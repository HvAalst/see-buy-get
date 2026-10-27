import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { callOffSays, shopsToPick } from './screens/CallOff';
import type { NetworkPoint } from './types';

describe('calling an order off, said first (the user, 2026-10-27: “Comes back, store pays”)', () => {
  it('before it left the shop it was handed in at: withdrawn, and what comes back', () => {
    expect(callOffSays({ parcelId: 'P', outcome: 'refund', amount: 240, currency: 'KES' }, t)).toMatch(/^It is withdrawn, and .*240.* comes back to your balance.$/);
    expect(callOffSays({ parcelId: 'P', outcome: 'refund', amount: 0, currency: 'KES' }, t)).toBe('It is withdrawn. It was never paid for, so nothing comes back.');
  });

  it('at a hub: back to the shop it was handed in at, as a new parcel, at a price — the way there not given back', () => {
    const says = callOffSays({ parcelId: 'P', outcome: 'bring_back', amount: 180, currency: 'KES', backTo: 'Nairobi CBD', atHub: 'Naivasha Hub' }, t);
    expect(says).toMatch(/^It is at Naivasha Hub. It comes back to Nairobi CBD, the shop you handed it in at, as a new parcel for .*180.*. What it cost to get it there is not given back.$/);
  });

  it('where it cannot be, the reason as the server gave it', () => {
    expect(callOffSays({ parcelId: 'P', outcome: 'no', why: 'A driver is carrying it: it cannot be called off on the road.' }, t)).toBe('A driver is carrying it: it cannot be called off on the road.');
  });
  it('not handed in at a shop: asks where it comes back to — its door where it has one — then says the way to its door, with the most suggested (2026-10-27)', () => {
    expect(callOffSays({ parcelId: 'P', outcome: 'pick', atHub: 'Naivasha Hub' }, t)).toBe('It is at Naivasha Hub. It was not handed in at a shop, so say which shop it comes back to. You see the price before anything is done.');
    expect(callOffSays({ parcelId: 'P', outcome: 'pick', atHub: 'Naivasha Hub', door: 'Gate 2' }, t)).toMatch(/^It is at Naivasha Hub. It was not handed in at a shop, so say where it comes back to: your own door, or a shop./);
    expect(callOffSays({ parcelId: 'P', outcome: 'to_door', atHub: 'Naivasha Hub', backTo: 'Gate 2', suggestedMax: 9, currency: 'KES' }, t)).toMatch(/^It is at Naivasha Hub. It comes to Gate 2 as a load: the first driver whose vehicle fits takes it, at their price, never more than you allow. We suggest allowing .*9/);
  });

  it('offers the shops taking parcels that match what was typed, the nearest to the store first', () => {
    const at = (lat: number) => ({ lat, lng: 36.8 });
    const shop = (did: string, shopName: string, lat: number, more: Partial<NetworkPoint> = {}): NetworkPoint => ({ did, shopName, zone: 'Nairobi', location: at(lat), openState: 'open', pricePerParcel: 1, ...more });
    const points = [shop('a', 'Far Duka', -1.9), shop('b', 'Near Duka', -1.21), shop('c', 'Closed Duka', -1.2, { openState: 'closed' }), shop('d', 'Held Duka', -1.2, { takesNew: false }), shop('e', 'Kisumu Corner', -0.1, { zone: 'Kisumu' })];
    expect(shopsToPick(points, '', at(-1.2)).map((p) => p.did)).toEqual(['b', 'a', 'e']);
    expect(shopsToPick(points, 'kisumu', at(-1.2)).map((p) => p.did)).toEqual(['e']);
    expect(shopsToPick(points, '', null).map((p) => p.did)).toEqual(['a', 'e', 'b']);
    expect(shopsToPick(points, '', at(-1.2), 1)).toHaveLength(1);
  });
});
