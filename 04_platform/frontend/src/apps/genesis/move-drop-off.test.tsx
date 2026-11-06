import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { money } from './logic';
import { MoveDropOff, moveSaysSend, shopsToMoveTo } from './screens/MoveDropOff';
import type { ConsumerParcelView, MoveView, NetworkPoint } from './types';

/*
 * 2026-11-06 — DROPPING A BOOKED PARCEL OFF AT ANOTHER SHOP (the owner: "moving needs a re-price, but it's not automated by
 * us so the user is aware of the implication"): the sender sees the cash the counter will take from there, first.
 */
const view = (over: Partial<MoveView> = {}): MoveView => ({
  parcelId: 'PUD-1',
  from: { did: 'did:a', shopName: 'Shop A' },
  to: { did: 'did:b', shopName: 'Shop B' },
  was: 300,
  now: 340,
  difference: 40,
  currency: 'KES',
  pays: 'counter',
  canMove: true,
  ...over,
});
const point = (did: string, over: Partial<NetworkPoint> = {}) => ({ did, shopName: `Shop ${did}`, zone: 'Z', openState: 'open', takesNew: true, ...over }) as NetworkPoint;
const parcel = (over: Partial<ConsumerParcelView> = {}) => ({ parcelId: 'PUD-1', relation: 'sent', status: 'Created', dropOff: { did: 'did:a', shopName: 'Shop A', price: 300, currency: 'KES' }, ...over }) as unknown as ConsumerParcelView;
const block = (p: ConsumerParcelView) => renderToString(<MoveDropOff parcel={p} points={[]} preview={async () => null} move={async () => null} />);

describe('dropping a booked parcel off at another shop', () => {
  it('is offered only while it is booked and not dropped off — the server says so by giving its drop-off', () => {
    expect(block(parcel())).toContain(t('send.move.open', { shop: 'Shop A' }));
    expect(block(parcel({ dropOff: undefined }))).toBe('');
  });

  it('says the cash the counter takes from the new shop, beside the price it was booked at', () => {
    expect(moveSaysSend(view(), t)).toBe(t('send.move.dearer', { shop: 'Shop B', now: money(340, 'KES'), was: money(300, 'KES') }));
    expect(moveSaysSend(view({ now: 280, difference: -20 }), t)).toBe(t('send.move.cheaper', { shop: 'Shop B', now: money(280, 'KES'), was: money(300, 'KES') }));
    expect(moveSaysSend(view({ now: 300, difference: 0 }), t)).toBe(t('send.move.same', { shop: 'Shop B', now: money(300, 'KES') }));
    expect(moveSaysSend(view({ canMove: false, why: 'Shop B has no place left for a new parcel right now' }), t)).toBe('Shop B has no place left for a new parcel right now');
  });

  it('offers only shops it could go to: not its own, open, taking parcels, with room', () => {
    const shops = shopsToMoveTo([point('did:a'), point('did:b'), point('did:c', { openState: 'closed' }), point('did:d', { takesNew: false }), point('did:e', { freeSlots: 0 }), point('did:f', { freeSlots: 3 })], 'did:a', '');
    expect(shops.map((p) => p.did)).toEqual(['did:b', 'did:f']);
  });
});
