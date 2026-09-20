import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

const root = process.cwd();

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  get adminToken(): string {
    return env('ADMIN_TOKEN', 'dev-admin-token-change-me');
  },
  // Password admin = ADMIN_PASSWORD, fallback ke ADMIN_TOKEN lama agar
  // setup yang sudah jalan tidak rusak.
  get adminPassword(): string {
    const p = env('ADMIN_PASSWORD', '');
    if (p) return p;
    return env('ADMIN_TOKEN', 'dev-admin-token-change-me');
  },
  get auditRetentionDays(): number {
    return Number(env('AUDIT_RETENTION_DAYS', '90'));
  },
  get dataDir(): string {
    return path.resolve(root, env('DATA_DIR', './data'));
  },
  get dbPath(): string {
    return path.resolve(root, env('DB_PATH', './data/glympfoto.db'));
  },
  get maxUploadBytes(): number {
    return Number(env('MAX_UPLOAD_MB', '15')) * 1024 * 1024;
  },
  get port(): number {
    return Number(env('PORT', '3000'));
  },
  get storageDir(): string {
    return path.resolve(root, env('STORAGE_DIR', './storage'));
  },
  get guestUpload(): boolean {
    return env('GUEST_UPLOAD', '0') === '1';
  },
  // Folder arsip di memori bersama (mis. /sdcard/GlympFoto) — setiap foto
  // yang lolos upload disalin ke sini dengan nama aslinya agar terlihat
  // di galeri/file manager. Kosong = mati. Best-effort: gagal salin tidak
  // menggagalkan upload.
  get sharedDir(): string {
    return env('SHARED_DIR', '').trim();
  },
  // Domain publik pembungkus (mis. GitHub Pages) yang boleh meng-iframe viewer.
  // Kosong = tidak ada pihak luar yang boleh embed (paling ketat).
  get publicHost(): string {
    return env('PUBLIC_HOST', '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  },
};

// Versi asset statis — naikkan setiap ada perubahan JS/CSS agar browser
// tidak memakai file lama dari cache (pernah bikin foto tidak tampil).
export const ASSET_V = '22';

export function getOriginalsDir(): string {
  return path.join(config.storageDir, 'originals');
}
export function getTmpDir(): string {
  return path.join(config.storageDir, 'tmp');
}
