import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']);
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

export function sanitizeFilename(original: string): string {
  const base = path.basename(original).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return base.length > 0 ? base : 'photo';
}

export function extOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function isAllowedExtMime(ext: string, mime: string): boolean {
  return ALLOWED_EXT.has(ext) && ALLOWED_MIME.has(mime);
}

/** Cegah path traversal: pastikan resolved path tetap di dalam baseDir */
export function safeJoin(baseDir: string, name: string): string | null {
  const base = path.basename(name);
  if (base !== name || name.includes('..') || path.isAbsolute(name)) return null;
  const resolved = path.resolve(baseDir, base);
  if (!resolved.startsWith(path.resolve(baseDir) + path.sep)) return null;
  return resolved;
}

/**
 * Salin arsip foto ke SHARED_DIR (memori bersama, terlihat di galeri).
 * Best-effort: tidak pernah melempar — gagal salin (mis. /sdcard tidak
 * termount) hanya return null. Nama pakai nama asli; tabrakan diberi
 * suffix -1, -2, ...
 */
export function mirrorToShared(absSrcPath: string, originalFilename: string): string | null {
  try {
    const dir = config.sharedDir;
    if (!dir) return null;
    fs.mkdirSync(dir, { recursive: true });
    const safe = sanitizeFilename(originalFilename);
    const ext = path.extname(safe);
    const stem = path.basename(safe, ext) || 'photo';
    let dest: string | null = null;
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? `${stem}${ext}` : `${stem}-${i}${ext}`;
      const resolved = safeJoin(dir, candidate);
      if (!resolved) return null;
      if (!fs.existsSync(resolved)) {
        dest = resolved;
        break;
      }
    }
    if (!dest) return null;
    fs.copyFileSync(absSrcPath, dest);
    return dest;
  } catch {
    return null;
  }
}
