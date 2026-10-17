import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayHours, GeoPoint } from './pudo.types';

/**
 * A FLEET'S SITES — the depots and yards its trucks and drivers work from.
 *
 * A fleet had one depot, typed when it signed up and never changed, and the day plan started every truck there. A
 * fleet that works from Nairobi and Mombasa planned its Mombasa trucks out of Nairobi. Now a fleet keeps its own sites —
 * its own record, which only its office changes (staff read it) — and the depot it signed up with is the first of them,
 * until the office changes it. Every truck and driver works from one site (its home); the roster can say a driver
 * starts somewhere else for a day.
 *
 * A site says what the plan needs to know about it, and nothing more: where it is, when it is open for loading, how
 * many trucks can load there at once, and the shifts drivers start on. Not who works there for what pay — the network
 * does not do employment — and not its stock: a site is where trucks start from, not a warehouse.
 */

/** The depot a fleet signed up with: a site from the start, under this id, until the office changes it or closes it. */
export const DEPOT_SITE = 'depot';
export const MAX_SITES = 50;
export const MAX_SHIFTS = 6;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** When a site is open for loading, day by day. A day left out, or null, is a day it is closed. */
export class SiteWeek {
  @ApiPropertyOptional({ type: DayHours, nullable: true }) mon?: DayHours | null;
  @ApiPropertyOptional({ type: DayHours, nullable: true }) tue?: DayHours | null;
  @ApiPropertyOptional({ type: DayHours, nullable: true }) wed?: DayHours | null;
  @ApiPropertyOptional({ type: DayHours, nullable: true }) thu?: DayHours | null;
  @ApiPropertyOptional({ type: DayHours, nullable: true }) fri?: DayHours | null;
  @ApiPropertyOptional({ type: DayHours, nullable: true }) sat?: DayHours | null;
  @ApiPropertyOptional({ type: DayHours, nullable: true }) sun?: DayHours | null;
}

/** A shift drivers start on at a site: its name, when it starts, and how long it may be. */
export class SiteShift {
  shiftId: string;
  name: string;
  /** HH:MM on the fleet's clock. */
  start: string;
  hours: number;
}

/** A site as it is kept. */
export interface FleetSite {
  siteId: string;
  fleetDid: string;
  name: string;
  location: GeoPoint;
  address?: string;
  /** Open for loading. Absent: it never closes. */
  hours?: SiteWeek;
  /** How many trucks load there at once. Absent: the office has not said, and a plan counts none — as many load as come. */
  loadingBays?: number;
  shifts: SiteShift[];
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
  closedAt?: string;
  closedBy?: string;
}

export class FleetSiteView {
  siteId: string;
  name: string;
  location: GeoPoint;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional({ type: SiteWeek }) hours?: SiteWeek;
  /** Absent: not said — as many load at once as come. */
  @ApiPropertyOptional() loadingBays?: number;
  @ApiProperty({ type: [SiteShift] }) shifts: SiteShift[];
  /** The depot the fleet signed up with. */
  main: boolean;
  /** How many of the fleet's vehicles, and of its active drivers, work from here. */
  vehicles: number;
  drivers: number;
}

/** A vehicle or driver, and the site it works from. */
export class SiteHome {
  id: string;
  /** Its plate, or the driver's name. */
  name: string;
  siteId: string;
}

/** A fleet's sites, and who works from where. */
export class FleetSitesView {
  @ApiProperty({ type: [FleetSiteView] }) sites: FleetSiteView[];
  @ApiProperty({ type: [SiteHome] }) vehicles: SiteHome[];
  @ApiProperty({ type: [SiteHome] }) drivers: SiteHome[];
}
