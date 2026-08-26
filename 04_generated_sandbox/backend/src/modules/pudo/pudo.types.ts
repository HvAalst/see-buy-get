// PUDO Light domain (Compendium Ch 12–19). The emerging-market Tier 1/2 on-ramp. Reuses the GLOS
// backbone (DID, vault, wallet, ledger, events) but models its own light parcel/agent/corridor flow.

import { CargoClass, CargoNature, Equipment } from './cargo.types';
import { FxRate } from '../../foundation/money/fx.service';
import { BorderCrossing } from './country';

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
  /** The country this shop stands in (ISO-3166 alpha-2). It decides which sister contracts it, and a
   *  journey that leaves it crosses a border. Absent on every pre-slice record, which reads as this
   *  deployment's home country — read it through AgentService.countryOf, never off the field. */
  country?: string;
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

/**
 * The rates a price was struck at, stamped onto the thing that was priced.
 *
 * A named type rather than an inline shape, so the quote and the parcel carry the SAME record — the whole
 * value of keeping it is that what was promised and what was minted can be compared line for line.
 */
export class ParcelFx {
  base: string; // the currency everything was converted INTO
  rates: FxRate[]; // one per foreign currency on the route
  quotedAt: string;
  expiresAt: string; // how long the converted price was good for
  stale: boolean; // whether any rate behind it was already past its refresh window
  /**
   * How much of this price is the FX BUFFER — the difference between what the buyer was charged and what
   * the sisters will settle at (see FX_SPREAD_PCT).
   *
   * Carried as money rather than left as a rate to re-derive, because it is booked: at billing it is split
   * out of revenue into FX gain/loss, so a buffer that turns out to be systematically fat is a number
   * somebody has to answer for rather than quiet margin. Zero on a domestic price.
   */
  buffer: number;
}

/**
 * What travels with a parcel that leaves one customs territory for another.
 *
 * Built at mint from what the sender already declared, and REQUIRED: a crossing is a step with a
 * precondition now, not a line on a route. See customs.ts for the three limits this deliberately keeps —
 * we are not a broker, duty is the importer's, and the importer is referenced rather than named.
 */
export class CustomsDeclaration {
  crossings: BorderCrossing[]; // which borders, read off the route it was quoted on
  contents: string; // what a border officer reads: "Ankara shirt ×2, Kitenge scarf"
  itemCount: number;
  declaredValue: number; // what the GOODS are worth — never the shipping price
  currency: string;
  exporterId: string; // the store or person sending it
  importerRef?: string; // the receiver, by the hash we hold — a real filing needs a name and address
  incoterm: 'DDU'; // delivered duty unpaid: the importer settles duty, and none of it moves through us
  declaredAt: string;
}

export type ParcelSize = 'S' | 'M' | 'L' | 'HEAVY';
export type ParcelStatus = 'Created' | 'At_PUDO' | 'On_Bus' | 'At_MDP' | 'Ready_For_Pickup' | 'Delivered' | 'Disputed' | 'Voided';

/** Where a parcel came into being: a shop counter, a store's own premises, or somebody's hands. */
export type BirthplaceKind = 'counter' | 'store' | 'hand';

/**
 * A parcel's BIRTHPLACE — the place it came into being, which is not the same fact as the first node that
 * took custody of it.
 *
 * They coincide at a counter, which is why one field carried both for so long: `originAgentDid` meant
 * "where it was born" AND "which shop first held it". For a store they already differ (packed in a
 * warehouse, handed in at a shop), and for a store that is collected from directly they diverge entirely —
 * born at the dock, first held by a driver. Conflating them made the collection point look like a parcel
 * with no origin, which no parcel has ever been.
 */
export class Birthplace {
  kind: BirthplaceKind;
  /** Whose place it was: an agent DID, a vendorId, or the sender's own DID. */
  atId?: string;
  label: string; // what a human calls it — a shop name, a store name
  location?: GeoPoint; // known for a counter or a store; often unknown for a parcel born in someone's hands
  at: string;
}

/** Who can be holding a parcel. The network is never an owner — it is one of these holders, in turn. */
export type CustodyKind = 'sender' | 'shop' | 'driver' | 'hub' | 'receiver';

/**
 * One stretch of TIME during which one party physically held the parcel. An open leg (no `to`) is who has
 * it right now.
 *
 * Recorded rather than inferred, because the question a damage claim asks is "who had it when", and a
 * status trail answers only "where was it". Ownership is a different question again and does not move: the
 * SENDER owns the shipment (they paid for it, they can void it, refunds return to them) and the RECEIVER
 * owns the goods (they inspect, they dispute, they hold a collection secret nobody else has). Custody is
 * the chain of hands in between, and it is the only one of the three that changes on every leg.
 */
export class CustodyLeg {
  holderId: string; // an agent DID, a driver DID, an MDP id, a vendorId, or the sender/receiver's own id
  holderKind: CustodyKind;
  from: string;
  to?: string;
  note?: string;
}

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
  /** The country this hub stands in — same fact as a shop's, and it matters more here: a hub is where a
   *  cross-border journey changes hands, so the leg into it is the one that clears customs. Absent on
   *  pre-slice records; read it through MdpService.countryOf. */
  country?: string;
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
/**
 * A vendor's own dock, as a place the network COLLECTS FROM — and nothing else.
 *
 * A store that ships every day should not have to carry its parcels to a shop first. But being a PUDO is a
 * bundle, and outbound is the smallest part of it: a PUDO also takes custody of strangers' parcels, holds
 * release secrets, sits in the destination directory, earns a labour fee for taking a box in, and passes
 * eligibility written for a retail counter. A dock needs none of that and must be granted none of it.
 *
 * So this is deliberately NOT an agent: outbound only, never a destination, no shelf, no release, no
 * rating, and NO INTAKE FEE — nobody was paid to take in a box its own owner packed. What the vendor gains
 * is a saved trip and, having photographed their own goods at mint, their own evidence of their condition.
 * What they accept is that they are the only witness to what they declared.
 */
export class CollectionPoint {
  label: string; // what a driver reads on the offer: "Njiro warehouse, gate 2"
  zone: string; // the delivery zone the dock sits in — corridors are zone-keyed, so a journey needs one
  /** The country the dock stands in. Its own field rather than the store's, because a warehouse is not
   *  always in the country the company is registered in — and a route only cares where the GOODS are.
   *  Absent = the store's own country; read it through VendorService.dockCountryOf. */
  country?: string;
  location: GeoPoint; // the loading door, which is not always the storefront pin
  bays: number; // floor room for staged bags — the shop's bag bays, at a dock
  enabledAt: string;
}

/** Where a key is allowed to be: in a page, or only on a server. See ApiKeyService. */
export type ApiKeyKind = 'publishable' | 'secret';
/** Which world it points at. Carried in the key itself, so a glance at a config file tells you. */
export type ApiKeyMode = 'test' | 'live';

/** A merchant's API key. The full secret exists only in the response that created it. */
export class ApiKey {
  keyId: string;
  vendorId: string;
  kind: ApiKeyKind;
  mode: ApiKeyMode;
  label?: string;
  /** The key itself — PUBLISHABLE ONLY, because it is public by construction and gets read back. */
  value?: string;
  /** SHA-256 of a secret key. See ApiKeyService for why a fast hash is the right one here. */
  hash?: string;
  hint: string; // last four characters — enough to tell two keys apart in a list
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

/** A key as its owner may see it: never a secret, not even to them. */
export class ApiKeyView {
  keyId: string;
  kind: ApiKeyKind;
  mode: ApiKeyMode;
  label?: string;
  hint: string;
  value?: string; // publishable only
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export class Vendor {
  vendorId: string;
  /** Real GLOS DID (S15). The vendorId stays the domain key; the DID is what an actor token binds to. */
  did: string;
  name: string;
  callbackUrl?: string; // GLOS pushes HMAC-signed status callbacks here
  secret: string;
  location?: GeoPoint; // store map pin — origin-PUDO suggestions are ranked from here
  address?: string;
  /** Their own dock, if they have asked for one. Absent = they drop off at a PUDO like everyone else. */
  collection?: CollectionPoint;
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
  /**
   * The first PUDO to take custody — absent when there is none, which is a real case rather than missing
   * data: a store collected from its own dock hands the parcel straight to a driver. This is NOT where the
   * parcel came from; that is `birthplace`, which every parcel has. The two were one field until they had
   * to be told apart.
   */
  originAgentDid?: string;
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
  /** The money every figure above is in — the SELLING sister's, stamped at mint. Absent on records
   *  written before prices named their unit; read it through ParcelService.currencyOf. */
  currency?: string;
  /** The paperwork this parcel crosses a border with. Absent on a domestic shipment, which needs none —
   *  and never absent on one that crosses, because the mint refuses to sell that shipment without it. */
  customs?: CustomsDeclaration;
  /** The sister that SOLD this shipment: it collected the price and carries the cost of every leg, so a
   *  shop in another country that handles this parcel recharges its own sister's outlay to this one, at
   *  cost. Absent on records written before a parcel named its seller — then nobody recharges anybody,
   *  which is exactly right for a single-sister world. */
  sellerEntityId?: string;
  /** The exchange rates this parcel's price was struck at, when it needed any.
   *
   *  Kept for the same reason `platformFeePct` is: a price is a promise made at a moment, and the rate
   *  behind it moves. Without this, a cross-border parcel's cost is a number nobody can reconstruct or
   *  argue about, and the sister that collected it could not later prove what it owed the sister that
   *  performed the leg. Absent on every domestic parcel, because nothing was converted. */
  fx?: ParcelFx;
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
  /** Where it came into being. Absent on pre-slice records — read it through `birthplaceOf`. */
  birthplace?: Birthplace;
  /** Who has physically held it, in order. Absent on pre-slice records — read through `custodianOf`. */
  custody?: CustodyLeg[];
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
