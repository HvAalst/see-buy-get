import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { ShelfService } from './shelf.service';
import { RoutingService, type ShipmentQuote } from './routing.service';
import { QuoteBookService, type HeldQuote } from './quote-book.service';
import { ParcelService } from './parcel.service';
import { VendorService } from './vendor.service';
import { requireCountryCode } from './country';
import { declareFor } from './customs';
import { BorderCrossing } from './country';
import { ANONYMOUS, ApiKeyService, type Caller } from './api-key.service';
import { classifySize, SIZE_WEIGHT_KG } from './pudo.config';
import { Agent, ParcelSize } from './pudo.types';

/**
 * The SHIPMENT SERVICE PROVIDER surface — a price a buyer can see before deciding to buy.
 *
 * Every price this network has ever computed was computed for a vendor who had already decided to ship:
 * inside an authenticated mint, against two shop DIDs, with a parcel about to exist. A buyer standing on a
 * product page has none of that. They have not decided, they have no account, and they do not know what a
 * DID is. This is the same routing and the same open-data rates, asked the way that person can ask.
 *
 * Four rules it is built around, and each of them is a thing that would otherwise go wrong:
 *
 *  - **It creates nothing.** No parcel, no account, no reservation, no shelf slot held. A quote is a
 *    question; asking it twice costs nothing and changes nothing.
 *  - **You name a PLACE, not a DID.** Either a collection point (which a checkout already knows, because
 *    the network directory is public) or a country and an area, which is what a person actually knows.
 *  - **It never understates.** The buyer is shown the price they will not exceed, with the cheaper figure
 *    beside it — a number that turns out to be higher at checkout is worse than one that turns out lower.
 *  - **It shows the price and not the cost sheet.** The full participant stack — every shop, its fee, the
 *    sister owed it — is open data we publish deliberately, but handing a competitor a costed route on an
 *    unauthenticated call is a different act. The number goes in the open; the breakdown waits for a key.
 */

/** Where a shipment starts or ends, said the way somebody without a DID can say it. */
export interface QuoteEndpoint {
  /** A collection point, by its public id. Exact, and what a merchant's checkout already holds. */
  pointId?: string;
  /** …or a country and an area, and we find the point. */
  country?: string;
  area?: string;
}

export interface QuotedPoint {
  pointId: string;
  name: string;
  area: string;
  country: string;
  landmark?: string;
  location?: { lat: number; lng: number };
  openState: 'open' | 'closed';
}

/**
 * The costed route: every stop's own published fee and the company owed it.
 *
 * This is open data — each participant advertises its own rate and competition depends on that being
 * visible. What it is not is something to hand a competitor on an anonymous call, so it rides only with a
 * SERVER-SIDE key: the merchant paying for the shipment can see what they are paying for, and a stranger
 * with a scraper sees the number and nothing behind it.
 */
export interface QuoteBreakdown {
  nodes: Array<{ type: 'pudo' | 'mdp'; label: string; country: string; fee: number; nativeFee: number; currency: string }>;
  nodeFees: number;
  transport: number;
  platformFeePct: number;
  /** The rates the price was converted at, when it crossed a currency line. */
  fx?: { base: string; buffer: number; rates: Array<{ from: string; to: string; rate: number; mid: number; spreadPct: number; at: string; source: string; stale: boolean }> };
}

export interface PublicQuote {
  from: QuotedPoint;
  to: QuotedPoint;
  parcel: { size: ParcelSize; weightKg: number };
  /** `amount` is the ceiling — what the shipment will not cost more than. `minimum` is what it costs if
   *  the seller commits to one route. Both in `currency`, which is the selling company's money. */
  price: { currency: string; amount: number; minimum: number };
  eta: { readyAt: string; hours: number; arrivesWhileOpen: boolean };
  route: { hops: string[]; km: number; crossesBorder: boolean; crossings: BorderCrossing[] };
  /** What this shipment will additionally need before it can be sent. Empty for an ordinary domestic one. */
  requires: string[];
  /**
   * The name this price is HELD under — send it back when you create the shipment and it is minted at
   * this figure rather than at the one the world has moved to since.
   *
   * Absent on an anonymous quote: we cannot promise a price to somebody we will not recognise later.
   */
  quoteId?: string;
  /** When this price stops being good. Present whenever it is held, or whenever a rate was applied. */
  expiresAt?: string;
  /** Which world answered — `live` unless a test key asked. Always present, so a caller can never be in
   *  doubt about whether the thing they are looking at is real. */
  mode: 'test' | 'live';
  /** The costed route. Present only for a server-side key. */
  breakdown?: QuoteBreakdown;
}

/** What a merchant asks for when they want the shipment, not just the price. */
export interface MintInput {
  from?: QuoteEndpoint;
  to?: QuoteEndpoint;
  dimensionsCm?: { l: number; w: number; h: number };
  weightKg?: number;
  size?: ParcelSize;
  /** A price held earlier. Give this OR the shape above — see mint(). */
  quoteId?: string;
  buyerMobile: string;
  contentPhotoRef: string;
  externalOrderId?: string;
  items?: Array<{ name: string; qty: number }>;
  subtotal?: number;
  routeMode?: 'flexible' | 'locked';
}

/**
 * A shipment, as the merchant who paid for it sees it.
 *
 * Deliberately WITHOUT the collection code. That is the handover secret — the only thing standing between
 * a stranger and the parcel — and it belongs to the person collecting, in their own app. A merchant does
 * not need it, and putting it on an API response would widen its exposure for nobody's benefit.
 */
export interface MintedShipment {
  shipmentId: string;
  did?: string;
  trackingKey?: string;
  externalOrderId?: string;
  status: string;
  paid: boolean;
  price: { currency: string; amount: number };
  parcel: { size: ParcelSize; weightKg: number };
  collect: QuotedPoint;
  eta: { readyAt: string };
  route: { crossesBorder: boolean; crossings: BorderCrossing[] };
  /** The printable label, once the shipment is paid for. Absent while it is not. */
  label?: unknown;
  mode: 'test' | 'live';
  /** True when nothing was created: a test key ran every check and then committed nothing. */
  simulated: boolean;
}

@Injectable()
export class ShippingApiService {
  constructor(
    private readonly agents: AgentService,
    private readonly shelf: ShelfService,
    private readonly routing: RoutingService,
    private readonly parcels: ParcelService,
    private readonly vendors: VendorService,
    private readonly quotes: QuoteBookService,
  ) {}

  quote(input: { from: QuoteEndpoint; to: QuoteEndpoint; dimensionsCm?: { l: number; w: number; h: number }; weightKg?: number; size?: ParcelSize }, caller: Caller = ANONYMOUS): PublicQuote {
    const from = this.resolve(input.from, 'from');
    const to = this.resolve(input.to, 'to');
    if (from.did === to.did) throw new GlosError('INVALID_INPUT', 'Collect from and send to are the same point — a shipment needs two ends');

    // Derived from the measurements when they are given, exactly as every mint in the system does it, so a
    // quote and the shipment it becomes cannot disagree about what size the parcel was.
    const size: ParcelSize = input.dimensionsCm
      ? classifySize({ ...input.dimensionsCm, kg: input.weightKg ?? SIZE_WEIGHT_KG[input.size ?? 'M'] })
      : input.size ?? 'M';
    if (size === 'HEAVY') {
      throw new GlosError('CARGO_REQUIRES_DEDICATED', 'This is too big for the pick-up network — it needs dedicated freight, which is quoted separately');
    }
    const weightKg = input.weightKg ?? SIZE_WEIGHT_KG[size];

    const { plan, quote } = this.routing.quoteWithPlan(from.did, to.did, size);
    // A price is only worth holding for somebody we can recognise when they come back to claim it. An
    // anonymous quote is a calculation; a keyed one is a promise, and that difference is the honest reason
    // a key is worth having.
    const held = caller.vendorId
      ? this.quotes.hold({ vendorId: caller.vendorId, mode: caller.mode, quote, fromPointId: from.did, toPointId: to.did, size, weightKg, dimensionsCm: input.dimensionsCm })
      : undefined;
    return this.viewOf(quote, plan, from, to, size, weightKg, caller, held);
  }

  /**
   * One answer, built one way.
   *
   * A fresh quote and a redeemed one must be the same shape and read the same, or an integrator ends up
   * writing two parsers for one endpoint's output. The only difference between them is which figures went
   * in: a redemption brings back the price it was promised and recomputes nothing but the arrival time.
   */
  private viewOf(
    quote: ShipmentQuote,
    plan: ReturnType<RoutingService['planJourney']>,
    from: Agent,
    to: Agent,
    size: ParcelSize,
    weightKg: number,
    caller: Caller,
    held?: HeldQuote,
  ): PublicQuote {
    return {
      from: this.point(from),
      to: this.point(to),
      parcel: { size, weightKg },
      // The CEILING first. A buyer told 400 and charged 480 at checkout has been misled; one told 480 and
      // charged 400 has not. `flexible` is also what a store pays by default, so it is the likelier truth.
      price: { currency: quote.currency, amount: quote.flexible.total, minimum: quote.locked.total },
      eta: { readyAt: plan.pickupReadyAt, hours: plan.totalHours, arrivesWhileOpen: plan.arrivesWhileOpen },
      route: { hops: plan.hops.map((h) => h.label), km: quote.totalKm, crossesBorder: quote.crossesBorder, crossings: quote.crossings },
      // Said out loud rather than left for the mint to refuse: a shipment that crosses a border cannot be
      // sent without a contents list and a declared value, and an integrator should know that at quote time.
      requires: quote.crossesBorder ? ['customs_declaration'] : [],
      // When the price is held, its own expiry is the one that matters — and it is already the earlier of
      // the two, because a converted price cannot outlive the rate behind it. Unheld, the rate's window is
      // still worth saying: it is when the number stops being worth re-using.
      expiresAt: held?.expiresAt ?? quote.fx?.expiresAt,
      // Always said, never inferred. A caller must not have to work out from context whether the thing in
      // front of them is real — the answer says so.
      mode: caller.mode,
      ...(held ? { quoteId: held.quoteId } : {}),
      // ABSENT, not undefined, for a caller who has not earned it: a key that is simply missing from the
      // body cannot be mistaken for one that came back empty, and there is nothing for a reader to probe.
      ...(ApiKeyService.seesBreakdown(caller)
        ? {
            breakdown: {
              nodes: quote.nodes.map((n) => ({ type: n.type, label: n.label, country: n.country, fee: n.fee, nativeFee: n.nativeFee, currency: n.currency })),
              nodeFees: quote.nodeFees,
              transport: quote.flexible.transport,
              platformFeePct: quote.platformFeePct,
              ...(quote.fx ? { fx: { base: quote.fx.base, buffer: quote.fx.buffer, rates: quote.fx.rates } } : {}),
            },
          }
        : {}),
    };
  }

  /**
   * Turn a price into a shipment.
   *
   * The half that is not safe to repeat, which is why the caller names the attempt (see IdempotencyService)
   * and why it takes a SERVER-SIDE key: a credential that ships things must never sit in a page.
   *
   * ONE PREFLIGHT, TWO ENDINGS. Every check runs identically in both modes — the same resolution, the same
   * derived size, the same cargo gate, the same customs declaration, the same quote — and only then do the
   * paths part. That is the whole promise of a sandbox: a request that is refused in test is refused live
   * for the same reason, and one that works in test would have worked. A test mode that validates less
   * teaches a merchant to build something that fails on the day it matters.
   */
  mint(input: MintInput, caller: Caller): MintedShipment {
    if (!ApiKeyService.canMint(caller) || !caller.vendorId) {
      throw new GlosError('FORBIDDEN', 'Creating a shipment needs a secret key (sk_…) — a publishable key can only ask for prices');
    }
    const vendor = this.vendors.get(caller.vendorId);
    if (!input.buyerMobile?.trim()) throw new GlosError('PHONE_REQUIRED', 'Give the buyer’s mobile — somebody has to be told where to collect it');
    if (!input.contentPhotoRef?.trim()) throw new GlosError('PHOTO_REQUIRED', 'A photo of the contents is required — it is the baseline a damage claim is judged against');

    // REDEEM, or re-price. A held quote is honoured at the figure the buyer was shown; without one the
    // price is whatever the world says now, which is the older behaviour and still the right default for a
    // caller who never asked us to hold anything.
    const held = input.quoteId ? this.quotes.require(input.quoteId, caller.vendorId, caller.mode) : undefined;
    if (held && (input.from || input.to || input.dimensionsCm || input.weightKg || input.size)) {
      // Refused rather than resolved in somebody's favour. A quote that says "M to Kisumu" and a request
      // that says "L to Nakuru" is a caller who believes two different things about one shipment, and
      // silently honouring either of them ships the wrong parcel at a price nobody agreed to.
      throw new GlosError('INVALID_INPUT', 'Send a quoteId or the shipment’s shape, not both — the held quote already says where it goes and how big it is');
    }

    // The price and every gate behind it: the endpoints must resolve, the parcel must fit the network, the
    // route must exist, the currencies must be bridgeable. `quote` runs the caller's own key so a test mint
    // is priced by exactly the arithmetic a live one is.
    if (!held && !(input.from && input.to)) {
      throw new GlosError('FIELD_REQUIRED', 'Send a quoteId, or say where to collect from and send to');
    }
    const quoted = held ? this.heldAsQuote(held, caller) : this.quote({ ...input, from: input.from!, to: input.to! }, caller);
    const origin = this.agents.get(quoted.from.pointId);
    const dest = this.agents.get(quoted.to.pointId);

    // THE PAPERWORK GATE RUNS HERE, in the preflight, so it runs in BOTH modes. Leaving it to the live
    // mint — which does re-derive it, and is what actually writes it onto the parcel — meant a test mint
    // sailed past a border it could never have crossed. A sandbox that validates less than production
    // teaches a merchant to build something that fails on the day it matters. The declaration built here
    // is deliberately thrown away: one place writes it, and this is not that place.
    if (quoted.route.crossesBorder) {
      declareFor({
        crossings: quoted.route.crossings,
        items: input.items,
        declaredValue: input.subtotal,
        currency: quoted.price.currency,
        exporterId: vendor.vendorId,
        at: new Date().toISOString(),
        context: 'This shipment',
      });
    }

    if (caller.mode === 'test') {
      // A DRY RUN, and it says so. Everything above ran; nothing below does. No parcel, no billing, no
      // label a shop would accept, no notification to a buyer who did not order anything. What it cannot
      // give you is something to track — that is the one thing a sandbox is not able to fake honestly.
      //
      // A held quote is NOT spent here either, and that is the same rule rather than an exception to it:
      // spending a name is a commitment, and a dry run makes none. It also means a developer can rehearse
      // the same checkout as many times as it takes without minting a fresh quote between every attempt.
      return this.shipmentView(
        {
          shipmentId: `test_${quoted.to.pointId.slice(-6)}_${quoted.parcel.size}`,
          status: 'Created',
          paid: false,
          externalOrderId: input.externalOrderId,
        },
        quoted,
        'test',
        true,
      );
    }

    const { parcel, label, paid } = this.parcels.createInbound({
      vendorId: vendor.vendorId,
      externalOrderId: input.externalOrderId,
      originAgentDid: origin.did,
      destAgentDid: dest.did,
      buyerMobile: input.buyerMobile.trim(),
      size: quoted.parcel.size,
      dimensionsCm: input.dimensionsCm,
      weightKg: input.weightKg,
      contentPhotoRef: input.contentPhotoRef.trim(),
      items: input.items,
      subtotal: input.subtotal,
      shippingPolicy: vendor.shippingPolicy,
      routeMode: input.routeMode,
      // THE HELD PRICE, when there is one. This line is the promise: the parcel is billed at the figure
      // the buyer was shown, not at the one the world has moved to since.
      quote: held ? held.quote : this.routing.quoteShipment(origin.did, dest.did, quoted.parcel.size),
    });
    // Spent only now, because the shipment now exists. A mint that threw leaves the price held, so a
    // merchant can fix what was wrong and redeem the same promise rather than go back to the buyer with a
    // different number.
    if (held) this.quotes.markRedeemed(held.quoteId, parcel.parcelId);
    return this.shipmentView(
      {
        shipmentId: parcel.parcelId,
        did: parcel.did,
        trackingKey: parcel.trackingKey,
        externalOrderId: parcel.externalOrderId,
        status: parcel.status,
        paid,
        // A label is a claim on the network, so it issues only once the shipment is paid for.
        label: paid ? (label ?? undefined) : undefined,
        amount: parcel.shipmentCost,
      },
      quoted,
      'live',
      false,
    );
  }

  /**
   * A held price, read back as the answer it was — with one thing re-checked.
   *
   * WE HOLD THE PRICE, NOT THE WORLD. The figure survives the route getting dearer, which is the entire
   * promise. What it cannot survive is the route becoming impossible: a shop that has stopped taking
   * parcels is not somewhere a buyer can be sent, whatever they were charged, and minting into it would
   * turn a price promise into an undeliverable parcel. So the ends are re-checked and nothing else is.
   */
  private heldAsQuote(held: HeldQuote, caller: Caller): PublicQuote {
    for (const [pointId, side] of [[held.fromPointId, 'collect from'], [held.toPointId, 'send to']] as const) {
      const agent = this.agents.list().find((a) => a.did === pointId);
      if (!agent || agent.status !== 'ACTIVE') {
        throw new GlosError('NOT_FOUND', `The point this quote would ${side} is no longer taking parcels — ask for a new quote`, { quoteId: held.quoteId });
      }
    }
    const from = this.agents.get(held.fromPointId);
    const to = this.agents.get(held.toPointId);
    const plan = this.routing.planJourney({ originAgentDid: from.did, destAgentDid: to.did, weightKg: held.weightKg });
    // The ETA is recomputed and the PRICE is not, and that asymmetry is deliberate: an arrival time is a
    // prediction that should be as good as we can make it today, while a price is a promise made earlier.
    return this.viewOf(held.quote, plan, from, to, held.size as ParcelSize, held.weightKg, caller);
  }

  private shipmentView(
    made: { shipmentId: string; did?: string; trackingKey?: string; externalOrderId?: string; status: string; paid: boolean; label?: unknown; amount?: number },
    quoted: PublicQuote,
    mode: 'test' | 'live',
    simulated: boolean,
  ): MintedShipment {
    return {
      shipmentId: made.shipmentId,
      did: made.did,
      trackingKey: made.trackingKey,
      externalOrderId: made.externalOrderId,
      status: made.status,
      paid: made.paid,
      price: { currency: quoted.price.currency, amount: made.amount ?? quoted.price.amount },
      parcel: quoted.parcel,
      collect: quoted.to,
      eta: { readyAt: quoted.eta.readyAt },
      route: { crossesBorder: quoted.route.crossesBorder, crossings: quoted.route.crossings },
      ...(made.label ? { label: made.label } : {}),
      mode,
      simulated,
    };
  }

  /** The countries and areas a quote can name — what a picker is built from, without exposing the register. */
  areas(): Array<{ country: string; areas: string[] }> {
    const byCountry = new Map<string, Set<string>>();
    for (const a of this.agents.list()) {
      if (a.status !== 'ACTIVE') continue; // an area with no shop anyone can collect at is not an area we serve
      const country = this.agents.countryOf(a);
      const set = byCountry.get(country) ?? new Set<string>();
      set.add(a.zone);
      byCountry.set(country, set);
    }
    return [...byCountry.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([country, areas]) => ({ country, areas: [...areas].sort() }));
  }

  /**
   * Turn what the caller said into a real collection point.
   *
   * ACTIVE only, at both ends and for the same reason: a quote names somewhere a person will actually stand,
   * and offering a shop that has not finished signing up is offering an appointment nobody will keep.
   */
  private resolve(where: QuoteEndpoint, side: 'from' | 'to'): Agent {
    const label = side === 'from' ? 'collect from' : 'send to';
    if (where?.pointId) {
      const agent = this.agents.list().find((a) => a.did === where.pointId);
      if (!agent) throw new GlosError('NOT_FOUND', `No collection point ${where.pointId} — check the network directory`);
      if (agent.status !== 'ACTIVE') throw new GlosError('NOT_FOUND', `${agent.shopName} is not taking parcels yet`);
      return agent;
    }
    if (!where?.area?.trim()) {
      throw new GlosError('FIELD_REQUIRED', `Say where to ${label}: a collection point, or a country and an area`);
    }
    const country = requireCountryCode(where.country);
    const area = where.area.trim();
    const candidates = this.agents
      .list()
      .filter((a) => a.status === 'ACTIVE' && this.agents.countryOf(a) === country && a.zone.toLowerCase() === area.toLowerCase());
    if (!candidates.length) throw new GlosError('NOT_FOUND', `We have no collection point in ${area}, ${country} yet`);
    // The one with the most room, then by name so the same ask gives the same answer twice. Nothing is
    // reserved by choosing it — this is where they WOULD collect, not a slot held for them.
    const best = candidates
      .map((a) => ({ a, free: side === 'to' ? this.shelf.available(a.did) : 0 }))
      .sort((x, y) => y.free - x.free || x.a.shopName.localeCompare(y.a.shopName))[0];
    if (side === 'to' && best.free <= 0) throw new GlosError('NO_CAPACITY_AVAILABLE', `Every collection point in ${area} is full right now`);
    return best.a;
  }

  private point(a: Agent): QuotedPoint {
    return {
      pointId: a.did,
      name: a.shopName,
      area: a.zone,
      country: this.agents.countryOf(a),
      landmark: a.landmark,
      location: a.location,
      openState: a.openState,
    };
  }
}
