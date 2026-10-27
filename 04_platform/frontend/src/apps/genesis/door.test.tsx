import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { formatMoney, t } from '../../shared/i18n';
import { DoorBlock, doorOnOffer, doorSays, doorUnderWay, raiseSays } from './screens/DoorDelivery';
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

  it('waiting for a driver, the most may be raised by a second ask: approve the difference by when — or it stays as it was', () => {
    const posted = door({ state: 'posted', paid: 300, loadCode: 'FRT-012', canSendToShop: true, canRaise: true, shopName: 'Mama Njeri' });
    expect(render(coming({ status: 'Returned', door: posted }))).toContain(t('send.door.raise'));
    expect(raiseSays(posted, t)).toBeNull();
    const asking = door({ ...posted, canRaise: false, raise: { to: 400, amount: 100, state: 'awaiting', until: '2026-10-27T15:00:00.000Z', instructions: 'Check 2547***678 — enter your M-Pesa PIN' } });
    expect(raiseSays(asking, t)).toMatchObject({ tone: 'warn', title: t('send.door.raiseAwaitingTitle', { amount: formatMoney(100, 'KES') }) });
    const html = render(coming({ status: 'Returned', door: asking }));
    expect(html).toContain('Check 2547***678 — enter your M-Pesa PIN');
    expect(html).toContain(t('send.door.checkAgain'));
    expect(html).not.toContain(t('send.door.raise'));
    // Asked by paybill (the phone could not be asked): the reference to quote is shown; asked on the phone, it is not needed.
    expect(render(coming({ status: 'Returned', door: door({ ...asking, raise: { ...asking.raise!, reference: 'SBG-R42' } }) }))).toContain('SBG-R42');
    expect(render(coming({ status: 'Returned', door: door({ ...asking, raise: { ...asking.raise!, reference: 'SBG-R42', pushed: true } }) }))).not.toContain('SBG-R42');
    expect(render(coming({ door: door({ state: 'awaiting', reference: 'SBG-D7' }) }))).toContain('SBG-D7');
    const lapsed = door({ ...posted, raise: { to: 400, amount: 100, state: 'lapsed', why: 'the time to pay ran out' } });
    expect(raiseSays(lapsed, t)?.detail).toBe(t('send.door.raiseLapsedDetail', { to: formatMoney(400, 'KES'), paid: formatMoney(300, 'KES') }));
    // Paid: nothing of its own — the load's line says the new amount.
    expect(raiseSays(door({ ...posted, paid: 400, raise: { to: 400, amount: 100, state: 'paid' } }), t)).toBeNull();
    // Taken: its price is fixed, nothing to raise.
    expect(raiseSays(door({ state: 'taken', paid: 300, raise: { to: 400, amount: 100, state: 'lapsed' } }), t)).toBeNull();
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
