/** When a page last changed, for the sitemap (page-dates.mjs). */
export type PageDates = Record<string, { hash: string; date: string }>;
export function pageHash(html: string): string;
export function datesFor(hashes: Record<string, string>, previous: unknown, today: string): PageDates;
export function publishedDates(site: string): Promise<unknown>;
