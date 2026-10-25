import { resolveBaseUrl } from '../../lib/sbg/config';

/**
 * WHETHER SEEBUYGET IS OPEN WHERE AN ACCOUNT STANDS — for the apps to tell somebody who signed up before their country
 * opened (COMING, the user 2026-10-25: "can preregister before a country goes live") why nothing moves yet, and when it
 * will. One country as GET /v1/sbg/countries/:code says it: public, the same answer the join form reads.
 */
export interface CountryStanding {
  country: string;
  name: string;
  joinable: boolean;
  /** Sign-ups are taken there, and nothing moves until the day it opens. */
  coming?: boolean;
  settles: boolean;
  settlesAs?: string;
}

const asked = new Map<string, Promise<CountryStanding | undefined>>();

/**
 * Asked once a page per country. Without signal there is no answer and nothing is said: a note that cannot load is not
 * shown, and the next screen to ask tries again rather than keeping the failure.
 */
export function countryStanding(code: string | undefined): Promise<CountryStanding | undefined> {
  const key = (code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(key)) return Promise.resolve(undefined);
  const known = asked.get(key);
  if (known) return known;
  const answer = (async () => {
    try {
      const res = await fetch(`${resolveBaseUrl()}/v1/sbg/countries/${key}`, { signal: AbortSignal.timeout(6000) });
      return res.ok ? ((await res.json()) as CountryStanding) : undefined;
    } catch {
      return undefined;
    }
  })();
  asked.set(key, answer);
  void answer.then((s) => {
    if (!s) asked.delete(key);
  });
  return answer;
}

/** For the tests: forget every answer, as a new page would. */
export function forgetCountryStandings(): void {
  asked.clear();
}
