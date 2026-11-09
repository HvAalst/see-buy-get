import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { EntityService } from '../../foundation/entity/entity.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { haversineKm } from './geo';
import { MdpService } from './mdp.service';
import type { GeoPoint, Mdp } from './pudo.types';
import { ROAD_CIRCUITY_FACTOR } from './pudo.config';
import { ROUTER, type Router } from './router';
import { ZoneMapService } from './zone-map.service';

/** A hub added to a zone, and who said so: staff, the hub itself, or the proposal (the nearest hub by road). */
interface StoredServe {
  mdpId: string;
  by: string;
  at: string;
  proposed?: boolean;
  /** The hub added the zone itself, from its own app. */
  byHub?: boolean;
}

/** A hub staff took away from a zone — the zone it stands in included. Never served there again until staff give it back. */
interface StoredTaken {
  mdpId: string;
  by: string;
  at: string;
}

interface StoredCatchments {
  entityId: string;
  /** Before 2026-11-09: one hub a zone. Read as a hub added to it; written no more. */
  hubs?: Record<string, StoredServe>;
  /** Zone code → the hubs added to it. Codes are never used again, so a hub added outlives a map republished. */
  served?: Record<string, StoredServe[]>;
  /** Zone code → the hubs staff took away from it. */
  taken?: Record<string, StoredTaken[]>;
}

/** How a hub comes to serve a zone. */
export type ServingHow = 'stands' | 'added' | 'hub' | 'proposed' | 'inherited';
export const SERVING_HOW: readonly ServingHow[] = ['stands', 'added', 'hub', 'proposed', 'inherited'];

export class CatchmentHubOfZone {
  mdpId: string;
  hubName: string;
  /** stands — its pin is in the zone; added — by staff; hub — the hub added it; proposed — the nearest, not yet kept; inherited — from a zone this one was made from. */
  @ApiProperty({ enum: SERVING_HOW }) how: ServingHow;
  /** How far the zone's centre is from the hub, by road (km, estimated where the road table does not hold it). */
  @ApiPropertyOptional() km?: number;
}

export class CatchmentZoneView {
  code: string;
  name: string;
  group: string;
  /** Every hub that serves it, nearest first: a parcel goes to the nearest of them to its shop that has room. */
  @ApiProperty({ type: [CatchmentHubOfZone] }) hubs: CatchmentHubOfZone[];
  /** Hubs staff took away from it: never served here until given back. */
  @ApiProperty({ type: [String] }) taken: string[];
}

export class CatchmentHubView {
  mdpId: string;
  name: string;
  /** How many zones it serves. */
  zones: number;
}

/**
 * WHICH HUBS SERVE EACH ZONE (2026-11-09 — a net of hubs, the owner: "we should not restrict hubs … to 1 per zone …
 * We should aim for a net of hubs"). On the country's map in force; a zone no hub serves is routed as before, by the
 * area name its shops typed, until one does.
 */
export class CatchmentsView {
  entityId: string;
  country: string;
  /** The map in force, whose zones these are; absent where the country has none. */
  @ApiPropertyOptional() mapVersion?: number;
  @ApiProperty({ type: [CatchmentZoneView] })
  zones: CatchmentZoneView[];
  /** The country's approved hubs, each with how many zones it serves. */
  @ApiProperty({ type: [CatchmentHubView] })
  hubs: CatchmentHubView[];
  /** Zones no hub serves yet. */
  unserved: number;
}

/** A zone, as a hub reads it on its own screen. */
export class HubZoneLine {
  code: string;
  name: string;
  /** From the hub, by road (km). */
  @ApiPropertyOptional() km?: number;
  @ApiPropertyOptional({ enum: SERVING_HOW }) how?: ServingHow;
}

/** What a hub serves, as its own app shows it: the zone it stands in, the zones it serves, and zones near it to add. */
export class HubZonesView {
  mdpId: string;
  /** The map in force; absent where its country keeps no zones yet. */
  @ApiPropertyOptional() mapVersion?: number;
  /** The zone its pin stands in — always its own, unless staff took it away. */
  @ApiPropertyOptional({ type: HubZoneLine }) standsIn?: HubZoneLine;
  @ApiProperty({ type: [HubZoneLine] }) serves: HubZoneLine[];
  /** Zones staff took away from it. */
  @ApiProperty({ type: [HubZoneLine] }) taken: HubZoneLine[];
  /** The nearest zones it does not serve yet, to add. */
  @ApiProperty({ type: [HubZoneLine] }) nearby: HubZoneLine[];
}

/** How many zones near a hub its own screen offers to add. */
const NEARBY = 12;

type Serving = { mdpId: string; how: ServingHow };

/**
 * A NET OF HUBS (2026-11-09 — the owner's answers): every approved hub serves the zone its pin stands in, by itself; a hub
 * may add neighbouring zones from its own app; staff add hubs to a zone and take any away — the zone a hub stands in too —
 * and every change is in the company's change log. A zone no hub serves may be given the nearest by road, as a proposal.
 * Which of a zone's hubs a parcel goes to: the nearest by road to its shop that has room on its floor; none with room, the
 * nearest (it waits there for room, as a full hub's bags always have — never refused). A zone made from others since carries their added hubs over
 * until it has its own. A hub no longer approved serves nothing.
 *
 * Replaces 2026-11-09's first rule, "each zone belongs to exactly one hub" (the catchments-and-runs plan, D1).
 */
@Injectable()
export class CatchmentService implements OnModuleInit {
  private readonly store = new PersistentMap<string, StoredCatchments>('pudo-catchments');

  constructor(
    private readonly entities: EntityService,
    private readonly zones: ZoneMapService,
    private readonly mdps: MdpService,
    @Optional() @Inject(ROUTER) private readonly router?: Router,
  ) {}

  /** The hubs sort by catchment too: given the lookups here, so neither needs the other to be built. */
  onModuleInit(): void {
    this.mdps.useCatchments?.({
      hubForPoint: (country, point, now) => this.hubForPoint(country, point, now),
      serves: (mdpId, country, point, now) => this.serves(mdpId, country, point, now),
    });
  }

  view(entityId: string, now: number = Date.now()): CatchmentsView {
    const company = this.company(entityId);
    const inForce = this.zones.setup(entityId, now).inForce;
    const hubs = this.hubsOf(company);
    const byId = new Map(hubs.map((h) => [h.mdpId, h]));
    const s = this.stored(company.entityId);
    const stands = this.standingIn(company, hubs, now);
    const count = new Map<string, number>();
    const zones: CatchmentZoneView[] = (inForce?.zones ?? []).map((z) => {
      const serving = this.servingOf(company.entityId, s, z.code, byId, stands, now)
        .map((h) => ({ mdpId: h.mdpId, hubName: byId.get(h.mdpId)!.name, how: h.how, km: this.km(z.centre, byId.get(h.mdpId)!.location) }))
        .sort((a, b) => a.km - b.km || a.mdpId.localeCompare(b.mdpId));
      for (const h of serving) count.set(h.mdpId, (count.get(h.mdpId) ?? 0) + 1);
      return { code: z.code, name: z.name, group: z.group, hubs: serving, taken: (s.taken?.[z.code] ?? []).map((t) => t.mdpId) };
    });
    return {
      entityId: company.entityId,
      country: company.jurisdiction!,
      ...(inForce ? { mapVersion: inForce.version } : {}),
      zones,
      hubs: hubs.map((h) => ({ mdpId: h.mdpId, name: h.name, zones: count.get(h.mdpId) ?? 0 })),
      unserved: zones.filter((z) => !z.hubs.length).length,
    };
  }

  /** Every zone no hub serves given the nearest of the country's hubs by road — a proposal, until a person keeps it. */
  propose(entityId: string, by: string, now: number = Date.now()): CatchmentsView {
    const company = this.company(entityId);
    const inForce = this.zones.setup(entityId, now).inForce;
    if (!inForce) throw new GlosError('INVALID_STATE', 'Publish the country’s zones first: a hub serves zones of the map in force');
    const hubs = this.hubsOf(company);
    if (!hubs.length) throw new GlosError('INVALID_STATE', `${company.name} has no approved hub yet`);
    const byId = new Map(hubs.map((h) => [h.mdpId, h]));
    const s = this.stored(company.entityId);
    const stands = this.standingIn(company, hubs, now);
    let proposed = 0;
    for (const z of inForce.zones) {
      if (this.servingOf(company.entityId, s, z.code, byId, stands, now).length) continue;
      const taken = new Set((s.taken?.[z.code] ?? []).map((t) => t.mdpId));
      const nearest = hubs
        .filter((h) => !taken.has(h.mdpId))
        .map((h) => ({ h, km: this.km(z.centre, h.location) }))
        .sort((a, b) => a.km - b.km || a.h.mdpId.localeCompare(b.h.mdpId))[0];
      if (!nearest) continue;
      s.served![z.code] = [...(s.served![z.code] ?? []), { mdpId: nearest.h.mdpId, by, at: new Date(now).toISOString(), proposed: true }];
      proposed += 1;
    }
    if (proposed) {
      this.save(s);
      this.entities.noteChange(company.entityId, { by, what: 'catchments', from: 'zones without a hub', to: `${proposed} zone${proposed === 1 ? '' : 's'} given the nearest hub by road (proposed)` });
    }
    return this.view(entityId, now);
  }

  /**
   * Staff (or the country's company) add a hub to a zone, or take it away — the zone it stands in too. Adding a hub staff
   * took away gives it back; adding a proposed one keeps it.
   */
  setServing(entityId: string, code: string, mdpId: string, serve: boolean, by: string, now: number = Date.now()): CatchmentsView {
    const company = this.company(entityId);
    const { zone, hub } = this.zoneAndHub(company, code, mdpId, now);
    const s = this.stored(company.entityId);
    const at = new Date(now).toISOString();
    if (serve) {
      s.taken![code] = (s.taken![code] ?? []).filter((t) => t.mdpId !== mdpId);
      s.served![code] = [...(s.served![code] ?? []).filter((x) => x.mdpId !== mdpId), { mdpId, by, at }];
    } else {
      s.served![code] = (s.served![code] ?? []).filter((x) => x.mdpId !== mdpId);
      if (!(s.taken![code] ?? []).some((t) => t.mdpId === mdpId)) s.taken![code] = [...(s.taken![code] ?? []), { mdpId, by, at }];
    }
    this.save(s);
    this.entities.noteChange(company.entityId, { by, what: 'catchments', from: `${zone.code} ${zone.name}`, to: `${hub.name} ${serve ? 'serves it' : 'taken away from it'}` });
    return this.view(entityId, now);
  }

  /** What a hub serves, for its own screen. */
  ofHub(mdpId: string, now: number = Date.now()): HubZonesView {
    const hub = this.mdps.require(mdpId);
    const company = this.entities.forJurisdiction(this.mdps.countryOf(hub));
    const inForce = company?.kind === 'sister' ? this.zones.setup(company.entityId, now).inForce : undefined;
    if (!company || !inForce) return { mdpId, serves: [], taken: [], nearby: [] };
    const hubs = this.hubsOf(company);
    const byId = new Map(hubs.map((h) => [h.mdpId, h]));
    const s = this.stored(company.entityId);
    const stands = this.standingIn(company, hubs, now);
    const line = (z: { code: string; name: string; centre: GeoPoint }, how?: ServingHow): HubZoneLine => ({ code: z.code, name: z.name, km: this.km(z.centre, hub.location), ...(how ? { how } : {}) });
    const own = this.zones.zoneAt(this.mdps.countryOf(hub), hub.location, now);
    const ownZone = own ? inForce.zones.find((z) => z.code === own.code) : undefined;
    const serves: HubZoneLine[] = [];
    const taken: HubZoneLine[] = [];
    const rest: HubZoneLine[] = [];
    for (const z of inForce.zones) {
      const mine = this.servingOf(company.entityId, s, z.code, byId, stands, now).find((h) => h.mdpId === mdpId);
      if (mine) serves.push(line(z, mine.how));
      else if ((s.taken?.[z.code] ?? []).some((t) => t.mdpId === mdpId)) taken.push(line(z));
      else rest.push(line(z));
    }
    const near = (a: HubZoneLine, b: HubZoneLine) => (a.km ?? 0) - (b.km ?? 0) || a.code.localeCompare(b.code);
    return {
      mdpId,
      mapVersion: inForce.version,
      ...(ownZone ? { standsIn: line(ownZone, serves.some((z) => z.code === ownZone.code) ? 'stands' : undefined) } : {}),
      serves: serves.sort(near),
      taken: taken.sort(near),
      nearby: rest.sort(near).slice(0, NEARBY),
    };
  }

  /**
   * A hub adds a zone to the ones it serves, or stops serving one it added, from its own app. It cannot add one staff took
   * away from it, nor stop serving the zone it stands in (that is always its own; staff may take it away).
   */
  setServingByHub(mdpId: string, code: string, serve: boolean, by: string, now: number = Date.now()): HubZonesView {
    const hub = this.mdps.require(mdpId);
    if (!this.mdps.isApproved(hub)) throw new GlosError('INVALID_STATE', 'Your hub serves zones once SeeBuyGet has approved it');
    const company = this.entities.forJurisdiction(this.mdps.countryOf(hub));
    if (!company || company.kind !== 'sister') throw new GlosError('INVALID_STATE', `SeeBuyGet keeps no zones in ${this.mdps.countryOf(hub)} yet`);
    const { zone } = this.zoneAndHub(company, code, mdpId, now);
    const s = this.stored(company.entityId);
    if (serve) {
      if ((s.taken?.[code] ?? []).some((t) => t.mdpId === mdpId)) throw new GlosError('FORBIDDEN', `SeeBuyGet’s staff took ${zone.name} away from ${hub.name}: ask them to give it back`);
      if (!(s.served![code] ?? []).some((x) => x.mdpId === mdpId && !x.proposed)) {
        s.served![code] = [...(s.served![code] ?? []).filter((x) => x.mdpId !== mdpId), { mdpId, by, at: new Date(now).toISOString(), byHub: true }];
      }
    } else {
      const own = this.zones.zoneAt(this.mdps.countryOf(hub), hub.location, now);
      if (own?.code === code) throw new GlosError('INVALID_STATE', `${zone.name} is where ${hub.name} stands: it is always yours`);
      s.served![code] = (s.served![code] ?? []).filter((x) => x.mdpId !== mdpId);
    }
    this.save(s);
    this.entities.noteChange(company.entityId, { by, what: 'catchments', from: `${zone.code} ${zone.name}`, to: `${hub.name} ${serve ? 'serves it (added by the hub)' : 'no longer serves it (said by the hub)'}` });
    return this.ofHub(mdpId, now);
  }

  /** Every hub that serves a zone of a country's map in force. */
  hubsFor(country: string | undefined, code: string | undefined, now: number = Date.now()): string[] {
    if (!country || !code) return [];
    const company = this.entities.forJurisdiction(country);
    if (!company || company.kind !== 'sister') return [];
    const hubs = this.hubsOf(company);
    const byId = new Map(hubs.map((h) => [h.mdpId, h]));
    return this.servingOf(company.entityId, this.stored(company.entityId), code, byId, this.standingIn(company, hubs, now), now).map((h) => h.mdpId);
  }

  /**
   * The hub a parcel at a pin goes to — a shop's, a hub's, a door's: of the hubs serving the zone the pin lies in, the
   * nearest by road with room on its floor; none with room, the nearest. Or nothing, and then it routes as it always has.
   */
  hubForPoint(country: string | undefined, point: GeoPoint | undefined, now: number = Date.now()): string | undefined {
    if (!point) return undefined;
    const zone = this.zones.zoneAt(country, point, now);
    if (!zone) return undefined;
    const ids = this.hubsFor(country, zone.code, now);
    if (!ids.length) return undefined;
    const ranked = ids
      .map((id) => this.mdps.require(id))
      .map((h) => ({ h, km: this.km(point, h.location) }))
      .sort((a, b) => a.km - b.km || a.h.mdpId.localeCompare(b.h.mdpId));
    return (ranked.find(({ h }) => this.mdps.hasRoom(h, now)) ?? ranked[0]).h.mdpId;
  }

  /** Whether a hub serves the zone a pin lies in: then it hands a parcel for there straight to its shop. */
  serves(mdpId: string, country: string | undefined, point: GeoPoint | undefined, now: number = Date.now()): boolean {
    if (!point) return false;
    const zone = this.zones.zoneAt(country, point, now);
    return zone ? this.hubsFor(country, zone.code, now).includes(mdpId) : false;
  }

  /* ------------------------------------------------------------------ inside -- */

  /**
   * The hubs that serve a zone: those standing in it, those added to it — less any staff took away. A zone with neither
   * carries over the hubs added to a zone it was made from. A hub no longer approved serves nothing.
   */
  private servingOf(entityId: string, s: StoredCatchments, code: string, hubs: Map<string, Mdp>, stands: Map<string, string[]>, now: number): Serving[] {
    const taken = new Set((s.taken?.[code] ?? []).map((t) => t.mdpId));
    const out: Serving[] = [];
    const add = (mdpId: string, how: ServingHow) => {
      if (hubs.has(mdpId) && !taken.has(mdpId) && !out.some((o) => o.mdpId === mdpId)) out.push({ mdpId, how });
    };
    for (const id of stands.get(code) ?? []) add(id, 'stands');
    for (const x of s.served?.[code] ?? []) add(x.mdpId, x.proposed ? 'proposed' : x.byHub ? 'hub' : 'added');
    if (out.length) return out;
    for (const from of this.zones.lineageOf(entityId, code, now)) {
      for (const x of s.served?.[from] ?? []) add(x.mdpId, 'inherited');
      if (out.length) return out;
    }
    return out;
  }

  /** Zone code → the approved hubs whose pin stands in it, on the map in force. */
  private standingIn(company: Entity, hubs: Mdp[], now: number): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const h of hubs) {
      const z = this.zones.zoneAt(company.jurisdiction, h.location, now);
      if (z) out.set(z.code, [...(out.get(z.code) ?? []), h.mdpId]);
    }
    return out;
  }

  private zoneAndHub(company: Entity, code: string, mdpId: string, now: number): { zone: { code: string; name: string }; hub: Mdp } {
    const inForce = this.zones.setup(company.entityId, now).inForce;
    const zone = inForce?.zones.find((z) => z.code === code);
    if (!zone) throw new GlosError('NOT_FOUND', `There is no zone ${code} on the map in force`);
    const hub = this.hubsOf(company).find((h) => h.mdpId === mdpId);
    if (!hub) throw new GlosError('VALIDATION_FAILED', `${mdpId} is not an approved hub of ${company.name}`, { field: 'mdpId' });
    return { zone, hub };
  }

  private hubsOf(company: Entity): Mdp[] {
    return this.mdps
      .list()
      .filter((m) => this.mdps.isApproved(m) && this.mdps.countryOf(m) === company.jurisdiction && m.location && Number.isFinite(m.location.lat))
      .sort((a, b) => a.mdpId.localeCompare(b.mdpId));
  }

  private km(a: GeoPoint, b: GeoPoint): number {
    const km = this.router ? this.router.roadKm(a, b) : haversineKm(a, b) * ROAD_CIRCUITY_FACTOR;
    return Math.round(km * 10) / 10;
  }

  private company(entityId: string): Entity {
    const company = this.entities.get(entityId);
    if (company.kind !== 'sister' || !company.jurisdiction) throw new GlosError('FORBIDDEN', `${company.name} does not run a country: catchments belong to the company that does`);
    return company;
  }

  /** As kept — one hub a zone, from before 2026-11-09, read as a hub added to it. */
  private stored(entityId: string): StoredCatchments & { served: Record<string, StoredServe[]>; taken: Record<string, StoredTaken[]> } {
    const s = this.store.get(entityId);
    const served: Record<string, StoredServe[]> = {};
    for (const [code, list] of Object.entries(s?.served ?? {})) served[code] = [...list];
    for (const [code, one] of Object.entries(s?.hubs ?? {})) if (!(served[code] ?? []).some((x) => x.mdpId === one.mdpId)) served[code] = [...(served[code] ?? []), one];
    const taken: Record<string, StoredTaken[]> = {};
    for (const [code, list] of Object.entries(s?.taken ?? {})) taken[code] = [...list];
    return { entityId, served, taken };
  }

  private save(s: StoredCatchments): void {
    this.store.set(s.entityId, { entityId: s.entityId, served: s.served, taken: s.taken });
  }
}
