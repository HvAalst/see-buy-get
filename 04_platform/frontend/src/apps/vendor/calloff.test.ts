import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { callOffSays } from './screens/CallOff';

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
});
