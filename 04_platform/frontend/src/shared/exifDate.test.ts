import { describe, expect, it } from 'vitest';
import { exifDateOf, readExifDate } from './exifDate';

/*
 * 2026-11-02 — THE DATE A PHONE WROTE INTO A PHOTO, read before the photo is made smaller (which strips it). The photos
 * here are built byte by byte: the smallest file that carries an EXIF block the way a phone's camera writes one.
 */

/** A TIFF block with an Exif IFD holding DateTimeOriginal (and OffsetTimeOriginal when given), in either byte order. */
function tiff({ date, offset, little = true }: { date?: string; offset?: string; little?: boolean }): Uint8Array {
  const tags: Array<{ tag: number; text: string }> = [];
  if (date !== undefined) tags.push({ tag: 0x9003, text: `${date}\0` });
  if (offset !== undefined) tags.push({ tag: 0x9011, text: `${offset}\0` });
  const exifIfd = 8 + 2 + 12 + 4; // after IFD0's one entry and its next-IFD offset
  const dataAt = exifIfd + 2 + tags.length * 12 + 4;
  const size = dataAt + tags.reduce((n, t) => n + t.text.length, 0);
  const b = new Uint8Array(size);
  const v = new DataView(b.buffer);
  b.set(little ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  v.setUint16(2, 42, little);
  v.setUint32(4, 8, little);
  // IFD0: one entry, the pointer to the Exif IFD.
  v.setUint16(8, 1, little);
  v.setUint16(10, 0x8769, little);
  v.setUint16(12, 4, little);
  v.setUint32(14, 1, little);
  v.setUint32(18, exifIfd, little);
  v.setUint32(22, 0, little);
  // The Exif IFD.
  v.setUint16(exifIfd, tags.length, little);
  let data = dataAt;
  tags.forEach((t, i) => {
    const e = exifIfd + 2 + i * 12;
    v.setUint16(e, t.tag, little);
    v.setUint16(e + 2, 2, little); // ASCII
    v.setUint32(e + 4, t.text.length, little);
    v.setUint32(e + 8, data, little);
    for (let k = 0; k < t.text.length; k += 1) b[data + k] = t.text.charCodeAt(k);
    data += t.text.length;
  });
  return b;
}

const concat = (...parts: Array<ArrayLike<number>>) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** A JPEG: SOI, an APP0 a phone often puts first, APP1 "Exif", then the picture's start and end. */
function jpeg(block: Uint8Array | null): Uint8Array {
  const app0 = concat([0xff, 0xe0, 0x00, 0x10], text('JFIF\0'), new Uint8Array(9));
  const app1 = block ? concat([0xff, 0xe1, ((block.length + 8) >> 8) & 0xff, (block.length + 8) & 0xff], text('Exif\0\0'), block) : new Uint8Array(0);
  return concat([0xff, 0xd8], app0, app1, [0xff, 0xda, 0x00, 0x02], [0xff, 0xd9]);
}

describe('the date a phone wrote into a photo', () => {
  it('reads DateTimeOriginal from a JPEG, in either byte order, as a local time with no zone', () => {
    expect(exifDateOf(jpeg(tiff({ date: '2026:10:30 14:22:05' })))).toBe('2026-10-30T14:22:05');
    expect(exifDateOf(jpeg(tiff({ date: '2026:10:30 14:22:05', little: false })))).toBe('2026-10-30T14:22:05');
  });

  it('keeps the zone when the phone wrote one beside it', () => {
    expect(exifDateOf(jpeg(tiff({ date: '2026:10:30 14:22:05', offset: '+03:00' })))).toBe('2026-10-30T14:22:05+03:00');
  });

  it('says there is no date rather than guess: none written, a clock never set, no EXIF, not a photo', () => {
    expect(exifDateOf(jpeg(tiff({})))).toBeNull();
    expect(exifDateOf(jpeg(tiff({ date: '0000:00:00 00:00:00' })))).toBeNull();
    expect(exifDateOf(jpeg(null))).toBeNull();
    expect(exifDateOf(new Uint8Array(text('GIF89a not a photo')))).toBeNull();
    expect(exifDateOf(new Uint8Array(0))).toBeNull();
  });

  it('reads it from a PNG’s eXIf chunk and a WebP’s EXIF chunk too', () => {
    const block = tiff({ date: '2026:09:01 08:00:00' });
    const len = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    const png = concat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], len(13), text('IHDR'), new Uint8Array(13), [0, 0, 0, 0], len(block.length), text('eXIf'), block, [0, 0, 0, 0]);
    expect(exifDateOf(png)).toBe('2026-09-01T08:00:00');
    const le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
    const chunk = concat(text('EXIF'), le(block.length + 6), text('Exif\0\0'), block);
    const webp = concat(text('RIFF'), le(4 + chunk.length), text('WEBP'), chunk);
    expect(exifDateOf(webp)).toBe('2026-09-01T08:00:00');
  });

  it('reads a file the way the phone hands it over — a Blob — and answers null for one it cannot read', async () => {
    expect(await readExifDate(new Blob([jpeg(tiff({ date: '2026:10:30 14:22:05' })).slice()], { type: 'image/jpeg' }))).toBe('2026-10-30T14:22:05');
    expect(await readExifDate({ slice: () => ({ arrayBuffer: () => Promise.reject(new Error('gone')) }) } as unknown as Blob)).toBeNull();
  });
});
