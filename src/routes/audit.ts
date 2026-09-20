import { Router } from 'express';
import { getDb } from '../db.js';
import { audit } from '../lib/audit.js';

const router = Router();

router.get('/audit', (req, res) => {
  const db = getDb();
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100));
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
  const action = typeof req.query.action === 'string' ? req.query.action : '';
  const rows = action
    ? db
        .prepare(`SELECT * FROM audit_logs WHERE action=? ORDER BY id DESC LIMIT ? OFFSET ?`)
        .all(action, limit, offset)
    : db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset);
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM audit_logs`).get() as { c: number }).c;
  res.json({ logs: rows, total });
});

router.post('/audit/cleanup', (req, res) => {
  const db = getDb();
  const daysRow = db
    .prepare(`SELECT value FROM settings WHERE key='audit_retention_days'`)
    .get() as { value: string } | undefined;
  const days = Number(daysRow?.value ?? process.env.AUDIT_RETENTION_DAYS ?? 90);
  if (!days || days <= 0) {
    res.json({ ok: true, deleted: 0, note: 'retensi_tanpa_batas' });
    return;
  }
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const r = db.prepare(`DELETE FROM audit_logs WHERE timestamp < ?`).run(cutoff);
  audit(db, req, 'AUDIT_CLEANUP', 'ok', { detail: `deleted:${r.changes}:older_than:${days}d` });
  res.json({ ok: true, deleted: r.changes });
});

router.get('/settings', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  res.json({ settings: rows });
});

router.put('/settings', (req, res) => {
  const db = getDb();
  const { auditRetentionDays } = req.body ?? {};
  if (auditRetentionDays !== undefined) {
    const d = Number(auditRetentionDays);
    if (!Number.isInteger(d) || d < 0 || d > 3650) {
      res.status(400).json({ error: 'retensi_tidak_valid' });
      return;
    }
    db.prepare(
      `INSERT INTO settings(key,value) VALUES('audit_retention_days',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run(String(d));
  }
  res.json({ ok: true });
});

export default router;
