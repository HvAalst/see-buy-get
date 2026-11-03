import { placeholdersOf } from '../../shared/i18n';

/*
 * 2026-11-03 — THE LANGUAGES REVIEW SHEET (the owner: "write the translation in and write a separate review sheet that lives
 * in 'languages' where a review can be edited as version 2. the first version is not lost. languages are reviewed per country
 * sbg company").
 *
 * Every phrase of the apps, one row each: its English, version 1 as written into the apps, and the country's version 2 — its
 * own words, or version 1 kept as it is. A row is found by its key or by any of its words. Version 2 is checked before it is
 * saved: it keeps every placeholder and counted word of the English, or the screen it is on would show a gap.
 */

export interface WordReviewRow {
  key: string;
  text?: string;
  kept?: boolean;
  by: string;
  at: string;
  history: Array<{ text?: string; kept?: boolean; by: string; at: string }>;
}

export type LanguageFilter = 'all' | 'open' | 'reviewed' | 'own';

export interface LanguageRow {
  key: string;
  english: string;
  /** Version 1, as written into the apps; absent where nothing was written for it yet (the app says the English). */
  v1?: string;
  /** The country's version 2. */
  review?: WordReviewRow;
}

const fold = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Every phrase there is English for, with its two versions — in the order of their keys. */
export function languageRows(english: Record<string, string>, v1: Record<string, string>, reviews: readonly WordReviewRow[]): LanguageRow[] {
  const byKey = new Map(reviews.map((r) => [r.key, r]));
  return Object.keys(english)
    .sort()
    .map((key) => ({ key, english: english[key], ...(v1[key] !== undefined ? { v1: v1[key] } : {}), ...(byKey.has(key) ? { review: byKey.get(key) } : {}) }));
}

/** The rows a filter and a search leave: `open` not yet reviewed, `reviewed` either way, `own` said in the country's own words. */
export function visibleRows(rows: readonly LanguageRow[], filter: LanguageFilter, query: string): LanguageRow[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (filter === 'open' && r.review) return false;
    if (filter === 'reviewed' && !r.review) return false;
    if (filter === 'own' && !r.review?.text) return false;
    if (!words.length) return true;
    const hay = fold([r.key, r.english, r.v1 ?? '', r.review?.text ?? ''].join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/** Counts for the filter's own labels. */
export function rowCounts(rows: readonly LanguageRow[]): Record<LanguageFilter, number> {
  let reviewed = 0;
  let own = 0;
  for (const r of rows) {
    if (r.review) reviewed += 1;
    if (r.review?.text) own += 1;
  }
  return { all: rows.length, open: rows.length - reviewed, reviewed, own };
}

/** Why version 2 cannot be saved as written, or null: empty, or a placeholder of the English lost or added. */
export function reviewProblem(english: string, proposed: string): 'empty' | 'placeholders' | null {
  if (!proposed.trim()) return 'empty';
  return placeholdersOf(english) === placeholdersOf(proposed) ? null : 'placeholders';
}

/** The placeholders a phrase carries, to show beside the box: `{name}`, and `{n}` for a counted word. */
export function placeholderList(english: string): string[] {
  const list = placeholdersOf(english);
  return list ? list.split(',').map((p) => (p.endsWith('#') ? `{${p.slice(0, -1)}}` : `{${p}}`)) : [];
}
