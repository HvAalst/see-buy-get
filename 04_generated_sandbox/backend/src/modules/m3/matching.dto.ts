import { ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class BroadcastDto {
  @IsString()
  did!: string;

  @IsString()
  zone!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  equipment?: string[];

  @IsOptional()
  @IsIn(['available', 'busy'])
  status?: 'available' | 'busy';
}

export class DemandDto {
  @IsString()
  glosShipmentId!: string;

  @IsString()
  payerDid!: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  zone?: string;

  @IsOptional()
  @IsObject()
  slo?: Record<string, unknown>;
}

export class BatchDto {
  @IsOptional()
  @IsIn(['instant', 'batch'])
  window?: 'instant' | 'batch';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DemandDto)
  demands!: DemandDto[];
}

export class ForceAssignDto {
  @IsString()
  carrierDid!: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  by?: string;
}

export class BlockDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  by?: string;
}
