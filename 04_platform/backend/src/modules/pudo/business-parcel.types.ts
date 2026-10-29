import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { CARGO_NATURES, type CargoNature } from './cargo.types';
import type { ParcelStatus } from './pudo.types';

/** Every state a parcel can be in, for the contract (the type in pudo.types is the source). */
export const PARCEL_STATUSES: readonly ParcelStatus[] = ['Created', 'At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Unclaimed', 'Delivered', 'Disputed', 'Voided', 'Returned', 'Lost'];

/**
 * A BUSINESS'S PARCELS (the user, 2026-10-29). Billed to the business, from "A prepaid balance" it tops up like a store's;
 * sent from the Business app and from its own system; and its own place may be where a parcel is collected or delivered
 * (later steps). A parcel goes shop to shop, as every parcel does: what is new is who pays for it.
 */

class ParcelSizeDto {
  // A millimetre floor, as at a store's mint: an envelope is a parcel.
  @IsNumber() @Min(0.1) l!: number;
  @IsNumber() @Min(0.1) w!: number;
  @IsNumber() @Min(0.1) h!: number;
}

class ParcelLineDto {
  @IsString() @MaxLength(120) name!: string;
  @IsNumber() @Min(1) qty!: number;
}

/** Send one parcel: from a shop, to a shop, for somebody who collects it there. */
export class BusinessParcelDto {
  /** The shop it is handed in at. */
  @IsString() @MaxLength(120) originPudoDid!: string;
  /** The shop the receiver collects it from. */
  @IsString() @MaxLength(120) destPudoDid!: string;
  /** The person who collects it. Never sent a text by us; the code is the business's to pass on. */
  @IsString() @MaxLength(30) receiverMobile!: string;
  /** Measured, so it is priced on what it is rather than on a size band. */
  @ValidateNested() @Type(() => ParcelSizeDto) dimensionsCm!: ParcelSizeDto;
  @IsNumber() @Min(0.01) weightKg!: number;
  /** A photograph of what is inside, uploaded first: what a damage report is read against. */
  @IsString() @MaxLength(80) contentPhotoRef!: string;
  @IsOptional() @IsBoolean() fragile?: boolean;
  @IsOptional() @IsIn(CARGO_NATURES) @ApiPropertyOptional({ enum: CARGO_NATURES }) natureCode?: CargoNature;
  /** The business's own reference — an order or an invoice number. */
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  /** What the goods are worth, for the cover. */
  @IsOptional() @IsNumber() @Min(0) declaredValue?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ParcelLineDto) items?: ParcelLineDto[];
  /** `flexible` holds the most it can cost and gives back the rest on delivery; `locked` pays the cheapest route now. */
  @IsOptional() @IsIn(['flexible', 'locked']) @ApiPropertyOptional({ enum: ['flexible', 'locked'] }) routeMode?: 'flexible' | 'locked';
  /** The price shown when it was quoted. Moved since: refused with the new price, never billed silently. */
  @IsOptional() @IsNumber() @Min(0) expectedTotal?: number;
}

export class BusinessTopUpDto {
  @IsNumber() @Min(0.01) amount!: number;
  /** The phone the payment prompt goes to. Without one, a paybill and a reference are shown. */
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
}

export class BusinessCallOffDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** The company of ours that holds the balance, and in what money. */
export class ParcelAccountCompany {
  @ApiProperty() name!: string;
  @ApiProperty() currency!: string;
}

/** A payment asked for and not yet confirmed by the rail. */
export class ParcelTopUpOpen {
  @ApiProperty() reference!: string;
  @ApiProperty() amount!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() openedAt!: string;
  /** The phone was sent a prompt to approve. */
  @ApiPropertyOptional() pushed?: boolean;
  /** How to pay where no prompt was sent: a paybill and the reference to give. */
  @ApiPropertyOptional() instructions?: string;
}

/** What a top-up costs: free above an amount, a fee below it. Absent: no fee. */
export class ParcelTopUpTerms {
  @ApiPropertyOptional() freeAbove?: number;
  @ApiPropertyOptional() amount?: number;
}

/** The parcel account, or why there is none yet. */
export class BusinessParcelAccountView {
  /** It has been opened. */
  @ApiProperty() open!: boolean;
  /** Not open: whether it can be, here. False where no company of ours holds money in its country. */
  @ApiProperty() canOpen!: boolean;
  @ApiPropertyOptional() whyNot?: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) balance?: number | null;
  @ApiPropertyOptional({ type: ParcelAccountCompany }) company?: ParcelAccountCompany;
  @ApiPropertyOptional({ type: ParcelTopUpOpen }) waiting?: ParcelTopUpOpen;
  @ApiPropertyOptional({ type: ParcelTopUpTerms }) terms?: ParcelTopUpTerms;
  /** Counted over every parcel it sent, never a filtered page. */
  @ApiProperty() sent!: number;
  @ApiProperty() unpaid!: number;
  @ApiProperty() moving!: number;
}

/** A shop at one end of a parcel. */
export class ParcelEnd {
  @ApiProperty() did!: string;
  @ApiProperty() name!: string;
  @ApiProperty() zone!: string;
}

/** One parcel the business sent, as its list reads it. */
export class BusinessParcelRow {
  @ApiProperty() parcelId!: string;
  @ApiProperty({ enum: PARCEL_STATUSES }) status!: ParcelStatus;
  /** Paid from the balance; until then it has no label and no shop takes it in. */
  @ApiProperty() paid!: boolean;
  @ApiPropertyOptional() reference?: string;
  @ApiProperty() receiver!: string;
  @ApiPropertyOptional({ type: ParcelEnd }) from?: ParcelEnd;
  @ApiProperty({ type: ParcelEnd }) to!: ParcelEnd;
  @ApiProperty() size!: string;
  @ApiPropertyOptional() cost?: number;
  @ApiProperty() currency!: string;
  /** What the receiver says at the shop, for the business to pass on — while there is something to collect. */
  @ApiPropertyOptional() collectionCode?: string;
  @ApiPropertyOptional() trackingKey?: string;
  /** Who in the business sent it. */
  @ApiPropertyOptional() sentBy?: string;
  @ApiProperty() createdAt!: string;
  /** Called off at a hub: the parcel bringing it back. */
  @ApiPropertyOptional() returnParcelId?: string;
}

export class BusinessParcelList {
  @ApiProperty({ type: [BusinessParcelRow] }) items!: BusinessParcelRow[];
  @ApiProperty() total!: number;
}

/** One step of its journey. */
export class ParcelStep {
  @ApiProperty() at!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() note?: string;
}

/** One parcel, opened: the row, and what it was charged and where it has been. */
export class BusinessParcelDetail extends BusinessParcelRow {
  @ApiPropertyOptional() weightKg?: number;
  @ApiPropertyOptional() fragile?: boolean;
  @ApiPropertyOptional() routeMode?: string;
  /** The platform fee inside the cost — one line, never what it is made of. */
  @ApiPropertyOptional() platformFee?: number;
  @ApiPropertyOptional() tax?: number;
  @ApiPropertyOptional() taxLabel?: string;
  @ApiPropertyOptional() declaredValue?: number;
  @ApiPropertyOptional() coverLimit?: number;
  @ApiProperty({ type: [ParcelStep] }) steps!: ParcelStep[];
}

/** Sent: the parcel, whether the balance paid for it, and what that left. */
export class BusinessParcelSent {
  @ApiProperty({ type: BusinessParcelDetail }) parcel!: BusinessParcelDetail;
  @ApiProperty() paid!: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true }) balance?: number | null;
}

/** A test key's send: every check run and the price worked out — nothing made, nothing paid. */
export class BusinessParcelTrial {
  @ApiProperty() test!: boolean;
  @ApiProperty() price!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: ['flexible', 'locked'] }) routeMode!: string;
  @ApiProperty() size!: string;
  /** Whether the balance would pay for it today. */
  @ApiProperty() covered!: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true }) balance?: number | null;
}

/** Its label, to print: the picture, and what the QR on it says. */
export class BusinessParcelLabel {
  @ApiProperty() parcelId!: string;
  @ApiProperty() svg!: string;
  @ApiProperty() qrPayload!: string;
}

/** One line of the parcel account's book. */
export class ParcelBookLine {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty({ enum: ['+', '-'] }) sign!: '+' | '-';
  @ApiProperty() amount!: number;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional() parcelId?: string;
  @ApiPropertyOptional() note?: string;
  @ApiProperty() at!: string;
}

export class ParcelBook {
  @ApiProperty({ type: [ParcelBookLine] }) items!: ParcelBookLine[];
  @ApiProperty() total!: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) balance?: number | null;
}

/** What calling a parcel off would do now, or did. */
export class BusinessCallOffView {
  @ApiProperty() parcelId!: string;
  /** `refund` withdrawn with its money back · `bring_back` back to the shop it was handed in at, at a price · `none` it cannot be. */
  @ApiProperty({ enum: ['refund', 'bring_back', 'pick', 'to_door', 'no'] }) outcome!: string;
  @ApiPropertyOptional() amount?: number;
  @ApiPropertyOptional() currency?: string;
  @ApiPropertyOptional() backTo?: string;
  @ApiPropertyOptional() why?: string;
  @ApiPropertyOptional() done?: boolean;
}

/** Who in a business sent one of its parcels — kept apart from the parcel, which travels (lesson: a record that travels). */
export interface ParcelSender {
  parcelId: string;
  entityId: string;
  personDid: string;
  name: string;
  at: string;
}
