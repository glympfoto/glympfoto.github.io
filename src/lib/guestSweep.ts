import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { getOriginalsDir } from '../config.js';

type GuestPhoto = { id: string; stored_name: string };
type GuestShare = {
  expires_at: number | null;
  id: string;
  max_views: number | null;
  views_count: number;
};

/**
 * Guest sekarang disimpan permanen — sweep dinonaktifkan.
 * Fungsi tetap ada agar panggilan lama tidak error, tapi selalu return 0.
 * Jika mau auto-hapus lagi, kembalikan logika lama atau set env GUEST_KEEP=0.
 */
export function sweepGuestPhotos(_db: DatabaseSync): number {
  return 0;
}

function deleteGuestPhoto(db: DatabaseSync, p: GuestPhoto): void {
  try {
    fs.unlinkSync(path.join(getOriginalsDir(), path.basename(p.stored_name)));
  } catch {
    /* file sudah hilang */
  }
  try {
    db.prepare(`DELETE FROM photos WHERE id=?`).run(p.id);
  } catch {
    /* abaikan */
  }
}
