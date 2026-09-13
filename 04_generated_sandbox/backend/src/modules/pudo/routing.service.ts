import { Inject, Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { ShelfService } from './shelf.service';
import { CorridorService } from './corridor.service';
import { MdpService } from './mdp.service';
import { VehicleService } from './vehicle.service';
import { Router, ROUTER } from './router';
import { isOpenAt, nextOpenAt } from './hours';
import { PresenceService } from '../../foundation/presence/presence.service';
import { BORDER_DWELL_H, DISPATCH_BUFFER_H, HANDOVER_BUFFER_H, NETWORK_JURISDICTION, SIZE_LANE, SIZE_TRANSPORT_FACTOR, SIZE_WEIGHT_KG, taxOn, VEHICLE_SPEED_KMH, withPlatformFee } from './pudo.config';
import { EntityService } from '../../foundation/entity/entity.service';
import { ResolvedInsurance, ResolvedRates, ResolvedTax } from '../../foundation/entity/entity.types';
import { currencyForJurisdiction, requireCurrencyFor } from '../../foundation/money/currency';
import { FX_QUOTE_TTL_MIN, FxRate, FxService } from '../../foundation/money/fx.service';
import { BorderCrossing, crossingsOn } from './country';
import { ParcelFx, ParcelSize } from './pudo.types';

export interface NodePick {
  agentDid: string;
  shopName: string;
  zone: string;
  distanceKm?: number;
}

/**
 * One priced outcome: what the work cost, what the platform takes, and the sum.
 *
 * `fee` is stated rather than left as `total − base`. A merchant reconciling their books needs the
 * platform's take as a line the way they get one from any other platform they pay; derivable is not the
 * same as stated, and every other component of this quote is named.
 *
 * `total` is NET OF TAX and stays that way — it is the sister's own price, and it is the figure every
 * margin question is asked of. `tax` is the next layer on top of it and `gross` is what the customer
 * actually pays. The three hold `total + tax === gross` exactly.
 *
 * Which figure to CHARGE is not a matter of taste: it is `gross`. `total` is what the business earned.
 */
export interface QuoteLeg {
  transport: number;
  base: number;
  fee: number;
  total: number;
  tax: number;
  gross: number;
  /**
   * The COST-OF-RISK slice of `fee` — already inside it, never added to it.
   *
   * The customer has always paid this: cost of risk is one of the three layers the platform fee is made
   * of, so it has been in every price since the rate stack shipped. What it has never been is money set
   * ASIDE — the whole fee landed in revenue, which made carrying risk look like earning. Stating the
   * slice here lets billing move it to the claims provision instead, and moves not one cent of anybody's
   * price: `base + fee === total` still holds, and this is a part of `fee`, not a fourth term.
   *
   * Zero wherever a sister has not set a cost-of-risk rate, which is everywhere today.
   */
  provision: number;
}
/**
 * A stop on the journey + its open-data fee, the sister company owed that fee, and what it is owed IN.
 *
 * Two amounts on purpose. `nativeFee` in `currency` is what the site actually charges — the number it
 * advertises and the number it will be paid. `fee` is that amount expressed in the QUOTE's currency, which
 * is what the buyer's price is built from. On a domestic route they are the same number; across a border
 * they must not be conflated, because one of them is a promise to a shop and the other is a promise to a
 * buyer, and the rate between them can move.
 */
export interface QuoteNode {
  type: 'pudo' | 'mdp';
  id: string;
  label: string;
  fee: number;
  nativeFee: number;
  entityId: string;
  country: string;
  currency: string;
  /**
   * P4 — a stop with no sister behind it: a service the SELLING sister buys. `entityId` is then the seller,
   * which owes the shop directly; the shop is paid out only where money may leave to a supplier there.
   */
  purchased?: boolean;
}

/** The rates a quote was converted at, and how long the resulting price is good for. Shared with the
 *  parcel, so what was quoted and what was minted can be compared line for line. */
export type QuoteFx = ParcelFx;
export interface ShipmentQuote {
  hops: Array<{ type: 'pudo' | 'mdp' | 'dock'; id: string; label: string; zone: string; country: string }>;
  nodes: QuoteNode[]; // each stop + its open-data fee (the tail)
  legs: Array<{ from: string; to: string; km: number }>; // per-leg distance (the tail)
  /** The sister companies that perform this journey. One today; on a cross-border route the second is
   *  what one sister will owe the other, which is the whole reason a leg has to name its performer. */
  entityIds: string[];
  /** The sister SELLING this shipment: it collects the whole price, keeps the margin, and carries the
   *  cost of every leg — including the ones another sister's shops perform and recharge to it at cost. */
  sellerEntityId: string;
  /** The currency every figure below is in — the selling sister's. A quote is a promise to a buyer, and
   *  a promise made in no particular currency is not one. */
  currency: string;
  /** The rates this quote was converted at. ABSENT on a single-currency route — nothing was converted,
   *  so there is nothing to expire. Present means the price stands on a rate and has a shelf life. */
  fx?: QuoteFx;
  /** Whether the goods leave one country for another, and on which legs. Empty on a domestic route. */
  crossesBorder: boolean;
  crossings: BorderCrossing[];
  totalKm: number;
  nodeFees: number;
  size: ParcelSize;
  transportFactor: number;
  /** Where `transportFactor` came from: a real measurement, or the band the size was declared as.
   *  Stated rather than left to be inferred from the decimals — `ToteHaul.basis` set the precedent, and
   *  a merchant asking why two similar boxes priced differently deserves the answer inside the quote. */
  factorBasis: 'measured' | 'band';
  perKm: { min: number; max: number };
  /** What the platform takes, as a fraction — the SUM of the seller's three layers. */
  platformFeePct: number;
  /**
   * The three layers behind that one number — INTERNAL.
   *
   * For seeing how the business is doing and for deciding: a sister earning well cannot otherwise tell
   * whether it is because the market is good or because it is carrying risk nobody is paying for. Never
   * shown to a buyer, who sees a price; a merchant sees `fee`, one line, like any platform they pay.
   */
  rates: ResolvedRates;
  /**
   * The tax the selling sister charges on this shipment, and the authority it collects under.
   *
   * Unlike `rates` this is NOT internal: a customer is entitled to know what tax they were charged and by
   * whom, and in most jurisdictions a receipt is required to say so. It is the one part of the price
   * breakdown that is nobody's commercial secret.
   */
  tax: ResolvedTax;
  /**
   * The cover the selling sister gives, and what it charges above it.
   *
   * PUBLIC, like the tax and unlike the rate split: a shipper cannot decide whether to declare a value
   * without knowing what is already covered and what the extra would cost. The premium itself is not in
   * the legs, because it is charged on the value of the GOODS — a base this quote knows nothing about
   * until somebody declares one.
   */
  insurance: ResolvedInsurance;
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
/**
 * A quote with the platform's own three layers removed — what leaves the building.
 *
 * `rates` is documented as internal on the type and was nevertheless being served whole from a `@Public()`
 * endpoint, which meant anyone could read a sister's cost-of-risk, profit-on-risk and margin by asking for
 * a shipping price. The decision was explicit: a buyer sees a price, a merchant sees ONE platform fee, and
 * the split is for running the business. A type comment does not enforce itself, so this does.
 *
 * The TAX deliberately stays. It is the one part of a price that is nobody's commercial secret — a customer
 * is entitled to know what tax they were charged and by whom, and in most jurisdictions a receipt must say.
 *
 * `provision` goes with `rates`, and it is worth saying why it is not enough to strip the object: the
 * per-leg provision is `base × costOfRiskPct`, and `base` is public, so leaving it would publish the
 * cost-of-risk knob by division. A secret that can be divided out of two public numbers is not a secret —
 * which is how it slipped back in the first time, through a different field than the one that was fixed.
 */
export type PublicQuoteLeg = Omit<QuoteLeg, 'provision'>;
export type PublicQuote = Omit<ShipmentQuote, 'rates' | 'flexible' | 'locked'> & { flexible: PublicQuoteLeg; locked: PublicQuoteLeg };

export function publicQuote(quote: ShipmentQuote): PublicQuote {
  const { rates: _internal, flexible, locked, ...rest } = quote;
  const strip = (leg: QuoteLeg): PublicQuoteLeg => {
    const { provision: _cover, ...open } = leg;
    return open;
  };
  return { ...rest, flexible: strip(flexible), locked: strip(locked) };
}

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
    private readonly presence: PresenceService,
    private readonly fx: FxService,
    @Inject(ROUTER) private readonly router: Router,
  ) {}

  /**
   * Quote a shipment from the OPEN-DATA participant rates along the route: node fees (each PUDO + MDP's
   * advertised per-parcel price) + transport (route km × a per-km rate × a size factor) + the 2% margin.
   * Two prices: `flexible` reserves the worst case (dearest carrier) so any passing vehicle can claim it
   * (the over-hold is rebated on delivery); `locked` is the cheapest carrier if the vendor commits the route.
   */
  quoteShipment(originAgentDid: string, destAgentDid: string, size: ParcelSize = 'M', measured?: number): ShipmentQuote {
    this.doorFor(originAgentDid, destAgentDid);
    return this.quoteJourney(this.planJourney({ originAgentDid, destAgentDid, weightKg: SIZE_WEIGHT_KG[size] }), size, undefined, measured);
  }

  /**
   * The quote AND the journey behind it, in one pass.
   *
   * A customer-facing answer needs both — a price and when they could collect it — and planning the same
   * route twice to get them is work a public endpoint should not be doing on a stranger's behalf.
   */
  quoteWithPlan(originAgentDid: string, destAgentDid: string, size: ParcelSize = 'M', measured?: number): { plan: ReturnType<RoutingService['planJourney']>; quote: ShipmentQuote } {
    this.doorFor(originAgentDid, destAgentDid);
    const plan =this.planJourney({ originAgentDid, destAgentDid, weightKg: SIZE_WEIGHT_KG[size] });
    return { plan, quote: this.quoteJourney(plan, size, undefined, measured) };
  }

  /**
   * Quote a journey that starts at a PLACE rather than a node — a store's own dock.
   *
   * Same stack, one term missing: no origin shop handled it, so no origin node fee is charged. That is not
   * a discount, it is the absence of work. `sellerEntityId` is the sister that sells the shipment (the
   * store's own), which is who the margin belongs to when there is no origin shop to take it from.
   */
  quoteShipmentFrom(from: RouteEnd, destAgentDid: string, size: ParcelSize = 'M', sellerEntityId?: string, measured?: number): ShipmentQuote {
    this.doorFor(undefined, destAgentDid);
    return this.quoteJourney(this.planJourney({ from, destAgentDid, weightKg: SIZE_WEIGHT_KG[size] }), size, sellerEntityId, measured);
  }

  /**
   * P2b — THE QUOTE'S DOOR. A price is a promise to perform and to be paid, so it is asked first whether
   * we may charge anyone at either end — before the route is planned, and long before a shop's fee resolves
   * to a sister that does not exist and refuses in words about a float the buyer has never heard of.
   */
  private doorFor(originAgentDid: string | undefined, destAgentDid: string): void {
    // P4 — THE JOURNEY DECIDES. The origin shop's sister SELLS the shipment, so it is asked whether we may
    // charge anyone there. The destination only has to be allowed to take goods in: where no sister stands
    // behind it, its leg is a service the seller buys (see quoteJourney).
    if (originAgentDid) this.presence.require(this.agents.countryOf(this.agents.get(originAgentDid)), 'merchantOfRecord');
    this.presence.require(this.agents.countryOf(this.agents.get(destAgentDid)), 'takeIn');
  }

  private quoteJourney(plan: ReturnType<RoutingService['planJourney']>, size: ParcelSize, sellerEntityId?: string, measured?: number): ShipmentQuote {
    // Each stop names the sister that will be owed its fee. Today they are all the same company, so the
    // quote reads as one entity's cost stack — but the fee is owed to a shop by a specific sister, and
    // writing that down now is what makes a cross-border route expressible later without a re-quote.
    // A DOCK is on the route but not in the stack: it is where the parcel was, not somebody who handled it.
    // Each stop, what it is owed, and IN WHAT. The native amount is the shop's own advertised rate in its
    // own money; the fee the price is built from comes after, once we know what money the price is in.
    // P2b/P4 — every hop, before a single fee is resolved, so a refusal names the country and not a float.
    // A HUB is registered only where a sister stands, so it must be where we can bill. A SHOP need only be
    // allowed to take goods in: where no sister stands behind it, its leg is bought by the seller.
    for (const h of plan.hops) {
      if (h.type === 'mdp') this.presence.require(h.country ?? NETWORK_JURISDICTION, 'merchantOfRecord');
      if (h.type === 'pudo') this.presence.require(h.country ?? NETWORK_JURISDICTION, 'takeIn');
    }
    const sites = plan.hops.filter((h): h is typeof h & { type: 'pudo' | 'mdp' } => h.type !== 'dock').map((h) => {
      const isHub = h.type === 'mdp';
      const site = isHub ? this.mdps.require(h.id) : this.agents.get(h.id);
      const own = isHub ? this.mdps.entityIdOf(this.mdps.require(h.id)) : this.agents.entityIdOrNone(this.agents.get(h.id));
      return { type: h.type, id: h.id, label: h.label, own, country: h.country, nativeFee: Math.round(site.pricePerParcel * 100) / 100 };
    });
    // The margin belongs to the sister selling the shipment, not to the network: the one named, else the
    // first stop that has a sister of its own — which the door has already made the origin.
    const sellerId = sellerEntityId ?? sites.find((s) => s.own)?.own;
    if (!sellerId) throw new GlosError('FORBIDDEN', 'Nobody of ours can sell this journey: no stop on it stands where a company of ours does');
    const stops = sites.map((s) =>
      s.own
        ? { ...s, entityId: s.own, purchased: false, currency: this.currencyOf(s.own) }
        : // P4 — the seller owes this shop directly, in the shop's own money. An unmapped country refuses
          // by name rather than silently becoming dollars (user, 2026-09-13).
          { ...s, entityId: sellerId, purchased: true, currency: requireCurrencyFor(s.country) },
    );
    const entityIds = [...new Set(stops.map((n) => n.entityId))];
    const legs = plan.legs.map((l) => ({ from: l.from, to: l.to, km: l.distanceKm }));
    const totalKm = Math.round(legs.reduce((s, l) => s + l.km, 0) * 10) / 10;
    // ITEM 9. A MEASURED parcel is charged for what it measures; a DECLARED one for the band it was
    // declared as. The band is still derived from the same limit table, so nothing became under-declarable
    // that was not before — what changed is that a real measurement is no longer rounded up to a tier.
    const factor = measured ?? SIZE_TRANSPORT_FACTOR[size];
    const { min, max } = this.vehicles.priceRange();
    /**
     * NO SURGE HERE, AND THAT IS A DECISION — user, 2026-09-06.
     *
     * The market pulse prices freight: `suggest`, `suggestNearby`, `offerNear` and the claim lock all flex
     * a driver's offer by what the zone is doing. It has never reached this function, and it must not. A
     * published shipping price on a merchant's checkout is a different promise from a driver's spot offer:
     * a buyer quoted one figure at breakfast and another at lunch reads it as a trick, and it is the
     * MERCHANT who fields that complaint, not us.
     *
     * That is why `MarketPulseStore` is absent from this service's constructor. Injecting it would look
     * like finishing an unfinished job; `parcel-price-stability.spec.ts` is what says otherwise, and it
     * fails loudly the moment a surge factor reaches a parcel.
     */
    const transport = (rate: number) => Math.round(totalKm * rate * factor * 100) / 100;
    // The margin belongs to the sister selling the shipment, not to the network. Today one company
    // performs the whole journey, so the origin node's rate is that company's; when a route crosses a
    // border the COLLECTING sister's rate is the one that should apply, per R1 — revisit it there.
    // (The seller was resolved above, before any stop could be priced against it.)
    // The seller's three layers for THIS KIND of work. A letter through the shop network and a dedicated
    // truck haul are different businesses carrying different risk, and a sister can now say so. The lane
    // comes from the size's own class, so nothing new has to be declared to get the right rate.
    const stack = this.entities.ratesFor(sellerId, SIZE_LANE[size]);
    const feePct = stack.totalPct;
    // The SELLING sister's tax, on the lane this size ships in. The seller's, deliberately — it is the
    // merchant of record for the whole shipment, and a leg performed by another sister's shop is bought by
    // this one at cost rather than sold by that one to the buyer. Whose tax applies follows who is selling.
    const taxRule = this.entities.taxFor(sellerId, SIZE_LANE[size]);
    const insurance = this.entities.insuranceFor(sellerId, SIZE_LANE[size]);

    // ONE CURRENCY, NAMED. The seller quotes in its own money and every figure below is summed into it, so
    // a stop paid in another currency is CONVERTED here — at a stated rate, from a rate book that says
    // where the number came from and how old it is. This used to refuse outright; the refusal survives
    // where it is still true, which is a currency the rate book has never heard of.
    //
    // Note what is converted and what is not: a NODE FEE is somebody else's price in their own money.
    // Transport and the margin are the seller's own, already in the quote's currency, and converting them
    // would be converting a number that never left home.
    const currency = this.currencyOf(sellerId);
    const quotedAt = new Date();
    const used = new Map<string, FxRate>();
    const nodes: QuoteNode[] = stops.map((n) => {
      if (n.currency !== currency) {
        // The BUFFERED rate, because this is a price somebody will be charged. The shop is owed exactly
        // what it asked for in its own money whatever the rate does afterwards; the person who chose to
        // ship across a border carries the movement. Both rates ride along — see FX_SPREAD_PCT.
        const rate = this.fx.quoteRate(n.currency, currency);
        used.set(`${rate.from}>${rate.to}`, rate);
      }
      return {
        type: n.type,
        id: n.id,
        label: n.label,
        entityId: n.entityId,
        country: n.country,
        currency: n.currency,
        nativeFee: n.nativeFee,
        fee: this.fx.convertForQuote(n.nativeFee, n.currency, currency),
        ...(n.purchased ? { purchased: true } : {}),
      };
    });
    const nodeFees = Math.round(nodes.reduce((sum, n) => sum + n.fee, 0) * 100) / 100;
    const rates = [...used.values()];
    // What the buffer actually came to, in money: the gap between what the buyer is charged for the
    // foreign stops and what the sisters will settle them at. Computed HERE, where both numbers exist,
    // rather than re-derived later from a rate — and stamped on the parcel so billing can book it as the
    // buffer it is instead of as margin.
    const buffer = Math.round(nodes.reduce((sum, n) => sum + (n.currency === currency ? 0 : n.fee - this.fx.convert(n.nativeFee, n.currency, currency)), 0) * 100) / 100;
    // The rate may be old — that is a fact about the world and it is reported. What was PROMISED is only
    // good for the window: a price stated in converted money cannot be honoured indefinitely, and the
    // mint re-quotes against this before it commits anybody.
    const fx: QuoteFx | undefined = rates.length
      ? { base: currency, rates, buffer, quotedAt: quotedAt.toISOString(), expiresAt: new Date(quotedAt.getTime() + FX_QUOTE_TTL_MIN * 60_000).toISOString(), stale: rates.some((r) => r.stale) }
      : undefined;

    // Where the goods leave one customs territory for another. Read off the route rather than stored, and
    // reported rather than charged for: a crossing costs time and paperwork that this quote does NOT yet
    // price or schedule. Saying which leg crosses is what makes that gap addressable instead of invisible.
    const crossings = crossingsOn(plan.hops);
    // The fee is derived from the two figures rather than computed a second way, so `base + fee === total`
    // holds exactly — a rounding difference between a stated line and the total it belongs to is the kind
    // of penny a merchant reconciles for an hour and never forgives.
    const leg = (rate: number): QuoteLeg => {
      const t = transport(rate);
      const base = Math.round((nodeFees + t) * 100) / 100;
      const total = withPlatformFee(base, feePct);
      // Tax on the WHOLE price including the platform's take, not on the cost base — what is taxed is the
      // sale, not the profit. Zero-rated by default, in which case `gross` is `total` to the cent and
      // every figure below is the number it was before tax existed.
      const { tax, gross } = taxOn(total, taxRule.ratePct);
      // The cost-of-risk slice, on the same base the fee was computed on. Carved OUT of the fee rather
      // than added on: the three layers are additive on `base`, so the risk layer's money is exactly
      // `base × costOfRiskPct` and it is already inside the total above.
      const provision = Math.round(base * stack.costOfRiskPct * 100) / 100;
      return { transport: t, base, fee: Math.round((total - base) * 100) / 100, total, tax, gross, provision };
    };
    return {
      hops: plan.hops, nodes, legs, entityIds, sellerEntityId: sellerId, currency, fx, crossesBorder: crossings.length > 0, crossings,
      totalKm, nodeFees, size, transportFactor: factor, factorBasis: measured != null ? 'measured' : 'band', perKm: { min, max }, platformFeePct: feePct, rates: stack, tax: taxRule, insurance,
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
      // A leg that leaves one country for another stops at a post and waits. It is the one leg on a
      // continental route that genuinely does not move, and reading it as if it did was the lie.
      const crossesBorder = from.country !== to.country;
      const departAt = cursor;
      const arriveAt = departAt + (transitH + HANDOVER_BUFFER_H + (crossesBorder ? BORDER_DWELL_H : 0)) * 3_600_000;
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
        crossesBorder,
        /** The wait at the post, called out separately from the driving so the ETA can be argued with. */
        borderDwellH: crossesBorder ? BORDER_DWELL_H : 0,
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
