import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ExportRow } from './exports';
import { matchesExport, splitCounts, visibleExports } from './exportSearch';

/*
 * THE EXPORTS, SPLIT AND SEARCHED (the owner, 2026-11-03: "the records of exports should have a split by sea / by air
 * and a searchbox that looks for data in the exports to guarantee a quick lookup").
 */
const row = (over: Partial<ExportRow>): ExportRow =>
  ({
    exportId: 'x',
    code: 'EXP-1001',
    goodsDescription: 'Avocados, 20 pallets',
    loadingPort: 'Mombasa',
    bookingReference: 'MSC-77812',
    gateCutoffAt: '2026-11-04T10:00:00Z',
    modes: ['road', 'sea'],
    timing: {} as never,
    missing: 0,
    box: {} as never,
    you: 'exporter',
    exporterName: 'Thika Avocados',
    destCountry: 'NL',
    originCountry: 'KE',
    vessel: 'MSC Aurora',
    voyage: '512E',
    bookedWithName: 'Swift Forwarding',
    containerNo: 'MSCU1234567',
    ...over,
  }) as ExportRow;

const sea = row({});
const rail = row({ exportId: 'r', code: 'EXP-1002', modes: ['road', 'rail', 'sea'], containerNo: 'TGHU7654321', vessel: undefined, goodsDescription: 'Tea, 18 t' });
const air = row({ exportId: 'a', code: 'EXP-2001', mode: 'air', modes: ['road', 'air'], loadingPort: 'NBO', bookingReference: '176-12345675', containerNo: undefined, vessel: undefined, voyage: undefined, flights: ['KQ 512', 'KL 566'], airline: 'Kenya Airways', houseNumber: 'HAWB-889', goodsDescription: 'Roses, 480 boxes', destCountry: 'NL' });
const names = (c: string) => ({ NL: 'Netherlands', KE: 'Kenya', UG: 'Uganda' })[c];

describe('exports split by sea or by air', () => {
  it('counts each, and shows only its own', () => {
    expect(splitCounts([sea, rail, air])).toEqual({ all: 3, sea: 2, air: 1 });
    expect(visibleExports([sea, rail, air], 'air', '').map((r) => r.code)).toEqual(['EXP-2001']);
    expect(visibleExports([sea, rail, air], 'sea', '').map((r) => r.code)).toEqual(['EXP-1001', 'EXP-1002']);
    expect(visibleExports([sea, rail, air], 'all', '')).toHaveLength(3);
  });
});

describe('the search', () => {
  it('finds an export by everything it is looked up by', () => {
    for (const q of ['EXP-1001', 'avocados', 'mombasa', 'MSC-77812', 'MSCU1234567', 'aurora', '512E', 'swift', 'thika']) expect({ q, found: matchesExport(sea, q, names) }).toEqual({ q, found: true });
    for (const q of ['176-12345675', 'KQ 512', 'kenya airways', 'HAWB-889', 'roses', 'NBO']) expect({ q, found: matchesExport(air, q, names) }).toEqual({ q, found: true });
  });

  it('finds a reference however it is typed', () => {
    expect(matchesExport(sea, 'MSCU 1234567')).toBe(true);
    expect(matchesExport(sea, 'mscu-1234567')).toBe(true);
    expect(matchesExport(air, '17612345675')).toBe(true);
    expect(matchesExport(air, 'kq512')).toBe(true);
  });

  it('finds a country by its name or its code, and a rail leg by "rail"', () => {
    expect(matchesExport(sea, 'netherlands', names)).toBe(true);
    expect(matchesExport(sea, 'NL', names)).toBe(true);
    expect(matchesExport(sea, 'uganda', names)).toBe(false);
    expect(matchesExport(rail, 'rail')).toBe(true);
    expect(matchesExport(sea, 'rail')).toBe(false);
  });

  it('wants every word found, and nothing typed shows everything', () => {
    expect(matchesExport(air, 'roses netherlands', names)).toBe(true);
    expect(matchesExport(air, 'roses uganda', names)).toBe(false);
    expect(matchesExport(sea, '   ')).toBe(true);
    // The split and the search together.
    expect(visibleExports([sea, rail, air], 'sea', 'tea').map((r) => r.code)).toEqual(['EXP-1002']);
    expect(visibleExports([sea, rail, air], 'air', 'tea')).toEqual([]);
  });

  it('is what the exports screen draws — the split, the box, and a way back when nothing matches', () => {
    const src = readFileSync('src/apps/business/screens/ExportsScreen.tsx', 'utf8');
    expect(src).toMatch(/visibleExports\(rows, split, query, countryName\)\.map\(/);
    expect(src).toMatch(/type="search"/);
    expect(src).toMatch(/business\.exports\.search\.clear/);
    // The filter by legs is gone from the list it split.
    expect(src).not.toMatch(/<ModeFilter/);
  });
});
