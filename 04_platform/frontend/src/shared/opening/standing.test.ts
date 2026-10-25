import { afterEach, describe, expect, it, vi } from 'vitest';
import { countryStanding, forgetCountryStandings } from './standing';

/*
 * WHETHER SEEBUYGET IS OPEN WHERE AN ACCOUNT STANDS (COMING, the user 2026-10-25): asked of the one-country route, once a
 * page per country — and a failure is not kept, so the next screen to ask tries again.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  forgetCountryStandings();
});

const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('a country’s standing', () => {
  it('asks the one-country route once a page, and says whether it is coming', async () => {
    const fetcher = answer({ country: 'ZM', name: 'Zambia', joinable: true, coming: true, settles: false });
    vi.stubGlobal('fetch', fetcher);
    expect(await countryStanding('zm')).toMatchObject({ name: 'Zambia', coming: true });
    expect(await countryStanding('ZM')).toMatchObject({ coming: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toMatch(/\/v1\/sbg\/countries\/ZM$/);
  });

  it('asks nothing for no country, or for something that is not a country code', async () => {
    const fetcher = answer({});
    vi.stubGlobal('fetch', fetcher);
    expect(await countryStanding(undefined)).toBeUndefined();
    expect(await countryStanding('Zambia')).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps no failure: without signal nothing is said, and the next ask tries again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('no signal'))));
    expect(await countryStanding('ZM')).toBeUndefined();
    vi.stubGlobal('fetch', answer({ country: 'ZM', name: 'Zambia', joinable: true, settles: false }, 404));
    expect(await countryStanding('ZM')).toBeUndefined();
    const fetcher = answer({ country: 'ZM', name: 'Zambia', joinable: true, settles: false });
    vi.stubGlobal('fetch', fetcher);
    expect(await countryStanding('ZM')).toMatchObject({ name: 'Zambia' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
