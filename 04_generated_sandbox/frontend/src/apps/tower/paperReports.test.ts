import { describe, expect, it } from 'vitest';
import { caseSub, casesWaiting, lastDecidedOf, mayReport, openCaseOf, reportBlocker, strikeStep, type PaperCase } from './paperReports';

const AT = '2026-10-09T09:00:00.000Z';
const WEEK = '2026-10-16T09:00:00.000Z';
const aCase = (over: Partial<PaperCase> = {}): PaperCase => ({
  caseId: 'pc_1',
  entityId: 'sbg-ke',
  company: 'SeeBuyGet Kenya',
  documentId: 'doc_1',
  paper: { title: 'courier licence CA/CL/0042, good until 2027-10-01', kind: 'licence', relatesTo: 'CA/CL/0042', status: 'declared', uploadedBy: 'Wanjiru Kamau', uploadedAt: AT },
  openedAt: AT,
  answerBy: WEEK,
  strikeFrom: WEEK,
  state: 'open',
  reports: [{ reportId: 'pr_1', at: AT, category: 'expired', note: 'The register shows it expired.', by: 'Amina Otieno', role: 'SeeBuyGet staff', evidenceId: 'ev_1' }],
  ...over,
});
const say = ((key: string, vars?: Record<string, string | number>) => `${key}${vars ? ':' + Object.values(vars).join(',') : ''}`) as never;
const when = (iso: string) => iso.slice(0, 10);

describe('what a member of staff may do about striking a reported paper', () => {
  it('not before the company has been heard: until its time runs out, or it answers, a strike is not proposed', () => {
    expect(strikeStep(aCase(), Date.parse(AT))).toBe('wait');
    expect(strikeStep(aCase(), Date.parse(WEEK) - 1)).toBe('wait');
    expect(strikeStep(aCase(), Date.parse(WEEK))).toBe('propose');
    // It answered on the second day: from then.
    const answered = aCase({ answer: { at: '2026-10-10T09:00:00.000Z', by: 'Wanjiru Kamau', note: 'Renewed.' }, strikeFrom: '2026-10-10T09:00:00.000Z' });
    expect(strikeStep(answered, Date.parse('2026-10-10T09:00:01.000Z'))).toBe('propose');
  });
  it('a colleague’s proposal is offered for approval; your own is not — the approval is somebody else’s', () => {
    const proposal = { by: 'Amina Otieno', at: WEEK, reason: 'Expired.' };
    expect(strikeStep(aCase({ proposal }), Date.parse(WEEK))).toBe('approve');
    expect(strikeStep(aCase({ proposal: { ...proposal, byYou: true } }), Date.parse(WEEK))).toBe('other');
  });
  it('offers nothing once it is decided', () => {
    expect(strikeStep(aCase({ state: 'struck' }), Date.parse(WEEK))).toBe('closed');
    expect(strikeStep(aCase({ state: 'dismissed', proposal: { by: 'Amina Otieno', at: WEEK, reason: 'x' } }), Date.parse(WEEK))).toBe('closed');
  });
});

describe('which paper can be reported, and what a report needs', () => {
  it('a paper that counts, on a record the company keeps itself — and no other', () => {
    expect(mayReport({ status: 'declared', kind: 'licence' }, 'company')).toBe(true);
    expect(mayReport({ status: 'verified', kind: 'certificate_of_incorporation' }, 'company')).toBe(true);
    // Not switched on yet: its papers are verified by staff, not reported.
    expect(mayReport({ status: 'verified', kind: 'licence' }, 'staff')).toBe(false);
    expect(mayReport({ status: 'verified', kind: 'licence' }, undefined)).toBe(false);
    // Replaced, struck, turned down or still waiting: it says nothing that could be wrong.
    for (const status of ['superseded', 'struck', 'rejected', 'awaiting_verification']) expect(mayReport({ status, kind: 'licence' }, 'company')).toBe(false);
    // A consignment's packing list is not a paper the company keeps about itself.
    expect(mayReport({ status: 'verified', kind: 'packing_list' }, 'company')).toBe(false);
  });
  it('is not sent without words, or without what shows them', () => {
    expect(reportBlocker({ note: '   ', hasEvidence: true })).toBe('tower.paperReport.needNote');
    expect(reportBlocker({ note: 'The register shows it expired.', hasEvidence: false })).toBe('tower.paperReport.needEvidence');
    expect(reportBlocker({ note: 'The register shows it expired.', hasEvidence: true })).toBeNull();
  });
});

describe('what a paper’s row and the queue say about a report', () => {
  const open = aCase();
  const dismissed = aCase({ caseId: 'pc_0', state: 'dismissed', decision: { outcome: 'dismissed', reason: 'Checked.', at: '2026-10-05T09:00:00.000Z' } });
  const struck = aCase({ caseId: 'pc_2', documentId: 'doc_2', state: 'struck', decision: { outcome: 'struck', reason: 'Expired.', at: '2026-10-08T09:00:00.000Z' } });
  it('finds the open question about a paper, and the last thing decided about it', () => {
    expect(openCaseOf([dismissed, open, struck], 'doc_1')?.caseId).toBe('pc_1');
    expect(openCaseOf([dismissed, struck], 'doc_1')).toBeUndefined();
    expect(openCaseOf(undefined, 'doc_1')).toBeUndefined();
    expect(lastDecidedOf([dismissed, open, struck], 'doc_1')?.caseId).toBe('pc_0');
    expect(lastDecidedOf([dismissed, { ...dismissed, caseId: 'pc_9', decision: { outcome: 'dismissed', reason: 'Later.', at: '2026-10-07T09:00:00.000Z' } }], 'doc_1')?.caseId).toBe('pc_9');
    expect(lastDecidedOf([open], 'doc_1')).toBeUndefined();
  });
  it('counts what waits on staff — and is no number at all while unread', () => {
    expect(casesWaiting(null)).toBeNull();
    expect(casesWaiting([])).toBe(0);
    expect(casesWaiting([open, dismissed, struck])).toBe(1);
  });
  it('says in one line whose paper, how many said so, and where it stands', () => {
    expect(caseSub(open, say, when)).toBe('tower.paperReport.sub.one:SeeBuyGet Kenya,1 · tower.paperReport.sub.answerBy:2026-10-16');
    const two = aCase({ reports: [...open.reports, { ...open.reports[0], reportId: 'pr_2' }], answer: { at: '2026-10-10T09:00:00.000Z', by: 'Wanjiru Kamau', note: 'Renewed.' } });
    expect(caseSub(two, say, when)).toBe('tower.paperReport.sub.many:SeeBuyGet Kenya,2 · tower.paperReport.sub.answered:2026-10-10');
    expect(caseSub(aCase({ proposal: { by: 'Amina Otieno', at: WEEK, reason: 'x' } }), say, when)).toBe('tower.paperReport.sub.one:SeeBuyGet Kenya,1 · tower.paperReport.sub.proposed:Amina Otieno');
    expect(caseSub(struck, say, when)).toBe('tower.paperReport.sub.one:SeeBuyGet Kenya,1 · tower.paperReport.sub.struck:2026-10-08');
    expect(caseSub(dismissed, say, when)).toBe('tower.paperReport.sub.one:SeeBuyGet Kenya,1 · tower.paperReport.sub.dismissed:2026-10-05');
  });
});
