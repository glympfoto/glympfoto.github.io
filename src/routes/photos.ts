import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import multer from 'multer';
import { config, getOriginalsDir, getTmpDir } from '../config.js';
import { getDb } from '../db.js';
import { audit } from '../lib/audit.js';
import { extOf, isAllowedExtMime, sanitizeFilename, uniqueStoredName } from '../lib/files.js';
import { newId } from '../lib/tokens.js';
import { thumbBuffer } from '../lib/watermark.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { uploadLimiter } from '../middleware/rateLimit.js';

const router = Router();
router.use(adminAuth);

function makeUpload() {
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
    fileFilter: (_req, file, cb) => {
      const ext = extOf(file.originalname);
      if (!ext || file.size === 0) return;
      void ext;
      cb(null, true);
    },
    limits: { fileSize: config.maxUploadBytes, files: 1 },
  });
}

router.post('/photos', uploadLimiter, (req, res, next) => makeUpload().single('photo')(req, res, next), async (req, res) => {
  const db = getDb();
  const f = req.file;
  if (!f) {
    audit(db, req, 'UPLOAD', 'error', { detail: 'no_file' });
    res.status(400).json({ error: 'file_wajib_diisi' });
    return;
  }
  try {
    const safeOriginal = sanitizeFilename(f.originalname);
    const ext = extOf(safeOriginal);
    const mime = f.mimetype;
    if (!isAllowedExtMime(ext, mime)) {
      fs.unlinkSync(f.path);
      audit(db, req, 'UPLOAD', 'rejected', { detail: `invalid_mime:${mime}:${ext}` });
      res.status(400).json({ error: 'tipe_file_tidak_didukung' });
      return;
    }
    let width: number | null = null;
    let height: number | null = null;
    try {
      const meta = await sharp(f.path, { failOnError: true }).metadata();
      if (!meta.format || !meta.width || !meta.height) throw new Error('bukan gambar valid');
      width = meta.width;
      height = meta.height;
    } catch {
      fs.unlinkSync(f.path);
      audit(db, req, 'UPLOAD', 'rejected', { detail: 'invalid_image_content' });
      res.status(400).json({ error: 'file_bukan_gambar_valid' });
      return;
    }
    const id = newId();
    const storedName = uniqueStoredName(getOriginalsDir(), safeOriginal);
    if (!storedName) {
      fs.unlinkSync(f.path);
      audit(db, req, 'UPLOAD', 'error', { detail: 'storage_unavailable' });
      res.status(500).json({ error: 'upload_gagal' });
      return;
    }
    const dest = path.join(getOriginalsDir(), storedName);
    fs.renameSync(f.path, dest);
    const stat = fs.statSync(dest);
    db.prepare(
      `INSERT INTO photos(id, filename, stored_name, mime, size, width, height, created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    ).run(id, safeOriginal, storedName, mime, stat.size, width, height, Date.now());
    audit(db, req, 'UPLOAD', 'ok', { detail: `photo:${id}:${safeOriginal}:${stat.size}` });
    res.status(201).json({
      createdAt: Date.now(),
      filename: safeOriginal,
      height,
      id,
      mime,
      size: stat.size,
      width,
    });
  } catch (e) {
    try {
      if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    } catch {
      /* abaikan */
    }
    audit(db, req, 'UPLOAD', 'error', { detail: String(e).slice(0, 300) });
    res.status(500).json({ error: 'upload_gagal' });
  }
});

router.get('/photos', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.*, COUNT(s.id) AS links FROM photos p
       LEFT JOIN share_links s ON s.photo_id=p.id
       GROUP BY p.id ORDER BY p.created_at DESC LIMIT 200`,
    )
    .all();
  res.json({ photos: rows });
});

router.get('/photos/:id/thumb', async (req, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM photos WHERE id=?`).get(req.params.id) as
    | { stored_name: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const full = path.join(getOriginalsDir(), path.basename(row.stored_name));
  if (!fs.existsSync(full)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const w = Math.min(800, Math.max(64, Number(req.query.w ?? 480) || 480));
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.type('image/jpeg');
  try {
    const buf = await thumbBuffer(full, w);
    res.send(buf);
  } catch {
    res.status(500).json({ error: 'thumb_gagal' });
  }
});

router.delete('/photos/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM photos WHERE id=?`).get(req.params.id) as
    | { id: string; stored_name: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const full = path.join(getOriginalsDir(), path.basename(row.stored_name));
  try {
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch {
    /* lanjut hapus record */
  }
  db.prepare(`DELETE FROM photos WHERE id=?`).run(row.id);
  audit(db, req, 'PHOTO_DELETE', 'ok', { detail: `photo:${row.id}` });
  res.json({ ok: true });
});

export default router;
