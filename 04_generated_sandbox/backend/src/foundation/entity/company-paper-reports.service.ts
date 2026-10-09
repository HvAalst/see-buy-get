import { Injectable, Optional } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { createHash, randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';
import { MailService } from '../mail/mail.service';
import { decodeDocument } from '../media/decode-document';
import { PersistentMap } from '../store/persistent-map';
import { COMPANY_PAPER_KINDS, CompanyDeclarationService, recordKeeper } from './company-declarations.service';
import { CompanyDocumentService } from './company-documents.service';
import { EntityAdminService } from './entity-admin.service';
import { EntityService } from './entity.service';

/**
 * SOMEBODY SAYS A COMPANY'S PAPER IS NOT RIGHT — the only time SeeBuyGet steps into a record a company keeps itself.
 *
 * The user, 2026-10-09: "sbg should only interact at dispute… we need rather a reporting system like BB, with
 * screenshot etc." and then, deciding: "logged in users that are connected, paper keeps counting, … two people decision
 * to strike a paper."
 *
 * A company that is switched on puts its own papers on record and they count at once (company-declarations). What
 * replaces a member of staff checking each one is this: anybody signed in who is connected to the company and can see
 * the paper may REPORT it — what is wrong, and what shows it (a screenshot, a photograph). Then:
 *
 *   · THE PAPER KEEPS COUNTING. A report never acts by itself: otherwise reporting a company would switch it off.
 *   · THE COMPANY IS TOLD what was said — never by whom — and has a fixed time to answer, with its own evidence.
 *   · ONE MEMBER OF STAFF MAY DISMISS IT, with a reason: that leaves everything as it is.
 *   · STRIKING THE PAPER TAKES TWO: one proposes with the reason, a second, different one approves. Not before the
 *     company has answered or its time has run out. The strike puts back what the paper changed.
 *   · Everything said and decided is kept, with the evidence, under the fingerprint it arrived with.
 *
 * Modelled on BondBridge's content reports (Bondbridge/ai/specs/public-content-moderation.md): the server resolves
 * what is reported from what the reporter could see; the reporter is not named to the reported party; a report raises
 * a question and removes nothing.
 */
export const REPORT_CATEGORIES = ['expired', 'not_genuine', 'not_theirs', 'wrong_details', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** What each category says, to the company it is said about. */
export const REPORT_CATEGORY_WORDS: Record<ReportCategory, string> = {
  expired: 'it has run out, or been withdrawn',
  not_genuine: 'it is not a genuine paper',
  not_theirs: 'it belongs to somebody else',
  wrong_details: 'what is on record is not what the paper says',
  other: 'something else is wrong with it',
};

/** How long a company has to answer before a strike can be decided without it. */
export const REPORT_ANSWER_DAYS = 7;
/** A screenshot or a photograph; a scan at most. */
export const MAX_EVIDENCE_BYTES = 6 * 1024 * 1024;

export type PaperCaseState = 'open' | 'dismissed' | 'struck';

interface PaperCase {
  caseId: string;
  entityId: string;
  documentId: string;
  openedAt: string;
  answerBy: string;
  state: PaperCaseState;
  reports: Array<{ reportId: string; at: string; category: ReportCategory; note: string; evidenceId: string; reporter: { key: string; name: string; role: string } }>;
  answer?: { at: string; by: string; note: string; evidenceId?: string };
  proposal?: { by: string; byKey: string; at: string; reason: string };
  decision?: { outcome: 'dismissed' | 'struck'; reason: string; by: string; at: string; effect?: string };
}

export class PaperReportView {
  @ApiProperty() reportId: string;
  @ApiProperty() at: string;
  @ApiProperty({ enum: REPORT_CATEGORIES }) category: ReportCategory;
  @ApiProperty() note: string;
  /** For staff only: who said it, and what they attached. The company is never told who. */
  @ApiPropertyOptional() by?: string;
  @ApiPropertyOptional() role?: string;
  @ApiPropertyOptional() evidenceId?: string;
}

export class PaperCaseView {
  @ApiProperty() caseId: string;
  @ApiProperty() entityId: string;
  @ApiProperty() company: string;
  @ApiProperty() documentId: string;
  /** The paper as it stands: its title, what it is for, and whether it still counts. */
  @ApiProperty() paper: { title: string; kind: string; relatesTo?: string; status: string; uploadedBy: string; uploadedAt: string };
  /** What the paper was put on record WITH, where it came with a change: what the item was, and what it was made. */
  @ApiPropertyOptional() claimed?: { was: string; now: string; by: string; at: string };
  @ApiProperty() openedAt: string;
  @ApiProperty() answerBy: string;
  /** From when a strike may be proposed: once the company has answered, or once its time has run out. */
  @ApiProperty() strikeFrom: string;
  @ApiProperty({ enum: ['open', 'dismissed', 'struck'] }) state: PaperCaseState;
  @ApiProperty({ type: [PaperReportView] }) reports: PaperReportView[];
  @ApiPropertyOptional() answer?: { at: string; by: string; note: string; evidenceId?: string };
  /** For staff only: a strike one of them has proposed, waiting for a second. `byYou`: the reader proposed it. */
  @ApiPropertyOptional() proposal?: { by: string; at: string; reason: string; byYou?: boolean };
  @ApiPropertyOptional() decision?: { outcome: 'dismissed' | 'struck'; reason: string; at: string; effect?: string; by?: string };
}

export interface Reporter {
  /** What tells one reporter from another: the key their sessions answer to. */
  key: string;
  name: string;
  role: string;
}

@Injectable()
export class CompanyPaperReportService {
  private readonly cases = new PersistentMap<string, PaperCase>('entity-paper-cases');
  /** What a reporter or the company attached, apart from the case, so listing cases never carries a file. */
  private readonly evidence = new PersistentMap<string, { caseId: string; contentType: string; fingerprint: string; base64: string }>('entity-paper-evidence');

  constructor(
    private readonly entities: EntityService,
    private readonly documents: CompanyDocumentService,
    private readonly declarations: CompanyDeclarationService,
    private readonly admins: EntityAdminService,
    // Optional so a hand-built module keeps compiling; without it everything is decided and nobody is emailed.
    @Optional() private readonly mail?: MailService,
  ) {}

  /* ------------------------------------------------------------------ reading -- */

  /** Every case, for staff: what waits first (the one whose time runs out soonest), then what was decided, newest first. */
  list(staffKey?: string): PaperCaseView[] {
    const all = [...this.cases.values()];
    const open = all.filter((c) => c.state === 'open').sort((a, b) => a.answerBy.localeCompare(b.answerBy));
    const done = all.filter((c) => c.state !== 'open').sort((a, b) => (b.decision?.at ?? '').localeCompare(a.decision?.at ?? ''));
    return [...open, ...done].map((c) => this.view(c, 'staff', staffKey));
  }

  /** One company's cases, as staff read them or as the company itself does — which is never told who reported. */
  forEntity(entityId: string, reader: 'staff' | 'company', staffKey?: string): PaperCaseView[] {
    return [...this.cases.values()]
      .filter((c) => c.entityId === entityId)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .map((c) => this.view(c, reader, staffKey));
  }

  one(caseId: string, staffKey?: string): PaperCaseView {
    return this.view(this.require(caseId), 'staff', staffKey);
  }

  /**
   * WHAT BECAME OF ONE REPORTER'S OWN REPORTS on a company's papers — the latest about each paper, named by what the
   * paper is FOR (a licence or policy number), because that is what the reporter was shown. Somebody who reported
   * must be able to read back that it is being looked at, or what was decided and why; never anybody else's report.
   */
  byReporter(entityId: string, reporterKey: string): Array<{ kind: string; relatesTo?: string; at: string; state: PaperCaseState; reason?: string }> {
    const latest = new Map<string, { kind: string; relatesTo?: string; at: string; state: PaperCaseState; reason?: string }>();
    const theirs = [...this.cases.values()].filter((c) => c.entityId === entityId).sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    for (const c of theirs) {
      const mine = c.reports.find((r) => r.reporter.key === reporterKey);
      if (!mine) continue;
      const document = this.documents.get(c.entityId, c.documentId);
      latest.set(`${document.kind}|${(document.relatesTo ?? '').toUpperCase()}`, { kind: document.kind, ...(document.relatesTo ? { relatesTo: document.relatesTo } : {}), at: mine.at, state: c.state, ...(c.decision ? { reason: c.decision.reason } : {}) });
    }
    return [...latest.values()];
  }

  /** How many wait on staff. */
  waiting(): number {
    return [...this.cases.values()].filter((c) => c.state === 'open').length;
  }

  /** What was attached, with whether it still matches the fingerprint it arrived under. For staff. */
  evidenceFile(caseId: string, evidenceId: string): { contentType: string; bytes: Buffer; fingerprint: string; intact: boolean } {
    const kept = this.evidence.get(evidenceId);
    if (!kept || kept.caseId !== caseId) throw new GlosError('NOT_FOUND', 'No such evidence for this report');
    const bytes = Buffer.from(kept.base64, 'base64');
    return { contentType: kept.contentType, bytes, fingerprint: kept.fingerprint, intact: createHash('sha256').update(bytes).digest('hex') === kept.fingerprint };
  }

  /** Which company a case is about — for a route that has to ask whether the caller reaches it. */
  entityOf(caseId: string): string {
    return this.require(caseId).entityId;
  }

  /* ------------------------------------------------------------------ the report -- */

  /**
   * REPORT A PAPER. The paper must be one that COUNTS on the record of a company that keeps its own; what is wrong is
   * said in words and shown with a file. Several people reporting one paper are one question, with each of their
   * reports in it; nobody reports the same paper twice while it is open. NOTHING CHANGES ON THE RECORD.
   */
  async report(input: { entityId: string; documentId: string; category: string; note?: string; evidenceDataUrl?: string; reporter: Reporter }, now: number = Date.now()): Promise<{ caseId: string; reportId: string; answerBy: string; told: number }> {
    const entity = this.entities.get(input.entityId);
    if (recordKeeper(entity) !== 'company') throw new GlosError('INVALID_STATE', `${entity.name} does not keep its own papers: they are verified by staff, not reported`);
    const document = this.documents.get(entity.entityId, input.documentId);
    if (!(COMPANY_PAPER_KINDS as readonly string[]).includes(document.kind)) throw new GlosError('INVALID_STATE', 'This is the paper of a consignment, not one the company keeps about itself');
    if (!this.documents.counts(document)) throw new GlosError('INVALID_STATE', `This paper is ${document.status.replace(/_/g, ' ')}: it does not count, and there is nothing to report`);
    if (!REPORT_CATEGORIES.includes(input.category as ReportCategory)) throw new GlosError('VALIDATION_FAILED', `Say what is wrong with it: ${REPORT_CATEGORIES.join(', ')}`);
    const note = input.note?.trim();
    if (!note) throw new GlosError('FIELD_REQUIRED', 'Say what is wrong with this paper, in your own words', { field: 'note' });
    if (!input.evidenceDataUrl) throw new GlosError('FIELD_REQUIRED', 'Attach what shows it: a screenshot or a photograph', { field: 'evidence' });
    if (!input.reporter?.key) throw new GlosError('FORBIDDEN', 'A report comes from somebody signed in');

    let c = [...this.cases.values()].find((x) => x.documentId === document.documentId && x.state === 'open');
    if (c?.reports.some((r) => r.reporter.key === input.reporter.key)) throw new GlosError('CONFLICT', 'You have already reported this paper. It is being looked at');
    const first = !c;
    if (!c) {
      c = { caseId: `pc_${randomBytes(8).toString('hex')}`, entityId: entity.entityId, documentId: document.documentId, openedAt: new Date(now).toISOString(), answerBy: new Date(now + REPORT_ANSWER_DAYS * 86_400_000).toISOString(), state: 'open', reports: [] };
    }
    // The evidence last among the checks and first among the writes: it is the half that can still be refused.
    const evidenceId = this.keepEvidence(c.caseId, input.evidenceDataUrl);
    const reportId = `pr_${randomBytes(8).toString('hex')}`;
    c.reports.push({ reportId, at: new Date(now).toISOString(), category: input.category as ReportCategory, note: note.slice(0, 1000), evidenceId, reporter: { key: input.reporter.key, name: input.reporter.name, role: input.reporter.role } });
    this.cases.set(c.caseId, c);

    // The company is told the first time a paper is questioned — what was said, never by whom. A second person saying
    // the same of the same paper adds to what staff read; it is not a second email.
    const told = first
      ? await this.tell(entity.entityId, 'company-paper-reported', { company: entity.name, paper: document.title, said: REPORT_CATEGORY_WORDS[input.category as ReportCategory], note: note.slice(0, 1000), answerBy: c.answerBy.slice(0, 10) }, now)
      : 0;
    return { caseId: c.caseId, reportId, answerBy: c.answerBy, told };
  }

  /** THE COMPANY ANSWERS: what is right, and optionally what shows it. May be said again while it is open; the last one stands. */
  answer(input: { caseId: string; note?: string; evidenceDataUrl?: string; by?: string }, now: number = Date.now()): PaperCaseView {
    const c = this.require(input.caseId);
    if (c.state !== 'open') throw new GlosError('INVALID_STATE', 'This report has been decided');
    const by = input.by?.trim();
    if (!by) throw new GlosError('FIELD_REQUIRED', 'An answer names the person who gave it');
    const note = input.note?.trim();
    if (!note) throw new GlosError('FIELD_REQUIRED', 'Say what is right about this paper', { field: 'note' });
    const evidenceId = input.evidenceDataUrl ? this.keepEvidence(c.caseId, input.evidenceDataUrl) : undefined;
    c.answer = { at: new Date(now).toISOString(), by, note: note.slice(0, 2000), ...(evidenceId ? { evidenceId } : {}) };
    this.cases.set(c.caseId, c);
    return this.view(c, 'company');
  }

  /* ------------------------------------------------------------------ the decision -- */

  /** ONE MEMBER OF STAFF DISMISSES IT, with the reason. Nothing on the record changes; whatever was proposed is dropped. */
  async dismiss(caseId: string, reason: string | undefined, staff: { name: string; key: string }, now: number = Date.now()): Promise<PaperCaseView> {
    const c = this.require(caseId);
    if (c.state !== 'open') throw new GlosError('INVALID_STATE', 'This report has already been decided');
    const why = reason?.trim();
    if (!why) throw new GlosError('FIELD_REQUIRED', 'Say why — the company and whoever reported it read the reason', { field: 'reason' });
    c.state = 'dismissed';
    delete c.proposal;
    c.decision = { outcome: 'dismissed', reason: why.slice(0, 1000), by: staff.name, at: new Date(now).toISOString() };
    this.cases.set(c.caseId, c);
    await this.tellDecision(c, now);
    return this.view(c, 'staff', staff.key);
  }

  /**
   * THE FIRST MEMBER OF STAFF: "this paper should be struck, and this is why." It strikes nothing. Not before the
   * company has answered or its time has run out — a strike can stop a country charging, and the company is heard first.
   */
  proposeStrike(caseId: string, reason: string | undefined, staff: { name: string; key: string }, now: number = Date.now()): PaperCaseView {
    const c = this.require(caseId);
    if (c.state !== 'open') throw new GlosError('INVALID_STATE', 'This report has already been decided');
    if (c.proposal) throw new GlosError('INVALID_STATE', `${c.proposal.by} has already proposed to strike this paper. A second member of staff approves it, or it is dismissed`);
    this.requireHeard(c, now);
    this.requireStillCounts(c);
    const why = reason?.trim();
    if (!why) throw new GlosError('FIELD_REQUIRED', 'Say why this paper should be struck — the second member of staff approves on the strength of it', { field: 'reason' });
    c.proposal = { by: staff.name, byKey: staff.key, at: new Date(now).toISOString(), reason: why.slice(0, 1000) };
    this.cases.set(c.caseId, c);
    return this.view(c, 'staff', staff.key);
  }

  /**
   * THE SECOND MEMBER OF STAFF APPROVES, and the paper is struck. Never the one who proposed it. Whether the paper
   * still counts is asked again here, at the moment it happens.
   */
  async approveStrike(caseId: string, staff: { name: string; key: string }, now: number = Date.now()): Promise<PaperCaseView> {
    const c = this.require(caseId);
    if (c.state !== 'open') throw new GlosError('INVALID_STATE', 'This report has already been decided');
    if (!c.proposal) throw new GlosError('INVALID_STATE', 'Nobody has proposed to strike this paper yet. One member of staff proposes, with the reason; a second approves');
    if (c.proposal.byKey === staff.key) throw new GlosError('CONFLICT', 'A second member of staff has to approve — not the one who proposed it');
    // Heard already: a strike is only ever PROPOSED once the company has answered or its time has run out, and
    // neither can be undone. Whether the paper still counts can change in between — the company may have replaced it.
    this.requireStillCounts(c);
    const by = `${c.proposal.by} and ${staff.name}`;
    const { effect } = this.declarations.strike(c.entityId, c.documentId, by, c.proposal.reason, now);
    c.state = 'struck';
    c.decision = { outcome: 'struck', reason: c.proposal.reason, by, at: new Date(now).toISOString(), effect };
    this.cases.set(c.caseId, c);
    await this.tellDecision(c, now);
    return this.view(c, 'staff', staff.key);
  }

  /* ------------------------------------------------------------------ inside -- */

  private requireHeard(c: PaperCase, now: number): void {
    if (c.answer || now >= Date.parse(c.answerBy)) return;
    throw new GlosError('INVALID_STATE', `The company has until ${c.answerBy.slice(0, 10)} to answer. A strike is decided once it has answered, or once that day has passed. Dismissing a report does not wait`);
  }

  private requireStillCounts(c: PaperCase): void {
    const document = this.documents.get(c.entityId, c.documentId);
    if (!this.documents.counts(document)) throw new GlosError('INVALID_STATE', `This paper is now ${document.status.replace(/_/g, ' ')}: the company has replaced it since. Dismiss this report, saying so`);
  }

  private keepEvidence(caseId: string, dataUrl: string): string {
    const { contentType, bytes } = decodeDocument(dataUrl, MAX_EVIDENCE_BYTES);
    const evidenceId = `ev_${randomBytes(8).toString('hex')}`;
    this.evidence.set(evidenceId, { caseId, contentType, fingerprint: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') });
    return evidenceId;
  }

  private require(caseId: string): PaperCase {
    const c = this.cases.get(caseId);
    if (!c) throw new GlosError('NOT_FOUND', 'No such report');
    return c;
  }

  private view(c: PaperCase, reader: 'staff' | 'company', staffKey?: string): PaperCaseView {
    const entity = this.entities.get(c.entityId);
    const document = this.documents.get(c.entityId, c.documentId);
    const declaration = this.declarations.ofDocument(c.documentId);
    const staff = reader === 'staff';
    return {
      caseId: c.caseId,
      entityId: c.entityId,
      company: entity.name,
      documentId: c.documentId,
      paper: { title: document.title, kind: document.kind, ...(document.relatesTo ? { relatesTo: document.relatesTo } : {}), status: document.status, uploadedBy: document.uploadedBy, uploadedAt: document.uploadedAt },
      ...(declaration ? { claimed: { was: declaration.wasWords, now: declaration.nowWords, by: declaration.by, at: declaration.at } } : {}),
      openedAt: c.openedAt,
      answerBy: c.answerBy,
      strikeFrom: c.answer ? c.answer.at : c.answerBy,
      state: c.state,
      // WHO REPORTED IT, and what they attached, are for staff. The company reads what was said and answers that.
      reports: c.reports.map((r) => ({ reportId: r.reportId, at: r.at, category: r.category, note: r.note, ...(staff ? { by: r.reporter.name, role: r.reporter.role, evidenceId: r.evidenceId } : {}) })),
      ...(c.answer ? { answer: c.answer } : {}),
      ...(staff && c.proposal ? { proposal: { by: c.proposal.by, at: c.proposal.at, reason: c.proposal.reason, ...(staffKey && c.proposal.byKey === staffKey ? { byYou: true } : {}) } } : {}),
      ...(c.decision ? { decision: { outcome: c.decision.outcome, reason: c.decision.reason, at: c.decision.at, ...(c.decision.effect ? { effect: c.decision.effect } : {}), ...(staff ? { by: c.decision.by } : {}) } } : {}),
    };
  }

  /** The company's administrators, and those of the company above it: everybody whose paper it is. Returns how many. */
  private async tell<K extends 'company-paper-reported' | 'company-paper-decided'>(entityId: string, template: K, params: Parameters<MailService['send']>[2], now: number): Promise<number> {
    if (!this.mail) return 0;
    const parent = this.entities.find(entityId)?.parentEntityId;
    let told = 0;
    for (const admin of [...this.admins.list(entityId), ...(parent ? this.admins.list(parent) : [])]) {
      if (await this.mail.send(template, { address: admin.email, name: admin.name }, params as never, now)) told += 1;
    }
    return told;
  }

  private tellDecision(c: PaperCase, now: number): Promise<number> {
    const entity = this.entities.get(c.entityId);
    const document = this.documents.get(c.entityId, c.documentId);
    return this.tell(c.entityId, 'company-paper-decided', { company: entity.name, paper: document.title, outcome: c.decision!.outcome, reason: c.decision!.reason, effect: c.decision!.effect ?? '' }, now);
  }
}
