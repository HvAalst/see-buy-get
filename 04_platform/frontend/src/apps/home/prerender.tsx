import { renderToString } from 'preact-render-to-string';
import { App } from './app';
import { t } from '../../shared/i18n';
import { FAQ } from './screens/WelcomeScreen';
import type { TownPage } from './api';
import { townSlugFromPath } from './prerendered';
import { CONTACT_PATH, HELP_PATH, articlePath, helpPageOf } from './help';
import { ABOUT_PATH, AUDIENCES, NOTICES, forPath, infoPageOf, noticeKey, pageKey, range, type InfoPage } from './pages';
import { GUIDE_APPS, articleById, articles, type PublicApp } from '../../shared/guide/articles';

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

export async function prerender(data: { url: string }): Promise<{
  html: string;
  links?: Set<string>;
  data: { towns: TownPage[] };
  head: { lang: string; title: string; elements: Set<HeadElement> };
}> {
  const towns = await loadTowns();
  const url = data.url || '/';
  (globalThis as { __SBG_PRERENDER__?: unknown }).__SBG_PRERENDER__ = { url, towns };
  const html = renderToString(<App />);

  const slug = townSlugFromPath(url);
  const town = slug ? towns.find((p) => p.slug === slug) : undefined;
  const help = helpPageOf(url);
  const info = infoPageOf(url);
  const head = town ? townHead(town) : help ? helpHead(help) : info ? infoHead(info) : frontHead();
  return {
    html,
    // From the front page, every town page and the help — and from the help, every article and writing to us. The
    // plugin renders each of them in turn.
    ...(url === '/' ? { links: new Set([...towns.map((p) => `/towns/${p.slug}`), HELP_PATH, ABOUT_PATH, ...AUDIENCES.map((a) => forPath(a.who)), NOTICES.privacy.path, NOTICES.cookies.path]) } : {}),
    ...(help?.kind === 'index' ? { links: new Set([...articles().map((a) => articlePath(a.id)), CONTACT_PATH]) } : {}),
    data: { towns },
    head: { lang: 'en', ...head },
  };
}

const meta = (props: Record<string, string>): HeadElement => ({ type: 'meta', props });
const ldScript = (ld: unknown): HeadElement => ({ type: 'script', props: { type: 'application/ld+json', children: JSON.stringify(ld) } });

/** What every page says about itself, plus the absolute addresses when the site's own address is known. */
function common(title: string, description: string, path: string): HeadElement[] {
  return [
    meta({ name: 'description', content: description }),
    meta({ property: 'og:type', content: 'website' }),
    meta({ property: 'og:site_name', content: 'SeeBuyGet' }),
    meta({ property: 'og:title', content: title }),
    meta({ property: 'og:description', content: description }),
    meta({ name: 'twitter:card', content: 'summary' }),
    ...(SITE
      ? [
          { type: 'link', props: { rel: 'canonical', href: `${SITE}${path}` } },
          meta({ property: 'og:url', content: `${SITE}${path}` }),
          meta({ property: 'og:image', content: `${SITE}/icons/icon-512.png` }),
        ]
      : []),
  ];
}

function frontHead(): { title: string; elements: Set<HeadElement> } {
  const title = t('home.landing.metaTitle');
  const description = t('home.landing.metaDescription');
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'SeeBuyGet',
      ...(SITE ? { url: `${SITE}/`, logo: `${SITE}/icons/icon-512.png` } : {}),
      description,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: t('home.landing.serviceName'),
      serviceType: t('home.landing.serviceType'),
      provider: { '@type': 'Organization', name: 'SeeBuyGet' },
      description: t('home.welcome.lede'),
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
    const a = articleById(page.id);
    if (!a) return frontHead();
    const path = articlePath(a.id);
    const title = t('help.ui.articleMetaTitle', { title: a.title });
    const apps = a.apps.filter((x): x is PublicApp => x !== 'console').map((x) => t(GUIDE_APPS[x]));
    const ld = a.steps?.length
      ? { '@context': 'https://schema.org', '@type': 'HowTo', name: a.title, description: a.summary, inLanguage: 'en', ...(apps.length ? { tool: apps.map((name) => ({ '@type': 'HowToTool', name })) } : {}), step: a.steps.map((text, i) => ({ '@type': 'HowToStep', position: i + 1, text })) }
      : { '@context': 'https://schema.org', '@type': 'Article', headline: a.title, description: a.summary, inLanguage: 'en' };
    return { title, elements: new Set([...common(title, a.summary, path), ldScript([ld, crumbs({ name: a.title, path })])]) };
  }
  const title = t('help.ui.metaTitle');
  return { title, elements: new Set([...common(title, t('help.ui.metaDescription'), HELP_PATH), ldScript([crumbs()])]) };
}

/** A town page: its shops as an ItemList of stores, each with its map position and public page where it has one. */
function townHead(town: TownPage): { title: string; elements: Set<HeadElement> } {
  const title = t('home.town.metaTitle', { town: town.town });
  const description = t('home.town.metaDescription', { town: town.town, n: town.shops.length });
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
  return { title, elements: new Set([...common(title, description, `/towns/${town.slug}/`), ldScript(ld)]) };
}
