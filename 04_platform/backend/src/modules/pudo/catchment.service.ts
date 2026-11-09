import { Inject, Injectable, Optional } from '@nestjs/common';
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

/** One zone's hub, and who said so: a proposal (the nearest hub by road) until a person keeps it. */
interface StoredCatchment {
  mdpId: string;
  by: string;
  at: string;
  proposed?: boolean;
}

interface StoredCatchments {
  entityId: string;
  /** Zone code → the hub that serves it. Codes are never used again, so an assignment outlives a map republished. */
  hubs: Record<string, StoredCatchment>;
}

export class CatchmentZoneView {
  code: string;
  name: string;
  group: string;
  @ApiPropertyOptional() mdpId?: string;
  @ApiPropertyOptional() hubName?: string;
  /** Set by the proposal — the nearest hub by road — and not yet kept by a person. */
  @ApiPropertyOptional() proposed?: boolean;
  /** Carried over from the zone it was made from (merged or split since), not set on this zone itself. */
  @ApiPropertyOptional() inherited?: boolean;
  /** How far its centre is from its hub, by road (km, estimated where the road table does not hold it). */
  @ApiPropertyOptional() km?: number;
}

export class CatchmentHubView {
  mdpId: string;
  name: string;
  /** How many zones it serves. */
  zones: number;
}

/**
 * WHICH HUB SERVES EACH ZONE (2026-11-09 — the plan's Part A, D1: "each zone belongs to exactly one hub, proposed by the
 * nearest hub by road, changeable in the console"). On the country's map in force; a zone without a hub is routed as
 * before, by the area name its shops typed, until one serves it.
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

/**
 * HUB CATCHMENTS (2026-11-09 — the owner's answers to the catchments-and-runs plan: D1 as recommended). Each zone of a
 * country's map belongs to exactly one of the country's hubs. The console proposes the nearest hub by road for every zone
 * without one, and the country's staff change any of them; every change is in the company's change log. A zone made
 * from others since (merged, split) carries their hub over until somebody sets its own. A hub no longer approved serves
 * nothing. What routing asks: the hub that serves a pin (a shop's, a hub's, a door's) — or nothing, and then it routes as
 * it always has.
 */
@Injectable()
export class CatchmentService {
  private readonly store = new PersistentMap<string, StoredCatchments>('pudo-catchments');

  constructor(
    private readonly entities: EntityService,
    private readonly zones: ZoneMapService,
    private readonly mdps: MdpService,
    @Optional() @Inject(ROUTER) private readonly router?: Router,
  ) {}

  view(entityId: string, now: number = Date.now()): CatchmentsView {
    const company = this.company(entityId);
    const inForce = this.zones.setup(entityId, now).inForce;
    const hubs = this.hubsOf(company);
    const byId = new Map(hubs.map((h) => [h.mdpId, h]));
    const s = this.stored(company.entityId);
    const count = new Map<string, number>();
    const zones: CatchmentZoneView[] = (inForce?.zones ?? []).map((z) => {
      const got = this.resolve(company.entityId, s, z.code, byId, now);
      const hub = got ? byId.get(got.mdpId) : undefined;
      if (hub) count.set(hub.mdpId, (count.get(hub.mdpId) ?? 0) + 1);
      return {
        code: z.code,
        name: z.name,
        group: z.group,
        ...(hub ? { mdpId: hub.mdpId, hubName: hub.name, km: this.km(z.centre, hub.location) } : {}),
        ...(hub && got?.proposed ? { proposed: true } : {}),
        ...(hub && got?.inherited ? { inherited: true } : {}),
      };
    });
    return {
      entityId: company.entityId,
      country: company.jurisdiction!,
      ...(inForce ? { mapVersion: inForce.version } : {}),
      zones,
      hubs: hubs.map((h) => ({ mdpId: h.mdpId, name: h.name, zones: count.get(h.mdpId) ?? 0 })),
      unserved: zones.filter((z) => !z.mdpId).length,
    };
  }

  /** Every zone without a hub given the nearest of the country's hubs by road — a proposal, until a person keeps it. */
  propose(entityId: string, by: string, now: number = Date.now()): CatchmentsView {
    const company = this.company(entityId);
    const inForce = this.zones.setup(entityId, now).inForce;
    if (!inForce) throw new GlosError('INVALID_STATE', 'Publish the country’s zones first: a hub serves zones of the map in force');
    const hubs = this.hubsOf(company);
    if (!hubs.length) throw new GlosError('INVALID_STATE', `${company.name} has no approved hub yet`);
    const byId = new Map(hubs.map((h) => [h.mdpId, h]));
    const s = this.stored(company.entityId);
    let proposed = 0;
    for (const z of inForce.zones) {
      if (this.resolve(company.entityId, s, z.code, byId, now)) continue;
      const nearest = hubs.map((h) => ({ h, km: this.km(z.centre, h.location) })).sort((a, b) => a.km - b.km || a.h.mdpId.localeCompare(b.h.mdpId))[0];
      s.hubs[z.code] = { mdpId: nearest.h.mdpId, by, at: new Date(now).toISOString(), proposed: true };
      proposed += 1;
    }
    if (proposed) {
      this.store.set(company.entityId, s);
      this.entities.noteChange(company.entityId, { by, what: 'catchments', from: 'zones without a hub', to: `${proposed} zone${proposed === 1 ? '' : 's'} given the nearest hub by road (proposed)` });
    }
    return this.view(entityId, now);
  }

  /** A zone given a hub — or none, and then it is routed as before. A person's choice: no longer a proposal. */
  assign(entityId: string, code: string, mdpId: string | undefined, by: string, now: number = Date.now()): CatchmentsView {
    const company = this.company(entityId);
    const inForce = this.zones.setup(entityId, now).inForce;
    const zone = inForce?.zones.find((z) => z.code === code);
    if (!zone) throw new GlosError('NOT_FOUND', `There is no zone ${code} on the map in force`);
    const hubs = this.hubsOf(company);
    const byId = new Map(hubs.map((h) => [h.mdpId, h]));
    const s = this.stored(company.entityId);
    const before = this.resolve(company.entityId, s, code, byId, now);
    const beforeWords = before ? `${zone.code} ${zone.name} · ${byId.get(before.mdpId)?.name ?? before.mdpId}${before.proposed ? ' (proposed)' : ''}` : `${zone.code} ${zone.name} · no hub`;
    if (mdpId) {
      const hub = byId.get(mdpId);
      if (!hub) throw new GlosError('VALIDATION_FAILED', `${mdpId} is not an approved hub of ${company.name}`, { field: 'mdpId' });
      s.hubs[code] = { mdpId, by, at: new Date(now).toISOString() };
    } else {
      delete s.hubs[code];
    }
    this.store.set(company.entityId, s);
    this.entities.noteChange(company.entityId, { by, what: 'catchments', from: beforeWords, to: `${zone.code} ${zone.name} · ${mdpId ? byId.get(mdpId)!.name : 'no hub'}` });
    return this.view(entityId, now);
  }

  /** The hub that serves a zone of a country's map in force — or nothing. */
  hubFor(country: string | undefined, code: string | undefined, now: number = Date.now()): string | undefined {
    if (!country || !code) return undefined;
    const company = this.entities.forJurisdiction(country);
    if (!company) return undefined;
    const s = this.store.get(company.entityId);
    if (!s) return undefined;
    const byId = new Map(this.hubsOf(company).map((h) => [h.mdpId, h]));
    return this.resolve(company.entityId, s, code, byId, now)?.mdpId;
  }

  /** The hub that serves a pin — a shop's, a hub's, a door's — on its country's map in force, or nothing. */
  hubForPoint(country: string | undefined, point: GeoPoint | undefined, now: number = Date.now()): string | undefined {
    const zone = this.zones.zoneAt(country, point, now);
    return zone ? this.hubFor(country, zone.code, now) : undefined;
  }

  /* ------------------------------------------------------------------ inside -- */

  /** A zone's own hub; else the hub of a zone it was made from; a hub no longer approved serves nothing. */
  private resolve(entityId: string, s: StoredCatchments, code: string, hubs: Map<string, Mdp>, now: number): (StoredCatchment & { inherited?: boolean }) | undefined {
    const own = s.hubs[code];
    if (own && hubs.has(own.mdpId)) return own;
    for (const from of this.zones.lineageOf(entityId, code, now)) {
      const was = s.hubs[from];
      if (was && hubs.has(was.mdpId)) return { ...was, inherited: true };
    }
    return undefined;
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

  private stored(entityId: string): StoredCatchments {
    const s = this.store.get(entityId);
    return s ? { entityId, hubs: { ...s.hubs } } : { entityId, hubs: {} };
  }
}
