import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A COUNTRY'S PRICE CARD (2026-11-08 — zone pricing, step 2; the owner: "follow your recommendations").
 *
 * What a parcel costs between two zones, set by the country's company and nobody else, in its own money:
 * - BANDS: how far apart two zones are, by the zones that lie between them and by the km between them (the higher counts),
 *   with exceptions for single pairs;
 * - a TABLE of prices per band and weight step, and a price per kg above the last step;
 * - a CHARGE for the group of each end's zone (a remote end costs more), or for a zone priced on its own;
 * - SURCHARGES with names: delivery to a door, an oversize parcel, a fragile one;
 * - the WEIGHT RULES: the size divisor per service, the step weights round up to, the most a parcel may weigh;
 * - a MINIMUM and the cash STEP a consumer price is rounded to.
 *
 * The two shops' own fees, our fee and the tax are NOT on the card: they are added to the card's price as they are today.
 * A card names the zone map it was made with, so a zone edited later never moves a price made from it.
 *
 * Its life: a draft → ready → (filed with the regulator, and cleared by it, where the country says its regulator requires
 * that) → approved by a second person, from a date at least the country's notice days ahead → in force on that date.
 */

export class PriceBand {
  key: string;
  name: string;
  /** The most zones that may lie between the two zones for a pair to be in this band; null on the last band. */
  @ApiPropertyOptional({ type: Number, nullable: true })
  maxZones: number | null;
  /** The most km between the two zones' centres for this band; null on the last band. */
  @ApiPropertyOptional({ type: Number, nullable: true })
  maxKm: number | null;
}

export class EndCharge {
  perParcel: number;
  perKg: number;
}

export class PriceWeightRules {
  /** cm³ per kg, handed in and collected at shops. */
  divisorShop: number;
  /** cm³ per kg, taken to a door. */
  divisorDoor: number;
  /** Billable weight is rounded up to a multiple of this. */
  stepKg: number;
  /** The most a parcel may weigh, billable. */
  maxKg: number;
  /** Below this weight the volume is not counted (a small light parcel is charged what it weighs). 0: always counted. */
  volumeFromKg: number;
}

export class PricePair {
  a: string;
  b: string;
  band: string;
}

export class PriceSurcharges {
  /** Taken to a door rather than collected at a shop: per parcel. */
  door: number;
  /** A parcel whose longest side is over `oversizeCm`: per parcel. */
  oversize: number;
  oversizeCm: number;
  /** A parcel marked fragile: per parcel. */
  fragile: number;
}

/** What may be changed on a draft: the whole card, every time. */
export interface PriceCardTerms {
  bands: PriceBand[];
  steps: number[];
  /** band key → a price for each step. */
  table: Record<string, number[]>;
  /** band key → the price of each kg above the last step. */
  perExtraKg: Record<string, number>;
  /** group key → the charge for an end in that group. */
  groupCharges: Record<string, EndCharge>;
  /** zone code → its own charge, instead of its group's. */
  zoneCharges: Record<string, EndCharge>;
  pairs: PricePair[];
  weight: PriceWeightRules;
  surcharges: PriceSurcharges;
  minimum: number;
  /** A consumer price, tax included, is rounded to this; 0: not rounded. */
  cashStep: number;
}

export interface StoredPriceCard extends PriceCardTerms {
  version: number;
  status: 'draft' | 'ready' | 'filed' | 'cleared' | 'approved' | 'withdrawn';
  zoneMapVersion: number;
  currency: string;
  createdAt: string;
  createdBy: string;
  readyAt?: string;
  readyBy?: string;
  /** The account that made it ready: who may not approve it. Never a name — two people are told apart by their accounts. */
  readyById?: string;
  filedAt?: string;
  filedBy?: string;
  filedRef?: string;
  clearedAt?: string;
  clearedBy?: string;
  clearedRef?: string;
  approvedAt?: string;
  approvedBy?: string;
  effectiveFrom?: string;
  withdrawnAt?: string;
  withdrawnBy?: string;
}

export interface PriceCardSettings {
  /** Its regulator must have every price change filed with it and cleared before use (the country says so; never assumed). */
  filingRequired: boolean;
  /** How many days ahead a new card must be approved before it is in force. */
  noticeDays: number;
}

export interface StoredPriceCards {
  entityId: string;
  settings: PriceCardSettings;
  cards: StoredPriceCard[];
}

/* ------------------------------------------------------------------ views -- */

export class PriceCardSettingsView {
  filingRequired: boolean;
  noticeDays: number;
}

export class PriceCardView {
  version: number;
  /** draft · ready · filed · cleared · approved (from a date to come: scheduled) · in_force · past · withdrawn. */
  @ApiProperty({ enum: ['draft', 'ready', 'filed', 'cleared', 'scheduled', 'in_force', 'past', 'withdrawn'] })
  status: 'draft' | 'ready' | 'filed' | 'cleared' | 'scheduled' | 'in_force' | 'past' | 'withdrawn';
  zoneMapVersion: number;
  currency: string;
  @ApiProperty({ type: [PriceBand] })
  bands: PriceBand[];
  @ApiProperty({ type: [Number] })
  steps: number[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'array', items: { type: 'number' } } })
  table: Record<string, number[]>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  perExtraKg: Record<string, number>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'object', properties: { perParcel: { type: 'number' }, perKg: { type: 'number' } } } })
  groupCharges: Record<string, EndCharge>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'object', properties: { perParcel: { type: 'number' }, perKg: { type: 'number' } } } })
  zoneCharges: Record<string, EndCharge>;
  @ApiProperty({ type: [PricePair] })
  pairs: PricePair[];
  weight: PriceWeightRules;
  surcharges: PriceSurcharges;
  minimum: number;
  cashStep: number;
  createdAt: string;
  createdBy: string;
  @ApiPropertyOptional() readyBy?: string;
  @ApiPropertyOptional() filedRef?: string;
  @ApiPropertyOptional() filedBy?: string;
  @ApiPropertyOptional() clearedRef?: string;
  @ApiPropertyOptional() clearedBy?: string;
  @ApiPropertyOptional() approvedBy?: string;
  @ApiPropertyOptional() approvedAt?: string;
  @ApiPropertyOptional() effectiveFrom?: string;
  @ApiPropertyOptional() withdrawnBy?: string;
  /** What stops it going on: each problem in words. Empty when nothing does. */
  @ApiProperty({ type: [String] })
  problems: string[];
}

/** One cell's estimated cost beside its price — at the country's own starting figures, said as an estimate. */
export class PriceCostCell {
  band: string;
  stepKg: number;
  price: number;
  cost: number;
}

export class PriceCardsView {
  entityId: string;
  currency: string;
  settings: PriceCardSettingsView;
  /** The zone maps a card can be made with: the published versions. */
  @ApiProperty({ type: [Number] })
  zoneMaps: number[];
  @ApiPropertyOptional({ type: PriceCardView })
  inForce?: PriceCardView;
  @ApiProperty({ type: [PriceCardView] })
  pending: PriceCardView[];
  @ApiProperty({ type: [PriceCardView] })
  history: PriceCardView[];
  /** The card being worked on, ready or on its way: its estimated cost per cell. */
  @ApiProperty({ type: [PriceCostCell] })
  costs: PriceCostCell[];
}

/** A price worked out from a card, line by line — the console's "try a price", and what a parcel will keep. */
export class ZonePriceLine {
  key: string;
  label: string;
  amount: number;
}

export class ZonePrice {
  version: number;
  zoneMapVersion: number;
  currency: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  band: string;
  bandName: string;
  zonesCrossed: number;
  km: number;
  billableKg: number;
  /** What set the billable weight: what it weighs, or how big it is. */
  @ApiProperty({ enum: ['weight', 'size'] })
  by: 'weight' | 'size';
  @ApiProperty({ type: [ZonePriceLine] })
  lines: ZonePriceLine[];
  /** The card's price for the journey: the table, the ends, the surcharges — at least the minimum. Before shop fees, our fee and tax. */
  amount: number;
  /**
   * 2026-11-08 — what carrying this journey is planned to cost, where a quote priced a real journey (step 4's report): the
   * road at the cheapest carrier that can take it, the hubs' own fees on the way, and its share of each leg's bag loading.
   */
  plannedCost?: number;
}
