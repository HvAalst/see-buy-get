import { DropOffHoldService } from './drop-off-hold.service';
import { DropOffHoldSweeper } from './drop-off-hold.sweeper';

/*
 * 2026-11-05 — TOLD BEFORE THE PLACE ENDS (the owner: "24 hour and the store or sender is told at 12, 6, and 3 hours before
 * time ends"). The sweep alone, with the parcel, the shop, the store and the bell stood in for.
 */
const HOUR = 3_600_000;
const T0 = Date.parse('2026-11-05T08:00:00Z');

function setUp(status = 'Created') {
  const holds = new DropOffHoldService();
  const told: Array<{ to: string; kind: string; title: string; body: string; link?: string }> = [];
  const parcel = { parcelId: 'P1', status, externalOrderId: 'ORD-7' };
  const sweeper = new DropOffHoldSweeper(
    holds,
    { get: () => parcel } as never,
    { find: () => ({ shopName: 'Downtown Kiosk' }) } as never,
    { has: () => true, get: () => ({ did: 'did:store', name: 'Nairobi Threads' }) } as never,
    { notify: async (to: string, n: { kind: string; title: string; body: string; link?: string }) => void told.push({ to, ...n }) } as never,
  );
  return { holds, told, parcel, sweeper };
}

describe('the booker is told before the place held for it ends', () => {
  it('tells the store at 12, 6 and 3 hours left, once each, on its orders', async () => {
    const { holds, told, sweeper } = setUp();
    holds.hold({ parcelId: 'P1', agentDid: 'shop', bookedBy: { vendorId: 'ven' } }, T0);
    expect(await sweeper.sweep(T0 + 11 * HOUR)).toBe(0);
    expect(await sweeper.sweep(T0 + 12 * HOUR + 60_000)).toBe(1);
    expect(await sweeper.sweep(T0 + 12 * HOUR + 120_000)).toBe(0);
    await sweeper.sweep(T0 + 18 * HOUR + 60_000);
    await sweeper.sweep(T0 + 21 * HOUR + 60_000);
    expect(told.map((n) => n.title)).toEqual([
      'Order ORD-7: hand it in at Downtown Kiosk within 12 hours',
      'Order ORD-7: hand it in at Downtown Kiosk within 6 hours',
      'Order ORD-7: hand it in at Downtown Kiosk within 3 hours',
    ]);
    expect(told.every((n) => n.to === 'did:store' && n.kind === 'drop_off_hold' && n.link === '/?go=orders')).toBe(true);
    expect(told[0].body).toMatch(/cancel it for a full refund/);
  });

  it('says so once when the place has ended — the booking still stands', async () => {
    const { holds, told, sweeper } = setUp();
    holds.hold({ parcelId: 'P1', agentDid: 'shop', bookedBy: { vendorId: 'ven' } }, T0);
    await sweeper.sweep(T0 + 24 * HOUR);
    await sweeper.sweep(T0 + 25 * HOUR);
    expect(told.map((n) => n.title)).toEqual(['Order ORD-7: the place held at Downtown Kiosk has ended']);
    // Never cancelled by the clock (the owner: "package has to go anyway"): it still goes when there is room.
    expect(told[0].body).toMatch(/still booked, and it still goes/);
  });

  it('a person is told in their own bell, opened on the parcel, with nothing to refund', async () => {
    const { holds, told, sweeper } = setUp();
    holds.hold({ parcelId: 'P1', agentDid: 'shop', bookedBy: { personDid: 'did:person:a' } }, T0);
    await sweeper.sweep(T0 + 12 * HOUR + 60_000);
    expect(told).toEqual([expect.objectContaining({ to: 'did:person:a', link: '/?parcel=P1', title: 'Your parcel: hand it in at Downtown Kiosk within 12 hours' })]);
    expect(told[0].body).not.toMatch(/refund/);
  });

  it('tells nobody about a parcel already handed in or called off, and lets its place go', async () => {
    const { holds, told, sweeper } = setUp('At_PUDO');
    holds.hold({ parcelId: 'P1', agentDid: 'shop', bookedBy: { vendorId: 'ven' } }, T0);
    await sweeper.sweep(T0 + 12 * HOUR + 60_000);
    expect(told).toEqual([]);
    expect(holds.of('P1')?.state).toBe('ended');
  });
});
