import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { isPlausiblePhone, normalizePhone } from '../../foundation/identity/phone';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetMoveService } from './fleet-move.service';
import { PersonService } from './person.service';
import type { FleetDriver } from './fleet.types';

/** How long an offer stays open. It lapses by itself — nothing is left waiting on an answer nobody gives. */
export const OFFER_DAYS = 7;
/** Offers one fleet may make in a day, refused ones included — enough to hire, too few to go through a phone book. */
export const MAX_OFFERS_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FleetOfferStatus = 'open' | 'accepted' | 'declined' | 'withdrawn' | 'lapsed';

interface FleetOfferRecord {
  offerId: string;
  fleetDid: string;
  /** Bound to the DRIVER the number named when the offer was made — never to the number, which anyone can know. */
  driverDid: string;
  /** The last three digits of the number the office typed: all it is shown until the driver says yes. */
  phoneEnding: string;
  offeredAt: string;
  expiresAt: string;
  /** The manager who made it (their person), for the fleet's own record. */
  by?: string;
  /** Stored states only — `lapsed` is the clock's, read off `expiresAt`, never written. */
  status: 'open' | 'accepted' | 'declined' | 'withdrawn';
  closedAt?: string;
}

/** An offer as the fleet office sees it: a number it typed, and what became of it. */
export interface FleetOfferView {
  offerId: string;
  phoneEnding: string;
  status: FleetOfferStatus;
  offeredAt: string;
  expiresAt: string;
  closedAt?: string;
  /** Only once they said yes — before that a phone number names nobody to the office. */
  driverName?: string;
}

/** An offer as the driver sees it: who, until when, and what (if anything) they must finish before saying yes. */
export interface DriverOfferView {
  offerId: string;
  fleetDid: string;
  companyName: string;
  offeredAt: string;
  expiresAt: string;
  /** The fleet they drive for now — absent for a courier on their own, or a driver between fleets. */
  fromCompany?: string;
  /** Each thing to finish first, as a sentence. Empty means they can say yes now. */
  blockers: string[];
}

/**
 * A FLEET OFFERS A PLACE — to a driver it names, who says yes or no from their own app.
 *
 * The user's answer (2026-10-01) to "anyone could guess the fleet code into a fleet": the code only names the fleet
 * now, and a fleet takes on a driver who is already registered by the phone number they sign in with. The number
 * ADDRESSES the offer; it never opens anything. The offer is bound to the driver that number named, it shows only in
 * that driver's own signed-in app, and only that sign-in can accept it — not the fleet, not network staff, and not a
 * colleague who knows the number.
 *
 * It waits, and that is not the pending the user ruled out: nothing is held up while it does. The driver keeps
 * driving where they are; no load, run or shipper hangs on the answer; and it lapses after OFFER_DAYS by itself.
 *
 * WHAT A FLEET LEARNS. That a number belongs to a registered driver — which adding one already told it — and nothing
 * else: not their name, not where they drive now, until they say yes. A day's offers are capped, refusals included,
 * so the form is no way to go through a phone book.
 */
@Injectable()
export class FleetOfferService {
  private readonly offers = new PersistentMap<string, FleetOfferRecord>('fleet-offers');
  /** Offers each fleet made (or tried to) in the last day. In memory: honest for one instance, as the rate guard says of itself. */
  private readonly tries = new Map<string, number[]>();

  constructor(
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    private readonly persons: PersonService,
    private readonly moves: FleetMoveService,
    private readonly events: EventBus,
  ) {}

  /** Offer a place to whoever signs in with `phone`. Returns the offer as the office sees it — an open one already made is returned, not doubled. */
  offer(fleetDid: string, phone: string, by?: string, now: number = Date.now()): FleetOfferView {
    const fleet = this.managers.requireActive(fleetDid);
    const typed = (phone ?? '').trim();
    if (!isPlausiblePhone(typed)) throw new GlosError('PHONE_INVALID', 'Enter the phone number they sign in with', { field: 'phone' });
    this.spend(fleetDid, now);

    const driver = this.driverFor(typed);
    if (!driver) throw new GlosError('NOT_FOUND', 'No driver signs in with that number. If they are new to SeeBuyGet, add them as a new driver instead.', { field: 'phone' });
    if (driver.managerDid === fleetDid) throw new GlosError('INVALID_STATE', 'They already drive for you', { field: 'phone' });

    const open = [...this.offers.values()].find((o) => o.fleetDid === fleetDid && o.driverDid === driver.did && statusOf(o, now) === 'open');
    if (open) return this.fleetView(open, now);

    const rec: FleetOfferRecord = {
      offerId: `fo_${randomBytes(8).toString('hex')}`,
      fleetDid,
      driverDid: driver.did,
      phoneEnding: normalizePhone(typed).slice(-3),
      offeredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + OFFER_DAYS * DAY_MS).toISOString(),
      ...(by ? { by } : {}),
      status: 'open',
    };
    this.offers.set(rec.offerId, rec);
    void this.events
      .publish(GlosEvent.Pudo.FleetOfferMade, { offerId: rec.offerId, driverDid: driver.did, fleetDid, companyName: fleet.companyName, expiresAt: rec.expiresAt }, { source: 'pudo' })
      .catch(() => undefined);
    return this.fleetView(rec, now);
  }

  /** The offers waiting on THIS driver, newest first — each with what they would have to finish before saying yes. */
  forDriver(driverDid: string, now: number = Date.now()): DriverOfferView[] {
    const driver = this.drivers.get(driverDid);
    const fromCompany = driver.managerDid ? this.companyOf(driver.managerDid) : undefined;
    const blockers = this.moves.blockersFor(driverDid, now);
    return [...this.offers.values()]
      .filter((o) => o.driverDid === driverDid && statusOf(o, now) === 'open' && this.isActiveFleet(o.fleetDid))
      .sort((a, b) => b.offeredAt.localeCompare(a.offeredAt))
      .map((o) => ({
        offerId: o.offerId,
        fleetDid: o.fleetDid,
        companyName: this.companyOf(o.fleetDid) ?? 'A fleet',
        offeredAt: o.offeredAt,
        expiresAt: o.expiresAt,
        ...(fromCompany ? { fromCompany } : {}),
        blockers,
      }));
  }

  /** Every offer this fleet made that is still open or closed in the last 30 days, newest first. */
  forFleet(fleetDid: string, now: number = Date.now()): FleetOfferView[] {
    return [...this.offers.values()]
      .filter((o) => o.fleetDid === fleetDid && (statusOf(o, now) === 'open' || now - Date.parse(o.closedAt ?? o.expiresAt) < 30 * DAY_MS))
      .sort((a, b) => b.offeredAt.localeCompare(a.offeredAt))
      .map((o) => this.fleetView(o, now));
  }

  /**
   * YES — from the driver's own sign-in, and nobody else's (the controller makes sure of who is asking; this makes
   * sure the offer is theirs). The move happens now or is refused by name.
   */
  accept(offerId: string, driverDid: string, now: number = Date.now()): { driver: FleetDriver; companyName: string } {
    const rec = this.openOfferFor(offerId, driverDid, now);
    const moved = this.moves.join(driverDid, rec.fleetDid, now);
    this.close(rec, 'accepted', now);
    return moved;
  }

  /** No. The fleet is told, by the number it typed; nothing else changes. */
  decline(offerId: string, driverDid: string, now: number = Date.now()): void {
    const rec = this.openOfferFor(offerId, driverDid, now);
    this.close(rec, 'declined', now);
    void this.events
      .publish(GlosEvent.Pudo.FleetOfferClosed, { offerId, outcome: 'declined', fleetDid: rec.fleetDid, driverDid, phoneEnding: rec.phoneEnding, companyName: this.companyOf(rec.fleetDid) ?? '' }, { source: 'pudo' })
      .catch(() => undefined);
  }

  /** The fleet takes an open offer back. The driver is told, so it does not sit in their app saying yes is possible. */
  withdraw(offerId: string, fleetDid: string, now: number = Date.now()): FleetOfferView {
    const rec = this.offers.get(offerId);
    if (!rec || rec.fleetDid !== fleetDid) throw new GlosError('NOT_FOUND', 'No such offer');
    if (statusOf(rec, now) !== 'open') throw new GlosError('INVALID_STATE', `That offer is already ${statusOf(rec, now)}`);
    this.close(rec, 'withdrawn', now);
    void this.events
      .publish(GlosEvent.Pudo.FleetOfferClosed, { offerId, outcome: 'withdrawn', fleetDid, driverDid: rec.driverDid, phoneEnding: rec.phoneEnding, companyName: this.companyOf(fleetDid) ?? '' }, { source: 'pudo' })
      .catch(() => undefined);
    return this.fleetView(rec, now);
  }

  // --- internals ---

  /**
   * The driver who signs in with this number — through the identity spine, because that is what "the number they
   * sign in with" means. The most recent driver registration wins, exactly as sign-in picks one.
   */
  private driverFor(phone: string): FleetDriver | undefined {
    const links = this.persons.findByPhone(phone)?.roles.filter((r) => r.role === 'driver' && r.status === 'active') ?? [];
    for (const link of [...links].reverse()) {
      try {
        return this.drivers.get(link.entityDid);
      } catch {
        // a link to a record that no longer exists names nobody — try the one before it
      }
    }
    return undefined;
  }

  /** The offer, if it is THIS driver's and still open. Somebody else's offer is "no such offer" — not a confirmation it exists. */
  private openOfferFor(offerId: string, driverDid: string, now: number): FleetOfferRecord {
    const rec = this.offers.get(offerId);
    if (!rec || rec.driverDid !== driverDid) throw new GlosError('NOT_FOUND', 'No such offer');
    const company = this.companyOf(rec.fleetDid) ?? 'the fleet';
    const status = statusOf(rec, now);
    if (status === 'lapsed') throw new GlosError('INVALID_STATE', `This offer lapsed — ask ${company} to offer you a place again`);
    if (status === 'withdrawn') throw new GlosError('INVALID_STATE', `${company} took this offer back`);
    if (status !== 'open') throw new GlosError('INVALID_STATE', `You already answered this offer`);
    if (!this.isActiveFleet(rec.fleetDid)) throw new GlosError('INVALID_STATE', `${company} is not taking on drivers right now`);
    return rec;
  }

  private close(rec: FleetOfferRecord, status: FleetOfferRecord['status'], now: number): void {
    rec.status = status;
    rec.closedAt = new Date(now).toISOString();
    this.offers.set(rec.offerId, rec);
  }

  private fleetView(o: FleetOfferRecord, now: number): FleetOfferView {
    const status = statusOf(o, now);
    let driverName: string | undefined;
    if (status === 'accepted') {
      try {
        driverName = this.drivers.get(o.driverDid).displayName;
      } catch {
        driverName = undefined;
      }
    }
    return { offerId: o.offerId, phoneEnding: o.phoneEnding, status, offeredAt: o.offeredAt, expiresAt: o.expiresAt, ...(o.closedAt ? { closedAt: o.closedAt } : {}), ...(driverName ? { driverName } : {}) };
  }

  /** One more offer from this fleet today — or refused, with when it may try again. */
  private spend(fleetDid: string, now: number): void {
    const recent = (this.tries.get(fleetDid) ?? []).filter((t) => now - t < DAY_MS);
    if (recent.length >= MAX_OFFERS_PER_DAY) {
      const retryAfterSec = Math.max(1, Math.ceil((DAY_MS - (now - recent[0])) / 1000));
      this.tries.set(fleetDid, recent);
      throw new GlosError('RATE_LIMITED', `You have made ${MAX_OFFERS_PER_DAY} offers in a day — try again tomorrow`, { limit: MAX_OFFERS_PER_DAY, retryAfterSec });
    }
    recent.push(now);
    this.tries.set(fleetDid, recent);
  }

  private companyOf(fleetDid: string): string | undefined {
    try {
      return this.managers.get(fleetDid).companyName;
    } catch {
      return undefined;
    }
  }

  private isActiveFleet(fleetDid: string): boolean {
    try {
      return this.managers.get(fleetDid).status === 'ACTIVE';
    } catch {
      return false;
    }
  }
}

/** The clock's word on an open offer: past its date, it lapsed — whether or not anybody looked. */
function statusOf(o: FleetOfferRecord, now: number): FleetOfferStatus {
  if (o.status === 'open' && now >= Date.parse(o.expiresAt)) return 'lapsed';
  return o.status;
}
