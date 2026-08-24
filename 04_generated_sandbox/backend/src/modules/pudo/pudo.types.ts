// PUDO Light domain (Compendium Ch 12–19). The emerging-market Tier 1/2 on-ramp. Reuses the GLOS
// backbone (DID, vault, wallet, ledger, events) but models its own light parcel/agent/corridor flow.

import { CargoClass, CargoNature, Equipment } from './cargo.types';

/** A map pin. Named (not an inline literal) so it is one reusable schema in the contract. */
export class GeoPoint {
  lat: number;
  lng: number;
}

/** One line in an order — the buyer's cart as it travels to the merchant console. */
export class LineItem {
  name: string;
  qty: number;
}

/** Declared parcel dimensions (cm) that derive the size tier. */
export class Dimensions {
  l: number;
  w: number;
  h: number;
}

export type AgentStatus = 'DRAFT' | 'KYC_PENDING' | 'APPROVED_UNFUNDED' | 'ACTIVE' | 'LOCKED';
/** Business availability the agent controls (Risk #30 store closure), distinct from the lifecycle status. */
export type OpenState = 'open' | 'closed';

/** The agent-eligibility "filter" (Compendium 18.1). Hard requirements gate onboarding. */
export class AgentRequirements {
  androidVersion: number; // ≥ 10
  reliablePower: boolean;
  tradingLicence: string; // licence number/reference (must be present)
  criminalRecordClear: boolean;
  canFloatCod?: boolean; // preferred, not required
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export class DayHours {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
}
/** Weekly opening schedule. A missing/null day means closed that day. */
export type WeeklyHours = Partial<Record<Weekday, DayHours | null>>;

/** Shelf as a grid: columns are colour-coded, rows numbered (e.g. slot "Green-3"). */
export class ShelfConfig {
  rows: number;
  cols: number;
  consolidationSlots?: string[]; // labels the agent pooled for multiple small (S) parcels — letters/envelopes
}
export class ShelfSlot {
  label: string; // e.g. "Green-3"
  color: string; // column colour
  row: number;
  col: number;
  occupiedBy?: string; // a normal slot's single parcelId
  consolidation?: boolean; // a bundle slot: pools multiple small parcels
  items?: string[]; // a bundle slot's pooled parcelIds
  maxItems?: number; // a bundle slot's capacity
}

/** KYC documents collected to move DRAFT → KYC_PENDING (Compendium 18.5). */
export class KycDocuments {
  idCopyRef: string;
  tradingLicenceRef: string;
  shopPhotoRefs: string[]; // at least one
  submittedAt: string;
}

export class Agent {
  agentId: string;
  did: string;
  vaultRef: string; // Golden Record PII (name, national ID, mobile) in the IdentityVault
  shopName: string;
  zone: string;
  /** The sister company this shop is contracted to — it buys the shop's handling and owes it the fee.
   *  A shop sits in exactly one country, so this is unambiguous. Absent on pre-entity records; read it
   *  through AgentService.entityIdOf(). */
  entityId?: string;
  location: GeoPoint; // map pin (provided, or geocoded from the address)
  physicalAddress?: string; // typed physical address (optional if a pin is given)
  landmark: string; // no street addresses — landmark + GPS
  openState: OpenState; // agent-controlled open / temporarily-closed
  openingHours: WeeklyHours; // per-day schedule (pickup window + ETA constraint)
  shelf: ShelfConfig; // rows × cols → colour/number slot grid (replaces the m² cap)
  /**
   * How many outbound BAGS this shop has floor room to stage at once — the shelf's counterpart for the
   * other pile in the room. Undefined on every pre-slice record (and on a shop that has never said), which
   * reads as DEFAULT_BAG_BAYS: read it through AgentService.bagBaysOf, never off the field.
   */
  bagBays?: number;
  shopfrontMediaId?: string; // the shop-front photo shown on the My-shop dashboard (owner-gated media)
  pricePerParcel: number; // open-data handling fee the agent advertises (public — competition pressure)
  // S32c — load/unload equipment on hand at this site (MAN baseline + declared). A heavy dedicated-freight
  // job checks whether its origin/dest PUDOs can HANDLE the cargo (a pallet needs a forklift/pallet-jack);
  // a gap is flagged advisory (arrange equipment) — a small shop with only MAN cannot handle project cargo.
  equipment: Equipment[];
  deviceImei: string; // Golden Record device — agent binds to this tablet
  requirements: AgentRequirements;
  kyc?: KycDocuments;
  equipmentDepositPaid: boolean; // $50 refundable starter-kit deposit (18.3)
  status: AgentStatus;
  lastPingAt: string;
  createdAt: string;
}

export type ParcelSize = 'S' | 'M' | 'L' | 'HEAVY';
export type ParcelStatus = 'Created' | 'At_PUDO' | 'On_Bus' | 'At_MDP' | 'Ready_For_Pickup' | 'Delivered' | 'Disputed' | 'Voided';

/**
 * MDP hub (Compendium Ch 17 — Main Distribution Point). A regional sort centre, distinct from a PUDO
 * shop: parcels are NOT shelved here, they are sorted into tote bags by next destination. One MDP
 * covers one or more zones; it sits in the middle of every multi-hop journey (PUDO → MDP → … → PUDO).
 */
export class Mdp {
  mdpId: string;
  /** Real GLOS DID (S2). The mdpId stays the domain key; the DID is what an actor token binds to. */
  did: string;
  name: string;
  /** The sister company this hub is contracted to — same reasoning as a shop's: a fixed site sits in
   *  one country. Absent on pre-entity records; read it through MdpService.entityIdOf(). */
  entityId?: string;
  zones: string[]; // the delivery zones this hub serves (last-mile reach)
  location: GeoPoint;
  contactPhone?: string; // operator contact (control-tower escalation + GPS anchor)
  address?: string; // physical address (the map pin gives the coordinates)
  pricePerParcel: number; // open-data sort fee the hub advertises (public)
  createdAt: string;
}

/**
 * free (in the pocket) → filling (linked to a destination, taking parcels) → available (full or aged
 * out → published for drivers to claim) → claimed (a driver took it, en route to pick up) →
 * in_transit (scanned onto the vehicle). The MDP empties it on arrival and it returns to free.
 */
export type ToteStatus = 'free' | 'filling' | 'available' | 'claimed' | 'in_transit';

/**
 * A tote bag: a reusable laminated QR (`toteId`) + a human-readable `code` (BAG-007) so the worker
 * eyeballs the right bag without rescanning. When filling it is linked to ONE next destination; a bus
 * driver scans the bag (not each parcel); the receiving MDP empties it and the tote returns to free.
 * Full (or 24 h-aged) totes are published to the dispatch marketplace for a passing driver to claim.
 */
export class Tote {
  toteId: string; // the laminated QR payload
  code: string; // human-readable bag code
  status: ToteStatus;
  locationId: string; // where the bag is now (mdpId | agentDid | bus:<badge>)
  destinationNodeId?: string; // next hop this bag is committed to (a PUDO did or an MDP id)
  destinationLabel?: string;
  parcels: string[]; // parcelIds currently in the bag
  unitsUsed: number; // fill against BAG_CAPACITY_UNITS
  weightKg: number; // accumulated parcel weight (for vehicle capacity / dispatch matching)
  filledAt?: string; // when the first parcel went in (drives the 24 h max-wait publish)
  availableAt?: string; // when it was published to the claim marketplace
  claimedBy?: string; // driverDid that claimed it
  /**
   * A SHOP bag, published by the shopkeeper's SEAL and by nothing else. A hub bag has no seal step, so the
   * dispatch sweep publishes it the moment it is full or aged; a shop bag that the sweep published behind
   * the counter would advertise a bag still open on the floor — and lock the shop out of the completeness
   * gate, which only accepts a filling bag. The sweep asks the shop to close it instead (see publishReady).
   * Undefined on a hub bag and on every pre-slice record, which is the correct default for both.
   */
  sealRequired?: boolean;
  /** Which nudge this shop has already had for this bag, so the sweep asks once per reason (full → aged). */
  sealPromptedFor?: 'full' | 'max_wait';
  /** When the shop closed it. The record that the completeness gate ran, distinct from being published. */
  sealedAt?: string;
}

export type ConsignmentStatus = 'open' | 'posted';

/** F3 — one member deposit into a consolidation lot. THIN attribution: `memberRef` is a free-text label
 *  (a farmer name / receipt number), NOT an on-platform identity — the cooperative reconciles member
 *  deposits and payout off-platform. */
export class ConsignmentDeposit {
  memberRef: string;
  weightKg: number;
  at: string;
}

/**
 * F3 — a consolidation CONSIGNMENT: the bulk analogue of a Tote (`consignment : bulk :: tote : parcels`). A
 * durable dry commodity (grain, dry food, cement) accumulates member deposits toward a truckload; when the
 * lot is FULL (>= targetKg) or AGED it posts itself to the dispatch marketplace as ONE bulk freight (via the
 * F1 registerFreight path). Perishables never consolidate — a cold-chain commodity books freight directly
 * (immediate/planned). Settlement is OFF-PLATFORM like an F2 counter freight: no shipper is billed on-platform
 * (the freight posts without a shipperDid → 'unpaid'); the cooperative pays the haul and splits it among
 * members off-platform, optionally capped by a cash budget (maxSpend).
 */
export class Consignment {
  consignmentId: string;
  code: string; // human-readable LOT-007
  status: ConsignmentStatus;
  ownerDid: string; // the cooperative / aggregating PUDO that owns the lot (owner-scoped)
  natureCode: CargoNature; // the commodity — must be durable (non-perishable); drives the vehicle capability
  pickupLabel: string; // where the lot is aggregated (the owner's site) — the freight's pickup
  pickupLocation: GeoPoint;
  destLabel: string; // where the truckload goes
  destLocation?: GeoPoint;
  targetKg: number; // a truckload target — the lot is full at/above this
  weightKg: number; // accumulated deposit weight
  deposits: ConsignmentDeposit[];
  maxSpend?: number; // optional cash budget cap for the eventual haul (→ the freight's maxSpend)
  openedAt: string;
  filledAt?: string; // when the FIRST deposit arrived — drives the aged-out publish (like a tote's filledAt); undefined until then
  postedAt?: string;
  freightId?: string; // the marketplace freight it became, once posted
}

/** The next hop the system computes for a parcel while sorting it at an MDP. */
export class NextHop {
  type: 'pudo' | 'mdp';
  id: string;
  label: string;
  zone: string;
}
export type PaymentMode = 'cash' | 'prepaid';
export type ParcelDirection = 'outbound' | 'inbound';

/**
 * What the e-commerce checkout charges the BUYER (collected by the store, becomes the vendor's income).
 * GLOS only reports it — the vendor always prepays the FULL shipment cost to the daughter company.
 *   full   → the buyer pays the whole shipment price at checkout.
 *   capped → the buyer pays up to `buyerContributionCap` (free at/above `freeOverSubtotal`); vendor absorbs the rest.
 */
export class ShippingPolicy {
  mode: 'full' | 'capped';
  freeOverSubtotal: number; // (capped) order value at/above which the buyer is charged nothing
  buyerContributionCap: number; // (capped) the most the buyer is charged at checkout
  // S34c — the most the vendor will pay to move ONE dedicated-freight (P4+) shipment: the all-in charge cap
  // dispatch enforces before a driver may claim a diverted order. Undefined = no cap (accept any market price).
  maxTransportSpend?: number;
}

/** A registered e-commerce vendor that wires its checkout into PUDO for click-and-collect. */
export class Vendor {
  vendorId: string;
  /** Real GLOS DID (S15). The vendorId stays the domain key; the DID is what an actor token binds to. */
  did: string;
  name: string;
  callbackUrl?: string; // GLOS pushes HMAC-signed status callbacks here
  secret: string;
  location?: GeoPoint; // store map pin — origin-PUDO suggestions are ranked from here
  address?: string;
  country: string; // which per-country daughter company settles this vendor
  /** That daughter company, by id. Absent on records written before entities existed — resolve it
   *  through VendorService.entityIdOf(), which derives it from the country the record already has. */
  entityId?: string;
  balance: number; // prepaid balance held with the daughter company ('no prepay, no label' gate)
  shippingPolicy: ShippingPolicy;
  createdAt: string;
}

/**
 * A buyer's checkout selection captured by the embedded PUDO-picker node (or a webhook, or manual entry):
 * the destination PUDO the buyer chose + the email for the collection code. It travels from the buyer's
 * checkout, across the auth boundary, into the merchant console where it pre-fills a shipment (no dropdown).
 */
export class CheckoutHandoff {
  id: string;
  vendorId: string;
  destAgentDid: string; // the PUDO the buyer picked at checkout
  buyerEmail: string;
  buyerMobile?: string;
  externalOrderId?: string;
  items?: LineItem[];
  subtotal?: number; // order value — drives the buyer/vendor split
  source: 'node' | 'webhook' | 'manual';
  consumed: boolean; // flipped once a shipment is minted from it
  parcelId?: string; // the shipment it became
  at: string;
}

export class PhygitalLabel {
  parcelId: string;
  qrPayload: string; // what the printed QR encodes
  svg: string; // a simple printable label
}

export class ParcelScan {
  at: string;
  status: ParcelStatus | 'CREATED';
  by: string; // agent or driver did/badge
  note?: string;
  anchorTxId?: string;
}

/**
 * The authenticated-twin projection a signed-in consumer sees for a parcel they are a party to (S21).
 * PII-free: no mobiles, no counterparty identity, no collection code — only the caller's own relation
 * to the parcel, its live status, and a status timeline. The receiver's collection token is a later
 * (S22) surface, not this one.
 */
export interface ConsumerParcelView {
  parcelId: string;
  did?: string; // DT — the shipment's stable GLOS identity (the digital twin), shown to its owner
  relation: 'sent' | 'received'; // the caller's side of this parcel
  direction: ParcelDirection;
  status: ParcelStatus;
  originZone: string;
  destZone: string;
  size: ParcelSize;
  fragile?: boolean;
  items?: LineItem[];
  trackingKey?: string; // the same shareable public key; handy for a quick-look link
  vendorOrder: boolean; // a vendor/e-commerce order vs a walk-up peer send
  createdAt: string;
  updatedAt: string; // last movement (for newest-first ordering)
  timeline: Array<{ at: string; status: ParcelStatus | 'CREATED'; note?: string }>;
  // S23 — the receiver's OWN evidence + reason (relation==='received' only; never shown to the sender).
  podPhotoRef?: string; // their delivered-state photo, if they took one
  disputePhotoRef?: string; // their dispute-evidence photo, if they disputed
  disputeReason?: string; // what they reported (free text — kept off the counterparty's view)
  /**
   * The in-app collection token (S22) — present ONLY on the single-parcel detail, only for the RECEIVER,
   * and only while the parcel is Ready_For_Pickup. The QR is what the PUDO scans; the code is the typed
   * fallback for a dead camera. This is the one place the handover secret is exposed — in the owner's
   * authenticated app, never on the public track and never in the list.
   */
  collectToken?: { code: string; qrPayload: string };
}

export class Parcel {
  parcelId: string; // pre-printed QR sticker id (the human handle; reusable across shipments)
  // DT — the shipment's stable GLOS identity: a real DID minted at creation (the digital twin's id, distinct
  // from the reusable sticker parcelId). Resolvable + ledger-anchored, so the twin is a first-class entity.
  did?: string;
  direction: ParcelDirection;
  size: ParcelSize;
  dimensionsCm?: Dimensions; // declared dims that derived the size tier
  weightKg: number; // implied by size tier (Heavy > 20 kg)
  fragile?: boolean; // cannot ride a bike/motorcycle (no fragile on a two-wheeler)
  // S30 — cargo taxonomy. cargoClass (P0–P6) is DERIVED from weight+dims at create and drives the handling
  // lane (P4+ never enters the PUDO/MDP pipeline). natureCode is the commodity's primary nature (default
  // GEN), which the compatibility matrix reads to keep e.g. cement dust off fresh produce on one vehicle.
  cargoClass?: CargoClass;
  natureCode?: CargoNature;
  originAgentDid: string;
  originZone: string;
  destZone: string;
  destAgentDid?: string;
  /**
   * R1 — the sister company that collects for this shipment: the one in the PAYER's jurisdiction. A
   * vendor order is paid by the store, so it is the store's sister; a walk-up is paid at the counter,
   * so it is the origin shop's. Never the group, which is not a party to customer transactions.
   * Internal: it is an accounting fact, and appears on no consumer or public surface.
   */
  collectingEntityId?: string;
  senderMobile: string;
  receiverMobile: string;
  // S21: pseudonymous join keys to the person identity (peppered sha256 of the mobile, never the number).
  // A signed-in consumer sees every parcel whose sender/receiver hash matches their verified phone —
  // retroactively (O4). Absent when the counterpart is not a person (e.g. a vendor sender).
  senderPhoneHash?: string;
  receiverPhoneHash?: string;
  dropoffPhotoRef?: string; // mandatory for outbound drop-off (fraud defence)
  deliveredPhotoRef?: string;
  paymentMode: PaymentMode;
  status: ParcelStatus;
  corridorId?: string;
  committedNodeDid?: string; // first-mile node the parcel is committed to
  toteId?: string; // the tote bag currently carrying the parcel (transit / MDP sort)
  atMdpId?: string; // the MDP hub the parcel was dropped at (while At_MDP / awaiting sort)
  driverBadgeId?: string;
  /**
   * Release secret. The destination agent reads it aloud from their screen and the customer repeats
   * it back — it is never SMS'd, so it costs nothing and works with no signal. Because it is the
   * sole custody check, wrong attempts are counted and the code is burned at OTP_MAX_ATTEMPTS.
   */
  otp?: string;
  /**
   * Wrong-attempt counter for whichever release secret this parcel uses — the OTP above on a peer-send,
   * the collectionCode below on an inbound order. A parcel has exactly one live secret, so one budget
   * guards both paths; it is reset when the secret becomes live (arrive() / shelve()) and by a reissue.
   */
  otpAttempts?: number;
  /** Set when the release secret was burned by repeated wrong attempts; release needs an operator reissue. */
  otpLockedAt?: string;
  // --- inbound (e-commerce pickup-at-PUDO) ---
  vendorId?: string;
  externalOrderId?: string;
  buyerEmail?: string; // legacy order-notification channel; since S22 the collection token is delivered IN-APP
  // to the receiver's authenticated twin (never SMS'd/emailed as the secret) — see ConsumerParcelView.collectToken.
  // The buyer's QR collection token: shown in their app, scanned at the destination PUDO — the handover
  // secret, and the ONLY check standing between a stranger and this parcel. Never printed on the label
  // (it rode on the box until the parcel itself was handing out its own key), never in a public view.
  collectionCode?: string;
  trackingKey?: string; // PUBLIC track-and-trace token (safe to share — no PII, drives "track my parcel")
  binSlot?: string; // chaos-shelf slot at the destination PUDO
  items?: LineItem[];
  contentPhotoRef?: string; // photo of the contents at mint — the baseline a dispute is judged against
  label?: PhygitalLabel; // the generated label, persisted so the order detail can reprint it
  // --- pricing + prepaid settlement (open-data quote; GLOS holds no fiat, bills the vendor full) ---
  subtotal?: number; // order value (drives the buyer-charge under a capped policy)
  routeMode?: 'flexible' | 'locked'; // flexible = any carrier @ ceiling (rebated); locked = cheapest route
  routeKm?: number; // total route distance (kept for the flexible delivery rebate calc)
  nodeFees?: number; // sum of per-parcel fees at each PUDO + MDP on the route
  transportCost?: number; // per-km transport at the chosen rate (ceiling or cheapest)
  platformFee?: number; // the daughter-co margin, in money
  /** The margin RATE this parcel was priced at, stamped at mint. The sister can turn its knob at any
   *  time; a parcel in transit must settle on the rate its price was quoted with, not on today's. */
  platformFeePct?: number;
  shipmentCost?: number; // what the vendor is billed prepaid (nodeFees + transport + platform fee)
  ceilingCost?: number; // the worst-case (highest-rate) total a flexible parcel reserves
  actualCost?: number; // the real total once the carrier is known (drives the flexible rebate)
  rebate?: number; // refunded to the vendor after delivery (ceiling − actual) on a flexible parcel
  actualPerKm?: number; // the delivering carrier's per-km rate (captured at handover, drives the rebate)
  buyerCharge?: number; // what the checkout charged the buyer (REPORTED only — vendor's income)
  paidStatus?: 'unpaid' | 'ParcelPaid'; // prepaid gate — label issues only when ParcelPaid
  disputeReason?: string;
  disputePhotoRef?: string;
  // S23 — the buyer's own delivered-state proof + app-filed dispute, kept ALONGSIDE the agent's
  // counter dispute above (both retained for adjudication). Filed by the authenticated receiver.
  buyerPodPhotoRef?: string; // the receiver's photo of what they received (proof of state, happy path)
  buyerDisputePhotoRef?: string; // the receiver's photo of THE PROBLEM (dispute evidence, kept distinct)
  buyerDisputeReason?: string;
  buyerDisputedBy?: string; // the person DID that filed the dispute
  // S25 — handover completeness gate. Set when a waiting parcel was KNOWINGLY left behind at handover
  // (an acknowledged short-ship), so the control tower sees it immediately instead of waiting for the
  // 48 h stagnant window. Cleared the moment the parcel is finally loaded onto a bus.
  shortShippedAt?: string;
  shortShipReason?: string;
  acceptedAt: string;
  handedToBusAt?: string;
  deliveredAt?: string;
  scans: ParcelScan[];
}

// 'OVERDRAFT' was removed with the trade-credit line — there is no way to create one any more. Any row
// on disk from before still renders (the type word falls back to the raw string), it just cannot recur.
export type LedgerType = 'TOP_UP' | 'FEE' | 'LABOR_PAYOUT' | 'DRIVER_PAYOUT' | 'REFUND' | 'SETTLEMENT' | 'BILLING' | 'REBATE';

export class PudoLedgerEntry {
  id: string;
  type: LedgerType;
  sign: '+' | '-';
  amount: number;
  /** What the amount IS. Optional only because rows written before this field existed have none — read
   *  it through agentLedgerCurrencyOf(), which defaults them, never straight off the record. */
  currency?: string;
  /** The journal entry this row projects. The BOOKS are the money; this row is how a shopkeeper reads
   *  it. Absent on rows written before the books existed, and on records that move no money of ours. */
  entryId?: string;
  did?: string; // agent (or driver) the entry applies to
  reference: string; // parcel id / manifest id / driver id / admin id / bank txn / mdp id / vendor id
  refType: 'parcel' | 'manifest' | 'driver' | 'admin' | 'bank' | 'mdp' | 'vendor';
  at: string;
}

export class Corridor {
  corridorId: string;
  name: string;
  originZone: string;
  destZone: string;
  vehicleType: 'bus' | 'truck';
  schedule: string; // e.g. 'North-South Express, 08:00'
  status: 'active' | 'blocked';
}

export class Driver {
  driverDid: string;
  badgeId: string;
  name: string;
  corridorId: string;
  vehicleType: 'bus' | 'truck';
  capacityKg: number;
}
