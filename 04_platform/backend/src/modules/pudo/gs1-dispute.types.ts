import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * TWO BUSINESSES SAY ONE GS1 COMPANY PREFIX IS THEIRS (round 18).
 *
 * The user: "Refuse the same digit" — a prefix is shared only under different extension digits, as a group's companies
 * share their parent's; and "Only when disputed" — entering a prefix stays the business's own word, but a business that
 * says a prefix another uses is really its own sends its GS1 licence, and staff decide, the way a disputed national ID is
 * decided: one member of staff says whose it is and why, a different one approves, and both businesses read the reason.
 *
 * Nothing changes while it is open: the business using the prefix goes on printing under it. It is told at once and has
 * a week to send its own licence; staff decide when every business using it has sent one, or the week is over.
 */

/** How long the businesses using the prefix have to send their own licence before staff may decide without it. */
export const GS1_ANSWER_DAYS = 7;

export const GS1_DISPUTE_STATES = ['open', 'proposed', 'decided', 'withdrawn'] as const;
export type Gs1DisputeState = (typeof GS1_DISPUTE_STATES)[number];
/** The prefix is the claimant's — or stays with the businesses using it. */
export const GS1_DISPUTE_SIDES = ['claimant', 'holders'] as const;
export type Gs1DisputeSide = (typeof GS1_DISPUTE_SIDES)[number];

export interface Gs1Party {
  /** The key its codes are kept under: a business's entityId, or a forwarder's client's (round 20). */
  entityId: string;
  /** Told, and answering: the business itself — or, for a client, the forwarder that keeps its record. */
  did: string;
  name: string;
  /** Round 20 — a client's party is answered by its forwarder: that business's entityId. */
  actsFor?: string;
  licenceRef?: string;
  /** Licences it sent before the one it sent last: evidence is never deleted mid-case, so staff see them too. */
  earlier?: string[];
  note?: string;
  sentAt?: string;
}

export interface Gs1Dispute {
  disputeId: string;
  companyPrefix: string;
  /** The digit the claimant asked to print under: what it is given if the prefix is decided to be its. */
  extensionDigit: number;
  claimant: Gs1Party;
  /** The businesses using the prefix when it was opened (or a decision gave it to). */
  holders: Gs1Party[];
  openedAt: string;
  openedBy: string;
  state: Gs1DisputeState;
  proposal?: { to: Gs1DisputeSide; what: string; reason: string; by: string; byKey: string; at: string };
  sentBack?: { by: string; at: string; why: string };
  decided?: { to: Gs1DisputeSide; reason: string; proposedBy: string; by: string; at: string };
  withdrawnAt?: string;
}

/** A business's own reading of a dispute it is in: its side, the other businesses by name, where it stands. */
export class Gs1DisputeView {
  disputeId: string;
  companyPrefix: string;
  extensionDigit: number;
  @ApiProperty({ enum: ['claimant', 'holder'] }) side: 'claimant' | 'holder';
  @ApiProperty({ enum: GS1_DISPUTE_STATES }) state: Gs1DisputeState;
  openedAt: string;
  /** Until when the businesses using the prefix may send their licence before staff decide without it. */
  answerBy: string;
  claimantName: string;
  holderNames: string[];
  /** Whether this business has sent its licence. */
  licenceSent: boolean;
  /** Round 20 — the client this business stands for in it, when it is a client's prefix. */
  @ApiPropertyOptional() forClient?: string;
  /** Decided: whether the prefix is this business's to use, and the reason staff gave. */
  @ApiPropertyOptional() decided?: { mine: boolean; reason: string; at: string };
  @ApiPropertyOptional() withdrawnAt?: string;
}

export class Gs1PartyRow {
  entityId: string;
  name: string;
  @ApiPropertyOptional() licenceRef?: string;
  @ApiPropertyOptional({ type: [String] }) earlier?: string[];
  @ApiPropertyOptional() note?: string;
  @ApiPropertyOptional() sentAt?: string;
  /** The digit it prints under now, when it uses the prefix. */
  @ApiPropertyOptional() digitNow?: number;
  /** Round 20 — a forwarder's client: the forwarder that keeps its record and answers for it. */
  @ApiPropertyOptional() forwarder?: string;
}

/** What staff read: both sides with their licences, the proposal waiting, the decision. */
export class Gs1DisputeRow {
  disputeId: string;
  companyPrefix: string;
  extensionDigit: number;
  @ApiProperty({ enum: GS1_DISPUTE_STATES }) state: Gs1DisputeState;
  openedAt: string;
  answerBy: string;
  /** Whether staff may say whose it is now: every business using it has sent its licence, or the week is over. */
  mayDecide: boolean;
  @ApiProperty({ type: Gs1PartyRow }) claimant: Gs1PartyRow;
  @ApiProperty({ type: [Gs1PartyRow] }) holders: Gs1PartyRow[];
  @ApiPropertyOptional() proposal?: { to: Gs1DisputeSide; what: string; reason: string; by: string; at: string };
  @ApiPropertyOptional() sentBack?: { by: string; at: string; why: string };
  @ApiPropertyOptional() decided?: { to: Gs1DisputeSide; reason: string; proposedBy: string; by: string; at: string };
  @ApiPropertyOptional() withdrawnAt?: string;
}

export class OpenGs1DisputeDto {
  @IsString() @MaxLength(24) companyPrefix!: string;
  @IsInt() @Min(0) @Max(9) extensionDigit!: number;
  /** The photograph or screenshot of the business's GS1 licence, uploaded as media kind `gs1_licence`. */
  @IsString() @MaxLength(80) licenceRef!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** Round 20 — said for one of the forwarder's clients: the prefix is the CLIENT's. */
  @IsOptional() @IsString() @MaxLength(80) forClientId?: string;
}

export class SendGs1LicenceDto {
  @IsString() @MaxLength(80) licenceRef!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ProposeGs1Dto {
  @IsIn(GS1_DISPUTE_SIDES) to!: Gs1DisputeSide;
  /** What was checked, and how — the second member of staff approves on the strength of it. */
  @IsString() @MaxLength(500) what!: string;
  /** Written for the businesses: both read it. */
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class ApproveGs1Dto {
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class SendBackGs1Dto {
  @IsString() @MaxLength(300) why!: string;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}
