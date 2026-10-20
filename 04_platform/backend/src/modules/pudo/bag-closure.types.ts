import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A BAG CLOSED ON OUR OWN SEAL, AND RECEIVED BY IT (round 36; the user, 2026-10-20, on the ISO 28000 check: "Receiving on
 * our own seals"; "we wire in both options. we suggest coded security seals").
 *
 * A bag leaves the shop or the hub that filled it CLOSED, one of two ways: with a coded security seal — a pull-tight
 * plastic seal with its own printed number, typed in and photographed on the bag — or, without a seal, photographed
 * closed. A bag that is not closed is not loaded.
 *
 * Whoever receives it — the hub it is dropped at, the shop it is delivered to — scans it, photographs it as it arrived
 * and, on a sealed bag, reads the number off the seal: never shown it first, so the reading is worth something. A number
 * that is not the one it was closed with, a broken seal or a bag opened is reported first, under the tamper protocol: the
 * bag is held, operations told, and nobody opens it until operations has released it.
 */

export const BAG_CLOSURE_KINDS = ['seal', 'photo'] as const;
export type BagClosureKind = (typeof BAG_CLOSURE_KINDS)[number];

/** A seal number as printed: no longer than this. */
export const MAX_BAG_SEAL = 40;

/** Who closed or received it: the person, and the shop or hub they did it at. */
export interface BagParty {
  did: string;
  name: string;
  place: string;
}

export interface BagReceipt {
  at: string;
  receivedAt?: string;
  by: BagParty;
  photoRef: string;
  /** On a sealed bag: the number as read off the seal. */
  numberRead?: string;
  /** Received as it was closed — or, after a report released by operations, as it was found. */
  asClosed: boolean;
  asFound?: boolean;
}

/** One closing of one bag, kept after the bag is emptied and used again. The number is never on the bag itself. */
export interface BagClosure {
  closureId: string;
  toteId: string;
  code: string;
  kind: BagClosureKind;
  /** The coded seal's number as printed, and folded for matching. */
  number?: string;
  key?: string;
  /** The bag closed, its seal in view. */
  photoRef: string;
  /** What was in it when it was closed. */
  parcels: string[];
  closedAt: string;
  closedReceivedAt?: string;
  closedBy: BagParty;
  /** sha256 of the closing as made (everything above). The receipt is kept beside it. */
  hash: string;
  receipt?: BagReceipt;
}

/** How a bag is closed: the number on its coded seal and a photograph — or, without a seal, the photograph alone. */
export class BagClosureDto {
  /** The number printed on the coded security seal put on the bag. Absent or empty: closed without a seal. */
  @IsOptional() @IsString() @MaxLength(MAX_BAG_SEAL) seal?: string;
  /** The bag closed, its seal in view. Asked for by name when it is missing. */
  @IsOptional() @IsString() photoRef?: string;
}

/** A bag received: its photograph as it arrived; the number read off its seal; whether it is as it was closed. */
export class BagReceiptDto {
  @IsOptional() @IsString() @MaxLength(MAX_BAG_SEAL) sealNumber?: string;
  @IsOptional() @IsString() photoRef?: string;
  @IsOptional() @IsBoolean() asClosed?: boolean;
}

/** Closing a bag at the shop or hub where it stands (a shop's own bag is closed with "Close the bag"). */
export class CloseBagDto extends BagClosureDto {
  /** When it was closed, by the phone's clock: a step kept on the phone with no signal. */
  @IsOptional() @IsDateString() observedAt?: string;
}
