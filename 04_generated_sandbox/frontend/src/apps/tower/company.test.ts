import { describe, expect, it } from 'vitest';
import {
  companyCreateBlocker,
  documentBlocker,
  emptyRow,
  expiryTone,
  fromEditRows,
  readinessCounts,
  relatesToChoices,
  SECTION_FIELDS,
  declarationBody,
  declareBlocker,
  declareFields,
  itemLine,
  mayTakeOff,
  papersWaiting,
  recordHands,
  recordLede,
  runningOutHint,
  shortFingerprint,
  toldWords,
  toEditRows,
  uploadBlocker,
  type CompanyDocument,
  type CompanyRecord,
} from './company';
import type { CatalogueCountry } from './presence';

/**
 * A company, recorded properly — the console's half.
 *
 * The rule worth a test above all: the person who put a paper on record never verifies it. The rest is the screen
 * refusing, before the server has to, the things a person would otherwise type and have bounced.
 */

const record = (over: Partial<CompanyRecord> = {}): CompanyRecord => ({
  representatives: [],
  beneficialOwners: [],
  taxRegistrations: [],
  bankAccounts: [],
  licences: [],
  insurance: [],
  obligations: [],
  ...over,
});

const doc = (over: Partial<CompanyDocument> = {}): CompanyDocument => ({
  documentId: 'doc_1',
  entityId: 'sbg-zm',
  kind: 'certificate_of_incorporation',
  title: 'Certificate',
  version: 1,
  fingerprint: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
  contentType: 'application/pdf',
  size: 1000,
  uploadedBy: 'Amina',
  uploadedAt: '2026-09-13T08:00:00Z',
  status: 'awaiting_verification',
  ...over,
});

describe('CA4 — a paper counts once somebody else has checked it', () => {
  it('never lets the uploader verify their own paper', () => {
    expect(documentBlocker(doc(), 'Amina')).toBe('tower.company.doc.ownUpload');
    expect(documentBlocker(doc(), ' amina ')).toBe('tower.company.doc.ownUpload');
    expect(documentBlocker(doc(), 'Brian')).toBeNull();
    expect(documentBlocker(doc(), undefined)).toBe('tower.company.doc.needName');
    expect(documentBlocker(doc({ status: 'verified' }), 'Brian')).toBe('tower.company.doc.notAwaiting');
  });

  it('goes by what the server says for somebody with an account: a namesake may verify, and nobody their own under another name', () => {
    expect(documentBlocker(doc({ mine: false }), 'Amina', true)).toBeNull();
    expect(documentBlocker(doc({ mine: true }), 'Somebody Else', true)).toBe('tower.company.doc.ownUpload');
    // The setup key has only a typed name; and a server that predates it says nothing: the names decide.
    expect(documentBlocker(doc({ mine: false }), 'Amina', false)).toBe('tower.company.doc.ownUpload');
    expect(documentBlocker(doc(), 'Amina', true)).toBe('tower.company.doc.ownUpload');
    expect(documentBlocker(doc(), 'Brian', true)).toBeNull();
  });

  it('shows the fingerprint grouped, the way a person compares one', () => {
    expect(shortFingerprint(doc().fingerprint)).toBe('a1b2 c3d4 e5f6 0718…');
  });

  it('asks which licence, policy or obligation a paper is for', () => {
    const r = record({ licences: [{ kind: 'courier', number: 'C-1', issuer: 'X', expiresAt: '2027-01-01', supports: [] }] });
    expect(relatesToChoices('licence', r, [])).toEqual([{ value: 'C-1', label: 'C-1' }]);
    expect(relatesToChoices('obligation_registration', r, [{ key: 'e_invoicing', name: 'Smart Invoice' }])).toEqual([{ value: 'e_invoicing', label: 'Smart Invoice' }]);
    expect(uploadBlocker({ kind: 'licence', relatesTo: '', title: 'Licence', dataUrl: 'data:x' })).toBe('tower.company.doc.needRelatesTo');
    expect(uploadBlocker({ kind: 'other', relatesTo: '', title: 'Letter', dataUrl: '' })).toBe('tower.company.doc.needFile');
    expect(uploadBlocker({ kind: 'other', relatesTo: '', title: 'Letter', dataUrl: 'data:x' })).toBeNull();
  });
});

describe('CA3 — the record, edited like a form', () => {
  it('round-trips a list section, leaving out what nobody typed', () => {
    const r = record({ beneficialOwners: [{ name: 'SeeBuyGet Group', sharePct: 100 }] });
    const rows = toEditRows('beneficialOwners', r);
    expect(rows).toEqual([{ name: 'SeeBuyGet Group', sharePct: '100', nationality: '' }]);
    expect(fromEditRows('beneficialOwners', rows)).toEqual([{ name: 'SeeBuyGet Group', sharePct: 100 }]);
  });

  it('lets the server decide what a licence permits unless somebody changed it', () => {
    const rows = [{ ...emptyRow(SECTION_FIELDS.licences), number: 'C-1', issuer: 'ZICTA', expiresAt: '2027-01-31', supports: ['claims' as const] }];
    expect(fromEditRows('licences', rows)[0]).not.toHaveProperty('supports');
    expect(fromEditRows('licences', rows, [true])[0]).toMatchObject({ supports: ['claims'] });
    expect(emptyRow(SECTION_FIELDS.licences).kind).toBe('courier');
  });

  it('counts readiness without pretending every item weighs the same', () => {
    expect(readinessCounts({ entityId: 'x', ready: false, items: [{ key: 'a', met: true, label: 'A' }, { key: 'b', met: false, label: 'B' }] })).toEqual({ met: 1, total: 2 });
    expect(readinessCounts(null)).toEqual({ met: 0, total: 0 });
  });
});

describe('CA3 + CA7 — creating a draft', () => {
  const zm = { code: 'ZM', name: 'Zambia' } as CatalogueCountry;

  it('allows one company of ours per country, and any number of partners', () => {
    const companies = [{ entityId: 'sbg-zm', name: 'SeeBuyGet Zambia', kind: 'sister' as const, jurisdiction: 'ZM' }];
    expect(companyCreateBlocker({ kind: 'sister', jurisdiction: 'ZM', name: 'Another' }, [zm], companies)).toBe('tower.company.create.hasSister');
    expect(companyCreateBlocker({ kind: 'partner', jurisdiction: 'ZM', name: 'Lusaka Freight' }, [zm], companies)).toBeNull();
    expect(companyCreateBlocker({ kind: 'partner', jurisdiction: '', name: 'X' }, [zm], companies)).toBe('tower.company.create.needCountry');
    expect(companyCreateBlocker({ kind: 'partner', jurisdiction: 'ZM', name: ' ' }, [zm], companies)).toBe('tower.company.create.needName');
  });
});

describe('what a company was told about a paper that is running out', () => {
  const say = ((key: string, vars?: Record<string, string | number>) => `${key}${vars ? ':' + Object.values(vars).join(',') : ''}`) as never;
  const when = (iso: string) => iso.slice(0, 10);
  const at = '2026-10-09T06:00:00.000Z';
  it('says nothing where nothing was said yet', () => {
    expect(toldWords({}, say, when)).toBeNull();
  });
  it('says how many administrators were emailed, and when', () => {
    expect(toldWords({ told: { stage: 14, at, to: 1, of: 1 } }, say, when)).toEqual({ text: 'tower.companies.told.one:1,2026-10-09', tone: 'quiet' });
    expect(toldWords({ told: { stage: 'lapsed', at, to: 3, of: 3 } }, say, when)).toEqual({ text: 'tower.companies.told.many:3,2026-10-09', tone: 'quiet' });
  });
  it('WARNS where the reminder went nowhere: nobody to tell, nothing handed over, or only some of them', () => {
    expect(toldWords({ told: { stage: 30, at, to: 0, of: 0, nobody: true } }, say, when)).toEqual({ text: 'tower.companies.told.nobody:2026-10-09', tone: 'warn' });
    expect(toldWords({ told: { stage: 30, at, to: 0, of: 2 } }, say, when)).toEqual({ text: 'tower.companies.told.notHandedOver:2,2026-10-09', tone: 'warn' });
    expect(toldWords({ told: { stage: 7, at, to: 3, of: 5 } }, say, when)).toEqual({ text: 'tower.companies.told.some:3,5,2026-10-09', tone: 'warn' });
  });
});

describe('whose hands a company’s record is in', () => {
  it('staff keep it until the company is switched on; the company keeps it from then, and staff only read', () => {
    expect(recordHands({ keeper: 'staff' }, 'operator')).toEqual({ keeper: 'staff', mine: true });
    expect(recordHands({ keeper: 'staff' }, 'company')).toEqual({ keeper: 'staff', mine: false });
    expect(recordHands({ keeper: 'company' }, 'company')).toEqual({ keeper: 'company', mine: true });
    expect(recordHands({ keeper: 'company' }, 'operator')).toEqual({ keeper: 'company', mine: false });
    // A server that does not say (an older one), or a record not read yet: as it always was — staff's.
    expect(recordHands({}, 'company').mine).toBe(false);
    expect(recordHands(null, 'operator').mine).toBe(true);
  });
  it('says to each reader whose it is to change, and where a renewed date goes', () => {
    expect([recordLede({ keeper: 'staff' }, 'operator'), recordLede({ keeper: 'company' }, 'operator'), recordLede({ keeper: 'company' }, 'company'), recordLede({ keeper: 'staff' }, 'company')]).toEqual([
      'tower.company.lede',
      'tower.company.ledeTheirs',
      'tower.company.ledeOwn',
      'tower.company.ledeDraft',
    ]);
    expect([runningOutHint({ keeper: 'company' }, 'company'), runningOutHint({ keeper: 'staff' }, 'company'), runningOutHint({ keeper: 'company' }, 'operator'), runningOutHint({ keeper: 'staff' }, 'operator')]).toEqual([
      'tower.company.runningOut.own',
      'tower.company.runningOut.ownDraft',
      'tower.company.runningOut.staff',
      'tower.company.runningOut.staffDraft',
    ]);
  });
});

describe('a change with its paper — what the company fills in, and what it may not', () => {
  const licence = { kind: 'courier', number: 'CA/CL/0042', issuer: 'Communications Authority', expiresAt: '2026-12-10', supports: ['merchantOfRecord'] };
  it('never offers what a paper permits, nor the kind of one already on record', () => {
    expect(declareFields('licences', false).map((f) => f.key)).toEqual(['kind', 'number', 'issuer', 'expiresAt']);
    expect(declareFields('licences', true).map((f) => f.key)).toEqual(['number', 'issuer', 'expiresAt']);
    expect(declareFields('insurance', true).map((f) => f.key)).toEqual(['insurer', 'policyNumber', 'coverAmount', 'expiresAt']);
    expect(declareFields('representatives', true).map((f) => f.key)).toEqual(['name', 'role', 'signing']);
  });
  it('a licence or policy that permits something is not offered to be taken off; the rest are', () => {
    expect(mayTakeOff('licences', licence)).toBe(false);
    expect(mayTakeOff('insurance', { kind: 'public_liability', supports: [] })).toBe(true);
    expect(mayTakeOff('bankAccounts', { accountNumber: '1' })).toBe(true);
    expect(mayTakeOff('representatives', { name: 'Otieno Odhiambo' })).toBe(true);
  });
  it('is not sent without its number, its date, or its paper', () => {
    const row = { kind: 'courier', number: 'CA/CL/0042', issuer: 'CA', expiresAt: '2027-12-10', supports: [] };
    expect(declareBlocker('licences', { ...row, number: '  ' }, true)).toBe('tower.company.declare.needReference');
    expect(declareBlocker('licences', { ...row, expiresAt: '' }, true)).toBe('tower.company.declare.needDate');
    expect(declareBlocker('licences', row, false)).toBe('tower.company.declare.needPaper');
    expect(declareBlocker('licences', row, true)).toBeNull();
    // A signatory has no date to give.
    expect(declareBlocker('representatives', { name: 'Otieno Odhiambo', role: 'Director', signing: 'alone' }, true)).toBeNull();
    expect(declareBlocker('representatives', { name: '', role: 'Director', signing: 'alone' }, true)).toBe('tower.company.declare.needReference');
  });
  it('sends which one it replaces, the item as typed and the paper — and never what it permits', () => {
    const row = { kind: 'courier', number: 'CA/CL/0099', issuer: 'Communications Authority', expiresAt: '2027-12-10', supports: ['merchantOfRecord'] as never };
    expect(declarationBody('licences', 'CA/CL/0042', row, { dataUrl: 'data:application/pdf;base64,AAAA', kind: 'licence' })).toEqual({
      section: 'licences',
      was: 'CA/CL/0042',
      item: { kind: 'courier', number: 'CA/CL/0099', issuer: 'Communications Authority', expiresAt: '2027-12-10' },
      paperDataUrl: 'data:application/pdf;base64,AAAA',
    });
    // A new one names nothing it replaces; a paper of another kind says which.
    const added = declarationBody('representatives', undefined, { name: 'Otieno Odhiambo', role: 'Director', signing: 'alone' }, { dataUrl: 'data:application/pdf;base64,BBBB', kind: 'memorandum_and_articles' });
    expect(added).toEqual({ section: 'representatives', item: { name: 'Otieno Odhiambo', role: 'Director', signing: 'alone' }, paperDataUrl: 'data:application/pdf;base64,BBBB', paperKind: 'memorandum_and_articles' });
  });
  it('shows an item as two lines a reader recognises', () => {
    const say = ((key: string, vars?: Record<string, string | number>) => `${key}${vars ? ':' + Object.values(vars).join(',') : ''}`) as never;
    expect(itemLine('licences', licence, say)).toEqual({ title: 'tower.company.licence.courier · CA/CL/0042', detail: 'tower.company.declare.goodUntil:Communications Authority,2026-12-10' });
    expect(itemLine('bankAccounts', { bankName: 'KCB', accountName: 'SeeBuyGet Kenya Ltd', accountNumber: '1100223344', currency: 'KES', purpose: 'general' }, say)).toEqual({ title: 'KCB · 1100223344', detail: 'SeeBuyGet Kenya Ltd · KES · tower.company.purpose.general' });
    expect(itemLine('representatives', { name: 'Otieno Odhiambo', role: 'Director', signing: 'alone' }, say)).toEqual({ title: 'Otieno Odhiambo', detail: 'Director · tower.company.signing.alone' });
  });
});

describe('how many papers need a company now — the number beside its own record', () => {
  const paper = (daysLeft: number, lapsed = false) => ({ entityId: 'sbg-ke', name: 'SeeBuyGet Kenya', source: 'licence' as const, kind: 'courier', reference: 'CA/CL/0042', expiresAt: '2026-11-12', supports: [], lapsed, daysLeft });
  it('counts the lapsed and the ones inside their last two weeks — not the ones still far out', () => {
    expect(papersWaiting([paper(-3, true), paper(14), paper(15), paper(59)])).toBe(2);
  });
  it('is no number at all while unread, and none when nothing waits: a record is not a queue', () => {
    expect(papersWaiting(null)).toBeNull();
    expect(papersWaiting([])).toBeNull();
    expect(papersWaiting([paper(40)])).toBeNull();
  });
});

describe('CA5 — how loudly a lapsing paper is shown', () => {
  it('is bad once lapsed, a warning inside two weeks, quiet before', () => {
    expect(expiryTone({ lapsed: true, daysLeft: -3 })).toBe('bad');
    expect(expiryTone({ lapsed: false, daysLeft: 10 })).toBe('warn');
    expect(expiryTone({ lapsed: false, daysLeft: 40 })).toBe('quiet');
  });
});
