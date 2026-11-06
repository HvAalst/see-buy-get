import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { money, moveLine, moveShopChoices, type NetworkShop, type ParcelMove } from './parcels';

/*
 * 2026-11-06 — HANDING A BUSINESS PARCEL IN AT ANOTHER SHOP (the owner: "moving needs a re-price, but it's not automated by
 * us so the user is aware of the implication"): the new price beside the old, and the balance after, before it moves.
 */
const shop = (did: string, over: Partial<NetworkShop> = {}): NetworkShop => ({ did, shopName: `Shop ${did}`, zone: 'Z', openState: 'open', takesNew: true, ...over });
const move = (over: Partial<ParcelMove> = {}): ParcelMove => ({
  parcelId: 'PUD-1',
  from: { did: 'a', shopName: 'Shop a' },
  to: { did: 'b', shopName: 'Shop b' },
  was: 300,
  now: 360,
  difference: 60,
  currency: 'KES',
  balance: 1000,
  balanceAfter: 940,
  canMove: true,
  ...over,
});

describe('handing a business parcel in at another shop', () => {
  it('offers only shops it could go to: not its own, open, taking parcels, with room', () => {
    const shops = moveShopChoices([shop('a'), shop('c'), shop('b'), shop('d', { openState: 'closed' }), shop('e', { takesNew: false }), shop('f', { freeSlots: 0 })], 'a');
    expect(shops.map((s) => s.did)).toEqual(['b', 'c']);
  });

  it('says the new price beside the old and the balance after — or why it cannot move', () => {
    expect(moveLine(move(), t)).toBe(t('business.parcels.moveDearer', { shop: 'Shop b', now: money(360, 'KES'), was: money(300, 'KES'), diff: money(60, 'KES'), after: money(940, 'KES') }));
    expect(moveLine(move({ now: 250, difference: -50, balanceAfter: 1050 }), t)).toBe(t('business.parcels.moveCheaper', { shop: 'Shop b', now: money(250, 'KES'), was: money(300, 'KES'), diff: money(50, 'KES'), after: money(1050, 'KES') }));
    expect(moveLine(move({ now: 300, difference: 0 }), t)).toBe(t('business.parcels.moveSame', { shop: 'Shop b', now: money(300, 'KES'), was: money(300, 'KES'), diff: money(0, 'KES'), after: money(940, 'KES') }));
    expect(moveLine(move({ canMove: false, why: 'Shop b is at its parcel limit for now' }), t)).toBe('Shop b is at its parcel limit for now');
  });
});
