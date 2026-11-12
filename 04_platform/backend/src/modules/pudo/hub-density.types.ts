import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import type { GeoPoint } from './pudo.types';

/*
 * 2026-11-12 — WHERE HUBS ARE NEEDED (the owner, 2026-11-11: "each country staff should have a part in their system where they
 * have a hub density optimiser on a map. It would show them where hubs are needed or needed extra"; the plan "Hubs on the
 * Road", step 3, D6 and D7 as recommended). What a country's staff read, and what they send.
 */

/** How far a zone's shops may be from a hub, by its group (D6): Kenya starts at urban 15 km, rural 60, remote 150. */
export class DensityReach {
  urban!: number;
  rural!: number;
  remote!: number;
}

export const DENSITY_COVERAGE = ['near', 'far', 'too_far'] as const;
export type DensityCoverage = (typeof DENSITY_COVERAGE)[number];

export class DensityZone {
  code!: string;
  name!: string;
  group!: string;
  @ApiProperty() centre!: GeoPoint;
  /** Shops standing in it. */
  shops!: number;
  /** Parcels handed in at its shops, and for its shops, in the last 30 days. */
  sent30!: number;
  received30!: number;
  /** The farthest of its shops from the nearest hub serving it, by road (its centre where it has no shop). */
  @ApiPropertyOptional() km?: number;
  @ApiPropertyOptional() nearestHub?: string;
  @ApiPropertyOptional() nearestHubName?: string;
  /** A hub serves it (on the Zones screen). */
  served!: boolean;
  /** Near: within its group's reach; far: within twice it; too far: beyond. */
  @ApiProperty({ enum: DENSITY_COVERAGE }) coverage!: DensityCoverage;
}

export class DensityHub {
  mdpId!: string;
  name!: string;
  @ApiProperty() location!: GeoPoint;
  /** On the road map in force: a stop, or local only. */
  @ApiPropertyOptional({ enum: ['stop', 'local'] }) role?: 'stop' | 'local';
  down!: boolean;
  /** Days of the last 14 it ran full: its day's sorting reached, or a bag held for room. */
  fullDays!: number;
  /** Parcels it sorted a day, over the last 14. */
  sortedPerDay!: number;
  @ApiPropertyOptional() sortPerDay?: number;
  @ApiPropertyOptional() bagPlaces?: number;
  /** Bags waiting for room on its floor now. */
  waiting!: number;
}

export class DensityLink {
  a!: string;
  b!: string;
}

export const SUGGESTION_KINDS = ['hub_needed', 'extra_hub', 'too_close', 'road_gap', 'bottleneck'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export class SuggestionPlace {
  /** A known town, where one is near. */
  @ApiPropertyOptional() name?: string;
  lat!: number;
  lng!: number;
}

/** The numbers a suggestion stands on: only those its kind has. */
export class SuggestionNumbers {
  @ApiPropertyOptional() shops?: number;
  @ApiPropertyOptional() parcels?: number;
  /** How far by road its shops are from the nearest hub. */
  @ApiPropertyOptional() km?: number;
  /** How far they may be, by their zone's group. */
  @ApiPropertyOptional() reach?: number;
  @ApiPropertyOptional() fullDays?: number;
  @ApiPropertyOptional() days?: number;
  /** Parcels a day from the zones it serves, against what it says it sorts. */
  @ApiPropertyOptional() ratio?: number;
  /** Two hubs apart, by road. */
  @ApiPropertyOptional() apart?: number;
  /** The country's minimum distance between two stops. */
  @ApiPropertyOptional() min?: number;
  /** A bottleneck: its sort fee, the country's list figure, and how many times that it charges (the higher of sort and pass-on). */
  @ApiPropertyOptional() fee?: number;
  @ApiPropertyOptional() list?: number;
}

export class HubSuggestion {
  /** Stable while what it is about is: its row on the hub list is kept by it. */
  id!: string;
  @ApiProperty({ enum: SUGGESTION_KINDS }) kind!: SuggestionKind;
  /** How strongly it is suggested: a row rejected on the hub list is open again once this doubles. */
  score!: number;
  @ApiProperty({ type: SuggestionPlace }) place!: SuggestionPlace;
  @ApiProperty({ type: [String] }) zones!: string[];
  @ApiProperty({ type: [String] }) zoneNames!: string[];
  @ApiProperty({ type: [String] }) hubs!: string[];
  @ApiProperty({ type: [String] }) hubNames!: string[];
  @ApiProperty({ type: SuggestionNumbers }) numbers!: SuggestionNumbers;
  /** A gap on the road: the known towns on the way between the two hubs. */
  @ApiProperty({ type: [String] }) towns!: string[];
}

export class HubDensityView {
  entityId!: string;
  country!: string;
  /** The zone map in force; absent where the country has none yet. */
  @ApiPropertyOptional() mapVersion?: number;
  @ApiProperty({ type: DensityReach }) reach!: DensityReach;
  @ApiProperty({ type: DensityReach }) reachStart!: DensityReach;
  @ApiProperty({ type: [DensityZone] }) zones!: DensityZone[];
  @ApiProperty({ type: [DensityHub] }) hubs!: DensityHub[];
  /** Roads between stops: the road map in force, else the one being looked at, else the proposal. */
  @ApiProperty({ type: [DensityLink] }) links!: DensityLink[];
  roadMapInForce!: boolean;
  /** What it suggests, most strongly first. */
  @ApiProperty({ type: [HubSuggestion] }) suggestions!: HubSuggestion[];
}

export class DensityReachDto {
  @IsInt() @Min(1) @Max(1000) urban!: number;
  @IsInt() @Min(1) @Max(1000) rural!: number;
  @IsInt() @Min(1) @Max(1000) remote!: number;
}
