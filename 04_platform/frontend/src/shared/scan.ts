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

export type ScanKind = 'parcel' | 'tote' | 'vehicle' | 'badge' | 'collect' | 'track' | 'load';

const KINDS: readonly ScanKind[] = ['parcel', 'tote', 'vehicle', 'badge', 'collect', 'track', 'load'];

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
    case 'load':
      return 'load label';
    default:
      return 'code';
  }
}

/* ------------------------------------------------- a load's codes, met in any box (round 19) -- */

/** The GS1 check digit (mod 10, weights 3 and 1 from the right) — the same rule the backend prints SSCCs with. */
function gs1CheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += (digits.charCodeAt(digits.length - 1 - i) - 48) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/**
 * A package's SSCC, as a scanner hands over the GS1-128 barcode on its label: the bare 18 digits, `00` + 18, `(00) …`,
 * with a scanner's `]C1` in front or the separator character inside — or null. The check digit must hold, so a parcel
 * sticker or any other number is never taken for one.
 */
export function ssccOfScan(raw: string | null | undefined): string | null {
  const s = String(raw ?? '')
    .replace(/^\]C1/, '')
    .replace(/[\s\u001d]/g, '')
    .replace(/^\(00\)/, '');
  const digits = /^00\d{18}$/.test(s) ? s.slice(2) : s;
  return /^\d{18}$/.test(digits) && gs1CheckDigit(digits.slice(0, 17)) === Number(digits[17]) ? digits : null;
}

/**
 * A load's own code: the QR on our label (its tracking address), a bare tracking key, or the load's code typed off the
 * label (`FRT-12`). A tracking key is shared in shape with a parcel's, so only a box that looks for LOADS reads one.
 */
export function isLoadLabel(raw: string | null | undefined): boolean {
  const text = String(raw ?? '').trim();
  const fromUrl = /[?&]track=([^&#\s]+)/i.exec(text)?.[1];
  return /^T-[0-9A-F]{6,}$/i.test(fromUrl ?? text) || /^FRT-\d+$/i.test(text);
}

/**
 * Round 32 — the SSCC a parcel's box should look its PARCEL up by first: a store parcel carries its own GS1-128 barcode,
 * so in a box that expects a parcel an SSCC may name the parcel itself rather than a load's package. Elsewhere, none.
 */
export function parcelSsccOf(raw: string, expect: ScanKind): string | null {
  return expect === 'parcel' ? ssccOfScan(raw) : null;
}

/** What a box should look a load up by: an SSCC in any box; a load's label too in a box that looks for loads. */
export function loadLookupOf(raw: string, loads: boolean): string | null {
  if (ssccOfScan(raw)) return raw.trim();
  return loads && isLoadLabel(raw) ? raw.trim() : null;
}
