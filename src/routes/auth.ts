import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { audit, clientIp, clientUa } from '../lib/audit.js';
import { secureToken, timingSafeEqualString } from '../lib/tokens.js';
import { loginLimiter } from '../middleware/rateLimit.js';

const router = Router();

export const SESSION_COOKIE = 'glymp_session';
const SESSION_DAYS = 30;

function sessionCookie(id: string, maxAgeSec: number): string {
  // Tanpa Secure agar tetap jalan di http:// lokal Termux.
  // Di balik Cloudflare Tunnel, TLS ditangani tunnel.
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax`;
}

export function getSessionId(req: { headers: { cookie?: string } }): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === SESSION_COOKIE) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Login dengan password saja — dapat cookie sesi httpOnly 30 hari. */
router.post('/api/login', loginLimiter, (req, res) => {
  const db = getDb();
  const pw = String(req.body?.password ?? '');
  if (!pw || !timingSafeEqualString(pw, config.adminPassword)) {
    audit(db, req, 'LOGIN', 'rejected', { detail: 'wrong_password' });
    res.status(401).json({ error: 'password_salah' });
    return;
  }
  const id = secureToken(32);
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions(id, created_at, expires_at, ip, user_agent) VALUES(?,?,?,?,?)`,
  ).run(id, now, now + SESSION_DAYS * 24 * 3600 * 1000, clientIp(req), clientUa(req));
  audit(db, req, 'LOGIN', 'ok', {});
  res.setHeader('Set-Cookie', sessionCookie(id, SESSION_DAYS * 24 * 3600));
  res.json({ ok: true });
});

/** Logout — cabut sesi. Idempotent, tanpa auth. */
router.post('/api/logout', (req, res) => {
  const sid = getSessionId(req);
  if (sid) {
    try {
      getDb().prepare(`DELETE FROM sessions WHERE id=?`).run(sid);
    } catch {
      /* abaikan */
    }
  }
  try {
    audit(getDb(), req, 'LOGOUT', 'ok', {});
  } catch {
    /* abaikan */
  }
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  res.json({ ok: true });
});

export default router;
