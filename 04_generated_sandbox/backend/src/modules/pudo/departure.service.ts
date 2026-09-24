import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { CorridorService } from './corridor.service';
import { FleetManagerService } from './fleet-manager.service';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import {
  Departure,
  DepartureBooking,
  DepartureOffer,
  DELAY_PLACES,
  RATE_BASES,
  type DelayPlace,
  type RateBasis,
  type WaitingRecord,
  type WaitingTerms,
} from './departure.types';

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
 * per kilometre, and sometimes per kilogram — so the fleet says which, and this only applies it.
 *
 * AND THE TRIP PRICE NEVER MOVES; THE WAITING DOES. A departure is planned: it leaves at a stated time and
 * runs a known distance, so it is quoted up front and the number agreed before anything rolls. What is not
 * planned is being told to wait at the gate, and that is the one clock in this file that runs by the hour —
 * against the side that caused it, which is the whole reason a waiting record carries a PLACE.
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
    freeMin?: number;
    waitingPerHour?: number;
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

    /*
     * THE WAITING TERMS, and both halves or neither.
     *
     * A rate with no free window bills a shipper from the moment the truck arrives, which is not a delay
     * charge, it is a surcharge on loading. A free window with no rate is a promise with nothing behind it.
     * So a fleet that wants to charge for waiting states what it allows AND what it costs, and one that
     * says neither does not charge — which is a real answer, not a missing setting.
     */
    const perHour = Number(input.waitingPerHour);
    const freeMin = Number(input.freeMin);
    let waiting: WaitingTerms | undefined;
    if (Number.isFinite(perHour) && perHour > 0) {
      if (!Number.isFinite(freeMin) || freeMin < 0) {
        throw new GlosError('INVALID_INPUT', 'Charging for waiting needs the free time first — how long is loading simply expected to take?');
      }
      waiting = { freeMin: Math.round(freeMin), perHour: Math.round(perHour * 100) / 100 };
    }

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
      ...(waiting ? { waiting } : {}),
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
    load: { weightKg: number; volumeM3?: number; km?: number },
  ): { price: number; units: number } {
    const units = rate.basis === 'per_trip' ? 1 : rate.basis === 'per_km' ? Math.max(0, load.km ?? 0) : Math.max(0, load.weightKg);
    const raw = rate.amount * units;
    // The floor matters most on the bases that can price a real stop at almost nothing.
    const price = Math.max(raw, rate.minCharge ?? 0);
    return { price: Math.round(price * 100) / 100, units: Math.round(units * 100) / 100 };
  }

  /**
   * WHAT A WAIT COST — the only hourly arithmetic in this file, and the free window comes off first.
   *
   * Pro rata by the minute, deliberately. Per-started-hour is what the trade often does and it is the rule
   * that makes a fair charge feel like a penalty: eleven minutes over becomes a full hour, and the shipper
   * who was nearly on time pays the same as the one who was not. A fleet that wants more can raise `perHour`
   * where a shipper can see it before booking.
   *
   * No terms means no charge. Not "unlimited waiting" — nobody agreed to a clock nobody published.
   */
  static waitingCharge(terms: WaitingTerms | undefined, waitedMin: number): { billableMin: number; amount: number } {
    const waited = Math.max(0, Math.round(waitedMin));
    if (!terms || terms.perHour <= 0) return { billableMin: 0, amount: 0 };
    const billableMin = Math.max(0, waited - terms.freeMin);
    return { billableMin, amount: Math.round((billableMin / 60) * terms.perHour * 100) / 100 };
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
  quote(departureId: string, load: { weightKg: number; volumeM3?: number }): {
    price: number;
    units: number;
    binds: 'weight' | 'space';
    currency: string;
    waiting?: WaitingTerms;
  } {
    const departure = this.require(departureId);
    this.assertBookable(departure, load);
    const { binds } = DepartureService.bindsOn(departure, load);
    const { price, units } = DepartureService.priceOf(departure.rate, { ...load, km: departure.km });
    // The waiting terms travel WITH the quote: a price that hides the one charge that can appear afterwards
    // is not a quote, and a shipper reading it is the person who can still do something about a slow bay.
    return { price, units, binds, currency: departure.rate.currency, ...(departure.waiting ? { waiting: departure.waiting } : {}) };
  }

  /** Take space on a departure. */
  book(
    departureId: string,
    input: { shipperDid: string; description: string; weightKg: number; volumeM3?: number; freightId?: string },
  ): { departure: Departure; booking: DepartureBooking } {
    const departure = this.require(departureId);
    const load = { weightKg: Number(input.weightKg), volumeM3: Number(input.volumeM3) || undefined };
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
      waiting: [],
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

  /**
   * Say who is running it. The fleet's call, and it can change until the run leaves.
   *
   * Space is sold before a roster exists — that is the ordinary way round, not an omission — so this is a
   * separate act rather than a field on `declare`. Nothing can be clocked until it has happened.
   */
  assignDriver(departureId: string, managerDid: string, driver: { did: string; name: string }): Departure {
    const departure = this.require(departureId);
    if (departure.managerDid !== managerDid) throw new GlosError('FORBIDDEN', 'That is not your departure');
    if (departure.status === 'cancelled') throw new GlosError('INVALID_STATE', 'That run was called off');
    departure.driverDid = driver.did;
    departure.driverName = driver.name;
    this.departures.set(departure.departureId, departure);
    return departure;
  }

  /** The runs a driver is rostered on, soonest first — what the driver app shows them. */
  forDriver(driverDid: string): Departure[] {
    return this.list()
      .filter((d) => d.driverDid === driverDid && d.status !== 'cancelled')
      .sort((a, b) => a.leavesAt.localeCompare(b.leavesAt));
  }

  /**
   * THE TRUCK IS AT THE GATE. The clock starts here and not a moment earlier.
   *
   * The time is the server's, taken now. A driver typing "I got here at 08:00" is making a claim in a
   * dispute they have an interest in; a driver tapping when they arrive is making a record. That costs us
   * the driver who forgets — answered by `waiveWaiting`, not by accepting typed times.
   *
   * Arriving twice at the same stop is not an error and must not restart the clock: a tap that lands twice
   * (a flaky signal, a double press) would otherwise erase a real wait, which is the one failure mode a
   * shipper can never detect. The first arrival stands.
   */
  arrive(departureId: string, bookingId: string, where: DelayPlace, by: string): { departure: Departure; record: WaitingRecord } {
    const { departure, booking } = this.requireClockable(departureId, bookingId, where, by);
    const existing = booking.waiting.find((w) => w.where === where);
    if (existing) return { departure, record: existing };

    const record: WaitingRecord = {
      where,
      arrivedAt: new Date().toISOString(),
      waitedMin: 0,
      billableMin: 0,
      amount: 0,
      bearer: where === 'loading' ? 'shipper' : 'consignee',
    };
    booking.waiting = [...booking.waiting, record];
    this.departures.set(departure.departureId, departure);
    return { departure, record };
  }

  /**
   * LOADED, AND FREE TO GO. The clock stops, the free window comes off, and what is left is owed.
   *
   * Refuses without an arrival rather than inventing one: a stop with an end and no beginning would price
   * at whatever the default was, which is how a shipper gets billed for a wait nobody witnessed.
   */
  freeToGo(departureId: string, bookingId: string, where: DelayPlace, by: string): { departure: Departure; record: WaitingRecord } {
    const { departure, booking } = this.requireClockable(departureId, bookingId, where, by);
    const record = booking.waiting.find((w) => w.where === where);
    if (!record) {
      throw new GlosError('INVALID_STATE', `Nothing was clocked at ${where} — record the arrival first, or there is no wait to end`);
    }
    if (record.freeAt) return { departure, record }; // already ended; a second tap is not a second wait

    record.freeAt = new Date().toISOString();
    record.waitedMin = Math.max(0, Math.round((Date.parse(record.freeAt) - Date.parse(record.arrivedAt)) / 60_000));
    const { billableMin, amount } = DepartureService.waitingCharge(departure.waiting, record.waitedMin);
    record.billableMin = billableMin;
    record.amount = amount;
    this.departures.set(departure.departureId, departure);
    return { departure, record };
  }

  /**
   * The fleet lets a waiting charge go, and says why.
   *
   * This is the pressure valve for a rule enforced by taps: the driver who clocked in and went for lunch,
   * the bay that was genuinely ours to blame. The record STAYS — the wait happened and both sides can still
   * read it — and only the amount goes to zero, because deleting it would make the charge unarguable in the
   * other direction.
   */
  waiveWaiting(departureId: string, bookingId: string, where: DelayPlace, managerDid: string, reason: string): Departure {
    const departure = this.require(departureId);
    if (departure.managerDid !== managerDid) throw new GlosError('FORBIDDEN', 'That is not your departure');
    if (!reason?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say why you are letting it go — a waived charge without a reason is not a decision');
    const booking = departure.bookings.find((b) => b.bookingId === bookingId);
    if (!booking) throw new GlosError('NOT_FOUND', 'No such booking');
    const record = booking.waiting.find((w) => w.where === where);
    if (!record) throw new GlosError('NOT_FOUND', `Nothing was clocked at ${where}`);
    record.amount = 0;
    record.waivedReason = reason.trim();
    this.departures.set(departure.departureId, departure);
    return departure;
  }

  /** What one booking owes for standing time, and where it was incurred. Zero is a real answer. */
  waitingOwed(booking: DepartureBooking): { total: number; byPlace: { where: DelayPlace; bearer: string; amount: number }[] } {
    const byPlace = booking.waiting.map((w) => ({ where: w.where, bearer: w.bearer, amount: w.amount }));
    return { total: Math.round(byPlace.reduce((n, w) => n + w.amount, 0) * 100) / 100, byPlace };
  }

  /**
   * Everything that has to be true before a clock may be touched, in the order a person would ask it.
   *
   * WHO is the guard that matters. The driver standing at the gate, or the fleet that sold the run — and
   * nobody else, because the shipper being charged would otherwise hold the stopwatch that bills them.
   */
  private requireClockable(
    departureId: string,
    bookingId: string,
    where: DelayPlace,
    by: string,
  ): { departure: Departure; booking: DepartureBooking } {
    if (!DELAY_PLACES.includes(where)) throw new GlosError('INVALID_INPUT', `Say where: ${DELAY_PLACES.join(' or ')}`);
    const departure = this.require(departureId);
    if (departure.status === 'cancelled') throw new GlosError('INVALID_STATE', 'That run was called off');
    if (by !== departure.driverDid && by !== departure.managerDid) {
      throw new GlosError('FORBIDDEN', 'Only the driver on this run or the fleet that sold it can record waiting time');
    }
    const booking = departure.bookings.find((b) => b.bookingId === bookingId);
    if (!booking) throw new GlosError('NOT_FOUND', 'No such booking');
    if (booking.status !== 'booked') throw new GlosError('INVALID_STATE', 'That booking was cancelled — there is nobody to charge for waiting');
    return { departure, booking };
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
          ...(d.waiting ? { waiting: d.waiting } : {}),
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
