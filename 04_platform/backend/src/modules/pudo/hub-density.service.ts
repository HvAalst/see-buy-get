import { Inject, Injectable, Optional } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { EntityService } from '../../foundation/entity/entity.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { AgentService } from './agent.service';
import { CatchmentService } from './catchment.service';
import { GAZETTEER, nearestPlaceAt } from './geo-gazetteer';
import { haversineKm } from './geo';
import { ASIDE_DAYS, coverageOf, DENSITY_DAYS, EXTRA_HUB_FULL_DAYS, gatherNeeds, middleOf, needScore, reachOfGroup, reachStartOf, ROAD_GAP_KM, stillAside } from './hub-density';
import type { DensityHub, DensityReach, DensityZone, HubDensityView, HubSuggestion } from './hub-density.types';
import { MdpService } from './mdp.service';
import { ParcelService } from './parcel.service';
import type { GeoPoint, Mdp } from './pudo.types';
import { ROAD_CIRCUITY_FACTOR } from './pudo.config';
import { RoadMapService } from './road-map.service';
import { ROUTER, type Router } from './router';
import { ToteService } from './tote.service';
import { ZoneMapService } from './zone-map.service';

interface StoredAside {
  by: string;
  at: string;
  reason: string;
  score: number;
}

interface StoredDensity {
  entityId: string;
  /** The country's own reach by group (D6); absent = its starting figures. */
  reach?: DensityReach;
  aside: Record<string, StoredAside>;
}

/** Shops counted where they stand: signed up and seen, working or not (a shop held for money still stands there). */
const COUNTED: ReadonlySet<string> = new Set(['APPROVED_UNFUNDED', 'ACTIVE', 'LOCKED']);

/**
 * 2026-11-12 — WHERE HUBS ARE NEEDED (the owner, 2026-11-11: "a hub density optimiser on a map. It would show them where hubs
 * are needed or needed extra"; the plan "Hubs on the Road", step 3). For a country's staff: each zone's coverage (how far its
 * shops are from a hub, by its group's reach), its demand (parcels in 30 days, shops), each hub's pressure (days full, bags
 * waiting), and four kinds of suggestion — a hub needed, an extra hub needed, two stops too close, a gap on the road — each with
 * its reason, its numbers and a place at a known town where one is near. It suggests; staff decide (D7: an invitation to
 * share); it never approves, moves or closes a hub, nor tells anybody anything by itself.
 */
@Injectable()
export class HubDensityService {
  private readonly store = new PersistentMap<string, StoredDensity>('pudo-hub-density');

  constructor(
    private readonly entities: EntityService,
    private readonly zones: ZoneMapService,
    private readonly mdps: MdpService,
    private readonly catchments: CatchmentService,
    private readonly roadMaps: RoadMapService,
    private readonly agents: AgentService,
    private readonly parcels: ParcelService,
    private readonly totes: ToteService,
    @Optional() @Inject(ROUTER) private readonly router?: Router,
  ) {}

  view(entityId: string, now: number = Date.now()): HubDensityView {
    const company = this.company(entityId);
    const country = company.jurisdiction!;
    const s = this.stored(company);
    const reach = s.reach ?? reachStartOf(country);
    const inForce = this.zones.setup(company.entityId, now).inForce;
    const hubs = this.hubsOf(company);
    const byId = new Map(hubs.map((h) => [h.mdpId, h]));
    const working = hubs.filter((h) => !this.mdps.isDown(h, now));

    // The road map: in force, else being looked at, else the proposal — for the roads drawn and the gaps and pairs suggested.
    const roads = hubs.length >= 2 ? this.roadMaps.view(company.entityId, now) : undefined;
    const plan = roads?.confirmed ?? roads?.draft ?? roads?.proposal;
    const live = this.roadMaps.inForce(country, now);

    // Shops, and parcels in the last 30 days, by zone of the map in force.
    const zoneOf = (p: GeoPoint | undefined) => (p ? this.zones.zoneAt(country, p, now)?.code : undefined);
    const shopsIn = new Map<string, Array<{ did: string; location: GeoPoint }>>();
    for (const a of this.agents.list()) {
      if (!COUNTED.has(a.status) || a.hubCounterOf || !a.location || this.agents.countryOf(a) !== country) continue;
      const code = zoneOf(a.location);
      if (code) shopsIn.set(code, [...(shopsIn.get(code) ?? []), { did: a.did, location: a.location }]);
    }
    const since = now - 30 * 86_400_000;
    const sent = new Map<string, number>();
    const received = new Map<string, number>();
    const shopZone = new Map<string, string | undefined>();
    const zoneOfShop = (did: string | undefined) => {
      if (!did) return undefined;
      if (!shopZone.has(did)) {
        const a = this.agents.find(did);
        shopZone.set(did, a && this.agents.countryOf(a) === country ? zoneOf(a.location) : undefined);
      }
      return shopZone.get(did);
    };
    for (const p of this.parcels.list()) {
      const at = Date.parse(p.acceptedAt ?? p.scans?.[0]?.at ?? '');
      if (!Number.isFinite(at) || at < since) continue;
      const from = zoneOfShop(p.originAgentDid);
      const to = zoneOfShop(p.destAgentDid);
      if (from) sent.set(from, (sent.get(from) ?? 0) + 1);
      if (to) received.set(to, (received.get(to) ?? 0) + 1);
    }

    // Each zone: the farthest of its shops from the nearest hub serving it (or from any working hub, none serving it).
    const served = inForce ? this.catchments.view(company.entityId, now) : undefined;
    const servingOf = new Map((served?.zones ?? []).map((z) => [z.code, z.hubs.map((h) => h.mdpId).filter((id) => byId.has(id) && !this.mdps.isDown(byId.get(id)!, now))]));
    const zones: DensityZone[] = (inForce?.zones ?? []).map((z) => {
      const serving = (servingOf.get(z.code) ?? []).map((id) => byId.get(id)!).filter(Boolean);
      const pool = serving.length ? serving : working;
      const points = (shopsIn.get(z.code) ?? []).map((x) => x.location);
      let worst: { km: number; hub: Mdp } | undefined;
      for (const p of points.length ? points : [z.centre]) {
        const best = pool.map((h) => ({ km: this.km(p, h.location), hub: h })).sort((a, b) => a.km - b.km)[0];
        if (best && (!worst || best.km > worst.km)) worst = best;
      }
      const km = worst ? Math.round(worst.km * 10) / 10 : undefined;
      return {
        code: z.code,
        name: z.name,
        group: z.group,
        centre: z.centre,
        shops: points.length,
        sent30: sent.get(z.code) ?? 0,
        received30: received.get(z.code) ?? 0,
        ...(km !== undefined ? { km, nearestHub: worst!.hub.mdpId, nearestHubName: worst!.hub.name } : {}),
        served: serving.length > 0,
        coverage: coverageOf(km, reachOfGroup(reach, z.group)),
      };
    });

    // Each hub: its last 14 days, and the bags waiting for room on its floor now.
    const waitingAt = new Map<string, number>();
    for (const t of this.totes.list()) if (t.waitsForRoom?.hubId) waitingAt.set(t.waitsForRoom.hubId, (waitingAt.get(t.waitsForRoom.hubId) ?? 0) + 1);
    const densityHubs: DensityHub[] = hubs.map((h) => {
      const days = this.mdps.daysOf(h.mdpId, DENSITY_DAYS, now);
      const role = live ? (live.plan.stops.includes(h.mdpId) ? 'stop' : live.plan.local[h.mdpId] ? 'local' : undefined) : undefined;
      return {
        mdpId: h.mdpId,
        name: h.name,
        location: h.location,
        ...(role ? { role } : {}),
        down: this.mdps.isDown(h, now),
        fullDays: days.filter((d) => d.full).length,
        sortedPerDay: Math.round((days.reduce((n, d) => n + d.sorted, 0) / DENSITY_DAYS) * 10) / 10,
        ...(h.sortPerDay !== undefined ? { sortPerDay: h.sortPerDay } : {}),
        ...(h.bagPlaces !== undefined ? { bagPlaces: h.bagPlaces } : {}),
        waiting: waitingAt.get(h.mdpId) ?? 0,
      };
    });

    const all = [
      ...this.hubsNeeded(zones, reach, country),
      ...this.extraHubs(zones, densityHubs, served?.zones ?? [], country),
      ...(plan ? plan.tooClose.map((p) => this.tooClose(p, byId, plan.minKm)) : []),
      ...(plan ? plan.links.filter((l) => l.km > ROAD_GAP_KM).map((l) => this.roadGap(l, byId, country)) : []),
    ].filter((x): x is HubSuggestion => Boolean(x));
    const asideOf = (x: HubSuggestion) => (stillAside(s.aside[x.id], x.score, now) ? s.aside[x.id] : undefined);
    const withAside = all.map((x) => {
      const a = asideOf(x);
      return a ? { ...x, aside: { by: a.by, at: a.at, reason: a.reason } } : x;
    });
    return {
      entityId: company.entityId,
      country,
      ...(inForce ? { mapVersion: inForce.version } : {}),
      reach,
      reachStart: reachStartOf(country),
      zones,
      hubs: densityHubs,
      links: (plan?.links ?? []).map((l) => ({ a: l.a, b: l.b })),
      roadMapInForce: Boolean(roads?.confirmed),
      suggestions: withAside.filter((x) => !x.aside).sort((a, b) => b.score - a.score),
      setAside: withAside.filter((x) => x.aside).sort((a, b) => b.score - a.score),
    };
  }

  /** A suggestion set aside, with why: it comes back after 90 days, or sooner once its numbers double. Logged. */
  setAside(entityId: string, id: string, reason: string, by: string, now: number = Date.now()): HubDensityView {
    const company = this.company(entityId);
    const v = this.view(entityId, now);
    const found = [...v.suggestions, ...v.setAside].find((x) => x.id === id);
    if (!found) throw new GlosError('NOT_FOUND', 'That suggestion is no longer made: read the map again');
    const s = this.stored(company);
    s.aside[id] = { by, at: new Date(now).toISOString(), reason: reason.trim(), score: found.score };
    this.save(s);
    this.entities.noteChange(company.entityId, { by, what: 'hubDensity', from: this.title(found), to: `set aside for ${ASIDE_DAYS} days: ${reason.trim()}` });
    return this.view(entityId, now);
  }

  /** A suggestion set aside, brought back. */
  bringBack(entityId: string, id: string, by: string, now: number = Date.now()): HubDensityView {
    const company = this.company(entityId);
    const s = this.stored(company);
    if (!s.aside[id]) throw new GlosError('NOT_FOUND', 'That suggestion is not set aside');
    delete s.aside[id];
    this.save(s);
    this.entities.noteChange(company.entityId, { by, what: 'hubDensity', from: id, to: 'brought back' });
    return this.view(entityId, now);
  }

  /** The country's reach by group (D6). Logged. */
  setReach(entityId: string, reach: DensityReach, by: string, now: number = Date.now()): HubDensityView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const before = s.reach ?? reachStartOf(company.jurisdiction);
    s.reach = { urban: reach.urban, rural: reach.rural, remote: reach.remote };
    this.save(s);
    const line = (r: DensityReach) => `urban ${r.urban} km, rural ${r.rural} km, remote ${r.remote} km`;
    this.entities.noteChange(company.entityId, { by, what: 'hubDensity', from: line(before), to: line(s.reach) });
    return this.view(entityId, now);
  }

  /* ------------------------------------------------------------------ the four kinds -- */

  /** Zones beyond their reach where shops stand or parcels go: gathered, placed at a known town near their middle. */
  private hubsNeeded(zones: DensityZone[], reach: DensityReach, country: string): HubSuggestion[] {
    const wanting = zones
      .filter((z) => z.coverage !== 'near' && (z.shops > 0 || z.sent30 + z.received30 > 0))
      .map((z) => ({ ...z, score: needScore(z.shops, z.sent30 + z.received30), reach: reachOfGroup(reach, z.group) }));
    return gatherNeeds(wanting, (a, b) => this.km(a, b)).map((group) => {
      const top = group[0];
      const middle = middleOf(group.map((z) => ({ lat: z.centre.lat, lng: z.centre.lng, weight: z.score })));
      const shops = group.reduce((n, z) => n + z.shops, 0);
      const parcels = group.reduce((n, z) => n + z.sent30 + z.received30, 0);
      return {
        id: `need:${top.code}`,
        kind: 'hub_needed' as const,
        score: needScore(shops, parcels),
        place: this.placeAt(middle, country),
        zones: group.map((z) => z.code),
        zoneNames: group.map((z) => z.name),
        hubs: top.nearestHub ? [top.nearestHub] : [],
        hubNames: top.nearestHubName ? [top.nearestHubName] : [],
        numbers: { shops, parcels, ...(top.km !== undefined ? { km: Math.round(top.km) } : {}), reach: top.reach },
        towns: [],
      };
    });
  }

  /** A hub full on 5 of the last 14 days, or sent more a day than it says it sorts: another, in its busiest far zone. */
  private extraHubs(zones: DensityZone[], hubs: DensityHub[], catchZones: Array<{ code: string; hubs: Array<{ mdpId: string }> }>, country: string): HubSuggestion[] {
    const out: HubSuggestion[] = [];
    for (const h of hubs) {
      const served = zones.filter((z) => catchZones.find((c) => c.code === z.code)?.hubs.some((x) => x.mdpId === h.mdpId));
      const perDay = served.reduce((n, z) => n + z.sent30 + z.received30, 0) / 30;
      const ratio = h.sortPerDay ? Math.round((perDay / h.sortPerDay) * 10) / 10 : undefined;
      if (h.fullDays < EXTRA_HUB_FULL_DAYS && !(ratio !== undefined && ratio > 1)) continue;
      const far = served
        .map((z) => ({ z, weight: (z.sent30 + z.received30) * this.km(h.location, z.centre) }))
        .sort((a, b) => b.weight - a.weight)[0]?.z;
      const at = far?.centre ?? h.location;
      out.push({
        id: `extra:${h.mdpId}`,
        kind: 'extra_hub',
        score: h.fullDays * 10 + Math.round((ratio ?? 0) * 10),
        place: this.placeAt(at, country),
        zones: far ? [far.code] : [],
        zoneNames: far ? [far.name] : [],
        hubs: [h.mdpId],
        hubNames: [h.name],
        numbers: { fullDays: h.fullDays, days: DENSITY_DAYS, ...(ratio !== undefined ? { ratio } : {}) },
        towns: [],
      });
    }
    return out;
  }

  /** Two stops nearer than the country's minimum: one of them could be local only. */
  private tooClose(p: { a: string; b: string; aName: string; bName: string; km: number }, byId: Map<string, Mdp>, min: number): HubSuggestion | undefined {
    const a = byId.get(p.a);
    if (!a) return undefined;
    return {
      id: `close:${p.a}:${p.b}`,
      kind: 'too_close',
      score: Math.max(1, Math.round(min - p.km)),
      place: { name: a.name, lat: a.location.lat, lng: a.location.lng },
      zones: [],
      zoneNames: [],
      hubs: [p.a, p.b],
      hubNames: [p.aName, p.bName],
      numbers: { apart: Math.round(p.km), min },
      towns: [],
    };
  }

  /** Two neighbouring stops more than a day's drive apart: the known towns on the way offered as the place for a hub. */
  private roadGap(l: { a: string; b: string; aName: string; bName: string; km: number }, byId: Map<string, Mdp>, country: string): HubSuggestion | undefined {
    const a = byId.get(l.a);
    const b = byId.get(l.b);
    if (!a || !b) return undefined;
    const direct = this.km(a.location, b.location);
    const towns = GAZETTEER.filter((t) => t.country === country)
      .map((t) => ({ t, fromA: this.km(a.location, t.location), toB: this.km(t.location, b.location) }))
      .filter((x) => x.fromA > 30 && x.toB > 30 && x.fromA + x.toB <= 1.1 * direct)
      .sort((x, y) => Math.abs(x.fromA - direct / 2) - Math.abs(y.fromA - direct / 2));
    const best = towns[0];
    const half = { lat: (a.location.lat + b.location.lat) / 2, lng: (a.location.lng + b.location.lng) / 2 };
    return {
      id: `gap:${l.a}:${l.b}`,
      kind: 'road_gap',
      score: Math.round(l.km),
      place: best ? { name: best.t.name, lat: best.t.location.lat, lng: best.t.location.lng } : this.placeAt(half, country),
      zones: [],
      zoneNames: [],
      hubs: [l.a, l.b],
      hubNames: [l.aName, l.bName],
      numbers: { apart: Math.round(l.km) },
      towns: towns.slice(0, 5).map((x) => x.t.name),
    };
  }

  /* ------------------------------------------------------------------ inside -- */

  /** At a known town within 60 km where there is one; else the point itself. */
  private placeAt(point: GeoPoint, country: string): { name?: string; lat: number; lng: number } {
    const town = nearestPlaceAt(point, 60, country);
    return town ? { name: town.name, lat: town.location.lat, lng: town.location.lng } : { lat: Math.round(point.lat * 1e4) / 1e4, lng: Math.round(point.lng * 1e4) / 1e4 };
  }

  private title(x: HubSuggestion): string {
    const where = x.place.name ?? `${x.place.lat}, ${x.place.lng}`;
    return x.kind === 'hub_needed' ? `a hub needed near ${where}` : x.kind === 'extra_hub' ? `an extra hub beside ${x.hubNames[0]}` : x.kind === 'too_close' ? `${x.hubNames.join(' and ')} too close` : `a gap on the road between ${x.hubNames.join(' and ')}`;
  }

  private km(a: GeoPoint, b: GeoPoint): number {
    try {
      if (this.router) return this.router.roadKm(a, b);
    } catch {
      // the road engine could not answer: the usual detour
    }
    return haversineKm(a, b) * ROAD_CIRCUITY_FACTOR;
  }

  private hubsOf(company: Entity): Mdp[] {
    return this.mdps
      .list()
      .filter((m) => this.mdps.isApproved(m) && this.mdps.countryOf(m) === company.jurisdiction && m.location && Number.isFinite(m.location.lat))
      .sort((a, b) => a.mdpId.localeCompare(b.mdpId));
  }

  private company(entityId: string): Entity {
    const company = this.entities.get(entityId);
    if (company.kind !== 'sister' || !company.jurisdiction) throw new GlosError('FORBIDDEN', `${company.name} does not run a country: where hubs are needed is the company's that does`);
    return company;
  }

  private stored(company: Entity): StoredDensity {
    const s = this.store.get(company.entityId);
    return s ? { ...s, aside: { ...s.aside } } : { entityId: company.entityId, aside: {} };
  }

  private save(s: StoredDensity): void {
    this.store.set(s.entityId, s);
  }
}
