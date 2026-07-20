import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { ToteService } from './tote.service';
import { FleetService } from './fleet.service';
import { detourKm, haversineKm } from './geo';
import { DISPATCH_MAX_DETOUR_KM, DISPATCH_MAX_PICKUP_MIN, OFFER_TTL_MIN, TOTE_MAX_WAIT_H, VEHICLE_SPEED_KMH } from './pudo.config';
import { Vehicle } from './fleet.types';
import { Claimable, Freight, Offer, RoutePlan } from './dispatch.types';

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
  private readonly freights = new Map<string, Freight>();
  private readonly offers = new Map<string, Offer>();
  private freightSeq = 0;

  constructor(
    private readonly totes: ToteService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly fleet: FleetService,
    private readonly events: EventBus,
  ) {}

  // --- publishing ---

  /** Promote filling totes that are full or have waited ≥ 24 h to 'available' (claimable). */
  publishReady(now: number = Date.now()): string[] {
    const published: string[] = [];
    for (const t of this.totes.list({ status: 'filling' })) {
      const aged = t.filledAt ? now - new Date(t.filledAt).getTime() >= TOTE_MAX_WAIT_H * 3_600_000 : false;
      if (t.parcels.length && (this.totes.isFull(t) || aged)) {
        this.totes.markAvailable(t.code);
        published.push(t.code);
        void this.events.publish(GlosEvent.Pudo.ToteAvailable, { code: t.code, reason: this.totes.isFull(t) ? 'full' : 'max_wait', weightKg: t.weightKg, destination: t.destinationLabel }, { source: 'pudo' }).catch(() => undefined);
      }
    }
    return published;
  }

  /** Agent manually publishes a not-yet-full tote early. */
  release(code: string): { code: string; status: string } {
    const t = this.totes.markAvailable(code);
    void this.events.publish(GlosEvent.Pudo.ToteAvailable, { code: t.code, reason: 'manual', weightKg: t.weightKg, destination: t.destinationLabel }, { source: 'pudo' }).catch(() => undefined);
    return { code: t.code, status: t.status };
  }

  registerFreight(input: { description: string; pickupLocation: { lat: number; lng: number }; pickupLabel: string; destLabel: string; destLocation?: { lat: number; lng: number }; weightKg: number; fragile?: boolean; bulk?: boolean }): Freight {
    this.freightSeq += 1;
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
      bulk: input.bulk ?? true, // bulk cargo by default (sugar/cement) → trucks
      status: 'available',
      createdAt: new Date().toISOString(),
    };
    this.freights.set(freight.freightId, freight);
    return freight;
  }

  // --- matching ---

  /** Suggest the loads sitting along a driver's A→B route, within remaining vehicle capacity. */
  suggest(driverDid: string, route: RoutePlan, now: number = Date.now()): Offer[] {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) throw new BadRequestException('Couple the driver to a vehicle before requesting work');
    this.publishReady(now);
    const remaining = this.remainingCapacity(driverDid);

    const matches = this.availableLoads()
      .map((load) => ({ load, detour: detourKm(route.from, load.pickupLocation, route.to), minutesAway: this.minutes(route.from, load.pickupLocation) }))
      .filter(({ load, detour, minutesAway }) => detour <= DISPATCH_MAX_DETOUR_KM && minutesAway <= DISPATCH_MAX_PICKUP_MIN && this.vehicleCanCarry(vehicle, load, remaining))
      .sort((a, b) => a.detour - b.detour || a.minutesAway - b.minutesAway);

    const out: Offer[] = [];
    for (const { load, detour, minutesAway } of matches) {
      // One live offer per driver+load — reuse the existing pending one if any.
      const existing = [...this.offers.values()].find((o) => o.driverDid === driverDid && o.ref === load.ref && o.status === 'pending' && new Date(o.expiresAt).getTime() > now);
      if (existing) { out.push(existing); continue; }
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
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + OFFER_TTL_MIN * 60_000).toISOString(),
        status: 'pending',
      };
      this.offers.set(offer.offerId, offer);
      out.push(offer);
    }
    return out;
  }

  /** Driver accepts an offer → reserves the load (and its weight) for this driver. */
  claim(offerId: string, now: number = Date.now()): Offer {
    const offer = this.requireOffer(offerId);
    if (offer.status === 'expired' || new Date(offer.expiresAt).getTime() <= now) { offer.status = 'expired'; throw new BadRequestException('Offer has lapsed (auto-ignored)'); }
    if (offer.status !== 'pending') throw new BadRequestException(`Offer is ${offer.status}`);
    const vehicle = this.fleet.vehicleForDriver(offer.driverDid);
    if (!vehicle) throw new BadRequestException('Driver is no longer coupled to a vehicle');
    if (offer.weightKg > this.remainingCapacity(offer.driverDid)) throw new BadRequestException('Not enough remaining capacity for this load');

    if (offer.kind === 'tote') this.totes.markClaimed(offer.ref, offer.driverDid);
    else { const f = this.requireFreight(offer.ref); if (f.status !== 'available') throw new BadRequestException(`Freight is ${f.status}`); f.status = 'claimed'; f.claimedBy = offer.driverDid; }

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

  /** Loads the driver currently holds (claimed or on the vehicle). */
  claimsFor(driverDid: string): Claimable[] {
    const totes = this.totes.list().filter((t) => t.claimedBy === driverDid && (t.status === 'claimed' || t.status === 'in_transit')).map((t) => this.wrapTote(t.code)).filter((c): c is Claimable => c != null);
    const freight = [...this.freights.values()].filter((f) => f.claimedBy === driverDid && (f.status === 'claimed' || f.status === 'in_transit')).map((f) => this.wrapFreight(f));
    return [...totes, ...freight];
  }

  /** Bulk freight is picked up (claimed → in_transit) then delivered (→ delivered, capacity released). */
  pickupFreight(freightId: string): Freight {
    const f = this.requireFreight(freightId);
    if (f.status !== 'claimed') throw new BadRequestException(`Freight is ${f.status}, expected claimed`);
    f.status = 'in_transit';
    return f;
  }
  deliverFreight(freightId: string): Freight {
    const f = this.requireFreight(freightId);
    if (f.status !== 'in_transit') throw new BadRequestException(`Freight is ${f.status}, expected in_transit`);
    f.status = 'delivered'; // no longer counts against the driver's remaining capacity
    return f;
  }

  listFreight(filter: { status?: Freight['status'] } = {}): Freight[] {
    return [...this.freights.values()].filter((f) => !filter.status || f.status === filter.status);
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
    const freight = [...this.freights.values()].filter((f) => f.status === 'available').map((f) => this.wrapFreight(f));
    return [...totes, ...freight];
  }

  private wrapTote(code: string): Claimable | null {
    const t = this.totes.byCodeMaybe(code);
    if (!t) return null;
    // A loaded (in-transit) tote sits on the bus — fall back to an "on board" label so it still shows
    // among the driver's loads. Available/claimed totes resolve to their PUDO/MDP pickup point.
    const place = this.place(t.locationId) ?? { loc: { lat: 0, lng: 0 }, label: 'on board' };
    const fragile = false; // totes are not individually flagged fragile here; parcel rules apply at load
    return { kind: 'tote', ref: t.code, pickupLocation: place.loc, pickupLabel: place.label, destLabel: t.destinationLabel || 'destination', weightKg: t.weightKg, fragile, bulk: false };
  }

  private wrapFreight(f: Freight): Claimable {
    return { kind: 'freight', ref: f.freightId, pickupLocation: f.pickupLocation, pickupLabel: f.pickupLabel, destLabel: f.destLabel, weightKg: f.weightKg, fragile: f.fragile, bulk: f.bulk };
  }

  private vehicleCanCarry(vehicle: Vehicle, load: Claimable, remainingKg: number): boolean {
    if (load.weightKg > remainingKg) return false;
    if (load.weightKg > vehicle.capacityKg) return false;
    if (load.fragile && !vehicle.allowsFragile) return false;
    if (load.bulk && !vehicle.carriesBulk) return false;
    return true;
  }

  /** Resolve a tote's locationId (an MDP id or an agent DID) → its coordinates + display label. */
  private place(locationId: string): { loc: { lat: number; lng: number }; label: string } | null {
    const mdp = this.mdps.list().find((m) => m.mdpId === locationId);
    if (mdp) return { loc: mdp.location, label: mdp.name };
    try { const a = this.agents.get(locationId); return { loc: a.location, label: a.shopName }; } catch { return null; }
  }

  private minutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    return Math.max(1, Math.round((haversineKm(a, b) / VEHICLE_SPEED_KMH.bus) * 60));
  }

  private requireOffer(offerId: string): Offer {
    const o = this.offers.get(offerId);
    if (!o) throw new NotFoundException(`Offer not found: ${offerId}`);
    return o;
  }

  private requireFreight(freightId: string): Freight {
    const f = this.freights.get(freightId);
    if (!f) throw new NotFoundException(`Freight not found: ${freightId}`);
    return f;
  }
}
