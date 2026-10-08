import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { RoutingService } from './routing.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { VendorService } from './vendor.service';
import { ParcelService } from './parcel.service';
import { ToteService } from './tote.service';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { DispatchService } from './dispatch.service';
import { RouteConstraintService } from './route-constraint.service';
import { WalletGateService } from './wallet-gate.service';
import { CargoService } from './cargo.service';
import { MediaService } from './media.service';
import { MarketPulseStore } from './market-pulse.store';
import { MarketPulseService } from './market-pulse.service';
import { RatingService } from './rating.service';
import { MonitorService } from './monitor.service';
import { GraduationService } from './graduation.service';
import { VendorCallbackService } from './vendor-callback.service';
import { ConsignmentService } from './consignment.service';
import { BagPlanService } from './bag-plan.service';
import { ForthcomingService } from './forthcoming.service';
import { DockService } from './dock.service';
import { FleetManagerService } from './fleet-manager.service';
import { PersonService, NUMBER_UNDO_MS } from './person.service';
import { AccountService } from './account.service';
import { OtpService } from './otp.service';
import { EmailCodeService } from './email-code.service';
import { AccountRecoveryService } from './account-recovery.service';
import { NotificationService } from './notification.service';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { UnclaimedService } from './unclaimed.service';
import { ReturnService } from './return.service';
import { ConversationService } from './conversation.service';
import { MerchantRatingService } from './merchant-rating.service';
import { BusinessService } from './business.service';
import { OutboxPushSender } from './push-sender';
import { PUSH_SENDER } from './notification.types';
import { UNCOLLECTED_H, UNCOLLECTED_REMINDER_H } from './pudo.config';
import { GazetteerGeocoder, GEOCODER } from './geocoder';
import { HeuristicRouter, ROUTER } from './router';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { DidService } from '../../foundation/did/did.service';
import { AuthService } from '../../foundation/auth/auth.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { HandleService } from '../../foundation/handle/handle.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { BooksService } from '../../foundation/books/books.service';
import { FxService } from '../../foundation/money/fx.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { SandboxPayoutRail } from '../../foundation/payouts/sandbox-rail.adapter';
import { PAYOUT_RAIL } from '../../foundation/payouts/payout.types';
import { MailService } from '../../foundation/mail/mail.service';
import { OutboxMailSender } from '../../foundation/mail/outbox-mail.sender';
import { MAIL_SENDER } from '../../foundation/mail/mail.types';

/**
 * A PARCEL IS KEPT BY THE ACCOUNT, NOT BY THE NUMBER — on the real person, parcel, order, business, chat, rating and
 * notification services, and the real number change.
 *
 * Found while the number change was built (2026-10-01) and left on the progress page: a parcel was found by "the
 * number it was addressed to is the number you sign in with". So an account that moved to a new number lost sight of
 * every parcel it had; and a day later, when the old number was freed, whoever signed up with it was shown those
 * parcels — with the collection code, which is all a shop asks for.
 */
describe('a parcel is kept by the account, not by the number', () => {
  let persons: PersonService;
  let parcels: ParcelService;
  let agents: AgentService;
  let gate: WalletGateService;
  let dispatch: DispatchService;
  let otp: OtpService;
  let recovery: AccountRecoveryService;
  let notifications: NotificationService;
  let dispatcher: NotificationDispatcher;
  let conversations: ConversationService;
  let merchants: MerchantRatingService;
  let businesses: BusinessService;
  let auth: AuthService;
  let events: EventBus;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        PersonService, AccountService, OtpService, AuthService, EmailCodeService, AccountRecoveryService,
        NotificationService, OutboxPushSender, { provide: PUSH_SENDER, useExisting: OutboxPushSender },
        NotificationDispatcher, UnclaimedService, ReturnService, ConversationService, MerchantRatingService,
        BusinessService, CompanyDocumentService, HandleService,
        MailService, OutboxMailSender, { provide: MAIL_SENDER, useExisting: OutboxMailSender },
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        EntityService, PresenceService, BooksService, FxService,
        PayoutService, SandboxPayoutRail, { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail },
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    moduleRef.get(EntityService).seed();
    moduleRef.get(FxService).seed();
    persons = moduleRef.get(PersonService);
    parcels = moduleRef.get(ParcelService);
    agents = moduleRef.get(AgentService);
    gate = moduleRef.get(WalletGateService);
    dispatch = moduleRef.get(DispatchService);
    otp = moduleRef.get(OtpService);
    recovery = moduleRef.get(AccountRecoveryService);
    notifications = moduleRef.get(NotificationService);
    dispatcher = moduleRef.get(NotificationDispatcher);
    conversations = moduleRef.get(ConversationService);
    merchants = moduleRef.get(MerchantRatingService);
    businesses = moduleRef.get(BusinessService);
    auth = moduleRef.get(AuthService);
    events = moduleRef.get(EventBus);
    dispatcher.onModuleInit(); // compile() runs no lifecycle hooks: the notices that answer an event are subscribed here
  });

  afterEach(() => dispatcher.onModuleDestroy());

  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  let seq = 0;
  const PIN = '4826';
  const DAY_AND_A_BIT = NUMBER_UNDO_MS + 1000;

  /** A shop that takes parcels in at its counter, with money to do it. */
  function aShop(zone: string) {
    seq += 1;
    const hours = { open: '08:00', close: '18:00' };
    const a = agents.register({
      shopName: `Shop ${seq}`, zone, location: { lat: -1.2 - seq / 1000, lng: 36.8 }, landmark: 'next to the market',
      openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null }, shelf: { rows: 3, cols: 3 },
      fullName: `Owner ${seq}`, nationalId: `ID-PF-${seq}`, mobile: `+2547001${String(seq).padStart(5, '0')}`, deviceImei: `IMEI-PF-${seq}`,
      requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-100', criminalRecordClear: true },
    } as never);
    agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'licence.pdf', shopPhotoRefs: ['shop-1.jpg'] } as never);
    agents.decideKyc(a.did, true);
    gate.topUp(a.did, 500);
    return agents.get(a.did);
  }
  /** A number nobody has an account on. */
  const aNumber = () => `+2547110${String((seq += 1)).padStart(5, '0')}`;
  /** Somebody with an account, a PIN and a confirmed email. */
  function aPerson(phone = aNumber()) {
    const person = persons.ensurePerson(phone);
    persons.setPin(person.personDid, PIN);
    persons.setEmail(person.personDid, `person${(seq += 1)}@example.com`);
    return { personDid: person.personDid, phone };
  }
  /** A fresh number, confirmed by a code as the app would. */
  function aVerifiedNumber() {
    const phone = aNumber();
    otp.verify(phone, otp.request(phone).code);
    return phone;
  }
  /** As a request reads them: the account as it stands now, on whatever number it is on. */
  const me = (personDid: string) => persons.requireByDid(personDid);
  /** A parcel taken in at a counter: from one number, for another. */
  function aParcel(input: { from?: string; to: string }) {
    const origin = aShop('NorthTown');
    const dest = aShop('SouthTown');
    const parcelId = `QR-PF-${(seq += 1)}`;
    const handedBack = parcels.accept({ agentDid: origin.did, parcelId, size: 'M', destZone: 'SouthTown', destPudoDid: dest.did, senderMobile: input.from ?? aNumber(), receiverMobile: input.to, dropoffPhotoRef: 'drop.jpg' } as never);
    return { parcelId, origin, dest, handedBack };
  }
  const ids = (list: Array<{ parcelId: string }>) => list.map((p) => p.parcelId);
  /** The account each side of a parcel is kept by, as the parcel service has it. */
  const keptBy = (parcelId: string) => ({ sender: parcels.senderOf(parcels.get(parcelId)).owner, receiver: parcels.receiverOf(parcels.get(parcelId)).owner });

  /* ------------------------------------------------------------------ the account keeps what it had -- */

  describe('an account that moves to a new number', () => {
    it('keeps every parcel it had, received and sent — with the collection code — where it used to lose sight of them all', () => {
      const p = aPerson();
      const incoming = aParcel({ to: p.phone });
      const outgoing = aParcel({ from: p.phone, to: aNumber() });
      expect(ids(parcels.partyTo(me(p.personDid)).received)).toEqual([incoming.parcelId]);
      const code = parcels.consumerParcel(incoming.parcelId, me(p.personDid)).collectToken!.code;
      expect(code).toBeTruthy();

      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber());

      const mine = parcels.partyTo(me(p.personDid));
      expect(ids(mine.received)).toEqual([incoming.parcelId]);
      expect(ids(mine.sent)).toEqual([outgoing.parcelId]);
      expect(mine.received[0].relation).toBe('received');
      // The code is what the shop asks for: losing it is losing the parcel.
      expect(parcels.consumerParcel(incoming.parcelId, me(p.personDid)).collectToken!.code).toBe(code);
      expect(parcels.consumerParcel(outgoing.parcelId, me(p.personDid)).relation).toBe('sent');
    });

    it('keeps them when two members of staff moved it, and when the move is undone', () => {
      const p = aPerson();
      const incoming = aParcel({ to: p.phone });
      const t0 = Date.now();
      recovery.moveByStaff(p.personDid, aVerifiedNumber(), t0);
      expect(ids(parcels.partyTo(me(p.personDid)).received)).toEqual([incoming.parcelId]);

      recovery.undoWithOldNumber(p.phone, PIN, t0 + 60_000);
      expect(ids(parcels.partyTo(me(p.personDid)).received)).toEqual([incoming.parcelId]);
    });

    it('keeps the parcel that was already waiting for them when they first signed up', () => {
      // Addressed to a number nobody had an account on: it waits for whoever signs in with it.
      const phone = aNumber();
      const waiting = aParcel({ to: phone });
      const sentEarlier = aParcel({ from: phone, to: aNumber() });
      expect(keptBy(waiting.parcelId).receiver).toBeUndefined();
      const p = aPerson(phone);
      expect(ids(parcels.partyTo(me(p.personDid)).received)).toEqual([waiting.parcelId]);
      expect(ids(parcels.partyTo(me(p.personDid)).sent)).toEqual([sentEarlier.parcelId]);
      // The shop can reach them about it already: the account on the number it was addressed to.
      const thread = conversations.openAboutParcel(waiting.parcelId, waiting.dest.did);
      expect(conversations.listFor(p.personDid).map((c) => c.conversationId)).toEqual([thread.conversationId]);

      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      expect(keptBy(waiting.parcelId).receiver).toBe(p.personDid);
      expect(keptBy(sentEarlier.parcelId).sender).toBe(p.personDid);
      expect(ids(parcels.partyTo(me(p.personDid)).received)).toEqual([waiting.parcelId]);
      expect(ids(parcels.partyTo(me(p.personDid)).sent)).toEqual([sentEarlier.parcelId]);
      // And the number, freed, brings nothing of theirs to the next person on it.
      recovery.settle(t0 + DAY_AND_A_BIT);
      expect(parcels.partyTo(aPersonAt(phone)).received).toEqual([]);
    });

    it('is still told about its parcels — and whoever has the old number is told nothing', async () => {
      const p = aPerson();
      const incoming = aParcel({ to: p.phone });
      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      recovery.settle(t0 + DAY_AND_A_BIT);
      const newcomer = aPersonAt(p.phone);

      // It has been on the shelf for more than a day: the one reminder is due.
      const stored = parcels.get(incoming.parcelId);
      stored.status = 'Ready_For_Pickup';
      stored.readyAt = new Date(t0 - (UNCOLLECTED_REMINDER_H + 1) * 3_600_000).toISOString();
      expect(await dispatcher.remindUncollected(t0)).toBe(1);

      expect(notifications.inboxFor(p.personDid).map((n) => n.title)).toContain('Your parcel is still waiting');
      expect(notifications.inboxFor(newcomer.personDid).filter((n) => n.kind === 'parcel_ready')).toEqual([]);
    });
  });

  /* ------------------------------------------------------------------ the number, in somebody else's hands -- */

  /** Whoever signs up with a number once it is free. */
  function aPersonAt(phone: string) {
    const person = persons.ensurePerson(phone);
    return persons.requireByDid(person.personDid);
  }

  describe('whoever signs up with the old number once it is free', () => {
    function moved() {
      const p = aPerson();
      const incoming = aParcel({ to: p.phone });
      const outgoing = aParcel({ from: p.phone, to: aNumber() });
      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      recovery.settle(t0 + DAY_AND_A_BIT);
      return { p, incoming, outgoing, newcomer: aPersonAt(p.phone) };
    }

    it('is shown none of the parcels that were sent to, or from, the account that had it', () => {
      const { newcomer } = moved();
      expect(parcels.partyTo(newcomer)).toEqual({ sent: [], received: [] });
    });

    it('cannot open one by its id — so cannot read the collection code — and is told only that there is no such parcel', () => {
      const { incoming, outgoing, newcomer } = moved();
      expect(() => parcels.consumerParcel(incoming.parcelId, newcomer)).toThrow(/No such parcel/);
      expect(() => parcels.consumerParcel(outgoing.parcelId, newcomer)).toThrow(/No such parcel/);
      expect(() => parcels.requireReceiver(incoming.parcelId, newcomer)).toThrow(/No such parcel/);
    });

    it('cannot add a photo to it, dispute it, rate the store, or talk to the shop about it', () => {
      const { p, incoming, newcomer } = moved();
      const stored = parcels.get(incoming.parcelId);
      stored.status = 'Delivered';
      expect(() => parcels.attachPod(incoming.parcelId, newcomer, newcomer.personDid, 'pod.jpg')).toThrow(/No such parcel/);
      expect(() => parcels.buyerDispute(incoming.parcelId, newcomer, newcomer.personDid, 'It is broken', 'broken.jpg')).toThrow(/No such parcel/);
      stored.vendorId = 'ven_some_store';
      expect(() => merchants.rate({ parcelId: incoming.parcelId, phoneHash: newcomer.phoneHash, personDid: newcomer.personDid, stars: 1 })).toThrow(/No such parcel/);
      stored.status = 'Ready_For_Pickup';
      expect(() => conversations.openAboutParcel(incoming.parcelId, newcomer.personDid)).toThrow(/Parcel not found/);

      // …while the account they belong to still can, on its new number.
      expect(conversations.openAboutParcel(incoming.parcelId, p.personDid).conversationId).toBeTruthy();
      stored.status = 'Delivered';
      expect(parcels.attachPod(incoming.parcelId, me(p.personDid), p.personDid, 'pod.jpg').podPhotoRef).toBe('pod.jpg');
    });

    it('the shop’s message about a waiting parcel reaches the account it belongs to, not the newcomer', () => {
      const { p, incoming, newcomer } = moved();
      parcels.get(incoming.parcelId).status = 'Ready_For_Pickup';
      const thread = conversations.openAboutParcel(incoming.parcelId, incoming.dest.did);
      expect(conversations.listFor(p.personDid).map((c) => c.conversationId)).toContain(thread.conversationId);
      expect(conversations.listFor(newcomer.personDid)).toEqual([]);
    });

    it('moving on in their turn, takes what was sent to them there — and nothing of the account that had the number first', () => {
      const { p, incoming, outgoing, newcomer } = moved();
      const theirs = aParcel({ to: p.phone });
      persons.setPin(newcomer.personDid, PIN);
      persons.setEmail(newcomer.personDid, `newcomer${(seq += 1)}@example.com`);
      recovery.changeNumber(newcomer.personDid, PIN, aVerifiedNumber());

      expect(ids(parcels.partyTo(me(newcomer.personDid)).received)).toEqual([theirs.parcelId]);
      expect(parcels.partyTo(me(newcomer.personDid)).sent).toEqual([]);
      expect(ids(parcels.partyTo(me(p.personDid)).received)).toEqual([incoming.parcelId]);
      expect(ids(parcels.partyTo(me(p.personDid)).sent)).toEqual([outgoing.parcelId]);
    });

    it('hears none of the notices about a parcel — arrived, the code changed, time to collect — and the account it belongs to hears each', async () => {
      // Both sides have an account, and both accounts move on from the number the parcel knows them by.
      const sender = aPerson();
      const p = aPerson();
      const parcel = aParcel({ from: sender.phone, to: p.phone });
      const t0 = Date.now();
      recovery.changeNumber(sender.personDid, PIN, aVerifiedNumber(), t0);
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      recovery.settle(t0 + DAY_AND_A_BIT);
      const newcomer = aPersonAt(p.phone);
      const stored = parcels.get(parcel.parcelId);
      const titles = (did: string) => notifications.inboxFor(did).filter((n) => n.kind === 'parcel_ready').map((n) => n.title);

      stored.status = 'Ready_For_Pickup';
      stored.readyAt = new Date(t0).toISOString();
      await events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: parcel.parcelId }, { source: 'pudo' });
      await flush();
      expect(titles(p.personDid)).toEqual(['Your parcel has arrived']);

      await events.publish(GlosEvent.Pudo.ParcelReleaseCodeReissued, { parcelId: parcel.parcelId }, { source: 'pudo' });
      await flush();
      expect(titles(p.personDid)).toContain('The pickup code has changed');
      // A peer send: the sender is the relay to a receiver with no app, and is told on their new number too.
      expect(titles(sender.personDid)).toEqual(['The pickup code has changed']);

      // The free window runs out: the one notice that asks them to decide.
      expect((await dispatcher.sweepShelf(t0 + (UNCOLLECTED_H + 1) * 3_600_000)).closed).toBe(1);
      expect(titles(p.personDid)).toContain('Time to collect your parcel');
      expect(titles(newcomer.personDid)).toEqual([]);
    });

    it('IS shown what is sent to that number from now on: it is theirs', () => {
      const { p, newcomer } = moved();
      const fresh = aParcel({ to: p.phone });
      expect(ids(parcels.partyTo(newcomer).received)).toEqual([fresh.parcelId]);
      expect(ids(parcels.partyTo(me(p.personDid)).received)).not.toContain(fresh.parcelId);
    });
  });

  /* ------------------------------------------------------------------ the day in which it can be undone -- */

  describe('in the 24 hours a move can still be undone', () => {
    it('a parcel sent to the OLD number is the account’s: the number is held for it and nobody else can be on it', () => {
      const p = aPerson();
      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      const late = aParcel({ to: p.phone });
      expect(ids(parcels.partyTo(me(p.personDid)).received)).toEqual([late.parcelId]);

      recovery.settle(t0 + DAY_AND_A_BIT);
      expect(parcels.partyTo(aPersonAt(p.phone)).received).toEqual([]);
      expect(ids(parcels.partyTo(me(p.personDid)).received)).toEqual([late.parcelId]);
    });

    it('a parcel sent to the NEW number is shown to the account, and does not go back with it when the move is undone', () => {
      const p = aPerson();
      const before = aParcel({ to: p.phone });
      const fresh = aVerifiedNumber();
      const t0 = Date.now();
      // Whoever moved it — the owner, or somebody who talked two members of staff into it.
      recovery.moveByStaff(p.personDid, fresh, t0);
      const toTheNewNumber = aParcel({ to: fresh });
      expect(keptBy(toTheNewNumber.parcelId).receiver).toBeUndefined();
      expect(ids(parcels.partyTo(me(p.personDid)).received).sort()).toEqual([before.parcelId, toTheNewNumber.parcelId].sort());

      recovery.undoWithOldNumber(p.phone, PIN, t0 + 60_000);
      // Back on its own number with what was its own, and nothing of whoever holds the other one.
      expect(ids(parcels.partyTo(me(p.personDid)).received)).toEqual([before.parcelId]);
      expect(ids(parcels.partyTo(aPersonAt(fresh)).received)).toEqual([toTheNewNumber.parcelId]);
    });

    it('once the day has passed, a parcel sent to the new number is the account’s like any other', () => {
      const p = aPerson();
      const fresh = aVerifiedNumber();
      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, fresh, t0);
      recovery.settle(t0 + DAY_AND_A_BIT);
      const later = aParcel({ to: fresh });
      expect(keptBy(later.parcelId).receiver).toBe(p.personDid);
    });
  });

  /* ------------------------------------------------------------------ at the moment it is made -- */

  describe('when a parcel is made', () => {
    it('names the account on each number where there is one, and none where there is not', () => {
      const sender = aPerson();
      const receiver = aPerson();
      const both = aParcel({ from: sender.phone, to: receiver.phone });
      expect(keptBy(both.parcelId)).toEqual({ sender: sender.personDid, receiver: receiver.personDid });

      const neither = aParcel({ to: aNumber() });
      expect(keptBy(neither.parcelId)).toEqual({ sender: undefined, receiver: undefined });
    });

    it('says nothing of it on the parcel itself — the shop that takes a parcel in must not learn whether a number has an account', () => {
      const sender = aPerson();
      const receiver = aPerson();
      const both = aParcel({ from: sender.phone, to: receiver.phone });
      const neither = aParcel({ to: aNumber() });
      // What the counter is handed back, and what is stored: the same fields whether or not anybody has an account…
      expect(Object.keys(both.handedBack).sort()).toEqual(Object.keys(neither.handedBack).sort());
      expect(Object.keys(parcels.get(both.parcelId)).sort()).toEqual(Object.keys(parcels.get(neither.parcelId)).sort());
      // …and neither account's id anywhere in it.
      for (const record of [both.handedBack, parcels.get(both.parcelId)]) {
        expect(JSON.stringify(record)).not.toContain(sender.personDid);
        expect(JSON.stringify(record)).not.toContain(receiver.personDid);
      }
      // An account that moves on changes nothing on the parcel either.
      const before = JSON.stringify(parcels.get(neither.parcelId));
      // …one that was waiting for a number before its account existed, so the move is what names the account for it.
      const phone = aNumber();
      const waiting = aParcel({ to: phone });
      const later = aPerson(phone);
      const asStored = JSON.stringify(parcels.get(waiting.parcelId));
      recovery.changeNumber(later.personDid, PIN, aVerifiedNumber());
      expect(keptBy(waiting.parcelId).receiver).toBe(later.personDid);
      expect(JSON.stringify(parcels.get(waiting.parcelId))).toBe(asStored);
      expect(JSON.stringify(parcels.get(neither.parcelId))).toBe(before);
    });

    it('somebody known by a number alone reads only what belongs to no account', () => {
      const receiver = aPerson();
      const theirs = aParcel({ to: receiver.phone });
      const open = aNumber();
      const nobodys = aParcel({ to: open });
      const hashOf = (phone: string) => parcels.get(phone === open ? nobodys.parcelId : theirs.parcelId).receiverPhoneHash!;
      expect(parcels.partyTo(hashOf(receiver.phone)).received).toEqual([]);
      expect(ids(parcels.partyTo(hashOf(open)).received)).toEqual([nobodys.parcelId]);
    });
  });

  /* ------------------------------------------------------------------ a store's order too big for a parcel -- */

  describe('a store’s order that went as freight', () => {
    const anOrder = (buyerMobile: string, now?: number) =>
      dispatch.registerFreight({ description: 'A wardrobe', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'The store', destLabel: 'Home', destLocation: { lat: -1.15, lng: 36.8 }, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80], buyerMobile, externalOrderId: `SO-${(seq += 1)}` }, now);

    it('stays with the account when its number changes, and is not shown to whoever has the old number next', () => {
      const p = aPerson();
      const order = anOrder(p.phone);
      expect(dispatch.freightsFor(me(p.personDid)).map((f) => f.freightId)).toEqual([order.freightId]);

      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      expect(dispatch.freightsFor(me(p.personDid)).map((f) => f.freightId)).toEqual([order.freightId]);
      recovery.settle(t0 + DAY_AND_A_BIT);
      expect(dispatch.freightsFor(aPersonAt(p.phone))).toEqual([]);
      // The load goes whole to every driver who lists the board: the buyer's account is not on it.
      expect(dispatch.buyerOf(order).owner).toBe(p.personDid);
      expect(JSON.stringify(dispatch.listFreight())).not.toContain(p.personDid);
    });

    it('placed for a number nobody has an account on, it waits for whoever signs in with it — and then goes with them', () => {
      const phone = aNumber();
      const order = anOrder(phone);
      const p = aPerson(phone);
      expect(dispatch.freightsFor(me(p.personDid)).map((f) => f.freightId)).toEqual([order.freightId]);
      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      recovery.settle(t0 + DAY_AND_A_BIT);
      expect(dispatch.freightsFor(me(p.personDid)).map((f) => f.freightId)).toEqual([order.freightId]);
      expect(dispatch.freightsFor(aPersonAt(phone))).toEqual([]);
    });

    it('placed for the old number while it is held, it is the account’s — judged on the clock the order was placed at', () => {
      const p = aPerson();
      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      const held = anOrder(p.phone, t0 + 3_600_000);
      // The same number a day and an hour later, on the order's own clock: nobody's yet.
      const free = anOrder(p.phone, t0 + DAY_AND_A_BIT + 3_600_000);
      expect(dispatch.freightsFor(me(p.personDid)).map((f) => f.freightId)).toEqual([held.freightId]);
      expect(dispatch.buyerOf(free).owner).toBeUndefined();
    });
  });

  /* ------------------------------------------------------------------ an invitation into a business -- */

  describe('an invitation into a business', () => {
    function aBusiness() {
      const owner = aPerson();
      const { entity } = businesses.create(owner.personDid, { name: `Abebe Import ${(seq += 1)}`, country: 'ET', registrationNo: `REG-PF-${seq}`, activities: ['importer'], yourName: 'Abebe Kebede' });
      const { token } = businesses.session(owner.personDid, entity.entityId);
      return { entity, acting: businesses.requireMember(auth.introspect(token.access_token)) };
    }

    it('not yet answered, it goes with the account to its new number — and whoever has the old number is shown no way in', () => {
      const { acting } = aBusiness();
      const p = aPerson();
      const { memberId } = businesses.invite(acting, { phone: p.phone, name: 'Selam Tesfaye', role: 'booker' });
      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      expect(businesses.mine(p.personDid).map((m) => [m.memberId, m.state])).toEqual([[memberId, 'invited']]);

      recovery.settle(t0 + DAY_AND_A_BIT);
      const newcomer = aPersonAt(p.phone);
      expect(businesses.mine(newcomer.personDid)).toEqual([]);
      expect(() => businesses.accept(newcomer.personDid, memberId)).toThrow(/No such invitation/);
      expect(() => businesses.decline(newcomer.personDid, memberId)).toThrow(/No such invitation/);
      expect(businesses.accept(p.personDid, memberId).state).toBe('joined');
    });

    it('sent to a number nobody has an account on, it still waits for whoever signs in with it — and the owner is told nothing more', () => {
      const { acting } = aBusiness();
      const known = aPerson();
      const phone = aNumber();
      const a = businesses.invite(acting, { phone: known.phone, name: 'Known', role: 'viewer' });
      const b = businesses.invite(acting, { phone, name: 'Nobody yet', role: 'viewer' });
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      expect(JSON.stringify(a)).not.toContain(known.personDid);
      const p = aPerson(phone);
      expect(businesses.mine(p.personDid).map((m) => m.memberId)).toEqual([b.memberId]);

      // They found it by the number; when the account moves on, it goes with the account.
      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      expect(businesses.mine(p.personDid).map((m) => m.memberId)).toEqual([b.memberId]);
      recovery.settle(t0 + DAY_AND_A_BIT);
      const newcomer = aPersonAt(phone);
      expect(businesses.mine(newcomer.personDid)).toEqual([]);
      expect(() => businesses.accept(newcomer.personDid, b.memberId)).toThrow(/No such invitation/);
    });

    it('sent to the old number in the day it is still held, it is for the account that had it', () => {
      const { acting } = aBusiness();
      const p = aPerson();
      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      const { memberId } = businesses.invite(acting, { phone: p.phone, name: 'Selam Tesfaye', role: 'booker' });
      expect(businesses.mine(p.personDid).map((m) => m.memberId)).toEqual([memberId]);
      recovery.settle(t0 + DAY_AND_A_BIT);
      expect(businesses.mine(aPersonAt(p.phone).personDid)).toEqual([]);
    });

    it('an invitation already declined or withdrawn is not picked up by a move', () => {
      const { acting } = aBusiness();
      // Sent before the account existed, so it is still for the number alone when they say no to it.
      const phone = aNumber();
      const declined = businesses.invite(acting, { phone, name: 'Selam', role: 'booker' });
      const open = businesses.invite(aBusiness().acting, { phone, name: 'Selam', role: 'booker' });
      const p = aPerson(phone);
      businesses.decline(p.personDid, declined.memberId);
      // The one still open is kept; the one they declined is not touched.
      expect(businesses.keepWith(p.personDid, me(p.personDid).phoneHash)).toBe(1);
      expect(businesses.mine(p.personDid).map((m) => m.memberId)).toEqual([open.memberId]);
    });
  });

  /* ------------------------------------------------------------------ the guard itself -- */

  describe('a number leaving an account', () => {
    it('is asked of every keeper BEFORE the account moves — a keeper that fails has stopped a move that had not begun', () => {
      const p = aPerson();
      const fresh = aVerifiedNumber();
      const heard: string[] = [];
      persons.onNumberLeft((personDid, fromHash) => {
        heard.push(`${personDid}:${fromHash === me(personDid).phoneHash}`);
        throw new Error('the keeper could not keep');
      });
      expect(() => recovery.changeNumber(p.personDid, PIN, fresh)).toThrow(/the keeper could not keep/);
      // Asked while the account was still on the number it is leaving, and nothing moved.
      expect(heard).toEqual([`${p.personDid}:true`]);
      expect(persons.loginWithPin(p.phone, PIN).person.personDid).toBe(p.personDid);
      expect(me(p.personDid).phoneChange).toBeUndefined();
    });

    it('takes only what no account has: the next account on the number, moving on in its turn, takes nothing of the first one’s — parcel, order or invitation', () => {
      const first = aPerson();
      const parcel = aParcel({ to: first.phone });
      const order = dispatch.registerFreight({ description: 'A wardrobe', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'The store', destLabel: 'Home', destLocation: { lat: -1.15, lng: 36.8 }, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80], buyerMobile: first.phone, externalOrderId: `SO-${(seq += 1)}` });
      const owner = aPerson();
      const { entity } = businesses.create(owner.personDid, { name: `Abebe Import ${(seq += 1)}`, country: 'ET', registrationNo: `REG-PF-${seq}`, activities: ['importer'], yourName: 'Abebe Kebede' });
      const acting = businesses.requireMember(auth.introspect(businesses.session(owner.personDid, entity.entityId).token.access_token));
      const { memberId } = businesses.invite(acting, { phone: first.phone, name: 'Selam Tesfaye', role: 'booker' });

      const t0 = Date.now();
      recovery.changeNumber(first.personDid, PIN, aVerifiedNumber(), t0);
      recovery.settle(t0 + DAY_AND_A_BIT);
      // Somebody else has the number now, and moves on from it too.
      const second = aPersonAt(first.phone);
      persons.setPin(second.personDid, PIN);
      persons.setEmail(second.personDid, `second${(seq += 1)}@example.com`);
      recovery.changeNumber(second.personDid, PIN, aVerifiedNumber());

      expect(ids(parcels.partyTo(me(first.personDid)).received)).toEqual([parcel.parcelId]);
      expect(dispatch.freightsFor(me(first.personDid)).map((x) => x.freightId)).toEqual([order.freightId]);
      expect(businesses.mine(first.personDid).map((m) => m.memberId)).toEqual([memberId]);
      expect(parcels.partyTo(me(second.personDid))).toEqual({ sent: [], received: [] });
      expect(dispatch.freightsFor(me(second.personDid))).toEqual([]);
      expect(businesses.mine(second.personDid)).toEqual([]);
    });

    it('is not asked when a move is undone: the account takes nothing from the number it gives back', () => {
      const p = aPerson();
      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      let asked = 0;
      persons.onNumberLeft(() => (asked += 1));
      recovery.undoWithOldNumber(p.phone, PIN, t0 + 60_000);
      expect(asked).toBe(0);
    });

    it('says whose a number certainly is: held for a day for the account that left it, and not yet the account’s that arrived', () => {
      const p = aPerson();
      const from = me(p.personDid).phoneHash;
      expect(persons.settledAt(from)!.personDid).toBe(p.personDid);
      const t0 = Date.now();
      recovery.changeNumber(p.personDid, PIN, aVerifiedNumber(), t0);
      const to = me(p.personDid).phoneHash;

      expect(persons.settledAt(from, t0 + 1000)!.personDid).toBe(p.personDid);
      expect(persons.settledAt(to, t0 + 1000)).toBeUndefined();
      // The day has passed: the new number is theirs, the old one is nobody's.
      expect(persons.settledAt(from, t0 + DAY_AND_A_BIT)).toBeUndefined();
      expect(persons.settledAt(to, t0 + DAY_AND_A_BIT)!.personDid).toBe(p.personDid);
      expect(persons.settledAt('')).toBeUndefined();
    });
  });
});
