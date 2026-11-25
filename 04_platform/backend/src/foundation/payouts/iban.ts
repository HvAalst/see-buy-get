/**
 * 2026-11-25 (route plan part 4) — A BANK ACCOUNT NUMBER (IBAN) A PARTNER PAYS A HAND TO, checked before it is kept: a country of
 * the SEPA area, that country's length, and its two check digits (ISO 13616, modulo 97). A typing slip is caught on the screen,
 * not by a bank a day later. Many hands in Bulgaria bank with a bank of another EU country (a Lithuanian IBAN at an app bank),
 * so every SEPA country is taken, not only the hand's own.
 */

/** The SEPA countries and their IBAN lengths (the IBAN registry, SWIFT). */
export const SEPA_IBAN_LENGTH: Readonly<Record<string, number>> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23,
  GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28,
  PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
};

/** As the bank writes it: capitals, no spaces or dashes. */
export function normaliseIban(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[\s-]/g, '');
}

/** Why an IBAN is not one we pay to — or undefined for one that is. */
export function ibanProblem(raw: string): 'not_iban' | 'not_sepa' | 'length' | 'check' | undefined {
  const iban = normaliseIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return 'not_iban';
  const length = SEPA_IBAN_LENGTH[iban.slice(0, 2)];
  if (!length) return 'not_sepa';
  if (iban.length !== length) return 'length';
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1 ? undefined : 'check';
}

/** Shown in place of it: the country, then only the last four characters. */
export function maskIban(raw: string): string {
  const iban = normaliseIban(raw);
  return `${iban.slice(0, 2)}•• •••• ${iban.slice(-4)}`;
}

/** Letters as two digits (A = 10 … Z = 35), the remainder by 97 taken a few digits at a time so no number grows past safe. */
function mod97(rearranged: string): number {
  let rest = 0;
  for (const ch of rearranged) {
    const digits = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest;
}

/** A BIC: four letters of the bank, two of its country, two of its place, and three of a branch where given. */
export function isBic(raw: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test((raw ?? '').toUpperCase().replace(/\s/g, ''));
}
