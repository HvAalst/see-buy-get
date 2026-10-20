import { describe, expect, it } from 'vitest';
import { disputeLine, maySendLicence, mayTakeBack, stillWorthShowing, type Gs1DisputeView } from './gs1Dispute';

const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ` ${JSON.stringify(vars)}` : ''}`;
const day = (iso: string) => iso.slice(0, 10);
const base: Gs1DisputeView = { disputeId: 'gs1d_1', companyPrefix: '6161234', extensionDigit: 4, side: 'holder', state: 'open', openedAt: '2026-10-19T08:00:00.000Z', answerBy: '2026-10-26T08:00:00.000Z', claimantName: 'Genuine Goods', holderNames: ['Acme Traders', 'Acme Kisumu'], licenceSent: false };

describe('a GS1 prefix disputed, as a business reads it (round 18)', () => {
  it('asks the business using it for its licence, by when — and says once it is sent', () => {
    expect(disputeLine(base, t as never, day)).toEqual({ text: 'business.gs1.d.holderAsk {"prefix":"6161234","claimant":"Genuine Goods","by":"2026-10-26"}', tone: 'warn' });
    expect(disputeLine({ ...base, licenceSent: true }, t as never, day).text).toBe('business.gs1.d.holderSent {"prefix":"6161234","claimant":"Genuine Goods"}');
    expect(maySendLicence(base)).toBe(true);
    expect(mayTakeBack(base)).toBe(false);
  });

  it('tells the one who opened it who uses the prefix and when staff decide — and lets it take it back', () => {
    const mine = { ...base, side: 'claimant' as const, licenceSent: true };
    expect(disputeLine(mine, t as never, day).text).toBe('business.gs1.d.claimantOpen {"prefix":"6161234","names":"Acme Traders, Acme Kisumu","n":2,"by":"2026-10-26"}');
    expect(mayTakeBack(mine)).toBe(true);
    expect(maySendLicence(mine)).toBe(false);
  });

  it('says the decision with its reason, from each side', () => {
    const decided = { ...base, state: 'decided' as const, decided: { mine: false, reason: 'The licence is in Genuine’s name', at: '2026-10-20T08:00:00.000Z' } };
    expect(disputeLine(decided, t as never, day)).toEqual({ text: 'business.gs1.d.decidedNotHolder {"prefix":"6161234","claimant":"Genuine Goods","reason":"The licence is in Genuine’s name"}', tone: 'danger' });
    expect(disputeLine({ ...decided, side: 'claimant', decided: { ...decided.decided, mine: true } }, t as never, day)).toEqual({ text: 'business.gs1.d.decidedMine {"prefix":"6161234","reason":"The licence is in Genuine’s name"}', tone: 'ok' });
    expect(disputeLine({ ...decided, side: 'claimant' }, t as never, day).text).toContain('business.gs1.d.decidedNotClaimant');
    expect(maySendLicence(decided)).toBe(false);
    // A month after it ended, it leaves the panel.
    expect(stillWorthShowing(decided, Date.parse('2026-11-10T08:00:00.000Z'))).toBe(true);
    expect(stillWorthShowing(decided, Date.parse('2026-11-25T08:00:00.000Z'))).toBe(false);
    expect(disputeLine({ ...base, state: 'withdrawn', withdrawnAt: '2026-10-20T08:00:00.000Z' }, t as never, day).tone).toBe('idle');
  });

  it('said for a client, every sentence is the client’s — never the forwarder’s (round 20)', () => {
    const forUnga = { ...base, forClient: 'Unga Millers' };
    expect(disputeLine({ ...forUnga, side: 'claimant' }, t as never, day).text).toBe('business.gs1.d.claimantOpenClient {"prefix":"6161234","names":"Acme Traders, Acme Kisumu","n":2,"by":"2026-10-26","client":"Unga Millers"}');
    expect(disputeLine(forUnga, t as never, day).text).toContain('business.gs1.d.holderAskClient');
    expect(disputeLine({ ...forUnga, licenceSent: true }, t as never, day).text).toContain('business.gs1.d.holderSentClient');
    const decided = { ...forUnga, state: 'decided' as const, decided: { mine: true, reason: 'r', at: '2026-10-20T08:00:00.000Z' } };
    expect(disputeLine(decided, t as never, day).text).toContain('business.gs1.d.decidedMineClient');
    expect(disputeLine({ ...decided, side: 'claimant', decided: { ...decided.decided, mine: false } }, t as never, day).text).toContain('business.gs1.d.decidedNotClaimantClient');
    expect(disputeLine({ ...decided, decided: { ...decided.decided, mine: false } }, t as never, day).text).toContain('business.gs1.d.decidedNotHolderClient');
  });
});
