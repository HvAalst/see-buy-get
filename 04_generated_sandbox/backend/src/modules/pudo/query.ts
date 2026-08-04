/**
 * Generic list-query helpers — the reusable substrate for the Registers epic (searchable, filterable,
 * paginated, exportable lists), shared by the vendor/agent/driver registers and their bookkeeping
 * ledgers. Deliberately tiny and dependency-free: filtering/sorting/searching is done in the service over
 * the in-memory maps today, and the SAME contract (a `Page<T>` envelope) is what a real index/DB backs
 * later — no call site changes. Bounds are enforced here so no query can ask for an unbounded scan.
 */

/** The page envelope every register returns: the rows for this page + the full match count. */
export interface Page<T> {
  items: T[];
  total: number;
}

export const PAGE_DEFAULT_LIMIT = 20;
export const PAGE_MAX_LIMIT = 200;

/** Case-insensitive substring match of `q` against any of the given fields (undefined fields are skipped). */
export function textMatch(fields: Array<string | number | null | undefined>, q: string | undefined): boolean {
  const needle = (q ?? '').trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => f != null && String(f).toLowerCase().includes(needle));
}

/** Whether an ISO timestamp falls within [from, to] (inclusive of the day). Missing bounds pass. */
export function withinDates(iso: string | undefined, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  if (from) {
    const f = Date.parse(from);
    if (Number.isFinite(f) && t < f) return false;
  }
  if (to) {
    // `to` is inclusive of the whole day: if it is a bare date, extend to end-of-day.
    const bare = /^\d{4}-\d{2}-\d{2}$/.test(to);
    const end = Date.parse(bare ? `${to}T23:59:59.999Z` : to);
    if (Number.isFinite(end) && t > end) return false;
  }
  return true;
}

/** Coerce a raw query `limit`/`offset` (string|number|undefined) to safe, bounded integers. */
export function pageBounds(limit?: number | string, offset?: number | string): { limit: number; offset: number } {
  const l = Number(limit);
  const o = Number(offset);
  return {
    limit: Number.isFinite(l) && l > 0 ? Math.min(PAGE_MAX_LIMIT, Math.floor(l)) : PAGE_DEFAULT_LIMIT,
    offset: Number.isFinite(o) && o > 0 ? Math.floor(o) : 0,
  };
}

/** Slice already-filtered+sorted rows into a Page (total = the full match count, before slicing). */
export function paginate<T>(rows: T[], limit?: number | string, offset?: number | string): Page<T> {
  const { limit: l, offset: o } = pageBounds(limit, offset);
  return { items: rows.slice(o, o + l), total: rows.length };
}

/** Render rows to RFC-4180 CSV (CRLF line ends, quote+escape only when needed) — with a formula-injection
 *  guard: a STRING cell a spreadsheet would evaluate as a formula (leading = + - @ or tab/CR — including a
 *  buyer phone like "+254…") is prefixed with an apostrophe so it stays literal text. NUMBER cells are our
 *  own data (a leading "-" there is a real negative, not an injection) and pass through untouched. */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined): string => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}
