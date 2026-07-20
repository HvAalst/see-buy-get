import { IsArray, IsIn, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { TRACKING_EVENT_TYPES, TrackingEventType } from './event-vocabulary';
import { EventSource, ProofOfDeliveryType } from './tracking.types';
import { Severity } from './exception.types';
import { AlertChannel } from './alert.service';

const SOURCES: EventSource[] = ['api', 'mobile', 'manual'];
const POD_TYPES: ProofOfDeliveryType[] = ['signature', 'photo', 'pin'];

export class IngestEventDto {
  @IsString()
  glosShipmentId!: string;

  @IsIn(TRACKING_EVENT_TYPES as unknown as string[])
  type!: TrackingEventType;

  @IsOptional()
  @IsString()
  occurredAt?: string;

  @IsOptional()
  @IsObject()
  location?: { lat: number; lng: number };

  @IsOptional()
  @IsString()
  carrierDid?: string;

  @IsOptional()
  @IsIn(SOURCES)
  source?: EventSource;

  @IsOptional()
  proof?: boolean;
}

export class ConnectorIngestDto {
  @IsObject()
  payload!: Record<string, unknown>;
}

export class RegisterContextDto {
  @IsString()
  glosShipmentId!: string;

  @IsArray()
  legs!: unknown[];

  @IsArray()
  milestones!: unknown[];
}

export class DeliveryDto {
  @IsIn(POD_TYPES)
  type!: ProofOfDeliveryType;

  @IsString()
  ref!: string;

  @IsOptional()
  @IsObject()
  location?: { lat: number; lng: number };
}

export class PositionDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;
}

export class SensorDto {
  @IsIn(['temperature', 'shock'])
  metric!: 'temperature' | 'shock';

  @IsNumber()
  value!: number;
}

export class DeadlineDto {
  @IsString()
  deadline!: string;
}

export class OverrideDto {
  @IsIn(['critical', 'high', 'medium', 'low'])
  severity!: Severity;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  by?: string;
}

export class ReasonDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  by?: string;
}

export class GeofenceDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsObject()
  center?: { lat: number; lng: number };

  @IsOptional()
  @IsNumber()
  radiusM?: number;

  @IsOptional()
  @IsIn(['hub', 'port', 'airport', 'customer', 'custom'])
  kind?: 'hub' | 'port' | 'airport' | 'customer' | 'custom';
}

export class AlertRuleDto {
  @IsIn(['exception', 'delivered'])
  on!: 'exception' | 'delivered';

  @IsOptional()
  @IsIn(['critical', 'high', 'medium', 'low'])
  minSeverity?: Severity;

  @IsOptional()
  @IsString()
  exceptionType?: string;

  @IsOptional()
  @IsString()
  lane?: string;

  @IsArray()
  @IsIn(['in_app', 'email', 'sms', 'webhook'], { each: true })
  channels!: AlertChannel[];

  @IsString()
  label!: string;
}

export class WebhookDto {
  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];
}
