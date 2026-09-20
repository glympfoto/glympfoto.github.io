import path from 'node:path';

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
