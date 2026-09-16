import { Test } from '@nestjs/testing';
import { ImportService } from './import.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { DidService } from '../../foundation/did/did.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { EventBus } from '../../foundation/events/event-bus.service';
import { pdfDataUrl } from '../../foundation/entity/company.test-util';

/**
 * CL2a — the importer's papers, and the agent who clears them.
 *
 * The failures worth guarding are all one failure: a paper reaching somebody it was not shared with, or a
 * paper that cannot be relied on being relied on anyway. The user's first container sat at customs for two
 * weeks because a pleasant, reliable agent did not know what that border would ask for — so the tests that
 * matter most are the confinement of a grant, and the moment an agent publishes what they need.
 */
describe('an import consignment, its papers, and the agent who clears them', () => {
  let imports: ImportService;
  let entities: EntityService;
  let documents: CompanyDocumentService;
  let importerId: string;
  let agentId: string;
  let rivalId: string;

  /**
   * Every upload gets distinct bytes. Not a convenience: the register refuses a file whose fingerprint
   * already exists under the same kind, which is right — re-uploading the identical scan is not a new
   * version of anything. A reissued licence really is a different document, so the test has to make one.
   */
  let uploads = 0;
  const paper = (entityId: string, kind: string, title: string, over: { relatesTo?: string; expiresAt?: string } = {}) =>
    documents.upload({ entityId, kind, title, dataUrl: pdfDataUrl(`${entityId}:${title}:${over.relatesTo ?? ''}:${(uploads += 1)}`), ...over, by: 'Hans' });

  const register = (over: Record<string, unknown> = {}) =>
    imports.register(
      { importerEntityId: importerId, goodsDescription: 'Factory plant, 20ft', originCountry: 'NL', destCountry: 'ET', destPort: 'Djibouti', ...over } as never,
      'Hans',
    );

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      // Hand-listed, which is the very shape that once let 856 green tests sit over an app that could not
      // boot — so `app.boot.spec.ts` is what actually proves this service resolves in the real module, and
      // this list exists only to get an instance to exercise.
      providers: [ImportService, EntityService, CompanyDocumentService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    documents = moduleRef.get(CompanyDocumentService);
    imports = moduleRef.get(ImportService);
    importerId = entities.createCompany({ kind: 'partner', jurisdiction: 'et', name: 'Yukel Trading' }, 'Amina').entityId;
    agentId = entities.createCompany({ kind: 'partner', jurisdiction: 'et', name: 'Addis Clearing' }, 'Amina').entityId;
    rivalId = entities.createCompany({ kind: 'partner', jurisdiction: 'et', name: 'Other Clearing' }, 'Amina').entityId;
  });

  describe('the container exists before it arrives', () => {
    it('records one, codes it, and leaves the carrier seam empty because nothing fills it', () => {
      const one = register({ containerNo: 'mscu1234567', carrierRef: 'BL-99' });
      expect(one).toMatchObject({ code: 'IMP-001', status: 'open', importerEntityId: importerId, containerNo: 'MSCU1234567', destPort: 'Djibouti' });
      expect(one.agentEntityId).toBeUndefined();
      // The seam: a reference the importer typed is kept, and NOTHING has filled an arrival.
      expect(one.carrierRef).toBe('BL-99');
      expect(one.etaAt).toBeUndefined();
      expect(one.etaSource).toBeUndefined();
      // An eta somebody types says so — `manual` is the only source anything writes today.
      expect(register({ etaAt: '2026-11-01' })).toMatchObject({ code: 'IMP-002', etaAt: '2026-11-01', etaSource: 'manual' });
    });

    it('refuses what an agent could not act on, in words that say what is missing', () => {
      expect(() => register({ goodsDescription: '  ' })).toThrow(/what is in the container/);
      expect(() => register({ destPort: '' })).toThrow(/where it is cleared/);
      expect(() => register({ destCountry: 'Ethiopia' })).toThrow(/two-letter country code/);
      expect(() => register({ etaAt: 'soon' })).toThrow(/YYYY-MM-DD/);
    });
  });

  describe('the missing primitive: a reader', () => {
    it('shares nothing until an agent is appointed, and then only what the two grants reach', () => {
      const one = register();
      const two = register({ goodsDescription: 'Fertilizer' });
      const licence = paper(importerId, 'licence', 'Investment licence'); // a COMPANY paper: no relatesTo
      const packingOne = paper(importerId, 'packing_list', 'Packing list IMP-001', { relatesTo: one.code });
      const packingTwo = paper(importerId, 'packing_list', 'Packing list IMP-002', { relatesTo: two.code });

      // Before any appointment the agent is an onlooker, and somebody else's container is simply absent.
      expect(() => imports.detail(one.importId, agentId)).toThrow(/No such consignment/);

      imports.appoint(one.importId, agentId, importerId, 'Hans');
      const seen = imports.detail(one.importId, agentId).documents.map((d) => d.documentId);

      // The standing grant reaches the company papers; the per-consignment grant reaches THIS container's.
      expect(seen).toContain(licence.documentId);
      expect(seen).toContain(packingOne.documentId);
      // And the confinement that matters: the other container's papers are NOT reachable.
      expect(seen).not.toContain(packingTwo.documentId);
      expect(() => imports.detail(two.importId, agentId)).toThrow(/No such consignment/);
      expect(() => imports.readableDocument(one.importId, agentId, packingTwo.documentId)).toThrow(/not shared with you/);
      // A different agent entirely reaches none of it.
      expect(() => imports.readableDocument(one.importId, rivalId, licence.documentId)).toThrow(/not shared with you/);
    });

    it('revokes immediately, keeps the grant on the record, and leaves the published list behind', () => {
      const one = register();
      paper(importerId, 'licence', 'Investment licence');
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      imports.publishRequired(one.importId, agentId, [{ label: 'Investment licence' }], 'Selam');

      imports.revoke(one.importId, importerId, 'Hans', 'Appointed somebody closer to the port');
      expect(() => imports.detail(one.importId, agentId)).toThrow(/No such consignment/);

      const after = imports.detail(one.importId, importerId);
      expect(after.status).toBe('open');
      expect(after.agentEntityId).toBeUndefined();
      // Kept, never deleted: "who could see our invoices in March" stays answerable.
      expect(after.grants).toHaveLength(2);
      expect(after.grants.every((g) => g.revokedAt && g.revokedReason === 'Appointed somebody closer to the port')).toBe(true);
      // The knowledge survives the appointment — the importer does not start again with the next agent.
      expect(after.required.map((r) => r.key)).toEqual(['investment_licence']);
    });

    it('does not take the company papers back while that agent is still clearing another container', () => {
      // The standing grant is shared with the AGENT, not with the container. Revoking one appointment used
      // to reach across and cut their access to a consignment nobody had touched — silently.
      const one = register();
      const two = register({ goodsDescription: 'Fertilizer' });
      const licence = paper(importerId, 'licence', 'Investment licence');
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      imports.appoint(two.importId, agentId, importerId, 'Hans');
      // One agent, one standing grant, however many containers they clear.
      expect(imports.detail(one.importId, importerId).grants.filter((g) => g.scope === 'company' && !g.revokedAt)).toHaveLength(1);

      imports.revoke(one.importId, importerId, 'Hans');
      expect(() => imports.detail(one.importId, agentId)).toThrow(/No such consignment/);
      expect(imports.detail(two.importId, agentId).documents.map((d) => d.documentId)).toContain(licence.documentId);

      // And when the last appointment ends, the company papers really are taken back.
      imports.revoke(two.importId, importerId, 'Hans');
      expect(() => imports.detail(two.importId, agentId)).toThrow(/No such consignment/);
      expect(imports.detail(two.importId, importerId).grants.every((g) => g.revokedAt)).toBe(true);
    });

    it('refuses a shared login by making an appointment the only way in, and will not swap an agent silently', () => {
      const one = register();
      expect(() => imports.appoint(one.importId, importerId, importerId, 'Hans')).toThrow(/appointing yourself grants nothing/);
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      expect(() => imports.appoint(one.importId, rivalId, importerId, 'Hans')).toThrow(/Revoke that appointment first/);
      // The agent cannot appoint, and cannot revoke: the goods are the importer's, and so is the decision.
      expect(() => imports.appoint(one.importId, rivalId, agentId, 'Selam')).toThrow(/the importer’s/);
      expect(() => imports.revoke(one.importId, agentId, 'Selam')).toThrow(/the importer’s/);
    });
  });

  describe('the agent publishes, and we never assert', () => {
    it('keeps what the importer already supplied when the agent republishes, and lets new wording win', () => {
      const one = register();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      imports.publishRequired(one.importId, agentId, [{ label: 'Investment licence', copies: 10 }, { label: 'Packing list' }], 'Selam');
      const licence = paper(importerId, 'licence', 'Investment licence');
      imports.supply(one.importId, importerId, 'investment_licence', licence.documentId, 'Hans');

      // The agent remembers a third paper — the fertilizer case — and tidies their own wording.
      const after = imports.publishRequired(
        one.importId,
        agentId,
        [{ label: 'Investment licence' }, { label: 'Packing list' }, { label: 'Ministry of Agriculture permit', note: 'For the fertilizer' }],
        'Selam',
      );
      const licenceLine = after.required.find((r) => r.key === 'investment_licence')!;
      expect(licenceLine.state).toBe('supplied');
      expect(licenceLine.documentId).toBe(licence.documentId);
      // The agent's latest publication is authoritative for their own wording: ten copies really was dropped.
      expect(licenceLine.copies).toBeUndefined();
      expect(after.required.map((r) => r.key)).toEqual(['investment_licence', 'packing_list', 'ministry_of_agriculture_permit']);
      expect(after.asked).toBe(3);
      expect(after.accepted).toBe(0);
    });

    it('refuses an empty list, a duplicate line and a nonsense copy count', () => {
      const one = register();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      expect(() => imports.publishRequired(one.importId, agentId, [], 'Selam')).toThrow(/at least one paper/);
      expect(() => imports.publishRequired(one.importId, agentId, [{ label: 'Invoice' }, { label: 'invoice' }], 'Selam')).toThrow(/on the list twice/);
      expect(() => imports.publishRequired(one.importId, agentId, [{ label: 'Invoice', copies: 0 }], 'Selam')).toThrow(/between 1 and 50/);
    });

    it('keeps each side to its own act: the importer supplies, the agent ticks off', () => {
      const one = register();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      imports.publishRequired(one.importId, agentId, [{ label: 'Invoice' }], 'Selam');
      const invoice = paper(importerId, 'commercial_invoice', 'Invoice 1', { relatesTo: one.code });

      expect(() => imports.publishRequired(one.importId, importerId, [{ label: 'Anything' }], 'Hans')).toThrow(/Only the agent appointed/);
      expect(() => imports.supply(one.importId, agentId, 'invoice', invoice.documentId, 'Selam')).toThrow(/the importer’s/);
      expect(() => imports.accept(one.importId, importerId, 'invoice', 'Hans')).toThrow(/Only the agent appointed/);

      imports.supply(one.importId, importerId, 'invoice', invoice.documentId, 'Hans');
      const accepted = imports.accept(one.importId, agentId, 'invoice', 'Selam');
      expect(accepted.required[0]).toMatchObject({ state: 'accepted', acceptedBy: 'Selam' });
      expect(accepted.accepted).toBe(1);
    });

    it('sends a paper back only with a reason, and a fresh paper clears the old decision', () => {
      const one = register();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      imports.publishRequired(one.importId, agentId, [{ label: 'Invoice' }], 'Selam');
      const first = paper(importerId, 'commercial_invoice', 'Invoice 1', { relatesTo: one.code });
      imports.supply(one.importId, importerId, 'invoice', first.documentId, 'Hans');

      expect(() => imports.reject(one.importId, agentId, 'invoice', 'Selam')).toThrow(/Say why/);
      const rejected = imports.reject(one.importId, agentId, 'invoice', 'Selam', 'The consignee name is spelled wrong');
      expect(rejected.required[0]).toMatchObject({ state: 'rejected', rejectionReason: 'The consignee name is spelled wrong' });
      expect(rejected.waitingOnYou).toBe(0); // read as the AGENT: it is back with the importer now

      const second = paper(importerId, 'commercial_invoice', 'Invoice 2', { relatesTo: one.code });
      const resupplied = imports.supply(one.importId, importerId, 'invoice', second.documentId, 'Hans');
      // A replacement gets a fresh look: showing the importer a refusal of a paper nobody read would be a lie.
      expect(resupplied.required[0]).toMatchObject({ state: 'supplied' });
      expect(resupplied.required[0].rejectionReason).toBeUndefined();
    });
  });

  describe('a paper that cannot be relied on says so before it is relied on', () => {
    it('refuses to accept one whose expiry has passed, and names the date', () => {
      const one = register();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      imports.publishRequired(one.importId, agentId, [{ label: 'Investment licence' }], 'Selam');
      const lapsed = paper(importerId, 'licence', 'Investment licence', { expiresAt: '2020-01-01' });
      const supplied = imports.supply(one.importId, importerId, 'investment_licence', lapsed.documentId, 'Hans');
      expect(supplied.required[0].expired).toBe(true);
      expect(() => imports.accept(one.importId, agentId, 'investment_licence', 'Selam')).toThrow(/expired on 2020-01-01/);
    });

    it('does not silently follow a replaced version — the agent is told the paper moved', () => {
      const one = register();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      imports.publishRequired(one.importId, agentId, [{ label: 'Packing list' }], 'Selam');
      const v1 = paper(importerId, 'packing_list', 'Packing list', { relatesTo: one.code });
      imports.supply(one.importId, importerId, 'packing_list', v1.documentId, 'Hans');
      paper(importerId, 'packing_list', 'Packing list', { relatesTo: one.code }); // v2 supersedes v1

      const seen = imports.detail(one.importId, agentId).required[0];
      expect(seen.stale).toBe(true);
      expect(() => imports.accept(one.importId, agentId, 'packing_list', 'Selam')).toThrow(/replaced since it was attached/);
      // And the importer cannot attach a superseded version in the first place.
      expect(() => imports.supply(one.importId, importerId, 'packing_list', v1.documentId, 'Hans')).toThrow(/has been replaced/);
    });
  });

  describe('what a border actually asked for, dated and attributed', () => {
    it('accumulates only from agents clearing real containers, and never inflates on a republish', () => {
      const one = register();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      imports.publishRequired(one.importId, agentId, [{ label: 'Investment licence' }, { label: 'Ministry of Agriculture permit' }], 'Selam');
      // Republishing the same keys must not make it look as though the border asked twice.
      imports.publishRequired(one.importId, agentId, [{ label: 'Investment licence' }, { label: 'Ministry of Agriculture permit' }], 'Selam');

      const known = imports.knownPapers('ET', 'Djibouti');
      expect(known.map((k) => k.key).sort()).toEqual(['investment_licence', 'ministry_of_agriculture_permit']);
      expect(known.every((k) => k.agents === 1 && k.times === 1)).toBe(true);
      expect(known[0].lastAskedAt).toBeTruthy();

      // A second container, a second agent, same port: the count is of COMPANIES that asked, not of containers.
      const two = register({ goodsDescription: 'Fertilizer' });
      imports.appoint(two.importId, rivalId, importerId, 'Hans');
      imports.publishRequired(two.importId, rivalId, [{ label: 'Investment licence' }], 'Dawit');
      const again = imports.knownPapers('ET', 'Djibouti').find((k) => k.key === 'investment_licence')!;
      expect(again).toMatchObject({ agents: 2, times: 2 });

      // Another port is another border: nothing carries across.
      expect(imports.knownPapers('ET', 'Modjo')).toEqual([]);
      expect(imports.knownPapers('KE')).toEqual([]);
    });
  });

  describe('what is waiting on whom', () => {
    it('counts the importer’s unsupplied lines and the agent’s untouched ones, and owes an onlooker nothing', () => {
      const one = register();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      imports.publishRequired(one.importId, agentId, [{ label: 'Invoice' }, { label: 'Packing list' }], 'Selam');
      const invoice = paper(importerId, 'commercial_invoice', 'Invoice', { relatesTo: one.code });
      imports.supply(one.importId, importerId, 'invoice', invoice.documentId, 'Hans');

      // One supplied and waiting on the agent; one still waiting on the importer.
      expect(imports.detail(one.importId, importerId).waitingOnYou).toBe(1);
      expect(imports.detail(one.importId, agentId).waitingOnYou).toBe(1);
      expect(imports.outstandingFor(importerId)).toBe(1);
      expect(imports.outstandingFor(agentId)).toBe(1);

      // Network staff read over the shoulder: a party to nothing, owed nothing, acting on nothing.
      const asStaff = imports.detail(one.importId, '', { all: true });
      expect(asStaff.youAre).toBe('onlooker');
      expect(asStaff.waitingOnYou).toBe(0);
      expect(imports.list('', { all: true })).toHaveLength(1);
    });
  });
});
