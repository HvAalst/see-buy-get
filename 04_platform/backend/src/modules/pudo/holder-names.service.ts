import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { AgentService } from './agent.service';
import { DispatchService } from './dispatch.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetService } from './fleet.service';
import { MdpService } from './mdp.service';
import { ParcelService } from './parcel.service';
import type { NowWithView } from './now-with.types';
import type { CustodyLeg, Parcel } from './pudo.types';

/** A hub's own id, as the hubs are given one (mdp.service.ts) — never shown as a name. */
const HUB_ID = /^mdp_/;

/**
 * 2026-11-15 — WHO HAS IT NOW, BY NAME (plan R1). Reads the open leg of a parcel's hand-over chain, or a load's driver, and
 * names the holder as the network contracts with it: a shop by its trading name, a hub by its name, on the road the fleet's
 * trading name (or the name an independent courier rides under) and the kind of vehicle. Bound to the parcels and loads
 * late, so neither has to know the hubs, the fleets or the drivers.
 */
@Injectable()
export class HolderNamesService implements OnModuleInit {
  constructor(
    private readonly parcels: ParcelService,
    private readonly dispatch: DispatchService,
    private readonly agents: AgentService,
    @Optional() private readonly mdps?: MdpService,
    @Optional() private readonly drivers?: DriverService,
    @Optional() private readonly managers?: FleetManagerService,
    @Optional() private readonly fleet?: FleetService,
  ) {}

  onModuleInit(): void {
    this.parcels.registerHolderNames((leg, p) => this.ofLeg(leg, p));
    this.dispatch.registerCarrierNames((driverDid) => this.carrier(driverDid));
  }

  /** The open leg of a parcel's chain, named. Nothing for the receiver: by then it is delivered. */
  ofLeg(leg: CustodyLeg, p: Parcel): NowWithView | undefined {
    const since = leg.from;
    switch (leg.holderKind) {
      case 'sender':
        return { kind: 'sender', since };
      case 'shop': {
        const name = this.agents.find(leg.holderId)?.shopName;
        return { kind: 'shop', since, ...(name ? { name } : {}) };
      }
      case 'hub': {
        const name = this.hubName(leg.holderId, p.atMdpId);
        return { kind: 'hub', since, ...(name ? { name } : {}) };
      }
      case 'driver': {
        const { name, vehicle } = this.carrier(leg.holderId);
        return { kind: 'carrier', since, ...(name ? { name } : {}), ...(vehicle ? { vehicle } : {}) };
      }
      // 2026-11-18 — a route's carrier across a border (step 2c): the company, by the name the route gives it.
      case 'carrier':
        return { kind: 'carrier', since, ...(leg.holderId ? { name: leg.holderId } : {}) };
      default:
        return undefined;
    }
  }

  /**
   * A hub, by name. A hub's hand-over records its NAME (mdp.service.ts), older ones its id: either is read, and an id
   * nobody can look up is never shown.
   */
  hubName(holderId: string, atMdpId?: string): string | undefined {
    const found = this.mdps?.find(holderId)?.name ?? (atMdpId ? this.mdps?.find(atMdpId)?.name : undefined);
    if (found) return found;
    return holderId && !HUB_ID.test(holderId) && !holderId.startsWith('did:') ? holderId : undefined;
  }

  /** On the road: the company we contract with and the kind of vehicle. A badge nobody knows names nobody. */
  carrier(driverDid: string): { name?: string; vehicle?: string } {
    let name: string | undefined;
    try {
      const driver = this.drivers?.get(driverDid);
      if (driver?.managerDid) {
        const m = this.managers?.get(driver.managerDid);
        name = m ? m.tradingName || m.companyName : undefined;
      } else {
        name = driver?.displayName;
      }
    } catch {
      name = undefined;
    }
    let vehicle: string | undefined;
    try {
      vehicle = this.fleet?.vehicleForDriver(driverDid)?.vehicleClass;
    } catch {
      vehicle = undefined;
    }
    return { ...(name ? { name } : {}), ...(vehicle ? { vehicle } : {}) };
  }
}
