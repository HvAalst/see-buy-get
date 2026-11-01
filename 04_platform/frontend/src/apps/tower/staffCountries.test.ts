import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countriesWords, givable, holdsEvery, keepPick, pickable, rememberedPick, restoredPick, waitingCountries } from './staffCountries';

const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')})` : key);
const nameOf = (code: string) => ({ KE: 'Kenya', NL: 'Netherlands', ZM: 'Zambia' })[code] ?? code;

describe('staff separated by country, in the console', () => {
  // This computer's storage, stood in for: the tests run without a browser.
  const kept = new Map<string, string>();
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
  });
  afterEach(() => keepPick(null));

  it('says a grant in words — every country for an account from before countries', () => {
    expect(holdsEvery(undefined)).toBe(true);
    expect(holdsEvery(['*'])).toBe(true);
    expect(holdsEvery(['KE'])).toBe(false);
    expect(countriesWords(['*'], nameOf, t as never)).toBe('tower.countries.every');
    expect(countriesWords(['KE', 'NL'], nameOf, t as never)).toBe('Kenya, Netherlands');
    expect(countriesWords([], nameOf, t as never)).toBe('tower.countries.none');
  });

  it('offers only what the reader may give: their own countries, or all of them and every country', () => {
    const catalogue = [{ code: 'KE' }, { code: 'NL' }, { code: 'ZM' }];
    expect(givable(['KE'], catalogue)).toEqual({ every: false, codes: ['KE'] });
    expect(givable(['*'], catalogue)).toEqual({ every: true, codes: ['KE', 'NL', 'ZM'] });
  });

  it('says what a waiting request asks for, in countries', () => {
    expect(waitingCountries({ countries: ['KE'] }, nameOf, t as never)).toBe('tower.countries.waitingNew(countries=Kenya)');
    expect(waitingCountries({ kind: 'countries', countries: ['KE'], countriesNow: ['*'] }, nameOf, t as never)).toBe('tower.countries.waitingChange(from=tower.countries.every,to=Kenya)');
    expect(waitingCountries({ kind: 'roles', countries: ['KE'] }, nameOf, t as never)).toBeNull();
    expect(waitingCountries({}, nameOf, t as never)).toBeNull();
  });

  it('lets the reader pick among more than one country, and remembers a pick only while it is still theirs', () => {
    expect(pickable(['KE'], [])).toEqual([]);
    expect(pickable(['NL', 'KE'], [])).toEqual(['KE', 'NL']);
    expect(pickable(['*'], ['NL', 'KE', 'KE', undefined, 'sbg'])).toEqual(['KE', 'NL']);
    keepPick('NL');
    expect(rememberedPick(['KE', 'NL'])).toBe('NL');
    expect(rememberedPick(['KE'])).toBeNull();
    // at sign-in: one of theirs, or any country for somebody who works in every country
    expect(restoredPick(['NL'])).toBe('NL');
    expect(restoredPick(['KE'])).toBeNull();
    expect(restoredPick(['*'])).toBe('NL');
  });
});
