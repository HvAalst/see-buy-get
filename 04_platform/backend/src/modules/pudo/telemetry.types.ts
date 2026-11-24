import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Who sends a vehicle's positions: our Driver app, or the fleet's own system by key (the owner's brief, feature 4). */
export const TELEMATICS_PROVIDERS = ['DRIVER_APP_GPS', 'WEBFLEET', 'TRIMBLE', 'TRANSICS', 'CUSTOM_WEBHOOK'] as const;
export type TelematicsProvider = (typeof TELEMATICS_PROVIDERS)[number];

/** Where a watched run stands with Romania: not there yet, in it, in it and silent, or done. */
export type RoTransitStatus = 'PENDING_BORDER' | 'ACTIVE_IN_RO' | 'SIGNAL_LOST' | 'COMPLETED';
/** Why a watch ended. */
export type TelemetryClosedBy = 'left_romania' | 'delivered' | 'handed_over' | 'shift_ended' | 'never_entered';

/** RO e-Transport wants positions at most 2 minutes apart (ANAF's interface notes, 2024); a longer silence is kept as a gap. */
export const RO_PING_GAP_MIN = 2;
/** The owner's brief: a silence of 15 minutes in Romania alerts the driver and the office. */
export const RO_SIGNAL_LOST_MIN = 15;
/** Readings outside before a vehicle is called out of Romania: one near the line may read either side. */
export const RO_OUTSIDE_READINGS = 3;
/** How near Romania a watched vehicle starts sending a position every minute, in km. */
export const RO_REACH_KM = 50;
/** Positions are kept this many days after a watch ends, then deleted (legal.html L74). */
export const TELEMETRY_KEEP_DAYS = 90;
/** The most positions kept for one watch: a minute apart, about two weeks. */
export const TELEMETRY_MAX_PINGS = 20_000;

/** A silence in Romania: from the last position heard to the next, in minutes. */
export class TelemetryGap {
  @ApiProperty() from: string;
  @ApiPropertyOptional() to?: string;
  @ApiPropertyOptional() minutes?: number;
}

/** A UIT on a load the vehicle carries, as the watch keeps it for the fleet's system to read. */
export class TelemetryUit {
  @ApiProperty() code: string;
  @ApiProperty() freightId: string;
  @ApiProperty() freightCode: string;
  @ApiPropertyOptional() validThrough?: string;
}

/**
 * 2026-11-24 — A RUN WATCHED FOR RO e-TRANSPORT (the owner's brief, feature 4: "TransportTelemetrySession"): a vehicle on a shift
 * carrying a load with a UIT, or anything between two countries, from the moment it is watched until it is out of Romania, has
 * delivered, has handed over, or its shift ends. SeeBuyGet watches; the carrier sends the positions to ANAF through its
 * registered provider or ANAF's own app (the owner's answer, 2026-11-24).
 */
export class TransportTelemetrySession {
  @ApiProperty() sessionId: string;
  @ApiProperty() driverDid: string;
  @ApiProperty() vehicleId: string;
  @ApiProperty() plate: string;
  @ApiPropertyOptional() trailerPlate?: string;
  @ApiPropertyOptional() fleetDid?: string;
  @ApiProperty({ type: [TelemetryUit] }) uitCodes: TelemetryUit[];
  @ApiProperty({ enum: TELEMATICS_PROVIDERS }) provider: TelematicsProvider;
  @ApiProperty({ enum: ['PENDING_BORDER', 'ACTIVE_IN_RO', 'SIGNAL_LOST', 'COMPLETED'] }) roStatus: RoTransitStatus;
  @ApiProperty() startedAt: string;
  @ApiPropertyOptional() enteredRoAt?: string;
  @ApiPropertyOptional() leftRoAt?: string;
  @ApiPropertyOptional() closedAt?: string;
  @ApiPropertyOptional({ enum: ['left_romania', 'delivered', 'handed_over', 'shift_ended', 'never_entered'] }) closedBy?: TelemetryClosedBy;
  @ApiPropertyOptional() lastPingAt?: string;
  @ApiPropertyOptional() lastCountry?: string;
  @ApiProperty() outsideStreak: number;
  @ApiProperty({ type: [TelemetryGap] }) gaps: TelemetryGap[];
  @ApiProperty() pings: number;
  @ApiPropertyOptional() longestGapMin?: number;
}

/** One position of a watched run (the brief's "TelemetryPing"). */
export interface TelemetryPing {
  lat: number;
  lng: number;
  speedKmh?: number;
  heading?: number;
  /** RO from Romania's outline; elsewhere the nearest place's country, where one is known. */
  country?: string;
  recordedAt: string;
  source: TelematicsProvider;
}

/** What the Driver app is told of its watch with each position it sends. */
export class TelemetryDriverView {
  @ApiProperty({ enum: ['PENDING_BORDER', 'ACTIVE_IN_RO', 'SIGNAL_LOST', 'COMPLETED'] }) roStatus: RoTransitStatus;
  @ApiProperty({ enum: TELEMATICS_PROVIDERS }) provider: TelematicsProvider;
  /** Send a position every minute: in Romania, or within RO_REACH_KM of it. */
  @ApiProperty() everyMinute: boolean;
  @ApiPropertyOptional() lastPingAt?: string;
  @ApiPropertyOptional() enteredRoAt?: string;
}
