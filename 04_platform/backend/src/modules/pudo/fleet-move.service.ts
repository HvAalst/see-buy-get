import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { AuthService } from '../../foundation/auth/auth.service';
import { AccountService } from './account.service';
import { DepartureService } from './departure.service';
import { DispatchService } from './dispatch.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetService } from './fleet.service';
import { ParcelService } from './parcel.service';
import { PersonService } from './person.service';
import { VehicleService } from './vehicle.service';
import { betweenFleets } from './driver.service';
import { TRUCK_SUBTYPE_CATALOG, type TruckSubtype, type VehicleClass } from './fleet.config';
import type { CourierAsk, FleetDriver, FleetRemovalReason, Vehicle } from './fleet.types';

/** What riding for themselves would take, said to the driver before anything is asked of them. */
export interface RideAloneTerms {
  /** Whether it can be done from the app at all — and when not, the sentence that says why. */
  offered: boolean;
  why?: string;
  /** What they are cleared to ride: the vehicle of their own has to be one of these. */
  classes: VehicleClass[];
  /** Where a courier can register, and the company of ours that would contract them there (none where we only match). */
  countries: Array<{ jurisdiction: string; companyName?: string }>;
  /**
   * Whether staff check them first: anything heavier than a motorcycle on their licence, as for anybody signing up on
   * one. Then the ask carries a photograph of their ID and of their licence, and they ride once two things are true:
   * staff read both, and staff checked their record.
   */
  check: boolean;
  /** An ask already with staff: what they asked for, and when. Nothing else can be asked while it waits. */
  waiting?: { country: string; vehicleClass: VehicleClass; plate: string; askedAt: string };
  /** Why the last ask was refused, in staff’s words. They may ask again. */
  refused?: { reason: string; at: string };
  /** A truck is registered with its body: the ones there are, when a truck is among what they may ride. */
  bodies?: Array<{ id: string; label: string }>;
}

/** What a fleet's own words may say when it takes a driver off: why, in a sentence the driver is shown. */
export const REMOVAL_REASONS: readonly FleetRemovalReason[] = ['left', 'ended', 'other'];

/**
 * A DRIVER CHANGES FLEET — the mechanics, whoever decided it.
 *
 * There are exactly two ways in and one way out, and none of them is a code:
 *   - IN: a fleet offers a place to a driver already registered, and THAT driver says yes from their own sign-in
 *     (FleetOfferService). The fleet decides who; the driver decides whether.
 *   - IN: a fleet adds a new driver itself (drivers/onboard) — a registration, not a move.
 *   - OUT: the fleet takes a driver off.
 *   - OUT: the driver leaves, by themselves, from their own sign-in — once their shift has ended and nothing is in
 *     their hands. No office is asked: a driver who had to be let go could be kept.
 *   - AND ON THEIR OWN: a driver who is in no fleet rides for themselves (rideAlone) — at once on a bicycle or a
 *     motorcycle, as anybody signing up on one would be. The sign-up itself refuses them, rightly: their ID, their
 *     number and their licence are already theirs, on the record they keep.
 *
 * It used to be "type the fleet's join code". That code also names the company at its own console sign-in, it is
 * handed round a depot, it never expires, and it is six characters of hexadecimal — so anybody who guessed it,
 * or was once shown it, could put themselves on a fleet's trucks, licence and insurance. A shared code can say
 * WHICH fleet. It cannot say WHO may join it.
 *
 * REFUSED WHILE ANYTHING IS UNFINISHED, both ways: a load in hand, a run of the fleet's still to go or with goods
 * aboard (and, for a driver choosing to move, a shift running). Stop new commitments, never the finishing of old
 * ones: the shippers on those planned around this driver.
 *
 * WHAT MOVES AND WHAT STAYS. Everything keyed to the driver goes with them — papers, trips, ratings, badge. What a
 * fleet did stays that fleet's: every haul carries the carrier it was taken for (Freight.carrierDid), so its
 * earnings statement, its track record and its consignment notes are untouched. The sign-in follows: the person
 * link and the email account are re-pointed, and every session the driver holds ends, because each carries the
 * old fleet as its tenant.
 */
@Injectable()
export class FleetMoveService {
  constructor(
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    private readonly fleet: FleetService,
    private readonly dispatch: DispatchService,
    private readonly departures: DepartureService,
    private readonly parcels: ParcelService,
    private readonly persons: PersonService,
    private readonly accounts: AccountService,
    private readonly auth: AuthService,
    private readonly events: EventBus,
    private readonly vehicles: VehicleService,
  ) {}

  /** What a driver has to finish before they may move to another fleet — as sentences they can act on. Empty: free to go. */
  blockersFor(driverDid: string, now: number = Date.now()): string[] {
    const out: string[] = [];
    if (this.fleet.activeForDriver(driverDid)) out.push('you are on a shift — end it first');
    out.push(...this.inHand(driverDid, now));
    return out;
  }

  /**
   * JOIN a fleet — called only once that fleet's offer was accepted by the driver themselves. Refused by name while
   * anything is unfinished. Returns the driver as they now stand.
   */
  join(driverDid: string, fleetDid: string, now: number = Date.now()): { driver: FleetDriver; companyName: string } {
    const target = this.managers.requireActive(fleetDid);
    const before = this.drivers.get(driverDid);
    if (before.managerDid === fleetDid) throw new GlosError('INVALID_STATE', `You already drive for ${target.companyName}`);
    const blockers = this.blockersFor(driverDid, now);
    if (blockers.length) throw new GlosError('INVALID_STATE', `Finish this first: ${blockers.join('; ')}`, { blockers });

    const from = before.managerDid;
    const driver = this.drivers.setFleet(driverDid, fleetDid);
    this.repoint(driverDid, fleetDid);
    void this.events
      .publish(
        GlosEvent.Pudo.DriverChangedFleet,
        { driverDid, driverName: driver.displayName, ...(from ? { fromManagerDid: from } : {}), toManagerDid: fleetDid, toCompany: target.companyName },
        { source: 'pudo' },
      )
      .catch(() => undefined);
    return { driver, companyName: target.companyName };
  }

  /**
   * THE FLEET TAKES A DRIVER OFF. The office's own decision about its own roster, with a reason the driver is shown.
   *
   * A shift with nothing aboard simply ends — the truck is the fleet's and so is the decision. A load in the driver's
   * hands, or a run of the fleet's they are on, is refused by name: goods are somebody's, and a fleet that wants a
   * driver gone still has to get its loads home and its runs crewed first.
   *
   * Afterwards they are BETWEEN FLEETS: everything that is theirs stays theirs, and they cannot start a shift until
   * a fleet offers them a place.
   */
  remove(fleetDid: string, driverDid: string, input: { reason: FleetRemovalReason; note?: string; by?: string }, now: number = Date.now()): FleetDriver {
    const company = this.managers.get(fleetDid).companyName;
    const driver = this.drivers.get(driverDid);
    if (driver.managerDid !== fleetDid) throw new GlosError('FORBIDDEN', 'That driver is not in your fleet');
    if (!REMOVAL_REASONS.includes(input.reason)) throw new GlosError('VALIDATION_FAILED', 'Say why: they left, you ended it, or in your own words', { field: 'reason' });
    const note = input.note?.trim();
    if (input.reason === 'other' && !note) throw new GlosError('REASON_REQUIRED', 'Say why in your own words — the driver is shown it', { field: 'note' });

    const blockers = this.inHand(driverDid, now, driver.displayName);
    if (blockers.length) throw new GlosError('INVALID_STATE', `Not yet: ${blockers.join('; ')}`, { blockers });

    if (this.fleet.activeForDriver(driverDid)) this.fleet.uncouple(driverDid);
    const at = new Date(now).toISOString();
    const left = this.drivers.leaveFleet(driverDid, { fleetDid, companyName: company, reason: input.reason, ...(note ? { note } : {}), at, ...(input.by ? { by: input.by } : {}) });
    this.repoint(driverDid, undefined);
    void this.events
      .publish(
        GlosEvent.Pudo.DriverLeftFleet,
        { driverDid, driverName: left.displayName, fleetDid, companyName: company, reason: input.reason, ...(note ? { note } : {}), ...(input.by ? { by: input.by } : {}) },
        { source: 'pudo' },
      )
      .catch(() => undefined);
    return left;
  }

  /**
   * THE DRIVER LEAVES, BY THEMSELVES. Their own decision about who they drive for, from their own sign-in.
   *
   * TWO CONDITIONS AND NO THIRD: their shift has ended, and nothing is in their hands — a load, a bag, parcels handed
   * to them at a counter, or a run that has left with goods aboard. Whatever stands is said by name, and they finish
   * it first: the goods are somebody's.
   *
   * NOT A CONDITION: the office's leave. A run of the fleet's that has NOT left yet does not hold them — they are
   * taken off it and the office is told which, so it can put somebody else on. (A driver saying yes to ANOTHER
   * fleet's offer is still refused while rostered, as before: that rule is older than this one and was not asked to
   * change. It no longer holds anybody, since they can leave first and say yes after.)
   *
   * Afterwards they are between fleets exactly as a driver a fleet took off is: everything that is theirs stays
   * theirs, and they cannot start a shift until a fleet offers them a place.
   */
  leave(driverDid: string, now: number = Date.now()): { driver: FleetDriver; companyName: string; runs: string[] } {
    const driver = this.drivers.get(driverDid);
    const fleetDid = driver.managerDid;
    if (!fleetDid) throw new GlosError('INVALID_STATE', 'You are not in a fleet');
    const company = this.managers.get(fleetDid).companyName;

    const blockers: string[] = [];
    if (this.fleet.activeForDriver(driverDid)) blockers.push('you are on a shift — end it first');
    blockers.push(...this.cargoInHand(driverDid));
    const underway = this.departures.forDriver(driverDid).filter((d) => d.status === 'departed' && d.bookings.some((b) => b.status === 'booked'));
    if (underway.length === 1) blockers.push(`the ${underway[0].lineName} run has left with goods aboard — finish it first`);
    else if (underway.length > 1) blockers.push(`${underway.length} of your runs have left with goods aboard — finish them first`);
    if (blockers.length) throw new GlosError('INVALID_STATE', `Finish this first: ${blockers.join('; ')}`, { blockers });

    const runs = this.departures.takeOffRuns(driverDid).map((d) => d.lineName);
    const at = new Date(now).toISOString();
    const left = this.drivers.leaveFleet(driverDid, { fleetDid, companyName: company, reason: 'own', at });
    this.repoint(driverDid, undefined);
    void this.events
      .publish(GlosEvent.Pudo.DriverLeftFleet, { driverDid, driverName: left.displayName, fleetDid, companyName: company, reason: 'own', ...(runs.length ? { runs } : {}) }, { source: 'pudo' })
      .catch(() => undefined);
    return { driver: left, companyName: company, runs };
  }

  /**
   * WHY THIS DRIVER CANNOT BECOME A COURIER FROM THE APP, as a sentence they can act on — or nothing, when they can.
   *
   * The rule is the one a stranger signing up meets, no stricter and no looser: a bicycle or a motorcycle starts at
   * once; anything heavier is checked by network staff first. A fleet's driver has not been through THAT check as a
   * courier, and the app has no way to ask for it yet, so it says so instead of offering a button that would refuse.
   */
  private rideAloneBlock(driver: FleetDriver): string | null {
    if (driver.managerDid) return `You drive for ${this.managers.get(driver.managerDid).companyName}. Leave that fleet first: “Your fleet”, under your name`;
    if (!betweenFleets(driver)) return 'You already ride for yourself';
    if (driver.status === 'SUSPENDED') return 'Your driver account is suspended, so this cannot be done from here';
    if (driver.idHold) return `The national ID on your registration went to somebody else (reference ${driver.idHold.reference}). Put the number of your own ID card on record first, in Settings`;
    if (driver.status !== 'ACTIVE') return 'Your registration has not been checked by the network yet, so this cannot be done from here';
    return null;
  }

  /** What it would take, for the sheet that offers it. Reads only: asking changes nothing. */
  rideAloneTerms(driverDid: string): RideAloneTerms {
    const driver = this.drivers.get(driverDid);
    const why = this.rideAloneBlock(driver);
    const check = driver.registry === 'heavy';
    const refused = driver.courierAskRefusal ? { refused: { reason: driver.courierAskRefusal.reason, at: driver.courierAskRefusal.at } } : {};
    if (!why && driver.courierAsk) {
      const { country, vehicleClass, plate, askedAt } = driver.courierAsk;
      return { offered: false, check, waiting: { country, vehicleClass, plate, askedAt }, classes: [], countries: [] };
    }
    const bodies = !why && driver.licence.classes.includes('truck') ? { bodies: Object.entries(TRUCK_SUBTYPE_CATALOG).map(([id, s]) => ({ id, label: s.label })) } : {};
    return { offered: !why, ...(why ? { why } : {}), check, ...refused, ...bodies, classes: why ? [] : [...driver.licence.classes], countries: why ? [] : this.drivers.courierCountries() };
  }

  /**
   * A DRIVER WHO IS IN NO FLEET RIDES FOR THEMSELVES — the user, 2026-10-12: "they should become courier at once if
   * a bike or motorcycle."
   *
   * Until this a driver a fleet took off, or who left one, had exactly one way back onto the road: another fleet's
   * offer. Signing up again as a courier was refused, because their ID, number and licence are already registered —
   * to them. So it is the SAME record that becomes a courier's: their trips, papers, rating and badge are theirs
   * already and nothing is registered twice.
   *
   * WHAT A COURIER HAS THAT A FLEET'S DRIVER NEVER DID, asked for here: where they legally reside — which decides
   * the company of ours that contracts them — and a vehicle of their own, of a class they are cleared for.
   *
   * THE VEHICLE IS REGISTERED FIRST. It is the one step that can still be refused once the questions are answered,
   * and a refusal must leave them exactly as they were: in no fleet, and not half a courier.
   */
  rideAlone(
    driverDid: string,
    input: { country: string; vehicleClass: VehicleClass; plate: string; truckSubtype?: TruckSubtype; idCopyRef?: string; licenceCopyRef?: string },
    now: number = Date.now(),
  ): { driver: FleetDriver; vehicle?: Vehicle; companyName?: string; asked?: CourierAsk } {
    const driver = this.drivers.get(driverDid);
    const why = this.rideAloneBlock(driver);
    if (why) throw new GlosError('INVALID_STATE', why);
    if (driver.courierAsk) throw new GlosError('INVALID_STATE', 'You have asked already: the network is checking your papers, and you are told here when it decides');
    const country = (input.country ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new GlosError('FIELD_REQUIRED', 'Say which country you live in: it decides which company you ride for');
    const where = this.drivers.courierCountries().find((c) => c.jurisdiction === country);
    if (!where) throw new GlosError('FORBIDDEN', `The network does not operate in ${country} yet, so a courier cannot register there`);
    if (!driver.licence.classes.includes(input.vehicleClass)) {
      throw new GlosError('CANNOT_COUPLE', `You are not licence-cleared for a ${input.vehicleClass}. Choose a vehicle you are cleared for`);
    }
    if (input.vehicleClass === 'truck' && !TRUCK_SUBTYPE_CATALOG[input.truckSubtype as TruckSubtype]) {
      throw new GlosError('FIELD_REQUIRED', 'Say what body your truck has: flatbed, tipper, refrigerated…');
    }
    // ANYTHING HEAVIER THAN A MOTORCYCLE ON THEIR LICENCE: an ask, read by staff before they ride — refused before
    // anything is written, and nothing about them changes while it waits.
    if (driver.registry === 'heavy') {
      if (!input.plate?.trim()) throw new GlosError('FIELD_REQUIRED', 'A number plate is required');
      const asked = this.drivers.askToRideAlone(driverDid, {
        country,
        vehicleClass: input.vehicleClass,
        plate: input.plate.trim().toUpperCase(),
        ...(input.vehicleClass === 'truck' ? { truckSubtype: input.truckSubtype } : {}),
        idCopyRef: input.idCopyRef ?? '',
        licenceCopyRef: input.licenceCopyRef ?? '',
      }, now);
      return { driver: asked, asked: asked.courierAsk, ...(where.companyName ? { companyName: where.companyName } : {}) };
    }
    // Theirs, and nobody else's: no fleet, and the courier recorded as the one who owns and drives it.
    const vehicle = this.vehicles.register({ plate: input.plate, vehicleClass: input.vehicleClass, managerDid: undefined, ownerType: 'driver_owned', ownerName: driver.displayName, ownerDriverDid: driverDid, country } as never);
    const rides = this.drivers.rideAlone(driverDid, country);
    // On their screen from the first morning: the vehicle list is a history, and they have none of their own yet.
    this.fleet.claimOwnVehicle(driverDid, vehicle.vehicleId);
    return { driver: rides, vehicle, ...(where.companyName ? { companyName: where.companyName } : {}) };
  }

  /**
   * STAFF DECIDE AN ASK TO RIDE FOR THEMSELVES — the check a van or truck courier signing up meets, no looser.
   *
   * Approving takes what vetting takes, by the member of staff who looked: they read the ID and the licence (on the
   * row, not behind a tap), and THEY tick that the record check is clear — a fleet said so of its own driver once, and
   * a fleet's word is not the network's check of somebody it is about to contract with directly. The licence must not
   * have lapsed. The vehicle is registered FIRST, so a refusal there leaves the driver as they were; then the record
   * they have becomes a courier's, exactly as a rider's does at once.
   *
   * Refusing takes a reason, which the driver reads. They stay in no fleet, and may ask again.
   */
  decideRideAlone(driverDid: string, input: { approve: boolean; by?: string; reason?: string; criminalRecordClear?: boolean }, now: number = Date.now()): FleetDriver {
    const driver = this.drivers.get(driverDid);
    const ask = driver.courierAsk;
    if (!ask) throw new GlosError('INVALID_STATE', `${driver.displayName} has not asked to ride for themselves, or the ask was already decided`);
    const at = new Date(now).toISOString();
    if (!input.approve) {
      const reason = input.reason?.trim();
      if (!reason) throw new GlosError('REASON_REQUIRED', 'A refusal must say why: the driver is shown it');
      const closed = this.drivers.closeCourierAsk(driverDid, { reason, at, ...(input.by ? { by: input.by } : {}) });
      this.tellRideAlone(closed, false, reason);
      return closed;
    }
    if (!input.criminalRecordClear) throw new GlosError('APPROVAL_BLOCKED', 'Tick that you checked their record and it is clear: a courier is checked by the network itself');
    if (driver.licence.expiresAt && Date.parse(driver.licence.expiresAt) <= now) throw new GlosError('APPROVAL_BLOCKED', 'Cannot approve: the driving licence has expired');
    const why = this.rideAloneBlock(driver);
    if (why) throw new GlosError('INVALID_STATE', why);
    if (!this.drivers.courierCountries().some((c) => c.jurisdiction === ask.country)) {
      throw new GlosError('FORBIDDEN', `The network does not operate in ${ask.country} any more, so a courier cannot be registered there`);
    }
    const vehicle = this.vehicles.register({ plate: ask.plate, vehicleClass: ask.vehicleClass, ...(ask.truckSubtype ? { truckSubtype: ask.truckSubtype } : {}), managerDid: undefined, ownerType: 'driver_owned', ownerName: driver.displayName, ownerDriverDid: driverDid, country: ask.country } as never);
    this.drivers.recordCourierCheck(driverDid, { idCopyRef: ask.idCopyRef, licenceCopyRef: ask.licenceCopyRef, at: ask.askedAt });
    this.drivers.rideAlone(driverDid, ask.country);
    this.fleet.claimOwnVehicle(driverDid, vehicle.vehicleId);
    const rides = this.drivers.closeCourierAsk(driverDid);
    this.tellRideAlone(rides, true);
    return rides;
  }

  private tellRideAlone(driver: FleetDriver, approved: boolean, reason?: string): void {
    const companyName = approved && driver.entityId ? this.drivers.courierCountries().find((c) => c.jurisdiction === driver.jurisdiction)?.companyName : undefined;
    void this.events
      .publish(GlosEvent.Pudo.DriverRideAloneDecided, { did: driver.did, approved, ...(reason ? { reason } : {}), ...(companyName ? { companyName } : {}) }, { source: 'pudo' })
      .catch(() => undefined);
  }

  /**
   * The sign-in follows the driver: the person link and the email account now name the new fleet (or none), and
   * every token already issued to this driver — each of which carries the OLD fleet as its tenant — ends. Keyed to
   * the driver, not the person: the same person's shop or consumer sign-in has nothing to do with this.
   */
  private repoint(driverDid: string, tenant: string | undefined): void {
    this.persons.retenant('driver', driverDid, tenant);
    this.accounts.retenant(driverDid, tenant);
    this.auth.revokeAll(driverDid);
  }

  /**
   * Loads in the driver's hands and runs of their fleet's still to go — said to the driver, or, given `about` (their
   * name), to the office that wants them gone.
   */
  private inHand(driverDid: string, now: number, about?: string): string[] {
    const out: string[] = this.cargoInHand(driverDid, about);
    const runs = this.departures.unfinishedFor(driverDid, now);
    if (runs.length === 1) out.push(about ? `${about} is on the ${runs[0].lineName} run — put somebody else on it first` : `you are on the ${runs[0].lineName} run — your fleet office has to take you off it`);
    else if (runs.length > 1) out.push(about ? `${about} is on ${runs.length} of your runs — put somebody else on them first` : `you are on ${runs.length} of your fleet's runs — your fleet office has to take you off them`);
    return out;
  }

  /**
   * What is physically in the driver's hands: loads and bags, and the parcels handed to them over a counter. The
   * last were counted by nobody — a driver holding parcels a shop had scanned to their badge was "carrying nothing",
   * and could be taken off a fleet, or move to another, with them in the van.
   */
  private cargoInHand(driverDid: string, about?: string): string[] {
    const out: string[] = [];
    const cargo = this.dispatch.activeCargo(new Set([driverDid])).items;
    if (cargo.length === 1) out.push(about ? `${about} is carrying ${cargo[0].ref} — it has to be delivered or handed back` : `you are carrying ${cargo[0].ref} — deliver it or hand it back`);
    else if (cargo.length > 1) out.push(about ? `${about} is carrying ${cargo.length} loads — they have to be delivered or handed back` : `you are carrying ${cargo.length} loads — deliver them or hand them back`);
    const loose = this.parcels.onBusWith(this.drivers.get(driverDid).badgeId).length;
    if (loose === 1) out.push(about ? `${about} is carrying a parcel a shop handed over — it has to be delivered first` : 'you are carrying a parcel a shop handed you — deliver it first');
    else if (loose > 1) out.push(about ? `${about} is carrying ${loose} parcels shops handed over — they have to be delivered first` : `you are carrying ${loose} parcels shops handed you — deliver them first`);
    return out;
  }
}
