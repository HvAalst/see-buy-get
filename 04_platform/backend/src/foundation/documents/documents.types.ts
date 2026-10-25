import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

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
 *
 * GENERAL, AND EACH COUNTRY'S OWN (the user, 2026-10-25: "every country needs it's specific adjustments, so there will
 * be the general terms of use, global, and specific terms of use"). Every document has a global line, which everybody
 * agrees to; a country may have a line of its own for any of them, which everybody there agrees to AS WELL — the
 * adjustments its law asks for, on top of the general text, never instead of it. A country with none has the general
 * text alone. A line is named by its KEY: `terms` for the general terms of use, `terms@KE` for Kenya's own.
 */

/** The documents a sign-up agrees to: the terms of use, what happens to their data (use and keeping), and cookies. */
export const DOCUMENT_KINDS = ['terms', 'privacy', 'cookies'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Where each is read on the public site. */
export const DOCUMENT_PATHS: Record<DocumentKind, string> = { terms: '/terms/', privacy: '/privacy/', cookies: '/cookies/' };

/** A line's key: `terms`, or `terms@KE` for Kenya's own. */
export function documentKey(kind: DocumentKind, country?: string): string {
  return country ? `${kind}@${country.toUpperCase()}` : kind;
}

/** Where a line is read on the public site: the general text at its page, a country's own with `?country=`. */
export function documentPath(kind: DocumentKind, country?: string): string {
  return country ? `${DOCUMENT_PATHS[kind]}?country=${country.toUpperCase()}` : DOCUMENT_PATHS[kind];
}

export const DOCUMENT_STATES = ['proposed', 'published', 'declined'] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

/** Long enough for any notice we would write, short enough that nobody pastes a book into the console by mistake. */
export const MAX_DOCUMENT_BODY = 100_000;
export const MAX_DOCUMENT_TITLE = 120;
export const MAX_CHANGE_NOTE = 1_000;

export class DocumentVersion {
  @ApiProperty() versionId: string;
  @ApiProperty({ enum: DOCUMENT_KINDS }) kind: DocumentKind;
  /** The country whose own line this is. Absent: the general text, everybody's. */
  @ApiPropertyOptional() country?: string;
  /** 1, 2, 3 … in the order they were published, per line. A proposal has none until it is published. */
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
  /** The published version this one was written from — none for a country's first. Refused if it is no longer current. */
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

/** A published version, as anybody reads it: the text, its number and date, and what changed. Never who wrote it. */
export class PublishedDocument {
  @ApiProperty() key: string;
  @ApiProperty({ enum: DOCUMENT_KINDS }) kind: DocumentKind;
  /** The country whose own line it is; absent for the general text. */
  @ApiPropertyOptional() country?: string;
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
  /** `terms`, or `terms@KE` for a country's own: what the agreement names it by. */
  @ApiProperty() key: string;
  @ApiProperty({ enum: DOCUMENT_KINDS }) kind: DocumentKind;
  @ApiPropertyOptional() country?: string;
  @ApiProperty() title: string;
  /** The version to read and agree to. */
  @ApiProperty() number: number;
  @ApiProperty() publishedAt: string;
  /** Somebody who agreed to this version or a later one is not asked again. */
  @ApiProperty() since: number;
  @ApiProperty() path: string;
}

export class AgreementSet {
  /** The country whose own documents are in the set, if any. */
  @ApiPropertyOptional() country?: string;
  @ApiProperty({ type: [AgreementDocument] }) documents: AgreementDocument[];
}

/**
 * The versions somebody read and agreed to, by key (`terms`, `terms@KE` …) — sent with a sign-up, or after signing in
 * when asked again. `country` is the one the form showed the documents for; each door checks the versions against the
 * country the sign-up is really in.
 */
export class AgreementDto {
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' }, example: { terms: 1, privacy: 1, cookies: 1, 'terms@KE': 1 } })
  @IsObject()
  versions!: Record<string, number>;
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(2) country?: string;
}

/** For the sign-up bodies that carry it. */
export class WithAgreement {
  @IsOptional() @ValidateNested() @Type(() => AgreementDto) agreement?: AgreementDto;
}

export class ProposeDocumentDto {
  /** A country's own line; absent for the general text. */
  @IsOptional() @IsString() @MaxLength(2) country?: string;
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

/** Where somebody stands with the set: whether they must agree before going on, and what they agreed to. */
export class MyAgreement {
  @ApiProperty() needed: boolean;
  /** The country whose own documents were asked: the one this sign-in works in. */
  @ApiPropertyOptional() country?: string;
  @ApiProperty({ type: [AgreementDocument] }) documents: AgreementDocument[];
  /** When they last agreed to anything, and the latest version of each line they agreed to. Absent: nothing yet. */
  @ApiPropertyOptional() agreedAt?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'integer' } }) agreed?: Record<string, number>;
}
