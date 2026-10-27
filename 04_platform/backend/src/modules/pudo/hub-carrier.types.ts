import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

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
