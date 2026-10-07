import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/*
 * A LINK TO A DOCUMENT — what an email carries instead of the file.
 *
 * The user, 2026-10-07: "Use ZeptoMail to send, keep the files on our own server, and put a link in the email. No own
 * mail server, and attachments only as an occasional extra." A file in somebody's mailbox cannot follow the rule that
 * a document is kept twelve months, cannot be taken back, and cannot be seen to have been opened. A link can.
 *
 * The link opens ONE document as ONE of its parties reads it, with nobody signed in. That makes it a key, and it is
 * held to what a key must be: it cannot be guessed, it stops, it opens exactly one thing, every opening is counted,
 * and the party it was made for can cancel it. An identifier opens nothing here — this is not one.
 */

/**
 * `ready` — it opens the document · `expired` — its time is up · `cancelled` — the party it was made for cancelled
 * it · `used_up` — it has been opened as often as one link may be · `gone` — the document itself has passed the end
 * of its keeping, and there is nothing left for any link to open.
 */
export const LINK_STATES = ['ready', 'expired', 'cancelled', 'used_up', 'gone'] as const;
export type LinkState = (typeof LINK_STATES)[number];

/**
 * A link cancelled by nobody's hand. `left` — it was emailed to one of a business's people, and they are no longer in
 * that business: what they were sent as one of its people stops with their place in it.
 */
export const LINK_CANCEL_REASONS = ['left'] as const;
export type LinkCancelReason = (typeof LINK_CANCEL_REASONS)[number];

/** The key itself, as the page that was opened from the email sends it. In the body, never in an address. */
export class DocumentLinkTokenDto {
  @IsString() @MinLength(20) @MaxLength(100) token: string;
}

/** What a link is, said to whoever holds it — before they take the file. Only a link that still opens says what it opens. */
export class DocumentLinkView {
  @ApiProperty({ enum: LINK_STATES }) state: LinkState;
  /** When it stops, or stopped. */
  expiresAt: string;
  /** The note's number, and where the goods went from and to. Only while the link opens it. */
  @ApiPropertyOptional() number?: string;
  @ApiPropertyOptional() from?: string;
  @ApiPropertyOptional() to?: string;
  @ApiPropertyOptional() deliveredAt?: string;
  /** How many more times it can be opened. */
  @ApiPropertyOptional() opensLeft?: number;
  /** Until when the document itself is kept: after that nobody can be given another copy. */
  @ApiPropertyOptional() documentUntil?: string;
}

/** A link as the party it was made for sees it on the document: where it went, how it was used, and whether it still opens. */
export class DocumentLinkRow {
  linkId: string;
  @ApiProperty({ enum: LINK_STATES }) state: LinkState;
  /** The address it was emailed to, masked. Absent on a link somebody made to pass on themselves. */
  @ApiPropertyOptional() sentTo?: string;
  /** Who made it, where a person did and the sign-in names one: in a company, which of its people. */
  @ApiPropertyOptional() madeBy?: string;
  createdAt: string;
  expiresAt: string;
  /** How many times the file was taken with it, and when last. */
  opened: number;
  @ApiPropertyOptional() lastOpenedAt?: string;
  @ApiPropertyOptional() cancelledAt?: string;
  /** Who cancelled it, where a person did and the sign-in names one. */
  @ApiPropertyOptional() cancelledBy?: string;
  /** Why, when nobody cancelled it by hand. */
  @ApiPropertyOptional({ enum: LINK_CANCEL_REASONS }) cancelledWhy?: LinkCancelReason;
}

/**
 * A LINK JUST MADE. `url` is the only time the key exists outside whoever is handed this: it is not kept, so it
 * cannot be shown again — the one who made it passes it on now, or cancels it and makes another.
 */
export class MadeDocumentLink {
  url: string;
  @ApiProperty({ type: DocumentLinkRow }) link: DocumentLinkRow;
}

export class DocumentLinkList {
  @ApiProperty({ type: [DocumentLinkRow] }) items: DocumentLinkRow[];
}
