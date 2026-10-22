import { describe, expect, it } from 'vitest';
import { copyReady, daysNotMatching, shortTx, type AnchorsView } from './trailAnchor';

/** Round 40 — the trail anchored outside our database, as the console reads it. */
describe('the trail anchored outside our database, on the console', () => {
  const tx = '4b8e0f6c2d1a9e7b3c5f8a0d6e2b4c9f1a7d3e5b8c0f2a4d6e8b1c3f5a7d9e0b';

  it('shortens a fingerprint for a table, keeping both ends', () => {
    expect(shortTx(tx)).toBe('4b8e0f6c2d…7d9e0b');
    expect(shortTx('abc')).toBe('abc');
  });

  it('checks a copy only as a whole link number and the 64 letters and digits', () => {
    expect(copyReady('18342', tx)).toBe(true);
    expect(copyReady(' 18342 ', ` ${tx.toUpperCase()} `)).toBe(true);
    expect(copyReady('0', tx)).toBe(false);
    expect(copyReady('12a', tx)).toBe(false);
    expect(copyReady('12', tx.slice(1))).toBe(false);
  });

  it('counts the days the chain no longer matches — the ones that need a person', () => {
    const day = (stillMatches: boolean) => ({ date: '2026-10-22', at: '', height: 1, txId: tx, whole: true, mailed: true, stillMatches });
    const view: AnchorsView = { heads: [day(true), day(false), day(false)], nextAt: '', delivers: false };
    expect(daysNotMatching(view)).toBe(2);
    expect(daysNotMatching(null)).toBe(0);
  });
});
