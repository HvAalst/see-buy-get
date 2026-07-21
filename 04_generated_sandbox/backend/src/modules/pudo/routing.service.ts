import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { ShelfService } from './shelf.service';
import { CorridorService } from './corridor.service';
import { MdpService } from './mdp.service';
import { VehicleService } from './vehicle.service';
import { haversineKm } from './geo';
import { isOpenAt, nextOpenAt } from './hours';
import { DISPATCH_BUFFER_H, HANDOVER_BUFFER_H, PLATFORM_FEE_PCT, SIZE_TRANSPORT_FACTOR, SIZE_WEIGHT_KG, VEHICLE_SPEED_KMH, withPlatformFee } from './pudo.config';
import { ParcelSize } from './pudo.types';

export interface NodePick {
  agentDid: string;
  shopName: string;
  zone: string;
  distanceKm?: number;
}

export interface QuoteLeg { transport: number; base: number; total: number; }
export interface ShipmentQuote {
  hops: Array<{ type: 'pudo' | 'mdp'; id: string; label: string; zone: string }>;
  nodes: Array<{ type: 'pudo' | 'mdp'; id: string; label: string; fee: number }>; // each stop + its open-data fee (the tail)
  legs: Array<{ from: string; to: string; km: number }>; // per-leg distance (the tail)
  totalKm: number;
  nodeFees: number;
  size: ParcelSize;
  transportFactor: number;
  perKm: { min: number; max: number };
  platformFeePct: number;
  flexible: QuoteLeg;
  locked: QuoteLeg;
}

/** A located waypoint on the journey: the origin PUDO, an MDP hub, or the destination PUDO. */
interface RouteHop {
  type: 'pudo' | 'mdp';
  id: string;
  label: string;
  zone: string;
  location: { lat: number; lng: number };
}

/**
 * RoutingService. Picks the **first-mile node** a parcel commits to (the nearest open PUDO with free
 * shelf capacity) and **computes the journey legs** to the destination over the static corridors —
 * with the arrival time corrected to the destination's opening hours (a parcel is never "ready for
 * pickup" while the shop is closed). This is what the shelf grid + opening hours unlock.
 */
@Injectable()
export class RoutingService {
  constructor(
    private readonly agents: AgentService,
    private readonly shelf: ShelfService,
    private readonly corridors: CorridorService,
    private readonly mdps: MdpService,
    private readonly vehicles: VehicleService,
  ) {}

  /**
   * Quote a shipment from the OPEN-DATA participant rates along the route: node fees (each PUDO + MDP's
   * advertised per-parcel price) + transport (route km × a per-km rate × a size factor) + the 2% margin.
   * Two prices: `flexible` reserves the worst case (dearest carrier) so any passing vehicle can claim it
   * (the over-hold is rebated on delivery); `locked` is the cheapest carrier if the vendor commits the route.
   */
  quoteShipment(originAgentDid: string, destAgentDid: string, size: ParcelSize = 'M'): ShipmentQuote {
    const plan = this.planJourney({ originAgentDid, destAgentDid, weightKg: SIZE_WEIGHT_KG[size] });
    const nodes = plan.hops.map((h) => ({ type: h.type, id: h.id, label: h.label, fee: Math.round((h.type === 'mdp' ? this.mdps.require(h.id).pricePerParcel : this.agents.get(h.id).pricePerParcel) * 100) / 100 }));
    const legs = plan.legs.map((l) => ({ from: l.from, to: l.to, km: l.distanceKm }));
    const nodeFees = Math.round(nodes.reduce((sum, n) => sum + n.fee, 0) * 100) / 100;
    const totalKm = Math.round(legs.reduce((s, l) => s + l.km, 0) * 10) / 10;
    const factor = SIZE_TRANSPORT_FACTOR[size];
    const { min, max } = this.vehicles.priceRange();
    const transport = (rate: number) => Math.round(totalKm * rate * factor * 100) / 100;
    const leg = (rate: number) => { const t = transport(rate); const base = Math.round((nodeFees + t) * 100) / 100; return { transport: t, base, total: withPlatformFee(base) }; };
    return {
      hops: plan.hops, nodes, legs, totalKm, nodeFees, size, transportFactor: factor, perKm: { min, max }, platformFeePct: PLATFORM_FEE_PCT,
      flexible: leg(max), locked: leg(min),
    };
  }

  /** The real total at a known per-km rate (the delivering carrier's) — drives the flexible rebate. */
  costAtRate(nodeFees: number, totalKm: number, size: ParcelSize, perKm: number): number {
    return withPlatformFee(Math.round((nodeFees + totalKm * perKm * SIZE_TRANSPORT_FACTOR[size]) * 100) / 100);
  }

  /** Choose the origin node a parcel will be committed to: nearest open PUDO with a free slot. */
  assignFirstMileNode(input: { location?: { lat: number; lng: number }; zone?: string }): NodePick {
    const candidates = this.agents
      .list()
      .filter((a) => a.status === 'ACTIVE' && a.openState === 'open' && this.shelf.hasSpace(a.did) && (!input.zone || a.zone === input.zone));
    if (!candidates.length) throw new GlosError('NO_CAPACITY_AVAILABLE', 'No open PUDO with free shelf capacity available');

    const ranked = input.location
      ? candidates.map((a) => ({ a, d: haversineKm(input.location!, a.location) })).sort((x, y) => x.d - y.d)
      : candidates.map((a) => ({ a, d: undefined as number | undefined }));
    const { a, d } = ranked[0];
    return { agentDid: a.did, shopName: a.shopName, zone: a.zone, distanceKm: d != null ? Math.round(d) : undefined };
  }

  /**
   * Compute the journey legs from an origin node (given or assigned) to the destination PUDO.
   * Routes through MDP hubs when they exist (origin PUDO → MDP[s] → destination PUDO); falls back to
   * a single direct corridor when neither end is served by a hub. The final arrival is corrected to
   * the destination's opening hours — a parcel is never "ready for pickup" while the shop is closed.
   */
  planJourney(input: { originAgentDid?: string; destAgentDid: string; fromLocation?: { lat: number; lng: number }; weightKg?: number }) {
    const dest = this.agents.get(input.destAgentDid);
    const originPick = input.originAgentDid ? this.nodePick(input.originAgentDid) : this.assignFirstMileNode({ location: input.fromLocation });
    const origin = this.agents.get(originPick.agentDid);

    const route = this.buildRoute(origin, dest);
    const viaMdp = route.some((h) => h.type === 'mdp');
    if (!viaMdp && origin.zone !== dest.zone) {
      // Cross-zone with no hub → require a direct zone-pair corridor (the pre-MDP behaviour).
      // Same-zone deliveries need no corridor: they are a direct local hop (a neighbourhood courier leg).
      const corridor = this.corridors.forZones(origin.zone, dest.zone);
      if (!corridor) throw new GlosError('NOT_FOUND', `No active corridor from ${origin.zone} to ${dest.zone} and no MDP hub to route through`);
    }

    const weightKg = input.weightKg ?? 1;
    const vehicle = this.corridors.chooseVehicle(weightKg);

    let cursor = Date.now() + DISPATCH_BUFFER_H * 3_600_000;
    const legs = route.slice(0, -1).map((from, i) => {
      const to = route[i + 1];
      const distanceKm = Math.round(haversineKm(from.location, to.location) * 10) / 10;
      const transitH = distanceKm / VEHICLE_SPEED_KMH[vehicle];
      const departAt = cursor;
      const arriveAt = departAt + (transitH + HANDOVER_BUFFER_H) * 3_600_000;
      cursor = arriveAt + (to.type === 'mdp' ? HANDOVER_BUFFER_H * 3_600_000 : 0); // sort dwell at a hub
      return {
        index: i,
        mode: vehicle,
        legType: to.type === 'mdp' ? ('to_mdp' as const) : from.type === 'mdp' ? ('last_mile' as const) : ('direct' as const),
        from: from.label,
        to: to.label,
        fromNode: from.id,
        toNode: to.id,
        distanceKm,
        departAt: new Date(departAt).toISOString(),
        arriveAt: new Date(arriveAt).toISOString(),
      };
    });

    const arrivalDate = new Date(legs[legs.length - 1].arriveAt);
    // ETA-vs-opening-hours: the customer can only collect when the destination PUDO is open.
    const pickupReadyAt = nextOpenAt(dest.openingHours, arrivalDate);
    const arrivesWhileOpen = isOpenAt(dest.openingHours, arrivalDate);
    const totalHours = Math.round(((arrivalDate.getTime() - Date.now()) / 3_600_000) * 10) / 10;

    return {
      originNode: { ...originPick, committed: true },
      hops: route.map((h) => ({ type: h.type, id: h.id, label: h.label, zone: h.zone })),
      mdpRouted: viaMdp,
      destNode: { agentDid: dest.did, shopName: dest.shopName, zone: dest.zone, freeSlots: this.shelf.available(dest.did) },
      legs,
      transitArrivalAt: arrivalDate.toISOString(),
      pickupReadyAt: pickupReadyAt.toISOString(),
      arrivesWhileOpen,
      totalHours,
    };
  }

  /** origin PUDO → MDP(origin zone) → MDP(dest zone, if different) → dest PUDO (hubs collapse if shared). */
  private buildRoute(origin: ReturnType<AgentService['get']>, dest: ReturnType<AgentService['get']>): RouteHop[] {
    const route: RouteHop[] = [{ type: 'pudo', id: origin.did, label: origin.shopName, zone: origin.zone, location: origin.location }];
    const originMdp = this.mdps.mdpForZone(origin.zone);
    const destMdp = this.mdps.mdpForZone(dest.zone);
    if (originMdp) route.push({ type: 'mdp', id: originMdp.mdpId, label: originMdp.name, zone: origin.zone, location: originMdp.location });
    if (destMdp && destMdp.mdpId !== originMdp?.mdpId) route.push({ type: 'mdp', id: destMdp.mdpId, label: destMdp.name, zone: dest.zone, location: destMdp.location });
    route.push({ type: 'pudo', id: dest.did, label: dest.shopName, zone: dest.zone, location: dest.location });
    return route;
  }

  private nodePick(agentDid: string): NodePick {
    const a = this.agents.get(agentDid);
    return { agentDid: a.did, shopName: a.shopName, zone: a.zone };
  }
}
