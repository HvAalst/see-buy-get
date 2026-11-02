/**
 * 2026-11-02 — THE DATE A PHONE WROTE INTO A PHOTO (the owner: a damage photo picked from the gallery is "accepted,
 * labelled" — "from the gallery", with the date the phone recorded).
 *
 * A camera writes when it took the picture into the photo itself: EXIF DateTimeOriginal ("2026:10:30 14:22:05"), and on
 * newer phones the zone beside it (OffsetTimeOriginal, "+03:00"). The app makes every photo smaller before it is sent,
 * on a canvas, and that strips EXIF on purpose (shared/media.ts: no home coordinates leave the phone). So the date is read
 * HERE, from the file as the phone handed it over, BEFORE anything else touches it — and only the date: nothing else in
 * the EXIF is looked at or kept.
 *
 * Read from a JPEG's APP1 segment, a PNG's eXIf chunk or a WebP's EXIF chunk. A photo with no date, or a date the camera
 * left unset (0000:00:00), answers null — said to the person as "no date on it", never guessed from the file's own times.
 */

/** How much of a file is read to find its EXIF: it sits near the start, and a phone's photo can be ten megabytes. */
export const EXIF_READ_BYTES = 256 * 1024;

const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TYPE_ASCII = 2;

/** The date the phone recorded, read from a photo file — `2026-10-30T14:22:05`, with `+03:00` when it carried a zone. */
export async function readExifDate(file: Blob): Promise<string | null> {
  try {
    const head = await file.slice(0, EXIF_READ_BYTES).arrayBuffer();
    return exifDateOf(new Uint8Array(head));
  } catch {
    return null;
  }
}

/** The same, from the first bytes of a photo. Pure: no DOM, no clock. */
export function exifDateOf(bytes: Uint8Array): string | null {
  const tiff = tiffIn(bytes);
  return tiff ? dateIn(tiff) : null;
}

/** Where the EXIF's TIFF block starts in a JPEG, a PNG or a WebP — or null when the file carries none. */
function tiffIn(b: Uint8Array): Uint8Array | null {
  // JPEG: FF D8, then segments FF xx <length> until the picture data starts.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 4 <= b.length && b[at] === 0xff) {
      const marker = b[at + 1];
      if (marker === 0xda || marker === 0xd9) return null; // the picture itself, or the end: no EXIF before it
      const length = (b[at + 2] << 8) | b[at + 3];
      if (length < 2) return null;
      if (marker === 0xe1 && ascii(b, at + 4, 6) === 'Exif\0\0') return b.subarray(at + 10, Math.min(b.length, at + 2 + length));
      at += 2 + length;
    }
    return null;
  }
  // PNG: chunks of <length><type><data><crc>; EXIF is the eXIf chunk, the TIFF block itself.
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') {
    let at = 8;
    while (at + 8 <= b.length) {
      const length = readU32(b, at, false);
      const type = ascii(b, at + 4, 4);
      if (type === 'eXIf') return b.subarray(at + 8, Math.min(b.length, at + 8 + length));
      if (type === 'IDAT' || type === 'IEND') return null;
      at += 12 + length;
    }
    return null;
  }
  // WebP: RIFF <size> WEBP, then chunks; EXIF is the EXIF chunk (some writers put the JPEG "Exif\0\0" before the block).
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    let at = 12;
    while (at + 8 <= b.length) {
      const type = ascii(b, at, 4);
      const length = readU32(b, at + 4, true);
      if (type === 'EXIF') {
        const data = b.subarray(at + 8, Math.min(b.length, at + 8 + length));
        return ascii(data, 0, 6) === 'Exif\0\0' ? data.subarray(6) : data;
      }
      at += 8 + length + (length % 2);
    }
  }
  return null;
}

/** DateTimeOriginal (with OffsetTimeOriginal) from a TIFF block: IFD0 → the Exif IFD → the two tags. */
function dateIn(t: Uint8Array): string | null {
  const order = ascii(t, 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  if (readU16(t, 2, little) !== 42) return null;
  const ifd0 = readU32(t, 4, little);
  const exifIfd = valueOf(t, ifd0, TAG_EXIF_IFD, little);
  if (exifIfd === null) return null;
  const date = asciiTag(t, exifIfd, TAG_DATE_TIME_ORIGINAL, little);
  const m = date ? /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(date) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  // A camera that never had its clock set writes zeros: that is no date, not the year nought.
  if (Number(y) < 1900 || Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || Number(h) > 23 || Number(mi) > 59) return null;
  const zone = asciiTag(t, exifIfd, TAG_OFFSET_TIME_ORIGINAL, little);
  const offset = zone && /^[+-]\d{2}:\d{2}$/.test(zone.trim()) ? zone.trim() : '';
  return `${y}-${mo}-${d}T${h}:${mi}${s ? `:${s}` : ''}${offset}`;
}

/** The 4-byte value or offset an IFD entry holds for a tag, or null when the IFD has no such tag. */
function valueOf(t: Uint8Array, ifd: number, tag: number, little: boolean): number | null {
  const entry = entryOf(t, ifd, tag, little);
  return entry === null ? null : readU32(t, entry + 8, little);
}

/** An ASCII tag's text, without its closing zero. */
function asciiTag(t: Uint8Array, ifd: number, tag: number, little: boolean): string | null {
  const entry = entryOf(t, ifd, tag, little);
  if (entry === null || readU16(t, entry + 2, little) !== TYPE_ASCII) return null;
  const count = readU32(t, entry + 4, little);
  // Four bytes or fewer sit in the entry itself; more, at the offset it names.
  const at = count <= 4 ? entry + 8 : readU32(t, entry + 8, little);
  if (at + count > t.length) return null;
  return ascii(t, at, count).replace(/\0+$/, '');
}

function entryOf(t: Uint8Array, ifd: number, tag: number, little: boolean): number | null {
  if (ifd + 2 > t.length) return null;
  const n = readU16(t, ifd, little);
  for (let i = 0; i < n; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > t.length) return null;
    if (readU16(t, entry, little) === tag) return entry;
  }
  return null;
}

function readU16(b: Uint8Array, at: number, little: boolean): number {
  return little ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1];
}

function readU32(b: Uint8Array, at: number, little: boolean): number {
  const v = little ? b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24) : (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
  return v >>> 0;
}

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = '';
  for (let i = at; i < at + n && i < b.length; i += 1) s += String.fromCharCode(b[i]);
  return s;
}
