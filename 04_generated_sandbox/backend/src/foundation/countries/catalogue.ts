import { COUNTRY_LINES, DEFAULT_ID_DOCUMENTS, ID_DOCUMENTS, NO_POSTAL_CODE } from './catalogue.data';

/**
 * THE COUNTRIES THAT EXIST — the only place a new jurisdiction may come from.
 *
 * Until this, any two letters were a country: an operator could record `ZZ` as matched and every screen would
 * dutifully answer for a place that is not on any map. The catalogue is data, read by everybody and edited by
 * nobody at runtime; what changes at runtime is a country's STANDING (the presence), never whether it exists.
 */
export interface CatalogueCountry {
  code: string;
  name: string;
  /** ISO-4217 — what the country actually settles in, including currencies it uses but does not issue. */
  currency: string;
  dialCode: string;
  drivingSide: 'left' | 'right';
  languages: string[];
  /** Whether an address there normally carries a postal code — a form must not demand one where it does not. */
  postalCode: boolean;
  /** The identity documents vetting accepts there. */
  idDocuments: string[];
}

const regionName = new Intl.DisplayNames(['en'], { type: 'region' });

export const COUNTRY_CATALOGUE: readonly CatalogueCountry[] = COUNTRY_LINES.trim()
  .split('\n')
  .map((line) => {
    const [code, currency, dial, side, languages] = line.trim().split('|');
    return {
      code,
      name: regionName.of(code) ?? code,
      currency,
      dialCode: `+${dial}`,
      drivingSide: side === 'L' ? 'left' : 'right',
      languages: languages.split(','),
      postalCode: !NO_POSTAL_CODE.has(code),
      idDocuments: ID_DOCUMENTS[code] ?? DEFAULT_ID_DOCUMENTS,
    } satisfies CatalogueCountry;
  });

const BY_CODE = new Map(COUNTRY_CATALOGUE.map((c) => [c.code, c]));

/** The country behind a code, or nothing — 'ke' and 'KE' are the same country. */
export function catalogueEntry(code?: string): CatalogueCountry | undefined {
  return code ? BY_CODE.get(code.trim().toUpperCase()) : undefined;
}

export function isCatalogued(code?: string): boolean {
  return Boolean(catalogueEntry(code));
}
