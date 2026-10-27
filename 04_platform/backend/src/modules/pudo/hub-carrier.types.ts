import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/**
 * WHAT A HUB MOVES BAGS ON BETWEEN HUBS — its pallets, roll cages and crates (the user, 2026-09-03: "let the hub choose
 * even whether they use pallet and its dynamic dimensions or whether they use a custom size trolley"; and 2026-10-27, D11:
 * a hub's carriers go "back with the driver, or abandoned or select separate return trip").
 *
 * THE HUB'S OWN WORD, as its fee and its hours are: participants declare, the network reads. Its owner says what each kind
 * is, its size and what it may carry; staff and the hub's people change nothing in it.
 *
 * HOW MUCH ONE HOLDS IS WORKED OUT, NEVER TYPED: in parcels of size M, the lesser of its space and its rating — the same
 * measure a bag is filled in and a driver's road is paid on, so one unit survives every carrier. A number a hub typed
 * could be talked up; one worked out from a tape measure cannot.
 */
export const HUB_CARRIER_KINDS = ['pallet', 'cage', 'crate', 'other'] as const;
export type HubCarrierKind = (typeof HUB_CARRIER_KINDS)[number];

/** Most kinds a hub keeps on its list: enough for a pallet, a cage and a crate or two, never a catalogue. */
export const HUB_CARRIER_MAX_KINDS = 6;
/** The bounds of a size said in centimetres, and of a rating said in kilograms. */
export const HUB_CARRIER_CM = { min: 20, max: 300 } as const;
export const HUB_CARRIER_KG = { min: 10, max: 3000 } as const;
/** What one weighs empty, in kilograms, where the hub says: what a return job of its empties weighs. */
export const HUB_CARRIER_EMPTY_KG = { min: 1, max: 500 } as const;

/** One kind of carrier as the hub keeps it. */
export interface HubCarrier {
  carrierId: string;
  kind: HubCarrierKind;
  /** The hub's own name for it: "Euro pallet", "Blue roll cage". */
  name: string;
  /** The space a load may take up on it, in centimetres: its floor, and how high it is loaded (a pallet: the stacking height). */
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** What it may carry, in kilograms: its rating. */
  maxKg: number;
  /** What one weighs empty, where the hub said it: a return job of its empties is posted at that weight. */
  emptyKg?: number;
  saidAt: string;
  saidBy: string;
}

/** One kind of carrier as anybody reads it: as the hub said it, and what it holds, worked out. */
export class HubCarrierView {
  carrierId: string;
  @ApiProperty({ enum: HUB_CARRIER_KINDS }) kind: HubCarrierKind;
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  maxKg: number;
  @ApiPropertyOptional() emptyKg?: number;
  /** WORKED OUT: how many parcels of size M it holds — the lesser of its space and its rating, to one decimal. */
  holds: number;
  /** …and how many full bags that is. */
  bags: number;
  /** Which of the two decides what it holds: its space, or what it may carry. */
  @ApiProperty({ enum: ['space', 'weight'] }) boundBy: 'space' | 'weight';
  saidAt: string;
  saidBy: string;
}

/** A hub's carriers, and the sentence every screen that shows them says. */
export class HubCarriersView {
  mdpId: string;
  @ApiProperty({ type: [HubCarrierView] }) carriers: HubCarrierView[];
  basis: string;
}

/** One kind on the hub's list, as its owner writes it. With a `carrierId` it is that kind changed; without, a new one. */
export class HubCarrierInput {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) carrierId?: string;
  @ApiProperty({ enum: HUB_CARRIER_KINDS }) @IsIn(HUB_CARRIER_KINDS as unknown as string[]) kind: HubCarrierKind;
  @IsString() @MaxLength(40) name: string;
  @IsInt() @Min(HUB_CARRIER_CM.min) @Max(HUB_CARRIER_CM.max) lengthCm: number;
  @IsInt() @Min(HUB_CARRIER_CM.min) @Max(HUB_CARRIER_CM.max) widthCm: number;
  @IsInt() @Min(HUB_CARRIER_CM.min) @Max(HUB_CARRIER_CM.max) heightCm: number;
  @IsInt() @Min(HUB_CARRIER_KG.min) @Max(HUB_CARRIER_KG.max) maxKg: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(HUB_CARRIER_EMPTY_KG.min) @Max(HUB_CARRIER_EMPTY_KG.max) emptyKg?: number;
}

/**
 * A HUB'S CARRIERS ON A MOVE BETWEEN HUBS (the user, 2026-10-27, D11: "Back with the driver, or abandoned or select separate
 * return trip"; the return trip, "Post it as a job"). The hub whose carriers they are says, as they go with a driver, what
 * happens to them at the other hub once the bags are off:
 *  - with_driver: counted back out to the driver who brought them, on that visit;
 *  - left: left there — given up, the other hub's to keep or use; nobody brings them back;
 *  - return_job: kept aside there for a return job the owning hub posts — a load like any other, any driver can take it,
 *    and the owning hub pays it, between the two of them.
 * The other hub does what was said, and says it did. Nothing else is tracked: no pool, no exchange, no counts per hub pair.
 */
export const CARRIER_WAYS_BACK = ['with_driver', 'left', 'return_job'] as const;
export type CarrierWayBack = (typeof CARRIER_WAYS_BACK)[number];
/** Most carriers one move takes. */
export const CARRIER_MOVE_MAX = 50;

export interface CarrierMove {
  moveId: string;
  /** The hub whose carriers they are, and the hub they went to. */
  ownerMdpId: string;
  toMdpId: string;
  /** Which kind of the owner's, and its name as it was when they went. */
  carrierId: string;
  carrierName: string;
  count: number;
  /** Who carries them there. */
  driverDid: string;
  driverName?: string;
  wayBack: CarrierWayBack;
  sentAt: string;
  sentBy: string;
  /** The other hub did what was said: counted out to the driver, took them in as left, or kept them aside. */
  done?: { at: string; by: string; count: number };
  /** The return job the owning hub posted, for the ones kept aside. */
  job?: { freightId: string; code: string; postedAt: string; postedBy: string };
  /** Home: the return job delivered at the owning hub. */
  home?: { at: string };
}

/** Where a move stands, said as one word: on the way there; back with the driver; left there; kept for a job; the job on its way; home. */
export const CARRIER_MOVE_STATES = ['on_the_way', 'with_driver', 'left', 'kept', 'returning', 'home'] as const;
export type CarrierMoveState = (typeof CARRIER_MOVE_STATES)[number];

export class CarrierMoveJob {
  freightId: string;
  code: string;
  postedAt: string;
  /** The return job's own status on the board. */
  status: string;
}

export class CarrierMoveView {
  moveId: string;
  ownerMdpId: string;
  ownerName: string;
  toMdpId: string;
  toName: string;
  carrierName: string;
  count: number;
  @ApiPropertyOptional() driverName?: string;
  @ApiProperty({ enum: CARRIER_WAYS_BACK }) wayBack: CarrierWayBack;
  @ApiProperty({ enum: CARRIER_MOVE_STATES }) state: CarrierMoveState;
  sentAt: string;
  @ApiPropertyOptional() doneAt?: string;
  @ApiPropertyOptional() doneCount?: number;
  @ApiPropertyOptional({ type: CarrierMoveJob }) job?: CarrierMoveJob;
  @ApiPropertyOptional() homeAt?: string;
  /** What one weighs empty, as the owner said — what a return job is posted at. */
  @ApiPropertyOptional() emptyKg?: number;
}

/** A hub's carriers on the move: its own, away; and other hubs', come to it. */
export class CarrierMovesView {
  mdpId: string;
  @ApiProperty({ type: [CarrierMoveView] }) away: CarrierMoveView[];
  @ApiProperty({ type: [CarrierMoveView] }) here: CarrierMoveView[];
}

/** Carriers going with a driver to another hub: which, how many, where, with whom (the pass scanned), and the way back. */
export class SendCarriersDto {
  @IsString() @MaxLength(40) carrierId: string;
  @IsInt() @Min(1) @Max(CARRIER_MOVE_MAX) count: number;
  @IsString() @MaxLength(60) toMdpId: string;
  @IsString() @MinLength(2) @MaxLength(80) driverBadgeId: string;
  @ApiProperty({ enum: CARRIER_WAYS_BACK }) @IsIn(CARRIER_WAYS_BACK as unknown as string[]) wayBack: CarrierWayBack;
}

/** The other hub did what was said — with how many, where that is a count (counted out to the driver). */
export class CarriersDoneDto {
  @IsOptional() @IsInt() @Min(0) @Max(CARRIER_MOVE_MAX) count?: number;
}

/** The owning hub posts the return job for the ones kept aside: what they weigh together. */
export class CarrierReturnJobDto {
  @IsInt() @Min(1) @Max(25_000) weightKg: number;
}

/**
 * The hub's owner writes its list WHOLE: what is sent is the list. A kind sent with its id is that kind, changed; one
 * sent without is new; one left out is taken off. Said whole because it is short and read whole — a merge would leave a
 * kind nobody can see how to remove.
 */
export class SetHubCarriersDto {
  @ApiProperty({ type: [HubCarrierInput] })
  @IsArray()
  @ArrayMaxSize(HUB_CARRIER_MAX_KINDS)
  @ValidateNested({ each: true })
  @Type(() => HubCarrierInput)
  carriers: HubCarrierInput[];
}
