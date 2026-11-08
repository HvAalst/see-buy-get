import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardAt, priceFromRow, type CounterAsk, type CounterPriceRow } from './counterPrice';

/**
 * THE PHONE AND THE SERVER COME TO THE SAME PRICE (2026-11-08 — zone pricing, step 3b). The server wrote down a shop's
 * price list and what it charges for a set of walk-ups from it (backend pudo.service.spec.ts, into
 * contracts/counter-price-cases.json): both size classes, a parcel counted by its size, oversize, fragile, the minimum
 * with and without a surcharge, a weight past the card's table, the same zone, the same shop, a shop in no zone and one
 * heavier than the card takes — on the card in force (to the cent) and on the next one, from its date (to its cash step).
 * The counter works every one out from the list alone and must agree: a counter with no signal tells the sender the
 * price the server will charge.
 */
const golden = JSON.parse(readFileSync(join('..', 'backend', 'contracts', 'counter-price-cases.json'), 'utf8')) as {
  now: string;
  later: string;
  row: CounterPriceRow;
  cases: Array<CounterAsk & { gross: number | null; grossLater: number | null }>;
};

describe('a walk-up priced on the phone', () => {
  it('reads the server’s cases — two cards, and cases both priced and not', () => {
    expect(golden.row.cards).toHaveLength(2);
    expect(golden.cases.filter((c) => c.gross != null).length).toBeGreaterThanOrEqual(12);
    expect(golden.cases.some((c) => c.gross == null)).toBe(true);
  });

  it('comes to the server’s price for every case on the card in force, to the cent', () => {
    const now = Date.parse(golden.now);
    for (const c of golden.cases) {
      const priced = priceFromRow(golden.row, c, now);
      expect({ ask: c, gross: priced?.gross ?? null }).toEqual({ ask: c, gross: c.gross });
      if (priced) expect(priced.currency).toBe(golden.row.currency);
    }
  });

  it('comes to the server’s price on the card that comes into force later, from its date — rounded to its cash step', () => {
    const later = Date.parse(golden.later);
    for (const c of golden.cases) {
      const priced = priceFromRow(golden.row, c, later);
      expect({ ask: c, gross: priced?.gross ?? null }).toEqual({ ask: c, gross: c.grossLater });
    }
  });

  it('prices from the card in force at the moment: the first until the second’s date', () => {
    const [first, second] = golden.row.cards;
    expect(cardAt(golden.row, Date.parse(golden.now))?.version).toBe(first.version);
    expect(cardAt(golden.row, Date.parse(second.from) - 1)?.version).toBe(first.version);
    expect(cardAt(golden.row, Date.parse(second.from))?.version).toBe(second.version);
    expect(cardAt(golden.row, Date.parse(golden.later))?.version).toBe(second.version);
  });

  it('has no price where it cannot know one: no card yet, no list, a shop the list does not hold', () => {
    const ask = golden.cases.find((c) => c.gross != null)!;
    expect(priceFromRow(golden.row, ask, Date.parse(golden.row.cards[0].from) - 1)).toBeUndefined();
    expect(priceFromRow(null, ask, Date.parse(golden.now))).toBeUndefined();
    expect(priceFromRow(golden.row, { ...ask, dest: 'a-shop-nobody-listed' }, Date.parse(golden.now))).toBeUndefined();
    expect(priceFromRow({ ...golden.row, cards: [] }, ask, Date.parse(golden.now))).toBeUndefined();
  });
});
