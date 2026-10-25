import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/**
 * WHAT SOMEBODY AGREES TO WHEN THEY SIGN UP, KEPT AS TEXT STAFF WRITE (the user, 2026-10-25: "every sign up needs an
 * agreement of terms of use, use of data, storage of data, cookie statement, etc." — and "the text can be drafted and
 * inserted but need cms from the staff console and it's usual track of changes timestamped etc.").
 *
 * Each document is a line of VERSIONS. A version is never edited once written: a change is a new version, proposed by
 * one member of staff with a note saying what changed, and published only when a DIFFERENT one approves it — the same
 * two people every change of consequence here takes. Every version is kept, with who wrote it, who published it and
 * when, so what anybody agreed to can be read back word for word. A published version that asks something new of
 * people is marked so, and everybody who agreed to an earlier one is asked again before they go on.
 */

/** The documents a sign-up agrees to: the terms of use, what happens to their data (use and keeping), and cookies. */
export const DOCUMENT_KINDS = ['terms', 'privacy', 'cookies'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Where each is read on the public site. */
export const DOCUMENT_PATHS: Record<DocumentKind, string> = { terms: '/terms/', privacy: '/privacy/', cookies: '/cookies/' };

export const DOCUMENT_STATES = ['proposed', 'published', 'declined'] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

/** Long enough for any notice we would write, short enough that nobody pastes a book into the console by mistake. */
export const MAX_DOCUMENT_BODY = 100_000;
export const MAX_DOCUMENT_TITLE = 120;
export const MAX_CHANGE_NOTE = 1_000;

export class DocumentVersion {
  @ApiProperty() versionId: string;
  @ApiProperty({ enum: DOCUMENT_KINDS }) kind: DocumentKind;
  /** 1, 2, 3 … in the order they were published. A proposal has none until it is published. */
  @ApiPropertyOptional() number?: number;
  @ApiProperty() title: string;
  /**
   * The text, in plain Markdown: a paragraph per blank line, `## ` for a heading, `- ` or `1. ` for a list, `**bold**`,
   * and `[words](/path)` or `[words](https://…)` for a link. Nothing else is read as anything but text.
   */
  @ApiProperty() body: string;
  /** What changed and why, said by whoever wrote it — shown beside the version, to staff and on the public page. */
  @ApiProperty() changeNote: string;
  /** Everybody who agreed to an earlier version is asked to agree to this one before they go on. */
  @ApiProperty() askAgain: boolean;
  @ApiProperty({ enum: DOCUMENT_STATES }) status: DocumentState;
  /** The published version this one was written from. A proposal over a version that is no longer current is refused. */
  @ApiPropertyOptional() basedOn?: string;
  @ApiProperty() writtenBy: string;
  @ApiProperty() writtenAt: string;
  /** Who published it, or declined it — and when, and (declined) why. */
  @ApiPropertyOptional() decidedBy?: string;
  @ApiPropertyOptional() decidedAt?: string;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional() publishedAt?: string;
  /** `seed`: inserted with the system as a first draft, never yet written by anybody at SeeBuyGet. */
  @ApiPropertyOptional({ enum: ['seed'] }) source?: 'seed';
  /** Said to whoever reads it: THEY wrote this one, so they cannot publish it. */
  @ApiPropertyOptional() mine?: boolean;
  /** How many people agreed to this version. Staff only. */
  @ApiPropertyOptional() agreed?: number;
}

/** A published version, as anybody may read it: the text, its number and date, and what changed. Never who wrote it. */
export class PublishedDocument {
  @ApiProperty({ enum: DOCUMENT_KINDS }) kind: DocumentKind;
  @ApiProperty() number: number;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty() publishedAt: string;
  @ApiProperty() changeNote: string;
  @ApiProperty() askAgain: boolean;
  /** Where it is read on the public site. */
  @ApiProperty() path: string;
}

/** One line of a document's public history: which version, when, and what changed. */
export class PublishedVersionLine {
  @ApiProperty() number: number;
  @ApiProperty() title: string;
  @ApiProperty() publishedAt: string;
  @ApiProperty() changeNote: string;
  @ApiProperty() askAgain: boolean;
}

/** One document in the set a sign-up agrees to: the version shown now, and the oldest one that still counts. */
export class AgreementDocument {
  @ApiProperty({ enum: DOCUMENT_KINDS }) kind: DocumentKind;
  @ApiProperty() title: string;
  /** The version to read and agree to. */
  @ApiProperty() number: number;
  @ApiProperty() publishedAt: string;
  /** Somebody who agreed to this version or a later one is not asked again. */
  @ApiProperty() since: number;
  @ApiProperty() path: string;
}

export class AgreementSet {
  @ApiProperty({ type: [AgreementDocument] }) documents: AgreementDocument[];
}

/** The versions somebody read and agreed to, by number — sent with a sign-up, or after signing in when asked again. */
export class AgreementDto {
  @IsInt() @Min(1) terms!: number;
  @IsInt() @Min(1) privacy!: number;
  @IsInt() @Min(1) cookies!: number;
}

/** For the sign-up bodies that carry it. */
export class WithAgreement {
  @IsOptional() @ValidateNested() @Type(() => AgreementDto) agreement?: AgreementDto;
}

export class ProposeDocumentDto {
  @IsString() @MinLength(1) @MaxLength(MAX_DOCUMENT_TITLE) title!: string;
  @IsString() @MinLength(1) @MaxLength(MAX_DOCUMENT_BODY) body!: string;
  @IsString() @MinLength(1) @MaxLength(MAX_CHANGE_NOTE) changeNote!: string;
  @IsBoolean() askAgain!: boolean;
  /** The typed name beside the shared key on a laptop; a named sign-in says it itself. */
  @IsOptional() @IsString() @MaxLength(120) by?: string;
}

export class DecideDocumentDto {
  @IsOptional() @IsString() @MaxLength(MAX_CHANGE_NOTE) reason?: string;
  @IsOptional() @IsString() @MaxLength(120) by?: string;
}

/** Where somebody stands with the set: whether they must agree before going on, and what they last agreed to. */
export class MyAgreement {
  @ApiProperty() needed: boolean;
  @ApiProperty({ type: [AgreementDocument] }) documents: AgreementDocument[];
  /** What they agreed to last, and when. Absent: nothing yet. */
  @ApiPropertyOptional() agreedAt?: string;
  @ApiPropertyOptional() agreed?: Record<string, number>;
}
