import fs from 'node:fs';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closeDb } from '../src/db.js';

process.env.ADMIN_TOKEN = 'test-admin-token-123';
process.env.ADMIN_PASSWORD = 'test-admin-token-123';
process.env.DATA_DIR = './data-test';
process.env.STORAGE_DIR = './storage-test';
process.env.DB_PATH = './data-test/test.db';
process.env.MAX_UPLOAD_MB = '2';

const ADMIN = { 'x-admin-token': 'test-admin-token-123' };
let app: ReturnType<typeof createApp>;
let photoId = '';
let tinyPng: Buffer;

beforeAll(async () => {
  try { closeDb(); } catch {}
  fs.rmSync('./data-test', { force: true, recursive: true });
  fs.rmSync('./storage-test', { force: true, recursive: true });
  app = createApp();
  tinyPng = await sharp({
    create: { background: { b: 80, g: 120, r: 200 }, channels: 3, height: 64, width: 64 },
  })
    .png()
    .toBuffer();
});

afterAll(() => {
  try { closeDb(); } catch {}
  fs.rmSync('./data-test', { force: true, recursive: true });
  fs.rmSync('./storage-test', { force: true, recursive: true });
});

describe('upload & auth', () => {
  it('menolak tanpa admin token', async () => {
    await request(app).get('/api/photos').expect(401);
  });
  it('menolak MIME tidak valid', async () => {
    await request(app).post('/api/photos').set(ADMIN).attach('photo', Buffer.from('bukan gambar'), 'x.txt').expect(400);
  });
  it('menolak file terlalu besar', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 1);
    const r = await request(app).post('/api/photos').set(ADMIN).attach('photo', big, 'big.png');
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).not.toBe(201);
  });
  it('upload valid OK', async () => {
    const r = await request(app).post('/api/photos').set(ADMIN).attach('photo', tinyPng, 'foto.png').expect(201);
    expect(r.body.id).toBeTruthy();
    photoId = r.body.id;
  });
  it('path traversal ditolak via thumb id aneh', async () => {
    await request(app).get('/api/photos/..%2F..%2Fetc%2Fpasswd/thumb').set(ADMIN).expect(404);
  });
});

describe('sharing lifecycle', () => {
  let token = '';
  it('buat link one-time + open 5 detik', async () => {
    const r = await request(app)
      .post('/api/shares')
      .set(ADMIN)
      .send({ oneTime: true, openDurationSec: 5, photoId })
      .expect(201);
    token = r.body.token;
    expect(token.length).toBeGreaterThan(20);
  });
  it('viewer page memuat tanpa bocor original', async () => {
    const r = await request(app).get(`/v/${token}`).expect(200);
    expect(r.text).not.toMatch(/originals/i);
    expect(r.text).not.toMatch(/\.png.*storage/i);
    expect(r.headers['cache-control']).toMatch(/no-store/);
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });
  it('open pertama OK + image no-store + watermark berbeda per session', async () => {
    const o = await request(app).post(`/v/${token}/open`).expect(200);
    const img = await request(app).get(o.body.imageUrl).expect(200);
    expect(img.headers['cache-control']).toMatch(/no-store/);
    expect(img.headers['content-type']).toMatch(/jpeg/);
    expect(img.body.length).toBeGreaterThan(1000);
    (global as any).__img1 = Buffer.from(img.body);
  }, 15000);
  it('one-time: open kedua ditolak (410)', async () => {
    await request(app).post(`/v/${token}/open`).expect(410);
  });
  it('token invalid 404 + audit DOWNLOAD_ATTEMPT tercatat', async () => {
    await request(app).get('/v/token-ngawur-123/img/x').expect(404);
    const logs = await request(app).get('/api/audit?limit=50').set(ADMIN).expect(200);
    const actions = (logs.body.logs as any[]).map((l) => l.action);
    expect(actions).toContain('DOWNLOAD_ATTEMPT');
  });
  it('original tidak bisa diakses langsung', async () => {
    for (const p of ['/storage/originals/x.png', '/originals/x', '/data/test.db', '/v/abc/img/evil']) {
      await request(app).get(p).expect(404);
    }
  });
});

describe('max views & race', () => {
  it('max_views=3: request ke-4 ditolak; race 10 bersamaan hanya 3 lolos', async () => {
    const c = await request(app)
      .post('/api/shares')
      .set(ADMIN)
      .send({ maxViews: 3, openDurationSec: 60, photoId })
      .expect(201);
    const t = c.body.token;
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => request(app).post(`/v/${t}/open`)),
    );
    const ok = results.filter(
      (r) => r.status === 'fulfilled' && (r as any).value.status === 200,
    ).length;
    expect(ok).toBe(3);
  });
});

describe('expiry & revoke & timer', () => {
  it('link expired (buat lalu tunggu) ditolak', async () => {
    const c = await request(app)
      .post('/api/shares')
      .set(ADMIN)
      .send({ expiresInSec: 60, openDurationSec: 60, photoId })
      .expect(201);
    await request(app).post(`/api/shares/${c.body.id}/revoke`).set(ADMIN).expect(200);
    await request(app).post(`/v/${c.body.token}/open`).expect(410);
  });
  it('timer image expiry ditegakkan server (open 3 detik → tunggu → 410)', async () => {
    const c = await request(app)
      .post('/api/shares')
      .set(ADMIN)
      .send({ openDurationSec: 3, photoId })
      .expect(201);
    const o = await request(app).post(`/v/${c.body.token}/open`).expect(200);
    await new Promise((r) => setTimeout(r, 3400));
    await request(app).get(o.body.imageUrl).expect(410);
    await request(app).get(o.body.statusUrl).expect(410);
  }, 15000);
  it('revoke menghentikan image yang sudah dibuka', async () => {
    const c = await request(app)
      .post('/api/shares')
      .set(ADMIN)
      .send({ openDurationSec: 120, photoId })
      .expect(201);
    const o = await request(app).post(`/v/${c.body.token}/open`).expect(200);
    await request(app).post(`/api/shares/${c.body.id}/revoke`).set(ADMIN).expect(200);
    await request(app).get(o.body.imageUrl).expect(410);
  });
  it('audit log mencatat view lifecycle', async () => {
    const logs = await request(app).get('/api/audit?limit=200').set(ADMIN).expect(200);
    const actions = new Set((logs.body.logs as any[]).map((l) => l.action));
    for (const a of ['UPLOAD', 'SHARE_CREATE', 'VIEW_OPEN', 'VIEW_IMAGE']) {
      expect(actions.has(a)).toBe(true);
    }
    const blob = JSON.stringify(logs.body);
    expect(blob).not.toMatch(/test-admin-token-123/);
  });
});

describe('rate limiting', () => {
  it('viewer open dibatasi (burst besar → 429 muncul)', async () => {
    const c = await request(app)
      .post('/api/shares')
      .set(ADMIN)
      .send({ openDurationSec: 60, photoId })
      .expect(201);
    let limited = false;
    for (let i = 0; i < 70; i++) {
      const r = await request(app).post(`/v/${c.body.token}/open`);
      if (r.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  }, 20000);
});
