import { describe, expect, it } from 'vitest';
import {
  CLAIM_SLOW_DAYS,
  DISPOSAL_LONG_DAYS,
  amount,
  claimBlocker,
  coverLine,
  daysWaiting,
  documentsOf,
  missingWords,
  money,
  shelfSlots,
  stuckDays,
  stuckLabel,
  waitingLine,
  type ClaimRow,
} from './queues';

/**
 * The operator's decision queues.
 *
 * These rules were paid for once already, in the vanilla console this migrates from, and every one of
 * them exists because of a way the screen could mislead the person deciding:
 *
 *   - telling an adjudicator a covered shipment has NO cover (which is what the old screen did on every
 *     case, because the queue never sent the limit);
 *   - accepting a decision with no reason, when the claimant is shown that reason;
 *   - letting somebody type an award the server will refuse, and only saying so afterwards;
 *   - reporting "nothing is waiting" while the truth is "nothing has been read yet".
 */

const t = ((key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : key) as never;

const claim = (over: Partial<ClaimRow> = {}): ClaimRow => ({
  parcelId: 'PUD-1',
  shipmentCost: 3.4,
  currency: 'KES',
  awardCap: 5000,
  capBasis: 'free-limit',
  ...over,
});

const NOW = Date.parse('2026-09-09T12:00:00Z');

describe('how long somebody has been waiting', () => {
  it('counts whole days, and never a negative one', () => {
    expect(daysWaiting('2026-09-06T12:00:00Z', NOW)).toBe(3);
    expect(daysWaiting('2026-09-09T11:00:00Z', NOW)).toBe(0);
    // Two machines, two clocks: "waiting -1 days" makes an operator distrust the whole screen.
    expect(daysWaiting('2026-09-10T12:00:00Z', NOW)).toBe(0);
    expect(daysWaiting(undefined, NOW)).toBeNull();
  });

  it('has a threshold for each queue, and neither of them expires anything', () => {
    expect(CLAIM_SLOW_DAYS).toBe(3);
    expect(DISPOSAL_LONG_DAYS).toBe(14);
  });
});

describe('what a claim is covered for', () => {
  it('names a declared cover as declared, and a free limit as a free limit', () => {
    expect(coverLine(claim({ capBasis: 'declared', awardCap: 6000 }), t)).toContain('tower.claims.becauseDeclared');
    expect(coverLine(claim({ capBasis: 'free-limit' }), t)).toContain('tower.claims.becauseFreeLimit');
  });

  it('says plainly when there is no cover at all', () => {
    // The bound that stops a typo is not a promise, and an award there is a goodwill decision.
    expect(coverLine(claim({ capBasis: 'sanity-bound', awardCap: 1_000_000 }), t)).toContain('tower.claims.noCover');
  });

  it('says a price was never RECORDED rather than calling it zero', () => {
      // A walk-up parcel paid for in cash carries no shipmentCost. "Sold for 0.00" is a fact about this
      // shipment, and the wrong one — it tells an adjudicator the carriage was free.
      expect(coverLine(claim({ shipmentCost: undefined }), t)).toContain('tower.claims.priceNotRecorded');
      expect(coverLine(claim({ shipmentCost: 0 }), t)).toContain('tower.claims.shippingSoldFor');
    });

    it('never prints a figure beside a currency it does not know', () => {
      // This network has no unit of its own: every sister settles in a different one, so a bare number
      // dressed as money is a number pretending to be a currency somebody has to guess at.
      expect(amount(1000, 'KES')).toBe('1,000.00 KES');
      expect(amount(1000, undefined)).toBe('1,000.00');
    });

    it('always states the shipping price as NOT a cap', () => {
    // It is the first money figure an adjudicator's eye lands on, and it is about the carriage, not the
    // goods. Every branch of this line carries the label.
    for (const basis of ['declared', 'free-limit', 'sanity-bound'] as const) {
      expect(coverLine(claim({ capBasis: basis }), t)).toContain('tower.claims.shippingSoldFor');
    }
  });
});

describe('what stops a decision being submitted', () => {
  it('demands a reason for every decision, including a rejection', () => {
    // A person whose goods arrived broken is owed an explanation even when they are not owed money.
    expect(claimBlocker('rejected', '', '', claim(), t)).toBe('tower.claims.needReason');
    expect(claimBlocker('upheld', '100', '  ', claim(), t)).toBe('tower.claims.needReason');
    expect(claimBlocker('rejected', '', 'Packaging was intact; damage predates us', claim(), t)).toBeNull();
  });

  it('will not let an upheld claim award nothing', () => {
    // Upholding a claim means awarding something; rejecting it is the honest way to award nothing.
    expect(claimBlocker('upheld', '', 'agreed', claim(), t)).toBe('tower.claims.needAward');
    expect(claimBlocker('upheld', '0', 'agreed', claim(), t)).toBe('tower.claims.needAward');
    expect(claimBlocker('upheld', 'abc', 'agreed', claim(), t)).toBe('tower.claims.needAward');
  });

  it('refuses an award over the cover BEFORE the server has to', () => {
    // The whole reason the cap is now on the row: the operator can see it, so they should not have to
    // discover it by being refused after typing.
    expect(claimBlocker('upheld', '5000', 'agreed', claim(), t)).toBeNull();
    expect(claimBlocker('upheld', '5000.01', 'agreed', claim(), t)).toContain('tower.claims.overCover');
  });

  it('says a sanity bound is a sanity bound, not cover', () => {
    const uncovered = claim({ capBasis: 'sanity-bound', awardCap: 1_000_000 });
    expect(claimBlocker('upheld', '2000000', 'agreed', uncovered, t)).toContain('tower.claims.overBound');
    // …and an ordinary goodwill award under it is perfectly fine.
    expect(claimBlocker('partly_upheld', '250', 'part worn', uncovered, t)).toBeNull();
  });
});

describe('the approvals queue', () => {
  it('counts the shelf a shop is actually offering', () => {
    expect(shelfSlots({ did: 'x', shelf: { rows: 4, cols: 6 } })).toBe(24);
    expect(shelfSlots({ did: 'x' })).toBe(0);
  });

  it('lists the documents, and an empty list when there are none', () => {
    // A decision made on no documents is a different decision, and the screen must not hide which it is.
    expect(documentsOf({ did: 'x', kyc: { idCopyRef: 'a', shopPhotoRefs: ['b', 'c'] } })).toEqual(['a', 'b', 'c']);
    expect(documentsOf({ did: 'x' })).toEqual([]);
  });
});

describe('the one line that says what is waiting', () => {
  it('adds up every queue that has been read', () => {
    expect(waitingLine({ hazards: 2, claims: 1, disposal: 0, approvals: 3 }, t)).toBe('tower.work.waitingAll(n=6)');
  });

  it('says nothing is waiting only when it has actually looked', () => {
    expect(waitingLine({ hazards: 0, claims: 0, disposal: 0, approvals: 0 }, t)).toBe('tower.work.clearAll');
    // Nothing read yet is a different answer, and the difference is the whole point of this function.
    expect(waitingLine({ hazards: null, claims: null, disposal: null, approvals: null }, t)).toBe('tower.work.unknown');
  });

  it('counts the queues it HAS read rather than waiting for all of them', () => {
    // A console that says nothing until every read lands is a console that says nothing when one is slow.
    expect(waitingLine({ hazards: 2, claims: null, disposal: null, approvals: null }, t)).toBe('tower.work.waitingAll(n=2)');
  });
});

describe('money', () => {
  it('is always two decimals, so a column of it lines up', () => {
    expect(money(3.4)).toBe('3.40');
    expect(money(undefined)).toBe('0.00');
  });
});

describe('the shops that started and stopped', () => {
  it('counts whole days stuck, and never rounds one up', () => {
    // This number is the argument for ringing somebody. An argument must not overstate its own case, so
    // a shop that registered this morning is 0 days stuck rather than 1.
    expect(stuckDays('2026-08-11T09:00:00Z', NOW)).toBe(29);
    expect(stuckDays('2026-09-09T06:00:00Z', NOW)).toBe(0);
    expect(stuckDays('2026-09-10T06:00:00Z', NOW)).toBe(0);
  });

  it('says 0 rather than NaN for a date the server did not send', () => {
    expect(stuckDays('', NOW)).toBe(0);
  });

  it('says one day properly, and today as today', () => {
    // The console's other day counts start past 48 hours and can never print a 1. This one starts at
    // zero, so it is the one place that has to.
    expect(stuckLabel(0, t)).toBe('tower.stalled.today');
    expect(stuckLabel(1, t)).toBe('tower.stalled.daysOne(count=1)');
    expect(stuckLabel(29, t)).toBe('tower.stalled.daysMany(count=29)');
  });

  it('names the missing documents rather than counting them', () => {
    expect(missingWords(['id', 'licence', 'photos'], t)).toBe('tower.stalled.doc.id, tower.stalled.doc.licence, tower.stalled.doc.photos');
    expect(missingWords([], t)).toBe('');
  });

  it('passes through a document this console has no word for', () => {
    // A silent gap would tell a caller the shop is done when it is not.
    expect(missingWords(['id', 'tax-number'], t)).toBe('tower.stalled.doc.id, tax-number');
  });
});
