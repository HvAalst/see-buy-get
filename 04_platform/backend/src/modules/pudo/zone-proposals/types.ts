/**
 * A first zone map proposed to one country's company (2026-11-08): its official areas, grouped into zones, each with the
 * group proposed for it and the evidence for that group. A country's own data, for that country alone: the table in
 * index.ts is keyed by country, and a country absent from it is offered nothing.
 */
export interface ZoneProposal {
  country: string;
  label: string;
  source: string;
  licence: string;
  attribution: string;
  level: string;
  /** Each area with its polygons encoded as the server keeps them (zone-geometry.ts encodePolygon). */
  areas: Array<{ name: string; polygons: string[] }>;
  /** Each zone by the indexes of its areas; `group` is a key of the starting groups (urban, rural, remote). */
  zones: Array<{ name: string; group: string; areas: number[]; evidence: string[] }>;
}
