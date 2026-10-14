import { describe, expect, it } from 'vitest';
import { contractReportBlocker, hasContract, mayReportPaper, paperName, paperSays, yourReportSays, type ContractPaper } from './contract';

const say = ((key: string, vars?: Record<string, string | number>) => `${key}${vars ? ':' + Object.values(vars).join(',') : ''}`) as never;
const day = (iso: string) => iso.slice(0, 10);
const licence: ContractPaper = { source: 'licence', kind: 'courier', issuer: 'Communications Authority', number: 'CA/CL/0042', expiresAt: '2027-10-01', lapsed: false, reportable: true };

describe('who you contract with — whether there is anything to show', () => {
  it('the row is there only where a company of ours contracts with this person', () => {
    expect(hasContract({ company: { name: 'SeeBuyGet Kenya', jurisdiction: 'KE' }, papers: [] })).toBe(true);
    expect(hasContract({ papers: [] })).toBe(false);
    expect(hasContract(null)).toBe(false);
    expect(hasContract(undefined)).toBe(false);
  });
});

describe('a paper of the company you contract with, in words', () => {
  it('is called what it is — and a kind nobody has named yet is still a licence or a policy', () => {
    expect(paperName(licence)).toBe('account.contract.licence.courier');
    expect(paperName({ source: 'insurance', kind: 'goods_in_transit' })).toBe('account.contract.insurance.goods_in_transit');
    expect(paperName({ source: 'licence', kind: 'something new' })).toBe('account.contract.licence.other');
    expect(paperName({ source: 'insurance', kind: 'other' })).toBe('account.contract.insurance.other');
    // A licence kind is never looked up among the policies, nor the other way round.
    expect(paperName({ source: 'insurance', kind: 'courier' })).toBe('account.contract.insurance.other');
  });
  it('says who issued it and until when — or that it has run out', () => {
    expect(paperSays(licence, say, day)).toBe('account.contract.goodUntil:Communications Authority,2027-10-01');
    expect(paperSays({ ...licence, lapsed: true, expiresAt: '2026-10-01' }, say, day)).toBe('account.contract.ranOut:Communications Authority,2026-10-01');
  });
});

describe('reporting one of them', () => {
  it('is offered where there is a paper behind it and no report of yours still being looked at', () => {
    expect(mayReportPaper(licence)).toBe(true);
    expect(mayReportPaper({ ...licence, reportable: false })).toBe(false);
    expect(mayReportPaper({ ...licence, yourReport: { at: '2026-10-09T09:00:00.000Z', state: 'open' } })).toBe(false);
    // Decided, it can be said again: the paper may have been replaced, or be wrong in another way.
    expect(mayReportPaper({ ...licence, yourReport: { at: '2026-10-09T09:00:00.000Z', state: 'dismissed', reason: 'Checked.' } })).toBe(true);
    expect(mayReportPaper({ ...licence, reportable: false, yourReport: { at: '2026-10-09T09:00:00.000Z', state: 'struck', reason: 'Expired.' } })).toBe(false);
  });
  it('is not sent without words, or without what shows them', () => {
    expect(contractReportBlocker({ note: '  ', hasEvidence: true })).toBe('account.contract.needNote');
    expect(contractReportBlocker({ note: 'The register lists it as expired.', hasEvidence: false })).toBe('account.contract.needEvidence');
    expect(contractReportBlocker({ note: 'The register lists it as expired.', hasEvidence: true })).toBeNull();
  });
  it('reads back what became of your own report: being looked at, struck, or dismissed with the reason', () => {
    expect(yourReportSays(licence, say, day)).toBeNull();
    expect(yourReportSays({ yourReport: { at: '2026-10-09T09:00:00.000Z', state: 'open' } }, say, day)).toEqual({ text: 'account.contract.yours.open:2026-10-09', tone: 'info' });
    expect(yourReportSays({ yourReport: { at: '2026-10-09T09:00:00.000Z', state: 'struck', reason: 'Expired.' } }, say, day)).toEqual({ text: 'account.contract.yours.struck:Expired.', tone: 'ok' });
    expect(yourReportSays({ yourReport: { at: '2026-10-09T09:00:00.000Z', state: 'dismissed', reason: 'Checked today.' } }, say, day)).toEqual({ text: 'account.contract.yours.dismissed:Checked today.', tone: 'info' });
  });
});
