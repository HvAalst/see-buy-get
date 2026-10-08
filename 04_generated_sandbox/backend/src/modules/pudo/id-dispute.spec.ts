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
import { PersonService } from './person.service';
import { AccountService } from './account.service';
import { OtpService } from './otp.service';
import { EmailCodeService } from './email-code.service';
import { AccountRecoveryService } from './account-recovery.service';
import { NotificationService } from './notification.service';
import { OutboxPushSender } from './push-sender';
import { PUSH_SENDER } from './notification.types';
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
import { PayoutService } from '../../foundation/payouts/payout.service';
import { SandboxPayoutRail } from '../../foundation/payouts/sandbox-rail.adapter';
import { PAYOUT_RAIL } from '../../foundation/payouts/payout.types';
import { MailService } from '../../foundation/mail/mail.service';
import { OutboxMailSender } from '../../foundation/mail/outbox-mail.sender';
import { MAIL_SENDER } from '../../foundation/mail/mail.types';

import { ContactCardService, hourAfter, visitingHours, weekdayOf } from './contact-card.service';
import { CompanyReadinessService } from '../../foundation/entity/company-readiness.service';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { IdDisputeService, normalizeIdReference } from './id-dispute.service';
import { APPOINTMENT_CHANGES, APPOINTMENT_REMINDER_HOURS, APPOINTMENT_WITHIN_DAYS, DISPUTE_ANSWER_DAYS, DISPUTE_CONTEST_DAYS, DISPUTE_OPENS_PER_DAY, type DisputePhoto, type IdRegister } from './id-dispute.types';
import { IDENTITY_CHECK_DAYS } from './media.types';

/**
 * TWO PEOPLE SAY ONE NATIONAL ID IS THEIRS — on the real driver, shop, person, code, photograph, notification and
 * mail services.
 *
 * The user, 2026-10-08: staff see "a selfie with the holder showing it's ID back and front"; "staff decide from the
 * photos, if that is still disputed they can make an appointment in person", with a ticket saying what to bring.
 * What is proved here is mostly what keeps it fair and what keeps it private: that nothing moves an ID but two
 * different members of staff (or its holder saying it was never theirs), that a registration which loses its ID is
 * held and not removed, and that no number and no photograph outlives the decision.
 */
describe('two people say one national ID is theirs', () => {
  let persons: PersonService;
  let drivers: DriverService;
  let agents: AgentService;
  let managers: FleetManagerService;
  let otp: OtpService;
  let recovery: AccountRecoveryService;
  let disputes: IdDisputeService;
  let notifications: NotificationService;
  let outbox: OutboxMailSender;
  let media: MediaService;
  let gate: WalletGateService;
  let parcels: ParcelService;
  let routing: RoutingService;
  let readiness: CompanyReadinessService;
  let entities: EntityService;
  let contacts: ContactCardService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        PersonService, AccountService, OtpService, AuthService, EmailCodeService, AccountRecoveryService, IdDisputeService, ContactCardService, CompanyReadinessService, CompanyDocumentService,
        NotificationService, OutboxPushSender, { provide: PUSH_SENDER, useExisting: OutboxPushSender },
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
    drivers = moduleRef.get(DriverService);
    agents = moduleRef.get(AgentService);
    managers = moduleRef.get(FleetManagerService);
    otp = moduleRef.get(OtpService);
    recovery = moduleRef.get(AccountRecoveryService);
    disputes = moduleRef.get(IdDisputeService);
    notifications = moduleRef.get(NotificationService);
    outbox = moduleRef.get(OutboxMailSender);
    media = moduleRef.get(MediaService);
    gate = moduleRef.get(WalletGateService);
    parcels = moduleRef.get(ParcelService);
    routing = moduleRef.get(RoutingService);
    readiness = moduleRef.get(CompanyReadinessService);
    entities = moduleRef.get(EntityService);
    contacts = moduleRef.get(ContactCardService);
    recovery.onModuleInit();
  });
  afterEach(() => recovery.onModuleDestroy());

  let seq = 0;
  const DAY = 86_400_000;
  const AMINA = { name: 'Amina Otieno', key: 'staff:amina' };
  const BRIAN = { name: 'Brian Kamau', key: 'staff:brian' };
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const T0 = Date.now();
  const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  /** Make, or move, an appointment at a moment — for an hour, where the country counts its visitors by the hour. */
  const appoint = (reference: string, date: string, now: number, at?: string) => disputes.appoint(reference, date, at, now);

  function aFleet() {
    seq += 1;
    const m = managers.register({ companyName: 'Kilima Haulage ' + seq, contactPhone: '+25480077' + seq + '0', ownerFullName: 'O O', ownerNationalId: 'MGR-ID-' + seq, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: 'BRN-ID-' + seq, transportOperatorLicence: 'TOL-ID-' + seq, taxId: 'TAX-ID-' + seq } });
    managers.submitKyc(m.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'a' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    return m.did;
  }
  /** A driver registered with this national ID, with a person behind it and a confirmed email. */
  function aDriver(over: { nationalId?: string; managerDid?: string; phone?: string } = {}) {
    seq += 1;
    const phone = over.phone ?? '+2547441' + String(seq).padStart(5, '0');
    const nationalId = over.nationalId ?? '3300' + String(seq).padStart(4, '0');
    const email = 'holder' + seq + '@example.com';
    const d = drivers.register({ displayName: 'Rider ' + seq, fullName: 'R ' + seq, nationalId, mobile: phone, licenceClasses: ['bike'], ...(over.managerDid ? { managerDid: over.managerDid } : {}) });
    const person = persons.attachRole(phone, 'driver', d.did, over.managerDid);
    persons.setEmail(person.personDid, email);
    return { did: d.did, personDid: person.personDid, phone, nationalId, email };
  }
  function aShop(nationalId?: string) {
    seq += 1;
    const phone = '+2547442' + String(seq).padStart(5, '0');
    const id = nationalId ?? '4400' + String(seq).padStart(4, '0');
    const a = agents.register({
      shopName: 'Duka ' + seq, zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'blue gate',
      openingHours: { mon: { open: '08:00', close: '18:00' } }, shelf: { rows: 3, cols: 3 }, fullName: 'S ' + seq, nationalId: id, mobile: phone, deviceImei: 'IMEI-ID-' + seq,
      requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    } as never);
    const person = persons.attachRole(phone, 'agent', a.did);
    return { did: a.did, personDid: person.personDid, phone, nationalId: id };
  }
  const aNumber = () => '+2547663' + String((seq += 1)).padStart(5, '0');
  function aVerifiedNumber() {
    const phone = aNumber();
    otp.verify(phone, otp.request(phone).code);
    return phone;
  }
  const again = (phone: string) => {
    (otp as unknown as { rates: Map<string, unknown> }).rates.clear();
    return otp.verify(phone, otp.request(phone).code);
  };
  const failure = (fn: () => unknown) => {
    try {
      fn();
      return 'DID NOT REFUSE';
    } catch (e) {
      return (e as { code?: string }).code + ': ' + (e as Error).message;
    }
  };
  const stored = () => [...(disputes as unknown as { disputes: Map<string, Record<string, any>> }).disputes.values()];
  const idOf = (reference: string) => stored().find((d) => d.claimant.reference === reference)!.disputeId as string;
  const holderRef = (reference: string) => stored().find((d) => d.claimant.reference === reference)!.holder.reference as string;
  const mailTo = (address: string) => outbox.recent(address).filter((m) => m.template === 'account-safety');
  const about = (m: { subject: string }, words: string) => m.subject.toLowerCase().includes(words.toLowerCase());

  /** Somebody refused at registration opens a dispute over the number a registration already holds. */
  function open(nationalId: string, register: IdRegister = 'driver', at = T0) {
    const phone = aVerifiedNumber();
    const opened = disputes.open({ register, nationalId, phone }, at);
    return { ...opened, phone, disputeId: idOf(opened.reference), holderReference: holderRef(opened.reference) };
  }
  /** All three photographs, then sent. */
  function sendAll(reference: string, at = T0) {
    for (const which of ['face', 'front', 'back'] as DisputePhoto[]) disputes.photo({ reference, which, dataUrl: PNG }, at);
    return disputes.send(reference, at);
  }
  /** Both have sent; staff have read both cards as given. */
  function bothSent(nationalId: string, cards: { claimant?: string; holder?: string }, register: IdRegister = 'driver') {
    const o = open(nationalId, register);
    sendAll(o.reference);
    sendAll(o.holderReference);
    if (cards.claimant) disputes.readCard(o.disputeId, AMINA, 'claimant', cards.claimant, T0);
    if (cards.holder) disputes.readCard(o.disputeId, AMINA, 'holder', cards.holder, T0);
    return o;
  }
  /** Decided for the claimant, the holder having shown nothing. */
  function wonByClaimant(holder: { nationalId: string }) {
    const o = open(holder.nationalId);
    sendAll(o.reference);
    const late = T0 + DISPUTE_ANSWER_DAYS * DAY + 1000;
    disputes.readCard(o.disputeId, AMINA, 'claimant', holder.nationalId, late);
    disputes.check(o.disputeId, AMINA, { to: 'claimant', what: 'Card read; face matches; reference in the picture.', reason: 'You showed no card.' }, late);
    disputes.approve(o.disputeId, BRIAN, late);
    return { ...o, at: late };
  }

  /* ------------------------------------------------------------------------ opening -- */

  describe('opening a dispute', () => {
    it('needs the phone confirmed by a code, hands back a reference to write on paper — and does not tell the holder yet', () => {
      const d = aDriver();
      const before = outbox.recent().length;
      expect(failure(() => disputes.open({ register: 'driver', nationalId: d.nationalId, phone: aNumber() }))).toMatch(/^PHONE_NOT_VERIFIED/);
      const phone = aVerifiedNumber();
      const opened = disputes.open({ register: 'driver', nationalId: d.nationalId, phone }, T0);
      expect(opened.reference).toMatch(/^ID-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(Date.parse(opened.photosBy)).toBe(T0 + DISPUTE_ANSWER_DAYS * DAY);
      // The code was for this one opening.
      expect(otp.isVerified(phone)).toBe(false);
      // A reference with no photographs behind it is nothing: nobody has been told anything.
      expect(outbox.recent()).toHaveLength(before);
      expect(notifications.inboxFor(d.personDid)).toHaveLength(0);
      expect(disputes.against(d.personDid, T0)).toBeUndefined();
      expect(disputes.status(opened.reference, T0)).toMatchObject({ side: 'claimant', state: 'opened', photos: [], sent: false, photosDueBy: opened.photosBy });
    });

    it('finds the holder however the number is typed, and each of the two has a reference of their own', () => {
      const d = aDriver({ nationalId: 'AB-12.345/6' });
      const o = open(' ab 123456 ');
      expect(o.holderReference).toMatch(/^ID-/);
      expect(o.holderReference).not.toBe(o.reference);
      expect(stored()[0].holder.did).toBe(d.did);
      // As somebody types what they wrote down.
      expect(disputes.status(o.reference.toLowerCase().replace(/-/g, ' '), T0).side).toBe('claimant');
      expect(disputes.status(normalizeIdReference(o.holderReference), T0).side).toBe('holder');
      expect(failure(() => disputes.status('ID-AAAA-AAAA', T0))).toMatch(/^NOT_FOUND/);
    });

    it('refuses what is not a dispute: a number nobody holds, the asker’s own registration, an ID already being looked at', () => {
      const d = aDriver();
      const free = aVerifiedNumber();
      const nobody = failure(() => disputes.open({ register: 'driver', nationalId: '99990000', phone: free }, T0));
      expect(nobody).toMatch(/^NOT_FOUND/);
      expect(nobody).toContain('you can register with it');
      // A driver's ID does not stop the same person opening a shop: the shop register holds nothing under it.
      expect(failure(() => disputes.open({ register: 'shop', nationalId: d.nationalId, phone: free }, T0))).toMatch(/^NOT_FOUND/);
      again(d.phone);
      expect(failure(() => disputes.open({ register: 'driver', nationalId: d.nationalId, phone: d.phone }, T0))).toMatch(/^INVALID_STATE: That ID is on your own registration/);

      const first = disputes.open({ register: 'driver', nationalId: d.nationalId, phone: free }, T0);
      // A lost reference: the same person asking again is handed the same one.
      again(free);
      expect(disputes.open({ register: 'driver', nationalId: d.nationalId, phone: free }, T0).reference).toBe(first.reference);
      expect(stored()).toHaveLength(1);
      expect(failure(() => disputes.open({ register: 'driver', nationalId: d.nationalId, phone: aVerifiedNumber() }, T0))).toMatch(/^CONFLICT/);
    });

    it('is limited: a few a day from one number', () => {
      const phone = aVerifiedNumber();
      for (let i = 0; i < DISPUTE_OPENS_PER_DAY; i++) {
        if (i) again(phone);
        disputes.open({ register: 'driver', nationalId: aDriver().nationalId, phone }, T0);
      }
      again(phone);
      expect(failure(() => disputes.open({ register: 'driver', nationalId: aDriver().nationalId, phone }, T0))).toMatch(/^RATE_LIMITED/);
      again(phone);
      expect(disputes.open({ register: 'driver', nationalId: aDriver().nationalId, phone }, T0 + DAY + 1000).reference).toMatch(/^ID-/);
    });
  });

  /* -------------------------------------------------------------------- photographs -- */

  describe('the photographs', () => {
    it('are three, kept as an identity check, and one taken again replaces — and deletes — the one before', () => {
      const d = aDriver();
      const o = open(d.nationalId);
      expect(failure(() => disputes.send(o.reference, T0))).toMatch(/^FIELD_REQUIRED: All three photographs are needed\. Still missing: you holding the card, the front of the card, the back of the card/);
      disputes.photo({ reference: o.reference, which: 'face', dataUrl: PNG }, T0);
      const first = stored()[0].claimant.photos.face as string;
      expect(media.get(first)).toMatchObject({ kind: 'id_check', retentionClass: 'identity-check', link: { type: 'id-dispute', id: o.disputeId }, status: 'active' });
      // Nobody's but staff's: the owner is the dispute, which no token can sign in as.
      expect(media.viewableBy(media.get(first)!, d.did, false)).toBe(false);
      expect(media.viewableBy(media.get(first)!, 'anyone', true)).toBe(true);

      const status = disputes.photo({ reference: o.reference, which: 'face', dataUrl: PNG }, T0);
      expect(status.photos).toEqual(['face']);
      expect(media.get(first)).toBeUndefined();
      expect(failure(() => disputes.send(o.reference, T0))).toMatch(/Still missing: the front of the card, the back of the card/);
    });

    it('tell the holder when they are sent — with a week to answer, and THEIR reference in Settings', async () => {
      const d = aDriver();
      const o = open(d.nationalId);
      const sent = sendAll(o.reference);
      expect(sent).toMatchObject({ state: 'answering', sent: true, photos: ['face', 'front', 'back'] });
      expect(sent.photosDueBy).toBeUndefined();
      expect(failure(() => disputes.photo({ reference: o.reference, which: 'face', dataUrl: PNG }, T0))).toMatch(/^INVALID_STATE: Your photographs have been sent already/);

      const answerBy = new Date(T0 + DISPUTE_ANSWER_DAYS * DAY).toISOString();
      expect(disputes.against(d.personDid, T0)).toEqual({ reference: o.holderReference, register: 'driver', state: 'answering', answerBy });
      expect(notifications.inboxFor(d.personDid)[0]).toMatchObject({ kind: 'security', title: 'Somebody says the national ID on your registration is theirs' });
      const [mail] = mailTo(d.email);
      expect(about(mail, 'somebody says the national ID on your registration is theirs')).toBe(true);
      expect(mail.text).toContain('put the right one there');
      // Nothing the holder is sent names the other person, their phone or their reference.
      expect(mail.text).not.toContain(o.reference);
      expect(mail.text).not.toContain(o.phone.slice(-6));
      expect(JSON.stringify(disputes.status(o.holderReference, T0))).not.toContain(o.reference);
    });

    it('come from the holder by their own reference — or not at all: after a week staff decide without them', () => {
      const d = aDriver();
      const o = open(d.nationalId);
      // Before the claimant has sent anything, the holder has been told nothing and there is nothing to answer.
      expect(failure(() => disputes.photo({ reference: o.holderReference, which: 'face', dataUrl: PNG }, T0))).toMatch(/^INVALID_STATE/);
      sendAll(o.reference);
      expect(disputes.list(undefined, T0).waiting).toBe(0);
      expect(sendAll(o.holderReference, T0 + DAY)).toMatchObject({ side: 'holder', state: 'ready', sent: true });
      expect(disputes.list(undefined, T0 + DAY).waiting).toBe(1);

      const silent = aDriver();
      const o2 = open(silent.nationalId);
      sendAll(o2.reference);
      const justBefore = T0 + DISPUTE_ANSWER_DAYS * DAY - 1000;
      expect(disputes.status(o2.reference, justBefore).state).toBe('answering');
      expect(disputes.status(o2.reference, justBefore + 2000).state).toBe('ready');
      // Late, but before anybody decided: still taken.
      expect(disputes.status(o2.holderReference, justBefore + 2000).photosDueBy).toBeTruthy();
      expect(sendAll(o2.holderReference, justBefore + 3000).sent).toBe(true);
    });

    it('never sent: the dispute lapses after a week, and the holder never hears of it', () => {
      const d = aDriver();
      const o = open(d.nationalId);
      disputes.photo({ reference: o.reference, which: 'face', dataUrl: PNG }, T0);
      const photo = stored()[0].claimant.photos.face as string;
      const after = T0 + DISPUTE_ANSWER_DAYS * DAY + 1000;
      expect(disputes.status(o.reference, after)).toMatchObject({ state: 'lapsed', sent: false });
      expect(failure(() => disputes.send(o.reference, after))).toMatch(/^INVALID_STATE/);
      expect(notifications.inboxFor(d.personDid)).toHaveLength(0);
      // The one photograph that was taken starts its thirty days.
      expect(Date.parse(media.get(photo)!.expiresAt!)).toBe(after + IDENTITY_CHECK_DAYS * DAY);
      // And the same person may open it again.
      again(o.phone);
      expect(disputes.open({ register: 'driver', nationalId: d.nationalId, phone: o.phone }, after).reference).not.toBe(o.reference);
    });

    it('can be taken back by the claimant while nothing is decided — and the holder is told it is over', () => {
      const d = aDriver();
      const o = open(d.nationalId);
      sendAll(o.reference);
      expect(failure(() => disputes.withdraw(o.holderReference, T0))).toMatch(/^FORBIDDEN/);
      expect(disputes.withdraw(o.reference, T0).state).toBe('withdrawn');
      expect(mailTo(d.email).some((m) => about(m, 'was withdrawn'))).toBe(true);
      expect(disputes.against(d.personDid, T0)).toBeUndefined();
      expect(drivers.holdsNationalId(d.did, d.nationalId)).toBe(true);
      expect(failure(() => disputes.withdraw(o.reference, T0))).toMatch(/^INVALID_STATE/);
    });
  });

  /* ---------------------------------------------------- "the number was never mine" -- */

  describe('the holder says the number on their record was mistyped', () => {
    it('ends it at once: their record takes their own number, and the disputed one waits for the claimant alone', () => {
      const d = aDriver();
      const o = open(d.nationalId);
      sendAll(o.reference);
      // The disputed number itself is not a correction; nor is somebody else's.
      expect(failure(() => disputes.ownId(d.personDid, d.nationalId, T0))).toMatch(/^INVALID_STATE: That is the number being disputed/);
      const other = aDriver();
      expect(failure(() => disputes.ownId(d.personDid, other.nationalId, T0))).toMatch(/^DUPLICATE/);
      expect(drivers.holdsNationalId(d.did, d.nationalId)).toBe(true);

      expect(disputes.ownId(d.personDid, '77001234', T0)).toEqual({ saved: true });
      expect(drivers.holdsNationalId(d.did, '77001234')).toBe(true);
      expect(drivers.holdsNationalId(d.did, d.nationalId)).toBe(false);
      expect(drivers.canOperate(d.did)).toBe(true);
      expect(disputes.status(o.reference, T0)).toMatchObject({ state: 'conceded', yours: true });
      expect(disputes.against(d.personDid, T0)).toBeUndefined();

      // Kept for the claimant: a stranger typing it is still refused, the claimant's own phone gets through.
      expect(failure(() => drivers.register({ displayName: 'X', fullName: 'X', nationalId: d.nationalId, mobile: aNumber(), licenceClasses: ['bike'] }))).toMatch(/^DUPLICATE/);
      const mine = drivers.register({ displayName: 'Claimant', fullName: 'C', nationalId: d.nationalId, mobile: o.phone, licenceClasses: ['bike'] });
      expect(drivers.holdsNationalId(mine.did, d.nationalId)).toBe(true);
    });

    it('is theirs to say only once they have been told — and only about a registration of their own', () => {
      const d = aDriver();
      open(d.nationalId);
      // Opened, no photographs: the holder has been told nothing, and nothing of theirs is waiting.
      expect(failure(() => disputes.ownId(d.personDid, '77005678', T0))).toMatch(/^INVALID_STATE: Nothing on your account is waiting/);
      expect(drivers.holdsNationalId(d.did, d.nationalId)).toBe(true);
      const bystander = aDriver();
      expect(failure(() => disputes.ownId(bystander.personDid, '77009999', T0))).toMatch(/^INVALID_STATE: Nothing on your account/);
    });
  });

  /* -------------------------------------------------------------------------- staff -- */

  describe('staff read the cards', () => {
    it('by typing the number — and only whether it is the disputed one is kept', () => {
      const d = aDriver();
      const o = open(d.nationalId);
      sendAll(o.reference);
      expect(failure(() => disputes.readCard(o.disputeId, AMINA, 'claimant', d.nationalId, T0))).toMatch(/^INVALID_STATE/);
      sendAll(o.holderReference);
      expect(disputes.readCard(o.disputeId, AMINA, 'claimant', ' ' + d.nationalId + ' ', T0).claimant.card).toBe('matches');
      expect(disputes.readCard(o.disputeId, AMINA, 'holder', '55667788', T0).holder.card).toBe('differs');
      const kept = JSON.stringify(stored()[0]);
      expect(kept).not.toContain(d.nationalId);
      expect(kept).not.toContain('55667788');
      expect(kept).not.toContain(o.phone.replace('+', ''));
      // Read again, it is the latest reading that stands.
      expect(disputes.readCard(o.disputeId, AMINA, 'holder', d.nationalId, T0).holder.card).toBe('matches');
      expect(stored()[0].holder.ownVaultRef).toBeUndefined();
    });

    it('cannot read a card nobody sent', () => {
      const d = aDriver();
      const o = open(d.nationalId);
      sendAll(o.reference);
      const late = T0 + DISPUTE_ANSWER_DAYS * DAY + 1000;
      expect(failure(() => disputes.readCard(o.disputeId, AMINA, 'holder', d.nationalId, late))).toMatch(/^INVALID_STATE: They have sent no photographs/);
    });

    it('are shown the photographs one dispute at a time, with who the holder is — never a number or a phone', () => {
      const fleet = aFleet();
      const d = aDriver({ managerDid: fleet });
      const o = bothSent(d.nationalId, { claimant: d.nationalId });
      const listed = disputes.list(AMINA, T0).items[0];
      expect(listed.claimant.face).toBeUndefined();
      const one = disputes.one(o.disputeId, AMINA, T0);
      expect(one.claimant.face).toMatch(/^med_/);
      expect(one.holder.back).toMatch(/^med_/);
      expect(one.holder.who).toMatch(/^Driver: Rider \d+, with Kilima Haulage \d+$/);
      expect(one.claimant.phoneEnds).toBe(o.phone.slice(-3));
      expect(one).toMatchObject({ reference: o.reference, holderReference: o.holderReference, state: 'ready' });
      const said = JSON.stringify(one);
      expect(said).not.toContain(d.nationalId);
      expect(said).not.toContain(o.phone);
      expect(said).not.toContain(d.phone);
    });

    it('can ask for them again, saying why — the old ones are deleted and the person has another week', () => {
      const d = aDriver();
      const o = bothSent(d.nationalId, { claimant: d.nationalId });
      const old = stored()[0].claimant.photos.front as string;
      expect(failure(() => disputes.retake(o.disputeId, AMINA, 'claimant', ' ', T0))).toMatch(/^FIELD_REQUIRED/);
      const row = disputes.retake(o.disputeId, AMINA, 'claimant', 'The reference is not in the picture.', T0 + DAY);
      expect(row).toMatchObject({ state: 'opened' });
      expect(row.claimant).toMatchObject({ retakeWhy: 'The reference is not in the picture.' });
      expect(row.claimant.card).toBeUndefined();
      expect(media.get(old)).toBeUndefined();
      // The holder was told days ago and is still shown it while the other person takes theirs again.
      expect(disputes.against(d.personDid, T0 + DAY)).toMatchObject({ reference: o.holderReference, state: 'opened' });
      const status = disputes.status(o.reference, T0 + DAY);
      expect(status).toMatchObject({ sent: false, photos: [], retakeWhy: 'The reference is not in the picture.' });
      expect(Date.parse(status.photosDueBy!)).toBe(T0 + DAY + DISPUTE_ANSWER_DAYS * DAY);
      // Sent again, it waits on staff again — the holder is not told a second time.
      const mails = mailTo(d.email).length;
      expect(sendAll(o.reference, T0 + 2 * DAY)).toMatchObject({ state: 'ready', sent: true });
      expect(disputes.status(o.reference, T0 + 2 * DAY).retakeWhy).toBeUndefined();
      expect(mailTo(d.email)).toHaveLength(mails);
    });
  });

  describe('two members of staff decide', () => {
    it('only for somebody whose card has been read as carrying the number — and say what they checked and why', () => {
      const d = aDriver();
      const o = bothSent(d.nationalId, {});
      const say = { what: 'Looked at both.', reason: 'Because.' };
      expect(failure(() => disputes.check(o.disputeId, AMINA, { to: 'claimant', ...say }, T0))).toMatch(/^INVALID_STATE: Read the number on the claimant/);
      expect(failure(() => disputes.check(o.disputeId, AMINA, { to: 'holder', ...say }, T0))).toMatch(/^INVALID_STATE: The holder has shown no card/);
      disputes.readCard(o.disputeId, AMINA, 'claimant', '11112222', T0);
      // The claimant's own card carries a different number: it stays where it is, whatever the holder showed.
      expect(failure(() => disputes.check(o.disputeId, AMINA, { to: 'claimant', ...say }, T0))).toMatch(/^INVALID_STATE/);
      expect(failure(() => disputes.check(o.disputeId, AMINA, { to: 'holder', what: ' ', reason: 'x' }, T0))).toMatch(/^FIELD_REQUIRED/);
      expect(failure(() => disputes.check(o.disputeId, AMINA, { to: 'holder', what: 'x', reason: ' ' }, T0))).toMatch(/^FIELD_REQUIRED/);
      const row = disputes.check(o.disputeId, AMINA, { to: 'holder', ...say }, T0);
      expect(row).toMatchObject({ state: 'checked', proposedTo: 'holder', proposedBy: 'Amina Otieno', proposedWhat: 'Looked at both.', proposedByYou: true });
      expect(disputes.one(o.disputeId, BRIAN, T0).proposedByYou).toBeUndefined();
      // A proposal changes nothing.
      expect(drivers.holdsNationalId(d.did, d.nationalId)).toBe(true);
      expect(disputes.status(o.reference, T0).yours).toBeUndefined();
    });

    it('and they are two: the one who proposed it cannot approve it, and a second may send it back', () => {
      const d = aDriver();
      const o = bothSent(d.nationalId, { claimant: d.nationalId, holder: d.nationalId });
      expect(failure(() => disputes.approve(o.disputeId, BRIAN, T0))).toMatch(/^INVALID_STATE: Nobody has said whose it is yet/);
      disputes.check(o.disputeId, AMINA, { to: 'claimant', what: 'w', reason: 'r' }, T0);
      expect(failure(() => disputes.approve(o.disputeId, { name: 'Amina Otieno', key: AMINA.key }, T0))).toMatch(/^CONFLICT: A second member of staff has to approve/);
      expect(failure(() => disputes.readCard(o.disputeId, BRIAN, 'holder', d.nationalId, T0))).toMatch(/Send it back first/);
      expect(failure(() => disputes.sendBack(o.disputeId, BRIAN, ' ', T0))).toMatch(/^FIELD_REQUIRED/);
      const back = disputes.sendBack(o.disputeId, BRIAN, 'The face is not the one on the card.', T0);
      expect(back).toMatchObject({ state: 'ready', sentBackWhy: 'Brian Kamau: The face is not the one on the card.' });
      expect(back.proposedTo).toBeUndefined();
      expect(drivers.holdsNationalId(d.did, d.nationalId)).toBe(true);
      // Proposed again — by anybody — and approved by somebody else.
      disputes.check(o.disputeId, BRIAN, { to: 'holder', what: 'w', reason: 'The card you showed is not yours.' }, T0);
      expect(disputes.approve(o.disputeId, AMINA, T0)).toMatchObject({ state: 'decided', decidedTo: 'holder', decidedBy: 'Amina Otieno', holderEffect: 'none' });
    });

    it('for the claimant, the holder having shown nothing: the holder is HELD, not removed, and their fleet is told', async () => {
      const fleet = aFleet();
      const d = aDriver({ managerDid: fleet });
      expect(drivers.canOperate(d.did)).toBe(true);
      const o = wonByClaimant(d);
      const row = disputes.one(o.disputeId, AMINA, o.at);
      expect(row).toMatchObject({ state: 'decided', decidedTo: 'claimant', holderEffect: 'held', decidedBy: 'Brian Kamau' });
      expect(Date.parse(row.contestBy!)).toBe(o.at + DISPUTE_CONTEST_DAYS * DAY);

      // Held: still a driver, with everything that is theirs — but nothing new.
      expect(drivers.get(d.did).status).toBe('ACTIVE');
      expect(drivers.canOperate(d.did)).toBe(false);
      expect(drivers.offRoadReasons(d.did).join(' ')).toContain('reference ' + o.holderReference);
      expect(drivers.holdsNationalId(d.did, d.nationalId)).toBe(false);
      expect(notifications.inboxFor(fleet).some((n) => /cannot start a shift for now/.test(n.title))).toBe(true);
      expect(disputes.against(d.personDid, o.at)).toMatchObject({ reference: o.holderReference, state: 'decided', held: true });
      const told = mailTo(d.email).find((m) => about(m, 'went to somebody else'))!;
      expect(told.text).toContain('You showed no card.');
      expect(told.text).toContain('is held');
      expect(disputes.status(o.holderReference, o.at)).toMatchObject({ yours: false, held: true, reason: 'You showed no card.', contestBy: row.contestBy });
      // The one who got it is not told the other's reason.
      expect(disputes.status(o.reference, o.at)).toMatchObject({ yours: true });
      expect(disputes.status(o.reference, o.at).reason).toBeUndefined();

      // Kept for the claimant alone.
      expect(failure(() => drivers.register({ displayName: 'X', fullName: 'X', nationalId: d.nationalId, mobile: aNumber(), licenceClasses: ['bike'] }))).toMatch(/^DUPLICATE/);
      const mine = drivers.register({ displayName: 'Claimant', fullName: 'C', nationalId: d.nationalId, mobile: o.phone, licenceClasses: ['bike'] });
      expect(drivers.holdsNationalId(mine.did, d.nationalId)).toBe(true);
      expect(drivers.canOperate(mine.did)).toBe(true);
    });

    it('for the claimant, the holder’s own card carrying another number: their record takes that, and nothing else changes for them', () => {
      const d = aDriver();
      const o = bothSent(d.nationalId, { claimant: d.nationalId, holder: '55001122' });
      disputes.check(o.disputeId, AMINA, { to: 'claimant', what: 'w', reason: 'Your card carries a different number.' }, T0);
      expect(disputes.approve(o.disputeId, BRIAN, T0)).toMatchObject({ decidedTo: 'claimant', holderEffect: 'corrected' });
      expect(drivers.holdsNationalId(d.did, '55001122')).toBe(true);
      expect(drivers.canOperate(d.did)).toBe(true);
      expect(drivers.offRoadReasons(d.did)).toEqual([]);
      expect(disputes.status(o.holderReference, T0).held).toBeUndefined();
      expect(mailTo(d.email).find((m) => about(m, 'went to somebody else'))!.text).toContain('is on your registration now');
    });

    it('for the holder: nothing changes for them, and the claimant reads why', () => {
      const d = aDriver();
      const o = bothSent(d.nationalId, { claimant: '90909090', holder: d.nationalId });
      disputes.check(o.disputeId, AMINA, { to: 'holder', what: 'w', reason: 'Your card carries a different number: register with that one.' }, T0);
      disputes.approve(o.disputeId, BRIAN, T0);
      expect(drivers.holdsNationalId(d.did, d.nationalId)).toBe(true);
      expect(drivers.canOperate(d.did)).toBe(true);
      expect(disputes.status(o.reference, T0)).toMatchObject({ state: 'decided', yours: false, reason: 'Your card carries a different number: register with that one.' });
      expect(disputes.status(o.holderReference, T0)).toMatchObject({ yours: true });
      expect(disputes.status(o.holderReference, T0).contestBy).toBeUndefined();
      // Nothing the holder still has to do: it is gone from their Settings.
      expect(disputes.against(d.personDid, T0)).toBeUndefined();
      expect(failure(() => drivers.register({ displayName: 'X', fullName: 'X', nationalId: d.nationalId, mobile: o.phone, licenceClasses: ['bike'] }))).toMatch(/^DUPLICATE/);
    });

    it('starts the photographs’ thirty days at the decision, and blanks what the vault kept once it cannot be contested', () => {
      const d = aDriver();
      const o = bothSent(d.nationalId, { claimant: d.nationalId, holder: '55003344' });
      const photo = stored()[0].holder.photos.face as string;
      expect(media.get(photo)!.expiresAt).toBeUndefined();
      disputes.check(o.disputeId, AMINA, { to: 'claimant', what: 'w', reason: 'r' }, T0);
      disputes.approve(o.disputeId, BRIAN, T0);
      expect(Date.parse(media.get(photo)!.expiresAt!)).toBe(T0 + IDENTITY_CHECK_DAYS * DAY);
      expect(media.sweep(new Date(T0 + IDENTITY_CHECK_DAYS * DAY + 1000))).toBeGreaterThanOrEqual(6);
      expect(media.get(photo)!.status).toBe('expired');

      const vaultRef = stored()[0].claimant.phoneVaultRef as string;
      const vault = (disputes as unknown as { vault: IdentityVault }).vault;
      expect(vault.reveal(vaultRef, { purpose: 'test', requesterDid: 't' }).phone).toBe(o.phone);
      const over = T0 + DISPUTE_CONTEST_DAYS * DAY + 1000;
      expect(disputes.status(o.reference, over).state).toBe('decided');
      expect(vault.reveal(vaultRef, { purpose: 'test', requesterDid: 't' }).phone).toBeUndefined();
      expect(disputes.status(o.holderReference, over).contestBy).toBeUndefined();
    });
  });

  /* ----------------------------------------------------------------------- the hold -- */

  describe('a registration that lost its ID', () => {
    it('is free again the moment an ID of its own is on record — put there by its holder, and never somebody else’s', () => {
      const d = aDriver();
      const o = wonByClaimant(d);
      const other = aDriver();
      expect(failure(() => disputes.ownId(d.personDid, other.nationalId, o.at))).toMatch(/^DUPLICATE/);
      // Not the number that was just decided on, either: it is kept for the other person.
      expect(failure(() => disputes.ownId(d.personDid, d.nationalId, o.at))).toMatch(/^DUPLICATE/);
      expect(drivers.canOperate(d.did)).toBe(false);
      expect(disputes.ownId(d.personDid, '66007788', o.at)).toEqual({ saved: true });
      expect(drivers.canOperate(d.did)).toBe(true);
      expect(drivers.holdsNationalId(d.did, '66007788')).toBe(true);
      expect(disputes.status(o.holderReference, o.at).held).toBeUndefined();
    });

    it('a shop starts no new parcel and is named by none — said as what it is, not as an empty float — until then', () => {
      const s = aShop();
      agents.submitKyc(s.did, { idCopyRef: 'med_idcopy', tradingLicenceRef: 'med_licence', shopPhotoRefs: ['med_front'] });
      agents.decideKyc(s.did, true);
      const o = open(s.nationalId, 'shop');
      sendAll(o.reference);
      const late = T0 + DISPUTE_ANSWER_DAYS * DAY + 1000;
      disputes.readCard(o.disputeId, AMINA, 'claimant', s.nationalId, late);
      disputes.check(o.disputeId, AMINA, { to: 'claimant', what: 'w', reason: 'r' }, late);
      // A shop sent a copy of its keeper's ID when it registered: the one thing on record, shown beside what they send now.
      expect(disputes.one(o.disputeId, AMINA, late).holder).toMatchObject({ who: expect.stringMatching(/^Shop: Duka \d+$/), onRecord: ['med_idcopy'] });
      expect(disputes.list(AMINA, late).items[0].holder.onRecord).toBeUndefined();
      expect(() => agents.assertMayTakeIn(s.did)).not.toThrow();
      // The counter's own doors, asked BEFORE and AFTER: a walk-up, and a parcel booked to be handed in here.
      const walkUp = () => failure(() => parcels.accept({ parcelId: 'PUD-IDH-' + (seq += 1), agentDid: s.did, destZone: 'Kisumu', size: 'M', paymentMode: 'credit', senderMobile: '+254700111', receiverMobile: '+254700222', dropoffPhotoRef: 'p.jpg' } as never));
      const mint = (dids: Array<string | undefined>) => failure(() => (parcels as unknown as { requireSellable(q: unknown, dids: Array<string | undefined>): void }).requireSellable({ nodes: [] }, dids));
      const refusal = /^FORBIDDEN: Duka \d+ is not taking new parcels for now\. Choose another shop\.$/;
      expect(mint([s.did, undefined])).not.toMatch(refusal);
      const booked = () => failure(() => (parcels as unknown as { admitBooked(p: unknown, did: string): void }).admitBooked({ originAgentDid: s.did }, s.did));
      expect(walkUp()).not.toMatch(/No new parcel can be started/);
      expect(booked()).not.toMatch(/No new parcel can be started/);
      const money = gate.canTransact(s.did).ok;
      expect(disputes.approve(o.disputeId, BRIAN, late).holderEffect).toBe('held');
      expect(walkUp()).toMatch(/^FORBIDDEN: No new parcel can be started at this shop for now/);
      // What was booked to be handed in here BEFORE the hold is still taken in: the hold is where a parcel is made.
      expect(booked()).not.toMatch(/No new parcel can be started|is not taking new parcels/);
      // AT MINT no new parcel names it, as the place to hand in or the place to collect. The sender is told which
      // shop, and to choose another — never why: that is the shopkeeper's own business.
      expect(mint([s.did, undefined])).toMatch(refusal);
      expect(mint([undefined, s.did])).toMatch(refusal);
      expect(mint([s.did])).not.toMatch(/national|reference|held/i);
      const other = aShop();
      agents.submitKyc(other.did, { idCopyRef: 'med_idcopy', tradingLicenceRef: 'med_licence', shopPhotoRefs: ['med_front'] });
      agents.decideKyc(other.did, true);
      // A walk-up at ANOTHER counter, to be collected at the held shop: made nowhere.
      expect(failure(() => parcels.accept({ parcelId: 'PUD-IDH-' + (seq += 1), agentDid: other.did, destPudoDid: s.did, destZone: 'NorthTown', size: 'M', paymentMode: 'credit', senderMobile: '+254700111', receiverMobile: '+254700222', dropoffPhotoRef: 'p.jpg' } as never))).toMatch(refusal);
      expect(agents.takesNew(agents.get(s.did))).toBe(false);
      // The money side is judged apart: a parcel booked before the hold is not refused for a float that is fine.
      expect(gate.canTransact(s.did).moneyOk).toBe(money);

      expect(failure(() => agents.assertMayTakeIn(s.did))).toMatch(new RegExp('^FORBIDDEN: No new parcel can be started at this shop for now.*reference ' + o.holderReference));
      expect(gate.canTransact(s.did)).toMatchObject({ ok: false, code: 'ID_HELD' });
      expect(agents.holdsNationalId(s.did, s.nationalId)).toBe(false);
      expect(disputes.against(s.personDid, late)).toMatchObject({ register: 'shop', held: true });

      disputes.ownId(s.personDid, '44556677', late);
      expect(() => agents.assertMayTakeIn(s.did)).not.toThrow();
      expect(walkUp()).not.toMatch(/No new parcel can be started/);
      expect(booked()).not.toMatch(/No new parcel can be started/);
      expect(gate.canTransact(s.did).code).not.toBe('ID_HELD');
      expect(mint([s.did, undefined])).not.toMatch(refusal);
      expect(agents.holdsNationalId(s.did, '44556677')).toBe(true);
    });

    it('a held shop is offered to nobody choosing where a new parcel starts — and to everybody again afterwards', () => {
      const s = aShop();
      agents.submitKyc(s.did, { idCopyRef: 'med_idcopy', tradingLicenceRef: 'med_licence', shopPhotoRefs: ['med_front'] });
      agents.decideKyc(s.did, true);
      gate.topUp(s.did, 50);
      expect(agents.get(s.did).status).toBe('ACTIVE');
      expect(agents.takesNew(agents.get(s.did))).toBe(true);
      expect(JSON.stringify(routing.assignFirstMileNode({ zone: 'NorthTown' }))).toContain(s.did);
      agents.holdForId(s.did, { reference: 'ID-TEST-HELD', at: new Date().toISOString() });
      // Still trading, as far as its float goes — and still not somewhere a new parcel starts.
      expect(agents.get(s.did).status).toBe('ACTIVE');
      expect(agents.takesNew(agents.get(s.did))).toBe(false);
      expect(failure(() => routing.assignFirstMileNode({ zone: 'NorthTown' }))).toMatch(/^NO_CAPACITY_AVAILABLE/);
      agents.takeNationalId(s.did, '44001122');
      expect(JSON.stringify(routing.assignFirstMileNode({ zone: 'NorthTown' }))).toContain(s.did);
      // A shop the float has locked was never offered either: one question, asked everywhere a shop is chosen.
      expect(agents.takesNew({ status: 'LOCKED' })).toBe(false);
      expect(agents.takesNew({ status: 'ACTIVE' })).toBe(true);
    });
  });

  /* ------------------------------------------------------------------- still disputed -- */

  describe('still disputed: an appointment in person', () => {
    const tomorrow = (from: number) => dayStr(from + DAY);

    it('is made by whoever did not get it, in time, for a day ahead — and both are given a ticket', () => {
      const ke = entities.forJurisdiction('KE')!;
      const d = aDriver();
      const o = wonByClaimant(d);
      const day = dayStr(o.at + 3 * DAY);
      expect(failure(() => appoint(o.reference, day, o.at))).toMatch(/^INVALID_STATE: The ID is yours/);
      // The country's company says, in its own admin, where it is and when it receives visitors — one day a week here.
      const visitDay = weekdayOf(day)!;
      contacts.set(ke.entityId, { contactName: 'Grace at the front desk', phone: '+254 20 000 111', address: 'Mombasa Road, gate 4', hours: 'Mon–Fri 8–17', visitDays: [visitDay], visitFrom: '09:00', visitTo: '16:00' }, 'Grace');
      // Before any day is chosen, the app is told which days there are to choose from.
      expect(disputes.status(o.holderReference, o.at).support).toMatchObject({ address: 'Mombasa Road, gate 4', visitDays: [visitDay], visitFrom: '09:00', visitTo: '16:00' });
      const wrongDay = failure(() => appoint(o.holderReference, dayStr(o.at + 4 * DAY), o.at));
      expect(wrongDay).toMatch(/^INVALID_INPUT: .+ does not receive visitors on a \w+day\. It does on \w+day\.$/);
      expect(wrongDay).toContain(ke.name);
      expect(disputes.status(o.holderReference, o.at).state).toBe('decided');
      expect(failure(() => appoint(o.holderReference, dayStr(o.at), o.at))).toMatch(/^INVALID_INPUT: Choose a day from tomorrow on/);
      expect(failure(() => appoint(o.holderReference, dayStr(o.at + (APPOINTMENT_WITHIN_DAYS + 2) * DAY), o.at))).toMatch(/^INVALID_INPUT: Choose a day within/);

      const mine = appoint(o.holderReference, day, o.at);
      expect(mine).toMatchObject({ state: 'appointment' });
      expect(mine.ticket).toEqual({
        reference: o.holderReference,
        date: day,
        yours: true,
        bring: ['id_card', 'phone', 'reference', 'second_document'],
        changesLeft: APPOINTMENT_CHANGES,
        willRemind: true,
        place: { company: ke.name, contactName: 'Grace at the front desk', phone: '+254 20 000 111', address: 'Mombasa Road, gate 4', hours: 'Mon–Fri 8–17', visitDays: [visitDay], visitFrom: '09:00', visitTo: '16:00' },
      });
      // Staff are shown where the tickets send them.
      expect(disputes.one(o.disputeId, AMINA, o.at)).toMatchObject({ appointmentDate: day, appointmentBy: 'holder', place: { company: ke.name, address: 'Mombasa Road, gate 4', visitDays: [visitDay], visitFrom: '09:00', visitTo: '16:00' } });
      expect(disputes.one(o.disputeId, AMINA, o.at).appointmentOffDay).toBeUndefined();
      // Read one dispute at a time, like the photographs: the list carries nobody's address.
      expect(disputes.list(AMINA, o.at).items.find((x) => x.disputeId === o.disputeId)).toMatchObject({ appointmentDate: day });
      expect(disputes.list(AMINA, o.at).items.find((x) => x.disputeId === o.disputeId)!.place).toBeUndefined();
      // The other person's ticket is their own: their reference, and nothing to change.
      expect(disputes.status(o.reference, o.at).ticket).toMatchObject({ reference: o.reference, date: day, yours: false, changesLeft: 0 });
      const told = mailTo(d.email).find((m) => about(m, 'your appointment'))!;
      expect(told.text).toContain('Mombasa Road, gate 4');
      expect(told.text).toContain('between 09:00 and 16:00');
      expect(told.text).toContain('your ID card itself');
      expect(told.text).toContain(o.holderReference);
      // The photographs are kept until the day has come and gone.
      const photo = stored()[0].claimant.photos.face as string;
      expect(Date.parse(media.get(photo)!.expiresAt!)).toBe(Date.parse(day + 'T00:00:00.000Z') + IDENTITY_CHECK_DAYS * DAY);

      // The company changes its days afterwards: the ticket and the console both say the day no longer fits.
      const another = (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).find((x) => x !== visitDay)!;
      contacts.set(ke.entityId, { visitDays: [another] }, 'Grace');
      expect(disputes.status(o.holderReference, o.at).ticket).toMatchObject({ offDay: true, place: { visitDays: [another] } });
      expect(disputes.one(o.disputeId, AMINA, o.at).appointmentOffDay).toBe(true);
      // Clearing them is the company's to do as well: every day is taken again, and nothing is off.
      contacts.set(ke.entityId, { visitDays: [] }, 'Grace');
      expect(disputes.status(o.holderReference, o.at).ticket!.offDay).toBeUndefined();
      expect(disputes.one(o.disputeId, AMINA, o.at).appointmentOffDay).toBeUndefined();
    });

    /** Every day of the week, nine to twelve: three hours a day, so what is being proved is the closures and the count. */
    const EVERY_DAY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

    it('is not offered or taken on a date the company says it is closed — a public holiday, a one-off closure', () => {
      const ke = entities.forJurisdiction('KE')!;
      const d = aDriver();
      const o = wonByClaimant(d);
      const holiday = dayStr(o.at + 3 * DAY);
      const oneOff = dayStr(o.at + 5 * DAY);
      contacts.set(ke.entityId, { address: 'Mombasa Road, gate 4', visitDays: EVERY_DAY, visitFrom: '09:00', visitTo: '12:00', closedDates: [{ date: oneOff, note: 'Stocktaking' }, { date: holiday, note: 'Mashujaa Day' }, { date: holiday, note: 'Mashujaa Day' }] }, 'Grace', o.at);
      // Kept in date order, one of each.
      expect(contacts.of(ke.entityId)!.closedDates).toEqual([{ date: holiday, note: 'Mashujaa Day' }, { date: oneOff, note: 'Stocktaking' }]);
      // Not offered …
      const offered = disputes.status(o.holderReference, o.at).choices!.map((c) => c.date);
      expect(offered).toHaveLength(21 - 2);
      expect(offered).not.toContain(holiday);
      expect(offered).not.toContain(oneOff);
      expect(offered).toContain(dayStr(o.at + 4 * DAY));
      // … and not taken, in words that say what the day is.
      expect(failure(() => appoint(o.holderReference, holiday, o.at))).toMatch(/^INVALID_INPUT: .+ is closed on \d+ \w+ \d{4} \(Mashujaa Day\)\. Choose another day\.$/);
      expect(appoint(o.holderReference, dayStr(o.at + 4 * DAY), o.at).ticket).toMatchObject({ date: dayStr(o.at + 4 * DAY) });
      // A closure announced AFTER somebody chose that day: their ticket and the console say it no longer fits.
      contacts.set(ke.entityId, { closedDates: [{ date: dayStr(o.at + 4 * DAY), note: 'Burst pipe' }] }, 'Grace', o.at);
      expect(disputes.status(o.holderReference, o.at).ticket).toMatchObject({ offDay: true });
      expect(disputes.one(o.disputeId, AMINA, o.at)).toMatchObject({ appointmentOffDay: true, place: { closedDates: [{ date: dayStr(o.at + 4 * DAY), note: 'Burst pipe' }] } });
      // The day they are moved to is not that one; the holiday that was replaced is open again.
      expect(disputes.status(o.holderReference, o.at).choices!.map((c) => c.date)).toContain(holiday);
      expect(appoint(o.holderReference, holiday, o.at).ticket!.offDay).toBeUndefined();
    });

    it('closed dates are dates, said by the company — replaced as a list, cleared by an empty one, and let go once they are past', () => {
      const ke = entities.forJurisdiction('KE')!;
      const at = Date.parse('2026-10-08T10:00:00.000Z');
      for (const bad of ['25 December', '2026-13-01', '2026-02-30', '']) expect(failure(() => contacts.set(ke.entityId, { closedDates: [{ date: bad }] }, 'Grace', at))).toMatch(/^VALIDATION_FAILED: A closed date is a date/);
      const set = contacts.set(ke.entityId, { closedDates: [{ date: '2026-12-25', note: 'Christmas Day' }, { date: '2026-10-07' }, { date: '2026-10-01', note: 'long gone' }, { date: '2026-10-20' }] }, 'Grace', at);
      // Yesterday is still said (somebody may be reading a ticket for it); last week is not.
      expect(set.closedDates).toEqual([{ date: '2026-10-07' }, { date: '2026-10-20' }, { date: '2026-12-25', note: 'Christmas Day' }]);
      // Putting a telephone number right leaves them alone; a new list replaces the list; an empty one clears it.
      expect(contacts.set(ke.entityId, { phone: '+254 20 000 111' }, 'Grace', at).closedDates).toHaveLength(3);
      expect(contacts.set(ke.entityId, { closedDates: [{ date: '2026-11-02' }] }, 'Grace', at).closedDates).toEqual([{ date: '2026-11-02' }]);
      expect(contacts.set(ke.entityId, { closedDates: [] }, 'Grace', at).closedDates).toBeUndefined();
    });

    it('is for an HOUR where the company says how many visitors it sees in one — and an hour that is full is not offered or taken', () => {
      const ke = entities.forJurisdiction('KE')!;
      // Two visitors an hour, nine to twelve: three hours, two places in each.
      contacts.set(ke.entityId, { address: 'Mombasa Road, gate 4', visitDays: EVERY_DAY, visitFrom: '09:00', visitTo: '12:00', visitorsPerHour: 2 }, 'Grace');
      expect(visitingHours(contacts.of(ke.entityId))).toEqual(['09:00', '10:00', '11:00']);
      const [a, b, c] = [wonByClaimant(aDriver()), wonByClaimant(aDriver()), wonByClaimant(aDriver())];
      const day = dayStr(a.at + 2 * DAY);
      const hoursOf = (ref: string) => disputes.status(ref, a.at).choices!.find((x) => x.date === day)!.hours;
      expect(hoursOf(a.holderReference)).toEqual([{ at: '09:00', free: 2 }, { at: '10:00', free: 2 }, { at: '11:00', free: 2 }]);

      // A day alone is not enough any more, and an hour has to be one of its hours.
      expect(failure(() => appoint(a.holderReference, day, a.at))).toMatch(/^INVALID_INPUT: Choose the hour you will come: 09:00, 10:00, 11:00\.$/);
      expect(failure(() => appoint(a.holderReference, day, a.at, '12:00'))).toMatch(/^INVALID_INPUT: Choose the hour you will come/);
      expect(failure(() => appoint(a.holderReference, day, a.at, '09:30'))).toMatch(/^INVALID_INPUT: Choose the hour you will come/);

      const mine = appoint(a.holderReference, day, a.at, '10:00');
      expect(mine.ticket).toMatchObject({ date: day, at: '10:00', until: '11:00', yours: true });
      expect(disputes.status(a.reference, a.at).ticket).toMatchObject({ date: day, at: '10:00', until: '11:00', yours: false });
      expect(disputes.one(a.disputeId, AMINA, a.at)).toMatchObject({ appointmentDate: day, appointmentAt: '10:00', place: { visitorsPerHour: 2 } });
      expect(mine.ticket!.offDay).toBeUndefined();
      // One place is gone from that hour, for everybody else. Their own does not count against themselves.
      expect(hoursOf(b.holderReference)).toEqual([{ at: '09:00', free: 2 }, { at: '10:00', free: 1 }, { at: '11:00', free: 2 }]);
      expect(hoursOf(a.holderReference)!.find((h) => h.at === '10:00')).toEqual({ at: '10:00', free: 2 });
      appoint(b.holderReference, day, a.at, '10:00');
      // Full: said as full, and refused.
      expect(hoursOf(c.holderReference)!.find((h) => h.at === '10:00')).toEqual({ at: '10:00', free: 0 });
      expect(failure(() => appoint(c.holderReference, day, a.at, '10:00'))).toMatch(/^CONFLICT: 10:00 on \d+ \w+ \d{4} is full\. Choose another hour\.$/);
      expect(disputes.status(c.holderReference, a.at).state).toBe('decided');
      expect(appoint(c.holderReference, day, a.at, '11:00').ticket).toMatchObject({ at: '11:00', until: '12:00' });
      // An appointment at ANOTHER country's office takes no place at this one.
      const elsewhere = stored().find((x) => x.disputeId === b.disputeId)!;
      elsewhere.country = 'TZ';
      expect(hoursOf(c.holderReference)!.find((h) => h.at === '10:00')).toEqual({ at: '10:00', free: 1 });
      elsewhere.country = 'KE';
      expect(hoursOf(c.holderReference)!.find((h) => h.at === '10:00')).toEqual({ at: '10:00', free: 0 });
      // Somebody moves away, and the place is free again.
      appoint(b.holderReference, day, a.at, '09:00');
      expect(hoursOf(c.holderReference)!.find((h) => h.at === '10:00')).toEqual({ at: '10:00', free: 1 });
      // The notice says the hour.
      expect(notifications.inboxFor(stored().find((x) => x.disputeId === a.disputeId)!.holder.personDid).some((n) => / at 10:00 at /.test(n.body))).toBe(true);
    });

    it('a day with no hour left is not offered at all; and the number is the company’s own — a whole one, with hours to count in', () => {
      const ke = entities.forJurisdiction('KE')!;
      contacts.set(ke.entityId, { visitDays: EVERY_DAY, visitFrom: '09:00', visitTo: '10:00', visitorsPerHour: 1 }, 'Grace');
      const [a, b] = [wonByClaimant(aDriver()), wonByClaimant(aDriver())];
      const day = dayStr(a.at + 2 * DAY);
      appoint(a.holderReference, day, a.at, '09:00');
      const offered = disputes.status(b.holderReference, a.at).choices!.map((x) => x.date);
      expect(offered).toHaveLength(20);
      expect(offered).not.toContain(day);

      for (const bad of [1.5, -1, 201]) expect(failure(() => contacts.set(ke.entityId, { visitorsPerHour: bad }, 'Grace'))).toMatch(/^VALIDATION_FAILED: Visitors an hour is a whole number/);
      // Hours that no longer hold a whole hour cannot carry a number an hour — and are refused, not half-saved.
      expect(failure(() => contacts.set(ke.entityId, { visitTo: '09:30' }, 'Grace'))).toMatch(/^VALIDATION_FAILED: Say from when until when you receive visitors/);
      expect(contacts.of(ke.entityId)).toMatchObject({ visitTo: '10:00', visitorsPerHour: 1 });
      // Taken off again — by zero — no hour is asked for and none fills: the day is offered to everybody.
      expect(contacts.set(ke.entityId, { visitorsPerHour: 0 }, 'Grace').visitorsPerHour).toBeUndefined();
      expect(disputes.status(b.holderReference, a.at).choices!.find((x) => x.date === day)).toEqual({ date: day });
      expect(appoint(b.holderReference, day, a.at).ticket!.at).toBeUndefined();
      // And a number brought in after somebody chose only a day: their ticket says to choose again.
      contacts.set(ke.entityId, { visitorsPerHour: 3 }, 'Grace');
      expect(disputes.status(b.holderReference, a.at).ticket).toMatchObject({ offDay: true });
      expect(hourAfter('09:00')).toBe('10:00');
      expect(visitingHours({ visitFrom: '08:30', visitTo: '11:00' })).toEqual(['08:30', '09:30']);
      expect(visitingHours({ visitFrom: '09:00' })).toEqual([]);
    });

    it('the days to choose from are told only to somebody who may choose — and nothing is told where the company set no days', () => {
      const ke = entities.forJurisdiction('KE')!;
      const d = aDriver();
      const o = wonByClaimant(d);
      // No visiting days set: nothing to offer, and any day is taken as before.
      expect(disputes.status(o.holderReference, o.at).choices).toBeUndefined();
      // An address alone is not days: still nothing to offer.
      contacts.set(ke.entityId, { address: 'Mombasa Road, gate 4' }, 'Grace');
      expect(disputes.status(o.holderReference, o.at).choices).toBeUndefined();
      contacts.set(ke.entityId, { visitDays: EVERY_DAY, visitFrom: '09:00', visitTo: '12:00' }, 'Grace');
      // The one who lost may choose; the one who got it has nothing to choose.
      expect(disputes.status(o.holderReference, o.at).choices).toHaveLength(21);
      expect(disputes.status(o.holderReference, o.at).choices![0]).toEqual({ date: dayStr(o.at + DAY) });
      expect(disputes.status(o.reference, o.at).choices).toBeUndefined();
      // Once made: the maker may still move it, the other may not — and on the day itself nobody may.
      const day = dayStr(o.at + 2 * DAY);
      appoint(o.holderReference, day, o.at);
      expect(disputes.status(o.holderReference, o.at).choices).toHaveLength(21);
      expect(disputes.status(o.reference, o.at).choices).toBeUndefined();
      expect(disputes.status(o.holderReference, o.at + 2 * DAY).choices).toBeUndefined();
      // After the time to contest has passed, nobody is offered a day.
      const late = wonByClaimant(aDriver());
      expect(disputes.status(late.holderReference, late.at + DISPUTE_CONTEST_DAYS * DAY + 1000).choices).toBeUndefined();
    });

    it('is part of switching a country on: a company of ours is not ready until its own entry says where and when', () => {
      const ke = entities.forJurisdiction('KE')!;
      const item = (key: string) => readiness.readinessOf(ke.entityId).items.find((i) => i.key === key)!;
      expect(item('visitors_address')).toMatchObject({ met: false, label: expect.stringContaining('written by the company in its own Settings') });
      expect(item('visiting_days').met).toBe(false);
      expect(readiness.readinessOf(ke.entityId).ready).toBe(false);
      contacts.set(ke.entityId, { address: 'Mombasa Road, gate 4' }, 'Grace');
      expect(item('visitors_address').met).toBe(true);
      // Days without hours are half an answer: a ticket would say which day and not when.
      contacts.set(ke.entityId, { visitDays: ['mon', 'fri'] }, 'Grace');
      expect(item('visiting_days').met).toBe(false);
      contacts.set(ke.entityId, { visitFrom: '09:00', visitTo: '16:00' }, 'Grace');
      expect(item('visiting_days').met).toBe(true);
      // Taken away again, it is missing again: derived from what the company says now, never ticked once.
      contacts.set(ke.entityId, { address: '' }, 'Grace');
      expect(item('visitors_address').met).toBe(false);
      // A partner's office is not ours to send anybody to: it is not asked.
      const partner = entities.createCompany({ kind: 'partner', jurisdiction: 'zm', name: 'Lusaka Logistics' }, 'Amina');
      expect(readiness.readinessOf(partner.entityId).items.some((i) => i.key === 'visitors_address' || i.key === 'visiting_days')).toBe(false);
    });

    /* ------------------------------------------------------------ the day before -- */

    const HOUR = 3_600_000;
    /** When the reminder for an appointment on this day comes due: the morning of the day before. */
    const dueOf = (date: string) => Date.parse(date + 'T00:00:00.000Z') - APPOINTMENT_REMINDER_HOURS * HOUR;
    const reminders = (address: string) => outbox.recent(address).filter((m) => m.template === 'appointment-reminder');
    /** Decided for a claimant who HAS an account and an inbox — so both of the two people can be reached. */
    function wonByKnownClaimant() {
      const d = aDriver();
      const phone = aVerifiedNumber();
      const me = persons.ensurePerson(phone);
      const email = 'claimant' + (seq += 1) + '@example.com';
      persons.setEmail(me.personDid, email);
      const opened = disputes.open({ register: 'driver', nationalId: d.nationalId, phone }, T0);
      const disputeId = idOf(opened.reference);
      const holderReference = holderRef(opened.reference);
      sendAll(opened.reference);
      const at = T0 + DISPUTE_ANSWER_DAYS * DAY + 1000;
      disputes.readCard(disputeId, AMINA, 'claimant', d.nationalId, at);
      disputes.check(disputeId, AMINA, { to: 'claimant', what: 'w', reason: 'You showed no card.' }, at);
      disputes.approve(disputeId, BRIAN, at);
      return { d, me, email, reference: opened.reference, holderReference, disputeId, at };
    }

    it('the day before, each of the two is reminded — once — of when, where and what to bring', () => {
      const ke = entities.forJurisdiction('KE')!;
      contacts.set(ke.entityId, { address: 'Mombasa Road, gate 4', visitDays: EVERY_DAY, visitFrom: '09:00', visitTo: '12:00', visitorsPerHour: 2 }, 'Grace');
      const k = wonByKnownClaimant();
      const day = dayStr(k.at + 3 * DAY);
      appoint(k.holderReference, day, k.at, '10:00');
      const due = dueOf(day);
      // Not before its time: and the ticket says a reminder WILL come, not that one went.
      expect(disputes.remindAppointments(due - 1000)).toBe(0);
      expect(reminders(k.d.email)).toHaveLength(0);
      expect(disputes.status(k.holderReference, due - 1000).ticket).toMatchObject({ willRemind: true });
      expect(disputes.status(k.holderReference, due - 1000).ticket!.remindedAt).toBeUndefined();

      // The morning of the day before: one appointment, and both of its people.
      expect(disputes.remindAppointments(due + 1000)).toBe(1);
      const [mine] = reminders(k.d.email);
      expect(mine.subject).toBe('SeeBuyGet: your appointment is tomorrow');
      for (const said of ['10:00 to 11:00', 'Mombasa Road, gate 4', k.holderReference, 'Your ID card itself — not a copy or a photograph', 'The phone you use with SeeBuyGet', 'your driving licence', 'Change the day today']) expect(mine.text).toContain(said);
      // Their own reference, never the other person's.
      expect(mine.text).not.toContain(k.reference);
      const [theirs] = reminders(k.email);
      expect(theirs.subject).toBe('SeeBuyGet: your appointment is tomorrow');
      for (const said of ['You may come too', k.reference, '10:00 to 11:00', 'Your ID card itself']) expect(theirs.text).toContain(said);
      expect(theirs.text).not.toContain(k.holderReference);
      expect(theirs.text).not.toContain('Change the day today');
      // In the app as well — the person's own bell, and the bell of the app they drive in.
      const inApp = notifications.inboxFor(k.d.personDid).find((n) => n.title === 'Your appointment about the national ID is tomorrow')!;
      expect(inApp.body).toMatch(/^Tomorrow, \d+ \w+ \d{4}, 10:00 to 11:00, at .+Mombasa Road, gate 4\. Bring: Your ID card itself/);
      expect(inApp.body).toContain('your driving licence');
      expect(notifications.inboxFor(k.d.did).some((n) => n.title === 'Your appointment about the national ID is tomorrow')).toBe(true);
      expect(notifications.inboxFor(k.me.personDid).some((n) => n.title === 'The appointment about the national ID is tomorrow' && /you may come too/.test(n.body))).toBe(true);

      // Once: looked at again an hour later, and the next morning, nothing more goes.
      expect(disputes.remindAppointments(due + 2 * HOUR)).toBe(0);
      expect(disputes.remindAppointments(due + 20 * HOUR)).toBe(0);
      expect(reminders(k.d.email)).toHaveLength(1);
      expect(reminders(k.email)).toHaveLength(1);
      // The ticket and the console say it went, and when.
      expect(disputes.status(k.holderReference, due + 2000).ticket!.remindedAt).toBe(new Date(due + 1000).toISOString());
      expect(disputes.one(k.disputeId, AMINA, due + 2000).appointmentRemindedAt).toBe(new Date(due + 1000).toISOString());
    });

    it('moved, it is reminded of again when the NEW day comes; made after the reminder was due, or on a day that has come, it is not', () => {
      const k = wonByKnownClaimant();
      const day = dayStr(k.at + 3 * DAY);
      appoint(k.holderReference, day, k.at);
      expect(disputes.remindAppointments(dueOf(day) + 1000)).toBe(1);
      // Moved, the day before, to a later day: nothing has been said of THAT day yet.
      const later = dayStr(k.at + 6 * DAY);
      appoint(k.holderReference, later, dueOf(day) + 2000);
      expect(disputes.status(k.holderReference, dueOf(day) + 3000).ticket!.remindedAt).toBeUndefined();
      expect(disputes.remindAppointments(dueOf(later) - 1000)).toBe(0);
      expect(disputes.remindAppointments(dueOf(later) + 1000)).toBe(1);
      expect(reminders(k.d.email)).toHaveLength(2);

      // Made when the reminder was already due: they were told all of it a moment ago, and are not told twice.
      const q = wonByKnownClaimant();
      const soon = dayStr(q.at + 2 * DAY);
      appoint(q.holderReference, soon, dueOf(soon) + HOUR);
      expect(disputes.remindAppointments(dueOf(soon) + 2 * HOUR)).toBe(0);
      expect(reminders(q.d.email)).toHaveLength(0);
      expect(disputes.status(q.holderReference, dueOf(soon) + 3 * HOUR).ticket!.remindedAt).toBeUndefined();

      // Nobody looked the day before, and the day has come: "tomorrow" would be wrong, so nothing goes.
      const r = wonByKnownClaimant();
      const then = dayStr(r.at + 3 * DAY);
      appoint(r.holderReference, then, r.at);
      expect(disputes.remindAppointments(Date.parse(then + 'T08:00:00.000Z'))).toBe(0);
      expect(reminders(r.d.email)).toHaveLength(0);
      // And an appointment that is over is not reminded of: only one that is still to come.
      expect(disputes.remindAppointments(Date.parse(then + 'T08:00:00.000Z') + 5 * DAY)).toBe(0);
    });

    it('somebody with no account cannot be reminded, and their ticket says so; an office that changed its times is said instead of what to bring', () => {
      const ke = entities.forJurisdiction('KE')!;
      contacts.set(ke.entityId, { address: 'Mombasa Road, gate 4', visitDays: EVERY_DAY, visitFrom: '09:00', visitTo: '12:00' }, 'Grace');
      const d = aDriver();
      const o = wonByClaimant(d);
      const day = dayStr(o.at + 3 * DAY);
      appoint(o.holderReference, day, o.at);
      // The one refused at registration never made an account: nothing we send reaches them, and the ticket says it.
      expect(disputes.status(o.reference, o.at).ticket).toMatchObject({ willRemind: false });
      expect(disputes.status(o.holderReference, o.at).ticket).toMatchObject({ willRemind: true });
      // The office closes that day afterwards.
      contacts.set(ke.entityId, { closedDates: [{ date: day, note: 'Burst pipe' }] }, 'Grace', o.at);
      expect(disputes.remindAppointments(dueOf(day) + 1000)).toBe(1);
      const [mail] = reminders(d.email);
      expect(mail.subject).toBe('SeeBuyGet: your appointment tomorrow no longer fits');
      expect(mail.text).toContain('choose another day, today');
      expect(mail.text).toContain('Do not travel tomorrow');
      expect(mail.text).not.toContain('Your ID card itself');
      const inApp = notifications.inboxFor(d.personDid).find((n) => n.title === 'Your appointment tomorrow no longer fits')!;
      expect(inApp.body).toContain('choose another day, today');
      expect(inApp.body).not.toContain('Bring:');
      // For the one with no account nothing went, and nothing claims to have.
      expect(disputes.status(o.reference, dueOf(day) + 2000).ticket!.remindedAt).toBeUndefined();
      expect(disputes.status(o.holderReference, dueOf(day) + 2000).ticket!.remindedAt).toBeTruthy();
    });

    it('goes by the clock: while the server runs it looks every half hour, and stops when the server stops', () => {
      const k = wonByKnownClaimant();
      const day = dayStr(k.at + 3 * DAY);
      appoint(k.holderReference, day, k.at);
      jest.useFakeTimers({ now: dueOf(day) + 60_000 });
      try {
        disputes.onModuleInit();
        // Nobody called anything: only time passed.
        expect(reminders(k.d.email)).toHaveLength(0);
        jest.advanceTimersByTime(31 * 60 * 1000);
        expect(reminders(k.d.email)).toHaveLength(1);
        expect(reminders(k.email)).toHaveLength(1);
        // Stopped, it looks no more: an appointment that comes due afterwards is left alone.
        disputes.onModuleDestroy();
        const later = dayStr(k.at + 6 * DAY);
        appoint(k.holderReference, later, Date.now());
        jest.setSystemTime(dueOf(later) + 60_000);
        jest.advanceTimersByTime(3 * HOUR);
        expect(reminders(k.d.email)).toHaveLength(1);
      } finally {
        disputes.onModuleDestroy();
        jest.useRealTimers();
      }
    });

    it('follows visiting days and hours the company sets for itself — days of the week, times of day, merged like the rest of its entry', () => {
      const ke = entities.forJurisdiction('KE')!;
      expect(contacts.set(ke.entityId, { address: 'Mombasa Road, gate 4', visitDays: ['fri', 'mon', 'mon'], visitFrom: '09:00', visitTo: '16:30' }, 'Grace')).toMatchObject({ visitDays: ['mon', 'fri'], visitFrom: '09:00', visitTo: '16:30' });
      // Putting a telephone number right does not drop them, or the address.
      expect(contacts.set(ke.entityId, { phone: '+254 20 000 111' }, 'Grace')).toMatchObject({ visitDays: ['mon', 'fri'], visitFrom: '09:00', address: 'Mombasa Road, gate 4' });
      expect(failure(() => contacts.set(ke.entityId, { visitDays: ['mon', 'someday'] }, 'Grace'))).toMatch(/^VALIDATION_FAILED: A visiting day is a day of the week/);
      expect(failure(() => contacts.set(ke.entityId, { visitFrom: '9am' }, 'Grace'))).toMatch(/^VALIDATION_FAILED: Visiting hours are a time of day/);
      expect(failure(() => contacts.set(ke.entityId, { visitFrom: '17:00' }, 'Grace'))).toMatch(/^VALIDATION_FAILED: Visiting hours end after they begin/);
      // A refusal changed nothing.
      expect(contacts.of(ke.entityId)).toMatchObject({ visitDays: ['mon', 'fri'], visitFrom: '09:00', visitTo: '16:30' });
      const cleared = contacts.set(ke.entityId, { visitDays: [], visitFrom: '', visitTo: '' }, 'Grace');
      expect(cleared.visitDays).toBeUndefined();
      expect(cleared.visitFrom).toBeUndefined();
      expect(cleared.visitTo).toBeUndefined();
      expect(cleared.address).toBe('Mombasa Road, gate 4');
      // A date is a weekday wherever it is read.
      expect([weekdayOf('2026-10-11'), weekdayOf('2026-10-12'), weekdayOf('2026-10-17'), weekdayOf('nonsense')]).toEqual(['sun', 'mon', 'sat', undefined]);
    });

    it('cannot be made once the two weeks are over', () => {
      const d = aDriver();
      const o = wonByClaimant(d);
      const late = o.at + DISPUTE_CONTEST_DAYS * DAY + 1000;
      expect(failure(() => appoint(o.holderReference, tomorrow(late), late))).toMatch(/^INVALID_STATE: The time to contest this decision has passed/);
    });

    it('can be moved by whoever made it — twice, and not on the day', () => {
      const d = aDriver();
      const o = wonByClaimant(d);
      appoint(o.holderReference, dayStr(o.at + 5 * DAY), o.at);
      expect(failure(() => appoint(o.reference, dayStr(o.at + 6 * DAY), o.at))).toMatch(/^FORBIDDEN: Only the person who made the appointment/);
      expect(appoint(o.holderReference, dayStr(o.at + 6 * DAY), o.at).ticket).toMatchObject({ date: dayStr(o.at + 6 * DAY), changesLeft: APPOINTMENT_CHANGES - 1 });
      // No address written for this country's company: the ticket carries no place, and staff are not shown one.
      expect(disputes.status(o.holderReference, o.at).ticket!.place).toBeUndefined();
      expect(disputes.one(o.disputeId, AMINA, o.at).place).toBeUndefined();
      expect(appoint(o.holderReference, dayStr(o.at + 7 * DAY), o.at).ticket!.changesLeft).toBe(0);
      expect(failure(() => appoint(o.holderReference, dayStr(o.at + 8 * DAY), o.at))).toMatch(/^INVALID_STATE: The day has been changed as often/);
      const d2 = aDriver();
      const o2 = wonByClaimant(d2);
      appoint(o2.holderReference, dayStr(o2.at + 2 * DAY), o2.at);
      expect(failure(() => appoint(o2.holderReference, dayStr(o2.at + 4 * DAY), o2.at + 2 * DAY))).toMatch(/^INVALID_STATE: The day has come/);
    });

    it('is decided again by two members of staff, from the day on — and the decision changes only for somebody who came', () => {
      const d = aDriver();
      const o = wonByClaimant(d);
      // The claimant registered with it in the meantime.
      const mine = drivers.register({ displayName: 'Claimant', fullName: 'C', nationalId: d.nationalId, mobile: o.phone, licenceClasses: ['bike'] });
      const me = persons.attachRole(o.phone, 'driver', mine.did);
      const day = dayStr(o.at + 3 * DAY);
      appoint(o.holderReference, day, o.at);
      const say = { what: 'Card in the hand: genuine, and theirs.', reason: 'The other person did not come; this card is the real one.' };
      expect(disputes.list(undefined, o.at).waiting).toBe(0);
      expect(failure(() => disputes.check(o.disputeId, AMINA, { to: 'holder', ...say, claimantCame: false, holderCame: true }, o.at))).toMatch(/^INVALID_STATE: The appointment is on/);
      const then = Date.parse(day + 'T09:00:00.000Z');
      expect(disputes.list(undefined, then).waiting).toBe(1);
      expect(failure(() => disputes.check(o.disputeId, AMINA, { to: 'holder', ...say }, then))).toMatch(/^FIELD_REQUIRED: Say who came/);
      expect(failure(() => disputes.check(o.disputeId, AMINA, { to: 'holder', ...say, claimantCame: true, holderCame: false }, then))).toMatch(/^INVALID_STATE: The decision can change only for somebody who came/);

      expect(disputes.check(o.disputeId, AMINA, { to: 'holder', ...say, claimantCame: false, holderCame: true }, then)).toMatchObject({ state: 'rechecked', proposedTo: 'holder' });
      expect(failure(() => disputes.approve(o.disputeId, AMINA, then))).toMatch(/^CONFLICT/);
      // Nothing has moved yet.
      expect(drivers.canOperate(d.did)).toBe(false);
      const row = disputes.approve(o.disputeId, BRIAN, then);
      expect(row).toMatchObject({ state: 'final', finalTo: 'holder', finalBy: 'Brian Kamau', decidedTo: 'claimant' });
      expect(row.holder.came).toBe(true);
      expect(row.claimant.came).toBe(false);

      // It goes back: the first holder drives again; the registration made with it since is the one held now.
      expect(drivers.holdsNationalId(d.did, d.nationalId)).toBe(true);
      expect(drivers.canOperate(d.did)).toBe(true);
      expect(drivers.holdsNationalId(mine.did, d.nationalId)).toBe(false);
      expect(drivers.canOperate(mine.did)).toBe(false);
      expect(drivers.offRoadReasons(mine.did).join(' ')).toContain('reference ' + o.reference);
      expect(disputes.status(o.reference, then)).toMatchObject({ state: 'final', yours: false, held: true, reason: say.reason });
      expect(disputes.status(o.holderReference, then)).toMatchObject({ yours: true });
      expect(disputes.status(o.holderReference, then).held).toBeUndefined();
      expect(disputes.against(me.personDid, then)).toMatchObject({ reference: o.reference, held: true });
      // Final: no ticket any more, and nothing further to make.
      expect(disputes.status(o.reference, then).ticket).toBeUndefined();
      expect(failure(() => appoint(o.reference, tomorrow(then), then))).toMatch(/^INVALID_STATE/);
    });

    it('finds whoever opened it by their ACCOUNT once they have one — on a new number still, and never whoever has their old one', () => {
      const d = aDriver();
      const o = wonByClaimant(d);
      // The claimant registered with it, and then moved their account to another number — as anybody may.
      const mine = drivers.register({ displayName: 'Claimant', fullName: 'C', nationalId: d.nationalId, mobile: o.phone, licenceClasses: ['bike'] });
      const me = persons.attachRole(o.phone, 'driver', mine.did);
      const fresh = aNumber();
      persons.movePhone(me.personDid, fresh, 'self', o.at);
      const heldKey = drivers.moveMobile(mine.did, fresh);
      // A week later the old number is free, and somebody else registers to drive with it.
      persons.settleMove(me.personDid, o.at + 8 * 24 * 3_600_000);
      if (heldKey) drivers.releaseHeldPhone(heldKey, mine.did);
      const other = drivers.register({ displayName: 'Newcomer', fullName: 'N', nationalId: '9900' + String((seq += 1)).padStart(4, '0'), mobile: o.phone, licenceClasses: ['bike'] });
      const stranger = persons.attachRole(o.phone, 'driver', other.did);

      // The holder comes to the appointment and the decision goes back to them.
      const day = dayStr(o.at + 3 * DAY);
      appoint(o.holderReference, day, o.at);
      const then = Date.parse(day + 'T09:00:00.000Z');
      const say = { what: 'Card in the hand: genuine, and theirs.', reason: 'The other person did not come; this card is the real one.' };
      disputes.check(o.disputeId, AMINA, { to: 'holder', ...say, claimantCame: false, holderCame: true }, then);
      disputes.approve(o.disputeId, BRIAN, then);

      // The registration made with the ID since is the claimant's own, wherever their account is now: that one is held.
      expect(drivers.holdsNationalId(d.did, d.nationalId)).toBe(true);
      expect(drivers.holdsNationalId(mine.did, d.nationalId)).toBe(false);
      expect(drivers.canOperate(mine.did)).toBe(false);
      expect(disputes.status(o.reference, then)).toMatchObject({ state: 'final', held: true });
      expect(disputes.against(me.personDid, then)).toMatchObject({ reference: o.reference, held: true });
      // Whoever has the old number has nothing to do with any of it.
      expect(drivers.canOperate(other.did)).toBe(true);
      expect(drivers.idHoldOf(other.did)).toBeUndefined();
      expect(disputes.against(stranger.personDid, then)).toBeUndefined();
    });

    it('a dispute goes with the account that answers for it, and is never taken by the next account on the number', () => {
      const claimantOn = (reference: string) => stored().find((x) => x.claimant.reference === reference)!.claimant.personDid;
      // Opened by somebody who already had an account: it names that account from the start.
      const phone = aVerifiedNumber();
      const opener = persons.ensurePerson(phone);
      const opened = disputes.open({ register: 'driver', nationalId: aDriver().nationalId, phone }, T0);
      expect(claimantOn(opened.reference)).toBe(opener.personDid);
      // They move on; a week later somebody else is on the number, and moves on from it in their turn.
      persons.movePhone(opener.personDid, aNumber(), 'self', T0);
      persons.settleMove(opener.personDid, T0 + 8 * 24 * 3_600_000);
      const next = persons.ensurePerson(phone);
      persons.movePhone(next.personDid, aNumber(), 'self', T0 + 9 * 24 * 3_600_000);
      expect(claimantOn(opened.reference)).toBe(opener.personDid);

      // Opened from a number nobody had an account on: it names nobody, until the account that came to it moves on.
      const o2 = open(aDriver().nationalId);
      expect(claimantOn(o2.reference)).toBeUndefined();
      const later = persons.ensurePerson(o2.phone);
      persons.movePhone(later.personDid, aNumber(), 'self', T0);
      expect(claimantOn(o2.reference)).toBe(later.personDid);
    });

    it('where nobody came, or what was seen changes nothing, the decision stands — and that is final too', () => {
      const d = aDriver();
      const o = wonByClaimant(d);
      const day = dayStr(o.at + 2 * DAY);
      appoint(o.holderReference, day, o.at);
      const then = Date.parse(day + 'T12:00:00.000Z');
      disputes.check(o.disputeId, AMINA, { to: 'claimant', what: 'Nobody came.', reason: 'You made an appointment and did not come.', claimantCame: false, holderCame: false }, then);
      expect(disputes.sendBack(o.disputeId, BRIAN, 'They rang: they are on their way.', then).state).toBe('appointment');
      disputes.check(o.disputeId, BRIAN, { to: 'claimant', what: 'Still nobody.', reason: 'You made an appointment and did not come.', claimantCame: false, holderCame: false }, then);
      expect(disputes.approve(o.disputeId, AMINA, then)).toMatchObject({ state: 'final', finalTo: 'claimant', holderEffect: 'held' });
      expect(drivers.canOperate(d.did)).toBe(false);
      expect(disputes.status(o.holderReference, then)).toMatchObject({ state: 'final', yours: false, held: true, reason: 'You made an appointment and did not come.' });
      expect(disputes.against(d.personDid, then)).toMatchObject({ state: 'final', held: true });
    });
  });
});
