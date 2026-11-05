import { Injectable } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';

/**
 * 2026-11-05 — A BOOKING HOLDS A PLACE AT ITS DROP-OFF SHOP (compendium gap #6, pre-drop-off; the owner: "A place in its
 * space", "24 hour and the store or sender is told at 12, 6, and 3 hours before time ends").
 *
 * Before this, a parcel booked to be handed in at a shop held nothing there: the shop heard of it in the bell and found out
 * whether it had room when the parcel was on its counter. Now a booking (a store's order, a Business parcel, an API
 * shipment, a parcel booked in the Send app) holds one place on that shop's shelf from the moment it is booked, for
 * DROP_OFF_HOLD_H hours. The place counts against the shop's free space everywhere free space is offered — the public map,
 * routing, the shipping API, the pickers — so a full shop is not offered for new bookings.
 *
 * WHAT IT NEVER DOES: refuse a parcel that is physically at a counter. A hold lowers what is OFFERED; a parcel arriving on
 * a bus, or handed in by somebody standing there, is placed as before.
 *
 * WHEN THE TIME RUNS OUT: the place frees and the booking stays. It can still be handed in if the shop has room then, or
 * cancelled (a store's is refunded in full). The booker is told at 12, 6 and 3 hours left, and when it ends — in the bell,
 * never a text.
 *
 * Kept beside the parcel, not on it: a hold is about the shop's space and the booker, and it ends.
 */
export const DROP_OFF_HOLD_H = 24;
/** Told this many hours before the place ends, once each, most urgent first if a sweep was late. */
export const DROP_OFF_WARN_H = [12, 6, 3] as const;

export type HoldBooker = { vendorId: string } | { personDid: string };

export interface DropOffHold {
  parcelId: string;
  /** The shop holding the place. */
  agentDid: string;
  heldAt: string;
  until: string;
  /** Who booked it, and so who is told the time left: a store (its vendorId) or a person. */
  bookedBy: HoldBooker;
  /** The hours-left marks already told (12, 6, 3). */
  warned: number[];
  /**
   * held — the place is the parcel's until `until`;
   * used — the parcel was handed in and took its place;
   * lapsed — the time ran out (the booking stays; the place was freed);
   * ended — the booking was cancelled or voided before it came in.
   */
  state: 'held' | 'used' | 'lapsed' | 'ended';
  endedAt?: string;
  /** Set once the booker was told the place ended, so the notice is never repeated. */
  lapseTold?: boolean;
}

const HOUR = 3_600_000;

@Injectable()
export class DropOffHoldService {
  private readonly holds = new PersistentMap<string, DropOffHold>('pudo-drop-off-holds');

  /** Hold a place for a booking. Idempotent: a parcel already holding (or that held) a place keeps its record. */
  hold(input: { parcelId: string; agentDid: string; bookedBy: HoldBooker }, now: number = Date.now()): DropOffHold {
    const had = this.holds.get(input.parcelId);
    if (had) return had;
    const h: DropOffHold = {
      parcelId: input.parcelId,
      agentDid: input.agentDid,
      heldAt: new Date(now).toISOString(),
      until: new Date(now + DROP_OFF_HOLD_H * HOUR).toISOString(),
      bookedBy: input.bookedBy,
      warned: [],
      state: 'held',
    };
    this.holds.set(h.parcelId, h);
    return h;
  }

  of(parcelId: string): DropOffHold | undefined {
    return this.holds.get(parcelId);
  }

  /** Still holding its place at this moment. The clock decides, so a sweep that runs late never over-counts. */
  isHeld(h: DropOffHold | undefined, now: number = Date.now()): boolean {
    return !!h && h.state === 'held' && Date.parse(h.until) > now;
  }

  /** How many places this shop holds for bookings right now. */
  heldAt(agentDid: string, now: number = Date.now()): number {
    let n = 0;
    for (const h of this.holds.values()) if (h.agentDid === agentDid && this.isHeld(h, now)) n += 1;
    return n;
  }

  /** The bookings this shop is expecting — held, or held and run out — oldest first. */
  forShop(agentDid: string): DropOffHold[] {
    return [...this.holds.values()].filter((h) => h.agentDid === agentDid && (h.state === 'held' || h.state === 'lapsed')).sort((a, b) => a.heldAt.localeCompare(b.heldAt));
  }

  /** The parcel came in: its place is taken by the parcel itself. Returns whether the place was still held for it. */
  use(parcelId: string, now: number = Date.now()): boolean {
    const h = this.holds.get(parcelId);
    if (!h || h.state === 'used' || h.state === 'ended') return false;
    const wasHeld = this.isHeld(h, now);
    this.holds.set(parcelId, { ...h, state: 'used', endedAt: new Date(now).toISOString() });
    return wasHeld;
  }

  /** The booking was cancelled or voided before it came in: the place is given back. */
  end(parcelId: string, now: number = Date.now()): void {
    const h = this.holds.get(parcelId);
    if (!h || h.state === 'used' || h.state === 'ended') return;
    this.holds.set(parcelId, { ...h, state: 'ended', endedAt: new Date(now).toISOString() });
  }

  /**
   * What the booker should be told now: for each held place, the most urgent hours-left mark not yet told (a late sweep
   * skips the marks it slept through rather than sending three at once), and every place whose time has run out and whose
   * booker was not yet told. Marks what it returns as told, so a second sweep sends nothing.
   */
  due(now: number = Date.now()): { warn: Array<{ hold: DropOffHold; hoursLeft: number; mark: number }>; lapsed: DropOffHold[] } {
    const warn: Array<{ hold: DropOffHold; hoursLeft: number; mark: number }> = [];
    const lapsed: DropOffHold[] = [];
    for (const h of [...this.holds.values()]) {
      if (h.state === 'held' && Date.parse(h.until) <= now) {
        const next: DropOffHold = { ...h, state: 'lapsed', endedAt: h.until, lapseTold: true };
        this.holds.set(h.parcelId, next);
        lapsed.push(next);
        continue;
      }
      if (h.state !== 'held') continue;
      const left = (Date.parse(h.until) - now) / HOUR;
      const passed = DROP_OFF_WARN_H.filter((m) => left <= m && !h.warned.includes(m));
      if (!passed.length) continue;
      const mark = Math.min(...passed);
      const next: DropOffHold = { ...h, warned: [...h.warned, ...passed] };
      this.holds.set(h.parcelId, next);
      warn.push({ hold: next, hoursLeft: Math.max(1, Math.round(left)), mark });
    }
    return { warn, lapsed };
  }
}
