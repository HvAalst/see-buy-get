import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * A PERSON'S OWN DOOR, PAID FIRST BY MOBILE MONEY (the user, 2026-10-27: "Mobile money first"). A person's goods coming back
 * to them — turned round at a hub — may come to their own door as a load instead of to the shop. They are asked by M-Pesa
 * for the most they allow; once it is paid, the load is posted from the hub; the first driver whose vehicle fits takes it
 * at their own price, never above what was paid; and whatever the driver charged less goes back to the number it came
 * from. A prepayment for ONE load, never a balance: it can pay nothing else, and what it did not use leaves by itself.
 */
export const DOOR_STATES = ['awaiting', 'posted', 'taken', 'delivered', 'lapsed', 'to_shop', 'reversed'] as const;
export type DoorState = (typeof DOOR_STATES)[number];

/** One person's load to their own door — kept beside the parcel and the load, never on them. */
export interface DoorRequest {
  requestId: string;
  personDid: string;
  /** The person's goods at the hub, coming back to them. */
  parcelId: string;
  mdpId: string;
  hubName: string;
  /** The company that sells the carriage — the network's, in the country the hub is in — and its money. */
  entityId: string;
  currency: string;
  to: { lat: number; lng: number };
  label: string;
  /** What they allowed, and were asked for by mobile money. */
  maxSpend: number;
  /**
   * The number they pay from — the driver calls it at their door, and what is left goes back to it. Kept whole only until
   * nothing is owed back to it any more; the mask stays, to be recognised by.
   */
  phone: string;
  phoneMasked: string;
  fundingId?: string;
  reference?: string;
  /** What the payment rail asked of them, said as it said it — "check your phone", or a paybill and a reference. */
  instructions?: string;
  pushed?: boolean;
  state: DoorState;
  openedAt: string;
  /** Until when the box waits at the hub for the payment. */
  until: string;
  paidAt?: string;
  /** What arrived. */
  paid?: number;
  freightId?: string;
  loadCode?: string;
  /** The driver's price, gross, billed out of what was paid — once a driver took the load. */
  billed?: number;
  /** What goes back to their number: what the load did not use, or all of it where it never went. */
  owedBack?: number;
  /** The shop it would go to instead, and — sent there — the parcel taking it. */
  shopName?: string;
  shopParcelId?: string;
  remindedAt?: string;
  closedAt?: string;
}

/** What bringing it to their door would be, said before they ask — the most to allow suggested, in the hub's money. */
export class DoorPreview {
  @ApiProperty({ enum: ['door', 'no'] }) outcome!: 'door' | 'no';
  @ApiPropertyOptional() suggestedMax?: number;
  @ApiPropertyOptional() currency?: string;
  @ApiPropertyOptional() atHub?: string;
  /** How far from the hub a door may be, in kilometres. */
  @ApiPropertyOptional() maxKm?: number;
  @ApiPropertyOptional() why?: string;
}

/** Where their load to their door stands, as their Send app reads it. */
export class DoorView {
  @ApiProperty({ enum: DOOR_STATES }) state!: DoorState;
  @ApiProperty() label!: string;
  @ApiProperty() maxSpend!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() phoneMasked!: string;
  /** awaiting: pay by then, and what the payment rail asked. */
  @ApiPropertyOptional() until?: string;
  @ApiPropertyOptional() instructions?: string;
  @ApiPropertyOptional() pushed?: boolean;
  @ApiPropertyOptional() reference?: string;
  @ApiPropertyOptional() paid?: number;
  @ApiPropertyOptional() loadCode?: string;
  /** taken: what the driver charged, out of what was paid. */
  @ApiPropertyOptional() billed?: number;
  /** What goes back to their number. */
  @ApiPropertyOptional() owedBack?: number;
  /** posted, no driver yet: they may send it to the shop instead, all of it back. */
  @ApiPropertyOptional() canSendToShop?: boolean;
  @ApiPropertyOptional() shopName?: string;
  @ApiPropertyOptional() shopParcelId?: string;
}

export class DoorRequestDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  /** Their door, in words a driver can find — a street, a gate, a landmark. */
  @IsString() @MinLength(2) @MaxLength(120) label!: string;
  /** The most they allow a driver, asked for by mobile money now. */
  @IsNumber() @Min(1) maxSpend!: number;
  /** The number they pay from, which the driver calls at their door. */
  @IsString() @MinLength(7) @MaxLength(20) phone!: string;
}
