import { Inject, Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { ToteService } from './tote.service';
import { GeoPoint, Tote } from './pudo.types';
import { FleetService } from './fleet.service';
import { CargoService } from './cargo.service';
import { CargoNature, Equipment, VehicleCapability } from './cargo.types';
import { VendorService } from './vendor.service';
import { RatingService, belowFloor } from './rating.service';
import { WalletGateService } from './wallet-gate.service';
import { clampMultiplier, computeFreightPrice, freightMultiplier, shipperCharge, type PriceBreakdown } from './pricing';
import { isTempBreach, loadSafetyItems, missingKeys, requiredLoadKeys, requiredUnloadKeys, tempBand, unloadSafetyItems } from './heavy-cargo';
import { MediaService } from './media.service';
import { MarketPulseStore } from './market-pulse.store';
import { DEFAULT_MAX_MULTIPLIER, DEFAULT_MIN_MULTIPLIER, toteCapacityOf, VEHICLE_SPEC } from './fleet.config';
import { Router, ROUTER } from './router';
import { DEFAULT_PRICE_PER_KM, DISPATCH_MAX_DETOUR_KM, DISPATCH_MAX_PICKUP_MIN, FREIGHT_NOSHOW_GRACE_H, NETWORK_CURRENCY, NUDGE_RADIUS_KM, OFFER_TTL_MIN, TOTE_MAX_WAIT_H, VEHICLE_SPEED_KMH } from './pudo.config';
import { hashPhone } from '../../foundation/identity/phone';
import { Vehicle } from './fleet.types';
import { Claimable, ClaimableKind, Freight, FreightShipmentView, FreightStatus, Offer, RoutePlan } from './dispatch.types';
import { paginate, textMatch, toCsv, withinDates, type Page } from './query';

/* --------------------- driver jobs + earnings register (R5) — a driver's freight hauls -------------- */

/** A driver's "jobs" are the dedicated-freight hauls they CLAIMED (Freight.claimedBy === driverDid); each
 *  carries the driver's agreed earning (lockedPrice, locked at claim) and whether it has been paid out.
 *  Totes are excluded — they are unpriced to the driver (they settle on the parcel model). */
export interface DriverJobsQuery {
  q?: string; // job code / description / destination / tracking / order ref
  status?: FreightStatus;
  paid?: 'paid' | 'unpaid'; // the driver payout for this job
  from?: string; // ISO or YYYY-MM-DD (inclusive)
  to?: string;
  sort?: 'newest' | 'oldest' | 'earn_desc' | 'earn_asc';
  limit?: number | string;
  offset?: number | string;
}

export interface DriverJobRow {
  freightId: string;
  code: string;
  description: string;
  destLabel: string;
  status: FreightStatus;
  cargoClass: string;
  weightKg: number;
  earning?: number; // lockedPrice — the driver's agreed pay for the haul
  paid: boolean; // driverPaid
  claimedAt?: string;
  deliveredAt?: string;
  createdAt: string;
}

/** The date a job is filed under in the register — when the driver CLAIMED it (falls back to creation). */
function jobDate(f: Freight): string {
  return f.claimedAt ?? f.createdAt;
}

export function driverJobRowOf(f: Freight): DriverJobRow {
  return { freightId: f.freightId, code: f.code, description: f.description, destLabel: f.destLabel, status: f.status, cargoClass: f.cargoClass, weightKg: f.weightKg, earning: f.lockedPrice, paid: Boolean(f.driverPaid), claimedAt: f.claimedAt, deliveredAt: f.deliveredAt, createdAt: f.createdAt };
}

export interface DriverJobsSummary {
  earned: number; // sum of the agreed earning over the set
  paid: number; // of that, what has been paid out
  unpaid: number; // earned - paid (still owed)
  delivered: number; // jobs completed
  count: number;
}

export function driverJobsSummaryOf(rows: Freight[]): DriverJobsSummary {
  let earned = 0;
  let paid = 0;
  let delivered = 0;
  for (const f of rows) {
    const e = f.lockedPrice ?? 0;
    earned += e;
    if (f.driverPaid) paid += e;
    if (f.status === 'delivered') delivered += 1;
  }
  earned = Math.round(earned * 100) / 100;
  paid = Math.round(paid * 100) / 100;
  return { earned, paid, unpaid: Math.round((earned - paid) * 100) / 100, delivered, count: rows.length };
}

function driverJobSort(sort?: DriverJobsQuery['sort']): (a: Freight, b: Freight) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => jobDate(a).localeCompare(jobDate(b));
    case 'earn_desc':
      return (a, b) => (b.lockedPrice ?? 0) - (a.lockedPrice ?? 0);
    case 'earn_asc':
      return (a, b) => (a.lockedPrice ?? 0) - (b.lockedPrice ?? 0);
    default:
      return (a, b) => jobDate(b).localeCompare(jobDate(a)); // newest first
  }
}

/** Filter + search + sort a driver's freight jobs (PURE — restricts to THIS driver's claimed hauls). */
export function filterDriverJobs(rows: Freight[], driverDid: string, q: DriverJobsQuery): Freight[] {
  let out = rows.filter((f) => f.claimedBy === driverDid);
  if (q.status) out = out.filter((f) => f.status === q.status);
  if (q.paid) out = out.filter((f) => (q.paid === 'paid' ? f.driverPaid === true : !f.driverPaid));
  if (q.from || q.to) out = out.filter((f) => withinDates(jobDate(f), q.from, q.to));
  if (q.q) out = out.filter((f) => textMatch([f.code, f.description, f.destLabel, f.trackingKey, f.externalOrderId], q.q));
  return [...out].sort(driverJobSort(q.sort));
}

export function driverJobsToCsv(rows: Freight[]): string {
  return toCsv(
    ['Job', 'Description', 'Destination', 'Status', 'Class', 'Weight kg', 'Earning', 'Currency', 'Paid', 'Claimed', 'Delivered'],
    rows.map((f) => [f.code, f.description, f.destLabel, f.status, f.cargoClass, f.weightKg, f.lockedPrice ?? '', f.lockedPrice == null ? '' : NETWORK_CURRENCY, f.driverPaid ? 'yes' : 'no', f.claimedAt ?? '', f.deliveredAt ?? '']),
  );
}

/**
 * DispatchService — the opportunistic line-haul marketplace (Compendium Ch 19). PUDO agents (and
 * MDPs) bag parcels into totes bound for a destination; a full tote — or one that has waited the max
 * 24 h — is PUBLISHED for claim. A driver declares a route A→B and the platform suggests the loads
 * sitting on the way ("≈5 min from <place>, a shipment is ready — claim it?"), sized to the REMAINING
 * capacity of the driver's coupled vehicle (whose total load the fleet manager set). The driver
 * claims, ignores, or simply doesn't answer — in which case the offer auto-ignores when it lapses.
 */
@Injectable()
export class DispatchService {
  // Durable: a freight job is a real transport obligation (a diverted P4+ order is a paid commitment),
  // so — unlike the ephemeral offer bulletin — it must survive a restart.
  private readonly freights = new PersistentMap<string, Freight>('pudo-freights');
  private readonly offers = new Map<string, Offer>();
  /** Live "decline this one offer" capabilities (see mintDeclineToken). In-memory like the offers they answer. */
  private readonly declineTokens = new Map<string, { offerId: string; expiresAt: number }>();
  private freightSeq = 0;

  constructor(
    private readonly totes: ToteService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly fleet: FleetService,
    private readonly events: EventBus,
    private readonly cargo: CargoService,
    private readonly vendors: VendorService,
    private readonly gate: WalletGateService,
    private readonly market: MarketPulseStore,
    private readonly media: MediaService,
    private readonly ratings: RatingService,
    @Inject(ROUTER) private readonly router: Router,
  ) {
    this.freightSeq = [...this.freights.values()].length; // continue the human FRT-NNN sequence after a restart
  }

  // --- publishing ---

  /**
   * Promote filling totes that are full or have waited ≥ 24 h to 'available' (claimable).
   *
   * A SHOP bag is never promoted here. It is a physical bag on a counter, open until a human shuts it, and
   * publishing it behind the shopkeeper would advertise a bag a driver cannot take — and lock the shop out
   * of the completeness gate, which only accepts a bag that is still filling. So the sweep ASKS instead:
   * one nudge when it fills, one more when it has waited out the clock, and the parcels are never stranded
   * quietly because someone forgot to close a bag.
   */
  publishReady(now: number = Date.now()): string[] {
    const published: string[] = [];
    for (const t of this.totes.list({ status: 'filling' })) {
      const aged = t.filledAt ? now - new Date(t.filledAt).getTime() >= TOTE_MAX_WAIT_H * 3_600_000 : false;
      if (!t.parcels.length) continue;
      const full = this.totes.isFull(t);
      if (!full && !aged) continue;
      if (t.sealRequired) {
        this.promptSeal(t, aged ? 'max_wait' : 'full');
        continue;
      }
      this.totes.markAvailable(t.code);
      published.push(t.code);
      void this.events.publish(GlosEvent.Pudo.ToteAvailable, { code: t.code, reason: full ? 'full' : 'max_wait', weightKg: t.weightKg, destination: t.destinationLabel }, { source: 'pudo' }).catch(() => undefined);
    }
    return published;
  }

  /**
   * Ask a shop to close a bag that is ready to go. Once per reason and never backwards: a bag that filled
   * (one nudge) and then waited out the clock earns a second, sharper one — but a sweep running every few
   * minutes must not nag a counter every few minutes.
   */
  private promptSeal(tote: Tote, reason: 'full' | 'max_wait'): void {
    if (tote.sealPromptedFor === reason || (reason === 'full' && tote.sealPromptedFor === 'max_wait')) return;
    this.totes.noteSealPrompt(tote.code, reason);
    void this.events
      .publish(
        GlosEvent.Pudo.ToteNeedsSeal,
        { code: tote.code, agentDid: tote.locationId, reason, destination: tote.destinationLabel, parcels: tote.parcels.length },
        { source: 'pudo' },
      )
      .catch(() => undefined);
  }

  /** Agent manually publishes a not-yet-full tote early. */
  release(code: string): { code: string; status: string } {
    // A shop bag has its own early-publish, and it is the seal: closing the bag runs the completeness gate
    // and publishes in one act. Releasing it from here would put a bag on the marketplace with parcels for
    // it still sitting on the shelf, unrecorded — the exact hole the gate exists to close.
    const bag = this.totes.requireByCode(code);
    if (bag.sealRequired) throw new GlosError('INVALID_STATE', `Bag ${code} is a shop bag — close it at the counter to send it`);
    const t = this.totes.markAvailable(code);
    void this.events.publish(GlosEvent.Pudo.ToteAvailable, { code: t.code, reason: 'manual', weightKg: t.weightKg, destination: t.destinationLabel }, { source: 'pudo' }).catch(() => undefined);
    return { code: t.code, status: t.status };
  }

  registerFreight(input: { description: string; pickupLocation: { lat: number; lng: number }; pickupLabel: string; destLabel: string; destLocation?: { lat: number; lng: number }; weightKg: number; fragile?: boolean; bulk?: boolean; natureCode?: CargoNature; dimensionsCm?: [number, number, number]; shipperDid?: string; originEquipment?: Equipment[]; destEquipment?: Equipment[]; buyerMobile?: string; externalOrderId?: string; maxSpend?: number; scheduledPickupAt?: string; allowEarlyClaim?: boolean }, now: number = Date.now()): Freight {
    this.freightSeq += 1;
    // A future pickup date parks the load for later; a past/absent date ships now. A supplied-but-unparseable
    // date is a CALLER ERROR — fail closed (never silently ship-now what was meant to be scheduled). Store the
    // canonical UTC instant so the later due-comparison is unambiguous.
    let scheduledPickupAt: string | undefined;
    if (input.scheduledPickupAt != null) {
      const t = new Date(input.scheduledPickupAt).getTime();
      if (Number.isNaN(t)) throw new GlosError('INVALID_INPUT', 'scheduledPickupAt is not a valid date/time');
      if (t > now) scheduledPickupAt = new Date(t).toISOString();
    }
    const scheduled = scheduledPickupAt != null;
    // The shipper's early-claim choice (default: allow — a scarce truck can commit ahead of the date).
    const allowEarlyClaim = input.allowEarlyClaim ?? true;
    // S32: give the freight a cargo model so it matches vehicles like a tote does — class (from weight+dims)
    // drives the required equipment, the primary nature drives the required vehicle capability.
    const natureCode: CargoNature = input.natureCode ?? 'GEN';
    const cargoClass = this.cargo.classify({ kg: input.weightKg, dimsCm: input.dimensionsCm });
    const bulk = input.bulk ?? true; // bulk cargo by default (sugar/cement) → trucks
    const requiredEquipment = bulk ? [] : this.cargo.requiredEquipment(cargoClass);
    // S32c: flag ends whose site cannot HANDLE this cargo — a site needs at least one qualifying piece of the
    // required equipment (any-of). Only checked when the site's manifest is known (a diverted order → its
    // PUDOs); a bulletin freight with only geo labels leaves both ends unknown → no gap flagged.
    const siteHandles = (have?: Equipment[]) => requiredEquipment.length === 0 || (have != null && requiredEquipment.some((eq) => have.includes(eq)));
    const equipmentGaps: Array<'origin' | 'dest'> = [];
    if (input.originEquipment != null && !siteHandles(input.originEquipment)) equipmentGaps.push('origin');
    if (input.destEquipment != null && !siteHandles(input.destEquipment)) equipmentGaps.push('dest');
    const freight: Freight = {
      freightId: `frt_${randomBytes(5).toString('hex')}`,
      code: `FRT-${String(this.freightSeq).padStart(3, '0')}`,
      description: input.description,
      pickupLocation: input.pickupLocation,
      pickupLabel: input.pickupLabel,
      destLabel: input.destLabel,
      destLocation: input.destLocation,
      weightKg: input.weightKg,
      fragile: input.fragile ?? false,
      bulk,
      cargoClass,
      natureCode,
      requiredCapabilities: this.cargo.requiredCapabilities([natureCode]),
      // Handling equipment is for DISCRETE/palletised cargo (a forklift/pallet-jack/crane). Loose BULK
      // (cement in a tipper, grain in a hopper) self-loads via silo/tipping, so it needs no handling gear —
      // its constraint is `carriesBulk` (checked in vehicleCanCarry), not a forklift.
      requiredEquipment,
      equipmentGaps,
      shipperDid: input.shipperDid,
      // S32d — keep the buyer joined to their diverted order by phone HASH only (never the cleartext number:
      // the raw Freight goes to drivers/operators). Plus a public tracking key + the order ref. Only when a
      // buyer is known (a diverted order; not a bulletin freight).
      buyerPhoneHash: input.buyerMobile ? hashPhone(input.buyerMobile) || undefined : undefined,
      trackingKey: `T-${randomBytes(5).toString('hex').toUpperCase()}`,
      externalOrderId: input.externalOrderId,
      // S34c — a positive, finite cap only; a zero/negative/NaN budget is treated as "no cap" (never a load
      // nobody can ever afford to move) so a bad value can't silently strand a diverted order.
      maxSpend: input.maxSpend != null && Number.isFinite(input.maxSpend) && input.maxSpend > 0 ? Math.round(input.maxSpend * 100) / 100 : undefined,
      // A scheduled load is booked for later; if allowEarlyClaim it is still reservable now (see availableLoads).
      scheduledPickupAt,
      allowEarlyClaim,
      status: scheduled ? 'scheduled' : 'available',
      createdAt: new Date().toISOString(),
    };
    this.freights.set(freight.freightId, freight);
    // Ping nearby drivers NOW for a ship-now load OR an early-claimable scheduled one (so a scarce truck can
    // commit ahead of the date). A no-early-claim scheduled load stays silent until due (publishReadyFreight).
    if (!scheduled || allowEarlyClaim) {
      void this.events
        .publish(GlosEvent.Pudo.FreightPosted, { freightId: freight.freightId, code: freight.code, pickupLocation: freight.pickupLocation, destLabel: freight.destLabel, weightKg: freight.weightKg, cargoClass: freight.cargoClass }, { source: 'pudo' })
        .catch(() => undefined);
    }
    return freight;
  }

  /**
   * The scheduled-freight maintenance pass — the freight analogue of publishReady() for totes. Called lazily
   * from suggest() (a driver requesting work always sees the current picture) and safe to call anywhere:
   *  1. PROMOTE a scheduled load whose pickup date has arrived to 'available'. A no-early-claim load pings
   *     drivers now (its first ping); an early-claimable one already pinged at booking, so it flips silently.
   *  2. RELEASE a no-show: an EARLY-claimed scheduled load not picked up by its date + grace goes back to the
   *     marketplace (rebating the shipper if billed), so an early reservation can never strand a shipment.
   * Returns the freightIds promoted.
   */
  publishReadyFreight(now: number = Date.now()): string[] {
    const activated: string[] = [];
    const ping = (f: Freight) =>
      void this.events
        .publish(GlosEvent.Pudo.FreightPosted, { freightId: f.freightId, code: f.code, pickupLocation: f.pickupLocation, destLabel: f.destLabel, weightKg: f.weightKg, cargoClass: f.cargoClass }, { source: 'pudo' })
        .catch(() => undefined);
    for (const f of this.freights.values()) {
      if (!f.scheduledPickupAt) continue;
      const due = new Date(f.scheduledPickupAt).getTime();
      if (f.status === 'scheduled' && due <= now) {
        // Its date arrived while still unclaimed → it becomes a normal available load.
        f.status = 'available';
        this.freights.set(f.freightId, f);
        activated.push(f.freightId);
        if (!f.allowEarlyClaim) ping(f); // an early-claim load already pinged at booking — don't double-notify
      } else if (
        (f.status === 'claimed' || f.status === 'scheduled') &&
        f.claimedBy &&
        !f.pickedUpAt &&
        // The grace window runs from the LATER of the pickup date and the claim instant — never from the fixed
        // date alone. A load claimed AFTER its date (a late reservation, or a load re-claimed after an earlier
        // release) gets a full fresh grace from its claim, so it can't be re-released before the driver can pick
        // up — the thrash that anchoring purely to a now-past `due` would cause.
        now > Math.max(due, f.claimedAt ? new Date(f.claimedAt).getTime() : due) + FREIGHT_NOSHOW_GRACE_H * 3_600_000
      ) {
        // A no-show: reserved ahead, but not picked up by the pickup date + grace → free it + undo the charge.
        if (f.paidStatus === 'billed' && f.shipperDid && this.vendors.has(f.shipperDid)) {
          this.vendors.rebate(f.shipperDid, f.freightId, shipperCharge(f.lockedPrice ?? 0), 'freight no-show release');
        }
        f.status = 'available';
        f.scheduledPickupAt = undefined; // its date has passed — it's now a plain ship-now load: no stale gate, no 'scheduled' timeline, and this loop skips it forever after (so it can never no-show-release twice)
        f.claimedBy = undefined;
        f.claimedAt = undefined;
        f.lockedPrice = undefined;
        f.priceBreakdown = undefined;
        f.lockedAt = undefined;
        f.paidStatus = undefined;
        f.driverPaid = undefined;
        this.freights.set(f.freightId, f);
        ping(f); // back on the market — re-notify nearby drivers
      }
    }
    return activated;
  }

  /** Every diverted freight a buyer (by phone hash) is a party to — the "my shipments" freight section. */
  freightsForPhoneHash(phoneHash: string): FreightShipmentView[] {
    if (!phoneHash) return [];
    return [...this.freights.values()]
      .filter((f) => f.buyerPhoneHash === phoneHash)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((f) => DispatchService.toShipmentView(f));
  }

  /** The buyer-facing, PII-free projection of a freight job + its status timeline (built from the stamped
   *  transition times). Never carries the buyer's number, the shipper, or the pickup coordinates. */
  static toShipmentView(f: Freight): FreightShipmentView {
    // A scheduled load's first milestone is 'scheduled' (booked for a future date), not 'available'.
    const timeline: Array<{ status: Freight['status']; at: string }> = [{ status: f.scheduledPickupAt ? 'scheduled' : 'available', at: f.createdAt }];
    if (f.claimedAt) timeline.push({ status: 'claimed', at: f.claimedAt });
    if (f.pickedUpAt) timeline.push({ status: 'in_transit', at: f.pickedUpAt });
    if (f.deliveredAt) timeline.push({ status: 'delivered', at: f.deliveredAt });
    return {
      freightId: f.freightId,
      code: f.code,
      status: f.status,
      cargoClass: f.cargoClass,
      destLabel: f.destLabel,
      weightKg: f.weightKg,
      trackingKey: f.trackingKey,
      externalOrderId: f.externalOrderId,
      equipmentGaps: f.equipmentGaps,
      createdAt: f.createdAt,
      scheduledPickupAt: f.scheduledPickupAt,
      timeline,
      tempBreached: f.tempBreached, // S33b — the only temp fact a buyer sees (a boolean; never the readings)
    };
  }

  // --- matching ---

  /** Suggest the loads sitting along a driver's A→B route, within remaining vehicle capacity. `minEarn` is the
   *  driver's own floor: hide freight paying less than this (their surge-threshold filter). */
  suggest(driverDid: string, route: RoutePlan, now: number = Date.now(), minEarn?: number): Offer[] {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) throw new GlosError('NOT_COUPLED', 'Couple the driver to a vehicle before requesting work');
    this.publishReady(now);
    this.publishReadyFreight(now); // any scheduled freight that has come due joins the marketplace now
    const remaining = this.remainingCapacity(driverDid);
    const remainingTotes = this.remainingTotes(driverDid); // bag spaces, the constraint kilos cannot express
    const profile = this.pricingProfile(vehicle); // S34 — fixed for this driver+vehicle across all offers here
    const floor = minEarn != null && Number.isFinite(minEarn) && minEarn > 0 ? minEarn : undefined;

    // REP4 — the ENFORCING guard: a driver whose reliable rating has fallen below the network floor is barred
    // from the FREIGHT marketplace (the premium, high-value loads). They keep their tote/parcel line-haul work
    // — which is what earns them ratings — so the bar is RECOVERABLE: as fresh good ratings pull their average
    // back above the floor, freight returns. Cold-start safe (belowFloor never fires for a new/thinly-rated driver).
    const freightBarred = belowFloor(this.ratings.driverRating(driverDid));

    const matches = this.availableLoads()
      .filter((load) => !(freightBarred && load.kind === 'freight'))
      .map((load) => ({ load, detour: this.router.detourKm(route.from, load.pickupLocation, route.to), minutesAway: this.minutes(route.from, load.pickupLocation) }))
      .filter(({ load, detour, minutesAway }) => detour <= DISPATCH_MAX_DETOUR_KM && minutesAway <= DISPATCH_MAX_PICKUP_MIN && this.vehicleCanCarry(vehicle, load, remaining, remainingTotes))
      .sort((a, b) => a.detour - b.detour || a.minutesAway - b.minutesAway);

    const out: Offer[] = [];
    for (const { load, detour, minutesAway } of matches) {
      // S34 — freight offers carry a transparent price: P = B + D·R_base·M, D = deadhead (driver→pickup) +
      // haul (pickup→dropoff), M the market multiplier flexed within THIS vehicle's own [min,max] corridor. The
      // price shown here is indicative; it is LOCKED (recomputed against the vehicle at that instant) on claim.
      const price = load.kind === 'freight'
        ? computeFreightPrice({
            baseFee: profile.baseFee,
            ratePerKm: profile.ratePerKm,
            deadheadKm: this.router.roadKm(route.from, load.pickupLocation),
            tripKm: load.destLocation ? this.router.roadKm(load.pickupLocation, load.destLocation) : 0,
            // S34b — the market multiplier for the PICKUP's zone (supply/demand + admin surge), clamped to the corridor.
            multiplier: freightMultiplier(new Date(now), { min: profile.min, max: profile.max }, this.market.factorFor(load.pickupLocation, now)),
          })
        : undefined;
      // S34c — two gates BEFORE reusing/creating an offer, computed against the CURRENT price so a load that no
      // longer qualifies is dropped even if a stale offer exists: (1) the shipper's budget — don't offer a freight
      // whose all-in charge would exceed what the shipper agreed to pay (a cheaper vehicle may still get it);
      // (2) the driver's own minimum-earning filter. Both apply to freight only (totes settle on a different model).
      if (price && load.kind === 'freight') {
        if (load.maxSpend != null && shipperCharge(price.total) > load.maxSpend) continue;
        if (floor != null && price.total < floor) continue;
      }
      out.push(this.makeOffer(driverDid, load, { detour, minutesAway, price, now }));
    }
    return out;
  }

  /**
   * Mint (or re-use) the one live offer for this driver + load. One live offer per pair: re-asking a driver
   * about a load they are already looking at is how a helpful app becomes a nuisance, and it would also let
   * two offers for the same bag disagree about the price.
   */
  private makeOffer(driverDid: string, load: Claimable, ctx: { detour: number; minutesAway: number; price?: PriceBreakdown; now: number }): Offer {
    const { detour, minutesAway, price, now } = ctx;
    const existing = [...this.offers.values()].find((o) => o.driverDid === driverDid && o.ref === load.ref && o.status === 'pending' && new Date(o.expiresAt).getTime() > now);
    if (existing) return existing;
    const offer: Offer = {
      offerId: `ofr_${randomBytes(6).toString('hex')}`,
      driverDid,
      kind: load.kind,
      ref: load.ref,
      pickupLabel: load.pickupLabel,
      pickupLocation: load.pickupLocation,
      destLabel: load.destLabel,
      weightKg: load.weightKg,
      detourKm: detour,
      minutesAway,
      message: `≈${minutesAway} min from ${load.pickupLabel}: a ${load.weightKg} kg shipment to ${load.destLabel} is ready. Claim it?`,
      price,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + OFFER_TTL_MIN * 60_000).toISOString(),
      status: 'pending',
    };
    this.offers.set(offer.offerId, offer);
    return offer;
  }

  /**
   * The ONE load worth interrupting this driver for, right where they are — or null.
   *
   * The route list answers "what is on the road I named"; this answers "what am I about to drive past". It
   * is the same fitness question (heading, kilos, bag spaces, capability, budget, the freight bar) asked
   * against a live position instead of a planned trip, and it returns a single load on purpose: a driver at
   * speed can hold one question in their head, not a list. Minting the offer here is what makes the pop-up
   * actionable — the price is fixed at the moment they are asked, and the tap has something to open.
   */
  offerNear(driverDid: string, point: GeoPoint, now: number = Date.now()): Offer | null {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) return null;
    const remaining = this.remainingCapacity(driverDid);
    const remainingTotes = this.remainingTotes(driverDid);
    const profile = this.pricingProfile(vehicle);
    const freightBarred = belowFloor(this.ratings.driverRating(driverDid));

    const best = this.availableLoads()
      .filter((load) => !(freightBarred && load.kind === 'freight'))
      .filter((load) => this.vehicleCanCarry(vehicle, load, remaining, remainingTotes))
      .map((load) => ({ load, km: this.router.roadKm(point, load.pickupLocation) }))
      .filter(({ load, km }) => km <= NUDGE_RADIUS_KM && this.headingTowards(driverDid, load.pickupLocation))
      .sort((a, b) => a.km - b.km)[0];
    if (!best) return null;

    const { load } = best;
    const price = load.kind === 'freight'
      ? computeFreightPrice({
          baseFee: profile.baseFee,
          ratePerKm: profile.ratePerKm,
          deadheadKm: best.km,
          tripKm: load.destLocation ? this.router.roadKm(load.pickupLocation, load.destLocation) : 0,
          multiplier: freightMultiplier(new Date(now), { min: profile.min, max: profile.max }, this.market.factorFor(load.pickupLocation, now)),
        })
      : undefined;
    // The shipper's budget still binds — an interruption offering a price nobody will pay is worse than silence.
    if (price && load.kind === 'freight' && load.maxSpend != null && shipperCharge(price.total) > load.maxSpend) return null;

    return this.makeOffer(driverDid, load, { detour: Math.round(best.km * 10) / 10, minutesAway: this.minutes(point, load.pickupLocation), price, now });
  }

  /* --- declining from the lock screen --- */

  /**
   * A one-shot capability to decline ONE offer, and nothing else.
   *
   * "Not now" has to work from the notification itself — a driver who must open an app to say no will simply
   * not say it, and the load sits reserved-in-spirit while someone else could have taken it. But the service
   * worker that handles that tap has no session, and giving it the driver's token would hand a background
   * script the driver's whole identity to solve a one-word problem.
   *
   * So the push carries a capability instead: unguessable, bound to a single offer, single-use, and dead when
   * the offer lapses. Leaked, it can decline one load the driver was declining anyway.
   */
  mintDeclineToken(offerId: string, now: number = Date.now()): string {
    const token = randomBytes(24).toString('hex');
    this.declineTokens.set(token, { offerId, expiresAt: now + OFFER_TTL_MIN * 60_000 });
    return token;
  }

  /** Redeem a decline capability. Burned on use, and refused once it (or its offer) has lapsed. */
  declineByToken(token: string, now: number = Date.now()): Offer {
    const held = this.declineTokens.get(token);
    if (!held) throw new GlosError('NOT_FOUND', 'That link has already been used, or has expired');
    this.declineTokens.delete(token); // one shot, whatever happens next
    if (held.expiresAt <= now) throw new GlosError('WINDOW_EXPIRED', 'That offer has already lapsed');
    return this.ignore(held.offerId);
  }

  /** Driver accepts an offer → reserves the load (and its weight) for this driver. */
  claim(offerId: string, now: number = Date.now()): Offer {
    const offer = this.requireOffer(offerId);
    if (offer.status === 'expired' || new Date(offer.expiresAt).getTime() <= now) { offer.status = 'expired'; throw new GlosError('WINDOW_EXPIRED', 'Offer has lapsed (auto-ignored)'); }
    if (offer.status !== 'pending') throw new GlosError('INVALID_STATE', `Offer is ${offer.status}`);
    const vehicle = this.fleet.vehicleForDriver(offer.driverDid);
    if (!vehicle) throw new GlosError('NOT_COUPLED', 'Driver is no longer coupled to a vehicle');
    if (offer.weightKg > this.remainingCapacity(offer.driverDid)) throw new GlosError('CAPACITY_EXCEEDED', 'Not enough remaining capacity for this load');
    // …and room in the hold for one more BAG. Kilos are not the binding constraint on a line-haul: a driver
    // claiming from a coffee table could reserve twenty bags of letters against a weight limit they never
    // reach, and arrive at a bus whose boot holds twelve.
    if (offer.kind === 'tote' && this.remainingTotes(offer.driverDid) < 1) {
      throw new GlosError('CAPACITY_EXCEEDED', `Your ${vehicle.vehicleClass} is carrying all ${this.toteCapacityOf(vehicle)} bag(s) it holds — deliver one before taking another`);
    }
    // S31/S32: re-check the load's required capabilities AND equipment against the driver's CURRENT vehicle —
    // coupling is re-assignable, so what held when the offer was made (suggest → vehicleCanCarry) may not hold
    // now. Without this, a driver could re-couple to an unsuitable vehicle and RESERVE the load (markClaimed)
    // only to dead-end at load time, stranding it 'claimed' for everyone else.
    const need = this.loadRequirements(offer.kind, offer.ref);
    if (
      need.capabilities.some((cap) => !vehicle[cap]) ||
      !DispatchService.hasEquipmentFor(vehicle, need.equipment) ||
      (need.bulk && !vehicle.carriesBulk) ||
      (need.fragile && !vehicle.allowsFragile)
    ) {
      throw new GlosError('VEHICLE_MISSING_CAPABILITY', 'Your current vehicle lacks a capability or equipment this load requires — re-couple to a suitable vehicle');
    }

    if (offer.kind === 'tote') this.totes.markClaimed(offer.ref, offer.driverDid);
    else {
      const f = this.requireFreight(offer.ref);
      // Claimable when live ('available') OR when it's a scheduled load the shipper opened to early reservation.
      if (!(f.status === 'available' || (f.status === 'scheduled' && f.allowEarlyClaim))) throw new GlosError('INVALID_STATE', `Freight is ${f.status}`);
      // REP4 — bar a below-floor driver from CLAIMING freight (defence-in-depth behind suggest's withholding, and
      // it also catches a stale offer claimed after the driver dropped below the floor). Recoverable; cold-start safe.
      if (belowFloor(this.ratings.driverRating(offer.driverDid))) throw new GlosError('REPUTATION_BELOW_FLOOR', 'Your rating is below the network minimum — freight is paused until it recovers. Keep delivering to bring it back up.');
      // S34 — compute the price to LOCK. The market can surge afterwards and the driver can edit their profile,
      // but what is agreed at this instant never changes. Recompute against THIS vehicle's current profile
      // (defaults resolved for a legacy vehicle) and the multiplier now, over the distance the offer was priced
      // on (deadhead + haul).
      const profile = this.pricingProfile(vehicle);
      const breakdown = computeFreightPrice({
        baseFee: profile.baseFee,
        ratePerKm: profile.ratePerKm,
        deadheadKm: offer.price?.distanceKm ?? 0,
        tripKm: 0,
        // S34b — lock against the market at the pickup's zone AT THIS INSTANT (a rule set since the offer, or a
        // shifted pulse, is honoured here); the corridor clamp still guarantees the driver's floor and ceiling.
        multiplier: freightMultiplier(new Date(now), { min: profile.min, max: profile.max }, this.market.factorFor(f.pickupLocation, now)),
      });
      // S34c — the shipper's budget gate, checked BEFORE any mutation so a refused claim leaves the freight
      // untouched and available. suggest() already skips over-budget offers; this re-check catches a driver who
      // re-coupled to a pricier vehicle (or a surge) after the offer was made (the S31 mirror-at-claim lesson).
      if (f.maxSpend != null && shipperCharge(breakdown.total) > f.maxSpend) {
        throw new GlosError('BUDGET_EXCEEDED', "This load's price now exceeds the shipper's budget — it stays open for a cheaper vehicle or a cooler market");
      }
      f.status = 'claimed';
      f.claimedBy = offer.driverDid;
      f.claimedAt = new Date(now).toISOString(); // stamp the injected clock — the no-show deadline is anchored to this
      f.priceBreakdown = breakdown;
      f.lockedPrice = breakdown.total;
      f.lockedAt = f.claimedAt;
      f.driverPaid = false;
      // Settle the shipper: a diverted vendor order (shipperDid = the vendor) is billed its earning + the
      // platform fee from its prepaid balance. THREE distinct states, so an uncollected debt is never silent:
      //  - 'billed'         a known shipper whose prepaid balance covered the charge;
      //  - 'billing_failed' a known shipper whose balance fell SHORT — a real debt for a Local Admin to collect;
      //  - 'unpaid'         a bulletin freight with no shipper, settled off-platform (the intended default).
      // The driver is still paid on delivery in every case — labour done is owed regardless of shipper collection.
      if (f.shipperDid && this.vendors.has(f.shipperDid)) {
        const { paid } = this.vendors.billShipment(f.shipperDid, f.freightId, shipperCharge(breakdown.total));
        f.paidStatus = paid ? 'billed' : 'billing_failed';
      } else {
        f.paidStatus = 'unpaid';
      }
      this.freights.set(f.freightId, f);
    }

    offer.status = 'claimed';
    // Retire the competing offers for the same load.
    for (const o of this.offers.values()) if (o.ref === offer.ref && o.offerId !== offer.offerId && o.status === 'pending') o.status = 'ignored';
    void this.events.publish(GlosEvent.Pudo.LoadClaimed, { offerId, driverDid: offer.driverDid, kind: offer.kind, ref: offer.ref, weightKg: offer.weightKg }, { source: 'pudo' }).catch(() => undefined);
    return offer;
  }

  ignore(offerId: string): Offer {
    const offer = this.requireOffer(offerId);
    if (offer.status === 'pending') offer.status = 'ignored';
    return offer;
  }

  /** Offers still awaiting an answer (lapsed ones are reported as auto-ignored). */
  activeOffersFor(driverDid: string, now: number = Date.now()): Offer[] {
    const live: Offer[] = [];
    for (const o of this.offers.values()) {
      if (o.driverDid !== driverDid) continue;
      if (o.status === 'pending' && new Date(o.expiresAt).getTime() <= now) o.status = 'expired'; // auto-ignore
      if (o.status === 'pending') live.push(o);
    }
    return live.sort((a, b) => a.detourKm - b.detourKm);
  }

  // --- capacity ---

  /** Total load the fleet manager set on the vehicle, minus everything the driver is already carrying. */
  remainingCapacity(driverDid: string): number {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) return 0;
    const toteKg = this.totes.list().filter((t) => t.claimedBy === driverDid && (t.status === 'claimed' || t.status === 'in_transit')).reduce((s, t) => s + t.weightKg, 0);
    const freightKg = [...this.freights.values()].filter((f) => f.claimedBy === driverDid && (f.status === 'claimed' || f.status === 'in_transit')).reduce((s, f) => s + f.weightKg, 0);
    return Math.round((vehicle.capacityKg - toteKg - freightKg) * 100) / 100;
  }

  /** How many BAGS this vehicle holds (the shared pure helper — see fleet.config toteCapacityOf). */
  toteCapacityOf(vehicle: Vehicle): number {
    return toteCapacityOf(vehicle);
  }

  /**
   * Bag spaces left in the hold — the capacity kilos cannot express.
   *
   * A tote of letters weighs nothing, so a bus with 500 kg free could be offered a hundred bags while its
   * boot holds a dozen. Counted in BAGS, against what the driver is already carrying or has reserved.
   */
  remainingTotes(driverDid: string): number {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) return 0;
    const held = this.totes.list().filter((t) => t.claimedBy === driverDid && (t.status === 'claimed' || t.status === 'in_transit')).length;
    return Math.max(0, this.toteCapacityOf(vehicle) - held);
  }

  /**
   * Is this pickup on the road the driver SAID they are running?
   *
   * "A load near you" has always meant near your last GPS fix, which is only half the question — a driver
   * leaving Hawassa for Addis is a hundred metres from a bag going the other way, and got pinged about it.
   * With a declared leg we can ask the real question: is this load on your way? The same detour budget the
   * offer list uses, so being told about a load and being offered it agree.
   *
   * A driver who has declared nothing is not excluded: we cannot say they are NOT heading there, and going
   * quiet on them would punish the very drivers we most want to start declaring. Never throws — this is a
   * notification filter.
   */
  headingTowards(driverDid: string, point: GeoPoint): boolean {
    const leg = this.fleet.legFor(driverDid);
    if (!leg) return true;
    try {
      return this.router.detourKm(leg.from, point, leg.to) <= DISPATCH_MAX_DETOUR_KM;
    } catch {
      return true; // an unroutable leg must not silence a driver
    }
  }

  /**
   * Can this driver's CURRENTLY-coupled vehicle carry this freight? A capability-fitness check only —
   * the same capabilities / equipment / bulk / fragile predicate claim() enforces (loadRequirements +
   * hasEquipmentFor), minus the claim-time capacity/budget gates. Used to TARGET a freight-posted
   * notification at drivers who could actually claim it, so a bike/small-van driver is never pinged for a
   * pallet. Never throws (a notification filter): an uncoupled driver or an unknown freight → false.
   */
  freightCarryableByDriver(freightId: string, driverDid: string): boolean {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle || !this.freights.has(freightId)) return false;
    const need = this.loadRequirements('freight', freightId);
    return !(
      need.capabilities.some((cap) => !vehicle[cap]) ||
      !DispatchService.hasEquipmentFor(vehicle, need.equipment) ||
      (need.bulk && !vehicle.carriesBulk) ||
      (need.fragile && !vehicle.allowsFragile)
    );
  }

  /** Loads the driver currently holds (claimed or on the vehicle). */
  claimsFor(driverDid: string): Claimable[] {
    const totes = this.totes.list().filter((t) => t.claimedBy === driverDid && (t.status === 'claimed' || t.status === 'in_transit')).map((t) => this.wrapTote(t.code)).filter((c): c is Claimable => c != null);
    const freight = [...this.freights.values()].filter((f) => f.claimedBy === driverDid && (f.status === 'claimed' || f.status === 'in_transit')).map((f) => this.wrapFreight(f));
    return [...totes, ...freight];
  }

  /** Freight is picked up (claimed → in_transit) then delivered (→ delivered, capacity released). S32b: when
   *  a driver DID is given (the authenticated driver-app path), only the driver who CLAIMED it may advance it —
   *  a claimed freight is that driver's obligation, not a free-for-all. */
  pickupFreight(freightId: string, driverDid?: string, check?: { confirmed?: string[]; securementPhotoId?: string }, now: number = Date.now()): Freight {
    const f = this.requireFreight(freightId);
    if (driverDid && f.claimedBy !== driverDid) throw new GlosError('FORBIDDEN', 'This freight was claimed by another driver');
    if (f.status !== 'claimed') throw new GlosError('INVALID_STATE', `Freight is ${f.status}, expected claimed`);
    // A load reserved ahead of its date can't be picked up before it — the cargo (or the consolidated lot)
    // isn't ready yet. It becomes pickable on/after the booked pickup date.
    if (f.scheduledPickupAt && now < new Date(f.scheduledPickupAt).getTime()) throw new GlosError('INVALID_STATE', `Pickup is booked for ${f.scheduledPickupAt} — it can't be collected before then`);
    // S33 — the load-safety gate. Every dedicated freight must clear the load-safety checklist THIS cargo
    // requires (re-derived from the freight, so a client that under-reports can't bypass it) AND carry a
    // securement photo, before it leaves the pickup. The check happens BEFORE any mutation, so a failed gate
    // leaves the freight untouched (still 'claimed').
    const required = requiredLoadKeys({ bulk: f.bulk, fragile: f.fragile, requiredCapabilities: f.requiredCapabilities });
    const missing = missingKeys(required, check?.confirmed);
    if (missing.length) throw new GlosError('SAFETY_CHECK_INCOMPLETE', `Complete the load-safety checklist before pickup — ${missing.length} item(s) left`);
    const securementPhotoId = check?.securementPhotoId;
    if (!securementPhotoId) throw new GlosError('SECUREMENT_PHOTO_REQUIRED', 'Attach a photo of the secured load before pickup');
    f.status = 'in_transit';
    f.pickedUpAt = new Date().toISOString();
    f.loadSafety = { confirmed: [...new Set(check?.confirmed ?? [])], securementPhotoRef: securementPhotoId, at: f.pickedUpAt, by: driverDid };
    // Bind the securement photo to the freight so its retention clock is the freight's, not the 48h orphan
    // reaper. adopt() (not link()) because this id came from the CLIENT: it only re-kinds/links a photo the
    // DRIVER owns and that isn't attached elsewhere, so a passed id can never launder another actor's media
    // (S29). Anchored at delivery (the terminal state).
    this.media.adopt(securementPhotoId, driverDid ?? '', { type: 'freight', id: f.freightId }, 'securement');
    this.freights.set(f.freightId, f);
    return f;
  }
  deliverFreight(freightId: string, driverDid?: string, check?: { confirmed?: string[] }): Freight {
    const f = this.requireFreight(freightId);
    if (driverDid && f.claimedBy !== driverDid) throw new GlosError('FORBIDDEN', 'This freight was claimed by another driver');
    if (f.status !== 'in_transit') throw new GlosError('INVALID_STATE', `Freight is ${f.status}, expected in_transit`);
    // S33 — the unload gate: the unload checklist must be complete before the freight is marked delivered.
    const missing = missingKeys(requiredUnloadKeys(), check?.confirmed);
    if (missing.length) throw new GlosError('SAFETY_CHECK_INCOMPLETE', `Complete the unload checklist before delivery — ${missing.length} item(s) left`);
    f.status = 'delivered'; // no longer counts against the driver's remaining capacity
    f.deliveredAt = new Date().toISOString();
    f.unloadReport = { confirmed: [...new Set(check?.confirmed ?? [])], at: f.deliveredAt, by: driverDid };
    // S34 — pay the driver their LOCKED earning on delivery, exactly once. A system-level ledger outflow
    // (drivers hold no agent wallet). A legacy/bulletin freight claimed before pricing (no lockedPrice) is skipped.
    if (f.lockedPrice != null && !f.driverPaid && f.claimedBy) {
      this.gate.driverPayout(f.claimedBy, f.lockedPrice);
      f.driverPaid = true;
    }
    // S33 — delivery is terminal: start the securement photo's retention clock (shipment-proof bin).
    this.media.anchorFreightTerminal(f.freightId);
    this.freights.set(f.freightId, f);
    return f;
  }

  /**
   * S33b — log a temperature reading for a cold-chain freight IN TRANSIT. Only the claiming driver may log it;
   * a reading outside the cargo's safe band marks the freight breached (STICKY — the chain, once broken, stays
   * flagged even if it recovers) and emits an event for the operator watchtower. A freight whose cargo is not
   * temperature-controlled has no band, so logging is refused (there is nothing to monitor).
   */
  recordTemp(freightId: string, celsius: number, driverDid?: string): Freight {
    const f = this.requireFreight(freightId);
    if (driverDid && f.claimedBy !== driverDid) throw new GlosError('FORBIDDEN', 'This freight was claimed by another driver');
    if (f.status !== 'in_transit') throw new GlosError('INVALID_STATE', `Freight is ${f.status}, expected in_transit`);
    const band = tempBand(f.natureCode);
    if (!band) throw new GlosError('NOT_TEMPERATURE_CONTROLLED', 'This freight is not temperature-controlled — no reading to log');
    if (!Number.isFinite(celsius)) throw new GlosError('INVALID_INPUT', 'A numeric temperature reading is required');
    const c = Math.round(celsius * 10) / 10;
    const breach = isTempBreach(c, band);
    f.tempReadings = [...(f.tempReadings ?? []), { celsius: c, at: new Date().toISOString(), by: driverDid, breach }];
    if (breach && !f.tempBreached) {
      f.tempBreached = true; // sticky
      void this.events.publish(GlosEvent.Pudo.FreightTempBreach, { freightId: f.freightId, code: f.code, celsius: c, band, driverDid }, { source: 'pudo' }).catch(() => undefined);
    }
    this.freights.set(f.freightId, f);
    return f;
  }

  listFreight(filter: { status?: Freight['status'] } = {}): Freight[] {
    return [...this.freights.values()].filter((f) => !filter.status || f.status === filter.status);
  }

  // --- driver jobs + earnings register (R5): the driver's OWN freight hauls, owner-scoped by the caller ---

  driverJobsPage(driverDid: string, q: DriverJobsQuery): Page<DriverJobRow> {
    const filtered = filterDriverJobs([...this.freights.values()], driverDid, q);
    const { items, total } = paginate(filtered, q.limit, q.offset);
    return { items: items.map(driverJobRowOf), total };
  }

  /** Running totals (earned / paid / unpaid / delivered / count) for the CURRENT filtered view. */
  driverJobsSummary(driverDid: string, q: DriverJobsQuery): DriverJobsSummary {
    return driverJobsSummaryOf(filterDriverJobs([...this.freights.values()], driverDid, q));
  }

  driverJobsCsv(driverDid: string, q: DriverJobsQuery): string {
    return driverJobsToCsv(filterDriverJobs([...this.freights.values()], driverDid, q));
  }

  /** All cargo currently claimed or moving (optionally scoped to one fleet's drivers) for the dashboard. */
  activeCargo(driverDids?: Set<string>): { items: Array<{ kind: 'tote' | 'freight'; ref: string; weightKg: number; destLabel: string; status: string; driverDid: string; parcels?: number }>; count: number; totalKg: number } {
    const mine = (did: string) => !driverDids || driverDids.has(did);
    const totes = this.totes.list().filter((t) => t.claimedBy && mine(t.claimedBy) && (t.status === 'claimed' || t.status === 'in_transit')).map((t) => ({ kind: 'tote' as const, ref: t.code, weightKg: t.weightKg, destLabel: t.destinationLabel || 'destination', status: t.status, driverDid: t.claimedBy!, parcels: t.parcels.length }));
    const freight = [...this.freights.values()].filter((f) => f.claimedBy && mine(f.claimedBy) && (f.status === 'claimed' || f.status === 'in_transit')).map((f) => ({ kind: 'freight' as const, ref: f.code, weightKg: f.weightKg, destLabel: f.destLabel, status: f.status, driverDid: f.claimedBy! }));
    const items = [...totes, ...freight];
    return { items, count: items.length, totalKg: Math.round(items.reduce((s, i) => s + i.weightKg, 0) * 100) / 100 };
  }

  // --- internals ---

  private availableLoads(): Claimable[] {
    const totes = this.totes.list({ status: 'available' }).map((t) => this.wrapTote(t.code)).filter((c): c is Claimable => c != null);
    // 'available' loads, PLUS a scheduled load the shipper lets drivers reserve ahead of its date (early claim).
    const freight = [...this.freights.values()].filter((f) => f.status === 'available' || (f.status === 'scheduled' && f.allowEarlyClaim)).map((f) => this.wrapFreight(f));
    return [...totes, ...freight];
  }

  private wrapTote(code: string): Claimable | null {
    const t = this.totes.byCodeMaybe(code);
    if (!t) return null;
    // A loaded (in-transit) tote sits on the bus — fall back to an "on board" label so it still shows
    // among the driver's loads. Available/claimed totes resolve to their PUDO/MDP pickup point.
    const place = this.place(t.locationId) ?? { loc: { lat: 0, lng: 0 }, label: 'on board' };
    const fragile = false; // totes are not individually flagged fragile here; parcel rules apply at load
    // S31: surface the capabilities the bag's cargo needs (perishable → cold chain, hazardous → hazmat) so a
    // vehicle that lacks one is never offered the tote — the offer would only dead-end at loadBag otherwise.
    return { kind: 'tote', ref: t.code, code: t.code, pickupLocation: place.loc, pickupLabel: place.label, destLabel: t.destinationLabel || 'destination', weightKg: t.weightKg, fragile, bulk: false, status: t.status, requiredCapabilities: this.mdps.toteRequiredCapabilities(t) };
  }

  /**
   * S34 — resolve a vehicle's pricing profile, filling class defaults for any missing field. A vehicle
   * persisted BEFORE S34a rehydrates with baseFee/minMultiplier/maxMultiplier undefined: PersistentMap.load()
   * does no migration, and vehicle.service.register() only defaults them for a NEWLY created vehicle. Reading
   * them raw would drive NaN into the price and, from there, into a vendor's durable balance and the ledger.
   * Every pricing read goes through here, so a legacy vehicle prices at its class default — mirroring the
   * write-time defaults in register(). (pricing.ts also sanitises non-finite inputs as a last-line backstop.)
   */
  private pricingProfile(vehicle: Vehicle): { baseFee: number; ratePerKm: number; min: number; max: number } {
    const spec = VEHICLE_SPEC[vehicle.vehicleClass];
    const baseFee = Number.isFinite(vehicle.baseFee) ? vehicle.baseFee : (spec?.defaultBaseFee ?? 1);
    const ratePerKm = Number.isFinite(vehicle.pricePerKm) ? vehicle.pricePerKm : DEFAULT_PRICE_PER_KM;
    const min = clampMultiplier(Number.isFinite(vehicle.minMultiplier) ? vehicle.minMultiplier : DEFAULT_MIN_MULTIPLIER);
    const max = Math.max(min, clampMultiplier(Number.isFinite(vehicle.maxMultiplier) ? vehicle.maxMultiplier : DEFAULT_MAX_MULTIPLIER));
    return { baseFee, ratePerKm, min, max };
  }

  private wrapFreight(f: Freight): Claimable {
    // S32: freight now carries its cargo model, so it matches vehicles on capability AND equipment like a tote.
    // S32b: status lets the driver app drive the claimed → picked-up → delivered flow in-app.
    return { kind: 'freight', ref: f.freightId, code: f.code, pickupLocation: f.pickupLocation, pickupLabel: f.pickupLabel, destLabel: f.destLabel, destLocation: f.destLocation, weightKg: f.weightKg, fragile: f.fragile, bulk: f.bulk, status: f.status, scheduledPickupAt: f.scheduledPickupAt, requiredCapabilities: f.requiredCapabilities, requiredEquipment: f.requiredEquipment, lockedPrice: f.lockedPrice, priceBreakdown: f.priceBreakdown, maxSpend: f.maxSpend, cargoClass: f.cargoClass, natureCode: f.natureCode, loadChecklist: loadSafetyItems({ bulk: f.bulk, fragile: f.fragile, requiredCapabilities: f.requiredCapabilities }), unloadChecklist: unloadSafetyItems(), tempBand: tempBand(f.natureCode) ?? undefined, lastTempC: f.tempReadings?.length ? f.tempReadings[f.tempReadings.length - 1].celsius : undefined, tempBreached: f.tempBreached };
  }

  private vehicleCanCarry(vehicle: Vehicle, load: Claimable, remainingKg: number, remainingTotes = Number.POSITIVE_INFINITY): boolean {
    if (load.weightKg > remainingKg) return false;
    if (load.weightKg > vehicle.capacityKg) return false;
    // A bag needs a bag space, not just kilos — otherwise the offer list keeps offering bags to a full boot.
    if (load.kind === 'tote' && remainingTotes < 1) return false;
    if (load.fragile && !vehicle.allowsFragile) return false;
    if (load.bulk && !vehicle.carriesBulk) return false;
    // S31: the vehicle must satisfy EVERY capability the load's cargo requires (perishable → cold chain,
    // hazardous → hazmat — a load needing both needs both).
    if ((load.requiredCapabilities ?? []).some((cap) => !vehicle[cap])) return false;
    // S32: and it must carry AT LEAST ONE piece of qualifying load/unload equipment (requiredEquipment is an
    // any-of set — a P4 load can be handled by a hand-truck OR a pallet-jack OR a tail-lift OR a ramp).
    if (!DispatchService.hasEquipmentFor(vehicle, load.requiredEquipment)) return false;
    return true;
  }

  /** Does the vehicle carry at least one piece of the equipment a load requires? An empty requirement (bulk /
   *  light cargo) is always satisfied. requiredEquipment is ANY-OF, so one qualifying piece is enough. */
  private static hasEquipmentFor(vehicle: Vehicle, required?: Equipment[]): boolean {
    if (!required || required.length === 0) return true;
    const have = vehicle.equipment ?? [];
    return required.some((eq) => have.includes(eq));
  }

  /** Everything a claimable's cargo requires of a vehicle (tote via its parcels; freight from its record) —
   *  capabilities, equipment, AND the bulk/fragile flags. Used by claim() to re-check the driver's CURRENT
   *  vehicle (coupling is re-assignable), so it mirrors EVERY axis vehicleCanCarry filters on. */
  private loadRequirements(kind: ClaimableKind, ref: string): { capabilities: VehicleCapability[]; equipment: Equipment[]; bulk: boolean; fragile: boolean } {
    if (kind === 'tote') {
      const t = this.totes.byCodeMaybe(ref);
      return { capabilities: t ? this.mdps.toteRequiredCapabilities(t) : [], equipment: [], bulk: false, fragile: false };
    }
    const f = this.freights.get(ref);
    return { capabilities: f?.requiredCapabilities ?? [], equipment: f?.requiredEquipment ?? [], bulk: f?.bulk ?? false, fragile: f?.fragile ?? false };
  }

  /** Resolve a tote's locationId (an MDP id or an agent DID) → its coordinates + display label. */
  private place(locationId: string): { loc: { lat: number; lng: number }; label: string } | null {
    const mdp = this.mdps.list().find((m) => m.mdpId === locationId);
    if (mdp) return { loc: mdp.location, label: mdp.name };
    try { const a = this.agents.get(locationId); return { loc: a.location, label: a.shopName }; } catch { return null; }
  }

  private minutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    return this.router.etaMinutes(a, b, VEHICLE_SPEED_KMH.bus);
  }

  private requireOffer(offerId: string): Offer {
    const o = this.offers.get(offerId);
    if (!o) throw new GlosError('NOT_FOUND', `Offer not found: ${offerId}`);
    return o;
  }

  private requireFreight(freightId: string): Freight {
    const f = this.freights.get(freightId);
    if (!f) throw new GlosError('NOT_FOUND', `Freight not found: ${freightId}`);
    return f;
  }
}
