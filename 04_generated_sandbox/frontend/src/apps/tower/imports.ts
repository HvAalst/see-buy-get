import type { MessageKey } from '../../shared/i18n';
import type { CompanyDocument } from './company';

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
  code: string;
  status: ImportStatus;
  goodsDescription: string;
  containerNo?: string;
  originCountry: string;
  destCountry: string;
  destPort: string;
  etaAt?: string;
  importerEntityId: string;
  importerName?: string;
  agentEntityId?: string;
  agentName?: string;
  youAre: 'importer' | 'agent' | 'onlooker';
  accepted: number;
  asked: number;
  waitingOnYou: number;
  createdAt: string;
}

export interface ImportDetailView extends ImportRow {
  required: RequiredPaperView[];
  documents: CompanyDocument[];
  grants: DocumentGrant[];
}

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
  destPort: string;
  containerNo: string;
  carrierRef: string;
  etaAt: string;
}

export const EMPTY_IMPORT_FORM: RegisterImportForm = {
  goodsDescription: '',
  originCountry: '',
  destCountry: '',
  destPort: '',
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
  if (!form.destPort.trim()) return 'tower.imports.need.port';
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
