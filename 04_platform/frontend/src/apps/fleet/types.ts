/**
 * Local view types for the fleet app. Same contract stance as the other apps: honest view
 * types declared once, `narrow()` in api.ts as the single cast site. Field names mirror
 * backend fleet.types.ts / vehicle.service.ts / driver.service.ts and the fleet dashboard
 * controller mapping.
 */

export const VEHICLE_CLASSES = ['bike', 'motorcycle', 'tuktuk', 'car', 'van', 'bus', 'truck'] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

/** Classes that put a driver in the HEAVY registry (licence + KYC + vetting). */
export const HEAVY_CLASSES: readonly VehicleClass[] = ['tuktuk', 'car', 'van', 'bus', 'truck'];

export type DriverStatus = 'DRAFT' | 'KYC_PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface ManagerView {
  did: string;
  companyName: string;
  status: string;
  loginCode?: string;
}

/* ------------------------------------------------- FP4: the papers that switch things off -- */

export type { PaperKind, PaperState, PaperView } from '../../shared/papers';
import type { BoardBlocker } from '../../shared/board';
import type { PaperKind, PaperView } from '../../shared/papers';

/** A paper on the dashboard's list: which thing, and whether it is on a shift the sweep will end. */
export interface PaperRow {
  subject: 'vehicle' | 'driver';
  id: string;
  label: string;
  kind: PaperKind;
  state: 'due' | 'lapsed';
  expiresAt?: string;
  daysLeft?: number;
  onShift: boolean;
  /** A driver who has sent the renewed card: the row waits on this office to read it, under Drivers. */
  cardSent?: boolean;
}

export interface PapersReport {
  lapsed: PaperRow[];
  due: PaperRow[];
  /** Papers with a date that is neither due nor lapsed — so "nothing listed" can be told from "nothing recorded". */
  inDate: number;
  unrecorded: number;
}

export interface VehicleDocumentsView {
  registrationPhotoRef?: string;
  factoryId?: string;
  insuranceRef?: string;
  insuranceExpiresAt?: string;
  inspectionRef?: string;
  inspectionExpiresAt?: string;
}

export interface VehicleRow {
  vehicleId: string;
  qr: string;
  plate: string;
  vehicleClass: VehicleClass;
  truckSubtype?: string;
  capacityKg: number;
  pricePerKm: number;
  verified: boolean;
  status: string;
  managerDid?: string;
  vehiclePhotoRefs?: string[]; // S26 — mediaIds of the vehicle-body photos
  trailerPhotoRefs?: string[]; // S26 — mediaIds of a coupled trailer's photos
  /** FP4 — the owner's read carries the papers as recorded, their state today, and the lapsed ones in words. */
  documents?: VehicleDocumentsView;
  papers?: PaperView[];
  offRoad?: string[];
}

export interface DriverRow {
  did: string;
  displayName: string;
  badgeId?: string;
  registry: 'light' | 'heavy';
  status: DriverStatus;
  /** `copyRef` is the card the date was read from, when there was one; `recordedAt` is when it was typed. */
  licence?: { classes?: string[]; number?: string; expiresAt?: string; copyRef?: string; recordedAt?: string };
  /**
   * THE RENEWED CARD THIS DRIVER SENT, waiting on this office: the photograph, and the date and number they
   * read off it. Their reading is shown beside the photograph and never typed into the record for them.
   */
  licenceRenewal?: { copyRef: string; expiresAt: string; number?: string; sentAt: string };
  /** Why their last card was not accepted. They are shown it until they send another. */
  licenceRenewalRefusal?: { reason: string; at: string };
  managerDid?: string;
  /**
   * What this driver's VEHICLE RATE is costing them in work, today.
   *
   * It arrives on the manager's list and not on the driver's own card, because the price per km lives on
   * the vehicle and the vehicle is the manager's: telling a driver their price is losing them work when
   * they hold no way to change it is an accusation, not information.
   *
   * Their earnings FLOOR is deliberately absent. That is the driver's own decision about their own time,
   * and putting it in front of whoever schedules them turns a setting into a negotiation.
   */
  rateReach?: { overBudget: number; ratePerKm?: number; rateLooksHigh: boolean };
  /** FP4 — the licence's state today, and why no shift can start when it has lapsed. */
  papers?: PaperView[];
  offRoad?: string[];
}

export interface AssignmentRow {
  assignmentId: string;
  driverDid: string;
  vehicleId: string;
  corridorId?: string;
  startedAt: string;
}

export interface CorridorRow {
  corridorId: string;
  name: string;
  originZone: string;
  destZone: string;
  /** proposed (a fleet's line waiting for the network) · active · blocked */
  status: string;
  /** Absent for the network's own corridors. */
  owner?: { kind: 'fleet'; managerDid: string; company: string };
  vehicleType?: 'bus' | 'truck';
  schedule?: string;
  note?: string;
}

export interface SubtypeRow {
  id: string;
  label: string;
  capacityKg: number;
  coldChain?: boolean;
  bulk?: boolean;
  liquid?: boolean;
  hazmat?: boolean;
  oversized?: boolean;
}

export interface PositionRow {
  plate: string;
  driverName: string;
  vehicleClass: string;
  hoursOnDuty: number;
  location: { lat: number; lng: number };
  /** When that position was reported. Absent on a record from before it was stamped. */
  lastLocatedAt?: string;
}

export interface SessionRow {
  driverName: string;
  plate: string;
  vehicleClass: string;
  hoursOnDuty: number;
  /** FP8 — past the shift limit: the driver delivers what is aboard and takes nothing new. */
  overLimit?: boolean;
  location?: { lat: number; lng: number } | null;
  lastLocatedAt?: string;
}

export interface CargoRow {
  ref: string;
  kind: string;
  weightKg: number;
  destLabel: string;
  driver: string;
  status: string;
}

export interface DashboardView {
  vehicles: { total?: number; active?: number };
  drivers: { total?: number; onShift?: number; offShift?: number };
  sessions: { active?: number; todayHours?: number; list?: SessionRow[] };
  positions?: PositionRow[];
  /** FP8 — the limits every hours figure is read against: one shift, and the rest between two. */
  hours?: { limit: number; rest: number };
  cargo: { count?: number; totalKg?: number; items?: CargoRow[] };
  /** FP4 — what is off the road and what is running out, from the same rules the six-hourly sweep enforces. */
  papers?: PapersReport | null;
}

/* ------------------------------------------------- FP1: the fleet's earnings register -- */

export interface FleetJobRow {
  freightId: string;
  code: string;
  description: string;
  destLabel: string;
  status: 'available' | 'claimed' | 'in_transit' | 'delivered' | string;
  cargoClass: string;
  weightKg: number;
  earning?: number;
  /** BOOKED by the network at delivery — owed to the fleet, not yet money that moved. */
  paid: boolean;
  /** B2 — the shipper pays the carrier for this haul directly; nothing is owed by SeeBuyGet. */
  direct?: boolean;
  /** FP8 — what an upheld claim took back from this haul's pay. */
  clawback?: number;
  claimedAt?: string;
  deliveredAt?: string;
  createdAt: string;
  driverDid: string;
  driverName: string;
}

export interface FleetEarningsSummary {
  earned: number;
  paid: number;
  unpaid: number;
  delivered: number;
  count: number;
  byDriver: Array<{ driverDid: string; driverName: string; earned: number; delivered: number; count: number }>;
  byMonth: Array<{ month: string; earned: number; delivered: number; count: number }>;
  /** The money, apart from the register: booked as owed (null where no sister pays this fleet), on its way, left. */
  settlement?: { payeeDid: string; owed: number | null; settled: number; inFlight: number; currency?: string };
}

/* ------------------------------------------------- FP5: dispatch — the office puts a load on a driver -- */

/** A driver on a shift right now, as the dispatch picker needs them. */
export interface DispatchDriverRow {
  did: string;
  name: string;
  vehicleId: string;
  plate: string;
  vehicleClass: string;
  truckSubtype?: string;
  /** Kilos still free on the vehicle after what they already hold. */
  remainingKg: number;
  location?: { lat: number; lng: number };
  lastLocatedAt?: string;
}

/** One load on the market as THIS driver would see it — priced against their vehicle, every reason why not marked. */
export interface DispatchRow {
  freightId: string;
  code: string;
  description: string;
  pickupLabel: string;
  destLabel: string;
  weightKg: number;
  cargoClass?: string;
  commitMode: 'instant' | 'negotiate';
  scheduledPickupAt?: string;
  deadheadKm: number;
  loadedKm: number;
  totalKm: number;
  /** The driver's earning. Absent when there is no vehicle to price against. */
  price?: { total: number; multiplier?: number };
  earningsPerKm?: number | null;
  canTake: boolean;
  blockers: BoardBlocker[];
  /** FP7 — the sender's delivery window, the one instruction the office dispatches against. */
  deliveryWindow?: string;
}

export interface DispatchView {
  drivers: DispatchDriverRow[];
  /** The driver the rows were judged for; null when nobody was chosen (or nobody is on a shift). */
  driver: string | null;
  /** Where every distance and price was measured from, and why that point. */
  from: { lat: number; lng: number; source: 'driver' | 'depot' };
  rows: DispatchRow[];
  total: number;
}

/* --------------------------------------------------------------- F3: runs --
   A departure this fleet has put on one of its own lines, and what it is carrying. */

export interface WaitingRow {
  where: 'loading' | 'delivery';
  arrivedAt: string;
  freeAt?: string;
  waitedMin: number;
  billableMin: number;
  amount: number;
  /** Who it lands on — the shipper at the collection gate, the consignee at delivery. */
  bearer: 'shipper' | 'consignee';
  waivedReason?: string;
}

interface DepartureBookingBase {
  bookingId: string;
  shipperDid: string;
  description: string;
  weightKg: number;
  volumeM3?: number;
  /** Which axis this load actually filled: a pallet of foam binds on space, steel on weight. */
  binds: 'weight' | 'space';
  price: number;
  units: number;
  at: string;
  /** `delivered` is the ending a run used to lack — the goods came off, and somebody recorded it. */
  status: 'booked' | 'delivered' | 'cancelled';
  deliveredAt?: string;
  receivedBy?: string;
  /** What the goods are — the vehicle and the other loads are checked against it. */
  nature?: string;
  declaredValue?: number;
  /** What the driver recorded at the door. */
  pod?: { receiverName: string; photoRef: string; remarks?: string; at: string };
  /** What the shipper says went wrong, and what this fleet said back. Never decided by us. */
  claim?: { kind: string; description: string; amount?: number; raisedAt: string; answer?: 'accepted' | 'refused'; answerNote?: string; answeredAt?: string };
  waiting: WaitingRow[];
}

/**
 * A load on a run, and the two kinds are not the same thing wearing different labels.
 *
 * A DISCRIMINATED UNION rather than an optional field beside an enum, because the one guarantee that
 * matters here is that an `own` load always has a customer on it — the server refuses one without — and a
 * type that merely allows a name lets every screen quietly render "For undefined". This way the compiler
 * knows the name is there the moment the kind is checked, and nothing needs a fallback that would paper
 * over the very state the backend exists to prevent.
 *
 *  `sold`  came through the offer list and we quoted it: our price, agreed by both sides.
 *  `own`   a customer this fleet already had, recorded so the space stops being advertised. Priced by
 *          nobody here, and the name never leaves the fleet's own screens.
 */
export type DepartureBookingRow = DepartureBookingBase &
  ({ kind: 'sold'; customer?: undefined } | { kind: 'own'; customer: string });

export interface DepartureRow {
  departureId: string;
  corridorId: string;
  lineName: string;
  /**
   * Which truck. Required on every run declared now, unlike the driver: the space in a particular hold is
   * what is being sold. OPTIONAL HERE because runs declared before that rule have none, and a type that
   * says "always" let a screen print "On undefined" without the compiler saying a word.
   */
  vehicleId?: string;
  plate?: string;
  vehicleClass: string;
  originZone: string;
  destZone: string;
  leavesAt: string;
  capacityKg: number;
  capacityM3?: number;
  rate: { basis: string; amount: number; currency: string; minCharge?: number };
  /** What the fleet charges for being kept standing. Absent means it does not charge. */
  waiting?: { freeMin: number; perHour: number };
  /** How the shipper pays them — directly. A record, never a posting. */
  settle?: { method: string; when: string };
  /** What THIS fleet insures, or plainly none. Never ours, and absent means they have not said. */
  cover?: { limit: number; policy?: string };
  km?: number;
  driverDid?: string;
  driverName?: string;
  note?: string;
  status: 'open' | 'closed' | 'departed' | 'cancelled';
  /** Why it was called off. Required by the server once anybody is aboard. */
  cancelledReason?: string;
  bookings: DepartureBookingRow[];
  createdAt: string;
}
