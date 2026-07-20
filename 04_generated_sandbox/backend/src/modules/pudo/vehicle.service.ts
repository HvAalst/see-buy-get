import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'crypto';
import { TRUCK_SUBTYPE_CATALOG, TruckSubtype, TruckSubtypeSpec, VEHICLE_SPEC, VehicleClass } from './fleet.config';
import { Vehicle, VehicleDocuments, VehicleOwnerType } from './fleet.types';
import { FleetManagerService } from './fleet-manager.service';
import { DEFAULT_PRICE_PER_KM } from './pudo.config';

interface RegisterVehicleInput {
  plate: string;
  vehicleClass: VehicleClass;
  truckSubtype?: TruckSubtype;
  capacityKg?: number; // heavy registry may declare a real load capacity within class bounds
  ownerType?: VehicleOwnerType;
  ownerName: string;
  documents?: VehicleDocuments;
  managerDid?: string; // the fleet manager that owns this vehicle (must be ACTIVE)
  pricePerKm?: number; // open-data transport rate (defaults if unset)
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

  constructor(private readonly managers: FleetManagerService) {}

  register(input: RegisterVehicleInput): Vehicle {
    const spec = VEHICLE_SPEC[input.vehicleClass];
    if (!spec) throw new BadRequestException(`Unknown vehicle class: ${input.vehicleClass}`);
    if (input.managerDid) this.managers.requireActive(input.managerDid);
    if (!input.plate?.trim()) throw new BadRequestException('A number plate is required');
    if (input.vehicleClass === 'truck' && !input.truckSubtype) throw new BadRequestException('A truck needs a sub-type (e.g. flatbed / tipper / refrigerated / tanker / lowboy …)');
    if (input.truckSubtype && input.vehicleClass !== 'truck') throw new BadRequestException('Sub-types apply to trucks only');
    if (input.truckSubtype && !TRUCK_SUBTYPE_CATALOG[input.truckSubtype]) throw new BadRequestException(`Unknown truck sub-type: ${input.truckSubtype}`);

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
      ownerType: input.ownerType ?? 'driver_owned',
      ownerName: input.ownerName,
      documents: docs,
      verified: Boolean(docs.registrationPhotoRef && docs.factoryId),
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    this.vehicles.set(vehicle.vehicleId, vehicle);
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
      if (declaredKg <= 0) throw new BadRequestException('Load capacity must be positive');
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

  retire(vehicleId: string): Vehicle {
    const v = this.require(vehicleId);
    v.status = 'RETIRED';
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
    if (pricePerKm < 0) throw new BadRequestException('Price cannot be negative');
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
    if (!v) throw new NotFoundException(`Vehicle not found: ${vehicleId}`);
    return v;
  }
}
