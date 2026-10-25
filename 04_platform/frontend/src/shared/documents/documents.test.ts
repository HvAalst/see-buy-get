import { afterEach, describe, expect, it, vi } from 'vitest';
import { changedSince, countriesOf, fetchAgreementSets, forgetAgreementSet, mergeSets, numbersOf, type AgreementDocument } from './documents';

/*
 * GENERAL, AND EACH COUNTRY'S OWN (the user, 2026-10-25: "every country needs it's specific adjustments, so there will be
 * the general terms of use, global, and specific terms of use"): what a sign-up form shows and sends.
 */
const doc = (key: string, number = 1, since = 1): AgreementDocument => {
  const [kind, country] = key.split('@') as [AgreementDocument['kind'], string | undefined];
  return { key, kind, ...(country ? { country } : {}), title: key, number, since, publishedAt: '2026-10-25T09:00:00.000Z', path: country ? `/${kind}/?country=${country}` : `/${kind}/` };
};
const GENERAL = [doc('terms', 2, 2), doc('privacy'), doc('cookies', 2, 1)];

describe('what a sign-up agrees to, in more than one country', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetAgreementSet();
  });

  it('sends the version of every line on screen, by its key', () => {
    expect(numbersOf([...GENERAL, doc('terms@KE')])).toEqual({ terms: 2, privacy: 1, cookies: 2, 'terms@KE': 1 });
  });

  it('shows the general documents once, then each country’s own — a phone from one country, signing up in another', () => {
    const kenya = [...GENERAL, doc('terms@KE')];
    const uganda = [...GENERAL, doc('privacy@UG'), doc('terms@UG')];
    expect(mergeSets([kenya, uganda]).map((d) => d.key)).toEqual(['terms', 'privacy', 'cookies', 'terms@KE', 'privacy@UG', 'terms@UG']);
    expect(mergeSets([GENERAL]).map((d) => d.key)).toEqual(['terms', 'privacy', 'cookies']);
  });

  it('takes each country once, whatever case it is typed in, and leaves out what is not a country', () => {
    expect(countriesOf(['ke', undefined, 'KE', '', null, ' ug ', 'Kenya'])).toEqual(['KE', 'UG']);
  });

  it('marks as new what has a version since what they agreed to — and a country’s own they never agreed to', () => {
    expect(changedSince([...GENERAL, doc('terms@KE')], { terms: 2, privacy: 1, cookies: 1 })).toEqual(['cookies', 'terms@KE']);
    expect(changedSince(GENERAL, undefined)).toEqual([]);
  });

  it('reads each country’s set from the server, and nothing at all when one of them cannot be read', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        asked.push(String(url).replace(/^.*\/v1/, '/v1'));
        if (String(url).includes('country=UG')) return new Response('{}', { status: 503 });
        return new Response(JSON.stringify({ documents: String(url).includes('country=KE') ? [...GENERAL, doc('terms@KE')] : GENERAL }), { status: 200 });
      }),
    );
    expect((await fetchAgreementSets(['KE']))?.map((d) => d.key)).toEqual(['terms', 'privacy', 'cookies', 'terms@KE']);
    expect((await fetchAgreementSets([]))?.map((d) => d.key)).toEqual(['terms', 'privacy', 'cookies']);
    // No signal for one is not "no terms there": the form says it could not load, rather than sending less.
    expect(await fetchAgreementSets(['KE', 'UG'])).toBeNull();
    expect(asked).toEqual(['/v1/sbg/agreement?country=KE', '/v1/sbg/agreement', '/v1/sbg/agreement?country=UG']);
  });
});
