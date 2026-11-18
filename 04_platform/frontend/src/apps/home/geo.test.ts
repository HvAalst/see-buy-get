import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCountriesOf } from './pages';
import { datesFor, pageHash } from '../../../scripts/page-dates.mjs';
import { openKey, pricesKey } from '../../../scripts/pages-stale.mjs';
import { townLine } from '../../../scripts/llms-lines.mjs';

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

/*
 * 2026-11-18 — WHAT IT COSTS FROM A TOWN, ON ITS PAGE (the owner: example prices per country, "yes"): a real table on the
 * page, offers in what a machine reads, each town page carrying only its own prices, a changed price card rebuilding the
 * pages at night, and llms.txt saying a small parcel's lowest prices.
 */
describe('what it costs from a town', () => {
  const TOWNS = [
    { town: 'Nairobi', slug: 'nairobi', country: 'KE', shops: [{ shopName: 'Mama Pima', landmark: 'By the market', openState: 'open' }] },
    { town: 'Mombasa', slug: 'mombasa', country: 'KE', shops: [{ shopName: 'Pwani Duka', landmark: 'Old town', openState: 'open' }] },
  ];
  const PRICES = [
    { slug: 'nairobi', town: 'Nairobi', country: 'KE', currency: 'KES', to: [{ slug: 'nairobi', town: 'Nairobi', from: { S: 150, M: 300, L: 450 } }, { slug: 'mombasa', town: 'Mombasa', from: { S: 300, M: 600 } }] },
  ];
  async function town(slug: string) {
    vi.resetModules();
    vi.stubEnv('SBG_PUBLIC_URL', SITE);
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.endsWith('/v1/sbg/network/towns')) return new Response(JSON.stringify({ items: TOWNS }), { status: 200 });
      if (u.endsWith('/v1/sbg/network/prices')) return new Response(JSON.stringify({ items: PRICES }), { status: 200 });
      return new Response('', { status: 503 });
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { prerender } = await import('./prerender');
    return prerender({ url: `/towns/${slug}/` });
  }

  it('shows a table on the town’s page: within the town and to the busiest towns, the lowest price per size', async () => {
    const built = await town('nairobi');
    expect(built.html).toContain('What it costs to send from Nairobi');
    expect(built.html).toMatch(/<table class="town__table">/);
    expect(built.html).toContain('Within Nairobi');
    expect(built.html).toMatch(/Mombasa<\/th><td class="town__n">KES[\s ]300<\/td><td class="town__n">KES[\s ]600<\/td><td class="town__n">–<\/td>/);
    // Only its own prices ride along with the page.
    expect(built.data.prices?.slug).toBe('nairobi');
  });

  it('says them as offers a machine reads: each size to each town, from its lowest price', async () => {
    const built = await town('nairobi');
    const ld = JSON.parse([...built.head.elements].find((e: Head) => e.props.type === 'application/ld+json')!.props.children) as Array<Record<string, unknown>>;
    const catalog = ld.find((x) => x['@type'] === 'OfferCatalog') as { itemListElement: Array<{ name: string; priceSpecification: { minPrice: number; priceCurrency: string } }> };
    expect(catalog.itemListElement).toHaveLength(5);
    expect(catalog.itemListElement[3]).toMatchObject({ name: 'Small parcel from Nairobi to Mombasa', priceSpecification: { minPrice: 300, priceCurrency: 'KES' } });
  });

  it('never shows one town’s prices on another’s page', async () => {
    vi.resetModules();
    const { renderToString } = await import('preact-render-to-string');
    const { h } = await import('preact');
    await import('./prerenderEnglish');
    const { TownPricesTable } = await import('./screens/TownScreen');
    const mombasa = { ...TOWNS[1], shops: [] } as never;
    expect(renderToString(h(TownPricesTable, { page: mombasa, prices: PRICES[0] as never }))).toBe('');
    expect(renderToString(h(TownPricesTable, { page: { ...TOWNS[0], shops: [] } as never, prices: PRICES[0] as never }))).toContain('Within Nairobi');
  });

  it('a town with no prices (no company of ours sells there) shows no table and no offers', async () => {
    const built = await town('mombasa');
    expect(built.html).not.toContain('What it costs to send from');
    expect(built.data.prices).toBeUndefined();
    expect(JSON.stringify([...built.head.elements])).not.toContain('OfferCatalog');
  });

  it('a changed price rebuilds the pages at night; llms.txt says a small parcel’s lowest prices', () => {
    expect(pricesKey(PRICES[0])).toBe(pricesKey(JSON.parse(JSON.stringify(PRICES[0]))));
    // The same towns, one price changed: a difference.
    const changed = JSON.parse(JSON.stringify(PRICES[0])) as (typeof PRICES)[0];
    changed.to[1].from.S = 320;
    expect(pricesKey(changed)).not.toBe(pricesKey(PRICES[0]));
    expect(pricesKey(null)).toBe('');
    expect(townLine('Nairobi', `${SITE}/towns/nairobi/`, PRICES[0])).toBe(`- [Nairobi](${SITE}/towns/nairobi/): a small parcel within Nairobi from KES 150, to Mombasa from KES 300`);
    expect(townLine('Mombasa', `${SITE}/towns/mombasa/`, null)).toBe(`- [Mombasa](${SITE}/towns/mombasa/)`);
  });
});
