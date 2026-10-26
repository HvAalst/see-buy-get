import type { MessageKey } from './i18n';

/**
 * ABBREVIATIONS, SAID IN FULL (the user, 2026-10-26: "when we use abbreviations, on mouse over it should show the full
 * text or on mobile …" — and, asked how, "Tap the word itself"). A term of the trade in a sentence — SSCC, KRA PIN, CMR —
 * is drawn with a dotted underline: hovering shows what it stands for, a tap opens the same under the word, with a line on
 * what it is (ui/Abbr.tsx). The full words are here and in the word catalog (en.abbr.ts), once, so every app says them
 * the same way, translated like every other word.
 *
 * Only the trade's own short forms. Not the ones everybody reads without thinking — PIN, ID, QR, PDF, SMS, km, kg, the
 * days of the week, a currency's code beside an amount: marking those would put a dotted line under half a screen.
 */
export const ABBREVIATIONS = [
  'GS1',
  'SSCC',
  'KRA PIN',
  'KRA',
  'eTIMS',
  'VAT',
  'HS code',
  'CMR',
  'UN number',
  'KYC',
  'CSV',
  'API',
  'ZPL',
  'UTC',
  'ICD',
  'IBC',
  'VIN',
  'ERP',
  'TMS',
  'ISO 28000',
  'PUDO',
  'CSC',
  'URL',
  'NAS',
  'S3',
  'HMAC',
  'JSON',
  // The trade terms (Incoterms) by their three letters.
  'EXW',
  'FCA',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
] as const;

export type Abbreviation = (typeof ABBREVIATIONS)[number];

/** The words' key for a term: "KRA PIN" → abbr.kraPin.name and abbr.kraPin.about. */
export function abbrSlug(term: Abbreviation): string {
  return term
    .split(' ')
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

export const abbrName = (term: Abbreviation) => `abbr.${abbrSlug(term)}.name` as MessageKey;
export const abbrAbout = (term: Abbreviation) => `abbr.${abbrSlug(term)}.about` as MessageKey;

// The longest first, so "KRA PIN" is one term and not "KRA" and a word after it; a letter, a digit or an underscore on either
// side is a longer word ("APIs", "VATable", a setting's name such as GLOS_ROUTER_URL), not the term.
const ESCAPED = [...ABBREVIATIONS].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const FIND = new RegExp(`(?<![A-Za-z0-9_])(${ESCAPED.join('|')})(?![A-Za-z0-9_])`, 'g');

export type AbbrPiece = string | { term: Abbreviation };

/**
 * A sentence in pieces: its words, and each term of the glossary the first time it comes — once is enough to learn it,
 * and a dotted line under every "GS1" of a paragraph is noise. Pure, so it is tested without a page.
 */
export function splitAbbr(text: string): AbbrPiece[] {
  const out: AbbrPiece[] = [];
  const seen = new Set<string>();
  let at = 0;
  for (const m of text.matchAll(FIND)) {
    const term = m[1] as Abbreviation;
    if (seen.has(term)) continue;
    seen.add(term);
    if (m.index! > at) out.push(text.slice(at, m.index));
    out.push({ term });
    at = m.index! + term.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
