import type { MessageKey } from '../../shared/i18n';
import { UPLOAD_LIMITS } from '../../shared/upload';

/**
 * A COUNTRY'S ZONES, the console's half (2026-11-08 — zone pricing, step 1). The views mirror the server's
 * zone-map.types.ts; the helpers below are pure so the screen's words and checks can be tested without drawing it.
 */

export interface ZoneGroup {
  key: string;
  name: string;
}

export interface ZoneAreaSet {
  setId: string;
  source: string;
  licence: string;
  attribution: string;
  level: string;
  count: number;
  importedAt: string;
  importedBy: string;
}

export interface ZoneRow {
  code: string;
  name: string;
  group: string;
  areas: number;
  areaKm2: number;
  centre: { lat: number; lng: number };
  shops?: number;
  hubs?: number;
  from?: string[];
  evidence?: string[];
}

export type ZoneMapStatus = 'draft' | 'scheduled' | 'in_force' | 'past';

export interface ZoneMap {
  version: number;
  status: ZoneMapStatus;
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
  publishedBy?: string;
  effectiveFrom?: string;
  areas: ZoneAreaSet;
  zones: ZoneRow[];
}

export interface ZoneVersion {
  version: number;
  status: Exclude<ZoneMapStatus, 'draft'>;
  effectiveFrom: string;
  publishedBy: string;
  zones: number;
}

export interface ZoneSetup {
  entityId: string;
  country: string;
  groups: ZoneGroup[];
  inForce?: ZoneMap;
  scheduled: ZoneMap[];
  draft?: ZoneMap;
  versions: ZoneVersion[];
  outside: string[];
}

export interface ZoneAreaShape {
  id: string;
  name: string;
  zone: string;
  polygons: string[];
}

export interface ZoneShapes {
  version: number;
  setId: string;
  attribution: string;
  areas: ZoneAreaShape[];
}

/** The map the screen works on: the draft when one is open, else the map in force. */
export function workingMap(setup: ZoneSetup | null): ZoneMap | undefined {
  return setup?.draft ?? setup?.inForce;
}

/**
 * The colour of each group on the map, by its place in the country's list — never the only way it is said: the legend
 * names every group in words, and each zone's row says its group. Fills are kept light so the street map shows through.
 */
const GROUP_FILLS = ['#2f6fb0', '#3f8f5a', '#b5651d', '#7b4fa0', '#a8323e', '#2a8c8c', '#8a7a1e', '#5a5f7a'];
export function groupColour(groups: ZoneGroup[], key: string): string {
  const i = groups.findIndex((g) => g.key === key);
  return GROUP_FILLS[(i < 0 ? groups.length : i) % GROUP_FILLS.length];
}

export function groupName(groups: ZoneGroup[], key: string): string {
  return groups.find((g) => g.key === key)?.name ?? key;
}

/** The line under the map's fold: what is in force, what waits, and how many zones. */
export function zonesHint(setup: ZoneSetup | null, t: (k: MessageKey, p?: Record<string, string | number>) => string): string {
  if (!setup) return '';
  if (setup.draft) return t('tower.zones.hint.draft', { version: setup.draft.version, n: setup.draft.zones.length });
  if (setup.inForce) return t('tower.zones.hint.inForce', { version: setup.inForce.version, n: setup.inForce.zones.length });
  return t('tower.zones.hint.none');
}

export interface AreaForm {
  text: string;
  fileName: string;
  source: string;
  licence: string;
  attribution: string;
  level: string;
  nameField: string;
}

export const EMPTY_AREA_FORM: AreaForm = { text: '', fileName: '', source: '', licence: '', attribution: '', level: '', nameField: '' };

/** What stops a boundary file being sent, before it is sent: the file, its size, and the three things its licence needs said. */
export function areaFormProblem(form: AreaForm): MessageKey | null {
  if (!form.text) return 'tower.zones.import.needFile';
  if (form.text.length > UPLOAD_LIMITS.zoneAreasText) return 'tower.zones.import.tooLarge';
  if (!form.source.trim()) return 'tower.zones.import.needSource';
  if (!form.licence.trim()) return 'tower.zones.import.needLicence';
  if (!form.attribution.trim()) return 'tower.zones.import.needCredit';
  return null;
}

/** The groups as typed: names trimmed, empty rows dropped, and what is wrong with them, if anything. */
export function groupsProblem(rows: Array<{ key?: string; name: string }>): MessageKey | null {
  const names = rows.map((r) => r.name.trim()).filter(Boolean);
  if (!names.length) return 'tower.zones.groups.needOne';
  if (names.length > 8) return 'tower.zones.groups.tooMany';
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return 'tower.zones.groups.twice';
  return null;
}

/** An encoded polyline (precision 5) back to [lat, lng] corners — the server's zone-geometry.ts encodeRing, read. */
export function decodeRing(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = text.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i <= text.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < text.length) {
    lat += next();
    lng += next();
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

/** One polygon as sent (its rings encoded, separated by a space) → rings of [lat, lng], outer first. */
export function decodePolygon(text: string): Array<Array<[number, number]>> {
  return text.split(' ').filter(Boolean).map(decodeRing);
}

/** The date a map is published from: today's date for "now", else what was typed — as the instant the server wants. */
export function publishFrom(day: string, today: string): string | undefined {
  if (!day || day <= today) return undefined;
  return new Date(`${day}T00:00:00`).toISOString();
}
