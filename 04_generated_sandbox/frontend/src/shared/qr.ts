/**
 * QR encoder — byte mode, versions 1–10, all four error-correction levels.
 *
 * WHY THIS EXISTS AT ALL: SeeBuyGet is a phygital network. The vehicle's dashboard sticker,
 * the laminated tote bag, the driver's badge, the parcel label and the buyer's collection
 * code are all meant to be SCANNED — the compendium's agent app is three screens of "scan
 * this". Until now the product had no QR anywhere: the label's "QR" was a black square with
 * the letters QR drawn in it. This module makes the codes real.
 *
 * No dependency, by the same rule as the PNG icon generator: a clean checkout must build.
 * ~300 lines of well-specified arithmetic is a better trade than a runtime dependency in
 * the one code path that has to work on a $40 Android in a dusty shop.
 *
 * Scope is deliberate: versions 1–10 cover ~270 bytes at level M, and every payload this
 * product prints (a parcel id, a bag code, a badge, a collection code, a tracking URL) is
 * far under that. Byte mode only — no numeric/alphanumeric compaction, no kanji: the gain
 * would be a smaller symbol for ids that are already tiny, at the cost of three more
 * encoders to get wrong.
 */

export type EccLevel = 'L' | 'M' | 'Q' | 'H';

/* ------------------------------------------------------------ GF(256) ----- */

/** log/antilog tables for the field the QR spec uses: x^8 + x^4 + x^3 + x^2 + 1 (0x11d). */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const gfMul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let d = 0; d < degree; d++) {
    const next = new Uint8Array(poly.length + 1);
    for (let i = 0; i < poly.length; i++) {
      next[i] ^= poly[i];
      next[i + 1] ^= gfMul(poly[i], EXP[d]);
    }
    poly = next;
  }
  return poly;
}

/** Reed–Solomon remainder — the block's error-correction codewords. */
function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenerator(ecLen);
  const rem = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

/* -------------------------------------------------------------- tables ---- */

/**
 * Block structure per version and level: [ecCodewordsPerBlock, ...[blockCount, dataCodewords]].
 * Straight from ISO/IEC 18004 table 9; the round-trip test is what proves it was typed right.
 */
type BlockSpec = [number, ...Array<[number, number]>];
const BLOCKS: Record<EccLevel, BlockSpec[]> = {
  L: [
    [0], [7, [1, 19]], [10, [1, 34]], [15, [1, 55]], [20, [1, 80]], [26, [1, 108]],
    [18, [2, 68]], [20, [2, 78]], [24, [2, 97]], [30, [2, 116]], [18, [2, 68], [2, 69]],
  ],
  M: [
    [0], [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
    [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]],
  ],
  Q: [
    [0], [13, [1, 13]], [22, [1, 22]], [18, [2, 17]], [26, [2, 24]], [18, [2, 15], [2, 16]],
    [24, [4, 19]], [18, [2, 14], [4, 15]], [22, [4, 18], [2, 19]], [20, [4, 16], [4, 17]], [24, [6, 19], [2, 20]],
  ],
  H: [
    [0], [17, [1, 9]], [28, [1, 16]], [22, [2, 13]], [16, [4, 9]], [22, [2, 11], [2, 12]],
    [28, [4, 15]], [26, [4, 13], [1, 14]], [26, [4, 14], [2, 15]], [24, [4, 12], [4, 13]], [28, [6, 15], [2, 16]],
  ],
};

/** Alignment-pattern centre coordinates per version. */
const ALIGN: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const ECC_BITS: Record<EccLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/** Data codewords available at this version and level (the EC codewords sit on top). */
const dataCapacity = (version: number, ecc: EccLevel): number => {
  const [, ...groups] = BLOCKS[ecc][version];
  return groups.reduce((n, [count, len]) => n + count * len, 0);
};

/* ---------------------------------------------------------------- bits ---- */

class BitBuffer {
  readonly bits: number[] = [];
  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

/** UTF-8, so a payload may carry any text (place words, a URL, an id). */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/* -------------------------------------------------------------- encode ---- */

function encodeData(bytes: Uint8Array, version: number, ecc: EccLevel): Uint8Array {
  const capacity = dataCapacity(version, ecc);
  const buf = new BitBuffer();
  buf.put(0b0100, 4); // byte mode
  buf.put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) buf.put(b, 8);

  // Terminator (up to four zeros), then pad to a byte boundary.
  const capacityBits = capacity * 8;
  for (let i = 0; i < 4 && buf.bits.length < capacityBits; i++) buf.bits.push(0);
  while (buf.bits.length % 8 !== 0) buf.bits.push(0);

  const words = new Uint8Array(capacity);
  for (let i = 0; i < buf.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (buf.bits[i + j] ?? 0);
    words[i / 8] = byte;
  }
  // Alternating pad codewords fill the rest, per the spec.
  for (let i = Math.ceil(buf.bits.length / 8); i < capacity; i++) words[i] = i % 2 === 0 ? 0x11 : 0xec;
  return words;
}

/** Split into blocks, add EC per block, then interleave both — the spec's final sequence. */
function interleave(data: Uint8Array, version: number, ecc: EccLevel): Uint8Array {
  const [ecLen, ...groups] = BLOCKS[ecc][version];
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];

  let offset = 0;
  for (const [count, len] of groups) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(offset, offset + len);
      offset += len;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, ecLen));
    }
  }

  const out: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) out.push(b[i]);
  return new Uint8Array(out);
}

/* -------------------------------------------------------------- matrix ---- */

type Grid = Int8Array[]; // -1 = free, 0/1 = module; function modules are written first

function blankGrid(size: number): Grid {
  return Array.from({ length: size }, () => new Int8Array(size).fill(-1));
}

function placeFinder(g: Grid, row: number, col: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= g.length || cc >= g.length) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      g[rr][cc] = inRing || inCore ? 1 : 0;
    }
  }
}

function placeFunctionPatterns(g: Grid, version: number): void {
  const size = g.length;
  placeFinder(g, 0, 0);
  placeFinder(g, 0, size - 7);
  placeFinder(g, size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    g[6][i] = i % 2 === 0 ? 1 : 0;
    g[i][6] = i % 2 === 0 ? 1 : 0;
  }

  // Alignment patterns — skipped where they would collide with a finder.
  const centres = ALIGN[version];
  for (const r of centres) {
    for (const c of centres) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          g[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0;
        }
      }
    }
  }

  // The always-dark module, and the format-info areas reserved as 0 for now.
  g[size - 8][8] = 1;
  for (let i = 0; i < 9; i++) {
    if (g[8][i] === -1) g[8][i] = 0;
    if (g[i][8] === -1) g[i][8] = 0;
  }
  for (let i = 0; i < 8; i++) {
    if (g[8][size - 1 - i] === -1) g[8][size - 1 - i] = 0;
    if (g[size - 1 - i][8] === -1) g[size - 1 - i][8] = 0;
  }

  // Version information (7 and up), BCH(18,6).
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = ((version << 12) | rem) >>> 0;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) as 0 | 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      g[b][a] = bit;
      g[a][b] = bit;
    }
  }
}

/** Zig-zag placement of the final codeword stream, skipping the vertical timing column. */
function placeData(g: Grid, words: Uint8Array): void {
  const size = g.length;
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    const col = right === 6 ? right - 1 : right; // column 6 is timing — step over it
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (g[row][c] !== -1) continue;
        const byte = words[bitIndex >>> 3];
        const bit = byte === undefined ? 0 : (byte >>> (7 - (bitIndex & 7))) & 1;
        g[row][c] = bit as 0 | 1;
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Which modules may be masked: everything the function patterns did not claim. */
function dataMask(version: number, size: number): boolean[][] {
  const probe = blankGrid(size);
  placeFunctionPatterns(probe, version);
  return probe.map((row) => Array.from(row, (v) => v === -1));
}

function applyMask(g: Grid, free: boolean[][], mask: number): void {
  const fn = MASKS[mask];
  for (let r = 0; r < g.length; r++) {
    for (let c = 0; c < g.length; c++) {
      if (free[r][c] && fn(r, c)) g[r][c] = (g[r][c] ^ 1) as 0 | 1;
    }
  }
}

/** Format info: 5 data bits → BCH(15,5), XOR 0x5412, written twice. */
function placeFormat(g: Grid, ecc: EccLevel, mask: number): void {
  const size = g.length;
  const data = (ECC_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = (((data << 10) | rem) ^ 0x5412) >>> 0;

  for (let i = 0; i <= 5; i++) g[8][i] = ((bits >>> i) & 1) as 0 | 1;
  g[8][7] = ((bits >>> 6) & 1) as 0 | 1;
  g[8][8] = ((bits >>> 7) & 1) as 0 | 1;
  g[7][8] = ((bits >>> 8) & 1) as 0 | 1;
  for (let i = 9; i < 15; i++) g[14 - i][8] = ((bits >>> i) & 1) as 0 | 1;

  for (let i = 0; i < 8; i++) g[size - 1 - i][8] = ((bits >>> i) & 1) as 0 | 1;
  for (let i = 8; i < 15; i++) g[8][size - 15 + i] = ((bits >>> i) & 1) as 0 | 1;
  g[size - 8][8] = 1; // the dark module survives format placement
}

/* ------------------------------------------------------------- penalty ---- */

function penalty(g: Grid): number {
  const size = g.length;
  let score = 0;

  // Rule 1 — runs of five or more same-coloured modules in a line.
  for (const transposed of [false, true]) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const prev = transposed ? g[b - 1][a] : g[a][b - 1];
        const cur = transposed ? g[b][a] : g[a][b];
        if (cur === prev) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  // Rule 2 — 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = g[r][c];
      if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) score += 3;
    }
  }

  // Rule 3 — the finder-like 1:1:3:1:1 pattern with four light modules beside it.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (const transposed of [false, true]) {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b + 11 <= size; b++) {
        const line = Array.from({ length: 11 }, (_, k) => (transposed ? g[b + k][a] : g[a][b + k]));
        if (A.every((v, k) => v === line[k]) || B.every((v, k) => v === line[k])) score += 40;
      }
    }
  }

  // Rule 4 — deviation from a 50/50 dark ratio.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (g[r][c] === 1) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/* ---------------------------------------------------------------- API ----- */

export interface QrOptions {
  /** Default 'M' (~15% recovery). Physical, laminated things use 'Q' — see qrForPrint. */
  ecc?: EccLevel;
}

/** The smallest version that fits, or null when the payload is beyond version 10. */
export function chooseVersion(byteLength: number, ecc: EccLevel): number | null {
  for (let v = 1; v <= 10; v++) {
    const header = 4 + (v <= 9 ? 8 : 16);
    if (dataCapacity(v, ecc) * 8 >= header + byteLength * 8) return v;
  }
  return null;
}

/**
 * Encode `text` into a square matrix of booleans (true = dark).
 *
 * Throws only when the payload cannot fit version 10 — a programming error at these sizes,
 * not a runtime condition, so it is loud rather than silently truncating a scannable code
 * into an unscannable one.
 */
export function qrMatrix(text: string, opts: QrOptions = {}): boolean[][] {
  const ecc = opts.ecc ?? 'M';
  const bytes = utf8(text);
  const version = chooseVersion(bytes.length, ecc);
  if (version === null) throw new Error(`QR payload too long for version 10 at level ${ecc}: ${bytes.length} bytes`);

  const words = interleave(encodeData(bytes, version, ecc), version, ecc);
  const size = 17 + version * 4;
  const free = dataMask(version, size);

  let best: Grid | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    const g = blankGrid(size);
    placeFunctionPatterns(g, version);
    placeData(g, words);
    applyMask(g, free, mask);
    placeFormat(g, ecc, mask);
    const score = penalty(g);
    if (score < bestScore) {
      bestScore = score;
      best = g;
    }
  }

  return best!.map((row) => Array.from(row, (v) => v === 1));
}

/**
 * One SVG path covering every dark module — one node instead of hundreds of rects, which
 * matters when a hub screen lists a dozen bag codes at once.
 */
export function qrPath(matrix: boolean[][]): string {
  const parts: string[] = [];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix.length; c++) {
      if (matrix[r][c]) parts.push(`M${c} ${r}h1v1h-1z`);
    }
  }
  return parts.join('');
}

/** The payload scheme for everything this network prints — one place, so scanners agree. */
export const QR_SCHEME = 'sbg';

export function qrPayload(kind: 'parcel' | 'tote' | 'vehicle' | 'badge' | 'collect' | 'track', value: string): string {
  return `${QR_SCHEME}:${kind}:${value}`;
}
