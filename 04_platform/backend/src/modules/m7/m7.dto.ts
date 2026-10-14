import { ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class GeoPointDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;
}

export class DisruptionSignalDto {
  @IsOptional()
  @IsIn(['port_strike', 'weather', 'unrest', 'congestion', 'carrier_failure'])
  type?: 'port_strike' | 'weather' | 'unrest' | 'congestion' | 'carrier_failure';

  @IsString()
  zone!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  center?: GeoPointDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  radiusKm?: number;

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  severity?: 'low' | 'medium' | 'high';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}

export class PolicyDto {
  @IsString()
  shipperDid!: string;

  @IsNumber()
  @Min(0)
  ifDelayHoursGt!: number;

  @IsNumber()
  @Min(0)
  ifExtraCostLt!: number;

  @IsIn(['reroute', 'wait', 'split_air', 'rebook_fastest'])
  thenAction!: 'reroute' | 'wait' | 'split_air' | 'rebook_fastest';
}

export class RawSignalDto {
  @IsOptional()
  @IsString()
  source?: string;

  @IsString()
  zone!: string;

  @IsString()
  headline!: string;

  @IsOptional()
  @IsIn(['port_strike', 'weather', 'unrest', 'congestion', 'carrier_failure'])
  type?: 'port_strike' | 'weather' | 'unrest' | 'congestion' | 'carrier_failure';

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  severity?: 'low' | 'medium' | 'high';

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  center?: GeoPointDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  radiusKm?: number;

  @IsOptional()
  @IsString()
  externalId?: string;
}

export class ScenarioDisruptionDto {
  @IsOptional()
  @IsIn(['port_strike', 'weather', 'unrest', 'congestion', 'carrier_failure'])
  type?: 'port_strike' | 'weather' | 'unrest' | 'congestion' | 'carrier_failure';

  @IsString()
  zone!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  center?: GeoPointDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  radiusKm?: number;

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  severity?: 'low' | 'medium' | 'high';
}

export class ScenarioDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ScenarioDisruptionDto)
  disruptions!: ScenarioDisruptionDto[];
}

export class ExecuteActionDto {
  @IsString()
  glosShipmentId!: string;

  @IsIn(['reroute', 'wait', 'split_air', 'rebook_fastest'])
  action!: 'reroute' | 'wait' | 'split_air' | 'rebook_fastest';

  @IsOptional()
  @IsString()
  disruptionId?: string;

  @IsOptional()
  @IsString()
  policyId?: string;
}
