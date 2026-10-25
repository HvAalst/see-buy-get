import { lapsedOf, offRoadLine, vehiclePapers } from './papers';
import { Injectable, Optional } from '@nestjs/common';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'crypto';
import { DEFAULT_MAX_MULTIPLIER, DEFAULT_MIN_MULTIPLIER, TRUCK_SUBTYPE_CATALOG, TruckSubtype, TruckSubtypeSpec, VEHICLE_SPEC, VehicleClass } from './fleet.config';
import { Vehicle, VehicleDocuments, VehicleOwnerType } from './fleet.types';
import { Equipment } from './cargo.types';
import { clampMultiplier } from './pricing';
import { FleetManagerService } from './fleet-manager.service';
import { MediaService } from './media.service';
import { DEFAULT_PRICE_PER_KM, NETWORK_JURISDICTION } from './pudo.config';
import { haversineKm } from './geo';
import type { GeoPoint } from './pudo.types';

/** A reason a vehicle is off the road, in words — for now, or for `day` (YYYY-MM-DD, on the owner's clock) when asked. */
export type OffRoadSource = (vehicle: Vehicle, at: { now: number; day?: string }) => string[];

interface RegisterVehicleInput {
  plate: string;
  vehicleClass: VehicleClass;
  truckSubtype?: TruckSubtype;
  capacityKg?: number; // heavy registry may declare a real load capacity within class bounds
  toteCapacity?: number; // how many BAGS the hold takes (defaults per class — see VehicleClassSpec.defaultTotes)
  /** How high the loading deck stands, in metres. Declared: only the fleet can measure it, and a guess
   *  would clear a load under a bridge on arithmetic about other people's trucks. */
  deckM?: number;
  ownerType?: VehicleOwnerType;
  ownerName: string;
  /** The courier whose own vehicle this is — set by signup, never by a form; only they may start a shift on it. */
  ownerDriverDid?: string;
  documents?: VehicleDocuments;
  vehiclePhotoRefs?: string[]; // S26 — mediaIds of the vehicle body photos
  trailerPhotoRefs?: string[]; // S26 — mediaIds of a coupled trailer's photos
  managerDid?: string; // the fleet manager that owns this vehicle (must be ACTIVE)
  /** Where a courier's own vehicle works — set by the paths that make one, never by a form; it picks the country whose
   *  rates the vehicle starts from (a fleet's vehicle starts from its fleet's company's). */
  country?: string;
  pricePerKm?: number; // the owner's own transport rate; unset, the country's company's starting rate
  equipment?: Equipment[]; // S32 — declared load/unload equipment (tail-lift, pallet jack, …) beyond the subtype baseline
  baseFee?: number; // S34 — flag-down fee (defaults per class)
  minMultiplier?: number; // S34 — the driver's price floor multiplier (default 0.8)
  maxMultiplier?: number; // S34 — the driver's price ceiling multiplier (default 1.5)
}

/**
 * VehicleService — the fleet registry (Compendium Ch 19). Every vehicle has its own ID, independent
 * of any driver. The system COMPUTES capacity from the class (light classes are fixed; heavy classes
 * may declare a real load within bounds) and derives handling rules (fragile / cold-chain / bulk).
 * There is no hard roadworthiness gate (insurance is government-regulated) — instead a vehicle with
 * full registration + a doc photo + a factory/VIN number is flagged `verified` for dispatch priority.
 */
@Injectable()
export class VehicleService {
  // Durable: registered fleet vehicles (documents, verification, pricing, manager ownership).
  private readonly vehicles = new PersistentMap<string, Vehicle>('pudo-vehicles');
  private readonly offRoadSources: OffRoadSource[] = [];
  private readonly noteSources: Array<(vehicle: Vehicle, now: number) => string[]> = [];

  constructor(
    private readonly managers: FleetManagerService,
    private readonly media: MediaService,
    // The rates a vehicle starts from: its country's company's list (2026-10-25). Optional for the specs built by hand.
    @Optional() private readonly entities?: EntityService,
  ) {}

  /**
   * WHAT A VEHICLE'S RATE STARTS FROM where its owner names none of their own (the user, 2026-10-25: "each countries
   * rate and individually the individuals can overrule with their own rate"): the list of the company that settles it
   * — a fleet's company, or the company of the country a courier's vehicle works in — in that company's money. A
   * smaller class starts from its share of the truck's loading fee, as the class defaults always were. With no company
   * of ours behind it, the figures every company starts from.
   */
  private startingRates(input: Pick<RegisterVehicleInput, 'managerDid' | 'country'>): { perKm: number; truckBaseFee: number } {
    const manager = input.managerDid ? this.managers.get(input.managerDid) : undefined;
    const entityId = manager ? this.managers.entityIdOrNone(manager) : this.entities?.forJurisdiction(input.country ?? NETWORK_JURISDICTION)?.entityId;
    const list = this.entities?.amountsFor(entityId);
    return { perKm: list?.freightPerKm ?? DEFAULT_PRICE_PER_KM, truckBaseFee: list?.freightBaseFee ?? VEHICLE_SPEC.truck.defaultBaseFee };
  }

  /**
   * WHICH VEHICLES MAY PRICE A PARCEL (the user, 2026-10-25: "a quote price should be taken only from vehicles that can
   * carry that load, within the unified currency range"). Active; able to take a parcel this heavy — its class's
   * per-parcel limit and its own capacity — and fragile goods only where it takes them; and with its rate in
   * `currency`, the quote's own money, as `moneyOf` says (DriverService.rateCurrencyOf: the settling company's): a
   * rate in another money read as if it were this one would be a wrong price, not a cheap one, and a rate in no money
   * anybody can name is left out. `only`, where given, narrows them to those vehicles (the ones near the asker).
   */
  carrierRates(q: { currency: string; moneyOf: (v: Vehicle) => string | undefined; kg?: number; fragile?: boolean; only?: ReadonlySet<string> }): number[] {
    return [...this.vehicles.values()]
      .filter((v) => v.status === 'ACTIVE' && (!q.only || q.only.has(v.vehicleId)))
      .filter((v) => q.kg == null || (q.kg <= v.maxParcelKg && q.kg <= v.capacityKg))
      .filter((v) => !q.fragile || v.allowsFragile)
      .filter((v) => q.moneyOf(v) === q.currency)
      .map((v) => v.pricePerKm)
      .filter((rate) => Number.isFinite(rate) && rate >= 0);
  }

  /** The active vehicles of fleets whose depot stands within `km` of a place. */
  basedNear(point: GeoPoint, km: number): string[] {
    return [...this.vehicles.values()]
      .filter((v) => v.status === 'ACTIVE' && v.managerDid)
      .filter((v) => {
        try {
          const depot = this.managers.get(v.managerDid!).location;
          return Boolean(depot) && haversineKm(depot, point) <= km;
        } catch {
          return false;
        }
      })
      .map((v) => v.vehicleId);
  }

  register(input: RegisterVehicleInput): Vehicle {
    const spec = VEHICLE_SPEC[input.vehicleClass];
    if (!spec) throw new GlosError('INVALID_VEHICLE_CLASS', `Unknown vehicle class: ${input.vehicleClass}`);
    if (input.managerDid) this.managers.requireActive(input.managerDid);
    if (!input.plate?.trim()) throw new GlosError('FIELD_REQUIRED', 'A number plate is required');
    if (input.vehicleClass === 'truck' && !input.truckSubtype) throw new GlosError('FIELD_REQUIRED', 'A truck needs a sub-type (e.g. flatbed / tipper / refrigerated / tanker / lowboy …)');
    if (input.truckSubtype && input.vehicleClass !== 'truck') throw new GlosError('INVALID_INPUT', 'Sub-types apply to trucks only');
    if (input.truckSubtype && !TRUCK_SUBTYPE_CATALOG[input.truckSubtype]) throw new GlosError('INVALID_TRUCK_SUBTYPE', `Unknown truck sub-type: ${input.truckSubtype}`);

    const sub: TruckSubtypeSpec | undefined = input.truckSubtype ? TRUCK_SUBTYPE_CATALOG[input.truckSubtype] : undefined;
    const capacityKg = this.computeCapacity(input.vehicleClass, input.capacityKg, sub?.capacityKg);
    const docs = input.documents ?? {};
    const starting = this.startingRates(input);
    const vehicle: Vehicle = {
      vehicleId: `veh_${randomBytes(7).toString('hex')}`,
      managerDid: input.managerDid,
      qr: `VEH-${randomBytes(4).toString('hex').toUpperCase()}`, // dashboard sticker
      plate: input.plate.trim().toUpperCase(),
      vehicleClass: input.vehicleClass,
      truckSubtype: input.truckSubtype,
      capacityKg,
      // The other capacity: how many BAGS the hold takes. A declared figure is honoured (an owner knows their
      // own boot); otherwise the class default. Never zero — a vehicle that can carry nothing is not a vehicle.
      toteCapacity: input.toteCapacity != null && input.toteCapacity > 0 ? Math.floor(input.toteCapacity) : spec.defaultTotes,
      // HOW HIGH THE DECK STANDS. Only when the fleet measured it: there is no class default and there must
      // not be one, because a guessed deck would clear a load under a bridge on arithmetic about other
      // people's trucks. Absent leaves the hazard map answering HEIGHT_UNKNOWN, which is the truth.
      ...(input.deckM != null && input.deckM > 0 && input.deckM < 3 ? { deckM: Math.round(input.deckM * 100) / 100 } : {}),
      // The owner's own rate where they name one; else the country's company's, which they can overrule any time (setPrice).
      pricePerKm: input.pricePerKm != null ? Math.round(input.pricePerKm * 1000) / 1000 : Math.round(starting.perKm * 1000) / 1000,
      // S34 — the pricing profile. Defaults are class-scaled (a bike's flag-down is a fraction of a truck's) with a
      // sane [0.8, 1.5] corridor; a fleet may declare its own. Bounds are sanitised so min ≤ max ≤ 3.
      baseFee:
        input.baseFee != null && input.baseFee >= 0
          ? Math.round(input.baseFee * 100) / 100
          : Math.round(((spec.defaultBaseFee / VEHICLE_SPEC.truck.defaultBaseFee) * starting.truckBaseFee) * 100) / 100,
      minMultiplier: clampMultiplier(input.minMultiplier ?? DEFAULT_MIN_MULTIPLIER),
      maxMultiplier: Math.max(clampMultiplier(input.minMultiplier ?? DEFAULT_MIN_MULTIPLIER), clampMultiplier(input.maxMultiplier ?? DEFAULT_MAX_MULTIPLIER)),
      maxParcelKg: spec.maxParcelKg,
      allowsFragile: spec.allowsFragile,
      coldChain: Boolean(sub?.coldChain),
      // FB5 — the SUBTYPE decides, exactly as it does for coldChain/liquid/hazmat/oversized above and below.
      // This line alone carried `|| spec.carriesBulk`, and every truck class defaults it true — so a box-body
      // dry van declared it could take loose sand. The fallback was only ever defensible while the flag meant
      // "can carry sacks", which is true of any truck; it means LOOSE, which is true of very few.
      // A truck with no subtype declared keeps the old class default: we do not know its body, and stranding
      // every vehicle registered before subtypes existed would be a worse answer than the one we had.
      carriesBulk: sub ? Boolean(sub.bulk) : spec.carriesBulk,
      liquid: Boolean(sub?.liquid),
      hazmat: Boolean(sub?.hazmat),
      oversized: Boolean(sub?.oversized),
      // S32: every vehicle can do manual (human) handling; a truck subtype adds its built-in kit (a crane
      // truck self-loads), and the fleet manager may declare more (a tail-lift, a pallet jack). Deduped.
      equipment: [...new Set<Equipment>(['MAN', ...(sub?.equipment ?? []), ...(input.equipment ?? [])])],
      ownerType: input.ownerType ?? 'driver_owned',
      ownerName: input.ownerName,
      // A fleet's vehicle is the fleet's, whoever is named on it: an owner-driver is recorded only where no fleet owns it.
      ...(input.ownerDriverDid && !input.managerDid ? { ownerDriverDid: input.ownerDriverDid } : {}),
      documents: docs,
      vehiclePhotoRefs: input.vehiclePhotoRefs?.length ? input.vehiclePhotoRefs : undefined,
      trailerPhotoRefs: input.trailerPhotoRefs?.length ? input.trailerPhotoRefs : undefined,
      verified: Boolean(docs.registrationPhotoRef && docs.factoryId),
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    this.vehicles.set(vehicle.vehicleId, vehicle);
    // S26: attach the owner's images to this vehicle → 'vehicle-asset' bin (user-managed while registered).
    const link = { type: 'vehicle' as const, id: vehicle.vehicleId };
    for (const ref of input.vehiclePhotoRefs ?? []) this.media.link(ref, link, 'vehicle');
    for (const ref of input.trailerPhotoRefs ?? []) this.media.link(ref, link, 'trailer');
    this.media.link(docs.registrationPhotoRef, link, 'registration');
    return vehicle;
  }

  /**
   * Capacity the system assigns. A declared load is honoured (clamped to the class ceiling); otherwise
   * a truck sub-type's typical payload applies, falling back to the class default. Registration is
   * flexible — any class may declare a real figure.
   */
  computeCapacity(vehicleClass: VehicleClass, declaredKg?: number, subtypeKg?: number): number {
    const spec = VEHICLE_SPEC[vehicleClass];
    if (declaredKg != null) {
      if (declaredKg <= 0) throw new GlosError('AMOUNT_INVALID', 'Load capacity must be positive');
      const ceiling = Math.max(spec.maxCapacityKg, subtypeKg ?? 0);
      return Math.min(declaredKg, ceiling);
    }
    return subtypeKg ?? spec.defaultCapacityKg;
  }

  /** Attach / update documents — re-evaluates the verified (priority) flag. */
  updateDocuments(vehicleId: string, documents: VehicleDocuments): Vehicle {
    const v = this.require(vehicleId);
    v.documents = { ...v.documents, ...documents };
    v.verified = Boolean(v.documents.registrationPhotoRef && v.documents.factoryId);
    return v;
  }

  ground(vehicleId: string): Vehicle {
    const v = this.require(vehicleId);
    v.status = 'GROUNDED';
    return v;
  }

  /**
   * A vehicle scoped to the viewer. The owning manager (or an operator) sees the full record; anyone else
   * sees only the PUBLIC marketplace fields — never the owner id, registration documents, dashboard QR or
   * the S26 media refs. Keeps the newly-added photo mediaIds off a raw cross-tenant read (the S25
   * raw-object-leak lesson). Used by both the detail and the (open-data) list surfaces.
   */
  private scopedView(v: Vehicle, tenant: string | undefined, isOperator: boolean): Vehicle | Partial<Vehicle> {
    // FP4 — the owner sees the papers as they stand today, derived here and never written back.
    if (isOperator || (tenant && v.managerDid === tenant)) return { ...v, papers: vehiclePapers(v), offRoad: this.offRoadReasons(v.vehicleId), upkeep: this.upkeepReasons(v), notes: this.noteSources.flatMap((source) => source(v, Date.now())) };
    const publicView: Partial<Vehicle> = { ...v };
    delete publicView.managerDid;
    delete publicView.documents;
    delete publicView.vehiclePhotoRefs;
    delete publicView.trailerPhotoRefs;
    delete publicView.qr; // the dashboard shift sticker is the owner's, not marketplace data
    // ownerName is the driver's real full name for a driver-owned vehicle (Golden-Record PII) — never
    // marketplace data; the genuine public surfaces (/pricing, /network/points) never carry it either.
    delete publicView.ownerName;
    delete publicView.ownerType;
    delete publicView.ownerDriverDid; // which person a van belongs to is not marketplace data either
    return publicView;
  }

  /** Vehicle detail scoped to the viewer (see scopedView). */
  viewFor(vehicleId: string, tenant: string | undefined, isOperator: boolean): Vehicle | Partial<Vehicle> {
    return this.scopedView(this.require(vehicleId), tenant, isOperator);
  }

  /** The vehicle list scoped to the viewer — a fleet manager's own rows are full; others get public rows. */
  listFor(filter: { status?: Vehicle['status']; vehicleClass?: VehicleClass; managerDid?: string }, tenant: string | undefined, isOperator: boolean): Array<Vehicle | Partial<Vehicle>> {
    return this.list(filter).map((v) => this.scopedView(v, tenant, isOperator));
  }

  retire(vehicleId: string): Vehicle {
    const v = this.require(vehicleId);
    v.status = 'RETIRED';
    this.media.anchorVehicleRetired(vehicleId); // S26: start the grace clock on this vehicle's asset photos
    return v;
  }

  /**
   * ACTIVE, and nothing keeps it off the road: no paper lapsed (FP4), and no reason any other part of the network has
   * registered (in the workshop, a safety defect, a service overdue). Each is derived, so the vehicle is back the
   * moment its reason ends. `day` asks about a day other than today, on the owner's clock — a plan for tomorrow.
   */
  isUsable(vehicleId: string, now: number = Date.now(), day?: string): boolean {
    const v = this.vehicles.get(vehicleId);
    return v?.status === 'ACTIVE' && this.offRoadReasons(vehicleId, now, day).length === 0;
  }

  /** Why this vehicle cannot start a shift, in words, one line per reason: its papers first. Empty when it can. */
  offRoadReasons(vehicleId: string, now: number = Date.now(), day?: string): string[] {
    const v = this.vehicles.get(vehicleId);
    if (!v) return [];
    return [...lapsedOf(vehiclePapers(v, now)).map(offRoadLine), ...this.offRoadSources.flatMap((source) => source(v, { now, day }))];
  }

  /** What keeps it off the road besides its papers — in the workshop, a defect, a service overdue — for its owner's list. */
  private upkeepReasons(v: Vehicle, now: number = Date.now()): string[] {
    return this.offRoadSources.flatMap((source) => source(v, { now }));
  }

  /**
   * Another reason a vehicle can be off the road, owned by the feature that knows it: the gate stays ONE place — every
   * door that starts a shift, plans a day or books a run already asks isUsable — and the feature stays its own.
   */
  addOffRoadSource(source: OffRoadSource): void {
    this.offRoadSources.push(source);
  }

  /** Something its owner should know that does NOT keep it off the road — a service due soon — for the owner's list. */
  addNoteSource(source: (vehicle: Vehicle, now: number) => string[]): void {
    this.noteSources.push(source);
  }

  /** Back to ACTIVE, for a vehicle grounded before grounding had a way back. */
  reinstate(vehicleId: string): Vehicle {
    const v = this.require(vehicleId);
    if (v.status === 'GROUNDED') v.status = 'ACTIVE';
    this.vehicles.set(vehicleId, v);
    return v;
  }

  /** Resolve a scanned dashboard sticker (the QR, or the plate / id typed as a fallback). */
  byQr(scan: string): Vehicle | undefined {
    const s = (scan || '').trim().toUpperCase();
    return [...this.vehicles.values()].find((v) => v.qr === s || v.plate === s || v.vehicleId === scan);
  }

  get(vehicleId: string): Vehicle {
    return this.require(vehicleId);
  }

  /** Set the vehicle's open-data per-km transport rate (the driver/fleet manager prices their own asset). */
  setPrice(vehicleId: string, pricePerKm: number): Vehicle {
    if (pricePerKm < 0) throw new GlosError('AMOUNT_INVALID', 'Price cannot be negative');
    const vehicle = this.require(vehicleId);
    vehicle.pricePerKm = Math.round(pricePerKm * 1000) / 1000;
    return vehicle;
  }

  list(filter: { status?: Vehicle['status']; vehicleClass?: VehicleClass; managerDid?: string } = {}): Vehicle[] {
    return [...this.vehicles.values()].filter((v) => (!filter.status || v.status === filter.status) && (!filter.vehicleClass || v.vehicleClass === filter.vehicleClass) && (!filter.managerDid || v.managerDid === filter.managerDid));
  }

  private require(vehicleId: string): Vehicle {
    const v = this.vehicles.get(vehicleId);
    if (!v) throw new GlosError('NOT_FOUND', `Vehicle not found: ${vehicleId}`);
    return v;
  }
}
