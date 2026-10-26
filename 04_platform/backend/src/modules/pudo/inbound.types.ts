import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { FREIGHT_CLAIM_DECISIONS, FREIGHT_CLAIM_KINDS, FreightTrackView, ReceivingExceptionView, type FreightClaimDecision, type FreightClaimKind } from './dispatch.types';
import { GeoPoint } from './pudo.types';

/**
 * INBOUND SUPPLY, READING A (assessment.html D1–D14; the user, 2026-10-25: "Yes, A then B") — a business receiving
 * goods at its own sites. Its delivery places can receive: each gets a code the business gives its suppliers, who write
 * it as "deliver to" when they post a load. What is addressed there, the business sees coming in.
 *
 * WHAT THE RECEIVER SEES (D2, D5, D7): the logistics half — its own number for the order, who it is from, how many
 * packages of what and how heavy, when it leaves and when it is expected, where it is now and who is bringing it, as the
 * load's own tracking link shows anybody who holds it. Never a price, never the supplier's contacts.
 *
 * THE RECEIVING MOMENT (D9): what the receiver found at the handover not as the note says — short, over, damaged, wrong —
 * written on the note beside its name; and what did not come, or came and is not the goods, stays expected here until
 * the receiver closes it. ITS CLOCK (D10): when a load is expected and whether it is late is read on the place's own.
 */

/** One of a business's receiving points: the place, and the code its suppliers write. */
export class ReceivingPointView {
  siteId: string;
  name: string;
  @ApiProperty({ type: GeoPoint }) location: GeoPoint;
  /** "7KQ3-PX9M": what the business gives its suppliers. */
  code: string;
  since: string;
  by: string;
}

/** What a "deliver to" code names, for the supplier about to send there: the business and the place, nothing more. */
export class ReceivingPointNamed {
  name: string;
  siteName: string;
  @ApiProperty({ type: GeoPoint }) location: GeoPoint;
}

/** D9 — how the receiver closes what was still expected of a load: it came after all, or it is not coming. */
export const INBOUND_CLOSINGS = ['came', 'not_coming'] as const;
export type InboundClosingHow = (typeof INBOUND_CLOSINGS)[number];

/** D9 — what was still expected of a load, closed by the receiver: how, its words, when, and which of its people. */
export class InboundClosed {
  @ApiProperty({ enum: INBOUND_CLOSINGS }) how: InboundClosingHow;
  @ApiPropertyOptional() note?: string;
  at: string;
  by: string;
}

/** D10 — when a load coming in is expected, and whether it is late, read on the receiving place's own clock. */
export class InboundDue {
  /** The place's clock, and its name: Africa/Nairobi, "East Africa Time". */
  zone: string;
  zoneName: string;
  /** The day it is expected there, YYYY-MM-DD. */
  day: string;
  /** About when there, HH:MM — once it is on the road and something says the hour. */
  @ApiPropertyOptional() about?: string;
  /** That day is today there. */
  today: boolean;
  /** Late there: `day` — its day has gone · `hour` — it is on the road and its hour has passed. */
  @ApiPropertyOptional({ enum: ['day', 'hour'] }) late?: 'day' | 'hour';
}

/** A claim on goods that came in: what it says, where it stands, and whether the sender or the receiver made it — never money. */
export class InboundClaimView {
  @ApiProperty({ enum: FREIGHT_CLAIM_KINDS }) kind: FreightClaimKind;
  @ApiProperty({ enum: ['open', 'resolved'] }) state: 'open' | 'resolved';
  raisedAt: string;
  @ApiProperty({ enum: ['sender', 'receiver'] }) by: 'sender' | 'receiver';
  @ApiPropertyOptional({ enum: [...FREIGHT_CLAIM_DECISIONS, 'report_only'] }) decision?: FreightClaimDecision;
  @ApiPropertyOptional() note?: string;
  @ApiPropertyOptional() decidedAt?: string;
}

/**
 * D13 — GOODS FROM ABROAD: whether they have cleared, from what the note rests on (the user, 2026-10-26: "An expected
 * arrival from abroad shows whether it has cleared, from the note. Nothing more is computed."). `cleared` — customs let
 * the import go, as its agent recorded, or its driver said it cleared the border; `held` — held by customs at its port, or
 * on the way by an authority, as its driver said; `at_border` — at a border post, as its driver said; `under_bond` — in
 * the country under a transit bond, not cleared in yet; `not_yet` — nothing said of it yet.
 */
export const ABROAD_STATES = ['cleared', 'held', 'at_border', 'under_bond', 'not_yet'] as const;
export type AbroadState = (typeof ABROAD_STATES)[number];

export class InboundAbroad {
  /** The country it comes from. */
  from: string;
  @ApiProperty({ enum: ABROAD_STATES }) state: AbroadState;
  /** When it was let go, held, or reached the post. */
  @ApiPropertyOptional() at?: string;
  /** Where: the port customs let it go at or holds it, or the border post its driver named. */
  @ApiPropertyOptional() where?: string;
  /** Who clears it in under the agreed term — this receiver, or its supplier. Absent where no term was agreed. */
  @ApiPropertyOptional({ enum: ['receiver', 'supplier'] }) clearsIn?: 'receiver' | 'supplier';
}

/** A load coming in to one of the business's receiving points — the tracking link's view, and the receiver's own facts. */
export class InboundRow extends FreightTrackView {
  /** D13 — from abroad: whether it has cleared, from what the note rests on. Absent for goods from inside the country. */
  @ApiPropertyOptional({ type: InboundAbroad }) abroad?: InboundAbroad;
  freightId: string;
  /** The load's own tracking link, to open the whole of it. */
  @ApiPropertyOptional() trackingKey?: string;
  /** The receiver's own number for the order, as the supplier wrote it. */
  @ApiPropertyOptional() reference?: string;
  /** Which receiving point it is for. */
  site: { siteId: string; name: string };
  /** Who it is from: the business that sent it — or, sent by its forwarder, the client it was sent for. */
  from: string;
  @ApiPropertyOptional() packages?: number;
  @ApiPropertyOptional() packaging?: string;
  /** D9 — what the receiver found not as the note says, at the handover: as it stands on the note. */
  @ApiPropertyOptional({ type: [ReceivingExceptionView] }) exceptions?: ReceivingExceptionView[];
  /** D9 — packages still expected after the handover (short, and not the goods): until the receiver closes them, then 0. */
  @ApiPropertyOptional() stillExpected?: number;
  @ApiPropertyOptional({ type: InboundClosed }) closed?: InboundClosed;
  /**
   * D10 — when and whether late, on the receiving place's own clock. Where it is given it is the row's one answer: the
   * carrier's own reading (`late`, `expectedAbout`) is left off. Absent where nothing says a day, or the place's clock is
   * not known (a country of several clocks): the carrier's reading stands, as the tracking link shows it.
   */
  @ApiPropertyOptional({ type: InboundDue }) due?: InboundDue;
  /**
   * ITS COPY OF THE NOTE (the user, 2026-10-26: "Its copy, no carriage price"): the id in the archive of the receiver's
   * copy, once one is frozen — the file, and the links to pass it on to an insurer, hang on it.
   */
  @ApiPropertyOptional() noteId?: string;
  /** The trade term agreed, where one was; and so, once delivered, who claims for goods lost or damaged on the road. */
  @ApiPropertyOptional() incoterm?: string;
  @ApiPropertyOptional({ enum: ['sender', 'receiver'] }) claimant?: 'sender' | 'receiver';
  /** The receiver may claim on it now: it carries the risk, the load is delivered, no claim yet, within the window. */
  @ApiPropertyOptional() canClaim?: boolean;
  @ApiPropertyOptional({ type: InboundClaimView }) claim?: InboundClaimView;
}

/** What is coming in to a business: its receiving points, and what is addressed to them — coming first, then the last fortnight's. */
export class InboundView {
  @ApiProperty({ type: [ReceivingPointView] }) points: ReceivingPointView[];
  @ApiProperty({ type: [InboundRow] }) items: InboundRow[];
}

/** D9 — close what is still expected of a load: it came after all, or it is not coming; with a line of the receiver's words. */
export class CloseInboundDto {
  @ApiProperty({ enum: INBOUND_CLOSINGS }) @IsIn(INBOUND_CLOSINGS) how!: InboundClosingHow;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
