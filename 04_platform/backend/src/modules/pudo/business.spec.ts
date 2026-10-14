import { Test } from '@nestjs/testing';
import { BusinessService, MAX_UNCHECKED_PER_PERSON } from './business.service';
import { PersonService } from './person.service';
import { MediaService } from './media.service';
import { AuthService } from '../../foundation/auth/auth.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { pdfDataUrl } from '../../foundation/entity/company.test-util';
import { listedPublicly } from '../../foundation/entity/entity.types';
import { HandleService } from '../../foundation/handle/handle.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { MailService } from '../../foundation/mail/mail.service';
import { OutboxMailSender } from '../../foundation/mail/outbox-mail.sender';
import { MAIL_SENDER } from '../../foundation/mail/mail.types';

/**
 * B1 — A CUSTOMER'S BUSINESS, on the real person, entity, document and token services.
 *
 * The user, 2026-10-04: a separate business app for shippers and expeditors; the expeditor acts as the shipper's
 * agent; we never handle their payments. What this proves is the part that has to hold before any of that work runs
 * on it: who is in a business, who may change what, and that a business nobody has checked is shown to no stranger.
 */
describe('a customer’s business', () => {
  let businesses: BusinessService;
  let persons: PersonService;
  let entities: EntityService;
  let documents: CompanyDocumentService;
  let auth: AuthService;
  let outbox: OutboxMailSender;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BusinessService, PersonService, MediaService, AuthService, DidService, EntityService, CompanyDocumentService, HandleService,
        IdentityVault, OperationalStore, FieldEncryption, EventBus, LedgerService, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        MailService, OutboxMailSender, { provide: MAIL_SENDER, useExisting: OutboxMailSender },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    businesses = moduleRef.get(BusinessService);
    persons = moduleRef.get(PersonService);
    documents = moduleRef.get(CompanyDocumentService);
    auth = moduleRef.get(AuthService);
    outbox = moduleRef.get(OutboxMailSender);
  });

  let seq = 0;
  /** A person who signed in with their phone, chose a PIN and confirmed a recovery email. */
  function aPerson() {
    seq += 1;
    const phone = `+2519110${String(seq).padStart(5, '0')}`;
    const person = persons.ensurePerson(phone);
    persons.setPin(person.personDid, '48261');
    const email = `owner${seq}-${Date.now()}@example.com`;
    persons.setEmail(person.personDid, email);
    return { personDid: person.personDid, phone, email };
  }
  const setUp = (personDid: string, over: Partial<{ name: string; country: string; activities: string[] }> = {}) =>
    businesses.create(personDid, { name: over.name ?? `Abebe Import ${(seq += 1)}`, country: over.country ?? 'ET', registrationNo: `REG-${seq}`, activities: over.activities ?? ['importer'], yourName: 'Abebe Kebede' });
  /** Act as somebody, through the same token-and-check a request goes through. */
  const actingAs = (personDid: string, entityId: string) => {
    const { token } = businesses.session(personDid, entityId);
    return businesses.requireMember(auth.introspect(token.access_token));
  };
  const papers = (entityId: string) => {
    for (const kind of ['certificate_of_incorporation', 'representative_id']) {
      documents.upload({ entityId, kind, title: kind, dataUrl: pdfDataUrl(`${entityId}:${kind}:${(seq += 1)}`), by: 'Abebe Kebede' });
    }
  };

  describe('setting one up', () => {
    it('is done by a person with their own sign-in, who becomes its owner and acts as the business', () => {
      const abebe = aPerson();
      const { entity } = setUp(abebe.personDid);
      expect(entity.kind).toBe('business');
      expect(entity.business?.verification.state).toBe('unverified');
      const { token, business } = businesses.session(abebe.personDid, entity.entityId);
      const claims = auth.introspect(token.access_token);
      // The business's own DID and tenant, the member's name for the record, and the person — so a PIN change ends it.
      expect(claims).toMatchObject({ role: 'business', did: entity.did, tenant: entity.entityId, actorName: 'Abebe Kebede', personDid: abebe.personDid });
      expect(business.you.role).toBe('owner');
    });

    it('needs the PIN chosen first — a business is only as safe as its people’s sign-in', () => {
      const bare = persons.ensurePerson('+251911999001');
      expect(() => setUp(bare.personDid)).toThrow(/Choose your PIN first/);
    });

    it('is never one of OUR companies: not on the register, not a partner, never a party to the books', () => {
      const { entity } = setUp(aPerson().personDid, { country: 'ET' });
      expect(entities.companies().map((c) => c.entityId)).not.toContain(entity.entityId);
      // The defect this kind exists to close: an importer recorded as a partner answered for the country.
      expect(entities.partnerFor('ET', { includeDraft: true })).toBeUndefined();
      expect(() => entities.requireTransacting(entity.entityId)).toThrow(/a customer’s business/);
    });

    it('stops a person setting up an endless row of businesses nobody has checked', () => {
      const p = aPerson();
      for (let i = 0; i < MAX_UNCHECKED_PER_PERSON; i += 1) setUp(p.personDid);
      expect(() => setUp(p.personDid)).toThrow(/not checked yet/);
    });

    it('refuses what a business does not do, and an empty list', () => {
      const p = aPerson();
      expect(() => setUp(p.personDid, { activities: [] })).toThrow(/Say what the business does/);
      expect(() => setUp(p.personDid, { activities: ['bank'] })).toThrow(/Not something a business here does: bank/);
    });
  });

  describe('the people in it', () => {
    it('adds somebody by number; they see it with their own sign-in and say yes', () => {
      const owner = aPerson();
      const { entity } = setUp(owner.personDid);
      const selam = aPerson();
      const invited = businesses.invite(actingAs(owner.personDid, entity.entityId), { phone: selam.phone, name: 'Selam Tesfaye', role: 'booker' });
      expect(invited).toMatchObject({ state: 'invited', role: 'booker', phoneEnds: selam.phone.slice(-3) });

      // Not in yet: a number addresses, it never admits.
      expect(() => businesses.session(selam.personDid, entity.entityId)).toThrow(/No such business/);
      const [mine] = businesses.mine(selam.personDid);
      expect(mine).toMatchObject({ entityId: entity.entityId, state: 'invited', invitedBy: 'Abebe Kebede' });
      businesses.accept(selam.personDid, mine.memberId);
      expect(actingAs(selam.personDid, entity.entityId).member.role).toBe('booker');
    });

    it('answers the same whether or not the number has an account — the invitation just waits for whoever signs in with it', () => {
      const owner = aPerson();
      const { entity } = setUp(owner.personDid);
      const acting = actingAs(owner.personDid, entity.entityId);
      const known = aPerson();
      const a = businesses.invite(acting, { phone: known.phone, name: 'Known', role: 'viewer' });
      const b = businesses.invite(acting, { phone: '+251911777001', name: 'Nobody yet', role: 'viewer' });
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      expect(a.state).toBe(b.state);
    });

    it('will not let somebody else accept an invitation that is not theirs, and says nothing about whose it is', () => {
      const owner = aPerson();
      const { entity } = setUp(owner.personDid);
      const selam = aPerson();
      const { memberId } = businesses.invite(actingAs(owner.personDid, entity.entityId), { phone: selam.phone, name: 'Selam', role: 'booker' });
      const colleague = aPerson();
      expect(() => businesses.accept(colleague.personDid, memberId)).toThrow(/No such invitation/);
    });

    it('lets only an owner add people', () => {
      const owner = aPerson();
      const { entity } = setUp(owner.personDid);
      const booker = aPerson();
      const { memberId } = businesses.invite(actingAs(owner.personDid, entity.entityId), { phone: booker.phone, name: 'Booker', role: 'booker' });
      businesses.accept(booker.personDid, memberId);
      expect(() => businesses.invite(actingAs(booker.personDid, entity.entityId), { phone: '+251911777002', name: 'X', role: 'owner' })).toThrow(/Only an owner/);
    });

    it('takes somebody out on their NEXT request, with the session they already hold', () => {
      const owner = aPerson();
      const { entity } = setUp(owner.personDid);
      const leaver = aPerson();
      const { memberId } = businesses.invite(actingAs(owner.personDid, entity.entityId), { phone: leaver.phone, name: 'Leaver', role: 'booker' });
      businesses.accept(leaver.personDid, memberId);
      const { token } = businesses.session(leaver.personDid, entity.entityId);
      expect(businesses.requireMember(auth.introspect(token.access_token)).member.name).toBe('Leaver');

      businesses.remove(actingAs(owner.personDid, entity.entityId), memberId);
      // The token is still valid as a token. The person is no longer in the business, and that is what is asked.
      expect(auth.introspect(token.access_token).active).toBe(true);
      expect(() => businesses.requireMember(auth.introspect(token.access_token))).toThrow(/no longer in this business/);
    });

    it('makes a viewer read-only, and lets them leave', () => {
      const owner = aPerson();
      const { entity } = setUp(owner.personDid);
      const viewer = aPerson();
      const { memberId } = businesses.invite(actingAs(owner.personDid, entity.entityId), { phone: viewer.phone, name: 'Viewer', role: 'viewer' });
      businesses.accept(viewer.personDid, memberId);
      const acting = actingAs(viewer.personDid, entity.entityId);
      expect(businesses.mayAct(acting)).toBe(false);
      expect(businesses.mayAct(actingAs(owner.personDid, entity.entityId))).toBe(true);
      businesses.remove(acting, memberId);
      expect(businesses.mine(viewer.personDid)).toEqual([]);
    });

    it('always keeps an owner: the last one can neither go nor become something else', () => {
      const owner = aPerson();
      const { entity, member } = setUp(owner.personDid);
      const acting = actingAs(owner.personDid, entity.entityId);
      expect(() => businesses.remove(acting, member.memberId)).toThrow(/always has an owner/);
      expect(() => businesses.setRole(acting, member.memberId, 'viewer')).toThrow(/always has an owner/);

      const second = aPerson();
      const { memberId } = businesses.invite(acting, { phone: second.phone, name: 'Second', role: 'owner' });
      // An owner who has not accepted yet is nobody's owner.
      expect(() => businesses.setRole(acting, member.memberId, 'viewer')).toThrow(/always has an owner/);
      businesses.accept(second.personDid, memberId);
      expect(businesses.setRole(acting, member.memberId, 'viewer').role).toBe('viewer');
    });

    it('refuses the same number twice in one business', () => {
      const owner = aPerson();
      const { entity } = setUp(owner.personDid);
      const acting = actingAs(owner.personDid, entity.entityId);
      businesses.invite(acting, { phone: '+251911777003', name: 'A', role: 'booker' });
      expect(() => businesses.invite(acting, { phone: '+251911777003', name: 'A again', role: 'booker' })).toThrow(/already in this business/);
      expect(() => businesses.invite(acting, { phone: owner.phone, name: 'Me', role: 'booker' })).toThrow(/already in this business/);
    });
  });

  describe('SeeBuyGet checking who it is', () => {
    function asked() {
      const owner = aPerson();
      const { entity } = setUp(owner.personDid, { name: `Checked Trading ${(seq += 1)}` });
      papers(entity.entityId);
      businesses.askForCheck(actingAs(owner.personDid, entity.entityId));
      return { owner, entityId: entity.entityId };
    }
    const verifyPapers = (entityId: string) => {
      for (const d of documents.list(entityId)) documents.verify(entityId, d.documentId, 'Amina Staff');
    };

    it('cannot be asked for without the registration certificate and the representative’s ID', () => {
      const owner = aPerson();
      const { entity } = setUp(owner.personDid);
      const acting = actingAs(owner.personDid, entity.entityId);
      expect(businesses.view(entity.entityId, owner.personDid).check.missing).toEqual(['certificate_of_incorporation', 'representative_id']);
      expect(() => businesses.askForCheck(acting)).toThrow(/registration certificate/);
    });

    it('takes two different members of staff, on papers somebody has verified', () => {
      const { owner, entityId } = asked();
      const amina = { name: 'Amina Staff', key: 'operator:amina' };
      const brian = { name: 'Brian Staff', key: 'operator:brian' };
      expect(() => businesses.approve(entityId, amina)).toThrow(/Verify the registration certificate/);
      verifyPapers(entityId);
      expect(businesses.approve(entityId, amina).business?.verification.state).toBe('checking');
      // The same member of staff twice is one person, however many clicks.
      expect(() => businesses.approve(entityId, amina)).toThrow(/A second member of staff/);
      const done = businesses.approve(entityId, brian);
      expect(done.business?.verification).toMatchObject({ state: 'verified', firstBy: 'Amina Staff', verifiedBy: 'Brian Staff' });
      expect(listedPublicly(done)).toBe(true);
      // The owner is told, at their recovery email.
      expect(outbox.recent(owner.email).filter((m) => m.template === 'business-checked')).toHaveLength(1);
    });

    it('is shown to no stranger until then', () => {
      const { entityId } = asked();
      expect(listedPublicly(entities.get(entityId))).toBe(false);
      expect(businesses.staffRow(entityId).handle).toBeUndefined();
    });

    it('is refused only with a reason, which the business reads and can ask again after', () => {
      const { owner, entityId } = asked();
      expect(() => businesses.refuse(entityId, { name: 'Amina Staff' }, '  ')).toThrow(/Say why/);
      businesses.refuse(entityId, { name: 'Amina Staff' }, 'The certificate is for a different company');
      const view = businesses.view(entityId, owner.personDid);
      expect(view.check).toMatchObject({ state: 'refused', reason: 'The certificate is for a different company' });
      expect(outbox.recent(owner.email).filter((m) => m.template === 'business-checked')).toHaveLength(1);
      expect(businesses.askForCheck(actingAs(owner.personDid, entityId)).business?.verification.state).toBe('asked');
    });

    it('goes back to unchecked when the name or registration number changes — those are what was checked', () => {
      const { owner, entityId } = asked();
      verifyPapers(entityId);
      businesses.approve(entityId, { name: 'Amina Staff', key: 'operator:amina' });
      businesses.approve(entityId, { name: 'Brian Staff', key: 'operator:brian' });
      const acting = actingAs(owner.personDid, entityId);
      // What it does is its own business: the check stands.
      expect(businesses.update(acting, { activities: ['importer', 'shipper'] }).business?.verification.state).toBe('verified');
      expect(businesses.update(acting, { name: 'Somebody Else Entirely PLC' }).business?.verification.state).toBe('unverified');
    });

    it('lets only an owner ask', () => {
      const owner = aPerson();
      const { entity } = setUp(owner.personDid);
      papers(entity.entityId);
      const booker = aPerson();
      const { memberId } = businesses.invite(actingAs(owner.personDid, entity.entityId), { phone: booker.phone, name: 'Booker', role: 'booker' });
      businesses.accept(booker.personDid, memberId);
      expect(() => businesses.askForCheck(actingAs(booker.personDid, entity.entityId))).toThrow(/Only an owner/);
    });
  });
});
