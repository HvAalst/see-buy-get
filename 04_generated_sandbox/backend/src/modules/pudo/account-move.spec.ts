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

import { AccountMoveService, countryOfPhone, normalizeReference } from './account-move.service';
import { MOVE_ASKS_PER_DAY, MOVE_LAPSES_AFTER_DAYS } from './account-move.types';
import { ContactCardService } from './contact-card.service';

/**
 * TWO MEMBERS OF STAFF MOVE AN ACCOUNT — on the real person, driver, code, notification and mail services.
 *
 * The user, 2026-10-01: "2 seebuyget staff can move an account." It is for the person with no number, no PIN and no
 * inbox they can read — and it is exactly what somebody after another person's account would ask for. So most of
 * what is proved here is what STOPS it: that asking tells a stranger nothing, that the holder hears of it at once and
 * can end it by being who they are, that one member of staff is never two, and that the move can still be undone.
 */
describe('two members of staff move an account', () => {
  let persons: PersonService;
  let drivers: DriverService;
  let managers: FleetManagerService;
  let otp: OtpService;
  let recovery: AccountRecoveryService;
  let moves: AccountMoveService;
  let auth: AuthService;
  let notifications: NotificationService;
  let outbox: OutboxMailSender;
  let vault: IdentityVault;
  let entities: EntityService;
  let contacts: ContactCardService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        PersonService, AccountService, OtpService, AuthService, EmailCodeService, AccountRecoveryService, AccountMoveService, ContactCardService,
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
    managers = moduleRef.get(FleetManagerService);
    otp = moduleRef.get(OtpService);
    recovery = moduleRef.get(AccountRecoveryService);
    moves = moduleRef.get(AccountMoveService);
    auth = moduleRef.get(AuthService);
    notifications = moduleRef.get(NotificationService);
    outbox = moduleRef.get(OutboxMailSender);
    vault = moduleRef.get(IdentityVault);
    entities = moduleRef.get(EntityService);
    contacts = moduleRef.get(ContactCardService);
    recovery.onModuleInit();
  });
  afterEach(() => recovery.onModuleDestroy());

  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };
  let seq = 0;
  const PIN = '48261';
  const AMINA = { name: 'Amina Otieno', key: 'staff:amina' };
  const BRIAN = { name: 'Brian Kamau', key: 'staff:brian' };
  const DAY = 86_400_000;

  /** The account has existed for a while: its PIN was chosen, and last used, yesterday — not in the instant of this test. */
  function sinceYesterday(personDid: string) {
    const person = persons.requireByDid(personDid);
    const yesterday = new Date(Date.now() - DAY).toISOString();
    person.pinChangedAt = yesterday;
    person.pinUsedAt = yesterday;
    (persons as unknown as { save(p: unknown): void }).save(person);
  }
  function aFleet() {
    seq += 1;
    const m = managers.register({ companyName: 'Kilima Haulage ' + seq, contactPhone: '+25480066' + seq + '0', ownerFullName: 'O O', ownerNationalId: 'MGR-AM-' + seq, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: 'BRN-AM-' + seq, transportOperatorLicence: 'TOL-AM-' + seq, taxId: 'TAX-AM-' + seq } });
    managers.submitKyc(m.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'a' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    return m.did;
  }
  /** A driver with a PIN and a confirmed email. */
  function aDriver(managerDid?: string) {
    seq += 1;
    const phone = '+2547440' + String(seq).padStart(5, '0');
    const nationalId = 'ID-AM-' + seq;
    const email = 'mover' + seq + '@example.com';
    const d = drivers.register({ displayName: 'Rider ' + seq, fullName: 'R ' + seq, nationalId, mobile: phone, licenceClasses: ['bike'], ...(managerDid ? { managerDid } : {}) });
    const person = persons.attachRole(phone, 'driver', d.did, managerDid);
    persons.setPin(person.personDid, PIN);
    persons.setEmail(person.personDid, email);
    sinceYesterday(person.personDid);
    return { did: d.did, personDid: person.personDid, phone, nationalId, email };
  }
  /** Somebody who only sends and collects parcels: no ID on record, no name outside the vault. */
  function aSender() {
    seq += 1;
    const phone = '+2547550' + String(seq).padStart(5, '0');
    const person = persons.ensurePerson(phone);
    persons.setPin(person.personDid, PIN);
    sinceYesterday(person.personDid);
    return { personDid: person.personDid, phone };
  }
  const aNumber = () => '+2547660' + String((seq += 1)).padStart(5, '0');
  /** A fresh number, confirmed by a code as the app would. */
  function aVerifiedNumber() {
    const phone = aNumber();
    otp.verify(phone, otp.request(phone).code);
    return phone;
  }
  /** The same number confirmed again, a minute later — which is how long one waits for a second code. */
  const again = (phone: string) => {
    (otp as unknown as { rates: Map<string, unknown> }).rates.clear();
    return otp.verify(phone, otp.request(phone).code);
  };
  const about = (m: { subject: string }, words: string) => m.subject.toLowerCase().includes(words.toLowerCase());
  const mailTo = (address: string) => outbox.recent(address).filter((m) => m.template === 'account-safety');
  const stored = () => [...(moves as unknown as { moves: Map<string, Record<string, unknown>> }).moves.values()];
  const idOf = (reference: string) => stored().find((m) => m.reference === reference)!.moveId as string;
  const failure = (fn: () => unknown) => {
    try {
      fn();
      return 'DID NOT REFUSE';
    } catch (e) {
      return (e as { code?: string }).code + ': ' + (e as Error).message;
    }
  };
  /** Asked a minute ago — so anything the account does "now" is after it. */
  const askFor = (who: { phone: string }, over: Partial<{ nationalId: string; note: string }> = {}, at = Date.now() - 60_000) => {
    const newPhone = aVerifiedNumber();
    const asked = moves.ask({ oldPhone: who.phone, newPhone, ...over }, at);
    return { ...asked, newPhone, moveId: idOf(asked.reference), at };
  };

  /* ------------------------------------------------------------------------ asking -- */

  describe('asking', () => {
    it('needs the new number confirmed by a code, and hands back a reference somebody can read down a telephone', () => {
      const d = aDriver();
      const unproved = aNumber();
      expect(failure(() => moves.ask({ oldPhone: d.phone, newPhone: unproved }))).toMatch(/^PHONE_NOT_VERIFIED/);
      const proved = aVerifiedNumber();
      expect(otp.isVerified(proved)).toBe(true);
      const asked = moves.ask({ oldPhone: d.phone, newPhone: proved });
      expect(asked.reference).toMatch(/^MV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(Date.parse(asked.lapsesAt) - Date.now()).toBeGreaterThan(MOVE_LAPSES_AFTER_DAYS * DAY - 5000);
      // The code was for this one asking: the same number cannot be used to ask about ANOTHER account without another code.
      expect(otp.isVerified(proved)).toBe(false);
      expect(failure(() => moves.ask({ oldPhone: aDriver().phone, newPhone: proved }))).toMatch(/^PHONE_NOT_VERIFIED/);
    });

    it('answers the same whether or not the old number has an account — asking tells a stranger nothing', () => {
      const d = aDriver();
      const real = moves.ask({ oldPhone: d.phone, newPhone: aVerifiedNumber() });
      const nobody = moves.ask({ oldPhone: aNumber(), newPhone: aVerifiedNumber() });
      expect(Object.keys(nobody).sort()).toEqual(Object.keys(real).sort());
      expect(nobody.reference).toMatch(/^MV-/);
      // …and the same again when read back with the reference.
      expect(moves.status(nobody.reference)).toEqual({ ...moves.status(real.reference), askedAt: expect.any(String), lapsesAt: expect.any(String) });
      // Staff see that there is nothing behind it; the asker never does.
      expect(moves.one(idOf(nobody.reference))).toMatchObject({ namesAccount: false, state: 'asked' });
      expect(moves.one(idOf(real.reference))).toMatchObject({ namesAccount: true });
    });

    it('refuses a new number that is the old one, is no number, or already has an account of its own', () => {
      const d = aDriver();
      const other = aSender();
      again(d.phone);
      expect(failure(() => moves.ask({ oldPhone: d.phone, newPhone: d.phone }))).toMatch(/^INVALID_STATE: That is the same number/);
      expect(failure(() => moves.ask({ oldPhone: d.phone, newPhone: '12' }))).toMatch(/^PHONE_INVALID/);
      expect(failure(() => moves.ask({ oldPhone: 'x', newPhone: aVerifiedNumber() }))).toMatch(/^PHONE_INVALID/);
      // Said only to somebody who has just proved they hold that number — never before.
      expect(failure(() => moves.ask({ oldPhone: d.phone, newPhone: other.phone }))).toMatch(/^PHONE_NOT_VERIFIED/);
      again(other.phone);
      expect(failure(() => moves.ask({ oldPhone: d.phone, newPhone: other.phone }))).toMatch(/^DUPLICATE: The new number already has an account of its own/);
      expect(stored()).toHaveLength(0);
    });

    it('tells the account’s holder at once, everywhere they read — and nobody when the number names no account', async () => {
      const d = aDriver();
      const asked = askFor(d);
      await settle();
      const ends = asked.newPhone.slice(-3);
      expect(notifications.inboxFor(d.personDid)[0]).toMatchObject({ kind: 'security', title: 'Somebody asked for your account to be moved' });
      expect(notifications.inboxFor(d.did)[0].body).toContain('a number ending ' + ends);
      const [mail] = mailTo(d.email);
      expect(about(mail, 'Somebody asked for your account to be moved')).toBe(true);
      expect(mail.text).toContain('sign in to any SeeBuyGet app with your number and PIN — that alone stops it');
      // No whole number in what is said: the last digits tell them which.
      expect(mail.text).not.toContain(asked.newPhone);
      const before = outbox.recent().length;
      moves.ask({ oldPhone: aNumber(), newPhone: aVerifiedNumber() });
      await settle();
      expect(outbox.recent()).toHaveLength(before);
    });

    it('is one request when asked again with the same two numbers — not a second notice — and is limited for one account in a day', async () => {
      const d = aDriver();
      const t0 = Date.now();
      const first = askFor(d, {}, t0);
      await settle();
      again(first.newPhone);
      expect(moves.ask({ oldPhone: d.phone, newPhone: first.newPhone }, t0 + 1000).reference).toBe(first.reference);
      await settle();
      expect(mailTo(d.email)).toHaveLength(1);
      expect(stored()).toHaveLength(1);
      // Other numbers are other requests, each a notice — so there is a limit to them.
      for (let i = 1; i < MOVE_ASKS_PER_DAY; i++) moves.ask({ oldPhone: d.phone, newPhone: aVerifiedNumber() }, t0 + i * 1000);
      expect(failure(() => moves.ask({ oldPhone: d.phone, newPhone: aVerifiedNumber() }, t0 + 60_000))).toMatch(/^RATE_LIMITED/);
      expect(stored()).toHaveLength(MOVE_ASKS_PER_DAY);
      // A day after the first, one more may be asked.
      expect(moves.ask({ oldPhone: d.phone, newPhone: aVerifiedNumber() }, t0 + DAY + 1).reference).toMatch(/^MV-/);
      // Another account is not held to this one's limit.
      expect(askFor(aDriver(), {}, t0).reference).toMatch(/^MV-/);
    });

    it('keeps no whole phone number and no national ID — keys, last digits, and whether the ID was the right one', () => {
      const d = aDriver();
      const sender = aSender();
      const right = askFor(d, { nationalId: ' ' + d.nationalId + ' ', note: '  My phone was stolen in Gikomba.  ' });
      const wrong = askFor(aDriver(), { nationalId: 'ID-SOMEBODY-ELSE' });
      const none = askFor(sender, { nationalId: 'ID-ANYTHING' });
      const unsaid = askFor(aDriver());
      const kept = JSON.stringify(stored());
      for (const secret of [d.phone, right.newPhone, d.nationalId, 'ID-SOMEBODY-ELSE', 'ID-ANYTHING', sender.phone]) expect(kept).not.toContain(secret);
      expect(moves.one(right.moveId)).toMatchObject({ nationalId: 'matches', oldEnds: d.phone.slice(-3), newEnds: right.newPhone.slice(-3), note: 'My phone was stolen in Gikomba.' });
      expect(moves.one(wrong.moveId).nationalId).toBe('differs');
      expect(moves.one(none.moveId).nationalId).toBe('none_on_record');
      expect(moves.one(unsaid.moveId).nationalId).toBeUndefined();
      // The new number is in the vault while the request waits — and nowhere a reader of the store can see.
      expect(vault.reveal(stored()[0].newVaultRef as string, { purpose: 'test', requesterDid: 'test' }).phone).toBe(right.newPhone);
    });

    it('is read back with the reference as somebody types it — and a reference nobody was given is not found', () => {
      const asked = askFor(aDriver());
      const bare = asked.reference.replace(/[^A-Z0-9]/g, '').slice(2);
      for (const typed of [asked.reference, asked.reference.toLowerCase(), ' ' + bare + ' ', 'mv ' + bare.slice(0, 4) + ' ' + bare.slice(4)]) expect(moves.status(typed).state).toBe('asked');
      expect(normalizeReference('mv-abcd-2345')).toBe('ABCD2345');
      expect(failure(() => moves.status('MV-AAAA-AAAA'))).toMatch(/^NOT_FOUND/);
      expect(failure(() => moves.status(''))).toMatch(/^NOT_FOUND/);
      // What it says: where it stands, and until when. Not whose account, and not which numbers.
      expect(Object.keys(moves.status(asked.reference)).sort()).toEqual(['askedAt', 'lapsesAt', 'state']);
    });

    it('says who to speak to: the company that answers for the country the old number is in, as it wrote its own entry', () => {
      const kenya = entities.forJurisdiction('KE')!;
      const d = aDriver();
      expect(askFor(d).support).toBeUndefined();
      contacts.set(kenya.entityId, { contactName: 'The help desk', phone: '+254 20 555 0100', email: 'help@sbg-ke.example', hours: 'Mon–Sat 8–18' }, 'Amina Otieno');
      const asked = askFor(aDriver());
      expect(asked.support).toEqual({ company: kenya.name, contactName: 'The help desk', phone: '+254 20 555 0100', email: 'help@sbg-ke.example', hours: 'Mon–Sat 8–18' });
      expect(moves.status(asked.reference).support).toEqual(asked.support);
      expect(countryOfPhone('+254700000001')).toBe('KE');
      expect(countryOfPhone('+251911000001')).toBe('ET');
      // A number in a country with no company of ours is given nobody: there is nobody.
      const elsewhere = '+4479460' + String((seq += 1)).padStart(5, '0');
      expect(moves.ask({ oldPhone: elsewhere, newPhone: aVerifiedNumber() }).support).toBeUndefined();
    });
  });

  /* ------------------------------------------------------------------------- staff -- */

  describe('staff', () => {
    it('one checks who is asking, a second approves — and the account is on the new number, every session ended', async () => {
      const fleet = aFleet();
      const d = aDriver(fleet);
      const session = auth.mintActorToken({ role: 'driver', did: d.did, revocationKey: d.personDid, personDid: d.personDid });
      const asked = askFor(d, { nationalId: d.nationalId });

      const checked = moves.check(asked.moveId, AMINA, ' Saw their national ID card at the Nairobi office; the number on it matches. ');
      expect(checked).toMatchObject({ state: 'checked', checkedBy: 'Amina Otieno', checkedWhat: 'Saw their national ID card at the Nairobi office; the number on it matches.', checkedByYou: true });
      // Checking moves nothing.
      const theirPhone = persons.trustDevice(d.phone); // the device the holder has been signing in on
      expect(persons.loginWithPin(d.phone, PIN, theirPhone).person.personDid).toBe(d.personDid);
      // (…and that sign-in is itself after the asking, so the request is made again for the rest of this test.)
      moves.refuse(asked.moveId, AMINA, 'Asked again for the test');
      const fresh = askFor(d, {}, Date.now() + 1000);
      moves.check(fresh.moveId, AMINA, 'Saw the ID card', Date.now() + 2000);

      const moved = moves.approve(fresh.moveId, BRIAN, Date.now() + 3000);
      expect(moved).toMatchObject({ state: 'moved', decidedBy: 'Brian Kamau', checkedBy: 'Amina Otieno' });
      expect(moved.checkedByYou).toBeUndefined();
      expect(persons.findByPhone(fresh.newPhone)?.personDid).toBe(d.personDid);
      expect(persons.findByPhone(d.phone)).toBeUndefined();
      // NO DEVICE WENT WITH THE NUMBER. The device that signed in on the old number opens nothing — not the old
      // number, which nobody has, and not the new one: the PIN works again on a device a code to the NEW number confirmed.
      expect(failure(() => persons.loginWithPin(d.phone, PIN, theirPhone))).toMatch(/^DEVICE_NOT_KNOWN/);
      expect(failure(() => persons.loginWithPin(fresh.newPhone, PIN, theirPhone))).toMatch(/^DEVICE_NOT_KNOWN/);
      expect(persons.loginWithPin(fresh.newPhone, PIN, persons.trustDevice(fresh.newPhone)).person.personDid).toBe(d.personDid);
      expect(auth.introspect(session.access_token)).toMatchObject({ active: false, reason: 'revoked' });
      expect(drivers.get(d.did).did).toBe(d.did);
      expect(moves.status(fresh.reference)).toEqual({ state: 'moved', askedAt: expect.any(String), decidedAt: expect.any(String) });
      expect(JSON.stringify(moves.status(fresh.reference))).not.toMatch(/Brian|Amina|Kamau|Otieno/);

      // The holder is told, in staff's own words, with how to undo it — and their fleet's office hears too.
      await settle();
      const mail = mailTo(d.email).find((m) => about(m, 'Your phone number was changed'))!;
      expect(mail.text).toContain('Two members of SeeBuyGet staff moved your account to a new phone number');
      expect(mail.text).toContain('Undo a number change');
      expect(notifications.inboxFor(fleet)[0].title).toMatch(/changed the phone number they sign in with/);
    });

    it('can be undone for 24 hours by whoever holds the old number and the PIN as it was — staff’s doing or not', () => {
      const d = aDriver();
      const t0 = Date.now() + 1000;
      const asked = askFor(d, {}, t0);
      moves.check(asked.moveId, AMINA, 'Saw the ID card', t0 + 1000);
      moves.approve(asked.moveId, BRIAN, t0 + 2000);
      // Whoever was given the account chooses a PIN of their own…
      persons.setPin(d.personDid, '73914');
      // …and the person it was taken from still has the number and the PIN it had.
      recovery.undoWithOldNumber(d.phone, PIN, t0 + 3000);
      expect(persons.findByPhone(d.phone)?.personDid).toBe(d.personDid);
      expect(persons.findByPhone(asked.newPhone)).toBeUndefined();
      expect(persons.requireByDid(d.personDid).phoneChange).toBeUndefined();
    });

    it('is never one member of staff twice, and never approved before it was checked', () => {
      const d = aDriver();
      const t0 = Date.now() + 1000;
      const asked = askFor(d, {}, t0);
      expect(failure(() => moves.approve(asked.moveId, BRIAN, t0 + 1))).toMatch(/^INVALID_STATE: Nobody has checked who is asking yet/);
      expect(failure(() => moves.check(asked.moveId, AMINA, '   ', t0 + 2))).toMatch(/^FIELD_REQUIRED/);
      moves.check(asked.moveId, AMINA, 'Saw the ID card', t0 + 3);
      expect(failure(() => moves.check(asked.moveId, BRIAN, 'Again', t0 + 4))).toMatch(/^INVALID_STATE: This has already been checked/);
      expect(failure(() => moves.approve(asked.moveId, AMINA, t0 + 5))).toMatch(/^CONFLICT: A second member of staff has to approve/);
      // The same person under another name is still the same key.
      expect(failure(() => moves.approve(asked.moveId, { name: 'A. Otieno', key: AMINA.key }, t0 + 6))).toMatch(/^CONFLICT/);
      expect(persons.findByPhone(d.phone)?.personDid).toBe(d.personDid);
      expect(moves.approve(asked.moveId, BRIAN, t0 + 7).state).toBe('moved');
      // Over is over: nothing more can be done to it.
      for (const act of [() => moves.approve(asked.moveId, BRIAN, t0 + 8), () => moves.check(asked.moveId, AMINA, 'x', t0 + 8), () => moves.refuse(asked.moveId, BRIAN, 'x', t0 + 8)]) expect(failure(act)).toMatch(/^INVALID_STATE: This request is over/);
      expect(failure(() => moves.one('mv_nothing'))).toMatch(/^NOT_FOUND/);
    });

    it('cannot check a request whose number names no account: there is nothing to move, and it can only be refused', () => {
      const asked = moves.ask({ oldPhone: aNumber(), newPhone: aVerifiedNumber() });
      const id = idOf(asked.reference);
      expect(failure(() => moves.check(id, AMINA, 'Saw an ID'))).toMatch(/^INVALID_STATE: The old number names no account/);
      expect(moves.refuse(id, AMINA, 'We could not confirm that this account is yours. Bring your ID to an office.').state).toBe('refused');
      expect(moves.status(asked.reference)).toMatchObject({ state: 'refused', reason: 'We could not confirm that this account is yours. Bring your ID to an office.' });
    });

    it('is refused by either of them, at either step, with a reason the asker reads — and the holder is told nothing changed', async () => {
      const d = aDriver();
      const t0 = Date.now() + 1000;
      const first = askFor(d, {}, t0);
      expect(failure(() => moves.refuse(first.moveId, AMINA, ' ', t0 + 1))).toMatch(/^FIELD_REQUIRED/);
      expect(Object.keys(moves.status(first.reference, t0 + 1)).sort()).toEqual(['askedAt', 'lapsesAt', 'state']);
      expect(moves.refuse(first.moveId, AMINA, 'The ID you showed is not the one this account registered with.', t0 + 2)).toMatchObject({ state: 'refused', decidedBy: 'Amina Otieno', reason: 'The ID you showed is not the one this account registered with.' });
      const second = askFor(d, {}, t0 + 10);
      moves.check(second.moveId, AMINA, 'Saw the ID card', t0 + 11);
      // The one who checked may still refuse it; so may the other.
      expect(moves.refuse(second.moveId, AMINA, 'On a second look the photograph is not theirs.', t0 + 12).state).toBe('refused');
      expect(persons.findByPhone(d.phone)?.personDid).toBe(d.personDid);
      await settle();
      const told = mailTo(d.email).filter((m) => about(m, 'The request to move your account was refused'));
      expect(told).toHaveLength(2);
      expect(told[0].text).toContain('Nothing about your account has changed');
      // The reason is for whoever asked; it is not sent to the holder, who may be somebody else.
      expect(told[0].text).not.toContain('photograph');
    });

    it('blanks the new number the moment a request is over, however it ended', () => {
      const d = aDriver();
      const t0 = Date.now() + 1000;
      const phoneOf = (moveId: string) => vault.reveal(stored().find((m) => m.moveId === moveId)!.newVaultRef as string, { purpose: 'test', requesterDid: 'test' }).phone;
      const refused = askFor(d, {}, t0);
      expect(phoneOf(refused.moveId)).toBe(refused.newPhone);
      moves.refuse(refused.moveId, AMINA, 'No', t0 + 1);
      const stopped = askFor(d, {}, t0 + 2);
      moves.stop(d.personDid, t0 + 3);
      const lapsed = askFor(aDriver(), {}, t0);
      moves.list(undefined, t0 + MOVE_LAPSES_AFTER_DAYS * DAY);
      const moved = askFor(d, {}, t0 + 4);
      moves.check(moved.moveId, AMINA, 'Saw the ID card', t0 + 5);
      moves.approve(moved.moveId, BRIAN, t0 + 6);
      for (const m of [refused, stopped, lapsed, moved]) expect(phoneOf(m.moveId)).toBeUndefined();
    });

    it('shows staff what there is to check the asker against — and says so when there is nothing', () => {
      const fleet = aFleet();
      const d = aDriver(fleet);
      const sender = aSender();
      const forDriver = moves.one(askFor(d).moveId);
      expect(forDriver.account).toMatchObject({ hasPin: true, nationalIdOnRecord: true, roles: [{ role: 'driver', name: drivers.get(d.did).displayName, with: managers.get(fleet).companyName }] });
      // The recovery email, masked: they said they cannot read it, and staff can ask which address it was.
      expect(forDriver.account!.email).toMatch(/@example\.com$/);
      expect(forDriver.account!.email).not.toBe(d.email);
      const forSender = moves.one(askFor(sender).moveId);
      expect(forSender.account).toMatchObject({ hasPin: true, nationalIdOnRecord: false, roles: [] });
      expect(forSender.account!.email).toBeUndefined();
      // Never a whole number, in a row or in a list.
      const shown = JSON.stringify([forDriver, forSender, moves.list()]);
      for (const phone of [d.phone, sender.phone]) expect(shown).not.toContain(phone);
      // The list does not carry the account: that is read one request at a time.
      expect(moves.list().items[0].account).toBeUndefined();
    });

    it('lists what waits on somebody first, oldest first — and says which ones the reader checked', () => {
      const t0 = Date.now() + 1000;
      const a = askFor(aDriver(), {}, t0);
      const b = askFor(aDriver(), {}, t0 + 1000);
      const c = askFor(aDriver(), {}, t0 + 2000);
      moves.refuse(a.moveId, AMINA, 'No', t0 + 3000);
      moves.check(c.moveId, AMINA, 'Saw the ID card', t0 + 4000);
      const list = moves.list(AMINA, t0 + 5000);
      expect(list.waiting).toBe(2);
      expect(list.items.map((m) => [m.reference, m.state, m.checkedByYou])).toEqual([[b.reference, 'asked', undefined], [c.reference, 'checked', true], [a.reference, 'refused', undefined]]);
      expect(moves.list(BRIAN, t0 + 5000).items[1].checkedByYou).toBeUndefined();
    });
  });

  /* ------------------------------------------------------------- the account's holder -- */

  describe('the account’s holder', () => {
    it('is shown the request against their own account, and ends it by saying no — signed in, which the asker said they could not be', () => {
      const d = aDriver();
      const other = aDriver();
      const t0 = Date.now() + 1000;
      expect(moves.openAgainst(d.personDid, t0)).toBeUndefined();
      const asked = askFor(d, {}, t0);
      expect(moves.openAgainst(d.personDid, t0 + 1)).toEqual({ askedAt: new Date(t0).toISOString(), toEnds: asked.newPhone.slice(-3) });
      expect(moves.openAgainst(other.personDid, t0 + 1)).toBeUndefined();
      moves.check(asked.moveId, AMINA, 'Saw the ID card', t0 + 2);
      // Somebody else saying no ends nothing of this one's.
      expect(moves.stop(other.personDid, t0 + 3)).toBe(0);
      expect(moves.openAgainst(d.personDid, t0 + 3)).toBeDefined();

      expect(moves.stop(d.personDid, t0 + 4)).toBe(1);
      expect(moves.one(asked.moveId)).toMatchObject({ state: 'stopped', stoppedBy: 'holder' });
      expect(moves.openAgainst(d.personDid, t0 + 5)).toBeUndefined();
      expect(failure(() => moves.approve(asked.moveId, BRIAN, t0 + 6))).toMatch(/^INVALID_STATE: This request is over/);
      expect(persons.findByPhone(d.phone)?.personDid).toBe(d.personDid);
      expect(moves.status(asked.reference)).toEqual({ state: 'stopped', askedAt: expect.any(String), decidedAt: expect.any(String) });
      expect(moves.stop(d.personDid, t0 + 7)).toBe(0);
    });

    it('ends it by using the PIN — the one thing the asker said they could not do — and the second member of staff is told why', () => {
      const d = aDriver();
      const asked = askFor(d);
      moves.check(asked.moveId, AMINA, 'Saw the ID card', asked.at + 1000);
      expect(moves.one(asked.moveId).account!.pinUsedSince).toBeUndefined();
      // A wrong PIN is not the holder: it is anybody.
      expect(failure(() => persons.loginWithPin(d.phone, '00000', persons.trustDevice(d.phone)))).toMatch(/^AUTH_FAILED/);
      expect(moves.one(asked.moveId).account!.pinUsedSince).toBeUndefined();

      persons.loginWithPin(d.phone, PIN, persons.trustDevice(d.phone));
      // Staff see it before they press anything…
      expect(moves.one(asked.moveId).account!.pinUsedSince).toEqual(expect.any(String));
      // …and pressing it ends the request instead of moving the account.
      expect(failure(() => moves.approve(asked.moveId, BRIAN))).toMatch(/^CONFLICT: This account’s PIN was used after the request was made/);
      expect(moves.one(asked.moveId)).toMatchObject({ state: 'stopped', stoppedBy: 'pin' });
      expect(persons.findByPhone(d.phone)?.personDid).toBe(d.personDid);
      expect(persons.findByPhone(asked.newPhone)).toBeUndefined();
    });

    it('ends it at the first member of staff’s check too, and when the PIN is asked again inside an app or chosen again by a code', () => {
      const inApp = aDriver();
      const a = askFor(inApp);
      persons.confirmPin(inApp.personDid, PIN);
      expect(failure(() => moves.check(a.moveId, AMINA, 'Saw the ID card'))).toMatch(/^CONFLICT/);
      expect(moves.one(a.moveId)).toMatchObject({ state: 'stopped', stoppedBy: 'pin' });

      const reset = aDriver();
      const b = askFor(reset);
      moves.check(b.moveId, AMINA, 'Saw the ID card', b.at + 1000);
      persons.setPin(reset.personDid, '73914');
      expect(failure(() => moves.approve(b.moveId, BRIAN))).toMatch(/^CONFLICT/);
      expect(moves.one(b.moveId).state).toBe('stopped');
    });

    it('is not stopped by a PIN that was used BEFORE it was asked: that is an ordinary yesterday', () => {
      const d = aDriver();
      persons.loginWithPin(d.phone, PIN, persons.trustDevice(d.phone));
      const t0 = Date.now() + 5000;
      const asked = askFor(d, {}, t0);
      moves.check(asked.moveId, AMINA, 'Saw the ID card', t0 + 1000);
      expect(moves.one(asked.moveId).account!.pinUsedSince).toBeUndefined();
      expect(moves.approve(asked.moveId, BRIAN, t0 + 2000).state).toBe('moved');
    });
  });

  /* ------------------------------------------------------------------------ it ends -- */

  describe('a request nobody decides', () => {
    it('lapses after its days — to the millisecond — and is then over for everybody', () => {
      const d = aDriver();
      const t0 = Date.now() + 1000;
      const asked = askFor(d, {}, t0);
      moves.check(asked.moveId, AMINA, 'Saw the ID card', t0 + 1000);
      const end = t0 + MOVE_LAPSES_AFTER_DAYS * DAY;
      expect(moves.list(undefined, end - 1).waiting).toBe(1);
      expect(moves.openAgainst(d.personDid, end - 1)).toBeDefined();
      expect(moves.list(undefined, end).waiting).toBe(0);
      expect(moves.status(asked.reference, end)).toMatchObject({ state: 'lapsed' });
      expect(moves.status(asked.reference, end).lapsesAt).toBeUndefined();
      expect(moves.openAgainst(d.personDid, end)).toBeUndefined();
      expect(failure(() => moves.approve(asked.moveId, BRIAN, end))).toMatch(/^INVALID_STATE: This request is over/);
      expect(persons.findByPhone(d.phone)?.personDid).toBe(d.personDid);
      // The same two numbers may be asked about again afterwards: it is a new request.
      again(asked.newPhone);
      expect(moves.ask({ oldPhone: d.phone, newPhone: asked.newPhone }, end + 1).reference).not.toBe(asked.reference);
    });

    it('never rewrites what WAS decided: moved, refused and stopped stay so long after the date they would have lapsed', () => {
      const t0 = Date.now() + 1000;
      const moved = askFor(aDriver(), {}, t0);
      moves.check(moved.moveId, AMINA, 'Saw the ID card', t0 + 1);
      moves.approve(moved.moveId, BRIAN, t0 + 2);
      const refused = askFor(aDriver(), {}, t0);
      moves.refuse(refused.moveId, AMINA, 'No', t0 + 3);
      const holder = aDriver();
      const stopped = askFor(holder, {}, t0);
      moves.stop(holder.personDid, t0 + 4);
      const later = t0 + 10 * MOVE_LAPSES_AFTER_DAYS * DAY;
      expect(moves.list(undefined, later).items.map((m) => m.state).sort()).toEqual(['moved', 'refused', 'stopped']);
      expect([moves.status(moved.reference, later).state, moves.status(refused.reference, later).state, moves.status(stopped.reference, later).state]).toEqual(['moved', 'refused', 'stopped']);
      // …with who decided it, and when, as they were.
      expect(moves.one(moved.moveId, undefined, later)).toMatchObject({ state: 'moved', decidedBy: 'Brian Kamau', decidedAt: new Date(t0 + 2).toISOString() });
    });

    it('approved a millisecond before it would lapse, is approved', () => {
      const d = aDriver();
      const t0 = Date.now() + 1000;
      const asked = askFor(d, {}, t0);
      moves.check(asked.moveId, AMINA, 'Saw the ID card', t0 + 1000);
      expect(moves.approve(asked.moveId, BRIAN, t0 + MOVE_LAPSES_AFTER_DAYS * DAY - 1).state).toBe('moved');
    });
  });
});
