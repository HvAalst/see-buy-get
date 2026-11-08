import { Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { EntityService } from '../../foundation/entity/entity.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { UPLOAD_LIMITS } from '../../foundation/media/upload-limits';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import type { Agent, GeoPoint, Mdp } from './pudo.types';
import { AreaFileProblem, AreaIndex, boxOf, decodePolygon, encodePolygon, measure, parseAreaFile, type Shape } from './zone-geometry';
import { proposalFor } from './zone-proposals';
import type { PlaceZone, StoredArea, StoredAreaSet, StoredZone, StoredZoneMap, StoredZoneSetup, ZoneAreaSetView, ZoneGroup, ZoneMapSummary, ZoneMapView, ZoneSetupView, ZoneShapesView, ZoneView } from './zone-map.types';

/** What every country starts from: three groups, in plain English, for the country to rename in its own words. */
export const DEFAULT_ZONE_GROUPS: ZoneGroup[] = [
  { key: 'urban', name: 'Urban' },
  { key: 'rural', name: 'Rural' },
  { key: 'remote', name: 'Remote' },
];
export const MAX_ZONE_GROUPS = 8;
/** How far ahead a map may be published: a year, so a date mistyped by a decade is refused rather than kept. */
const MAX_AHEAD_MS = 366 * 24 * 3_600_000;

export interface ImportAreasInput {
  geojson: string;
  source: string;
  licence: string;
  attribution: string;
  level?: string;
  nameField?: string;
}

/**
 * EACH COUNTRY'S ZONES (2026-11-08 — zone pricing, step 1). The country's company imports its official areas once, groups
 * them into zones in a draft, gives each zone one of its price groups, and publishes the draft from a date. Shops and hubs
 * are never given a zone by hand: theirs is the zone their pin lies in, on the map in force.
 *
 * Who may change it is the controller's question (the company's own administrators, or staff); every change is recorded on
 * the company beside its other terms. Nothing here is priced yet — see zone-map.types.ts.
 */
@Injectable()
export class ZoneMapService {
  private readonly setups = new PersistentMap<string, StoredZoneSetup>('pudo-zones');
  private readonly areaSets = new PersistentMap<string, StoredAreaSet>('pudo-zone-areas');
  /** An area set's shapes, decoded once, and the grid that finds a pin among them. Area sets never change once imported. */
  private readonly indexes = new Map<string, { shapes: Map<string, Shape>; index: AreaIndex }>();
  /** A published map's areas → their zone. Published maps never change, so this is never stale. */
  private readonly zoneOfArea = new Map<string, Map<string, StoredZone>>();
  /** A published map's zone centres, and the zones counted between two of its zones: worked out once, never stale. */
  private readonly centresOf = new Map<string, Map<string, { lat: number; lng: number }>>();
  private readonly crossings = new Map<string, { zonesCrossed: number; straightKm: number }>();

  constructor(
    private readonly entities: EntityService,
    @Optional() private readonly agents?: AgentService,
    @Optional() private readonly mdps?: MdpService,
  ) {}

  /* --------------------------------------------------------------- reading -- */

  setup(entityId: string, now: number = Date.now()): ZoneSetupView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const inForce = this.inForceOf(s, now);
    const draft = s.maps.find((m) => m.status === 'draft');
    const published = s.maps.filter((m) => m.status === 'published');
    const proposal = proposalFor(s.country);
    return {
      entityId,
      country: s.country,
      ...(proposal ? { proposal: { label: proposal.label, source: proposal.source, licence: proposal.licence, attribution: proposal.attribution, level: proposal.level, areas: proposal.areas.length, zones: proposal.zones.length } } : {}),
      groups: s.groups,
      ...(inForce ? { inForce: this.mapView(s, inForce, now, true) } : {}),
      scheduled: published.filter((m) => this.statusOf(s, m, now) === 'scheduled').map((m) => this.mapView(s, m, now, false)),
      ...(draft ? { draft: this.mapView(s, draft, now, true) } : {}),
      versions: published
        .map((m): ZoneMapSummary => ({ version: m.version, status: this.statusOf(s, m, now) as ZoneMapSummary['status'], effectiveFrom: m.effectiveFrom!, publishedBy: m.publishedBy ?? '', zones: m.zones.length }))
        .sort((a, b) => b.version - a.version),
      outside: inForce ? this.outside(s, inForce) : [],
    };
  }

  /** The shapes of a map's areas and the zone each is in: the draft when one is open, else the map in force. */
  shapes(entityId: string, version?: number, now: number = Date.now()): ZoneShapesView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const map = version != null ? s.maps.find((m) => m.version === version) : (s.maps.find((m) => m.status === 'draft') ?? this.inForceOf(s, now));
    if (!map) throw new GlosError('NOT_FOUND', version != null ? `${company.name} has no zone map ${version}` : `${company.name} has no zones yet`);
    const set = this.areaSet(entityId, map.setId);
    const zoneOf = new Map<string, string>();
    for (const z of map.zones) for (const a of z.areas) zoneOf.set(a, z.code);
    return { version: map.version, setId: set.setId, attribution: set.attribution, areas: set.areas.map((a) => ({ id: a.id, name: a.name, zone: zoneOf.get(a.id) ?? '', polygons: a.polygons })) };
  }

  /**
   * The zone a pin lies in, on its country's map in force at `at`. Undefined where the country keeps no zones yet, or the pin
   * lies in none of them (out at sea, over a border).
   */
  zoneAt(country: string | undefined, point: GeoPoint | undefined, at: number = Date.now()): PlaceZone | undefined {
    if (!country || !point) return undefined;
    const company = this.entities.forJurisdiction(country);
    if (!company) return undefined;
    const s = this.setups.get(company.entityId);
    if (!s) return undefined;
    const map = this.inForceOf(s, at);
    if (!map) return undefined;
    const zone = this.zoneOfPoint(company.entityId, map, point);
    if (!zone) return undefined;
    return { code: zone.code, name: zone.name, group: zone.group, groupName: s.groups.find((g) => g.key === zone.group)?.name ?? zone.group, version: map.version };
  }

  /**
   * The zones of one published version, with their groups and centres — what a price card made with that version prices.
   * Published versions never change, so this is kept once worked out.
   */
  publishedZones(entityId: string, version: number): { country: string; groups: ZoneGroup[]; zones: Array<{ code: string; name: string; group: string; centre: { lat: number; lng: number } }> } {
    const company = this.company(entityId);
    const s = this.stored(company);
    const map = s.maps.find((m) => m.status === 'published' && m.version === version);
    if (!map) throw new GlosError('NOT_FOUND', `${company.name} has no published zone map ${version}`);
    const key = `${entityId}#v${version}`;
    let centres = this.centresOf.get(key);
    if (!centres) {
      const set = this.areaSet(entityId, map.setId);
      const byId = new Map(set.areas.map((a) => [a.id, a]));
      centres = new Map();
      for (const z of map.zones) {
        const parts = z.areas.map((id) => byId.get(id)).filter((a): a is StoredArea => !!a);
        const km2 = parts.reduce((n, a) => n + a.areaKm2, 0) || parts.length || 1;
        const w = (a: StoredArea) => (parts.some((p) => p.areaKm2 > 0) ? a.areaKm2 : 1);
        centres.set(z.code, { lat: parts.reduce((n, a) => n + a.centre.lat * w(a), 0) / km2, lng: parts.reduce((n, a) => n + a.centre.lng * w(a), 0) / km2 });
      }
      this.centresOf.set(key, centres);
    }
    return { country: s.country, groups: s.groups, zones: map.zones.map((z) => ({ code: z.code, name: z.name, group: z.group, centre: centres!.get(z.code)! })) };
  }

  /** The zone a pin lies in on one published version (a price card's own), whatever version is in force today. */
  zoneCodeIn(entityId: string, version: number, point: GeoPoint | undefined): string | undefined {
    if (!point) return undefined;
    const company = this.company(entityId);
    const map = this.stored(company).maps.find((m) => m.status === 'published' && m.version === version);
    return map ? this.zoneOfPoint(entityId, map, point)?.code : undefined;
  }

  /**
   * HOW MANY ZONES LIE BETWEEN TWO ZONES (the owner: "the zones it is passing"), counted once for the pair on one published
   * version and kept: the straight line between their centres, looked at every kilometre, and every other zone it passes
   * through counted once. With the line's length — the distance a band is also measured by. The same pair always answers
   * the same for the same version, so a price made from it never moves.
   */
  crossing(entityId: string, version: number, from: string, to: string): { zonesCrossed: number; straightKm: number } {
    const key = `${entityId}#v${version}#${from < to ? `${from}|${to}` : `${to}|${from}`}`;
    const known = this.crossings.get(key);
    if (known) return known;
    const { zones } = this.publishedZones(entityId, version);
    const a = zones.find((z) => z.code === from);
    const b = zones.find((z) => z.code === to);
    if (!a || !b) throw new GlosError('NOT_FOUND', `There is no zone ${!a ? from : to} in zone map ${version}`);
    const company = this.company(entityId);
    const map = this.stored(company).maps.find((m) => m.status === 'published' && m.version === version)!;
    const straightKm = Math.hypot((a.centre.lat - b.centre.lat) * 110.574, (a.centre.lng - b.centre.lng) * 111.32 * Math.cos(((a.centre.lat + b.centre.lat) / 2) * (Math.PI / 180)));
    const passed = new Set<string>();
    if (from !== to) {
      const samples = Math.min(2000, Math.max(2, Math.ceil(straightKm)));
      for (let i = 1; i < samples; i++) {
        const t = i / samples;
        const z = this.zoneOfPoint(entityId, map, { lat: a.centre.lat + (b.centre.lat - a.centre.lat) * t, lng: a.centre.lng + (b.centre.lng - a.centre.lng) * t });
        if (z && z.code !== from && z.code !== to) passed.add(z.code);
      }
    }
    const answer = { zonesCrossed: passed.size, straightKm: Math.round(straightKm * 10) / 10 };
    this.crossings.set(key, answer);
    return answer;
  }

  zoneOfShop(shop: Agent | undefined, at?: number): PlaceZone | undefined {
    if (!shop || !this.agents) return undefined;
    return this.zoneAt(this.agents.countryOf(shop), shop.location, at);
  }

  zoneOfHub(hub: Mdp | undefined, at?: number): PlaceZone | undefined {
    if (!hub || !this.mdps) return undefined;
    return this.zoneAt(this.mdps.countryOf(hub), hub.location, at);
  }

  /* -------------------------------------------------------------- changing -- */

  /**
   * The country's official areas, from a boundary file, with where they came from and the credit their licence asks for.
   * They open a new draft with one zone per area, each in the middle group, for the company to merge and group. Refused
   * while a draft is open: importing would throw its work away.
   */
  importAreas(entityId: string, input: ImportAreasInput, by: string, now: number = Date.now()): ZoneSetupView {
    const company = this.company(entityId);
    const s = this.stored(company);
    if (s.maps.some((m) => m.status === 'draft')) throw new GlosError('INVALID_STATE', 'A draft is open: publish it or throw it away before bringing in new areas');
    const text = input.geojson ?? '';
    if (text.length > UPLOAD_LIMITS.zoneAreasText) throw new GlosError('INVALID_INPUT', `The file is ${(text.length / 1e6).toFixed(1)} million characters; the most is ${(UPLOAD_LIMITS.zoneAreasText / 1e6).toFixed(1)} million: simplify its shapes first`, { field: 'geojson' });
    const said = (v: string | undefined, field: string, words: string): string => {
      const t = (v ?? '').trim();
      if (!t) throw new GlosError('VALIDATION_FAILED', `Say ${words}`, { field });
      return t.slice(0, 300);
    };
    const source = said(input.source, 'source', 'where the areas come from');
    const licence = said(input.licence, 'licence', 'the licence they are published under');
    const attribution = said(input.attribution, 'attribution', 'the credit their licence asks for');
    let parsed;
    try {
      parsed = parseAreaFile(text, input.nameField?.trim() || undefined);
    } catch (e) {
      if (e instanceof AreaFileProblem) throw new GlosError('INVALID_INPUT', e.message, { field: e.field ?? 'geojson' });
      throw e;
    }
    const setId = `${new Date(now).toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;
    const areas: StoredArea[] = parsed.map((a, i) => {
      const { areaKm2, centre } = measure(a.shape);
      return { id: String(i + 1), name: a.name, box: boxOf(a.shape), polygons: a.shape.map(encodePolygon), areaKm2, centre };
    });
    const set: StoredAreaSet = { entityId, setId, country: s.country, source, licence, attribution, level: (input.level ?? '').trim().slice(0, 60) || 'areas', importedAt: new Date(now).toISOString(), importedBy: by, areas };
    const group = this.middleGroup(s);
    const draft: StoredZoneMap = {
      version: this.nextVersion(s),
      status: 'draft',
      setId,
      zones: areas.map((a) => ({ code: this.newCode(s), name: a.name, group, areas: [a.id] })),
      createdAt: new Date(now).toISOString(),
      createdBy: by,
    };
    this.areaSets.set(this.setKey(entityId, setId), set);
    this.save({ ...s, maps: [...s.maps, draft] });
    this.note(entityId, by, this.inForceLine(s, now), `draft ${draft.version}: ${areas.length} ${set.level} from ${source}, one zone each`);
    return this.setup(entityId, now);
  }

  /**
   * A draft from the first map proposed for this company's country (zone-proposals), where there is one: its areas, its
   * zones and each zone's proposed group with the evidence for it. A proposed group the company no longer has starts in
   * the middle group. Refused while a draft is open, and for a country with no proposal: one country's map is never
   * offered to another.
   */
  startFromProposal(entityId: string, by: string, now: number = Date.now()): ZoneSetupView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const proposal = proposalFor(s.country);
    if (!proposal || proposal.country !== s.country) throw new GlosError('NOT_FOUND', `No map is proposed for ${company.name}`);
    if (s.maps.some((m) => m.status === 'draft')) throw new GlosError('INVALID_STATE', 'A draft is open: publish it or throw it away before starting from the proposed map');
    const setId = `${new Date(now).toISOString().slice(0, 10)}-proposal-${randomBytes(2).toString('hex')}`;
    const areas: StoredArea[] = proposal.areas.map((a, i) => {
      const shape = a.polygons.map(decodePolygon);
      const { areaKm2, centre } = measure(shape);
      return { id: String(i + 1), name: a.name, box: boxOf(shape), polygons: a.polygons, areaKm2, centre };
    });
    const set: StoredAreaSet = { entityId, setId, country: s.country, source: proposal.source, licence: proposal.licence, attribution: proposal.attribution, level: proposal.level, importedAt: new Date(now).toISOString(), importedBy: by, areas };
    const middle = this.middleGroup(s);
    const draft: StoredZoneMap = {
      version: this.nextVersion(s),
      status: 'draft',
      setId,
      zones: proposal.zones.map((z) => ({
        code: this.newCode(s),
        name: z.name,
        group: s.groups.some((g) => g.key === z.group) ? z.group : middle,
        areas: z.areas.map((i) => String(i + 1)),
        ...(z.evidence.length ? { evidence: [...z.evidence] } : {}),
      })),
      createdAt: new Date(now).toISOString(),
      createdBy: by,
    };
    this.areaSets.set(this.setKey(entityId, setId), set);
    this.save({ ...s, maps: [...s.maps, draft] });
    this.note(entityId, by, this.inForceLine(s, now), `draft ${draft.version}: the proposed map (${areas.length} ${set.level}, ${draft.zones.length} zones)`);
    return this.setup(entityId, now);
  }

  /** The country's groups, in its words and order. A group a draft or a map in force still uses cannot be taken away. */
  setGroups(entityId: string, groups: Array<{ key?: string; name: string }>, by: string, now: number = Date.now()): ZoneSetupView {
    const company = this.company(entityId);
    const s = this.stored(company);
    if (!Array.isArray(groups) || !groups.length) throw new GlosError('VALIDATION_FAILED', 'A country needs at least one group', { field: 'groups' });
    if (groups.length > MAX_ZONE_GROUPS) throw new GlosError('VALIDATION_FAILED', `At most ${MAX_ZONE_GROUPS} groups`, { field: 'groups' });
    const names = new Set<string>();
    const known = new Set(s.groups.map((g) => g.key));
    let n = s.groups.length + 1;
    const next: ZoneGroup[] = [];
    for (const g of groups) {
      const name = (g?.name ?? '').trim().slice(0, 40);
      if (!name) throw new GlosError('VALIDATION_FAILED', 'Every group needs a name', { field: 'groups' });
      if (names.has(name.toLowerCase())) throw new GlosError('VALIDATION_FAILED', `Two groups are called “${name}”`, { field: 'groups' });
      names.add(name.toLowerCase());
      if (g.key && !known.has(g.key)) throw new GlosError('VALIDATION_FAILED', `There is no group ${g.key}`, { field: 'groups' });
      if (g.key && next.some((x) => x.key === g.key)) throw new GlosError('VALIDATION_FAILED', `A group is listed twice`, { field: 'groups' });
      let key = g.key;
      // A new group takes a key nobody has, kept or listed: keys never change once given, names may.
      if (!key) {
        do key = `g${n++}`;
        while (known.has(key) || next.some((x) => x.key === key) || groups.some((y) => y?.key === key));
      }
      next.push({ key, name });
    }
    const kept = new Set(next.map((g) => g.key));
    const inUse = this.mapsThatCount(s, now).flatMap((m) => m.zones.map((z) => z.group));
    const gone = s.groups.find((g) => !kept.has(g.key) && inUse.includes(g.key));
    if (gone) throw new GlosError('INVALID_STATE', `“${gone.name}” is still the group of a zone: give those zones another group first`, { field: 'groups' });
    const before = s.groups.map((g) => g.name).join(', ');
    const after = next.map((g) => g.name).join(', ');
    if (JSON.stringify(s.groups) === JSON.stringify(next)) return this.setup(entityId, now);
    this.save({ ...s, groups: next });
    this.note(entityId, by, `groups: ${before}`, `groups: ${after}`);
    return this.setup(entityId, now);
  }

  /** A new draft, copied from the newest published map. */
  startDraft(entityId: string, by: string, now: number = Date.now()): ZoneSetupView {
    const company = this.company(entityId);
    const s = this.stored(company);
    if (s.maps.some((m) => m.status === 'draft')) throw new GlosError('INVALID_STATE', 'A draft is already open');
    const newest = [...s.maps].filter((m) => m.status === 'published').sort((a, b) => b.version - a.version)[0];
    if (!newest) throw new GlosError('INVALID_STATE', 'There is no map to start from: bring in the country’s areas first');
    const draft: StoredZoneMap = { version: this.nextVersion(s), status: 'draft', setId: newest.setId, zones: newest.zones.map((z) => ({ ...z, areas: [...z.areas] })), createdAt: new Date(now).toISOString(), createdBy: by };
    this.save({ ...s, maps: [...s.maps, draft] });
    this.note(entityId, by, `map ${newest.version}`, `draft ${draft.version}, from map ${newest.version}`);
    return this.setup(entityId, now);
  }

  discardDraft(entityId: string, by: string, now: number = Date.now()): ZoneSetupView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const draft = this.draftOf(s);
    const rest = s.maps.filter((m) => m !== draft);
    this.save({ ...s, maps: rest });
    // Areas brought in for this draft alone go with it.
    if (!rest.some((m) => m.setId === draft.setId)) {
      this.areaSets.delete(this.setKey(entityId, draft.setId));
      this.indexes.delete(this.setKey(entityId, draft.setId));
    }
    this.note(entityId, by, `draft ${draft.version} (${draft.zones.length} zones)`, 'thrown away');
    return this.setup(entityId, now);
  }

  /** A zone of the draft renamed, or put in another group. */
  changeZone(entityId: string, code: string, change: { name?: string; group?: string }, by: string, now: number = Date.now()): ZoneSetupView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const draft = this.draftOf(s);
    const zone = this.zoneIn(draft, code);
    const name = change.name != null ? change.name.trim().slice(0, 80) : zone.name;
    if (!name) throw new GlosError('VALIDATION_FAILED', 'A zone needs a name', { field: 'name' });
    const group = change.group ?? zone.group;
    if (!s.groups.some((g) => g.key === group)) throw new GlosError('VALIDATION_FAILED', `There is no group ${group}`, { field: 'group' });
    if (name === zone.name && group === zone.group) return this.setup(entityId, now);
    const groupName = (key: string) => s.groups.find((g) => g.key === key)?.name ?? key;
    const before = `${zone.code} ${zone.name} · ${groupName(zone.group)}`;
    zone.name = name;
    zone.group = group;
    this.save(s);
    this.note(entityId, by, before, `${zone.code} ${name} · ${groupName(group)}`);
    return this.setup(entityId, now);
  }

  /** Two or more zones of the draft made one. It keeps the first one's code, group and name unless a name is given. */
  merge(entityId: string, codes: string[], name: string | undefined, by: string, now: number = Date.now()): ZoneSetupView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const draft = this.draftOf(s);
    const unique = [...new Set(codes ?? [])];
    if (unique.length < 2) throw new GlosError('VALIDATION_FAILED', 'Choose at least two zones to make one', { field: 'codes' });
    const zones = unique.map((c) => this.zoneIn(draft, c));
    const [keep, ...others] = zones;
    const merged = (name ?? '').trim().slice(0, 80) || keep.name;
    keep.areas = [...keep.areas, ...others.flatMap((z) => z.areas)];
    keep.from = [...new Set([...(keep.from ?? []), ...others.map((z) => z.code), ...others.flatMap((z) => z.from ?? [])])];
    // A proposal's reasons stay with the zone they were given for, now one: what was said of each part is still true of it.
    const evidence = [...new Set(zones.flatMap((z) => z.evidence ?? []))];
    if (evidence.length) keep.evidence = evidence;
    keep.name = merged;
    draft.zones = draft.zones.filter((z) => !others.includes(z));
    this.save(s);
    this.note(entityId, by, zones.map((z) => `${z.code} ${z.name}`).join(' + '), `${keep.code} ${merged} (${keep.areas.length} areas)`);
    return this.setup(entityId, now);
  }

  /**
   * Areas of the draft moved to another zone, or into a new one (a zone split). A zone left with no area is gone; its code
   * is not used again.
   */
  move(entityId: string, areaIds: string[], to: string | undefined, name: string | undefined, by: string, now: number = Date.now()): ZoneSetupView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const draft = this.draftOf(s);
    const ids = [...new Set(areaIds ?? [])];
    if (!ids.length) throw new GlosError('VALIDATION_FAILED', 'Choose the areas to move', { field: 'areas' });
    const set = this.areaSet(entityId, draft.setId);
    const holder = new Map<string, StoredZone>();
    for (const z of draft.zones) for (const a of z.areas) holder.set(a, z);
    for (const id of ids) if (!set.areas.some((a) => a.id === id) || !holder.has(id)) throw new GlosError('NOT_FOUND', `There is no area ${id} in this draft`, { field: 'areas' });
    const target = to ? this.zoneIn(draft, to) : undefined;
    const moving = target ? ids.filter((id) => holder.get(id) !== target) : ids;
    if (!moving.length) throw new GlosError('INVALID_STATE', `Those areas are in ${target!.name} already`);
    const sources = [...new Set(moving.map((id) => holder.get(id)!))];
    const areaName = (id: string) => set.areas.find((a) => a.id === id)?.name ?? id;
    const into: StoredZone = target ?? { code: this.newCode(s), name: (name ?? '').trim().slice(0, 80) || areaName(moving[0]), group: sources[0].group, areas: [], from: sources.map((z) => z.code) };
    for (const z of sources) z.areas = z.areas.filter((a) => !moving.includes(a));
    into.areas = [...into.areas, ...moving];
    draft.zones = [...draft.zones.filter((z) => z.areas.length), ...(target ? [] : [into])];
    this.save(s);
    this.note(entityId, by, sources.map((z) => `${z.code} ${z.name}`).join(', '), `${moving.length} ${moving.length === 1 ? 'area' : 'areas'} to ${into.code} ${into.name}`);
    return this.setup(entityId, now);
  }

  /** The draft published, from now or from a date to come. From that date it is the country's map. */
  publish(entityId: string, from: string | undefined, by: string, now: number = Date.now()): ZoneSetupView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const draft = this.draftOf(s);
    const at = from ? Date.parse(from) : now;
    if (!Number.isFinite(at)) throw new GlosError('VALIDATION_FAILED', 'The date it starts from is not a date', { field: 'from' });
    // A map starts now or later, never earlier: what was already priced or routed on the old one stays as it was.
    if (at < now - 60_000) throw new GlosError('VALIDATION_FAILED', 'A map starts now or later, never in the past', { field: 'from' });
    if (at > now + MAX_AHEAD_MS) throw new GlosError('VALIDATION_FAILED', 'A map can be published at most a year ahead', { field: 'from' });
    if (!draft.zones.length) throw new GlosError('INVALID_STATE', 'The draft has no zones');
    const set = this.areaSet(entityId, draft.setId);
    const placed = draft.zones.flatMap((z) => z.areas);
    if (placed.length !== set.areas.length || new Set(placed).size !== placed.length) throw new GlosError('INVALID_STATE', 'Every area must be in exactly one zone');
    const unknown = draft.zones.find((z) => !s.groups.some((g) => g.key === z.group));
    if (unknown) throw new GlosError('INVALID_STATE', `${unknown.name} has no group`);
    draft.status = 'published';
    draft.effectiveFrom = new Date(Math.max(at, now)).toISOString();
    draft.publishedAt = new Date(now).toISOString();
    draft.publishedBy = by;
    this.save(s);
    this.note(entityId, by, this.inForceLine(s, now, draft.version), `map ${draft.version} from ${draft.effectiveFrom.slice(0, 16).replace('T', ' ')} UTC (${draft.zones.length} zones)`);
    return this.setup(entityId, now);
  }

  /* --------------------------------------------------------------- inside -- */

  private company(entityId: string): Entity {
    const company = this.entities.get(entityId);
    if (company.kind !== 'sister' || !company.jurisdiction) throw new GlosError('FORBIDDEN', `${company.name} does not run a country: zones belong to the company that does`);
    return company;
  }

  private stored(company: Entity): StoredZoneSetup {
    return this.setups.get(company.entityId) ?? { entityId: company.entityId, country: company.jurisdiction!, groups: DEFAULT_ZONE_GROUPS.map((g) => ({ ...g })), maps: [], nextCode: 1 };
  }

  private save(s: StoredZoneSetup): void {
    this.setups.set(s.entityId, s);
  }

  private setKey(entityId: string, setId: string): string {
    return `${entityId}#${setId}`;
  }

  private areaSet(entityId: string, setId: string): StoredAreaSet {
    const set = this.areaSets.get(this.setKey(entityId, setId));
    if (!set) throw new GlosError('NOT_FOUND', `The areas of this map are missing (${setId})`);
    return set;
  }

  private draftOf(s: StoredZoneSetup): StoredZoneMap {
    const draft = s.maps.find((m) => m.status === 'draft');
    if (!draft) throw new GlosError('INVALID_STATE', 'There is no draft: start one first');
    return draft;
  }

  private zoneIn(map: StoredZoneMap, code: string): StoredZone {
    const zone = map.zones.find((z) => z.code === code);
    if (!zone) throw new GlosError('NOT_FOUND', `There is no zone ${code} in this draft`, { field: 'code' });
    return zone;
  }

  private newCode(s: StoredZoneSetup): string {
    return `Z${String(s.nextCode++).padStart(4, '0')}`;
  }

  private nextVersion(s: StoredZoneSetup): number {
    return s.maps.reduce((n, m) => Math.max(n, m.version), 0) + 1;
  }

  /** The group a new zone starts in: the middle one, so nothing starts as the cheapest or the dearest. */
  private middleGroup(s: StoredZoneSetup): string {
    return (s.groups.find((g) => g.key === 'rural') ?? s.groups[Math.floor((s.groups.length - 1) / 2)]).key;
  }

  private inForceOf(s: StoredZoneSetup, at: number): StoredZoneMap | undefined {
    return s.maps
      .filter((m) => m.status === 'published' && Date.parse(m.effectiveFrom!) <= at)
      .sort((a, b) => Date.parse(b.effectiveFrom!) - Date.parse(a.effectiveFrom!) || b.version - a.version)[0];
  }

  private statusOf(s: StoredZoneSetup, m: StoredZoneMap, now: number): ZoneMapView['status'] {
    if (m.status === 'draft') return 'draft';
    if (this.inForceOf(s, now)?.version === m.version) return 'in_force';
    return Date.parse(m.effectiveFrom!) > now ? 'scheduled' : 'past';
  }

  /** The maps a group may not vanish from: the draft, the map in force and those still to come. */
  private mapsThatCount(s: StoredZoneSetup, now: number): StoredZoneMap[] {
    return s.maps.filter((m) => ['draft', 'in_force', 'scheduled'].includes(this.statusOf(s, m, now)));
  }

  private inForceLine(s: StoredZoneSetup, now: number, besides?: number): string {
    const m = this.inForceOf(s, now);
    return m && m.version !== besides ? `map ${m.version} (${m.zones.length} zones)` : 'no zones';
  }

  private note(entityId: string, by: string, from: string, to: string): void {
    this.entities.noteChange(entityId, { by, what: 'zones', from, to });
  }

  private indexOf(entityId: string, setId: string): { shapes: Map<string, Shape>; index: AreaIndex } {
    const key = this.setKey(entityId, setId);
    const known = this.indexes.get(key);
    if (known) return known;
    const set = this.areaSet(entityId, setId);
    const shapes = new Map<string, Shape>();
    const list = set.areas.map((a) => {
      const shape = a.polygons.map(decodePolygon);
      shapes.set(a.id, shape);
      return { id: a.id, shape, box: a.box };
    });
    const built = { shapes, index: new AreaIndex(list) };
    this.indexes.set(key, built);
    return built;
  }

  private zoneOfPoint(entityId: string, map: StoredZoneMap, point: GeoPoint): StoredZone | undefined {
    const areaId = this.indexOf(entityId, map.setId).index.find(point);
    if (!areaId) return undefined;
    if (map.status === 'draft') return map.zones.find((z) => z.areas.includes(areaId));
    const key = `${entityId}#v${map.version}`;
    let byArea = this.zoneOfArea.get(key);
    if (!byArea) {
      byArea = new Map();
      for (const z of map.zones) for (const a of z.areas) byArea.set(a, z);
      this.zoneOfArea.set(key, byArea);
    }
    return byArea.get(areaId);
  }

  /** This country's shops and hubs, with their pins. */
  private placesOf(country: string): Array<{ kind: 'shop' | 'hub'; name: string; location?: GeoPoint }> {
    const shops = (this.agents?.list() ?? []).filter((a) => this.agents!.countryOf(a) === country).map((a) => ({ kind: 'shop' as const, name: a.shopName, location: a.location }));
    const hubs = (this.mdps?.list() ?? []).filter((m) => this.mdps!.countryOf(m) === country).map((m) => ({ kind: 'hub' as const, name: m.name, location: m.location }));
    return [...shops, ...hubs];
  }

  private outside(s: StoredZoneSetup, map: StoredZoneMap): string[] {
    return this.placesOf(s.country)
      .filter((p) => p.location && !this.zoneOfPoint(s.entityId, map, p.location))
      .map((p) => `${p.kind === 'shop' ? 'Shop' : 'Hub'} ${p.name}`);
  }

  private mapView(s: StoredZoneSetup, m: StoredZoneMap, now: number, counted: boolean): ZoneMapView {
    const set = this.areaSet(s.entityId, m.setId);
    const byId = new Map(set.areas.map((a) => [a.id, a]));
    const counts = new Map<string, { shops: number; hubs: number }>();
    if (counted) {
      for (const p of this.placesOf(s.country)) {
        const z = p.location ? this.zoneOfPoint(s.entityId, m, p.location) : undefined;
        if (!z) continue;
        const c = counts.get(z.code) ?? { shops: 0, hubs: 0 };
        if (p.kind === 'shop') c.shops++;
        else c.hubs++;
        counts.set(z.code, c);
      }
    }
    const zones = m.zones.map((z): ZoneView => {
      const parts = z.areas.map((id) => byId.get(id)).filter((a): a is StoredArea => !!a);
      const km2 = parts.reduce((n, a) => n + a.areaKm2, 0);
      const weight = km2 || parts.length || 1;
      const lat = parts.reduce((n, a) => n + a.centre.lat * (km2 ? a.areaKm2 : 1), 0) / weight;
      const lng = parts.reduce((n, a) => n + a.centre.lng * (km2 ? a.areaKm2 : 1), 0) / weight;
      const c = counts.get(z.code);
      return {
        code: z.code,
        name: z.name,
        group: z.group,
        areas: parts.length,
        areaKm2: Math.round(km2 * 10) / 10,
        centre: { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 },
        ...(counted ? { shops: c?.shops ?? 0, hubs: c?.hubs ?? 0 } : {}),
        ...(z.from?.length ? { from: z.from } : {}),
        ...(z.evidence?.length ? { evidence: z.evidence } : {}),
      };
    });
    const areas: ZoneAreaSetView = { setId: set.setId, source: set.source, licence: set.licence, attribution: set.attribution, level: set.level, count: set.areas.length, importedAt: set.importedAt, importedBy: set.importedBy };
    return {
      version: m.version,
      status: this.statusOf(s, m, now),
      createdAt: m.createdAt,
      createdBy: m.createdBy,
      ...(m.publishedAt ? { publishedAt: m.publishedAt } : {}),
      ...(m.publishedBy ? { publishedBy: m.publishedBy } : {}),
      ...(m.effectiveFrom ? { effectiveFrom: m.effectiveFrom } : {}),
      areas,
      zones,
    };
  }
}
