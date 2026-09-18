import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CompanyDocument } from '../../foundation/entity/company-documents.service';

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
 * CL2b — WHAT THE AGENT CHARGES, and how far it has got.
 *
 * `none` nobody has quoted · `quoted` the agent named a price · `accepted` the importer agreed to it ·
 * `paid` money was actually received, against a reference, and the agent is owed it on a sister's books.
 *
 * Derived from the record every time it is read rather than stored beside it, for the same reason the
 * required list derives its own state: a second field saying "paid" is a field that can disagree with the
 * journal entry that moved the money.
 */
export const FEE_STATES = ['none', 'quoted', 'accepted', 'paid'] as const;
export type FeeState = (typeof FEE_STATES)[number];

/**
 * The agent's fee for clearing one container.
 *
 * **The network earns nothing from an appointment** (§10, and it is a condition of the agent record ever
 * reaching shippers). So there is no margin field here and nowhere for one to go: what is received is owed
 * onward in full. The posting is cash in and a liability to the agent — not one line of revenue — which is
 * "collected is not earned" applied to somebody else's fee rather than to our own carriage.
 *
 * DECLARED BEFORE `ImportConsignment`, which carries one. A type annotation alone would be erased, but the
 * swagger plugin emits a metadata factory that evaluates this class when the consignment class is defined —
 * so declaring it later is a temporal dead zone, and the contract emit dies rather than the typecheck.
 */
export class ImportFee {
  @ApiProperty() amount: number;
  /** The collecting sister's own currency. A sister can only invoice in its own money. */
  @ApiProperty() currency: string;
  @ApiProperty() quotedBy: string;
  @ApiProperty() quotedAt: string;
  @ApiPropertyOptional() note?: string;
  @ApiPropertyOptional() acceptedBy?: string;
  @ApiPropertyOptional() acceptedAt?: string;
  /** Which sister's books hold it — the one in the PAYER's jurisdiction, because collection follows the payer. */
  @ApiPropertyOptional() collectingEntityId?: string;
  @ApiPropertyOptional() paidAt?: string;
  @ApiPropertyOptional() recordedBy?: string;
  /** The rail's or the bank's own reference. Money is only ever created by an observed external event, and
   *  this is the thing you point at afterwards when somebody says they paid. */
  @ApiPropertyOptional() reference?: string;
  /** The journal entry that received it. Present only once money actually moved. */
  @ApiPropertyOptional() entryId?: string;
}

/**
 * CL2b — WHETHER WE CAN BE THE ONE WHO BILLS THIS, ANSWERED AT THE START.
 *
 * The rule from the design note, and the reason this is on the view rather than in an error: *where we only
 * match we cannot be the one who bills, and the screen must say so at the start rather than fail at the end.*
 * A person should never assemble a fee, agree it, and only then be told the money cannot run here.
 *
 * `canPayOut` is about the AGENT's country, not the importer's. The two are usually the same and do not have
 * to be — and where they are not, the honest outcome is not a refusal: the fee is received, the agent is owed
 * it on the books, and the payout run says by name that it cannot send it there yet.
 */
export class MoneyHere {
  @ApiProperty() canBill: boolean;
  @ApiProperty() canPayOut: boolean;
  /** Said plainly, before anybody starts. Absent when the money can run here normally. */
  @ApiPropertyOptional() why?: string;
  @ApiPropertyOptional() currency?: string;
  @ApiPropertyOptional() collectingEntityId?: string;
}

/**
 * The container itself. It exists BEFORE it arrives, which is the entire point of the slice: the journey
 * starts when the container is onboarded and the shipping documents are created, because from that moment
 * arrival is certain and the papers can be assembled while the ship is still moving. Two weeks of hassle at
 * the far end was two weeks nobody used.
 */
export class ImportConsignment {
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
  /** Where it is cleared — "Djibouti", "Mombasa". A label, not a modelled port: we do not run ports. */
  @ApiProperty() destPort: string;

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

  /** What the agent charges to clear this container, once they have quoted it. */
  @ApiPropertyOptional() fee?: ImportFee;
  /** The road leg, once a person has minted it. Stored as id AND code: the id is what the freight
   *  machinery answers to, the code is what a human reads on a screen beside this container. */
  @ApiPropertyOptional() roadFreightId?: string;
  @ApiPropertyOptional() roadFreightCode?: string;
  @ApiPropertyOptional() roadMintedAt?: string;
  @ApiPropertyOptional() roadMintedBy?: string;

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
  @ApiProperty() destPort: string;
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
  /** CL2b — the agent's fee, once quoted. */
  @ApiPropertyOptional() fee?: ImportFee;
  /** CL2b — whether the money can run here at all, said before anybody starts assembling it. */
  @ApiProperty() money: MoneyHere;
  @ApiPropertyOptional() roadFreightId?: string;
  /** CL4 — what the state did, with both parties' accounts. Shown to both, and to an operator. */
  @ApiProperty({ type: [CustomsHold] }) customsHolds: CustomsHold[];
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

/** One port — §6's per-lane rule, where the lane is a border. */
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
  @ApiProperty({ type: ClearanceHolds }) holds: ClearanceHolds;
}

/** The record, and the sentence that has to travel with it. */
export class ClearanceRecordResponse {
  @ApiProperty({ type: ClearanceRecord }) record: ClearanceRecord;
  /** What was measured and what was not. In the payload so no screen can render the figures without it. */
  @ApiProperty() measured: string;
  /** Their own public page, so "the same thing a shipper reads" is a claim they can go and check. */
  @ApiPropertyOptional() handle?: string;
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
