import type { Translate } from '../../shared/i18n';

/**
 * 2026-11-01 — STAFF SEPARATED BY COUNTRY, as the console says it (the owner: "everything needs to be separated by
 * country"). A member of staff works in named countries, or in every country (`*`); the server holds every record and
 * list to them (staff-country.interceptor.ts) — this only says it, offers what may be given, and remembers the country
 * the reader picked to read their lists in.
 */
export const EVERY_COUNTRY = '*';

/** Whether a grant reaches every country. An account from before countries carries none: every country. */
export function holdsEvery(countries: readonly string[] | undefined): boolean {
  return !countries || countries.includes(EVERY_COUNTRY);
}

/** Countries as words: "Every country", or the names, in order. */
export function countriesWords(countries: readonly string[] | undefined, nameOf: (code: string) => string, t: Translate): string {
  if (holdsEvery(countries)) return t('tower.countries.every');
  const names = countries!.map(nameOf);
  return names.length ? names.join(', ') : t('tower.countries.none');
}

/**
 * WHAT THE READER MAY GIVE A COLLEAGUE: only countries they work in themselves — and every country only somebody who
 * works in every country (the server refuses the rest; this does not offer it). `codes` is what a picker lists.
 */
export function givable(mine: readonly string[] | undefined, catalogue: ReadonlyArray<{ code: string }> | null): { every: boolean; codes: string[] } {
  if (holdsEvery(mine)) return { every: true, codes: (catalogue ?? []).map((c) => c.code) };
  return { every: false, codes: [...mine!] };
}

/** A waiting request in countries: a new colleague's, or a change from the countries held now. Null when it says none. */
export function waitingCountries(
  p: { kind?: string; countries?: string[]; countriesNow?: string[] },
  nameOf: (code: string) => string,
  t: Translate,
): string | null {
  if (!p.countries?.length) return null;
  const words = (c: readonly string[]) => countriesWords(c, nameOf, t);
  if (p.kind === 'countries') return t('tower.countries.waitingChange', { from: words(p.countriesNow ?? []), to: words(p.countries) });
  if (p.kind === 'roles') return null;
  return t('tower.countries.waitingNew', { countries: words(p.countries) });
}

/**
 * THE COUNTRIES THE READER CAN PICK TO READ THEIR LISTS IN: their own when they work in more than one; for somebody
 * who works in every country, the countries the network knows (its companies and where it stands). One country is
 * nothing to pick — the reader is already in it.
 */
export function pickable(mine: readonly string[] | undefined, known: ReadonlyArray<string | undefined>): string[] {
  const codes = holdsEvery(mine) ? known.filter((c): c is string => typeof c === 'string' && /^[A-Z]{2}$/.test(c)) : [...mine!];
  const unique = [...new Set(codes)].sort();
  return unique.length > 1 ? unique : [];
}

/** Where the picked country is kept on this computer — a convenience of the reader's, never a grant. */
export const PICKED_KEY = 'sbg.console.country';

/** The country picked before on this computer, whatever it was. */
function keptPick(): string | null {
  try {
    return globalThis.localStorage?.getItem(PICKED_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The country picked before, if it is still one of these choices. */
export function rememberedPick(choices: readonly string[]): string | null {
  const kept = keptPick();
  return kept && choices.includes(kept) ? kept : null;
}

/**
 * The country picked before, at sign-in, when it is still one the reader may pick: one of theirs, or any country for
 * somebody who works in every country (the server narrows a list only to a country the reader holds anyway).
 */
export function restoredPick(countries: readonly string[] | undefined): string | null {
  const kept = keptPick();
  return kept && /^[A-Z]{2}$/.test(kept) && (holdsEvery(countries) || countries!.includes(kept)) ? kept : null;
}

export function keepPick(code: string | null): void {
  try {
    if (code) globalThis.localStorage?.setItem(PICKED_KEY, code);
    else globalThis.localStorage?.removeItem(PICKED_KEY);
  } catch {
    /* a private window: the pick lasts this page */
  }
}
