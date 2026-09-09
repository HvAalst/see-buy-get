import { describe, expect, it } from 'vitest';
import { PAYOUT_ACTIONS, payoutTone, runSummary } from './settlement';

/**
 * Paying people.
 *
 * Two failures this file exists to prevent, and both of them are somebody not being paid:
 *
 *   - a run that quietly skips half the payees and reports success, so the person who was skipped finds
 *     out on Friday;
 *   - a screen offering an action that advances a payment nobody understands, or colouring a payment
 *     green before the money has actually left.
 */

const t = ((key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : key) as never;

describe('the one honest next step', () => {
  it('offers exactly one path forward from each state the rail defines', () => {
    expect(PAYOUT_ACTIONS.requested.map((a) => a.action)).toEqual(['submit']);
    // Settled and failed are the RAIL speaking, so both are offered from submitted and neither from
    // anywhere else.
    expect(PAYOUT_ACTIONS.submitted.map((a) => a.action)).toEqual(['settle', 'fail']);
    // Money that left and came back is a new fact, not an undo.
    expect(PAYOUT_ACTIONS.settled.map((a) => a.action)).toEqual(['reverse']);
    expect(PAYOUT_ACTIONS.failed).toEqual([]);
    expect(PAYOUT_ACTIONS.reversed).toEqual([]);
  });

  it('offers NOTHING against a state it has never heard of', () => {
    // Advancing a payment whose status this build cannot reason about is worse than doing nothing.
    expect(PAYOUT_ACTIONS['held_by_the_bank']).toBeUndefined();
    expect(PAYOUT_ACTIONS['held_by_the_bank'] ?? []).toEqual([]);
  });

  it('carries a reason on the two endings that need one', () => {
    // "Failed" and "reversed" are things that happened TO a payment; the record has to say what the rail
    // said, or the next person reading it cannot tell a bank rejection from an operator's slip.
    expect(PAYOUT_ACTIONS.submitted.find((a) => a.action === 'fail')?.reasonKey).toBeTruthy();
    expect(PAYOUT_ACTIONS.settled[0].reasonKey).toBeTruthy();
    expect(PAYOUT_ACTIONS.requested[0].reasonKey).toBeUndefined();
  });

  it('is not green until the money has actually left', () => {
    expect(payoutTone('settled')).toBe('ok');
    expect(payoutTone('submitted')).toBe('info'); // handed to the rail is not paid
    expect(payoutTone('requested')).toBe('quiet');
    expect(payoutTone('failed')).toBe('warn');
    expect(payoutTone('reversed')).toBe('warn');
    expect(payoutTone('something_new')).toBe('quiet');
  });
});

describe('what a run did', () => {
  it('names who was SKIPPED, in the same sentence as what was raised', () => {
    // A run that pays four of six and reports success is how somebody discovers on Friday that they have
    // not been paid since Tuesday.
    const line = runSummary(
      { day: '2026-09-09', raised: [1, 2, 3, 4], skipped: [{ payeeDid: 'did:glos:abcdef123456', reason: 'not enough cover' }] },
      t,
    );
    expect(line).toContain('tower.money.runRaised(n=4,day=2026-09-09)');
    expect(line).toContain('tower.money.runSkipped');
    expect(line).toContain('not enough cover');
  });

  it('says a run raised NOTHING rather than reporting a cheerful zero', () => {
    expect(runSummary({ day: '2026-09-09', raised: [], skipped: [] }, t)).toBe('tower.money.runRaisedNone(day=2026-09-09)');
  });

  it('says nothing about skipping when nobody was skipped', () => {
    expect(runSummary({ day: '2026-09-09', raised: [1] }, t)).toBe('tower.money.runRaised(n=1,day=2026-09-09)');
  });
});
