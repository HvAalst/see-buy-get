import { Inject, Injectable, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { ParcelInvoiceService, type ParcelInvoiceContext } from './parcel-invoice.service';
import type { ParcelInvoice, ParcelInvoiceDto, ParcelInvoiceLine, ParcelInvoiceView } from './parcel-invoice.types';
import { AgentService } from './agent.service';
import { ShelfService } from './shelf.service';
import { RoutingService, type ShipmentQuote } from './routing.service';
import { QuoteBookService, type HeldQuote } from './quote-book.service';
import { CallOffService } from './call-off.service';
import type { CallOffView } from './call-off.types';
import { ParcelService } from './parcel.service';
import { VendorService } from './vendor.service';
import { MediaService } from './media.service';
import { requireCountryCode } from './country';
import { declareFor } from './customs';
import { BorderCrossing } from './country';
import { ANONYMOUS, ApiKeyService, type Caller } from './api-key.service';
import { classifySize, measuredFactor, SIZE_WEIGHT_KG } from './pudo.config';
import { parcelCurrency } from './parcel.service';
import { Agent, ParcelSize } from './pudo.types';
import { Geocoder, GEOCODER } from './geocoder';
import { Router, ROUTER } from './router';

/** A resolved end of a journey: the point, and — when an address was typed — how it was found. */
interface Resolved {
  agent: Agent;
  distanceKm?: number;
  matchedPlace?: string;
}

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
  /**
   * …or where the person actually IS, in their own words: "Bole, Addis Ababa", "12 Biashara St, Kisumu",
   * or just an area name. We place it and find the nearest collection point.
   */
  address?: string;
  /** …or an area we already serve, named exactly. `country` narrows either of the two above. */
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
  /** How far this point is from the address that was typed. Absent when no address was given. */
  distanceKm?: number;
  /** What we understood the typed address to mean — shown back so a buyer can see we read them right. */
  matchedPlace?: string;
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
  /** `chargedBy`, when measured: whether its size or its weight set the price, and what it counts as in kg (2026-10-27). */
  parcel: { size: ParcelSize; weightKg: number; chargedBy?: ShipmentQuote['chargedBy'] };
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
  /** Round 13 — the commercial invoice, for a shipment that crosses a border. */
  invoice?: ParcelInvoiceDto;
}

/**
 * A shipment, as the merchant who paid for it sees it.
 *
 * Deliberately WITHOUT the collection code. That is the handover secret — the only thing standing between
 * a stranger and the parcel — and it belongs to the person collecting, in their own app. A merchant does
 * not need it, and putting it on an API response would widen its exposure for nobody's benefit.
 */
/**
 * A shipment read back by the store that created it.
 *
 * Smaller than `MintedShipment` on purpose. That one answers "what did I just buy", so it carries the
 * quote it was bought against; this one answers "where is it now", and re-quoting to fill in a route would
 * put TODAY's price on a shipment sold last week. Every figure here is read off the parcel.
 */
export interface PublicShipment {
  shipmentId: string;
  did?: string;
  trackingKey?: string;
  externalOrderId?: string;
  status: string;
  paid: boolean;
  /** The price it was SOLD at, stamped at mint — never a fresh quote. */
  price: { currency: string; amount: number };
  /** Whether it can still be called off. Reported rather than left to be discovered by a failed attempt. */
  cancellable: boolean;
  createdAt: string;
  /** Round 29 — its SSCC, where the store holds a GS1 company prefix: given once it is paid, printed on its label. */
  sscc?: string;
  /** Called off at a hub (2026-10-27): the shipment bringing it back to the shop it was handed in at. */
  returnShipmentId?: string;
  /** The shipment this one brings back — called off at a hub, the store collects it again at the shop it handed it in at. */
  returnOf?: string;
  /** Called off at a hub and going to the store's own door as a load: that load's code. */
  returnLoad?: string;
}

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
  /** Round 13 — its commercial invoice, for a shipment that crosses a border: print the copies with the label. */
  papers?: { number: string; copies: number; currency: string; totalValue: number };
  /** The printable label, once the shipment is paid for. Absent while it is not. */
  label?: unknown;
  /** Round 29 — its SSCC, where the store holds a GS1 company prefix and the shipment is paid for. */
  sscc?: string;
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
    // Round 30 — the photo of the contents a shipment names: uploaded by the store's own system, checked before minting.
    private readonly media: MediaService,
    @Inject(GEOCODER) private readonly geocoder: Geocoder,
    @Inject(ROUTER) private readonly router: Router,
    // A store parcel's papers abroad (round 13): its commercial invoice, checked with the declaration and kept with the parcel.
    @Optional() private readonly invoices?: ParcelInvoiceService,
    // Called off at a hub, brought back at the store's cost (2026-10-27). Optional for the specs that build this by hand.
    @Optional() private readonly callOffs?: CallOffService,
  ) {}

  /**
   * Round 30 — A PHOTO OF WHAT IS IN THE BOX, from a store's own system (the user: "It sends the photo too"). Kept as
   * the store's own; the shipment that names it as contentPhotoRef makes it that shipment's evidence, kept with it.
   * A secret key, as making a shipment needs — a test one too, so an integration is tried end to end; a photo no
   * shipment names is removed when it is two days old, the way an abandoned capture in the app is.
   */
  uploadPhoto(input: { dataUrl: string; thumbDataUrl?: string }, caller: Caller): { photoId: string; keptUnusedUntil: string } {
    if (!ApiKeyService.canMint(caller) || !caller.vendorId) {
      throw new GlosError('FORBIDDEN', 'A photo for a shipment needs a secret key (sk_…), as making the shipment does');
    }
    const vendor = this.vendors.get(caller.vendorId);
    const { mediaId } = this.media.upload({ ownerDid: vendor.did, kind: 'content', dataUrl: input.dataUrl, thumbDataUrl: input.thumbDataUrl });
    return { photoId: mediaId, keptUnusedUntil: this.media.unusedUntil(mediaId)! };
  }

  quote(input: { from: QuoteEndpoint; to: QuoteEndpoint; dimensionsCm?: { l: number; w: number; h: number }; weightKg?: number; size?: ParcelSize }, caller: Caller = ANONYMOUS): PublicQuote {
    const from = this.resolve(input.from, 'from');
    const to = this.resolve(input.to, 'to');
    if (from.agent.did === to.agent.did) throw new GlosError('INVALID_INPUT', 'Collect from and send to are the same point — a shipment needs two ends');

    // Derived from the measurements when they are given, exactly as every mint in the system does it, so a
    // quote and the shipment it becomes cannot disagree about what size the parcel was.
    const size: ParcelSize = input.dimensionsCm
      ? classifySize({ ...input.dimensionsCm, kg: input.weightKg ?? SIZE_WEIGHT_KG[input.size ?? 'M'] })
      : input.size ?? 'M';
    if (size === 'HEAVY') {
      throw new GlosError('CARGO_REQUIRES_DEDICATED', 'This is too big for the pick-up network — it needs dedicated freight, which is quoted separately');
    }
    const weightKg = input.weightKg ?? SIZE_WEIGHT_KG[size];

    // ITEM 9 — measured where measured. The same dims that derived the size price the transport, so the
    // public quote a buyer is shown is the one the mint will reproduce.
    const { plan, quote } = this.routing.quoteWithPlan(from.agent.did, to.agent.did, size, input.dimensionsCm ? measuredFactor({ ...input.dimensionsCm, kg: weightKg }) : undefined, { kg: weightKg });
    // A price is only worth holding for somebody we can recognise when they come back to claim it. An
    // anonymous quote is a calculation; a keyed one is a promise, and that difference is the honest reason
    // a key is worth having.
    const held = caller.vendorId
      ? this.quotes.hold({ vendorId: caller.vendorId, mode: caller.mode, quote, fromPointId: from.agent.did, toPointId: to.agent.did, size, weightKg, dimensionsCm: input.dimensionsCm })
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
    from: Resolved,
    to: Resolved,
    size: ParcelSize,
    weightKg: number,
    caller: Caller,
    held?: HeldQuote,
  ): PublicQuote {
    return {
      from: this.point(from),
      to: this.point(to),
      // Size or weight, whichever is more: which one set this price, said so a store can tell its buyer why (2026-10-27).
      parcel: { size, weightKg, ...(quote.chargedBy ? { chargedBy: quote.chargedBy } : {}) },
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
    // Round 30 — one this store sent us and has used for no other shipment. Checked in BOTH modes, before the test
    // branch: a name or an id we do not hold would mint in test and be refused live, which is what a sandbox must never do.
    if (!this.media.mayAdopt(input.contentPhotoRef.trim(), vendor.did)) {
      throw new GlosError('PHOTO_REQUIRED', 'We do not hold that photo of the contents. Send it with POST /v1/sbg/shipping/photos and name the photoId it gives as contentPhotoRef: a photo of this shipment, used for no other.', { field: 'contentPhotoRef' });
    }

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
    // A STORE PARCEL'S PAPERS ABROAD (round 13): crossing a border, it carries its commercial invoice — item by item, its
    // value, weight and origin, and the buyer it goes to — checked here, in both modes, before anything exists.
    if (input.invoice && !quoted.route.crossesBorder) throw new GlosError('INVALID_INPUT', 'This shipment does not cross a border, so it needs no commercial invoice', { field: 'invoice' });
    if (quoted.route.crossesBorder && !input.invoice) {
      throw new GlosError('CUSTOMS_INCOMPLETE', 'This shipment crosses a border, so it needs its commercial invoice: each item with its value, weight and country of origin, and the buyer it goes to', { missing: ['invoice'], crossings: quoted.route.crossings.map((c) => `${c.fromCountry}→${c.toCountry}`) });
    }
    const papers = input.invoice ? this.papersChecked(input.invoice, vendor, quoted, dest, input.weightKg) : undefined;
    if (quoted.route.crossesBorder) {
      declareFor({
        crossings: quoted.route.crossings,
        items: papers ? itemsOf(papers.lines) : input.items,
        declaredValue: papers ? papers.totalValue : input.subtotal,
        currency: papers ? papers.currency : quoted.price.currency,
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
          // Its papers as they would be: every check made, nothing kept.
          ...(papers ? { papers: papersSummary(papers) } : {}),
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
      items: papers ? itemsOf(papers.lines) : input.items,
      subtotal: input.subtotal,
      ...(papers ? { declaredValue: papers.totalValue, customsCurrency: papers.currency } : {}),
      shippingPolicy: vendor.shippingPolicy,
      routeMode: input.routeMode,
      // THE HELD PRICE, when there is one. This line is the promise: the parcel is billed at the figure
      // the buyer was shown, not at the one the world has moved to since.
      quote: held ? held.quote : this.routing.quoteShipment(origin.did, dest.did, quoted.parcel.size, input.dimensionsCm ? measuredFactor({ ...input.dimensionsCm, kg: input.weightKg ?? SIZE_WEIGHT_KG[quoted.parcel.size] }) : undefined, { kg: input.weightKg ?? SIZE_WEIGHT_KG[quoted.parcel.size] }),
    });
    // Spent only now, because the shipment now exists. A mint that threw leaves the price held, so a
    // merchant can fix what was wrong and redeem the same promise rather than go back to the buyer with a
    // different number.
    if (held) this.quotes.markRedeemed(held.quoteId, parcel.parcelId);
    // Its papers, signed and kept with it: what the store prints with the label.
    if (input.invoice && this.invoices) this.invoices.issue(input.invoice, { ...this.papersContext(vendor, quoted, dest, input.weightKg), parcelId: parcel.parcelId });
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
        ...(parcel.sscc ? { sscc: parcel.sscc } : {}),
        amount: parcel.shipmentCost,
        ...(papers ? { papers: papersSummary(papers) } : {}),
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
      if (!agent || !this.agents.takesNew(agent)) {
        throw new GlosError('NOT_FOUND', `The point this quote would ${side} is no longer taking parcels — ask for a new quote`, { quoteId: held.quoteId });
      }
    }
    const from = { agent: this.agents.get(held.fromPointId) };
    const to = { agent: this.agents.get(held.toPointId) };
    const plan = this.routing.planJourney({ originAgentDid: from.agent.did, destAgentDid: to.agent.did, weightKg: held.weightKg });
    // The ETA is recomputed and the PRICE is not, and that asymmetry is deliberate: an arrival time is a
    // prediction that should be as good as we can make it today, while a price is a promise made earlier.
    return this.viewOf(held.quote, plan, from, to, held.size as ParcelSize, held.weightKg, caller);
  }

  /**
   * A shipment the caller already created — its state now, not a fresh quote.
   *
   * THE PRICE COMES OFF THE PARCEL, never off `quote`. Re-quoting a sold shipment would answer with
   * today's number for something bought yesterday, and a merchant reconciling an invoice would find the
   * API disagreeing with their own books. Everything stamped at mint is stamped precisely so this can be
   * read back years later.
   *
   * A shipment belonging to somebody else answers NOT FOUND, not FORBIDDEN. "You may not see this" tells a
   * stranger the id is real, which is a probe worth nothing to the owner and something to everyone else.
   */
  shipment(shipmentId: string, caller: Caller): PublicShipment {
    if (!caller.vendorId) throw new GlosError('FORBIDDEN', 'Reading a shipment needs your key — a shipment belongs to the store that created it');
    if (shipmentId.startsWith('test_')) {
      // A test mint creates nothing on purpose, so there is nothing here to read. Said plainly: the
      // alternative is a 404 that reads like a bug in the merchant's own integration.
      throw new GlosError('NOT_FOUND', 'That is a simulated shipment from a test key — nothing was created, so there is nothing to look up');
    }
    const parcel = this.ownedParcel(shipmentId, caller.vendorId);
    return this.publicShipmentOf(parcel);
  }

  /**
   * Call it off, while it can still be called off.
   *
   * Needs a SECRET key for the same reason minting does: a credential that can undo a shipment must never
   * sit in a page. The rules are the network's own, not a second set invented for the API — a parcel can be
   * cancelled while it is Created, At_PUDO or At_MDP, and the money moves by the same path an operator's
   * cancellation uses: called off before it has left the shop it was handed in at, the store's money comes back in
   * full and the shop's take-in pay goes back; at a hub, what was carried is not given back. Refusing later is not a limitation to apologise for: once somebody is
   * carrying it, calling it off is a conversation and not an API call.
   *
   * THERE IS NO AMEND, deliberately. Changing where a parcel goes, or how big it is, changes what it costs
   * — an "edit" that quietly re-prices a shipment a buyer already paid for is the worst version of this
   * feature. Cancel it and create the new one, so the re-price is visible and consented to.
   */
  cancelShipment(shipmentId: string, caller: Caller, reason?: string, choice: { backTo?: string; maxSpend?: number } = {}): PublicShipment {
    if (!ApiKeyService.canMint(caller) || !caller.vendorId) {
      throw new GlosError('FORBIDDEN', 'Cancelling needs a secret key (sk_…) — a publishable key can only ask for prices');
    }
    if (shipmentId.startsWith('test_')) {
      throw new GlosError('NOT_FOUND', 'That is a simulated shipment from a test key — nothing was created, so there is nothing to cancel');
    }
    const parcel = this.ownedParcel(shipmentId, caller.vendorId);
    // `by` names the store, not a person: the network's audit trail records WHO asked, and through this
    // door the answer is a merchant's own system rather than anybody at a counter.
    // At a hub it is not withdrawn but brought back, at the store's cost (2026-10-27): the same door as the store's app.
    if (this.callOffs) this.callOffs.callOff(caller.vendorId, parcel.parcelId, `vendor:${caller.vendorId}`, reason?.trim() || 'cancelled by the store', Date.now(), choice);
    else this.parcels.cancel(parcel.parcelId, `vendor:${caller.vendorId}`, reason?.trim() || 'cancelled by the store');
    return this.publicShipmentOf(this.parcels.get(parcel.parcelId));
  }

  /**
   * What calling it off would do now, asked before calling it off (2026-10-27): withdrawn with its price given back, before it
   * left the shop it was handed in at; at a hub, brought back to that shop as a new shipment, at what cost; or why it cannot be.
   */
  callOffPreview(shipmentId: string, caller: Caller, backTo?: string): CallOffView {
    if (!caller.vendorId) throw new GlosError('FORBIDDEN', 'Reading a shipment needs your key — a shipment belongs to the store that created it');
    if (shipmentId.startsWith('test_')) throw new GlosError('NOT_FOUND', 'That is a simulated shipment from a test key — nothing was created, so there is nothing to call off');
    const parcel = this.ownedParcel(shipmentId, caller.vendorId);
    if (!this.callOffs) throw new GlosError('INVALID_STATE', 'Calling off is not open here');
    return this.callOffs.preview(caller.vendorId, parcel.parcelId, backTo?.trim() || undefined);
  }

  /** The caller's own shipment, or nothing they can distinguish from one that never existed. */
  /* ---------------------------------------------- a store parcel's papers abroad (round 13) -- */

  /** Its commercial invoice, read back by the store that created the shipment: the current one, and any it replaced. */
  papers(shipmentId: string, caller: Caller): ParcelInvoiceView {
    const parcel = this.papersParcel(shipmentId, caller);
    return this.invoices!.view(parcel.parcelId, parcel.status === 'Created');
  }

  /** The three copies, one a page, for the store to print with the label and put in the pouch. */
  papersPage(shipmentId: string, caller: Caller): string {
    const parcel = this.papersParcel(shipmentId, caller);
    const current = this.invoices!.current(parcel.parcelId);
    if (!current) throw new GlosError('NOT_FOUND', 'This shipment has no commercial invoice yet');
    return this.invoices!.htmlFor(current);
  }

  /**
   * Correct the invoice, until the parcel is handed in: a new one, signed, that replaces it — the one replaced stays on
   * the record. Once the parcel is in a shop's hands its papers travel as they are.
   */
  correctPapers(shipmentId: string, input: ParcelInvoiceDto, caller: Caller): ParcelInvoice {
    const parcel = this.papersParcel(shipmentId, caller);
    if (parcel.status !== 'Created') throw new GlosError('INVALID_STATE', `This parcel is ${parcel.status}: once it is handed in, its papers travel as they are`);
    const crossings = parcel.customs!.crossings;
    const dest = this.agents.get(parcel.destAgentDid!);
    const before = this.invoices!.current(parcel.parcelId);
    return this.invoices!.issue(input, {
      store: storeOf(this.vendors.get(caller.vendorId!)),
      fromCountry: crossings[0].fromCountry,
      toCountry: crossings[crossings.length - 1].toCountry,
      shop: shopOf(dest),
      ...(before?.statedGrossKg != null ? { grossKg: before.statedGrossKg } : {}),
      signer: SYSTEM_SIGNER,
      parcelId: parcel.parcelId,
    });
  }

  /** A shipment of this store's that crosses a border, read with a secret key: its papers name the buyer. */
  private papersParcel(shipmentId: string, caller: Caller) {
    if (!ApiKeyService.canMint(caller) || !caller.vendorId) throw new GlosError('FORBIDDEN', 'A shipment’s papers name its buyer: they are read with a secret key (sk_…)');
    if (!this.invoices) throw new GlosError('INVALID_STATE', 'Commercial invoices are not running in this deployment');
    if (shipmentId.startsWith('test_')) throw new GlosError('NOT_FOUND', 'That is a simulated shipment from a test key — nothing was created, so it has no papers');
    const parcel = this.ownedParcel(shipmentId, caller.vendorId);
    if (!parcel.customs) throw new GlosError('NOT_FOUND', 'This shipment does not cross a border: it has no commercial invoice');
    return parcel;
  }

  /** What the invoice knows that the store does not send: the store, the border, the shop, the weight it stated. */
  private papersContext(vendor: { vendorId: string; name: string; address?: string }, quoted: PublicQuote, dest: Agent, weightKg?: number): ParcelInvoiceContext {
    const crossings = quoted.route.crossings;
    return {
      store: storeOf(vendor),
      fromCountry: crossings[0]?.fromCountry ?? '',
      toCountry: crossings[crossings.length - 1]?.toCountry ?? '',
      shop: shopOf(dest),
      ...(weightKg != null ? { grossKg: weightKg } : {}),
      signer: SYSTEM_SIGNER,
    };
  }

  private papersChecked(input: ParcelInvoiceDto, vendor: { vendorId: string; name: string; address?: string }, quoted: PublicQuote, dest: Agent, weightKg?: number) {
    if (!this.invoices) throw new GlosError('INVALID_STATE', 'Commercial invoices are not running in this deployment');
    return this.invoices.check(input, this.papersContext(vendor, quoted, dest, weightKg));
  }

  /**
   * ROUND 28 — A SHIPMENT'S LABEL, ASKED FOR AGAIN (the user: "ZPL through the shipping API"; "On each request"). The label
   * the shipment issued once it was paid — as it came when it was made, or (`format=zpl`) in the language the store's
   * warehouse label printers read, so they print with no app in between. A secret key, as creating it: a label is a claim
   * on the network. Another store's shipment answers NOT FOUND, as every read here does.
   */
  label(shipmentId: string, caller: Caller): { parcelId: string; qrPayload: string; svg: string } {
    if (!ApiKeyService.canMint(caller) || !caller.vendorId) throw new GlosError('FORBIDDEN', 'A label is a claim on the network: it is printed with a secret key (sk_…), as the shipment was made with one');
    if (shipmentId.startsWith('test_')) throw new GlosError('NOT_FOUND', 'That is a simulated shipment from a test key — nothing was created, so it has no label');
    const parcel = this.ownedParcel(shipmentId, caller.vendorId);
    return this.parcels.orderLabel(caller.vendorId, parcel.parcelId);
  }

  /** The same label for a thermal label printer (ZPL, 203 dpi, 100 × 150 mm). */
  labelZpl(shipmentId: string, caller: Caller): string {
    return this.parcels.labelZplFor(this.label(shipmentId, caller).parcelId);
  }

  private ownedParcel(shipmentId: string, vendorId: string) {
    let parcel;
    try {
      parcel = this.parcels.get(shipmentId);
    } catch {
      throw new GlosError('NOT_FOUND', `No shipment ${shipmentId}`);
    }
    if (parcel.vendorId !== vendorId) throw new GlosError('NOT_FOUND', `No shipment ${shipmentId}`);
    return parcel;
  }

  /**
   * What a merchant may read back about their own shipment.
   *
   * Deliberately NOT the collection code. The store is told that on the `ready_for_pickup` callback, at
   * the moment it is useful and to an endpoint they registered; putting it on a pollable read means every
   * integration that logs a response body has it in a log file forever.
   */
  private publicShipmentOf(parcel: ReturnType<ParcelService['get']>): PublicShipment {
    return {
      shipmentId: parcel.parcelId,
      did: parcel.did,
      trackingKey: parcel.trackingKey,
      externalOrderId: parcel.externalOrderId,
      status: parcel.status,
      paid: parcel.paidStatus === 'ParcelPaid',
      // The figure it was SOLD at, read off the parcel. See the note on `shipment`.
      price: { currency: parcelCurrency(parcel), amount: parcel.shipmentCost ?? 0 },
      cancellable: ['Created', 'At_PUDO', 'At_MDP'].includes(parcel.status),
      createdAt: parcel.acceptedAt,
      ...(parcel.sscc ? { sscc: parcel.sscc } : {}),
      ...(parcel.returnParcelId ? { returnShipmentId: parcel.returnParcelId } : {}),
      ...(parcel.returnOf ? { returnOf: parcel.returnOf.parcelId } : {}),
      ...(parcel.returnLoad ? { returnLoad: parcel.returnLoad.code } : {}),
    };
  }

  private shipmentView(
    made: { shipmentId: string; did?: string; trackingKey?: string; externalOrderId?: string; status: string; paid: boolean; label?: unknown; sscc?: string; amount?: number; papers?: MintedShipment['papers'] },
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
      ...(made.sscc ? { sscc: made.sscc } : {}),
      ...(made.papers ? { papers: made.papers } : {}),
      mode,
      simulated,
    };
  }

  /** The countries and areas a quote can name — what a picker is built from, without exposing the register. */
  areas(): Array<{ country: string; areas: string[] }> {
    const byCountry = new Map<string, Set<string>>();
    for (const a of this.agents.list()) {
      if (!this.agents.takesNew(a)) continue; // an area with no shop anyone can collect at is not an area we serve
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
  private resolve(where: QuoteEndpoint, side: 'from' | 'to'): Resolved {
    const label = side === 'from' ? 'collect from' : 'send to';
    if (where?.pointId) {
      const agent = this.agents.list().find((a) => a.did === where.pointId);
      if (!agent) throw new GlosError('NOT_FOUND', `No collection point ${where.pointId} — check the network directory`);
      if (agent.status !== 'ACTIVE') throw new GlosError('NOT_FOUND', `${agent.shopName} is not taking parcels yet`);
      if (!this.agents.takesNew(agent)) throw new GlosError('NOT_FOUND', `${agent.shopName} is not taking new parcels for now — choose another collection point`);
      return { agent };
    }
    // A typed address, which is what a person actually has. Tried BEFORE the area list, because somebody
    // who wrote "Bole, Addis Ababa" has told us more than an area name would, and falling through to the
    // list would throw that away.
    if (where?.address?.trim()) return this.nearestTo(where.address.trim(), where.country, side);
    if (!where?.area?.trim()) {
      throw new GlosError('FIELD_REQUIRED', `Say where to ${label}: a collection point, an address, or a country and an area`);
    }
    const country = requireCountryCode(where.country);
    const area = where.area.trim();
    const candidates = this.agents
      .list()
      .filter((a) => this.agents.takesNew(a) && this.agents.countryOf(a) === country && a.zone.toLowerCase() === area.toLowerCase());
    if (!candidates.length) throw new GlosError('NOT_FOUND', `We have no collection point in ${area}, ${country} yet`);
    // The one with the most room, then by name so the same ask gives the same answer twice. Nothing is
    // reserved by choosing it — this is where they WOULD collect, not a slot held for them.
    const best = candidates
      .map((a) => ({ a, free: side === 'to' ? this.shelf.available(a.did) : 0 }))
      .sort((x, y) => y.free - x.free || x.a.shopName.localeCompare(y.a.shopName))[0];
    if (side === 'to' && best.free <= 0) throw new GlosError('NO_CAPACITY_AVAILABLE', `Every collection point in ${area} is full right now`);
    return { agent: best.a };
  }

  /**
   * Place what somebody typed, then find the collection point nearest to it.
   *
   * A FALLBACK geocode is refused rather than used. The gazetteer answers an address it does not know
   * with a deterministic pseudo-point — stable and offline, which is right for putting a pin somewhere
   * provisional, and completely wrong for choosing where a stranger will walk to collect a parcel.
   * Sending somebody to a shop picked by a hash of their own typo is worse than telling them we did not
   * understand, so this says so and suggests what would work.
   *
   * If the text is not a place we can locate, it gets ONE more chance as the name of an area we serve,
   * because "Kisumu" is a reasonable thing to type and the two paths should not feel like different
   * products to whoever is filling in the box.
   */
  private nearestTo(address: string, country: string | undefined, side: 'from' | 'to'): Resolved {
    const placed = this.geocoder.geocode(address);
    if (placed.confidence === 'fallback') {
      if (this.areaExists(address, country)) return this.resolve({ country, area: address }, side);
      throw new GlosError('NOT_FOUND', `We could not place “${address}”. Try the town or area, or pick a collection point.`, { address });
    }
    const wanted = country ? requireCountryCode(country) : undefined;
    const candidates = this.agents
      .list()
      .filter((a) => this.agents.takesNew(a) && (!wanted || this.agents.countryOf(a) === wanted))
      .filter((a) => side !== 'to' || this.shelf.available(a.did) > 0)
      .map((a) => ({ a, km: this.router.roadKm(placed.location, a.location) }))
      .sort((x, y) => x.km - y.km || x.a.shopName.localeCompare(y.a.shopName));
    if (!candidates.length) {
      throw new GlosError('NO_CAPACITY_AVAILABLE', `We have no collection point with room near ${placed.matched ?? address} right now`, { address });
    }
    const best = candidates[0];
    // The distance and the place we matched both travel back: a buyer who typed their street should be
    // able to see that we read them correctly and how far they would actually be walking.
    return { agent: best.a, distanceKm: Math.round(best.km * 10) / 10, matchedPlace: placed.matched };
  }

  /** Is this the name of an area we serve? The second chance a typed town gets before we give up on it. */
  private areaExists(area: string, country?: string): boolean {
    const wanted = country ? requireCountryCode(country) : undefined;
    return this.agents
      .list()
      .some((a) => this.agents.takesNew(a) && a.zone.toLowerCase() === area.trim().toLowerCase() && (!wanted || this.agents.countryOf(a) === wanted));
  }

  private point(resolved: Resolved): QuotedPoint {
    const a = resolved.agent;
    return {
      pointId: a.did,
      name: a.shopName,
      area: a.zone,
      country: this.agents.countryOf(a),
      landmark: a.landmark,
      location: a.location,
      openState: a.openState,
      ...(resolved.distanceKm !== undefined ? { distanceKm: resolved.distanceKm } : {}),
      ...(resolved.matchedPlace ? { matchedPlace: resolved.matchedPlace } : {}),
    };
  }
}

/** Who signs a store parcel's papers sent with its key: its own system, for the store. */
const SYSTEM_SIGNER = 'The store’s shipping system';

/** The store as its papers name it. */
function storeOf(vendor: { vendorId: string; name: string; address?: string }): ParcelInvoiceContext['store'] {
  return { vendorId: vendor.vendorId, name: vendor.name, ...(vendor.address ? { address: vendor.address } : {}) };
}

/** The shop the parcel is collected from, as its papers name it when the buyer gave no address. */
function shopOf(dest: Agent): ParcelInvoiceContext['shop'] {
  return { name: dest.shopName, zone: dest.zone, ...(dest.landmark ? { landmark: dest.landmark } : {}), ...(dest.physicalAddress ? { address: dest.physicalAddress } : {}) };
}

/** The declaration's contents, from the invoice's lines: what a border officer reads first. */
function itemsOf(lines: ParcelInvoiceLine[]): Array<{ name: string; qty: number }> {
  return lines.map((l) => ({ name: l.description, qty: l.quantity }));
}

/** What the store is told of its papers when it creates the shipment. */
function papersSummary(p: { number: string; copies: number; currency: string; totalValue: number }): NonNullable<MintedShipment['papers']> {
  return { number: p.number, copies: p.copies, currency: p.currency, totalValue: p.totalValue };
}
