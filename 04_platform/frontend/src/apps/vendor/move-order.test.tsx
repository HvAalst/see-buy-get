import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { money } from './logic';
import { MoveBlock, movable, moveSays } from './screens/MoveOrder';
import type { MoveView, OrderDetail } from './types';
import type { VendorActions, VendorState } from './useVendorApp';

/*
 * 2026-11-06 — HANDING AN ORDER IN AT ANOTHER SHOP (the owner: "moving needs a re-price, but it's not automated by us so the
 * user is aware of the implication"): the store sees the new price beside the old, and what it does to its balance, first.
 */
const view = (over: Partial<MoveView> = {}): MoveView => ({
  parcelId: 'PUD-1',
  from: { did: 'did:a', shopName: 'Shop A' },
  to: { did: 'did:b', shopName: 'Shop B' },
  was: 300,
  now: 350,
  difference: 50,
  currency: 'KES',
  pays: 'balance',
  balance: 1000,
  balanceAfter: 950,
  canMove: true,
  ...over,
});
const order = (over: Partial<OrderDetail> = {}) => ({ parcelId: 'PUD-1', status: 'Created', originAgentDid: 'did:a', ...over }) as unknown as OrderDetail;
const block = (move: VendorState['move'], d = order()) =>
  renderToString(<MoveBlock d={d} state={{ move, points: [], pointsState: 'ready', busy: null } as unknown as VendorState} actions={{} as VendorActions} />);

describe('handing an order in at another shop', () => {
  it('only while it is booked to be handed in at a shop, and not handed in yet', () => {
    expect(movable(order())).toBe(true);
    expect(movable(order({ status: 'At_PUDO' }))).toBe(false);
    expect(movable(order({ originAgentDid: undefined }))).toBe(false);
    expect(movable(order({ handInMdpId: 'mdp-1' } as never))).toBe(false);
    expect(block(null, order({ status: 'Delivered' }))).toBe('');
  });

  it('says the new price beside the old, and the balance after — dearer, cheaper or the same', () => {
    expect(moveSays(view(), t)).toBe(t('vendor.move.dearer', { shop: 'Shop B', now: money(350, 'KES'), was: money(300, 'KES'), diff: money(50, 'KES'), after: money(950, 'KES') }));
    expect(moveSays(view({ now: 280, difference: -20, balanceAfter: 1020 }), t)).toBe(t('vendor.move.cheaper', { shop: 'Shop B', now: money(280, 'KES'), was: money(300, 'KES'), diff: money(20, 'KES'), after: money(1020, 'KES') }));
    expect(moveSays(view({ now: 300, difference: 0 }), t)).toBe(t('vendor.move.same', { shop: 'Shop B', now: money(300, 'KES') }));
    expect(moveSays(view({ canMove: false, why: 'Shop B has no place left for a new parcel right now' }), t)).toBe('Shop B has no place left for a new parcel right now');
  });

  it('is asked first, then shows the shops, then the price with the move to confirm', () => {
    expect(block(null)).toContain(t('vendor.move.open'));
    expect(block({ parcelId: 'PUD-1' })).toContain(t('vendor.move.pickTitle'));
    const html = block({ parcelId: 'PUD-1', view: view() });
    expect(html).toContain(t('vendor.move.title', { shop: 'Shop B' }));
    expect(html).toContain(t('vendor.move.confirm', { shop: 'Shop B', amount: money(350, 'KES') }));
    expect(html).toContain(t('vendor.move.keep'));
  });

  it('cannot move: says why, and offers no move', () => {
    const html = block({ parcelId: 'PUD-1', view: view({ canMove: false, why: 'The balance is 50.00 short of the new price: top up first' }) });
    expect(html).toContain(t('vendor.move.noTitle', { shop: 'Shop B' }));
    expect(html).toContain('top up first');
    expect(html).not.toContain(t('vendor.move.confirm', { shop: 'Shop B', amount: money(350, 'KES') }));
  });
});
