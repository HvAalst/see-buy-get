import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { AuthService } from '../../foundation/auth/auth.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { hashPhone } from '../../foundation/identity/phone';
import { MailService } from '../../foundation/mail/mail.service';
import type { MailParams } from '../../foundation/mail/mail.templates';
import { AccountService } from './account.service';
import { AgentService } from './agent.service';
import { DriverService } from './driver.service';
import { EmailCodeService, normalizeEmail } from './email-code.service';
import { FleetManagerService } from './fleet-manager.service';
import { NotificationService } from './notification.service';
import { OtpService } from './otp.service';
import { PersonService } from './person.service';
import type { Person, PhoneChange } from './person.types';

/** Wrong tries at undoing a number change with the old number, or at the ID on a recovery, before that way is shut. */
export const MAX_RECOVERY_MISSES = 5;
const SWEEP_MS = 60 * 60 * 1000;

type Safety = MailParams['account-safety'];

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
 *    old number and the PIN as it was, or with the inbox; and for those 24 hours the old number is held, then
 *    freed for a new person.
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
  ) {}

  onModuleInit(): void {
    // Five wrong PINs: the owner hears it in the app already; the inbox is the channel a thief of the phone cannot read.
    this.events.subscribe<{ personDid: string }>(GlosEvent.Pudo.PersonPinLocked, (e) => {
      const person = this.persons.findByDid(e.payload.personDid);
      if (person) this.tellByMail(person, { headline: 'Your PIN was locked', what: 'Somebody typed a wrong PIN five times for your phone number, so nobody can sign in with it now.', next: 'To sign in again, verify your phone by code and choose a new PIN. If it was not you, somebody knows your number: choose a PIN they cannot guess.' });
    });
    this.timer = setInterval(() => this.settle(), SWEEP_MS);
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
  sendConfirmCode(email: string): { code: string } {
    const { code, minutes } = this.emailCodes.request(email);
    void this.mail?.send('email-code', { address: normalizeEmail(email) }, { code, minutes, why: 'confirm' });
    return { code };
  }

  /**
   * Send a code to the address ON AN ACCOUNT — to recover it, or to undo a number change. Says nothing about
   * whether there is such an account: an address nobody holds is answered exactly as one somebody does.
   */
  sendAccountCode(email: string, why: 'recover' | 'undo'): { code?: string } {
    const person = this.persons.findByEmail(email);
    if (!person) return {};
    const { code, minutes } = this.emailCodes.request(email);
    void this.mail?.send('email-code', { address: normalizeEmail(email) }, { code, minutes, why });
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
      void this.mail?.send('account-safety', { address: old }, { headline: 'Your recovery email was changed', what: `The email address on your SeeBuyGet account is now ${person.emailMasked}. This address no longer receives its notices.`, next: 'If it was not you, sign in and change your PIN straight away, then set the recovery email again.', when: new Date().toISOString() });
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
    if (!this.otp.isVerified(newPhone)) throw new GlosError('PHONE_NOT_VERIFIED', 'Verify the new number first — we send it a code');
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
    if (!person) throw new GlosError('NOT_FOUND', 'No account uses that email address');
    this.checkNationalId(person, email, input.nationalId);
    if (!this.otp.isVerified(input.newPhone)) throw new GlosError('PHONE_NOT_VERIFIED', 'Verify the new number first — we send it a code');

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
  tellHolder(person: Person, s: Omit<Safety, 'when'>): void {
    this.tell(person, s);
  }

  /** Undo a number change with the OLD number and the PIN as it was. Wrong five times and only the inbox can undo it. */
  undoWithOldNumber(oldPhone: string, pin: string, now: number = Date.now()): Person {
    const person = this.persons.movedFrom(hashPhone(oldPhone), now);
    // The same answer whether or not that number was ever moved: this door tells a stranger nothing.
    const refused = () => new GlosError('AUTH_FAILED', 'Wrong phone or PIN');
    if (!person) throw refused();
    if ((person.phoneChange?.undoAttempts ?? 0) >= MAX_RECOVERY_MISSES) throw new GlosError('PIN_LOCKED', 'Too many wrong tries. Undo it with the code we send to your email instead.');
    if (!this.persons.originalPinMatches(person, pin)) {
      this.persons.noteUndoMiss(person);
      throw refused();
    }
    return this.undo(person, now);
  }

  /** Undo a number change with a code sent to the account's email. */
  undoWithEmail(email: string, code: string, now: number = Date.now()): Person {
    const address = normalizeEmail(email);
    if (!this.emailCodes.isVerified(address, now)) this.emailCodes.verify(address, code, now);
    const person = this.persons.findByEmail(address);
    if (!person?.phoneChange || Date.parse(person.phoneChange.undoUntil) <= now) throw new GlosError('INVALID_STATE', 'There is no number change to undo on that account — the 24 hours may have passed');
    this.emailCodes.consume(address);
    return this.undo(person, now);
  }

  /**
   * THE WINDOWS THAT HAVE CLOSED: the change stands, and the old number — held for a day so its owner could take
   * it back — is freed for whoever has it now. Run on a timer and safe to run at any time.
   */
  settle(now: number = Date.now()): number {
    let settled = 0;
    for (const person of this.persons.withNumberChange()) {
      const held = this.persons.settleMove(person.personDid, now);
      if (person.phoneChange) continue; // still inside its window
      for (const h of held) (h.register === 'driver' ? this.drivers : this.agents).releaseHeldPhone(h.key, h.did);
      settled += 1;
    }
    return settled;
  }

  /* ------------------------------------------------------------------ internals -- */

  /** The move itself, however it was authorised: the person, every register that holds their number, the email sign-in. */
  private move(personDid: string, newPhone: string, how: PhoneChange['how'], now: number): Person {
    const before = this.persons.requireByDid(personDid);
    const links = before.roles.filter((r) => r.status === 'active' && (r.role === 'driver' || r.role === 'agent'));
    // Asked of every register BEFORE anything moves, so a number another driver or shop holds refuses the whole thing.
    for (const l of links) (l.role === 'driver' ? this.drivers : this.agents).assertPhoneFree(l.entityDid, newPhone);

    const { person, fromHash } = this.persons.movePhone(personDid, newPhone, how, now);
    const held: PhoneChange['held'] = [];
    for (const l of links) {
      const key = (l.role === 'driver' ? this.drivers : this.agents).moveMobile(l.entityDid, newPhone);
      if (key) held.push({ register: l.role === 'driver' ? 'driver' : 'shop', did: l.entityDid, key });
    }
    this.persons.holdPrints(personDid, held);
    this.accounts.rephone(fromHash, person.phoneHash);
    this.auth.revokeAll(personDid);

    const until = person.phoneChange!.undoUntil;
    this.tell(person, {
      headline: 'Your phone number was changed',
      what:
        how === 'email'
          ? 'Your SeeBuyGet account was recovered with this email address and moved to a new phone number, with a new PIN.'
          : how === 'staff'
            ? 'Two members of SeeBuyGet staff moved your account to a new phone number. Somebody told them they had lost the number and the PIN, and staff checked who was asking.'
            : 'Your SeeBuyGet account now signs in with a different phone number.',
      next: 'If it was you, there is nothing to do. If it was NOT you: within 24 hours, open any SeeBuyGet app, choose “Trouble signing in?” and then “Undo a number change” — with your old number and PIN, or with a code to this address. The account goes back to your number and the PIN is locked until you choose a new one.',
      until,
    });
    this.tellFleets(person, 'changed the phone number they sign in with');
    return person;
  }

  private undo(person: Person, now: number): Person {
    const links = person.roles.filter((r) => r.status === 'active' && (r.role === 'driver' || r.role === 'agent'));
    for (const l of links) (l.role === 'driver' ? this.drivers : this.agents).undoMobile(l.entityDid);
    const movedTo = person.phoneHash;
    const back = this.persons.undoMove(person.personDid, now);
    this.accounts.rephone(movedTo, back.phoneHash);
    this.tell(back, {
      headline: 'The number change was undone',
      what: 'Your SeeBuyGet account is back on the phone number it had before. Every phone was signed out and the PIN is locked.',
      next: 'To sign in, choose “First time here, or forgot your PIN?”: a code goes to your number and you choose a new PIN. Pick one nobody around you could guess or has seen you type.',
    });
    this.tellFleets(back, 'had a change of phone number undone');
    return back;
  }

  /** A driver or a shopkeeper gave a national ID when they registered; a recovery has to name it. Five wrong and the door shuts for the day. */
  private checkNationalId(person: Person, email: string, nationalId?: string): void {
    const drivers = person.roles.filter((r) => r.role === 'driver' && r.status === 'active').map((r) => r.entityDid);
    const shops = person.roles.filter((r) => r.role === 'agent' && r.status === 'active').map((r) => r.entityDid);
    if (!drivers.length && !shops.length) return;
    if ((this.idMisses.get(email) ?? 0) >= MAX_RECOVERY_MISSES) throw new GlosError('RATE_LIMITED', 'Too many wrong tries for this account today. Try again tomorrow, or ask SeeBuyGet staff.');
    const id = nationalId?.trim();
    const ok = Boolean(id) && (drivers.some((did) => this.drivers.holdsNationalId(did, id)) || shops.some((did) => this.agents.holdsNationalId(did, id)));
    if (ok) return;
    this.idMisses.set(email, (this.idMisses.get(email) ?? 0) + 1);
    if (!id) throw new GlosError('FIELD_REQUIRED', 'Type the national ID number you registered with', { field: 'nationalId' });
    // A 403, never a 401: every app reads a 401 as a wrong PIN or a dead sign-in, and this is neither.
    throw new GlosError('FORBIDDEN', 'That national ID number is not the one on this account', { field: 'nationalId' });
  }

  /** The person hears it everywhere they read: their own inbox in the app, each driver record's, and the email. */
  private tell(person: Person, s: Omit<Safety, 'when'>): void {
    const drivers = person.roles.filter((r) => r.role === 'driver' && r.status === 'active').map((r) => r.entityDid);
    for (const to of [person.personDid, ...drivers]) {
      void this.notifications
        ?.notify(to, { kind: 'security', title: s.headline, body: `${s.what} ${s.next}`, link: '/', tag: `account:${person.personDid}:${s.headline}` })
        .catch((err) => this.logger.warn(`security notice failed: ${(err as Error).message}`));
    }
    this.tellByMail(person, s);
  }

  private tellByMail(person: Person, s: Omit<Safety, 'when'>): void {
    const address = this.persons.emailOf(person);
    if (address) void this.mail?.send('account-safety', { address }, { ...s, when: new Date().toISOString() });
  }

  /** A fleet's office is told when one of its drivers' sign-in number changes — it is the fleet's name on their loads. */
  private tellFleets(person: Person, did: string): void {
    for (const link of person.roles.filter((r) => r.role === 'driver' && r.status === 'active' && r.tenant)) {
      let name = 'One of your drivers';
      try {
        name = this.drivers.get(link.entityDid).displayName;
        this.managers.get(link.tenant as string);
      } catch {
        continue;
      }
      void this.notifications
        ?.notify(link.tenant as string, { kind: 'security', title: `${name} ${did}`, body: 'If that is expected, there is nothing to do. If it is not, speak to them: a number change can be undone for 24 hours.', link: '/', tag: `driver:${link.entityDid}:number` })
        .catch(() => undefined);
    }
  }
}
