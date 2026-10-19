import { describe, expect, it } from 'vitest';
import { businessesWaiting, gs1Step, gs1Waiting, licenceRefs, mayApprove, sideWords, type Gs1DisputeRow } from './gs1Disputes';

const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ` ${JSON.stringify(vars)}` : ''}`;
const day = (iso: string) => iso.slice(0, 10);
const row: Gs1DisputeRow = {
  disputeId: 'gs1d_1',
  companyPrefix: '6161234',
  extensionDigit: 4,
  state: 'open',
  openedAt: '2026-10-19T08:00:00.000Z',
  answerBy: '2026-10-26T08:00:00.000Z',
  mayDecide: false,
  claimant: { entityId: 'g', name: 'Genuine Goods', licenceRef: 'm1' },
  holders: [
    { entityId: 'a', name: 'Acme Traders', licenceRef: 'm2', earlier: ['m0'], digitNow: 4 },
    { entityId: 's', name: 'Acme Kisumu', digitNow: 5 },
  ],
};

describe('a GS1 prefix disputed, as staff decide it (round 18)', () => {
  it('says what it waits on: the businesses still to send their licence, and until when', () => {
    expect(gs1Step(row, t as never, day)).toBe('tower.gs1.step.waiting {"names":"Acme Kisumu","by":"2026-10-26"}');
    expect(gs1Step({ ...row, mayDecide: true }, t as never, day)).toBe('tower.gs1.step.ready');
    expect(gs1Waiting([row, { ...row, state: 'decided' }])).toBe(1);
  });

  it('shows the licence to read first, then any it replaced', () => {
    expect(licenceRefs(row.holders[0])).toEqual(['m2', 'm0']);
    expect(licenceRefs(row.holders[1])).toEqual([]);
  });

  it('a proposal is approved by somebody else — and the decision names both, and whose it is', () => {
    const proposed = { ...row, state: 'proposed' as const, proposal: { to: 'holders' as const, what: 'x', reason: 'y', by: 'Amina', at: row.openedAt } };
    expect(mayApprove(proposed, 'Amina')).toBe(false);
    expect(mayApprove(proposed, 'Baraka')).toBe(true);
    expect(gs1Step(proposed, t as never, day)).toBe('tower.gs1.step.proposed {"whose":"Acme Traders, Acme Kisumu","by":"Amina"}');
    expect(sideWords(row, 'claimant')).toBe('Genuine Goods');
    const decided = { ...row, state: 'decided' as const, decided: { to: 'claimant' as const, reason: 'y', proposedBy: 'Amina', by: 'Baraka', at: '2026-10-20T08:00:00.000Z' } };
    expect(gs1Step(decided, t as never, day)).toBe('tower.gs1.step.decided {"whose":"Genuine Goods","proposedBy":"Amina","by":"Baraka","at":"2026-10-20"}');
  });

  it('counts a dispute waiting on the Businesses badge — and says nothing rather than too little when one read failed', () => {
    expect(businessesWaiting(2, [row, { ...row, state: 'proposed' }, { ...row, state: 'decided' }])).toBe(4);
    expect(businessesWaiting(0, [row])).toBe(1);
    expect(businessesWaiting(0, [])).toBe(0);
    expect(businessesWaiting(null, [row])).toBeNull();
    expect(businessesWaiting(3, null)).toBeNull();
  });
});
