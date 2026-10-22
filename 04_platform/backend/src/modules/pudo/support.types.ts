import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * WRITING TO US (the user, 2026-10-22): "direct message field that is sorted by category by the system for sbg staff.
 * User selects what type of issue they have and ultimately the chatbot will ingest a message for staff. They will have
 * to leave their email."
 *
 * The person picks what it is about from these; staff read them sorted by it, what cannot wait first. A chatbot that
 * takes the message later fills the same three things — what it is about, the words, the address to answer.
 */
export const SUPPORT_CATEGORIES = ['sign-in', 'parcel', 'damage', 'money', 'joining', 'business', 'safety', 'privacy', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** Staff read these first, whatever their age: somebody may be at risk, or an account in the wrong hands. */
export const URGENT_CATEGORIES: readonly SupportCategory[] = ['safety'];

/** Where a message was written from: the app the person was in (its Help), or the front door. */
export const SUPPORT_FROM = ['home', 'send', 'agent', 'driver', 'mdp', 'vendor', 'fleet', 'business'] as const;

export type SupportStatus = 'open' | 'answered' | 'closed';

/** A message as written, in the person's words. */
export class SupportMessageDto {
  @ApiProperty({ enum: SUPPORT_CATEGORIES }) @IsIn(SUPPORT_CATEGORIES as unknown as string[]) category!: SupportCategory;
  /** The address the answer goes to. Required: it is the only way back to them. */
  @IsString() @MaxLength(254) email!: string;
  @IsString() @MinLength(10) @MaxLength(2000) message!: string;
  /** The help article it was written from, when it was. */
  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[a-z0-9-]+$/) about?: string;
  @ApiPropertyOptional({ enum: SUPPORT_FROM }) @IsOptional() @IsIn(SUPPORT_FROM as unknown as string[]) from?: (typeof SUPPORT_FROM)[number];
  /** The language the page was in, so an answer can be written in it. */
  @IsOptional() @IsString() @MaxLength(12) locale?: string;
  /** Left empty by people. A form-filling machine fills every field it finds: what it sends is thanked for and dropped. */
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

export class SupportAnswerDto {
  @IsString() @MinLength(2) @MaxLength(4000) text!: string;
}

/** The person is thanked with this: what to quote if they write again. */
export class SupportReceivedView {
  reference!: string;
}

export class SupportAnswerView {
  by!: string;
  at!: string;
  text!: string;
  /** It left by email. False: it waits in the outbox (no mail provider wired yet), or could not be handed over. */
  mailed!: boolean;
}

export class SupportMessageView {
  reference!: string;
  @ApiProperty({ enum: SUPPORT_CATEGORIES }) category!: SupportCategory;
  email!: string;
  message!: string;
  @ApiPropertyOptional() about?: string;
  @ApiPropertyOptional({ enum: SUPPORT_FROM }) from?: string;
  @ApiPropertyOptional() locale?: string;
  at!: string;
  @ApiProperty({ enum: ['open', 'answered', 'closed'] }) status!: SupportStatus;
  /** Somebody may be at risk: read first. */
  urgent!: boolean;
  @ApiProperty({ type: [SupportAnswerView] }) answers!: SupportAnswerView[];
  @ApiPropertyOptional() closedAt?: string;
  @ApiPropertyOptional() closedBy?: string;
  /** How many other messages from the same address are open: one person writing three times is one person. */
  others!: number;
}

export class SupportCategoryCount {
  @ApiProperty({ enum: SUPPORT_CATEGORIES }) category!: SupportCategory;
  open!: number;
}

export class SupportInboxView {
  /** The status read: open (the default), answered or closed. */
  @ApiProperty({ enum: ['open', 'answered', 'closed'] }) status!: SupportStatus;
  /** Open messages per category — every category, nought included, so the sorting is always there to read. */
  @ApiProperty({ type: [SupportCategoryCount] }) counts!: SupportCategoryCount[];
  /** Urgent first, then oldest first: whoever has waited longest is answered next. */
  @ApiProperty({ type: [SupportMessageView] }) items!: SupportMessageView[];
  /** A closed message and the person's address are kept this many days after closing, then deleted. */
  keptDays!: number;
}
