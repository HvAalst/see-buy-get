import type { MessageKey } from '../../shared/i18n';

/**
 * A COMPANY'S PAPER, REPORTED — as the console reads it (the user, 2026-10-09: "sbg should only interact at dispute…
 * a reporting system like BB, with screenshot"; "the paper keeps counting"; "two people decision to strike a paper").
 *
 * The server decides everything: who may report, that a report changes nothing, that the company is heard first,
 * that a strike takes two. This file only shapes what a screen shows, and says what a screen holds back before the
 * server has to — above all, that the member of staff who proposed a strike is not offered its approval.
 */

export const REPORT_CATEGORIES = ['expired', 'not_genuine', 'not_theirs', 'wrong_details', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ReportCategory, MessageKey> = {
  expired: 'tower.paperReport.cat.expired',
  not_genuine: 'tower.paperReport.cat.not_genuine',
  not_theirs: 'tower.paperReport.cat.not_theirs',
  wrong_details: 'tower.paperReport.cat.wrong_details',
  other: 'tower.paperReport.cat.other',
};

/** One question about one paper: everybody's reports on it, the company's answer, and what was decided. */
export interface PaperCase {
  caseId: string;
  entityId: string;
  company: string;
  documentId: string;
  paper: { title: string; kind: string; relatesTo?: string; status: string; uploadedBy: string; uploadedAt: string };
  /** What the paper was put on record WITH, where it came with a change. */
  claimed?: { was: string; now: string; by: string; at: string };
  openedAt: string;
  answerBy: string;
  /** From when a strike may be proposed: once the company has answered, or once its time has run out. */
  strikeFrom: string;
  state: 'open' | 'dismissed' | 'struck';
  /** `by`, `role` and `evidenceId` are there for staff only: the company is never told who reported it. */
  reports: Array<{ reportId: string; at: string; category: ReportCategory; note: string; by?: string; role?: string; evidenceId?: string }>;
  answer?: { at: string; by: string; note: string; evidenceId?: string };
  /** Staff only: a strike one of them proposed, waiting for a second. `byYou`: the reader proposed it. */
  proposal?: { by: string; at: string; reason: string; byYou?: boolean };
  decision?: { outcome: 'dismissed' | 'struck'; reason: string; at: string; effect?: string; by?: string };
}

export const CASE_LABEL: Record<PaperCase['state'], MessageKey> = {
  open: 'tower.paperReport.state.open',
  dismissed: 'tower.paperReport.state.dismissed',
  struck: 'tower.paperReport.state.struck',
};
export const CASE_TONE: Record<PaperCase['state'], 'info' | 'quiet' | 'warn'> = { open: 'info', dismissed: 'quiet', struck: 'warn' };

export const isWaiting = (c: Pick<PaperCase, 'state'>): boolean => c.state === 'open';

/** How many reports wait on staff. Null while unread: a blank count reads as zero, and zero is a different answer. */
export function casesWaiting(rows: PaperCase[] | null): number | null {
  return rows ? rows.filter(isWaiting).length : null;
}

/**
 * WHAT A MEMBER OF STAFF MAY DO ABOUT A STRIKE, now. (Dismissing is always theirs while it is open, and is not a step.)
 *   wait     the company has not answered and its time has not run out: a strike is not proposed yet
 *   propose  nobody has proposed one
 *   approve  a colleague proposed it: this reader may approve
 *   other    this reader proposed it: the approval is somebody else's, and they are told so rather than offered it
 *   closed   it has been decided
 */
export function strikeStep(c: Pick<PaperCase, 'state' | 'proposal' | 'strikeFrom'>, now: number): 'wait' | 'propose' | 'approve' | 'other' | 'closed' {
  if (c.state !== 'open') return 'closed';
  if (c.proposal) return c.proposal.byYou ? 'other' : 'approve';
  return now >= Date.parse(c.strikeFrom) ? 'propose' : 'wait';
}

/** The open question about one paper, if there is one — what that paper's row shows. */
export function openCaseOf(cases: PaperCase[] | undefined, documentId: string): PaperCase | undefined {
  return (cases ?? []).find((c) => c.documentId === documentId && c.state === 'open');
}

/** The last thing decided about one paper, if anything was. */
export function lastDecidedOf(cases: PaperCase[] | undefined, documentId: string): PaperCase | undefined {
  return (cases ?? []).filter((c) => c.documentId === documentId && c.state !== 'open').sort((a, b) => (b.decision?.at ?? '').localeCompare(a.decision?.at ?? ''))[0];
}

/** The papers a company keeps ABOUT ITSELF — the ones that can be reported. A consignment's papers have their own readers. */
const COMPANY_PAPER_KINDS = ['certificate_of_incorporation', 'memorandum_and_articles', 'tax_registration_certificate', 'bank_confirmation', 'licence', 'insurance_policy', 'representative_id', 'beneficial_ownership', 'obligation_registration'];

/**
 * MAY THIS PAPER BE REPORTED? It has to COUNT — verified before the company was switched on, or put on record by the
 * company since — on a record the company keeps itself. A draft's papers are verified by staff; a struck or replaced
 * one no longer says anything.
 */
export function mayReport(document: { status: string; kind: string }, keeper: 'staff' | 'company' | undefined): boolean {
  return keeper === 'company' && (document.status === 'declared' || document.status === 'verified') && COMPANY_PAPER_KINDS.includes(document.kind);
}

/** What stops a report from being sent — words, and what shows them. */
export function reportBlocker(form: { note: string; hasEvidence: boolean }): MessageKey | null {
  if (!form.note.trim()) return 'tower.paperReport.needNote';
  if (!form.hasEvidence) return 'tower.paperReport.needEvidence';
  return null;
}

/** The second line of a row in the queue: whose paper, how many said so, and where it stands. */
export function caseSub(c: PaperCase, t: (key: MessageKey, vars?: Record<string, string | number>) => string, when: (iso: string) => string): string {
  const said = t(c.reports.length === 1 ? 'tower.paperReport.sub.one' : 'tower.paperReport.sub.many', { company: c.company, n: c.reports.length });
  if (c.state !== 'open') return `${said} · ${t(c.state === 'struck' ? 'tower.paperReport.sub.struck' : 'tower.paperReport.sub.dismissed', { when: when(c.decision?.at ?? c.openedAt) })}`;
  if (c.proposal) return `${said} · ${t('tower.paperReport.sub.proposed', { who: c.proposal.by })}`;
  if (c.answer) return `${said} · ${t('tower.paperReport.sub.answered', { when: when(c.answer.at) })}`;
  return `${said} · ${t('tower.paperReport.sub.answerBy', { when: when(c.answerBy) })}`;
}
