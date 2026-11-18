/** The sitemap, with each page's other languages (sitemap.mjs). */
export function pageOf(path: string): string;
export function languageOf(path: string): string;
export function sitemapXml(found: string[], dates: Record<string, { date: string }>, site: string): string;
