import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

let db: DatabaseSync | null = null;

export function getDb(dbPath = config.dbPath): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  // busy timeout 5s: SQLite otomatis menunggu lock WAL writer
  // (sesuai docs node:sqlite opsi `timeout`) alih-alih langsung SQLITE_BUSY
  db = new DatabaseSync(dbPath, { timeout: 5000 });
  // Pragmas — best effort, jangan gagalkan boot jika tidak didukung
  try {
    db.exec('PRAGMA journal_mode = WAL');
  } catch {}
  initSchema(db);
  return db;
}

export function initSchema(d: DatabaseSync): void {
  d.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS share_links (
    id TEXT PRIMARY KEY,
    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    one_time INTEGER NOT NULL DEFAULT 0,
    max_views INTEGER,
    views_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    open_duration_sec INTEGER NOT NULL DEFAULT 30,
    watermark_enabled INTEGER NOT NULL DEFAULT 1,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_share_token ON share_links(token);
  CREATE TABLE IF NOT EXISTS view_sessions (
    id TEXT PRIMARY KEY,
    share_id TEXT NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    view_number INTEGER NOT NULL,
    opened_at INTEGER NOT NULL,
    expires_at_image INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_view_token ON view_sessions(token);
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    view_id TEXT,
    share_token TEXT,
    timestamp INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
  `);
  // Migrasi: tandai foto guest (tanpa riwayat, auto-hapus)
  try {
    d.exec(`ALTER TABLE photos ADD COLUMN guest INTEGER NOT NULL DEFAULT 0`);
  } catch {
    /* kolom sudah ada */
  }
  // Migrasi: lokasi untuk audit (kota/ip + GPS presisi)
  for (const col of [
    `ALTER TABLE audit_logs ADD COLUMN country TEXT`,
    `ALTER TABLE audit_logs ADD COLUMN city TEXT`,
    `ALTER TABLE audit_logs ADD COLUMN lat REAL`,
    `ALTER TABLE audit_logs ADD COLUMN lon REAL`,
    `ALTER TABLE audit_logs ADD COLUMN accuracy REAL`,
  ]) {
    try {
      d.exec(col);
    } catch {
      /* kolom sudah ada */
    }
  }
  // Migrasi: model device dari Client Hints (Chrome baru menyembunyikan
  // model di UA → "(Linux; Android 10; K)"). Diisi dari header
  // Sec-CH-UA-Model atau laporan JS navigator.userAgentData.
  try {
    d.exec(`ALTER TABLE audit_logs ADD COLUMN device TEXT`);
  } catch {
    /* kolom sudah ada */
  }
  // Migrasi: short_code untuk shortlink self-hosted (/s/:code)
  try {
    d.exec(`ALTER TABLE share_links ADD COLUMN short_code TEXT`);
  } catch {
    /* kolom sudah ada */
  }
  try {
    d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_share_short ON share_links(short_code)`);
  } catch {
    /* index sudah ada */
  }
  const row = d.prepare(`SELECT value FROM settings WHERE key='audit_retention_days'`).get() as
    | { value: string }
    | undefined;
  if (!row) {
    d.prepare(`INSERT INTO settings(key,value) VALUES('audit_retention_days',?)`).run(
      String(config.auditRetentionDays),
    );
  }
}

export function closeDb(): void {
  if (db) {
    try {
      db.close();
    } catch {}
    db = null;
  }
}
