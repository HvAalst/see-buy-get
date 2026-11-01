import { GlosError } from '../http/glos-error';
import { catalogueEntry } from './catalogue';

/**
 * AN ADDRESS AS THE COUNTRY WRITES IT (the owner, 2026-10-30: "in settings the address field is poor, especially for
 * countries that do have formal physical addresses. We say it is used for invoicing").
 *
 * One free line was enough where an address is a building, a road and an area — and too little where an invoice must
 * carry a street, a house number, a postcode and a town that can be checked. So a country says which fields its
 * addresses have, in what order they are written, and what its postcode looks like; the form asks for those, the
 * server checks them, and the address is kept as the one line every paper already prints.
 *
 * Kept deliberately small: the shape of an address, never a list of streets. A country this does not know is asked
 * for a line and a town, and a postcode where the catalogue says it has them — never refused for being unknown.
 */

export const ADDRESS_FIELDS = ['building', 'street', 'number', 'addition', 'line', 'area', 'poBox', 'postcode', 'town', 'region'] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

export type AddressParts = { country: string } & Partial<Record<AddressField, string>>;

export interface AddressFormat {
  country: string;
  /** The fields asked, in the order a form shows them; `required` ones must be there. */
  fields: Array<{ key: AddressField; required: boolean }>;
  /** What a postcode there looks like, to show as an example; absent where it has none or we do not check it. */
  postcodeExample?: string;
}

interface Style {
  fields: Array<[AddressField, boolean]>;
  /** How the address is written, line by line; each line's parts joined by a space. */
  lines: AddressField[][];
}

/** Street, then the house number: most of continental Europe. */
const STREET_NUMBER: Style = {
  fields: [['street', true], ['number', true], ['addition', false], ['postcode', true], ['town', true]],
  lines: [['street', 'number', 'addition'], ['postcode', 'town']],
};
/** The house number first, then the street: France and Belgium's French usage, and others. */
const NUMBER_STREET: Style = {
  fields: [['number', true], ['street', true], ['addition', false], ['postcode', true], ['town', true]],
  lines: [['number', 'street', 'addition'], ['postcode', 'town']],
};
/** A street address line, the town, the postcode: Britain and Ireland. */
const LINE_TOWN_POSTCODE: Style = {
  fields: [['line', true], ['town', true], ['postcode', true]],
  lines: [['line'], ['town'], ['postcode']],
};
/** A street address line, then town, state or province and postcode on one: the Americas and Australia. */
const LINE_TOWN_REGION: Style = {
  fields: [['line', true], ['town', true], ['region', true], ['postcode', true]],
  lines: [['line'], ['town', 'region', 'postcode']],
};
/**
 * EAST AFRICA: a building, a road and an area, and a post office box with its postal code — the way an address is
 * written where most streets carry no numbers and post goes to a box.
 */
const BUILDING_AREA_BOX: Style = {
  fields: [['building', false], ['street', false], ['area', true], ['poBox', false], ['postcode', false], ['town', true]],
  lines: [['building', 'street'], ['area'], ['poBox', 'postcode'], ['town']],
};
/** Anywhere else: a line, the town, and a postcode where the country has them. */
const ANY: Style = {
  fields: [['line', true], ['area', false], ['postcode', false], ['town', true]],
  lines: [['line'], ['area'], ['postcode', 'town']],
};

const STYLES: Record<string, Style> = {
  NL: STREET_NUMBER, DE: STREET_NUMBER, AT: STREET_NUMBER, CH: STREET_NUMBER, LU: STREET_NUMBER, DK: STREET_NUMBER,
  SE: STREET_NUMBER, NO: STREET_NUMBER, FI: STREET_NUMBER, PL: STREET_NUMBER, CZ: STREET_NUMBER, SK: STREET_NUMBER,
  ES: STREET_NUMBER, IT: STREET_NUMBER, PT: STREET_NUMBER, BE: STREET_NUMBER, HU: STREET_NUMBER, SI: STREET_NUMBER,
  HR: STREET_NUMBER, RO: STREET_NUMBER, BG: STREET_NUMBER, GR: STREET_NUMBER, EE: STREET_NUMBER, LV: STREET_NUMBER, LT: STREET_NUMBER,
  FR: NUMBER_STREET, MC: NUMBER_STREET,
  GB: LINE_TOWN_POSTCODE, IE: LINE_TOWN_POSTCODE,
  US: LINE_TOWN_REGION, CA: LINE_TOWN_REGION, AU: LINE_TOWN_REGION,
  KE: BUILDING_AREA_BOX, UG: BUILDING_AREA_BOX, TZ: BUILDING_AREA_BOX, RW: BUILDING_AREA_BOX, ET: BUILDING_AREA_BOX,
  BI: BUILDING_AREA_BOX, SS: BUILDING_AREA_BOX, SO: BUILDING_AREA_BOX, DJ: BUILDING_AREA_BOX, ER: BUILDING_AREA_BOX,
};

/** What a postcode looks like where we check it — the pattern, and one to show. Kept to the ones we are sure of. */
const POSTCODES: Record<string, { pattern: RegExp; example: string }> = {
  NL: { pattern: /^\d{4} [A-Z]{2}$/, example: '1015 CJ' },
  BE: { pattern: /^\d{4}$/, example: '1000' },
  LU: { pattern: /^(L-)?\d{4}$/, example: '1009' },
  DE: { pattern: /^\d{5}$/, example: '10115' },
  AT: { pattern: /^\d{4}$/, example: '1010' },
  CH: { pattern: /^\d{4}$/, example: '8001' },
  FR: { pattern: /^\d{5}$/, example: '75001' },
  ES: { pattern: /^\d{5}$/, example: '28001' },
  IT: { pattern: /^\d{5}$/, example: '00118' },
  PT: { pattern: /^\d{4}-\d{3}$/, example: '1100-148' },
  DK: { pattern: /^\d{4}$/, example: '1050' },
  SE: { pattern: /^\d{3} \d{2}$/, example: '111 22' },
  NO: { pattern: /^\d{4}$/, example: '0150' },
  FI: { pattern: /^\d{5}$/, example: '00100' },
  PL: { pattern: /^\d{2}-\d{3}$/, example: '00-001' },
  CZ: { pattern: /^\d{3} \d{2}$/, example: '110 00' },
  GB: { pattern: /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/, example: 'SW1A 1AA' },
  US: { pattern: /^\d{5}(-\d{4})?$/, example: '10001' },
  CA: { pattern: /^[A-Z]\d[A-Z] \d[A-Z]\d$/, example: 'K1A 0B1' },
  AU: { pattern: /^\d{4}$/, example: '2000' },
  KE: { pattern: /^\d{5}$/, example: '00100' },
  TZ: { pattern: /^\d{5}$/, example: '11101' },
  ET: { pattern: /^\d{4}$/, example: '1000' },
  ZA: { pattern: /^\d{4}$/, example: '0001' },
  IN: { pattern: /^\d{6}$/, example: '110001' },
};

/** Where a space belongs in a postcode typed without one: "1015CJ" is "1015 CJ". */
const SPACED: Record<string, RegExp> = { NL: /^(\d{4})([A-Z]{2})$/, SE: /^(\d{3})(\d{2})$/, CZ: /^(\d{3})(\d{2})$/, CA: /^([A-Z]\d[A-Z])(\d[A-Z]\d)$/, GB: /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/ };

function styleOf(country: string): Style {
  return STYLES[country] ?? ANY;
}

/** The fields a country's addresses have, for a form to ask. */
export function addressFormatFor(code: string): AddressFormat {
  const country = (code ?? '').trim().toUpperCase();
  const style = styleOf(country);
  // A country that has no postal codes is not asked for one, whatever its style says (the catalogue knows).
  const hasPostcodes = catalogueEntry(country)?.postalCode !== false;
  const fields = style.fields.filter(([key]) => key !== 'postcode' || hasPostcodes).map(([key, required]) => ({ key, required }));
  const example = POSTCODES[country]?.example;
  return { country, fields, ...(example && hasPostcodes ? { postcodeExample: example } : {}) };
}

/** A postcode as the country writes it: upper case, single spaces, the space where it belongs. */
function tidyPostcode(country: string, raw: string): string {
  let s = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  const spaced = SPACED[country];
  if (spaced && !s.includes(' ')) s = s.replace(spaced, '$1 $2');
  return s;
}

/**
 * The parts, checked and tidied: the country is a real one, every field it requires is there, the postcode looks like
 * that country's, nothing is longer than a line. Refused by the field, so a form can say which.
 */
export function checkAddress(input: AddressParts): AddressParts {
  const country = (input.country ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || !catalogueEntry(country)) throw new GlosError('VALIDATION_FAILED', 'Choose the country of the address', { field: 'country' });
  const format = addressFormatFor(country);
  const out: AddressParts = { country };
  for (const { key, required } of format.fields) {
    let value = (input[key] ?? '').replace(/\s+/g, ' ').trim();
    if (value.length > 120) throw new GlosError('VALIDATION_FAILED', 'That is too long for one part of an address', { field: key });
    if (key === 'postcode' && value) {
      value = tidyPostcode(country, value);
      const known = POSTCODES[country];
      if (known && !known.pattern.test(value)) throw new GlosError('VALIDATION_FAILED', `That is not a postcode of ${catalogueEntry(country)!.name}: it looks like ${known.example}`, { field: 'postcode' });
    }
    if (required && !value) throw new GlosError('VALIDATION_FAILED', 'Fill in every part of the address that is not marked optional', { field: key });
    if (value) out[key] = value;
  }
  return out;
}

/** The address as one line, the way every paper prints it: the country's own order, its lines joined by commas. */
export function formatAddress(parts: AddressParts): string {
  const style = styleOf(parts.country);
  const said = (key: AddressField): string | undefined => {
    const v = parts[key]?.trim();
    if (!v) return undefined;
    // A post office box is written out where it is written down.
    return key === 'poBox' ? `P.O. Box ${v.replace(/^p\.?\s*o\.?\s*box\s*/i, '')}` : v;
  };
  const lines = style.lines
    .map((line) => {
      const words = line.map(said).filter((v): v is string => Boolean(v));
      // "P.O. Box 123 - 00100": a box and its postal code are written with a dash between them.
      return line.includes('poBox') && words.length === 2 ? words.join(' - ') : words.join(' ');
    })
    .filter(Boolean);
  return lines.join(', ');
}
