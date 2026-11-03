import type { ExportRow } from './exports';

/**
 * 2026-11-03 — THE EXPORTS, SPLIT AND SEARCHED (the owner: "the records of exports should have a split by sea / by air
 * and a searchbox that looks for data in the exports to guarantee a quick lookup").
 *
 * The list comes whole from the server, so the search runs here, as the person types, over everything an export is
 * looked up by: its code, the goods, the port or airport, the booking or the air waybill, the container, the ship and
 * voyage or the flights and airline, the house waybill, who it was booked with, where it comes from and goes to (by the
 * country's code or its name), the exporter and the agent clearing it. Every word typed must be found somewhere; a
 * reference is found however it is typed — "MSCU 1234567" finds MSCU1234567, "176-12345675" finds 17612345675.
 */
export type ExportSplit = 'all' | 'sea' | 'air';

export const exportModeOf = (row: Pick<ExportRow, 'mode'>): 'sea' | 'air' => (row.mode === 'air' ? 'air' : 'sea');

/** How many of each, for the split's own labels. */
export function splitCounts(rows: Array<Pick<ExportRow, 'mode'>>): Record<ExportSplit, number> {
  const air = rows.filter((r) => exportModeOf(r) === 'air').length;
  return { all: rows.length, sea: rows.length - air, air };
}

const fold = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const compact = (s: string): string => fold(s).replace(/[\s\-./]/g, '');

/** The words an export is found by, folded once. `countryName` turns a code into its name in the reader's language. */
export function exportHaystack(row: ExportRow, countryName: (code: string) => string | undefined = () => undefined): { words: string; compact: string } {
  const parts = [
    row.code,
    row.goodsDescription,
    row.loadingPort,
    row.bookingReference,
    row.containerNo,
    row.vessel,
    row.voyage,
    ...(row.flights ?? []),
    row.airline,
    row.houseNumber,
    row.bookedWithName,
    row.destCountry,
    row.destCountry ? countryName(row.destCountry) : undefined,
    row.originCountry,
    row.originCountry ? countryName(row.originCountry) : undefined,
    row.exporterName,
    row.agentName,
    (row.modes ?? []).includes('rail') ? 'rail train' : undefined,
    exportModeOf(row) === 'air' ? 'air' : 'sea',
  ].filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  const words = fold(parts.join(' '));
  return { words, compact: compact(parts.join('')) };
}

/** Whether every word of the search is found in the export (a reference however it is spaced). */
export function matchesExport(row: ExportRow, query: string, countryName?: (code: string) => string | undefined): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = exportHaystack(row, countryName);
  // Each word is looked for as typed, and without its spaces, dashes, dots and slashes — so the pieces of a reference
  // typed apart ("MSCU 1234567", "kq512") are found in it.
  return terms.every((term) => hay.words.includes(term) || hay.compact.includes(compact(term)));
}

/** The list for this split and this search, in the server's order (newest first). */
export function visibleExports(rows: ExportRow[], split: ExportSplit, query: string, countryName?: (code: string) => string | undefined): ExportRow[] {
  return rows.filter((r) => (split === 'all' || exportModeOf(r) === split) && matchesExport(r, query, countryName));
}
