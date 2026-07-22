/**
 * Placeholder PWA icon generator — SeeBuyGet apps.
 *
 * Same approach as the icons already sitting in src/apps/driver/public/icons: a flat
 * brand-indigo field with a white monoline glyph, written as an 8-bit truecolour PNG
 * (colour type 2, filter 0 on every scanline) with nothing but node:zlib. No canvas,
 * no sharp, no network — the repo must build on a clean checkout.
 *
 * The driver icons are NOT regenerated here (they are committed art, byte-for-byte
 * untouched); this script only owns the four apps added alongside it.
 *
 *   node scripts/gen-icons.mjs            # all apps below
 *   node scripts/gen-icons.mjs agent mdp  # a subset
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const INDIGO = [0x4c, 0x46, 0xe0]; // --blue / theme_color
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
};

/** Emitted per app. Maskable keeps the glyph inside the central safe circle. */
const VARIANTS = [
  { file: 'icon-192.png', size: 192, scale: 0.6 },
  { file: 'icon-512.png', size: 512, scale: 0.6 },
  { file: 'icon-512-maskable.png', size: 512, scale: 0.44 },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.6 },
];

const SS = 4; // supersamples per axis

function draw(size, glyph, scale) {
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
      for (let c = 0; c < 3; c++) rgb[i + c] = Math.round(INDIGO[c] + (WHITE[c] - INDIGO[c]) * a);
    }
  }
  return rgb;
}

const wanted = process.argv.slice(2);
const apps = Object.keys(GLYPHS).filter((a) => wanted.length === 0 || wanted.includes(a));
if (wanted.length && apps.length !== wanted.length) {
  console.error(`unknown app(s): ${wanted.filter((w) => !(w in GLYPHS)).join(', ')}`);
  process.exit(1);
}

for (const app of apps) {
  const dir = resolve(ROOT, 'src/apps', app, 'public/icons');
  mkdirSync(dir, { recursive: true });
  for (const { file, size, scale } of VARIANTS) {
    writeFileSync(resolve(dir, file), encodePng(size, draw(size, GLYPHS[app], scale)));
  }
  console.log(`icons: ${app} -> ${VARIANTS.map((v) => v.file).join(', ')}`);
}
