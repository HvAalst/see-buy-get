import { describe, expect, it } from 'vitest';
import { addStep, approveFrom, belowCost, cellCost, earliestDay, figure, marginOf, removeStep, setCell, sizeOfStep, weekShift, workingCard, type PriceCardTerms, type PriceCardsView } from './priceCards';

const TERMS: PriceCardTerms = {
  bands: [
    { key: 'local', name: 'Local', maxZones: 0, maxKm: 30 },
    { key: 'national', name: 'National', maxZones: null, maxKm: null },
  ],
  steps: [1, 5],
  table: { local: [70, 100], national: [150, 260] },
  perExtraKg: { local: 0, national: 0 },
  groupCharges: {},
  zoneCharges: {},
  pairs: [],
  weight: { divisorShop: 6000, divisorDoor: 5000, stepKg: 0.5, maxKg: 30, volumeFromKg: 0 },
  surcharges: { door: 0, oversize: 0, oversizeCm: 100, fragile: 0 },
  minimum: 0,
  cashStep: 0,
};

describe('price and cost per pair of zones in the console (step 4)', () => {
  it('steps a week at a time from its Sunday, and says what a price leaves after its planned cost', () => {
    expect(weekShift('2026-11-08', -7)).toBe('2026-11-01');
    expect(weekShift('2026-11-08', 7)).toBe('2026-11-15');
    expect(weekShift('2026-12-27', 7)).toBe('2027-01-03');
    expect(marginOf({ price: 10, planned: 12.5 })).toBe(-2.5);
    expect(marginOf({ price: 0.3, planned: 0.1 })).toBe(0.2);
  });
});

describe('a country’s price card in the console (2026-11-08)', () => {
  it('works on the one card on its way: a draft, ready, filed or cleared — never one in force or scheduled', () => {
    const view = (status: string) => ({ pending: [{ status, version: 1 }] }) as unknown as PriceCardsView;
    expect(workingCard(view('draft'))?.version).toBe(1);
    expect(workingCard(view('cleared'))?.version).toBe(1);
    expect(workingCard(view('scheduled'))).toBeUndefined();
    expect(workingCard(null)).toBeUndefined();
  });

  it('changes one price; adds a weight in its place with no price yet; takes one out but never the last', () => {
    expect(setCell(TERMS, 'local', 1, 110).table.local).toEqual([70, 110]);
    const added = addStep(TERMS, 2);
    expect(added.steps).toEqual([1, 2, 5]);
    expect(added.table).toEqual({ local: [70, 0, 100], national: [150, 0, 260] });
    expect(addStep(TERMS, 5)).toBe(TERMS);
    expect(removeStep(added, 1).table.local).toEqual([70, 100]);
    expect(removeStep({ ...TERMS, steps: [1], table: { local: [70], national: [150] } }, 0).steps).toEqual([1]);
  });

  it('says where a price stands below its estimated cost', () => {
    const costs = [{ band: 'local', stepKg: 1, price: 70, cost: 90 }];
    expect(cellCost(costs, 'local', 1)?.cost).toBe(90);
    expect(belowCost(70, 90)).toBe(true);
    expect(belowCost(100, 90)).toBe(false);
    expect(belowCost(0, 90)).toBe(false); // a price not filled in yet is said as missing, not as below cost
  });

  it('approves from the country’s notice ahead at the earliest; reads a typed figure, a comma as a point', () => {
    expect(earliestDay('2026-11-08', 30)).toBe('2026-12-08');
    expect(earliestDay('2026-11-08', 0)).toBe('2026-11-08');
    expect(approveFrom('2026-12-08', '2026-12-08')).toBeUndefined();
    expect(approveFrom('2026-12-20', '2026-12-08')).toBe(new Date('2026-12-20T00:00:00').toISOString());
    expect(figure('12,5')).toBe(12.5);
    expect(figure('abc')).toBe(0);
    expect(figure('-3')).toBe(0);
  });
});

describe('a fixed card’s weights said as sizes (the owner’s D3, 2026-11-12)', () => {
  it('names the network’s sizes by their weight, the last weight heavy, any other weight as itself', () => {
    expect([1, 5, 15, 30].map((kg, i, all) => sizeOfStep(kg, i === all.length - 1))).toEqual(['S', 'M', 'L', 'heavy']);
    expect(sizeOfStep(2, false)).toBeNull();
    expect(sizeOfStep(15, true)).toBe('heavy');
  });
});
