import { chooseVersion, qrMatrix, qrSvgGroup, type EccLevel } from './qr';

/**
 * The same independent-decoder round trip the frontend copy has: it reads a matrix back
 * out (unmask → zig-zag → de-interleave → parse) and asserts the payload survived. That
 * is what keeps the two copies of this encoder honest — a typo in either one's block
 * tables fails here rather than on a printed label nobody can scan.
 */

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

function decode(m: boolean[][]): string {
  const size = m.length;
  const version = (size - 17) / 4;
  let fbits = 0;
  for (let i = 0; i <= 5; i++) fbits |= (m[8][i] ? 1 : 0) << i;
  fbits |= (m[8][7] ? 1 : 0) << 6;
  fbits |= (m[8][8] ? 1 : 0) << 7;
  fbits |= (m[7][8] ? 1 : 0) << 8;
  for (let i = 9; i < 15; i++) fbits |= (m[14 - i][8] ? 1 : 0) << i;
  const raw = (fbits ^ 0x5412) >>> 10;
  const ecc = ECC_FROM_BITS[(raw >> 3) & 0b11];
  const maskFn = MASKS[raw & 0b111];
  const fn = functionMap(version, size);

  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    const col = right === 6 ? right - 1 : right;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (fn[row][c]) continue;
        const bit = m[row][c] ? 1 : 0;
        bits.push(maskFn(row, c) ? bit ^ 1 : bit);
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

  const [, ...groups] = BLOCKS[ecc][version];
  const lengths: number[] = [];
  for (const [count, len] of groups) for (let i = 0; i < count; i++) lengths.push(len);
  const blocks: number[][] = lengths.map(() => []);
  let idx = 0;
  for (let i = 0; i < Math.max(...lengths); i++) {
    for (let b = 0; b < blocks.length; b++) if (i < lengths[b]) blocks[b].push(stream[idx++]);
  }

  const dataBits: number[] = [];
  for (const byte of blocks.flat()) for (let j = 7; j >= 0; j--) dataBits.push((byte >> j) & 1);
  const take = (n: number) => dataBits.splice(0, n).reduce((acc, b) => (acc << 1) | b, 0);
  expect(take(4)).toBe(0b0100);
  const length = take(version <= 9 ? 8 : 16);
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) out[i] = take(8);
  return out.toString('utf8');
}

describe('label QR encoder', () => {
  it('round-trips every payload the network prints, at every level', () => {
    const payloads = ['sbg:parcel:PUD-049410ED6B', 'sbg:tote:tote_9f3a', 'sbg:vehicle:VEH-0A5104D1', 'sbg:collect:COL-BA9103CC'];
    for (const ecc of ['L', 'M', 'Q', 'H'] as EccLevel[]) {
      for (const text of payloads) expect(decode(qrMatrix(text, ecc))).toBe(text);
    }
  });

  it('agrees with the spec on structure', () => {
    const m = qrMatrix('sbg:parcel:PUD-1', 'Q');
    expect((m.length - 17) % 4).toBe(0);
    expect(m[0][0]).toBe(true);
    expect(m[1][1]).toBe(false);
    expect(m[m.length - 8][8]).toBe(true); // the always-dark module
  });

  it('emits an SVG group with a white quiet zone and one path', () => {
    const svg = qrSvgGroup('sbg:parcel:PUD-1', 12, 12, 96);
    expect(svg).toContain('<g transform="translate(12 12)');
    expect(svg).toContain('fill="#fff"');
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
  });

  it('refuses a payload it cannot encode rather than truncating it', () => {
    expect(chooseVersion(5000, 'Q')).toBeNull();
    expect(() => qrMatrix('A'.repeat(5000), 'Q')).toThrow(/too long/);
  });
});
