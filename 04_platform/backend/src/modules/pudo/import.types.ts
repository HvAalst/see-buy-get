import { Quote } from './quote.types';
import { HeldRailNote, RailNoteView } from './rail-note.types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CompanyDocument } from '../../foundation/entity/company-documents.service';
import { BOX_ENDINGS, CONDITION_STANCES, FREE_DAY_KINDS, INTERCHANGE_SIDES } from './container-box';
import { ContactCardView } from './depot.types';

/**
 * CL2a — AN IMPORT CONSIGNMENT: one container, its papers, and the agent appointed to clear it.
 *
 * NOT the `Consignment` in pudo.types.ts, which is F3's consolidation LOT — a cooperative filling a
 * truckload from member deposits. The collision is unfortunate and the two are kept apart deliberately:
 * that one is codenamed LOT-nnn and this one IMP-nnn, and nothing converts between them. The only other
 * "container" in this system is a truck BODY that can carry one, which is a third thing again.
 *
 * WHY THIS EXISTS, from two real imports the user ran. One 20ft container from the Netherlands to Ethiopia
 * sat at customs for two weeks: the agent was pleasant and reliable and simply did not know which papers
 * that border would ask for. Five containers of factory plant from India cleared in a morning, because a
 * different agent knew every document before the clearance started. So the lever is FOREKNOWLEDGE, not
 * diligence, and a document wallet that still lets an agent discover a requirement at the counter has
 * changed nothing.
 */

/**
 * `open` — recorded, no agent yet. `appointed` — an agent holds grants over the papers.
 *
 * There is deliberately no `ready` or `cleared` state. Whether the papers are complete is DERIVED from the
 * required list every time it is read, the same way a country's `established` is derived from a company
 * existing rather than typed by somebody. A stored flag saying "ready" is one that goes stale the moment a
 * licence expires, and it would go stale silently.
 */
export const IMPORT_STATUSES = ['open', 'appointed'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * HOW THE GOODS ARRIVED — a label, and nothing more than a label.
 *
 * Added because the agent page said "clears containers" and the user corrected it: agents clear air
 * freight, vehicles, whatever they specialise in, and a container is simply the only consignment this
 * system had ever recorded. That was our model describing somebody's business.
 *
 * This does NOT model air or rail carriage any more than `destPort` models a port. There is no airline,
 * no air waybill, no schedule and no rate — those stay out for the same reason ocean carriage does. What
 * it buys is an honest record: an agent whose work is air freight can now have that counted as air
 * freight instead of being invisible or mislabelled.
 *
 * Absent on every consignment recorded before this field existed, and those were sea containers by
 * construction — the register accepted nothing else. `modeOf` below states that rather than leaving a
 * silent `?? 'sea'` for somebody to mistake for a guess about new data.
 */
export const CONSIGNMENT_MODES = ['sea', 'air', 'road', 'rail'] as const;
export type ConsignmentMode = (typeof CONSIGNMENT_MODES)[number];

/** The mode of a consignment, including the ones recorded before the field existed. */
export function modeOf(c: { mode?: ConsignmentMode }): ConsignmentMode {
  return c.mode ?? 'sea';
}

/**
 * WHAT IS ACTUALLY IN THE BOX — declared by the importer, never read out of a description by us.
 *
 * The question that forced this: two identical 20ft tanks, one carrying edible oil and one carrying gas
 * oil, are entirely different movements. No container code distinguishes them, and we must not decide it
 * from the words "edible oil" either — classifying goods is regulated territory and the penalty lands on
 * the importer, which is the same line §10 draws around duty. So the importer PICKS the nature, from the
 * vocabulary the freight side already uses, and we carry what they said.
 */

/**
 * A TANK'S HISTORY, which is the only thing that makes it food-grade.
 *
 * Not geometry and not a code: a tank that has carried crude can never carry food, and the way that is
 * established in the trade is the last cargoes plus a cleaning certificate. Recorded as the importer's
 * declaration with the certificate attachable as one of their own documents — we do not certify a tank
 * fit for food, and nothing here should ever read as though we had.
 */
export class TankDeclaration {
  /** What it last held, most recent first. The trade usually wants three. Their words. */
  @ApiProperty({ type: [String] }) lastCargoes: string[];
  @ApiPropertyOptional() cleanedAt?: string;
  /** One of the importer's own documents — the cleaning certificate. Never a file uploaded into here. */
  @ApiPropertyOptional() certificateDocumentId?: string;
  @ApiProperty() declaredBy: string;
  @ApiProperty() declaredAt: string;
}

/**
 * THE DANGEROUS-GOODS DECLARATION — the importer's, and never inferred.
 *
 * A UN number and class decide the placards on the truck, the certification the driver must hold, and
 * which roads the load may not use at all (the hazard map's NO_HAZMAT). We do not derive any of it: a
 * description reading "solvent" is not a classification, and guessing one would be the same regulated
 * advice this epic refuses to give about duty.
 */
export class DangerousGoodsDeclaration {
  /** 'UN1202'. Carried as the importer wrote it; we validate the shape and never the choice. */
  @ApiProperty() unNumber: string;
  /** The IMDG/ADR class as declared — '3', '8', '5.1'. */
  @ApiProperty() imdgClass: string;
  @ApiPropertyOptional() properShippingName?: string;
  @ApiProperty() declaredBy: string;
  @ApiProperty() declaredAt: string;
}

/**
 * THE BOX'S OWN FACTS, resolved from the catalogue for whoever is reading.
 *
 * Sent rather than left for a screen to look up, for the reason every derived figure in this codebase is
 * sent: two implementations of the same table drift, and the one on the screen drifts silently.
 */
export class ContainerFacts {
  @ApiProperty() code: string;
  @ApiProperty() label: string;
  @ApiProperty() lengthM: number;
  @ApiPropertyOptional() lengthFt?: number;
  /**
   * External height in metres. 2.591 standard, 2.896 high-cube — the 30 cm that decides a bridge.
   *
   * ABSENT for the four size codes that are OPEN RANGES ("taller than 2896 mm"). The standard declines
   * to say, so we do too, and the road leg then has no height to give the bridge map.
   */
  @ApiPropertyOptional() heightM?: number;
  @ApiPropertyOptional() widthM?: number;
  /** The 2.5 m class rather than 8'0" — a box that will not fit some older chassis at all. */
  @ApiProperty() palletWide: boolean;
  /** The standard's own grouping — 'tank (dangerous liquids)', 'ventilated', 'flat rack'. */
  @ApiProperty() group: string;
  @ApiProperty() kind: string;
  /** No fixed roof: craned from above, not weatherproof, and the cargo may stand proud of the box. */
  @ApiProperty() openTop: boolean;
  @ApiProperty() needsPower: boolean;
  @ApiProperty({ type: [String] }) bodies: string[];
  @ApiProperty({ type: [String] }) equipment: string[];
  /** How tall the movement stands, where the cargo was declared taller than an open box. */
  @ApiProperty() outOfGauge: boolean;
  /** True where the CODE does not state a height, so somebody has to measure the box. */
  @ApiProperty() heightUnstated: boolean;
}

/* --------------------------- Y0 + Y1: the box as an asset, and the clock on it -- */

/**
 * HOW MANY FREE DAYS SOMEBODY SAYS THIS BOX HAS — a claim, carried and attributed, never a finding.
 *
 * It comes from a contract between the importer and the shipping line that we have never seen. Sent with
 * the name on it because the countdown that uses it has to be able to say whose number it is, and every
 * claim is kept: a corrected figure is a second claim rather than an edit.
 */
export class FreeDaysClaimView {
  @ApiProperty({ enum: FREE_DAY_KINDS }) kind: string;
  @ApiProperty() days: number;
  @ApiProperty() by: string;
  @ApiProperty() byEntityId: string;
  @ApiProperty() at: string;
}

/**
 * WHAT THE CLOCK SAYS, derived on every read and said in DATES — there is no money anywhere in it.
 *
 * We do not compute somebody else's charge: the rate is in a contract we have not seen, the penalty lands
 * on the importer, and a figure we invented would be relied on. So this carries days and dates and the
 * sentence that explains them, and the charge stays between the importer and the line.
 *
 * TWO CLOCKS, because demurrage runs while the box sits INSIDE the terminal and detention runs while it is
 * OUTSIDE and not yet back. Different parties can be at fault for each, so a single "days" field would be
 * a number nobody could act on.
 */
export class BoxClockView {
  /** `stopped` has an ending; `unknown` has neither an arrival nor a picked-up road leg. */
  @ApiProperty({ enum: ['demurrage', 'detention', 'stopped', 'unknown'] }) kind: string;
  /** What the running clock counts from. */
  @ApiPropertyOptional() since?: string;
  /** Whole days, floored: a part-day is not a day anybody is charged for, and not one we will invent. */
  @ApiPropertyOptional() daysElapsed?: number;
  @ApiPropertyOptional() freeDays?: number;
  /** Whose figure it is. Shown beside the countdown, always. */
  @ApiPropertyOptional() freeDaysBy?: string;
  @ApiPropertyOptional() freeDaysAt?: string;
  /** DERIVED, never stored — a stored due-date goes stale in silence the moment the claim is corrected. */
  @ApiPropertyOptional() dueBackAt?: string;
  @ApiPropertyOptional() daysLeft?: number;
  @ApiProperty() overdue: boolean;
  /** How long it stood inside the terminal before the gate, where both dates are known. Closed, not running. */
  @ApiPropertyOptional() demurrageDays?: number;
  /** One sentence naming what is being counted and whose numbers these are. Screens show it verbatim. */
  @ApiProperty() basis: string;
}


/**
 * Y3 — ONE ACCOUNT OF THE BOX'S CONDITION AT A GATE. Attributed, dated, and never erased.
 *
 * The same shape as a road hazard's account and a customs hold's, for the same reason: two parties are
 * going to disagree about who put the hole in it, and the honest structure is both accounts standing side
 * by side with nothing adjudicating them.
 */
export class InterchangeAccountView {
  /** A person's name — or, on the DERIVED account, the leg whose photograph it is. */
  @ApiProperty() by: string;
  @ApiPropertyOptional() byEntityId?: string;
  @ApiProperty() at: string;
  @ApiProperty({ enum: CONDITION_STANCES }) stance: string;
  @ApiPropertyOptional() note?: string;
  /** Media ids, readable only through this consignment's own photograph route. */
  @ApiProperty({ type: [String] }) photoRefs: string[];
  /**
   * TRUE where this account was read off the leg rather than typed by anybody.
   *
   * The driver's securement photograph was taken to prove a load was strapped down, and it is being read
   * as evidence of a container's condition. That is a fair reading, and it is not the same as somebody
   * standing at the gate and saying so — which is why a reader is told which one they are looking at.
   */
  @ApiPropertyOptional() derived?: boolean;
}

/** One of the two gates, with everything anybody has said about it. */
export class InterchangeGateView {
  @ApiProperty({ enum: INTERCHANGE_SIDES }) side: string;
  @ApiProperty() gate: string;
  @ApiPropertyOptional() at?: string;
  @ApiProperty({ type: [InterchangeAccountView] }) accounts: InterchangeAccountView[];
  @ApiProperty({ type: [String] }) photoRefs: string[];
  /**
   * FALSE means nobody has said anything about this gate at all.
   *
   * Sent as a fact rather than left as an empty list, because a gate with no record is where an argument
   * gets settled by whoever sounds more certain — and that is the thing this slice exists to prevent.
   */
  @ApiProperty() stated: boolean;
  @ApiProperty() disputed: boolean;
}

/**
 * THE BOX, DERIVED FROM ITS NUMBER and never registered — Y0.
 *
 * A container is a shipping line's property on loan, and the road leg we mint out of the terminal gate is
 * what starts the clock on it. The entity is created the first time anybody names one, is keyed by the
 * number (globally unique by design, with a check digit so a typo is detectable), and belongs to NO
 * consignment: the same box comes back next month under a different one, and it can turn up on a purely
 * domestic load with no import behind it at all.
 */
export class ContainerBoxView {
  @ApiProperty() containerNo: string;
  /** The first three letters are the owner; the fourth says what the equipment is. */
  @ApiPropertyOptional() ownerCode?: string;
  @ApiPropertyOptional() category?: string;
  @ApiPropertyOptional() typeCode?: string;
  /**
   * The date on the CSC safety-approval plate. Carried, with NOTHING stated about it: whether a box is fit
   * is a surveyor's verdict, and the same line that refused to certify a tank holds here.
   */
  @ApiPropertyOptional() cscPlateDate?: string;
  @ApiProperty() firstSeenAt: string;
  /** How many spells out of a terminal this box has had with us — the history a per-consignment record loses. */
  @ApiProperty() timesUsed: number;
  @ApiPropertyOptional() importCode?: string;
  /** WHO OWES THE RETURN: the agent who booked it, derived from the appointment rather than typed. */
  @ApiPropertyOptional() owedByName?: string;
  /** Recorded by a person — nothing here watches a vessel berth, and we do not guess at an arrival. */
  @ApiPropertyOptional() arrivedAt?: string;
  /** DERIVED from the road leg's pickup. The leg we mint is what starts detention, in code and not only in prose. */
  @ApiPropertyOptional() outGatedAt?: string;
  @ApiPropertyOptional() returnedAt?: string;
  /**
   * How the spell ended, and there are two endings rather than one.
   *
   * `returned` is the one the first draft assumed was the only one. `bought` is the ordinary market case —
   * containers are traded goods, sold and never returned — and a box that was bought is never overdue.
   */
  @ApiPropertyOptional({ enum: BOX_ENDINGS }) ending?: string;
  @ApiPropertyOptional() endedBy?: string;
  @ApiPropertyOptional() endedWhere?: string;
  /**
   * Y2 — THE LEG HOME, on the same board as any other load.
   *
   * Its DELIVERY is what records the return, exactly as the laden leg's pickup is what records the
   * out-gate: the box is back when the leg that took it back arrived, and nobody has to remember a date.
   */
  @ApiPropertyOptional() returnLegCode?: string;
  @ApiPropertyOptional({ enum: ['posted', 'moving', 'arrived'] }) returnLegState?: string;
  @ApiPropertyOptional() returnDepot?: string;
  /** True where there is nothing in it. Said out loud: an empty run is real work with no cargo to bill. */
  @ApiPropertyOptional() returnEmpty?: boolean;
  /**
   * Y3 — BOTH GATES, ALWAYS, so the one nobody recorded is visible as the one nobody recorded.
   *
   * A box handed over with a hole in it and no photograph is a dispute the importer loses by default.
   */
  @ApiProperty({ type: [InterchangeGateView] }) interchange: InterchangeGateView[];
  @ApiProperty({ type: [FreeDaysClaimView] }) freeDays: FreeDaysClaimView[];
  @ApiProperty({ type: BoxClockView }) clock: BoxClockView;
}

/**
 * The two kinds of grant, because the papers are of two kinds.
 *
 * `company` — the standing papers: an investment licence, a tax number. They are the importer's own and are
 * reused on every container, so the grant is not tied to one. These carry no `relatesTo` on the document.
 * `consignment` — this container's own: a packing list, the invoices, the bill of lading. These carry the
 * import's CODE as `relatesTo`, which is what confines the grant to one container.
 */
export const GRANT_SCOPES = ['company', 'consignment'] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];

/**
 * THE MISSING PRIMITIVE — a READER.
 *
 * Every field on `CompanyDocument` is about the company that owns it: who uploaded it, who verified it, when
 * it expires. Nothing on it could say who else may see it, so before this slice a document could not be
 * shared at all, and the only way to let an agent at the papers was to hand them the client's sign-in. The
 * administrator record refuses one person administering two companies in writing, for exactly the reason
 * that makes a borrowed login the wrong answer: a credential reaching two companies is one neither controls.
 *
 * The shape is copied from what conversations already do — shared with exactly ONE named counterparty,
 * explicit, revocable, on the record, and visible to both sides. A revoked grant is KEPT rather than deleted:
 * "who could see our invoices in March" has to stay answerable after the appointment ends.
 */
export class DocumentGrant {
  @ApiProperty() grantId: string;
  @ApiProperty({ enum: GRANT_SCOPES }) scope: GrantScope;
  /** Whose papers these are — the importer. */
  @ApiProperty() ownerEntityId: string;
  /** Who may read them — the clearing agent. Exactly one company, never a list. */
  @ApiProperty() readerEntityId: string;
  /**
   * THE READER'S NAME AND ADDRESS, because an entity id is not an answer to "who can read my papers".
   *
   * The screen showed `partner-et-djibouti-clearing-lj2ga` — a primary key, wrapped over three lines in a
   * column too narrow for it. Somebody deciding whether to revoke access to their own commercial papers
   * was being asked to recognise a slug. The name is what they know the company by; the handle is where
   * they can go and read who it is before deciding.
   *
   * Absent where the record has no name for that id, rather than falling back to the id dressed as a
   * name — an unknown reader is a thing worth seeing plainly.
   */
  @ApiPropertyOptional() readerName?: string;
  @ApiPropertyOptional() readerHandle?: string;
  /** How many papers this grant actually reaches today. Derived, and it moves as papers are added. */
  @ApiPropertyOptional() reaches?: number;
  /** Which container, on a `consignment` grant. Absent on a standing one. */
  @ApiPropertyOptional() importId?: string;
  @ApiProperty() grantedBy: string;
  @ApiProperty() grantedAt: string;
  @ApiPropertyOptional() revokedBy?: string;
  @ApiPropertyOptional() revokedAt?: string;
  @ApiPropertyOptional() revokedReason?: string;
}

/**
 * One line of the list THE AGENT PUBLISHES — what they will need for this consignment.
 *
 * We never assert this list. The whole difference between the user's two imports is that one agent knew and
 * the other did not, and the network is not in a position to know better than either: a list of papers
 * asserted by us would be wrong at some border on some day, and the penalty for being wrong lands on the
 * importer standing at the counter. So the agent publishes, the importer fulfils, the agent ticks off, and
 * the importer can see at any moment what is still missing.
 */
export class RequiredPaper {
  /** A slug the agent chooses, unique within this consignment — what `supply` and `accept` name. */
  @ApiProperty() key: string;
  /** The agent's own words: "Investment licence", "Ministry of Agriculture permit". */
  @ApiProperty() label: string;
  /** How many physical copies the counter wants. Some of the user's papers were wanted in ten. */
  @ApiPropertyOptional() copies?: number;
  @ApiPropertyOptional() note?: string;
  @ApiProperty() addedBy: string;
  @ApiProperty() addedAt: string;
  /** What the importer attached. One of THEIR OWN documents, never a file uploaded into this list. */
  @ApiPropertyOptional() documentId?: string;
  @ApiPropertyOptional() suppliedAt?: string;
  @ApiPropertyOptional() suppliedBy?: string;
  @ApiPropertyOptional() acceptedAt?: string;
  @ApiPropertyOptional() acceptedBy?: string;
  @ApiPropertyOptional() rejectedAt?: string;
  @ApiPropertyOptional() rejectedBy?: string;
  @ApiPropertyOptional() rejectionReason?: string;
}

/**
 * CL4 item 1 — WHAT THE STATE DID, which is the half of §6 that is not the agent's doing.
 *
 * Inspection selection, a physical examination, a queue. §6 says these are "recorded, shown, and labelled
 * as not the agent's doing", and never blended into anything — because blending is exactly what makes
 * bribery look like competence.
 *
 * WHO RECORDS IT: either party to the container, and in practice the agent, who is the one standing there.
 * That is obviously self-serving — a free "it was not my fault" field — so it is built the way the road
 * map's disputes are built and for the same reason: the account is ATTRIBUTED, the OTHER party can put
 * their account beside it, and nothing is ever erased. A reader sees the disagreement rather than our
 * adjudication of it. The disputed count travels with the record, so a page cannot show the excuse
 * without showing that it is contested.
 *
 * AND IT NEVER TOUCHES THE AGENT'S OWN FIGURES. A system that quietly discounted an agent's response
 * times by the holds they themselves reported would have built the excuse field this design refuses.
 * Context a reader weighs; never arithmetic.
 *
 * NO PHOTOGRAPH, deliberately, and this is the one field somebody will want to add. A customs hold notice
 * is a photograph of an official document, and whether we may hold those is the open legal question that
 * blocks CL5 (§11). Words, a date and an attribution are available today; the photograph is not, and
 * shipping it here would smuggle the blocked decision in through a side door.
 */
export const CUSTOMS_HOLD_KINDS = ['inspection_selected', 'physical_exam', 'documents_queried', 'queue', 'other'] as const;
export type CustomsHoldKind = (typeof CUSTOMS_HOLD_KINDS)[number];

/** Which side of the question somebody is on: it happened as described, or it did not. */
export const HOLD_STANCES = ['happened', 'disputed'] as const;
export type HoldStance = (typeof HOLD_STANCES)[number];

/**
 * ONE PARTY'S ACCOUNT of a hold — what they said, when, and which side they are on.
 *
 * DECLARED ABOVE its users: the swagger plugin evaluates an `@ApiProperty` class reference when the
 * referring class is DEFINED, so a class declared after its user typechecks cleanly and then kills the
 * contract emit with a temporal dead zone. That has cost this project a session twice.
 */
export class CustomsHoldAccount {
  @ApiProperty() by: string;
  @ApiProperty() at: string;
  @ApiProperty({ enum: HOLD_STANCES }) stance: HoldStance;
  @ApiPropertyOptional() note?: string;
}

/** One thing the state did to one container, and both parties' accounts of it. */
export class CustomsHold {
  @ApiProperty() holdId: string;
  @ApiProperty({ enum: CUSTOMS_HOLD_KINDS }) kind: CustomsHoldKind;
  /** When it happened, as the party recording it says. Their date, not ours: we were not there. */
  @ApiProperty() at: string;
  /** When it ended, once somebody records that it has. Absent while a container is still held. */
  @ApiPropertyOptional() releasedAt?: string;
  @ApiProperty() recordedBy: string;
  @ApiProperty() recordedAt: string;
  /** Every account given, oldest first, including the one that recorded it. */
  @ApiProperty({ type: [CustomsHoldAccount] }) accounts: CustomsHoldAccount[];
}

/**
 * CL2b — HOW FAR THE AGENT'S FEE HAS GOT: `none` · `quoted` · `accepted` the importer agreed · `paid` a party
 * confirmed it paid. Derived from the quotation on every read.
 *
 * The user, 2026-10-04: "we don't manage the clearing agent's fee, but we do handle quotations for anyone." So the fee
 * is a QUOTATION (quote.types.ts) — the figure, the proforma, open or paid as the parties confirm it — and nothing of
 * it passes through our books. It used to: staff recorded the money arriving and a sister owed it onward.
 */
export const FEE_STATES = ['none', 'quoted', 'accepted', 'paid'] as const;
export type FeeState = (typeof FEE_STATES)[number];

/**
 * What the consignment itself keeps of the fee: which quotation it is, and when it was FIRST quoted — the agent's
 * record counts how long an appointed agent took to name a price, and a re-quote must not move that.
 *
 * Declared before `ImportConsignment`, which carries one: the swagger plugin evaluates the class when the referring
 * class is defined.
 */
export class ImportFeeStamp {
  @ApiProperty() quoteId: string;
  @ApiProperty() quotedAt: string;
  /**
   * Whose fee it is (2026-10-28, the export's rule: "import and export rules similar makes sense"): one quotation per
   * APPOINTMENT. A replacement agent quotes its own from nothing, and the former one's stays on `formerFees`.
   */
  @ApiPropertyOptional() agentEntityId?: string;
}

/** The fee an ended appointment quoted: its quotation stays between the two of them. */
export class ImportFormerFee {
  @ApiProperty() agentEntityId: string;
  @ApiProperty() quoteId: string;
  @ApiProperty() endedAt: string;
}

/**
 * The container itself. It exists BEFORE it arrives, which is the entire point of the slice: the journey
 * starts when the container is onboarded and the shipping documents are created, because from that moment
 * arrival is certain and the papers can be assembled while the ship is still moving. Two weeks of hassle at
 * the far end was two weeks nobody used.
 */
export class ImportConsignment {
  /** The railway's note, where the box came inland by rail — held, never issued by us (rail-note.ts). */
  @ApiPropertyOptional({ type: HeldRailNote }) rail?: HeldRailNote;
  /** The notes it replaced, each kept as it was. */
  @ApiPropertyOptional({ type: [HeldRailNote] }) formerRail?: HeldRailNote[];
  @ApiProperty() importId: string;
  /** IMP-001. Also the `relatesTo` every paper belonging to THIS container is filed under. */
  @ApiProperty() code: string;
  @ApiProperty({ enum: IMPORT_STATUSES }) status: ImportStatus;
  /** The company that owns the goods. */
  @ApiProperty() importerEntityId: string;
  @ApiProperty() goodsDescription: string;
  /** The carrier's own container number, as printed on the box — MSCU1234567. Free text: we do not validate
   *  a format we are not the registrar of. */
  @ApiPropertyOptional() containerNo?: string;
  @ApiProperty() originCountry: string;
  @ApiProperty() destCountry: string;
  /** Where it is cleared — "Djibouti", "Mombasa", or an airport. A label, not a modelled place. */
  /** WHERE IT CLEARS. The papers a border asks for are that border's, and this is which border. */
  @ApiProperty() destPort: string;
  /**
   * WHERE THE VESSEL PUT IT DOWN, when that is somewhere else — a landlocked import discharged at a
   * coastal port and cleared inland. Absent means the two are the same place.
   */
  @ApiPropertyOptional() dischargePort?: string;
  /** How the goods arrived. Absent on anything recorded before the field existed — see modeOf(). */
  @ApiPropertyOptional({ enum: CONSIGNMENT_MODES }) mode?: ConsignmentMode;

  /* ---- what kind of box, and what is in it. See container-type.ts for what each buys ---- */

  /**
   * The ISO 6346 size/type code as printed on the box — 45G1, 22U1, 22T1.
   *
   * SELECTED from a catalogue, never invented, so the height, the roof, the bodies that can carry it and
   * the equipment that lifts it are all DERIVED rather than typed by whoever filled the form.
   */
  @ApiPropertyOptional() containerType?: string;
  /**
   * WHAT THE GOODS ARE, in the vocabulary the freight side already uses. The importer's choice.
   *
   * The distance between a food tank and a fuel tank, and nothing about the container says it. Absent
   * means nobody has said, which is why the road leg refuses to carry certain combinations blind.
   */
  @ApiPropertyOptional() natureCode?: string;
  /**
   * How tall the CARGO stands, in metres, where the box has no roof.
   *
   * Only meaningful for an open top or a flat rack, and it is the difference between the height of the
   * floor the cargo sits on and the height of the movement. Absent on an open box leaves the road height
   * unknown rather than guessed at the box's own figure — see standsOn().
   */
  @ApiPropertyOptional() cargoHeightM?: number;
  /** A tank's last cargoes and its cleaning certificate. The only thing that makes one food-grade. */
  @ApiPropertyOptional({ type: TankDeclaration }) tank?: TankDeclaration;
  /** The importer's dangerous-goods declaration. Never derived from the goods description. */
  @ApiPropertyOptional({ type: DangerousGoodsDeclaration }) dangerous?: DangerousGoodsDeclaration;

  /* ---- the seam, deliberately NOT WIRED (see the note on the service) ---- */

  /** The carrier's booking or bill-of-lading reference, if the importer typed one. Nothing reads it yet. */
  @ApiPropertyOptional() carrierRef?: string;
  /** Expected arrival, when somebody knows it. NOTHING FILLS THIS AUTOMATICALLY — see the service comment. */
  @ApiPropertyOptional() etaAt?: string;
  /** How the arrival information got here. `manual` is the only value anything writes today. */
  @ApiPropertyOptional({ enum: ['manual', 'carrier_webhook'] }) etaSource?: 'manual' | 'carrier_webhook';

  @ApiPropertyOptional() agentEntityId?: string;
  @ApiPropertyOptional() appointedAt?: string;
  @ApiPropertyOptional() appointedBy?: string;
  @ApiProperty({ type: [RequiredPaper] }) required: RequiredPaper[];

  /* ---- CL2b: paying the agent, and the road leg minted from the port ---- */

  /** The agent's quotation for clearing this container, once they have named a price. */
  @ApiPropertyOptional({ type: ImportFeeStamp }) fee?: ImportFeeStamp;
  @ApiPropertyOptional({ type: [ImportFormerFee] }) formerFees?: ImportFormerFee[];
  /** The road leg, once a person has minted it. Stored as id AND code: the id is what the freight
   *  machinery answers to, the code is what a human reads on a screen beside this container. */
  @ApiPropertyOptional() roadFreightId?: string;
  @ApiPropertyOptional() roadFreightCode?: string;
  @ApiPropertyOptional() roadMintedAt?: string;
  @ApiPropertyOptional() roadMintedBy?: string;

  /**
   * BL1 — THE BONDED LEG: the quay to the counter, run before any customs entry is made.
   *
   * Only a split chain has one. Where a box is discharged and cleared in the same place there is nothing
   * to move under bond, and the single leg above is the delivery.
   */
  @ApiPropertyOptional() bondedFreightId?: string;
  @ApiPropertyOptional() bondedFreightCode?: string;
  @ApiPropertyOptional() bondedMintedAt?: string;
  @ApiPropertyOptional() bondedMintedBy?: string;

  /**
   * BL1 — WHEN CUSTOMS LET IT GO, recorded by the agent who cleared it.
   *
   * NOT derived from the papers being accepted. An agent accepting a bill of lading is our record of our
   * own process; a release is a state's decision about the goods, and the two can be days apart. The
   * delivery leg of a split chain waits on this, because a truck sent to a counter that has not released
   * the box is a truck sent to wait.
   */
  @ApiPropertyOptional() releasedAt?: string;
  @ApiPropertyOptional() releasedBy?: string;

  /** CL4 — what the state did to this container. Absent on every consignment recorded before the slice. */
  @ApiPropertyOptional({ type: [CustomsHold] }) customsHolds?: CustomsHold[];

  @ApiProperty() createdAt: string;
  @ApiProperty() createdBy: string;
}

/**
 * WHAT WAS ACTUALLY ASKED FOR AT A BORDER, dated and attributed.
 *
 * §7's provenance model, arriving earlier than planned because this slice demands it. This is FIRST-HAND by
 * construction: it is recorded only when an agent who is clearing a real container publishes what they will
 * need for it. Nobody types it as a claim about the world, and there is no route that accepts one — which is
 * how the rumour case is refused at intake rather than stored at low confidence.
 *
 * It is never presented as what a border requires. It is presented as what agents have been asked for there,
 * with the date and how many asked — because a permit that stopped being needed in March should show as
 * nobody having asked since March, not as a rule we are still asserting.
 */
export class BorderPaperObservation {
  @ApiProperty() observationId: string;
  @ApiProperty() country: string;
  @ApiProperty() port: string;
  @ApiProperty() key: string;
  @ApiProperty() label: string;
  /** The agent who asked for it — a company that was clearing a real container at the time. */
  @ApiProperty() byEntityId: string;
  @ApiProperty() at: string;
  /** Which container it was asked for. Ties the observation to a real event, so it can be checked. */
  @ApiProperty() importId: string;
}

/** What a reader sees of one paper on the list, with the document resolved. */
export class RequiredPaperView extends RequiredPaper {
  /** The attached document, as much of it as this reader may see. Absent until the importer supplies one. */
  @ApiPropertyOptional() document?: CompanyDocument;
  /** The importer replaced the attached paper with a newer version. We do NOT follow it silently — see the
   *  service — so the agent is told the version they accepted is no longer the current one. */
  @ApiProperty() stale: boolean;
  /** The attached document's expiry has passed. Said before it is relied on, never discovered at the counter. */
  @ApiProperty() expired: boolean;
  /** `waiting` nobody has supplied it · `supplied` waiting on the agent · `accepted` · `rejected`. */
  @ApiProperty({ enum: ['waiting', 'supplied', 'accepted', 'rejected'] }) state: 'waiting' | 'supplied' | 'accepted' | 'rejected';
}

/** One consignment as a list reads it. */
export class ImportRow {
  @ApiProperty() importId: string;
  @ApiProperty() code: string;
  @ApiProperty({ enum: IMPORT_STATUSES }) status: ImportStatus;
  @ApiProperty() goodsDescription: string;
  @ApiPropertyOptional() containerNo?: string;
  @ApiProperty() originCountry: string;
  @ApiProperty() destCountry: string;
  /** WHERE IT CLEARS. The papers a border asks for are that border's, and this is which border. */
  @ApiProperty() destPort: string;
  /**
   * WHERE THE VESSEL PUT IT DOWN, when that is somewhere else — a landlocked import discharged at a
   * coastal port and cleared inland. Absent means the two are the same place.
   */
  @ApiPropertyOptional() dischargePort?: string;
  @ApiPropertyOptional() etaAt?: string;
  @ApiProperty() importerEntityId: string;
  @ApiPropertyOptional() importerName?: string;
  @ApiPropertyOptional() agentEntityId?: string;
  @ApiPropertyOptional() agentName?: string;
  /** The agent's PUBLIC address — `seebuyget.com/@handle`. An entity id is not somewhere you can go. */
  @ApiPropertyOptional() agentHandle?: string;
  /** Which side of this the reader is on. An operator reading over the network's shoulder is `onlooker`. */
  @ApiProperty({ enum: ['importer', 'agent', 'onlooker'] }) youAre: 'importer' | 'agent' | 'onlooker';
  /** Derived every read, never stored: how many of the agent's list are accepted, out of how many. */
  @ApiProperty() accepted: number;
  @ApiProperty() asked: number;
  /** Lines waiting on THIS reader to act. What the console counts on the group badge. */
  @ApiProperty() waitingOnYou: number;
  /** CL2b — how far the agent's fee has got. Derived on every read. */
  @ApiProperty({ enum: FEE_STATES }) feeState: FeeState;
  /** CL2b — the road leg minted from the port, when one has been. */
  @ApiPropertyOptional() roadFreightCode?: string;
  @ApiProperty() createdAt: string;
}

/** One consignment in full, for whoever is allowed to read it. */
export class ImportDetail extends ImportRow {
  @ApiProperty({ type: [RequiredPaperView] }) required: RequiredPaperView[];
  /** The importer's papers this reader may see: their own, or whatever the grants reach. */
  @ApiProperty() documents: CompanyDocument[];
  /** Every grant over these papers, live and revoked, so both sides see what was shared and when. */
  @ApiProperty({ type: [DocumentGrant] }) grants: DocumentGrant[];
  /** Fees quoted under appointments that ended — the importer's to read, each quotation kept between it and that agent. */
  @ApiPropertyOptional({ type: [ImportFormerFee] }) formerFees?: ImportFormerFee[];
  /** CL2b — the agent's quotation: the figure, the proforma, and open or paid as the parties confirm it. */
  @ApiPropertyOptional({ type: Quote }) fee?: Quote;
  @ApiPropertyOptional() roadFreightId?: string;
  /** BL1 — the bonded run from the quay, where the chain is split. */
  @ApiPropertyOptional() bondedFreightId?: string;
  @ApiPropertyOptional() bondedFreightCode?: string;
  /** BL1 — when customs released it. Until then a split chain cannot mint its delivery leg. */
  @ApiPropertyOptional() releasedAt?: string;
  @ApiPropertyOptional() releasedBy?: string;
  /** CL4 — what the state did, with both parties' accounts. Shown to both, and to an operator. */
  @ApiProperty({ type: [CustomsHold] }) customsHolds: CustomsHold[];
  /**
   * WHAT IS STILL MISSING BEFORE THIS CAN GO ON A TRUCK, in sentences. Derived on every read.
   *
   * A food tank whose last cargo nobody has stated; hazardous goods with no UN number; an open box with
   * no cargo height. Each is a fact no code, description or weight can supply, and each makes the road
   * leg refuse — so it is said on the screen from the moment the container is recorded, rather than
   * discovered by whoever finally tries to mint one.
   */
  @ApiProperty({ type: [String] }) cargoGaps: string[];
  /** The container type's own facts, resolved from the catalogue so no screen re-derives them. */
  @ApiPropertyOptional({ type: ContainerFacts }) containerFacts?: ContainerFacts;
  /**
   * THE BOX ITSELF, and the clock running on it — Y0 and Y1.
   *
   * Absent until a container number has been recorded, because the box IS its number: there is nothing to
   * derive an entity from until somebody names one. Present for both parties, deliberately — the agent
   * who booked it owes the return and the importer pays for it being late, so hiding the countdown from
   * either of them would be choosing which one gets surprised.
   */
  @ApiPropertyOptional({ type: ContainerBoxView }) box?: ContainerBoxView;
  /** The railway's note with its check, and what it says of the box against ours. */
  @ApiPropertyOptional({ type: RailNoteView }) rail?: RailNoteView;
}

/* ------------------------- CL6: what a clearing agent says they clear, in their own words -- */

/**
 * WHAT AN AGENT CLEARS — and this list is THEIRS TO SAY, not ours to derive.
 *
 * The correction that produced it, from the user: *"Agents do not just clear containers... Some clear air
 * freight, some vehicles, as their specialisation."* The first version of the agent page said "clears
 * containers", which was our model talking rather than the trade: a container is the only consignment this
 * system happens to record, and writing that into a sentence about somebody's business made our
 * limitation look like their job description.
 *
 * SO THIS IS THE ONE PLACE IN THE AGENT DESIGN THAT IS ASSERTED RATHER THAN DERIVED, and the split is
 * deliberate rather than a lapse:
 *
 *   - IDENTITY and RECORD are derived and never claimed. A handle falls out of the verified name; being an
 *     agent falls out of having been appointed; every figure falls out of timestamps. That is what stops
 *     squatting and stops a record that can only flatter.
 *   - WHAT SOMEBODY OFFERS cannot be derived at all. Nobody but the agent knows they clear livestock at
 *     Mombasa, and a network that waited to observe it would list every agent as doing nothing until they
 *     had already been hired for it — which is the same chicken-and-egg the whole directory exists to end.
 *
 * The precedent is already in this codebase and it is exactly this shape: the agent PUBLISHES the papers a
 * border will need and we never assert them; a minter's body pick is ADVISORY; a shipper's excluded bodies
 * are "a stated preference, not a physical constraint, and the board presents it as one". A claim is
 * carried, attributed, dated — and never dressed up as something we checked.
 *
 * A FIXED VOCABULARY, because a finder cannot honestly match free text, plus `words` for what a
 * vocabulary cannot hold. The list is drawn from what actually CHANGES the clearance job — a vehicle, a
 * live animal and a drum of solvent are three different jobs at the same counter — and never from
 * commodity categories, which would multiply forever without telling a shipper anything.
 */
export const CLEARANCE_SPECIALISMS = [
  'sea_container',
  'air_freight',
  'vehicles',
  'bulk_breakbulk',
  'project_heavy_lift',
  'perishables',
  'livestock',
  'pharma_cold_chain',
  'dangerous_goods',
  'personal_effects',
  'courier_express',
  'bonded_transit',
] as const;
export type ClearanceSpecialism = (typeof CLEARANCE_SPECIALISMS)[number];

/**
 * An agent's own advertisement: what they clear, where, and anything a list cannot say.
 *
 * Every field is the agent's claim about themselves. `saidAt` is on the record because a claim made two
 * years ago and never revisited is weaker than one made last week, and a reader is entitled to tell the
 * difference. Nothing here is verified, and no screen may present it as if it were.
 */
export class ClearanceOffer {
  @ApiProperty({ enum: CLEARANCE_SPECIALISMS, isArray: true }) specialisms: ClearanceSpecialism[];
  /** Ports, airports and border posts they work — labels, exactly as `destPort` is. We run no ports. */
  @ApiProperty({ type: [String] }) places: string[];
  /** What the vocabulary cannot hold. Their own words, shown as theirs. */
  @ApiPropertyOptional() words?: string;
  @ApiProperty() saidAt: string;
  @ApiProperty() saidBy: string;
}

/* ---------------------- CL4 item 1: the clearing agent's record, as it crosses the wire -- */

/*
 * The classes below mirror `agent-record.ts`, which is pure and carries no decorators so that a figure
 * somebody's livelihood is judged on stays reproducible from the containers it came from. Declared here,
 * ONCE, and imported by the public profile page as well — the agent's own copy and the shipper's view are
 * the same object by construction, because a record handed down is a verdict and one both parties hold is
 * an account. Every one of them is declared ABOVE its user: the swagger plugin evaluates an
 * `@ApiProperty` class reference when the referring class is defined.
 */

/** How often each kind of hold happened. A named class because an array of anonymous objects kills the emit. */
export class ClearanceHoldKind {
  @ApiProperty() key: string;
  @ApiProperty() times: number;
}

/** WHAT THE STATE DID — counted apart, and never netted off anything the agent controls. */
export class ClearanceHolds {
  @ApiProperty() containers: number;
  @ApiProperty() recorded: number;
  /** Of those, how many the other party to that container disputes. Shown with the count, always. */
  @ApiProperty() disputed: number;
  @ApiProperty({ type: [ClearanceHoldKind] }) kinds: ClearanceHoldKind[];
}

/** One port, or one mode — §6's per-lane rule, where the lane is a border. */
export class ClearancePortSlice {
  @ApiProperty() key: string;
  @ApiProperty() appointed: number;
  @ApiProperty() listed: number;
  @ApiProperty() cleared: number;
}

/**
 * WHAT AN AGENT DID WITH THE WORK IN FRONT OF THEM — and nothing about what happened at the counter.
 *
 * Scoring an agent on elapsed time at a border systematically advertises whoever pays bribes, and absence
 * of a seizure is not evidence of compliance. So there is no border-time figure here and there must not
 * be one; `holds` is the state's own share, recorded and labelled, never blended in.
 */
export class ClearanceRecord {
  @ApiProperty() appointed: number;
  @ApiProperty() listed: number;
  @ApiProperty() quoted: number;
  @ApiProperty() cleared: number;
  @ApiProperty() inFlight: number;
  /** Containers where the list GREW after the importer had begun supplying — the two-week story, counted. */
  @ApiProperty() listedLate: number;
  @ApiProperty() latePapers: number;
  @ApiPropertyOptional() listHours?: number | null;
  @ApiPropertyOptional() checkHours?: number | null;
  @ApiPropertyOptional() quoteHours?: number | null;
  @ApiProperty() thin: boolean;
  @ApiProperty() ratesNeed: number;
  @ApiProperty({ type: [ClearancePortSlice] }) ports: ClearancePortSlice[];
  /**
   * WHAT THEY HAVE ACTUALLY BEEN SEEN CLEARING, by mode — beside what they SAY they clear.
   *
   * The two are shown together on purpose and they are allowed to disagree: an agent may advertise air
   * freight and have no air consignment on our record, which is information rather than a contradiction.
   * See `recordSays` for the sentence that has to travel with an empty one.
   */
  @ApiProperty({ type: [ClearancePortSlice] }) modes: ClearancePortSlice[];
  @ApiProperty({ type: ClearanceHolds }) holds: ClearanceHolds;
}

/**
 * ONE AGENT, AS THE FINDER LISTS THEM — what they say, and what we have seen, side by side.
 *
 * §6a refused a ranked directory and that still holds: this is a list of PAGES, ordered by nothing that
 * could be read as a judgement. What it adds to a name is the pair — their claim next to their record —
 * because a claim with nothing behind it and a claim with forty containers behind it look identical on a
 * name alone, and the shipper is the one who should weigh the difference.
 */
export class AgentCard {
  @ApiProperty() entityId: string;
  /** Their public page. The whole point of a result: somewhere to go and read the rest. */
  @ApiPropertyOptional() handle?: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() country?: string;
  /** What they say they clear, in their own words. Never verified — see ClearanceOffer. */
  @ApiPropertyOptional({ type: ClearanceOffer }) offer?: ClearanceOffer;
  /** What we have actually seen: appointments and cleared consignments. NEVER a score or a rank. */
  @ApiProperty() appointed: number;
  @ApiProperty() cleared: number;
  /** True when the record is too thin to state a usual time. Said, because a newcomer is not a bad agent. */
  @ApiProperty() thin: boolean;
  /**
   * HOW TO REACH THEM — their own entry, published by them and never verified by us.
   *
   * The finder's whole purpose is that the next step is a telephone call, and it first shipped without a
   * telephone number. The same card the yard finder and the public page show: one per company.
   */
  @ApiPropertyOptional({ type: ContactCardView }) contact?: ContactCardView;
}

/**
 * WHAT THE FINDER ANSWERS, and what the answer is NOT.
 *
 * `basis` is not decoration, in the manner of the road board's `basis`: a list of people is read as a
 * ranking unless it says otherwise, and this one is alphabetical precisely so that advertising more
 * cannot move anybody up it.
 */
export class AgentFinderResponse {
  @ApiProperty({ type: [AgentCard] }) items: AgentCard[];
  @ApiProperty() total: number;
  @ApiProperty() basis: string;
}

/** The record, and the sentence that has to travel with it. */
export class ClearanceRecordResponse {
  @ApiProperty({ type: ClearanceRecord }) record: ClearanceRecord;
  /** What was measured and what was not. In the payload so no screen can render the figures without it. */
  @ApiProperty() measured: string;
  /** Their own public page, so "the same thing a shipper reads" is a claim they can go and check. */
  @ApiPropertyOptional() handle?: string;
  /**
   * THEIR OWN ADVERTISEMENT, returned with their record so the two are one read.
   *
   * The screen that edits a claim and the screen that shows the record are the same screen, and a form
   * loaded from a different source than the page a shipper reads is a form that can silently disagree
   * with it.
   */
  @ApiPropertyOptional({ type: ClearanceOffer }) offer?: ClearanceOffer;
}

/** What agents have been asked for at one port, most asked first. Never stated as a requirement. */
export class KnownPaper {
  @ApiProperty() key: string;
  @ApiProperty() label: string;
  /** How many DISTINCT agents have asked for it here. A count of companies, not of containers. */
  @ApiProperty() agents: number;
  /** How many containers it was asked for. */
  @ApiProperty() times: number;
  @ApiProperty() lastAskedAt: string;
  @ApiProperty() firstAskedAt: string;
}
