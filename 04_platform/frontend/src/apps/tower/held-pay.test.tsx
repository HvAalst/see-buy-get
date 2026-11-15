import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { HeldRow, type HoldRow } from './screens/HeldPayPanel';
import type { TowerActions, TowerState } from './useTowerApp';

/*
 * 2026-11-15 — PAYMENT HELD: A PROBLEM REPORTED, as staff read it: the record side by side, the protocol's questions answered
 * from it, one tap to apply what it says, and going against it waiting for a different member of staff.
 */
const row = (over: Partial<HoldRow> = {}): HoldRow => ({
  freightId: 'f1',
  code: 'FRT-101',
  description: 'A fridge, upright',
  country: 'KE',
  price: 1500,
  currency: 'KES',
  deliveredAt: '2026-11-15T09:00:00.000Z',
  heldUntil: '2026-11-16T09:00:00.000Z',
  problem: { kind: 'damaged', description: 'The door is dented', at: '2026-11-15T12:00:00.000Z' },
  doorNotes: ['damaged × 1'],
  reading: { step: 'arose_in_carriage', outcome: 'refund', facts: { handedOver: true, notedAtDoor: true, notedAtPickup: false }, words: 'Step 3: the problem was noted at the door and not when the driver took it over.' },
  appliesAt: '2026-11-18T12:00:00.000Z',
  ...over,
});
const state = { who: { name: 'Amina Otieno' }, busyId: null } as unknown as TowerState;
const actions = { client: () => null } as unknown as TowerActions;

describe('a held pay in staff’s queue', () => {
  it('shows the record side by side, the three questions answered, and applies what the protocol says', () => {
    const html = renderToString(<HeldRow row={row()} state={state} actions={actions} onChanged={() => undefined} />);
    for (const k of ['tower.hold.atPickup', 'tower.hold.atDoor', 'tower.hold.driverSays', 'tower.hold.q1', 'tower.hold.q2', 'tower.hold.q3'] as const) expect(html).toContain(t(k));
    expect(html).toContain('The door is dented');
    expect(html).toContain('damaged × 1');
    expect(html).toContain(t('tower.hold.noAnswer'));
    expect(html).toContain(t('tower.hold.apply', { outcome: t('tower.hold.refund') }));
    expect(html).toContain('Step 3: the problem was noted at the door');
  });

  it('says when the protocol’s answer applies by itself, and that it has waited over a day', () => {
    const fresh = renderToString(<HeldRow row={row()} state={state} actions={actions} onChanged={() => undefined} />);
    expect(fresh).toContain(t('tower.hold.appliesAt', { when: '' }).split('{')[0].trim().slice(0, 12));
    expect(fresh).not.toContain(t('tower.hold.overdue'));
    expect(renderToString(<HeldRow row={row({ overdue: true })} state={state} actions={actions} onChanged={() => undefined} />)).toContain(t('tower.hold.overdue'));
  });

  it('stops at the question that decided: not handed over asks nothing more', () => {
    const html = renderToString(<HeldRow row={row({ reading: { step: 'not_handed_over', outcome: 'refund', facts: { handedOver: false, notedAtDoor: false, notedAtPickup: false }, words: 'Step 1' } })} state={state} actions={actions} onChanged={() => undefined} />);
    expect(html).toContain(t('tower.hold.q1'));
    expect(html).not.toContain(t('tower.hold.q2'));
  });

  it('going against it, asked by this member of staff: waits for a different one, and nothing is applied meanwhile', () => {
    const pendingOverride = { outcome: 'release' as const, reason: 'Counted before opening', by: 'Amina Otieno', at: '2026-11-15T13:00:00.000Z' };
    const mine = renderToString(<HeldRow row={row({ pendingOverride })} state={state} actions={actions} onChanged={() => undefined} />);
    expect(mine).toContain(t('tower.hold.notYou'));
    expect(mine).not.toContain(t('tower.hold.apply', { outcome: t('tower.hold.refund') }));
    const theirs = renderToString(<HeldRow row={row({ pendingOverride })} state={{ ...state, who: { name: 'Brian Kamau' } } as unknown as TowerState} actions={actions} onChanged={() => undefined} />);
    expect(theirs).toContain(t('tower.hold.approve', { outcome: t('tower.hold.release') }));
  });
});
