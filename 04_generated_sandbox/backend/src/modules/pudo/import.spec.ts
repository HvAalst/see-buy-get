import { Test } from '@nestjs/testing';
import { ImportService } from './import.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { DidService } from '../../foundation/did/did.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { DispatchService } from './dispatch.service';
import { ContainerBoxService } from './container-box.service';
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
  let presence: PresenceService;
  let books: BooksService;
  let importerId: string;
  let agentId: string;
  let rivalId: string;
  /** Every load handed to the freight machinery, so the test can check WHAT was handed over. */
  let minted: Array<Record<string, unknown>>;
  /**
   * When each minted leg was actually PICKED UP — which is the box's out-gate.
   *
   * Held by the test rather than set by the service, because that is precisely the point: detention starts
   * when a driver takes the box away, not when somebody posted the load. The test moves the pickup and
   * watches the clock follow it.
   */
  let pickups: Record<string, string>;

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
    minted = [];
    pickups = {};
    const moduleRef = await Test.createTestingModule({
      // Hand-listed, which is the very shape that once let 856 green tests sit over an app that could not
      // boot — so `app.boot.spec.ts` is what actually proves this service resolves in the real module, and
      // this list exists only to get an instance to exercise.
      providers: [
        ImportService,
        ContainerBoxService,
        EntityService,
        CompanyDocumentService,
        DidService,
        LedgerService,
        EventBus,
        PresenceService,
        BooksService,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        // The freight machinery is at the EDGE of this slice: CL2b hands it one load and keeps the id it
        // gives back. Standing up the whole dispatch tree here would be testing another module through this
        // one; what it must actually do is prove we hand over the right load and store what comes back.
        {
          provide: DispatchService,
          useValue: {
            registerFreight: (input: Record<string, unknown>) => {
              minted.push(input);
              return { freightId: `frt_${minted.length}`, code: `FRT-${minted.length}` };
            },
            // The out-gate is DERIVED from the leg's pickup, so the stub has to be able to answer for one.
            requireFreightPublic: (freightId: string) => ({ freightId, pickedUpAt: pickups[freightId] }),
          },
        },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    documents = moduleRef.get(CompanyDocumentService);
    presence = moduleRef.get(PresenceService);
    books = moduleRef.get(BooksService);
    imports = moduleRef.get(ImportService);
    // Ethiopia can bill and pay out, so the money tests are about the money rather than about presence.
    // The tests that care about presence say so by turning one of these off.
    presence.set({ jurisdiction: 'ET', level: 'established', overrides: { merchantOfRecord: true, payouts: true } } as never);
    importerId = entities.createCompany({ kind: 'partner', jurisdiction: 'et', name: 'Yukel Trading' }, 'Amina').entityId;
    agentId = entities.createCompany({ kind: 'partner', jurisdiction: 'et', name: 'Addis Clearing' }, 'Amina').entityId;
    rivalId = entities.createCompany({ kind: 'partner', jurisdiction: 'et', name: 'Other Clearing' }, 'Amina').entityId;
  });

  describe('the container exists before it arrives', () => {
    it('records one, codes it, and leaves the carrier seam empty because nothing fills it', () => {
      const one = register({ containerNo: 'mscu1234566', carrierRef: 'BL-99' });
      expect(one).toMatchObject({ code: 'IMP-001', status: 'open', importerEntityId: importerId, containerNo: 'MSCU1234566', destPort: 'Djibouti' });
      expect(one.agentEntityId).toBeUndefined();
      // The seam: a reference the importer typed is kept, and NOTHING has filled an arrival.
      expect(one.carrierRef).toBe('BL-99');
      expect(one.etaAt).toBeUndefined();
      expect(one.etaSource).toBeUndefined();
      // An eta somebody types says so — `manual` is the only source anything writes today.
      expect(register({ etaAt: '2026-11-01' })).toMatchObject({ code: 'IMP-002', etaAt: '2026-11-01', etaSource: 'manual' });
    });

    it('refuses what an agent could not act on, in words that say what is missing', () => {
      expect(() => register({ goodsDescription: '  ' })).toThrow(/what is in it/);
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

  describe('paying the agent', () => {
    const appointed = () => {
      const one = register();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      return one;
    };

    it('quotes, agrees, receives — and the network earns nothing from it', () => {
      const one = appointed();
      const quoted = imports.quoteFee(one.importId, agentId, 4500, 'Port dues and our attendance', 'Selam');
      expect(quoted.feeState).toBe('quoted');
      expect(quoted.fee).toMatchObject({ amount: 4500, quotedBy: 'Selam', note: 'Port dues and our attendance' });
      expect(imports.acceptFee(one.importId, importerId, 'Hans').feeState).toBe('accepted');

      const paid = imports.recordFeeReceipt(one.importId, 'MPESA-XYZ-1', 'Amina');
      expect(paid.feeState).toBe('paid');
      expect(paid.fee).toMatchObject({ reference: 'MPESA-XYZ-1', recordedBy: 'Amina' });

      // Cash in, and the same amount owed onward to the AGENT — and no third line anywhere. "The network
      // earns nothing from an appointment" is a condition of this epic, so it is asserted, not assumed.
      const sister = entities.requireForJurisdiction('ET');
      const agentDid = entities.get(agentId).did;
      const entry = books.journal({ entityId: sister.entityId, ref: one.code })[0];
      expect(entry.lines).toHaveLength(2);
      // A stored line carries an accountId rather than a code, so the claim is made where it is legible:
      // nowhere in this sister's book did receiving somebody else's fee put anything into revenue.
      expect(books.trialBalance(sister.entityId).some((a) => String(a.code).startsWith('revenue') && a.balance !== 0)).toBe(false);
      expect(books.balance(sister.entityId, ACCOUNT_CODES.PAYABLE_PROVIDER, undefined, agentDid)).toBe(-4500);
      expect(books.balances(sister.entityId).balanced).toBe(true);
    });

    it('keeps each side to its own act, and will not receive money nobody agreed to', () => {
      const one = appointed();
      expect(() => imports.quoteFee(one.importId, importerId, 100, undefined, 'Hans')).toThrow(/Only the agent appointed/);
      expect(() => imports.recordFeeReceipt(one.importId, 'REF', 'Amina')).toThrow(/No fee has been quoted/);

      imports.quoteFee(one.importId, agentId, 100, undefined, 'Selam');
      expect(() => imports.acceptFee(one.importId, agentId, 'Selam')).toThrow(/the importer’s/);
      // Agreed by nobody yet: receiving money against it would be recording a debt the payer never accepted.
      expect(() => imports.recordFeeReceipt(one.importId, 'REF', 'Amina')).toThrow(/not been agreed/);

      imports.acceptFee(one.importId, importerId, 'Hans');
      // Money is never created on somebody saying so — the reference is the observed external event.
      expect(() => imports.recordFeeReceipt(one.importId, '  ', 'Amina')).toThrow(/needs the reference/);
      imports.recordFeeReceipt(one.importId, 'REF-1', 'Amina');
      expect(() => imports.recordFeeReceipt(one.importId, 'REF-2', 'Amina')).toThrow(/already received/);
      expect(() => imports.quoteFee(one.importId, agentId, 200, undefined, 'Selam')).toThrow(/already been paid/);
    });

    it('drops an earlier agreement when the agent re-quotes, so nobody is held to a price they never saw', () => {
      const one = appointed();
      imports.quoteFee(one.importId, agentId, 100, undefined, 'Selam');
      imports.acceptFee(one.importId, importerId, 'Hans');
      const requoted = imports.quoteFee(one.importId, agentId, 250, undefined, 'Selam');
      expect(requoted.feeState).toBe('quoted');
      expect(requoted.fee).toMatchObject({ amount: 250 });
      // toMatchObject with an undefined value asks for the key to EXIST holding undefined; the agreement is
      // genuinely gone, so it is asserted as absence.
      expect(requoted.fee?.acceptedAt).toBeUndefined();
    });

    it('says at the START that we cannot be the one who bills, and refuses the receipt in the country’s own words', () => {
      // Where we only match, we cannot charge customers — the rule this slice was told to respect.
      presence.set({ jurisdiction: 'ET', level: 'matched' } as never);
      const one = appointed();
      const view = imports.detail(one.importId, importerId);
      expect(view.money.canBill).toBe(false);
      expect(view.money.why).toMatch(/settled directly between you and them/);

      // Quoting and agreeing still work: what two companies agree between them is theirs to agree.
      imports.quoteFee(one.importId, agentId, 100, undefined, 'Selam');
      imports.acceptFee(one.importId, importerId, 'Hans');
      expect(() => imports.recordFeeReceipt(one.importId, 'REF-1', 'Amina')).toThrow(/cannot charge customers/);
    });
  });

  describe('the road leg from the port', () => {
    it('mints one load from the port with no shipper on it, and refuses a second', () => {
      const one = register({ destPort: 'Djibouti' });
      const out = imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.14 }, destLabel: 'Addis Ababa yard', weightKg: 12000 }, 'Hans');
      expect(out.roadFreightCode).toBe('FRT-1');
      expect(minted).toHaveLength(1);
      expect(minted[0]).toMatchObject({
        pickupLabel: 'Djibouti',
        destLabel: 'Addis Ababa yard',
        weightKg: 12000,
        // Both ends inland of the same border: the sea leg that brought it is not ours and is not modelled.
        pickupCountry: 'ET',
        destCountry: 'ET',
        externalOrderId: one.code,
        postedByDid: entities.get(importerId).did,
      });
      // Off-platform settlement, exactly as the consolidation lot does it.
      expect(minted[0].shipperDid).toBeUndefined();
      expect(String(minted[0].description)).toContain(one.code);
      expect(() => imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.14 }, destLabel: 'Anywhere', weightKg: 1 }, 'Hans')).toThrow(/already has a road leg/);
    });

    it('is the importer’s to mint, and refuses a load with nothing to carry or nowhere to go', () => {
      const one = register();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      expect(() => imports.mintRoadLeg(one.importId, agentId, { pickupLocation: { lat: 1, lng: 1 }, destLabel: 'X', weightKg: 1 }, 'Selam')).toThrow(/the importer’s/);
      expect(() => imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 1, lng: 1 }, destLabel: '  ', weightKg: 1 }, 'Hans')).toThrow(/where the container is going/);
      expect(() => imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 1, lng: 1 }, destLabel: 'X', weightKg: 0 }, 'Hans')).toThrow(/what the load weighs/);
      expect(minted).toHaveLength(0);
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

  /**
   * CL4 — WHAT THE STATE DID, which is the half of an agent's record that is not their doing.
   *
   * The whole risk of this field is that it is a free excuse box, written by the party it excuses. So the
   * guards worth having are about the OTHER party: that they see it at once, that they can answer beside
   * it, that answering never deletes anything, and that a dispute has to carry words somebody can weigh.
   */
  describe('what the state did to a container', () => {
    const appointed = () => {
      const one = register();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      return one;
    };

    it('lets the agent record a hold, and the importer sees it immediately', () => {
      const one = appointed();
      const after = imports.recordCustomsHold(one.importId, agentId, { kind: 'physical_exam', note: 'Selected for scanning' }, 'Selam');
      expect(after.customsHolds).toHaveLength(1);
      expect(after.customsHolds[0]).toMatchObject({ kind: 'physical_exam', recordedBy: agentId });
      // Not a private note: a claim made about a delay the importer is living through must be visible to them.
      expect(imports.detail(one.importId, importerId).customsHolds[0].accounts[0]).toMatchObject({ stance: 'happened', note: 'Selected for scanning' });
    });

    it('lets the importer answer it, and the original account SURVIVES', () => {
      const one = appointed();
      const hold = imports.recordCustomsHold(one.importId, agentId, { kind: 'queue' }, 'Selam').customsHolds[0];
      const after = imports.answerCustomsHold(one.importId, importerId, hold.holdId, 'disputed', 'They had not filed by then', 'Hans');

      const accounts = after.customsHolds[0].accounts;
      expect(accounts).toHaveLength(2);
      expect(accounts[0].stance).toBe('happened'); // never erased, never edited
      expect(accounts[1]).toMatchObject({ stance: 'disputed', note: 'They had not filed by then' });
    });

    it('refuses a dispute with no words — nobody can weigh a bare contradiction', () => {
      const one = appointed();
      const hold = imports.recordCustomsHold(one.importId, agentId, { kind: 'queue' }, 'Selam').customsHolds[0];
      expect(() => imports.answerCustomsHold(one.importId, importerId, hold.holdId, 'disputed', '  ', 'Hans')).toThrow(/Say what you say happened/);
    });

    it('does not turn one party changing their mind into two witnesses', () => {
      const one = appointed();
      const hold = imports.recordCustomsHold(one.importId, agentId, { kind: 'queue' }, 'Selam').customsHolds[0];
      imports.answerCustomsHold(one.importId, importerId, hold.holdId, 'disputed', 'Not what happened', 'Hans');
      const after = imports.answerCustomsHold(one.importId, importerId, hold.holdId, 'happened', 'I was wrong, they were held', 'Hans');
      expect(after.customsHolds[0].accounts).toHaveLength(2);
      expect(after.customsHolds[0].accounts[1]).toMatchObject({ stance: 'happened', note: 'I was wrong, they were held' });
    });

    it('is a stranger’s business in no way at all', () => {
      const one = appointed();
      expect(() => imports.recordCustomsHold(one.importId, rivalId, { kind: 'queue' }, 'Rival')).toThrow(/No such consignment/);
    });

    it('records a release once, and never before the hold began', () => {
      const one = appointed();
      const hold = imports.recordCustomsHold(one.importId, agentId, { kind: 'physical_exam', at: '2026-09-10T08:00:00.000Z' }, 'Selam').customsHolds[0];
      expect(() => imports.releaseCustomsHold(one.importId, agentId, hold.holdId, '2026-09-09T08:00:00.000Z')).toThrow(/cannot be released before/);
      const after = imports.releaseCustomsHold(one.importId, agentId, hold.holdId, '2026-09-12T08:00:00.000Z');
      expect(after.customsHolds[0].releasedAt).toBe('2026-09-12T08:00:00.000Z');
      // A release date that moves is not a record of anything.
      expect(() => imports.releaseCustomsHold(one.importId, agentId, hold.holdId, '2026-09-13T08:00:00.000Z')).toThrow(/already recorded as released/);
    });

    it('carries the holds into the agent’s record without touching one figure they control', () => {
      const one = appointed();
      imports.publishRequired(one.importId, agentId, [{ label: 'Invoice' }], 'Selam');
      const invoice = paper(importerId, 'commercial_invoice', 'Invoice', { relatesTo: one.code });
      imports.supply(one.importId, importerId, 'invoice', invoice.documentId, 'Hans');
      imports.accept(one.importId, agentId, 'invoice', 'Selam');
      const before = imports.agentRecord(agentId);

      imports.recordCustomsHold(one.importId, agentId, { kind: 'inspection_selected' }, 'Selam');
      const after = imports.agentRecord(agentId);

      expect(after.holds).toEqual({ containers: 1, recorded: 1, disputed: 0, kinds: [{ key: 'inspection_selected', times: 1 }] });
      // Everything the agent controls is untouched: a hold is context a reader weighs, never arithmetic.
      expect({ ...after, holds: null }).toEqual({ ...before, holds: null });
    });

    it('carries the mode, so an agent who clears air freight is not recorded as clearing containers', () => {
      const air = imports.register({ importerEntityId: importerId, goodsDescription: 'Spares, urgent', originCountry: 'DE', destCountry: 'ET', destPort: 'Bole', mode: 'air' } as never, 'Hans');
      imports.appoint(air.importId, agentId, importerId, 'Hans');
      const modes = imports.agentRecord(agentId).modes;
      expect(modes.find((m) => m.key === 'air')?.appointed).toBe(1);
      // And everything recorded before the field existed is sea BY CONSTRUCTION — the register took
      // nothing else — rather than by a guess about data nobody can check.
      const sea = register();
      imports.appoint(sea.importId, agentId, importerId, 'Hans');
      expect(imports.agentRecord(agentId).modes.find((m) => m.key === 'sea')?.appointed).toBe(1);
    });

    it('makes the agent an agent, and leaves a company that clears nothing alone', () => {
      const one = appointed();
      expect(imports.isAgent(agentId)).toBe(true);
      expect(imports.isAgent(rivalId)).toBe(false);
      expect(imports.agentRecord(agentId).appointed).toBe(1);
      expect(imports.agentRecord(rivalId).appointed).toBe(0);
      expect(imports.agentRecord(agentId).ports).toEqual([{ key: 'Djibouti', appointed: 1, listed: 0, cleared: 0 }]);
      expect(one.code).toMatch(/^IMP-/);
    });
  });

  /**
   * CL7 — AN OPEN TOP IS NOT A HIGH-CUBE, AND A FOOD TANK IS NOT A FUEL TANK.
   *
   * The question these exist for: all four used to produce the same record and then mint the same generic
   * road leg, to be offered to whatever truck was nearest. What is guarded is that the facts now REACH
   * the load, and that the two combinations nobody can honestly offer a truck are refused with a sentence
   * saying which fact is missing.
   */
  describe('what kind of box, and what is in it', () => {
    // What the fake dispatch was actually handed. The point of every test below: before this slice it
    // received a description and a weight, and derived everything else from nothing.
    const mintedLoads = () => minted as Array<Record<string, unknown>>;

    it('derives the box’s facts from its code, and never asks anybody to type them', () => {
      const one = register();
      const after = imports.declareCargo(one.importId, importerId, { containerType: '45g1' }, 'Hans');
      expect(after.containerFacts).toMatchObject({ code: '45G1', lengthFt: 40, openTop: false, kind: 'dry', group: 'general purpose' });
      expect(after.containerFacts!.heightM).toBeCloseTo(2.896, 3);
      expect(after.containerFacts!.bodies).toContain('skeletal');
      expect(after.containerFacts!.heightUnstated).toBe(false);
    });

    it('refuses what is not an ISO code — 45GI is a typo, not a box', () => {
      const one = register();
      expect(() => imports.declareCargo(one.importId, importerId, { containerType: '45GI' }, 'Hans')).toThrow(/not an ISO 6346 code/);
      expect(() => imports.declareCargo(one.importId, importerId, { containerType: '99Z9' }, 'Hans')).toThrow(/not an ISO 6346 code/);
    });

    it('takes ANY code the standard can build, not a shortlist somebody kept', () => {
      // A 30ft ventilated box and a 45ft pallet-wide flat rack were never on the first list, and neither
      // is exotic. "List them all rather" — so the tables are the standard and these simply work.
      const one = register();
      expect(imports.declareCargo(one.importId, importerId, { containerType: '32V0' }, 'Hans').containerFacts).toMatchObject({ lengthFt: 30, kind: 'vented' });
      expect(imports.declareCargo(one.importId, importerId, { containerType: 'LNP3' }, 'Hans').containerFacts).toMatchObject({ lengthFt: 45, palletWide: true });
    });

    it('asks for a measurement where the CODE will not state a height', () => {
      // Four size codes are open ranges — 'taller than 2896 mm' — and the standard stops there. Rather
      // than inventing 2.9 m for a box that is more than 2.9 m, it is refused until somebody measures it.
      const one = register();
      const after = imports.declareCargo(one.importId, importerId, { containerType: '46G1', natureCode: 'GEN' }, 'Hans');
      expect(after.containerFacts!.heightUnstated).toBe(true);
      expect(after.containerFacts!.heightM).toBeUndefined();
      expect(after.cargoGaps.join(' ')).toMatch(/taller than 2.896 m/);
      expect(() => imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.1 }, destLabel: 'Addis', weightKg: 20000 }, 'Hans')).toThrow(/taller than/);
      // Measured, it goes — and the measured figure is what reaches the load.
      imports.declareCargo(one.importId, importerId, { cargoHeightM: 3.05 }, 'Hans');
      expect(imports.detail(one.importId, importerId).cargoGaps).toEqual([]);
      imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.1 }, destLabel: 'Addis', weightKg: 20000 }, 'Hans');
      expect((minted[minted.length - 1] as { heightM?: number }).heightM).toBeCloseTo(3.05, 2);
    });

    it('HANDS THE BOX’S FACTS TO THE ROAD LEG, which used to get a description and a weight', () => {
      const one = register();
      imports.declareCargo(one.importId, importerId, { containerType: '45G1', natureCode: 'GEN' }, 'Hans');
      imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.1 }, destLabel: 'Addis', weightKg: 21000 }, 'Hans');

      const handed = mintedLoads()[0] as Record<string, unknown> & { heightM?: number; indivisible?: boolean; originEquipment?: string[]; destEquipment?: string[]; bodyHint?: string };
      // The height the bridge map has been waiting for since it was built.
      expect(handed.heightM).toBeCloseTo(2.896, 3);
      // A box cannot be split, which is what makes it a permit conversation and not two trips.
      expect(handed.indivisible).toBe(true);
      // And what has to lift it at each end, which was silent before.
      expect(handed.originEquipment).toContain('TLT');
      expect(handed.destEquipment).toContain('TLT');
      expect(handed.bodyHint).toBe('skeletal');
    });

    it('sends an OPEN TOP’s declared cargo height, not the box’s own', () => {
      const one = register();
      imports.declareCargo(one.importId, importerId, { containerType: '42U1', natureCode: 'GEN', cargoHeightM: 3.4 }, 'Hans');
      imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.1 }, destLabel: 'Addis', weightKg: 18000 }, 'Hans');
      // 3.4 m of cargo on an open box, not the 2.59 m of the box it stands in.
      expect(mintedLoads()[0].heightM).toBeCloseTo(3.4, 2);
      expect(imports.detail(one.importId, importerId).containerFacts!.outOfGauge).toBe(true);
    });

    it('will NOT mint an open box whose cargo height nobody has stated', () => {
      const one = register();
      imports.declareCargo(one.importId, importerId, { containerType: '22U1', natureCode: 'GEN' }, 'Hans');
      expect(imports.detail(one.importId, importerId).cargoGaps.join(' ')).toMatch(/no roof/);
      expect(() => imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.1 }, destLabel: 'Addis', weightKg: 9000 }, 'Hans')).toThrow(/no roof/);
    });

    /**
     * THE HALF OF THE QUESTION A CODE CANNOT ANSWER. 22T1 and 22T1: the same box, two movements.
     */
    describe('a food tank and a fuel tank', () => {
      it('refuses a FOOD tank whose last cargo nobody has stated', () => {
        const one = register({ goodsDescription: 'Edible oil, bulk' });
        imports.declareCargo(one.importId, importerId, { containerType: '22T1', natureCode: 'FOD' }, 'Hans');
        expect(imports.detail(one.importId, importerId).cargoGaps.join(' ')).toMatch(/last held/);
        expect(() => imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.1 }, destLabel: 'Addis', weightKg: 20000 }, 'Hans')).toThrow(/carried fuel can never carry food/);
      });

      it('lets it go once the tank’s history is declared, and keeps the certificate on the register', () => {
        const one = register({ goodsDescription: 'Edible oil, bulk' });
        imports.declareCargo(one.importId, importerId, { containerType: '22T1', natureCode: 'FOD' }, 'Hans');
        const cert = paper(importerId, 'other', 'Tank cleaning certificate', { relatesTo: one.code });
        const after = imports.declareCargo(
          one.importId,
          importerId,
          { tank: { lastCargoes: ['Sunflower oil', 'Sunflower oil'], cleanedAt: '2026-09-10', certificateDocumentId: cert.documentId } },
          'Hans',
        );
        expect(after.cargoGaps).toEqual([]);
        expect(after.customsHolds).toEqual([]); // unrelated, and still empty
        expect(imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.1 }, destLabel: 'Addis', weightKg: 20000 }, 'Hans').roadFreightCode).toBeTruthy();
      });

      it('refuses a certificate that is not one of the importer’s own documents', () => {
        const one = register();
        expect(() =>
          imports.declareCargo(one.importId, importerId, { tank: { lastCargoes: ['Crude'], certificateDocumentId: 'doc_nope' } }, 'Hans'),
        ).toThrow(/not one of your own documents/);
      });

      it('refuses HAZARDOUS goods with no UN number, because the truck needs it for its placards', () => {
        const one = register({ goodsDescription: 'Gas oil, bulk' });
        imports.declareCargo(one.importId, importerId, { containerType: '22T1', natureCode: 'HAZ-FLAM' }, 'Hans');
        expect(imports.detail(one.importId, importerId).cargoGaps.join(' ')).toMatch(/UN number/);
        expect(() => imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.1 }, destLabel: 'Addis', weightKg: 24000 }, 'Hans')).toThrow(/placards/);
      });

      it('checks the SHAPE of a UN number and never the choice, then hands the nature to the load', () => {
        const one = register({ goodsDescription: 'Gas oil, bulk' });
        imports.declareCargo(one.importId, importerId, { containerType: '22T1', natureCode: 'HAZ-FLAM' }, 'Hans');
        expect(() => imports.declareCargo(one.importId, importerId, { dangerous: { unNumber: 'diesel', imdgClass: '3' } }, 'Hans')).toThrow(/looks like UN1202/);
        const after = imports.declareCargo(one.importId, importerId, { dangerous: { unNumber: 'un 1202', imdgClass: '3', properShippingName: 'GAS OIL' } }, 'Hans');
        expect(after.cargoGaps).toEqual([]);

        imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.1 }, destLabel: 'Addis', weightKg: 24000 }, 'Hans');
        // The nature is what makes the freight machinery demand a hazmat-certified vehicle, and what the
        // hazard map reads to close a NO_HAZMAT road to it. It was never passed before.
        expect(mintedLoads()[0].natureCode).toBe('HAZ-FLAM');
      });

      it('leaves a tank carrying neither food nor hazmat alone — the gate is about the pairing', () => {
        const one = register({ goodsDescription: 'Glycerine, technical' });
        imports.declareCargo(one.importId, importerId, { containerType: '22T1', natureCode: 'GEN' }, 'Hans');
        expect(imports.detail(one.importId, importerId).cargoGaps).toEqual([]);
      });
    });
  });

  /**
   * CL6 — WHAT AN AGENT SAYS THEY CLEAR, AND FINDING ONE.
   *
   * The user's correction is the whole reason this exists: *"Agents do not just clear containers... Some
   * clear air freight, some vehicles, as their specialisation"* — and finding one is market dynamics, so
   * a directory nobody can search is not a directory.
   *
   * The guards worth having are about the SHAPE of the answer: that it never ranks anybody, that an
   * unchecked claim is never dressed as a finding, and that claiming more cannot buy position.
   */
  describe('what an agent says they clear, and finding one', () => {
    it('is the agent’s own claim, dated and attributed', () => {
      const offer = imports.setOffer(agentId, { specialisms: ['air_freight', 'vehicles'], places: [' Bole ', 'Djibouti', 'Bole'], words: 'Perishables out of Addis' }, 'Selam');
      expect(offer.specialisms).toEqual(['air_freight', 'vehicles']);
      // Labels, trimmed and de-duplicated. We run no ports, so there is nothing to validate against.
      expect(offer.places).toEqual(['Bole', 'Djibouti']);
      expect(offer.saidBy).toBe('Selam');
      expect(offer.saidAt).toBeTruthy();
    });

    it('refuses an entry that names nothing, and drops a specialism nobody offers', () => {
      expect(() => imports.setOffer(agentId, { specialisms: [] }, 'Selam')).toThrow(/at least one thing you clear/);
      expect(() => imports.setOffer(agentId, { specialisms: ['teleportation'] }, 'Selam')).toThrow(/at least one thing you clear/);
    });

    it('finds by what they SAY, because our record cannot answer what the goods were', () => {
      imports.setOffer(agentId, { specialisms: ['livestock'], places: ['Mombasa'] }, 'Selam');
      imports.setOffer(rivalId, { specialisms: ['air_freight'] }, 'Rival');

      expect(imports.findAgents({ specialism: 'livestock' }).map((a) => a.entityId)).toEqual([agentId]);
      expect(imports.findAgents({ specialism: 'air_freight' }).map((a) => a.entityId)).toEqual([rivalId]);
      expect(imports.findAgents({ specialism: 'bonded_transit' })).toEqual([]);
    });

    it('finds by a place they SAY they work, or one we have SEEN them work', () => {
      // Said, and never seen: the agent advertises Mombasa and has cleared nothing there.
      imports.setOffer(agentId, { specialisms: ['sea_container'], places: ['Mombasa'] }, 'Selam');
      expect(imports.findAgents({ place: 'mombasa' }).map((a) => a.entityId)).toEqual([agentId]);

      // Seen, and never said: the rival advertises no place at all but has a real appointment at Djibouti.
      const one = register();
      imports.appoint(one.importId, rivalId, importerId, 'Hans');
      expect(imports.findAgents({ place: 'djibouti' }).map((a) => a.entityId)).toEqual([rivalId]);
    });

    it('carries the claim NEXT TO the record, which is what stops the claim being worth gaming', () => {
      imports.setOffer(agentId, { specialisms: ['sea_container', 'air_freight', 'livestock', 'vehicles'] }, 'Selam');
      const [found] = imports.findAgents({ specialism: 'livestock' });
      // Claiming everything gets you seen. It does not get you credited: the record beside it is empty.
      expect(found.offer?.specialisms).toHaveLength(4);
      expect(found.appointed).toBe(0);
      expect(found.cleared).toBe(0);
      expect(found.thin).toBe(true);
    });

    it('lists an agent we have SEEN even when they have never filled in a form', () => {
      const one = register();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      const found = imports.findAgents({});
      expect(found.map((a) => a.entityId)).toContain(agentId);
      expect(found.find((a) => a.entityId === agentId)?.offer).toBeUndefined();
    });

    it('is ALPHABETICAL and never ranked — advertising more must not move anybody up', () => {
      // The one with the record is deliberately later in the alphabet than the one with none.
      imports.setOffer(rivalId, { specialisms: ['sea_container'] }, 'Rival');
      imports.setOffer(agentId, { specialisms: ['sea_container'] }, 'Selam');
      const one = register();
      imports.appoint(one.importId, rivalId, importerId, 'Hans');

      const found = imports.findAgents({ specialism: 'sea_container' });
      // 'Addis Clearing' has no record; 'Other Clearing' has the appointment. Alphabetically Addis is
      // first, so a list that ranked by work behind it would reverse exactly these two rows.
      expect(found.map((a) => a.name)).toEqual(['Addis Clearing', 'Other Clearing']);
      expect(found[0].appointed).toBe(0);
      expect(found[1].appointed).toBe(1);
    });

    it('keeps a country filter to that country', () => {
      imports.setOffer(agentId, { specialisms: ['sea_container'] }, 'Selam');
      const ke = imports.findAgents({ country: 'KE' });
      const et = imports.findAgents({ country: 'ET' });
      expect(ke.every((a) => a.country === 'KE')).toBe(true);
      expect(et.every((a) => a.country === 'ET')).toBe(true);
    });
  });

  /**
   * Y0 + Y1 — THE BOX IS SOMEBODY ELSE'S PROPERTY, AND A CLOCK RUNS ON IT.
   *
   * CL7 settled how a box is carried; this is the asset nobody was tracking. The failures worth guarding
   * are the silent ones: a mistyped number that still looks like a container number, a clock that would
   * count from a date nobody gave us, and — the user's own correction — a box that was SOLD reading as
   * overdue, which is the false alarm that teaches people to ignore the true one.
   */
  describe('the box is somebody else’s, and a clock runs on it', () => {
    const NO = 'MSCU1234566';

    it('refuses a container number whose check digit does not add up', () => {
      // The arithmetic exists precisely so a typo is detectable, and MSCU1234567 — the number that gets
      // written in examples everywhere, this project's own design note included — is one.
      expect(() => register({ containerNo: 'MSCU1234567' })).toThrow(/checks to 6, not 7/);
      expect(() => register({ containerNo: 'MSCU12345' })).toThrow(/not the shape/);
      // And nothing about whether the box EXISTS: that is the line's business, not ours.
      expect(register({ containerNo: NO }).containerNo).toBe(NO);
    });

    it('derives the box from its number, with no clock running yet', () => {
      const one = register({ containerNo: `mscu 123456-6` });
      const box = imports.detail(one.importId, importerId).box!;
      expect(box).toMatchObject({ containerNo: NO, ownerCode: 'MSCU', category: 'freight container', timesUsed: 1, importCode: one.code });
      // Nothing has happened to it yet, and the honest answer is that nothing is running — not day zero of
      // a countdown whose start we would have had to invent.
      expect(box.clock).toMatchObject({ kind: 'unknown', overdue: false });
      expect(box.clock.dueBackAt).toBeUndefined();
    });

    it('has no box at all until a number is recorded', () => {
      const one = register({});
      expect(imports.detail(one.importId, importerId).box).toBeUndefined();
      // The box IS its number, so there is nothing to keep a clock on and the refusal says so.
      expect(() => imports.recordBoxArrival(one.importId, importerId, '2026-09-10', 'Hans')).toThrow(/no container number yet/);
    });

    it('makes the agent who was appointed the one who owes the return', () => {
      const one = register({ containerNo: NO });
      expect(imports.detail(one.importId, importerId).box!.owedByName).toBeUndefined();
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      // DERIVED from the appointment rather than typed, so it cannot drift from who is actually clearing it.
      expect(imports.detail(one.importId, importerId).box!.owedByName).toBe('Addis Clearing');
      // And the importer still sees the clock, because the charge lands on them.
      expect(imports.detail(one.importId, agentId).box!.owedByName).toBe('Addis Clearing');
    });

    it('starts detention at the driver’s pickup, not at the paperwork', () => {
      const one = register({ containerNo: NO });
      imports.recordBoxArrival(one.importId, importerId, new Date(Date.now() - 6 * 86_400_000).toISOString(), 'Hans');
      expect(imports.detail(one.importId, importerId).box!.clock.kind).toBe('demurrage');

      imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.14 }, destLabel: 'Addis Ababa yard', weightKg: 12000 }, 'Hans');
      // A minted leg is not a gate: the box is still standing in the terminal until a truck takes it, and
      // a typed out-gate date would have been wrong in exactly the cases that matter.
      expect(imports.detail(one.importId, importerId).box!.clock.kind).toBe('demurrage');
      expect(imports.detail(one.importId, importerId).box!.outGatedAt).toBeUndefined();

      pickups['frt_1'] = new Date(Date.now() - 3 * 86_400_000).toISOString();
      const box = imports.detail(one.importId, importerId).box!;
      expect(box.outGatedAt).toBe(pickups['frt_1']);
      expect(box.clock).toMatchObject({ kind: 'detention', daysElapsed: 3, demurrageDays: 3 });
    });

    it('counts to the free days the importer claims, and only the importer may claim them', () => {
      const one = register({ containerNo: NO });
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.14 }, destLabel: 'Addis', weightKg: 12000 }, 'Hans');
      pickups['frt_1'] = new Date(Date.now() - 10 * 86_400_000).toISOString();

      // Nobody has said, so there is no date — the countdown refuses to be invented.
      expect(imports.detail(one.importId, importerId).box!.clock.dueBackAt).toBeUndefined();
      // The free days are in a contract between the importer and the line. The agent is not in a position
      // to state the figure, so they cannot: this is a truthfulness rule, not an access one.
      expect(() => imports.claimBoxFreeDays(one.importId, agentId, 'detention', 14, 'Selam')).toThrow(/importer/);

      const detail = imports.claimBoxFreeDays(one.importId, importerId, 'detention', 14, 'Hans');
      expect(detail.box!.clock).toMatchObject({ freeDays: 14, daysElapsed: 10, daysLeft: 4, overdue: false, freeDaysBy: 'Hans' });
      expect(detail.box!.clock.basis).toContain('Hans says it was given');
      // A correction is a second claim, kept beside the first rather than an edit over it.
      const corrected = imports.claimBoxFreeDays(one.importId, importerId, 'detention', 7, 'Hans');
      expect(corrected.box!.clock).toMatchObject({ freeDays: 7, overdue: true, daysLeft: -3 });
      expect(corrected.box!.freeDays).toHaveLength(2);
    });

    it('lets the agent record the return, and a stranger record nothing', () => {
      const one = register({ containerNo: NO });
      imports.appoint(one.importId, agentId, importerId, 'Hans');
      // A company with nothing to do with this container cannot touch its record, and the refusal names
      // who can — the two parties who are actually exposed to it.
      expect(() => imports.endBox(one.importId, rivalId, 'bought', {}, 'Rival')).toThrow(/importer or the appointed agent/);
      // The agent owes the return and is the one standing at the depot gate, so they can say it happened.
      const back = imports.endBox(one.importId, agentId, 'returned', { where: 'Modjo depot' }, 'Selam');
      expect(back.box).toMatchObject({ ending: 'returned', endedBy: 'Selam', endedWhere: 'Modjo depot' });
      expect(back.box!.clock.kind).toBe('stopped');
      // Twice is not a record: an ending that can be moved is a field, and this one is history.
      expect(() => imports.endBox(one.importId, importerId, 'returned', {}, 'Hans')).toThrow(/that spell is history/);
    });

    it('a box that was sold is never overdue', () => {
      const one = register({ containerNo: NO });
      imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.14 }, destLabel: 'Addis', weightKg: 12000 }, 'Hans');
      pickups['frt_1'] = new Date(Date.now() - 60 * 86_400_000).toISOString();
      imports.claimBoxFreeDays(one.importId, importerId, 'detention', 14, 'Hans');
      // Forty-six days past the free days, and every other branch would call it overdue.
      expect(imports.detail(one.importId, importerId).box!.clock.overdue).toBe(true);

      const sold = imports.endBox(one.importId, importerId, 'bought', { note: 'Sold to the consignee' }, 'Hans');
      expect(sold.box!.clock).toMatchObject({ kind: 'stopped', overdue: false });
      expect(sold.box!.clock.basis).toContain('No return is owed');
    });

    it('is the same box next month, and keeps the first spell', () => {
      const first = register({ containerNo: NO });
      imports.endBox(first.importId, importerId, 'returned', {}, 'Hans');
      // THE ENTITY IS NOT OWNED BY A CONSIGNMENT. A record hung on the first import would have lost this
      // history at the second use, and "when did we have this box" is the first question in any dispute.
      const second = register({ containerNo: NO });
      const box = imports.detail(second.importId, importerId).box!;
      expect(box).toMatchObject({ containerNo: NO, timesUsed: 2, importCode: second.code });
      expect(box.clock.kind).toBe('unknown');
      // And the first spell still reads as ended, on its own consignment.
      expect(imports.detail(first.importId, importerId).box!.ending).toBe('returned');
    });

    it('carries the CSC plate date and says nothing about it', () => {
      const one = register({ containerNo: NO });
      const detail = imports.declareCargo(one.importId, importerId, { containerType: '22G1', cscPlateDate: '2029-04-30' }, 'Hans');
      expect(detail.box).toMatchObject({ cscPlateDate: '2029-04-30', typeCode: '22G1' });
      // Whether the box is FIT is a surveyor's verdict. We hold the date because a haulier at a gate needs
      // it, and we draw no conclusion from it — the same line CL7 held on certifying a tank.
      expect(detail.cargoGaps.join(' ')).not.toMatch(/plate|CSC/i);
    });

    it('takes the number with the bill of lading, checked the same way', () => {
      const one = register({});
      expect(() => imports.declareCargo(one.importId, importerId, { containerNo: 'MSCU1234567' }, 'Hans')).toThrow(/checks to 6/);
      const detail = imports.declareCargo(one.importId, importerId, { containerNo: NO }, 'Hans');
      expect(detail.box!.containerNo).toBe(NO);
    });

    it('never lets the box’s clock touch the goods', () => {
      const one = register({ containerNo: NO });
      imports.mintRoadLeg(one.importId, importerId, { pickupLocation: { lat: 11.6, lng: 43.14 }, destLabel: 'Addis', weightKg: 12000 }, 'Hans');
      pickups['frt_1'] = new Date(Date.now() - 90 * 86_400_000).toISOString();
      imports.claimBoxFreeDays(one.importId, importerId, 'detention', 7, 'Hans');
      const detail = imports.detail(one.importId, importerId);
      expect(detail.box!.clock.overdue).toBe(true);
      // An overdue box is a later obligation between two other parties. Nothing about it may gate the
      // cargo — no new gap, no refusal — or the parcel trunk's rule is broken at container scale.
      expect(detail.cargoGaps).toEqual([]);
      expect(detail.roadFreightCode).toBe('FRT-1');
    });
  });
});
