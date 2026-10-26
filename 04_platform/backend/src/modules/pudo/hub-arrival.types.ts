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
 * stays with the store, which is told (D9). A fee per handling unit the hub may declare (D12) is not part of this step.
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
  since: string;
  by: string;
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
  /** Who brings it, in the store's words: its own van, a carrier's name. */
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
  @ApiProperty({ type: [HubArrivalView] }) arrivals: HubArrivalView[];
}

/** A hub's word that it takes stores' parcels in bulk — or no longer does. */
export class SetHubBulkDto {
  @IsBoolean() open!: boolean;
  /** The days and hours it receives: { mon: { open: '07:00', close: '15:00' }, sun: null, … }. Null clears them. */
  @IsOptional() @IsObject() hours?: Record<string, { open: string; close: string } | null> | null;
  @IsOptional() @IsInt() @Min(1) @Max(50) doors?: number | null;
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

/** One parcel scanned off the units: its label's code — the parcel id, its tracking key, or its SSCC. */
export class ScanHubArrivalDto {
  @IsString() @MaxLength(80) code!: string;
}
