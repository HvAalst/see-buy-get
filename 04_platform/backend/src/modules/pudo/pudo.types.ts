// PUDO Light domain (Compendium Ch 12–19). The emerging-market Tier 1/2 on-ramp. Reuses the GLOS
// backbone (DID, vault, wallet, ledger, events) but models its own light parcel/agent/corridor flow.

import { CargoClass, CargoNature, Equipment } from './cargo.types';
import { FxRate } from '../../foundation/money/fx.service';
import { BorderCrossing } from './country';
import { UnitHold } from './tamper.types';

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
  /**
   * THE NATIONAL ID IT REGISTERED WITH WENT TO SOMEBODY ELSE, by a decision of two members of staff
   * (id-dispute.service.ts). Nothing new is taken in at the counter until an ID of the shopkeeper's own is on
   * record; what is on the shelf is still collected.
   */
  idHold?: { reference: string; at: string };
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
  /** Why the last KYC decision went against them, and when. Cleared the moment they are approved.
   *  Present on a DRAFT shop = "we looked and said no", which is a different state from "never sent". */
  kycRejection?: { reason: string; at: string; by?: string };
  /**
   * Round 40 — THE DATE ITS TRADING LICENCE RUNS TO, noted by staff when they approved the shop and again at each renewal,
   * read off the licence in `copyRef`. Its number is `requirements.tradingLicence`. Absent on a shop approved before it was
   * asked, which stops nothing (shop-licence.ts).
   */
  licence?: { expiresAt: string; copyRef?: string; recordedBy?: string; recordedAt: string };
  /** A renewed licence the shop sent, waiting for staff to read it: the photograph, and the date the shop read off it. */
  licenceRenewal?: { copyRef: string; expiresAt: string; sentAt: string };
  /** Why the last licence the shop sent was not accepted — shown to the shop, which sends another. */
  licenceRenewalRefusal?: { reason: string; at: string; by?: string };
  /** What the last onboarding nudge was ABOUT — the missing set it named, e.g. "id,licence,photos" or
   *  "rejected" or "unfunded". Said once per distinct gap: progress starts a new clock, and an ignored
   *  nudge is never repeated. Follows CredentialReminderService's stamp-against-the-state rule. */
  signupNudgedFor?: string;
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
  incoterm: 'DAP'; // delivered at place (Incoterms 2020): the importer clears and settles duty, none of it through us
  /** DAP's named place: the shop the parcel is collected from. */
  namedPlace?: string;
  declaredAt: string;
}

export type ParcelSize = 'S' | 'M' | 'L' | 'HEAVY';
export type ParcelStatus = 'Created' | 'At_PUDO' | 'On_Bus' | 'At_MDP' | 'Ready_For_Pickup' | 'Unclaimed' | 'Delivered' | 'Disputed' | 'Voided' | 'Returned' | 'Lost';

/**
 * LOST: declared by network staff after a search, never by a clock (the user, 2026-10-18: "staff declare it"). A parcel
 * in the network's hands with no scan for `NOT_SEEN_H` opens a case; staff look for it, then declare it lost with where
 * they looked. The sender is told and holds a damage claim report; the network does not judge what it was worth
 * (rule-damage-is-reported-not-judged). Not a grave: a lost parcel that turns up is found again and carries on from the
 * step it was lost at.
 *
 * Which statuses a parcel can be lost FROM: the ones in which the network holds it. Not Created (nobody has handed it
 * over yet), not a finished one, not one under a reported problem.
 */
export const LOSABLE_STATUSES: ReadonlySet<ParcelStatus> = new Set<ParcelStatus>(['At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Unclaimed']);

/** A parcel declared lost: when, where they looked, and the step it carries on from when it is found. Nobody's name. */
export class ParcelLoss {
  declaredAt: string;
  /** Where staff looked, and what they found — the sender reads it, and it is the problem on the damage claim report. */
  reason: string;
  /** The status it held, restored when it is found: the next ordinary step then works as it would have. */
  fromStatus: ParcelStatus;
  /** Its last scan before it was declared lost. */
  lastSeenAt: string;
  foundAt?: string;
  /** Where it turned up and in whose hands, as staff were told. */
  foundNote?: string;
}

/**
 * The two states in which a parcel is sitting on a destination shelf waiting for its owner.
 *
 * 'Unclaimed' marks a change in TERMS, never in availability: the free window is over, the shop is now
 * being paid by the day, and somebody owes for that — but the box is still on the shelf and still
 * belongs to whoever holds the code. A status that blocked collection would build a system that punishes
 * the one person who eventually did the right thing and walked in on day ten.
 *
 * Exported as a set rather than spelled out at each of the dozen call sites that check for a collectable
 * parcel, because the failure mode of spelling it out is one release path that silently stops working
 * for exactly the parcels this feature exists for.
 */
export const COLLECTABLE_STATUSES: ReadonlySet<ParcelStatus> = new Set<ParcelStatus>(['Ready_For_Pickup', 'Unclaimed']);
export const isCollectable = (status: ParcelStatus): boolean => COLLECTABLE_STATUSES.has(status);

/**
 * What a receiver said when they were told their parcel's collection window had run out.
 *
 * Every one of these DOES something. A reason field that changes nothing is a survey, and this is not a
 * survey — it is the last chance to reach an outcome better than the default, which is a return nobody
 * wanted or an operator writing a box off.
 *
 * 'not-mine' is deliberately NOT a kind of abandonment. Somebody telling us they never ordered this is
 * the one answer after which disposing of it is the last thing we may do; it opens a case against the
 * store instead.
 */
export type ReceiverIntent = 'coming' | 'proxy' | 'relinquish' | 'not-mine';

/** A receiver's answer to the final notice, kept whole — the choice, when, and anything they typed. */
export interface ReceiverResponse {
  choice: ReceiverIntent;
  at: string;
  note?: string;
}

/**
 * Somebody the receiver named to collect on their behalf.
 *
 * This STRENGTHENS the release secret rather than bending it. The workaround it replaces is a receiver
 * reading their own code down the phone to a neighbour — invisible to us, unrecorded, and indistinguishable
 * afterwards from a stranger who guessed. A nomination mints a second code bound to a named person, and
 * the shop still never learns either of them.
 */
export interface CollectProxy {
  name: string;
  phoneHash?: string;
  code: string;
  nominatedAt: string;
}

/**
 * How a dispute ended.
 *
 * Three outcomes and no more, because these are the only three a claimant can be told without
 * weasling: we agree and here is the money, we agree in part and here is why, or we do not agree.
 * "Under review forever" is not an outcome, and it was the only one available before this existed.
 */
export type DisputeDecision = 'upheld' | 'partly_upheld' | 'rejected' | 'report_only';
/*
 * `report_only` is not a fourth thing staff may answer. It is what a reported problem ends in where the company that
 * carried the parcel has stated no cover and so pays nothing from its own books: nobody of ours has anything to
 * decide, and the case closes itself with the damage claim report (damage-report.types.ts). The user, 2026-10-12:
 * "I wonder whether that is our jurisdiction."
 */

/** Where the goods were when the problem was reported — and so where the parcel returns to when the
 *  case closes. A counter dispute is raised while the goods are still on the shop's shelf; a buyer
 *  dispute after they have been handed over. Resolving must not teleport a parcel between the two. */
export type DisputeOrigin = 'counter' | 'buyer';

/** One parcel on a bus's list: what the shop scans, and where on its shelf to find it. */
export class HandoverManifestParcel {
  parcelId: string;
  size: ParcelSize;
  destZone: string;
  binSlot?: string;
  fragile?: boolean;
  /** Left behind at an earlier handover: it is due on this one. */
  leftBehindBefore?: string;
}

/** The bus's list, read after the driver's pass: what this shop must scan onto it. */
export class HandoverManifest {
  corridorId: string;
  /** Where this bus goes: every parcel listed is bound there. */
  destZone: string;
  driverDid?: string;
  parcels: HandoverManifestParcel[];
}

export class DisputeCase {
  /** Open until an operator decides. This is the field that makes `Disputed` a queue rather than a grave. */
  state: 'open' | 'resolved';
  origin: DisputeOrigin;
  /** The status the parcel held when the dispute was raised, restored when the case closes. Stored
   *  rather than inferred: a rejected counter dispute must leave the parcel collectable again, and
   *  guessing that from the origin would be one assumption away from stranding somebody's goods. */
  fromStatus: ParcelStatus;
  reason: string;
  /** Who reported it — an agent DID at a counter, a person DID from the app. */
  raisedBy: string;
  raisedAt: string;
  decision?: DisputeDecision;
  /** What was awarded, in the parcel's own currency. Zero on a rejection, and zero is a real answer
   *  that still gets recorded — a refusal a claimant can be shown beats a case that went quiet. */
  award?: number;
  /** The operator's reasoning. REQUIRED on every decision including a rejection: a person whose goods
   *  arrived broken is owed an explanation even when they are not owed money. */
  note?: string;
  /** Who decided, and when. */
  decidedBy?: string;
  decidedAt?: string;
  /** The money the award is in: the parcel's own where it names one, otherwise that of the company whose books
   *  carry the award. Stamped at the decision — a parcel taken in at a counter names no currency of its own, and
   *  the sender was once told "40.00  is owed to you". Absent on a rejection. */
  currency?: string;
  /** How the award was funded — what the provision covered, and what it cost beyond that. Stamped at
   *  the decision so a later top-up of the provision cannot rewrite what a claim actually cost. */
  funding?: { fromProvision: number; fromExpense: number };
  /** Where the money went: a store's float, or a payable settled off-platform for somebody who paid
   *  cash and has no account. Absent on a rejection. */
  paidTo?: { kind: 'vendor' | 'off_platform'; id: string };
}

/** How a dispute ended, as the two people on the parcel may read it. */
export interface DisputeOutcomeView {
  /** Where the problem was raised: from the receiver's own app, or by the shop at its counter. It decides whose
   *  report this is said to have been — a receiver is not told "your report" about one the shop made. */
  origin: DisputeOrigin;
  decision: DisputeDecision;
  /** The network's reason, written for the claimant. Required on every decision, a rejection included. */
  note: string;
  decidedAt: string;
  /** What was awarded, in `currency`. Absent on a rejection. */
  award?: number;
  currency?: string;
  /** Who the award goes to: the store that bought the shipment, or the sender who paid for it at a counter. */
  paidTo?: 'store' | 'sender';
}

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
/** A planned journey, as it was promised: the shops and hubs in order, and when it should be ready to collect. */
export interface JourneyPlan {
  hops: Array<{ type: 'pudo' | 'mdp' | 'dock'; id: string; label: string; zone: string }>;
  mdpRouted: boolean;
  pickupReadyAt: string;
  plannedAt: string;
}

export class CustodyLeg {
  holderId: string; // an agent DID, a driver DID, an MDP id, a vendorId, or the sender/receiver's own id
  holderKind: CustodyKind;
  from: string;
  to?: string;
  note?: string;
  /** Round 23 — when SeeBuyGet heard of this hand-over, where later than `from`: it was done with no signal, dated by the phone. */
  receivedAt?: string;
}

/** Round 38 — where the caller stands under the custody cap; `capped` false when none applies to them now. */
export class CustodyCapView {
  capped: boolean;
  kind?: 'shop' | 'rider';
  holds?: number;
  cap?: number;
  completed?: number;
  liftedAfter?: number;
  /** Round 39 — a light courier whose ID nobody has seen yet: held at the starting number until somebody has. */
  idUnseen?: boolean;
}

/** A hub's papers, as a shop's: a copy of the responsible person's ID, the trading licence, a photograph of the premises. */
export class HubPapers {
  idCopyRef: string;
  licenceRef: string;
  photoRefs: string[];
  submittedAt: string;
}

/** Why SeeBuyGet said no: the hub is shown it, and sends its papers again. */
export class HubRefusal {
  reason: string;
  at: string;
  by?: string;
}

/**
 * WHERE A HUB STANDS WITH SEEBUYGET (the ISO 28000 check: "hubs are not vetted at all"). A hub that signs itself up
 * starts at `draft`, sends its papers (`pending`), and is `approved` by a member of staff who has seen them — or sent
 * back to `draft`, with the reason. A hub staff register themselves is approved by that person at registration. Until
 * approved a hub does no floor work and is chosen for no zone. Absent: not vetted, the same as `draft`.
 */
export class HubVetting {
  state: 'draft' | 'pending' | 'approved';
  papers?: HubPapers;
  approvedAt?: string;
  approvedBy?: string;
  refusal?: HubRefusal;
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
  /** Where it stands with SeeBuyGet: read it through MdpService.isApproved, never the field alone. */
  vetting?: HubVetting;
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
  /** Round 23 — when SeeBuyGet heard of that first parcel going in, where later than `filledAt` (bagged with no signal). */
  filledReceivedAt?: string;
  availableAt?: string; // when it was published to the claim marketplace
  claimedBy?: string; // driverDid that claimed it OFF THE MARKETPLACE
  /**
   * The driver physically carrying it, however it got onto their vehicle.
   *
   * Distinct from claimedBy, which records a marketplace act: taking a load off the board. A shop
   * handing a bag across the counter is the ordinary way cargo reaches a vehicle and is not a claim at
   * all — so before this, that bag had no driver on it anywhere. Its only trace was locationId reading
   * 'bus:<badge>', a fact encoded in a string prefix that nothing queried.
   *
   * Two things were silently wrong because of it. A fleet manager's "cargo in motion" counted claimed
   * loads only, so a driver riding around with three bags handed to them showed as carrying nothing.
   * And the VEHICLE CAPACITY check counted the same way — so a physical limit, the number of bags a bike
   * can hold, could be exceeded without the count ever moving.
   */
  carriedBy?: string;
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
  /**
   * Round 36 — how it is closed for the road: a coded seal ('seal') or photographed closed ('photo'). The seal's number
   * is never on the bag: it is in its closing (BagClosureService), read off the seal by whoever receives it.
   */
  closedWith?: 'seal' | 'photo';
  closureId?: string;
  /** Round 36 — held under the tamper protocol: not loaded, dropped or received until operations releases it. */
  held?: UnitHold;
  /** Round 23 — when SeeBuyGet heard of the seal, where later than `sealedAt`: closed with no signal, dated by the phone. */
  sealedReceivedAt?: string;
  /**
   * What carrying this bag is worth, LOCKED AT CLAIM — the tote analogue of a freight's `lockedPrice`.
   *
   * Locked rather than computed at delivery for the same reason freight locks: the driver agreed to a job
   * whose distance and contents were what they were at that moment. A parcel added after they claimed, or a
   * destination re-pointed by a re-sort, must not silently rewrite what they are owed either way.
   *
   * Absent on a bag nobody claimed through the marketplace (it can still be loaded), and on every record
   * written before this existed — both settle on the handling fee alone, and `basis` says which.
   */
  haul?: ToteHaul;
}

/** The road half of a bag's pay: what it was worth, and what that figure was computed from. */
export class ToteHaul {
  tripKm: number;
  ratePerKm: number; // the carrying vehicle's OWN advertised rate — the fuel-pump model, as everywhere else
  units: number; // the bag's fill in medium-equivalents, the same basis the buyers were charged on
  road: number; // tripKm × ratePerKm × units
  /**
   * How much the figure can be trusted:
   *  - 'measured'   — both ends resolved to real coordinates
   *  - 'unresolved' — the destination could not be placed, so the road is 0 and only handling is paid.
   *    Recorded rather than hidden: a driver being paid nothing for a real journey is a thing an operator
   *    must be able to SEE, not a silent rounding to zero.
   */
  basis: 'measured' | 'unresolved';
  lockedAt: string;
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
  /**
   * The goods value above which this store wants an UNCOLLECTED parcel shipped back to it.
   *
   * A store's own arithmetic, pre-declared so nobody has to be asked while a shelf slot sits occupied:
   * what the goods are worth against what the return leg costs. Below it, getting the box back is worth
   * less than the journey and the store would rather not pay for it.
   *
   * Undefined = never offer, which is the safe default: a store that has said nothing has not agreed to
   * be billed for anything. Zero means "always offer", which is a different statement and a real one.
   *
   * NOTE what this is NOT. It does not let a store abandon anything — the buyer paid for the goods, so
   * they are the buyer's (see the parcel-trunk rule). This decides only whether the store is OFFERED the
   * chance to pay for its return.
   */
  recoverAboveValue?: number;
  /**
   * THE STORE'S INSURER, where it names one. The user, 2026-10-12: a damage claim report goes "to an insurer of the
   * claimants choice, to the claimant themselves or one set by the vendor according to their shipping policy". Every
   * report on one of this store's orders is emailed to this address as a link. Absent: the store reads its reports in
   * its own app, and nothing is sent anywhere.
   */
  insurer?: { name: string; email: string };
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
  /**
   * Whether the ready_for_pickup callback carries the buyer's collection code. It does by default, because today
   * that callback is how many buyers learn the code (through the store's own email or text). A store whose buyers
   * get it from the Send app switches this off, and the code then never leaves the network. The default is meant to
   * flip once that is the common case.
   */
  callbackCarriesCode?: boolean;
  secret: string;
  /** When the signing secret was last rotated by the store. */
  secretRotatedAt?: string;
  location?: GeoPoint; // store map pin — origin-PUDO suggestions are ranked from here
  address?: string;
  /** Their own dock, if they have asked for one. Absent = they drop off at a PUDO like everyone else. */
  collection?: CollectionPoint;
  country: string; // which per-country daughter company settles this vendor
  /** That daughter company, by id. Absent on records written before entities existed — resolve it
   *  through VendorService.entityIdOf(), which derives it from the country the record already has. */
  entityId?: string;
  /**
   * Somebody to tell when a parcel is coming BACK.
   *
   * A store is a counterparty on the outbound leg and a RECEIVER on a return, and a receiver the network
   * cannot reach is a parcel that arrives at a shop with nobody expecting it. Taken from the operator's
   * phone at registration, where it is already asked for.
   */
  contactMobile?: string;
  /** Prepaid balance held with the daughter company ('no prepay, no label' gate). NULL where the store stands in
   *  a country we only match: having no till with us is a different fact from an empty one. */
  balance: number | null;
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
  /** Round 23 — when SeeBuyGet heard of this step, where later than `at`: done with no signal, dated by the phone. */
  receivedAt?: string;
}

/**
 * The authenticated-twin projection a signed-in consumer sees for a parcel they are a party to (S21).
 * PII-free: no mobiles, no counterparty identity, no collection code — only the caller's own relation
 * to the parcel, its live status, and a status timeline. The receiver's collection token is a later
 * (S22) surface, not this one.
 */
/**
 * A parcel RUNNING LATE: the network holds it on its way — at the shop it was handed in at, on the road, at a hub — and
 * the time it was promised to be ready to collect is more than PARCEL_LATE_GRACE_H behind it. `where` is which of
 * the three, so whoever reads it is told where it is as well as that it is late.
 */
export interface RunningLate {
  promisedAt: string;
  lateHours: number;
  where: 'shop' | 'road' | 'hub';
}

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
   * HOW A DISPUTE ENDED, for both people on the parcel: the receiver who reported it, and the sender who paid
   * for the shipment. The decision, the network's own reason for it, and — when something was awarded — how much
   * and to whom. Never the receiver's words or their photograph, which stay theirs.
   *
   * It was recorded and shown to nobody: once decided, the parcel went back to "delivered" and the person who had
   * reported broken goods could find no trace that anybody had answered.
   */
  disputeOutcome?: DisputeOutcomeView;
  /**
   * The damage claim report made when a problem was reported — receiver-only, because it holds what the receiver
   * wrote and photographed. Present for every reported problem, however it ended. Read it at
   * `GET parcels/:id/damage-report`.
   */
  damageReport?: { number: string };
  /** Declared lost by staff after a search — and, once it turned up, found again. Never who declared it. */
  lost?: { declaredAt: string; reason: string; foundAt?: string; foundNote?: string };
  /**
   * The in-app collection token (S22) — present ONLY on the single-parcel detail, only for the RECEIVER,
   * and only while the parcel is Ready_For_Pickup. The QR is what the PUDO scans; the code is the typed
   * fallback for a dead camera. This is the one place the handover secret is exposed — in the owner's
   * authenticated app, never on the public track and never in the list.
   */
  collectToken?: { code: string; qrPayload: string };
  /** Present while it is RUNNING LATE: past the time it was promised to be ready, and still on its way. */
  runningLate?: RunningLate;
  /**
   * There IS a code, and it is not shown until then: this account was moved to a new number without its PIN, and for
   * the day in which that can be undone nobody on it reads what a shop will ask for. In place of `collectToken`.
   */
  codeHeldUntil?: string;
  /** Receiver only: it was sent to a number this account has moved off. The sender does not know the new one. */
  sentToOldNumber?: boolean;
  /**
   * The closed-window facts, on the RECEIVER's twin only.
   *
   * A sender does not get these. They own the shipment, and it was delivered to the shelf they paid for;
   * whether the person at the other end has come for it, and what that is now costing, is between the
   * receiver and the network. On a peer send the sender is the receiver's only relay, but that argues for
   * telling them the parcel is waiting — which the status already does — not for showing them somebody
   * else's bill.
   */
  unclaimedAt?: string;
  /** What is owed for the shelf slot right now — the same figure the counter will ask for. */
  holdingOwed?: number;
  /** How many extensions are gone, so the app can say whether the next one is free. */
  extensionsUsed?: number;
  /** What they already answered, so a screen does not ask a question they have answered. */
  receiverResponse?: ReceiverResponse;
  /** Who they named to collect, and the code to pass on. Their own nomination, so their own code — not shown while `codeHeldUntil`. */
  collectProxy?: { name: string; code?: string };
  /** They gave up their claim. The parcel is still on a shelf; this says they are no longer coming. */
  relinquishedAt?: string;
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
  /**
   * WHO ANSWERS FOR THESE GOODS — decided when they were taken in, and kept.
   *
   *   ours    a sister carries it: our cover, our claim, our money. The shop is OUR agent.
   *   theirs  no sister can, so a carrier prices it, is paid for it and answers for it, while we
   *           record custody and prove it. There is no collecting entity and no posting of ours.
   *
   * Stamped on the parcel rather than derived later, because a country’s standing can change while
   * goods are on a shelf, and the promise made at the counter is the promise that was made.
   */
  takeInPromise?: 'ours' | 'theirs';
  senderMobile: string;
  receiverMobile: string;
  // S21: pseudonymous join keys to the person identity (peppered sha256 of the mobile, never the number).
  // A signed-in consumer sees every parcel whose sender/receiver hash matches their verified phone —
  // retroactively (O4). Absent when the counterpart is not a person (e.g. a vendor sender).
  senderPhoneHash?: string;
  receiverPhoneHash?: string;
  // The ACCOUNT each side belongs to is deliberately NOT here. This record is handed back whole to the shop that
  // takes the parcel in; an account's id on it would tell a shop, for any number it types, whether that number has an
  // account. It is kept beside the parcels: ParcelService.receiverOf / senderOf (see addressed-to.ts).
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
  /** Round 29 — a store's parcel, paid, under the store's GS1 company prefix: its SSCC, printed on its label. */
  sscc?: string;
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
  /**
   * The three layers that rate was made of, stamped at mint.
   *
   * `platformFeePct` alone says what was charged; this says WHY, and it is the only way to ask afterwards
   * whether a month was profitable because the market was good or because risk was priced into it. A
   * sister turning a knob tomorrow must not be able to rewrite the answer for shipments already sold —
   * the same durability rule the rate itself follows. Absent on records written before the layers existed,
   * whose whole rate was margin by definition.
   */
  rateStack?: { costOfRiskPct: number; profitOnRiskPct: number; marginPct: number };
  /** The SIZE FACTOR its transport was quoted at, stamped at mint for the same reason. A network constant
   *  today, but one that will be retuned — and the flexible rebate recomputes the real cost at delivery,
   *  so an unstamped factor would re-price parcels already sold. Absent on records written before this
   *  field existed; read it through ParcelService.transportFactorOf, which falls back to the constant. */
  transportFactor?: number;
  shipmentCost?: number; // what the vendor is billed prepaid — GROSS: nodeFees + transport + platform fee + tax
  /**
   * The tax inside `shipmentCost`, and the rate and name it was charged under — all three stamped at mint.
   *
   * Stamped for the same durability reason as the rate stack, and for a sharper one besides: a tax rate is
   * changed by a government, on a date, and every sale before that date was correctly taxed at the old
   * one. A ledger that recomputed tax from today's rate would restate history the authority itself does
   * not restate.
   *
   * ABSENT MEANS ZERO, not "look up the default" — unlike `platformFeePct`, whose absence means the
   * network rate. A shipment sold before any sister charged tax genuinely carried none, and reading a
   * current rate back onto it would invent a liability nobody ever collected.
   */
  taxPct?: number;
  taxLabel?: string;
  /**
   * What the shop was CHARGED for this parcel at its counter (before tax), and what it was PAID for taking it in — by
   * its own company's list on that day. Kept because both are taken back if the parcel is cancelled, and a list that
   * changed in between must not make what comes back differ from what went.
   */
  intakeCharge?: number;
  intakeLabour?: number;
  shipmentTax?: number;
  /**
   * The COST-OF-RISK slice of the platform fee on this shipment — money set aside against claims rather
   * than earned, stamped at mint like everything else about the price.
   *
   * Inside `platformFee`, never on top of it: the customer paid this the day the rate stack shipped, and
   * moving it from revenue to a provision changes no price. Stamped because a sister that turns its
   * cost-of-risk knob tomorrow must not change what was set aside for a shipment sold today — and
   * because a refund has to release exactly what a billing set aside.
   *
   * Absent means ZERO, the same reading as tax: a shipment sold before any of this carried no cover.
   */
  shipmentProvision?: number;
  /**
   * THE COVER on this shipment, stamped at mint.
   *
   * `coverLimit` is the ceiling an upheld damage award is checked against — the free limit the selling
   * sister carries, or the value the shipper declared, whichever is higher. Declaring less than the free
   * limit does not reduce cover: the floor is a floor, not a swap.
   *
   * `shipmentPremium` is what was charged for the part above the free limit, and like the cost-of-risk
   * slice it accrues to the claims provision rather than to revenue — money collected against a promise,
   * not earned for a service performed.
   *
   * Stamped, so a sister that changes its policy tomorrow cannot change what it promised on a shipment
   * sold today. Absent on every parcel from before this existed, which reads as NO cover — the honest
   * answer, because none was priced, promised or paid for.
   */
  declaredValue?: number;
  coverLimit?: number;
  shipmentPremium?: number;
  /** The money every figure above is in — the SELLING sister's, stamped at mint. Absent on records
   *  written before prices named their unit; read it through `parcelCurrency` (parcel.service.ts). */
  currency?: string;
  /** The paperwork this parcel crosses a border with. Absent on a domestic shipment, which needs none —
   *  and never absent on one that crosses, because the mint refuses to sell that shipment without it. */
  customs?: CustomsDeclaration;
  /** Round 13 — the shop that took it in saw its commercial invoice in the pouch: when, and which shop. */
  papersSeen?: { at: string; by: string };
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
  ceilingCost?: number; // the worst-case (highest-rate) GROSS a flexible parcel reserves — money held, tax and all
  /** The tax inside that ceiling. Held here rather than re-derived, so the rebate can un-owe exactly the
   *  tax that was owed: dividing a gross figure back out to find its tax is a different sum from the one
   *  that produced it, and it lands a cent away often enough to matter in a liability account. */
  ceilingTax?: number;
  /** …and the cover inside that ceiling, for the same reason: the rebate has to release exactly the
   *  provision the ceiling set aside, and re-deriving it from a rate would land a cent away. */
  ceilingProvision?: number;
  actualCost?: number; // the real GROSS once the carrier is known (drives the flexible rebate)
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
  /**
   * The open or settled CASE behind a dispute — the thing `Disputed` never had.
   *
   * Until this existed, `Disputed` was a terminal status: a person reported that their goods arrived
   * broken, the parcel stopped there, and nothing in the system could ever say what happened next. Not
   * a missing feature so much as a missing ending — and the reason the cost-of-risk pricing layer had
   * to stay at zero, because a provision you can never draw down is an accumulating fiction.
   *
   * Absent on every parcel that has never been disputed, and on disputes filed before this existed —
   * those keep their `disputeReason` / `buyerDisputeReason` and read as open cases with no case file.
   */
  dispute?: DisputeCase;
  /** Declared lost by staff after a search (ParcelLoss above); kept once it is found, with when and where. */
  lost?: ParcelLoss;
  /** Round 35 — held under the tamper protocol: it changes hands with nobody until operations releases it. */
  held?: UnitHold;
  // S25 — handover completeness gate. Set when a waiting parcel was KNOWINGLY left behind at handover
  // (an acknowledged short-ship), so the control tower sees it immediately instead of waiting for the
  // 48 h stagnant window. Cleared the moment the parcel is finally loaded onto a bus.
  shortShippedAt?: string;
  shortShipReason?: string;
  acceptedAt: string;
  /**
   * When it became collectable — the moment it hit the destination shelf.
   *
   * Stamped rather than derived from the last scan, and the difference is not cosmetic: a wrong
   * collection code writes a `Ready_For_Pickup` scan of its own, so ageing off the scan list would reset
   * the uncollected clock every time somebody fumbled their code. The one event that matters here happens
   * once, so it is recorded once.
   *
   * Absent on records written before this existed; readers fall back to the scan list.
   */
  readyAt?: string;
  /** When the receiver was reminded it was still waiting. Set once — see the dispatcher for why one
   *  reminder and not a series — and set even when there was nobody to tell, so somebody who signs up
   *  later is not greeted by a nudge about a parcel that has been sitting a fortnight. */
  uncollectedRemindedAt?: string;
  /** When the people on it were told it is running late (see runningLate). Once, and set even when there was nobody
   *  to tell, for the same reason as the reminder above. */
  lateToldAt?: string;
  /** The journey home, for a parcel nobody came for. Present only on a 'Returned' one — the two read as
   *  one story rather than as an abandonment and an unexplained new shipment. */
  returnParcelId?: string;
  /**
   * When the free collection window ran out — the start of the holding-fee clock.
   *
   * Distinct from readyAt, and the distinction is the whole feature: readyAt is when the wait began,
   * this is when the wait stopped being free. An extension resets readyAt and CLEARS this, because a
   * receiver who bought more time is inside a free window again by definition.
   */
  unclaimedAt?: string;
  /** Holding already settled, so a part-paid parcel is not billed twice at the counter. */
  holdingSettled?: number;
  /**
   * What a day of holding costs, fixed when the free time ended (the list of the company whose shop holds it, that
   * day). The days already owed are not re-priced by a later change to that list. Cleared with `unclaimedAt`.
   */
  holdingFeePerDay?: number;
  /** Extensions taken. The first is free (FREE_EXTENSIONS); counted so the second can be priced. */
  extensionsUsed?: number;
  /** What the receiver said when told the window had closed. Absent means silence — which is the
   *  common case and an outcome the whole flow has to reach correctly without. */
  receiverResponse?: ReceiverResponse;
  /** Somebody named to collect instead of the receiver. Their code releases the parcel; so does the
   *  receiver's own, because nominating a neighbour does not stop you collecting it yourself. */
  collectProxy?: CollectProxy;
  /**
   * When the RECEIVER gave up their claim to the goods.
   *
   * Only the receiver can set this: sender owns the shipment, receiver owns the goods, so the receiver
   * is the only party with anything to relinquish. It does not make the box disappear — there is a real
   * parcel in a real shop — and it is not 'Voided', which would say the shipment never happened when it
   * happened all the way. It moves the parcel into the disposal queue, and only once no store still has
   * a funded claim to bring it home.
   */
  relinquishedAt?: string;
  handedToBusAt?: string;
  deliveredAt?: string;
  /** Where it came into being. Absent on pre-slice records — read it through `birthplaceOf`. */
  birthplace?: Birthplace;
  /** Who has physically held it, in order. Absent on pre-slice records — read through `custodianOf`. */
  custody?: CustodyLeg[];
  /**
   * THE PROMISE, KEPT — the route it should take and when it should be ready to collect, as planned the moment it
   * entered custody at its first shop (JourneyPlanService). Frozen then and never rewritten, so it can be held
   * against what happened (`planVsActual`). The tracking page used to work its plan out again at every read, and a
   * promise worked out afresh every time is always on time. Absent where no route could be planned.
   */
  plan?: JourneyPlan;
  scans: ParcelScan[];
}

// 'OVERDRAFT' was removed with the trade-credit line — there is no way to create one any more. Any row
// on disk from before still renders (the type word falls back to the raw string), it just cannot recur.
export type LedgerType = 'TOP_UP' | 'TOP_UP_FEE' | 'FEE' | 'LABOR_PAYOUT' | 'DRIVER_PAYOUT' | 'DRIVER_CLAWBACK' | 'REFUND' | 'SETTLEMENT' | 'BILLING' | 'REBATE';

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

/**
 * A return offered to the store that sold it, for a parcel nobody came for.
 *
 * The offer exists because three parties each hold one piece: the network knows the parcel is stranded,
 * the STORE knows whether the goods are worth the journey home, and the SHOP is the one with it on a
 * shelf. Nobody can answer alone, so the network computes, the store decides, and the shop hands it over.
 *
 * The price is held AT THE OFFER, not at acceptance. A store that says yes on Friday to a figure quoted on
 * Monday must be billed Monday's number — the same promise a held checkout quote makes, for the same
 * reason, and the reason `quoteId` is carried rather than re-derived.
 */
export type ReturnOfferStatus = 'offered' | 'accepted' | 'declined' | 'expired';

export class ReturnOffer {
  offerId: string;
  parcelId: string;
  vendorId: string;
  /** Where it is now — the shop holding it — and where it would go back to. */
  fromAgentDid: string;
  toAgentDid: string;
  /** What the goods are worth, and what the journey home costs. The store's arithmetic, shown not implied. */
  declaredValue: number;
  returnCost: number;
  /**
   * What the shop is owed for having held the slot since the window closed — recomputed on every read,
   * never stamped.
   *
   * The transport half is a held price a store is billed exactly what it was shown. This half is a
   * METER, and showing it as though it were fixed would be the one dishonest number on the screen. It
   * grows while they think about it, which is also the truest pressure this feature has: a store
   * watching the cost of deciding nothing go up is being told something real.
   */
  holdingCost?: number;
  currency: string;
  /** The held price this will be billed at. A store is billed the figure it was shown. */
  quoteId?: string;
  status: ReturnOfferStatus;
  offeredAt: string;
  expiresAt: string;
  decidedAt?: string;
  declineReason?: string;
  /** The return shipment, once it exists. */
  returnParcelId?: string;
}

export class Corridor {
  corridorId: string;
  name: string;
  originZone: string;
  destZone: string;
  vehicleType: 'bus' | 'truck';
  schedule: string; // e.g. 'North-South Express, 08:00'
  /**
   * proposed  a fleet asked to run this line; nothing routes on it until the network publishes it
   * active    published — shops in the origin zone may take parcels in for it
   * blocked   closed by the network, and kept so that "closed" never reads as "never existed"
   */
  status: 'proposed' | 'active' | 'blocked';
  /** Absent for the network's own corridors. A fleet's line names the fleet that runs it — and only its
   *  own drivers may be put on it. */
  owner?: { kind: 'fleet'; managerDid: string; company: string };
  proposedBy?: string;
  proposedAt?: string;
  publishedBy?: string;
  publishedAt?: string;
  /** Why the fleet wants it. Read by the operator deciding whether to publish. */
  note?: string;
}

export class Driver {
  driverDid: string;
  badgeId: string;
  name: string;
  corridorId: string;
  vehicleType: 'bus' | 'truck';
  capacityKg: number;
}
