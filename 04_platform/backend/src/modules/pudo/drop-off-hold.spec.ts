import { DROP_OFF_HOLD_H, DropOffHoldService } from './drop-off-hold.service';

/*
 * 2026-11-05 — A BOOKING HOLDS A PLACE AT ITS DROP-OFF SHOP for 24 hours; its booker is told at 12, 6 and 3 hours left, and when
 * it ends (the owner). The record alone: what is held, for how long, and what is due to be told.
 */
const HOUR = 3_600_000;
const T0 = Date.parse('2026-11-05T08:00:00Z');

describe('a place held at the drop-off shop', () => {
  let holds: DropOffHoldService;
  beforeEach(() => {
    holds = new DropOffHoldService();
  });

  it('holds one place from booking for 24 hours, counted by the clock rather than by a sweep', () => {
    const h = holds.hold({ parcelId: 'P1', agentDid: 'shop', bookedBy: { vendorId: 'ven' } }, T0);
    expect(Date.parse(h.until) - T0).toBe(DROP_OFF_HOLD_H * HOUR);
    holds.hold({ parcelId: 'P2', agentDid: 'shop', bookedBy: { personDid: 'did:person:a' } }, T0);
    holds.hold({ parcelId: 'P3', agentDid: 'other', bookedBy: { vendorId: 'ven' } }, T0);
    expect(holds.heldAt('shop', T0)).toBe(2);
    expect(holds.heldAt('shop', T0 + 23 * HOUR)).toBe(2);
    // No sweep ran, and the places are free all the same once the time is up.
    expect(holds.heldAt('shop', T0 + 24 * HOUR)).toBe(0);
  });

  it('a second hold for the same parcel changes nothing', () => {
    holds.hold({ parcelId: 'P1', agentDid: 'shop', bookedBy: { vendorId: 'ven' } }, T0);
    const again = holds.hold({ parcelId: 'P1', agentDid: 'shop', bookedBy: { vendorId: 'ven' } }, T0 + 5 * HOUR);
    expect(again.heldAt).toBe(new Date(T0).toISOString());
    expect(holds.heldAt('shop', T0 + 5 * HOUR)).toBe(1);
  });

  it('frees the place when the parcel comes in, or when the booking is cancelled', () => {
    holds.hold({ parcelId: 'P1', agentDid: 'shop', bookedBy: { vendorId: 'ven' } }, T0);
    holds.hold({ parcelId: 'P2', agentDid: 'shop', bookedBy: { vendorId: 'ven' } }, T0);
    expect(holds.use('P1', T0 + HOUR)).toBe(true);
    holds.end('P2', T0 + HOUR);
    expect(holds.heldAt('shop', T0 + HOUR)).toBe(0);
    // Came in after its time: it was no longer held for it.
    holds.hold({ parcelId: 'P3', agentDid: 'shop', bookedBy: { vendorId: 'ven' } }, T0);
    expect(holds.use('P3', T0 + 25 * HOUR)).toBe(false);
    expect(holds.forShop('shop')).toEqual([]);
  });

  it('tells the booker at 12, 6 and 3 hours left, once each — a late sweep sends only the most urgent', () => {
    holds.hold({ parcelId: 'P1', agentDid: 'shop', bookedBy: { vendorId: 'ven' } }, T0);
    expect(holds.due(T0 + 11 * HOUR).warn).toEqual([]);
    const at12 = holds.due(T0 + 12 * HOUR + 60_000).warn;
    expect(at12.map((w) => w.mark)).toEqual([12]);
    expect(holds.due(T0 + 12 * HOUR + 120_000).warn).toEqual([]);
    // The sweep slept from 12 h left to 2 h left: one notice, for 3 hours, not two at once.
    const late = holds.due(T0 + 22 * HOUR).warn;
    expect(late.map((w) => w.mark)).toEqual([3]);
    expect(late[0].hoursLeft).toBe(2);
    expect(holds.of('P1')?.warned.sort((a, b) => a - b)).toEqual([3, 6, 12]);
  });

  it('when the time runs out: the place frees, the booking is still expected, and the booker is told once', () => {
    holds.hold({ parcelId: 'P1', agentDid: 'shop', bookedBy: { personDid: 'did:person:a' } }, T0);
    const end = holds.due(T0 + 24 * HOUR);
    expect(end.lapsed.map((h) => h.parcelId)).toEqual(['P1']);
    expect(holds.due(T0 + 25 * HOUR).lapsed).toEqual([]);
    expect(holds.forShop('shop').map((h) => [h.parcelId, h.state])).toEqual([['P1', 'lapsed']]);
    expect(holds.heldAt('shop', T0 + 25 * HOUR)).toBe(0);
  });

  it('nothing is told for a place already used or given back', () => {
    holds.hold({ parcelId: 'P1', agentDid: 'shop', bookedBy: { vendorId: 'ven' } }, T0);
    holds.use('P1', T0 + HOUR);
    holds.hold({ parcelId: 'P2', agentDid: 'shop', bookedBy: { vendorId: 'ven' } }, T0);
    holds.end('P2', T0 + HOUR);
    const d = holds.due(T0 + 30 * HOUR);
    expect(d.warn).toEqual([]);
    expect(d.lapsed).toEqual([]);
  });
});
