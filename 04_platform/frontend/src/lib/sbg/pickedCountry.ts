/**
 * 2026-11-01 — THE COUNTRY A MEMBER OF STAFF PICKED TO READ THEIR LISTS IN (the console's picker). Sent with every request
 * while one is picked; the server keeps a list to it only when it is one of the reader's own countries, so this is a
 * narrowing, never a grant. Nothing but the console sets it.
 */
export const PICKED_COUNTRY_HEADER = 'x-sbg-country';

let picked: string | null = null;

export function setPickedCountry(code: string | null): void {
  picked = code && /^[A-Z]{2}$/.test(code) ? code : null;
}

export function pickedCountry(): string | null {
  return picked;
}
