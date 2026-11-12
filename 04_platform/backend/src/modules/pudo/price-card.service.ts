import { Injectable, Logger, Optional } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { EntityService } from '../../foundation/entity/entity.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { BAG_CAPACITY_UNITS, MEDIUM_KG, ROAD_CIRCUITY_FACTOR, SIZE_WEIGHT_KG } from './pudo.config';
import type { ParcelSize } from './pudo.types';
import { ZoneMapService } from './zone-map.service';
import { haversineKm } from './geo';
import { OsrmRoadMatrix } from './road-matrix';
import { CompanyReadinessService } from '../../foundation/entity/company-readiness.service';
import { FIXED_BAND, type PriceCardKind } from './price-card.types';
import type {
  EndCharge,
  PriceBand,
  PriceCardSettings,
  PriceCardTerms,
  PriceCardView,
  PriceCardsView,
  PriceCostCell,
  StoredCardRoads,
  StoredPriceCard,
  StoredPriceCards,
  ZonePrice,
  ZonePriceLine,
} from './price-card.types';

/** Who did it: the name for the record, and the account, which is what tells two people apart (never their names). */
export interface Doer {
  name: string;
  id: string;
}

/** What a price is asked for: between two zones of the card's own map, for a parcel of a weight, or a size, or both. */
export interface PriceAsk {
  from: string;
  to: string;
  kg?: number;
  dims?: { l: number; w: number; h: number };
  size?: ParcelSize;
  door?: boolean;
  fragile?: boolean;
}

/** Where every country starts: neutral words and no figures. Each country's company fills in its own, in its own money. */
export const DEFAULT_BANDS: PriceBand[] = [
  { key: 'local', name: 'Local', maxZones: 0, maxKm: 30 },
  { key: 'near', name: 'Near', maxZones: 2, maxKm: 100 },
  { key: 'regional', name: 'Regional', maxZones: 5, maxKm: 300 },
  { key: 'national', name: 'National', maxZones: null, maxKm: null },
];
export const DEFAULT_STEPS = [1, 2, 5, 10, 20, 30];
/** 2026-11-12 — a fixed card starts with one weight for each size: small, medium, large, and heavy up to the most (D3). */
export const FIXED_STEPS = [1, 5, 15, 30];
const kindOf = (c: { kind?: PriceCardKind }): PriceCardKind => c.kind ?? 'zones';
const DEFAULT_SETTINGS: PriceCardSettings = { filingRequired: false, noticeDays: 30 };
/** How far ahead a card may be approved: a year, so a mistyped decade is refused. */
const MAX_AHEAD_DAYS = 366;
const DAY = 24 * 3_600_000;
const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * EACH COUNTRY'S PRICE CARD (2026-11-08 — zone pricing, step 2). Its company drafts it on one published zone map, makes it
 * ready, files it with its regulator where its regulator requires that, and a second person approves it from a date at
 * least the country's notice days ahead. Nothing is charged from a card yet: step 3 switches a country's prices to it.
 */
@Injectable()
export class PriceCardService {
  private readonly store = new PersistentMap<string, StoredPriceCards>('pudo-price-cards');
  /** 2026-11-08 — each card's road km between its zones, keyed entityId#version: written once, when it is measured. */
  private readonly roadKm = new PersistentMap<string, StoredCardRoads>('pudo-price-card-roads');
  /** The same, read: a zone's place in the table, kept once a card is first priced. */
  private readonly roadIndex = new Map<string, Map<string, number>>();
  /** Cards being measured now. */
  private readonly measuring = new Map<string, Promise<void>>();
  private readonly logger = new Logger(PriceCardService.name);

  constructor(
    private readonly entities: EntityService,
    private readonly zones: ZoneMapService,
    // 2026-11-08 — the routing server, where one is set: a card made ready keeps the road km between its zones (step 4).
    @Optional() private readonly roads?: OsrmRoadMatrix,
    // 2026-11-12 — the owner's weakness 2: a country running with no card of the kind it prices by, said as a warning.
    @Optional() readiness?: CompanyReadinessService,
  ) {
    readiness?.alsoWarn((entity) => {
      if (entity.kind !== 'sister' || !entity.jurisdiction) return [];
      const fixed = this.kindFor(entity.entityId) === 'fixed';
      // In force, or approved to start on a date to come: either way staff have done it. The company's own cards, read by
      // its id: a company still in draft prepares its prices before the switch-on (the owner, 2026-11-12: "the zones card for
      // the earlier draft companies is not working"), and the country lookup finds no draft.
      const met = Boolean(this.cardsOfCompany(entity.entityId).length);
      return [
        {
          key: 'warn:price_card',
          met,
          label: `${fixed ? 'A fixed card' : 'A zones card'} approved on the Prices screen — the country prices by ${fixed ? 'a fixed card' : 'factors'}: until one is, its parcels are priced by distance on the direct route`,
        },
      ];
    });
  }

  /** Every card being measured, measured. */
  async settled(): Promise<void> {
    await Promise.all([...this.measuring.values()]);
  }

  /* --------------------------------------------------------------- reading -- */

  overview(entityId: string, now: number = Date.now()): PriceCardsView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const mode = this.entities.pricingModeFor(entityId);
    const inForce = this.inForceOf(s, now, this.kindFor(entityId));
    const other = this.inForceOf(s, now, this.kindFor(entityId) === 'fixed' ? 'zones' : 'fixed');
    const views = s.cards.map((c) => this.view(company, s, c, now));
    const pending = views.filter((v) => ['draft', 'ready', 'filed', 'cleared', 'scheduled'].includes(v.status));
    const working = s.cards.find((c) => ['draft', 'ready', 'filed', 'cleared'].includes(c.status));
    return {
      entityId,
      currency: company.currency ?? '',
      settings: { ...s.settings },
      zoneMaps: this.zones.setup(entityId, now).versions.map((v) => v.version),
      mode,
      ...(inForce ? { inForce: this.view(company, s, inForce, now) } : {}),
      ...(other ? { inForceOther: this.view(company, s, other, now) } : {}),
      pending,
      history: views.filter((v) => ['past', 'withdrawn'].includes(v.status)).sort((a, b) => b.version - a.version),
      costs: working ? this.costs(entityId, working) : [],
    };
  }

  /** The card in force in a country at a moment, with its company — what step 3 prices from. */
  inForceFor(country: string | undefined, at: number = Date.now()): { entityId: string; card: StoredPriceCard } | undefined {
    const company = this.entities.forJurisdiction(country);
    if (!company) return undefined;
    const s = this.store.get(company.entityId);
    // 2026-11-12 — the card of the kind the country prices by (the owner's D3); a card of the other kind prices nothing.
    const card = s ? this.inForceOf(s, at, this.kindFor(company.entityId)) : undefined;
    return card ? { entityId: company.entityId, card } : undefined;
  }

  /** 2026-11-12 — the weights a contract card is priced at: the country's fixed card in force, else its starting sizes. */
  fixedStepsFor(entityId: string, at: number = Date.now()): number[] {
    const s = this.store.get(entityId);
    const card = s ? this.inForceOf(s, at, 'fixed') : undefined;
    return [...(card?.steps ?? FIXED_STEPS)];
  }

  /**
   * 2026-11-12 — A SENDER'S CONTRACT CARD (the owner's D3), as a fixed card prices it: its own price for each weight, and the
   * country's fixed card in force for the rest — its size rules and surcharges; no minimum but its own prices.
   */
  contractCard(entityId: string, rate: { steps?: number[]; prices?: number[]; perExtraKg?: number }, currency: string, at: number = Date.now()): StoredPriceCard {
    const s = this.store.get(entityId);
    const base = (s ? this.inForceOf(s, at, 'fixed') : undefined) ?? { ...this.neutralFixed(), currency };
    const terms = this.termsOf(base);
    return {
      ...terms,
      kind: 'fixed',
      bands: [{ key: FIXED_BAND.key, name: 'Contract card', maxZones: null, maxKm: null }],
      steps: [...(rate.steps ?? [])],
      table: { [FIXED_BAND.key]: [...(rate.prices ?? [])] },
      perExtraKg: { [FIXED_BAND.key]: rate.perExtraKg ?? 0 },
      minimum: 0,
      version: 0,
      status: 'approved',
      zoneMapVersion: 0,
      currency,
      createdAt: new Date(at).toISOString(),
      createdBy: 'contract',
    };
  }

  /** The kind of card a company's country prices by: its mode — a fixed card, or by factors (the zones card). */
  kindFor(entityId: string): PriceCardKind {
    return this.entities.pricingModeFor(entityId) === 'factors' ? 'zones' : 'fixed';
  }

  /** A price from one of the company's cards (its version, else the one in force, else the newest being worked on). */
  price(entityId: string, ask: PriceAsk, version?: number, now: number = Date.now()): ZonePrice {
    const company = this.company(entityId);
    const s = this.stored(company);
    const card = version != null ? s.cards.find((c) => c.version === version) : (this.inForceOf(s, now, this.kindFor(entityId)) ?? this.working(s));
    if (!card) throw new GlosError('NOT_FOUND', `${company.name} has no price card${version != null ? ` ${version}` : ''}`);
    return this.priceOn(entityId, card, ask);
  }

  /**
   * THE PRICE OF ONE JOURNEY ON ONE CARD, line by line. The billable weight (what it weighs, or its size by the service's
   * divisor, rounded up to the card's step); the band of the two zones (a pair named on the card, else the zones between
   * them and the km, the higher of the two); the table; each end's charge (once, for a parcel that stays in its zone);
   * the surcharges; at least the minimum. Before the shops' own fees, our fee and the tax.
   */
  priceOn(entityId: string, card: StoredPriceCard, ask: PriceAsk): ZonePrice {
    // 2026-11-12 — A FIXED CARD (the owner's D3): one price per size, near or far — no zones, no band to find, no ends.
    const fixed = kindOf(card) === 'fixed';
    const published = fixed ? undefined : this.zones.publishedZones(entityId, card.zoneMapVersion);
    const zones = published?.zones ?? [];
    const groups = published?.groups ?? [];
    const anywhere = { code: '', name: '', group: '', centre: { lat: 0, lng: 0 } };
    const from = fixed ? anywhere : zones.find((z) => z.code === ask.from);
    const to = fixed ? anywhere : zones.find((z) => z.code === ask.to);
    if (!from || !to) throw new GlosError('NOT_FOUND', `There is no zone ${!from ? ask.from : ask.to} on zone map ${card.zoneMapVersion}`);
    const w = card.weight;
    const weighed = ask.kg != null && ask.kg > 0 ? ask.kg : ask.size ? SIZE_WEIGHT_KG[ask.size] : undefined;
    if (weighed == null && !ask.dims) throw new GlosError('VALIDATION_FAILED', 'Say what it weighs, its size, or its measurements', { field: 'kg' });
    const volume = ask.dims ? (ask.dims.l * ask.dims.w * ask.dims.h) / (ask.door ? w.divisorDoor : w.divisorShop) : 0;
    const counted = ask.dims && !(w.volumeFromKg > 0 && (weighed ?? 0) < w.volumeFromKg) ? volume : 0;
    const raw = Math.max(weighed ?? 0, counted);
    const billableKg = Math.max(w.stepKg, Math.ceil(raw / w.stepKg - 1e-9) * w.stepKg);
    if (billableKg > w.maxKg + 1e-9) throw new GlosError('INVALID_INPUT', `It counts as ${r2(billableKg)} kg; the most a parcel may be here is ${w.maxKg} kg: send it as freight`, { field: 'kg' });

    const { band, zonesCrossed, km } = fixed ? { band: card.bands[0], zonesCrossed: 0, km: 0 } : this.bandFor(entityId, card, from, to);

    const lines: ZonePriceLine[] = [];
    const prices = card.table[band.key] ?? [];
    const idx = card.steps.findIndex((s) => billableKg <= s + 1e-9);
    const last = card.steps.length - 1;
    const tablePrice = idx >= 0 ? prices[idx] ?? 0 : (prices[last] ?? 0) + (card.perExtraKg[band.key] ?? 0) * Math.ceil(billableKg - card.steps[last] - 1e-9);
    lines.push({ key: 'table', label: idx >= 0 ? `${band.name}, up to ${card.steps[idx]} kg` : `${band.name}, ${card.steps[last]} kg and ${Math.ceil(billableKg - card.steps[last] - 1e-9)} kg more`, amount: r2(tablePrice) });

    const groupName = (key: string) => groups.find((g) => g.key === key)?.name ?? key;
    const endCharge = (z: { code: string; group: string }): EndCharge => card.zoneCharges[z.code] ?? card.groupCharges[z.group] ?? { perParcel: 0, perKg: 0 };
    for (const [key, z] of fixed ? [] : from.code === to.code ? ([['from', from]] as const) : ([['from', from], ['to', to]] as const)) {
      const c = endCharge(z);
      const amount = r2(c.perParcel + c.perKg * billableKg);
      if (amount) lines.push({ key: `end:${key}`, label: `${z.name} (${card.zoneCharges[z.code] ? 'its own price' : groupName(z.group)})`, amount });
    }
    if (ask.door && card.surcharges.door) lines.push({ key: 'door', label: 'To a door', amount: r2(card.surcharges.door) });
    if (ask.dims && Math.max(ask.dims.l, ask.dims.w, ask.dims.h) > card.surcharges.oversizeCm && card.surcharges.oversize) lines.push({ key: 'oversize', label: `Longer than ${card.surcharges.oversizeCm} cm`, amount: r2(card.surcharges.oversize) });
    if (ask.fragile && card.surcharges.fragile) lines.push({ key: 'fragile', label: 'Fragile', amount: r2(card.surcharges.fragile) });
    const subtotal = r2(lines.reduce((n, l) => n + l.amount, 0));
    if (card.minimum > subtotal) lines.push({ key: 'minimum', label: 'Up to the minimum', amount: r2(card.minimum - subtotal) });

    return {
      version: card.version,
      zoneMapVersion: card.zoneMapVersion,
      currency: card.currency,
      from: from.code,
      to: to.code,
      fromName: from.name,
      toName: to.name,
      band: band.key,
      bandName: band.name,
      zonesCrossed,
      km,
      billableKg: r2(billableKg),
      by: counted > (weighed ?? 0) ? 'size' : 'weight',
      lines,
      amount: r2(Math.max(subtotal, card.minimum)),
    };
  }

  /**
   * The band two zones are priced in on a card: a pair named on the card, else the zones between them and the km between
   * their centres, the further of the two. The same for a price worked out here and for a counter's price list.
   */
  bandFor(entityId: string, card: StoredPriceCard, from: { code: string; centre: { lat: number; lng: number } }, to: { code: string; centre: { lat: number; lng: number } }): { band: PriceBand; zonesCrossed: number; km: number } {
    const pair = card.pairs.find((p) => (p.a === from.code && p.b === to.code) || (p.a === to.code && p.b === from.code));
    const crossing = this.zones.crossing(entityId, card.zoneMapVersion, from.code, to.code);
    // A CARD'S DISTANCES ARE ITS OWN (2026-11-08, zone pricing step 4): the estimate — the straight line between the zones'
    // centres times the road factor, as the network has always estimated a road — never whatever router is wired in that day.
    // A card approved on one measure is charged on that measure: switching real road distances on must not re-band a card
    // already approved. Real road km come to a card of their own, frozen when it is made ready, once a routing server runs.
    const km = from.code === to.code ? 0 : r2(this.roadKmOf(entityId, card, from.code, to.code) ?? haversineKm(from.centre, to.centre) * ROAD_CIRCUITY_FACTOR);
    const band = pair ? card.bands.find((b) => b.key === pair.band) ?? this.bandOf(card.bands, crossing.zonesCrossed, km) : this.bandOf(card.bands, crossing.zonesCrossed, km);
    return { band, zonesCrossed: crossing.zonesCrossed, km };
  }

  /** A card measured by road: the km between two of its zones as measured, or nothing (estimate it) where the map knows no road. */
  private roadKmOf(entityId: string, card: StoredPriceCard, a: string, b: string): number | undefined {
    if (card.distances !== 'roads') return undefined;
    const key = `${entityId}#${card.version}`;
    const table = this.roadKm.get(key);
    if (!table) return undefined;
    let index = this.roadIndex.get(key);
    if (!index) {
      index = new Map(table.zones.map((z, i) => [z, i]));
      this.roadIndex.set(key, index);
    }
    const i = index.get(a);
    const j = index.get(b);
    if (i == null || j == null || i === j) return undefined;
    const [lo, hi] = i < j ? [i, j] : [j, i];
    const n = table.zones.length;
    const km = table.km[lo * n - (lo * (lo + 1)) / 2 + (hi - lo - 1)];
    return km == null ? undefined : km;
  }

  /**
   * 2026-11-08 — MEASURE A CARD'S ROADS (step 4): every zone of its map to every other, from the routing server, kept beside
   * the card. All or nothing: a server that cannot answer leaves the card estimated, with why — said in the change log.
   */
  private async measureRoads(entityId: string, version: number): Promise<void> {
    const s0 = this.store.get(entityId);
    const card0 = s0?.cards.find((c) => c.version === version);
    if (!card0 || !this.roads) return;
    const { zones } = this.zones.publishedZones(entityId, card0.zoneMapVersion);
    let got: { km: Array<Array<number | null>> } | { why: string };
    try {
      got = await this.roads.allPairs(zones.map((z) => z.centre));
    } catch (e) {
      got = { why: (e as Error).message || 'the routing server could not be asked' };
    }
    const s = this.store.get(entityId);
    const card = s?.cards.find((c) => c.version === version);
    if (!s || !card || card.distances !== 'measuring') return;
    const name = { name: 'SeeBuyGet', id: 'system' };
    if ('why' in got) {
      Object.assign(card, { distances: 'estimate', distancesWhy: got.why });
      this.save(s);
      this.note(entityId, name, `price card ${version}: road distances being measured`, `price card ${version}: estimated distances — ${got.why}`);
      this.logger.warn(`Price card ${version} of ${entityId} keeps estimated distances: ${got.why}`);
      return;
    }
    const km: Array<number | null> = [];
    for (let i = 0; i < zones.length; i += 1) {
      for (let j = i + 1; j < zones.length; j += 1) {
        const ab = got.km[i][j];
        const ba = got.km[j][i];
        const shorter = ab == null ? ba : ba == null ? ab : Math.min(ab, ba);
        km.push(shorter == null ? null : Math.round(shorter * 10) / 10);
      }
    }
    this.roadKm.set(`${entityId}#${version}`, { zones: zones.map((z) => z.code), km, at: new Date().toISOString() });
    this.roadIndex.delete(`${entityId}#${version}`);
    Object.assign(card, { distances: 'roads' });
    delete card.distancesWhy;
    this.save(s);
    this.note(entityId, name, `price card ${version}: road distances being measured`, `price card ${version}: road distances between its ${zones.length} zones measured`);
  }

  /**
   * 2026-11-08 — the cards a counter prices from with no signal (zone pricing, step 3b): the one in force in a country now,
   * and every approved one that comes into force after it, oldest first. Each says from when.
   */
  cardsFrom(country: string | undefined, now: number = Date.now()): { entityId: string; cards: StoredPriceCard[] } | undefined {
    const company = this.entities.forJurisdiction(country);
    if (!company || !this.store.get(company.entityId)) return undefined;
    return { entityId: company.entityId, cards: this.cardsOfCompany(company.entityId, now) };
  }

  /**
   * One company's cards of the kind it prices by: the one in force, then every approved one to come, oldest first. By its
   * id, so a company still in draft — preparing its prices — has them too; nothing prices from a draft's cards, since the
   * country lookups that price (`inForceFor`, `cardsFrom`) never find one.
   */
  cardsOfCompany(entityId: string, now: number = Date.now()): StoredPriceCard[] {
    const s = this.store.get(entityId);
    if (!s) return [];
    const kind = this.kindFor(entityId);
    const inForce = this.inForceOf(s, now, kind);
    const later = s.cards.filter((c) => kindOf(c) === kind && c.status === 'approved' && Date.parse(c.effectiveFrom!) > now).sort((a, b) => Date.parse(a.effectiveFrom!) - Date.parse(b.effectiveFrom!) || a.version - b.version);
    return [...(inForce ? [inForce] : []), ...later];
  }

  /** The band of a pair: the first band its zones-between fit, and the first its km fit — the further of the two. */
  bandOf(bands: PriceBand[], zonesCrossed: number, km: number): PriceBand {
    const byZones = bands.findIndex((b) => b.maxZones == null || zonesCrossed <= b.maxZones);
    const byKm = bands.findIndex((b) => b.maxKm == null || km <= b.maxKm);
    return bands[Math.max(byZones < 0 ? bands.length - 1 : byZones, byKm < 0 ? bands.length - 1 : byKm)];
  }

  /* -------------------------------------------------------------- changing -- */

  setSettings(entityId: string, input: Partial<PriceCardSettings>, by: Doer): PriceCardsView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const next: PriceCardSettings = { filingRequired: input.filingRequired ?? s.settings.filingRequired, noticeDays: input.noticeDays ?? s.settings.noticeDays };
    if (!Number.isInteger(next.noticeDays) || next.noticeDays < 0 || next.noticeDays > 180) throw new GlosError('VALIDATION_FAILED', 'Notice is a whole number of days, from 0 to 180', { field: 'noticeDays' });
    if (next.filingRequired === s.settings.filingRequired && next.noticeDays === s.settings.noticeDays) return this.overview(entityId);
    const line = (x: PriceCardSettings) => `${x.filingRequired ? 'filed with the regulator' : 'no filing'}, ${x.noticeDays} days’ notice`;
    this.save({ ...s, settings: next });
    this.note(entityId, by, `price cards: ${line(s.settings)}`, `price cards: ${line(next)}`);
    return this.overview(entityId);
  }

  /** A new draft: the newest card's terms, else the neutral start, on a published zone map (the one given, else the one in force). */
  startDraft(entityId: string, zoneMapVersion: number | undefined, by: Doer, now: number = Date.now(), kind: PriceCardKind = 'zones'): PriceCardsView {
    const company = this.company(entityId);
    const s = this.stored(company);
    if (this.working(s)) throw new GlosError('INVALID_STATE', 'A card is already being worked on: finish it or throw it away first');
    if (kind === 'fixed') {
      // 2026-11-12 — A FIXED CARD (the owner's D3): the newest fixed card's terms, else one price per size, all to fill in.
      const newestFixed = [...s.cards].filter((c) => c.status !== 'withdrawn' && kindOf(c) === 'fixed').sort((a, b) => b.version - a.version)[0];
      const terms: PriceCardTerms = newestFixed ? this.termsOf(newestFixed) : this.neutralFixed();
      const card: StoredPriceCard = { ...terms, kind: 'fixed', version: s.cards.reduce((n, c) => Math.max(n, c.version), 0) + 1, status: 'draft', zoneMapVersion: 0, currency: company.currency ?? '', createdAt: new Date(now).toISOString(), createdBy: by.name };
      this.save({ ...s, cards: [...s.cards, card] });
      this.note(entityId, by, this.inForceLine(s, now), `price card ${card.version}: a fixed card, a draft`);
      return this.overview(entityId, now);
    }
    const setup = this.zones.setup(entityId, now);
    const mapVersion = zoneMapVersion ?? setup.inForce?.version;
    if (mapVersion == null || !setup.versions.some((v) => v.version === mapVersion)) throw new GlosError('INVALID_STATE', 'A price card is made on a published zone map: publish the zones first');
    const newest = [...s.cards].filter((c) => c.status !== 'withdrawn' && kindOf(c) === 'zones').sort((a, b) => b.version - a.version)[0];
    const { groups } = this.zones.publishedZones(entityId, mapVersion);
    const terms: PriceCardTerms = newest ? this.termsOf(newest) : this.neutral(groups.map((g) => g.key));
    // Groups the map has that the terms do not get a charge of nothing, said on the card; a group gone is dropped.
    terms.groupCharges = Object.fromEntries(groups.map((g) => [g.key, terms.groupCharges[g.key] ?? { perParcel: 0, perKg: 0 }]));
    const card: StoredPriceCard = { ...terms, version: s.cards.reduce((n, c) => Math.max(n, c.version), 0) + 1, status: 'draft', zoneMapVersion: mapVersion, currency: company.currency ?? '', createdAt: new Date(now).toISOString(), createdBy: by.name };
    this.save({ ...s, cards: [...s.cards, card] });
    this.note(entityId, by, this.inForceLine(s, now), `price card ${card.version}: a draft on zone map ${mapVersion}`);
    return this.overview(entityId, now);
  }

  /** The draft's terms, the whole card every time. Saved as typed; what is still wrong is shown, and stops it being made ready. */
  saveDraft(entityId: string, terms: PriceCardTerms, by: Doer, now: number = Date.now()): PriceCardsView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const draft = s.cards.find((c) => c.status === 'draft');
    if (!draft) throw new GlosError('INVALID_STATE', 'There is no draft card: start one first');
    const kept = kindOf(draft) === 'fixed' ? this.asFixed(terms) : terms;
    const shape = this.shapeProblem(kept, kindOf(draft));
    if (shape) throw new GlosError('VALIDATION_FAILED', shape);
    Object.assign(draft, this.termsOf(kept as StoredPriceCard));
    this.save(s);
    this.note(entityId, by, `price card ${draft.version}`, `price card ${draft.version}: its terms saved`);
    return this.overview(entityId, now);
  }

  discardDraft(entityId: string, by: Doer, now: number = Date.now()): PriceCardsView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const draft = s.cards.find((c) => c.status === 'draft');
    if (!draft) throw new GlosError('INVALID_STATE', 'There is no draft card');
    this.save({ ...s, cards: s.cards.filter((c) => c !== draft) });
    this.note(entityId, by, `price card ${draft.version} (draft)`, 'thrown away');
    return this.overview(entityId, now);
  }

  /** Ready: nothing wrong with it, and no longer changed. The one who makes it ready cannot be the one who approves it. */
  ready(entityId: string, by: Doer, now: number = Date.now()): PriceCardsView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const draft = s.cards.find((c) => c.status === 'draft');
    if (!draft) throw new GlosError('INVALID_STATE', 'There is no draft card');
    const problems = this.problems(entityId, draft);
    if (problems.length) throw new GlosError('INVALID_STATE', `It cannot be made ready yet: ${problems[0]}`, { problems });
    const byRoad = kindOf(draft) === 'zones' && Boolean(this.roads?.configured());
    Object.assign(draft, { status: 'ready', readyAt: new Date(now).toISOString(), readyBy: by.name, readyById: by.id, ...(kindOf(draft) === 'zones' ? { distances: byRoad ? 'measuring' : 'estimate' } : {}) });
    this.save(s);
    if (byRoad) {
      const key = `${entityId}#${draft.version}`;
      const job = this.measureRoads(entityId, draft.version).finally(() => this.measuring.delete(key));
      this.measuring.set(key, job);
    }
    this.note(entityId, by, `price card ${draft.version} (draft)`, `price card ${draft.version}: ready${s.settings.filingRequired ? ', to be filed with the regulator' : ', for a second person to approve'}`);
    return this.overview(entityId, now);
  }

  /** Filed with the regulator (where the country says its regulator requires it), with the filing's reference. */
  filed(entityId: string, version: number, ref: string, by: Doer, now: number = Date.now()): PriceCardsView {
    const { s, card } = this.cardOf(entityId, version);
    if (!s.settings.filingRequired) throw new GlosError('INVALID_STATE', 'This country does not file its price cards with a regulator');
    if (card.status !== 'ready') throw new GlosError('INVALID_STATE', 'Only a ready card is filed');
    const reference = (ref ?? '').trim().slice(0, 120);
    if (!reference) throw new GlosError('VALIDATION_FAILED', 'Say the filing’s reference', { field: 'reference' });
    Object.assign(card, { status: 'filed', filedAt: new Date(now).toISOString(), filedBy: by.name, filedRef: reference });
    this.save(s);
    this.note(entityId, by, `price card ${version}: ready`, `price card ${version}: filed with the regulator (${reference})`);
    return this.overview(entityId, now);
  }

  /** Cleared by the regulator, with its reference. */
  cleared(entityId: string, version: number, ref: string, by: Doer, now: number = Date.now()): PriceCardsView {
    const { s, card } = this.cardOf(entityId, version);
    if (card.status !== 'filed') throw new GlosError('INVALID_STATE', 'Only a filed card is cleared');
    const reference = (ref ?? '').trim().slice(0, 120);
    if (!reference) throw new GlosError('VALIDATION_FAILED', 'Say the regulator’s reference', { field: 'reference' });
    Object.assign(card, { status: 'cleared', clearedAt: new Date(now).toISOString(), clearedBy: by.name, clearedRef: reference });
    this.save(s);
    this.note(entityId, by, `price card ${version}: filed`, `price card ${version}: cleared by the regulator (${reference})`);
    return this.overview(entityId, now);
  }

  /**
   * Approved by a second person — never the one who made it ready — from a date at least the country's notice days ahead.
   * From that date it is the country's price card; the one before stays until then.
   */
  approve(entityId: string, version: number, from: string | undefined, by: Doer, now: number = Date.now()): PriceCardsView {
    const { s, card } = this.cardOf(entityId, version);
    const waiting = s.settings.filingRequired ? 'cleared' : 'ready';
    if (card.status !== waiting) throw new GlosError('INVALID_STATE', s.settings.filingRequired ? 'A card is approved once the regulator has cleared it' : 'Only a ready card is approved');
    if (card.readyById === by.id) throw new GlosError('FORBIDDEN', 'A second person approves it: not the one who made it ready');
    if (card.distances === 'measuring') throw new GlosError('INVALID_STATE', 'The road distances between its zones are still being measured: try again in a minute');
    const earliest = now + s.settings.noticeDays * DAY;
    const at = from ? Date.parse(from) : earliest;
    if (!Number.isFinite(at)) throw new GlosError('VALIDATION_FAILED', 'The date it starts from is not a date', { field: 'from' });
    if (at < earliest - 60_000) throw new GlosError('VALIDATION_FAILED', `It can start ${s.settings.noticeDays} days from now at the earliest: that is the notice this country gives`, { field: 'from' });
    if (at > now + MAX_AHEAD_DAYS * DAY) throw new GlosError('VALIDATION_FAILED', 'A card can be approved at most a year ahead', { field: 'from' });
    const problems = this.problems(entityId, card);
    if (problems.length) throw new GlosError('INVALID_STATE', `It cannot be approved: ${problems[0]}`, { problems });
    Object.assign(card, { status: 'approved', approvedAt: new Date(now).toISOString(), approvedBy: by.name, effectiveFrom: new Date(Math.max(at, now)).toISOString() });
    this.save(s);
    this.note(entityId, by, this.inForceLine(s, now, card.version, kindOf(card)), `price card ${version} from ${card.effectiveFrom!.slice(0, 16).replace('T', ' ')} UTC`);
    return this.overview(entityId, now);
  }

  /** A card on its way taken back: ready, filed, cleared, or approved for a date still to come. One in force is replaced, never withdrawn. */
  withdraw(entityId: string, version: number, by: Doer, now: number = Date.now()): PriceCardsView {
    const { s, card } = this.cardOf(entityId, version);
    const scheduled = card.status === 'approved' && Date.parse(card.effectiveFrom!) > now;
    if (!['ready', 'filed', 'cleared'].includes(card.status) && !scheduled) throw new GlosError('INVALID_STATE', card.status === 'approved' ? 'A card in force is replaced by a new one, not withdrawn' : 'Only a card on its way is withdrawn');
    const before = card.status;
    Object.assign(card, { status: 'withdrawn', withdrawnAt: new Date(now).toISOString(), withdrawnBy: by.name });
    this.save(s);
    this.note(entityId, by, `price card ${version}: ${before}`, `price card ${version}: withdrawn`);
    return this.overview(entityId, now);
  }

  /* ------------------------------------------------------------- checking -- */

  /** What is wrong with a card's terms, in words — empty when nothing is. Shown on the draft; it stops ready and approval. */
  problems(entityId: string, card: StoredPriceCard): string[] {
    const out: string[] = [];
    const shape = this.shapeProblem(card, kindOf(card));
    if (shape) return [shape];
    const fixed = kindOf(card) === 'fixed';
    let zones: Array<{ code: string; group: string }> = [];
    if (!fixed) try {
      zones = this.zones.publishedZones(entityId, card.zoneMapVersion).zones;
    } catch {
      return [`Zone map ${card.zoneMapVersion} is not published`];
    }
    card.bands.forEach((b, i) => {
      const prices = card.table[b.key] ?? [];
      if (prices.length !== card.steps.length) out.push(`${b.name} needs a price for every weight`);
      else if (prices.some((p) => !(p > 0))) out.push(`${b.name} has a weight with no price`);
      else if (prices.some((p, j) => j > 0 && p < prices[j - 1])) out.push(`${b.name} is cheaper for a heavier parcel`);
      const before = i > 0 ? card.table[card.bands[i - 1].key] ?? [] : [];
      if (before.length === prices.length && prices.some((p, j) => p < before[j])) out.push(`${b.name} is cheaper than ${card.bands[i - 1].name} for the same weight`);
      if (card.steps[card.steps.length - 1] < card.weight.maxKg && !((card.perExtraKg[b.key] ?? 0) > 0)) out.push(`${b.name} needs a price for each kg above ${card.steps[card.steps.length - 1]} kg`);
    });
    const codes = new Set(zones.map((z) => z.code));
    for (const code of Object.keys(card.zoneCharges)) if (!codes.has(code)) out.push(`Zone ${code} is not on zone map ${card.zoneMapVersion}`);
    for (const p of card.pairs) {
      if (!codes.has(p.a) || !codes.has(p.b)) out.push(`A pair names a zone that is not on zone map ${card.zoneMapVersion}`);
      if (!card.bands.some((b) => b.key === p.band)) out.push(`A pair names a band the card does not have`);
    }
    return [...new Set(out)];
  }

  /** What is wrong with the card's shape before anything else can be said of it: the rules a figure must keep to. */
  private shapeProblem(t: PriceCardTerms, kind: PriceCardKind = 'zones'): string | null {
    const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
    if (kind === 'fixed' ? !Array.isArray(t.bands) || t.bands.length !== 1 : !Array.isArray(t.bands) || t.bands.length < 2 || t.bands.length > 8) return kind === 'fixed' ? 'A fixed card has one price for each weight, anywhere' : 'A card has from 2 to 8 bands';
    const keys = new Set<string>();
    for (const [i, b] of t.bands.entries()) {
      if (!b?.key || keys.has(b.key)) return 'Every band needs a key of its own';
      keys.add(b.key);
      if (!b.name?.trim()) return 'Every band needs a name';
      const lastBand = i === t.bands.length - 1;
      if (lastBand ? b.maxZones != null || b.maxKm != null : !num(b.maxZones, 0, 1000) || !num(b.maxKm, 0, 20000)) return lastBand ? 'The last band takes every pair further than the one before: it has no limit' : `${b.name} needs its most zones between and its most km`;
      const prev = t.bands[i - 1];
      if (i > 0 && !lastBand && (b.maxZones! < prev.maxZones! || b.maxKm! <= prev.maxKm!)) return `${b.name} must reach further than ${prev.name}`;
    }
    if (!Array.isArray(t.steps) || !t.steps.length || t.steps.length > 20 || t.steps.some((s, i) => !num(s, 0.01, 1000) || (i > 0 && s <= t.steps[i - 1]))) return 'The weights go up, from the lightest';
    const w = t.weight;
    if (!w || !num(w.divisorShop, 1000, 10000) || !num(w.divisorDoor, 1000, 10000)) return 'A size divisor is from 1,000 to 10,000 cm³ per kg';
    if (!num(w.stepKg, 0.1, 5)) return 'Weights round up in steps of 0.1 to 5 kg';
    if (!num(w.maxKg, 1, 100)) return 'The most a parcel may weigh is from 1 to 100 kg';
    if (!num(w.volumeFromKg, 0, 100)) return 'The weight below which size is not counted is from 0 to 100 kg';
    if (t.steps[t.steps.length - 1] > w.maxKg) return 'No weight on the card may be over the most a parcel may weigh';
    if (typeof t.table !== 'object' || typeof t.perExtraKg !== 'object' || typeof t.groupCharges !== 'object' || typeof t.zoneCharges !== 'object' || !Array.isArray(t.pairs)) return 'The card is not complete';
    for (const prices of Object.values(t.table)) if (!Array.isArray(prices) || prices.some((p) => !num(p, 0, 1e9))) return 'A price is a number, nothing below zero';
    for (const v of Object.values(t.perExtraKg)) if (!num(v, 0, 1e9)) return 'A price per kg is a number, nothing below zero';
    for (const c of [...Object.values(t.groupCharges), ...Object.values(t.zoneCharges)]) if (!c || !num(c.perParcel, 0, 1e9) || !num(c.perKg, 0, 1e9)) return 'A charge is a number, nothing below zero';
    const sc = t.surcharges;
    if (!sc || !num(sc.door, 0, 1e9) || !num(sc.oversize, 0, 1e9) || !num(sc.fragile, 0, 1e9) || !num(sc.oversizeCm, 30, 300)) return 'A surcharge is a number, nothing below zero; oversize starts from 30 to 300 cm';
    if (!num(t.minimum, 0, 1e9) || !num(t.cashStep, 0, 1e6)) return 'The minimum and the cash step are numbers, nothing below zero';
    if (t.pairs.length > 2000) return 'At most 2,000 pairs';
    return null;
  }

  /**
   * ITS COST, ESTIMATED, BESIDE EACH PRICE — at the country's own starting figures (its rate per km, a hub's sorting fee, a
   * bag's loading pay) over a typical distance for the band. An estimate, and said to be one: what a parcel really costs is
   * known only once it has travelled (step 4's weekly report). Shops' own fees are not in it: they are added to the price.
   */
  costs(entityId: string, card: StoredPriceCard): PriceCostCell[] {
    const a = this.entities.amountsFor(entityId);
    const out: PriceCostCell[] = [];
    const fixed = kindOf(card) === 'fixed';
    card.bands.forEach((b, i) => {
      const prev = i > 0 ? card.bands[i - 1].maxKm ?? 0 : 0;
      // 2026-11-12 — a fixed card prices near and far alike: costed on a middling journey, two hubs and 150 km.
      const km = fixed ? 150 : b.maxKm != null ? (prev + b.maxKm) / 2 : prev * 1.5 || 300;
      const hubs = fixed ? 2 : i === 0 ? 1 : 2;
      card.steps.forEach((kg, j) => {
        const units = Math.min(BAG_CAPACITY_UNITS, kg / MEDIUM_KG);
        const cost = km * a.freightPerKm * units + hubs * a.mdpSortFee + (hubs + 1) * a.toteLoadFee * (units / BAG_CAPACITY_UNITS);
        out.push({ band: b.key, stepKg: kg, price: r2(card.table[b.key]?.[j] ?? 0), cost: r2(cost) });
      });
    });
    return out;
  }

  /* --------------------------------------------------------------- inside -- */

  private company(entityId: string): Entity {
    const company = this.entities.get(entityId);
    if (company.kind !== 'sister' || !company.jurisdiction) throw new GlosError('FORBIDDEN', `${company.name} does not run a country: a price card belongs to the company that does`);
    return company;
  }

  private stored(company: Entity): StoredPriceCards {
    return this.store.get(company.entityId) ?? { entityId: company.entityId, settings: { ...DEFAULT_SETTINGS }, cards: [] };
  }

  private save(s: StoredPriceCards): void {
    this.store.set(s.entityId, s);
  }

  private working(s: StoredPriceCards): StoredPriceCard | undefined {
    return s.cards.find((c) => ['draft', 'ready', 'filed', 'cleared'].includes(c.status));
  }

  private cardOf(entityId: string, version: number): { s: StoredPriceCards; card: StoredPriceCard } {
    const company = this.company(entityId);
    const s = this.stored(company);
    const card = s.cards.find((c) => c.version === version);
    if (!card) throw new GlosError('NOT_FOUND', `${company.name} has no price card ${version}`);
    return { s, card };
  }

  private inForceOf(s: StoredPriceCards, at: number, kind: PriceCardKind): StoredPriceCard | undefined {
    return s.cards
      .filter((c) => kindOf(c) === kind && c.status === 'approved' && Date.parse(c.effectiveFrom!) <= at)
      .sort((a, b) => Date.parse(b.effectiveFrom!) - Date.parse(a.effectiveFrom!) || b.version - a.version)[0];
  }

  private statusOf(s: StoredPriceCards, c: StoredPriceCard, now: number): PriceCardView['status'] {
    if (c.status !== 'approved') return c.status;
    if (this.inForceOf(s, now, kindOf(c))?.version === c.version) return 'in_force';
    return Date.parse(c.effectiveFrom!) > now ? 'scheduled' : 'past';
  }

  private inForceLine(s: StoredPriceCards, now: number, besides?: number, kind?: PriceCardKind): string {
    const c = kind ? this.inForceOf(s, now, kind) : (this.inForceOf(s, now, 'fixed') ?? this.inForceOf(s, now, 'zones'));
    return c && c.version !== besides ? `price card ${c.version}` : 'no price card';
  }

  private neutral(groupKeys: string[]): PriceCardTerms {
    return {
      bands: DEFAULT_BANDS.map((b) => ({ ...b })),
      steps: [...DEFAULT_STEPS],
      table: Object.fromEntries(DEFAULT_BANDS.map((b) => [b.key, DEFAULT_STEPS.map(() => 0)])),
      perExtraKg: Object.fromEntries(DEFAULT_BANDS.map((b) => [b.key, 0])),
      groupCharges: Object.fromEntries(groupKeys.map((k) => [k, { perParcel: 0, perKg: 0 }])),
      zoneCharges: {},
      pairs: [],
      weight: { divisorShop: 6000, divisorDoor: 5000, stepKg: 0.5, maxKg: 30, volumeFromKg: 0 },
      surcharges: { door: 0, oversize: 0, oversizeCm: 100, fragile: 0 },
      minimum: 0,
      cashStep: 0,
    };
  }

  /** 2026-11-12 — where a fixed card starts: one price for each size, all to fill in, in the country's own money. */
  private neutralFixed(): PriceCardTerms {
    const start = this.neutral([]);
    return { ...start, bands: [{ ...FIXED_BAND }], steps: [...FIXED_STEPS], table: { [FIXED_BAND.key]: FIXED_STEPS.map(() => 0) }, perExtraKg: { [FIXED_BAND.key]: 0 }, groupCharges: {}, zoneCharges: {}, pairs: [] };
  }

  /** A fixed card's terms as kept: its one band, its own row of prices, no zones whatever was sent. */
  private asFixed(t: PriceCardTerms): PriceCardTerms {
    const band = t.bands?.[0];
    const key = band?.key ?? FIXED_BAND.key;
    return {
      ...t,
      bands: [{ key: FIXED_BAND.key, name: band?.name?.trim() || FIXED_BAND.name, maxZones: null, maxKm: null }],
      table: { [FIXED_BAND.key]: t.table?.[key] ?? t.table?.[FIXED_BAND.key] ?? [] },
      perExtraKg: { [FIXED_BAND.key]: t.perExtraKg?.[key] ?? t.perExtraKg?.[FIXED_BAND.key] ?? 0 },
      groupCharges: {},
      zoneCharges: {},
      pairs: [],
    };
  }

  /** A card's terms, copied — never a reference into another card. */
  private termsOf(c: PriceCardTerms): PriceCardTerms {
    return JSON.parse(
      JSON.stringify({ bands: c.bands, steps: c.steps, table: c.table, perExtraKg: c.perExtraKg, groupCharges: c.groupCharges, zoneCharges: c.zoneCharges, pairs: c.pairs, weight: c.weight, surcharges: c.surcharges, minimum: c.minimum, cashStep: c.cashStep }),
    ) as PriceCardTerms;
  }

  private view(company: Entity, s: StoredPriceCards, c: StoredPriceCard, now: number): PriceCardView {
    const status = this.statusOf(s, c, now);
    return {
      ...this.termsOf(c),
      version: c.version,
      kind: kindOf(c),
      status,
      zoneMapVersion: c.zoneMapVersion,
      currency: c.currency,
      createdAt: c.createdAt,
      createdBy: c.createdBy,
      ...(c.readyBy ? { readyBy: c.readyBy } : {}),
      ...(c.distances ? { distances: c.distances } : {}),
      ...(c.distancesWhy ? { distancesWhy: c.distancesWhy } : {}),
      ...(c.filedRef ? { filedRef: c.filedRef, filedBy: c.filedBy } : {}),
      ...(c.clearedRef ? { clearedRef: c.clearedRef, clearedBy: c.clearedBy } : {}),
      ...(c.approvedBy ? { approvedBy: c.approvedBy, approvedAt: c.approvedAt } : {}),
      ...(c.effectiveFrom ? { effectiveFrom: c.effectiveFrom } : {}),
      ...(c.withdrawnBy ? { withdrawnBy: c.withdrawnBy } : {}),
      problems: ['draft', 'ready', 'filed', 'cleared'].includes(status) ? this.problems(company.entityId, c) : [],
    };
  }

  private note(entityId: string, by: Doer, from: string, to: string): void {
    this.entities.noteChange(entityId, { by: by.name, what: 'prices', from, to });
  }
}
