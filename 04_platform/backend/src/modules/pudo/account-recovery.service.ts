import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { standInCode } from '../../foundation/runtime/standin-code';
import { AuthService } from '../../foundation/auth/auth.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { hashPhone } from '../../foundation/identity/phone';
import { MailService } from '../../foundation/mail/mail.service';
import { reviewCodeOn } from '../../foundation/runtime/review-code';
import { AccountService } from './account.service';
import { AgentService } from './agent.service';
import { DriverService } from './driver.service';
import { EmailCodeService, normalizeEmail } from './email-code.service';
import { FleetManagerService } from './fleet-manager.service';
import { NotificationService } from './notification.service';
import { OtpService } from './otp.service';
import { ParcelService } from './parcel.service';
import { PersonService } from './person.service';
import type { Person, PhoneChange } from './person.types';
import { noticeOf, said, sayEnglish, type Said } from './notice-words/say';
import { refused } from './notice-words/refuse';
import { ReaderLanguageService, addresseeOf, screenLanguage, type ScreenLanguage } from './reader-language.service';

/** Wrong tries at undoing a number change with the old number, or at the ID on a recovery, before that way is shut. */
export const MAX_RECOVERY_MISSES = 5;
const SWEEP_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * The hour (UTC) from which the day's reminder of an old number goes: the morning across Africa and Europe, and never
 * the middle of somebody's night. No time zone is kept for a person, so it is one hour for everybody.
 */
export const OLD_NUMBER_REMINDER_HOUR_UTC = 6;

/**
 * What a safety notice says, as phrases each reader reads in their own language — in the bell, on the phone and, since
 * 2026-11-27, in the email beside them (the language the person reads their app in, reader-language.service.ts).
 */
type SafetyWords = { headline: Said; what: Said; next: Said; until?: string };

/**
 * GETTING BACK INTO AN ACCOUNT — AND KEEPING SOMEBODY ELSE OUT OF IT.
 *
 * The account is the phone NUMBER, so a lost handset is nothing: the same number, a code and a new PIN bring it
 * all back. What can really be lost is the number itself — given up, deregistered, handed to somebody else by an
 * operator. The user's decisions (2026-10-01):
 *
 *  - STILL KNOW YOUR PIN? You can sign in from any browser with the old number, so you move the account yourself:
 *    the PIN again, a code to the new number. No staff, no ID — the PIN already opens everything.
 *  - "We need an email for account recovery and safety." Every account confirms one. It is told what happens to
 *    the account, it can undo a number change, and when the number is gone AND the PIN is forgotten it is the
 *    way back in — with the national ID number, where we hold one.
 *  - Whoever knows the PIN can move the account to THEIR number. So a move can be undone for 24 hours, with the
 *    old number and the PIN as it was, or with the inbox.
 *
 * And on 2026-10-08, to strengthen whoever holds the account:
 *
 *  - The old number stays the account's for SEVEN DAYS — what is sent to it still arrives, and nobody else can open
 *    an account on it. "The user blocks their own old phone number in the account. We remind them to do that for 7
 *    days, after that we free the account and a dual phone number doesn't work anymore."
 *  - An account moved WITHOUT its PIN (by its inbox, by staff) is not shown its parcels' collection codes for the day
 *    in which the move can be undone: collecting the goods is the one thing an undo cannot give back.
 *  - The codes an account could read are REPLACED when a move is undone, and when it is recovered without its PIN —
 *    whoever had the account for those hours, or the phone that was lost, is left holding codes that open nothing.
 *
 * No PIN and no inbox either: two members of staff move it (account-move.service.ts decides WHETHER; the move itself
 * is the one here, with the same notices and the same 24 hours to undo it). An ID somebody else registered is not
 * here.
 */
@Injectable()
export class AccountRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountRecoveryService.name);
  private timer?: NodeJS.Timeout;
  /** Wrong national IDs tried against one address today. In memory: honest for one instance. */
  private readonly idMisses = new Map<string, number>();

  constructor(
    private readonly persons: PersonService,
    private readonly drivers: DriverService,
    private readonly agents: AgentService,
    private readonly managers: FleetManagerService,
    private readonly accounts: AccountService,
    private readonly otp: OtpService,
    private readonly emailCodes: EmailCodeService,
    private readonly auth: AuthService,
    private readonly events: EventBus,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly mail?: MailService,
    // The parcels, for the codes an account could read and for how many are waiting. Optional so a hand-built module
    // keeps compiling; without it a move changes no code and its notice counts no parcels.
    @Optional() private readonly parcels?: ParcelService,
    // 2026-11-27 — the email in the language the person reads their app in.
    @Optional() private readonly readers?: ReaderLanguageService,
  ) {}

  onModuleInit(): void {
    // Five wrong PINs: the owner hears it in the app already; the inbox is the channel a thief of the phone cannot read.
    this.events.subscribe<{ personDid: string }>(GlosEvent.Pudo.PersonPinLocked, (e) => {
      const person = this.persons.findByDid(e.payload.personDid);
      if (person) this.tellByMail(person, { headline: said('accountSafety.pinLocked.title'), what: said('accountSafety.pinLocked.what'), next: said('accountSafety.pinLocked.next') });
    });
    // A PIN replaced by a code, or the PIN now working on a phone or browser it never had: the same channel, for
    // the same reason. If it was the holder, one email they expected; if it was not, the only way they find out.
    this.events.subscribe<{ personDid: string; newDevice?: boolean }>(GlosEvent.Pudo.PersonPinReplaced, (e) => {
      const person = this.persons.findByDid(e.payload.personDid);
      if (!person) return;
      this.tellByMail(person, {
        headline: said('accountSafety.pinReplaced.title'),
        what: said(e.payload.newDevice ? 'accountSafety.pinReplaced.what.newDevice' : 'accountSafety.pinReplaced.what.known'),
        next: said('accountSafety.pinReplaced.next'),
      });
    });
    this.events.subscribe<{ personDid: string }>(GlosEvent.Pudo.PersonDeviceConfirmed, (e) => {
      const person = this.persons.findByDid(e.payload.personDid);
      if (!person) return;
      this.tellByMail(person, { headline: said('accountSafety.newDevice.title'), what: said('accountSafety.newDevice.what'), next: said('accountSafety.newDevice.next') });
    });
    this.timer = setInterval(() => {
      this.settle();
      this.remindOldNumbers();
    }, SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /* ------------------------------------------------------------------ the address -- */

  /**
   * Send a code to an address somebody says is theirs — to CONFIRM it. Returns the code so a sandbox can show it;
   * the controller decides whether anybody but the inbox sees it.
   */
  sendConfirmCode(email: string, screen?: ScreenLanguage): { code: string; review?: true } {
    // The owner's stand-in code for an address named on the server, while no mail can leave: its own, mailed nowhere.
    const standIn = standInCode(email, Boolean(this.mail?.connection().sends));
    if (standIn) return { code: this.emailCodes.request(email, Date.now(), { standIn }).code };
    // The review code: mail cannot leave, the address belongs to nobody yet — 000000, mailed nowhere, shown by the caller.
    if (reviewCodeOn() && !this.mail?.connection().sends && !this.persons.findByEmail(email)) {
      return { code: this.emailCodes.request(email, Date.now(), { review: true }).code, review: true };
    }
    const { code, minutes } = this.emailCodes.request(email);
    // 2026-11-27 — in the language of the screen that asked: the address is not anybody's yet, so nothing else says it.
    void this.mail?.send('email-code', { address: normalizeEmail(email), ...screenLanguage(screen) }, { code, minutes, why: 'confirm' });
    return { code };
  }

  /**
   * Send a code to the address ON AN ACCOUNT — to recover it, or to undo a number change. Says nothing about
   * whether there is such an account: an address nobody holds is answered exactly as one somebody does.
   */
  sendAccountCode(email: string, why: 'recover' | 'undo', screen?: ScreenLanguage): { code?: string } {
    const person = this.persons.findByEmail(email);
    if (!person) return {};
    const standIn = standInCode(email, Boolean(this.mail?.connection().sends));
    if (standIn) return { code: this.emailCodes.request(email, Date.now(), { standIn }).code };
    const { code, minutes } = this.emailCodes.request(email);
    void this.mail?.send('email-code', { address: normalizeEmail(email), ...screenLanguage(screen) }, { code, minutes, why });
    return { code };
  }

  /** The signed-in person replaces their recovery email: the PIN again, and a code to the NEW address. The old one is told. */
  changeEmail(personDid: string, pin: string, email: string, code: string): Person {
    this.persons.confirmPin(personDid, pin);
    this.persons.assertEmailFree(email, personDid);
    if (!this.emailCodes.isVerified(email)) this.emailCodes.verify(email, code);
    const before = this.persons.requireByDid(personDid);
    const old = this.persons.emailOf(before);
    const person = this.persons.setEmail(personDid, email);
    this.emailCodes.consume(email);
    if (old && old !== normalizeEmail(email)) {
      void this.mail?.send(
        'account-safety',
        // The old address is no longer theirs, so whose it was is said: the email is in their language all the same.
        addresseeOf(this.readers, personDid, old),
        { headline: said('accountSafety.emailChanged.title'), what: said('accountSafety.emailChanged.what', { email: person.emailMasked }), next: said('accountSafety.emailChanged.next'), when: new Date().toISOString() },
      );
    }
    return person;
  }

  /* ------------------------------------------------------------------ moving the number -- */

  /**
   * THE PERSON MOVES THEIR OWN ACCOUNT — signed in, the PIN again, a code already confirmed on the new number.
   * Every session ends, this one included: the next sign-in is the new number and the same PIN.
   */
  changeNumber(personDid: string, pin: string, newPhone: string, now: number = Date.now()): Person {
    this.persons.confirmPin(personDid, pin);
    if (!this.otp.isVerified(newPhone)) throw refused('PHONE_NOT_VERIFIED', said('refuse.recovery.verifyNewNumber'));
    const person = this.move(personDid, newPhone, 'self', now);
    this.otp.consume(newPhone);
    return person;
  }

  /**
   * THE NUMBER IS GONE AND THE PIN FORGOTTEN: the inbox is the way back, with the national ID number where the
   * account has one on record (a driver's, a shopkeeper's). A new number, confirmed by code, and a new PIN.
   * Somebody who only sends and collects parcels gave us no ID, so for them the inbox stands alone.
   */
  recoverByEmail(input: { email: string; code?: string; nationalId?: string; newPhone: string; pin: string }, now: number = Date.now()): Person {
    const email = normalizeEmail(input.email);
    if (!this.emailCodes.isVerified(email, now)) this.emailCodes.verify(email, input.code ?? '', now);
    const person = this.persons.findByEmail(email);
    // The code was right, so this address is real to whoever holds the inbox — but it may be no account's.
    if (!person) throw refused('NOT_FOUND', said('refuse.recovery.noAccountForEmail'));
    this.checkNationalId(person, email, input.nationalId);
    if (!this.otp.isVerified(input.newPhone)) throw refused('PHONE_NOT_VERIFIED', said('refuse.recovery.verifyNewNumber'));

    const moved = this.move(person.personDid, input.newPhone, 'email', now);
    this.persons.setPin(moved.personDid, input.pin);
    this.auth.revokeAll(moved.personDid);
    this.otp.consume(input.newPhone);
    this.emailCodes.consume(email);
    this.idMisses.delete(email);
    return this.persons.requireByDid(moved.personDid);
  }

  /**
   * TWO MEMBERS OF STAFF MOVED IT. The caller has made sure of that; this is the move, and nothing about it is
   * gentler for having been staff's doing: the holder is told everywhere they read, every session ends, the old
   * number is held for a day, and for that day the move can be undone with the old number and the PIN as it was.
   */
  moveByStaff(personDid: string, newPhone: string, now: number = Date.now()): Person {
    return this.move(personDid, newPhone, 'staff', now);
  }

  /** Tell an account's holder something about its safety — in their app, on each driver record, and by email. */
  tellHolder(person: Person, s: SafetyWords): void {
    this.tell(person, s);
  }

  /** Undo a number change with the OLD number and the PIN as it was. Wrong five times and only the inbox can undo it. */
  undoWithOldNumber(oldPhone: string, pin: string, now: number = Date.now()): Person {
    const person = this.persons.movedFrom(hashPhone(oldPhone), now);
    // The same answer whether or not that number was ever moved: this door tells a stranger nothing.
    const wrongPhoneOrPin = () => refused('AUTH_FAILED', said('refuse.recovery.wrongPhoneOrPin'));
    if (!person) throw wrongPhoneOrPin();
    if ((person.phoneChange?.undoAttempts ?? 0) >= MAX_RECOVERY_MISSES) throw refused('PIN_LOCKED', said('refuse.recovery.tooManyUndoTries'));
    if (!this.persons.originalPinMatches(person, pin)) {
      this.persons.noteUndoMiss(person);
      throw wrongPhoneOrPin();
    }
    return this.undo(person, now);
  }

  /** Undo a number change with a code sent to the account's email. */
  undoWithEmail(email: string, code: string, now: number = Date.now()): Person {
    const address = normalizeEmail(email);
    if (!this.emailCodes.isVerified(address, now)) this.emailCodes.verify(address, code, now);
    const person = this.persons.findByEmail(address);
    if (!person?.phoneChange || Date.parse(person.phoneChange.undoUntil) <= now) throw refused('INVALID_STATE', said('refuse.recovery.noChangeToUndo'));
    this.emailCodes.consume(address);
    return this.undo(person, now);
  }

  /**
   * WHAT TIME HAS CLOSED. After a day a move can no longer be undone. After a week the old number — kept so that
   * what is still sent to it reaches the account — is let go for whoever has it now, and its holder is told. Returns
   * how many old numbers were let go. Run on a timer and safe to run at any time.
   */
  settle(now: number = Date.now()): number {
    let freed = 0;
    for (const person of this.persons.withNumberChange()) {
      const done = this.persons.settleMove(person.personDid, now);
      if (!done.freed) continue;
      this.release(done.held);
      this.tellOldNumberGone(person, 'time');
      freed += 1;
    }
    return freed;
  }

  /**
   * THE HOLDER BLOCKS THEIR OWN OLD NUMBER — "the user blocks their own old phone number in the account". The PIN
   * again, as for everything else under Settings: an open session is not proof of who holds the phone. From now a
   * parcel sent to that number is no longer theirs, and somebody else can open an account on it. They are told, in the
   * app and by email, so that somebody who did NOT do it hears that it was done.
   */
  blockOldNumber(personDid: string, pin: string, now: number = Date.now()): Person {
    this.persons.confirmPin(personDid, pin);
    this.release(this.persons.blockOldNumber(personDid, now));
    const person = this.persons.requireByDid(personDid);
    this.tellOldNumberGone(person, 'blocked');
    return person;
  }

  /**
   * "WE REMIND THEM TO DO THAT FOR 7 DAYS." Once a day, from the day the move can no longer be undone until the old
   * number is let go, its holder is reminded that it is still theirs, what to do with the days, and that they can block
   * it themselves. In the app every day; by email on the last one, when it is about to stop. It ends the moment they
   * block it. Returns how many were reminded.
   */
  remindOldNumbers(now: number = Date.now()): number {
    if (new Date(now).getUTCHours() < OLD_NUMBER_REMINDER_HOUR_UTC) return 0;
    const today = new Date(now).toISOString().slice(0, 10);
    let sent = 0;
    for (const person of this.persons.withNumberChange()) {
      const old = this.persons.oldNumberOf(person.personDid, now);
      if (!old || old.remindedOn === today) continue;
      // Counted in days of the calendar, so "tomorrow" is the day after the one this is read on.
      const days = Math.round((Date.parse(old.until.slice(0, 10)) - Date.parse(today)) / DAY_MS);
      this.tell(
        person,
        {
          headline: days <= 0 ? said('accountRecovery.remind.title.today') : days === 1 ? said('accountRecovery.remind.title.tomorrow') : said('accountRecovery.remind.title.days', { days }),
          what:
            days <= 0
              ? said('accountRecovery.remind.what.today')
              : days === 1
                ? said('accountRecovery.remind.what.tomorrow')
                : said('accountRecovery.remind.what.days', { days }),
          next: said('accountRecovery.remind.next'),
          until: old.until,
        },
        // The inbox hears it once, the day before: an email a day for a week is how an address gets ignored.
        days === 1,
      );
      this.persons.noteOldNumberReminded(person.personDid, today);
      sent += 1;
    }
    return sent;
  }

  /* ------------------------------------------------------------------ internals -- */

  /** The move itself, however it was authorised: the person, every register that holds their number, the email sign-in. */
  private move(personDid: string, newPhone: string, how: PhoneChange['how'], now: number): Person {
    const before = this.persons.requireByDid(personDid);
    const links = before.roles.filter((r) => r.status === 'active' && (r.role === 'driver' || r.role === 'agent'));
    // Asked of every register BEFORE anything moves, so a number another driver or shop holds refuses the whole thing.
    for (const l of links) (l.role === 'driver' ? this.drivers : this.agents).assertPhoneFree(l.entityDid, newPhone);

    const { person, fromHash, freed } = this.persons.movePhone(personDid, newPhone, how, now);
    // An account has one old number: an earlier one still kept was let go by this move.
    this.release(freed);
    // Moved WITHOUT its PIN, the number being gone: the phone it was on may be in somebody's hands with the codes on
    // its screen. They are replaced now — and not shown on the new number for a day (PersonService.codesHeldUntil).
    const waiting = this.parcels?.waitingFor(personDid) ?? 0;
    if (how !== 'self') this.parcels?.rotateCodesOf(personDid);
    const held: PhoneChange['held'] = [];
    for (const l of links) {
      const key = (l.role === 'driver' ? this.drivers : this.agents).moveMobile(l.entityDid, newPhone);
      if (key) held.push({ register: l.role === 'driver' ? 'driver' : 'shop', did: l.entityDid, key });
    }
    this.persons.holdPrints(personDid, held);
    this.accounts.rephone(fromHash, person.phoneHash);
    this.auth.revokeAll(personDid);

    const until = person.phoneChange!.undoUntil;
    const moved = said(how === 'email' ? 'accountRecovery.moved.email' : how === 'staff' ? 'accountRecovery.moved.staff' : 'accountRecovery.moved.self');
    // What is at stake, said in the notice itself: a holder who did NOT do this has a day, and should know why to hurry.
    const parcels = waiting === 0 ? '' : waiting === 1 ? said('accountRecovery.waiting.one') : said('accountRecovery.waiting.many', { n: waiting });
    const codes = how === 'self' ? '' : said('accountRecovery.codesChanged');
    this.tell(person, {
      headline: said('accountRecovery.changed.title'),
      what: said('accountRecovery.changed.what', { moved, parcels, codes }),
      next: said('accountRecovery.changed.next'),
      until,
    });
    this.tellFleets(person, said('accountRecovery.fleet.changed'));
    return person;
  }

  private undo(person: Person, now: number): Person {
    const links = person.roles.filter((r) => r.status === 'active' && (r.role === 'driver' || r.role === 'agent'));
    for (const l of links) (l.role === 'driver' ? this.drivers : this.agents).undoMobile(l.entityDid);
    const movedTo = person.phoneHash;
    const back = this.persons.undoMove(person.personDid, now);
    this.accounts.rephone(movedTo, back.phoneHash);
    // Whoever had the account for those hours could read the codes of its parcels. They open nothing now.
    const rotated = this.parcels?.rotateCodesOf(back.personDid) ?? 0;
    this.tell(back, {
      headline: said('accountRecovery.undone.title'),
      what: said('accountRecovery.undone.what', { rotated: rotated ? said('accountRecovery.undone.rotated') : '' }),
      next: said('accountRecovery.undone.next'),
    });
    this.tellFleets(back, said('accountRecovery.fleet.undone'));
    return back;
  }

  /** A driver or a shopkeeper gave a national ID when they registered; a recovery has to name it. Five wrong and the door shuts for the day. */
  private checkNationalId(person: Person, email: string, nationalId?: string): void {
    const drivers = person.roles.filter((r) => r.role === 'driver' && r.status === 'active').map((r) => r.entityDid);
    const shops = person.roles.filter((r) => r.role === 'agent' && r.status === 'active').map((r) => r.entityDid);
    if (!drivers.length && !shops.length) return;
    if ((this.idMisses.get(email) ?? 0) >= MAX_RECOVERY_MISSES) throw refused('RATE_LIMITED', said('refuse.recovery.tooManyIdTries'));
    const id = nationalId?.trim();
    const ok = Boolean(id) && (drivers.some((did) => this.drivers.holdsNationalId(did, id)) || shops.some((did) => this.agents.holdsNationalId(did, id)));
    if (ok) return;
    this.idMisses.set(email, (this.idMisses.get(email) ?? 0) + 1);
    if (!id) throw refused('FIELD_REQUIRED', said('refuse.recovery.nationalIdRequired'), { field: 'nationalId' });
    // A 403, never a 401: every app reads a 401 as a wrong PIN or a dead sign-in, and this is neither.
    throw refused('FORBIDDEN', said('refuse.recovery.nationalIdWrong'), { field: 'nationalId' });
  }

  /** The register prints an old number still held are given up with it. */
  private release(held: PhoneChange['held']): void {
    for (const h of held) (h.register === 'driver' ? this.drivers : this.agents).releaseHeldPhone(h.key, h.did);
  }

  private tellOldNumberGone(person: Person, why: 'blocked' | 'time'): void {
    this.tell(person, {
      headline: said('accountRecovery.oldGone.title'),
      what: said(why === 'blocked' ? 'accountRecovery.oldGone.what.blocked' : 'accountRecovery.oldGone.what.time'),
      next: said(why === 'blocked' ? 'accountRecovery.oldGone.next.blocked' : 'accountRecovery.oldGone.next.time'),
    });
  }

  /** The person hears it everywhere they read: their own inbox in the app, each driver record's, and — unless told not to — the email. */
  private tell(person: Person, w: SafetyWords, byMail = true): void {
    // 2026-11-26 — in phrases, so each reads it in their language; 2026-11-27 — every sender gives phrases, the email too.
    const drivers = person.roles.filter((r) => r.role === 'driver' && r.status === 'active').map((r) => r.entityDid);
    const body = noticeOf(w.headline, said('accountRecovery.twoParts', { what: w.what, next: w.next }));
    for (const to of [person.personDid, ...drivers]) {
      void this.notifications
        ?.notify(to, { kind: 'security', ...body, link: '/', tag: `account:${person.personDid}:${sayEnglish(w.headline)}` })
        .catch((err) => this.logger.warn(`security notice failed: ${(err as Error).message}`));
    }
    if (byMail) this.tellByMail(person, w);
  }

  /** The email, in the language the person reads their app in where all of it is written there (else English). */
  private tellByMail(person: Person, w: SafetyWords): void {
    const address = this.persons.emailOf(person);
    if (address) void this.mail?.send('account-safety', addresseeOf(this.readers, person.personDid, address), { headline: w.headline, what: w.what, next: w.next, when: new Date().toISOString(), ...(w.until ? { until: w.until } : {}) });
  }

  /** A fleet's office is told when one of its drivers' sign-in number changes — it is the fleet's name on their loads. */
  private tellFleets(person: Person, did: Said): void {
    for (const link of person.roles.filter((r) => r.role === 'driver' && r.status === 'active' && r.tenant)) {
      let name = 'One of your drivers';
      try {
        name = this.drivers.get(link.entityDid).displayName;
        this.managers.get(link.tenant as string);
      } catch {
        continue;
      }
      void this.notifications
        ?.notify(link.tenant as string, { kind: 'security', ...noticeOf(said('accountRecovery.fleet.title', { name, what: did }), said('accountRecovery.fleet.body')), link: '/', tag: `driver:${link.entityDid}:number` })
        .catch(() => undefined);
    }
  }
}
