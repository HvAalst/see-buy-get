import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { SiteWeek } from './fleet-site.types';
import { GeoPoint } from './pudo.types';

/**
 * WHEN A HUB IS OPEN, AND HOW TO REACH IT (the user, 2026-10-26: "hub has open hours as well? and a contact page for
 * anyone (drivers) wanting to contact the hub"). A hub had a pin, an address and a number staff ring — and no opening
 * hours, and nothing a driver at its gate, or a store bringing it a pallet, could read to find somebody there.
 *
 * ITS OWN WORD, AND A PUBLISHED ONE. Its owner writes it; staff and the hub's people change nothing in it. It rides on
 * the hub's public page (seebuyget.com/@handle), on a driver's stop at the hub, and on a store's hand-in — so the screens
 * that ask for it say that it is published. The number is the hub's desk, never the number it signs in with. As a
 * company's contact card, what is checked is the shape, never the choice: nobody rings the number.
 */
export interface HubContact {
  mdpId: string;
  /** When it is open, Sunday to Saturday, on its own clock. Absent: not said. */
  openingHours?: SiteWeek;
  /** The number a driver or a store rings: the hub's desk or its gate. */
  phone?: string;
  /** A second number: the gate and the office are often different telephones. */
  phoneAlt?: string;
  /** Who to ask for — "the floor lead", "Grace at the gate". A role or a name, as the hub prefers. */
  askFor?: string;
  /** Where to come in, in the words a driver needs: "Gate 2, behind the market, ring at the blue door". */
  gate?: string;
  email?: string;
  /**
   * Its number and gate on its public page too, for anyone (the user, 2026-10-26: "public if the hub ticks it, but the
   * phone number under a button that opens the phone app"). Off until it ticks it: the page shows its hours either way,
   * and those working with the hub — a driver with a bag to or from it, a store booked to it — see how to reach it in
   * their app regardless.
   */
  publish?: boolean;
  saidAt: string;
  saidBy: string;
}

/** Open now on the hub's clock — or when it next opens, within the week. */
export class HubOpenNow {
  open: boolean;
  /** Open: until when today (HH:MM). */
  @ApiPropertyOptional() until?: string;
  /** Closed: the day it next opens (sun … sat), at what time, and whether that is later today. Absent: not this week. */
  @ApiPropertyOptional() opensDay?: string;
  @ApiPropertyOptional() opensAt?: string;
  @ApiPropertyOptional() opensToday?: boolean;
}

/** A hub as a driver meets it at a stop: whether it is open, and how to reach somebody there. */
export class HubAtStop {
  mdpId: string;
  name: string;
  /** Its public page: seebuyget.com/@handle. */
  @ApiPropertyOptional() handle?: string;
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() askFor?: string;
  @ApiPropertyOptional() gate?: string;
  @ApiPropertyOptional({ type: SiteWeek }) openingHours?: SiteWeek;
  /** Absent where it keeps no opening hours, or its country keeps more than one clock. */
  @ApiPropertyOptional({ type: HubOpenNow }) openNow?: HubOpenNow;
}

/** The hub's own reading of its entry, and what anybody sees of it. */
export class HubContactView extends HubAtStop {
  @ApiProperty({ type: GeoPoint }) location: GeoPoint;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional() phoneAlt?: string;
  @ApiPropertyOptional() email?: string;
  /** Its clock, and the name of it. Absent: a country of several clocks. */
  @ApiPropertyOptional() zone?: string;
  @ApiPropertyOptional() zoneName?: string;
  /** Whether its number and gate are on its public page, for anyone. */
  @ApiPropertyOptional() publish?: boolean;
  @ApiPropertyOptional() saidAt?: string;
  @ApiPropertyOptional() saidBy?: string;
  /** Said on every screen that shows it: the hub's own claim, published, and nobody checked it. */
  basis: string;
}

/**
 * A HUB ON ITS PUBLIC PAGE: when it is open, and whether it is now — and its number and gate only where it ticked that
 * they go there. The number is shown as a button that opens the phone app, never printed.
 */
export class HubOnPage {
  @ApiPropertyOptional({ type: SiteWeek }) openingHours?: SiteWeek;
  @ApiPropertyOptional({ type: HubOpenNow }) openNow?: HubOpenNow;
  @ApiPropertyOptional() zoneName?: string;
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() phoneAlt?: string;
  @ApiPropertyOptional() askFor?: string;
  @ApiPropertyOptional() gate?: string;
  basis: string;
}

/**
 * The hub's owner writes its entry. A MERGE: a field left out stays as it was; an empty one is taken away; hours sent as
 * null are taken away.
 */
export class SetHubContactDto {
  /** { sun: null, mon: { open: '07:00', close: '18:00' }, … }. Null clears them. */
  @IsOptional() @IsObject() openingHours?: Record<string, { open: string; close: string } | null> | null;
  @IsOptional() @IsString() @MaxLength(24) phone?: string;
  @IsOptional() @IsString() @MaxLength(24) phoneAlt?: string;
  @IsOptional() @IsString() @MaxLength(80) askFor?: string;
  @IsOptional() @IsString() @MaxLength(160) gate?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  /** Its number and gate on its public page too. */
  @IsOptional() @IsBoolean() publish?: boolean;
}
