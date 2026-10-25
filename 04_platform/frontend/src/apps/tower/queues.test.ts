import { describe, expect, it } from 'vitest';
import {
  answersLine,
  applicationPapers,
  needsRecordTick,
  carrierBearsLine,
  CLAIM_SLOW_DAYS,
  DISPOSAL_LONG_DAYS,
  amount,
  floatsLine,
  claimBlocker,
  freightCoverLine,
  reportRowWords,
  coverLine,
  daysWaiting,
  documentsOf,
  hubPapersOf,
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
    // The company has stated none: it pays nothing itself. It used to be shown as "a goodwill decision".
    expect(coverLine(claim({ capBasis: 'none', awardCap: 0 }), t)).toContain('tower.claims.noCover');
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

    it('says the network’s float in each money, one figure each — never one total across them (2026-10-25)', () => {
      expect(floatsLine({ systemFloat: 1200, currency: 'KES', floats: [{ currency: 'KES', amount: 1200 }, { currency: 'UGX', amount: 40000 }] })).toBe('1,200.00 KES · 40,000.00 UGX');
      // An answer from before the floats were sent: the home money's, with its money.
      expect(floatsLine({ systemFloat: 1200, currency: 'KES' })).toBe('1,200.00 KES');
    });

    it('always states the shipping price as NOT a cap', () => {
    // It is the first money figure an adjudicator's eye lands on, and it is about the carriage, not the
    // goods. Every branch of this line carries the label.
    for (const basis of ['declared', 'free-limit', 'none'] as const) {
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

  it('lets nothing be awarded on a parcel whose company has stated no cover — not a little, and not "upheld" with nothing', () => {
    // It used to allow anything up to a million there, as "a goodwill decision" by one member of staff.
    const uncovered = claim({ capBasis: 'none', awardCap: 0 });
    expect(claimBlocker('upheld', '250', 'agreed', uncovered, t)).toBe('tower.claims.noAwardWithoutCover');
    expect(claimBlocker('partly_upheld', '0.01', 'part worn', uncovered, t)).toBe('tower.claims.noAwardWithoutCover');
    expect(claimBlocker('upheld', '', 'agreed', uncovered, t)).toBe('tower.claims.noAwardWithoutCover');
    // Closing it with a reason is what is left, and needs the reason.
    expect(claimBlocker('rejected', '', 'the damage claim report holds the record', uncovered, t)).toBeNull();
    expect(claimBlocker('rejected', '', ' ', uncovered, t)).toBe('tower.claims.needReason');
  });

  it('caps a freight claim at the cover the billing company stated, and allows nothing where it stated none', () => {
    const covered = { awardCap: 5000, capBasis: 'free-limit' as const, currency: 'KES' };
    expect(claimBlocker('upheld', '5000.01', 'agreed', covered, t)).toContain('tower.claims.overCover');
    expect(claimBlocker('partly_upheld', '250', 'part worn', covered, t)).toBeNull();
    // The million that stopped a typing mistake is gone with the policy it stood in for.
    const none = { awardCap: 0, capBasis: 'none' as const, currency: 'KES' };
    expect(claimBlocker('upheld', '250', 'agreed', none, t)).toBe('tower.claims.freightNoAward');
    expect(claimBlocker('rejected', '', 'the note is the report', none, t)).toBeNull();
  });

  it('says what a freight claim is covered for: the stated cover, none stated, or nothing billed', () => {
    const row = { freightId: 'f', code: 'FRT-1', description: 'x', destLabel: 'y', kind: 'damaged' as const, reason: 'r', raisedAt: '2026-09-15T00:00:00.000Z', raisedBy: 's', senderName: 'S', carriage: 10.2, currency: 'KES', evidence: [], attempts: 0 };
    expect(freightCoverLine({ ...row, coverable: true, awardCap: 5000, capBasis: 'free-limit' }, t)).toBe('tower.claims.freightCovered(amount=10.20 KES,cover=5,000.00 KES)');
    expect(freightCoverLine({ ...row, coverable: true, awardCap: 0, capBasis: 'none' }, t)).toBe('tower.claims.freightBilled(amount=10.20 KES)');
    expect(freightCoverLine({ ...row, coverable: false, awardCap: 0, capBasis: 'none' }, t)).toBe('tower.claims.freightNoBooks');
  });
});

describe('a damage claim report in the list staff read', () => {
  const row = { parcelId: 'QR-1', number: 'DCR-QR-1', madeAt: '2026-10-12T09:30:00.000Z', origin: 'counter' as const, reason: 'The lid is cracked', from: 'Mama Sarah Shop, Nairobi CBD', to: 'Riverside Corner, Westlands', heldBy: 'Riverside Corner', links: 0, opened: 0 };

  it('says who reported it and in whose hands the parcel was', () => {
    expect(reportRowWords(row, t)).toEqual({ by: 'tower.reports.byShop', hands: 'tower.reports.heldBy(name=Riverside Corner)', handedOn: 'tower.reports.noLink' });
    expect(reportRowWords({ ...row, origin: 'buyer', heldBy: undefined }, t)).toMatchObject({ by: 'tower.reports.byReceiver', hands: 'tower.reports.handedOver' });
  });

  it('says how many notes the receiver added after handover, and nothing where there are none', () => {
    expect(reportRowWords({ ...row, notes: 2 }, t).handedOn).toBe('tower.reports.noLink tower.reports.notes(count=2)');
    expect(reportRowWords(row, t).handedOn).toBe('tower.reports.noLink');
  });

  it('says whether whoever it is for has handed it on — a link stopped after use still counts as handed on', () => {
    expect(reportRowWords({ ...row, links: 1 }, t).handedOn).toBe('tower.reports.links(links=1,opened=0)');
    expect(reportRowWords({ ...row, links: 0, opened: 3 }, t).handedOn).toBe('tower.reports.links(links=0,opened=3)');
    // Emailed to the store's insurer the moment it was made: said first, with the address masked as the server sends it.
    expect(reportRowWords({ ...row, links: 1, insurer: { insurer: 'Jubilee', sentTo: 'c…s@jubilee.example', at: '2026-10-13T08:00:00.000Z' } }, t).handedOn).toBe('tower.reports.emailedTo(insurer=Jubilee,address=c…s@jubilee.example) tower.reports.links(links=1,opened=0)');
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

describe('FP8 — what the carrier bears of an award', () => {
  const base = { freightId: 'f1', code: 'FRT-1', description: 'x', destLabel: 'y', kind: 'damaged' as const, reason: 'r', raisedAt: '2026-09-15T00:00:00.000Z', raisedBy: 's', senderName: 'S', capBasis: 'free-limit' as const, evidence: [], attempts: 0, currency: 'KES' };
  it('names the haul price where the network paid the carrier, and nothing where it did not', () => {
    expect(carrierBearsLine({ ...base, coverable: true, awardCap: 100, carrierPaid: 10 }, t)).toContain('10');
    expect(carrierBearsLine({ ...base, coverable: true, awardCap: 100 }, t)).toBeNull(); // paid nothing yet — or settled between the parties
    expect(carrierBearsLine({ ...base, coverable: false, awardCap: 0, capBasis: 'none', carrierPaid: 10 }, t)).toBeNull();
  });
});

/** A driver in no fleet asking to ride for themselves: the papers are the ask’s own, and the record check is staff’s every time. */
describe('an ask to ride for themselves, on the driver applications row', () => {
  const ask = { country: 'KE', vehicleClass: 'van', plate: 'KVAN 1', idCopyRef: 'med_ask_id', licenceCopyRef: 'med_ask_lic', askedAt: '2026-10-15T08:00:00.000Z' };
  it('shows the ask’s own photographs, the licence first — not the ones a fleet once sent', () => {
    expect(applicationPapers({ kyc: { idCopyRef: 'fleet-id', licenceCopyRef: 'fleet-lic' }, courierAsk: ask })).toEqual(['med_ask_lic', 'med_ask_id']);
    expect(applicationPapers({ kyc: { idCopyRef: 'id', licenceCopyRef: 'lic' } })).toEqual(['lic', 'id']);
    expect(applicationPapers({})).toEqual([]);
  });
  it('asks staff to tick the record check on an ask even where a fleet once said it was clear', () => {
    expect(needsRecordTick({ criminalRecordClear: true, courierAsk: ask })).toBe(true);
    expect(needsRecordTick({ criminalRecordClear: true })).toBe(false);
    expect(needsRecordTick({ criminalRecordClear: false })).toBe(true);
  });

  it('puts a shop applicant\'s own answers to the requirements in one line for the reviewer', () => {
    const every = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '07:30', close: '19:00' }]));
    expect(answersLine({ requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-42', criminalRecordClear: true }, openingHours: every }, t)).toBe('tower.approvals.android(version=13) · tower.approvals.powerYes · tower.approvals.hours(from=07:30,to=19:00) · tower.approvals.licence(licence=TL-42) · tower.approvals.recordDeclared');
    expect(answersLine({ requirements: {}, openingHours: { ...every, sun: null } }, t)).toBe('tower.approvals.android(version=—) · tower.approvals.powerNo · tower.approvals.hours(from=07:30,to=19:00) · tower.approvals.licence(licence=—) · tower.approvals.recordNot');
    expect(answersLine({ requirements: { androidVersion: 12 }, openingHours: { ...every, sat: { open: '09:00', close: '13:00' } } }, t)).toContain('tower.approvals.hoursVary');
  });
});

describe('hubPapersOf — what a member of staff looks at before letting a hub work', () => {
  it('puts the licence first, then the ID, then the premises', () => {
    expect(hubPapersOf({ papers: { idCopyRef: 'id', licenceRef: 'licence', photoRefs: ['front', 'yard'], submittedAt: '2026-10-21T08:00:00.000Z' } })).toEqual(['licence', 'id', 'front', 'yard']);
  });
});
