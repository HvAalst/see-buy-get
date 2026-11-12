import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import type { GeoPoint } from './pudo.types';

/* 2026-11-12 — a country's road map of hubs (the plan "Hubs on the Road", step 2): what its staff and each hub read, and what staff send. */

export class RoadMapHub {
  mdpId!: string;
  name!: string;
  @ApiProperty() location!: GeoPoint;
  @ApiPropertyOptional() bagPlaces?: number;
  /** Down now: left out of the map in force while it is. */
  down!: boolean;
}

export class RoadNeighbour {
  mdpId!: string;
  name!: string;
  km!: number;
}

export class RoadStopView {
  mdpId!: string;
  name!: string;
  @ApiProperty({ type: [RoadNeighbour] }) neighbours!: RoadNeighbour[];
}

export class RoadLocalView {
  mdpId!: string;
  name!: string;
  /** The stop that carries its through parcels: the nearest. */
  via!: string;
  viaName!: string;
  km!: number;
}

export class RoadPairView {
  a!: string;
  b!: string;
  aName!: string;
  bName!: string;
  km!: number;
}

export class RoadPlanView {
  @ApiProperty({ type: [RoadStopView] }) stops!: RoadStopView[];
  @ApiProperty({ type: [RoadLocalView] }) local!: RoadLocalView[];
  @ApiProperty({ type: [RoadPairView] }) links!: RoadPairView[];
  /** How many pieces it is in: one, or some stops cannot reach the others. */
  pieces!: number;
  /** Stops nearer than the minimum distance. */
  @ApiProperty({ type: [RoadPairView] }) tooClose!: RoadPairView[];
  minKm!: number;
  @ApiPropertyOptional() by?: string;
  @ApiPropertyOptional() at?: string;
  @ApiPropertyOptional() confirmedBy?: string;
  @ApiPropertyOptional() confirmedAt?: string;
}

/** A country's road map of hubs, for its staff: the system's proposal, the one being changed, and the one in force. */
export class RoadMapView {
  entityId!: string;
  country!: string;
  minKm!: number;
  /** The figure the country starts from. */
  minKmStart!: number;
  @ApiProperty({ type: [RoadMapHub] }) hubs!: RoadMapHub[];
  @ApiProperty({ type: RoadPlanView }) proposal!: RoadPlanView;
  @ApiPropertyOptional({ type: RoadPlanView }) draft?: RoadPlanView;
  @ApiPropertyOptional({ type: RoadPlanView }) confirmed?: RoadPlanView;
  /** Approved since the map in force was confirmed: carried as local hubs of their nearest stop until staff confirm again. */
  @ApiProperty({ type: [String] }) joined!: string[];
  /** In the map in force, and no longer approved: left out, their neighbours each other's. */
  @ApiProperty({ type: [String] }) left!: string[];
}

/** A far hub's own bin: whole bags for it, by the next stop on the road (D4). */
export class ThroughBin {
  mdpId!: string;
  name!: string;
  via!: string;
  viaName!: string;
}

/** A hub's place on the road, for its own screen. */
export class HubRoadView {
  mdpId!: string;
  /** Its country's road map is confirmed. */
  inForce!: boolean;
  /** …and its price card is in force: parcels go along the road map now, and its floor's bins are these (D3). */
  routing!: boolean;
  @ApiPropertyOptional({ enum: ['stop', 'local'] }) role?: 'stop' | 'local';
  /** Local only: the stop that carries its through parcels. */
  @ApiPropertyOptional({ type: RoadNeighbour }) via?: RoadNeighbour;
  /** A stop: its neighbours on the road — one bin towards each, and its own shops. */
  @ApiProperty({ type: [RoadNeighbour] }) neighbours!: RoadNeighbour[];
  /** 2026-11-12 — its bins for far hubs, a whole bag each (D4), with the stop it goes by. */
  @ApiProperty({ type: [ThroughBin] }) throughBins!: ThroughBin[];
}

export class RoadMapRoleDto {
  @IsIn(['stop', 'local']) role!: 'stop' | 'local';
}

export class RoadMapLinkDto {
  @IsString() @MaxLength(80) a!: string;
  @IsString() @MaxLength(80) b!: string;
  @IsBoolean() on!: boolean;
}

export class RoadMapMinKmDto {
  @IsInt() @Min(1) @Max(1000) km!: number;
}

