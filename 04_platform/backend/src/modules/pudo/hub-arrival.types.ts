import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { SiteWeek } from './fleet-site.types';
import { GeoPoint } from './pudo.types';
import { HubOpenNow } from './hub-contact.types';

/**
 * INBOUND SUPPLY, READING B (assessment.html D1–D14; the user, 2026-10-25: "Yes, A then B") — A HUB AS A CROSS-DOCK.
 *
 * A store hands its parcels in at one of our hubs in bulk — on a pallet, in cartons, a cage — instead of one by one at a
 * shop's counter or in bags from its own dock. The hub says it takes parcels in bulk, and when (D8: declared days, hours
 * and doors; booked slots later). A store's parcel handed in there is priced from the hub, which works it from there:
 * no first road leg, no shop — fees follow custody. The store books the arrival: which parcels, how many handling units,
 * which day on the hub's own clock (D4: the receiver's expectation, with no load behind it where the store brings it
 * itself; D5: handling units, never item lines; D10: the hub's clock). At its door the hub counts the units, then scans
 * each parcel off them: the store parts with it and the hub answers for it (custody). What was booked and is not on it
 * stays with the store, which is told (D9).
 *
 * THE RECEIVING FEE (D12): a hub may charge per unit it takes in — its own fee for each kind, in its own money, as its sort
 * fee is its own (the user, 2026-10-26: "Its own fee"). The store pays for the units it books when it books them, sold by
 * its own company with that company's fee on top and tax, as a parcel is; the hub is paid its own fee at its door for the
 * units it counts. Units booked and not counted go back to the store; units beyond the booking are charged at the door,
 * or not taken in.
 */

export const HUB_UNIT_KINDS = ['pallet', 'carton', 'cage', 'sack'] as const;
export type HubUnitKind = (typeof HUB_UNIT_KINDS)[number];

/** `missed`: its day went by on the hub's clock and nothing came — the hub said so, and its parcels are the store's to book again. */
export const HUB_ARRIVAL_STATES = ['expected', 'receiving', 'received', 'withdrawn', 'missed'] as const;
export type HubArrivalState = (typeof HUB_ARRIVAL_STATES)[number];

/** How far ahead a store may book an arrival: a month. */
export const HUB_ARRIVAL_DAYS_AHEAD = 30;
/** The most parcels one arrival may carry, and the most handling units. */
export const HUB_ARRIVAL_MAX_PARCELS = 500;
export const HUB_ARRIVAL_MAX_UNITS = 100;

/** A hub's own word that it takes stores' parcels in bulk — kept by the hub, read by the stores choosing it. */
export interface HubBulk {
  mdpId: string;
  hours?: SiteWeek;
  doors?: number;
  /** What it charges to take in one unit of each kind, in its own money (D12). A kind left out costs nothing. */
  fees?: Partial<Record<HubUnitKind, number>>;
  since: string;
  by: string;
}

/**
 * THE RECEIVING FEE ON AN ARRIVAL (D12), locked when it was booked: the hub's own fee for one unit of its kind, in the
 * hub's money, and one unit as the store pays for it, in the store's money — the hub's fee converted, the network's fee
 * on top, the tax. Every charge and every return is so many of these units, so they add up to the cent.
 */
export interface HubArrivalFee {
  perUnit: number;
  currency: string;
  unit: { currency: string; gross: number; tax: number; buffer: number; provision: number };
  /** Paid by the store for the units it booked, when it booked them. */
  charged: { units: number; amount: number; at: string };
  /** Charged at the door for units beyond the booking. */
  extra?: { units: number; amount: number; at: string };
  /** Given back to the store: booked units the hub did not count — or all of them, where nothing came or it was withdrawn. */
  refunded?: { units: number; amount: number; at: string };
  /** The hub's pay for the units it counted at its door, in its own money. */
  paid?: { units: number; amount: number; at: string };
}

/** An arrival at a hub, as the store booked it and the hub took it in. */
export interface HubArrival {
  arrivalId: string;
  mdpId: string;
  vendorId: string;
  /** What the store says is on it. */
  parcelIds: string[];
  units: { kind: HubUnitKind; count: number };
  /** The day it is to come, on the hub's own clock. */
  expectedOn: string;
  reference?: string;
  /** Who brings it, in the store's words: its own people, a carrier's name. */
  bringer?: string;
  state: HubArrivalState;
  createdAt: string;
  createdBy: string;
  /** At the hub's door: how many units came, who took them in, a line of their words. */
  received?: { at: string; by: string; units: number; note?: string };
  /** The parcels scanned off it, in the order they were. */
  scanned: string[];
  /** Scanning finished: what was booked and did not come — still the store's. */
  finished?: { at: string; by: string; missing: string[] };
  withdrawn?: { at: string; by: string };
  /** The hub said it did not come, once its day was over. */
  missed?: { at: string; by: string };
  /** The hub's receiving fee on it (D12). Absent: the hub charges nothing for its kind of unit. */
  fee?: HubArrivalFee;
  /**
   * D11 — THE EMPTIES, BACK WITH WHOEVER BROUGHT THEM (the user, 2026-10-26; 2026-10-27, no van presumed): how many of the
   * store's pallets, cages or sacks the hub counted out at its door, once they were unloaded. Nothing more is tracked.
   */
  emptiesBack?: { units: number; at: string; by: string };
}

/** What a hub charges to take in one unit of each kind, in its own money (D12). */
export class HubUnitFees {
  @ApiPropertyOptional() pallet?: number;
  @ApiPropertyOptional() carton?: number;
  @ApiPropertyOptional() cage?: number;
  @ApiPropertyOptional() sack?: number;
}

/** One unit as a store pays for it, in its own money: the hub's fee with the network's fee and tax. */
export class HubUnitPrice {
  gross: number;
  currency: string;
}

/** For a store: one unit of each kind as it pays for it. Booking n units charges n times this. */
export class HubUnitPrices {
  @ApiPropertyOptional({ type: HubUnitPrice }) pallet?: HubUnitPrice;
  @ApiPropertyOptional({ type: HubUnitPrice }) carton?: HubUnitPrice;
  @ApiPropertyOptional({ type: HubUnitPrice }) cage?: HubUnitPrice;
  @ApiPropertyOptional({ type: HubUnitPrice }) sack?: HubUnitPrice;
}

/** A hub that takes stores' parcels in bulk: where, when, and at how many doors. */
export class HubBulkView {
  mdpId: string;
  name: string;
  @ApiProperty({ type: GeoPoint }) location: GeoPoint;
  @ApiPropertyOptional() address?: string;
  /** The days and hours it receives, on its own clock. Absent: whenever it is working. */
  @ApiPropertyOptional({ type: SiteWeek }) hours?: SiteWeek;
  /** How many trucks it takes at once. Absent: not said. */
  @ApiPropertyOptional() doors?: number;
  /** Its clock, and the name of it: Africa/Nairobi, "East Africa Time". Absent: a country of several clocks. */
  @ApiPropertyOptional() zone?: string;
  @ApiPropertyOptional() zoneName?: string;
  since: string;
  /** When it is open, Sunday to Saturday — what "whenever it is working" means where it set no hours for bulk. */
  @ApiPropertyOptional({ type: SiteWeek }) openingHours?: SiteWeek;
  @ApiPropertyOptional({ type: HubOpenNow }) openNow?: HubOpenNow;
  /** How a store bringing it parcels reaches it: its number (a call button, never printed), who to ask for, its gate. */
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() askFor?: string;
  @ApiPropertyOptional() gate?: string;
  @ApiPropertyOptional() handle?: string;
  /** What it charges to take in one unit of each kind, in its own money (D12) — public, as its sort fee is. Absent: nothing. */
  @ApiPropertyOptional({ type: HubUnitFees }) fees?: HubUnitFees;
  @ApiPropertyOptional() feeCurrency?: string;
  /** Read by a store: one unit of each kind as the store pays for it, in its own money. */
  @ApiPropertyOptional({ type: HubUnitPrices }) receiving?: HubUnitPrices;
}

/** A hub a store may hand this parcel in at, priced from there — the price the mint will charge — or why not. */
export class HubOption extends HubBulkView {
  /** The quote, as a shop's is shown: the price of this parcel handed in here. */
  @ApiPropertyOptional({ type: Object }) quote?: unknown;
  @ApiPropertyOptional() error?: string;
}

export class HubOptions {
  @ApiProperty({ type: [HubOption] }) hubs: HubOption[];
}

/** One parcel on an arrival: enough to find it on the pallet and sort it — never the buyer. */
export class HubArrivalParcel {
  parcelId: string;
  @ApiPropertyOptional() trackingKey?: string;
  @ApiPropertyOptional() sscc?: string;
  /** The shop it goes to. */
  destination: string;
  scanned: boolean;
  /** The store withdrew it after booking: it is not coming. */
  @ApiPropertyOptional() withdrawn?: boolean;
}

/** At the hub's door: how many units came, who took them in, and a line of their words. */
export class HubArrivalReceived {
  at: string;
  by: string;
  units: number;
  @ApiPropertyOptional() note?: string;
}

/** Scanning finished: when, by whom, and what was booked and did not come — still the store's. */
export class HubArrivalFinished {
  at: string;
  by: string;
  missing: string[];
}

/** The store withdrew it before the hub took it in. */
export class HubArrivalWithdrawn {
  at: string;
  by: string;
}

/** Its day went by and nothing came: when the hub said so, and who. */
export class HubArrivalMissed {
  at: string;
  by: string;
}

/** D11 — the store's empties counted out at the hub's door, to whoever brought them: how many, when, by whom. */
export class HubArrivalEmpties {
  units: number;
  at: string;
  by: string;
}

/**
 * The receiving fee on an arrival as its reader may read it (D12): the hub's own fee for one unit, public; to the store,
 * what it paid, in its own money; to the hub, what it is paid for what it counted, in its own.
 */
export class HubArrivalFeeView {
  perUnit: number;
  currency: string;
  @ApiPropertyOptional() storeCurrency?: string;
  /** One unit as the store pays for it. */
  @ApiPropertyOptional() unitGross?: number;
  /** Paid for the booked units when the store booked them. */
  @ApiPropertyOptional() charged?: number;
  @ApiPropertyOptional() chargedUnits?: number;
  /** Charged at the door for units beyond the booking. */
  @ApiPropertyOptional() extra?: number;
  @ApiPropertyOptional() extraUnits?: number;
  /** Given back: booked units the hub did not count, or all of them. */
  @ApiPropertyOptional() refunded?: number;
  @ApiPropertyOptional() refundedUnits?: number;
  /** To the hub: what it is paid for the units it counted, in its own money. */
  @ApiPropertyOptional() paid?: number;
  @ApiPropertyOptional() paidUnits?: number;
}

export class HubArrivalView {
  arrivalId: string;
  mdpId: string;
  hubName: string;
  vendorId: string;
  storeName: string;
  @ApiProperty({ type: [HubArrivalParcel] }) parcels: HubArrivalParcel[];
  @ApiProperty({ enum: HUB_UNIT_KINDS }) unitKind: HubUnitKind;
  units: number;
  expectedOn: string;
  @ApiPropertyOptional() reference?: string;
  @ApiPropertyOptional() bringer?: string;
  @ApiProperty({ enum: HUB_ARRIVAL_STATES }) state: HubArrivalState;
  createdAt: string;
  @ApiPropertyOptional({ type: HubArrivalReceived }) received?: HubArrivalReceived;
  scannedCount: number;
  @ApiPropertyOptional({ type: HubArrivalFinished }) finished?: HubArrivalFinished;
  @ApiPropertyOptional({ type: HubArrivalWithdrawn }) withdrawn?: HubArrivalWithdrawn;
  @ApiPropertyOptional({ type: HubArrivalMissed }) missed?: HubArrivalMissed;
  /** The hub's receiving fee on it (D12), as this reader may read it. Absent: none for its kind of unit. */
  @ApiPropertyOptional({ type: HubArrivalFeeView }) fee?: HubArrivalFeeView;
  /** D11 — the empties counted out at the door, to whoever brought them. Absent: not counted out yet. */
  @ApiPropertyOptional({ type: HubArrivalEmpties }) emptiesBack?: HubArrivalEmpties;
  /** On the hub's own clock (D10): it is expected today there, or its day has gone and it has not come. */
  @ApiPropertyOptional() today?: boolean;
  @ApiPropertyOptional() late?: boolean;
}

/** A store's parcels booked to be handed in at a hub and not yet on an arrival: what it can book next. */
export class HubWaiting {
  mdpId: string;
  hubName: string;
  /** When the hub receives, on its clock — what the store books against. Absent: it no longer takes parcels in bulk. */
  @ApiPropertyOptional({ type: HubBulkView }) bulk?: HubBulkView;
  @ApiProperty({ type: [HubArrivalParcel] }) parcels: HubArrivalParcel[];
}

/** One parcel scanned off the units: which, where it goes next, and whether it had been scanned already. */
export class HubArrivalScan {
  @ApiProperty({ type: HubArrivalView }) arrival: HubArrivalView;
  parcelId: string;
  /** The shop it goes to, as the hub sorts it. */
  destination: string;
  /** Scanned before: nothing changed. */
  already: boolean;
}

export class StoreHubArrivals {
  @ApiProperty({ type: [HubWaiting] }) waiting: HubWaiting[];
  @ApiProperty({ type: [HubArrivalView] }) arrivals: HubArrivalView[];
}

export class HubArrivals {
  /** Whether this hub takes stores' parcels in bulk now, and when. Absent: it does not. */
  @ApiPropertyOptional({ type: HubBulkView }) bulk?: HubBulkView;
  /** When the hub is open, Sunday to Saturday (its own entry): the hours it takes parcels in bulk start from them. */
  @ApiPropertyOptional({ type: SiteWeek }) openingHours?: SiteWeek;
  @ApiProperty({ type: [HubArrivalView] }) arrivals: HubArrivalView[];
}

/** A hub's word that it takes stores' parcels in bulk — or no longer does. */
export class SetHubBulkDto {
  @IsBoolean() open!: boolean;
  /** The days and hours it receives: { mon: { open: '07:00', close: '15:00' }, sun: null, … }. Null clears them. */
  @IsOptional() @IsObject() hours?: Record<string, { open: string; close: string } | null> | null;
  @IsOptional() @IsInt() @Min(1) @Max(50) doors?: number | null;
  /** What it charges to take in one unit of each kind, in its own money: { pallet: 150, carton: 20 }. Null clears them. */
  @IsOptional() @IsObject() fees?: Record<string, number | null> | null;
}

/** A store books the hand-in of its parcels at a hub. */
export class BookHubArrivalDto {
  @IsString() @MaxLength(64) mdpId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(HUB_ARRIVAL_MAX_PARCELS) @IsString({ each: true }) parcelIds!: string[];
  @ApiProperty({ enum: HUB_UNIT_KINDS }) @IsIn(HUB_UNIT_KINDS) unitKind!: HubUnitKind;
  @IsInt() @Min(1) @Max(HUB_ARRIVAL_MAX_UNITS) units!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedOn!: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @IsString() @MaxLength(80) bringer?: string;
}

/** At the hub's door: how many units came, and a line of the hub's words. */
export class ReceiveHubArrivalDto {
  @IsInt() @Min(1) @Max(HUB_ARRIVAL_MAX_UNITS) units!: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/** D11 — the store's empties counted out at the door, to whoever brought them: none, up to as many as came. */
export class EmptiesBackDto {
  @IsInt() @Min(0) @Max(HUB_ARRIVAL_MAX_UNITS) units!: number;
}

/** One parcel scanned off the units: its label's code — the parcel id, its tracking key, or its SSCC. */
export class ScanHubArrivalDto {
  @IsString() @MaxLength(80) code!: string;
}
