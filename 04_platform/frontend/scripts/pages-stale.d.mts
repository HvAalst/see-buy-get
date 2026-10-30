/** The comparisons of pages-stale.mjs, for its tests. */
export function builtData(html: string): { towns?: unknown[]; documents?: Record<string, { number?: number }>; directory?: { index?: { countries: unknown[] }; country?: { country: string; entries: unknown[] } } } | null;
export function townsKey(towns: unknown): string;
export function entriesKey(entries: unknown): string;
export function countriesKey(countries: unknown): string;
