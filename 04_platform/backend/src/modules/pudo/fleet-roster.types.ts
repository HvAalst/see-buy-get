import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * WHO DRIVES ON A DAY — the fleet office's word, kept per day.
 *
 * The day plan counted every active driver of a fleet as somebody to send out, so a fleet with seven drivers and three
 * of them off planned seven trucks' worth of work. The office now says who drives on a day, and the plan counts those.
 *
 * It is a planning fact and nothing more: no hours, no pay, no contract — the network does not do employment (the
 * payable is the fleet). And it opens and closes nothing: a driver who is not on it can still start a shift, because
 * the plan follows the vehicle, and whoever is in it drives its trips.
 */
export interface RosterDay {
  fleetDid: string;
  day: string;
  /** The drivers the office said drive that day. A driver who has since left the fleet, or is no longer active, is not counted. */
  driverDids: string[];
  /** Where a driver starts that day, where it is not their home site: driver → site. */
  starts?: Record<string, string>;
  /** Which shift of that site they start on, where the office said: driver → shift. */
  shifts?: Record<string, string>;
  setAt: string;
  setBy: string;
}

export class RosterDriverView {
  driverDid: string;
  name: string;
  rostered: boolean;
  /** The site they start from that day: their home site, unless the office said another for the day. */
  siteId: string;
  /** The site they work from. */
  homeSiteId: string;
  /** The shift of that site they start on: the one the office said, else the site's first. Absent: the site has no shifts. */
  @ApiPropertyOptional() shiftId?: string;
}

/** A fleet's day as the office reads its roster: who drives, and where that comes from. */
export class RosterView {
  day: string;
  /** `roster` — the office said who drives that day · `everyone` — it has not, so a plan counts every active driver. */
  @ApiProperty({ enum: ['roster', 'everyone'] }) source: 'roster' | 'everyone';
  /** How many drivers a plan for the day counts. */
  drivers: number;
  /** Every active driver of the fleet, and whether they drive that day. */
  @ApiProperty({ type: [RosterDriverView] }) list: RosterDriverView[];
  /** When the office last said, and who. Absent when it never has for this day. */
  @ApiPropertyOptional() setAt?: string;
  @ApiPropertyOptional() setBy?: string;
}

export class DriverRosterDay {
  day: string;
  rostered: boolean;
}

/** A driver's own days: each coming day their fleet has said who drives, and whether they do. */
export class DriverRosterView {
  /** Their fleet. Absent for a driver in no fleet, who has no roster. */
  @ApiPropertyOptional() fleetName?: string;
  @ApiProperty({ type: [DriverRosterDay] }) days: DriverRosterDay[];
}
