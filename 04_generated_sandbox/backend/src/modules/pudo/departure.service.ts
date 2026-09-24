import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { CorridorService } from './corridor.service';
import { FleetManagerService } from './fleet-manager.service';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { Departure, DepartureBooking, DepartureOffer, RATE_BASES, type RateBasis } from './departure.types';

/**
 * F3 — SELLING THE SPACE ON A RUN THAT IS HAPPENING ANYWAY.
 *
 * The market has run one way until now: a shipper posts a load, carriers bid. This is the other
 * direction, and it is the one a fleet has been waiting for — a line it already runs, a truck with air
 * in the back, and no way to sell it.
 *
 * Two things here are not arithmetic, and both came from the user.
 *
 * WHICHEVER AXIS BINDS. A truck is not a number of kilograms. Ship tempex 300 km and it weighs nothing
 * while filling the hold; ship steel and the weight runs out with the hold half empty. So a departure
 * declares both and a booking consumes whichever it actually fills — the same fact the parcel side
 * already prices on, at truck scale.
 *
 * THE PRICE BASIS IS DECLARED, NOT ASSUMED. Per kilogram is the basis an engineer reaches for and the one
 * that quietly loses money on exactly the loads that fill a truck. Real road freight is priced per trip,
 * per kilometre, per hour, and sometimes per kilogram — so the fleet says which, and this only applies it.
 */
@Injectable()
export class DepartureService {
  private readonly departures = new PersistentMap<string, Departure>('fleet-departures');

  constructor(
    private readonly corridors: CorridorService,
    private readonly managers: FleetManagerService,
  ) {}

  /**
   * Put a departure on one of this fleet's own published lines.
   *
   * Refuses somebody else's line and an unpublished one: a line that is still proposed routes nothing,
   * so space sold on it is space that cannot be delivered.
   */
  declare(input: {
    managerDid: string;
    corridorId: string;
    leavesAt: string;
    capacityKg: number;
    capacityM3?: number;
    basis: string;
    amount: number;
    minCharge?: number;
    km?: number;
    note?: string;
  }): Departure {
    const manager = this.managers.get(input.managerDid);
    const corridor = this.corridors.requireCorridor(input.corridorId);

    if (corridor.owner?.managerDid !== input.managerDid) {
      throw new GlosError('FORBIDDEN', `${corridor.name} is not your line — you can only sell space on a line you run`);
    }
    if (corridor.status !== 'active') {
      throw new GlosError('INVALID_STATE', `${corridor.name} is ${corridor.status}. Space can only be sold on a published line`);
    }

    const leavesAt = new Date(input.leavesAt);
    if (Number.isNaN(leavesAt.getTime())) throw new GlosError('INVALID_INPUT', 'Say when it leaves');
    // A departure in the past cannot be booked onto, and selling one is how a shipper loses a day.
    if (leavesAt.getTime() < Date.now()) throw new GlosError('INVALID_INPUT', 'That time has passed — a departure has to be ahead of now');

    const capacityKg = Number(input.capacityKg);
    if (!Number.isFinite(capacityKg) || capacityKg <= 0) throw new GlosError('INVALID_INPUT', 'Say how much weight is for sale');
    const capacityM3 = Number(input.capacityM3);
    const space = Number.isFinite(capacityM3) && capacityM3 > 0 ? Math.round(capacityM3 * 100) / 100 : undefined;

    const basis = String(input.basis) as RateBasis;
    if (!RATE_BASES.includes(basis)) throw new GlosError('INVALID_INPUT', `Say how you charge: ${RATE_BASES.join(', ')}`);
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new GlosError('INVALID_INPUT', 'Say what you charge');

    const km = Number(input.km);
    const distance = Number.isFinite(km) && km > 0 ? Math.round(km) : undefined;
    // Per-kilometre with no distance prices every booking at zero. Asked for here rather than discovered
    // by the first shipper to book, who would otherwise be quoted nothing and the fleet paid nothing.
    if (basis === 'per_km' && !distance) throw new GlosError('INVALID_INPUT', 'Charging by the kilometre needs the distance this line runs');

    const departure: Departure = {
      departureId: `dep_${randomBytes(6).toString('hex')}`,
      corridorId: corridor.corridorId,
      lineName: corridor.name,
      managerDid: input.managerDid,
      company: corridor.owner.company,
      originZone: corridor.originZone,
      destZone: corridor.destZone,
      leavesAt: leavesAt.toISOString(),
      capacityKg: Math.round(capacityKg),
      ...(space ? { capacityM3: space } : {}),
      rate: {
        basis,
        amount: Math.round(amount * 100) / 100,
        ...(Number(input.minCharge) > 0 ? { minCharge: Math.round(Number(input.minCharge) * 100) / 100 } : {}),
        currency: this.currencyFor(manager.jurisdiction),
      },
      ...(distance ? { km: distance } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      status: 'open',
      bookings: [],
      createdAt: new Date().toISOString(),
    };
    this.departures.set(departure.departureId, departure);
    return departure;
  }

  /**
   * What a shipper would pay, and which axis their load actually fills.
   *
   * Pure, and exported through `quote` so a screen can say the price BEFORE anybody commits — the same
   * rule the top-up fee is held to. `units` comes back with it so the number can be re-read rather than
   * taken on trust: 300 km at 1.20 is a sentence, 360 on its own is not.
   */
  static priceOf(
    rate: { basis: RateBasis; amount: number; minCharge?: number },
    load: { weightKg: number; volumeM3?: number; km?: number; hours?: number },
  ): { price: number; units: number } {
    const units =
      rate.basis === 'per_trip' ? 1 : rate.basis === 'per_km' ? Math.max(0, load.km ?? 0) : rate.basis === 'per_hour' ? Math.max(0, load.hours ?? 0) : Math.max(0, load.weightKg);
    const raw = rate.amount * units;
    // The floor matters most on the bases that can price a real stop at almost nothing.
    const price = Math.max(raw, rate.minCharge ?? 0);
    return { price: Math.round(price * 100) / 100, units: Math.round(units * 100) / 100 };
  }

  /**
   * WHICH AXIS THIS LOAD FILLS, and how much of the departure it takes.
   *
   * A share on each axis, and the bigger one wins — that is what "full" means for a vehicle. Space is
   * only compared where the fleet declared a hold AND the shipper measured: an unmeasured load against a
   * measured hold cannot be compared, so it falls back to weight and the booking SAYS it did rather than
   * quietly claiming the truck had room.
   */
  static bindsOn(
    departure: Pick<Departure, 'capacityKg' | 'capacityM3'>,
    load: { weightKg: number; volumeM3?: number },
  ): { binds: 'weight' | 'space'; shareKg: number; shareM3: number } {
    const shareKg = departure.capacityKg > 0 ? load.weightKg / departure.capacityKg : 0;
    const comparable = Boolean(departure.capacityM3 && load.volumeM3);
    const shareM3 = comparable ? (load.volumeM3 as number) / (departure.capacityM3 as number) : 0;
    return { binds: comparable && shareM3 > shareKg ? 'space' : 'weight', shareKg, shareM3 };
  }

  /** What is left on a departure, on both axes. */
  remaining(departure: Departure): { kg: number; m3?: number } {
    const live = departure.bookings.filter((b) => b.status === 'booked');
    const kg = live.reduce((n, b) => n + b.weightKg, 0);
    const m3 = live.reduce((n, b) => n + (b.volumeM3 ?? 0), 0);
    return {
      kg: Math.max(0, Math.round((departure.capacityKg - kg) * 100) / 100),
      ...(departure.capacityM3 ? { m3: Math.max(0, Math.round((departure.capacityM3 - m3) * 100) / 100) } : {}),
    };
  }

  /** The quote, before anything is taken. Refuses for the same reasons `book` would, so a screen can say why. */
  quote(departureId: string, load: { weightKg: number; volumeM3?: number; hours?: number }): { price: number; units: number; binds: 'weight' | 'space'; currency: string } {
    const departure = this.require(departureId);
    this.assertBookable(departure, load);
    const { binds } = DepartureService.bindsOn(departure, load);
    const { price, units } = DepartureService.priceOf(departure.rate, { ...load, km: departure.km });
    return { price, units, binds, currency: departure.rate.currency };
  }

  /** Take space on a departure. */
  book(
    departureId: string,
    input: { shipperDid: string; description: string; weightKg: number; volumeM3?: number; hours?: number; freightId?: string },
  ): { departure: Departure; booking: DepartureBooking } {
    const departure = this.require(departureId);
    const load = { weightKg: Number(input.weightKg), volumeM3: Number(input.volumeM3) || undefined, hours: input.hours };
    this.assertBookable(departure, load);
    if (!input.description?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say what you are sending — the carrier is loading it');

    const { binds } = DepartureService.bindsOn(departure, load);
    const { price, units } = DepartureService.priceOf(departure.rate, { ...load, km: departure.km });

    const booking: DepartureBooking = {
      bookingId: `bkg_${randomBytes(5).toString('hex')}`,
      shipperDid: input.shipperDid,
      ...(input.freightId ? { freightId: input.freightId } : {}),
      description: input.description.trim(),
      weightKg: Math.round(load.weightKg * 100) / 100,
      ...(load.volumeM3 ? { volumeM3: Math.round(load.volumeM3 * 100) / 100 } : {}),
      binds,
      price,
      units,
      at: new Date().toISOString(),
      status: 'booked',
    };
    departure.bookings = [...departure.bookings, booking];
    this.departures.set(departure.departureId, departure);
    return { departure, booking };
  }

  /** Give the space back. The shipper who took it, or the fleet that sold it. */
  cancelBooking(departureId: string, bookingId: string, by: string): Departure {
    const departure = this.require(departureId);
    const booking = departure.bookings.find((b) => b.bookingId === bookingId);
    if (!booking) throw new GlosError('NOT_FOUND', 'No such booking');
    if (booking.shipperDid !== by && departure.managerDid !== by) {
      throw new GlosError('FORBIDDEN', 'Only the shipper who booked it or the fleet that sold it can cancel this');
    }
    if (departure.status === 'departed') throw new GlosError('INVALID_STATE', 'That run has gone — the goods are on it');
    departure.bookings = departure.bookings.map((b) => (b.bookingId === bookingId ? { ...b, status: 'cancelled' as const } : b));
    this.departures.set(departure.departureId, departure);
    return departure;
  }

  /** Stop selling, mark it gone, or call it off. The fleet's own call. */
  setStatus(departureId: string, status: Departure['status'], managerDid: string): Departure {
    const departure = this.require(departureId);
    if (departure.managerDid !== managerDid) throw new GlosError('FORBIDDEN', 'That is not your departure');
    departure.status = status;
    this.departures.set(departure.departureId, departure);
    return departure;
  }

  /** One fleet's own departures, soonest first. */
  forFleet(managerDid: string): Departure[] {
    return this.list()
      .filter((d) => d.managerDid === managerDid)
      .sort((a, b) => a.leavesAt.localeCompare(b.leavesAt));
  }

  /**
   * What a SHIPPER can buy: open departures that have not left, soonest first.
   *
   * A departure with nothing left is not offered. It is not an error and nobody needs telling — a full
   * truck is simply not for sale, and listing it would be a row whose only content is that you cannot
   * have it.
   */
  offers(filter?: { from?: string; to?: string }): DepartureOffer[] {
    const now = Date.now();
    return this.list()
      .filter((d) => d.status === 'open' && new Date(d.leavesAt).getTime() > now)
      .filter((d) => (!filter?.from || d.originZone === filter.from) && (!filter?.to || d.destZone === filter.to))
      .map((d) => {
        const left = this.remaining(d);
        return {
          departureId: d.departureId,
          lineName: d.lineName,
          company: d.company,
          originZone: d.originZone,
          destZone: d.destZone,
          leavesAt: d.leavesAt,
          rate: d.rate,
          ...(d.km ? { km: d.km } : {}),
          ...(d.note ? { note: d.note } : {}),
          remainingKg: left.kg,
          ...(left.m3 != null ? { remainingM3: left.m3 } : {}),
          booked: d.bookings.filter((b) => b.status === 'booked').length,
        };
      })
      .filter((o) => o.remainingKg > 0 && (o.remainingM3 == null || o.remainingM3 > 0))
      .sort((a, b) => a.leavesAt.localeCompare(b.leavesAt));
  }

  list(): Departure[] {
    return [...this.departures.values()];
  }

  require(departureId: string): Departure {
    const departure = this.departures.get(departureId);
    if (!departure) throw new GlosError('NOT_FOUND', 'No such departure');
    return departure;
  }

  /** Everything that would make a booking a lie, asked in the order a person would ask it. */
  private assertBookable(departure: Departure, load: { weightKg: number; volumeM3?: number }): void {
    if (departure.status !== 'open') throw new GlosError('INVALID_STATE', `That departure is ${departure.status}`);
    if (new Date(departure.leavesAt).getTime() <= Date.now()) throw new GlosError('INVALID_STATE', 'That departure has already left');
    if (!Number.isFinite(load.weightKg) || load.weightKg <= 0) throw new GlosError('INVALID_INPUT', 'Say what it weighs');

    const left = this.remaining(departure);
    if (load.weightKg > left.kg) {
      throw new GlosError('NO_ROOM', `Only ${left.kg} kg is left on that departure`);
    }
    if (left.m3 != null && load.volumeM3 && load.volumeM3 > left.m3) {
      // The refusal names SPACE explicitly: a shipper told "it will not fit" while the weight figure
      // plainly allows it will read that as a bug, and send the same load again.
      throw new GlosError('NO_ROOM', `It weighs little enough, but only ${left.m3} m³ of space is left on that departure`);
    }
  }

  /** The country's own currency — always answerable, including where no company of ours stands. */
  private currencyFor(jurisdiction?: string): string {
    return (jurisdiction && catalogueEntry(jurisdiction)?.currency) || 'USD';
  }
}
