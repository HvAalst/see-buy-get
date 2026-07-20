import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { BUS_MAX_KG } from './pudo.config';
import { Corridor, Driver } from './pudo.types';

/**
 * CorridorService (P-004, ↔ M3 DME light). No dynamic matchmaking: buses run static named corridors
 * between zone pairs; trucks are dispatched manually. Vehicle selection is a single heuristic —
 * total weight < 500 kg ⇒ Bus, else Truck — because the network optimises for resilience, not
 * optimisation. The same data graduates onto M3 dynamic matching in Phase 2.
 */
@Injectable()
export class CorridorService {
  private readonly corridors = new Map<string, Corridor>();
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

  setStatus(corridorId: string, status: 'active' | 'blocked'): Corridor {
    const corridor = this.requireCorridor(corridorId);
    corridor.status = status;
    return corridor;
  }

  /** Find the active corridor serving a zone pair. */
  forZones(originZone: string, destZone: string): Corridor | undefined {
    return [...this.corridors.values()].find((c) => c.status === 'active' && c.originZone === originZone && c.destZone === destZone);
  }

  listCorridors(): Corridor[] {
    return [...this.corridors.values()];
  }

  requireCorridor(corridorId: string): Corridor {
    const corridor = this.corridors.get(corridorId);
    if (!corridor) throw new NotFoundException(`Corridor not found: ${corridorId}`);
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
}
