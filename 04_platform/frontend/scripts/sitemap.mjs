/**
 * THE SITEMAP — every page the build made, each with the day its content last changed (page-dates.mjs) and, 2026-11-18,
 * the same page in its other languages (the owner: "Is SBG optimized for GEO?"): English at the root, Kiswahili, Dutch
 * and Amharic under /sw/, /nl/ and /am/; English is the one for any other reader (x-default).
 */
const LANG = /^\/(sw|nl|am)(\/.*)$/;

/** `/sw/about/` → `/about/`; `/about/` → itself. */
export const pageOf = (path) => LANG.exec(path)?.[2] ?? path;
/** `/sw/about/` → `sw`; `/about/` → `en`. */
export const languageOf = (path) => LANG.exec(path)?.[1] ?? 'en';

export function sitemapXml(found, dates, site) {
  const versions = new Map();
  for (const p of found) versions.set(pageOf(p), [...(versions.get(pageOf(p)) ?? []), p]);
  const urls = found.map((p) => {
    const same = versions.get(pageOf(p)) ?? [p];
    const english = same.find((q) => languageOf(q) === 'en');
    const links =
      same.length > 1
        ? [...same.map((q) => `<xhtml:link rel="alternate" hreflang="${languageOf(q)}" href="${site}${q}"/>`), ...(english ? [`<xhtml:link rel="alternate" hreflang="x-default" href="${site}${english}"/>`] : [])].join('')
        : '';
    return `  <url><loc>${site}${p}</loc><lastmod>${dates[p]?.date}</lastmod>${p === '/' ? '<priority>1.0</priority>' : ''}${links}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}
