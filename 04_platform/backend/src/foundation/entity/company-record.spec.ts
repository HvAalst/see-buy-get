import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import { EntityService } from './entity.service';
import { CompanyDocumentService } from './company-documents.service';
import { CompanyReadinessService } from './company-readiness.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';
import { PresenceService } from '../presence/presence.service';
import { makeCompanyReady, pdfDataUrl } from './company.test-util';

/**
 * CA3, CA4, CA5, CA7, CA8 — a company of ours, or a partner, recorded properly.
 *
 * The failures worth guarding are all one failure: a company that looks real to the system before it is real on
 * paper. A draft that a money path can find; a document verified by the person who uploaded it; a licence that
 * lapsed while the country kept charging customers; a partner conjured by a flag.
 */
describe('a company, recorded properly', () => {
  let entities: EntityService;
  let documents: CompanyDocumentService;
  let readiness: CompanyReadinessService;
  let presence: PresenceService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EntityService,
        CompanyDocumentService,
        CompanyReadinessService,
        PresenceService,
        DidService,
        LedgerService,
        EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    documents = moduleRef.get(CompanyDocumentService);
    readiness = moduleRef.get(CompanyReadinessService);
    presence = moduleRef.get(PresenceService);
  });

  describe('CA3 — a draft can do nothing', () => {
    it('creates a company of ours in a catalogued country as a draft no money path can find', () => {
      const zm = entities.createCompany({ kind: 'sister', jurisdiction: 'zm', name: 'SeeBuyGet Zambia' }, 'Amina');
      expect(zm).toMatchObject({ entityId: 'sbg-zm', jurisdiction: 'ZM', currency: 'ZMW', status: 'draft', kind: 'sister' });
      expect(entities.forJurisdiction('ZM')).toBeUndefined();
      expect(() => entities.requireTransacting('sbg-zm')).toThrow(/still a draft/);
      expect(entities.sisterRecordFor('ZM')?.entityId).toBe('sbg-zm');
      expect(entities.changes('sbg-zm')[0]).toMatchObject({ what: 'created', by: 'Amina' });
    });

    it('refuses a second company of ours in one country, a country that does not exist, and an unnamed creator', () => {
      entities.createCompany({ kind: 'sister', jurisdiction: 'ZM', name: 'SeeBuyGet Zambia' }, 'Amina');
      expect(() => entities.createCompany({ kind: 'sister', jurisdiction: 'ZM', name: 'Another' }, 'Amina')).toThrow(/already has a company of ours/);
      expect(() => entities.createCompany({ kind: 'sister', jurisdiction: 'ZZ', name: 'Nowhere' }, 'Amina')).toThrow(/not a country in the catalogue/);
      expect(() => entities.createCompany({ kind: 'partner', jurisdiction: 'ZM', name: 'Lusaka Freight' })).toThrow(/Say who/);
    });

    it('checks every section of the record, and names the field that is wrong', () => {
      const zm = entities.createCompany({ kind: 'sister', jurisdiction: 'ZM', name: 'SeeBuyGet Zambia' }, 'Amina');
      expect(() => entities.updateRecord(zm.entityId, { legalForm: 'empire' }, 'Amina')).toThrow(/Legal form must be one of/);
      expect(() => entities.updateRecord(zm.entityId, { beneficialOwners: [{ name: 'A', sharePct: 60 }, { name: 'B', sharePct: 50 }] }, 'Amina')).toThrow(/owned more than once/);
      expect(() => entities.updateRecord(zm.entityId, { licences: [{ kind: 'courier', number: 'C-1', issuer: 'ZICTA' }] }, 'Amina')).toThrow(/Licence 1 expiry is required/);
      expect(() => entities.updateRecord(zm.entityId, { registeredAddress: { line1: '1 Cairo Rd', city: 'Lusaka', country: 'ZZ' } }, 'Amina')).toThrow(/not a country/);

      // What a licence supports defaults from its kind; a courier licence is what lets us sell a delivery.
      entities.updateRecord(zm.entityId, { licences: [{ kind: 'courier', number: 'C-1', issuer: 'ZICTA', expiresAt: '2027-01-31' }] }, 'Amina');
      expect(entities.recordOf(zm.entityId).licences[0].supports).toEqual(['merchantOfRecord']);
      expect(entities.changes(zm.entityId)[0]).toMatchObject({ what: 'record', to: 'licences' });
    });
  });

  describe('CA4 — documents that can be proved', () => {
    it('keeps the sha256 of the bytes, and refuses a file that is not what it claims to be', () => {
      const zm = entities.createCompany({ kind: 'sister', jurisdiction: 'ZM', name: 'SeeBuyGet Zambia' }, 'Amina');
      const dataUrl = pdfDataUrl('certificate');
      const doc = documents.upload({ entityId: zm.entityId, kind: 'certificate_of_incorporation', title: 'Certificate', dataUrl, by: 'Amina' });
      const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
      expect(doc.fingerprint).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(doc).toMatchObject({ version: 1, status: 'awaiting_verification', uploadedBy: 'Amina' });
      expect(documents.file(zm.entityId, doc.documentId)).toMatchObject({ intact: true, fingerprint: doc.fingerprint });

      const textAsPdf = `data:application/pdf;base64,${Buffer.from('just some words, not a pdf').toString('base64')}`;
      expect(() => documents.upload({ entityId: zm.entityId, kind: 'other', title: 'Fake', dataUrl: textAsPdf, by: 'Amina' })).toThrow(/not really a document/);
    });

    it('counts a document only once a DIFFERENT person verifies it', () => {
      const zm = entities.createCompany({ kind: 'sister', jurisdiction: 'ZM', name: 'SeeBuyGet Zambia' }, 'Amina');
      const doc = documents.upload({ entityId: zm.entityId, kind: 'certificate_of_incorporation', title: 'Certificate', dataUrl: pdfDataUrl('c'), by: 'Amina' });
      expect(() => documents.verify(zm.entityId, doc.documentId, 'amina')).toThrow(/different person must verify/);
      expect(documents.verify(zm.entityId, doc.documentId, 'Brian')).toMatchObject({ status: 'verified', verifiedBy: 'Brian' });
      expect(documents.isVerified(zm.entityId, 'certificate_of_incorporation')).toBe(true);
      expect(() => documents.reject(zm.entityId, doc.documentId, 'Brian')).toThrow(/Say why/);
    });

    it('tells the uploader from the verifier by ACCOUNT where there is one, and by name where there is not', () => {
      const zm = entities.createCompany({ kind: 'sister', jurisdiction: 'ZM', name: 'SeeBuyGet Zambia' }, 'Amina');
      const doc = documents.upload({ entityId: zm.entityId, kind: 'certificate_of_incorporation', title: 'Certificate', dataUrl: pdfDataUrl('by-account'), by: 'Sam Otieno', byKey: 'operator:opr_1' });
      // The same account, whatever name is typed beside it.
      expect(() => documents.verify(zm.entityId, doc.documentId, 'Another Name', undefined, 'operator:opr_1')).toThrow(/different person must verify/);
      expect(documents.uploadedByReader(doc, { name: 'Another Name', key: 'operator:opr_1' })).toBe(true);
      expect(documents.uploadedByReader(doc, { name: 'Sam Otieno', key: 'operator:opr_2' })).toBe(false);
      // The account is kept beside the paper, never on it: the company reads its papers whole.
      expect(JSON.stringify(documents.list(zm.entityId))).not.toContain('opr_1');
      // A colleague with the very same name is another person.
      expect(documents.verify(zm.entityId, doc.documentId, 'Sam Otieno', undefined, 'operator:opr_2')).toMatchObject({ status: 'verified', verifiedBy: 'Sam Otieno' });

      // No account on the record (a name typed on a laptop, or a paper from before accounts were kept): the name decides.
      const old = documents.upload({ entityId: zm.entityId, kind: 'tax_registration_certificate', title: 'Tax', dataUrl: pdfDataUrl('by-name'), by: 'Amina' });
      expect(() => documents.verify(zm.entityId, old.documentId, ' amina ', undefined, 'operator:opr_7')).toThrow(/different person must verify/);
      expect(documents.uploadedByReader(old, { name: 'AMINA', key: 'operator:opr_7' })).toBe(true);
      expect(documents.verify(zm.entityId, old.documentId, 'Brian', undefined, 'operator:opr_7').status).toBe('verified');
    });

    it('keeps every version: a replacement supersedes, and the same file twice is refused', () => {
      const zm = entities.createCompany({ kind: 'sister', jurisdiction: 'ZM', name: 'SeeBuyGet Zambia' }, 'Amina');
      const first = documents.upload({ entityId: zm.entityId, kind: 'licence', relatesTo: 'C-1', title: 'Courier licence', dataUrl: pdfDataUrl('v1'), by: 'Amina' });
      expect(() => documents.upload({ entityId: zm.entityId, kind: 'licence', relatesTo: 'C-1', title: 'Again', dataUrl: pdfDataUrl('v1'), by: 'Amina' })).toThrow(/already on record as version 1/);
      const second = documents.upload({ entityId: zm.entityId, kind: 'licence', relatesTo: 'c-1', title: 'Renewed', dataUrl: pdfDataUrl('v2'), by: 'Amina' });
      expect(second.version).toBe(2);
      const all = documents.list(zm.entityId);
      expect(all.find((d) => d.documentId === first.documentId)).toMatchObject({ status: 'superseded', supersededBy: second.documentId });
      expect(documents.currentOf(zm.entityId, 'licence', 'C-1')?.documentId).toBe(second.documentId);
    });
  });

  describe('CA3 + CA8 — ready, or not, and why', () => {
    it('lists what is missing, including what the country itself requires', () => {
      const zm = entities.createCompany({ kind: 'sister', jurisdiction: 'ZM', name: 'SeeBuyGet Zambia' }, 'Amina');
      const before = readiness.readinessOf(zm.entityId);
      expect(before.ready).toBe(false);
      const keys = before.items.map((i) => i.key);
      expect(keys).toEqual(expect.arrayContaining(['legal_name', 'signing_authority', 'bank_account', 'doc:certificate_of_incorporation', 'obligation:e_invoicing', 'obligation:data_protection_registration']));

      makeCompanyReady(entities, documents, zm.entityId);
      expect(readiness.readinessOf(zm.entityId).ready).toBe(true);
    });

    it('does not accept a bank account in the wrong money for a company of ours', () => {
      const zm = entities.createCompany({ kind: 'sister', jurisdiction: 'ZM', name: 'SeeBuyGet Zambia' }, 'Amina');
      makeCompanyReady(entities, documents, zm.entityId);
      entities.updateRecord(zm.entityId, { bankAccounts: [{ bankName: 'Bank', accountName: 'X', accountNumber: '1', currency: 'USD' }] }, 'Amina');
      expect(readiness.readinessOf(zm.entityId).items.find((i) => i.key === 'bank_account')?.met).toBe(false);
    });
  });

  describe('CA3 + CA7 — the ladder asks for a real company', () => {
    it('lets a proposal name a draft company, but never SETS established on one that is not active', () => {
      entities.createCompany({ kind: 'sister', jurisdiction: 'ZM', name: 'SeeBuyGet Zambia' }, 'Amina');
      expect(presence.propose({ jurisdiction: 'ZM', level: 'established', by: 'Amina' }).proposal?.status).toBe('pending');
      expect(() => presence.set({ jurisdiction: 'ZM', level: 'established' })).toThrow(/cannot be established/);
      entities.activate('sbg-zm', 'Brian');
      expect(presence.set({ jurisdiction: 'ZM', level: 'established' }).level).toBe('established');
      expect(entities.forJurisdiction('ZM')?.entityId).toBe('sbg-zm');
    });

    it('asks for a partner before Partnered, and a partner is never a party to our books', () => {
      expect(() => presence.propose({ jurisdiction: 'UG', level: 'partnered', by: 'Amina' })).toThrow(/no partner company is recorded/);
      const partner = entities.createCompany({ kind: 'partner', jurisdiction: 'UG', name: 'Kampala Freight Co' }, 'Amina');
      expect(partner.entityId).toBe('partner-ug-kampala-freight-co');
      expect(presence.propose({ jurisdiction: 'UG', level: 'partnered', by: 'Amina' }).proposal).toBeDefined();
      entities.activate(partner.entityId, 'Brian');
      expect(() => entities.requireTransacting(partner.entityId)).toThrow(/partner company/);
      expect(readiness.readinessOf(partner.entityId).items.some((i) => i.key === 'bank_account')).toBe(false);
    });
  });

  describe('CA5 — a lapsed paper switches off what it supported', () => {
    it('stops a country paying claims the day after its goods-in-transit policy expires, and says which policy', () => {
      entities.updateRecord('sbg-ke', { insurance: [{ kind: 'goods_in_transit', insurer: 'Jubilee', policyNumber: 'GIT-9', expiresAt: '2026-09-01' }] }, 'Amina');
      const onTheDay = Date.parse('2026-09-01T12:00:00Z');
      const dayAfter = Date.parse('2026-09-02T00:00:01Z');
      expect(presence.resolve('KE', onTheDay).capabilities.claims).toBe(true);
      const after = presence.resolve('KE', dayAfter);
      expect(after.capabilities.claims).toBe(false);
      expect(after.capabilities.merchantOfRecord).toBe(true); // only what the policy supported
      expect(after.lapses).toEqual([{ capability: 'claims', entityId: 'sbg-ke', source: 'insurance', kind: 'goods_in_transit', reference: 'GIT-9', expiredAt: '2026-09-01' }]);
      expect(presence.coverCeiling('KE', 5000)).toBe(presence.can('KE', 'claims') ? 5000 : 0);
    });

    it('lists what is about to lapse, soonest first, before it does', () => {
      entities.updateRecord(
        'sbg-ke',
        {
          licences: [{ kind: 'courier', number: 'CA-1', issuer: 'Communications Authority', expiresAt: '2026-10-20' }],
          insurance: [{ kind: 'goods_in_transit', insurer: 'Jubilee', policyNumber: 'GIT-9', expiresAt: '2026-09-30' }],
        },
        'Amina',
      );
      const now = Date.parse('2026-09-13T08:00:00Z');
      const soon = entities.expiring(now, 60);
      expect(soon.map((i) => i.reference)).toEqual(['GIT-9', 'CA-1']);
      expect(soon[0]).toMatchObject({ lapsed: false, daysLeft: 17, supports: ['claims'] });
      expect(entities.expiring(now, 10)).toEqual([]);
    });
  });
});
