import { Inject, Injectable, Optional } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { EntityService } from '../../foundation/entity/entity.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { haversineKm } from './geo';
import { MdpService } from './mdp.service';
import type { Mdp } from './pudo.types';
import type { HubRoadView, RoadMapView, RoadPlanView } from './road-map.types';
import { ROAD_CIRCUITY_FACTOR } from './pudo.config';
import { ROUTER, type Router } from './router';
import { adjacency, defaultMinKm, linksFor, nearest, pairOf, piecesOf, proposeRoadPlan, stopOf, tooClose, without, type Km, type RoadPlan } from './road-map';

/** A plan as kept: the stops, the local hubs, the neighbours — and staff's own changes to the neighbours, replayed on a change of stops. */
interface StoredPlan extends RoadPlan {
  added: Array<[string, string]>;
  removed: Array<[string, string]>;
  /** The hubs it was made over: a hub approved since, or gone since, is a change waiting for staff. */
  hubs: string[];
  minKm: number;
  by: string;
  at: string;
  confirmedBy?: string;
  confirmedAt?: string;
}

interface StoredRoadMap {
  entityId: string;
  /** The country's minimum distance between two stops; absent = its starting figure (defaultMinKm). */
  minKm?: number;
  /** In force: plans in this country go along it (step 4; until then, nothing moves differently). */
  confirmed?: StoredPlan;
  /** Being looked at: the proposal, as staff change it, until they confirm it. */
  draft?: StoredPlan;
}

/**
 * 2026-11-12 — A COUNTRY'S ROAD MAP OF HUBS (the plan "Hubs on the Road", step 2; D1 per country, D2 today's routing until
 * confirmed). The system proposes which hubs are stops and which are local only, and which stops are neighbours; the
 * country's staff change what they know better and confirm it; every change is in the company's change log. Nothing moves
 * differently until a map is confirmed — and then (step 4) only where the country's price card is in force (D3).
 */
@Injectable()
export class RoadMapService {
  private readonly store = new PersistentMap<string, StoredRoadMap>('pudo-road-maps');

  constructor(
    private readonly entities: EntityService,
    private readonly mdps: MdpService,
    @Optional() @Inject(ROUTER) private readonly router?: Router,
  ) {}

  view(entityId: string, now: number = Date.now()): RoadMapView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const hubs = this.hubsOf(company);
    const byId = new Map(hubs.map((h) => [h.mdpId, h]));
    const km = this.kmOver(hubs);
    const minKm = this.minKmOf(company, s);
    const proposal = proposeRoadPlan(hubs, km, minKm);
    const ids = new Set(hubs.map((h) => h.mdpId));
    const inPlan = (p: StoredPlan) => new Set([...p.stops, ...Object.keys(p.local)]);
    return {
      entityId: company.entityId,
      country: company.jurisdiction!,
      minKm,
      minKmStart: defaultMinKm(company.jurisdiction),
      hubs: hubs.map((h) => ({ mdpId: h.mdpId, name: h.name, location: h.location, ...(h.bagPlaces !== undefined ? { bagPlaces: h.bagPlaces } : {}), down: this.mdps.isDown(h, now) })),
      proposal: this.planView(proposal, byId, km, minKm),
      ...(s.draft ? { draft: this.planView(s.draft, byId, km, minKm, s.draft) } : {}),
      ...(s.confirmed ? { confirmed: this.planView(s.confirmed, byId, km, minKm, s.confirmed) } : {}),
      joined: s.confirmed ? hubs.filter((h) => !inPlan(s.confirmed!).has(h.mdpId)).map((h) => h.mdpId) : [],
      left: s.confirmed ? [...inPlan(s.confirmed)].filter((id) => !ids.has(id)).sort() : [],
    };
  }

  /** The proposal made the map being looked at — again, over any changes staff made to the last. */
  propose(entityId: string, by: string, now: number = Date.now()): RoadMapView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const hubs = this.hubsOf(company);
    if (hubs.length < 2) throw new GlosError('INVALID_STATE', `${company.name} has ${hubs.length ? 'one approved hub' : 'no approved hub'}: a road map joins two or more`);
    const minKm = this.minKmOf(company, s);
    const plan = proposeRoadPlan(hubs, this.kmOver(hubs), minKm);
    s.draft = { ...plan, added: [], removed: [], hubs: hubs.map((h) => h.mdpId), minKm, by, at: new Date(now).toISOString() };
    this.save(s);
    this.entities.noteChange(company.entityId, { by, what: 'roadMap', from: 'the road map', to: `proposed: ${plan.stops.length} stops, ${Object.keys(plan.local).length} local only, ${plan.links.length} roads between stops` });
    return this.view(entityId, now);
  }

  /** A hub made a stop, or local only (carried by its nearest stop), on the map being looked at. */
  setRole(entityId: string, mdpId: string, role: 'stop' | 'local', by: string, now: number = Date.now()): RoadMapView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const hubs = this.hubsOf(company);
    const hub = hubs.find((h) => h.mdpId === mdpId);
    if (!hub) throw new GlosError('VALIDATION_FAILED', `${mdpId} is not an approved hub of ${company.name}`, { field: 'mdpId' });
    const draft = this.draftOf(s, company, hubs, by, now);
    const stops = new Set(draft.stops);
    if (role === 'stop') stops.add(mdpId);
    else stops.delete(mdpId);
    if (!stops.size) throw new GlosError('INVALID_STATE', 'A road map keeps at least one stop');
    s.draft = this.remade(draft, [...stops].sort(), hubs, by, now);
    this.save(s);
    this.entities.noteChange(company.entityId, { by, what: 'roadMap', from: hub.name, to: role === 'stop' ? 'a stop on the road' : 'local only' });
    return this.view(entityId, now);
  }

  /** A road between two stops added, or taken away, on the map being looked at. */
  setLink(entityId: string, a: string, b: string, on: boolean, by: string, now: number = Date.now()): RoadMapView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const hubs = this.hubsOf(company);
    const draft = this.draftOf(s, company, hubs, by, now);
    if (a === b || !draft.stops.includes(a) || !draft.stops.includes(b)) throw new GlosError('VALIDATION_FAILED', 'A road joins two different stops of the map', { field: 'a' });
    const [x, y] = pairOf(a, b);
    const same = (p: [string, string]) => p[0] === x && p[1] === y;
    const added = draft.added.filter((p) => !same(p));
    const removed = draft.removed.filter((p) => !same(p));
    if (on) added.push([x, y]);
    else removed.push([x, y]);
    s.draft = this.remade({ ...draft, added, removed }, draft.stops, hubs, by, now);
    this.save(s);
    const name = (id: string) => hubs.find((h) => h.mdpId === id)?.name ?? id;
    this.entities.noteChange(company.entityId, { by, what: 'roadMap', from: `${name(x)} – ${name(y)}`, to: on ? 'neighbours on the road' : 'not neighbours' });
    return this.view(entityId, now);
  }

  /** The country's minimum distance between two stops (D1): the next proposal reads it. */
  setMinKm(entityId: string, minKm: number, by: string, now: number = Date.now()): RoadMapView {
    const company = this.company(entityId);
    const s = this.stored(company);
    const before = this.minKmOf(company, s);
    if (before === minKm) return this.view(entityId, now);
    s.minKm = minKm;
    this.save(s);
    this.entities.noteChange(company.entityId, { by, what: 'roadMap', from: `stops at least ${before} km apart`, to: `stops at least ${minKm} km apart` });
    return this.view(entityId, now);
  }

  /** The map being looked at, put in force: one piece, every local hub carried by a stop. */
  confirm(entityId: string, by: string, now: number = Date.now()): RoadMapView {
    const company = this.company(entityId);
    const s = this.stored(company);
    if (!s.draft) throw new GlosError('INVALID_STATE', 'Make a proposal first, then confirm it');
    const pieces = piecesOf(s.draft.stops, s.draft.links);
    if (pieces.length > 1) throw new GlosError('INVALID_STATE', `The road map is in ${pieces.length} pieces: add a road so every stop reaches the others, then confirm it`);
    for (const [hub, stop] of Object.entries(s.draft.local)) {
      if (!s.draft.stops.includes(stop)) throw new GlosError('INVALID_STATE', `${hub} is carried by a hub that is no longer a stop: propose again`);
    }
    s.confirmed = { ...s.draft, confirmedBy: by, confirmedAt: new Date(now).toISOString() };
    delete s.draft;
    this.save(s);
    this.entities.noteChange(company.entityId, { by, what: 'roadMap', from: 'the road map', to: `confirmed: ${s.confirmed.stops.length} stops, ${s.confirmed.links.length} roads between them` });
    return this.view(entityId, now);
  }

  /**
   * The map in force in a country NOW, as parcels will travel it (step 4): its hubs that may not work left out (down, no
   * longer approved), their neighbours each other's; a hub approved since carried by its nearest stop. Nothing where no map
   * is confirmed — today's routing stays (D2).
   */
  inForce(country: string | undefined, now: number = Date.now()): { plan: RoadPlan; km: Km } | undefined {
    const company = country ? this.entities.forJurisdiction(country) : undefined;
    if (!company || company.kind !== 'sister') return undefined;
    const s = this.store.get(company.entityId);
    if (!s?.confirmed) return undefined;
    const hubs = this.hubsOf(company);
    const km = this.kmOver(hubs);
    const working = new Set(hubs.filter((h) => !this.mdps.isDown(h, now)).map((h) => h.mdpId));
    const inPlan = [...s.confirmed.stops, ...Object.keys(s.confirmed.local)];
    const out = new Set(inPlan.filter((id) => !working.has(id)));
    const plan = without(s.confirmed, out, km);
    if (!plan.stops.length) return undefined;
    for (const h of hubs) {
      if (!working.has(h.mdpId) || plan.stops.includes(h.mdpId) || plan.local[h.mdpId]) continue;
      plan.local[h.mdpId] = nearest(h.mdpId, plan.stops, km)!;
    }
    return { plan, km };
  }

  /** A hub's place on the road, for its own screen: its role, its neighbours, or the stop that carries it. */
  ofHub(mdpId: string, now: number = Date.now()): HubRoadView {
    const hub = this.mdps.require(mdpId);
    const live = this.inForce(this.mdps.countryOf(hub), now);
    if (!live) return { mdpId, inForce: false, neighbours: [] };
    const name = (id: string) => this.mdps.find(id)?.name ?? id;
    const round = (n: number) => Math.round(n * 10) / 10;
    if (live.plan.stops.includes(mdpId)) {
      const around = [...(adjacency(live.plan.stops, live.plan.links).get(mdpId) ?? [])];
      return { mdpId, inForce: true, role: 'stop', neighbours: around.map((id) => ({ mdpId: id, name: name(id), km: round(live.km(mdpId, id)) })).sort((a, b) => a.km - b.km) };
    }
    const via = stopOf(live.plan, mdpId);
    return { mdpId, inForce: true, role: 'local', ...(via ? { via: { mdpId: via, name: name(via), km: round(live.km(mdpId, via)) } } : {}), neighbours: [] };
  }

  /* ------------------------------------------------------------------ inside -- */

  private draftOf(s: StoredRoadMap, company: Entity, hubs: Mdp[], by: string, now: number): StoredPlan {
    if (s.draft) return s.draft;
    if (s.confirmed) return { ...s.confirmed, confirmedBy: undefined, confirmedAt: undefined };
    const minKm = this.minKmOf(company, s);
    return { ...proposeRoadPlan(hubs, this.kmOver(hubs), minKm), added: [], removed: [], hubs: hubs.map((h) => h.mdpId), minKm, by, at: new Date(now).toISOString() };
  }

  /** A draft made again over its stops: local hubs to their nearest stop, the neighbours worked out and staff's changes replayed. */
  private remade(draft: StoredPlan, stops: string[], hubs: Mdp[], by: string, now: number): StoredPlan {
    const km = this.kmOver(hubs);
    const known = new Set(hubs.map((h) => h.mdpId));
    const local: Record<string, string> = {};
    for (const id of [...draft.stops, ...Object.keys(draft.local), ...draft.hubs]) {
      if (!known.has(id) || stops.includes(id) || local[id]) continue;
      local[id] = nearest(id, stops, km)!;
    }
    const key = (p: readonly [string, string]) => p.join('|');
    const removed = new Set(draft.removed.map(key));
    const links = linksFor(stops, km).filter((p) => !removed.has(key(p)));
    for (const p of draft.added) if (stops.includes(p[0]) && stops.includes(p[1]) && !links.some((l) => key(l) === key(p))) links.push(p);
    return { ...draft, stops, local, links, by, at: new Date(now).toISOString() };
  }

  private planView(plan: RoadPlan & { by?: string; at?: string; confirmedBy?: string; confirmedAt?: string; minKm?: number }, byId: Map<string, Mdp>, km: Km, minKm: number, kept?: StoredPlan): RoadPlanView {
    const name = (id: string) => byId.get(id)?.name ?? id;
    const round = (n: number) => Math.round(n * 10) / 10;
    const adj = adjacency(plan.stops, plan.links);
    const known = (id: string) => byId.has(id);
    return {
      stops: plan.stops.filter(known).map((id) => ({ mdpId: id, name: name(id), neighbours: [...(adj.get(id) ?? [])].filter(known).map((n) => ({ mdpId: n, name: name(n), km: round(km(id, n)) })).sort((a, b) => a.km - b.km) })),
      local: Object.entries(plan.local).filter(([id, via]) => known(id) && known(via)).map(([id, via]) => ({ mdpId: id, name: name(id), via, viaName: name(via), km: round(km(id, via)) })).sort((a, b) => a.name.localeCompare(b.name)),
      links: plan.links.filter(([a, b]) => known(a) && known(b)).map(([a, b]) => ({ a, b, aName: name(a), bName: name(b), km: round(km(a, b)) })),
      pieces: piecesOf(plan.stops.filter(known), plan.links).length,
      tooClose: tooClose({ ...plan, stops: plan.stops.filter(known) }, km, minKm).map((p) => ({ a: p.a, b: p.b, aName: name(p.a), bName: name(p.b), km: p.km })),
      minKm: kept?.minKm ?? minKm,
      ...(kept ? { by: kept.by, at: kept.at } : {}),
      ...(kept?.confirmedBy ? { confirmedBy: kept.confirmedBy, confirmedAt: kept.confirmedAt } : {}),
    };
  }

  /** Road km between hubs: the road engine where it is switched on, else as the crow flies times the usual detour; kept per call. */
  private kmOver(hubs: Mdp[]): Km {
    const at = new Map(hubs.map((h) => [h.mdpId, h.location]));
    const memo = new Map<string, number>();
    return (a: string, b: string) => {
      if (a === b) return 0;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const kept = memo.get(key);
      if (kept !== undefined) return kept;
      const p = at.get(a) ?? this.mdps.find(a)?.location;
      const q = at.get(b) ?? this.mdps.find(b)?.location;
      let d = Number.MAX_SAFE_INTEGER;
      if (p && q) {
        try {
          d = this.router ? this.router.roadKm(p, q) : haversineKm(p, q) * ROAD_CIRCUITY_FACTOR;
        } catch {
          d = haversineKm(p, q) * ROAD_CIRCUITY_FACTOR;
        }
      }
      memo.set(key, d);
      return d;
    };
  }

  private minKmOf(company: Entity, s: StoredRoadMap): number {
    return s.minKm ?? defaultMinKm(company.jurisdiction);
  }

  private hubsOf(company: Entity): Mdp[] {
    return this.mdps
      .list()
      .filter((m) => this.mdps.isApproved(m) && this.mdps.countryOf(m) === company.jurisdiction && m.location && Number.isFinite(m.location.lat))
      .sort((a, b) => a.mdpId.localeCompare(b.mdpId));
  }

  private company(entityId: string): Entity {
    const company = this.entities.get(entityId);
    if (company.kind !== 'sister' || !company.jurisdiction) throw new GlosError('FORBIDDEN', `${company.name} does not run a country: a road map of hubs belongs to the company that does`);
    return company;
  }

  private stored(company: Entity): StoredRoadMap {
    const s = this.store.get(company.entityId);
    return s ? { ...s } : { entityId: company.entityId };
  }

  private save(s: StoredRoadMap): void {
    this.store.set(s.entityId, s);
  }
}
