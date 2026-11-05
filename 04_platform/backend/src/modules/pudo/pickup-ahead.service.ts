import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AgentService } from './agent.service';
import { BagPlanService } from './bag-plan.service';
import { DispatchService } from './dispatch.service';
import { RoutePlan } from './dispatch.types';
import { DriverService } from './driver.service';
import { DropOffHoldService } from './drop-off-hold.service';
import { FleetService } from './fleet.service';
import { MdpService } from './mdp.service';
import { NotificationService } from './notification.service';
import { ParcelService } from './parcel.service';
import { DISPATCH_MAX_DETOUR_KM, DISPATCH_MAX_PICKUP_MIN, VEHICLE_SPEED_KMH } from './pudo.config';
import { GeoPoint, Parcel, Tote } from './pudo.types';
import { haversineKm } from './geo';
import { Router, ROUTER } from './router';
import { ToteService } from './tote.service';

/**
 * 2026-11-05 — PRE-DROP-OFF, THE DRIVER'S SIDE (compendium gap #6; the owner: "Seen ahead, taken on ahead"). Drivers on a
 * road see the parcels coming in at the shops along it — booked to be handed in there, or waiting there for their next
 * stop — "N parcels, X kg at shop S for H". A driver who takes them on ahead holds that room on their vehicle, and is the
 * one the bag for that stop is given to once the shop closes it.
 *
 * ONE DRIVER A STOP: while somebody has taken on the parcels a shop has for one next stop, nobody else can. The promise
 * ends when the bag is handed over (or the parcels go another way), when the driver lets it go, or after
 * PICKUP_AHEAD_H hours — the longest any of them is held.
 *
 * THE ROOM IS REAL: what is taken on counts against the vehicle's kilos and bag places everywhere room is asked
 * (DispatchService.remainingCapacity / remainingTotes), so a driver cannot promise the same space twice.
 */
export const PICKUP_AHEAD_H = 24;

export interface PickupPromise {
  promiseId: string;
  driverDid: string;
  agentDid: string;
  /** The next stop, as the shop's bag for it is addressed (a hub's id, or a zone). */
  hopKey: string;
  hopLabel: string;
  /** What was coming when it was taken on: the room held on the vehicle. */
  kg: number;
  parcels: number;
  takenAt: string;
  until: string;
  /** promised — room held; given — the bag is theirs (claimed); done — handed over or gone another way; let_go; lapsed. */
  state: 'promised' | 'given' | 'done' | 'let_go' | 'lapsed';
  toteCode?: string;
  endedAt?: string;
}

/** What a shop has coming for one next stop. */
export interface ComingGroup {
  agentDid: string;
  shopName: string;
  location?: GeoPoint;
  hopKey: string;
  hopLabel: string;
  parcels: number;
  kg: number;
  /** Booked to be handed in, not there yet. */
  booked: number;
  /** The driver who took these on, if one has. */
  takenBy?: { driverDid: string; name: string };
}

export interface ComingNearRoute extends ComingGroup {
  detourKm: number;
  minutesAway: number;
  /** This driver took them on. */
  mine?: { promiseId: string; state: PickupPromise['state'] };
}

const HOUR = 3_600_000;

@Injectable()
export class PickupAheadService {
  private readonly promises = new PersistentMap<string, PickupPromise>('pudo-pickup-ahead');
  private readonly logger = new Logger(PickupAheadService.name);

  constructor(
    private readonly parcels: ParcelService,
    private readonly holds: DropOffHoldService,
    private readonly bagPlans: BagPlanService,
    private readonly agents: AgentService,
    private readonly fleet: FleetService,
    private readonly drivers: DriverService,
    private readonly totes: ToteService,
    private readonly dispatch: DispatchService,
    mdps: MdpService,
    @Inject(ROUTER) private readonly router: Router,
    @Optional() private readonly events?: EventBus,
    @Optional() private readonly notifications?: NotificationService,
  ) {
    // Registered rather than asked for: dispatch and the hubs are below this in the graph.
    this.dispatch.registerAhead((driverDid) => this.heldOn(driverDid));
    mdps.registerPromised((tote, now) => this.giveBag(tote, now));
    this.events?.subscribe<{ code?: string; driverBadgeId?: string }>(GlosEvent.Pudo.BagLoaded, (e) => this.onBagLoaded(e.payload.code));
  }

  /* ------------------------------------------------------------------------------------------------ coming -- */

  /**
   * What a shop has coming, by next stop: parcels booked to be handed in there (their place still held), and parcels
   * waiting there loose or in a bag still filling. Not a same-shop parcel — it never leaves — nor one already in a closed bag.
   */
  comingAt(agentDid: string, now: number = Date.now()): ComingGroup[] {
    const shop = this.agents.find(agentDid);
    if (!shop) return [];
    const groups = new Map<string, ComingGroup>();
    const add = (parcel: Parcel, booked: boolean) => {
      if (this.parcels.isSameShop(parcel)) return;
      let hop: { key: string; label: string };
      try {
        hop = this.bagPlans.hopOf(parcel);
      } catch {
        return;
      }
      const g = groups.get(hop.key) ?? { agentDid, shopName: shop.shopName, location: shop.location, hopKey: hop.key, hopLabel: hop.label, parcels: 0, kg: 0, booked: 0 };
      g.parcels += 1;
      g.kg = Math.round((g.kg + (parcel.weightKg ?? 0)) * 100) / 100;
      if (booked) g.booked += 1;
      groups.set(hop.key, g);
    };
    for (const h of this.holds.forShop(agentDid)) {
      if (!this.holds.isHeld(h, now)) continue;
      let parcel;
      try {
        parcel = this.parcels.get(h.parcelId);
      } catch {
        continue;
      }
      if (parcel.status === 'Created') add(parcel, true);
    }
    for (const parcel of this.parcels.list({ status: 'At_PUDO', agentDid })) {
      if (parcel.originAgentDid !== agentDid || parcel.held) continue;
      const bag = parcel.toteId ? this.totes.list().find((t) => t.toteId === parcel.toteId) : undefined;
      if (bag && bag.status !== 'filling') continue; // closed and offered: the bag is the job now
      add(parcel, false);
    }
    return [...groups.values()].map((g) => {
      const p = this.activeFor(agentDid, g.hopKey, now);
      return p ? { ...g, takenBy: { driverDid: p.driverDid, name: this.nameOf(p.driverDid) } } : g;
    });
  }

  /**
   * The shops along a driver's road with parcels coming, nearest the road first — the same geometry as the offers ("near
   * your route" means one thing in this app), and only what their vehicle could carry as it stands.
   */
  nearRoute(driverDid: string, route: RoutePlan, now: number = Date.now()): ComingNearRoute[] {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) return [];
    const out: ComingNearRoute[] = [];
    for (const shop of this.agents.list()) {
      if (!shop.location) continue;
      const detourKm = this.router.detourKm(route.from, shop.location, route.to);
      const minutesAway = this.router.etaMinutes(route.from, shop.location, VEHICLE_SPEED_KMH.bus);
      if (detourKm > DISPATCH_MAX_DETOUR_KM || minutesAway > DISPATCH_MAX_PICKUP_MIN) continue;
      for (const g of this.comingAt(shop.did, now)) {
        if (g.kg > vehicle.capacityKg) continue;
        const mine = this.activeFor(shop.did, g.hopKey, now);
        out.push({ ...g, detourKm, minutesAway, ...(mine && mine.driverDid === driverDid ? { mine: { promiseId: mine.promiseId, state: mine.state } } : {}) });
      }
    }
    return this.withMine(driverDid, out, (loc) => ({ detourKm: this.router.detourKm(route.from, loc, route.to), minutesAway: this.router.etaMinutes(route.from, loc, VEHICLE_SPEED_KMH.bus) }), now);
  }

  /** The same, around a point (the nearby search): the shops within the radius, nearest first. */
  nearPoint(driverDid: string, at: GeoPoint, radiusKm: number, now: number = Date.now()): ComingNearRoute[] {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) return [];
    const out: ComingNearRoute[] = [];
    for (const shop of this.agents.list()) {
      if (!shop.location) continue;
      const km = Math.round(haversineKm(at, shop.location) * 10) / 10;
      if (km > radiusKm) continue;
      const minutesAway = this.router.etaMinutes(at, shop.location, VEHICLE_SPEED_KMH.bus);
      for (const g of this.comingAt(shop.did, now)) {
        if (g.kg > vehicle.capacityKg) continue;
        const mine = this.activeFor(shop.did, g.hopKey, now);
        out.push({ ...g, detourKm: km, minutesAway, ...(mine && mine.driverDid === driverDid ? { mine: { promiseId: mine.promiseId, state: mine.state } } : {}) });
      }
    }
    return this.withMine(driverDid, out, (loc) => ({ detourKm: Math.round(haversineKm(at, loc) * 10) / 10, minutesAway: this.router.etaMinutes(at, loc, VEHICLE_SPEED_KMH.bus) }), now);
  }

  /** What the driver took on is listed wherever they look from, so it can always be let go; nearest the road first. */
  private withMine(driverDid: string, out: ComingNearRoute[], where: (loc: GeoPoint) => { detourKm: number; minutesAway: number }, now: number): ComingNearRoute[] {
    for (const p of this.mine(driverDid, now)) {
      if (out.some((g) => g.agentDid === p.agentDid && g.hopKey === p.hopKey)) continue;
      const shop = this.agents.find(p.agentDid);
      const g = this.comingAt(p.agentDid, now).find((x) => x.hopKey === p.hopKey);
      if (!shop || !g) continue;
      out.push({ ...g, ...(shop.location ? where(shop.location) : { detourKm: 0, minutesAway: 0 }), mine: { promiseId: p.promiseId, state: p.state } });
    }
    return out.sort((a, b) => a.detourKm - b.detourKm || a.minutesAway - b.minutesAway || a.shopName.localeCompare(b.shopName));
  }

  /** Who took on what a shop has for one next stop — for the shop's own list of what is booked to come in. */
  takenFor(agentDid: string, hopKey: string, now: number = Date.now()): string | undefined {
    const p = this.activeFor(agentDid, hopKey, now);
    return p ? this.nameOf(p.driverDid) : undefined;
  }

  /* ------------------------------------------------------------------------------------------------- take on -- */

  /** Take on what a shop has coming for one next stop: the room is held on the vehicle now. Refused before anything is kept. */
  takeOn(driverDid: string, agentDid: string, hopKey: string, now: number = Date.now()): PickupPromise {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) throw new GlosError('NOT_COUPLED', 'Couple to a vehicle first: the room is held on it');
    const group = this.comingAt(agentDid, now).find((g) => g.hopKey === hopKey);
    if (!group) throw new GlosError('NOT_FOUND', 'Nothing is coming in there for that stop now');
    const taken = this.activeFor(agentDid, hopKey, now);
    if (taken && taken.driverDid === driverDid) return taken;
    if (taken) throw new GlosError('CONFLICT', `${this.nameOf(taken.driverDid)} has taken these on already`);
    const room = this.dispatch.remainingCapacity(driverDid);
    if (group.kg > room) throw new GlosError('CAPACITY_EXCEEDED', `These weigh ${group.kg} kg and your ${vehicle.vehicleClass} has ${room} kg left`);
    if (this.dispatch.remainingTotes(driverDid) < 1) throw new GlosError('CAPACITY_EXCEEDED', `Your ${vehicle.vehicleClass} has no bag place left`);
    const p: PickupPromise = {
      promiseId: `pah_${randomBytes(6).toString('hex')}`,
      driverDid,
      agentDid,
      hopKey,
      hopLabel: group.hopLabel,
      kg: group.kg,
      parcels: group.parcels,
      takenAt: new Date(now).toISOString(),
      until: new Date(now + PICKUP_AHEAD_H * HOUR).toISOString(),
      state: 'promised',
    };
    this.promises.set(p.promiseId, p);
    this.tellShop(p, 'taken');
    return p;
  }

  /** The driver lets it go: the room on their vehicle is free, and the parcels are anybody's again. */
  letGo(driverDid: string, promiseId: string, now: number = Date.now()): PickupPromise {
    const p = this.promises.get(promiseId);
    if (!p || p.driverDid !== driverDid) throw new GlosError('NOT_FOUND', 'You have not taken that on');
    if (p.state !== 'promised') throw new GlosError('INVALID_STATE', p.state === 'given' ? 'The bag is yours already: hand it back at the counter instead' : 'It has ended already');
    const next: PickupPromise = { ...p, state: 'let_go', endedAt: new Date(now).toISOString() };
    this.promises.set(promiseId, next);
    this.tellShop(next, 'let_go');
    return next;
  }

  /** What a driver has taken on and not yet collected. */
  mine(driverDid: string, now: number = Date.now()): PickupPromise[] {
    return [...this.promises.values()].filter((p) => p.driverDid === driverDid && this.live(p, now)).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  }

  /* ------------------------------------------------------------------------------------------ the bag given -- */

  /**
   * A shop's bag closed and about to be offered (MdpService.offerBag): if a driver took on what that shop had for the bag's
   * stop, the bag is theirs — claimed for them, with every check a claim makes — and they are told. True when given; false
   * sends it to every driver as before (nobody took it on, or the one who did can no longer carry it — they are told why).
   */
  giveBag(tote: Tote, now: number = Date.now()): boolean {
    const to = [tote.destinationNodeId, tote.packedFor].filter((id): id is string => Boolean(id));
    const p = [...this.promises.values()].find((x) => x.agentDid === tote.locationId && to.includes(x.hopKey) && x.state === 'promised' && Date.parse(x.until) > now);
    if (!p) return false;
    // Given FIRST, so the room the promise held is not counted beside the bag while the claim weighs it: counted once.
    this.promises.set(p.promiseId, { ...p, state: 'given', toteCode: tote.code });
    const refused = this.dispatch.claimBagFor(tote.code, p.driverDid, now);
    if (refused) {
      this.promises.set(p.promiseId, { ...p, state: 'let_go', endedAt: new Date(now).toISOString() });
      this.tellDriver(p, tote, refused);
      return false;
    }
    this.tellDriver(p, tote);
    return true;
  }

  /* -------------------------------------------------------------------------------------------- internals -- */

  /** The room a driver's promises hold on their vehicle — kilos and bag places — while they are only promised. */
  heldOn(driverDid: string, now: number = Date.now()): { kg: number; bags: number } {
    let kg = 0;
    let bags = 0;
    for (const p of this.promises.values()) {
      if (p.driverDid !== driverDid || p.state !== 'promised' || !this.live(p, now)) continue;
      if (!this.stillThere(p.agentDid, p.hopKey, now)) {
        this.promises.set(p.promiseId, { ...p, state: 'done', endedAt: new Date(now).toISOString() });
        continue;
      }
      kg += p.kg;
      bags += 1;
    }
    return { kg: Math.round(kg * 100) / 100, bags };
  }

  /**
   * Whether anything a promise was for is still at the shop or booked to come: a booking still holding its place, or a
   * parcel still at the counter for that stop — loose, or in a bag there, closed or not. A closed bag waiting to be given
   * keeps the promise alive; parcels handed over loose, or called off, end it.
   */
  private stillThere(agentDid: string, hopKey: string, now: number): boolean {
    const forHop = (parcel: Parcel): boolean => {
      if (this.parcels.isSameShop(parcel)) return false;
      try {
        return this.bagPlans.hopOf(parcel).key === hopKey;
      } catch {
        return false;
      }
    };
    for (const parcel of this.parcels.list({ status: 'At_PUDO', agentDid })) if (parcel.originAgentDid === agentDid && forHop(parcel)) return true;
    for (const h of this.holds.forShop(agentDid)) {
      if (!this.holds.isHeld(h, now)) continue;
      try {
        const parcel = this.parcels.get(h.parcelId);
        if (parcel.status === 'Created' && forHop(parcel)) return true;
      } catch {
        // gone: not there
      }
    }
    return false;
  }

  /** The promise standing for a shop's next stop: promised or given, within its time, with something still coming. */
  private activeFor(agentDid: string, hopKey: string, now: number): PickupPromise | undefined {
    return [...this.promises.values()].find((p) => p.agentDid === agentDid && p.hopKey === hopKey && (p.state === 'promised' || p.state === 'given') && this.live(p, now));
  }

  /** Within its time; a promise past it is marked lapsed as it is read. */
  private live(p: PickupPromise, now: number): boolean {
    if (p.state !== 'promised' && p.state !== 'given') return false;
    if (Date.parse(p.until) > now) return true;
    this.promises.set(p.promiseId, { ...p, state: 'lapsed', endedAt: p.until });
    return false;
  }

  private onBagLoaded(code?: string): void {
    if (!code) return;
    for (const p of this.promises.values()) {
      if (p.state === 'given' && p.toteCode === code) this.promises.set(p.promiseId, { ...p, state: 'done', endedAt: new Date().toISOString() });
    }
  }

  private nameOf(driverDid: string): string {
    try {
      return this.drivers.get(driverDid).displayName;
    } catch {
      return 'A driver';
    }
  }

  /** The shop is told who takes its parcels for a stop, or that they let them go — in the bell. */
  private tellShop(p: PickupPromise, what: 'taken' | 'let_go'): void {
    const name = this.nameOf(p.driverDid);
    void this.notifications
      ?.notify(p.agentDid, {
        kind: 'pickup_ahead',
        title: what === 'taken' ? `${name} takes your parcels for ${p.hopLabel}` : `${name} no longer takes your parcels for ${p.hopLabel}`,
        body: what === 'taken' ? 'Close the bag for that stop when they are in: it is given to them, and they collect it.' : 'They go to any driver again once the bag is closed.',
        link: '/?go=bag',
        tag: `pickup-ahead:${p.promiseId}:${what}`,
        data: { promiseId: p.promiseId, hopKey: p.hopKey },
      })
      .catch((err: Error) => this.logger.warn(`pickup-ahead shop notice not sent: ${err.message}`));
  }

  /** The driver is told the bag is theirs to collect — or why it could not be given to them after all. */
  private tellDriver(p: PickupPromise, tote: Tote, refused?: string): void {
    const shop = this.agents.find(p.agentDid)?.shopName ?? 'the shop';
    void this.notifications
      ?.notify(p.driverDid, {
        kind: 'pickup_ahead',
        title: refused ? `Bag ${tote.code} at ${shop} went to other drivers` : `Bag ${tote.code} at ${shop} is yours to collect`,
        body: refused ? `${refused}. It is offered to every driver now.` : `The parcels for ${p.hopLabel} you took on: ${tote.parcels.length} in the bag. Collect it at the counter.`,
        link: '/?go=home',
        tag: `pickup-ahead:${p.promiseId}:bag`,
        data: { promiseId: p.promiseId, code: tote.code },
      })
      .catch((err: Error) => this.logger.warn(`pickup-ahead driver notice not sent: ${err.message}`));
  }
}
