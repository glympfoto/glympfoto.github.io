import crypto from 'node:crypto';

export function secureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function newId(): string {
  return crypto.randomUUID();
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const SHORT_ALPH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function shortCode(len = 6): string {
  const b = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += SHORT_ALPH[b[i] % SHORT_ALPH.length];
  return s;
}
