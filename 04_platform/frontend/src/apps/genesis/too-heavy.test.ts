import { describe, expect, it } from 'vitest';
import { tooHeavyFor } from './screens/SendScreen';

/* 2026-11-13 — the Send app does not offer a shop a parcel heavier than its tools let it take (the owner: "shop and hub tools", T3). */
describe('a parcel too heavy for a shop', () => {
  it('is not offered there; a shop that says nothing, and a weight not yet typed, are', () => {
    expect(tooHeavyFor({ maxParcelKg: 23 }, '24')).toBe(true);
    expect(tooHeavyFor({ maxParcelKg: 23 }, '23')).toBe(false);
    expect(tooHeavyFor({ maxParcelKg: 23 }, '')).toBe(false);
    expect(tooHeavyFor({}, '29')).toBe(false);
  });
});
