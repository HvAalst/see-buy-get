import { describe, expect, it } from 'vitest';
import { formatMoney, t } from '../../shared/i18n';
import { WITHDRAWABLE, withdrawReasonOk, withdrawSays } from './withdraw';

/*
 * STAFF WITHDRAW A PERSON'S PARCEL (the user, 2026-10-27: "Back to its shop, sender pays"): what it would do, said in staff's
 * words before they do it.
 */
describe('withdrawing a person’s parcel, said first', () => {
  it('at a hub: back to the shop it was handed in at, the way back paid there in cash, what was carried not given back', () => {
    const says = withdrawSays({ parcelId: 'P', outcome: 'turn_round', amount: 180, currency: 'KES', backTo: 'Mama Njeri', atHub: 'Ghala Hub' }, t);
    expect(says).toBe(t('tower.withdraw.turnRound', { hub: 'Ghala Hub', shop: 'Mama Njeri', amount: formatMoney(180, 'KES') }));
    expect(says).toMatch(/^It is at Ghala Hub\. It goes back to Mama Njeri, the shop it was handed in at, as a new parcel to its sender, who pays .*180.* in cash there as they collect it\. What was carried to the hub is not given back\./);
  });

  it('not yet handed in, or still at its first shop: withdrawn there', () => {
    expect(withdrawSays({ parcelId: 'P', outcome: 'void' }, t)).toBe('It was never handed in: it is withdrawn, and nothing was paid for it.');
    expect(withdrawSays({ parcelId: 'P', outcome: 'void', atShop: 'Mama Njeri' }, t)).toBe('It has not left Mama Njeri: it is withdrawn there, and the shop gives back what was paid at its counter.');
  });

  it('where it cannot be: the reason as the server gave it', () => {
    expect(withdrawSays({ parcelId: 'P', outcome: 'no', why: 'A store’s parcel is the store’s to call off, from its own app or its systems.' }, t)).toBe('A store’s parcel is the store’s to call off, from its own app or its systems.');
  });

  it('asked only where it could be, and only with a few words of why', () => {
    expect(WITHDRAWABLE).toEqual(['Created', 'At_PUDO', 'At_MDP']);
    expect(withdrawReasonOk('ok')).toBe(false);
    expect(withdrawReasonOk('  the sender asked  ')).toBe(true);
  });
});
