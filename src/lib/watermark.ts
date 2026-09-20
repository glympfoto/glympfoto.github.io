import * as PImage from 'pureimage';
import sharp from 'sharp';

// Sisi terpanjang output (px) & kualitas JPEG. 1280 dipilih dari benchmark:
// 1600/q82 = 3.4 dtk + 117KB vs 1280/q80 = 1.4 dtk + 86KB untuk foto 12MP
// (sharp-wasm lambat; tiap piksel dihitung). Di layar HP tetap tajam.
const MAX_SIDE = 1280;
const JPEG_Q = 80;

// Teks watermark dirender via pureimage (pure JS + fontkit) ke layer PNG
// transparan, lalu di-composite sekali oleh sharp.
// Alasan: build sharp wasm32 memakai resvg TANPA fontconfig — setiap <text>
// SVG diam-diam di-skip (fontdb kosong), jadi watermark teks tidak pernah
// tercetak. Font TTF dimuat manual dari kandidat path di sistem.
let fontPromise: Promise<void> | null = null;
const FONT_CANDIDATES = [
  '/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/system/fonts/Roboto-Regular.ttf',
];

function ensureFont(): Promise<void> {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    const fs = await import('node:fs');
    for (const p of FONT_CANDIDATES) {
      try {
        if (!fs.existsSync(p)) continue;
        const f = PImage.registerFont(p, 'wmfont');
        await f.load();
        if (f.loaded) return;
      } catch {
        /* cek kandidat berikutnya */
      }
    }
  })();
  return fontPromise;
}

async function encodePng(img: PImage.Bitmap): Promise<Buffer> {
  const { Writable } = await import('node:stream');
  const chunks: Buffer[] = [];
  const ws = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  await PImage.encodePNGToStream(img, ws);
  return Buffer.concat(chunks);
}

/**
 * Pemanasan saat boot: sharp-wasm + fontkit lambat (±9 detik) pada panggilan
 * pertama per proses. Dipanggil fire-and-forget dari index.ts agar foto
 * pertama tidak kena cold start. Tidak boleh melempar error.
 */
export async function warmupWatermark(): Promise<void> {
  try {
    await ensureFont();
    await renderTextLayer(320, 240, { tag: 'warmup', tokenTag: 'warmup' });
    await sharp({ create: { background: '#888', channels: 3, height: 64, width: 64 } })
      .jpeg({ quality: JPEG_Q })
      .toBuffer();
  } catch {
    /* abaikan — request pertama hanya lebih lambat */
  }
}

/**
 * Render layer watermark: tiled diagonal + strip tengah + jejak jaringan.
 * Background transparan (clearRect) supaya foto di bawahnya tidak tertutup.
 */
async function renderTextLayer(
  W: number,
  H: number,
  t: { tag: string; tokenTag: string; extraTag?: string },
): Promise<Buffer> {
  await ensureFont();
  const img = PImage.make(W, H);
  const ctx = img.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // HANYA fillText — TANPA strokeText. strokeText pureimage menggambar
  // garis liar melintasi foto saat teks dirotasi (warning "can't project
  // the same paths"). Keterbacaan di foto terang/gelap didapat dari
  // teknik bayangan: fill gelap offset +1px lalu fill terang di atasnya.
  const soft = (txt: string, x: number, y: number, size: number, alpha: number) => {
    ctx.font = `${size}px wmfont`;
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillText(txt, x + 1, y + 1);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillText(txt, x, y);
  };

  // Tiled diagonal — jarang & kecil supaya tidak mengganggu foto,
  // tapi tetap susah dicrop tanpa merusak gambar
  const rows = Math.max(2, Math.floor(H / 600));
  const cols = Math.max(1, Math.floor(W / 750));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.round(((c + 0.5) / cols) * W);
      const y = Math.round(((r + 0.5) / rows) * H);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((-24 * Math.PI) / 180);
      soft(t.tag, 0, 0, 17, 0.28);
      soft(t.tokenTag, 0, 22, 11, 0.2);
      ctx.restore();
    }
  }

  // Teks tengah kecil — penanda sesi, tanpa menutupi foto.
  const cx = Math.round(W / 2);
  const cy = Math.round(H / 2);
  soft(t.tag, cx, cy, 15, 0.55);
  if (t.extraTag) {
    soft(t.extraTag, cx, cy + 22, 11, 0.45);
  }
  return encodePng(img);
}

/**
 * Generate rendered copy untuk recipient:
 * - resize max MAX_SIDE px (hemat bandwidth, cegah original-res leak)
 * - overlay tiled forensic watermark: View ID + timestamp + hash jaringan
 * - TIDAK PERNAH menulis ke original; return buffer in-memory
 */
export async function watermarkedBuffer(
  originalPath: string,
  opts: { viewId: string; shareToken: string; enabled: boolean; extraTag?: string },
): Promise<{ buffer: Buffer; width: number; height: number }> {
  if (!opts.enabled) {
    const out = await sharp(originalPath, { failOnError: false })
      .rotate()
      .resize({ fit: 'inside', height: MAX_SIDE, width: MAX_SIDE, withoutEnlargement: false })
      .jpeg({ quality: JPEG_Q })
      .toBuffer({ resolveWithObject: true });
    return { buffer: out.data, width: out.info.width, height: out.info.height };
  }

  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const tag = `${opts.viewId.slice(0, 8)} · ${stamp}`;
  const tokenTag = `share:${opts.shareToken.slice(0, 6)}`;
  const text = { extraTag: opts.extraTag, tag, tokenTag };

  // Dimensi target dihitung dari metadata (baca header saja, cepat) agar
  // resize + composite bisa jalan dalam SATU pipeline sharp. sharp di sini
  // (wasm) lambat — tiap pass decode+encode JPEG makan detik, jadi dua
  // pass seperti sebelumnya bikin "menyiapkan foto" belasan detik.
  // resize(W,H,fill) dipakai agar output PASTI W×H (pas dengan layer).
  try {
    const meta = await sharp(originalPath, { failOnError: false }).metadata();
    let w = meta.width ?? 0;
    let h = meta.height ?? 0;
    const ori = meta.orientation ?? 1;
    if (ori >= 5 && ori <= 8) [w, h] = [h, w]; // rotate() menukar dimensi
    if (w > 0 && h > 0) {
      const s = Math.min(MAX_SIDE / w, MAX_SIDE / h);
      const W = Math.max(1, Math.round(w * s));
      const H = Math.max(1, Math.round(h * s));
      const layer = await renderTextLayer(W, H, text);
      const out = await sharp(originalPath, { failOnError: false })
        .rotate()
        .resize(W, H, { fit: 'fill' })
        .composite([{ input: layer, left: 0, top: 0 }])
        .jpeg({ quality: JPEG_Q })
        .toBuffer();
      return { buffer: out, width: W, height: H };
    }
  } catch {
    /* jatuh ke fallback dua-pass di bawah */
  }

  // Fallback bila metadata gagal dibaca: cara lama dua pass.
  const plain = await sharp(originalPath, { failOnError: false })
    .rotate()
    .resize({ fit: 'inside', height: MAX_SIDE, width: MAX_SIDE, withoutEnlargement: false })
    .jpeg({ quality: JPEG_Q })
    .toBuffer({ resolveWithObject: true });
  const W = plain.info.width;
  const H = plain.info.height;
  const layer = await renderTextLayer(W, H, text);
  const out = await sharp(plain.data)
    .composite([{ input: layer, left: 0, top: 0 }])
    .jpeg({ quality: JPEG_Q })
    .toBuffer();
  return { buffer: out, width: W, height: H };
}

export async function thumbBuffer(originalPath: string, width = 480): Promise<Buffer> {
  return sharp(originalPath, { failOnError: false })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
}
