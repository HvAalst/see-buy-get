import { describe, expect, it } from 'vitest';
import { chooseVersion, qrMatrix, qrPath, qrPayload, type EccLevel } from './qr';

/* ==========================================================================
   A DECODER, written independently of the encoder, so the round-trip test
   proves the whole pipeline — bit packing, Reed–Solomon block interleaving,
   zig-zag placement, masking and format info — rather than asserting that the
   encoder agrees with itself. Error correction is not applied: nothing here
   corrupts modules, so the data codewords must already be exact.
   ========================================================================== */

const BLOCKS: Record<EccLevel, Array<[number, ...Array<[number, number]>]>> = {
  L: [[0], [7, [1, 19]], [10, [1, 34]], [15, [1, 55]], [20, [1, 80]], [26, [1, 108]], [18, [2, 68]], [20, [2, 78]], [24, [2, 97]], [30, [2, 116]], [18, [2, 68], [2, 69]]],
  M: [[0], [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]], [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]],
  Q: [[0], [13, [1, 13]], [22, [1, 22]], [18, [2, 17]], [26, [2, 24]], [18, [2, 15], [2, 16]], [24, [4, 19]], [18, [2, 14], [4, 15]], [22, [4, 18], [2, 19]], [20, [4, 16], [4, 17]], [24, [6, 19], [2, 20]]],
  H: [[0], [17, [1, 9]], [28, [1, 16]], [22, [2, 13]], [16, [4, 9]], [22, [2, 11], [2, 12]], [28, [4, 15]], [26, [4, 13], [1, 14]], [26, [4, 14], [2, 15]], [24, [4, 12], [4, 13]], [28, [6, 15], [2, 16]]],
};
const ALIGN: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const ECC_FROM_BITS: Record<number, EccLevel> = { 0b01: 'L', 0b00: 'M', 0b11: 'Q', 0b10: 'H' };

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

/** Mark every module claimed by a function pattern — the inverse of the encoder's reserve. */
function functionMap(version: number, size: number): boolean[][] {
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const claim = (r: number, c: number) => {
    if (r >= 0 && c >= 0 && r < size && c < size) fn[r][c] = true;
  };
  for (const [row, col] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) claim(row + r, col + c);
  }
  for (let i = 0; i < size; i++) {
    claim(6, i);
    claim(i, 6);
  }
  for (const r of ALIGN[version]) {
    for (const c of ALIGN[version]) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) claim(r + dr, c + dc);
    }
  }
  for (let i = 0; i < 9; i++) {
    claim(8, i);
    claim(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    claim(8, size - 1 - i);
    claim(size - 1 - i, 8);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      claim(b, a);
      claim(a, b);
    }
  }
  return fn;
}

function readFormat(m: boolean[][]): { ecc: EccLevel; mask: number } {
  let bits = 0;
  for (let i = 0; i <= 5; i++) bits |= (m[8][i] ? 1 : 0) << i;
  bits |= (m[8][7] ? 1 : 0) << 6;
  bits |= (m[8][8] ? 1 : 0) << 7;
  bits |= (m[7][8] ? 1 : 0) << 8;
  for (let i = 9; i < 15; i++) bits |= (m[14 - i][8] ? 1 : 0) << i;
  const raw = (bits ^ 0x5412) >>> 10;
  return { ecc: ECC_FROM_BITS[(raw >> 3) & 0b11], mask: raw & 0b111 };
}

function decode(m: boolean[][]): string {
  const size = m.length;
  const version = (size - 17) / 4;
  const { ecc, mask } = readFormat(m);
  const fn = functionMap(version, size);
  const maskFn = MASKS[mask];

  // Unmask, then walk the zig-zag exactly as the encoder wrote it.
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    const col = right === 6 ? right - 1 : right;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (fn[row][c]) continue;
        const raw = m[row][c] ? 1 : 0;
        bits.push(maskFn(row, c) ? raw ^ 1 : raw);
      }
    }
    upward = !upward;
  }

  const stream: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    stream.push(byte);
  }

  // De-interleave back into data blocks (EC codewords sit after them and are ignored).
  const [, ...groups] = BLOCKS[ecc][version];
  const lengths: number[] = [];
  for (const [count, len] of groups) for (let i = 0; i < count; i++) lengths.push(len);
  const blocks: number[][] = lengths.map(() => []);
  let idx = 0;
  for (let i = 0; i < Math.max(...lengths); i++) {
    for (let b = 0; b < blocks.length; b++) if (i < lengths[b]) blocks[b].push(stream[idx++]);
  }
  const data = blocks.flat();

  // Parse mode + length + payload.
  const dataBits: number[] = [];
  for (const byte of data) for (let j = 7; j >= 0; j--) dataBits.push((byte >> j) & 1);
  const take = (n: number) => dataBits.splice(0, n).reduce((acc, b) => (acc << 1) | b, 0);
  const mode = take(4);
  expect(mode).toBe(0b0100);
  const length = take(version <= 9 ? 8 : 16);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = take(8);
  return new TextDecoder().decode(out);
}

/* ------------------------------------------------------------------ tests -- */

describe('qr structure', () => {
  it('sizes follow 17 + 4v and carry the three finder patterns', () => {
    const m = qrMatrix('sbg:tote:BAG-004');
    const size = m.length;
    expect((size - 17) % 4).toBe(0);
    for (const [r0, c0] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ]) {
      // The 1:1:3:1:1 eye: dark ring, light gap, dark 3x3 core.
      expect(m[r0][c0]).toBe(true);
      expect(m[r0 + 1][c0 + 1]).toBe(false);
      expect(m[r0 + 3][c0 + 3]).toBe(true);
      expect(m[r0 + 6][c0 + 6]).toBe(true);
    }
  });

  it('timing patterns alternate and the dark module is set', () => {
    const m = qrMatrix('sbg:vehicle:VEH-0A5104D1');
    const size = m.length;
    for (let i = 8; i < size - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
    expect(m[size - 8][8]).toBe(true);
  });

  it('format info reads back as the level and mask that were written', () => {
    for (const ecc of ['L', 'M', 'Q', 'H'] as EccLevel[]) {
      const { ecc: got, mask } = readFormat(qrMatrix('sbg:badge:DRV-7CFC59B2', { ecc }));
      expect(got).toBe(ecc);
      expect(mask).toBeGreaterThanOrEqual(0);
      expect(mask).toBeLessThan(8);
    }
  });
});

describe('qr round-trip', () => {
  it('decodes back to the exact payload, at every level', () => {
    const payloads = [
      'sbg:parcel:DEMO-A49BV-6',
      'sbg:tote:BAG-004',
      'sbg:vehicle:VEH-0A5104D1',
      'sbg:badge:DRV-7CFC59B2',
      'sbg:collect:COL-BA9103CC',
      'sbg:track:T-D6581F1FC3',
      'https://seebuyget.example/t/T-D6581F1FC3',
    ];
    for (const ecc of ['L', 'M', 'Q', 'H'] as EccLevel[]) {
      for (const text of payloads) {
        expect(decode(qrMatrix(text, { ecc }))).toBe(text);
      }
    }
  });

  it('handles the size boundaries — one byte, and a payload that needs a bigger version', () => {
    expect(decode(qrMatrix('x'))).toBe('x');
    const long = 'sbg:track:'.concat('A'.repeat(90));
    const m = qrMatrix(long, { ecc: 'M' });
    expect(decode(m)).toBe(long);
    expect(m.length).toBeGreaterThan(25); // needed more than version 2
  });

  it('carries non-ASCII text through UTF-8', () => {
    const text = 'sbg:place:goldfox calmriver blueowl · Mamá';
    expect(decode(qrMatrix(text))).toBe(text);
  });
});

describe('capacity + helpers', () => {
  it('chooseVersion picks the smallest that fits and refuses the impossible', () => {
    expect(chooseVersion(10, 'M')).toBe(1);
    expect(chooseVersion(20, 'M')).toBe(2);
    // Level H holds far less than L at the same version.
    expect(chooseVersion(100, 'H')).toBeGreaterThan(chooseVersion(100, 'L')!);
    expect(chooseVersion(5000, 'M')).toBeNull();
    expect(() => qrMatrix('A'.repeat(5000))).toThrow(/too long/);
  });

  it('qrPath emits one rect per dark module', () => {
    const m = qrMatrix('sbg:tote:BAG-004');
    const dark = m.flat().filter(Boolean).length;
    expect(qrPath(m).match(/M/g)?.length).toBe(dark);
  });

  it('payloads are namespaced so a scanner knows what it read', () => {
    expect(qrPayload('tote', 'BAG-004')).toBe('sbg:tote:BAG-004');
    expect(qrPayload('collect', 'COL-1')).toBe('sbg:collect:COL-1');
  });
});
