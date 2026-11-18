import './prerenderEnglish';
import { renderToString } from 'preact-render-to-string';
import { App } from './app';
import { loadDirectoryPage, loadHelpPage } from './lazyScreens';
import { DIRECTORY_PATH, directoryCountryPath, directoryPageOf, type DirectoryBuilt, type DirectoryCountryView, type DirectoryIndex, type DirectoryPage } from './directory';
import { countryNameIn } from '../../shared/documents/documents';
import { setLocale, t, wordsReady } from '../../shared/i18n';
import { ALL_PAGE_LOCALES, OG_LOCALE, PAGE_LOCALES, hasLanguages, localizeHrefs, pathIn, splitLocale, type PageLocale } from './sitePaths';
import { FAQ } from './screens/WelcomeScreen';
import { TOWN_PRICE_SIZES, type TownPage, type TownPrices } from './api';

const TOWN_SIZE_WORD = { S: 'home.town.small', M: 'home.town.medium', L: 'home.town.large' } as const;
import type { PublishedDocument } from '../../shared/documents/documents';
import { townSlugFromPath } from './prerendered';
import { CONTACT_PATH, HELP_PATH, articlePath, helpPageOf } from './help';
import { ABOUT_PATH, AUDIENCES, NOTICES, forPath, infoPageOf, noticeKey, openCountriesOf, pageKey, range, type InfoPage, type Notice, type OpenCountry } from './pages';
import { GUIDE_APPS, siteArticleById, siteArticles, type PublicApp } from '../../shared/guide/articles';

type HeadElement = { type: string; props: Record<string, string> };

/**
 * THE FRONT PAGE, AND A PAGE PER TOWN, AS FINISHED HTML — rendered at build time, then taken over in the browser.
 *
 * Most AI crawlers (and some search crawlers) do not run a page's script: they read the HTML the server sends, and
 * to them a page that draws itself in the browser is an empty <div>. So the build renders the front page and one
 * page per town that has trading shops (`/towns/<slug>`), and adds what a machine reads about each: a title and a
 * description for the result, the address it should be known by, a preview for a shared link, and structured data
 * (who we are and what we do; the questions and answers; the shops in a town).
 *
 * The towns are fetched ONCE from the API the build is pointed at (`VITE_SBG_API`, else the sandbox's own). A build
 * that cannot reach it still renders the front page — with no town pages and no town links, which is true of what
 * it knew rather than a broken page. The same data goes into the page (`prerender-data`) so the browser's first
 * frame matches the HTML exactly before it fetches fresh figures.
 *
 * `SBG_PUBLIC_URL` is the site's own address (e.g. https://seebuyget.com); without it the pages are still rendered,
 * just without the absolute addresses (canonical, preview image) that need one.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SITE = (env.SBG_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
const API = (env.VITE_SBG_API ?? 'http://localhost:3000').trim().replace(/\/+$/, '');

let townsOnce: Promise<TownPage[]> | null = null;
function loadTowns(): Promise<TownPage[]> {
  townsOnce ??= fetch(`${API}/v1/sbg/network/towns`, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? (r.json() as Promise<{ items?: TownPage[] }>) : { items: [] }))
    .then((d) => (Array.isArray(d.items) ? d.items : []))
    .catch(() => {
      console.warn(`[prerender] could not reach ${API} for the town pages — building the front page without them`);
      return [];
    });
  return townsOnce;
}

/**
 * The terms of use, the data notice and the cookie statement as published now — fetched ONCE, like the towns, so their
 * pages are built with the words in them. A build that cannot reach the server builds them empty: the browser fetches.
 */
let documentsOnce: Promise<Partial<Record<Notice, PublishedDocument>>> | null = null;
function loadDocuments(): Promise<Partial<Record<Notice, PublishedDocument>>> {
  documentsOnce ??= Promise.all(
    (Object.keys(NOTICES) as Notice[]).map((which) =>
      fetch(`${API}/v1/sbg/documents/${which}`, { signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? (r.json() as Promise<PublishedDocument>) : null))
        .catch(() => null)
        .then((doc) => [which, doc] as const),
    ),
  ).then((pairs) => {
    const found = Object.fromEntries(pairs.filter(([, doc]) => doc)) as Partial<Record<Notice, PublishedDocument>>;
    if (Object.keys(found).length < pairs.length) console.warn(`[prerender] could not read every document from ${API} — their pages fetch them in the browser`);
    return found;
  });
  return documentsOnce;
}

/**
 * THE LOGISTICS DIRECTORY as the server has it — its countries read ONCE, and each country's firms when its page is built.
 * A build that cannot reach the server builds the directory's front page empty and no country pages: the browser fetches.
 */
let directoryOnce: Promise<DirectoryIndex | null> | null = null;
function loadDirectory(): Promise<DirectoryIndex | null> {
  directoryOnce ??= fetch(`${API}/v1/sbg/directory`, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? (r.json() as Promise<DirectoryIndex>) : null))
    .then((d) => (d && Array.isArray(d.countries) ? d : null))
    .catch(() => {
      console.warn(`[prerender] could not reach ${API} for the directory — building its page without countries`);
      return null;
    });
  return directoryOnce;
}
function loadDirectoryCountry(country: string): Promise<DirectoryCountryView | null> {
  return fetch(`${API}/v1/sbg/directory/${country}`, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? (r.json() as Promise<DirectoryCountryView>) : null))
    .then((d) => (d && Array.isArray(d.entries) ? d : null))
    .catch(() => null);
}

/**
 * 2026-11-18 — WHERE SEEBUYGET RUNS (the owner: "Is SBG optimized for GEO?"): the countries open to everyone, read ONCE from
 * the server's own list, for what a machine reads about who we are. A build that cannot reach it names no country.
 */
let openOnce: Promise<OpenCountry[]> | null = null;
function loadOpenCountries(): Promise<OpenCountry[]> {
  openOnce ??= fetch(`${API}/v1/sbg/countries`, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : []))
    .then(openCountriesOf)
    .catch(() => {
      console.warn(`[prerender] could not reach ${API} for the countries — building without where SeeBuyGet runs`);
      return [];
    });
  return openOnce;
}

/**
 * 2026-11-18 — WHAT IT COSTS FROM EACH TOWN (the owner: example prices per country, "yes"), read ONCE; each town page carries
 * only its own. A build that cannot reach the server builds the town pages without prices: the browser fetches them.
 */
let pricesOnce: Promise<TownPrices[]> | null = null;
function loadTownPrices(): Promise<TownPrices[]> {
  pricesOnce ??= fetch(`${API}/v1/sbg/network/prices`, { signal: AbortSignal.timeout(20_000) })
    .then((r) => (r.ok ? (r.json() as Promise<{ items?: TownPrices[] }>) : { items: [] }))
    .then((d) => (Array.isArray(d.items) ? d.items : []))
    .catch(() => {
      console.warn(`[prerender] could not reach ${API} for the town prices — building the town pages without them`);
      return [];
    });
  return pricesOnce;
}

export async function prerender(data: { url: string }): Promise<{
  html: string;
  links?: Set<string>;
  data: { towns: TownPage[]; documents: Partial<Record<Notice, PublishedDocument>>; directory?: DirectoryBuilt; openCountries: OpenCountry[]; prices?: TownPrices };
  head: { lang: string; title: string; elements: Set<HeadElement> };
}> {
  const towns = await loadTowns();
  const documents = await loadDocuments();
  const openCountries = await loadOpenCountries();
  // The help page's code is fetched on demand in the browser (lazyScreens.ts); here it is brought in before rendering.
  await loadHelpPage();
  const url = data.url || '/';
  // 2026-11-18 — the language is the address's (/sw/about/ is the About page in Kiswahili); `rest` is the page.
  const { locale, rest } = splitLocale(url);
  // A directory page: its code and words first (lazyScreens.ts), and what the server lists for it.
  const dirPage = directoryPageOf(rest);
  if (dirPage) await loadDirectoryPage();
  // Every word the page shows, in its language, before it is drawn: the plugin builds one page at a time.
  BUILD_LOCALE = locale;
  setLocale(locale);
  await wordsReady(locale);
  const index = dirPage?.kind === 'index' || rest === '/' ? await loadDirectory() : null;
  const countryView = dirPage?.kind === 'country' ? await loadDirectoryCountry(dirPage.country) : null;
  const directory: DirectoryBuilt | undefined = dirPage ? { ...(index ? { index } : {}), ...(countryView ? { country: countryView } : {}) } : undefined;
  const slug = townSlugFromPath(rest);
  const town = slug ? towns.find((p) => p.slug === slug) : undefined;
  // A town page carries its own prices, and only those.
  const prices = town ? (await loadTownPrices()).find((p) => p.slug === town.slug) : undefined;
  (globalThis as { __SBG_PRERENDER__?: unknown }).__SBG_PRERENDER__ = { url, towns, documents, ...(directory ? { directory } : {}), ...(prices ? { prices } : {}) };
  // A page in another language links to the same language.
  const html = localizeHrefs(renderToString(<App />), locale);

  const help = helpPageOf(rest);
  const info = infoPageOf(rest);
  const head = town ? townHead(town, prices) : help ? helpHead(help) : info ? infoHead(info) : dirPage ? directoryHead(dirPage, directory ?? {}) : frontHead(openCountries);
  const L = (p: string) => pathIn(locale, p);
  return {
    html,
    // From the front page, every town page and the help — and from the help, every article and writing to us. The
    // plugin renders each of them in turn. From the English front page, also the front page in each other language, and
    // from that, the same pages in its language (never the terms, the data notice or the cookies: English only).
    ...(rest === '/'
      ? {
          links: new Set([
            ...towns.map((p) => L(`/towns/${p.slug}`)),
            L(HELP_PATH),
            L(ABOUT_PATH),
            L(DIRECTORY_PATH),
            ...AUDIENCES.map((a) => L(forPath(a.who))),
            ...(locale === 'en' ? [NOTICES.terms.path, NOTICES.privacy.path, NOTICES.cookies.path, ...PAGE_LOCALES.map((l) => pathIn(l, '/'))] : []),
          ]),
        }
      : {}),
    ...(help?.kind === 'index' ? { links: new Set([...siteArticles().map((a) => L(articlePath(a.id))), L(CONTACT_PATH)]) } : {}),
    // From the directory, a page per country that has firms listed.
    ...(dirPage?.kind === 'index' && index ? { links: new Set(index.countries.map((c) => L(directoryCountryPath(c.country)))) } : {}),
    // Where it runs rides along, so the nightly check (scripts/pages-stale.mjs) sees a country opened since the build.
    data: { towns, documents, ...(directory ? { directory } : {}), openCountries, ...(prices ? { prices } : {}) },
    head: { lang: locale, ...head },
  };
}

/** The language the page being built is in: set at the start of each page (the plugin builds one at a time). */
let BUILD_LOCALE: PageLocale = 'en';

const meta = (props: Record<string, string>): HeadElement => ({ type: 'meta', props });
const ldScript = (ld: unknown): HeadElement => ({ type: 'script', props: { type: 'application/ld+json', children: JSON.stringify(ld) } });

/**
 * THE PICTURE A SHARED LINK SHOWS (the owner, 2026-11-01: a link to SeeBuyGet sent in WhatsApp, Telegram, WeChat, VK or
 * Viber should open as a card with a big picture, the title and a line). 1200 × 630, the shape every one of them shows
 * whole, and under WhatsApp's 300 KB, above which it shows no picture at all: the logo, the front page's promise in
 * letters big enough to read in a chat, and the counter from the front page's own drawing. Made once from the brand's
 * files (public/img/share-card.png); its size is said with it, so a messenger can lay the card out before it has the
 * picture. Only with the site's own address: a messenger fetches the picture by its full address, never a path.
 */
export const SHARE_IMAGE = { path: '/img/share-card.png', width: 1200, height: 630, type: 'image/png' } as const;

/**
 * What every page says about itself, plus the absolute addresses when the site's own address is known. `path` is the page
 * without a language; its own address is in the language being built. 2026-11-18 — a page built in every language says
 * where each of them is (hreflang), English being the one for any other reader (x-default).
 */
function common(title: string, description: string, path: string): HeadElement[] {
  const here = pathIn(BUILD_LOCALE, path);
  const versions = hasLanguages(path);
  return [
    meta({ name: 'description', content: description }),
    meta({ property: 'og:type', content: 'website' }),
    meta({ property: 'og:site_name', content: 'SeeBuyGet' }),
    meta({ property: 'og:title', content: title }),
    meta({ property: 'og:description', content: description }),
    // The pages are written in British English, and in Kiswahili, Dutch and Amharic; Open Graph names a language with a country.
    meta({ property: 'og:locale', content: OG_LOCALE[BUILD_LOCALE] }),
    ...(versions ? ALL_PAGE_LOCALES.filter((l) => l !== BUILD_LOCALE).map((l) => meta({ property: 'og:locale:alternate', content: OG_LOCALE[l] })) : []),
    // A large picture only where there is one to show; without the site's address there is none.
    meta({ name: 'twitter:card', content: SITE ? 'summary_large_image' : 'summary' }),
    ...(SITE
      ? [
          { type: 'link', props: { rel: 'canonical', href: `${SITE}${here}` } },
          ...(versions
            ? [
                ...ALL_PAGE_LOCALES.map((l) => ({ type: 'link', props: { rel: 'alternate', hreflang: l, href: `${SITE}${pathIn(l, path)}` } })),
                { type: 'link', props: { rel: 'alternate', hreflang: 'x-default', href: `${SITE}${path}` } },
              ]
            : []),
          meta({ property: 'og:url', content: `${SITE}${here}` }),
          meta({ property: 'og:image', content: `${SITE}${SHARE_IMAGE.path}` }),
          meta({ property: 'og:image:type', content: SHARE_IMAGE.type }),
          meta({ property: 'og:image:width', content: String(SHARE_IMAGE.width) }),
          meta({ property: 'og:image:height', content: String(SHARE_IMAGE.height) }),
          meta({ property: 'og:image:alt', content: t('home.landing.shareImageAlt') }),
        ]
      : []),
  ];
}

function frontHead(open: OpenCountry[] = []): { title: string; elements: Set<HeadElement> } {
  const title = t('home.landing.metaTitle');
  const description = t('home.landing.metaDescription');
  // 2026-11-18 — where it runs, and where to reach us: the countries open to everyone, and the help's own contact page —
  // never a typed number or address (each country sets its own office, and a hub's contact is public only if ticked).
  const areaServed = open.length ? { areaServed: open.map((c) => ({ '@type': 'Country', name: BUILD_LOCALE === 'en' ? c.name : countryNameIn(c.country, BUILD_LOCALE) || c.name, identifier: c.country })) } : {};
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'SeeBuyGet',
      ...(SITE ? { url: `${SITE}/`, logo: `${SITE}/icons/icon-512.png` } : {}),
      description,
      ...areaServed,
      ...(SITE ? { contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', url: `${SITE}${CONTACT_PATH}` } } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: t('home.landing.serviceName'),
      serviceType: t('home.landing.serviceType'),
      provider: { '@type': 'Organization', name: 'SeeBuyGet' },
      description: t('home.welcome.lede'),
      ...areaServed,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: t(q), acceptedAnswer: { '@type': 'Answer', text: t(a) } })),
    },
  ];
  return { title, elements: new Set([...common(title, description, '/'), ldScript(ld)]) };
}

/** SeeBuyGet at a glance, or a page for one reader: what it is, and the questions as a FAQPage a machine can read. */
function infoHead(page: InfoPage): { title: string; elements: Set<HeadElement> } {
  const crumb = (name: string, path: string) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'SeeBuyGet', ...(SITE ? { item: `${SITE}/` } : {}) },
      { '@type': 'ListItem', position: 2, name, ...(SITE ? { item: `${SITE}${path}` } : {}) },
    ],
  });
  if (page.kind === 'about') {
    const title = t('pages.about.metaTitle');
    const description = t('pages.about.metaDescription');
    const ld = [
      { '@context': 'https://schema.org', '@type': 'AboutPage', name: t('pages.about.title'), description, about: { '@type': 'Organization', name: 'SeeBuyGet', ...(SITE ? { url: `${SITE}/` } : {}) } },
      crumb(t('pages.about.title'), ABOUT_PATH),
    ];
    return { title, elements: new Set([...common(title, description, ABOUT_PATH), ldScript(ld)]) };
  }
  if (page.kind === 'notice') {
    const k = (part: string) => t(noticeKey(page.which, part));
    const path = NOTICES[page.which].path;
    const title = k('metaTitle');
    const description = k('metaDescription');
    const ld = [{ '@context': 'https://schema.org', '@type': 'WebPage', name: k('title'), description, about: { '@type': 'Organization', name: 'SeeBuyGet' } }, crumb(k('title'), path)];
    return { title, elements: new Set([...common(title, description, path), ldScript(ld)]) };
  }
  const spec = AUDIENCES.find((a) => a.who === page.who)!;
  const k = (part: string) => t(pageKey(page.who, part));
  const path = forPath(page.who);
  const title = k('metaTitle');
  const description = k('metaDescription');
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: k('title'), description, about: { '@type': 'Organization', name: 'SeeBuyGet' } },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: range(spec.questions).map((i) => ({ '@type': 'Question', name: k(`q${i}`), acceptedAnswer: { '@type': 'Answer', text: k(`a${i}`) } })) },
    crumb(k('title'), path),
  ];
  return { title, elements: new Set([...common(title, description, path), ldScript(ld)]) };
}

/** A help page: the index, one article (its steps as a HowTo a machine can read), or writing to us. */
function helpHead(page: NonNullable<ReturnType<typeof helpPageOf>>): { title: string; elements: Set<HeadElement> } {
  const crumbs = (last?: { name: string; path: string }) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'SeeBuyGet', ...(SITE ? { item: `${SITE}/` } : {}) },
      { '@type': 'ListItem', position: 2, name: t('help.ui.title'), ...(SITE ? { item: `${SITE}${HELP_PATH}` } : {}) },
      ...(last ? [{ '@type': 'ListItem', position: 3, name: last.name, ...(SITE ? { item: `${SITE}${last.path}` } : {}) }] : []),
    ],
  });
  if (page.kind === 'contact') {
    const title = t('help.ui.contactMetaTitle');
    return { title, elements: new Set([...common(title, t('help.ui.contactMetaDescription'), CONTACT_PATH), ldScript([crumbs({ name: t('help.contact.title'), path: CONTACT_PATH })])]) };
  }
  if (page.kind === 'article') {
    const a = siteArticleById(page.id);
    if (!a) return frontHead();
    const path = articlePath(a.id);
    const title = t('help.ui.articleMetaTitle', { title: a.title });
    const apps = a.apps.filter((x): x is PublicApp => x !== 'console').map((x) => t(GUIDE_APPS[x]));
    const ld = a.steps?.length
      ? { '@context': 'https://schema.org', '@type': 'HowTo', name: a.title, description: a.summary, inLanguage: BUILD_LOCALE, ...(apps.length ? { tool: apps.map((name) => ({ '@type': 'HowToTool', name })) } : {}), step: a.steps.map((text, i) => ({ '@type': 'HowToStep', position: i + 1, text })) }
      : { '@context': 'https://schema.org', '@type': 'Article', headline: a.title, description: a.summary, inLanguage: BUILD_LOCALE };
    return { title, elements: new Set([...common(title, a.summary, path), ldScript([ld, crumbs({ name: a.title, path })])]) };
  }
  const title = t('help.ui.metaTitle');
  return { title, elements: new Set([...common(title, t('help.ui.metaDescription'), HELP_PATH), ldScript([crumbs()])]) };
}

/** A town page: its shops as an ItemList of stores, each with its map position and public page where it has one. */
function townHead(town: TownPage, prices?: TownPrices): { title: string; elements: Set<HeadElement> } {
  const title = t('home.town.metaTitle', { town: town.town });
  const description = t('home.town.metaDescription', { town: town.town, n: town.shops.length });
  // 2026-11-18 — what it costs from here, as offers a machine reads: each size to each town, its lowest price ("from").
  const offers = prices?.to.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'OfferCatalog',
        name: t('home.town.pricesTitle', { town: town.town }),
        itemListElement: prices.to.flatMap((row) =>
          TOWN_PRICE_SIZES.filter((s) => row.from[s] !== undefined).map((s) => ({
            '@type': 'Offer',
            name: t('home.town.offerName', { size: t(TOWN_SIZE_WORD[s]), from: town.town, to: row.town }),
            priceSpecification: { '@type': 'PriceSpecification', minPrice: row.from[s], priceCurrency: prices.currency },
            itemOffered: { '@type': 'Service', name: t('home.landing.serviceName'), areaServed: [{ '@type': 'City', name: town.town }, { '@type': 'City', name: row.town }] },
          })),
        ),
      }
    : null;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: t('home.town.title', { town: town.town }),
    itemListElement: town.shops.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Store',
        name: s.shopName,
        address: { '@type': 'PostalAddress', addressLocality: town.town, addressCountry: town.country, streetAddress: s.landmark },
        ...(s.location ? { geo: { '@type': 'GeoCoordinates', latitude: s.location.lat, longitude: s.location.lng } } : {}),
        ...(SITE && s.handle ? { url: `${SITE}/@${s.handle}` } : {}),
        ...(s.rating ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: s.rating.average, ratingCount: s.rating.count, bestRating: 5 } } : {}),
      },
    })),
  };
  // With the trailing slash: a static host serves this page from /towns/<slug>/index.html, at that address.
  return { title, elements: new Set([...common(title, description, `/towns/${town.slug}/`), ldScript(offers ? [ld, offers] : ld)]) };
}

/**
 * The directory: its front page as a collection, a country's page as a list of the organisations on it, each by its
 * public page. Their own words are left out of what a machine reads: on the page they are marked as theirs, and a
 * machine that quotes the data would lose that mark.
 */
function directoryHead(page: DirectoryPage, built: DirectoryBuilt): { title: string; elements: Set<HeadElement> } {
  const crumbs = (last?: { name: string; path: string }) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'SeeBuyGet', ...(SITE ? { item: `${SITE}/` } : {}) },
      { '@type': 'ListItem', position: 2, name: t('directory.title'), ...(SITE ? { item: `${SITE}${DIRECTORY_PATH}` } : {}) },
      ...(last ? [{ '@type': 'ListItem', position: 3, name: last.name, ...(SITE ? { item: `${SITE}${last.path}` } : {}) }] : []),
    ],
  });
  if (page.kind === 'index') {
    const title = t('directory.metaTitle');
    const description = t('directory.metaDescription');
    const ld = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: t('directory.title'), description, about: { '@type': 'Organization', name: 'SeeBuyGet' } }, crumbs()];
    return { title, elements: new Set([...common(title, description, DIRECTORY_PATH), ldScript(ld)]) };
  }
  const view = built.country;
  const name = countryNameIn(page.country, BUILD_LOCALE) || view?.name || page.country;
  const path = directoryCountryPath(page.country);
  const entries = view?.entries ?? [];
  const title = t('directory.countryMetaTitle', { country: name });
  const description = t('directory.countryMetaDescription', { country: name, n: entries.length });
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: t('directory.countryTitle', { country: name }),
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      itemListElement: entries.map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: { '@type': 'Organization', name: e.name, address: { '@type': 'PostalAddress', addressCountry: e.country }, ...(SITE ? { url: `${SITE}/@${e.handle}` } : {}) },
      })),
    },
    crumbs({ name, path }),
  ];
  return { title, elements: new Set([...common(title, description, path), ldScript(ld)]) };
}
