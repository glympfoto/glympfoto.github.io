import type { Request } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length > 0) return cf.trim().slice(0, 64);
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim().slice(0, 64);
  return (req.ip ?? req.socket.remoteAddress ?? 'unknown').slice(0, 64);
}

export function clientUa(req: Request): string {
  return String(req.headers['user-agent'] ?? 'unknown').slice(0, 512);
}

// Model device dari Client Hints. Chrome 100+ menyembunyikan model di UA
// ("Linux; Android 10; K") dan hanya mengirim Sec-CH-UA-Model bila server
// opt-in via header Accept-CH (lihat GET /v/:token) atau bila client
// memintanya via navigator.userAgentData. Nilai seperti '"CPH2387"'.
export function clientDevice(req: Request): string | null {
  const raw = req.headers['sec-ch-ua-model'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string' || !first) return null;
  const model = first.replace(/^"+|"+$/g, '').trim().slice(0, 64);
  if (!model || model === '?') return null;
  return model;
}

// Cache IP -> {country,city} agar tidak lookup berulang
const geoCache = new Map<string, { city: string | null; country: string | null; ts: number }>();

export function geolocateIp(req: Request): { city: string | null; country: string | null } {
  // 1. Header Cloudflare (paling akurat & gratis, jika ip_geolocation=true di tunnel)
  const cfCountry = req.headers['cf-ipcountry'];
  const cfCity = req.headers['cf-ipcity'];
  if (typeof cfCountry === 'string' && cfCountry && cfCountry !== 'XX') {
    const country = cfCountry.slice(0, 2).toUpperCase();
    const city =
      typeof cfCity === 'string' && cfCity && cfCity !== '' ? cfCity.slice(0, 64) : null;
    return { city, country };
  }
  const ip = clientIp(req);
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'unknown' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return { city: 'Local', country: 'LOCAL' };
  }
  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.ts < 60 * 60 * 1000) return { city: cached.city, country: cached.country };
  // 2. Fallback: coba DB lokal MaxMind jika ada (data/GeoLite2-City.mmdb)
  //    Jika tidak ada, kembalikan null — tetap catat IP saja.
  try {
    const require = createRequire(import.meta.url);
    const maxmind = require('maxmind');
    const dbPath = path.resolve(process.cwd(), process.env.GEOIP_DB ?? './data/GeoLite2-City.mmdb');
    if (fs.existsSync(dbPath)) {
      const lookup = (maxmind as any).openSync(dbPath);
      const data = lookup.get(ip);
      const country = data?.country?.iso_code ?? null;
      const city = data?.city?.names?.en ?? data?.city?.names?.id ?? null;
      geoCache.set(ip, { city, country, ts: Date.now() });
      return { city, country };
    }
  } catch {
    /* tanpa GeoIP DB */
  }
  return { city: null, country: null };
}

export type AuditAction =
  | 'VIEW_LOCATION'
  | 'LOGIN'
  | 'LOGOUT'
  | 'UPLOAD'
  | 'SHARE_CREATE'
  | 'SHARE_REVOKE'
  | 'SHARE_DELETE'
  | 'PHOTO_DELETE'
  | 'VIEW_PAGE'
  | 'VIEW_OPEN'
  | 'VIEW_IMAGE'
  | 'VIEW_STATUS'
  | 'VIEW_EXPIRED'
  | 'VIEW_EVENT'
  | 'INVALID_TOKEN'
  | 'DOWNLOAD_ATTEMPT'
  | 'AUDIT_CLEANUP';

export function audit(
  db: DatabaseSync,
  req: Request,
  action: AuditAction,
  status: string,
  opts: { viewId?: string | null; shareToken?: string | null; detail?: string | null } = {},
): void {
  try {
    const geo = geolocateIp(req);
    db.prepare(
      `INSERT INTO audit_logs(view_id, share_token, timestamp, ip, user_agent, action, status, detail, country, city, device)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      opts.viewId ?? null,
      opts.shareToken ?? null,
      Date.now(),
      clientIp(req),
      clientUa(req),
      action,
      status,
      opts.detail ? String(opts.detail).slice(0, 2000) : null,
      geo.country,
      geo.city,
      clientDevice(req),
    );
  } catch {
    // audit tidak boleh merusak request utama
  }
}
