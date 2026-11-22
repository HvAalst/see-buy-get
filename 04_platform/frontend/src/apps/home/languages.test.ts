import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_LOCALES, hasLanguages, keepLanguage, localizeHrefs, pathIn, splitLocale, withSlash } from './sitePaths';
import { languageOf, pageOf, sitemapXml } from '../../../scripts/sitemap.mjs';

/*
 * 2026-11-18 — THE PUBLIC PAGES IN EACH LANGUAGE, AT THEIR OWN ADDRESS (the owner: "Is SBG optimized for GEO?"). The words
 * were there in Kiswahili, Dutch and Amharic, but drawn only in a browser that had chosen them; search engines and AI
 * assistants read English alone. Each page with its words in every language is now built at /sw/…, /nl/… and /am/… too,
 * says where its other languages are, and links within its own language. The terms, the data notice and the cookie
 * statement stay English: their text is staff's, in English.
 */
vi.mock('virtual:pwa-register/preact', () => ({
  useRegisterSW: () => ({ needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }),
}));

const SITE = 'https://seebuyget.example';
const hasFile = (path: string) => {
  try {
    return readFileSync(path, 'utf8').length > 0;
  } catch {
    return false;
  }
};
type Head = { type: string; props: Record<string, string> };

async function build(url: string) {
  vi.resetModules();
  vi.stubEnv('SBG_PUBLIC_URL', SITE);
  vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { prerender } = await import('./prerender');
  const built = await prerender({ url });
  const head = [...built.head.elements] as Head[];
  return {
    ...built,
    head,
    alternates: Object.fromEntries(head.filter((e) => e.props.rel === 'alternate').map((e) => [e.props.hreflang, e.props.href])),
    canonical: head.find((e) => e.props.rel === 'canonical')?.props.href,
    ogLocale: head.find((e) => e.props.property === 'og:locale')?.props.content,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as { __SBG_PRERENDER__?: unknown }).__SBG_PRERENDER__;
});

describe('a page’s address in each language', () => {
  it('English at the root, the others under their code', () => {
    expect(splitLocale('/sw/about/')).toEqual({ locale: 'sw', rest: '/about/' });
    expect(splitLocale('/am')).toEqual({ locale: 'am', rest: '/' });
    expect(splitLocale('/about/')).toEqual({ locale: 'en', rest: '/about/' });
    // Not a language: an address that only begins with the same letters.
    expect(splitLocale('/swahili/')).toEqual({ locale: 'en', rest: '/swahili/' });
    expect(pathIn('nl', '/help/contact/')).toBe('/nl/help/contact/');
    expect(pathIn('en', '/towns/nairobi/')).toBe('/towns/nairobi/');
    expect(withSlash('/about')).toBe('/about/');
  });

  it('every page but the three English texts and the apps is built in every language', () => {
    for (const p of ['/', '/about/', '/for/shops/', '/help/', '/help/parcel-problem/', '/help/contact/', '/towns/nairobi/', '/directory/', '/directory/ke/']) expect({ p, yes: hasLanguages(p) }).toEqual({ p, yes: true });
    for (const p of ['/terms/', '/privacy/', '/cookies/', '/send/', '/business/', '/@mama-pima']) expect({ p, yes: hasLanguages(p) }).toEqual({ p, yes: false });
  });

  it('links within its own language — never a page that is not built in it, never the language row', () => {
    const html = '<a href="/about/">A</a><a class="x" href="/?go=signin">S</a><a href="/#track">T</a><a href="/terms/">T</a><a href="/send/">S</a><a href="/about/" hreflang="en">English</a><a href="/sw/help/">H</a>';
    expect(localizeHrefs(html, 'sw')).toBe('<a href="/sw/about/">A</a><a class="x" href="/sw/?go=signin">S</a><a href="/sw/#track">T</a><a href="/terms/">T</a><a href="/send/">S</a><a href="/about/" hreflang="en">English</a><a href="/sw/help/">H</a>');
    expect(localizeHrefs(html, 'en')).toBe(html);
  });

  it('an address the app writes (a search) stays in the language of the bar', () => {
    expect(keepLanguage('/directory/?q=freight', '/am/directory/')).toBe('/am/directory/?q=freight');
    expect(keepLanguage('/directory/?q=freight', '/directory/')).toBe('/directory/?q=freight');
    expect(keepLanguage('/terms/', '/sw/about/')).toBe('/terms/');
  });

  it('every language a page is built in has the words those pages show', () => {
    for (const l of PAGE_LOCALES) for (const set of ['home', 'front', 'pages', 'help', 'directory']) expect({ l, set, here: hasFile(join('src/shared/i18n/words', l, `${set}.ts`)) }).toEqual({ l, set, here: true });
  });
});

describe('a page built in Kiswahili', () => {
  it('is in Kiswahili, at its own address, and says where its other languages are', async () => {
    // As the build's plugin names it: without the slash.
    const sw = await build('/sw/about');
    expect(sw.head[0]).toBeDefined();
    expect(sw.head.find((e) => e.props.property === 'og:title')?.props.content).toMatch(/kwa ufupi/);
    expect(sw.canonical).toBe(`${SITE}/sw/about/`);
    expect(sw.ogLocale).toBe('sw_KE');
    expect(sw.alternates).toEqual({ en: `${SITE}/about/`, sw: `${SITE}/sw/about/`, nl: `${SITE}/nl/about/`, am: `${SITE}/am/about/`, bg: `${SITE}/bg/about/`, 'x-default': `${SITE}/about/` });
    expect(sw.html).toContain('href="/sw/for/shops/"');
    // The language row names each language by its own name, at the same page.
    expect(sw.html).toMatch(/<a href="\/nl\/about\/" hreflang="nl" lang="nl"[^>]*>Nederlands<\/a>/);
    expect(sw.html).toMatch(/<a href="\/about\/" hreflang="en" lang="en"[^>]*>English<\/a>/);
  });

  it('the English page is unchanged in English, and says the same alternates', async () => {
    const en = await build('/about/');
    expect(en.head.find((e) => e.props.property === 'og:title')?.props.content).toMatch(/at a glance/);
    expect(en.canonical).toBe(`${SITE}/about/`);
    expect(en.ogLocale).toBe('en_GB');
    expect(en.alternates.sw).toBe(`${SITE}/sw/about/`);
    expect(en.html).toContain('href="/for/shops/"');
  });

  it('the terms stay English, with no other language claimed', async () => {
    const terms = await build('/terms/');
    expect(terms.alternates).toEqual({});
  });

  it('the English front page leads to each language’s front page; each leads to its own pages, never to the English texts', async () => {
    const en = await build('/');
    expect([...(en.links ?? [])]).toEqual(expect.arrayContaining(['/sw/', '/nl/', '/am/', '/terms/', '/about/']));
    const am = await build('/am/');
    const links = [...(am.links ?? [])];
    expect(links).toEqual(expect.arrayContaining(['/am/about/', '/am/help/', '/am/directory/', '/am/for/shops/']));
    expect(links.some((l) => l.includes('terms') || l === '/sw/')).toBe(false);
    expect(am.head.find((e) => e.props.property === 'og:locale')?.props.content).toBe('am_ET');
  });

  it('a help article says the language it is written in', async () => {
    const nl = await build('/nl/help/parcel-problem/');
    const ld = JSON.parse(nl.head.find((e) => e.props.type === 'application/ld+json')!.props.children) as Array<{ inLanguage?: string }>;
    expect(ld[0].inLanguage).toBe('nl');
  });
});

describe('the sitemap', () => {
  it('names each page’s other languages, English for any other reader', () => {
    const found = ['/', '/about/', '/sw/', '/sw/about/', '/terms/'];
    const dates = Object.fromEntries(found.map((p) => [p, { date: '2026-11-18' }]));
    const xml = sitemapXml(found, dates, SITE);
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain(`<url><loc>${SITE}/sw/about/</loc><lastmod>2026-11-18</lastmod><xhtml:link rel="alternate" hreflang="en" href="${SITE}/about/"/><xhtml:link rel="alternate" hreflang="sw" href="${SITE}/sw/about/"/><xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/about/"/></url>`);
    expect(xml).toContain(`<url><loc>${SITE}/terms/</loc><lastmod>2026-11-18</lastmod></url>`);
    expect([pageOf('/am/help/'), languageOf('/am/help/'), languageOf('/help/')]).toEqual(['/help/', 'am', 'en']);
  });
});
