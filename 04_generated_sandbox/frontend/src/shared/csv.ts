/**
 * Client-side CSV builder for register exports of the rows the app already holds (a multi-select "export
 * selected"). It mirrors the backend `toCsv` (query.ts) BYTE-FOR-BYTE — RFC-4180 CRLF, quote+escape only
 * when needed, and the SAME formula-injection guard — so a client export and the server's whole-set export
 * of the same rows are indistinguishable. Never include a collection code (the handover secret) in a column.
 */

/** A spreadsheet would evaluate a STRING cell starting = + - @ (or tab/CR — including a buyer phone like
 *  "+254…") as a formula; prefix it with an apostrophe so it stays literal. NUMBER cells are our own data
 *  (a leading "-" is a real negative, not an injection) and pass through untouched. */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined): string => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}
