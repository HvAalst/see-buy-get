import { Test } from '@nestjs/testing';
import { PresenceService } from './presence.service';
import { LEVEL_DEFAULTS, PRESENCE_CAPABILITIES, PRESENCE_LEVELS } from './presence.types';
import { EntityService } from '../entity/entity.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';

/**
 * HOW ESTABLISHED WE ARE, COUNTRY BY COUNTRY.
 *
 * Everything here guards one idea: the network can match, carry and PROVE in a country where it cannot
 * spend a shilling, and the difference must be impossible to blur. The failures worth writing tests
 * against are all the same failure wearing different clothes — a country quietly inheriting permissions
 * it was never granted:
 *
 *   - an unknown country falling back to the home sister's capabilities;
 *   - "established" being claimed by setting a flag, with no company behind it;
 *   - a cover limit surviving into a country where no provision can pay it;
 *   - goods taken in under nobody's promise at all.
 */
describe('presence', () => {
  let presence: PresenceService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PresenceService, EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    moduleRef.get(EntityService).seed();
    presence = moduleRef.get(PresenceService);
  });

  describe('a country nobody recorded', () => {
    it('is OBSERVED, and may do nothing at all', () => {
      const zm = presence.resolve('ZM');
      expect(zm.level).toBe('observed');
      expect(zm.recorded).toBe(false);
      expect(Object.values(zm.capabilities).every((v) => v === false)).toBe(true);
    });

    it('never inherits the home sister, however the question is asked', () => {
      // The whole design in one assertion. A default that happens to be generous is how a shop in a
      // country we have never heard of ends up taking money on our behalf.
      expect(presence.resolve(undefined).level).toBe('observed');
      expect(presence.resolve('').capabilities.merchantOfRecord).toBe(false);
      expect(presence.can('XX', 'takeIn')).toBe(false);
    });
  });

  describe('a country with a sister', () => {
    it('is ESTABLISHED without anybody saying so', () => {
      // Derived, not declared: the company existing IS the fact. Kenya has a sister in the seed.
      const ke = presence.resolve('KE');
      expect(ke.level).toBe('established');
      expect(ke.hasEntity).toBe(true);
      expect(ke.capabilities.merchantOfRecord).toBe(true);
      expect(ke.capabilities.claims).toBe(true);
    });

    it('is found whatever case the country arrives in', () => {
      expect(presence.resolve('ke').level).toBe('established');
    });
  });

  describe('setting a standing', () => {
    it('refuses ESTABLISHED where no company transacts', () => {
      // This flag must never be the thing that creates a Merchant of Record, a float and a claims
      // provision out of nothing.
      expect(() => presence.set({ jurisdiction: 'ZM', level: 'established', by: 'A. Mwangi' })).toThrow(/cannot be established/i);
    });

    it('records who decided it and why', () => {
      const zm = presence.set({ jurisdiction: 'ZM', level: 'matched', note: 'Carrier-led entry, no company yet', by: 'A. Mwangi' });
      expect(zm.level).toBe('matched');
      expect(zm.setBy).toBe('A. Mwangi');
      expect(zm.note).toBe('Carrier-led entry, no company yet');
      expect(zm.setAt).toBeTruthy();
    });

    it('grants MATCHED the custody rails and not one capability that touches money', () => {
      const zm = presence.set({ jurisdiction: 'ZM', level: 'matched' });
      expect(zm.capabilities.takeIn).toBe(true);
      expect(zm.capabilities.merchantOfRecord).toBe(false);
      expect(zm.capabilities.holdFloat).toBe(false);
      expect(zm.capabilities.cashOnDelivery).toBe(false);
      expect(zm.capabilities.claims).toBe(false);
      expect(zm.capabilities.payouts).toBe(false);
    });

    it('lets one capability move on its own, up or down', () => {
      // They arrive on different days: a country can pay local suppliers long before it collects tax,
      // and a country with a company can still be barred from holding float.
      const zm = presence.set({ jurisdiction: 'ZM', level: 'matched', overrides: { payouts: true } });
      expect(zm.capabilities.payouts).toBe(true);
      expect(zm.capabilities.merchantOfRecord).toBe(false);

      const ke = presence.set({ jurisdiction: 'KE', level: 'established', overrides: { holdFloat: false } });
      expect(ke.capabilities.holdFloat).toBe(false);
      expect(ke.capabilities.merchantOfRecord).toBe(true);
    });

    it('refuses an override for a capability that does not exist', () => {
      // A silent no-op on a permission is how somebody believes they granted something they did not.
      expect(() => presence.set({ jurisdiction: 'ZM', level: 'matched', overrides: { flying: true } as never })).toThrow(/unknown capability/i);
    });

    it('keeps only the exceptions, so a later level change still moves everything else', () => {
      presence.set({ jurisdiction: 'ZM', level: 'matched', overrides: { payouts: true } });
      // (Partnered now needs a real partner company — CA7 — so the level change here is a lowering.)
      const moved = presence.set({ jurisdiction: 'ZM', level: 'observed' });
      expect(moved.capabilities.payouts).toBe(false); // the override was not carried forward silently
    });
  });

  describe('who answers for goods taken in', () => {
    it('says OURS where a sister is on the hook', () => {
      expect(presence.takeInPromise('KE')).toBe('ours');
    });

    it('says NONE where goods may not be taken in at all', () => {
      expect(presence.takeInPromise('ZM')).toBe('none'); // unrecorded → observed
    });

    it('says THEIRS where goods may move but no sister can answer', () => {
      presence.set({ jurisdiction: 'ZM', level: 'matched' });
      expect(presence.takeInPromise('ZM')).toBe('theirs');
    });

    it('says OURS when the PAYER sits where a sister already carries it', () => {
      // The journey decides, not the shop. A Kenyan buyer's parcel is our sister's promise even where
      // it is handed over, and the foreign leg is a service we purchased.
      presence.set({ jurisdiction: 'ZM', level: 'matched' });
      expect(presence.takeInPromise('ZM', 'KE')).toBe('ours');
    });

    it('never lets a paying country conjure a take-in where take-in is refused', () => {
      // Somebody abroad being willing to pay does not make a counter we are not allowed to use legal.
      expect(presence.takeInPromise('ZM', 'KE')).toBe('none');
    });
  });

  describe('cover', () => {
    it('is zero by construction where no provision can pay an award', () => {
      presence.set({ jurisdiction: 'ZM', level: 'matched' });
      expect(presence.coverCeiling('ZM', 5000)).toBe(0);
      expect(presence.coverCeiling('KE', 5000)).toBe(5000);
    });
  });

  describe('the operator’s map', () => {
    it('lists every country with a company and every country on record', () => {
      presence.set({ jurisdiction: 'ZM', level: 'matched' });
      const map = presence.list();
      expect(map.map((p) => p.jurisdiction)).toEqual(expect.arrayContaining(['KE', 'ET', 'ZM']));
      expect(map.find((p) => p.jurisdiction === 'KE')?.level).toBe('established');
      expect(map.find((p) => p.jurisdiction === 'ZM')?.level).toBe('matched');
    });

    it('B1 — is not moved by a CUSTOMER: a shipper signing up from a country is not us preparing it, nor our partner there', async () => {
      // A business used to be recorded as a `partner`, so an importer in a country answered `partnerFor` and could
      // stand in for the company that partners us there.
      const moduleRef = await Test.createTestingModule({
        providers: [PresenceService, EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
      }).compile();
      const entities = moduleRef.get(EntityService);
      entities.seed();
      const map = moduleRef.get(PresenceService);
      entities.createBusiness({ name: 'Accra Shippers', jurisdiction: 'GH', profile: { activities: ['shipper'], registrationNo: 'CS-1', createdBy: 'Ama', createdByPersonDid: 'did:glos:ama' } });
      expect(map.list().map((p) => p.jurisdiction)).not.toContain('GH');
      expect(() => map.set({ jurisdiction: 'GH', level: 'partnered', by: 'A. Mwangi' })).toThrow();
    });
  });

  describe('CA1 — only a country that exists', () => {
    it('refuses two letters that are not a country', () => {
      expect(() => presence.set({ jurisdiction: 'ZZ', level: 'matched' })).toThrow(/not a country in the catalogue/);
      expect(() => presence.propose({ jurisdiction: 'ZZ', level: 'matched', by: 'Amina' })).toThrow(/not a country in the catalogue/);
    });
  });

  describe('CA2 — two people switch a country on', () => {
    const DAY = 86_400_000;

    it('holds a change that raises a country until a DIFFERENT person approves it', () => {
      const { proposal, applied } = presence.propose({ jurisdiction: 'ZM', level: 'matched', note: 'Lusaka partners ready', by: 'Amina' });
      expect(applied).toBeUndefined();
      expect(proposal).toMatchObject({ jurisdiction: 'ZM', status: 'pending', proposedBy: 'Amina', gains: ['takeIn'] });
      // Nothing behaves differently yet.
      expect(presence.resolve('ZM').level).toBe('observed');

      // The proposer cannot second their own change — not even by changing the case of their name.
      expect(() => presence.approve(proposal!.proposalId, ' amina ')).toThrow(/different person must approve/);
      expect(() => presence.approve(proposal!.proposalId, '')).toThrow(/Say who you are/);

      const { presence: after } = presence.approve(proposal!.proposalId, 'Brian');
      expect(after).toMatchObject({ level: 'matched', setBy: 'Amina', approvedBy: 'Brian' });
      expect(() => presence.approve(proposal!.proposalId, 'Chege')).toThrow(/already approved/);
    });

    it('tells the two apart by ACCOUNT: two colleagues with one name can second each other, and one account cannot second itself', () => {
      const { proposal } = presence.propose({ jurisdiction: 'ZM', level: 'matched', by: 'Sam Otieno', byKey: 'operator:opr_1' });
      const id = proposal!.proposalId;
      // The same account, whatever name is typed beside it.
      expect(() => presence.approve(id, 'Somebody Else', undefined, 'operator:opr_1')).toThrow(/different person must approve/);
      expect(presence.resolve('ZM').level).toBe('observed');
      // What a screen asks before it offers "Approve".
      expect(presence.proposedByReader(id, { name: 'Somebody Else', key: 'operator:opr_1' })).toBe(true);
      expect(presence.proposedByReader(id, { name: 'Sam Otieno', key: 'operator:opr_2' })).toBe(false);
      expect(presence.proposedByReader('pp_nobody', { name: 'Sam Otieno', key: 'operator:opr_1' })).toBe(false);
      // The account is kept beside the proposal, never on it: every member of staff reads a proposal whole.
      expect(JSON.stringify(presence.listProposals())).not.toContain('opr_1');
      // Another account with the very same name is another person.
      expect(presence.approve(id, 'Sam Otieno', undefined, 'operator:opr_2').presence).toMatchObject({ level: 'matched', setBy: 'Sam Otieno', approvedBy: 'Sam Otieno' });
    });

    it('goes by the name where there is no account to go by: typed on a laptop, or proposed before accounts were kept', () => {
      const old = presence.propose({ jurisdiction: 'ZM', level: 'matched', by: 'Amina' }).proposal!;
      expect(() => presence.approve(old.proposalId, ' amina ', undefined, 'operator:opr_9')).toThrow(/different person must approve/);
      expect(presence.proposedByReader(old.proposalId, { name: 'AMINA' })).toBe(true);
      expect(presence.proposedByReader(old.proposalId, { name: '' })).toBe(false);
      presence.decline(old.proposalId, 'Brian', 'asked again below');
      // A name typed beside the shared key is not an account: the same name under a staff sign-in is the same person.
      const typed = presence.propose({ jurisdiction: 'ZM', level: 'matched', by: 'Brian', byKey: 'typed:Brian' }).proposal!;
      expect(() => presence.approve(typed.proposalId, 'brian', undefined, 'operator:opr_3')).toThrow(/different person must approve/);
      expect(() => presence.approve(typed.proposalId, 'BRIAN', undefined, 'typed:BRIAN')).toThrow(/different person must approve/);
      expect(presence.approve(typed.proposalId, 'Chege', undefined, 'operator:opr_3').presence.approvedBy).toBe('Chege');
    });

    it('applies a lowering at once, by one named person — refusing is the safe direction', () => {
      presence.set({ jurisdiction: 'ZM', level: 'matched' });
      const { applied, proposal } = presence.propose({ jurisdiction: 'ZM', level: 'observed', note: 'Regulator letter', by: 'Amina' });
      expect(proposal).toBeUndefined();
      expect(applied).toMatchObject({ level: 'observed', setBy: 'Amina' });
      expect(applied?.approvedBy).toBeUndefined();
    });

    it('allows one waiting change per country, and a decline needs a reason that is kept', () => {
      const { proposal } = presence.propose({ jurisdiction: 'ZM', level: 'matched', by: 'Amina' });
      expect(() => presence.propose({ jurisdiction: 'ZM', level: 'matched', overrides: { payouts: true }, by: 'Brian' })).toThrow(/already waiting for a second person/);
      expect(() => presence.decline(proposal!.proposalId, 'Brian')).toThrow(/Say why/);
      expect(presence.decline(proposal!.proposalId, 'Brian', 'Not before the rate book has kwacha')).toMatchObject({ status: 'declined', reason: 'Not before the rate book has kwacha' });
      expect(presence.resolve('ZM').level).toBe('observed');
    });

    it('expires a change nobody decided, and keeps that on the record', () => {
      const t0 = Date.parse('2026-09-13T08:00:00Z');
      const { proposal } = presence.propose({ jurisdiction: 'ZM', level: 'matched', by: 'Amina' }, t0);
      const later = t0 + 8 * DAY;
      expect(() => presence.approve(proposal!.proposalId, 'Brian', later)).toThrow(/already expired/);
      expect(presence.listProposals(later)[0]).toMatchObject({ status: 'expired' });
      // …and a fresh proposal may be made once the old one has lapsed.
      expect(presence.propose({ jurisdiction: 'ZM', level: 'matched', by: 'Amina' }, later).proposal?.status).toBe('pending');
    });

    it('still refuses to establish a country no company transacts in, even with two people', () => {
      expect(() => presence.propose({ jurisdiction: 'ZM', level: 'established', by: 'Amina' })).toThrow(/cannot be established/);
    });
  });

  /**
   * CL5 — the first of the two gates on holding a photograph of an official document.
   *
   * The whole point of it is the DEFAULT, so that is what is asserted: not one level opens it, including
   * the one that opens everything else. Being established in a country answers whether we may transact
   * in it; whether its law lets us keep a photograph of one of its documents is a different question,
   * asked of a lawyer, about that country.
   */
  describe('holding a photograph of an official document', () => {
    it('is off at EVERY level, including established', () => {
      for (const level of PRESENCE_LEVELS) {
        expect(LEVEL_DEFAULTS[level].fieldEvidence).toBe(false);
      }
      // And it is a real capability, not a field somebody forgot to add to the list.
      expect([...PRESENCE_CAPABILITIES]).toContain('fieldEvidence');
    });

    it('opens only by a deliberate override, and says why when it is shut', () => {
      // KE is established in this fixture and still may not hold one.
      expect(presence.can('KE', 'fieldEvidence')).toBe(false);
      expect(() => presence.require('KE', 'fieldEvidence')).toThrow(/photographs of official documents/);

      presence.set({ jurisdiction: 'KE', level: 'established', overrides: { fieldEvidence: true }, by: 'Amina', note: 'Counsel confirmed 2026-09-20' });
      expect(presence.can('KE', 'fieldEvidence')).toBe(true);
      // One country's answer is not another's.
      expect(presence.can('ET', 'fieldEvidence')).toBe(false);
    });
  });
});
