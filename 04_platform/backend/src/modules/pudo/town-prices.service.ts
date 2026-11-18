import { Injectable, Optional } from '@nestjs/common';
import { EntityService } from '../../foundation/entity/entity.service';
import { NetworkPulseService } from './network-pulse.service';
import { RoutingService } from './routing.service';

/** The sizes a town page prices: what most people send. Heavy goods are priced in the app, by their weight. */
export const TOWN_PRICE_SIZES = ['S', 'M', 'L'] as const;
export type TownPriceSize = (typeof TOWN_PRICE_SIZES)[number];

export interface TownPriceRow {
  slug: string;
  town: string;
  /** The lowest price found for each size, in the country's money, as a person pays it at the counter. */
  from: Partial<Record<TownPriceSize, number>>;
}

export interface TownPrices {
  slug: string;
  town: string;
  country: string;
  currency: string;
  /** This town first (to another shop in it), then the country's towns with the most shops. */
  to: TownPriceRow[];
}

/** How many shops in each town are priced from and to: the most open ones, as the town page lists them. */
export const SHOPS_PRICED = 2;
/** How many towns a town page prices to: itself, and the country's towns with the most shops. */
export const TOWNS_PRICED = 12;
const CACHE_MS = 60 * 60 * 1000;

/**
 * 2026-11-18 — WHAT IT COSTS FROM A TOWN, ON ITS PAGE (the owner, asked whether example prices may be published per country:
 * "yes"). "How much to send a parcel from Nairobi to Mombasa" is a question AI search is asked, and until now the answer
 * was only inside the app.
 *
 * Priced by the same engine and the same way as the Send app's own price — the cheapest leg, its gross, rounded as a
 * person pays it at the counter (`consumer`) — between the town's most open shops and each other town's. "From": the
 * lowest of those, since a shop's own fee may differ. Only within one country (a nation's prices stay national), only
 * where a SeeBuyGet company sells (anywhere else a quote is refused, as in the app), and never between a shop and itself.
 * A pair the engine refuses is left out. Read by the town pages' build, so kept for an hour.
 */
@Injectable()
export class TownPricesService {
  private cached?: { at: number; prices: TownPrices[] };

  constructor(
    private readonly pulse: NetworkPulseService,
    private readonly routing: RoutingService,
    @Optional() private readonly entities?: EntityService,
  ) {}

  prices(now: number = Date.now()): TownPrices[] {
    if (this.cached && now - this.cached.at < CACHE_MS) return this.cached.prices;
    const towns = this.pulse.townShopIds(now);
    const out: TownPrices[] = [];
    for (const origin of towns) {
      if (this.entities && !this.entities.forJurisdiction(origin.country)) continue;
      const peers = towns.filter((t) => t.country === origin.country && t.slug !== origin.slug);
      let currency = '';
      const to: TownPriceRow[] = [];
      for (const dest of [origin, ...peers].slice(0, TOWNS_PRICED)) {
        const from: Partial<Record<TownPriceSize, number>> = {};
        for (const size of TOWN_PRICE_SIZES) {
          let best: number | undefined;
          for (const o of origin.ids.slice(0, SHOPS_PRICED)) {
            for (const d of dest.ids.slice(0, SHOPS_PRICED)) {
              if (o === d) continue;
              try {
                const q = this.routing.quoteShipment(o, d, size, undefined, { consumer: true });
                const price = q.locked.gross;
                // One money per page: a price in another currency is never compared with these.
                if (!Number.isFinite(price) || price <= 0 || (currency && q.currency !== currency)) continue;
                currency ||= q.currency;
                if (best === undefined || price < best) best = price;
              } catch {
                // Refused by the engine (no route, no company there): not priced, as in the app.
              }
            }
          }
          if (best !== undefined) from[size] = best;
        }
        if (Object.keys(from).length) to.push({ slug: dest.slug, town: dest.town, from });
      }
      if (to.length && currency) out.push({ slug: origin.slug, town: origin.town, country: origin.country, currency, to });
    }
    this.cached = { at: now, prices: out };
    return out;
  }
}
