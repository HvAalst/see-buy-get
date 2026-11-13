/**
 * A WALK-UP'S PRICE WORKED OUT ON THIS PHONE (2026-11-08 — zone pricing, step 3b). With no signal the counter still tells
 * the sender what to pay: from the price list the server last gave this shop (GET agents/:did/counter-prices, kept by the
 * read cache). The sums are the server's, step for step — the price card's (billable weight, band, table, each end,
 * surcharges, the minimum), then the two shops' own fees, our fee, the tax, and the country's cash step. A take-in kept
 * with no signal is priced again by the server at the card in force when it was made; the two agree by construction,
 * and the Shop app's test checks every case the server wrote down (backend contracts/counter-price-cases.json).
 */

export interface CounterCard {
  version: number;
  zoneMapVersion: number;
  from: string;
  origin: string;
  steps: number[];
  table: Record<string, number[]>;
  perExtraKg: Record<string, number>;
  weight: { divisorShop: number; stepKg: number; maxKg: number; volumeFromKg: number };
  surcharges: { oversize: number; oversizeCm: number; fragile: number };
  minimum: number;
  cashStep: number;
  bands: Record<string, string>;
  ends: Record<string, [number, number]>;
  zoneOf: Record<string, string>;
}

export interface CounterPriceRow {
  shop: string;
  country: string;
  currency: string;
  at: string;
  sizes: Array<{ maxCm: [number, number, number]; maxKg: number; lane: string }>;
  lanes: Record<string, { feePct: number; taxPct: number }>;
  fees: Record<string, number>;
  /** 2026-11-13 — each shop's heaviest parcel, as its tools let it take; absent in a list made before it was said. */
  maxKg?: Record<string, number>;
  cards: CounterCard[];
}

export interface CounterAsk {
  dest: string;
  l: number;
  w: number;
  h: number;
  kg: number;
  fragile?: boolean;
}

export interface CounterPrice {
  gross: number;
  currency: string;
  /** The card it came from, and from when that card is in force. */
  version: number;
  from: string;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The card in force at a moment: the latest whose date has come. */
export function cardAt(row: CounterPriceRow, now: number): CounterCard | undefined {
  let found: CounterCard | undefined;
  for (const c of row.cards) {
    const from = Date.parse(c.from);
    if (Number.isFinite(from) && from <= now && (!found || from > Date.parse(found.from) || (from === Date.parse(found.from) && c.version > found.version))) found = c;
  }
  return found;
}

/** The size class's lane, as the server classifies a parcel: the first class it fits, else the last. */
function laneOf(row: CounterPriceRow, a: CounterAsk): string | undefined {
  const desc = [a.l, a.w, a.h].sort((x, y) => y - x);
  const fit = row.sizes.find((s) => {
    const lim = [...s.maxCm].sort((x, y) => y - x);
    return a.kg <= s.maxKg && desc.every((d, i) => d <= lim[i]);
  });
  return (fit ?? row.sizes[row.sizes.length - 1])?.lane;
}

/** The card's price between this shop's zone and another's (the server's PriceCardService.priceOn), or nothing over its most. */
function cardAmount(card: CounterCard, destZone: string, a: CounterAsk): number | undefined {
  const w = card.weight;
  const volume = (a.l * a.w * a.h) / w.divisorShop;
  const counted = !(w.volumeFromKg > 0 && a.kg < w.volumeFromKg) ? volume : 0;
  const raw = Math.max(a.kg > 0 ? a.kg : 0, counted);
  const billableKg = Math.max(w.stepKg, Math.ceil(raw / w.stepKg - 1e-9) * w.stepKg);
  if (billableKg > w.maxKg + 1e-9) return undefined;
  const band = card.bands[destZone];
  if (!band) return undefined;
  const lines: number[] = [];
  const prices = card.table[band] ?? [];
  const idx = card.steps.findIndex((s) => billableKg <= s + 1e-9);
  const last = card.steps.length - 1;
  const tablePrice = idx >= 0 ? (prices[idx] ?? 0) : (prices[last] ?? 0) + (card.perExtraKg[band] ?? 0) * Math.ceil(billableKg - card.steps[last] - 1e-9);
  lines.push(r2(tablePrice));
  for (const z of card.origin === destZone ? [card.origin] : [card.origin, destZone]) {
    const [perParcel, perKg] = card.ends[z] ?? [0, 0];
    const amount = r2(perParcel + perKg * billableKg);
    if (amount) lines.push(amount);
  }
  if (Math.max(a.l, a.w, a.h) > card.surcharges.oversizeCm && card.surcharges.oversize) lines.push(r2(card.surcharges.oversize));
  if (a.fragile && card.surcharges.fragile) lines.push(r2(card.surcharges.fragile));
  const subtotal = r2(lines.reduce((n, x) => n + x, 0));
  return r2(Math.max(subtotal, card.minimum));
}

/** A round figure for a person, the tax worked out of it, never below what it costs (the server's cashRounded). */
function cashRounded(base: number, gross: number, ratePct: number, step: number): number {
  const at = (g: number) => {
    const tax = r2((g * ratePct) / (1 + ratePct));
    return { total: r2(g - tax), gross: r2(g) };
  };
  const nearest = at(Math.round(gross / step) * step);
  return (nearest.total >= base ? nearest : at(Math.ceil(gross / step) * step)).gross;
}

/**
 * What the sender pays for a walk-up from this shop to another, as the server would say it at `now`: nothing where the
 * card does not price it (no card in force, a shop the list does not know or in no zone, heavier than the card takes).
 */
export function priceFromRow(row: CounterPriceRow | null | undefined, a: CounterAsk, now: number): CounterPrice | undefined {
  if (!row) return undefined;
  // 2026-11-13 — heavier than this shop's or the other shop's tools let it take: no price, as the server refuses it (T3).
  const most = (did: string) => row.maxKg?.[did];
  if ((most(row.shop) != null && a.kg > most(row.shop)!) || (most(a.dest) != null && a.kg > most(a.dest)!)) return undefined;
  const card = cardAt(row, now);
  if (!card) return undefined;
  const destZone = card.zoneOf[a.dest];
  const originFee = row.fees[row.shop];
  const destFee = row.fees[a.dest];
  if (!destZone || originFee == null || destFee == null) return undefined;
  const lane = row.lanes[laneOf(row, a) ?? ''];
  if (!lane) return undefined;
  const amount = cardAmount(card, destZone, a);
  if (amount == null) return undefined;
  const shopFees = r2(originFee + (a.dest === row.shop ? 0 : destFee));
  const base = r2(shopFees + amount);
  const total = r2(base * (1 + lane.feePct));
  const net = r2(total);
  const rate = Math.max(0, lane.taxPct);
  const gross = r2(net + r2(net * rate));
  return { gross: card.cashStep > 0 ? cashRounded(base, gross, rate, card.cashStep) : gross, currency: row.currency, version: card.version, from: card.from };
}
