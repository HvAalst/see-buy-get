import { Inject, Injectable } from '@nestjs/common';
import { CargoService } from './cargo.service';
import { ConsignmentService } from './consignment.service';
import { FleetService } from './fleet.service';
import { Router, ROUTER } from './router';
import { RoutePlan } from './dispatch.types';
import { GeoPoint } from './pudo.types';
import { CargoNature } from './cargo.types';
import { CONSIGNMENT_MAX_WAIT_H, DISPATCH_MAX_DETOUR_KM, DISPATCH_MAX_PICKUP_MIN, VEHICLE_SPEED_KMH } from './pudo.config';

/**
 * A load that is COMING but cannot be taken yet — a consolidation lot still filling up.
 *
 * Deliberately not an Offer and deliberately carrying no offerId or ref: there is nothing here to claim, and
 * the shape must make that impossible rather than merely discouraged. A truck driver reads this to PLAN —
 * "eight tonnes of dry food are accumulating an hour off my route, full or forced out by Thursday" — and
 * decides for themselves whether to be near it then.
 */
export interface ExpectedLoad {
  kind: 'consignment';
  code: string;
  natureCode: CargoNature;
  pickupLabel: string;
  pickupLocation: GeoPoint;
  destLabel: string;
  /** What is in the lot today, and what it is filling toward. */
  weightKg: number;
  targetKg: number;
  fillPct: number;
  detourKm: number;
  minutesAway: number;
  /** The LATEST it goes to the marketplace — the aged-out date. Sooner if it fills first. */
  readyBy: string;
}

/**
 * ForthcomingService — what is coming, for a driver planning a route.
 *
 * Its own service for the same reason BagPlanService is: ConsignmentService already depends on
 * DispatchService (a full lot posts itself as freight), so asking dispatch about lots would close a cycle.
 * Nothing depends on this one, so it can read from all of them freely.
 *
 * Advisory only, by design. A filling lot is not a commitment — it may age out half full, or fill tomorrow —
 * so nothing here reserves a truck and nothing here promises the co-op one. When a lot does post, the
 * ordinary freight path takes over: it becomes claimable and the drivers near its pickup are pinged.
 */
@Injectable()
export class ForthcomingService {
  constructor(
    private readonly consignments: ConsignmentService,
    private readonly fleet: FleetService,
    private readonly cargo: CargoService,
    @Inject(ROUTER) private readonly router: Router,
  ) {}

  /**
   * The lots filling up along a driver's declared route.
   *
   * Same geometry as the offer list (detour + minutes from the route start), so "near your route" means one
   * thing in this app and not two. Same fitness rules as a claim, applied to the lot as it stands TODAY: its
   * commodity may demand a capability, and a driver should not be shown a load their vehicle could not carry
   * even if it stopped filling now. Never throws — an uncoupled driver simply has no vehicle to plan with,
   * and this sits beside a list that has already said so.
   *
   * FB5 removed a `carriesBulk` gate here. It rested on "a lot is bulk cargo", which was never true of a
   * consignment lot: members deposit SACKS, and ConsignmentService posts the full lot as `bagged`. The gate
   * therefore showed the filling lot to tippers — which cannot take sacks — and hid it from the flatbed with
   * a forklift that ends up carrying it. Capacity and capability still apply; packaging is not yet knowable
   * while a lot fills, so nothing here pretends to judge it.
   */
  nearRoute(driverDid: string, route: RoutePlan, now: number = Date.now()): ExpectedLoad[] {
    const vehicle = this.fleet.vehicleForDriver(driverDid);
    if (!vehicle) return [];

    return this.consignments
      .list({ status: 'open' })
      .filter((lot) => lot.weightKg > 0) // an empty lot is an intention, not a load
      .filter((lot) => lot.weightKg <= vehicle.capacityKg)
      .filter((lot) => !this.cargo.requiredCapabilities([lot.natureCode]).some((cap) => !vehicle[cap]))
      .map((lot) => ({
        lot,
        detourKm: this.router.detourKm(route.from, lot.pickupLocation, route.to),
        minutesAway: this.router.etaMinutes(route.from, lot.pickupLocation, VEHICLE_SPEED_KMH.bus),
      }))
      .filter(({ detourKm, minutesAway }) => detourKm <= DISPATCH_MAX_DETOUR_KM && minutesAway <= DISPATCH_MAX_PICKUP_MIN)
      .sort((a, b) => a.detourKm - b.detourKm || a.minutesAway - b.minutesAway)
      .map(({ lot, detourKm, minutesAway }) => ({
        kind: 'consignment' as const,
        code: lot.code,
        natureCode: lot.natureCode,
        pickupLabel: lot.pickupLabel,
        pickupLocation: lot.pickupLocation,
        destLabel: lot.destLabel,
        weightKg: lot.weightKg,
        targetKg: lot.targetKg,
        fillPct: lot.targetKg > 0 ? Math.min(100, Math.round((lot.weightKg / lot.targetKg) * 100)) : 0,
        detourKm,
        minutesAway,
        // The aged-out clock runs from the first deposit, exactly as the sweep computes it — a driver must not
        // be told a later date than the one that will actually force the lot out.
        readyBy: new Date(new Date(lot.filledAt ?? lot.openedAt).getTime() + CONSIGNMENT_MAX_WAIT_H * 3_600_000).toISOString(),
      }));
  }
}
