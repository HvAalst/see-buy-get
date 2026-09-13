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
  shortFingerprint,
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

describe('CA5 — how loudly a lapsing paper is shown', () => {
  it('is bad once lapsed, a warning inside two weeks, quiet before', () => {
    expect(expiryTone({ lapsed: true, daysLeft: -3 })).toBe('bad');
    expect(expiryTone({ lapsed: false, daysLeft: 10 })).toBe('warn');
    expect(expiryTone({ lapsed: false, daysLeft: 40 })).toBe('quiet');
  });
});
