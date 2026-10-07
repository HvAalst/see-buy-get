import { Test } from '@nestjs/testing';
import { AuthService } from '../../foundation/auth/auth.service';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { DidService } from '../../foundation/did/did.service';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { HandleService } from '../../foundation/handle/handle.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { maskAddress } from '../../foundation/mail/mail.service';
import { appUrl, renderMail } from '../../foundation/mail/mail.templates';
import { BusinessService } from './business.service';
import { ConsignmentNoteService } from './consignment-note.service';
import type { Freight } from './dispatch.types';
import { DocumentLinkService, LINK_MAX_LIVE } from './document-link.service';
import { MediaService } from './media.service';
import { NoteArchiveService } from './note-archive.service';
import { boardDocId } from './note-archive.types';
import { NoteBundleService } from './note-bundle.service';
import { PersonService } from './person.service';

/*
 * A BUSINESS'S DELIVERED LOAD SENDS A RECEIPT TOO — to a person, because a business has no mailbox of its own.
 *
 * Everybody in a business signs in as themselves, so "email the business" has to be answered with a name: the one who
 * posted the load, and the owners when that person cannot be emailed. The receipt carries the same link to the note as
 * a shop's does — which puts a way into the business's notes in one person's own mailbox. So the other half of this is
 * what becomes of that link when the person is no longer in the business.
 *
 * On the real business, person and token services; a real note builder, archive, bundle and link service on a real
 * bus. Only the load itself and the mail are stood in for — and the mail is what is asserted on.
 */

const SHOP = 'did:shop:a1';
const DRIVER = 'did:drv:amos';
const FLEET = 'did:fleet:kilima';
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

describe('the receipt for a business’s delivered load', () => {
  const archives: NoteArchiveService[] = [];
  afterEach(() => {
    for (const a of archives.splice(0)) a.onModuleDestroy();
  });

  let seq = 0;

  async function setUp() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BusinessService, PersonService, MediaService, AuthService, DidService, EntityService, CompanyDocumentService, HandleService,
        IdentityVault, OperationalStore, FieldEncryption, EventBus, LedgerService, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    const entities = moduleRef.get(EntityService);
    entities.seed();
    const businesses = moduleRef.get(BusinessService);
    const persons = moduleRef.get(PersonService);
    const auth = moduleRef.get(AuthService);
    const bus = moduleRef.get(EventBus);

    const freights: Record<string, Freight> = {};
    const sent: Array<{ template: string; to: { address: string; name?: string }; params: Record<string, unknown> }> = [];
    const notes = new ConsignmentNoteService(
      { requireFreightPublic: (id: string) => freights[id] ?? (() => { throw new Error('not found'); })() } as never,
      { get: (did: string) => ({ displayName: 'Amos K.', managerDid: did === DRIVER ? FLEET : undefined, jurisdiction: 'KE' }) } as never,
      { get: () => ({ companyName: 'Kilima Logistics', depotAddress: '1 Depot Rd', jurisdiction: 'KE', did: FLEET }) } as never,
      { get: (did: string) => ({ shopName: 'Mama Sarah Shop', landmark: 'Next to the market', country: 'KE', did }) } as never,
      { has: () => false, get: () => ({}) } as never,
      bus,
      { papersOnNote: () => [], noteParties: () => null } as never,
      { emailForDid: (did: string) => (did === SHOP ? 'mama.sarah@kilima.co.ke' : undefined) } as never,
      { send: async (template: string, to: { address: string; name?: string }, params: Record<string, unknown>) => (sent.push({ template, to, params }), true) } as never,
      entities,
      businesses,
    );
    notes.onModuleInit();
    const archive = new NoteArchiveService({ requireFreightPublic: (id: string) => freights[id] } as never, notes, {} as never, {} as never, bus);
    archive.onModuleInit();
    archives.push(archive);
    const bundles = new NoteBundleService(archive, notes, { get: () => undefined, blob: () => { throw new Error('no photograph'); } } as never);
    const links = new DocumentLinkService(archive, bundles, notes, businesses, persons);
    links.onModuleInit();

    /** A person who signed in with their phone and chose a PIN — and, unless told otherwise, confirmed a recovery email. */
    const aPerson = (email: string | null = `p${(seq += 1)}-${Date.now()}@kilima.co.ke`) => {
      seq += 1;
      const phone = `+2519120${String(seq).padStart(5, '0')}`;
      const person = persons.ensurePerson(phone);
      persons.setPin(person.personDid, '4826');
      if (email) persons.setEmail(person.personDid, email);
      return { personDid: person.personDid, phone, email: email ?? '' };
    };
    const aBusiness = (ownerDid: string, name = `Abebe Import ${(seq += 1)}`) => businesses.create(ownerDid, { name, country: 'ET', registrationNo: `REG-${(seq += 1)}`, activities: ['importer'], yourName: 'Abebe Kebede' }).entity;
    /** The sign-in a request from this person, for this business, arrives with. */
    const signIn = (personDid: string, entityId: string): IntrospectionResult => auth.introspect(businesses.session(personDid, entityId).token.access_token);
    /** Somebody added by an owner, who accepted with their own sign-in. */
    const join = (entityId: string, ownerDid: string, who: { personDid: string; phone: string }, name: string, role: string) => {
      const invited = businesses.invite(businesses.requireMember(signIn(ownerDid, entityId)), { phone: who.phone, name, role });
      businesses.accept(who.personDid, invited.memberId);
      return invited.memberId;
    };

    const load = (id: string, postedByDid: string, over: Partial<Freight> = {}): Freight =>
      ({
        freightId: id,
        code: `FRT-${id}`,
        description: 'Cement, 12 pallets',
        pickupLocation: { lat: 9.0, lng: 38.7 },
        pickupLabel: 'Kality Depot',
        destLabel: 'Adama Yard',
        weightKg: 9000,
        cargoClass: 'P5',
        natureCode: 'GEN',
        requiredCapabilities: [],
        requiredEquipment: [],
        status: 'delivered',
        postedByDid,
        ...(postedByDid === SHOP ? { shipperDid: SHOP } : { settlement: 'between_parties' }),
        claimedBy: DRIVER,
        claimedAt: '2026-10-06T08:00:00Z',
        createdAt: '2026-10-06T07:30:00Z',
        pickedUpAt: '2026-10-06T09:00:00Z',
        deliveredAt: '2026-10-06T12:04:00Z',
        lockedPrice: 18500,
        pickupCountry: 'ET',
        destCountry: 'ET',
        ...over,
      }) as Freight;
    const pickUp = async (id: string, postedByDid: string) => {
      freights[id] = load(id, postedByDid, { status: 'in_transit', deliveredAt: undefined });
      await bus.publish(GlosEvent.Pudo.FreightPickedUp, { freightId: id }, { source: 'test' });
      await flush();
    };
    const handOver = async (id: string, postedByDid: string) => {
      freights[id] = load(id, postedByDid, { proofOfDelivery: { receiverName: 'Tigist at the yard', photoRef: 'med_pod', confirmed: [], at: '2026-10-06T12:04:00Z' } as never });
      await bus.publish(GlosEvent.Pudo.FreightDelivered, { freightId: id }, { source: 'test' });
      await flush();
    };
    /** Posted by this sign-in, taken over, handed over: the receipt goes (or does not). */
    const deliver = async (id: string, postedByDid: string, poster?: IntrospectionResult) => {
      if (poster) businesses.notePosted(id, poster);
      await pickUp(id, postedByDid);
      await handOver(id, postedByDid);
    };
    const tokenOf = (url: unknown) => String(url).split('#doc=')[1];
    const receipts = () => sent.filter((m) => m.template === 'freight-delivered');
    return { businesses, persons, entities, links, sent, receipts, freights, aPerson, aBusiness, signIn, join, pickUp, handOver, deliver, tokenOf, notes };
  }

  /** An office of three: Abebe owns it, Selam books its loads, Dawit only looks. */
  async function anOffice() {
    const s = await setUp();
    const abebe = s.aPerson();
    const selam = s.aPerson();
    const dawit = s.aPerson();
    const biz = s.aBusiness(abebe.personDid, 'Abebe Import & Export PLC');
    const selamId = s.join(biz.entityId, abebe.personDid, selam, 'Selam Tesfaye', 'booker');
    const dawitId = s.join(biz.entityId, abebe.personDid, dawit, 'Dawit Alemu', 'viewer');
    const asOwner = () => s.businesses.requireMember(s.signIn(abebe.personDid, biz.entityId));
    return { ...s, abebe, selam, dawit, biz, selamId, dawitId, asOwner };
  }

  describe('who it goes to', () => {
    it('goes to the person who posted the load, at their own address — and to nobody else in the office', async () => {
      const o = await anOffice();
      await o.deliver('b1', o.biz.did, o.signIn(o.selam.personDid, o.biz.entityId));

      expect(o.receipts().map((m) => m.to)).toEqual([{ address: o.selam.email, name: 'Selam Tesfaye' }]);
      expect(o.receipts()[0].params).toMatchObject({ code: 'FRT-b1', noteNumber: 'CMR-FRT-b1', business: { name: 'Abebe Import & Export PLC', as: 'poster' } });
    });

    it('carries a link that opens the business’s own copy of the note, with nobody signed in', async () => {
      const o = await anOffice();
      await o.deliver('b1', o.biz.did, o.signIn(o.selam.personDid, o.biz.entityId));

      const token = o.tokenOf(o.receipts()[0].params.noteUrl);
      expect(o.links.look(token)).toMatchObject({ state: 'ready', number: 'CMR-FRT-b1', from: 'Kality Depot', to: 'Adama Yard' });
      const file = o.links.fetch(token);
      expect(file.filename).toMatch(/\.zip$/);
      expect(file.bytes.subarray(0, 2).toString()).toBe('PK');
      // On the note, where the business sees it: who it was emailed to (masked), and that it was opened once.
      const rows = o.links.listFor(boardDocId('b1'), o.signIn(o.abebe.personDid, o.biz.entityId));
      expect(rows).toEqual([expect.objectContaining({ state: 'ready', sentTo: maskAddress(o.selam.email), opened: 1 })]);
      // Which person it went to is kept to stop it with — and is nobody's to read.
      expect(JSON.stringify(rows)).not.toContain(o.selam.personDid);
    });

    it('goes to the owners in their place when the poster has left the business — asked at delivery, not at posting', async () => {
      const o = await anOffice();
      const second = o.aPerson();
      o.join(o.biz.entityId, o.abebe.personDid, second, 'Hana Bekele', 'owner');
      const posted = o.signIn(o.selam.personDid, o.biz.entityId);
      o.businesses.notePosted('b1', posted);
      await o.pickUp('b1', o.biz.did);
      o.businesses.remove(o.asOwner(), o.selamId);
      await o.handOver('b1', o.biz.did);

      // Both owners, longest in the business first; each their own link, because each is counted and cancelled by who it went to.
      expect(o.receipts().map((m) => [m.to.address, (m.params.business as { as: string }).as])).toEqual([[o.abebe.email, 'owner'], [second.email, 'owner']]);
      const tokens = o.receipts().map((m) => o.tokenOf(m.params.noteUrl));
      expect(new Set(tokens).size).toBe(2);
      for (const t of tokens) expect(o.links.look(t).state).toBe('ready');
      expect(o.sent.map((m) => m.to.address)).not.toContain(o.selam.email);
    });

    it('goes to the owners when the poster has given no email address', async () => {
      const s = await setUp();
      const abebe = s.aPerson();
      const quiet = s.aPerson(null);
      const biz = s.aBusiness(abebe.personDid);
      s.join(biz.entityId, abebe.personDid, quiet, 'Kebede Girma', 'booker');
      await s.deliver('b1', biz.did, s.signIn(quiet.personDid, biz.entityId));

      expect(s.receipts().map((m) => [m.to.address, (m.params.business as { as: string }).as])).toEqual([[abebe.email, 'owner']]);
    });

    it('still goes to the poster after they were made a viewer: they are in the business, and may read its notes', async () => {
      const o = await anOffice();
      o.businesses.notePosted('b1', o.signIn(o.selam.personDid, o.biz.entityId));
      await o.pickUp('b1', o.biz.did);
      o.businesses.setRole(o.asOwner(), o.selamId, 'viewer');
      await o.handOver('b1', o.biz.did);

      expect(o.receipts().map((m) => m.to.address)).toEqual([o.selam.email]);
    });

    it('goes to the owners for a load whose poster is not on record, and never to somebody only invited', async () => {
      const o = await anOffice();
      // An owner-to-be who has not accepted: invited by number, in nothing yet.
      const invited = o.aPerson();
      o.businesses.invite(o.asOwner(), { phone: invited.phone, name: 'Not yet', role: 'owner' });
      await o.deliver('b1', o.biz.did);

      expect(o.receipts().map((m) => m.to.address)).toEqual([o.abebe.email]);
    });

    it('reads who posted a load as one of THIS business’s people: a record made under another business names nobody here', async () => {
      const o = await anOffice();
      // Selam is in two businesses. The record says she posted this load signed in to the OTHER one.
      const theirs = o.aBusiness(o.aPerson().personDid, 'Somebody Else Ltd');
      const owner = (o.businesses as unknown as { members: Map<string, { entityId: string; role: string; personDid?: string }> }).members;
      const theirOwner = [...owner.values()].find((m) => m.entityId === theirs.entityId && m.role === 'owner')!;
      o.join(theirs.entityId, theirOwner.personDid!, o.selam, 'Selam Tesfaye', 'booker');
      await o.deliver('b1', o.biz.did, o.signIn(o.selam.personDid, theirs.entityId));

      // So she is not "the person who posted it" for this business, and its owner is told in the ordinary way.
      expect(o.receipts().map((m) => [m.to.address, (m.params.business as { as: string }).as])).toEqual([[o.abebe.email, 'owner']]);
    });

    it('sends nothing, and makes no link, when nobody in the business can be emailed', async () => {
      const s = await setUp();
      const quiet = s.aPerson(null);
      const biz = s.aBusiness(quiet.personDid);
      await s.deliver('b1', biz.did, s.signIn(quiet.personDid, biz.entityId));

      expect(s.sent).toEqual([]);
      expect(s.links.listFor(boardDocId('b1'), s.signIn(quiet.personDid, biz.entityId))).toEqual([]);
    });

    it('keeps who posted only for a business sign-in, and answers nobody for anything that is not a business', async () => {
      const o = await anOffice();
      o.businesses.notePosted('s1', { active: true, role: 'pudo', did: SHOP } as unknown as IntrospectionResult);
      o.businesses.notePosted('s2', { active: true, role: 'business', did: o.biz.did, tenant: o.biz.entityId } as unknown as IntrospectionResult);
      expect([...(o.businesses as unknown as { posters: Map<string, unknown> }).posters.keys()]).toEqual([]);
      expect(o.businesses.receiptPeople(SHOP, 's1')).toEqual([]);
      expect(o.businesses.receiptPeople('did:glos:nobody', 's1')).toEqual([]);
    });

    it('leaves a shop’s receipt exactly as it was: one email, to the shop’s account, in the shop’s words', async () => {
      const o = await anOffice();
      await o.deliver('s1', SHOP);

      expect(o.receipts().map((m) => m.to.address)).toEqual(['mama.sarah@kilima.co.ke']);
      expect(o.receipts()[0].params.business).toBeUndefined();
      expect(o.links.look(o.tokenOf(o.receipts()[0].params.noteUrl)).state).toBe('ready');
    });
  });

  describe('what it says', () => {
    const base = { code: 'FRT-204', description: 'Cement, 12 pallets', destination: 'Adama Yard', deliveredAt: '2026-10-06T12:04:00Z', carrier: 'Kilima Logistics', amount: 18500, currency: 'ETB', noteNumber: 'CMR-FRT-204' };
    const link = { noteUrl: `${appUrl('home')}#doc=${'k'.repeat(43)}`, noteUntil: '2026-11-05T12:04:00Z' };
    const poster = { business: { name: 'Abebe Import & Export PLC', as: 'poster' as const } };

    it('names the Business app — where the load, its note and its links are — and never the Shop app', () => {
      const withLink = renderMail('freight-delivered', { ...base, ...link, ...poster });
      expect(withLink.text).toContain('on the load itself: in the Business app, under Loads');
      expect(withLink.text).not.toContain('Shop app');
      const without = renderMail('freight-delivered', { ...base, ...poster });
      expect(without.text).toContain('is on the load in the Business app under Loads');
      expect(without.html).toContain(`href="${appUrl('business')}"`);
      expect(without.text).not.toContain('Shop app');
    });

    it('says the price is theirs and the carrier’s, and that this is not an invoice: we hold none of a business’s money', () => {
      const mail = renderMail('freight-delivered', { ...base, ...link, ...poster });
      expect(mail.text).toContain('Price agreed');
      expect(mail.text).not.toContain('Carriage charges');
      expect(mail.text).toContain('settled between the two of you');
      expect(mail.text).toContain('this email is not an invoice');
      // …and says none of it where no price was agreed: there is nothing to disown.
      const { amount: _a, currency: _c, ...unpriced } = base;
      expect(renderMail('freight-delivered', { ...unpriced, ...link, ...poster }).text).not.toContain('invoice');
    });

    it('says why THIS person is told: they posted it — or they are an owner and the poster cannot be emailed', () => {
      expect(renderMail('freight-delivered', { ...base, ...poster }).text).toContain('because you posted this load for Abebe Import & Export PLC');
      const owner = renderMail('freight-delivered', { ...base, business: { name: 'Abebe Import & Export PLC', as: 'owner' } });
      expect(owner.text).toContain('because you are an owner of Abebe Import & Export PLC');
      expect(owner.text).toContain('the person who posted it cannot be emailed');
    });

    it('keeps the shop’s words for a shop: the charge is a charge, and nothing is disowned', () => {
      const mail = renderMail('freight-delivered', { ...base, ...link });
      expect(mail.text).toContain('Carriage charges');
      expect(mail.text).toContain('in the Shop app, Records, then Notes');
      expect(mail.text).toContain('because your shop posted this load');
      expect(mail.text).not.toContain('invoice');
      expect(mail.text).not.toContain('Business app');
    });
  });

  describe('when somebody is no longer in the business', () => {
    it('stops the link that was emailed to them, at once — and says on the note what became of it', async () => {
      const o = await anOffice();
      await o.deliver('b1', o.biz.did, o.signIn(o.selam.personDid, o.biz.entityId));
      const token = o.tokenOf(o.receipts()[0].params.noteUrl);
      expect(o.links.look(token).state).toBe('ready');

      o.businesses.remove(o.asOwner(), o.selamId);

      expect(o.links.look(token)).toEqual({ state: 'cancelled', expiresAt: expect.any(String) });
      expect(() => o.links.fetch(token)).toThrow(/cancelled/);
      expect(o.links.listFor(boardDocId('b1'), o.signIn(o.abebe.personDid, o.biz.entityId))).toEqual([
        expect.objectContaining({ state: 'cancelled', sentTo: maskAddress(o.selam.email), cancelledWhy: 'left', cancelledAt: expect.any(String) }),
      ]);
    });

    it('does the same when they leave by themselves', async () => {
      const o = await anOffice();
      await o.deliver('b1', o.biz.did, o.signIn(o.selam.personDid, o.biz.entityId));
      const token = o.tokenOf(o.receipts()[0].params.noteUrl);

      o.businesses.remove(o.businesses.requireMember(o.signIn(o.selam.personDid, o.biz.entityId)), o.selamId);

      expect(o.links.look(token).state).toBe('cancelled');
    });

    it('stops only what was sent to THEM: another person’s receipt, and a link they made for the business to pass on, go on working', async () => {
      const o = await anOffice();
      const second = o.aPerson();
      const secondId = o.join(o.biz.entityId, o.abebe.personDid, second, 'Hana Bekele', 'owner');
      // No poster on record: both owners are sent a receipt, each with their own link.
      await o.deliver('b1', o.biz.did);
      const [abebes, hanas] = o.receipts().map((m) => o.tokenOf(m.params.noteUrl));
      // Hana makes one in the app, for the business's customer.
      const passedOn = o.tokenOf(o.links.make(boardDocId('b1'), o.signIn(second.personDid, o.biz.entityId)).url);

      o.businesses.remove(o.asOwner(), secondId);

      expect(o.links.look(hanas).state).toBe('cancelled');
      expect(o.links.look(abebes).state).toBe('ready');
      // Made for the business, on its note for the business to see and to cancel. Not hers to take with her.
      expect(o.links.look(passedOn).state).toBe('ready');
    });

    it('stops it for THAT business only: somebody in two keeps what the other one sent them', async () => {
      const s = await setUp();
      const abebe = s.aPerson();
      const selam = s.aPerson();
      const one = s.aBusiness(abebe.personDid, 'One PLC');
      const two = s.aBusiness(abebe.personDid, 'Two PLC');
      const inOne = s.join(one.entityId, abebe.personDid, selam, 'Selam Tesfaye', 'booker');
      s.join(two.entityId, abebe.personDid, selam, 'Selam Tesfaye', 'booker');
      await s.deliver('one-1', one.did, s.signIn(selam.personDid, one.entityId));
      await s.deliver('two-1', two.did, s.signIn(selam.personDid, two.entityId));
      const [fromOne, fromTwo] = s.receipts().map((m) => s.tokenOf(m.params.noteUrl));

      s.businesses.remove(s.businesses.requireMember(s.signIn(abebe.personDid, one.entityId)), inOne);

      expect(s.links.look(fromOne).state).toBe('cancelled');
      expect(s.links.look(fromTwo).state).toBe('ready');
    });

    it('leaves it alone when they are only made a viewer: a viewer still reads the business’s notes', async () => {
      const o = await anOffice();
      await o.deliver('b1', o.biz.did, o.signIn(o.selam.personDid, o.biz.entityId));
      const token = o.tokenOf(o.receipts()[0].params.noteUrl);

      o.businesses.setRole(o.asOwner(), o.selamId, 'viewer');

      expect(o.links.look(token).state).toBe('ready');
    });

    it('stays stopped if they are added again: a cancelled link is never switched back on', async () => {
      const o = await anOffice();
      await o.deliver('b1', o.biz.did, o.signIn(o.selam.personDid, o.biz.entityId));
      const token = o.tokenOf(o.receipts()[0].params.noteUrl);
      o.businesses.remove(o.asOwner(), o.selamId);

      o.join(o.biz.entityId, o.abebe.personDid, o.selam, 'Selam Tesfaye', 'booker');

      expect(o.links.look(token).state).toBe('cancelled');
    });
  });

  describe('when somebody replaces their recovery email', () => {
    it('stops every link that was emailed to the old address, for whichever business it was sent — and says why', async () => {
      const s = await setUp();
      const abebe = s.aPerson();
      const selam = s.aPerson();
      const one = s.aBusiness(abebe.personDid, 'One PLC');
      const two = s.aBusiness(abebe.personDid, 'Two PLC');
      s.join(one.entityId, abebe.personDid, selam, 'Selam Tesfaye', 'booker');
      s.join(two.entityId, abebe.personDid, selam, 'Selam Tesfaye', 'booker');
      await s.deliver('one-1', one.did, s.signIn(selam.personDid, one.entityId));
      await s.deliver('two-1', two.did, s.signIn(selam.personDid, two.entityId));
      const [fromOne, fromTwo] = s.receipts().map((m) => s.tokenOf(m.params.noteUrl));

      s.persons.setEmail(selam.personDid, `moved-${Date.now()}@kilima.co.ke`);

      expect(s.links.look(fromOne)).toEqual({ state: 'cancelled', expiresAt: expect.any(String) });
      expect(s.links.look(fromTwo).state).toBe('cancelled');
      expect(() => s.links.fetch(fromOne)).toThrow(/cancelled/);
      expect(s.links.listFor(boardDocId('one-1'), s.signIn(abebe.personDid, one.entityId))).toEqual([
        expect.objectContaining({ state: 'cancelled', sentTo: maskAddress(selam.email), cancelledWhy: 'address', cancelledAt: expect.any(String) }),
      ]);
    });

    it('stops nothing when the same address is only confirmed again', async () => {
      const o = await anOffice();
      await o.deliver('b1', o.biz.did, o.signIn(o.selam.personDid, o.biz.entityId));
      const token = o.tokenOf(o.receipts()[0].params.noteUrl);

      o.persons.setEmail(o.selam.personDid, o.selam.email.toUpperCase());

      expect(o.links.look(token).state).toBe('ready');
    });

    it('stops only what went to THAT person’s mailbox: a colleague’s receipt and a link made to pass on go on working', async () => {
      const o = await anOffice();
      const second = o.aPerson();
      o.join(o.biz.entityId, o.abebe.personDid, second, 'Hana Bekele', 'owner');
      await o.deliver('b1', o.biz.did);
      const [abebes, hanas] = o.receipts().map((m) => o.tokenOf(m.params.noteUrl));
      const passedOn = o.tokenOf(o.links.make(boardDocId('b1'), o.signIn(second.personDid, o.biz.entityId)).url);

      o.persons.setEmail(second.personDid, `hana-${Date.now()}@kilima.co.ke`);

      expect(o.links.look(hanas).state).toBe('cancelled');
      expect(o.links.look(abebes).state).toBe('ready');
      expect(o.links.look(passedOn).state).toBe('ready');
    });

    it('sends the next receipt to the new address, with a link that works', async () => {
      const o = await anOffice();
      const posted = o.signIn(o.selam.personDid, o.biz.entityId);
      await o.deliver('b1', o.biz.did, posted);
      const moved = `selam-${Date.now()}@kilima.co.ke`;
      o.persons.setEmail(o.selam.personDid, moved);
      await o.deliver('b2', o.biz.did, posted);

      expect(o.receipts().map((m) => m.to.address)).toEqual([o.selam.email, moved]);
      expect(o.links.look(o.tokenOf(o.receipts()[1].params.noteUrl)).state).toBe('ready');
    });

    it('never applies a reason that belongs to one business to them all: “left” without saying which stops nothing', async () => {
      const o = await anOffice();
      await o.deliver('b1', o.biz.did, o.signIn(o.selam.personDid, o.biz.entityId));
      const token = o.tokenOf(o.receipts()[0].params.noteUrl);

      expect(o.links.stopSentTo(o.selam.personDid, 'left')).toBe(0);
      expect(o.links.stopSentTo('', 'address')).toBe(0);
      expect(o.links.look(token).state).toBe('ready');
      // Stopped once, it is stopped: the first reason stays, and a second stop finds nothing to do.
      expect(o.links.stopSentTo(o.selam.personDid, 'address')).toBe(1);
      expect(o.links.stopSentTo(o.selam.personDid, 'left', o.biz.did)).toBe(0);
      expect(o.links.listFor(boardDocId('b1'), o.signIn(o.abebe.personDid, o.biz.entityId))[0].cancelledWhy).toBe('address');
    });
  });

  describe('the handful of links a note may have', () => {
    it('holds for receipts too: with the handful already working, the email goes without a link and says where the note is', async () => {
      const o = await anOffice();
      const asSelam = o.signIn(o.selam.personDid, o.biz.entityId);
      o.businesses.notePosted('b1', asSelam);
      await o.pickUp('b1', o.biz.did);
      for (let i = 0; i < LINK_MAX_LIVE; i++) o.links.make(boardDocId('b1'), asSelam);
      await o.handOver('b1', o.biz.did);

      // The receipt went — a delivery is told whatever became of the link.
      expect(o.receipts().map((m) => m.to.address)).toEqual([o.selam.email]);
      expect(o.receipts()[0].params.noteUrl).toBeUndefined();
      expect(o.links.listFor(boardDocId('b1'), asSelam)).toHaveLength(LINK_MAX_LIVE);
    });

    it('is one handful per note however many owners are told: the first ones get a link, the rest are told where the note is', async () => {
      const s = await setUp();
      const first = s.aPerson();
      const biz = s.aBusiness(first.personDid);
      for (let i = 0; i < LINK_MAX_LIVE + 1; i++) s.join(biz.entityId, first.personDid, s.aPerson(), `Owner ${i}`, 'owner');
      await s.deliver('b1', biz.did);

      expect(s.receipts()).toHaveLength(LINK_MAX_LIVE + 2);
      expect(s.receipts().filter((m) => m.params.noteUrl)).toHaveLength(LINK_MAX_LIVE);
      // The first owner — the longest in the business — is among the ones with a link.
      expect(s.receipts()[0]).toMatchObject({ to: { address: first.email }, params: { noteUrl: expect.stringContaining('#doc=') } });
    });
  });

  describe('who cancelled a link', () => {
    it('is kept by name where the sign-in names a person — in an office, “cancelled” is half an answer', async () => {
      const o = await anOffice();
      await o.deliver('b1', o.biz.did, o.signIn(o.selam.personDid, o.biz.entityId));
      const asOwner = o.signIn(o.abebe.personDid, o.biz.entityId);
      const [row] = o.links.listFor(boardDocId('b1'), asOwner);

      expect(o.links.cancel(boardDocId('b1'), row.linkId, asOwner)).toMatchObject({ state: 'cancelled', cancelledBy: 'Abebe Kebede' });
      // Twice is the same as once: the first one to cancel it is who cancelled it.
      expect(o.links.cancel(boardDocId('b1'), row.linkId, o.signIn(o.selam.personDid, o.biz.entityId))).toMatchObject({ cancelledBy: 'Abebe Kebede' });
      expect(o.links.listFor(boardDocId('b1'), asOwner)[0].cancelledWhy).toBeUndefined();
    });

    it('says staff, never a member of staff’s name, when staff did it — and nothing where the sign-in names nobody', async () => {
      const o = await anOffice();
      await o.deliver('b1', o.biz.did, o.signIn(o.selam.personDid, o.biz.entityId));
      await o.deliver('s1', SHOP);
      const staff = { active: true, role: 'operator', did: 'did:glos:ops', actorName: 'Chloe Wanjiru' } as unknown as IntrospectionResult;
      const shop = { active: true, role: 'pudo', did: SHOP } as unknown as IntrospectionResult;

      const [theirs] = o.links.listFor(boardDocId('b1'), staff);
      expect(o.links.cancel(boardDocId('b1'), theirs.linkId, staff)).toMatchObject({ state: 'cancelled', cancelledBy: 'SeeBuyGet staff' });
      const [shops] = o.links.listFor(boardDocId('s1'), shop);
      const cancelled = o.links.cancel(boardDocId('s1'), shops.linkId, shop);
      expect(cancelled.state).toBe('cancelled');
      expect(cancelled.cancelledBy).toBeUndefined();
    });
  });
});
