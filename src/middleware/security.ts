import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { config } from '../config.js';

// Domain pembungkus (PUBLIC_HOST) boleh meng-iframe viewer; tanpa itu tetap 'none'.
// Kasusnya www vs apex — izinkan keduanya biar https://glympfoto.work.gd juga bisa
// (user di screenshot buka tanpa www). frameguard dimatikan karena CSP sudah modern.
const extraFrameHosts = (() => {
  const h = config.publicHost;
  if (!h) return [];
  if (h === 'www.glympfoto.work.gd') return ['https://glympfoto.work.gd'];
  if (h === 'glympfoto.work.gd') return ['https://www.glympfoto.work.gd'];
  return [];
})();
const frameParents = config.publicHost
  ? ["'self'", `https://${config.publicHost}`, ...extraFrameHosts]
  : ["'none'"];

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
