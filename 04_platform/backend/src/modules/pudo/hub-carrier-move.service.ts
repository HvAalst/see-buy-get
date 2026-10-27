import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DispatchService } from './dispatch.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { HubCarrierService } from './hub-carrier.service';
import { CARRIER_MOVE_MAX, CARRIER_WAYS_BACK, type CarrierMove, type CarrierMoveState, type CarrierMovesView, type CarrierMoveView, type CarrierWayBack } from './hub-carrier.types';
import { MdpService } from './mdp.service';
import { NotificationService } from './notification.service';
import type { Mdp } from './pudo.types';

/** What happens at the other hub, as the notices say it. */
const WAY_BACK_WORDS: Record<CarrierWayBack, string> = {
  with_driver: 'they go back with the driver who brings them',
  left: 'they are left with you, yours to keep or use',
  return_job: 'they are kept aside for a return job the owning hub posts',
};

/**
 * A HUB'S CARRIERS ON A MOVE BETWEEN HUBS (the user, 2026-10-27, D11; hub-carrier.types.ts CarrierMove). The owning hub says,
 * as its carriers go with a driver, what happens to them at the other hub — back with the driver, left there, or kept for a
 * return job it posts and pays; the other hub does it and says so; a return job delivered at the owner brings them home.
 * There is no trip record on the bag path, so a move is its own record: the driver by the pass scanned, the hub it is for.
 */
@Injectable()
export class HubCarrierMoveService implements OnModuleInit {
  private readonly moves = new PersistentMap<string, CarrierMove>('hub-carrier-moves');
  private readonly logger = new Logger(HubCarrierMoveService.name);

  constructor(
    private readonly carriers: HubCarrierService,
    private readonly mdps: MdpService,
    private readonly fleet: FleetService,
    private readonly dispatch: DispatchService,
    private readonly events: EventBus,
    @Optional() private readonly drivers?: DriverService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  onModuleInit(): void {
    // Home: the return job delivered at the owning hub.
    this.events.subscribe<{ freightId: string }>(GlosEvent.Pudo.FreightDelivered, (e) => this.cameHome(e.payload.freightId));
  }

  /** The hub's carriers on the move: its own, away; and other hubs', come to it and not yet seen to. */
  viewOf(mdpId: string): CarrierMovesView {
    this.mdps.require(mdpId);
    const all = [...this.moves.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    return {
      mdpId,
      away: all.filter((m) => m.ownerMdpId === mdpId).slice(0, 30).map((m) => this.view(m)),
      here: all.filter((m) => m.toMdpId === mdpId && (!m.done || (m.wayBack === 'return_job' && !m.home))).map((m) => this.view(m)),
    };
  }

  /**
   * CARRIERS GO WITH A DRIVER to another hub: which kind of this hub's, how many, to which hub, with whom — the driver's pass,
   * scanned as a bag is loaded — and what happens to them there. Every check before anything is written.
   */
  send(ownerMdpId: string, input: { carrierId: string; count: number; toMdpId: string; driverBadgeId: string; wayBack: CarrierWayBack }, by: string, now: number = Date.now()): CarrierMoveView {
    const owner = this.mdps.require(ownerMdpId);
    const kind = this.carriers.kindOf(ownerMdpId, input.carrierId);
    if (!kind) throw new GlosError('NOT_FOUND', 'That kind is not on your list: add it under Pallets, cages and crates first', { field: 'carrierId' });
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > CARRIER_MOVE_MAX) throw new GlosError('INVALID_INPUT', `Say how many, from 1 to ${CARRIER_MOVE_MAX}`, { field: 'count' });
    if (!CARRIER_WAYS_BACK.includes(input.wayBack)) throw new GlosError('INVALID_INPUT', 'Say how they come back: with the driver, left there, or on a return job', { field: 'wayBack' });
    if (input.toMdpId === ownerMdpId) throw new GlosError('INVALID_INPUT', 'They go to another hub', { field: 'toMdpId' });
    let to: Mdp;
    try {
      to = this.mdps.require(input.toMdpId);
    } catch {
      throw new GlosError('NOT_FOUND', 'That hub is not known', { field: 'toMdpId' });
    }
    const driver = this.fleet.resolveBadge(String(input.driverBadgeId ?? '').trim());
    if (!driver) throw new GlosError('INVALID_INPUT', 'Scan the pass of the driver who takes them: a driver on shift', { field: 'driverBadgeId' });
    const driverName = this.nameOf(driver.driverDid);
    const move: CarrierMove = {
      moveId: `cm_${randomBytes(6).toString('hex')}`,
      ownerMdpId,
      toMdpId: to.mdpId,
      carrierId: kind.carrierId,
      carrierName: kind.name,
      count: input.count,
      driverDid: driver.driverDid,
      ...(driverName ? { driverName } : {}),
      wayBack: input.wayBack,
      sentAt: new Date(now).toISOString(),
      sentBy: by,
    };
    this.moves.set(move.moveId, move);
    // The other hub, told what comes and what it is to do with it.
    this.tell(to.did, 'Carriers coming to you', `${owner.name} sends ${this.many(move)} with ${driverName ?? 'a driver'}: ${WAY_BACK_WORDS[move.wayBack]}.`, move.moveId);
    return this.view(move);
  }

  /**
   * THE OTHER HUB DOES WHAT WAS SAID, and says so: counted back out to the driver (how many — never more than came), taken in
   * as left, or kept aside for the return job. Once.
   */
  done(mdpId: string, moveId: string, count: number | undefined, by: string, now: number = Date.now()): CarrierMoveView {
    const m = this.moves.get(moveId);
    if (!m || m.toMdpId !== mdpId) throw new GlosError('NOT_FOUND', 'These carriers did not come to this hub');
    if (m.done) throw new GlosError('INVALID_STATE', 'Said already');
    const n = m.wayBack === 'with_driver' ? (count ?? m.count) : m.count;
    if (!Number.isInteger(n) || n < 0 || n > m.count) throw new GlosError('INVALID_INPUT', `Count what went back with the driver: from none to the ${m.count} that came`, { field: 'count' });
    m.done = { at: new Date(now).toISOString(), by, count: n };
    this.moves.set(m.moveId, m);
    const owner = this.mdps.require(m.ownerMdpId);
    const here = this.mdps.require(mdpId);
    if (m.wayBack === 'return_job') this.tell(owner.did, 'Your carriers wait for their return job', `${here.name} keeps ${this.many(m)} aside for you: post their return job when you are ready.`, m.moveId);
    else if (m.wayBack === 'with_driver' && n < m.count) this.tell(owner.did, 'Fewer carriers came back', `${here.name} counted ${n} of ${this.many(m)} back out to ${m.driverName ?? 'the driver'}.`, m.moveId);
    return this.view(m);
  }

  /**
   * THE RETURN JOB (the user, 2026-10-27: "Post it as a job"): the carriers kept aside at the other hub, posted as a load from
   * there back to the owning hub — on the board for any driver, priced as any load is, paid by the owning hub to the carrier,
   * between the two of them. Delivered at the owner, they are home.
   */
  postReturnJob(ownerMdpId: string, moveId: string, weightKg: number, by: string, now: number = Date.now()): CarrierMoveView {
    const m = this.moves.get(moveId);
    if (!m || m.ownerMdpId !== ownerMdpId) throw new GlosError('NOT_FOUND', 'These are not your carriers');
    if (m.wayBack !== 'return_job') throw new GlosError('INVALID_STATE', 'These do not come back on a return job');
    if (!m.done) throw new GlosError('INVALID_STATE', 'The other hub has not said yet that it keeps them aside');
    if (m.job) throw new GlosError('INVALID_STATE', `Their return job is posted already: ${m.job.code}`);
    if (!Number.isInteger(weightKg) || weightKg < 1 || weightKg > 25_000) throw new GlosError('INVALID_INPUT', 'Say what they weigh together, in whole kilograms', { field: 'weightKg' });
    const owner = this.mdps.require(ownerMdpId);
    const there = this.mdps.require(m.toMdpId);
    const f = this.dispatch.registerFreight(
      {
        description: `Empty carriers going home: ${this.many(m)} of ${owner.name}`,
        pickupLocation: there.location,
        pickupLabel: there.name,
        destLabel: owner.name,
        destLocation: owner.location,
        weightKg,
        packaging: 'piece',
        packages: m.count,
        postedByDid: owner.did,
        postedByName: by,
        betweenParties: true,
        pickupCountry: this.mdps.countryOf(there),
        destCountry: this.mdps.countryOf(owner),
      },
      now,
    );
    m.job = { freightId: f.freightId, code: f.code, postedAt: new Date(now).toISOString(), postedBy: by };
    this.moves.set(m.moveId, m);
    return this.view(m);
  }

  private cameHome(freightId: string): void {
    for (const m of this.moves.values()) {
      if (m.job?.freightId !== freightId || m.home) continue;
      m.home = { at: new Date().toISOString() };
      this.moves.set(m.moveId, m);
      try {
        this.tell(this.mdps.require(m.ownerMdpId).did, 'Your carriers are home', `${this.many(m)} came back on ${m.job.code}.`, m.moveId);
      } catch (err) {
        this.logger.warn(`carriers home, not told: ${(err as Error).message}`);
      }
    }
  }

  private view(m: CarrierMove): CarrierMoveView {
    const state: CarrierMoveState = !m.done ? 'on_the_way' : m.wayBack === 'with_driver' ? 'with_driver' : m.wayBack === 'left' ? 'left' : m.home ? 'home' : m.job ? 'returning' : 'kept';
    const nameOf = (id: string) => {
      try {
        return this.mdps.require(id).name;
      } catch {
        return id;
      }
    };
    const status = (() => {
      if (!m.job) return undefined;
      try {
        return this.dispatch.requireFreightPublic(m.job.freightId).status;
      } catch {
        return undefined;
      }
    })();
    const emptyKg = this.carriers.kindOf(m.ownerMdpId, m.carrierId)?.emptyKg;
    return {
      moveId: m.moveId,
      ownerMdpId: m.ownerMdpId,
      ownerName: nameOf(m.ownerMdpId),
      toMdpId: m.toMdpId,
      toName: nameOf(m.toMdpId),
      carrierName: m.carrierName,
      count: m.count,
      ...(m.driverName ? { driverName: m.driverName } : {}),
      wayBack: m.wayBack,
      state,
      sentAt: m.sentAt,
      ...(m.done ? { doneAt: m.done.at, doneCount: m.done.count } : {}),
      ...(m.job ? { job: { freightId: m.job.freightId, code: m.job.code, postedAt: m.job.postedAt, status: status ?? 'available' } } : {}),
      ...(m.home ? { homeAt: m.home.at } : {}),
      ...(emptyKg != null ? { emptyKg } : {}),
    };
  }

  /** "2 × Blue roll cage" — the kind's name as it was when they went. */
  private many(m: Pick<CarrierMove, 'count' | 'carrierName'>): string {
    return `${m.count} × ${m.carrierName}`;
  }

  private nameOf(driverDid: string): string | undefined {
    try {
      return this.drivers?.get(driverDid).displayName ?? undefined;
    } catch {
      return undefined;
    }
  }

  private tell(did: string, title: string, body: string, moveId: string): void {
    void this.notifications?.notify(did, { kind: 'hub_arrival', title, body, link: '/', tag: `carriers:${moveId}:${title}`, data: { moveId } }).catch((err: Error) => this.logger.warn(`carriers notice not sent: ${err.message}`));
  }
}
