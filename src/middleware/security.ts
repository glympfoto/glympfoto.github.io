import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { config } from '../config.js';

// Domain pembungkus (PUBLIC_HOST) boleh meng-iframe viewer; tanpa itu tetap 'none'.
// Mendukung daftar koma: "glympfoto.work.gd,glympfoto.github.io".
// Kasusnya www vs apex — izinkan keduanya biar https://glympfoto.work.gd juga bisa.
// frameguard dimatikan karena CSP sudah modern.
const frameParents = (() => {
  const hosts = config.publicHosts;
  if (hosts.length === 0) return ["'none'"];
  const out = new Set<string>(["'self'"]);
  for (const h of hosts) {
    out.add(`https://${h}`);
    if (h === 'www.glympfoto.work.gd') out.add('https://glympfoto.work.gd');
    if (h === 'glympfoto.work.gd') out.add('https://www.glympfoto.work.gd');
  }
  return [...out];
})();

export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      baseUri: ["'none'"],
      connectSrc: ["'self'"],
      defaultSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: frameParents,
      imgSrc: ["'self'", 'blob:', 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
  frameguard: false,
  referrerPolicy: { policy: 'no-referrer' },
});

export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}
