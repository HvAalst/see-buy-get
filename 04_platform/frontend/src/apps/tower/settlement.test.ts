import { describe, expect, it } from 'vitest';
import { FUNDING_ACTIONS, PAYOUT_ACTIONS, fundingLine, fundingTone, payoutTone, payoutWho, runSummary } from './settlement';

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

/**
 * Money coming IN — the mirror, and the rule read backwards.
 *
 * The shop's own app used to create the entry that put cash in the held figure at the top of the Money
 * screen. What this file holds is the two ways that could come back: a console that offers a way to
 * declare money arrived without a provider reference, and a row that reads settled when only half of
 * what was asked for was actually paid.
 */
describe('money coming in', () => {
  it('offers no way to declare a payment without a provider reference', () => {
    // Both confirm paths demand one. Without it this console is the payer's own word with a staff badge.
    const confirms = FUNDING_ACTIONS.awaiting.filter((a) => a.action === 'confirm' || a.action === 'simulate');
    expect(confirms).toHaveLength(2);
    expect(confirms.every((a) => a.needsRef)).toBe(true);
  });

  it('offers nothing at all for a state this build has never heard of', () => {
    expect(FUNDING_ACTIONS.something_new).toBeUndefined();
  });

  it('lets a confirmed payment be reversed, and nothing else', () => {
    expect(FUNDING_ACTIONS.confirmed.map((a) => a.action)).toEqual(['reverse']);
    expect(FUNDING_ACTIONS.expired).toEqual([]);
  });

  it('is not green until a rail has confirmed it', () => {
    expect(fundingTone('confirmed')).toBe('ok');
    expect(fundingTone('awaiting')).toBe('info'); // asked for is not paid
    expect(fundingTone('reversed')).toBe('warn');
    expect(fundingTone('expired')).toBe('quiet');
    expect(fundingTone('something_new')).toBe('quiet');
  });

  it('says what was ASKED for while it is still waiting', () => {
    expect(fundingLine({ fundingId: 'f1', status: 'awaiting', amount: 5000, currency: 'KES' }, t)).toBe('tower.money.in.asked(amount=KES 5000.00)');
  });

  it('says what ARRIVED once it is confirmed, and what the provider took', () => {
    const line = fundingLine({ fundingId: 'f1', status: 'confirmed', amount: 5000, confirmedAmount: 5000, fee: 75, currency: 'KES' }, t);
    expect(line).toContain('tower.money.in.arrived(amount=KES 5000.00)');
    expect(line).toContain('tower.money.in.fee(amount=KES 75.00)');
  });

  it('shows the shortfall when somebody paid less than they said they would', () => {
    // The case this line exists for: ask for 5,000, pay 500. Showing only the asked-for amount is how a
    // half-paid top-up reads as settled.
    const line = fundingLine({ fundingId: 'f1', status: 'confirmed', amount: 5000, confirmedAmount: 500, currency: 'KES' }, t);
    expect(line).toContain('tower.money.in.arrived(amount=KES 500.00)');
    expect(line).toContain('tower.money.in.short(amount=KES 5000.00)');
  });

  it('says nothing about a shortfall when the full amount arrived', () => {
    expect(fundingLine({ fundingId: 'f1', status: 'confirmed', amount: 5000, confirmedAmount: 5000, currency: 'KES' }, t)).not.toContain('tower.money.in.short');
  });
});

describe('who raised a payout, and who approved it', () => {
  it('says a raised payout waits for somebody else, and names both once it went to the rail', () => {
    expect(payoutWho({ status: 'requested', requestedBy: { name: 'Amina' } }, t)).toBe('tower.money.who.raised(name=Amina)');
    expect(payoutWho({ status: 'submitted', requestedBy: { name: 'Amina' }, approvedBy: { name: 'Otieno' } }, t)).toBe('tower.money.who.approved(raised=Amina,approved=Otieno)');
    expect(payoutWho({ status: 'requested' }, t)).toBeNull();
  });
});
