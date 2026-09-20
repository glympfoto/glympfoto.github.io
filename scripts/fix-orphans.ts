/**
 * Cleanup satu kali: hapus record photos yang filenya sudah tidak ada di disk.
 * Cascade otomatis menghapus share_links + view_sessions terkait (foreign_keys ON).
 *
 * HANYA record tanpa file yang dihapus. File yatim (ada file, tidak ada record)
 * TIDAK disentuh sesuai keputusan.
 *
 * Backup DB dibuat otomatis sebelum penghapusan.
 *
 * Pakai: npx tsx scripts/fix-orphans.ts [--apply]
 *   tanpa --apply = dry-run, hanya lapor
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, getOriginalsDir } from '../src/config.js';
import { getDb } from '../src/db.js';

const APPLY = process.argv.includes('--apply');
const db = getDb();

type Photo = { id: string; stored_name: string; filename: string };
const photos = db.prepare(`SELECT id, stored_name, filename FROM photos`).all() as Photo[];

const orphans: Photo[] = [];
const present: Photo[] = [];
const dir = getOriginalsDir();

for (const p of photos) {
  const full = path.join(dir, path.basename(p.stored_name));
  if (fs.existsSync(full)) present.push(p);
  else orphans.push(p);
}

console.log(`storage dir : ${dir}`);
console.log(`total record: ${photos.length}`);
console.log(`file ada    : ${present.length}`);
console.log(`file hilang : ${orphans.length}`);

if (orphans.length === 0) {
  console.log('\nTidak ada record yatim. Selesai.');
  process.exit(0);
}

// Hitung apa yang akan ter-cascade
const ids = orphans.map((p) => p.id);
const placeholders = ids.map(() => '?').join(',');
const links = (
  db.prepare(`SELECT COUNT(*) AS c FROM share_links WHERE photo_id IN (${placeholders})`).get(...ids) as { c: number }
).c;
const sessions = (
  db
    .prepare(
      `SELECT COUNT(*) AS c FROM view_sessions WHERE share_id IN (SELECT id FROM share_links WHERE photo_id IN (${placeholders}))`,
    )
    .get(...ids) as { c: number }
).c;

console.log(`\nAkan dihapus:`);
console.log(`  record photos      : ${orphans.length}`);
console.log(`  share_links (cascade): ${links}`);
console.log(`  view_sessions (cascade): ${sessions}`);
orphans.slice(0, 10).forEach((p) => console.log(`  - ${p.filename} (${p.id})`));
if (orphans.length > 10) console.log(`  ... dan ${orphans.length - 10} lainnya`);

if (!APPLY) {
  console.log('\nDRY-RUN: tidak ada yang dihapus. Jalankan dengan --apply untuk eksekusi.');
  process.exit(0);
}

// Backup DB dulu
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${config.dbPath}.bak.${ts}`;
fs.copyFileSync(config.dbPath, backup);
console.log(`\nBackup DB: ${backup}`);

db.exec('BEGIN IMMEDIATE');
try {
  const r = db.prepare(`DELETE FROM photos WHERE id IN (${placeholders})`).run(...ids);
  db.exec('COMMIT');
  console.log(`\nSelesai: ${r.changes} record dihapus (+ ${links} link, ${sessions} session ter-cascade).`);
  const after = (db.prepare(`SELECT COUNT(*) AS c FROM photos`).get() as { c: number }).c;
  console.log(`Jumlah foto sekarang: ${after}`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('Gagal, di-rollback:', e);
  process.exit(1);
}
