/**
 * Reading a scanned code — the pure half of camera scanning.
 *
 * Every code this network prints is `sbg:<kind>:<value>` (see qr.ts `qrPayload`), but a
 * worker's camera will also meet a BARE code: a pre-printed QR sticker roll (the compendium
 * ships these to shops) often carries just the id with no scheme. Both must work, and a
 * code of the WRONG kind — a vehicle QR waved at the parcel field — must be caught and
 * rejected loudly rather than typed into the wrong box. That distinction is the whole point
 * of parsing here instead of dumping the raw string into the input.
 */

import { QR_SCHEME } from './qr';

export type ScanKind = 'parcel' | 'tote' | 'vehicle' | 'badge' | 'collect' | 'track';

const KINDS: readonly ScanKind[] = ['parcel', 'tote', 'vehicle', 'badge', 'collect', 'track'];

export interface ScanResult {
  /** The namespaced kind, or null for a bare code with no scheme. */
  kind: ScanKind | null;
  /** The id/code the field wants — never the scheme prefix. */
  value: string;
  /** Exactly what the scanner read, untouched. */
  raw: string;
}

/**
 * Parse a scanned string. `sbg:parcel:PUD-1` → {parcel, PUD-1}; a bare `PUD-1` →
 * {null, PUD-1}. The value keeps everything after the second colon, so an id containing a
 * colon survives; a `sbg:` prefix with an UNKNOWN kind is treated as bare (better to accept
 * an odd-but-real code than to reject it).
 */
export function parseScan(raw: string): ScanResult {
  const text = raw.trim();
  const parts = text.split(':');
  if (parts.length >= 3 && parts[0].toLowerCase() === QR_SCHEME) {
    const kind = parts[1].toLowerCase() as ScanKind;
    if (KINDS.includes(kind)) return { kind, value: parts.slice(2).join(':').trim(), raw };
  }
  return { kind: null, value: text, raw };
}

export interface ScanCheck {
  /** The value to fill the field with, or null when the code is the wrong kind. */
  value: string | null;
  /** True when a namespaced code of a DIFFERENT kind was scanned — a "red beep" mismatch. */
  mismatch: boolean;
  /** The kind that was actually scanned (for the mismatch message). */
  scannedKind: ScanKind | null;
}

/**
 * Check a scanned code against the kind a field expects.
 *  - the right kind, or a bare code → accept its value;
 *  - a namespaced code of another kind → mismatch (reject, do not fill).
 * A bare code is trusted because a pre-printed sticker roll cannot self-describe; the
 * endpoint is the final authority on whether the id is real.
 */
export function checkScan(raw: string, expected: ScanKind): ScanCheck {
  const { kind, value } = parseScan(raw);
  if (kind === null || kind === expected) return { value: value || null, mismatch: false, scannedKind: kind };
  return { value: null, mismatch: true, scannedKind: kind };
}

/** Plain-language name of a kind, for the mismatch message a non-reader hears. */
export function kindLabel(kind: ScanKind | null): string {
  switch (kind) {
    case 'parcel':
      return 'parcel';
    case 'tote':
      return 'bag';
    case 'vehicle':
      return 'vehicle';
    case 'badge':
      return 'driver badge';
    case 'collect':
      return 'collection';
    case 'track':
      return 'tracking';
    default:
      return 'code';
  }
}
