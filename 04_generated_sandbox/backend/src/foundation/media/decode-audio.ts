// Decoding and VALIDATING an uploaded audio data URL — a voice message in a conversation (CV4).
//
// Its own file rather than a wider decode-image: every line of that one is a security check about what "an
// image" means, and teaching it that audio is also acceptable would widen what every image upload accepts.
// The same discipline, applied to a different allowlist: trust the bytes, never the label.

import { GlosError } from '../http/glos-error';

/** A data URL whose type may carry parameters — a browser recording arrives as `audio/webm;codecs=opus`. */
const AUDIO_DATA_URL_RE = /^data:(audio\/[a-z0-9.+-]+)(?:;[a-z0-9=._+-]+)*;base64,([A-Za-z0-9+/=]+)$/i;

/** What a phone's recorder actually produces: WebM/Opus (Chrome, Android), Ogg (Firefox), MP4/AAC (iOS), MP3. */
export const AUDIO_CONTENT_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'] as const;
export type AudioContentType = (typeof AUDIO_CONTENT_TYPES)[number];

/**
 * Does the leading signature match the DECLARED type? WebM 1A45DFA3 (EBML) · Ogg "OggS" · MP4 "ftyp" at 4 ·
 * MP3 "ID3" or an MPEG frame sync. The allowlist alone only stops an honest caller; this stops text, markup or
 * an image announced as audio.
 */
export function audioSignatureMatches(contentType: string, b: Buffer): boolean {
  if (b.length < 12) return false;
  if (contentType === 'audio/webm') return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  if (contentType === 'audio/ogg') return b.toString('ascii', 0, 4) === 'OggS';
  if (contentType === 'audio/mp4') return b.toString('ascii', 4, 8) === 'ftyp';
  if (contentType === 'audio/mpeg') return b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
  return false;
}

/** Decode a `data:audio/<type>[;params];base64,<…>` URL into validated bytes, or throw. `maxBytes` is the caller's. */
export function decodeAudio(dataUrl: string, maxBytes: number): { contentType: AudioContentType; bytes: Buffer } {
  const m = AUDIO_DATA_URL_RE.exec((dataUrl ?? '').trim());
  if (!m) throw new GlosError('INVALID_INPUT', 'Expected a base64 audio recording');
  const contentType = m[1].toLowerCase();
  if (!AUDIO_CONTENT_TYPES.includes(contentType as AudioContentType)) {
    throw new GlosError('UNSUPPORTED_MEDIA', `Unsupported recording type ${contentType} — use WebM, Ogg, MP4 or MP3 audio`);
  }
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length === 0) throw new GlosError('INVALID_INPUT', 'The recording is empty');
  if (bytes.length > maxBytes) throw new GlosError('MEDIA_TOO_LARGE', 'That recording is too long to send — keep a voice message short');
  if (!audioSignatureMatches(contentType, bytes)) throw new GlosError('UNSUPPORTED_MEDIA', 'That is not a real recording in that format');
  return { contentType: contentType as AudioContentType, bytes };
}
