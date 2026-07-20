import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, Min, ValidateNested } from 'class-validator';
import { DisputeTag, MilestoneName } from './escrow.types';

const MILESTONES: MilestoneName[] = ['PICKUP', 'HANDOVER', 'DELIVERY'];
const TAGS: DisputeTag[] = ['damage', 'delay', 'documentation', 'payment'];

class MilestoneTermDto {
  @IsIn(MILESTONES) name!: MilestoneName;
  @IsNumber() @IsPositive() percent!: number;
  @IsString() payeeDid!: string;
}

export class CreateEscrowDto {
  @IsString() glosShipmentId!: string;
  @IsString() payerDid!: string;
  @IsString() currency!: string;
  @IsNumber() @IsPositive() totalAmount!: number;

  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => MilestoneTermDto)
  milestones!: MilestoneTermDto[];

  @IsOptional() @IsBoolean() requireAcceptance?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(0.5) commissionRate?: number;
  @IsOptional() @IsBoolean() staged?: boolean;
  @IsOptional() @IsString() deadline?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) latePenaltyPct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) earlyBonusPct?: number;
}

export class FundDto {
  @IsOptional() @IsIn(MILESTONES) milestone?: MilestoneName;
}

export class FileDisputeDto {
  @IsIn(MILESTONES) milestone!: MilestoneName;
  @IsIn(TAGS) tag!: DisputeTag;
  @IsString() reason!: string;
  @IsString() filedByDid!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) evidenceRefs?: string[];
}

export class ResolveDisputeDto {
  @IsInt() @Min(1) @Max(3) level!: 1 | 2 | 3;
  @IsOptional() @IsNumber() @Min(0) @Max(100) payeeSplitPct?: number;
  @IsOptional() @IsString() atFaultDid?: string;
  @IsOptional() @IsBoolean() atFault?: boolean;
  @IsOptional() @IsString() note?: string;
}
