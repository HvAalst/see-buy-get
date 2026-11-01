/**
 * AN ADDRESS IN ITS COUNTRY'S PARTS, as the form in Settings asks it (the owner, 2026-10-30: "in settings the address
 * field is poor, especially for countries that do have formal physical addresses. We say it is used for invoicing").
 * Which parts a country has, and what its postcode looks like, is the server's to say (`GET account/address-format/:c`,
 * backend/src/foundation/countries/address-format.ts): this only keeps the form's values and builds what is sent.
 */

export const ADDRESS_FIELDS = ['building', 'street', 'number', 'addition', 'line', 'area', 'poBox', 'postcode', 'town', 'region'] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];
export type AddressParts = { country: string } & Partial<Record<AddressField, string>>;

export interface AddressFormat {
  country: string;
  fields: Array<{ key: AddressField; required: boolean }>;
  postcodeExample?: string;
}

/** The country a new address starts in: the saved one's, else the browser's own region, else none chosen. */
export function startingCountry(saved: AddressParts | undefined, language: string | undefined): string {
  if (saved?.country) return saved.country;
  const region = (language ?? '').split(/[-_]/)[1] ?? '';
  return /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : '';
}

/** What is sent: the country, and only the parts its format asks — trimmed, empty ones left out. */
export function addressBody(country: string, values: Partial<Record<AddressField, string>>, format: AddressFormat | null): AddressParts {
  const body: AddressParts = { country };
  for (const { key } of format?.fields ?? []) {
    const v = (values[key] ?? '').trim();
    if (v) body[key] = v;
  }
  return body;
}

/** Whether two addresses say the same: the country and every part, spaces aside. */
export function sameAddress(a: Partial<AddressParts> | undefined, b: Partial<AddressParts> | undefined): boolean {
  const norm = (x: Partial<AddressParts> | undefined) => JSON.stringify([(x?.country ?? '').trim().toUpperCase(), ...ADDRESS_FIELDS.map((k) => (x?.[k] ?? '').trim())]);
  return norm(a) === norm(b);
}

/** Whether any part is filled in at all (the country aside): nothing filled is "no address". */
export function anyPart(value: Partial<AddressParts>): boolean {
  return ADDRESS_FIELDS.some((k) => (value[k] ?? '').trim());
}

/** The first required part still empty — said before anything is sent; the server checks the rest by the field. */
export function missingPart(values: Partial<Record<AddressField, string>>, format: AddressFormat | null): AddressField | null {
  for (const { key, required } of format?.fields ?? []) if (required && !(values[key] ?? '').trim()) return key;
  return null;
}
