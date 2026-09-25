import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { CorridorService } from './corridor.service';
import { DriverService } from './driver.service';
import { VehicleService } from './vehicle.service';
import { FleetManagerService } from './fleet-manager.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import {
  MyDepartureBooking,
  Departure,
  DepartureBooking,
  DepartureOffer,
  DELAY_PLACES,
  RATE_BASES,
  SETTLE_METHODS,
  SETTLE_WHEN,
  type SettleTerms,
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
    private readonly drivers: DriverService,
    private readonly vehicles: VehicleService,
    private readonly presence: PresenceService,
    private readonly events: EventBus,
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
    vehicleId: string;
    leavesAt: string;
    /** How much of the vehicle is for sale. Absent means all of it — the registry already knows. */
    capacityKg?: number;
    capacityM3?: number;
    basis: string;
    amount: number;
    minCharge?: number;
    freeMin?: number;
    waitingPerHour?: number;
    km?: number;
    note?: string;
    settleMethod?: string;
    settleWhen?: string;
  }): Departure {
    const manager = this.managers.get(input.managerDid);
    const corridor = this.corridors.requireCorridor(input.corridorId);
    // THE DOOR, asked here rather than assumed from registration. Fleet registration already refuses a
    // country we do not reach, so this looks redundant — and is not, because a country can be WOUND DOWN
    // after a fleet is standing in it. A lapsed licence switches capabilities off, and the run declared
    // the morning after would otherwise be sold as if nothing had changed. Same reason the held quote is
    // re-asked at the mint instead of trusted.
    this.requireOperating(manager.jurisdiction);

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

    /*
     * THE VEHICLE, which this used to do without.
     *
     * capacityKg was a bare number somebody typed, so forty tonnes could be published on a van and
     * nothing anywhere would say otherwise. Everywhere else in this product capacity is derived from a
     * registered vehicle with a body class; a run is the one place it was invented.
     *
     * Three questions, in the order an office would ask them: is it yours, can it go out, and does it
     * actually hold what you are selling.
     */
    const vehicle = this.vehicles.get(String(input.vehicleId ?? ''));
    if (vehicle.managerDid !== input.managerDid) throw new GlosError('FORBIDDEN', `${vehicle.plate} is not one of your vehicles`);
    if (!this.vehicles.isUsable(vehicle.vehicleId)) {
      const why = this.vehicles.offRoadReasons(vehicle.vehicleId);
      throw new GlosError('CANNOT_COUPLE', why.length ? `${vehicle.plate} is off the road: ${why.join('; ')}` : `${vehicle.plate} is ${vehicle.status} — it cannot take a run`);
    }

    // Declared or derived, and capped either way. Selling less than the whole truck is a real choice;
    // selling more than it holds is a promise the vehicle cannot keep.
    const asked = Number(input.capacityKg);
    const capacityKg = Number.isFinite(asked) && asked > 0 ? asked : vehicle.capacityKg;
    if (capacityKg > vehicle.capacityKg) {
      throw new GlosError('INVALID_INPUT', `${vehicle.plate} holds ${vehicle.capacityKg} kg — you cannot sell ${Math.round(capacityKg)} kg on it`);
    }
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

    /*
     * HOW THEY GET PAID, said rather than assumed.
     *
     * Both halves or neither, like the waiting terms: "cash" with no moment is half a sentence, and a
     * moment with no method is the other half. Absent is a real state for runs declared before this
     * existed, and the screens say the fleet has not said rather than guessing on their behalf.
     */
    const method = String(input.settleMethod ?? '');
    const when = String(input.settleWhen ?? '');
    let settle: SettleTerms | undefined;
    if (method || when) {
      if (!SETTLE_METHODS.includes(method as never)) throw new GlosError('INVALID_INPUT', `Say how you take payment: ${SETTLE_METHODS.join(', ')}`);
      if (!SETTLE_WHEN.includes(when as never)) throw new GlosError('INVALID_INPUT', `Say when you are paid: ${SETTLE_WHEN.join(', ')}`);
      settle = { method: method as SettleTerms['method'], when: when as SettleTerms['when'] };
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
      vehicleId: vehicle.vehicleId,
      plate: vehicle.plate,
      vehicleClass: vehicle.vehicleClass,
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
      ...(settle ? { settle } : {}),
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
      kind: 'sold',
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
    // The fleet office learns its space went, without having to sit on the screen watching for it.
    void this.events
      .publish(
        GlosEvent.Pudo.DepartureBooked,
        { departureId: departure.departureId, bookingId: booking.bookingId, managerDid: departure.managerDid, lineName: departure.lineName, shipperDid: input.shipperDid, description: booking.description, weightKg: booking.weightKg, price: booking.price, currency: departure.rate.currency },
        { source: 'pudo' },
      )
      .catch(() => undefined);
    return { departure, booking };
  }

  /**
   * F4 — THE WORK THE FLEET ALREADY HAD.
   *
   * A haulier does not arrive at this network empty. It arrives with a book of customers it has been
   * carrying for years, and until now there was nowhere to put them: the only way a load got onto a truck
   * here was for somebody to buy it through us. So the network saw a vehicle and never the work on it,
   * and the remaining-space figure on every offer was an advertisement rather than a fact.
   *
   * THIS IS WHAT MAKES F3 HONEST. A fleet with existing customers had two options and both were bad —
   * stay off the offer list entirely, or publish six tonnes while four of them are already spoken for.
   * The second one ends with a shipper standing at a gate beside a full truck, and it would have been our
   * number that put them there.
   *
   * WHAT THIS DELIBERATELY IS NOT: a sale. Nothing is quoted, no money is taken, no ledger moves, and the
   * customer needs no account — they are the fleet's, settled between the two of them the way they always
   * were. We are being told a load exists so the arithmetic stops lying. That is the whole transaction,
   * and it is also the reason a fleet in a country where we cannot yet bank anyone can use this at all.
   */
  addOwnLoad(
    departureId: string,
    managerDid: string,
    input: { customer: string; description: string; weightKg: number; volumeM3?: number; charge?: number },
  ): { departure: Departure; booking: DepartureBooking } {
    const departure = this.require(departureId);
    if (departure.managerDid !== managerDid) throw new GlosError('FORBIDDEN', 'That is not your departure');

    const customer = String(input.customer ?? '').trim();
    // Required, and not pedantry: an unattributed load is a hole in the capacity that nobody can account
    // for a week later, when the only question anybody asks is whose the four tonnes were.
    if (!customer) throw new GlosError('FIELD_REQUIRED', 'Say whose load this is — your own customer, in whatever name you file them under');
    if (!input.description?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say what it is — the driver is loading it');

    const load = { weightKg: Number(input.weightKg), volumeM3: Number(input.volumeM3) || undefined };
    this.assertBookable(departure, load, 'fleet');

    const { binds } = DepartureService.bindsOn(departure, load);
    // The fleet's own price, kept only because a run sheet that shows half the money is a worse run sheet.
    // We did not quote it and nothing is posted against it — see DepartureBooking.price.
    const charge = Number(input.charge);

    const booking: DepartureBooking = {
      bookingId: `bkg_${randomBytes(5).toString('hex')}`,
      kind: 'own',
      // The fleet is the party answerable to us for what is on their truck, and their customer has no
      // account here to name. It also means the ordinary cancel path already lets them take it off again.
      shipperDid: managerDid,
      customer,
      description: input.description.trim(),
      weightKg: Math.round(load.weightKg * 100) / 100,
      ...(load.volumeM3 ? { volumeM3: Math.round(load.volumeM3 * 100) / 100 } : {}),
      binds,
      price: Number.isFinite(charge) && charge > 0 ? Math.round(charge * 100) / 100 : 0,
      units: 0,
      at: new Date().toISOString(),
      status: 'booked',
      waiting: [],
    };
    departure.bookings = [...departure.bookings, booking];
    this.departures.set(departure.departureId, departure);
    return { departure, booking };
  }

  /**
   * HANDED OVER. The ending this model did not have.
   *
   * A run went open → departed and then stopped. The goods reached a door, somebody took them, and no
   * record of it existed — while the rest of this product is meticulous about custody. The waiting clock
   * made it worse by looking finished: the driver taps at the DELIVERY gate, which proves the truck got
   * there and says nothing about whether the load came off it.
   *
   * RECORDED BY THE DRIVER OR THE FLEET, never the shipper: this is the carrier saying what they did, and
   * a delivery a shipper can mark themselves is not a record of anything. The time is the server's, for
   * the same reason the gate taps are — a typed time is a claim in a dispute.
   *
   * Idempotent. A second tap is not a second delivery, and the first one stands.
   */
  deliver(departureId: string, bookingId: string, by: string, receivedBy?: string): { departure: Departure; booking: DepartureBooking } {
    const departure = this.require(departureId);
    if (by !== departure.driverDid && by !== departure.managerDid) {
      throw new GlosError('FORBIDDEN', 'Only the driver on this run or the fleet that sold it can say a load was handed over');
    }
    if (departure.status === 'cancelled') throw new GlosError('INVALID_STATE', 'That run was called off — nothing on it was delivered');
    const booking = departure.bookings.find((b) => b.bookingId === bookingId);
    if (!booking) throw new GlosError('NOT_FOUND', 'No such booking');
    if (booking.status === 'cancelled') throw new GlosError('INVALID_STATE', 'That booking was cancelled — it was never aboard');
    if (booking.status === 'delivered') return { departure, booking };

    booking.status = 'delivered';
    booking.deliveredAt = new Date().toISOString();
    const named = receivedBy?.trim();
    if (named) booking.receivedBy = named;
    this.departures.set(departure.departureId, departure);

    void this.events
      .publish(
        GlosEvent.Pudo.DepartureDelivered,
        { departureId: departure.departureId, bookingId, managerDid: departure.managerDid, company: departure.company, lineName: departure.lineName, shipperDid: booking.shipperDid, kind: booking.kind, description: booking.description, destZone: departure.destZone, deliveredAt: booking.deliveredAt, ...(named ? { receivedBy: named } : {}) },
        { source: 'pudo' },
      )
      .catch(() => undefined);
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
    if (booking.status === 'delivered') throw new GlosError('INVALID_STATE', 'That load was handed over — it cannot be given back');
    if (departure.status === 'departed') throw new GlosError('INVALID_STATE', 'That run has gone — the goods are on it');
    departure.bookings = departure.bookings.map((b) => (b.bookingId === bookingId ? { ...b, status: 'cancelled' as const } : b));
    this.departures.set(departure.departureId, departure);
    // The space is for sale again, and the fleet is the one who can do something about that.
    void this.events
      .publish(
        GlosEvent.Pudo.DepartureBookingCancelled,
        { departureId: departure.departureId, bookingId, managerDid: departure.managerDid, lineName: departure.lineName, shipperDid: booking.shipperDid, by, description: booking.description },
        { source: 'pudo' },
      )
      .catch(() => undefined);
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
    /*
     * THE PAPERS, WHICH THIS USED TO SKIP.
     *
     * Every other way a driver gets behind a wheel here asks canOperate() first — the coupling refuses a
     * lapsed licence by name. A departure roster is NOT a coupling, so it asked nothing, and a driver
     * whose licence expired last month could be put on a run and stand at a gate recording a charge.
     *
     * The refusal names the paper for the same reason the coupling does: "off the road: Insurance lapsed
     * 3 Sep 2026" is something an office can act on before the truck is due out; "cannot be rostered" is
     * a thing to ring somebody about.
     */
    if (!this.drivers.canOperate(driver.did)) {
      const why = this.drivers.offRoadReasons(driver.did);
      throw new GlosError('CANNOT_COUPLE', why.length ? `${driver.name} cannot drive this run: ${why.join('; ')}` : `${driver.name} is not an active driver`);
    }
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
    /*
     * THE CLOCK RUNS ON THE FLEET'S OWN LOADS. THE PRICE DOES NOT.
     *
     * The driver stood at that gate either way, and the record of it — arrived, free to go, ninety-five
     * minutes — is exactly the evidence the fleet needs to invoice their own customer. So it is kept.
     *
     * What we must not do is put a figure on it. The terms on this departure are the ones the fleet
     * published to the MARKET; a customer they have carried for six years is on whatever they agreed
     * years ago, and we were never told it. Pricing their wait at our rate would put a number on the
     * fleet's own run sheet that is not the number they will send, which is the quiet kind of wrong.
     */
    record.amount = booking.kind === 'own' ? 0 : amount;
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
    // Nothing to let go of: we never charged for this one. Offering to waive a charge that does not exist
    // would tell a fleet they had forgiven something, when what they actually have is a timesheet.
    if (booking.kind === 'own') {
      throw new GlosError('INVALID_STATE', 'That is your own customer — we put no charge on their waiting, so there is nothing here to waive');
    }
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

  /**
   * Stop selling, mark it gone, or call it off. The fleet's own call — and the last of the three is not
   * like the other two.
   *
   * CALLING OFF A LOADED RUN NEEDS A REASON. Closing and departing are housekeeping that change nothing
   * anybody planned around; cancelling breaks a promise to every shipper who arranged their week around
   * a truck. The reason exists because it is the thing they are owed and the only part of the message
   * they can act on — "the run is off" leaves somebody ringing round for a lorry with nothing to tell
   * the next carrier. It is required only when somebody is actually aboard: a fleet tidying away an
   * empty run it declared by mistake is not making a decision about anybody.
   */
  setStatus(departureId: string, status: Departure['status'], managerDid: string, reason?: string): Departure {
    const departure = this.require(departureId);
    if (departure.managerDid !== managerDid) throw new GlosError('FORBIDDEN', 'That is not your departure');

    const aboard = this.shippersAboard(departure);
    const said = reason?.trim();
    if (status === 'cancelled' && aboard.length > 0 && !said) {
      throw new GlosError('FIELD_REQUIRED', 'Say why you are calling it off — everybody with goods on this run is about to be told, and the reason is the only part they can act on');
    }

    const was = departure.status;
    departure.status = status;
    if (status === 'cancelled' && said) departure.cancelledReason = said;
    this.departures.set(departure.departureId, departure);

    // Announced AFTER the write, so nothing downstream can read a run that has not been saved yet.
    if (status !== was) this.announce(departure, status, aboard, said);
    return departure;
  }

  /**
   * Tell the world what happened to a run.
   *
   * `departed` and `cancelled` are both worth saying out loud and for opposite reasons: one is the moment
   * after which nothing can be changed, and the other is the moment somebody has to find another truck.
   * Every publish is fire-and-forget — a notification that fails must never roll back a fleet's decision.
   */
  private announce(departure: Departure, status: Departure['status'], shippers: string[], reason?: string): void {
    const base = {
      departureId: departure.departureId,
      lineName: departure.lineName,
      company: departure.company,
      managerDid: departure.managerDid,
      originZone: departure.originZone,
      destZone: departure.destZone,
      leavesAt: departure.leavesAt,
      shippers,
    };
    if (status === 'cancelled') {
      void this.events.publish(GlosEvent.Pudo.DepartureCancelled, { ...base, reason: reason ?? '' }, { source: 'pudo' }).catch(() => undefined);
    } else if (status === 'departed') {
      void this.events.publish(GlosEvent.Pudo.DepartureDeparted, base, { source: 'pudo' }).catch(() => undefined);
    }
  }

  /**
   * The parties with goods on this run, each once.
   *
   * The fleet's OWN loads are excluded even though they carry a shipperDid: it is the fleet's own, they
   * are the ones doing the telling, and a cancellation notice about your own decision is noise.
   */
  private shippersAboard(departure: Departure): string[] {
    return [...new Set(departure.bookings.filter((b) => b.status === 'booked' && b.kind === 'sold').map((b) => b.shipperDid))];
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
          ...(d.settle ? { settle: d.settle } : {}),
          ...(d.km ? { km: d.km } : {}),
          ...(d.note ? { note: d.note } : {}),
          vehicleClass: d.vehicleClass,
          remainingKg: left.kg,
          ...(left.m3 != null ? { remainingM3: left.m3 } : {}),
          booked: d.bookings.filter((b) => b.status === 'booked').length,
        };
      })
      .filter((o) => o.remainingKg > 0 && (o.remainingM3 == null || o.remainingM3 > 0))
      .sort((a, b) => a.leavesAt.localeCompare(b.leavesAt));
  }

  /**
   * EVERYTHING THIS SHIPPER HAS BOOKED, newest departure first.
   *
   * Cancelled bookings and finished runs stay in the list. A shipper's own history is the one place that
   * must not be tidied: "did I book that Tuesday truck or only think about it" is a real question, and a
   * list that only shows live rows answers it wrongly and confidently.
   *
   * The fleet's OWN loads are excluded by construction — they carry the fleet as shipperDid, and a fleet
   * manager opening a shipper's screen should not find their own customers filed as things they booked.
   */
  forShipper(shipperDid: string): MyDepartureBooking[] {
    return this.list()
      .flatMap((d) =>
        d.bookings
          .filter((b) => b.kind === 'sold' && b.shipperDid === shipperDid)
          .map((b) => ({
            bookingId: b.bookingId,
            departureId: d.departureId,
            company: d.company,
            lineName: d.lineName,
            originZone: d.originZone,
            destZone: d.destZone,
            leavesAt: d.leavesAt,
            description: b.description,
            weightKg: b.weightKg,
            ...(b.volumeM3 != null ? { volumeM3: b.volumeM3 } : {}),
            price: b.price,
            currency: d.rate.currency,
            bookingStatus: b.status,
            runStatus: d.status,
            ...(d.cancelledReason ? { cancelledReason: d.cancelledReason } : {}),
            ...(b.deliveredAt ? { deliveredAt: b.deliveredAt } : {}),
            ...(b.receivedBy ? { receivedBy: b.receivedBy } : {}),
            ...(d.waiting ? { waiting: d.waiting } : {}),
            ...(d.settle ? { settle: d.settle } : {}),
            waits: b.waiting,
            // The same rule cancelBooking enforces, said here so a screen can hide a button that
            // could only ever produce a refusal.
            cancellable: b.status === 'booked' && d.status !== 'departed' && d.status !== 'cancelled',
            at: b.at,
          })),
      )
      .sort((a, b) => b.leavesAt.localeCompare(a.leavesAt));
  }

  list(): Departure[] {
    return [...this.departures.values()];
  }

  require(departureId: string): Departure {
    const departure = this.departures.get(departureId);
    if (!departure) throw new GlosError('NOT_FOUND', 'No such departure');
    return departure;
  }

  /**
   * Everything that would make a booking a lie, asked in the order a person would ask it.
   *
   * `by` changes exactly one answer: WHICH STATUSES STILL TAKE A LOAD. A closed run is closed to the
   * market and not to the fleet that owns it — closed means "I have stopped selling", not "the truck is
   * full", and a fleet that closed the offer precisely because it is filling the rest with its own work
   * is the ordinary case rather than an edge one. Departed and cancelled refuse either way: one has gone
   * and the other is not happening.
   */
  private assertBookable(departure: Departure, load: { weightKg: number; volumeM3?: number }, by: 'shipper' | 'fleet' = 'shipper'): void {
    // Asked on every booking, not only at declaration: a run sold last week is still being booked onto
    // today, and the country it runs in can have been wound down in between.
    this.requireOperating(this.managers.get(departure.managerDid)?.jurisdiction);
    const takesLoads: Departure['status'][] = by === 'fleet' ? ['open', 'closed'] : ['open'];
    if (!takesLoads.includes(departure.status)) throw new GlosError('INVALID_STATE', `That departure is ${departure.status}`);
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

  /**
   * WHAT CURRENCY THIS FLEET PRICES IN, and whether we are guessing.
   *
   * A fleet's jurisdiction is optional at registration, so "no country named" is a real state and the
   * fallback to USD is a real guess. That guess is dangerous in exactly one place: a Kenyan fleet types
   * 450 meaning shillings, we publish 450 USD, and a shipper books a run at a hundred and thirty times
   * the price. Nobody finds out until the invoice.
   *
   * So the guess is still made — refusing to sell space because a legacy record lacks a field would be
   * worse — but it is LABELLED, and the form that asks for a price says which currency it is asking in.
   * An assumption a person can see is not the same thing as a silent one.
   */
  pricingCurrency(managerDid: string): { currency: string; assumed: boolean } {
    const jurisdiction = this.managers.get(managerDid)?.jurisdiction;
    const known = jurisdiction ? catalogueEntry(jurisdiction)?.currency : undefined;
    return known ? { currency: known, assumed: false } : { currency: 'USD', assumed: true };
  }

  /**
   * May this fleet move goods where it stands?
   *
   * `takeIn` and not `merchantOfRecord`, deliberately. Selling space on a truck settles between the fleet
   * and the shipper — we are not the merchant of record for it and take no cut — so the question is the
   * one the freight doors ask: may goods move here at all. A country where we only MATCH is exactly where
   * this feature is most valuable, and gating it on a sister company would lock it out of them.
   */
  private requireOperating(jurisdiction: string | undefined): void {
    /*
     * A FLEET WITH NO COUNTRY ON ITS RECORD IS NOT A FLEET IN A COUNTRY WE REFUSE.
     *
     * Found by driving this: jurisdiction is optional at registration, so plenty of real fleets have
     * none — and presence answers `observed` for an unknown country, which grants nothing. The gate as
     * first written therefore refused them all, with "the network does not operate in undefined", which
     * is both untrue and unactionable.
     *
     * This gate is about countries we have DECIDED not to reach. Where nobody has said which country it
     * is we have not decided anything, so there is nothing here to enforce — the incomplete record is a
     * real problem and it is already surfaced where it bites, on the price field, which says out loud
     * that the currency is a guess. Refusing the run instead would be the wrong screen and the wrong
     * sentence for the same defect.
     */
    if (!jurisdiction) return;
    if (!this.presence.can(jurisdiction, 'takeIn')) {
      throw new GlosError('FORBIDDEN', `The network does not operate in ${jurisdiction} yet, so space cannot be sold on a run there`);
    }
  }

  /** The country's own currency — always answerable, including where no company of ours stands. */
  private currencyFor(jurisdiction?: string): string {
    return (jurisdiction && catalogueEntry(jurisdiction)?.currency) || 'USD';
  }
}
