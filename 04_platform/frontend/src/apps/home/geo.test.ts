import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCountriesOf } from './pages';
import { datesFor, pageHash } from '../../../scripts/page-dates.mjs';
import { openKey } from '../../../scripts/pages-stale.mjs';

/*
 * 2026-11-18 — WHAT AI SEARCH READS ABOUT SEEBUYGET (the owner: "Is SBG optimized for GEO?"). Where it runs is read from the
 * server's own list of countries — open to everyone, never coming or being tested — and said in the front page's
 * structured data, with the help's contact page as where to reach us. Each page's date in the sitemap is the day its
 * content last changed, not the day the build ran.
 */
vi.mock('virtual:pwa-register/preact', () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }),
}));

const SITE = 'https://seebuyget.example';
const COUNTRIES = [
  { country: 'NL', name: 'Netherlands', joinable: true, settles: false },
  { country: 'KE', name: 'Kenya', joinable: true, coming: true, settles: true },
  { country: 'ET', name: 'Ethiopia', joinable: true, testing: true, settles: false },
  { country: 'UG', name: 'Uganda', joinable: false, settles: false },
];

type Head = { type: string; props: Record<string, string> };
async function frontLd(countries: unknown): Promise<Array<Record<string, unknown>>> {
  vi.resetModules();
  vi.stubEnv('SBG_PUBLIC_URL', SITE);
  vi.stubGlobal('fetch', async (url: string) => (String(url).endsWith('/v1/sbg/countries') ? new Response(JSON.stringify(countries), { status: 200 }) : new Response('', { status: 503 })));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { prerender } = await import('./prerender');
  const built = await prerender({ url: '/' });
  const ld = [...built.head.elements].find((e: Head) => e.type === 'script' && e.props.type === 'application/ld+json')!;
  return JSON.parse(ld.props.children) as Array<Record<string, unknown>>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as { __SBG_PRERENDER__?: unknown }).__SBG_PRERENDER__;
});

describe('where SeeBuyGet runs', () => {
  it('is the countries open to everyone — not one coming, being tested or closed', () => {
    expect(openCountriesOf(COUNTRIES)).toEqual([{ country: 'NL', name: 'Netherlands' }]);
    expect(openCountriesOf({ items: [] })).toEqual([]);
    expect(openCountriesOf(null)).toEqual([]);
  });

  it('is said in the front page’s structured data, with the help’s contact page as where to reach us', async () => {
    const [org, service] = await frontLd(COUNTRIES);
    expect(org['@type']).toBe('Organization');
    expect(org.areaServed).toEqual([{ '@type': 'Country', name: 'Netherlands', identifier: 'NL' }]);
    expect(org.contactPoint).toEqual({ '@type': 'ContactPoint', contactType: 'customer support', url: `${SITE}/help/contact/` });
    expect(service.areaServed).toEqual(org.areaServed);
    // No number and no address is typed into it: each country sets its own office.
    expect(JSON.stringify(org)).not.toMatch(/telephone|email|streetAddress/);
  });

  it('names no country where the server could not be read, or none is open yet', async () => {
    const [org] = await frontLd([]);
    expect(org).not.toHaveProperty('areaServed');
  });

  it('a country opened since the build makes the pages out of date at night', () => {
    expect(openKey([{ country: 'NL', name: 'Netherlands' }])).toBe(openKey(COUNTRIES));
    expect(openKey([])).not.toBe(openKey(COUNTRIES));
    expect(openKey(undefined)).toBe(openKey([]));
  });
});

describe('each page’s date is the day its content last changed', () => {
  const page = (body: string, script = '/assets/index-a1b2c3.js') =>
    `<html><head><title>About SeeBuyGet</title><meta name="description" content="What it is"><script type="module" src="${script}"></script></head><body><div id="app"><main>${body}</main><script type="application/json" id="prerender-data">{"towns":[]}</script></div>\n</body></html>`;

  it('a build that only renamed its scripts changes nothing; a word on the page does', () => {
    expect(pageHash(page('Shops near you'))).toBe(pageHash(page('Shops near you', '/assets/index-z9y8x7.js')));
    expect(pageHash(page('Shops near you'))).not.toBe(pageHash(page('Shops near your home')));
    expect(pageHash(page('Shops near you').replace('What it is', 'What it does'))).not.toBe(pageHash(page('Shops near you')));
  });

  it('keeps the published date of an unchanged page; a changed or new page is today’s', () => {
    const before = { pages: { '/': { hash: 'aaa', date: '2026-11-01' }, '/about/': { hash: 'bbb', date: '2026-11-02' } } };
    expect(datesFor({ '/': 'aaa', '/about/': 'ccc', '/for/shops/': 'ddd' }, before, '2026-11-18')).toEqual({
      '/': { hash: 'aaa', date: '2026-11-01' },
      '/about/': { hash: 'ccc', date: '2026-11-18' },
      '/for/shops/': { hash: 'ddd', date: '2026-11-18' },
    });
  });

  it('nothing published to compare with, or a date that is no date or still to come: today', () => {
    expect(datesFor({ '/': 'aaa' }, null, '2026-11-18')).toEqual({ '/': { hash: 'aaa', date: '2026-11-18' } });
    expect(datesFor({ '/': 'aaa' }, { pages: { '/': { hash: 'aaa', date: 'yesterday' } } }, '2026-11-18')['/'].date).toBe('2026-11-18');
    expect(datesFor({ '/': 'aaa' }, { pages: { '/': { hash: 'aaa', date: '2027-01-01' } } }, '2026-11-18')['/'].date).toBe('2026-11-18');
  });
});
