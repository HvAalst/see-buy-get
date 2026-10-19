import { describe, expect, it } from 'vitest';
import { EMPTY_LINE, EMPTY_PAPERS, papersBody, papersGaps, papersTotals, type PapersForm } from './papers';

const filled = (over: Partial<PapersForm> = {}): PapersForm => ({
  number: 'INV-1',
  currency: 'kes',
  buyerName: 'Abebe Kebede',
  buyerAddress: '',
  lines: [
    { description: 'Ankara shirt', quantity: '2', netKg: '0.6', unitValue: '1700', originCountry: 'ke', hsCode: '6205.20' },
    { ...EMPTY_LINE, description: 'Kitenge scarf', netKg: '0.2', unitValue: '900', originCountry: 'KE' },
  ],
  declared: true,
  ...over,
});

describe('a store parcel’s papers, as the store app fills them in', () => {
  it('names everything still missing, line by line — and nothing once it is ready', () => {
    expect(papersGaps(EMPTY_PAPERS)).toEqual(['number', 'currency', 'buyerName', 'line.0.description', 'line.0.netKg', 'line.0.unitValue', 'line.0.originCountry', 'declared']);
    expect(papersGaps(filled())).toEqual([]);
    expect(papersGaps(filled({ lines: [{ ...filled().lines[0], quantity: '1.5', hsCode: '62' }] }))).toEqual(['line.0.quantity', 'line.0.hsCode']);
    // An address too long is refused, never cut.
    expect(papersGaps(filled({ buyerAddress: 'x'.repeat(301) }))).toEqual(['buyerAddress']);
  });

  it('sends the invoice as typed: the address untouched, an HS code only where the store gave one', () => {
    const home = 'Bole Road, House 12\nNear the Edna Mall';
    const body = papersBody(filled({ buyerAddress: home }));
    expect(body).toEqual({
      number: 'INV-1',
      currency: 'KES',
      importer: { name: 'Abebe Kebede', address: home },
      lines: [
        { description: 'Ankara shirt', quantity: 2, netKg: 0.6, unitValue: 1700, originCountry: 'KE', hsCode: '6205.20' },
        { description: 'Kitenge scarf', quantity: 1, netKg: 0.2, unitValue: 900, originCountry: 'KE' },
      ],
      declare: true,
    });
    // No address: the papers name the shop the buyer collects from.
    expect((papersBody(filled()) as { importer: Record<string, unknown> }).importer).toEqual({ name: 'Abebe Kebede' });
  });

  it('adds the goods up as the invoice will', () => {
    expect(papersTotals(filled())).toEqual({ value: 4300, netKg: 0.8 });
    expect(papersTotals(EMPTY_PAPERS)).toEqual({ value: 0, netKg: 0 });
  });
});
