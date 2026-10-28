import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { INCOTERMS, type Incoterm } from '../m2/schema/ewaybill-schema';

/**
 * THE SHIPPER'S LETTER OF INSTRUCTION (the user, 2026-10-28: "the shippers letter of instruction is an important doc, I
 * think we should not just take the reference, but rather the form fields"; then, as recommended: a form, needed on every
 * export, frozen on signing).
 *
 * What the exporter tells its forwarder, from which the forwarder drafts the bill of lading before the documents cut-off.
 * Most of it is already on the export — shipper, forwarder, booking, vessel, port, box, seal, verified gross mass — and
 * is read from there when it is signed; the form asks only the rest. SIGNED, IT STOPS CHANGING: the page is frozen as a
 * version with the fingerprint of its bytes, and a change afterwards is a new version, never an edit of one the
 * forwarder may already hold. We draw it from the exporter's own words; we send it to nobody.
 */

export const CONSIGNEE_KINDS = ['named', 'to_order', 'to_order_of_bank'] as const;
export type ConsigneeKind = (typeof CONSIGNEE_KINDS)[number];
export const FREIGHT_TERMS = ['prepaid', 'collect'] as const;
export type FreightTerms = (typeof FREIGHT_TERMS)[number];
/** How the bill of lading is released: originals to be surrendered, a sea waybill, or released by telex at origin. */
export const BL_RELEASES = ['originals', 'sea_waybill', 'telex_release'] as const;
export type BlRelease = (typeof BL_RELEASES)[number];
export const MAX_SLI_LINES = 30;

export class SliParty {
  @ApiProperty() name: string;
  @ApiProperty() address: string;
  /** A person, a phone, an email — however the forwarder reaches them. */
  @ApiPropertyOptional() contact?: string;
}

export class SliLine {
  @ApiPropertyOptional() marks?: string;
  @ApiProperty() packages: number;
  /** Cartons, bags, pallets, drums … */
  @ApiProperty() packageKind: string;
  @ApiProperty() description: string;
  /** The exporter's own HS code, as it typed it — we never classify. */
  @ApiPropertyOptional() hsCode?: string;
  @ApiProperty() grossKg: number;
  @ApiPropertyOptional() netKg?: number;
  @ApiPropertyOptional() volumeM3?: number;
}

export class SliDangerous {
  /** UN and four digits — UN1263 for paint. */
  @ApiProperty() unNumber: string;
  @ApiProperty() hazardClass: string;
  @ApiPropertyOptional() properShippingName?: string;
  @ApiPropertyOptional() packingGroup?: string;
}

/** The form as the exporter left it: saved as often as it likes, signed when it is complete. */
export class SliDraft {
  @ApiPropertyOptional() shipperContact?: string;
  @ApiProperty({ enum: CONSIGNEE_KINDS }) consigneeKind: ConsigneeKind;
  @ApiPropertyOptional({ type: SliParty }) consignee?: SliParty;
  /** The bank a "to order of" bill is made out to. */
  @ApiPropertyOptional() orderOfBank?: string;
  @ApiPropertyOptional() notifySameAsConsignee?: boolean;
  @ApiPropertyOptional({ type: SliParty }) notify?: SliParty;
  @ApiPropertyOptional() dischargePort?: string;
  @ApiPropertyOptional() placeOfDelivery?: string;
  @ApiPropertyOptional({ enum: INCOTERMS }) incoterm?: Incoterm;
  @ApiPropertyOptional() incotermPlace?: string;
  @ApiPropertyOptional({ enum: FREIGHT_TERMS }) freight?: FreightTerms;
  @ApiPropertyOptional({ enum: BL_RELEASES }) blRelease?: BlRelease;
  @ApiPropertyOptional() originals?: number;
  @ApiPropertyOptional() copies?: number;
  @ApiProperty({ type: [SliLine] }) lines: SliLine[];
  @ApiPropertyOptional({ type: SliDangerous }) dangerous?: SliDangerous;
  @ApiPropertyOptional() letterOfCredit?: string;
  @ApiPropertyOptional() instructions?: string;
  @ApiProperty() savedAt: string;
  @ApiProperty() savedBy: string;
}

/** One signed version: frozen, fingerprinted. The page itself is kept apart, exactly as it was signed. */
export class SliVersion {
  @ApiProperty() version: number;
  @ApiProperty() signedBy: string;
  @ApiProperty() signedAt: string;
  /** sha256 of the frozen page's bytes. Never called `hash`: the response mask strips that name. */
  @ApiProperty() fingerprint: string;
  /** sha256 of the export's own facts the page was drawn from — when they change, the signed version is out of date. */
  @ApiProperty() basis: string;
  /** The weight and the seal on the page as signed, where there were any — compared on their own. */
  @ApiPropertyOptional() vgmKg?: number;
  @ApiPropertyOptional({ type: [String] }) seals?: string[];
}

export class ExportSli {
  @ApiPropertyOptional({ type: SliDraft }) draft?: SliDraft;
  @ApiProperty({ type: [SliVersion] }) versions: SliVersion[];
}

/** The letter as a reader sees it on the export: the draft, the versions, and what it still needs before signing. */
export class ExportSliView {
  @ApiPropertyOptional({ type: SliDraft }) draft?: SliDraft;
  @ApiProperty({ type: [SliVersion] }) versions: SliVersion[];
  /** What signing still needs, in words. Empty: it can be signed. */
  @ApiProperty({ type: [String] }) gaps: string[];
  /** The export's facts changed since the last signed version — the forwarder's copy is out of date. */
  @ApiProperty() stale: boolean;
  /** Whether the goods are hazardous: the form then asks for their dangerous goods particulars. */
  @ApiProperty() hazardous: boolean;
}

/* -------------------------------------------------------------------- requests -- */

export class SliPartyDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(300) address!: string;
  @IsOptional() @IsString() @MaxLength(120) contact?: string;
}

export class SliLineDto {
  @IsOptional() @IsString() @MaxLength(120) marks?: string;
  @IsInt() @Min(1) @Max(1_000_000) packages!: number;
  @IsString() @MaxLength(40) packageKind!: string;
  @IsString() @MaxLength(300) description!: string;
  @IsOptional() @IsString() @MaxLength(16) hsCode?: string;
  @IsNumber() @Min(0.1) @Max(60000) grossKg!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(60000) netKg?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) volumeM3?: number;
}

export class SliDangerousDto {
  @IsString() @MaxLength(8) unNumber!: string;
  @IsString() @MaxLength(8) hazardClass!: string;
  @IsOptional() @IsString() @MaxLength(120) properShippingName?: string;
  @IsOptional() @IsString() @MaxLength(4) packingGroup?: string;
}

export class SliDraftDto {
  @IsOptional() @IsString() @MaxLength(160) shipperContact?: string;
  @IsIn(CONSIGNEE_KINDS) consigneeKind!: ConsigneeKind;
  @IsOptional() @ValidateNested() @Type(() => SliPartyDto) consignee?: SliPartyDto;
  @IsOptional() @IsString() @MaxLength(120) orderOfBank?: string;
  @IsOptional() @IsBoolean() notifySameAsConsignee?: boolean;
  @IsOptional() @ValidateNested() @Type(() => SliPartyDto) notify?: SliPartyDto;
  @IsOptional() @IsString() @MaxLength(80) dischargePort?: string;
  @IsOptional() @IsString() @MaxLength(80) placeOfDelivery?: string;
  @IsOptional() @IsIn(INCOTERMS) incoterm?: Incoterm;
  @IsOptional() @IsString() @MaxLength(80) incotermPlace?: string;
  @IsOptional() @IsIn(FREIGHT_TERMS) freight?: FreightTerms;
  @IsOptional() @IsIn(BL_RELEASES) blRelease?: BlRelease;
  @IsOptional() @IsInt() @Min(1) @Max(6) originals?: number;
  @IsOptional() @IsInt() @Min(0) @Max(12) copies?: number;
  @IsArray() @ArrayMaxSize(MAX_SLI_LINES) @ValidateNested({ each: true }) @Type(() => SliLineDto) lines!: SliLineDto[];
  @IsOptional() @ValidateNested() @Type(() => SliDangerousDto) dangerous?: SliDangerousDto;
  @IsOptional() @IsString() @MaxLength(60) letterOfCredit?: string;
  @IsOptional() @IsString() @MaxLength(1000) instructions?: string;
}

export class SliSignDto {
  /** Who signs it, for the exporter. */
  @IsString() @MaxLength(120) signatory!: string;
}

