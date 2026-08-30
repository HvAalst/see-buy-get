// Decoding and VALIDATING an uploaded image data URL.
//
// Extracted from MediaService when a second uploader appeared (the help illustrations an SBG admin curates).
// It lives here rather than being copied because every line of it is a security check, and two copies of an
// allowlist are two things that drift: the day one of them learns about a new format, the other becomes the
// way in. There is exactly one place that decides what "an image" means.

import { GlosError } from '../http/glos-error';

const DATA_URL_RE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

/** Only real raster image types — no SVG (it can carry script), no arbitrary bytes. */
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

/**
 * Does the leading signature match the DECLARED type? JPEG FFD8FF · PNG 89504E47 · WebP RIFF….WEBP.
 *
 * The allowlist alone only blocks a caller who honestly declares `image/svg+xml`. This is what stops the
 * dishonest one: SVG or script bytes announced as `image/jpeg`. Trust the bytes, never the label.
 */
export function signatureMatches(contentType: string, b: Buffer): boolean {
  if (b.length < 12) return false;
  if (contentType === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (contentType === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (contentType === 'image/webp') return b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

/**
 * Decode a `data:<type>;base64,<…>` URL into validated bytes, or throw.
 *
 * `maxBytes` is required rather than defaulted, because the two callers have genuinely different ceilings
 * (a delivery photo, a thumbnail, a help illustration) and a shared default would quietly become one of
 * them. The caller that knows the ceiling states it.
 */
export function decodeImage(dataUrl: string, maxBytes: number): { contentType: ImageContentType; bytes: Buffer } {
  const m = DATA_URL_RE.exec((dataUrl ?? '').trim());
  if (!m) throw new GlosError('INVALID_INPUT', 'Expected a base64 image data URL');
  const contentType = m[1].toLowerCase();
  if (!IMAGE_CONTENT_TYPES.includes(contentType as ImageContentType)) {
    throw new GlosError('UNSUPPORTED_MEDIA', `Unsupported image type ${contentType} — use JPEG, PNG or WebP`);
  }
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length === 0) throw new GlosError('INVALID_INPUT', 'The image is empty');
  if (bytes.length > maxBytes) {
    throw new GlosError('MEDIA_TOO_LARGE', 'The image is too large — it should be downscaled before upload');
  }
  if (!signatureMatches(contentType, bytes)) {
    throw new GlosError('UNSUPPORTED_MEDIA', 'That is not a real JPEG, PNG or WebP image');
  }
  return { contentType: contentType as ImageContentType, bytes };
}
