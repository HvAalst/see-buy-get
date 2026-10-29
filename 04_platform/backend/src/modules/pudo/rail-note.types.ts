import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { RAIL_LOADS, RAIL_PARTICULARS, RAIL_REGIMES, type RailLoad, type RailParticular, type RailRegime } from '../../foundation/carriage-law/rail';

/**
 * A RAIL NOTE, HELD (the user, 2026-10-28: "for now we hold the note but we should be able to see whether it is valid").
 * The railway issued it — on paper or in its own system; we keep a copy and what is printed on it, as its holder read it,
 * and say whether that is complete for the law of its lane (foundation/carriage-law/rail.ts). Design:
 * 05_engineering/rail_note.md.
 */
export class RailStation {
  @ApiProperty() name: string;
  @ApiProperty({ description: 'The station’s country, as a two-letter code.' }) country: string;
}

export class RailElectronic {
  /** The note's reference in the railway's (or the state's) system: an e-CIM number, a CT-e key, an eT-RR number. */
  @ApiPropertyOptional() reference?: string;
  /** For a printout of an electronic CIM note: whether it carries its printout line. */
  @ApiPropertyOptional() printoutLine?: boolean;
}

export class HeldRailNote {
  /** One of the catalogue's railways by its key, or `other`. */
  @ApiProperty() railway: string;
  @ApiProperty() railwayName: string;
  @ApiProperty({ type: RailStation }) from: RailStation;
  @ApiProperty({ type: RailStation }) to: RailStation;
  @ApiPropertyOptional() noteNumber?: string;
  @ApiProperty({ description: 'The day the note was made out, YYYY-MM-DD: the law is read on that day.' }) madeOutOn: string;
  @ApiProperty({ enum: RAIL_LOADS }) load: RailLoad;
  @ApiPropertyOptional() dangerous?: boolean;
  /** What its holder found printed on it. */
  @ApiProperty({ enum: RAIL_PARTICULARS, isArray: true }) printed: RailParticular[];
  @ApiPropertyOptional({ type: RailElectronic }) electronic?: RailElectronic;
  /** The copy, from the holder's own company papers. */
  @ApiPropertyOptional() documentId?: string;
  @ApiPropertyOptional() documentTitle?: string;
  /** As printed on the rail note — matched against our own record of the box. */
  @ApiPropertyOptional() containerNo?: string;
  @ApiPropertyOptional({ type: [String] }) seals?: string[];
  /** The goods' gross mass as printed — the container's own weight is not in it (the gaps check, 2026-10-29). */
  @ApiPropertyOptional() grossMassKg?: number;
  @ApiProperty() recordedAt: string;
  @ApiProperty() recordedBy: string;
  @ApiProperty() recordedByEntityId: string;
}

export class RailStationDto {
  @IsString() @MaxLength(80) name: string;
  @Matches(/^[A-Za-z]{2}$/, { message: 'Say the station’s country as a two-letter code' }) country: string;
}

export class RailElectronicDto {
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @IsBoolean() printoutLine?: boolean;
}

export class RailNoteDto {
  @IsString() @MaxLength(40) railway: string;
  /** The railway's name, for one not in the catalogue (`other`). */
  @IsOptional() @IsString() @MaxLength(80) railwayName?: string;
  @ValidateNested() @Type(() => RailStationDto) from: RailStationDto;
  @ValidateNested() @Type(() => RailStationDto) to: RailStationDto;
  @IsOptional() @IsString() @MaxLength(60) noteNumber?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Say the day the note was made out as YYYY-MM-DD' }) madeOutOn: string;
  @IsIn(RAIL_LOADS) load: RailLoad;
  @IsOptional() @IsBoolean() dangerous?: boolean;
  @IsArray() @ArrayMaxSize(40) @IsIn(RAIL_PARTICULARS, { each: true }) printed: RailParticular[];
  @IsOptional() @ValidateNested() @Type(() => RailElectronicDto) electronic?: RailElectronicDto;
  @IsOptional() @IsString() @MaxLength(80) documentId?: string;
  @IsOptional() @IsString() @MaxLength(20) containerNo?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(40, { each: true }) seals?: string[];
  @IsOptional() @IsNumber() @Min(0) grossMassKg?: number;
}

/** A draft, checked before it is held: the lane, the load and what is printed. Nothing is written. */
export class RailCheckDto {
  @IsOptional() @IsString() @MaxLength(40) railway?: string;
  @Matches(/^[A-Za-z]{2}$/) from: string;
  @Matches(/^[A-Za-z]{2}$/) to: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) madeOutOn: string;
  @IsIn(RAIL_LOADS) load: RailLoad;
  @IsOptional() @IsBoolean() dangerous?: boolean;
  @IsArray() @ArrayMaxSize(40) @IsIn(RAIL_PARTICULARS, { each: true }) printed: RailParticular[];
  @IsOptional() @ValidateNested() @Type(() => RailElectronicDto) electronic?: RailElectronicDto;
}

export class RailNoteFindingView {
  @ApiProperty({ enum: RAIL_PARTICULARS }) key: RailParticular;
  @ApiProperty() rule: string;
  @ApiProperty({ enum: ['missing', 'ask'] }) kind: 'missing' | 'ask';
  @ApiPropertyOptional({ enum: ['no_documents', 'no_seals', 'nothing_to_pay'] }) unless?: 'no_documents' | 'no_seals' | 'nothing_to_pay';
}

export class RailElectronicFindingView {
  @ApiProperty() code: string;
  @ApiProperty() detail: string;
}

export class RailNoteCheckView {
  @ApiProperty({ enum: RAIL_REGIMES }) regime: RailRegime;
  @ApiProperty({ type: [String] }) rules: string[];
  @ApiPropertyOptional() railway?: string;
  @ApiProperty() checkedOn: string;
  @ApiProperty({ type: [String] }) sources: string[];
  @ApiProperty({ type: [RailNoteFindingView] }) findings: RailNoteFindingView[];
  @ApiProperty({ enum: RAIL_PARTICULARS, isArray: true }) asked: RailParticular[];
  @ApiProperty() complete: boolean;
  @ApiPropertyOptional() notChecked?: string;
  @ApiProperty({ type: [RailElectronicFindingView] }) electronic: RailElectronicFindingView[];
  @ApiProperty({ type: [String] }) limits: string[];
  @ApiProperty({ type: [String] }) claims: string[];
  @ApiProperty({ type: [String] }) caveats: string[];
}

/** One thing printed on the rail note, against our own record of the same box. */
export class RailNoteMatch {
  @ApiProperty({ enum: ['containerNo', 'seals', 'grossMass'] }) field: 'containerNo' | 'seals' | 'grossMass';
  @ApiProperty() printed: string;
  @ApiPropertyOptional() ours?: string;
  @ApiProperty() agrees: boolean;
  /** Why it does not agree, where the printed value is wrong in itself (a container number whose check digit fails). */
  @ApiPropertyOptional() why?: string;
}

export class RailNoteView extends HeldRailNote {
  @ApiProperty({ type: RailNoteCheckView }) check: RailNoteCheckView;
  @ApiProperty({ type: [RailNoteMatch] }) matches: RailNoteMatch[];
  /** How many notes this one replaced — each is kept, never written over. */
  @ApiProperty() replaced: number;
}

export class RailwayRow {
  @ApiProperty() key: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: [String] }) countries: string[];
  @ApiProperty() conditions: string;
  /** Whether we have read what its note must carry. */
  @ApiProperty() particularsChecked: boolean;
}

export class RailwayList {
  @ApiProperty({ type: [RailwayRow] }) items: RailwayRow[];
}
