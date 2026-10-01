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
import { AccountRecoveryService, MAX_RECOVERY_MISSES } from './account-recovery.service';
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

/**
 * GETTING BACK INTO AN ACCOUNT, AND KEEPING SOMEBODY ELSE OUT OF IT — on the real services, the real inbox and
 * the real mail outbox.
 *
 * The user's decisions (2026-10-01): somebody who still knows their PIN moves their own account to a new number;
 * every account has a confirmed email that is told what happens, can undo a number change and can recover the
 * account when the number is gone; a move can be undone for 24 hours, and the old number is then free for a new
 * person.
 */
describe('account recovery', () => {
  let persons: PersonService;
  let drivers: DriverService;
  let managers: FleetManagerService;
  let otp: OtpService;
  let codes: EmailCodeService;
  let recovery: AccountRecoveryService;
  let auth: AuthService;
  let notifications: NotificationService;
  let outbox: OutboxMailSender;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        PersonService, AccountService, OtpService, AuthService, EmailCodeService, AccountRecoveryService,
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
    codes = moduleRef.get(EmailCodeService);
    recovery = moduleRef.get(AccountRecoveryService);
    auth = moduleRef.get(AuthService);
    notifications = moduleRef.get(NotificationService);
    outbox = moduleRef.get(OutboxMailSender);
    recovery.onModuleInit(); // compile() runs no lifecycle hooks: the PIN-lock email is subscribed here
  });

  afterEach(() => recovery.onModuleDestroy());

  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  let seq = 0;
  const PIN = '4826';
  /** A fleet, so a driver's office can be told. */
  function aFleet() {
    seq += 1;
    const m = managers.register({ companyName: `Recovery Haulage ${seq}`, contactPhone: `+25480055${seq}0`, ownerFullName: 'O O', ownerNationalId: `MGR-RC-${seq}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-RC-${seq}`, transportOperatorLicence: `TOL-RC-${seq}`, taxId: `TAX-RC-${seq}` } });
    managers.submitKyc(m.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'a' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    return m.did;
  }
  /** A driver with a PIN and a confirmed email — as somebody who registered after launch stands. */
  function aDriver(managerDid?: string) {
    seq += 1;
    const phone = `+2547220${String(seq).padStart(5, '0')}`;
    const nationalId = `ID-RC-${seq}`;
    const email = `driver${seq}@example.com`;
    const d = drivers.register({ displayName: `Rider ${seq}`, fullName: `R ${seq}`, nationalId, mobile: phone, licenceClasses: ['bike'], ...(managerDid ? { managerDid } : {}) });
    const person = persons.attachRole(phone, 'driver', d.did, managerDid);
    persons.setPin(person.personDid, PIN);
    persons.setEmail(person.personDid, email);
    return { did: d.did, personDid: person.personDid, phone, nationalId, email };
  }
  /** A fresh number, confirmed by a code as the app would. */
  function aVerifiedNumber() {
    seq += 1;
    const phone = `+2547330${String(seq).padStart(5, '0')}`;
    otp.verify(phone, otp.request(phone).code);
    return phone;
  }
  const mailTo = (address: string, template = 'account-safety') => outbox.recent(address).filter((m) => m.template === template);

  /* ------------------------------------------------------------------ still know your PIN -- */

  describe('somebody who still knows their PIN moves their own account', () => {
    it('needs the PIN again and a code on the new number — then the new number signs in and the old one does not', () => {
      const d = aDriver();
      const fresh = aVerifiedNumber();
      expect(() => recovery.changeNumber(d.personDid, '0000', fresh)).toThrow(/That is not your PIN/);
      expect(() => recovery.changeNumber(d.personDid, PIN, '+254733999999')).toThrow(/Verify the new number first/);

      const session = auth.mintActorToken({ role: 'driver', did: d.did, revocationKey: d.personDid, personDid: d.personDid });
      const moved = recovery.changeNumber(d.personDid, PIN, fresh);
      expect(moved.personDid).toBe(d.personDid); // the same person, every role and all their history with them
      expect(persons.loginWithPin(fresh, PIN).person.personDid).toBe(d.personDid);
      expect(() => persons.loginWithPin(d.phone, PIN)).toThrow(/Wrong phone or PIN/);
      expect(auth.introspect(session.access_token)).toMatchObject({ active: false, reason: 'revoked' });
    });

    it('holds the old number for 24 hours, then frees it for a new person', () => {
      const d = aDriver();
      const t0 = Date.now();
      recovery.changeNumber(d.personDid, PIN, aVerifiedNumber(), t0);
      const newcomer = { displayName: 'New', fullName: 'New Holder', nationalId: 'ID-RC-NEWCOMER', mobile: d.phone, licenceClasses: ['bike'] as never };
      // Inside the window the number is still its old owner's to take back: not a driver's, not a person's.
      expect(() => drivers.register(newcomer)).toThrow(/mobile already exists/);
      expect(() => persons.ensurePerson(d.phone)).toThrow(/moved off another account in the last 24 hours/);
      expect(recovery.settle(t0 + NUMBER_UNDO_MS - 1000)).toBe(0);

      expect(recovery.settle(t0 + NUMBER_UNDO_MS + 1)).toBe(1);
      expect(drivers.register(newcomer).did).not.toBe(d.did);
      expect(persons.requireByDid(d.personDid).phoneChange).toBeUndefined();
    });

    it('refuses a number another account or another driver already holds, and moves nothing', () => {
      const d = aDriver();
      const other = aDriver();
      otp.verify(other.phone, otp.request(other.phone).code);
      expect(() => recovery.changeNumber(d.personDid, PIN, other.phone)).toThrow(/already/);
      expect(persons.loginWithPin(d.phone, PIN).person.personDid).toBe(d.personDid);
    });

    it('refuses a number a driver is REGISTERED on even when no account holds it yet — asked before anything moves', () => {
      const d = aDriver();
      // Registered by a fleet, never signed in: the register holds the number, the identity spine has never seen it.
      const taken = aVerifiedNumber();
      drivers.register({ displayName: 'Waiting', fullName: 'W W', nationalId: 'ID-RC-WAITING', mobile: taken, licenceClasses: ['bike'] });
      expect(() => recovery.changeNumber(d.personDid, PIN, taken)).toThrow(/already/);
      // Nothing moved: not the person, not the driver record.
      expect(persons.loginWithPin(d.phone, PIN).person.personDid).toBe(d.personDid);
      expect(persons.requireByDid(d.personDid).phoneChange).toBeUndefined();
    });

    it('will not move onto a number that is being held for the person who just left it', () => {
      const sender = (email: string) => {
        const phone = aVerifiedNumber();
        const person = persons.enroll(phone, true, PIN).person;
        persons.setEmail(person.personDid, email);
        return { phone, personDid: person.personDid };
      };
      const first = sender('held-first@example.com');
      const second = sender('held-second@example.com');
      recovery.changeNumber(first.personDid, PIN, aVerifiedNumber());
      // The old number is the first person's to take back for 24 hours; nobody else's account may land on it.
      // (Its code-proof from sign-up still stands in this test, so the refusal below is about the hold and nothing else.)
      expect(otp.isVerified(first.phone)).toBe(true);
      expect(() => recovery.changeNumber(second.personDid, PIN, first.phone)).toThrow(/moved off another account in the last 24 hours/);
      expect(recovery.undoWithOldNumber(first.phone, PIN).personDid).toBe(first.personDid);
    });

    it('tells the person in the app and by email, and tells their fleet — with how to undo it', async () => {
      const fleet = aFleet();
      const d = aDriver(fleet);
      recovery.changeNumber(d.personDid, PIN, aVerifiedNumber());
      await settle();
      const [mail] = mailTo(d.email);
      expect(mail.subject).toMatch(/your phone number was changed/);
      expect(mail.text).toContain('Undo a number change');
      expect(notifications.inboxFor(d.did)[0]).toMatchObject({ kind: 'security', title: 'Your phone number was changed' });
      expect(notifications.inboxFor(fleet)[0].title).toMatch(/changed the phone number they sign in with/);
    });
  });

  /* ------------------------------------------------------------------ undoing it -- */

  describe('a number change can be undone for 24 hours', () => {
    it('with the OLD number and the PIN as it was — even after the mover changed the PIN', () => {
      const d = aDriver();
      const theirs = aVerifiedNumber();
      recovery.changeNumber(d.personDid, PIN, theirs);
      persons.setPin(d.personDid, '7391'); // the colleague who knew the PIN makes it their own

      expect(() => recovery.undoWithOldNumber(d.phone, '7391')).toThrow(/Wrong phone or PIN/);
      const back = recovery.undoWithOldNumber(d.phone, PIN);
      expect(back.personDid).toBe(d.personDid);
      // Back on the old number, and LOCKED: whoever moved it knew the PIN. A code to the owner's number opens it.
      expect(() => persons.loginWithPin(d.phone, PIN)).toThrow(/Too many wrong PINs/);
      expect(() => persons.loginWithPin(theirs, '7391')).toThrow(/Wrong phone or PIN/);
      // …and the number it was moved to is let go.
      expect(persons.ensurePerson(theirs).personDid).not.toBe(d.personDid);
      expect(drivers.register({ displayName: 'T', fullName: 'T T', nationalId: 'ID-RC-THEIRS', mobile: theirs, licenceClasses: ['bike'] }).did).toBeTruthy();
    });

    it('answers a stranger the same whether or not that number was ever moved, and shuts after five wrong PINs', () => {
      const d = aDriver();
      recovery.changeNumber(d.personDid, PIN, aVerifiedNumber());
      expect(() => recovery.undoWithOldNumber('+254733000001', PIN)).toThrow(/Wrong phone or PIN/);
      for (let i = 0; i < MAX_RECOVERY_MISSES; i++) expect(() => recovery.undoWithOldNumber(d.phone, '0000')).toThrow(/Wrong phone or PIN/);
      expect(() => recovery.undoWithOldNumber(d.phone, PIN)).toThrow(/Undo it with the code we send to your email/);
    });

    it('with a code to the account’s email', async () => {
      const d = aDriver();
      recovery.changeNumber(d.personDid, PIN, aVerifiedNumber());
      const { code } = recovery.sendAccountCode(d.email, 'undo');
      expect(() => recovery.undoWithEmail(d.email, '000000')).toThrow(/Wrong or expired code/);
      recovery.undoWithEmail(d.email, code as string);
      expect(persons.requireByDid(d.personDid).phoneChange).toBeUndefined();
      await settle();
      expect(mailTo(d.email).map((m) => m.subject)).toEqual(expect.arrayContaining([expect.stringMatching(/number change was undone/)]));
    });

    it('not after the 24 hours', () => {
      const d = aDriver();
      const t0 = Date.now();
      recovery.changeNumber(d.personDid, PIN, aVerifiedNumber(), t0);
      expect(() => recovery.undoWithOldNumber(d.phone, PIN, t0 + NUMBER_UNDO_MS + 1)).toThrow(/Wrong phone or PIN/);
    });

    it('nor by email after the 24 hours, however fresh the code', () => {
      const d = aDriver();
      const t0 = Date.now();
      const theirs = aVerifiedNumber();
      recovery.changeNumber(d.personDid, PIN, theirs, t0);
      // A day later the owner asks for a code and types it straight away: the code is good, the window is not.
      const clock = jest.spyOn(Date, 'now').mockReturnValue(t0 + NUMBER_UNDO_MS + 1);
      try {
        const { code } = recovery.sendAccountCode(d.email, 'undo');
        expect(() => recovery.undoWithEmail(d.email, code as string)).toThrow(/no number change to undo/);
      } finally {
        clock.mockRestore();
      }
      expect(persons.requireByDid(d.personDid).phoneChange).toBeDefined(); // untouched: the sweep settles it, not a refused undo
      // Refused WHOLE — the driver record did not let go of the number it now stands on while the person kept it.
      expect(() => drivers.register({ displayName: 'Late', fullName: 'L L', nationalId: 'ID-RC-LATE', mobile: theirs, licenceClasses: ['bike'] })).toThrow(/already/);
    });
  });

  /* ------------------------------------------------------------------ the number is gone and the PIN forgotten -- */

  describe('the number is gone and the PIN forgotten: the inbox is the way back', () => {
    it('a driver needs their national ID number as well as the code — then a new number and a new PIN', () => {
      const d = aDriver();
      const fresh = aVerifiedNumber();
      const { code } = recovery.sendAccountCode(d.email, 'recover');
      const ask = { email: d.email, code, newPhone: fresh, pin: '7391' };
      expect(() => recovery.recoverByEmail(ask)).toThrow(/Type the national ID number you registered with/);
      expect(() => recovery.recoverByEmail({ ...ask, nationalId: 'ID-NOT-THEIRS' })).toThrow(/not the one on this account/);
      // Refused as itself, not as a 401: every app words a 401 as "that PIN is not right", which would send them to the wrong box.
      let refused: { code?: string; params?: { field?: string } } = {};
      try {
        recovery.recoverByEmail({ ...ask, nationalId: 'ID-STILL-NOT-THEIRS' });
      } catch (e) {
        refused = e as typeof refused;
      }
      expect(refused.code).toBe('FORBIDDEN');
      expect(refused.params?.field).toBe('nationalId');
      const back = recovery.recoverByEmail({ ...ask, nationalId: d.nationalId.toLowerCase() });
      expect(back.personDid).toBe(d.personDid);
      expect(persons.loginWithPin(fresh, '7391').person.personDid).toBe(d.personDid);
      // It is a number change like any other: the owner of the old number can still undo it.
      expect(recovery.undoWithOldNumber(d.phone, PIN).personDid).toBe(d.personDid);
    });

    it('shuts for the day after five wrong ID numbers', () => {
      const d = aDriver();
      const fresh = aVerifiedNumber();
      const { code } = recovery.sendAccountCode(d.email, 'recover');
      for (let i = 0; i < MAX_RECOVERY_MISSES; i++) expect(() => recovery.recoverByEmail({ email: d.email, code, nationalId: `WRONG-${i}`, newPhone: fresh, pin: '7391' })).toThrow(/not the one on this account/);
      expect(() => recovery.recoverByEmail({ email: d.email, code, nationalId: d.nationalId, newPhone: fresh, pin: '7391' })).toThrow(/Too many wrong tries/);
    });

    it('will not land the account on a number nobody proved they hold', () => {
      const d = aDriver();
      const { code } = recovery.sendAccountCode(d.email, 'recover');
      expect(() => recovery.recoverByEmail({ email: d.email, code, nationalId: d.nationalId, newPhone: '+254733777001', pin: '7391' })).toThrow(/Verify the new number first/);
      // Refused whole: the old number and the old PIN still stand.
      expect(persons.loginWithPin(d.phone, PIN).person.personDid).toBe(d.personDid);
    });

    it('somebody who only sends and collects gave us no ID, so the inbox stands alone', () => {
      const phone = aVerifiedNumber();
      const person = persons.enroll(phone, true, PIN).person;
      persons.setEmail(person.personDid, 'sender@example.com');
      const fresh = aVerifiedNumber();
      const { code } = recovery.sendAccountCode('Sender@Example.com ', 'recover');
      expect(recovery.recoverByEmail({ email: 'sender@example.com', code, newPhone: fresh, pin: '7391' }).personDid).toBe(person.personDid);
    });

    it('says nothing about whether an address has an account, and a wrong code opens nothing', () => {
      const d = aDriver();
      expect(recovery.sendAccountCode('nobody@example.com', 'recover')).toEqual({});
      expect(outbox.recent('nobody@example.com')).toHaveLength(0);
      expect(() => recovery.recoverByEmail({ email: d.email, code: '000000', nationalId: d.nationalId, newPhone: aVerifiedNumber(), pin: '7391' })).toThrow(/Wrong or expired code/);
      expect(persons.loginWithPin(d.phone, PIN).person.personDid).toBe(d.personDid);
    });
  });

  /* ------------------------------------------------------------------ the address itself -- */

  describe('the recovery email', () => {
    it('is one account’s: a second account cannot take the same address', () => {
      const a = aDriver();
      const b = aDriver();
      expect(() => persons.setEmail(b.personDid, a.email.toUpperCase())).toThrow(/already used by another account/);
      expect(persons.view(persons.requireByDid(a.personDid)).email).toBe(`d…@example.com`);
    });

    it('is replaced with the PIN and a code to the NEW address — and the old address is told', async () => {
      const d = aDriver();
      const { code } = recovery.sendConfirmCode('new@example.com');
      expect(() => recovery.changeEmail(d.personDid, '0000', 'new@example.com', code)).toThrow(/That is not your PIN/);
      expect(() => recovery.changeEmail(d.personDid, PIN, 'new@example.com', '000000')).toThrow(/Wrong or expired code/);
      recovery.changeEmail(d.personDid, PIN, 'new@example.com', code);
      await settle();
      expect(persons.findByEmail('new@example.com')?.personDid).toBe(d.personDid);
      expect(persons.findByEmail(d.email)).toBeUndefined();
      expect(mailTo(d.email)[0].subject).toMatch(/recovery email was changed/);
    });

    it('survives the person setting their name — one vault record, merged, never replaced', () => {
      const d = aDriver();
      persons.setProfile(d.personDid, { displayName: 'Rider R.', address: '12 Ngong Road' });
      expect(persons.emailOf(persons.requireByDid(d.personDid))).toBe(d.email);
    });

    it('is told when five wrong PINs lock the account', async () => {
      const d = aDriver();
      for (let i = 0; i < 4; i++) expect(() => persons.loginWithPin(d.phone, '0000')).toThrow(/Wrong phone or PIN/);
      expect(() => persons.loginWithPin(d.phone, '0000')).toThrow(/Too many wrong PINs/);
      await settle();
      expect(mailTo(d.email)[0].subject).toMatch(/your PIN was locked/);
    });
  });
});
