/**
 * PWA icon generator — the SeeBuyGet app family.
 *
 * ONE identity, SEVEN distinguishable apps. Every icon is the brand tile's field — Bright Orange,
 * the same corner radius — and they differ by a glyph in the ink. A shop owner, a driver and an
 * operator can have several of these installed at once, so identical icons would be unusable; a
 * different colour each would not be a brand. The field says who we are, the glyph says which app.
 *
 * `home` is the exception and it is the rule that makes the family legible: that app IS SeeBuyGet's
 * front door, so it carries the actual tile art from brand/png, resampled here rather than redrawn.
 *
 * Written with nothing but node:zlib — no canvas, no sharp, no network, so the repo builds on a
 * clean checkout. That constraint came with the original placeholder generator and is worth keeping:
 * an asset pipeline that needs a native module is an asset pipeline that breaks on somebody's laptop.
 *
 *   node scripts/gen-icons.mjs            # all seven
 *   node scripts/gen-icons.mjs agent mdp  # a subset
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The identity's own art, three directories up from the frontend — the same masters the
 *  illustrations are synced from. Read, never written. */
const BRAND_TILE = resolve(ROOT, '../../brand/png/tile-512w.png');

// brand/README.md. The field is Bright Orange and the glyph is white — the identity's own pairing,
// and the only one with enough contrast to survive being 48 px on a launcher in daylight. Navy on
// orange is the identity's other pairing and it is deliberately NOT used here: it is beautiful at
// wordmark size and turns to mud at icon size.
const ORANGE = [0xfb, 0x62, 0x00];
const WHITE = [0xff, 0xff, 0xff];

/* ------------------------------------------------------------------ PNG ---- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {number} size @param {Uint8Array} rgb size*size*3 */
function encodePng(size, rgb) {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Decode an 8-bit RGBA, non-interlaced PNG to flat RGBA bytes.
 *
 * Deliberately narrow: it refuses anything else rather than guessing, because the only input it will
 * ever be handed is the brand tile, and a decoder that silently mis-reads a format produces a subtly
 * wrong icon instead of an error. If the brand pack ever ships a different encoding, this should stop.
 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const [depth, colour, , , interlace] = [buf[24], buf[25], buf[26], buf[27], buf[28]];
  if (depth !== 8 || colour !== 6 || interlace !== 0) {
    throw new Error(`unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace}) — expected 8-bit RGBA, non-interlaced`);
  }
  if (width !== height) throw new Error('the tile must be square');

  const idat = [];
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat));

  // Un-filter. All five PNG filter types, applied per scanline against the reconstructed line above.
  const bpp = 4;
  const stride = width * bpp;
  const out = new Uint8Array(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0; // left
      const b = y > 0 ? out[(y - 1) * stride + i] : 0; // up
      const c = y > 0 && i >= bpp ? out[(y - 1) * stride + i - bpp] : 0; // up-left
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
      out[y * stride + i] = v & 0xff;
    }
  }
  return { size: width, rgba: out };
}

/**
 * Area-average resample. Correct for DOWNscaling, which is the only direction here — the masters are
 * 512 and every target is smaller. Nearest-neighbour would alias the letterforms into gravel at 48 px,
 * which is the size that matters most and the one nobody checks.
 */
function resample(rgba, from, to) {
  const out = new Uint8Array(to * to * 4);
  const ratio = from / to;
  for (let y = 0; y < to; y++) {
    const y0 = Math.floor(y * ratio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio));
    for (let x = 0; x < to; x++) {
      const x0 = Math.floor(x * ratio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio));
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * from + sx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += rgba[i + c];
          n++;
        }
      }
      const o = (y * to + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c] / n);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- shapes ---- */
// Every glyph is a list of primitives in a normalised 0..1 box. `inside(x, y)` is
// sampled 4x4 per pixel, so edges anti-alias by coverage instead of stair-stepping.

const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Isosceles triangle, apex up. */
const triangle = (cx, apexY, baseY, halfW) => (x, y) => {
  if (y < apexY || y > baseY) return false;
  const t = (y - apexY) / (baseY - apexY);
  return Math.abs(x - cx) <= halfW * t;
};

const union =
  (...parts) =>
  (x, y) =>
    parts.some((p) => p(x, y));

/* ------------------------------------------------------------------ apps ---- */

const GLYPHS = {
  // Counter + head: someone standing behind a PUDO desk.
  agent: union(
    disc(0.5, 0.27, 0.155),
    roundRect(0.24, 0.5, 0.76, 0.62, 0.06),
    roundRect(0.12, 0.68, 0.88, 0.84, 0.08),
  ),
  // A vehicle on the road: the body over two wheels. The one app used while MOVING.
  driver: union(
    roundRect(0.1, 0.28, 0.9, 0.62, 0.09),
    disc(0.3, 0.72, 0.115),
    disc(0.7, 0.72, 0.115),
  ),
  // Arrow up: hand a parcel to the network.
  genesis: union(triangle(0.5, 0.1, 0.46, 0.34), roundRect(0.4, 0.42, 0.6, 0.9, 0.09)),
  // Three bars, longest at the bottom: the fleet at a glance.
  fleet: union(
    roundRect(0.14, 0.18, 0.6, 0.34, 0.08),
    roundRect(0.14, 0.42, 0.86, 0.58, 0.08),
    roundRect(0.14, 0.66, 0.72, 0.82, 0.08),
  ),
  // Four tiles: the hub dashboard.
  mdp: union(
    roundRect(0.14, 0.14, 0.46, 0.46, 0.08),
    roundRect(0.54, 0.14, 0.86, 0.46, 0.08),
    roundRect(0.14, 0.54, 0.46, 0.86, 0.08),
    roundRect(0.54, 0.54, 0.86, 0.86, 0.08),
  ),
  // Storefront: the awning over the shop body — the merchant console.
  vendor: union(roundRect(0.1, 0.14, 0.9, 0.34, 0.09), roundRect(0.18, 0.44, 0.82, 0.88, 0.09)),
  // A tower: the cab on its stalk, on its base. The one app nobody in the field uses.
  tower: union(
    roundRect(0.3, 0.12, 0.7, 0.3, 0.06),
    roundRect(0.43, 0.3, 0.57, 0.76, 0.05),
    roundRect(0.16, 0.76, 0.84, 0.88, 0.06),
  ),
};

/**
 * Apps that never install, and therefore need a TAB icon and nothing else.
 *
 * The operator console is a page on a desk (see AppSpec.installable in vite.config.ts): it ships no
 * manifest, so a launcher icon and an apple-touch icon would be files nothing ever references —
 * and every unreferenced file in a build output is one somebody later has to work out the fate of.
 */
const TAB_ONLY = ['tower'];

/** `home` is the network's own front door, so it wears the real mark rather than a glyph. */
const BRAND_APPS = ['home'];

/**
 * Emitted per app.
 *
 * `scale` is the fraction of the canvas the mark occupies. The maskable variants are much smaller
 * because Android may crop a maskable icon to any shape, down to a circle inscribed in the middle
 * 80% — anything outside that can be cut. The tile art needs a tighter safe zone than a glyph does,
 * because a clipped letterform reads as a mistake where a clipped bar just reads as a bar.
 */
const VARIANTS = [
  { file: 'icon-192.png', size: 192, scale: 0.6, brandScale: 1 },
  { file: 'icon-512.png', size: 512, scale: 0.6, brandScale: 1 },
  { file: 'icon-512-maskable.png', size: 512, scale: 0.44, brandScale: 0.66 },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.6, brandScale: 1 },
  // Rendered at tab size rather than left to the browser to shrink a 192 down to 16: a downscaled
  // launcher icon is the standard way a careful app ends up with a smudge in the tab strip. The glyph
  // is given more of the canvas here — at 32 px the surrounding field is just wasted pixels.
  { file: 'favicon-48.png', size: 48, scale: 0.72, brandScale: 1 },
  { file: 'favicon-32.png', size: 32, scale: 0.76, brandScale: 1 },
];

const SS = 4; // supersamples per axis

/** A glyph in white on the brand field. */
function drawGlyph(size, glyph, scale) {
  const rgb = new Uint8Array(size * size * 3);
  const off = (1 - scale) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size - off) / scale;
          const v = ((y + (sy + 0.5) / SS) / size - off) / scale;
          if (u >= 0 && u <= 1 && v >= 0 && v <= 1 && glyph(u, v)) hits++;
        }
      }
      const a = hits / (SS * SS);
      const i = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) rgb[i + c] = Math.round(ORANGE[c] + (WHITE[c] - ORANGE[c]) * a);
    }
  }
  return rgb;
}

/**
 * The real tile, composited onto the brand field.
 *
 * At `brandScale` 1 the tile fills the canvas and the field never shows — which is right for a
 * launcher icon, because the tile IS a rounded square. Below 1 it is inset and the field surrounds
 * it in the same orange, so the mark sits safely inside any mask with no visible seam.
 */
function drawBrand(size, tile, brandScale) {
  const inner = Math.max(1, Math.round(size * brandScale));
  const art = resample(tile.rgba, tile.size, inner);
  const pad = Math.round((size - inner) / 2);
  const rgb = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = ORANGE[c];
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const s = (y * inner + x) * 4;
      const a = art[s + 3] / 255; // the tile's own rounded corners are transparent — respect them
      const d = ((y + pad) * size + (x + pad)) * 3;
      for (let c = 0; c < 3; c++) rgb[d + c] = Math.round(rgb[d + c] * (1 - a) + art[s + c] * a);
    }
  }
  return rgb;
}

const all = [...Object.keys(GLYPHS), ...BRAND_APPS].sort();
const wanted = process.argv.slice(2);
const unknown = wanted.filter((w) => !all.includes(w));
if (unknown.length) {
  console.error(`unknown app(s): ${unknown.join(', ')} — have: ${all.join(', ')}`);
  process.exit(1);
}
const apps = wanted.length ? wanted : all;

const tile = decodePng(readFileSync(BRAND_TILE));

for (const app of apps) {
  const dir = resolve(ROOT, 'src/apps', app, 'public/icons');
  mkdirSync(dir, { recursive: true });
  const written = [];
  for (const v of VARIANTS) {
    if (TAB_ONLY.includes(app) && !v.file.startsWith('favicon-')) continue;
    const rgb = BRAND_APPS.includes(app) ? drawBrand(v.size, tile, v.brandScale) : drawGlyph(v.size, GLYPHS[app], v.scale);
    writeFileSync(resolve(dir, v.file), encodePng(v.size, rgb));
    written.push(v.file);
  }
  // Reports what it WROTE, not what it might have: the tab-only apps write two of the six, and a line
  // claiming otherwise is how a missing icon goes unnoticed.
  console.log(`icons: ${app} -> ${written.join(', ')}`);
}
