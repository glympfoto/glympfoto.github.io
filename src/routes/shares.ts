import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { audit } from '../lib/audit.js';
import { newId, secureToken, shortCode } from '../lib/tokens.js';
import { adminAuth } from '../middleware/adminAuth.js';

const router = Router();
router.use(adminAuth);

const ALLOWED_OPEN = new Set([5, 10, 15, 30, 60, 120, 300]);

router.post('/shares', (req, res) => {
  const db = getDb();
  const { expiresInSec, maxViews, oneTime, openDurationSec, photoId, watermarkEnabled } =
    req.body ?? {};
  if (!photoId || typeof photoId !== 'string') {
    res.status(400).json({ error: 'photoId_wajib' });
    return;
  }
  const photo = db.prepare(`SELECT id FROM photos WHERE id=?`).get(photoId) as
    | { id: string }
    | undefined;
  if (!photo) {
    res.status(404).json({ error: 'foto_tidak_ditemukan' });
    return;
  }
  const one = oneTime === true || oneTime === 1;
  let max: number | null = null;
  if (one) max = 1;
  else if (maxViews === null || maxViews === undefined || maxViews === '') max = null;
  else {
    max = Number(maxViews);
    if (!Number.isInteger(max) || max < 1 || max > 1000) {
      res.status(400).json({ error: 'maxViews_tidak_valid' });
      return;
    }
  }
  let openSec = Number(openDurationSec ?? 30);
  if (!Number.isInteger(openSec) || openSec < 3 || openSec > 900) {
    res.status(400).json({ error: 'openDurationSec_tidak_valid' });
    return;
  }
  void ALLOWED_OPEN;
  let expiresAt: number | null = null;
  if (expiresInSec !== null && expiresInSec !== undefined && expiresInSec !== '') {
    const s = Number(expiresInSec);
    if (!Number.isInteger(s) || s < 60 || s > 60 * 60 * 24 * 30) {
      res.status(400).json({ error: 'expiresInSec_tidak_valid' });
      return;
    }
    expiresAt = Date.now() + s * 1000;
  }
  const wm = watermarkEnabled === false || watermarkEnabled === 0 ? 0 : 1;
  const id = newId();
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
  ).run(
    id,
    photoId,
    token,
    code,
    one ? 1 : 0,
    max,
    0,
    expiresAt,
    openSec,
    wm,
    0,
    Date.now(),
  );
  audit(db, req, 'SHARE_CREATE', 'ok', {
    detail: `share:${id}:photo:${photoId}:max:${max}:open:${openSec}s:wm:${wm}`,
    shareToken: token,
  });
  const urlPath = `/v/${token}`;
  const shortPath = `/s/${code}`;
  const pub = config.publicHost ? `https://${config.publicHost}` : '';
  res.status(201).json({
    expiresAt,
    id,
    maxViews: max,
    oneTime: one,
    openDurationSec: openSec,
    shortPath,
    shortUrl: pub ? `${pub}${shortPath}` : shortPath,
    token,
    url: pub ? `${pub}${urlPath}` : urlPath,
    urlPath,
    watermarkEnabled: wm === 1,
    warning: wm === 0 ? 'Watermark OFF — kemampuan tracing screenshot berkurang.' : undefined,
  });
});

router.get('/shares', (req, res) => {
  const db = getDb();
  const { photoId } = req.query;
  const rows =
    typeof photoId === 'string' && photoId
      ? db
          .prepare(`SELECT * FROM share_links WHERE photo_id=? ORDER BY created_at DESC`)
          .all(photoId)
      : db.prepare(`SELECT * FROM share_links ORDER BY created_at DESC LIMIT 200`).all();
  res.json({ shares: rows });
});

router.post('/shares/:id/revoke', (req, res) => {
  const db = getDb();
  const r = db.prepare(`SELECT id FROM share_links WHERE id=?`).get(req.params.id) as
    | { id: string }
    | undefined;
  if (!r) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  db.prepare(`UPDATE share_links SET revoked=1 WHERE id=?`).run(r.id);
  audit(db, req, 'SHARE_REVOKE', 'ok', { detail: `share:${r.id}` });
  res.json({ ok: true });
});

router.delete('/shares/:id', (req, res) => {
  const db = getDb();
  const r = db.prepare(`SELECT id, token FROM share_links WHERE id=?`).get(req.params.id) as
    | { id: string; token: string }
    | undefined;
  if (!r) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  db.prepare(`DELETE FROM share_links WHERE id=?`).run(r.id);
  audit(db, req, 'SHARE_DELETE', 'ok', { detail: `share:${r.id}`, shareToken: r.token });
  res.json({ ok: true });
});

export default router;
