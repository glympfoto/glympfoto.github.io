import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ASSET_V, config, getOriginalsDir } from '../config.js';
import { getDb } from '../db.js';
import { audit, clientIp, clientUa } from '../lib/audit.js';
import { sweepGuestPhotos } from '../lib/guestSweep.js';
import { newId } from '../lib/tokens.js';
import { watermarkedBuffer } from '../lib/watermark.js';
import { noStore } from '../middleware/security.js';
import { viewerImageLimiter, viewerOpenLimiter } from '../middleware/rateLimit.js';

const router = Router();
router.use(noStore);

type Share = {
  created_at: number;
  expires_at: number | null;
  id: string;
  max_views: number | null;
  one_time: number;
  open_duration_sec: number;
  photo_id: string;
  revoked: number;
  token: string;
  views_count: number;
  watermark_enabled: number;
};

function getShare(db: ReturnType<typeof getDb>, token: string): Share | undefined {
  return db.prepare(`SELECT * FROM share_links WHERE token=?`).get(token) as Share | undefined;
}

function invalid(res: Parameters<Parameters<typeof router.get>[1]>[1]) {
  return res.status(404).send('Link tidak valid atau telah kedaluwarsa.');
}

/** Halaman viewer — TIDAK memuat gambar, TIDAK consume view */
router.get('/v/:token', (req, res) => {
  const db = getDb();
  const share = getShare(db, req.params.token);
  if (!share) {
    audit(db, req, 'INVALID_TOKEN', 'rejected', { shareToken: req.params.token });
    return invalid(res);
  }
  audit(db, req, 'VIEW_PAGE', 'ok', { shareToken: share.token });
  const html = viewerHtml();
  // Opt-in Client Hints: Chrome baru menyembunyikan model device di UA
  // ("Android 10; K"). Dengan Accept-CH, request berikutnya (open/img)
  // menyertakan Sec-CH-UA-Model (mis. CPH2387 = Oppo) yang dicatat audit.
  res.setHeader('Accept-CH', 'Sec-CH-UA-Model, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA-Mobile');
  res.type('html').send(html);
});

/**
 * Buka sesi view — ATOMIC via BEGIN IMMEDIATE.
 * DatabaseSync tidak punya helper transaction, jadi pakai exec manual.
 * BEGIN IMMEDIATE mengunci DB untuk writer lain sehingga
 * dua request bersamaan tidak bisa melewati max_views.
 */
router.post('/v/:token/open', viewerOpenLimiter, (req, res) => {
  const db = getDb();
  const token = req.params.token;
  const now = Date.now();

  let result: { ok: true; viewId: string; expiresAtImage: number; fresh: Share } | { ok: false; reason: string };

  try {
    db.exec('BEGIN IMMEDIATE');
    const s = db.prepare(`SELECT * FROM share_links WHERE token=?`).get(token) as Share | undefined;
    if (!s) {
      db.exec('ROLLBACK');
      audit(db, req, 'INVALID_TOKEN', 'rejected', { shareToken: token });
      res.status(404).json({ error: 'invalid' });
      return;
    }
    if (s.revoked) {
      db.exec('ROLLBACK');
      audit(db, req, 'VIEW_OPEN', 'rejected', { detail: 'REVOKED', shareToken: token });
      res.status(410).json({ error: 'expired' });
      return;
    }
    if (s.expires_at !== null && now > s.expires_at) {
      db.exec('ROLLBACK');
      audit(db, req, 'VIEW_OPEN', 'rejected', { detail: 'EXPIRED', shareToken: token });
      res.status(410).json({ error: 'expired' });
      return;
    }
    if (s.max_views !== null && s.views_count >= s.max_views) {
      db.exec('ROLLBACK');
      audit(db, req, 'VIEW_OPEN', 'rejected', { detail: 'MAX_VIEWS', shareToken: token });
      res.status(410).json({ error: 'expired' });
      return;
    }
    const viewId = newId();
    const expiresAtImage = now + s.open_duration_sec * 1000;
    db.prepare(`UPDATE share_links SET views_count = views_count + 1 WHERE id=?`).run(s.id);
    db.prepare(
      `INSERT INTO view_sessions(id, share_id, token, view_number, opened_at, expires_at_image, ip, user_agent)
       VALUES(?,?,?,?,?,?,?,?)`,
    ).run(viewId, s.id, token, s.views_count + 1, now, expiresAtImage, clientIp(req), clientUa(req));
    const fresh = db.prepare(`SELECT * FROM share_links WHERE id=?`).get(s.id) as Share;
    db.exec('COMMIT');
    result = { expiresAtImage, fresh, ok: true, viewId };
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    // SQLITE_BUSY → dua writer bersamaan
    const msg = String((e as Error)?.message ?? '');
    if (msg.includes('BUSY') || msg.includes('busy')) {
      audit(db, req, 'VIEW_OPEN', 'error', { shareToken: token, detail: 'tx_busy' });
      res.status(503).json({ error: 'coba_lagi' });
      return;
    }
    audit(db, req, 'VIEW_OPEN', 'error', { detail: msg.slice(0, 200), shareToken: token });
    res.status(503).json({ error: 'coba_lagi' });
    return;
  }

  audit(db, req, 'VIEW_OPEN', 'ok', { shareToken: token, viewId: result.viewId });
  // Bersihkan foto guest yang link-nya sudah mati (best-effort)
  try {
    sweepGuestPhotos(db);
  } catch {
    /* abaikan */
  }
  res.json({
    expiresAt: result.expiresAtImage,
    imageUrl: `/v/${token}/img/${result.viewId}`,
    openDurationSec: result.fresh.open_duration_sec,
    serverNow: Date.now(),
    statusUrl: `/v/${token}/status/${result.viewId}`,
    viewId: result.viewId,
    watermark: result.fresh.watermark_enabled === 1,
  });
});

/** Status server-side — sumber kebenaran sisa waktu */
router.get('/v/:token/status/:viewId', (req, res) => {
  const db = getDb();
  const { token, viewId } = req.params;
  const v = db.prepare(`SELECT * FROM view_sessions WHERE id=? AND token=?`).get(viewId, token) as
    | { expires_at_image: number }
    | undefined;
  if (!v) {
    audit(db, req, 'INVALID_TOKEN', 'rejected', { shareToken: token, viewId });
    res.status(404).json({ error: 'invalid' });
    return;
  }
  const now = Date.now();
  const remainingMs = v.expires_at_image - now;
  if (remainingMs <= 0) {
    audit(db, req, 'VIEW_EXPIRED', 'expired', { shareToken: token, viewId });
    res.status(410).json({ expired: true, remainingMs: 0, serverNow: now });
    return;
  }
  res.json({ expired: false, remainingMs, serverNow: now });
});

/** Stream rendered watermarked copy. Original TIDAK PERNAH dikirim. */
router.get('/v/:token/img/:viewId', viewerImageLimiter, async (req, res) => {
  const db = getDb();
  const { token, viewId } = req.params;
  const now = Date.now();

  const v = db
    .prepare(
      `SELECT vs.*, s.photo_id, s.revoked AS s_revoked, s.expires_at AS s_expires,
              s.watermark_enabled, s.token AS s_token
       FROM view_sessions vs JOIN share_links s ON s.id=vs.share_id
       WHERE vs.id=? AND vs.token=?`,
    )
    .get(viewId, token) as
    | {
        expires_at_image: number;
        photo_id: string;
        s_expires: number | null;
        s_revoked: number;
        s_token: string;
        watermark_enabled: number;
      }
    | undefined;

  if (!v || v.s_token !== token) {
    audit(db, req, 'DOWNLOAD_ATTEMPT', 'rejected', {
      detail: 'bad_view_token',
      shareToken: token,
      viewId,
    });
    res.status(404).send('Tidak ditemukan.');
    return;
  }
  if (v.s_revoked || (v.s_expires !== null && now > v.s_expires) || now > v.expires_at_image) {
    audit(db, req, 'VIEW_EXPIRED', 'expired', { shareToken: token, viewId });
    res.status(410).send('Foto telah kedaluwarsa.');
    return;
  }
  const photo = db.prepare(`SELECT stored_name FROM photos WHERE id=?`).get(v.photo_id) as
    | { stored_name: string }
    | undefined;
  if (!photo) {
    res.status(410).send('Foto telah kedaluwarsa.');
    return;
  }
  const full = path.join(getOriginalsDir(), path.basename(photo.stored_name));
  if (!fs.existsSync(full)) {
    res.status(410).send('Foto telah kedaluwarsa.');
    return;
  }
  try {
    // Hash IP viewer ditanam ke watermark — jejak forensik bila screenshot bocor.
    // Hash saja (bukan IP mentah) agar tidak memajang PII di gambar.
    let extraTag: string | undefined;
    try {
      const { createHash } = await import('node:crypto');
      extraTag = `net:${createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 8)}`;
    } catch {
      /* tanpa extraTag */
    }
    const { buffer } = await watermarkedBuffer(full, {
      enabled: v.watermark_enabled === 1,
      extraTag,
      shareToken: token,
      viewId,
    });
    audit(db, req, 'VIEW_IMAGE', 'ok', { shareToken: token, viewId });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const fa = config.publicHost
      ? `'self' https://${config.publicHost} ${config.publicHost === 'www.glympfoto.work.gd' ? 'https://glympfoto.work.gd' : ''} ${config.publicHost === 'glympfoto.work.gd' ? 'https://www.glympfoto.work.gd' : ''}`.trim()
      : `'none'`;
    res.setHeader('Content-Security-Policy', `default-src 'none'; frame-ancestors ${fa}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('image/jpeg').send(buffer);
  } catch {
    audit(db, req, 'VIEW_IMAGE', 'error', { shareToken: token, viewId });
    res.status(500).send('Gagal memuat foto.');
  }
});

/** Event deterrence/logging dari client (visibility, print, dll). BUKAN deteksi screenshot. */
router.post('/v/:token/event', (req, res) => {
  const db = getDb();
  const { event, model, platform, viewId } = req.body ?? {};
  const evName = String(event ?? 'unknown').slice(0, 120);
  // Laporan device dari navigator.userAgentData (kunjungan pertama, saat
  // header Sec-CH-UA-Model belum tersedia). Tempel ke baris VIEW_OPEN
  // sesi ini agar riwayat admin menampilkan model (mis. CPH2387 = Oppo).
  if (evName === 'device_model' && typeof viewId === 'string' && typeof model === 'string') {
    const clean = model.replace(/^"+|"+$/g, '').trim().slice(0, 64);
    if (clean) {
      try {
        db.prepare(
          `UPDATE audit_logs SET device=? WHERE view_id=? AND action='VIEW_OPEN' AND (device IS NULL OR device='')`,
        ).run(clean, viewId);
      } catch {}
      const plat = typeof platform === 'string' ? platform.slice(0, 32) : '';
      audit(db, req, 'VIEW_EVENT', 'ok', {
        detail: `model:${clean}${plat ? ' platform:' + plat : ''}`.slice(0, 120),
        shareToken: req.params.token,
        viewId,
      });
      res.json({ ok: true });
      return;
    }
  }
  audit(db, req, 'VIEW_EVENT', 'ok', {
    detail: evName,
    shareToken: req.params.token,
    viewId: typeof viewId === 'string' ? viewId : null,
  });
  res.json({ ok: true });
});

/** Lokasi presisi dari GPS viewer (dengan izin). Hanya update baris VIEW_OPEN yang ada. */
router.post('/v/:token/location', (req, res) => {
  const db = getDb();
  const { accuracy, lat, lon, viewId } = req.body ?? {};
  const token = req.params.token;
  if (typeof viewId !== 'string' || typeof lat !== 'number' || typeof lon !== 'number') {
    res.status(400).json({ error: 'bad_request' });
    return;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }
  const acc = typeof accuracy === 'number' ? Math.min(100000, Math.max(0, accuracy)) : null;
  // Pastikan viewId milik token ini dan masih ada
  const v = db
    .prepare(`SELECT id FROM view_sessions WHERE id=? AND token=?`)
    .get(viewId, token) as { id: string } | undefined;
  if (!v) {
    res.status(404).json({ error: 'invalid' });
    return;
  }
  // Update baris VIEW_OPEN yang menandai view ini
  const r = db
    .prepare(`UPDATE audit_logs SET lat=?, lon=?, accuracy=? WHERE view_id=? AND action='VIEW_OPEN'`)
    .run(lat, lon, acc, viewId);
  if (r.changes === 0) {
    // Fallback: buat baris lokasi terpisah
    audit(db, req, 'VIEW_LOCATION', 'ok', { viewId, shareToken: token, detail: `${lat},${lon}±${acc ?? '?'}m` });
    // coba update baris yang baru dibuat
    try {
      db.prepare(`UPDATE audit_logs SET lat=?, lon=?, accuracy=? WHERE view_id=? AND action='VIEW_LOCATION'`).run(
        lat,
        lon,
        acc,
        viewId,
      );
    } catch {}
  }
  res.json({ ok: true });
});

function viewerHtml(): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="referrer" content="no-referrer"/>
<title>Foto privat — GlympFoto</title>
<link rel="stylesheet" href="/view.css?v=${ASSET_V}"/>
</head>
<body>
<main class="wrap">
  <header class="top">
    <div class="brand">Glymp<span>Foto</span></div>
    <div id="countdown-wrap" class="countdown hidden" role="timer" aria-live="polite">
      <span class="dot" aria-hidden="true"></span><b id="countdown">--</b> <span>dtk</span>
    </div>
  </header>
  <section id="state-loading" class="card">
    <div class="spinner" aria-hidden="true"></div>
    <p>Memuat foto aman…</p>
  </section>
  <section id="state-error" class="card hidden">
    <h1>Link tidak valid atau telah kedaluwarsa.</h1>
    <p>Minta tautan baru kepada pengirim.</p>
  </section>
  <section id="state-photo" class="hidden">
    <p id="img-status" class="hint">Sedang menyiapkan foto mohon tunggu sebentar</p>
    <figure class="photo-frame">
      <img id="photo" class="hidden" alt="Foto privat" draggable="false"/>
    </figure>
    <div id="hold" class="hold hidden">
      <div class="hold-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 11a3 3 0 0 0-3 3v5a2 2 0 0 0 4 0v-4a1 1 0 0 1 2 0v4a2 2 0 0 0 4 0v-7a7 7 0 0 0-7-7h-1a5 5 0 0 0-5 5v4a3 3 0 0 0 6 0v-4a1 1 0 0 1 2 0v4"/>
          <path d="M9 13a2 2 0 0 1 4 0v3"/>
        </svg>
      </div>
      <button id="hold-btn" type="button">Tahan untuk melihat</button>
    </div>
  </section>
  <section id="state-expired" class="card hidden">
    <h1>Foto telah kedaluwarsa.</h1>
  </section>
</main>
<script src="/view.js?v=${ASSET_V}"></script>
</body>
</html>`;
}

export default router;
