import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'crypto';
import { TRUCK_SUBTYPE_CATALOG, TruckSubtype, TruckSubtypeSpec, VEHICLE_SPEC, VehicleClass } from './fleet.config';
import { Vehicle, VehicleDocuments, VehicleOwnerType } from './fleet.types';
import { Equipment } from './cargo.types';
import { FleetManagerService } from './fleet-manager.service';
import { MediaService } from './media.service';
import { DEFAULT_PRICE_PER_KM } from './pudo.config';

interface RegisterVehicleInput {
  plate: string;
  vehicleClass: VehicleClass;
  truckSubtype?: TruckSubtype;
  capacityKg?: number; // heavy registry may declare a real load capacity within class bounds
  ownerType?: VehicleOwnerType;
  ownerName: string;
  documents?: VehicleDocuments;
  vehiclePhotoRefs?: string[]; // S26 — mediaIds of the vehicle body photos
  trailerPhotoRefs?: string[]; // S26 — mediaIds of a coupled trailer's photos
  managerDid?: string; // the fleet manager that owns this vehicle (must be ACTIVE)
  pricePerKm?: number; // open-data transport rate (defaults if unset)
  equipment?: Equipment[]; // S32 — declared load/unload equipment (tail-lift, pallet jack, …) beyond the subtype baseline
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

  constructor(
    private readonly managers: FleetManagerService,
    private readonly media: MediaService,
  ) {}

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
    const vehicle: Vehicle = {
      vehicleId: `veh_${randomBytes(7).toString('hex')}`,
      managerDid: input.managerDid,
      qr: `VEH-${randomBytes(4).toString('hex').toUpperCase()}`, // dashboard sticker
      plate: input.plate.trim().toUpperCase(),
      vehicleClass: input.vehicleClass,
      truckSubtype: input.truckSubtype,
      capacityKg,
      pricePerKm: input.pricePerKm != null ? Math.round(input.pricePerKm * 1000) / 1000 : DEFAULT_PRICE_PER_KM,
      maxParcelKg: spec.maxParcelKg,
      allowsFragile: spec.allowsFragile,
      coldChain: Boolean(sub?.coldChain),
      carriesBulk: Boolean(sub?.bulk) || spec.carriesBulk,
      liquid: Boolean(sub?.liquid),
      hazmat: Boolean(sub?.hazmat),
      oversized: Boolean(sub?.oversized),
      // S32: every vehicle can do manual (human) handling; a truck subtype adds its built-in kit (a crane
      // truck self-loads), and the fleet manager may declare more (a tail-lift, a pallet jack). Deduped.
      equipment: [...new Set<Equipment>(['MAN', ...(sub?.equipment ?? []), ...(input.equipment ?? [])])],
      ownerType: input.ownerType ?? 'driver_owned',
      ownerName: input.ownerName,
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
    if (isOperator || (tenant && v.managerDid === tenant)) return v;
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

  isUsable(vehicleId: string): boolean {
    return this.vehicles.get(vehicleId)?.status === 'ACTIVE';
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

  /**
   * The active fleet's per-km rate spread — the cheapest carrier (for the locked/affordable quote) and the
   * dearest (for the flexible/any-carrier ceiling). Falls back to the default rate when no vehicle is active.
   */
  priceRange(): { min: number; max: number } {
    const rates = [...this.vehicles.values()].filter((v) => v.status === 'ACTIVE').map((v) => v.pricePerKm);
    if (!rates.length) return { min: DEFAULT_PRICE_PER_KM, max: DEFAULT_PRICE_PER_KM };
    return { min: Math.min(...rates), max: Math.max(...rates) };
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
