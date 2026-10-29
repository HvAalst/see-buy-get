import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { FBL_BOXES, FBL_FORMS, type FblBox, type FblForm } from '../../foundation/carriage-law/fbl';

/**
 * A FORWARDER'S BILL, HELD (the user, 2026-10-28: "if we optimize for FBL, we must know and report for our users"; 2026-10-29:
 * the holder records FIATA's check, with the result attached). The forwarder issued it; we keep a copy and what is printed,
 * as its holder read it, and say what it means (foundation/carriage-law/fbl.ts). Design: 05_engineering/fbl_note.md.
 */
export class FblIssuer {
  @ApiProperty() name: string;
  @ApiProperty({ description: 'The issuer’s country, as a two-letter code.' }) country: string;
}

/** What the holder saw on FIATA's verification page — their word, with the page's result attached. Never ours. */
export class FblVerification {
  @ApiProperty() registered: boolean;
  @ApiPropertyOptional() fiataId?: string;
  @ApiPropertyOptional() issuerShown?: string;
  @ApiProperty() proofDocumentId: string;
  @ApiProperty() proofTitle: string;
  @ApiProperty() by: string;
  @ApiProperty() byEntityId: string;
  @ApiProperty() at: string;
}

export class HeldFbl {
  @ApiProperty({ enum: FBL_FORMS }) form: FblForm;
  @ApiProperty() number: string;
  @ApiProperty({ type: FblIssuer }) issuer: FblIssuer;
  @ApiProperty({ description: 'YYYY-MM-DD, as printed.' }) issuedOn: string;
  @ApiProperty() electronic: boolean;
  /** The carriage includes a sea or inland-waterway leg. */
  @ApiProperty() seaLeg: boolean;
  @ApiProperty({ enum: FBL_BOXES, isArray: true }) printed: FblBox[];
  @ApiPropertyOptional() documentId?: string;
  @ApiPropertyOptional() documentTitle?: string;
  /** As printed — matched against our own record, never corrected to it. */
  @ApiPropertyOptional() containerNo?: string;
  @ApiPropertyOptional({ type: [String] }) seals?: string[];
  @ApiPropertyOptional() packages?: number;
  @ApiPropertyOptional() grossWeightKg?: number;
  @ApiPropertyOptional() portOfLoading?: string;
  @ApiPropertyOptional() portOfDischarge?: string;
  @ApiPropertyOptional() consignedTo?: string;
  @ApiPropertyOptional() originals?: number;
  @ApiPropertyOptional({ type: FblVerification }) verification?: FblVerification;
  @ApiProperty() recordedAt: string;
  @ApiProperty() recordedBy: string;
  @ApiProperty() recordedByEntityId: string;
}

export class FblIssuerDto {
  @IsString() @MaxLength(120) name: string;
  @Matches(/^[A-Za-z]{2}$/, { message: 'Say the issuer’s country as a two-letter code' }) country: string;
}

export class FblDto {
  @IsIn(FBL_FORMS) form: FblForm;
  @IsString() @MaxLength(60) number: string;
  @ValidateNested() @Type(() => FblIssuerDto) issuer: FblIssuerDto;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Say the day it was issued as YYYY-MM-DD' }) issuedOn: string;
  @IsBoolean() electronic: boolean;
  @IsBoolean() seaLeg: boolean;
  @IsArray() @ArrayMaxSize(40) @IsIn(FBL_BOXES, { each: true }) printed: FblBox[];
  @IsOptional() @IsString() @MaxLength(80) documentId?: string;
  @IsOptional() @IsString() @MaxLength(20) containerNo?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(40, { each: true }) seals?: string[];
  @IsOptional() @IsInt() @Min(0) packages?: number;
  @IsOptional() @IsNumber() @Min(0) grossWeightKg?: number;
  @IsOptional() @IsString() @MaxLength(80) portOfLoading?: string;
  @IsOptional() @IsString() @MaxLength(80) portOfDischarge?: string;
  @IsOptional() @IsString() @MaxLength(160) consignedTo?: string;
  @IsOptional() @IsInt() @Min(1) originals?: number;
}

export class FblVerifiedDto {
  @IsBoolean() registered: boolean;
  @IsOptional() @IsString() @MaxLength(80) fiataId?: string;
  @IsOptional() @IsString() @MaxLength(160) issuerShown?: string;
  /** What FIATA's page showed — a screenshot or its PDF — from the company's own papers. */
  @IsString() @MaxLength(80) proofDocumentId: string;
}

export class FblFindingView {
  @ApiProperty({ enum: FBL_BOXES }) key: FblBox;
  @ApiProperty() rule: string;
  @ApiProperty({ enum: ['missing', 'ask'] }) kind: 'missing' | 'ask';
}

export class FblCountryNoteView {
  @ApiProperty() country: string;
  @ApiProperty() says: string;
  @ApiProperty() source: string;
}

export class FblGenuineView {
  @ApiProperty() where: string;
  @ApiProperty() says: string;
  @ApiProperty() directory: string;
}

export class FblSdrRateView {
  @ApiProperty() usd: number;
  @ApiProperty() on: string;
  @ApiProperty() source: string;
}

export class FblCheckView {
  @ApiProperty() form: string;
  @ApiProperty() conditions: string;
  @ApiProperty() negotiable: boolean;
  @ApiProperty({ type: [FblFindingView] }) findings: FblFindingView[];
  @ApiProperty({ enum: FBL_BOXES, isArray: true }) asked: FblBox[];
  @ApiProperty() complete: boolean;
  @ApiProperty({ type: [String] }) meaning: string[];
  @ApiProperty({ type: [String] }) limits: string[];
  @ApiProperty({ type: [String] }) claims: string[];
  @ApiProperty({ type: [FblCountryNoteView] }) country: FblCountryNoteView[];
  @ApiProperty({ type: FblGenuineView }) genuine: FblGenuineView;
  @ApiProperty({ type: FblSdrRateView }) sdrRate: FblSdrRateView;
  @ApiProperty({ type: [String] }) sources: string[];
}

/** One thing printed on the bill, against our own record of the same goods. */
export class FblMatch {
  @ApiProperty({ enum: ['containerNo', 'seals', 'packages', 'grossWeight', 'port'] }) field: 'containerNo' | 'seals' | 'packages' | 'grossWeight' | 'port';
  @ApiProperty() printed: string;
  @ApiProperty() ours: string;
  @ApiProperty() agrees: boolean;
  @ApiPropertyOptional() why?: string;
}

export class FblView extends HeldFbl {
  @ApiProperty({ type: FblCheckView }) check: FblCheckView;
  @ApiProperty({ type: [FblMatch] }) matches: FblMatch[];
  /** Where the electronic bill's check stands, in the holder's own record. */
  @ApiProperty({ enum: ['paper', 'not_checked', 'registered', 'not_registered'] }) verified: 'paper' | 'not_checked' | 'registered' | 'not_registered';
  @ApiProperty() replaced: number;
}

