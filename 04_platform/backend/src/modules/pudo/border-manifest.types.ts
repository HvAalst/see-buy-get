import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * 2026-11-10 — THE BORDER MANIFEST AT MOYALE, KENYA–ETHIOPIA ONLY (the owner: "a digital manifest cannot be a messy list of
 * text. It must be a structured document that satisfies customs authorities, security checkpoints, and tax officials
 * simultaneously. just for these both nations"; decided: commercial loads first, the shipper or its clearing agent enters
 * the customs references, and a load is refused at pickup until its manifest is complete).
 *
 * ONE DOCUMENT, THREE READERS. Customs reads the parties, the goods line by line with their HS codes, values and origin,
 * and the national references; a checkpoint reads the vehicle, the driver, the seals and where the load has been; a tax
 * officer reads the tax numbers and the invoice. It is the CARRIER'S TRANSPORT DOCUMENT — never the customs declaration,
 * which stays the declarant's (legal.html L26): the export entry and the import declaration are lodged by the shipper or
 * its clearing agent in each country's own system, and the manifest carries their numbers.
 *
 * The two customs systems exchange nothing (research, 10 November 2026), so the manifest is the one copy both sides read:
 * frozen at pickup and at each step after, fingerprinted, anchored, and checked by its QR code on the public check page.
 *
 * A nation's rules stay national: no other pair of countries has a manifest, and nothing here is asked anywhere else.
 */
export const MANIFEST_PAIRS = ['KE>ET', 'ET>KE'] as const;
export type ManifestPair = (typeof MANIFEST_PAIRS)[number];

/** The post the two countries share: a One-Stop Border Post since 2021. */
export const MANIFEST_POST = 'Moyale One-Stop Border Post';

/**
 * The trader's tax number each of the two countries uses, by its own name: Kenya's KRA PIN (a letter — A a person, P a
 * business — nine digits, a letter) and Ethiopia's TIN (ten digits). Only for the manifest: the fiscal invoices keep their
 * own table (fiscal-ways.ts), which asks Ethiopia nothing.
 */
export const TRADER_TAX_NUMBER: Readonly<Record<string, { name: string; pattern: RegExp; example: string }>> = {
  KE: { name: 'KRA PIN', pattern: /^[AP]\d{9}[A-Z]$/, example: 'P051234567X' },
  ET: { name: 'TIN', pattern: /^\d{10}$/, example: '0012345678' },
};

/** Both national tariffs classify at eight digits: a line declared at fewer is asked for again. */
export const MANIFEST_HS_DIGITS = 8;

/** What each country calls the paper its customs system issues, by direction. */
export const REFERENCE_NAMES: Readonly<Record<ManifestPair, { exportEntry: string; importDeclaration: string }>> = {
  'KE>ET': { exportEntry: 'Kenyan export entry (KRA iCMS)', importDeclaration: 'Ethiopian import declaration (ECC eCMS)' },
  'ET>KE': { exportEntry: 'Ethiopian export declaration (ECC eCMS)', importDeclaration: 'Kenyan import entry (KRA iCMS)' },
};

/** A number a customs system issued, as the shipper or its agent gave it. */
export class ManifestReference {
  @ApiProperty() number!: string;
  /** Who gave it, by name, for which business. */
  @ApiProperty() by!: string;
  @ApiProperty() at!: string;
}

export class ManifestReferences {
  @ApiPropertyOptional({ type: ManifestReference }) exportEntry?: ManifestReference;
  @ApiPropertyOptional({ type: ManifestReference }) importDeclaration?: ManifestReference;
  /** Kenya → Ethiopia: the exporter's eTIMS zero-rated invoice number, which its export entry carries. */
  @ApiPropertyOptional({ type: ManifestReference }) etimsInvoice?: ManifestReference;
}

/** Something the manifest still lacks, and whose it is to give. */
export class ManifestGap {
  @ApiProperty() key!: string;
  @ApiProperty({ enum: ['shipper', 'carrier'] }) who!: 'shipper' | 'carrier';
  /** Whether the goods wait for it at pickup. The import side's number may follow until the post. */
  @ApiProperty() blocking!: boolean;
  /** The sentence a person acts on. */
  @ApiProperty() words!: string;
}

/** The manifest as its readers see it on a load. */
export class BorderManifestStatus {
  /** Whether this load has one: it crosses between Kenya and Ethiopia. */
  @ApiProperty() required!: boolean;
  @ApiPropertyOptional({ enum: MANIFEST_PAIRS }) pair?: ManifestPair;
  @ApiPropertyOptional() post?: string;
  /** Nothing that holds the goods at pickup is missing. */
  @ApiProperty() complete!: boolean;
  @ApiProperty({ type: [ManifestGap] }) missing!: ManifestGap[];
  @ApiPropertyOptional({ type: ManifestReferences }) references?: ManifestReferences;
  /** What each reference is called in this direction. */
  @ApiPropertyOptional() referenceNames?: { exportEntry: string; importDeclaration: string };
  /** Copies frozen so far: at pickup, and at each step after. */
  @ApiProperty() versions!: number;
  @ApiPropertyOptional() fingerprint?: string;
  /** Whether the reader may give the references: the business that posted the load, a member who may act. */
  @ApiProperty() mayWrite!: boolean;
  /** Not this reader's to read in full (a carrier before pickup): told only whether it is complete. */
  @ApiPropertyOptional() withheld?: boolean;
}

/** One frozen copy of the manifest. */
export interface ManifestDocument {
  number: string;
  version: number;
  pair: ManifestPair;
  post: string;
  regime: 'commercial';
  frozenAt: string;
  /** Why this copy was frozen: taken over, at the post, cleared, delivered, a number added. */
  reason: string;
  load: { freightId: string; code: string; description: string; packages?: number; grossKg: number; from: string; to: string };
  consignor: { name: string; address?: string; country: string; taxName?: string; taxNo?: string };
  consignee: { name: string; address?: string; country: string; taxName?: string; taxNo?: string };
  goods: Array<{ description: string; hsCode: string; quantity: number; netKg: number; unitValue: number; lineValue: number; originCountry: string }>;
  currency?: string;
  totalValue?: number;
  incoterm?: string;
  namedPlace?: string;
  invoice?: { number: string; issuedOn: string; fingerprint: string };
  references: { exportEntry?: string; importDeclaration?: string; etimsInvoice?: string };
  vehicle?: { plate: string; vehicleClass: string; registrationCountry?: string; trailerPlate?: string; yellowCard?: { number: string; expiresAt?: string } };
  crew?: { name: string; licenceNumber?: string; passport?: { number: string; country: string; expiresAt: string } };
  seals: string[];
  events: Array<{ at: string; words: string }>;
}

export class ManifestVersionRow {
  @ApiProperty() seq!: number;
  @ApiProperty() at!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() fingerprint!: string;
}

/** The shipper or its clearing agent gives the numbers its customs systems issued. Empty clears one. */
export class ManifestReferencesDto {
  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[A-Za-z0-9/\-. ]*$/, { message: 'A customs number is letters, digits and / - . only' }) exportEntry?: string;
  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[A-Za-z0-9/\-. ]*$/, { message: 'A customs number is letters, digits and / - . only' }) importDeclaration?: string;
  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[A-Za-z0-9/\-. ]*$/, { message: 'An eTIMS invoice number is letters, digits and / - . only' }) etimsInvoice?: string;
}

/** A driver's passport, recorded by their fleet office or staff, as a licence is. */
export class DriverPassportDto {
  /** The name as printed on the passport: what an officer at the post compares. */
  @IsString() @MaxLength(120) @Matches(/\S/, { message: 'Write the name as printed on the passport' }) name!: string;
  @IsString() @MaxLength(20) @Matches(/^[A-Za-z0-9]{5,20}$/, { message: 'A passport number is 5 to 20 letters and digits, as printed' }) number!: string;
  /** The country that issued it: two letters. */
  @IsString() @Matches(/^[A-Za-z]{2}$/, { message: 'Say which country issued it, as two letters' }) country!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Say when it runs out, written YYYY-MM-DD' }) expiresAt!: string;
  @IsOptional() @IsString() @MaxLength(120) by?: string;
}
