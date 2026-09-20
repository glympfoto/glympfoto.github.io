import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import multer from 'multer';
import { config, getOriginalsDir, getTmpDir } from '../config.js';
import { getDb } from '../db.js';
import { extOf, isAllowedExtMime, mirrorToShared, sanitizeFilename } from '../lib/files.js';
import { newId, secureToken, shortCode } from '../lib/tokens.js';
import { guestUploadLimiter } from '../middleware/rateLimit.js';

const router = Router();

function makeGuestUpload() {
  return multer({
    storage: multer.diskStorage({
      destination(_req, _file, cb) {
        try {
          fs.mkdirSync(getTmpDir(), { recursive: true });
        } catch {}
        cb(null, getTmpDir());
      },
      filename(_req, file, cb) {
        const ext = extOf(file.originalname) || '';
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
      },
    }),
    fileFilter: (_req, _file, cb) => cb(null, true),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
  });
}

function guestEnabled(_req: unknown, res: any, next: any): void {
  if (!config.guestUpload) {
    res.status(404).json({ error: 'guest_disabled' });
    return;
  }
  next();
}

/**
 * Guest upload TANPA token admin.
 * - Satu request = 1 foto + 1 share link langsung.
 * - Watermark selalu ON, expiry selalu ada (default 24 jam).
 * - TANPA audit log — mode tanpa riwayat.
 * - Original guest disimpan permanen di storage (selamanya, seperti admin).
 */
router.post(
  '/api/guest/upload',
  guestEnabled,
  guestUploadLimiter,
  (req, res, next) => makeGuestUpload().single('photo')(req, res, next),
  async (req, res) => {
  const db = getDb();
  const f = req.file;
  if (!f) {
    res.status(400).json({ error: 'file_wajib_diisi' });
    return;
  }
  const cleanup = (): void => {
    try {
      if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    } catch {
      /* abaikan */
    }
  };
  try {
    const safeOriginal = sanitizeFilename(f.originalname);
    const ext = extOf(safeOriginal);
    if (!isAllowedExtMime(ext, f.mimetype)) {
      cleanup();
      res.status(400).json({ error: 'tipe_file_tidak_didukung' });
      return;
    }
    let width: number;
    let height: number;
    try {
      const meta = await sharp(f.path, { failOnError: true }).metadata();
      if (!meta.format || !meta.width || !meta.height) throw new Error('bukan gambar valid');
      width = meta.width;
      height = meta.height;
    } catch {
      cleanup();
      res.status(400).json({ error: 'file_bukan_gambar_valid' });
      return;
    }
    const one = req.body?.oneTime === 'true' || req.body?.oneTime === '1';
    let max: number | null = req.body?.maxViews ? Number(req.body.maxViews) : 5;
    if (one) max = 1;
    if (!Number.isInteger(max) || (max as number) < 1 || (max as number) > 20) {
      cleanup();
      res.status(400).json({ error: 'maxViews_tidak_valid' });
      return;
    }
    const openSec = Number(req.body?.openDurationSec ?? 30);
    if (!Number.isInteger(openSec) || openSec < 3 || openSec > 900) {
      cleanup();
      res.status(400).json({ error: 'openDurationSec_tidak_valid' });
      return;
    }
    const expSec = req.body?.expiresInSec ? Number(req.body.expiresInSec) : 86400;
    if (!Number.isInteger(expSec) || expSec < 300 || expSec > 604800) {
      cleanup();
      res.status(400).json({ error: 'expiresInSec_tidak_valid' });
      return;
    }
    const photoId = newId();
    const storedName = `${photoId}${ext}`;
    fs.mkdirSync(getOriginalsDir(), { recursive: true });
    const dest = path.join(getOriginalsDir(), storedName);
    fs.renameSync(f.path, dest);
    const stat = fs.statSync(dest);
    // Arsip ke memori bersama (best-effort, tidak menggagalkan upload)
    mirrorToShared(dest, safeOriginal);
    const now = Date.now();
    db.prepare(
      `INSERT INTO photos(id, filename, stored_name, mime, size, width, height, created_at, guest)
       VALUES(?,?,?,?,?,?,?,?,1)`,
    ).run(photoId, safeOriginal, storedName, f.mimetype, stat.size, width, height, now);
    const shareId = newId();
    const token = secureToken(32);
    let code = shortCode(5);
    for (let i = 0; i < 5; i++) {
      const exists = db.prepare(`SELECT 1 FROM share_links WHERE short_code=?`).get(code) as
        | { '1': number }
        | undefined;
      if (!exists) break;
      code = shortCode(5);
    }
    db.prepare(
      `INSERT INTO share_links(id, photo_id, token, short_code, one_time, max_views, views_count, expires_at,
        open_duration_sec, watermark_enabled, revoked, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(shareId, photoId, token, code, one ? 1 : 0, max, 0, now + expSec * 1000, openSec, 1, 0, now);
    const pub = config.publicHost ? `https://${config.publicHost}` : '';
    const urlPath = `/v/${token}`;
    const shortPath = `/s/${code}`;
    res.status(201).json({
      expiresAt: now + expSec * 1000,
      maxViews: max,
      oneTime: one,
      openDurationSec: openSec,
      shortPath,
      shortUrl: pub ? `${pub}${shortPath}` : shortPath,
      url: pub ? `${pub}${urlPath}` : urlPath,
      urlPath,
    });
  } catch {
    cleanup();
    res.status(500).json({ error: 'upload_gagal' });
  }
});

export default router;
