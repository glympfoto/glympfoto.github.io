import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { timingSafeEqualString } from '../lib/tokens.js';
import { getSessionId } from '../routes/auth.js';

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  // 1. Sesi cookie dari login password
  const sid = getSessionId(req);
  if (sid) {
    try {
      const db = getDb();
      const s = db.prepare(`SELECT expires_at FROM sessions WHERE id=?`).get(sid) as
        | { expires_at: number }
        | undefined;
      if (s && s.expires_at > Date.now()) {
        next();
        return;
      }
      if (s) {
        try {
          db.prepare(`DELETE FROM sessions WHERE id=?`).run(sid);
        } catch {
          /* abaikan */
        }
      }
    } catch {
      /* lanjut ke cek token */
    }
  }
  // 2. Header token (kompatibel API/curl lama)
  const header = req.headers['x-admin-token'];
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const got = String(Array.isArray(header) ? header[0] : (header ?? bearer ?? ''));
  if (got && timingSafeEqualString(got, config.adminPassword)) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}
