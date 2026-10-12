import { awardCapOf } from './pudo.controller';

/**
 * WHAT AN ADJUDICATOR IS TOLD A CLAIM IS COVERED FOR, against what the network will actually allow.
 *
 * This exists because the two had drifted apart in the worst possible direction. The queue never sent a
 * cover limit at all, and the screen reading it therefore rendered EVERY case as "no cover on this
 * shipment — an award here is a goodwill decision", including the ones that were covered to thousands.
 * The server knew better and refused anything over the real cap, so the only way to discover the truth
 * was to type an award and be told off by it.
 *
 * Nothing threw, no test failed, and the screen looked like it was working. The lesson is the general
 * one: a projection that drops a field turns a decision surface into a confident liar, and only a test
 * that compares the SHOWN number with the ENFORCED one can see it.
 */
describe('the ceiling an award is checked against', () => {
  it('reports a declared cover limit, and says it was declared', () => {
    // "Covered to 6,000 because they declared it" and "covered to 5,000 because that is what we carry
    // for free" invite different conversations with the claimant.
    expect(awardCapOf({ coverLimit: 6000, declaredValue: 6000 })).toEqual({
      coverLimit: 6000,
      declaredValue: 6000,
      awardCap: 6000,
      capBasis: 'declared',
    });
  });

  it('reports the free limit as a free limit when nothing was declared', () => {
    expect(awardCapOf({ coverLimit: 5000 })).toEqual({ coverLimit: 5000, awardCap: 5000, capBasis: 'free-limit' });
  });

  it('names NO cover as none, with nothing to award: the report is the answer there', () => {
    // A company that has stated no cover pays nothing from its own books (the user, 2026-10-12). It used to be
    // shown the bound that stops a typing mistake — a million — as if that were what could be awarded.
    const cap = awardCapOf({});
    expect(cap).toEqual({ awardCap: 0, capBasis: 'none' });
    expect(cap.coverLimit).toBeUndefined();
  });

  it('treats a zero cover limit as no cover, exactly as the refusal does', () => {
    // The same reading on both sides, or the screen and the server disagree at zero.
    expect(awardCapOf({ coverLimit: 0 })).toEqual({ coverLimit: 0, awardCap: 0, capBasis: 'none' });
  });
});
