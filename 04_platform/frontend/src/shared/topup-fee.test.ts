import { describe, expect, it } from 'vitest';
import { topUpCost, topUpTermsOf } from './topup-fee';

const TERMS = { charge: 20, freeAbove: 2000, currency: 'KES' };

describe('topUpTermsOf', () => {
  it('reads a real rule, and keeps the currency it is stated in', () => {
    expect(topUpTermsOf({ charge: 20, freeAbove: 2000, currency: 'KES' })).toEqual({ charge: 20, freeAbove: 2000, currency: 'KES' });
  });

  it('is null where NOBODY DECIDED A FEE — the case that must show no sentence at all', () => {
    // Every shape the server can send for "this sister charges nothing to top up".
    expect(topUpTermsOf({ charge: 0, freeAbove: 0 })).toBeNull();
    expect(topUpTermsOf(undefined)).toBeNull();
    expect(topUpTermsOf(null)).toBeNull();
    expect(topUpTermsOf({})).toBeNull();
  });

  it('reads HALF A RULE as no rule — neither half can be charged on its own', () => {
    expect(topUpTermsOf({ charge: 20, freeAbove: 0 })).toBeNull();
    expect(topUpTermsOf({ charge: 0, freeAbove: 2000 })).toBeNull();
    // And a negative is not a rebate: it is a broken record, and it charges nothing.
    expect(topUpTermsOf({ charge: -20, freeAbove: 2000 })).toBeNull();
  });

  it('drops a blank currency rather than rendering an empty unit next to a number', () => {
    expect(topUpTermsOf({ charge: 20, freeAbove: 2000, currency: '  ' })?.currency).toBeUndefined();
  });

  it('keeps the name of the tax inside the charge, where the company charges one — and none where it does not', () => {
    // The charge is what is paid, the company's own VAT inside it (the user, 2026-10-18: "Same VAT as carriage").
    expect(topUpTermsOf({ charge: 23.2, freeAbove: 2000, currency: 'KES', taxLabel: 'VAT' })).toEqual({ charge: 23.2, freeAbove: 2000, currency: 'KES', taxLabel: 'VAT' });
    expect(topUpTermsOf({ charge: 20, freeAbove: 2000, currency: 'KES' })).not.toHaveProperty('taxLabel');
    expect(topUpCost(topUpTermsOf({ charge: 23.2, freeAbove: 2000, taxLabel: 'VAT' }), 500)).toMatchObject({ fee: 23.2, lands: 476.8 });
  });
});

describe('topUpCost', () => {
  it('charges below the threshold, and says what actually lands', () => {
    // The gross is credited and the fee charged separately — 500 in, 20 charged, the float rises by 480.
    expect(topUpCost(TERMS, 500)).toEqual({ fee: 20, lands: 480, shortBy: 1500, free: false });
  });

  it('is free AT the threshold, not only above it — "this much or more"', () => {
    expect(topUpCost(TERMS, 2000)).toEqual({ fee: 0, lands: 2000, shortBy: 0, free: true });
    expect(topUpCost(TERMS, 5000)).toEqual({ fee: 0, lands: 5000, shortBy: 0, free: true });
    // One shilling short is still short. The boundary is the whole fee, so it is pinned from both sides.
    expect(topUpCost(TERMS, 1999)).toEqual({ fee: 20, lands: 1979, shortBy: 1, free: false });
  });

  it('says nothing where there is no rule, whatever the amount', () => {
    expect(topUpCost(null, 500)).toBeNull();
    expect(topUpCost(undefined, 500)).toBeNull();
  });

  it('says nothing for an empty or nonsense box — an empty box is not a free top-up', () => {
    expect(topUpCost(TERMS, 0)).toBeNull();
    expect(topUpCost(TERMS, Number.NaN)).toBeNull();
    expect(topUpCost(TERMS, -100)).toBeNull();
  });

  it('keeps fractions off the screen at two decimals', () => {
    expect(topUpCost({ charge: 12.5, freeAbove: 1000 }, 333.33)).toEqual({ fee: 12.5, lands: 320.83, shortBy: 666.67, free: false });
  });
});
