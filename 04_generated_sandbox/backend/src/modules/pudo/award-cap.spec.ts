import { awardCapOf } from './pudo.controller';
import { MAX_CLAIM_AWARD } from './pudo.config';

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

  it('falls back to the SANITY BOUND, and names it as one rather than as cover', () => {
    // A sister that has never priced cover carries none, and an award there is a goodwill decision. The
    // bound that stops a typo is not a promise, and a screen must not present it as one.
    const cap = awardCapOf({});
    expect(cap).toEqual({ awardCap: MAX_CLAIM_AWARD, capBasis: 'sanity-bound' });
    expect(cap.coverLimit).toBeUndefined();
  });

  it('treats a zero cover limit as no cover stated, exactly as the refusal does', () => {
    // Zero means "no policy stated", not "a policy of nothing" — the same reading item 8 settled on, and
    // it has to be the same on both sides or the screen and the server disagree at zero.
    expect(awardCapOf({ coverLimit: 0 }).capBasis).toBe('sanity-bound');
    expect(awardCapOf({ coverLimit: 0 }).awardCap).toBe(MAX_CLAIM_AWARD);
  });
});
