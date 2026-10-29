import type { MessageKey } from '../../shared/i18n';
import { DOCUMENT_KINDS, type CompanyDocument, type DocumentKind } from './company';
import { currencyReady, type QuoteView } from '../../shared/quote';

/**
 * CL2a — A CONTAINER, ITS PAPERS, AND THE AGENT APPOINTED TO CLEAR IT, as the console reads it.
 *
 * The server owns every rule; this file shapes what the screen shows and refuses what the screen can refuse
 * before the server has to. The one piece of real thinking here is `knownNotAsked` — see its comment. It is
 * the difference between the user's two imports, expressed as a function.
 */

export type ImportStatus = 'open' | 'appointed';
export type PaperState = 'waiting' | 'supplied' | 'accepted' | 'rejected';

export interface DocumentGrant {
  grantId: string;
  scope: 'company' | 'consignment';
  ownerEntityId: string;
  readerEntityId: string;
  /** The name a person knows them by, and where to go and read who they are. Absent when we hold none. */
  readerName?: string;
  readerHandle?: string;
  /** How many papers this grant opens TODAY. Derived on every read, because it moves as papers arrive. */
  reaches?: number;
  importId?: string;
  grantedBy: string;
  grantedAt: string;
  revokedBy?: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface RequiredPaperView {
  key: string;
  label: string;
  copies?: number;
  note?: string;
  addedBy: string;
  addedAt: string;
  documentId?: string;
  suppliedAt?: string;
  suppliedBy?: string;
  acceptedAt?: string;
  acceptedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  document?: CompanyDocument;
  stale: boolean;
  expired: boolean;
  state: PaperState;
}

export interface ImportRow {
  importId: string;
  /** The journey's legs in order (2026-10-29): how it came, the train inland where it goes by rail, our road leg. */
  modes?: Array<'road' | 'rail' | 'sea' | 'air'>;
  code: string;
  status: ImportStatus;
  goodsDescription: string;
  containerNo?: string;
  originCountry: string;
  destCountry: string;
  destPort: string;
  /** Where the vessel put it down, when that is somewhere else. Absent means it clears where it lands. */
  dischargePort?: string;
  etaAt?: string;
  importerEntityId: string;
  importerName?: string;
  agentEntityId?: string;
  agentName?: string;
  youAre: 'importer' | 'agent' | 'onlooker';
  accepted: number;
  asked: number;
  waitingOnYou: number;
  /** CL2b — how far the agent's fee has got. Derived by the server on every read. */
  feeState: FeeState;
  /** CL2b — the road leg on the freight board, once somebody has minted it. */
  roadFreightCode?: string;
  createdAt: string;
}

export interface ImportDetailView extends ImportRow {
  required: RequiredPaperView[];
  documents: CompanyDocument[];
  grants: DocumentGrant[];
  /** CL2b — the agent's fee as a QUOTATION: the figure, the proforma, open or paid as a party confirms it. */
  fee?: QuoteView;
  /** Fees quoted under appointments that ended — the importer's to read; one quotation per appointment (2026-10-28). */
  formerFees?: Array<{ agentEntityId: string; quoteId: string; endedAt: string }>;
  roadFreightId?: string;
  /** BL1 — the bonded run from the quay, on a split chain. Absent where the box clears where it lands. */
  bondedFreightId?: string;
  bondedFreightCode?: string;
  /** BL1 — when customs let it go. The delivery leg of a split chain waits on this. */
  releasedAt?: string;
  releasedBy?: string;
  /** CL4 — what the state did to this container, with both parties' accounts. Shown to both of them. */
  customsHolds: CustomsHoldView[];
  /**
   * CL7 — what is still missing before this can go on a truck, in sentences. Derived by the server.
   *
   * A food tank whose last cargo nobody has stated; hazardous goods with no UN number; an open box with
   * no cargo height. Shown from the moment the container is recorded, because the alternative is
   * discovering it at the moment somebody tries to mint a leg.
   */
  cargoGaps: string[];
  /**
   * The box's own facts, resolved by the SERVER from the ISO 6346 tables.
   *
   * Sent rather than worked out here, and that matters more now than when it was a shortlist: the tables
   * build thousands of valid codes, and a second copy of them on a screen would drift silently.
   */
  containerFacts?: {
    code: string;
    label: string;
    lengthM: number;
    lengthFt?: number;
    /** Absent where the CODE states only "taller than" a bound — see heightUnstated. */
    heightM?: number;
    widthM?: number;
    palletWide: boolean;
    group: string;
    kind: string;
    openTop: boolean;
    needsPower: boolean;
    bodies: string[];
    equipment: string[];
    outOfGauge: boolean;
    /** The standard itself declines to say. Ask for a measurement rather than showing a blank. */
    heightUnstated: boolean;
  };
  /**
   * Y0 + Y1 — THE BOX ITSELF, and the clock running on it.
   *
   * A container is a shipping line's property on loan, and the leg minted out of the terminal gate starts
   * a clock. Absent until a container number is recorded, because the box IS its number. Both parties get
   * it: the agent who booked it owes the return, and the importer is the one the charge lands on.
   */
  box?: ContainerBoxView;
  /** The railway's note, where the box came inland by rail: held, with its check (2026-10-28). */
  rail?: import('./screens/RailNotePanel').RailNoteView;
  /** Inland by rail: the arrival, the gate on the road leg, the rail terminal's free days (2026-10-29). */
  byRail?: import('./screens/ImportByRail').ImportByRailView;
  /** The forwarder's FIATA bill the goods came under (2026-10-29). */
  fbl?: import('./screens/FblPanel').FblView;
  /** By air: the waybill, the release step by step, the gate on the road leg, the handler's free storage (2026-10-29). */
  air?: import('./screens/ImportByAir').ImportAirView;
  /** The goods' nature, as declared: it suggests the agencies that may have to release air cargo. */
  natureCode?: string;
}

export type BoxClockKind = 'demurrage' | 'detention' | 'stopped' | 'unknown';
export type BoxEnding = 'returned' | 'bought';
export type FreeDayKind = 'demurrage' | 'detention';

/**
 * Y3 — one account of the box's condition at a gate.
 *
 * `derived` means it was read off the leg rather than typed: the driver's securement photograph at pickup
 * and their delivery photograph at the depot, which the freight flow already demands of them. A reader is
 * told which kind they are looking at, because they are not the same kind of evidence.
 */
export interface InterchangeAccountView {
  by: string;
  byEntityId?: string;
  at: string;
  stance: 'sound' | 'damaged';
  note?: string;
  photoRefs: string[];
  derived?: boolean;
}

export interface InterchangeGateView {
  side: 'out' | 'in';
  gate: string;
  at?: string;
  accounts: InterchangeAccountView[];
  photoRefs: string[];
  /** FALSE means nobody said anything about this gate at all — shown as a fact, not as an empty list. */
  stated: boolean;
  disputed: boolean;
}

export interface FreeDaysClaimView {
  kind: FreeDayKind;
  days: number;
  by: string;
  byEntityId: string;
  at: string;
}

/**
 * What the clock says — DERIVED by the server on every read, and said in days rather than in money.
 *
 * The basis field is one sentence naming what is counted and whose numbers produced it, and the screen
 * shows it verbatim: a countdown with nobody's name on it gets read as ours, and the free days come from a
 * contract between the importer and the line that we have never seen.
 */
export interface BoxClockView {
  kind: BoxClockKind;
  since?: string;
  daysElapsed?: number;
  freeDays?: number;
  freeDaysBy?: string;
  freeDaysAt?: string;
  dueBackAt?: string;
  daysLeft?: number;
  overdue: boolean;
  demurrageDays?: number;
  basis: string;
}

export interface ContainerBoxView {
  containerNo: string;
  ownerCode?: string;
  category?: string;
  typeCode?: string;
  /** The CSC safety-approval plate date. Carried, with nothing stated about it. */
  cscPlateDate?: string;
  firstSeenAt: string;
  /** How many spells out of a terminal this box has had with us — history a per-container record loses. */
  timesUsed: number;
  importCode?: string;
  /** The agent who booked it, derived from the appointment. */
  owedByName?: string;
  arrivedAt?: string;
  /** DERIVED from the road leg's pickup: the leg we mint is what starts detention. */
  outGatedAt?: string;
  returnedAt?: string;
  ending?: BoxEnding;
  endedBy?: string;
  endedWhere?: string;
  /** Y2 — the leg taking it home, and where that leg is up to. Its DELIVERY is what records the return. */
  returnLegCode?: string;
  returnLegState?: 'posted' | 'moving' | 'arrived';
  returnDepot?: string;
  /** Nothing in it. Said out loud rather than inferred from a small weight. */
  returnEmpty?: boolean;
  /** Y3 — both gates, always, so the one nobody recorded shows as the one nobody recorded. */
  interchange: InterchangeGateView[];
  freeDays: FreeDaysClaimView[];
  clock: BoxClockView;
}

/** What the goods ARE — the importer's declaration, from the vocabulary the freight side already uses. */
export const CARGO_NATURES = ['GEN', 'FOD', 'FOP', 'HAZ-CHEM', 'HAZ-DUST', 'HAZ-BIO', 'HAZ-FLAM', 'FRG', 'ODR', 'HUM'] as const;
export type CargoNatureCode = (typeof CARGO_NATURES)[number];

/** The things the state does to a container. Not one of them is the agent's doing. */
export const CUSTOMS_HOLD_KINDS = ['inspection_selected', 'physical_exam', 'documents_queried', 'queue', 'other'] as const;
export type CustomsHoldKind = (typeof CUSTOMS_HOLD_KINDS)[number];

export interface CustomsHoldView {
  holdId: string;
  kind: CustomsHoldKind;
  at: string;
  releasedAt?: string;
  recordedBy: string;
  recordedAt: string;
  /** Every account given, oldest first. A dispute is ADDED here; nothing is ever replaced or removed. */
  accounts: Array<{ by: string; at: string; stance: 'happened' | 'disputed'; note?: string }>;
}

/**
 * CL6 — what a clearing agent can SAY they clear. A vocabulary, so a finder can match it honestly.
 *
 * Mirrors the backend list. Drawn from what actually CHANGES the clearance job — a vehicle, a live animal
 * and a drum of solvent are three different jobs at the same counter — never from commodity categories,
 * which would multiply forever without telling a shipper anything.
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

/** Does the other party say this happened differently? Shown wherever the hold is, never separately. */
export function holdDisputed(hold: CustomsHoldView): boolean {
  return hold.accounts.some((a) => a.stance === 'disputed');
}

/**
 * A CLEARING AGENT'S OWN RECORD, as the console reads it.
 *
 * The same shape the public page carries, deliberately: an agent's copy of their record and a shipper's
 * view of it are one object, so neither can drift from the other.
 */
export interface ClearanceRecordView {
  appointed: number;
  listed: number;
  quoted: number;
  cleared: number;
  inFlight: number;
  listedLate: number;
  latePapers: number;
  listHours?: number | null;
  checkHours?: number | null;
  quoteHours?: number | null;
  thin: boolean;
  ratesNeed: number;
  ports: Array<{ key: string; appointed: number; listed: number; cleared: number }>;
  /** What they have been SEEN clearing, by mode — beside what they say they clear. */
  modes: Array<{ key: string; appointed: number; listed: number; cleared: number }>;
  holds: { containers: number; recorded: number; disputed: number; kinds: Array<{ key: string; times: number }> };
}

export type FeeState = 'none' | 'quoted' | 'accepted' | 'paid';

/** `GET /imports/known-papers`. What agents have BEEN ASKED FOR here — never what is required. */
export interface KnownPaper {
  key: string;
  label: string;
  agents: number;
  times: number;
  lastAskedAt: string;
  firstAskedAt: string;
}

export interface RegisterImportForm {
  goodsDescription: string;
  originCountry: string;
  destCountry: string;
  /** Kept for staff typing a label through the API; a screen sends `clearanceSiteId`. */
  destPort: string;
  /**
   * WHERE IT CLEARS and WHERE IT WAS DISCHARGED — two saved places, because for a landlocked import
   * they are two places and the difference is two legs. The quay is optional and means, when absent,
   * that the box clears where it lands.
   */
  clearanceSiteId: string;
  dischargeSiteId: string;
  containerNo: string;
  carrierRef: string;
  etaAt: string;
}

export const EMPTY_IMPORT_FORM: RegisterImportForm = {
  goodsDescription: '',
  originCountry: '',
  destCountry: '',
  destPort: '',
  clearanceSiteId: '',
  dischargeSiteId: '',
  containerNo: '',
  carrierRef: '',
  etaAt: '',
};

/* ------------------------------------------------------------------- rules -- */

/** What stops a container being recorded — said before the call, in the same words the server would use. */
export function registerBlocker(form: RegisterImportForm): MessageKey | null {
  if (!form.goodsDescription.trim()) return 'tower.imports.need.goods';
  if (!/^[A-Za-z]{2}$/.test(form.originCountry.trim())) return 'tower.imports.need.origin';
  if (!/^[A-Za-z]{2}$/.test(form.destCountry.trim())) return 'tower.imports.need.dest';
  // A PLACE, chosen. The typed label survives for staff on the API; a screen answers with a site.
  if (!form.clearanceSiteId && !form.destPort.trim()) return 'tower.imports.need.port';
  if (form.etaAt.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(form.etaAt.trim())) return 'tower.imports.need.date';
  return null;
}

/** What stops the agent publishing their list. An empty list tells the importer nothing. */
export function publishBlocker(rows: Array<{ label: string }>): MessageKey | null {
  const labelled = rows.filter((r) => r.label.trim());
  if (!labelled.length) return 'tower.imports.need.label';
  const keys = labelled.map((r) => slugOf(r.label));
  if (new Set(keys).size !== keys.length) return 'tower.imports.need.unique';
  return null;
}

/**
 * The filing key the SERVER will derive from a label. Mirrored here for one reason only: so the screen can
 * spot a duplicate before sending it, and so `knownNotAsked` can compare an agent's list with what has been
 * asked for at this port. Kept in step with `slug()` in import.service.ts.
 */
export function slugOf(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/**
 * THE LEVER, AS A FUNCTION — what agents have been asked for at this port that is NOT on this agent's list.
 *
 * The user's first container sat at customs for two weeks because a pleasant, reliable agent did not know
 * that a bag of fertilizer needed the Ministry of Agriculture and a fax machine needed the telecoms
 * corporation. The second cleared in a morning because a different agent knew every paper beforehand. The
 * only thing standing between those two outcomes is this list.
 *
 * It is a PROMPT, never a requirement: the agent publishes, and we say what others have been asked for here.
 * A row that is already on their list disappears from it, because the useful question is only ever "is there
 * something you have not thought of?"
 */
export function knownNotAsked(known: KnownPaper[], required: Array<{ key?: string; label: string }>): KnownPaper[] {
  const mine = new Set(required.map((r) => r.key || slugOf(r.label)).filter(Boolean));
  return known.filter((k) => !mine.has(k.key));
}

/** How far along the papers are. Derived, never stored — the server counts it the same way. */
export function readinessOf(detail: Pick<ImportDetailView, 'accepted' | 'asked'>): { accepted: number; asked: number; done: boolean } {
  return { accepted: detail.accepted, asked: detail.asked, done: detail.asked > 0 && detail.accepted === detail.asked };
}

/** The papers still standing between this container and the counter, worst first. */
export function outstanding(detail: ImportDetailView): RequiredPaperView[] {
  const rank: Record<PaperState, number> = { rejected: 0, waiting: 1, supplied: 2, accepted: 3 };
  return detail.required.filter((r) => r.state !== 'accepted' || r.expired || r.stale).sort((a, b) => rank[a.state] - rank[b.state] || a.label.localeCompare(b.label));
}

/**
 * How loudly one line should be shown.
 *
 * An expired or replaced paper is `bad` even when it was accepted, because an accepted paper that cannot be
 * relied on at the counter is the exact failure this slice exists to prevent — and it must not look calm.
 */
export function paperTone(paper: RequiredPaperView): 'ok' | 'warn' | 'bad' | 'quiet' {
  if (paper.expired || paper.stale || paper.state === 'rejected') return 'bad';
  if (paper.state === 'accepted') return 'ok';
  return paper.state === 'supplied' ? 'warn' : 'quiet';
}

/** The live grants, which is what "who can see our papers right now" means. Revoked ones are history. */
export function liveGrants(grants: DocumentGrant[]): DocumentGrant[] {
  return grants.filter((g) => !g.revokedAt);
}

/**
 * The console badge. Null while nothing has been read, because a badge of 0 says "you are up to date", which
 * is a different claim from "we have not looked yet" — the one thing a queue count must never get wrong.
 */
export function outstandingCount(rows: ImportRow[] | null): number | null {
  return rows === null ? null : rows.reduce((n, r) => n + r.waitingOnYou, 0);
}

/** The papers of this company that are NOT tied to a container — what a standing grant reaches. */
export function companyPapers(documents: CompanyDocument[]): CompanyDocument[] {
  return documents.filter((d) => !d.relatesTo && d.status !== 'superseded');
}

/** The papers filed under this container — what a per-consignment grant reaches. */
export function consignmentPapers(documents: CompanyDocument[], code: string): CompanyDocument[] {
  return documents.filter((d) => d.relatesTo?.toUpperCase() === code.toUpperCase() && d.status !== 'superseded');
}

/* ------------------------------------------------- CL2b: the fee and the road leg -- */

export interface FeeQuoteForm {
  amount: string;
  /** Three letters; empty means the money of the country the goods clear in. */
  currency: string;
  /** The agent's own quotation or proforma number. */
  reference: string;
  note: string;
}
export const EMPTY_FEE_FORM: FeeQuoteForm = { amount: '', currency: '', reference: '', note: '' };

export interface RoadLegForm {
  /** Both ends are SAVED PLACES now — a port chosen from the list, and somewhere to deliver it. */
  pickupSiteId: string;
  destSiteId: string;
  weightKg: string;
}
export const EMPTY_ROAD_FORM: RoadLegForm = { pickupSiteId: '', destSiteId: '', weightKg: '' };

/** A fee is a figure somebody will be asked to pay, so it is a real number above zero or it is nothing. */
export function feeQuoteBlocker(form: FeeQuoteForm): MessageKey | null {
  if (!positive(form.amount)) return 'tower.imports.needAmount';
  if (form.currency.trim() && !currencyReady(form.currency)) return 'tower.imports.needCurrency';
  return null;
}

/**
 * A road leg needs somewhere to collect from, somewhere to go, and something to carry.
 *
 * Both ends are SAVED PLACES, so the question is "which one" rather than "what are its coordinates".
 * That is the whole of the change: a place is named once and chosen afterwards, and neither end can be
 * half-answered the way a latitude without a longitude could be.
 */
export function roadBlocker(form: RoadLegForm, byRail = false): MessageKey | null {
  // By rail, the box is collected where the train brings it: no port to choose (2026-10-29).
  if (!form.pickupSiteId && !byRail) return 'tower.imports.needPort';
  if (!form.destSiteId) return 'tower.imports.needDest';
  if (!positive(form.weightKg)) return 'tower.imports.needAmount';
  return null;
}

/** How loudly the fee reads. Only `paid` is settled; everything else is somebody's turn to act. */
export function feeTone(state: FeeState): 'ok' | 'warn' | 'quiet' {
  return state === 'paid' ? 'ok' : state === 'none' ? 'quiet' : 'warn';
}

/**
 * Does "which side are you on" tell one row from another, or is it the same word on all of them?
 *
 * A COLUMN WHOSE EVERY CELL AGREES IS NOT A COLUMN. A company administrator is the importer on every
 * container they can see, so tagging each row "yours" prints the same pill eighty-nine times and gives
 * the eye eighty-nine things to step over on its way to the one row that differs. Staff reading the
 * network's list, or a company that imports some containers and clears others, genuinely need it.
 *
 * Derived from what is ON THE SCREEN rather than from who is reading it, because the answer changes
 * page by page and the reader's role does not describe it.
 */
export function partiesDiffer(rows: { youAre: ImportRow['youAre'] }[]): boolean {
  return new Set(rows.map((r) => r.youAre)).size > 1;
}

/**
 * ONE AGENT AS THE PUBLIC DIRECTORY LISTS THEM — their claim beside their record.
 *
 * The pair is the point: a claim with nothing behind it and a claim with forty containers behind it look
 * identical on a name alone, and the importer is the one who should weigh the difference. There is no
 * score and no ordering here, because this network is the party they are appointed through.
 */
export interface AgentCardView {
  entityId: string;
  name: string;
  handle?: string;
  country?: string;
  offer?: { specialisms: string[]; places?: string[]; words?: string };
  appointed: number;
  cleared: number;
  /** The record is too thin to say anything with. A newcomer is not a bad agent, and the screen says so. */
  thin: boolean;
  contact?: { phone?: string };
}

/* -------------------------------------------- CL2a: the papers as FILES you can handle -- */

/**
 * What to call the file when somebody saves it.
 *
 * The title is what a person typed, so it can hold a slash, a colon or nothing at all, and the browser
 * will either refuse the download or silently drop it into a folder nobody meant. The extension comes
 * from the content type the SERVER recorded and never from the title, because a paper called
 * "invoice.pdf" that is actually a photograph is the interesting case, not the unlikely one.
 */
export function paperFileName(doc: { title: string; contentType: string; documentId: string }): string {
  const ext = EXTENSION[doc.contentType] ?? 'bin';
  const safe = doc.title
    .replace(/[^\p{L}\p{N} ._-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${safe || doc.documentId}.${ext}`;
}

const EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/** The three letters on the tile. No emoji anywhere in this product, and a word beats a picture here. */
export function paperKindShort(contentType: string): string {
  return (EXTENSION[contentType] ?? contentType.split('/').pop() ?? '?').slice(0, 4).toUpperCase();
}

/** A size somebody can judge. Bytes below a kilobyte, one decimal above it, none above a megabyte. */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * WHO CAN READ THIS PAPER — derived from the grants, never stored against the document.
 *
 * There is no per-document sharing in this design and there should not be: a grant is over a SCOPE (all
 * of a company's papers, or everything filed under one container), which is the unit an importer
 * actually decides about. So the answer for a single paper is worked out from which scope it is in, and
 * the screen can say it without anybody maintaining a second list that would drift.
 */
export function readersOf(doc: { relatesTo?: string }, code: string, grants: DocumentGrant[]): string[] {
  // The same sentence the server enforces in `visibleDocuments`, and it has to STAY the same sentence: a
  // screen that promises a wider audience than the server allows is a screen lying about who saw a paper.
  // A container's own paper needs a CONSIGNMENT grant naming that container; a company paper needs a
  // COMPANY grant. Neither scope reaches into the other.
  const need = doc.relatesTo ? 'consignment' : 'company';
  if (doc.relatesTo && doc.relatesTo.toUpperCase() !== code.toUpperCase()) return [];
  const readers = liveGrants(grants)
    .filter((g) => g.scope === need)
    .map((g) => g.readerEntityId);
  return [...new Set(readers)];
}

/**
 * THE KIND OF PAPER AN AGENT'S WORDS DESCRIBE, or `other` when we cannot tell.
 *
 * The register's kinds are ours; the required line's label is the AGENT's — free text they typed when
 * publishing their list. Offering somebody an upload form pre-titled "Investment licence" while the kind
 * beside it says "Commercial invoice" is worse than not helping at all, so the two are reconciled where
 * the words plainly agree and left at `other` where they do not.
 *
 * It matches the slug's own words, never a translated label, so this stays pure and stays true in every
 * locale. "Investment licence" carries "licence" and lands on `licence`, which is what it is. The longest
 * match wins, so "certificate of origin" cannot be captured by a shorter certificate.
 */
export function kindForLabel(label: string): DocumentKind {
  const said = label
    .toLowerCase()
    // Both spellings are the same paper, and an importer typing either means the same thing.
    .replace(/licens/g, 'licenc')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!said) return 'other';

  let best: DocumentKind = 'other';
  let longest = 0;
  for (const kind of DOCUMENT_KINDS) {
    if (kind === 'other') continue;
    const phrase = kind.replace(/_/g, ' ');
    // WHOLE WORDS, and a plural is the same paper: an agent writes "Import permits" as readily as
    // "Import permit", while "Licenced warehouse note" is not a licence and must not be read as one.
    if (!new RegExp(`(^| )${phrase}s?( |$)`).test(said)) continue;
    if (phrase.length > longest) {
      longest = phrase.length;
      best = kind;
    }
  }
  return best;
}

function numeric(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value));
}

function positive(value: string): boolean {
  return numeric(value) && Number(value) > 0;
}
