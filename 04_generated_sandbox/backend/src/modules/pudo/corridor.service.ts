import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'crypto';
import { BUS_MAX_KG } from './pudo.config';
import { Corridor, Driver } from './pudo.types';

/**
 * CorridorService (P-004, ↔ M3 DME light). No dynamic matchmaking: buses run static named corridors
 * between zone pairs; trucks are dispatched manually. Vehicle selection is a single heuristic —
 * total weight < 500 kg ⇒ Bus, else Truck — because the network optimises for resilience, not
 * optimisation. The same data graduates onto M3 dynamic matching in Phase 2.
 *
 * TWO KINDS OF CORRIDOR, ONE LOOKUP. The network draws its own; a fleet may PROPOSE a line it runs with its
 * own vehicles, which the network then publishes. Routing reads both the same way, because a shop taking a
 * parcel in does not care whose bus it is — and that is exactly why only the network may publish one: a
 * published line changes what every shop in its origin zone may accept.
 */
@Injectable()
export class CorridorService {
  // Durable: corridors are drawn from the operator console now, not only by seed scripts, and a route that
  // vanished on restart would silently stop every cross-zone take-in it was serving.
  private readonly corridors = new PersistentMap<string, Corridor>('pudo-corridors');
  private readonly drivers = new Map<string, Driver>(); // keyed by badgeId

  /** Bus-vs-truck heuristic (M3 light). */
  chooseVehicle(totalWeightKg: number): 'bus' | 'truck' {
    return totalWeightKg < BUS_MAX_KG ? 'bus' : 'truck';
  }

  addCorridor(input: { name: string; originZone: string; destZone: string; vehicleType?: 'bus' | 'truck'; schedule?: string }): Corridor {
    const corridor: Corridor = {
      corridorId: `cor_${randomBytes(6).toString('hex')}`,
      name: input.name,
      originZone: input.originZone,
      destZone: input.destZone,
      vehicleType: input.vehicleType ?? 'bus',
      schedule: input.schedule ?? 'daily 08:00',
      status: 'active',
    };
    this.corridors.set(corridor.corridorId, corridor);
    return corridor;
  }

  /**
   * F1 — a fleet proposes a line it will run itself.
   *
   * PROPOSED, never active: nothing routes on it until the network publishes it. The refusals are the
   * ones a proposal can be certain about — both ends, two different zones, and a pair nobody already runs
   * or is waiting to run, because `forZones` takes the first match and a second line is one nobody reaches.
   */
  proposeLine(input: {
    managerDid: string;
    company: string;
    name?: string;
    originZone: string;
    destZone: string;
    vehicleType?: 'bus' | 'truck';
    schedule?: string;
    note?: string;
  }): Corridor {
    const origin = input.originZone?.trim();
    const dest = input.destZone?.trim();
    if (!origin || !dest) throw new GlosError('FIELD_REQUIRED', 'A line runs from one zone to another — name both ends');
    if (origin === dest) throw new GlosError('INVALID_INPUT', 'Both ends are the same zone — a line is only ever used for a parcel crossing zones');
    this.refuseOccupied(origin, dest);
    const now = new Date().toISOString();
    const line: Corridor = {
      corridorId: `cor_${randomBytes(6).toString('hex')}`,
      name: input.name?.trim() || `${origin} → ${dest}`,
      originZone: origin,
      destZone: dest,
      vehicleType: input.vehicleType ?? 'bus',
      schedule: input.schedule?.trim() || 'daily 08:00',
      status: 'proposed',
      owner: { kind: 'fleet', managerDid: input.managerDid, company: input.company },
      proposedBy: input.managerDid,
      proposedAt: now,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    };
    this.corridors.set(line.corridorId, line);
    return line;
  }

  /**
   * F2 — the network makes a proposed line real. Only from `proposed`: publishing a closed line would be
   * reopening it under a different name, and that is its own decision with its own button.
   */
  publish(corridorId: string, by?: string): Corridor {
    const corridor = this.requireCorridor(corridorId);
    if (corridor.status !== 'proposed') {
      throw new GlosError('INVALID_STATE', corridor.status === 'active' ? `${corridor.name} is already published` : `${corridor.name} is closed — reopen it instead`);
    }
    // Asked again: the network may have drawn its own corridor on this pair since the fleet proposed.
    this.refuseOccupied(corridor.originZone, corridor.destZone, corridor.corridorId);
    corridor.status = 'active';
    corridor.publishedBy = by;
    corridor.publishedAt = new Date().toISOString();
    this.corridors.set(corridorId, corridor);
    return corridor;
  }

  setStatus(corridorId: string, status: 'active' | 'blocked'): Corridor {
    const corridor = this.requireCorridor(corridorId);
    // Opening a proposal through the close/reopen switch would publish it without anybody deciding to.
    if (corridor.status === 'proposed') throw new GlosError('INVALID_STATE', `${corridor.name} has not been published yet — publish it rather than opening it`);
    corridor.status = status;
    this.corridors.set(corridorId, corridor);
    return corridor;
  }

  /** Find the active corridor serving a zone pair. */
  forZones(originZone: string, destZone: string): Corridor | undefined {
    return [...this.corridors.values()].find((c) => c.status === 'active' && c.originZone === originZone && c.destZone === destZone);
  }

  listCorridors(): Corridor[] {
    return [...this.corridors.values()];
  }

  /**
   * The list as one viewer may read it. A PROPOSED line is a fleet's plan, not yet network geography: its
   * own fleet and the operator see it, and nobody else — another fleet reading a competitor's intended
   * routes off an open list is a leak, not a feature.
   */
  visibleTo(managerDid: string | undefined, operator: boolean): Corridor[] {
    return this.listCorridors().filter((c) => operator || c.status !== 'proposed' || (managerDid !== undefined && c.owner?.managerDid === managerDid));
  }

  requireCorridor(corridorId: string): Corridor {
    const corridor = this.corridors.get(corridorId);
    if (!corridor) throw new GlosError('NOT_FOUND', `Corridor not found: ${corridorId}`);
    return corridor;
  }

  /**
   * A corridor a driver of this fleet may be put on: published, and either the network's or the fleet's own.
   * An independent driver (no fleet) may use the network's corridors only.
   */
  requireUsableBy(corridorId: string, managerDid: string | undefined): Corridor {
    const corridor = this.requireCorridor(corridorId);
    if (corridor.status === 'proposed') throw new GlosError('INVALID_STATE', `${corridor.name} has not been published by the network yet — nothing can run on it`);
    if (corridor.owner && corridor.owner.managerDid !== managerDid) {
      throw new GlosError('FORBIDDEN', `${corridor.name} is ${corridor.owner.company}’s line — only its own drivers run on it`);
    }
    return corridor;
  }

  addDriver(input: { driverDid: string; name: string; corridorId: string; vehicleType?: 'bus' | 'truck'; capacityKg?: number; badgeId?: string }): Driver {
    this.requireCorridor(input.corridorId);
    const driver: Driver = {
      driverDid: input.driverDid,
      badgeId: input.badgeId ?? `BADGE-${randomBytes(4).toString('hex').toUpperCase()}`,
      name: input.name,
      corridorId: input.corridorId,
      vehicleType: input.vehicleType ?? 'bus',
      capacityKg: input.capacityKg ?? 800,
    };
    this.drivers.set(driver.badgeId, driver);
    return driver;
  }

  /** Validate a scanned driver badge against the whitelist (handover step 2.1). */
  driverByBadge(badgeId: string): Driver | undefined {
    return this.drivers.get(badgeId);
  }

  listDrivers(): Driver[] {
    return [...this.drivers.values()];
  }

  /** Nothing else may stand on a pair that is already run, or waiting to be. A closed one is not in the way. */
  private refuseOccupied(originZone: string, destZone: string, except?: string): void {
    const clash = this.listCorridors().find(
      (c) => c.corridorId !== except && c.status !== 'blocked' && c.originZone === originZone && c.destZone === destZone,
    );
    if (clash) {
      throw new GlosError(
        'DUPLICATE',
        `${clash.name} already ${clash.status === 'proposed' ? 'waits to run' : 'runs'} from ${originZone} to ${destZone}, and only the first line on a pair is ever found`,
      );
    }
  }
}
