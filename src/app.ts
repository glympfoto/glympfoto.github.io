import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getDb } from './db.js';
import { audit } from './lib/audit.js';
import { adminAuth } from './middleware/adminAuth.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { helmetMiddleware, noStore } from './middleware/security.js';
import auditRouter from './routes/audit.js';
import authRouter from './routes/auth.js';
import guestRouter from './routes/guest.js';
import photosRouter from './routes/photos.js';
import sharesRouter from './routes/shares.js';
import viewerRouter from './routes/viewer.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmetMiddleware);
  app.use(globalLimiter);
  app.use(express.json({ limit: '1mb' }));

  // Static untuk admin UI & viewer assets.
  // JS/CSS dipaksa no-store: file kecil, dan cache basi pernah bikin
  // viewer gagal tampil (JS lama + HTML baru tidak cocok).
  // Original TIDAK PERNAH di public/static.
  const pub = path.resolve(process.cwd(), 'public');
  app.use(
    express.static(pub, {
      dotfiles: 'deny',
      extensions: false,
      index: false,
      maxAge: 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
          res.setHeader('Pragma', 'no-cache');
        }
      },
    }),
  );

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Shortlink self-hosted — HARUS sebelum viewerRouter
  app.get('/s/:code', (req, res) => {
    try {
      const row = getDb()
        .prepare(`SELECT token FROM share_links WHERE short_code=?`)
        .get(req.params.code) as { token: string } | undefined;
      if (!row) {
        res.status(404).send('Tidak ditemukan.');
        return;
      }
      res.redirect(302, `/v/${row.token}`);
    } catch {
      res.status(404).send('Tidak ditemukan.');
    }
  });

  // Router publik — HARUS sebelum adminAuth agar tidak tersegat
  app.use(authRouter);
  app.use(guestRouter);
  app.use('/api', adminAuth, photosRouter);
  app.use('/api', adminAuth, sharesRouter);
  app.use('/api', adminAuth, auditRouter);
  app.use(viewerRouter);

  // Halaman guest upload (tanpa token) — hanya jika GUEST_UPLOAD=1
  app.get('/g', (_req, res) => {
    if (!config.guestUpload) {
      res.status(404).send('Tidak ditemukan.');
      return;
    }
    res.sendFile(path.join(pub, 'guest.html'));
  });

  // Honeypot / direct-storage protection: endpoint apa pun yang mencoba
  // mengakses original/storage langsung dicatat sebagai DOWNLOAD_ATTEMPT.
  app.use(
    ['/storage', '/originals', '/data', '/tmp', '/uploads', '/files', '/download'],
    (req, res) => {
      try {
        audit(getDb(), req, 'DOWNLOAD_ATTEMPT', 'rejected', { detail: req.originalUrl });
      } catch {
        /* abaikan */
      }
      res.status(404).send('Tidak ditemukan.');
    },
  );

  // Admin dashboard
  app.get('/', (_req, res) => {
    res.sendFile(path.join(pub, 'admin.html'));
  });

  // Multer / upload error → 413
  app.use((err: any, _req: any, res: any, next: any) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'file_terlalu_besar' });
      return;
    }
    if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({ error: 'file_tidak_valid' });
      return;
    }
    next(err);
  });

  // Fallback no-store untuk viewer-ish path tak dikenal
  app.use(noStore, (req, res) => {
    if (req.path.startsWith('/v/')) {
      try {
        audit(getDb(), req, 'DOWNLOAD_ATTEMPT', 'rejected', { detail: req.originalUrl });
      } catch {
        /* abaikan */
      }
      res.status(404).send('Link tidak valid atau telah kedaluwarsa.');
      return;
    }
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}
