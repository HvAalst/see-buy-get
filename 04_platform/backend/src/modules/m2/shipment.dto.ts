import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PartyRole, TransportMode } from './shipment.types';

const MODES: TransportMode[] = ['road', 'rail', 'air', 'ocean', 'courier', 'multimodal'];
const ROLES: PartyRole[] = ['shipper', 'consignee', 'carrier', 'notify'];

class PartyDto {
  @IsIn(ROLES)
  role!: PartyRole;

  @IsString()
  did!: string;
}

class DeliveryWindowDto {
  @IsString()
  from!: string;

  @IsString()
  to!: string;
}

export class CreateShipmentDto {
  @IsString()
  origin!: string;

  @IsString()
  destination!: string;

  @IsNumber()
  @IsPositive()
  totalWeightKg!: number;

  @IsInt()
  @IsPositive()
  packageCount!: number;

  @IsOptional()
  @IsIn(MODES)
  mode?: TransportMode;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryWindowDto)
  deliveryWindow?: DeliveryWindowDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartyDto)
  parties?: PartyDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  handlingCodes?: string[];

  @IsOptional()
  @IsObject()
  goods?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  references?: Record<string, string>;

  @IsOptional()
  @IsString()
  shipperRef?: string;
}

export class EnrichShipmentDto {
  @IsOptional()
  @IsObject()
  goods?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  handlingCodes?: string[];

  @IsOptional()
  @IsObject()
  references?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartyDto)
  parties?: PartyDto[];
}

export class BatchIngestDto {
  @IsOptional()
  @IsArray()
  items?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  csv?: string;
}

export class ViaPluginDto {
  @IsObject()
  order!: Record<string, unknown>;
}

export class SaveTemplateDto {
  @IsString()
  name!: string;

  @IsObject()
  fields!: Record<string, unknown>;
}

export class LabelOverlayDto {
  @IsString() barcode!: string;
  @IsOptional() @IsString() carrierDid?: string;
  @IsOptional() @IsString() routing?: string;
}

export class AssignCarrierDto {
  @IsString() carrierDid!: string;
}

export class LegConstraintDto {
  @IsString() code!: string;
  @IsString() requesterDid!: string;
}

export class ProposeTermsDto {
  @IsString() fromDid!: string;
  @IsNumber() @IsPositive() price!: number;
  @IsString() currency!: string;
  @IsOptional() @IsString() note?: string;
}

export class AcceptTermsDto {
  @IsString() byDid!: string;
  @IsString() proposalId!: string;
}

export class SaveRouteDto {
  @IsString() name!: string;
  @IsArray() legs!: Record<string, unknown>[];
}
