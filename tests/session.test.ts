import fs from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closeDb, getDb } from '../src/db.js';

process.env.ADMIN_TOKEN = 'session-test-admin-789';
process.env.ADMIN_PASSWORD = 'session-test-admin-789';
process.env.DATA_DIR = './data-session-test';
process.env.STORAGE_DIR = './storage-session-test';
process.env.DB_PATH = './data-session-test/session.db';

const PW = 'session-test-admin-789';
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  try {
    closeDb();
  } catch {}
  fs.rmSync('./data-session-test', { force: true, recursive: true });
  fs.rmSync('./storage-session-test', { force: true, recursive: true });
  app = createApp();
});

afterAll(() => {
  try {
    closeDb();
  } catch {}
  fs.rmSync('./data-session-test', { force: true, recursive: true });
  fs.rmSync('./storage-session-test', { force: true, recursive: true });
});

describe('login password + sesi', () => {
  it('password salah → 401', async () => {
    await request(app).post('/api/login').send({ password: 'salah' }).expect(401);
  });
  it('tanpa sesi → 401', async () => {
    await request(app).get('/api/photos').expect(401);
  });
  it('login benar → cookie + akses granted', async () => {
    const agent = request.agent(app);
    const r = await agent.post('/api/login').send({ password: PW }).expect(200);
    const cookie = String(r.headers['set-cookie'] ?? '');
    expect(cookie).toMatch(/glymp_session/);
    expect(cookie).toMatch(/HttpOnly/);
    await agent.get('/api/photos').expect(200);
  });
  it('logout mencabut sesi', async () => {
    const agent = request.agent(app);
    await agent.post('/api/login').send({ password: PW }).expect(200);
    await agent.get('/api/photos').expect(200);
    await agent.post('/api/logout').expect(200);
    await agent.get('/api/photos').expect(401);
  });
  it('header token lama tetap kompatibel', async () => {
    await request(app).get('/api/photos').set({ 'x-admin-token': PW }).expect(200);
  });
  it('sesi kedaluwarsa ditolak', async () => {
    const agent = request.agent(app);
    await agent.post('/api/login').send({ password: PW }).expect(200);
    getDb().prepare(`UPDATE sessions SET expires_at=?`).run(Date.now() - 1000);
    await agent.get('/api/photos').expect(401);
  });
});
