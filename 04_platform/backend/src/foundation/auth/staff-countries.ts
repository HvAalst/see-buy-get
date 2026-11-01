import { catalogueEntry, isCatalogued } from '../countries/catalogue';

/**
 * 2026-11-01 — A MEMBER OF STAFF WORKS IN COUNTRIES (the owner: "everything needs to be separated by country … those
 * assigned to a country can not login to any other country without the right credentials"). One account per person,
 * carrying the countries it reaches; roles say WHAT they may do, countries say WHERE. A record of a country they do not
 * hold answers as if it did not exist.
 *
 * EVERY COUNTRY is a grant of its own (`*`), held by the owner to start. An account from before countries holds every
 * country, as an account from before roles holds all four: production started with the owner's, and narrowing the
 * others is a change two people make.
 */
export const EVERY_COUNTRY = '*';

/** Countries as given: catalogued codes only, upper-cased, each once, sorted — or every country, when that is asked. */
export function countriesOf(raw: readonly unknown[] | undefined): string[] {
  const given = (raw ?? []).filter((c): c is string => typeof c === 'string').map((c) => c.trim().toUpperCase());
  if (given.includes(EVERY_COUNTRY)) return [EVERY_COUNTRY];
  return [...new Set(given.filter((c) => isCatalogued(c)))].sort();
}

/** Does this grant reach every country? Absent — an account or a token from before countries — does. */
export function holdsEvery(held: readonly string[] | undefined): boolean {
  return !held || held.includes(EVERY_COUNTRY);
}

/** May somebody holding these countries see a record that touches those? Any one in common is enough. */
export function reaches(held: readonly string[] | undefined, touched: readonly string[]): boolean {
  if (holdsEvery(held)) return true;
  // A record that touches every country (a colleague who works in every country) is in each of them.
  if (touched.includes(EVERY_COUNTRY)) return true;
  return touched.some((c) => held!.includes(c.toUpperCase()));
}

/** May somebody holding `held` give somebody `asked`? Only what they hold themselves; every country only from every country. */
export function mayGrant(held: readonly string[] | undefined, asked: readonly string[]): boolean {
  if (holdsEvery(held)) return true;
  if (asked.includes(EVERY_COUNTRY)) return false;
  return asked.every((c) => held!.includes(c));
}

/** Does `next` only take countries away from `now` — never add one, and never every country? */
export function onlyNarrows(now: readonly string[], next: readonly string[]): boolean {
  if (next.includes(EVERY_COUNTRY)) return holdsEvery(now);
  if (holdsEvery(now)) return true;
  return next.every((c) => now.includes(c));
}

/** Countries as a sentence says them: "every country", "Kenya", "Kenya and the Netherlands". */
export function countriesLine(countries: readonly string[] | undefined): string {
  if (holdsEvery(countries)) return 'every country';
  const names = countries!.map((c) => catalogueEntry(c)?.name ?? c);
  if (!names.length) return 'no country';
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
}
