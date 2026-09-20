import fs from 'node:fs';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closeDb, getDb } from '../src/db.js';
import { sweepGuestPhotos } from '../src/lib/guestSweep.js';

process.env.ADMIN_TOKEN = 'guest-test-admin-456';
process.env.ADMIN_PASSWORD = 'guest-test-admin-456';
process.env.DATA_DIR = './data-guest-test';
process.env.STORAGE_DIR = './storage-guest-test';
process.env.DB_PATH = './data-guest-test/guest.db';
process.env.MAX_UPLOAD_MB = '2';
process.env.GUEST_UPLOAD = '1';

const ADMIN = { 'x-admin-token': 'guest-test-admin-456' };
let app: ReturnType<typeof createApp>;
let tinyPng: Buffer;

beforeAll(async () => {
  try {
    closeDb();
  } catch {}
  fs.rmSync('./data-guest-test', { force: true, recursive: true });
  fs.rmSync('./storage-guest-test', { force: true, recursive: true });
  fs.mkdirSync('./data-guest-test', { recursive: true });
  fs.mkdirSync('./storage-guest-test/tmp', { recursive: true });
  fs.mkdirSync('./storage-guest-test/originals', { recursive: true });
  app = createApp();
  tinyPng = await sharp({
    create: { background: { b: 30, g: 200, r: 10 }, channels: 3, height: 64, width: 64 },
  })
    .png()
    .toBuffer();
});

afterAll(() => {
  try {
    closeDb();
  } catch {}
  fs.rmSync('./data-guest-test', { force: true, recursive: true });
  fs.rmSync('./storage-guest-test', { force: true, recursive: true });
});

describe('guest upload tanpa token', () => {
  it('halaman /g terbuka saat GUEST_UPLOAD=1', async () => {
    await request(app).get('/g').expect(200);
  });
  it('upload tanpa token langsung jadi link', async () => {
    const r = await request(app)
      .post('/api/guest/upload')
      .field('openDurationSec', '30')
      .field('maxViews', '5')
      .field('expiresInSec', '3600')
      .attach('photo', tinyPng, 'guest.png')
      .expect(201);
    expect(r.body.urlPath).toMatch(/^\/v\//);
  });
  it('foto guest tampil di daftar admin dengan tanda guest', async () => {
    const r = await request(app).get('/api/photos').set(ADMIN).expect(200);
    expect(r.body.photos.length).toBeGreaterThan(0);
    expect(r.body.photos.every((p: any) => p.guest === 1)).toBe(true);
    const s = await request(app).get('/api/shares').set(ADMIN).expect(200);
    expect(s.body.shares.length).toBeGreaterThan(0);
  });
  it('viewer guest bisa dibuka + image no-store', async () => {
    const up = await request(app)
      .post('/api/guest/upload')
      .field('openDurationSec', '30')
      .field('maxViews', '5')
      .field('expiresInSec', '3600')
      .attach('photo', tinyPng, 'guest2.png')
      .expect(201);
    const token = up.body.urlPath.split('/')[2] as string;
    await request(app).get(`/v/${token}`).expect(200);
    const o = await request(app).post(`/v/${token}/open`).expect(200);
    const img = await request(app).get(o.body.imageUrl).expect(200);
    expect(img.headers['cache-control']).toMatch(/no-store/);
  }, 15000);
  it('view guest tercatat di audit (IP terlihat di admin)', async () => {
    const db = getDb();
    const c = (
      db.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action IN ('VIEW_PAGE','VIEW_OPEN','VIEW_IMAGE')`).get() as {
        c: number;
      }
    ).c;
    expect(c).toBeGreaterThan(0);
  });
  it('foto guest disimpan permanen (tidak auto-hapus)', async () => {
    const c0 = (
      getDb().prepare(`SELECT COUNT(*) AS c FROM photos WHERE guest=1`).get() as { c: number }
    ).c;
    const up = await request(app)
      .post('/api/guest/upload')
      .field('openDurationSec', '3')
      .field('oneTime', '1')
      .field('expiresInSec', '3600')
      .attach('photo', tinyPng, 'sekali.png')
      .expect(201);
    const token = up.body.urlPath.split('/')[2] as string;
    await request(app).post(`/v/${token}/open`).expect(200);
    await request(app).post(`/v/${token}/open`).expect(410);
    await new Promise((r) => setTimeout(r, 3400));
    const n = sweepGuestPhotos(getDb());
    expect(n).toBe(0);
    const left = (
      getDb().prepare(`SELECT COUNT(*) AS c FROM photos WHERE guest=1`).get() as { c: number }
    ).c;
    expect(left).toBe(c0 + 1);
  }, 15000);
  it('guest dimatikan via env → 404', async () => {
    process.env.GUEST_UPLOAD = '0';
    await request(app).get('/g').expect(404);
    await request(app)
      .post('/api/guest/upload')
      .attach('photo', tinyPng, 'x.png')
      .expect(404);
    process.env.GUEST_UPLOAD = '1';
  });
});
