// Fleet domain types (Compendium Ch 19). Drivers and Vehicles are SEPARATE entities, each with its
// own ID, joined by a flexible, re-assignable coupling (an Assignment) — a driver may run a bike on
// the MDP→PUDO feeder today and a van tomorrow, and a vehicle may change hands between drivers.

import { TruckSubtype, VehicleClass } from './fleet.config';
import { GeoPoint } from './pudo.types';

export type FleetManagerStatus = 'DRAFT' | 'KYC_PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED';

/** The fleet-manager eligibility filter (Ch 19) — hard requirements gate onboarding a fleet operator. */
export class FleetManagerRequirements {
  businessRegistrationNo: string; // registered company / business number
  transportOperatorLicence: string; // the regulated transport-operator / PSV licence
  taxId: string; // tax identification number
  declaredFleetSize?: number; // how many vehicles they intend to run
}

/** KYC documents collected to move a manager DRAFT → KYC_PENDING. */
export class FleetManagerKyc {
  businessRegCertRef: string;
  operatorLicenceRef: string;
  ownerIdRef: string;
  proofOfAddressRef: string;
  submittedAt: string;
}

export class FleetManager {
  managerId: string;
  did: string;
  vaultRef: string; // Golden Record PII (owner name, national ID, contact) in the vault
  companyName: string;
  tradingName?: string;
  contactPhone: string;
  contactEmail?: string;
  depotAddress?: string; // physical depot/office (pin and/or address)
  location: GeoPoint;
  requirements: FleetManagerRequirements;
  kyc?: FleetManagerKyc;
  bondPaid: boolean; // refundable operating bond (activation gate)
  loginCode?: string; // issued on activation — the manager signs into the fleet console with it
  status: FleetManagerStatus;
  createdAt: string;
}

export type VehicleStatus = 'ACTIVE' | 'GROUNDED' | 'RETIRED';
export type VehicleOwnerType = 'driver_owned' | 'fleet_owned' | 'third_party';

/** Registration documents — a PRIORITY signal (verified vehicles are preferred for dispatch). */
export class VehicleDocuments {
  registrationPhotoRef?: string; // photo of the registration papers
  factoryId?: string; // VIN / chassis / factory number
  insuranceRef?: string; // optional — insurance is government-regulated, not enforced here
  insuranceExpiresAt?: string;
}

export class Vehicle {
  vehicleId: string;
  managerDid?: string; // the fleet manager that owns this vehicle (undefined = unmanaged/legacy)
  qr: string; // the dashboard QR sticker the driver scans to start a shift
  plate: string;
  vehicleClass: VehicleClass;
  truckSubtype?: TruckSubtype; // only for class 'truck'
  capacityKg: number; // system-computed (light) or operator-declared within class bounds (heavy)
  pricePerKm: number; // open-data transport rate set by the driver/fleet manager (public, locked to the vehicle)
  maxParcelKg: number; // largest single parcel (from the class spec)
  allowsFragile: boolean;
  coldChain: boolean; // temperature-controlled body
  carriesBulk: boolean; // loose dry-bulk capable (trucks)
  liquid: boolean; // tanker
  hazmat: boolean; // dangerous-goods capable
  oversized: boolean; // abnormal / project cargo
  ownerType: VehicleOwnerType;
  ownerName: string;
  documents: VehicleDocuments;
  // S26 — the owner's photos of the actual vehicle body + any coupled trailer (mediaIds in the
  // 'vehicle-asset' retention bin: user-managed while the vehicle is registered).
  vehiclePhotoRefs?: string[];
  trailerPhotoRefs?: string[];
  verified: boolean; // full registration + doc photo + factory ID present → dispatch priority
  status: VehicleStatus;
  createdAt: string;
}

export type DriverStatus = 'DRAFT' | 'KYC_PENDING' | 'ACTIVE' | 'SUSPENDED';
export type DriverRegistry = 'light' | 'heavy';

/** Driver licence (required + verified for heavy registry; bikes need none). */
export class DriverLicence {
  number: string;
  classes: VehicleClass[]; // vehicle classes the driver is cleared to operate
  expiresAt?: string; // heavy registry: enforced (expired ⇒ cannot operate)
}

export class DriverKyc {
  idCopyRef: string;
  licenceCopyRef: string;
  submittedAt: string;
}

export class FleetDriver {
  driverId: string;
  did: string;
  managerDid?: string; // the fleet manager that employs this driver (undefined = unmanaged/legacy)
  vaultRef: string; // Golden Record PII (name, national ID, mobile) in the vault — never in the core
  displayName: string; // non-PII shop-floor label (e.g. "Driver J.")
  badgeId?: string; // scannable handover badge — issued on activation
  registry: DriverRegistry; // light (bike/motorcycle) | heavy (everything else)
  licence: DriverLicence;
  kyc?: DriverKyc;
  criminalRecordClear: boolean;
  homeZone?: string;
  status: DriverStatus;
  assignedVehicleId?: string; // convenience mirror of the active coupling
  createdAt: string;
  lastSeenAt: string;
}

export type AssignmentStatus = 'active' | 'ended';

/** The flexible coupling: which driver is operating which vehicle (and on which corridor) right now. */
export class Assignment {
  assignmentId: string;
  driverDid: string;
  vehicleId: string;
  corridorId?: string; // optional line-haul corridor this coupling serves
  status: AssignmentStatus;
  startedAt: string;
  endedAt?: string;
  location?: GeoPoint; // last reported GPS position (live fleet map)
  lastLocatedAt?: string;
}

/** What the handover/bag-load flow needs once a badge is scanned. */
export class ResolvedBadge {
  driverDid: string;
  badgeId: string;
  vehicle: Vehicle;
  corridorId?: string;
  vehicleType: 'bus' | 'truck';
  capacityKg: number;
  maxParcelKg: number;
  allowsFragile: boolean;
}
