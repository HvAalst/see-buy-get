import { Inject, Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { ShelfService } from './shelf.service';
import { CorridorService } from './corridor.service';
import { MdpService } from './mdp.service';
import { VehicleService } from './vehicle.service';
import { Router, ROUTER } from './router';
import { isOpenAt, nextOpenAt } from './hours';
import { DISPATCH_BUFFER_H, HANDOVER_BUFFER_H, SIZE_TRANSPORT_FACTOR, SIZE_WEIGHT_KG, VEHICLE_SPEED_KMH, withPlatformFee } from './pudo.config';
import { EntityService } from '../../foundation/entity/entity.service';
import { currencyForJurisdiction } from '../../foundation/money/currency';
import { BorderCrossing, crossingsOn } from './country';
import { ParcelSize } from './pudo.types';

export interface NodePick {
  agentDid: string;
  shopName: string;
  zone: string;
  distanceKm?: number;
}

export interface QuoteLeg { transport: number; base: number; total: number; }
/** A stop on the journey + its open-data fee, the sister company owed that fee, and what it is owed IN. */
export interface QuoteNode { type: 'pudo' | 'mdp'; id: string; label: string; fee: number; entityId: string; country: string; currency: string; }
export interface ShipmentQuote {
  hops: Array<{ type: 'pudo' | 'mdp' | 'dock'; id: string; label: string; zone: string; country: string }>;
  nodes: QuoteNode[]; // each stop + its open-data fee (the tail)
  legs: Array<{ from: string; to: string; km: number }>; // per-leg distance (the tail)
  /** The sister companies that perform this journey. One today; on a cross-border route the second is
   *  what one sister will owe the other, which is the whole reason a leg has to name its performer. */
  entityIds: string[];
  /** The currency every figure below is in — the selling sister's. A quote is a promise to a buyer, and
   *  a promise made in no particular currency is not one. */
  currency: string;
  /** Whether the goods leave one country for another, and on which legs. Empty on a domestic route. */
  crossesBorder: boolean;
  crossings: BorderCrossing[];
  totalKm: number;
  nodeFees: number;
  size: ParcelSize;
  transportFactor: number;
  perKm: { min: number; max: number };
  platformFeePct: number;
  flexible: QuoteLeg;
  locked: QuoteLeg;
}

/**
 * Where a journey STARTS, which is not always a node of the network.
 *
 * A PUDO counter is a node: it handles the parcel and earns a fee for doing so. A store's own dock is a
 * PLACE — the parcel is born there and a driver comes to it — so it belongs on the route (it has a point,
 * a zone and a name a driver can read) and nowhere near the fee stack, because nobody worked there.
 */
export interface RouteEnd {
  type: 'pudo' | 'dock';
  id: string;
  label: string;
  zone: string;
  /** The country it stands in. Required, and required of a DOCK too: a dock is nobody's contractual
   *  party, but the goods are physically there, and a border is a fact about goods, not about invoices. */
  country: string;
  location: { lat: number; lng: number };
}

/** A located waypoint on the journey: the origin (a PUDO or a store's own dock), an MDP hub, or the
 *  destination PUDO. A 'dock' is a place the journey STARTS from that is not a node of the network — see
 *  RouteEnd — which is why it appears in the route and never in the fee stack. */
interface RouteHop {
  type: 'pudo' | 'mdp' | 'dock';
  id: string;
  label: string;
  zone: string;
  country: string;
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
    private readonly entities: EntityService,
    @Inject(ROUTER) private readonly router: Router,
  ) {}

  /**
   * Quote a shipment from the OPEN-DATA participant rates along the route: node fees (each PUDO + MDP's
   * advertised per-parcel price) + transport (route km × a per-km rate × a size factor) + the 2% margin.
   * Two prices: `flexible` reserves the worst case (dearest carrier) so any passing vehicle can claim it
   * (the over-hold is rebated on delivery); `locked` is the cheapest carrier if the vendor commits the route.
   */
  quoteShipment(originAgentDid: string, destAgentDid: string, size: ParcelSize = 'M'): ShipmentQuote {
    return this.quoteJourney(this.planJourney({ originAgentDid, destAgentDid, weightKg: SIZE_WEIGHT_KG[size] }), size);
  }

  /**
   * Quote a journey that starts at a PLACE rather than a node — a store's own dock.
   *
   * Same stack, one term missing: no origin shop handled it, so no origin node fee is charged. That is not
   * a discount, it is the absence of work. `sellerEntityId` is the sister that sells the shipment (the
   * store's own), which is who the margin belongs to when there is no origin shop to take it from.
   */
  quoteShipmentFrom(from: RouteEnd, destAgentDid: string, size: ParcelSize = 'M', sellerEntityId?: string): ShipmentQuote {
    return this.quoteJourney(this.planJourney({ from, destAgentDid, weightKg: SIZE_WEIGHT_KG[size] }), size, sellerEntityId);
  }

  private quoteJourney(plan: ReturnType<RoutingService['planJourney']>, size: ParcelSize, sellerEntityId?: string): ShipmentQuote {
    // Each stop names the sister that will be owed its fee. Today they are all the same company, so the
    // quote reads as one entity's cost stack — but the fee is owed to a shop by a specific sister, and
    // writing that down now is what makes a cross-border route expressible later without a re-quote.
    // A DOCK is on the route but not in the stack: it is where the parcel was, not somebody who handled it.
    const nodes: QuoteNode[] = plan.hops.filter((h): h is typeof h & { type: 'pudo' | 'mdp' } => h.type !== 'dock').map((h) => {
      const isHub = h.type === 'mdp';
      const site = isHub ? this.mdps.require(h.id) : this.agents.get(h.id);
      const entityId = isHub ? this.mdps.entityIdOf(this.mdps.require(h.id)) : this.agents.entityIdOf(this.agents.get(h.id));
      return {
        type: h.type,
        id: h.id,
        label: h.label,
        fee: Math.round(site.pricePerParcel * 100) / 100,
        entityId,
        country: h.country,
        // What this stop is owed IN. A shop's advertised rate is a number in its own money; adding it to a
        // number in somebody else's is not arithmetic, and the gate below is what stops us pretending.
        currency: this.currencyOf(entityId),
      };
    });
    const entityIds = [...new Set(nodes.map((n) => n.entityId))];
    const legs = plan.legs.map((l) => ({ from: l.from, to: l.to, km: l.distanceKm }));
    const nodeFees = Math.round(nodes.reduce((sum, n) => sum + n.fee, 0) * 100) / 100;
    const totalKm = Math.round(legs.reduce((s, l) => s + l.km, 0) * 10) / 10;
    const factor = SIZE_TRANSPORT_FACTOR[size];
    const { min, max } = this.vehicles.priceRange();
    const transport = (rate: number) => Math.round(totalKm * rate * factor * 100) / 100;
    // The margin belongs to the sister selling the shipment, not to the network. Today one company
    // performs the whole journey, so the origin node's rate is that company's; when a route crosses a
    // border the COLLECTING sister's rate is the one that should apply, per R1 — revisit it there.
    const sellerId = sellerEntityId ?? nodes[0]?.entityId ?? entityIds[0];
    const feePct = this.entities.feePctOf(sellerId);

    // THE CURRENCY GATE. The seller quotes in its own money, and every figure in this quote is summed:
    // node fees, transport, margin. When a stop on the route is owed in a different currency, that sum is
    // not a price — it is two prices added together as though the numbers meant the same thing.
    //
    // So the quote refuses, by name, instead of returning a plausible wrong number. Note the gate is on
    // CURRENCY and not on the border: two countries sharing a currency quote perfectly well, and one
    // country could in principle not. What a quote cannot survive is two units, not two flags.
    //
    // Lifting this is the FX slice — a rate source, a rate held for the life of the quote, and a
    // cross-sister settlement for the leg one company performs and another collects for.
    const currency = this.currencyOf(sellerId);
    const foreign = nodes.find((n) => n.currency !== currency);
    if (foreign) {
      throw new GlosError(
        'FX_REQUIRED',
        `This route is priced in ${currency} but ${foreign.label} is paid in ${foreign.currency} — cross-currency shipping is not available yet`,
        { currency, otherCurrency: foreign.currency, at: foreign.label, country: foreign.country },
      );
    }

    // Where the goods leave one customs territory for another. Read off the route rather than stored, and
    // reported rather than charged for: a crossing costs time and paperwork that this quote does NOT yet
    // price or schedule. Saying which leg crosses is what makes that gap addressable instead of invisible.
    const crossings = crossingsOn(plan.hops);
    const leg = (rate: number) => { const t = transport(rate); const base = Math.round((nodeFees + t) * 100) / 100; return { transport: t, base, total: withPlatformFee(base, feePct) }; };
    return {
      hops: plan.hops, nodes, legs, entityIds, currency, crossesBorder: crossings.length > 0, crossings,
      totalKm, nodeFees, size, transportFactor: factor, perKm: { min, max }, platformFeePct: feePct,
      flexible: leg(max), locked: leg(min),
    };
  }

  /** The money a sister is owed in — from the company, never from a deployment default. */
  private currencyOf(entityId: string): string {
    const entity = this.entities.get(entityId);
    return entity.currency ?? currencyForJurisdiction(entity.jurisdiction);
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
      ? candidates.map((a) => ({ a, d: this.router.roadKm(input.location!, a.location) })).sort((x, y) => x.d - y.d)
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
  planJourney(input: { originAgentDid?: string; destAgentDid: string; fromLocation?: { lat: number; lng: number }; weightKg?: number; from?: RouteEnd }) {
    const dest = this.agents.get(input.destAgentDid);
    // A journey may start at a place that is not a node (a store's dock). When one is given it is used as
    // it stands; otherwise the origin is a PUDO — named, or the nearest one with room.
    let origin: RouteEnd;
    if (input.from) {
      origin = input.from;
    } else {
      const pick = input.originAgentDid ? this.nodePick(input.originAgentDid) : this.assignFirstMileNode({ location: input.fromLocation });
      const a = this.agents.get(pick.agentDid);
      origin = { type: 'pudo', id: a.did, label: a.shopName, zone: a.zone, country: this.agents.countryOf(a), location: a.location };
    }

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
      const distanceKm = Math.round(this.router.roadKm(from.location, to.location) * 10) / 10;
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
        fromCountry: from.country,
        toCountry: to.country,
        // A driver on this leg presents the goods at a border. NOTHING is added to the clock for it yet —
        // no queue, no paperwork, no overnight — which is the same optimism the ETA already carries and is
        // recorded here so the customs slice knows exactly which leg to hang itself on.
        crossesBorder: from.country !== to.country,
        distanceKm,
        departAt: new Date(departAt).toISOString(),
        arriveAt: new Date(arriveAt).toISOString(),
      };
    });

    const crossings = crossingsOn(route);
    const arrivalDate = new Date(legs[legs.length - 1].arriveAt);
    // ETA-vs-opening-hours: the customer can only collect when the destination PUDO is open.
    const pickupReadyAt = nextOpenAt(dest.openingHours, arrivalDate);
    const arrivesWhileOpen = isOpenAt(dest.openingHours, arrivalDate);
    const totalHours = Math.round(((arrivalDate.getTime() - Date.now()) / 3_600_000) * 10) / 10;

    return {
      // The origin as a NODE, for the callers that commit a parcel to a first-mile shop. A dock is not one
      // — the journey starts there, but nothing was committed to anybody — so it reports itself plainly
      // rather than pretending to be a shop with a DID.
      originNode: { agentDid: origin.type === 'pudo' ? origin.id : '', shopName: origin.label, zone: origin.zone, country: origin.country, committed: origin.type === 'pudo' },
      hops: route.map((h) => ({ type: h.type, id: h.id, label: h.label, zone: h.zone, country: h.country })),
      mdpRouted: viaMdp,
      // The borders on this route, if any. A plan can be made across one; what cannot yet be made across
      // one is a PRICE (see the currency gate in quoteJourney) or an honest arrival time.
      crossings,
      crossesBorder: crossings.length > 0,
      destNode: { agentDid: dest.did, shopName: dest.shopName, zone: dest.zone, freeSlots: this.shelf.available(dest.did) },
      legs,
      transitArrivalAt: arrivalDate.toISOString(),
      pickupReadyAt: pickupReadyAt.toISOString(),
      arrivesWhileOpen,
      totalHours,
    };
  }

  /** origin PUDO → MDP(origin zone) → MDP(dest zone, if different) → dest PUDO (hubs collapse if shared). */
  private buildRoute(origin: RouteEnd, dest: ReturnType<AgentService['get']>): RouteHop[] {
    // Every stop carries the country it stands in, so the crossings fall out of the route instead of
    // having to be declared. A hub's country is the hub's own — not the zone's — because a hub can serve
    // zones across a border and it is the HUB the goods are driven to.
    const route: RouteHop[] = [{ type: origin.type, id: origin.id, label: origin.label, zone: origin.zone, country: origin.country, location: origin.location }];
    const originMdp = this.mdps.mdpForZone(origin.zone);
    const destMdp = this.mdps.mdpForZone(dest.zone);
    if (originMdp) route.push({ type: 'mdp', id: originMdp.mdpId, label: originMdp.name, zone: origin.zone, country: this.mdps.countryOf(originMdp), location: originMdp.location });
    if (destMdp && destMdp.mdpId !== originMdp?.mdpId) route.push({ type: 'mdp', id: destMdp.mdpId, label: destMdp.name, zone: dest.zone, country: this.mdps.countryOf(destMdp), location: destMdp.location });
    route.push({ type: 'pudo', id: dest.did, label: dest.shopName, zone: dest.zone, country: this.agents.countryOf(dest), location: dest.location });
    return route;
  }

  private nodePick(agentDid: string): NodePick {
    const a = this.agents.get(agentDid);
    return { agentDid: a.did, shopName: a.shopName, zone: a.zone };
  }
}
