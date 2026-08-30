// Fleet domain config (Compendium Ch 19 — Drivers & Fleet). Vehicle classes span micro last-mile
// (bicycle, motorcycle) through line-haul (bus) and bulk cargo (truck). The system computes capacity
// + handling rules per class, and the class decides how rigorous DRIVER onboarding is:
//   - light registry  (bike, motorcycle): fast onboarding so micro-businesses can join the MDP→PUDO
//     feeder. The system knows the limits — a bike takes ≤ 20 kg parcels and NO fragile items.
//   - heavy registry  (tuktuk, car, van, bus, truck): full KYC + a valid licence with expiry +
//     full vehicle spec (type, sub-type, load capacity).
// Vehicle docs are a PRIORITY signal, not a hard gate — insurance is government-regulated; GLOS just
// prefers vehicles with full registration + doc photos + a factory/VIN number.

import { ParcelSize } from './pudo.types';
import { Equipment } from './cargo.types';

/** The runtime half of VehicleClass, so a class the API publishes cannot drift from one the code knows. */
export const VEHICLE_CLASSES = ['bike', 'motorcycle', 'tuktuk', 'car', 'van', 'bus', 'truck'] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

/**
 * A truck "comes in many forms" — an extensive body/handling taxonomy (Ch 19), because heavy freight
 * is where GLOS ultimately scales. Each sub-type carries a default load + handling capabilities
 * (cold-chain / dry-bulk / liquid / hazmat / oversized) the system uses for capacity + future matching.
 */
export interface TruckSubtypeSpec {
  label: string;
  capacityKg: number; // typical payload (operator may still declare a real figure)
  bulk?: boolean; // loose dry bulk (cement, grain, aggregate)
  coldChain?: boolean; // temperature-controlled
  liquid?: boolean; // tanker
  hazmat?: boolean; // dangerous goods
  oversized?: boolean; // abnormal / project cargo
  // S32 — load/unload equipment BUILT INTO this body (a crane truck self-loads; a sidelifter has a forklift).
  // The fleet manager may declare additional equipment the truck carries (a tail-lift, a pallet jack); this
  // is only the subtype-implied baseline. Every vehicle also gets 'MAN' (human handling) at register time.
  equipment?: Equipment[];
}

export const TRUCK_SUBTYPE_CATALOG = {
  flatbed: { label: 'Flatbed (open)', capacityKg: 12000 },
  dropside: { label: 'Drop-side', capacityKg: 8000, bulk: true },
  box: { label: 'Box / dry van', capacityKg: 10000 },
  curtain_side: { label: 'Curtain-side (tautliner)', capacityKg: 12000 },
  refrigerated: { label: 'Refrigerated (reefer)', capacityKg: 9000, coldChain: true },
  insulated: { label: 'Insulated', capacityKg: 9000, coldChain: true },
  tipper: { label: 'Tipper / dumper', capacityKg: 16000, bulk: true },
  cement_mixer: { label: 'Concrete mixer', capacityKg: 12000, bulk: true },
  grain_hopper: { label: 'Grain hopper', capacityKg: 22000, bulk: true },
  bulk_tanker: { label: 'Dry-bulk tanker (cement/flour)', capacityKg: 22000, bulk: true },
  tanker: { label: 'Tanker (liquids)', capacityKg: 20000, liquid: true },
  food_tanker: { label: 'Food-grade tanker', capacityKg: 18000, liquid: true },
  fuel_tanker: { label: 'Fuel tanker', capacityKg: 20000, liquid: true, hazmat: true },
  water_bowser: { label: 'Water bowser', capacityKg: 16000, liquid: true },
  hazmat: { label: 'Hazmat / chemical', capacityKg: 18000, hazmat: true },
  car_carrier: { label: 'Car carrier', capacityKg: 10000, oversized: true, equipment: ['RMP'] },
  livestock: { label: 'Livestock', capacityKg: 12000, equipment: ['RMP'] },
  skeletal: { label: 'Skeletal (container chassis)', capacityKg: 30000 },
  container_selfloader: { label: 'Container self-loader (sidelifter)', capacityKg: 30000, equipment: ['CRN', 'FLT'] },
  crane: { label: 'Crane / Hiab', capacityKg: 14000, equipment: ['CRN', 'STR'] },
  lowboy: { label: 'Lowboy / low-loader (machinery)', capacityKg: 40000, oversized: true, equipment: ['RMP'] },
  logging: { label: 'Logging / timber', capacityKg: 25000, oversized: true, equipment: ['CRN'] },
  tow_recovery: { label: 'Tow / recovery', capacityKg: 8000, equipment: ['CRN'] },
  refuse: { label: 'Refuse / compactor', capacityKg: 12000 },
} satisfies Record<string, TruckSubtypeSpec>;

export type TruckSubtype = keyof typeof TRUCK_SUBTYPE_CATALOG;
export const TRUCK_SUBTYPES = Object.keys(TRUCK_SUBTYPE_CATALOG) as TruckSubtype[];

export interface VehicleClassSpec {
  registry: 'light' | 'heavy'; // drives driver-onboarding rigor
  defaultCapacityKg: number; // system-computed capacity when none is provided
  maxCapacityKg: number; // upper bound the operator may declare (heavy registry)
  /**
   * How many BAGS the hold takes — the constraint weight cannot express. A tote of letters weighs almost
   * nothing, so by kilos a bus "fits" a hundred of them while its boot holds a dozen. This is the number a
   * driver actually runs out of on a line-haul, and it is what a bag claim is checked against.
   */
  defaultTotes: number;
  maxParcelKg: number; // largest single parcel this class may carry
  allowsFragile: boolean; // a bike/motorcycle may not carry fragile items
  carriesBulk: boolean; // bulk cargo (sugar/cement bags) — trucks only
  defaultBaseFee: number; // S34 — flag-down / loading fee (deadhead + load time), scaled to the class
  role: string;
}

export const VEHICLE_SPEC: Record<VehicleClass, VehicleClassSpec> = {
  bike: { registry: 'light', defaultCapacityKg: 20, maxCapacityKg: 20, defaultTotes: 1, maxParcelKg: 20, allowsFragile: false, carriesBulk: false, defaultBaseFee: 0.5, role: 'micro feeder · MDP→PUDO last mile' },
  motorcycle: { registry: 'light', defaultCapacityKg: 50, maxCapacityKg: 80, defaultTotes: 2, maxParcelKg: 30, allowsFragile: false, carriesBulk: false, defaultBaseFee: 0.8, role: 'micro feeder · last mile' },
  tuktuk: { registry: 'heavy', defaultCapacityKg: 250, maxCapacityKg: 400, defaultTotes: 4, maxParcelKg: 80, allowsFragile: true, carriesBulk: false, defaultBaseFee: 1.5, role: 'last mile · light distribution' },
  car: { registry: 'heavy', defaultCapacityKg: 300, maxCapacityKg: 500, defaultTotes: 4, maxParcelKg: 100, allowsFragile: true, carriesBulk: false, defaultBaseFee: 2, role: 'last mile' },
  van: { registry: 'heavy', defaultCapacityKg: 1200, maxCapacityKg: 2000, defaultTotes: 15, maxParcelKg: 300, allowsFragile: true, carriesBulk: false, defaultBaseFee: 5, role: 'feeder · distribution' },
  // A bus carries people first: the parcels ride in the boot and on the roof, which is why its bag count is
  // modest next to its kilos — the constraint a conductor actually hits on a corridor run.
  bus: { registry: 'heavy', defaultCapacityKg: 500, maxCapacityKg: 800, defaultTotes: 12, maxParcelKg: 200, allowsFragile: true, carriesBulk: false, defaultBaseFee: 4, role: 'corridor line-haul' },
  truck: { registry: 'heavy', defaultCapacityKg: 8000, maxCapacityKg: 30000, defaultTotes: 60, maxParcelKg: 2000, allowsFragile: true, carriesBulk: true, defaultBaseFee: 10, role: 'bulk cargo · line-haul' },
};

// S34 — dynamic-pricing bounds. A driver/fleet delegates a "pricing agent" (the multiplier engine) that may
// flex the per-km rate within THIS corridor; the driver always controls the absolute floor + ceiling. These
// are the defaults when a vehicle declares none.
export const DEFAULT_MIN_MULTIPLIER = 0.8;
export const DEFAULT_MAX_MULTIPLIER = 1.5;

/**
 * How many BAGS a vehicle's hold takes.
 *
 * A pure helper rather than a service method because both sides of the bag flow need it and they cannot see
 * each other: dispatch asks it when offering and claiming, the MDP/shop path asks it at the moment a bag is
 * physically scanned aboard. Absent on every vehicle registered before bag space existed, and a missing
 * figure must read as the CLASS DEFAULT — never as "no room" (which would strand every legacy bus) and never
 * as "unlimited" (which is the hole this closes).
 */
export function toteCapacityOf(vehicle: { toteCapacity?: number; vehicleClass: VehicleClass }): number {
  const n = vehicle.toteCapacity;
  if (typeof n === 'number' && Number.isFinite(n) && n >= 1) return Math.floor(n);
  return VEHICLE_SPEC[vehicle.vehicleClass]?.defaultTotes ?? 1;
}

/** Map a vehicle class onto the corridor's coarse bus/truck heuristic for line-haul legs. */
export const CLASS_TO_CORRIDOR_VEHICLE: Record<VehicleClass, 'bus' | 'truck'> = {
  bike: 'bus', motorcycle: 'bus', tuktuk: 'bus', car: 'bus', van: 'truck', bus: 'bus', truck: 'truck',
};

// Parcel size → an indicative kg, reused for vehicle-fit checks (mirrors SIZE_WEIGHT_KG tiers).
export const PARCEL_SIZE_KG: Record<ParcelSize, number> = { S: 1, M: 5, L: 15, HEAVY: 25 };

export const DRIVER_LICENCE_GRACE_DAYS = 0; // expired licence = cannot operate (heavy registry)

// Fleet-manager onboarding (Ch 19). A fleet manager is the operator who owns the vehicles + employs
// the drivers; they are vetted before they may register a fleet, then post a refundable operating bond.
export const FLEET_BOND_USD = 200; // refundable operating bond to activate a fleet manager
