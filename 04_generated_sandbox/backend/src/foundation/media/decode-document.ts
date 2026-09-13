// Decoding and VALIDATING an uploaded company document (CA4) — a registration certificate, a licence, a policy.
//
// Its own file, for the same reason decode-audio is: every line is a security check about what "a document" means,
// and widening the image or audio allowlists to accept PDFs would widen what every other upload accepts.
// Trust the bytes, never the label.

import { GlosError } from '../http/glos-error';

const DOCUMENT_DATA_URL_RE = /^data:(application\/pdf|image\/png|image\/jpeg)(?:;[a-z0-9=._+-]+)*;base64,([A-Za-z0-9+/=]+)$/i;

/** What a registry, a regulator or an insurer actually issues, and what a phone photographs one as. */
export const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

/** Does the leading signature match the DECLARED type? PDF "%PDF-" · PNG 89 50 4E 47 0D 0A 1A 0A · JPEG FF D8 FF. */
export function documentSignatureMatches(contentType: string, b: Buffer): boolean {
  if (b.length < 8) return false;
  if (contentType === 'application/pdf') return b.toString('ascii', 0, 5) === '%PDF-';
  if (contentType === 'image/png') return b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
  if (contentType === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return false;
}

/** Decode a `data:<type>;base64,<…>` URL into validated bytes, or throw. `maxBytes` is the caller's. */
export function decodeDocument(dataUrl: string, maxBytes: number): { contentType: DocumentContentType; bytes: Buffer } {
  const m = DOCUMENT_DATA_URL_RE.exec((dataUrl ?? '').trim());
  if (!m) throw new GlosError('UNSUPPORTED_MEDIA', 'Upload a PDF, PNG or JPEG document');
  const contentType = m[1].toLowerCase() as DocumentContentType;
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length === 0) throw new GlosError('INVALID_INPUT', 'The document is empty');
  if (bytes.length > maxBytes) throw new GlosError('MEDIA_TOO_LARGE', `That document is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
  if (!documentSignatureMatches(contentType, bytes)) throw new GlosError('UNSUPPORTED_MEDIA', 'That file is not really a document of that type');
  return { contentType, bytes };
}
