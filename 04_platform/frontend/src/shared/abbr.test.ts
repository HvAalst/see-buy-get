import { describe, expect, it } from 'vitest';
import { abbrAbout, abbrName, abbrSlug, ABBREVIATIONS, splitAbbr } from './abbr';
import { en } from './i18n/catalogs/en';
import { enApps } from './i18n/catalogs/en.apps';
import { enTowerAll } from './i18n/catalogs/en.tower';

const ALL: Record<string, string> = { ...en, ...enApps, ...enTowerAll };

/**
 * The capitals in the words that are left plain, each for its reason. A short form not here and not in the glossary
 * fails the last test: whoever writes it decides — explain it (shared/abbr.ts, en.abbr.ts), or say here why not.
 */
const PLAIN: Record<string, string> = {
  // Everybody reads these without thinking.
  ID: 'everyday', PIN: 'everyday', QR: 'everyday', OK: 'everyday', PDF: 'everyday', PNG: 'everyday', JPEG: 'everyday', SMS: 'everyday', MB: 'everyday', GPS: 'everyday', AI: 'everyday', EU: 'everyday',
  // A currency or a country by its code, beside an amount or in a list of them.
  KES: 'money', USD: 'money', UGX: 'money', TZS: 'money', ETB: 'money', KE: 'country',
  // How a date or a time is to be written.
  YYYY: 'format', DD: 'format', HH: 'format', MM: 'format',
  // Words in capitals for weight, or as a printed stamp.
  ADD: 'stress', AND: 'stress', COPY: 'stamp', COUNT: 'stress', FROM: 'stress', HERE: 'stress', HIGH: 'stress', MEANS: 'stress', NO: 'stress', NOT: 'stress', NOTHING: 'stress', ONE: 'stress', OWN: 'stress', PER: 'stress', RAISES: 'stress', RED: 'stress', SERVICE: 'stress', SHORTER: 'stress', SKIPPED: 'stress', TO: 'stress', WORDING: 'stress', YOU: 'stress', YOUR: 'stress', SANDBOX: 'stamp', WEBHOOK: 'stress', UP: 'stress', BILLED: 'stress', COVER: 'stress', DOES: 'stress', IS: 'stress', NEW: 'stress', PAYMENT: 'stress',
  // Names, and codes as they are printed: a brand, an example code, a prefix of our own codes.
  GLOS: 'name', SBG: 'name', TWILIO: 'name', QNAP: 'name', B2: 'name', R2: 'name', GIT: 'example', FRT: 'code', KLM: 'example', FM: 'code', PX9M: 'example', COL: 'code', FLT: 'code', DID: 'code', SID: 'code', POST: 'code', OSRM: 'name', SHA256: 'name', VAPID: 'name',
};

describe('the trade’s short forms, said in full', () => {
  it('marks each term the first time it comes in a sentence, a two-word term as one, and never inside a longer word', () => {
    expect(splitAbbr('Scan the SSCC, or our QR: the SSCC is GS1’s.')).toEqual(['Scan the ', { term: 'SSCC' }, ', or our QR: the SSCC is ', { term: 'GS1' }, '’s.']);
    expect(splitAbbr('Give your KRA PIN; KRA records it.')).toEqual(['Give your ', { term: 'KRA PIN' }, '; ', { term: 'KRA' }, ' records it.']);
    expect(splitAbbr('APIs and VATable')).toEqual(['APIs and VATable']);
    expect(splitAbbr('a GS1-128 barcode, S3-compatible')).toEqual(['a ', { term: 'GS1' }, '-128 barcode, ', { term: 'S3' }, '-compatible']);
    expect(splitAbbr('No short forms here.')).toEqual(['No short forms here.']);
    // A setting's name is one word: the URL in GLOS_ROUTER_URL is not marked.
    expect(splitAbbr('Set GLOS_ROUTER_URL to its URL.')).toEqual(['Set GLOS_ROUTER_URL to its ', { term: 'URL' }, '.']);
    expect(splitAbbr('')).toEqual([]);
  });

  it('says every term in full, with a line on what it is', () => {
    const slugs = ABBREVIATIONS.map(abbrSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const term of ABBREVIATIONS) {
      expect({ term, name: Boolean(ALL[abbrName(term)]?.trim()), about: Boolean(ALL[abbrAbout(term)]?.trim()) }).toEqual({ term, name: true, about: true });
    }
  });

  it('leaves no short form in the words unexplained without a reason', () => {
    const glossaryWords = new Set(ABBREVIATIONS.flatMap((t) => t.split(' ')));
    const seen = new Set<string>();
    for (const value of Object.values(ALL)) for (const m of String(value).matchAll(/(?<![A-Za-z0-9_])([A-Z][A-Z0-9]{1,6})(?![A-Za-z0-9_])/g)) seen.add(m[1]);
    // The guard read the words: the glossary's own terms are among what it found.
    expect(seen.has('SSCC') && seen.has('GS1') && seen.size > 30).toBe(true);
    const unexplained = [...seen].filter((s) => !glossaryWords.has(s) && !PLAIN[s]).sort();
    expect(unexplained).toEqual([]);
  });
});
