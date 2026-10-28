import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { FleetManagerService } from './fleet-manager.service';
import { GlosError } from '../../foundation/http/glos-error';
import { CARRIER_PAPER_KINDS, fleetPapers, paperLabel } from './papers';
import { MediaService } from './media.service';
import type { EventBus } from '../../foundation/events/event-bus.service';
import type { Geocoder } from './geocoder';
import type { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import type { LedgerService } from '../../foundation/ledger/ledger.service';
import type { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import type { PresenceService } from '../../foundation/presence/presence.service';

/**
 * THE OPERATOR'S OWN PAPERS, AND THE DOOR THAT WAS NEVER SHUT.
 *
 * Two defects, one gate.
 *
 * SUSPENSION STOPPED ALMOST NOTHING. `requireActive` was asked before registering a vehicle and before
 * onboarding a driver, and nowhere else. Selling space — the thing suspension exists to stop — called a
 * plain `get`, and the route guard checked WHO was calling, never whether they might still trade. A
 * fleet suspended mid-session kept publishing runs and taking bookings until its token ran out.
 *
 * AND THE TRANSPORT-OPERATOR LICENCE COULD NOT LAPSE, because it was a string with no date: collected at
 * registration, read once by a human at KYC, and then unfalsifiable by time. The network took a lorry
 * off the road for an expired inspection while the company running it could have lost its licence
 * unnoticed. That asymmetry is the whole reason this exists.
 *
 * What a sister decides is only the CONSEQUENCE. The dates are recorded and shown either way — a knob
 * that also hid the paper would have rebuilt the defect it was written to close.
 */
describe('a carrier that may not take new work', () => {
  const KE = 'sbg-ke';

  const setUp = () => {
    const dids = new DidService({ anchor: () => 'anchor' } as unknown as LedgerService, { publish: async () => undefined } as unknown as EventBus);
    const entities = new EntityService(dids);
    entities.seed();

    const vault = { store: () => ({ vaultRef: `vault_${Math.random().toString(16).slice(2)}` }) } as unknown as IdentityVault;
    const core = { upsert: () => undefined } as unknown as OperationalStore;
    const bus = { publish: async () => undefined } as unknown as EventBus;
    const presence = { can: () => true, require: () => undefined } as unknown as PresenceService;
    const geocoder = { geocode: () => ({ location: { lat: -1.28, lng: 36.82 } }) } as unknown as Geocoder;

    // The REAL media store (in memory under Jest), so ownership, adoption and purging are the rules the
    // app runs — a fake would only test that the fake agrees with this file.
    const media = new MediaService();
    const managers = new FleetManagerService(dids, vault, core, bus, entities, presence, geocoder, media);

    /** An ACTIVE fleet in Kenya, incorporated where a sister actually stands. */
    let n = 0;
    const activeFleet = (companyName = 'Kilima Logistics') => {
      n += 1;
      const m = managers.register({
        companyName,
        jurisdiction: 'KE',
        contactPhone: `+2547000000${n}`,
        ownerFullName: 'A Owner',
        ownerNationalId: `ID${n}`,
        depotAddress: 'Industrial Area, Nairobi',
        requirements: { businessRegistrationNo: `BRS-${n}`, transportOperatorLicence: `TLB-${n}`, taxId: `P05${n}` },
      });
      managers.submitKyc(m.did, { businessRegCertRef: 'm1', operatorLicenceRef: 'm2', ownerIdRef: 'm3', proofOfAddressRef: 'm4' });
      managers.decideKyc(m.did, true, 'staff');
      managers.recordBond(m.did);
      return m;
    };

    /** A fresh photograph uploaded by `owner` — a fleet office session uploads as the FLEET's DID. */
    const photo = (owner: string) => media.upload({ ownerDid: owner, kind: 'kyc_licence', dataUrl: PNG_1x1 }).mediaId;

    return { managers, entities, activeFleet, media, photo };
  };

  const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const DAY = 86_400_000;
  const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

  /* ------------------------------------------------------------------ the suspension gap -- */

  describe('the door suspension never shut', () => {
    it('lets an active fleet take work', () => {
      const { managers, activeFleet } = setUp();
      const m = activeFleet();
      expect(managers.tradingBlocks(m.did)).toEqual([]);
      expect(() => managers.assertMayTakeWork(m.did)).not.toThrow();
    });

    it('refuses a SUSPENDED fleet, by name', () => {
      const { managers, activeFleet } = setUp();
      const m = activeFleet();
      managers.suspend(m.did);

      expect(managers.tradingBlocks(m.did)).toEqual(['Kilima Logistics is suspended on the network']);
      // The company, not the DID: this reaches a person deciding whether to chase somebody.
      expect(() => managers.assertMayTakeWork(m.did)).toThrow(/Kilima Logistics is suspended/);
      expect(() => managers.assertMayTakeWork(m.did)).toThrow(GlosError);
    });

    it('refuses a fleet that never finished onboarding', () => {
      const { managers } = setUp();
      const m = managers.register({
        companyName: 'Half Done Haulage',
        jurisdiction: 'KE',
        contactPhone: '+254700111222',
        ownerFullName: 'B Owner',
        ownerNationalId: 'ID-HD',
        depotAddress: 'Mombasa Road',
        requirements: { businessRegistrationNo: 'BRS-HD', transportOperatorLicence: 'TLB-HD', taxId: 'P05HD' },
      });
      expect(managers.tradingBlocks(m.did)).toEqual(['Half Done Haulage is draft on the network']);
    });

    it('refuses a fleet we have never heard of rather than throwing', () => {
      const { managers } = setUp();
      // offers() asks this for every departure on the board. A corrupt managerDid must take one run off
      // the market, not empty the whole board with a 404 halfway through building it.
      expect(managers.tradingBlocks('did:glos:nobody')).toEqual(['We do not know this fleet']);
    });
  });

  /* ------------------------------------------------------------------- recording the dates -- */

  describe('the dates, which are recorded whatever anybody enforces', () => {
    it('starts with no date on either paper, and says so', () => {
      const { managers, activeFleet } = setUp();
      const m = activeFleet();
      const papers = managers.papersOf(m.did);

      expect(papers.map((p) => p.kind)).toEqual(['operator_licence', 'carrier_insurance']);
      // 'none', not 'ok'. A paper we never asked for switches nothing off and must not read as in date —
      // this is the state EVERY fleet on the network is in, and the reason the knob defaults to off.
      expect(papers.map((p) => p.state)).toEqual(['none', 'none']);
      // The licence NUMBER was always there. It was the date that was missing, which is why it could
      // never lapse and never be enforced.
      expect(papers[0].reference).toBe('TLB-1');
    });

    it('records the dates and who read them off the document', () => {
      const { managers, activeFleet } = setUp();
      const m = activeFleet();
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(200), insurancePolicy: 'Jubilee GIT/2026/114', insuranceExpiresAt: dateIn(90) }, 'ops1@sbg.test');

      const papers = managers.papersOf(m.did);
      expect(papers.map((p) => p.state)).toEqual(['ok', 'ok']);
      expect(papers[1].reference).toBe('Jubilee GIT/2026/114');
      expect(managers.get(m.did).papers?.recordedBy).toBe('ops1@sbg.test');
    });

    it('will not take a date it cannot read, and changes nothing when it refuses', () => {
      const { managers, activeFleet } = setUp();
      const m = activeFleet();
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(200) }, 'ops1@sbg.test');

      /*
       * ONE call carrying a good date AND a bad one. The first version of this test sent only the bad
       * one, so the licence it then checked was never at risk — a mutation that wrote the licence before
       * validating the insurance passed it untouched. An assertion about a field the refused call never
       * tried to change proves nothing about partial writes.
       */
      expect(() =>
        managers.recordPapers(m.did, { licenceExpiresAt: dateIn(-5), insuranceExpiresAt: '31/12/2026' }, 'ops1@sbg.test'),
      ).toThrow(/YYYY-MM-DD/);
      // Still the 200-day licence. The lapsed date in the refused call must not have landed.
      expect(managers.papersOf(m.did)[0].state).toBe('ok');
    });

    it('records one paper without wiping the other', () => {
      const { managers, activeFleet } = setUp();
      const m = activeFleet();
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(200) }, 'ops1@sbg.test');
      managers.recordPapers(m.did, { insuranceExpiresAt: dateIn(90), insurancePolicy: 'GIT/9' }, 'ops1@sbg.test');

      expect(managers.papersOf(m.did).map((p) => p.state)).toEqual(['ok', 'ok']);
    });

    it('clears a date somebody mistyped', () => {
      const { managers, activeFleet } = setUp();
      const m = activeFleet();
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(200) }, 'ops1@sbg.test');
      managers.recordPapers(m.did, { licenceExpiresAt: null }, 'ops1@sbg.test');

      expect(managers.papersOf(m.did)[0].state).toBe('none');
    });

    it('will not record a date on nobody s word', () => {
      const { managers, activeFleet } = setUp();
      const m = activeFleet();
      expect(() => managers.recordPapers(m.did, { licenceExpiresAt: dateIn(200) }, '  ')).toThrow(/who is recording/);
    });
  });

  /* ------------------------------------------------------------------------- the sister knob -- */

  describe('what a sister enforces, which by default is nothing', () => {
    it('enforces nothing until somebody says otherwise', () => {
      const { managers, entities, activeFleet } = setUp();
      const m = activeFleet();
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(-30) }, 'ops1@sbg.test');

      expect(entities.carrierPapersFor(KE).enforce).toEqual([]);
      expect(managers.enforcedFor(managers.get(m.did))).toEqual([]);
      // LAPSED AND STILL TRADING, on purpose. Every fleet already on the network was onboarded with no
      // date at all, so a switch thrown for everybody would refuse what was legal when it was given.
      expect(managers.papersOf(m.did)[0].state).toBe('lapsed');
      expect(managers.tradingBlocks(m.did)).toEqual([]);
    });

    it('stops the fleet once the sister turns that paper on', () => {
      const { managers, entities, activeFleet } = setUp();
      const m = activeFleet();
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(-30) }, 'ops1@sbg.test');
      entities.setCarrierPapers(KE, ['operator_licence'], 'ops1@sbg.test');

      const [why] = managers.tradingBlocks(m.did);
      // The refusal names the DOCUMENT and the day, because that is what somebody has to go and fix.
      expect(why).toMatch(/^Operator licence lapsed /);
      expect(() => managers.assertMayTakeWork(m.did)).toThrow(/Operator licence lapsed/);
    });

    it('enforces only the papers it named', () => {
      const { managers, entities, activeFleet } = setUp();
      const m = activeFleet();
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(200), insuranceExpiresAt: dateIn(-1) }, 'ops1@sbg.test');
      entities.setCarrierPapers(KE, ['operator_licence'], 'ops1@sbg.test');

      // The cover has lapsed and the sister does not enforce cover. It is a red row, not a closed door.
      expect(managers.papersOf(m.did)[1].state).toBe('lapsed');
      expect(managers.tradingBlocks(m.did)).toEqual([]);

      entities.setCarrierPapers(KE, [...CARRIER_PAPER_KINDS], 'ops1@sbg.test');
      expect(managers.tradingBlocks(m.did)).toEqual([`${paperLabel('carrier_insurance')} lapsed ${labelDay(dateIn(-1))}`]);
    });

    it('lets a sister turn the last one back off', () => {
      const { managers, entities, activeFleet } = setUp();
      const m = activeFleet();
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(-30) }, 'ops1@sbg.test');
      entities.setCarrierPapers(KE, ['operator_licence'], 'ops1@sbg.test');
      expect(managers.tradingBlocks(m.did)).toHaveLength(1);

      // The whole list every time, so [] can mean "none" — a patch could never express this.
      entities.setCarrierPapers(KE, [], 'ops1@sbg.test');
      expect(entities.carrierPapersFor(KE).enforce).toEqual([]);
      expect(managers.tradingBlocks(m.did)).toEqual([]);
    });

    it('never enforces a paper that was never dated', () => {
      const { managers, entities, activeFleet } = setUp();
      const m = activeFleet();
      entities.setCarrierPapers(KE, [...CARRIER_PAPER_KINDS], 'ops1@sbg.test');

      // The papers.ts rule, and the one that makes switching this on survivable: no date switches
      // nothing off, because we cannot enforce what we never asked for.
      expect(managers.papersOf(m.did).map((p) => p.state)).toEqual(['none', 'none']);
      expect(managers.tradingBlocks(m.did)).toEqual([]);
    });

    it('warns before it refuses, and the warning is not a refusal', () => {
      const { managers, entities, activeFleet } = setUp();
      const m = activeFleet();
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(10) }, 'ops1@sbg.test');
      entities.setCarrierPapers(KE, ['operator_licence'], 'ops1@sbg.test');

      expect(managers.papersOf(m.did)[0].state).toBe('due');
      expect(managers.tradingBlocks(m.did)).toEqual([]);
    });

    it('writes the change to the sister s own log, in words', () => {
      const { entities } = setUp();
      entities.setCarrierPapers(KE, ['operator_licence'], 'ops1@sbg.test');
      const change = entities.changes(KE).find((c) => c.what === 'carrierPapers');

      expect(change).toMatchObject({ from: 'nothing', to: 'operator licence', by: 'ops1@sbg.test' });
    });

    it('does not log a save that changed nothing as a decision', () => {
      const { entities } = setUp();
      entities.setCarrierPapers(KE, ['operator_licence'], 'ops1@sbg.test');
      // The same list again, in a different order and with a duplicate — still the same decision.
      entities.setCarrierPapers(KE, ['operator_licence', 'operator_licence'], 'ops2@sbg.test');

      const logged = entities.changes(KE).filter((c) => c.what === 'carrierPapers');
      expect(logged).toHaveLength(1);
      expect(logged[0].by).toBe('ops1@sbg.test');
    });

    it('does not let one sister s decision reach another s carriers', () => {
      const { managers, entities, activeFleet } = setUp();
      const m = activeFleet();
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(-30) }, 'ops1@sbg.test');

      const other = entities.sisters().find((s) => s.entityId !== KE);
      entities.setCarrierPapers(other!.entityId, [...CARRIER_PAPER_KINDS], 'ops1@sbg.test');

      // A Kenyan fleet answers to the Kenyan sister. Enforcement is a jurisdiction's call, not a switch
      // somebody throws for the network.
      expect(managers.tradingBlocks(m.did)).toEqual([]);
    });
  });

  /* -------------------------------------------------------------- what it must never refuse -- */

  describe('what a refused carrier may still do', () => {
    it('a lapsed paper never touches the papers themselves', () => {
      const { managers, entities, activeFleet } = setUp();
      const m = activeFleet();
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(-30) }, 'ops1@sbg.test');
      entities.setCarrierPapers(KE, ['operator_licence'], 'ops1@sbg.test');

      // The way back has to stay open: a fleet locked out of recording its renewal is locked out for good.
      expect(() => managers.recordPapers(m.did, { licenceExpiresAt: dateIn(300) }, 'ops1@sbg.test')).not.toThrow();
      expect(managers.tradingBlocks(m.did)).toEqual([]);
    });

    it('renewing puts it straight back, with nothing to unwind', () => {
      const { managers, entities, activeFleet } = setUp();
      const m = activeFleet();
      entities.setCarrierPapers(KE, [...CARRIER_PAPER_KINDS], 'ops1@sbg.test');
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(-1) }, 'ops1@sbg.test');
      expect(managers.tradingBlocks(m.did)).toHaveLength(1);

      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(365) }, 'ops1@sbg.test');
      // Derived at read time, never a status written into the record — so there is no second flag to
      // forget to clear. The same reason a vehicle's papers work this way.
      expect(managers.tradingBlocks(m.did)).toEqual([]);
    });
  });

  /* ----------------------------------------------------------- the fleet sends its own paper -- */

  /**
   * THE WAY BACK, FROM THE FLEET'S SIDE.
   *
   * Before this the fleet app told the office to "send the renewed document to SeeBuyGet" with no way to do
   * it. The courier's renewed licence is the precedent and its rules carry over whole: the date sent is the
   * FLEET's reading and switches nothing on; staff record the date they read off the same image, or turn
   * it down with a reason the fleet is shown.
   */
  describe('a renewed document the fleet sends', () => {
    it('waits beside the paper and switches nothing on', () => {
      const { managers, entities, activeFleet, photo } = setUp();
      const m = activeFleet();
      entities.setCarrierPapers(KE, ['operator_licence'], 'ops1@sbg.test');
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(-3) }, 'ops1@sbg.test');
      expect(managers.tradingBlocks(m.did)).toHaveLength(1);

      const copy = photo(m.did);
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: copy, expiresAt: dateIn(365), reference: 'TLB-1' }, { ownerDid: m.did, by: 'Kilima office' });

      // Their word is on file; the paper is not. Still lapsed, still off the board, until somebody reads it.
      expect(managers.get(m.did).papers?.sent?.operator_licence).toMatchObject({ copyRef: copy, expiresAt: dateIn(365), reference: 'TLB-1', sentBy: 'Kilima office' });
      expect(managers.papersOf(m.did)[0].state).toBe('lapsed');
      expect(managers.tradingBlocks(m.did)).toHaveLength(1);
    });

    it('adopts the image to the fleet as the right kind of document', () => {
      const { managers, activeFleet, photo, media } = setUp();
      const m = activeFleet();
      const licence = photo(m.did);
      const cover = photo(m.did);
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: licence, expiresAt: dateIn(365) }, { ownerDid: m.did });
      managers.sendPaper(m.did, { kind: 'carrier_insurance', copyRef: cover, expiresAt: dateIn(200) }, { ownerDid: m.did });

      expect(media.get(licence)).toMatchObject({ kind: 'kyc_licence', link: { type: 'fleet', id: m.did }, retentionClass: 'account-doc' });
      // An insurance certificate is not a licence, and is not filed as one.
      expect(media.get(cover)).toMatchObject({ kind: 'kyc_insurance', link: { type: 'fleet', id: m.did } });
    });

    it('will not attach an image somebody else uploaded', () => {
      const { managers, activeFleet, photo } = setUp();
      const m = activeFleet();
      const other = activeFleet('Other Haulage');
      const theirs = photo(other.did);

      // adopt() is the guard: a media id is not a secret, and a fleet must not be able to file another
      // account's photograph as its own licence.
      expect(() =>
        managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: theirs, expiresAt: dateIn(365) }, { ownerDid: m.did }),
      ).toThrow(/could not be attached/);
      expect(managers.get(m.did).papers?.sent).toBeUndefined();
    });

    it('refuses a date that has already passed', () => {
      const { managers, activeFleet, photo } = setUp();
      const m = activeFleet();
      expect(() =>
        managers.sendPaper(m.did, { kind: 'carrier_insurance', copyRef: photo(m.did), expiresAt: dateIn(-1) }, { ownerDid: m.did }),
      ).toThrow(/already passed — a renewed carrier insurance runs into the future/);
    });

    it('replaces an earlier document nobody had read, and deletes it', () => {
      const { managers, activeFleet, photo, media } = setUp();
      const m = activeFleet();
      const first = photo(m.did);
      const second = photo(m.did);
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: first, expiresAt: dateIn(300) }, { ownerDid: m.did });
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: second, expiresAt: dateIn(365) }, { ownerDid: m.did });

      expect(managers.get(m.did).papers?.sent?.operator_licence?.copyRef).toBe(second);
      // Never accepted, so nothing rests on it — a photograph of somebody's licence that proves nothing.
      expect(media.get(first)).toBeUndefined();
      expect(media.get(second)).toBeDefined();
    });

    it('becomes the paper’s own copy when staff record the date they read off it', () => {
      const { managers, activeFleet, photo, media } = setUp();
      const m = activeFleet();
      const copy = photo(m.did);
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: copy, expiresAt: dateIn(365) }, { ownerDid: m.did });

      // Staff type THEIR reading — which may differ from the fleet's, and is the one that counts.
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(360) }, 'ops1@sbg.test');

      const papers = managers.get(m.did).papers!;
      expect(papers.licenceExpiresAt).toBe(dateIn(360));
      expect(papers.licenceCopyRef).toBe(copy);
      expect(papers.sent).toBeUndefined();
      expect(media.get(copy)?.expiresAt).toBeUndefined(); // the copy on record is kept, on no clock
    });

    it('starts the clock on the copy it replaces, rather than keeping every licence ever held', () => {
      const { managers, activeFleet, photo, media } = setUp();
      const m = activeFleet();
      const old = photo(m.did);
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: old, expiresAt: dateIn(30) }, { ownerDid: m.did });
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(30) }, 'ops1@sbg.test');

      const renewed = photo(m.did);
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: renewed, expiresAt: dateIn(400) }, { ownerDid: m.did });
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(400) }, 'ops1@sbg.test');

      expect(managers.get(m.did).papers?.licenceCopyRef).toBe(renewed);
      // Not purged on the spot: for the grace period it still answers "what was on record before".
      expect(media.get(old)?.expiresAt).toBeDefined();
      expect(media.get(renewed)?.expiresAt).toBeUndefined();
    });

    it('never leaves the old copy beside a date typed on somebody’s word', () => {
      const { managers, activeFleet, photo, media } = setUp();
      const m = activeFleet();
      const copy = photo(m.did);
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: copy, expiresAt: dateIn(200) }, { ownerDid: m.did });
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(200) }, 'ops1@sbg.test');

      // A new date with nothing sent was read off a document in somebody's hand. It says so by having no
      // copy — the photograph of LAST year's licence beside THIS year's date would be a quiet lie.
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(500) }, 'ops2@sbg.test');
      expect(managers.get(m.did).papers?.licenceCopyRef).toBeUndefined();
      expect(media.get(copy)?.expiresAt).toBeDefined();
    });

    it('records one paper without consuming the other’s waiting document', () => {
      const { managers, activeFleet, photo } = setUp();
      const m = activeFleet();
      const licence = photo(m.did);
      const cover = photo(m.did);
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: licence, expiresAt: dateIn(365) }, { ownerDid: m.did });
      managers.sendPaper(m.did, { kind: 'carrier_insurance', copyRef: cover, expiresAt: dateIn(200) }, { ownerDid: m.did });

      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(365) }, 'ops1@sbg.test');
      expect(managers.get(m.did).papers?.sent).toEqual({ carrier_insurance: expect.objectContaining({ copyRef: cover }) });
      expect(managers.get(m.did).papers?.insuranceCopyRef).toBeUndefined();
    });

    it('keeps a waiting document waiting when a date is only corrected away', () => {
      const { managers, activeFleet, photo } = setUp();
      const m = activeFleet();
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(90) }, 'ops1@sbg.test');
      const copy = photo(m.did);
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: copy, expiresAt: dateIn(365) }, { ownerDid: m.did });

      // Clearing a mistyped date is a correction, not a reading of what they sent.
      managers.recordPapers(m.did, { licenceExpiresAt: null }, 'ops1@sbg.test');
      expect(managers.get(m.did).papers?.sent?.operator_licence?.copyRef).toBe(copy);
    });

    it('takes a renewed licence NUMBER, and still keeps one licence to one operator', () => {
      const { managers, activeFleet } = setUp();
      const m = activeFleet();
      activeFleet('Other Haulage'); // holds TLB-2

      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(365), licenceNumber: 'TLB-NEW-9' }, 'ops1@sbg.test');
      expect(managers.papersOf(m.did)[0].reference).toBe('TLB-NEW-9');

      // Somebody else's number is refused — and the date sent with it is not half-recorded.
      expect(() => managers.recordPapers(m.did, { licenceExpiresAt: dateIn(900), licenceNumber: 'TLB-2' }, 'ops1@sbg.test')).toThrow(/already exists/);
      expect(managers.get(m.did).papers?.licenceExpiresAt).toBe(dateIn(365));
      expect(managers.papersOf(m.did)[0].reference).toBe('TLB-NEW-9');
    });
  });

  describe('a document staff turn down', () => {
    it('says why, deletes the image, and records nothing from it', () => {
      const { managers, activeFleet, photo, media } = setUp();
      const m = activeFleet();
      const copy = photo(m.did);
      managers.sendPaper(m.did, { kind: 'carrier_insurance', copyRef: copy, expiresAt: dateIn(200) }, { ownerDid: m.did });

      managers.refusePaper(m.did, 'carrier_insurance', 'This is the quote, not the certificate — send the certificate', 'ops1@sbg.test');

      const papers = managers.get(m.did).papers!;
      expect(papers.refused?.carrier_insurance).toMatchObject({ reason: 'This is the quote, not the certificate — send the certificate', by: 'ops1@sbg.test' });
      expect(papers.sent).toBeUndefined();
      expect(papers.insuranceExpiresAt).toBeUndefined();
      expect(media.get(copy)).toBeUndefined();
    });

    it('will not refuse without a reason the fleet can act on', () => {
      const { managers, activeFleet, photo } = setUp();
      const m = activeFleet();
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: photo(m.did), expiresAt: dateIn(365) }, { ownerDid: m.did });
      expect(() => managers.refusePaper(m.did, 'operator_licence', '   ', 'ops1@sbg.test')).toThrow(/must say why/);
      // Still waiting: a refused refusal is not a half-done one.
      expect(managers.get(m.did).papers?.sent?.operator_licence).toBeDefined();
    });

    it('has nothing to refuse when nothing was sent', () => {
      const { managers, activeFleet } = setUp();
      const m = activeFleet();
      expect(() => managers.refusePaper(m.did, 'operator_licence', 'Blurred', 'ops1@sbg.test')).toThrow(/Nothing has been sent/);
    });

    it('clears the refusal once they send again, and once a date is recorded', () => {
      const { managers, activeFleet, photo } = setUp();
      const m = activeFleet();
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: photo(m.did), expiresAt: dateIn(365) }, { ownerDid: m.did });
      managers.refusePaper(m.did, 'operator_licence', 'Blurred — the date cannot be read', 'ops1@sbg.test');

      // Leaving it up after they sent again would tell them to fix what they just fixed.
      managers.sendPaper(m.did, { kind: 'operator_licence', copyRef: photo(m.did), expiresAt: dateIn(365) }, { ownerDid: m.did });
      expect(managers.get(m.did).papers?.refused).toBeUndefined();

      managers.refusePaper(m.did, 'operator_licence', 'Still blurred', 'ops1@sbg.test');
      managers.recordPapers(m.did, { licenceExpiresAt: dateIn(365) }, 'ops2@sbg.test');
      expect(managers.get(m.did).papers?.refused).toBeUndefined();
    });
  });

  /* ----------------------------------------------------------------------- the paper itself -- */

  describe('the shared paper vocabulary', () => {
    it('gives the operator s papers their own names', () => {
      // Before this the labels were a chain of ternaries ending in 'Driving licence', so an operator
      // licence would have been refused under a lorry driver's document. A refusal naming the wrong
      // paper sends somebody to fetch the wrong thing.
      expect(paperLabel('operator_licence')).toBe('Operator licence');
      expect(paperLabel('carrier_insurance')).toBe('Carrier insurance');
      expect(paperLabel('licence')).toBe('Driving licence');
    });

    it('reads a fleet with no papers block at all', () => {
      // Every fleet in the database predates this field. It must answer, not throw.
      expect(fleetPapers({ requirements: { businessRegistrationNo: 'x', transportOperatorLicence: 'TLB-9', taxId: 't' } }).map((p) => p.state)).toEqual(['none', 'none']);
    });
  });

  /*
   * COVER, PROVEN (the user, 2026-10-28: "Some carriers state cover ... But they must prove it"). A sender may ask for a
   * carrier with cover; what counts is the fleet's insurance as staff read it off the policy the fleet SENT, still running.
   */
  describe('the cover a sender may ask for', () => {
    it('counts only cover read off the policy the fleet sent, with what it covers and up to how much', () => {
      const { managers, activeFleet, photo } = setUp();
      const m = activeFleet();
      expect(managers.coverOf(m.did)).toBeUndefined();
      // A date typed on somebody's word, with no document: recorded, and not proof.
      managers.recordPapers(m.did, { insuranceExpiresAt: dateIn(200), insurancePolicy: 'GIT-77' }, 'ops1@sbg.test');
      expect(managers.coverOf(m.did)).toBeUndefined();
      // Sent, then read off the image by staff, with the limit and what it is for.
      managers.sendPaper(m.did, { kind: 'carrier_insurance', copyRef: photo(m.did), expiresAt: dateIn(200), reference: 'GIT-77' }, { ownerDid: m.did });
      managers.recordPapers(m.did, { insuranceExpiresAt: dateIn(200), insuranceCovers: 'both', insuranceLimit: 2_500_000, insuranceCurrency: 'kes' }, 'ops1@sbg.test');
      expect(managers.coverOf(m.did)).toMatchObject({ policy: 'GIT-77', expiresAt: dateIn(200), covers: 'both', limit: 2_500_000, currency: 'KES' });
    });

    it('stops counting the day after it lapses', () => {
      const { managers, activeFleet, photo } = setUp();
      const m = activeFleet();
      managers.sendPaper(m.did, { kind: 'carrier_insurance', copyRef: photo(m.did), expiresAt: dateIn(10) }, { ownerDid: m.did });
      managers.recordPapers(m.did, { insuranceExpiresAt: dateIn(10) }, 'ops1@sbg.test');
      expect(managers.coverOf(m.did)).toBeDefined();
      expect(managers.coverOf(m.did, Date.now() + 12 * DAY)).toBeUndefined();
    });

    it('refuses a limit in no money, or of nothing', () => {
      const { managers, activeFleet } = setUp();
      const m = activeFleet();
      expect(() => managers.recordPapers(m.did, { insuranceLimit: 500000, insuranceCurrency: 'KSH' }, 'ops1@sbg.test')).toThrow(/a currency some country uses/);
      expect(() => managers.recordPapers(m.did, { insuranceLimit: 0, insuranceCurrency: 'KES' }, 'ops1@sbg.test')).toThrow(/above nothing/);
    });
  });
});

/** The day a date-only expiry is still valid until, spelled as offRoadLine spells it. */
function labelDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
