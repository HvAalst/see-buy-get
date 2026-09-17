// Fleet domain types (Compendium Ch 19). Drivers and Vehicles are SEPARATE entities, each with its
// own ID, joined by a flexible, re-assignable coupling (an Assignment) — a driver may run a bike on
// the MDP→PUDO feeder today and a van tomorrow, and a vehicle may change hands between drivers.

import { TruckSubtype, VehicleClass } from './fleet.config';
import { Equipment } from './cargo.types';
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
  /**
   * Country of incorporation — which sister company contracts and pays this fleet, and in what
   * currency. A fleet is paid as a SUPPLIER, one invoice in one currency; how it then pays its own
   * drivers, in which countries, under whose employment law, is entirely the fleet's business.
   */
  jurisdiction?: string;
  /** That sister, by id. Absent on records written before entities existed — read it through
   *  FleetManagerService.entityIdOf(), which resolves from the jurisdiction. */
  entityId?: string;
  tradingName?: string;
  contactPhone: string;
  contactEmail?: string;
  depotAddress?: string; // physical depot/office (pin and/or address)
  location: GeoPoint;
  requirements: FleetManagerRequirements;
  kyc?: FleetManagerKyc;
  bondPaid: boolean; // refundable operating bond (activation gate)
  loginCode?: string; // issued on activation — the manager signs into the fleet console with it
  /** When the fleet last rotated its code. */
  codeRotatedAt?: string;
  status: FleetManagerStatus;
  createdAt: string;
}

/** FP4 — one paper's state today, DERIVED at read time from its expiry date (see papers.ts); never stored. */
export class PaperStatusView {
  kind!: 'insurance' | 'inspection' | 'licence';
  state!: 'ok' | 'due' | 'lapsed' | 'none';
  expiresAt?: string;
  /** Whole days until it lapses — negative once it has. Absent without a date. */
  daysLeft?: number;
  reference?: string;
}

export type VehicleStatus = 'ACTIVE' | 'GROUNDED' | 'RETIRED';
export type VehicleOwnerType = 'driver_owned' | 'fleet_owned' | 'third_party';

/** Registration documents — a PRIORITY signal (verified vehicles are preferred for dispatch). */
export class VehicleDocuments {
  registrationPhotoRef?: string; // photo of the registration papers
  factoryId?: string; // VIN / chassis / factory number
  insuranceRef?: string;
  /** FP4 — a passed insurance expiry takes the vehicle OFF THE ROAD (see papers.ts); no date recorded switches nothing off. */
  insuranceExpiresAt?: string;
  /** FP4 — the roadworthiness / inspection certificate, enforced the same way. */
  inspectionRef?: string;
  inspectionExpiresAt?: string;
}

export class Vehicle {
  vehicleId: string;
  managerDid?: string; // the fleet manager that owns this vehicle (undefined = unmanaged/legacy)
  qr: string; // the dashboard QR sticker the driver scans to start a shift
  plate: string;
  vehicleClass: VehicleClass;
  truckSubtype?: TruckSubtype; // only for class 'truck'
  capacityKg: number; // system-computed (light) or operator-declared within class bounds (heavy)
  /**
   * How many BAGS the hold takes — the constraint kilos cannot express (a tote of letters weighs nothing, so
   * by weight a bus fits a hundred while its boot holds a dozen). Absent on vehicles registered before this
   * existed: read it through DispatchService.toteCapacityOf, never off the field.
   */
  toteCapacity?: number;
  pricePerKm: number; // open-data transport rate set by the driver/fleet manager (public, locked to the vehicle)
  // S34 — the dynamic-pricing profile. baseFee is the flag-down (deadhead + loading) fee; pricePerKm above is
  // R_base; [minMultiplier, maxMultiplier] is the corridor the market engine may flex the per-km rate within.
  // The driver/fleet always owns the absolute floor + ceiling — the engine never prices outside these bounds.
  baseFee: number;
  minMultiplier: number;
  maxMultiplier: number;
  maxParcelKg: number; // largest single parcel (from the class spec)
  allowsFragile: boolean;
  coldChain: boolean; // temperature-controlled body
  carriesBulk: boolean; // loose dry-bulk capable (trucks)
  liquid: boolean; // tanker
  hazmat: boolean; // dangerous-goods capable
  oversized: boolean; // abnormal / project cargo
  // S32 — load/unload equipment this vehicle carries (MAN…STR). Subtype-implied baseline (a crane truck
  // self-loads) plus whatever the fleet manager declares (a tail-lift, a pallet jack). A heavy cargo class
  // (P3+) requires at least one qualifying piece; dispatch only offers a dedicated freight to a vehicle that
  // has the equipment the load needs. Always includes 'MAN'.
  equipment: Equipment[];
  ownerType: VehicleOwnerType;
  ownerName: string;
  documents: VehicleDocuments;
  // S26 — the owner's photos of the actual vehicle body + any coupled trailer (mediaIds in the
  // 'vehicle-asset' retention bin: user-managed while the vehicle is registered).
  vehiclePhotoRefs?: string[];
  trailerPhotoRefs?: string[];
  verified: boolean; // full registration + doc photo + factory ID present → dispatch priority
  status: VehicleStatus;
  /** FP4 — DERIVED on the owner's read, never stored: each paper's state today. */
  papers?: PaperStatusView[];
  /** FP4 — DERIVED: the papers that have lapsed, in words; non-empty means the vehicle cannot start a shift. */
  offRoad?: string[];
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

/**
 * The driver's face, and why it is NOT part of KYC.
 *
 * It is the BADGE PORTRAIT — the picture a shopkeeper sees beside a badge id when somebody they have
 * never met asks for a bag. That is a product reason, and it happens to give an operator something to
 * check the two documents against.
 *
 * Deliberately not a gate. A manager onboarding a driver in a yard at dusk with a cracked camera must
 * still be able to finish; blocking on a portrait would trade a real driver for a nicer record. The two
 * DOCUMENTS are the gate, because without them an approval means nothing at all.
 */
export class DriverPortrait {
  photoRef: string;
  addedAt: string;
}

export class FleetDriver {
  driverId: string;
  did: string;
  /** Their face, for the badge — see DriverPortrait. Absent is ordinary, never a blocker. */
  portrait?: DriverPortrait;
  managerDid?: string; // the fleet manager that employs this driver (undefined = independent courier)
  /**
   * Legal residence — and ONLY for an independent courier, who the network contracts with directly.
   * A fleet-attached driver has none, deliberately: the network pays their fleet, not them, so asking
   * where they live would be collecting data for a payment we never make. We move parcels; we do not
   * do payroll or employment. Read through DriverService.settlingEntityIdOf(), which sends a fleet
   * driver's answer to their fleet.
   */
  jurisdiction?: string;
  /** The sister that contracts this courier directly. Absent for a fleet-attached driver. */
  entityId?: string;
  vaultRef: string; // Golden Record PII (name, national ID, mobile) in the vault — never in the core
  displayName: string; // non-PII shop-floor label (e.g. "Driver J.")
  badgeId?: string; // scannable handover badge — issued on activation
  registry: DriverRegistry; // light (bike/motorcycle) | heavy (everything else)
  licence: DriverLicence;
  kyc?: DriverKyc;
  /** Why the last vetting decision went against them, and when. Cleared on approval. Present on a DRAFT
   *  driver = "we looked and said no", which is a different state from "never sent anything". */
  kycRejection?: { reason: string; at: string; by?: string };
  criminalRecordClear: boolean;
  homeZone?: string;
  status: DriverStatus;
  /**
   * Do not interrupt this driver for work paying less than this, all in.
   *
   * It lives on the DRIVER, not on the coupling, unlike the snooze and the derived-leg switch beside it.
   * Those two are moods held for a shift — a puncture, a favour taken this morning — and it is right that
   * ending the shift ends them. A fee floor is not a mood: it is the driver's cost base, and fuel does not
   * get cheaper because yesterday finished. Asking for it again every morning would make it the thing it
   * replaced — a number typed into a search box that dies on the next reload.
   *
   * The price of standing is that it can starve somebody silently, which is exactly what the snooze warns
   * about. That is paid for by COUNTING what it suppresses and showing them (see DispatchService's floor
   * report): a setting you can watch working is a setting you can undo.
   *
   * Absent, or zero, means no floor. Bounded by MAX_NUDGE_MIN_EARN.
   */
  nudgeMinEarn?: number;
  assignedVehicleId?: string; // convenience mirror of the active coupling
  createdAt: string;
  lastSeenAt: string;
  /** FP4 — DERIVED on read: the licence's state today; non-empty offRoad means no shift can start. */
  papers?: PaperStatusView[];
  offRoad?: string[];
}

export type AssignmentStatus = 'active' | 'ended';

/**
 * Where this driver is actually going — the leg they declared when they started the shift.
 *
 * A corridor is the network's line-haul plan; this is the driver's own answer, in their own places: a bus
 * runs a fixed route, a truck driver knows they are going to Addis and back. It is what makes "a load near
 * you" mean something — without it the network can only match on proximity, and pings a driver heading north
 * about a bag going south. Both ends are named AND pinned, because the places on these roads have names but
 * no addresses.
 */
export class DeclaredLeg {
  kind: 'leg';
  fromLabel: string;
  from: GeoPoint;
  toLabel: string;
  to: GeoPoint;
  declaredAt: string;
  /**
   * Who decided this road — the driver, or us.
   *
   * Taking a load IS a statement about where you are going: the pickup and the drop are both known the
   * moment a bag is claimed, and until now the network threw that away and went on matching a driver
   * against nothing. `derived` is that inference, and it is marked because the app must be able to say so
   * out loud and offer to switch it off. An inference presented as a declaration is a lie about who chose.
   *
   * Absent on every leg declared before this existed, which reads correctly: a driver said it.
   */
  source?: 'declared' | 'derived';
}

/**
 * The other shape a working day has: a PATCH, not a road.
 *
 * A bike or a bajaj does not run a corridor — it works a market district and comes back. Made to declare a
 * leg, such a rider would name the same place twice, and the detour maths would count the trip out AND back,
 * so a load two streets away would read as further off than it is. Declaring nothing is no better: it drops
 * them back to being pinged about everything within reach, including loads a bus should take.
 *
 * The patch travels WITH them: it is a radius around wherever they are now, not a circle pinned where they
 * declared it — which is what "near me" means to someone drifting across a city all day.
 */
export class DeclaredArea {
  kind: 'area';
  radiusKm: number;
  declaredAt: string;
}

/** How a driver has said they take work: along a road, or within a radius of themselves. */
export type DeclaredWork = DeclaredLeg | DeclaredArea;

/** The flexible coupling: which driver is operating which vehicle (and on which corridor) right now. */
export class Assignment {
  assignmentId: string;
  driverDid: string;
  vehicleId: string;
  corridorId?: string; // optional line-haul corridor this coupling serves
  /** How this driver takes work today: a road, or a radius around themselves. Absent until they say — and
   *  then matching falls back to plain proximity, as it did before anyone could declare anything. */
  work?: DeclaredWork;
  /**
   * New offers are SNOOZED until this instant (absent = taking work).
   *
   * A rider needs this far more than a line-haul driver does: lunch, a fare of their own, a puncture, the
   * last hour of a long day. It stops NEW work only — everything already claimed is still theirs to carry,
   * hand over and deliver, because snoozing offers is not going off shift. It lives on the coupling, so
   * ending the shift ends it: nobody discovers tomorrow morning that they are still snoozed.
   */
  snoozedUntil?: string;
  /**
   * The driver has switched OFF the road we worked out from the load they took.
   *
   * One decision, honoured for the rest of the shift. Without it, turning it off would clear a road that
   * the very next claim puts straight back — which is not a switch, it is an argument. Like the snooze
   * beside it, it lives on the coupling, so ending the shift ends it.
   */
  derivedLegOff?: boolean;
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
