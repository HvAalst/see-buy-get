import { Injectable } from '@nestjs/common';
import { EntityService } from '../../foundation/entity/entity.service';
import { currencyForJurisdiction } from '../../foundation/money/currency';
import { AgentService } from './agent.service';
import { SIZE_LANE, SIZE_LIMITS } from './pudo.config';
import { PriceCardService } from './price-card.service';
import type { StoredPriceCard } from './price-card.types';
import { ZoneMapService } from './zone-map.service';

/** One card as a counter keeps it: everything a walk-up's price from this shop needs, worked out where it is wanted. */
export interface CounterCard {
  version: number;
  zoneMapVersion: number;
  /** In force from (ISO). */
  from: string;
  /** This shop's zone on the card's map. */
  origin: string;
  steps: number[];
  table: Record<string, number[]>;
  perExtraKg: Record<string, number>;
  weight: { divisorShop: number; stepKg: number; maxKg: number; volumeFromKg: number };
  surcharges: { oversize: number; oversizeCm: number; fragile: number };
  minimum: number;
  cashStep: number;
  /** The band from this shop's zone to each zone of the map. */
  bands: Record<string, string>;
  /** Each zone's end charge: [per parcel, per kg]. */
  ends: Record<string, [number, number]>;
  /** The zone each shop of the country stands in on this card's map. */
  zoneOf: Record<string, string>;
}

/**
 * WHAT A COUNTER NEEDS TO PRICE A WALK-UP WITH NO SIGNAL (2026-11-08 — zone pricing, step 3b, D7). The cards it prices
 * from (in force now, and those coming into force, each from its date), every shop's own fee, our fee and the tax by
 * size class, and the size limits that pick the class. The phone keeps the last one it was given and works out the same
 * price the server would; a take-in it keeps is priced again by the server at the card in force when it was made.
 */
export interface CounterPriceRow {
  shop: string;
  country: string;
  currency: string;
  /** When it was made (ISO): the phone says how old the prices it uses are. */
  at: string;
  /** Size classes in order: the first a parcel fits names its lane; one that fits none takes the last. */
  sizes: Array<{ maxCm: [number, number, number]; maxKg: number; lane: string }>;
  /** Our fee (a fraction) and the tax (a fraction) on each lane. */
  lanes: Record<string, { feePct: number; taxPct: number }>;
  /** Each shop's own fee, in the country's money, to the cent. */
  fees: Record<string, number>;
  /** Empty where no card prices from this shop: nothing in force or coming, or its pin in no zone. */
  cards: CounterCard[];
}

@Injectable()
export class CounterPriceService {
  /** A card's bands and end charges from one zone do not change: worked out once per card and zone. */
  private readonly fixed = new Map<string, Pick<CounterCard, 'bands' | 'ends'>>();

  constructor(
    private readonly cards: PriceCardService,
    private readonly zones: ZoneMapService,
    private readonly agents: AgentService,
    private readonly entities: EntityService,
  ) {}

  rowFor(agentDid: string, now: number = Date.now()): CounterPriceRow {
    const shop = this.agents.get(agentDid);
    const country = this.agents.countryOf(shop);
    let sellerId: string | undefined;
    try {
      sellerId = this.agents.entityIdOf(shop);
    } catch {
      sellerId = undefined; // a country where no company of ours stands: nothing of ours is priced at this counter
    }
    const seller = sellerId ? this.entities.find(sellerId) : undefined;
    const currency = seller ? (seller.currency ?? currencyForJurisdiction(seller.jurisdiction)) : '';
    const lanes: CounterPriceRow['lanes'] = {};
    if (sellerId) {
      for (const lane of new Set(Object.values(SIZE_LANE))) {
        lanes[lane] = { feePct: this.entities.ratesFor(sellerId, lane).totalPct, taxPct: this.entities.taxFor(sellerId, lane).ratePct };
      }
    }
    // The shops the take-in picker offers (GET network/points), in this country.
    const peers = this.agents.list().filter((a) => !this.agents.isResting(a.did) && !this.agents.notOpenYet(a) && this.agents.countryOf(a) === country);
    const fees: Record<string, number> = {};
    for (const a of peers) fees[a.did] = Math.round(a.pricePerParcel * 100) / 100;
    fees[shop.did] = Math.round(shop.pricePerParcel * 100) / 100;
    const found = sellerId && seller?.jurisdiction === country ? this.cards.cardsFrom(country, now) : undefined;
    const cards = (found?.cards ?? [])
      .filter((c) => c.currency === currency)
      .map((c) => this.cardFor(found!.entityId, c, shop.location, [shop, ...peers]))
      .filter((c): c is CounterCard => c != null);
    return {
      shop: shop.did,
      country,
      currency,
      at: new Date(now).toISOString(),
      sizes: SIZE_LIMITS.map((l) => ({ maxCm: [...l.maxCm] as [number, number, number], maxKg: l.maxKg, lane: SIZE_LANE[l.size] })),
      lanes,
      fees,
      cards,
    };
  }

  private cardFor(entityId: string, card: StoredPriceCard, at: { lat: number; lng: number }, shops: Array<{ did: string; location: { lat: number; lng: number } }>): CounterCard | undefined {
    // 2026-11-12 — A FIXED CARD (the owner's D3): every shop in one place, '*', priced on its one band — the phone's sums
    // need nothing new: one zone, one band, no ends.
    const anywhere = card.kind === 'fixed';
    const origin = anywhere ? '*' : this.zones.zoneCodeIn(entityId, card.zoneMapVersion, at);
    if (!origin) return undefined;
    if (anywhere) {
      return {
        version: card.version,
        zoneMapVersion: 0,
        from: card.effectiveFrom!,
        origin,
        steps: [...card.steps],
        table: Object.fromEntries(Object.entries(card.table).map(([k, v]) => [k, [...v]])),
        perExtraKg: { ...card.perExtraKg },
        weight: { divisorShop: card.weight.divisorShop, stepKg: card.weight.stepKg, maxKg: card.weight.maxKg, volumeFromKg: card.weight.volumeFromKg },
        surcharges: { oversize: card.surcharges.oversize, oversizeCm: card.surcharges.oversizeCm, fragile: card.surcharges.fragile },
        minimum: card.minimum,
        cashStep: card.cashStep,
        bands: { '*': card.bands[0].key },
        ends: {},
        zoneOf: Object.fromEntries(shops.map((s) => [s.did, '*'])),
      };
    }
    const key = `${entityId}#${card.version}#${origin}`;
    let fixed = this.fixed.get(key);
    if (!fixed) {
      const { zones } = this.zones.publishedZones(entityId, card.zoneMapVersion);
      const from = zones.find((z) => z.code === origin)!;
      const bands: Record<string, string> = {};
      const ends: Record<string, [number, number]> = {};
      for (const z of zones) {
        bands[z.code] = this.cards.bandFor(entityId, card, from, z).band.key;
        const c = card.zoneCharges[z.code] ?? card.groupCharges[z.group] ?? { perParcel: 0, perKg: 0 };
        ends[z.code] = [c.perParcel, c.perKg];
      }
      fixed = { bands, ends };
      this.fixed.set(key, fixed);
    }
    const zoneOf: Record<string, string> = {};
    for (const s of shops) {
      const z = this.zones.zoneCodeIn(entityId, card.zoneMapVersion, s.location);
      if (z) zoneOf[s.did] = z;
    }
    return {
      version: card.version,
      zoneMapVersion: card.zoneMapVersion,
      from: card.effectiveFrom!,
      origin,
      steps: [...card.steps],
      table: Object.fromEntries(Object.entries(card.table).map(([k, v]) => [k, [...v]])),
      perExtraKg: { ...card.perExtraKg },
      weight: { divisorShop: card.weight.divisorShop, stepKg: card.weight.stepKg, maxKg: card.weight.maxKg, volumeFromKg: card.weight.volumeFromKg },
      surcharges: { oversize: card.surcharges.oversize, oversizeCm: card.surcharges.oversizeCm, fragile: card.surcharges.fragile },
      minimum: card.minimum,
      cashStep: card.cashStep,
      bands: fixed.bands,
      ends: fixed.ends,
      zoneOf,
    };
  }
}
