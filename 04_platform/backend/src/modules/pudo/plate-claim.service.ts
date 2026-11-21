import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { DepartureService } from './departure.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetService } from './fleet.service';
import type { Vehicle } from './fleet.types';
import { VehicleService, plateOf } from './vehicle.service';
import { takeOffVehicle } from './vehicle-take-off';
import type { LapsedPlateClaimView, PlateClaim, PlateClaimParty, PlateClaimState, PlateClaimView, PlateClaimsView } from './plate-claim.types';

/** How long the owner has to answer before staff look at it. */
export const ANSWER_DAYS = 14;
/** How many plates one driver or fleet may have asked about and not had answered, at once. */
export const OPEN_CLAIMS_MAX = 3;
const DAY = 86_400_000;
const LOOK_EVERY_MS = 3_600_000;
const OPEN: PlateClaimState[] = ['asked', 'lapsed'];

/**
 * 2026-11-21 — A PLATE CLAIMED BY WHOEVER BOUGHT THE VEHICLE (the owner: "add the check and consider that a vehicle may be sold and
 * no longer belongs to a driver as well").
 *
 * A plate names one vehicle in use (VehicleService.requirePlateFree). A vehicle changes hands; its seller may never take it off.
 * So the buyer asks — "I bought it" — and the seller (the courier who owns it, or its fleet's office) is told in the app and
 * answers with one tap: sold, and it comes off their vehicles at once (never mid-shift or with a run waiting, vehicle-take-off.ts),
 * and the buyer is told the plate is free; or still theirs, and the buyer is told to bring their papers to the help centre.
 *
 * Not answered in fourteen days — or with nobody to ask — network staff decide on the console, with what tells whether the vehicle
 * still goes out, and a reason both are told. Nobody learns who owns a plate by asking about it.
 */
@Injectable()
export class PlateClaimService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PlateClaimService.name);
  private readonly claims = new PersistentMap<string, PlateClaim>('pudo-plate-claims');
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly vehicles: VehicleService,
    private readonly fleet: FleetService,
    private readonly departures: DepartureService,
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    @Optional() private readonly events?: EventBus,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      try {
        this.sweep();
      } catch (err) {
        this.logger.warn(`plate claims: ${(err as Error).message}`);
      }
    }, LOOK_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** "I bought it": the owner of the vehicle that carries this plate is asked whether they sold it. Asking twice is one ask. */
  ask(plate: string, claimant: PlateClaimParty, now: number = Date.now()): PlateClaim {
    const wanted = plateOf(plate);
    if (!wanted) throw new GlosError('FIELD_REQUIRED', 'A number plate is required', { field: 'plate' });
    const v = this.vehicles.holderOf(wanted);
    if (!v) throw new GlosError('INVALID_STATE', `${wanted} is on no vehicle in use now: add it`);
    const holder = this.partyOf(v);
    if (holder && holder.kind === claimant.kind && holder.did === claimant.did) throw new GlosError('INVALID_STATE', `${wanted} is one of your vehicles already`);
    const mine = this.all().filter((c) => c.claimant.did === claimant.did && OPEN.includes(c.state));
    const same = mine.find((c) => c.vehicleId === v.vehicleId);
    if (same) return same;
    if (mine.length >= OPEN_CLAIMS_MAX) throw new GlosError('INVALID_STATE', `You have asked about ${OPEN_CLAIMS_MAX} plates already: wait for their answers`);
    const at = new Date(now).toISOString();
    const country = this.countryOf(claimant);
    const claim: PlateClaim = {
      claimId: `pcl_${randomBytes(8).toString('hex')}`,
      plate: wanted,
      vehicleId: v.vehicleId,
      vehicleClass: v.vehicleClass,
      claimant,
      ...(holder ? { holder } : {}),
      ...(country ? { country } : {}),
      askedAt: at,
      // Nobody to ask (a vehicle with no fleet and no owner on record): staff look at it at once.
      state: holder ? 'asked' : 'lapsed',
      ...(holder ? {} : { lapsedAt: at }),
    };
    this.claims.set(claim.claimId, claim);
    this.publish(holder ? GlosEvent.Pudo.PlateClaimAsked : GlosEvent.Pudo.PlateClaimLapsed, claim);
    return claim;
  }

  /** The owner answers: sold — it comes off their vehicles now — or still theirs. Only the owner, only while it waits for them. */
  answer(claimId: string, by: PlateClaimParty, sold: boolean, now: number = Date.now()): PlateClaim {
    const c = this.require(claimId);
    if (!c.holder || c.holder.kind !== by.kind || c.holder.did !== by.did) throw new GlosError('FORBIDDEN', `Only the owner of ${c.plate} answers this`);
    if (c.state !== 'asked') throw new GlosError('INVALID_STATE', c.state === 'lapsed' ? `SeeBuyGet staff look at ${c.plate} now: it was not answered in ${ANSWER_DAYS} days` : `This was answered already`);
    if (sold) {
      takeOffVehicle({ vehicles: this.vehicles, fleet: this.fleet, departures: this.departures }, c.vehicleId);
      this.close(c, 'sold', now);
      this.freeOthers(c, now);
    } else {
      this.close(c, 'kept', now);
    }
    return c;
  }

  /** Staff decide a claim nobody answered: take the vehicle off its owner's list, or leave it — with a reason both are told. */
  decide(vehicleId: string, input: { claimId: string; release: boolean; reason?: string; by: string }, now: number = Date.now()): PlateClaim {
    const c = this.require(input.claimId);
    if (c.vehicleId !== vehicleId) throw new GlosError('NOT_FOUND', 'Not found');
    if (c.state !== 'lapsed') throw new GlosError('INVALID_STATE', c.state === 'asked' ? `${c.plate} is waiting for its owner's answer until ${ANSWER_DAYS} days have passed` : 'This was decided already');
    const reason = input.reason?.trim();
    if (!reason) throw new GlosError('REASON_REQUIRED', 'Say why: the one who asked and the owner are both told');
    c.decidedBy = input.by;
    c.reason = reason;
    if (input.release) {
      takeOffVehicle({ vehicles: this.vehicles, fleet: this.fleet, departures: this.departures }, c.vehicleId);
      this.close(c, 'released', now);
      this.freeOthers(c, now);
    } else {
      this.close(c, 'left', now);
    }
    return c;
  }

  /**
   * Every hour: an ask the owner has not answered in fourteen days goes to staff; one whose vehicle came off another way (its owner
   * took it off, or another claim did) is closed, and its asker told the plate is free.
   */
  sweep(now: number = Date.now()): number {
    let moved = 0;
    for (const c of this.all()) {
      if (!OPEN.includes(c.state)) continue;
      if (this.vehicleGone(c.vehicleId)) {
        this.close(c, 'freed', now);
        moved += 1;
      } else if (c.state === 'asked' && Date.parse(c.askedAt) + ANSWER_DAYS * DAY <= now) {
        c.state = 'lapsed';
        c.lapsedAt = new Date(now).toISOString();
        this.claims.set(c.claimId, c);
        this.publish(GlosEvent.Pudo.PlateClaimLapsed, c);
        moved += 1;
      }
    }
    return moved;
  }

  /** What a driver or a fleet's office reads: open asks about its vehicles, and its own asks (open, or closed in the last month). */
  viewFor(party: PlateClaimParty, now: number = Date.now()): PlateClaimsView {
    const recent = (c: PlateClaim) => OPEN.includes(c.state) || (c.closedAt && Date.parse(c.closedAt) > now - 30 * DAY);
    const newest = (a: PlateClaim, b: PlateClaim) => b.askedAt.localeCompare(a.askedAt);
    return {
      forMe: this.all().filter((c) => c.state === 'asked' && c.holder?.kind === party.kind && c.holder.did === party.did).sort(newest).map((c) => ({ ...this.viewOf(c), askedBy: c.claimant.name })),
      asked: this.all().filter((c) => c.claimant.kind === party.kind && c.claimant.did === party.did && recent(c)).sort(newest).map((c) => this.viewOf(c)),
    };
  }

  /** For staff: the claims nobody answered, oldest first, with when the vehicle last went out. */
  lapsed(): LapsedPlateClaimView[] {
    return this.all()
      .filter((c) => c.state === 'lapsed')
      .sort((a, b) => (a.lapsedAt ?? a.askedAt).localeCompare(b.lapsedAt ?? b.askedAt))
      .map((c) => {
        const last = this.fleet.lastShiftOn(c.vehicleId);
        return { claimId: c.claimId, vehicleId: c.vehicleId, plate: c.plate, vehicleClass: c.vehicleClass, claimant: c.claimant, ...(c.holder ? { holder: c.holder } : {}), askedAt: c.askedAt, lapsedAt: c.lapsedAt ?? c.askedAt, ...(last ? { lastShiftAt: last } : {}) };
      });
  }

  get(claimId: string): PlateClaim {
    return this.require(claimId);
  }

  private viewOf(c: PlateClaim): PlateClaimView {
    return { claimId: c.claimId, plate: c.plate, vehicleClass: c.vehicleClass, state: c.state, askedAt: c.askedAt, ...(c.closedAt ? { closedAt: c.closedAt } : {}), ...(c.reason ? { reason: c.reason } : {}) };
  }

  /** The other open asks about the same vehicle: the plate is free for them too, and each is told. */
  private freeOthers(done: PlateClaim, now: number): void {
    for (const c of this.all()) if (c.claimId !== done.claimId && c.vehicleId === done.vehicleId && OPEN.includes(c.state)) this.close(c, 'freed', now);
  }

  private close(c: PlateClaim, state: PlateClaimState, now: number): void {
    c.state = state;
    c.closedAt = new Date(now).toISOString();
    this.claims.set(c.claimId, c);
    this.publish(GlosEvent.Pudo.PlateClaimClosed, c);
  }

  private vehicleGone(vehicleId: string): boolean {
    try {
      return this.vehicles.get(vehicleId).status === 'RETIRED';
    } catch {
      return true;
    }
  }

  /** Whose vehicle it is: its fleet, or the courier who owns it. */
  private partyOf(v: Vehicle): PlateClaimParty | undefined {
    if (v.managerDid) {
      try {
        return { kind: 'fleet', did: v.managerDid, name: this.managers.get(v.managerDid).companyName };
      } catch {
        return undefined;
      }
    }
    if (v.ownerDriverDid) {
      try {
        return { kind: 'driver', did: v.ownerDriverDid, name: this.drivers.get(v.ownerDriverDid).displayName };
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private countryOf(p: PlateClaimParty): string | undefined {
    try {
      return p.kind === 'driver' ? this.drivers.get(p.did).jurisdiction : this.managers.get(p.did).jurisdiction;
    } catch {
      return undefined;
    }
  }

  private all(): PlateClaim[] {
    return [...this.claims.values()];
  }

  private require(claimId: string): PlateClaim {
    const c = this.claims.get(claimId);
    if (!c) throw new GlosError('NOT_FOUND', 'Not found');
    return c;
  }

  private publish(type: string, claim: PlateClaim): void {
    void this.events?.publish(type, { claim: { ...claim } }, { source: 'pudo' }).catch(() => undefined);
  }
}
