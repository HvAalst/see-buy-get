import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A COUNTRY'S ZONES, as its company keeps them (2026-11-08 — zone pricing, step 1; the owner: "follow your recommendations").
 *
 * - AREAS: the official areas the country is divided into, imported once from a boundary file (its source, licence and the
 *   credit the licence asks for kept with them). A zone is made of whole areas, so a pin always lands in one area of one zone.
 * - GROUPS: the country's own price groups, in its own words — Urban, Rural and Remote until it says otherwise.
 * - MAPS: numbered versions. One draft is worked on; a version is published from a date, and the one whose date has come
 *   is in force. Old versions are kept: a parcel priced on one will name it.
 *
 * Nothing here prices anything yet. Prices by zone come with each country's price card (step 2), which will name the map
 * version it was made with, so a price never moves because somebody edited a zone.
 */

/** A price group, in the country's own words. Its key never changes; its name may. */
export class ZoneGroup {
  key: string;
  name: string;
}

/** What is kept of a country's areas: their names and shapes, and where they came from. */
export interface StoredAreaSet {
  entityId: string;
  setId: string;
  country: string;
  source: string;
  licence: string;
  attribution: string;
  /** What kind of area they are, in the country's words (wards, districts …). */
  level: string;
  importedAt: string;
  importedBy: string;
  areas: StoredArea[];
}

export interface StoredArea {
  id: string;
  name: string;
  box: [number, number, number, number];
  /** Each polygon as its rings, encoded (zone-geometry.ts encodePolygon). */
  polygons: string[];
  areaKm2: number;
  centre: { lat: number; lng: number };
}

export interface StoredZone {
  code: string;
  name: string;
  group: string;
  /** The ids of the areas it is made of. */
  areas: string[];
  /** The zones it was made from, when it was split off or merged — a code is never reused, so its past can be followed. */
  from?: string[];
  /** Why its group was proposed, where somebody proposed it (a first map made from open data). */
  evidence?: string[];
}

export interface StoredZoneMap {
  version: number;
  status: 'draft' | 'published';
  setId: string;
  zones: StoredZone[];
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
  /** From when it is the country's map (published maps only). */
  effectiveFrom?: string;
}

export interface StoredZoneSetup {
  entityId: string;
  country: string;
  groups: ZoneGroup[];
  maps: StoredZoneMap[];
  /** The next number a new zone's code takes: codes are never reused. */
  nextCode: number;
}

/* ------------------------------------------------------------------ views -- */

export class GeoCentre {
  lat: number;
  lng: number;
}

/** Where a country's areas came from, and the credit their licence asks for — said wherever they are shown. */
export class ZoneAreaSetView {
  setId: string;
  source: string;
  licence: string;
  attribution: string;
  level: string;
  count: number;
  importedAt: string;
  importedBy: string;
}

export class ZoneView {
  code: string;
  name: string;
  /** The key of its price group. */
  group: string;
  /** How many areas it is made of. */
  areas: number;
  areaKm2: number;
  centre: GeoCentre;
  /** How many shops and hubs stand in it now (for the map in force), so a change is weighed against who it touches. */
  @ApiPropertyOptional()
  shops?: number;
  @ApiPropertyOptional()
  hubs?: number;
  @ApiPropertyOptional({ type: [String] })
  from?: string[];
  @ApiPropertyOptional({ type: [String] })
  evidence?: string[];
}

export class ZoneMapView {
  version: number;
  /** draft: being worked on · scheduled: published, from a date still to come · in_force: the map now · past: replaced. */
  @ApiProperty({ enum: ['draft', 'scheduled', 'in_force', 'past'] })
  status: 'draft' | 'scheduled' | 'in_force' | 'past';
  createdAt: string;
  createdBy: string;
  @ApiPropertyOptional()
  publishedAt?: string;
  @ApiPropertyOptional()
  publishedBy?: string;
  @ApiPropertyOptional()
  effectiveFrom?: string;
  areas: ZoneAreaSetView;
  @ApiProperty({ type: [ZoneView] })
  zones: ZoneView[];
}

/** A published version, in one line, for the list of versions. */
export class ZoneMapSummary {
  version: number;
  @ApiProperty({ enum: ['scheduled', 'in_force', 'past'] })
  status: 'scheduled' | 'in_force' | 'past';
  effectiveFrom: string;
  publishedBy: string;
  zones: number;
}

/** A first map proposed for this country, where there is one (zone-proposals): what it is, where it came from, how many. */
export class ZoneProposalView {
  label: string;
  source: string;
  licence: string;
  attribution: string;
  level: string;
  areas: number;
  zones: number;
}

export class ZoneSetupView {
  entityId: string;
  country: string;
  /** Offered to this country's company only, and only where its country has one. */
  @ApiPropertyOptional({ type: ZoneProposalView })
  proposal?: ZoneProposalView;
  @ApiProperty({ type: [ZoneGroup] })
  groups: ZoneGroup[];
  /** The map in force now. */
  @ApiPropertyOptional({ type: ZoneMapView })
  inForce?: ZoneMapView;
  /** Published maps whose date has not come yet. */
  @ApiProperty({ type: [ZoneMapView] })
  scheduled: ZoneMapView[];
  @ApiPropertyOptional({ type: ZoneMapView })
  draft?: ZoneMapView;
  @ApiProperty({ type: [ZoneMapSummary] })
  versions: ZoneMapSummary[];
  /** Shops and hubs of this country whose pin lies in no zone of the map in force: each must be looked at. */
  @ApiProperty({ type: [String] })
  outside: string[];
}

/** One area's shape for the map, and the zone it is in. */
export class ZoneAreaShape {
  id: string;
  name: string;
  zone: string;
  /** Each polygon as one string: its rings as encoded polylines (precision 5), outer first, separated by a space. */
  @ApiProperty({ type: [String] })
  polygons: string[];
}

export class ZoneShapesView {
  version: number;
  setId: string;
  attribution: string;
  @ApiProperty({ type: [ZoneAreaShape] })
  areas: ZoneAreaShape[];
}

/** The zone a shop or a hub stands in, on its country's map in force — what the Shop and Hub apps show. */
export class PlaceZone {
  code: string;
  name: string;
  group: string;
  groupName: string;
  version: number;
}
