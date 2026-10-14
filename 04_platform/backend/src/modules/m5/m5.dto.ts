import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DisputeTag } from './reputation.types';

const DISPUTE_TAGS: DisputeTag[] = ['damage', 'delay', 'documentation', 'payment'];

export class SubmitRatingDto {
  @IsString()
  glosShipmentId!: string;

  @IsString()
  raterDid!: string;

  @IsOptional() @IsIn(['yes', 'late']) onTime?: 'yes' | 'late';
  @IsOptional() @IsIn(['pristine', 'damaged']) cargoCare?: 'pristine' | 'damaged';
  @IsOptional() @IsInt() @Min(1) @Max(5) communication?: number;
  @IsOptional() @IsIn(['accurate', 'issues']) documentation?: 'accurate' | 'issues';
  @IsOptional() @IsIn(['compliant', 'noncompliant']) equipment?: 'compliant' | 'noncompliant';

  @IsOptional() @IsIn(['prompt', 'late']) paymentPromptness?: 'prompt' | 'late';
  @IsOptional() @IsIn(['ready', 'delayed']) loadReadiness?: 'ready' | 'delayed';
  @IsOptional() @IsIn(['accurate', 'inaccurate']) informationAccuracy?: 'accurate' | 'inaccurate';
  @IsOptional() @IsInt() @Min(1) @Max(5) facilityAccessibility?: number;

  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsBoolean() private?: boolean;
  @IsOptional() @IsBoolean() forceMajeure?: boolean;
}

export class DisputeDto {
  @IsIn(DISPUTE_TAGS)
  tag!: DisputeTag;

  @IsBoolean()
  atFault!: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ChallengeDto {
  @IsString()
  ratingId!: string;
}

export class ExportDto {
  @IsIn(['carrier', 'shipper'])
  role!: 'carrier' | 'shipper';
}
