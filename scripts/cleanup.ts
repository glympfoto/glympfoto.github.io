import fs from 'node:fs';
import { getDb } from '../src/db.js';
import { getTmpDir } from '../src/config.js';

const db = getDb();
const daysRow = db
  .prepare(`SELECT value FROM settings WHERE key='audit_retention_days'`)
  .get() as { value: string } | undefined;
const days = Number(daysRow?.value ?? 90);
if (days > 0) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const r = db.prepare(`DELETE FROM audit_logs WHERE timestamp < ?`).run(cutoff);
  console.log(`cleanup: hapus ${r.changes} log lama`);
}
const tmp = getTmpDir();
try {
  for (const f of fs.readdirSync(tmp)) {
    if (f === '.gitkeep') continue;
    const p = `${tmp}/${f}`;
    const st = fs.statSync(p);
    if (Date.now() - st.mtimeMs > 30 * 60 * 1000) fs.unlinkSync(p);
  }
} catch {
  /* abaikan */
}
console.log('cleanup selesai');
