import fs from 'node:fs';
import { createApp } from './app.js';
import { config, getOriginalsDir, getTmpDir } from './config.js';
import { getDb } from './db.js';
import { sweepGuestPhotos } from './lib/guestSweep.js';

// Global error handler: Node 22 default-nya crash pada unhandled rejection.
// Kalau ada error async yang lolos, catat stack-nya lengkap lalu exit(1)
// supaya watchdog mengangkat server dalam kondisi bersih — bukan swallow
// error yang bisa meninggalkan state rusak. Trace tersimpan karena
// logs/server.log sekarang di-append, bukan di-truncate.
process.on('uncaughtException', (err) => {
  console.error('=== UNCAUGHT_EXCEPTION', new Date().toISOString(), '===');
  console.error(err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('=== UNHANDLED_REJECTION', new Date().toISOString(), '===');
  console.error(reason);
  process.exit(1);
});

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(getOriginalsDir(), { recursive: true });
fs.mkdirSync(getTmpDir(), { recursive: true });
getDb();

// Bersihkan tmp saat boot + tiap jam (rendered files tidak boleh menumpuk)
function cleanTmp(): void {
  try {
    const now = Date.now();
    const td = getTmpDir();
    for (const f of fs.readdirSync(td)) {
      const p = `${td}/${f}`;
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs > 30 * 60 * 1000) fs.unlinkSync(p);
      } catch {
        /* abaikan */
      }
    }
  } catch {
    /* abaikan */
  }
}
cleanTmp();
setInterval(cleanTmp, 60 * 60 * 1000).unref();

// Hapus foto guest yang link-nya sudah mati (saat boot + tiap jam)
function cleanGuest(): void {
  try {
    const n = sweepGuestPhotos(getDb());
    if (n > 0) console.log(`Bersihkan ${n} foto guest kedaluwarsa`);
  } catch {
    /* abaikan */
  }
}
cleanGuest();
setInterval(cleanGuest, 60 * 60 * 1000).unref();

// Hapus sesi login kedaluwarsa
function cleanSessions(): void {
  try {
    getDb().prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(Date.now());
  } catch {
    /* abaikan */
  }
}
cleanSessions();
setInterval(cleanSessions, 60 * 60 * 1000).unref();

const app = createApp();
// Forensik: bandingkan pid/ppid saat ada insiden. Kalau node mati tapi
// ppid (Termux app) tetap sama → node crash (bug kode). Kalau ppid berubah
// di antara dua kejadian → Termux app dibunuh Android & restart (Doze/LMK).
console.log(
  `boot pid=${process.pid} ppid=${process.ppid} node=${process.version} rss=${process.memoryUsage().rss}`,
);
app.listen(config.port, '0.0.0.0', () => {
  console.log(`GlympFoto berjalan di http://0.0.0.0:${config.port}`);
  // Panaskan sharp-wasm + font watermark di background: panggilan pertama
  // per proses makan ±9 detik (cold start), jangan bebankan ke foto pertama.
  import('./lib/watermark.js')
    .then((m) => m.warmupWatermark())
    .then(() => console.log('watermark warmed up'))
    .catch(() => {});
});
