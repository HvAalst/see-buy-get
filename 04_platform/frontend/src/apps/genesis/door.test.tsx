import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { formatMoney, t } from '../../shared/i18n';
import { DoorBlock, doorOnOffer, doorSays, doorUnderWay } from './screens/DoorDelivery';
import type { ConsumerParcelView, DoorView } from './types';
import type { SendActions, SendState } from './useSendApp';

/*
 * THEIR OWN DOOR, PAID FIRST BY MOBILE MONEY (the user, 2026-10-27: "Mobile money first"): offered on goods coming back to
 * them while still at the hub; then said as it stands — pay on your phone, paid and waiting, taken, delivered and what goes
 * back, sent to the shop instead, or the time ran out.
 */
const coming = (over: Partial<ConsumerParcelView> = {}) => ({ parcelId: 'PUD-Y', relation: 'received', status: 'At_MDP', returnOf: 'PUD-X', ...over }) as ConsumerParcelView;
const door = (over: Partial<DoorView>): DoorView => ({ state: 'awaiting', label: 'Gate 4', maxSpend: 300, currency: 'KES', phoneMasked: '254712***678', ...over });
const render = (p: ConsumerParcelView) => renderToString(<DoorBlock parcel={p} state={{ authPhone: '+254712345678' } as unknown as SendState} actions={{} as SendActions} />);

describe('their own door, paid first', () => {
  it('is offered on goods coming back to them, still at the hub — and on nothing else', () => {
    expect(doorOnOffer(coming())).toBe(true);
    expect(doorOnOffer(coming({ door: door({ state: 'lapsed' }) }))).toBe(true);
    expect(doorOnOffer(coming({ status: 'On_Bus' }))).toBe(false);
    expect(doorOnOffer(coming({ returnOf: undefined }))).toBe(false);
    expect(doorOnOffer(coming({ relation: 'sent' }))).toBe(false);
    expect(doorOnOffer(coming({ door: door({ state: 'awaiting' }) }))).toBe(false);
    expect(render(coming())).toContain(t('send.door.offer'));
  });

  it('while they pay: check your phone, by when — and they may check again or give up', () => {
    const html = render(coming({ door: door({ state: 'awaiting', until: '2026-10-27T15:00:00.000Z', instructions: 'Check 2547***678 — enter your M-Pesa PIN' }) }));
    expect(html).toContain(t('send.door.awaitingTitle', { amount: formatMoney(300, 'KES') }));
    expect(html).toContain(t('send.door.checkAgain'));
    expect(html).toContain(t('send.door.giveUp'));
    expect(html).not.toContain(t('send.door.offer'));
    expect(doorUnderWay(coming({ door: door({ state: 'awaiting' }) }))).toBe(true);
  });

  it('paid and waiting for a driver: the shop instead is offered, all of it back', () => {
    const d = door({ state: 'posted', paid: 300, loadCode: 'FRT-012', canSendToShop: true, shopName: 'Mama Njeri' });
    expect(doorSays(d, t)).toMatchObject({ title: t('send.door.postedTitle', { amount: formatMoney(300, 'KES') }) });
    expect(render(coming({ status: 'Returned', door: d }))).toContain(t('send.door.toShop', { shop: 'Mama Njeri' }));
  });

  it('taken, then delivered: what the driver charged, and what goes back to the number it came from', () => {
    expect(doorSays(door({ state: 'taken', paid: 300, billed: 212.4, loadCode: 'FRT-012' }), t).detail).toBe(t('send.door.takenDetail', { code: 'FRT-012', billed: formatMoney(212.4, 'KES'), paid: formatMoney(300, 'KES') }));
    expect(doorSays(door({ state: 'delivered', owedBack: 88 }), t).detail).toBe(t('send.door.deliveredDetail', { amount: formatMoney(88, 'KES'), last: '678' }));
    expect(doorSays(door({ state: 'delivered' }), t).detail).toBe(t('send.door.deliveredNothing'));
  });

  it('to the shop instead, or the time ran out: said so, and the cash note at the shop applies again only when it lapsed', () => {
    expect(doorSays(door({ state: 'to_shop', shopName: 'Mama Njeri', shopParcelId: 'PUD-Z', owedBack: 300 }), t).title).toBe(t('send.door.toShopTitle', { shop: 'Mama Njeri' }));
    expect(doorSays(door({ state: 'lapsed' }), t).title).toBe(t('send.door.lapsedTitle'));
    expect(doorUnderWay(coming({ door: door({ state: 'lapsed' }) }))).toBe(false);
    expect(doorUnderWay(coming({ door: door({ state: 'to_shop' }) }))).toBe(true);
  });
});
