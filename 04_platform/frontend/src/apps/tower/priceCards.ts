import type { MessageKey } from '../../shared/i18n';

/**
 * A COUNTRY'S PRICE CARD, the console's half (2026-11-08 — zone pricing, step 2). Views mirror the server's
 * price-card.types.ts; the helpers are pure, so the screen's edits and words are tested without drawing it.
 */

export interface PriceBand {
  key: string;
  name: string;
  maxZones: number | null;
  maxKm: number | null;
}
export interface EndCharge {
  perParcel: number;
  perKg: number;
}
export interface PriceCardTerms {
  bands: PriceBand[];
  steps: number[];
  table: Record<string, number[]>;
  perExtraKg: Record<string, number>;
  groupCharges: Record<string, EndCharge>;
  zoneCharges: Record<string, EndCharge>;
  pairs: Array<{ a: string; b: string; band: string }>;
  weight: { divisorShop: number; divisorDoor: number; stepKg: number; maxKg: number; volumeFromKg: number };
  surcharges: { door: number; oversize: number; oversizeCm: number; fragile: number };
  minimum: number;
  cashStep: number;
}
export type CardStatus = 'draft' | 'ready' | 'filed' | 'cleared' | 'scheduled' | 'in_force' | 'past' | 'withdrawn';
export interface PriceCardView extends PriceCardTerms {
  version: number;
  status: CardStatus;
  zoneMapVersion: number;
  currency: string;
  createdAt: string;
  createdBy: string;
  readyBy?: string;
  filedRef?: string;
  filedBy?: string;
  clearedRef?: string;
  clearedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  effectiveFrom?: string;
  withdrawnBy?: string;
  problems: string[];
}
export interface PriceCostCell {
  band: string;
  stepKg: number;
  price: number;
  cost: number;
}
export interface PriceCardsView {
  entityId: string;
  currency: string;
  settings: { filingRequired: boolean; noticeDays: number };
  zoneMaps: number[];
  inForce?: PriceCardView;
  pending: PriceCardView[];
  history: PriceCardView[];
  costs: PriceCostCell[];
}
export interface ZonePriceLine {
  key: string;
  label: string;
  amount: number;
}
export interface ZonePrice {
  version: number;
  currency: string;
  fromName: string;
  toName: string;
  bandName: string;
  zonesCrossed: number;
  km: number;
  billableKg: number;
  by: 'weight' | 'size';
  lines: ZonePriceLine[];
  amount: number;
}

/** The card being worked on (a draft, ready, filed or cleared): there is at most one. */
export function workingCard(view: PriceCardsView | null): PriceCardView | undefined {
  return view?.pending.find((c) => ['draft', 'ready', 'filed', 'cleared'].includes(c.status));
}

/** A card's terms, copied out of its view — what a draft is edited as. */
export function termsOf(card: PriceCardView): PriceCardTerms {
  const { bands, steps, table, perExtraKg, groupCharges, zoneCharges, pairs, weight, surcharges, minimum, cashStep } = card;
  return JSON.parse(JSON.stringify({ bands, steps, table, perExtraKg, groupCharges, zoneCharges, pairs, weight, surcharges, minimum, cashStep })) as PriceCardTerms;
}

/** One price in the table changed. */
export function setCell(t: PriceCardTerms, band: string, index: number, value: number): PriceCardTerms {
  const row = [...(t.table[band] ?? t.steps.map(() => 0))];
  row[index] = value;
  return { ...t, table: { ...t.table, [band]: row } };
}

/** A weight added to the table, in its place among the others; each band gets a price of nothing there, to be filled in. */
export function addStep(t: PriceCardTerms, kg: number): PriceCardTerms {
  if (!(kg > 0) || t.steps.includes(kg)) return t;
  const steps = [...t.steps, kg].sort((a, b) => a - b);
  const at = steps.indexOf(kg);
  const table = Object.fromEntries(Object.entries(t.table).map(([k, row]) => [k, [...row.slice(0, at), 0, ...row.slice(at)]]));
  return { ...t, steps, table };
}

/** A weight taken out of the table, with its prices. The last weight stays: a card always has one. */
export function removeStep(t: PriceCardTerms, index: number): PriceCardTerms {
  if (t.steps.length <= 1) return t;
  return { ...t, steps: t.steps.filter((_, i) => i !== index), table: Object.fromEntries(Object.entries(t.table).map(([k, row]) => [k, row.filter((_, i) => i !== index)])) };
}

/** The estimated cost of a cell, and whether the price stands below it. */
export function cellCost(costs: PriceCostCell[], band: string, stepKg: number): PriceCostCell | undefined {
  return costs.find((c) => c.band === band && c.stepKg === stepKg);
}
export function belowCost(price: number, cost: number | undefined): boolean {
  return cost != null && price > 0 && price < cost;
}

/** The words for a card's status. */
export function statusKey(status: CardStatus): MessageKey {
  return `tower.prices.st.${status}` as MessageKey;
}

/** The first day a card can be approved from: today plus the country's notice. As the date input wants it. */
export function earliestDay(today: string, noticeDays: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + noticeDays);
  return d.toISOString().slice(0, 10);
}

/** The instant a card is approved from: absent for the earliest the notice allows, else the start of the day chosen. */
export function approveFrom(day: string, earliest: string): string | undefined {
  if (!day || day <= earliest) return undefined;
  return new Date(`${day}T00:00:00`).toISOString();
}

/** A number typed into a price box: a figure, or 0 where nothing usable was typed. */
export function figure(text: string): number {
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
