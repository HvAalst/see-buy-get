import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { ShelfService } from './shelf.service';
import { RoutingService } from './routing.service';
import { requireCountryCode } from './country';
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
  /** When this price stops being good, when it stands on an exchange rate. Absent when nothing was converted. */
  expiresAt?: string;
  /** Which world answered — `live` unless a test key asked. Always present, so a caller can never be in
   *  doubt about whether the thing they are looking at is real. */
  mode: 'test' | 'live';
  /** The costed route. Present only for a server-side key. */
  breakdown?: QuoteBreakdown;
}

@Injectable()
export class ShippingApiService {
  constructor(
    private readonly agents: AgentService,
    private readonly shelf: ShelfService,
    private readonly routing: RoutingService,
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
      expiresAt: quote.fx?.expiresAt,
      // Always said, never inferred. A caller must not have to work out from context whether the thing in
      // front of them is real — the answer says so.
      mode: caller.mode,
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
