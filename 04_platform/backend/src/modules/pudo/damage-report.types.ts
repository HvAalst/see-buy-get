import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CustodyKind, DisputeOrigin } from './pudo.types';

/*
 * THE DAMAGE CLAIM REPORT — what a reported problem ends in, everywhere.
 *
 * The user, 2026-10-12, asked whether an award should take two members of staff: "I wonder whether that is our
 * jurisdiction. We are better off with a disclaimer that we facilitate the efficiency of the logistics chain and that
 * we hand over a report of the parcel mint, the finger print and it's related documents to an insurer of the
 * claimants choice, to the claimant themselves or one set by the vendor according to their shipping policy. Sort of a
 * damage claim report."
 *
 * So the network does not judge. What it has, and nobody else does, is the record: the parcel as it was made, every
 * hand it passed through and when, the photographs taken on the way, and the fingerprint of each step. The report is
 * that record, FROZEN as it stood when the problem was reported, with a fingerprint of its own — so the copy an
 * insurer holds and the copy a claimant holds can be compared, and neither can have been changed since.
 *
 * It is made for EVERY reported problem and no company can switch it off. Whether a company of ours also pays from
 * its own books is that company's choice, and a different thing (ParcelService.resolveDispute).
 */

/** The words the report is handed over with. Printed on it, and part of what its fingerprint covers. */
export const DAMAGE_REPORT_STATEMENT =
  'SeeBuyGet facilitates the logistics chain: it records every hand a parcel passes through, and it does not judge a claim for damage or loss. ' +
  'This report hands over that record — the parcel as it was made, its fingerprint and the documents that belong to it — as it stood when the problem was reported. ' +
  'It is for the claimant, for an insurer of the claimant’s choice, or for the insurer a store names in its shipping policy. ' +
  'It decides nothing about who is at fault and it offers no payment.';

/** Who held the parcel, named as who the network CONTRACTS with: a shop's trading name, a fleet's company — never one of a fleet's drivers. */
export class DamageReportHolder {
  @ApiProperty({ enum: ['sender', 'shop', 'driver', 'hub', 'receiver'] }) kind: CustodyKind;
  name: string;
}

/** One stretch of time in one party's hands. `to` is absent on the hands it was in when the problem was reported. */
export class DamageReportLeg {
  @ApiProperty({ type: DamageReportHolder }) holder: DamageReportHolder;
  from: string;
  @ApiPropertyOptional() to?: string;
  @ApiPropertyOptional() note?: string;
}

/** One recorded step, with the fingerprint it was anchored under when it happened. */
export class DamageReportEvent {
  at: string;
  status: string;
  note: string;
  @ApiPropertyOptional() fingerprint?: string;
}

/** A photograph that belongs to the parcel. `mediaId` absent where only a reference was recorded and no picture is held. */
export class DamageReportPhoto {
  /** drop_off · contents · handed_over · received · problem */
  what: string;
  reference: string;
  @ApiPropertyOptional() mediaId?: string;
  @ApiPropertyOptional() takenAt?: string;
  @ApiPropertyOptional() sha256?: string;
}

export class DamageReportParcel {
  parcelId: string;
  /** The shipment's own identity in the network: the same from the moment it was made. */
  @ApiPropertyOptional() shipmentId?: string;
  /** store — a store's order · counter — handed in at a shop · app — sent from somebody's phone. */
  through: string;
  @ApiPropertyOptional() store?: string;
  @ApiPropertyOptional() orderNumber?: string;
  madeAt: string;
  from: string;
  to: string;
  size: string;
  fragile: boolean;
  @ApiPropertyOptional({ type: [String] }) contents?: string[];
  /** What the goods were said to be worth when the parcel was made. Recorded, whether or not anything covers it. */
  @ApiPropertyOptional() declaredValue?: number;
  currency: string;
}

/** What was said about cover before the goods were accepted — the terms the parcel travelled under. */
export class DamageReportTerms {
  /** ours — a company of the network answers · theirs — the carrier's promise · none — nobody's. */
  promise: string;
  @ApiPropertyOptional() company?: string;
  /** What that company pays from its own books at most. Zero where it has stated no cover: it pays nothing itself. */
  coverLimit: number;
  currency: string;
}

export class DamageReportProblem {
  @ApiProperty({ enum: ['counter', 'buyer'] }) origin: DisputeOrigin;
  reportedAt: string;
  /** In the words of whoever reported it. */
  reason: string;
  /** Where the parcel was when it was reported: still on a shelf, or already handed over. */
  parcelWas: string;
  /** In whose hands it was at that moment, where it was in anybody's. */
  @ApiPropertyOptional({ type: DamageReportHolder }) heldBy?: DamageReportHolder;
  /** The shop that reported it, when it was reported at a counter. */
  @ApiPropertyOptional() shop?: string;
}

/** Everything the report says. Frozen: built once, when the problem is reported, from the record as it stood then. */
export class DamageReportBody {
  number: string;
  statement: string;
  @ApiProperty({ type: DamageReportParcel }) parcel: DamageReportParcel;
  @ApiProperty({ type: DamageReportTerms }) terms: DamageReportTerms;
  @ApiProperty({ type: DamageReportProblem }) problem: DamageReportProblem;
  @ApiProperty({ type: [DamageReportLeg] }) custody: DamageReportLeg[];
  @ApiProperty({ type: [DamageReportEvent] }) events: DamageReportEvent[];
  @ApiProperty({ type: [DamageReportPhoto] }) photographs: DamageReportPhoto[];
}

/** Where a report was emailed, as a link, the moment it was made: the insurer the store names on its shipping policy. */
/**
 * Printed on every note added after the parcel was handed over, and part of what that note's own fingerprint covers.
 * The user, 2026-10-15: "the damage claim is static after the handover to the consumer, because that is when the
 * logistics responsibility ended. However there is a chance that the minter did not take good care of the goods inside
 * a packaging and these got damaged inside a good looking packaging; they can be added as notes on the original report
 * and it is outside sbg's jurisdiction."
 */
export const NOTE_STATEMENT =
  'Added by the receiver after the parcel was handed over to them. The report above is the record as it stood when the problem was reported, and it does not change. ' +
  'What is found afterwards inside packaging that arrived whole is outside SeeBuyGet’s jurisdiction: how the goods were packed is for the sender to answer.';

/** A note added after handover: dated, with its own fingerprint, beside the report and never inside it. */
export class DamageReportNote {
  noteId: string;
  at: string;
  /** Who wrote it: the receiver, whose goods they are, and who is the one to open the parcel. */
  @ApiProperty({ enum: ['receiver'] }) by: 'receiver';
  text: string;
  @ApiProperty({ type: [DamageReportPhoto] }) photographs: DamageReportPhoto[];
  statement: string;
  /** SHA-256 over this note, keys sorted, without this field. The report's own fingerprint is untouched by it. */
  sha256: string;
}

/** A note, as the receiver writes it. */
export class AddDamageReportNoteDto {
  @IsString() @MinLength(1) @MaxLength(2000) text: string;
  /** Up to four of their own photographs of what they found. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) photoRefs?: string[];
}

export class DamageReportSentTo {
  /** The insurer's name, as the store wrote it. */
  insurer: string;
  /** The address, masked. */
  sentTo: string;
  at: string;
}

/** The report as it is kept and as it is read: what it says, when it was made, and the fingerprint of what it says. */
export class DamageReportView {
  parcelId: string;
  madeAt: string;
  /** SHA-256 over the body, keys sorted. Two copies with the same fingerprint say the same thing. */
  sha256: string;
  @ApiProperty({ type: DamageReportBody }) body: DamageReportBody;
  /** Beside the body, not in it: the fingerprint covers what the report SAYS, and where a copy went is not part of that. */
  @ApiPropertyOptional({ type: DamageReportSentTo }) insurer?: DamageReportSentTo;
  /** What the receiver found after handover, oldest first — beside the body, each with a fingerprint of its own. */
  @ApiPropertyOptional({ type: [DamageReportNote] }) notes?: DamageReportNote[];
}

/** A row of the list staff read: every problem reported, newest first. Nothing in it is decided by them. */
export class DamageReportRow {
  parcelId: string;
  number: string;
  madeAt: string;
  @ApiProperty({ enum: ['counter', 'buyer'] }) origin: DisputeOrigin;
  reason: string;
  from: string;
  to: string;
  @ApiPropertyOptional() store?: string;
  @ApiPropertyOptional() heldBy?: string;
  /** How many links to it are working, and how often the file was taken with one. */
  links: number;
  opened: number;
  /** Where it was emailed the moment it was made, where the store names an insurer. */
  @ApiPropertyOptional({ type: DamageReportSentTo }) insurer?: DamageReportSentTo;
  /** Notes the receiver added after handover. */
  @ApiPropertyOptional() notes?: number;
}

export class DamageReportList {
  @ApiProperty({ type: [DamageReportRow] }) items: DamageReportRow[];
}

/* ------------------------------------------------------------------ links -- */

/** As for a consignment note (document-link.types.ts): `gone` is left out, a report is kept as long as its parcel. */
export const REPORT_LINK_STATES = ['ready', 'expired', 'cancelled', 'used_up'] as const;
export type ReportLinkState = (typeof REPORT_LINK_STATES)[number];

/** The key itself, as the page opened from the link sends it. In the body, never in an address. */
export class DamageReportTokenDto {
  @IsString() @MinLength(20) @MaxLength(100) token: string;
}

/** What a link is, said to whoever holds it before they take the file. Only a link that still opens says what it opens. */
export class DamageReportLinkView {
  @ApiProperty({ enum: REPORT_LINK_STATES }) state: ReportLinkState;
  expiresAt: string;
  @ApiPropertyOptional() number?: string;
  @ApiPropertyOptional() parcelId?: string;
  @ApiPropertyOptional() from?: string;
  @ApiPropertyOptional() to?: string;
  @ApiPropertyOptional() reportedAt?: string;
  @ApiPropertyOptional() sha256?: string;
  @ApiPropertyOptional() opensLeft?: number;
  /** Notes the receiver added after handover — in the file the link opens. */
  @ApiPropertyOptional() notes?: number;
}

/** A link as whoever made it sees it on the report. */
export class DamageReportLinkRow {
  linkId: string;
  @ApiProperty({ enum: REPORT_LINK_STATES }) state: ReportLinkState;
  createdAt: string;
  expiresAt: string;
  opened: number;
  @ApiPropertyOptional() lastOpenedAt?: string;
  @ApiPropertyOptional() cancelledAt?: string;
}

/** A link just made. `url` is the only time the key exists outside whoever is handed this: it is not kept. */
export class MadeDamageReportLink {
  url: string;
  @ApiProperty({ type: DamageReportLinkRow }) link: DamageReportLinkRow;
}

export class DamageReportLinkList {
  @ApiProperty({ type: [DamageReportLinkRow] }) items: DamageReportLinkRow[];
}
