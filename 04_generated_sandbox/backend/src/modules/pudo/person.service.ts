import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DidService } from '../../foundation/did/did.service';
import { AuthService } from '../../foundation/auth/auth.service';
import { AccessToken } from '../../foundation/auth/auth.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { MailBounces } from '../../foundation/mail/mail-bounces.service';
import { hashEmail, hashPhone, isPlausiblePhone, normalizePhone } from '../../foundation/identity/phone';
import { isPlausibleEmail, normalizeEmail } from './email-code.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { MediaService } from './media.service';
import { DEVICE_UNUSED_DAYS, DeviceBook, DeviceSeen, KnownDevice } from './person-devices';
import { OldNumber, Person, PersonRole, PersonView, PhoneChange, ROLE_TO_ACTOR, RoleLink, toView } from './person.types';

/** Wrong-PIN attempts before the PIN locks. From then on only a code sent to the phone opens it again. */
export const MAX_PIN_ATTEMPTS = 5;
/**
 * HOW MANY DIGITS A PIN HAS. Five (the user, 2026-10-11: "a five digit pin is safer and commonly used for banking
 * apps rather than 4"). It was four. Now that a PIN is only looked at on a device a code confirmed, its job is to
 * stop whoever is holding that device, and five gives them a tenth of the chance in their five tries. And four is
 * what a mobile-money PIN and a bank card's are: a PIN of another length cannot simply be the same one.
 * Every app reads the same number from `shared/account/pin.ts`.
 */
export const PIN_LENGTH = 5;
const PIN_RE = new RegExp(`^\\d{${PIN_LENGTH}}$`);
const PIN_LOCKED_SENTENCE = 'Too many wrong PINs. Verify your phone by code to sign in.';

/**
 * THE PINS SOMEBODY WHO KNOWS YOU TRIES FIRST.
 *
 * Five wrong guesses lock a PIN, so a PIN has to survive five — and somebody who knows you knows to start with
 * mostly one digit (11111, 12121, 11222), a straight run up or down (12345, 98765, 78901), every second number
 * (13579, 24680), the same three over again (12312) or the keypad's middle column (02580). Refused at the moment
 * a PIN is chosen. Written for any length, so that the number of digits is one line and not a rewrite.
 */
const KEYPAD_COLUMN = ['2580', '0852'];
export function isGuessablePin(pin: string): boolean {
  if (!PIN_RE.test(pin)) return false;
  const d = pin.split('').map(Number);
  // Fewer than three different digits.
  if (new Set(d).size < 3) return true;
  // A run: each digit the same step on from the one before, round the dial.
  const runs = (step: number) => d.every((x, i) => i === 0 || x === (d[i - 1] + step + 10) % 10);
  if (runs(1) || runs(-1) || runs(2) || runs(-2)) return true;
  // The same three digits over again.
  if (d.every((x, i) => i < 3 || x === d[i - 3])) return true;
  // The keypad's middle column, read down or up, with a digit before or after it.
  return KEYPAD_COLUMN.some((column) => pin.startsWith(column) || pin.endsWith(column));
}

/** How long a number change can be undone. */
export const NUMBER_UNDO_MS = 24 * 60 * 60 * 1000;
/**
 * How long the old number stays the account's after a move, counted from the move: what is sent to it still arrives,
 * and nobody else can open an account on it. The user, 2026-10-08: seven days, in which the holder is reminded to block
 * it themselves; then it is let go.
 */
export const OLD_NUMBER_KEPT_MS = 7 * 24 * 60 * 60 * 1000;
const KEPT_DAYS = OLD_NUMBER_KEPT_MS / (24 * 60 * 60 * 1000);
const KEPT_FOR_ANOTHER = `That number was moved off another account less than ${KEPT_DAYS} days ago. It can be used again after that.`;

/** "a…@example.com" — enough for its owner to recognise, not enough for anybody else to use. */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? `${email[0]}…${email.slice(at)}` : '…';
}

/** Locked — by the five wrong guesses, or by the old fifteen-minute window while it still runs. */
function pinLocked(person: Person, now: number = Date.now()): boolean {
  return Boolean(person.pinLockedAt) || Boolean(person.pinLockedUntil && person.pinLockedUntil > now);
}

/**
 * PersonService — the identity spine (S20). "One person, one account, many roles."
 *
 * A Person is keyed by their verified phone (as a peppered hash — never the cleartext number) and
 * carries a set of RoleLinks. The existing role logins (PUDO account, fleet code, vendor secret) keep
 * working unchanged and simply ATTACH a role to the person by phone; the consumer role is minted here
 * by phone+OTP, then reopened by a 4-digit PIN. Acting as any held role mints an actor token through
 * the exact S2/S3 machinery (`AuthService.mintActorToken`) — there is no new authorization model, only
 * a person who is allowed to mint tokens for the roles they hold.
 */
@Injectable()
export class PersonService {
  private readonly logger = new Logger(PersonService.name);
  // Durable: a person IS an account (the PIN is a real credential; the roles are real access). Losing
  // these on a restart would sign every consumer out permanently and orphan their role links.
  private readonly persons = new PersistentMap<string, Person>('sbg-persons'); // keyed by phoneHash
  /** The devices each person's PIN works on: the ones a code to their phone was typed on. Durable. */
  private readonly devices = new DeviceBook(new PersistentMap<string, KnownDevice>('person-devices'));
  // Derived index personDid → phoneHash, so an authenticated request (token.did = personDid) resolves
  // in O(1). Rebuilt from the durable map at construction and kept in step on every save().
  private readonly byDid = new Map<string, string>();
  // And emailHash → personDid: one inbox, one account, found without the address.
  private readonly byEmail = new Map<string, string>();
  /** Whoever has to hear that somebody's recovery email is no longer the one it was. Registered, not injected. */
  private readonly whenEmailChanged: Array<(personDid: string) => void> = [];
  /** Whoever keeps something addressed to a phone number, and has to hear that an account is moving off one. */
  private readonly whenNumberLeft: Array<(personDid: string, fromHash: string) => void> = [];

  constructor(
    private readonly dids: DidService,
    private readonly auth: AuthService,
    private readonly vault: IdentityVault,
    private readonly media: MediaService,
    // Optional so a hand-built module keeps compiling; without it a locked PIN is still locked, just not announced.
    @Optional() private readonly events?: EventBus,
    // Optional for the same reason; without it nobody is told their email came back, and nothing else changes.
    @Optional() private readonly bounces?: MailBounces,
  ) {
    for (const p of this.persons.values()) {
      this.byDid.set(p.personDid, p.phoneHash);
      if (p.emailHash) this.byEmail.set(p.emailHash, p.personDid);
    }
  }

  // --- lookups ---

  findByPhone(phone: string): Person | undefined {
    const key = hashPhone(phone);
    return key ? this.persons.get(key) : undefined;
  }

  findByHash(phoneHash: string): Person | undefined {
    return phoneHash ? this.persons.get(phoneHash) : undefined;
  }

  findByDid(personDid: string): Person | undefined {
    const key = this.byDid.get(personDid);
    return key ? this.persons.get(key) : undefined;
  }

  /** For an authenticated request: resolve the person the token acts as, or 404. */
  /** The person a driver's or a shop's registration belongs to — whoever signs in as it. Nobody, for a record no person was ever linked to. */
  findByEntity(entityDid: string): Person | undefined {
    for (const person of this.persons.values()) if (person.roles.some((r) => r.entityDid === entityDid && r.role !== 'consumer')) return person;
    return undefined;
  }

  requireByDid(personDid: string): Person {
    const person = this.findByDid(personDid);
    if (!person) throw new GlosError('NOT_FOUND', 'No such person');
    return person;
  }

  // --- creation + role linking ---

  /**
   * Find-or-create the person for a phone. Generates a pseudonymous personDid whose controller carries
   * the phoneHash, never the number — the SBG core keeps only the hash (a future central account service
   * owns the cleartext). Idempotent: the same number always resolves to the same person, which is exactly
   * what makes retroactive role/parcel linking work.
   */
  ensurePerson(phone: string): Person {
    if (!isPlausiblePhone(phone)) throw new GlosError('PHONE_INVALID', 'Enter a valid phone number');
    const phoneHash = hashPhone(phone);
    const existing = this.persons.get(phoneHash);
    if (existing) return existing;
    // A number an account moved off in the last week is still that account's: to move back to in the first day, and
    // for what is sent to it in all seven.
    if (this.keptFor(phoneHash)) throw new GlosError('INVALID_STATE', KEPT_FOR_ANOTHER, { field: 'phone' });

    const personDid = this.dids.generate(`person:${phoneHash}`, { role: 'person' }).id;
    const person: Person = { personDid, phoneHash, roles: [], createdAt: new Date().toISOString() };
    this.save(person);
    return person;
  }

  /**
   * Attach a role to the person for `phone` (creating the person if new). The single entry point every
   * existing login path funnels through — a PUDO signup, a fleet-code login, a vendor registration —
   * so one human across many roles is always one person. Idempotent per (role, entityDid): re-linking
   * updates status/tenant rather than duplicating. For the consumer role the entity IS the person.
   */
  attachRole(phone: string, role: PersonRole, entityDid: string, tenant?: string, status: RoleLink['status'] = 'active'): Person {
    // Guard BEFORE creating the person: a non-consumer role must name a real entity, or we would leave an
    // orphan person carrying a link to nothing (which would only fail later, at switch time).
    if (role !== 'consumer' && !entityDid) throw new GlosError('FIELD_REQUIRED', 'A role entity id is required');
    const person = this.ensurePerson(phone);
    const linkedDid = role === 'consumer' ? person.personDid : entityDid;
    const existing = person.roles.find((r) => r.role === role && r.entityDid === linkedDid);
    if (existing) {
      existing.status = status;
      if (tenant !== undefined) existing.tenant = tenant;
    } else {
      person.roles.push({ role, entityDid: linkedDid, tenant, status, linkedAt: new Date().toISOString() });
    }
    this.save(person);
    return person;
  }

  // --- self-managed profile (S29): a display name + an avatar ---

  /**
   * Set the person's own profile. A display NAME is PII, so it goes to the Identity Vault (never the
   * operational core) — created lazily the first time, updated in place after, so the opaque handle is
   * stable. An AVATAR is an image the person already uploaded to MediaService: we verify they own it,
   * link it to the person (starting its account-doc retention clock indirectly — kept while linked), and
   * purge the previous avatar's bytes so a person keeps exactly one. Both fields are optional and
   * independent (a caller may set just the name, just the avatar, or both).
   */
  setProfile(personDid: string, input: { displayName?: string; avatarMediaId?: string; address?: string }): Person {
    const person = this.requireByDid(personDid);

    /*
     * THE VAULT FIELDS, WRITTEN ONCE AND MERGED — and the merge is not tidiness, it is the bug.
     *
     * `IdentityVault.update` REPLACES the record: it re-encrypts whatever object it is handed, with no
     * notion of a partial write. While the person's record held one field that was invisible; the moment it
     * holds two, writing a name and an address in the same breath means the second call silently erases
     * what the first just stored. Caught by the end-to-end test setting both and reading back neither.
     *
     * So: read the current record, apply only what was asked for, write the whole thing back.
     *
     * WHERE THEY LIVE goes here beside the name for the same reason the name does. A home address is the
     * most sensitive field a courier hands this product — it is what turns "a driver who was near the
     * warehouse" into a person somebody can be sent to — so the operational core keeps an opaque ref and
     * never the street, and every read is an audited consent receipt.
     *
     * The address is CLEARABLE: an empty string removes it. Somebody who typed their address and thought
     * better of it must be able to take it back, and a field that can only ever be set is one nobody
     * should fill in. A display name is not clearable, because it is what other people see you as.
     */
    if (input.displayName !== undefined || input.address !== undefined) {
      const name = input.displayName?.trim();
      if (input.displayName !== undefined) {
        if (!name) throw new GlosError('FIELD_REQUIRED', 'A display name cannot be empty');
        if (name.length > 80) throw new GlosError('INVALID_INPUT', 'That name is too long');
      }
      const address = input.address?.trim();
      if (address !== undefined && address.length > 240) throw new GlosError('INVALID_INPUT', 'That address is too long');

      // The vault store is in-memory while person.vaultRef is persisted, so after a restart a stale ref
      // must re-seed rather than throw NotFoundException out of update() — see profile() for the read side.
      const live = Boolean(person.vaultRef && this.vault.exists(person.vaultRef));
      const held = live ? this.vault.reveal(person.vaultRef as string, { purpose: 'self-profile-update', requesterDid: person.personDid }) : undefined;
      const next = {
        ...(held ?? {}),
        fullName: name ?? held?.fullName ?? '',
        ...(input.address !== undefined ? { address: address || undefined } : {}),
      };
      if (live) this.vault.update(person.vaultRef as string, next);
      else person.vaultRef = this.vault.store(next, { region: 'local' }).vaultRef;
    }

    if (input.avatarMediaId !== undefined) {
      const next = input.avatarMediaId.trim() || undefined;
      if (next) {
        // The person must actually OWN this media — media.link() is best-effort and does NOT check, so
        // without this a caller could pin any known media id onto their own profile.
        const ref = this.media.get(next);
        if (!ref || ref.ownerDid !== personDid) throw new GlosError('FORBIDDEN', 'That image is not yours to use');
        // It must be an image uploaded AS an avatar. Re-kinding an evidence photo (a PoD/dispute the person
        // owns) to {type:'person'}/'account-doc' would strip it out of its retention bin AND detach it from
        // its parcel, so a later holdParcelForDispute()/anchorParcelTerminal() no longer protects it — and a
        // subsequent avatar replace would purgeByOwner() it, hard-deleting locked evidence mid-case. Refuse.
        if (ref.kind !== 'avatar') throw new GlosError('INVALID_INPUT', 'That image was not uploaded as a profile photo');
        this.media.link(next, { type: 'person', id: personDid }, 'avatar');
      }
      if (person.avatarMediaId && person.avatarMediaId !== next) {
        this.media.purgeByOwner(person.avatarMediaId, personDid); // one avatar per person — drop the old bytes
      }
      person.avatarMediaId = next;
    }

    this.save(person);
    return person;
  }

  /**
   * The person's self-view profile fields. `displayName` is a genuine PII reveal (audited consent
   * receipt) — call it only for the person acting as themselves, never for a counterparty projection.
   * Reveal is guarded by vault.exists(): the vault kept its records in memory until it was made durable,
   * so a person enrolled before that holds a ref to nothing, and it must degrade to "no name" rather than
   * throw and 404 the whole authenticated surface (this method is on the hot path of me/enroll/login/setProfile).
   */
  profile(person: Person): { displayName?: string; avatarMediaId?: string; address?: string } {
    const held = person.vaultRef && this.vault.exists(person.vaultRef)
      ? this.vault.reveal(person.vaultRef, { purpose: 'self-profile', requesterDid: person.personDid })
      : undefined;
    // One reveal for both fields rather than two: each call writes a consent receipt, and a log that says
    // this person's record was opened twice to draw one screen makes the audit trail harder to read, not safer.
    return { displayName: held?.fullName || undefined, avatarMediaId: person.avatarMediaId, ...(held?.address ? { address: held.address } : {}) };
  }

  /** The full self-view: the PII-free projection plus the revealed profile. For the acting person ONLY. */
  view(person: Person, now: number = Date.now()): PersonView {
    return {
      ...toView(person),
      ...this.oldNumberView(person, now),
      ...this.profile(person),
      ...(person.pinChangedAt ? { pinChangedAt: person.pinChangedAt } : {}),
      // Only a bounce for good: a full mailbox clears by itself, and is not a thing to alarm somebody about.
      ...(person.emailVerifiedAt && this.bounces?.stoppedKey(person.emailHash) === 'hard' ? { emailBounced: true } : {}),
    };
  }

  // --- consumer auth (phone + OTP → PIN) ---

  /**
   * Enroll (or return) the consumer for an OTP-verified phone. Requires the phone to have been verified
   * through the OtpService already (the controller runs the OTP step first, exactly as signup does), so
   * this never trusts an unverified number. Optionally sets the PIN in the same step (the phone-first
   * happy path). Returns a consumer actor token.
   */
  enroll(phone: string, otpVerified: boolean, pin?: string, deviceKey?: string): { person: Person; isNew: boolean; token: AccessToken; device: string } {
    if (!otpVerified) throw new GlosError('PHONE_NOT_VERIFIED', 'Verify your phone number first');
    const before = this.findByPhone(phone);
    const isNew = !before;
    const hadPin = Boolean(before?.pinHash);
    // Is this a device the PIN already worked on? Asked BEFORE anything is forgotten below.
    const known = this.devices.knows(before?.personDid, deviceKey);
    const person = this.attachRole(phone, 'consumer', ''); // entityDid resolved to personDid inside
    const replaced = pin !== undefined && hadPin;
    if (pin !== undefined) {
      this.setPin(person.personDid, pin);
      // A PIN replaced by a code — forgotten, or locked by wrong tries — is a PIN somebody may have been guessing
      // at, or a phone that changed hands. Every device it worked on has to be confirmed again; this one is, below.
      if (hadPin) this.devices.forgetAll(person.personDid);
    }
    // THE CODE WAS TYPED ON THIS DEVICE: it is the moment the device becomes one this person's PIN works on. A
    // device that already was keeps the key it has — a new key for every code would fill a person's ten with one phone.
    const device = known && !replaced ? (deviceKey as string) : this.devices.add(person.personDid);
    if (known && !replaced) this.devices.used(person.personDid, device);
    // THE HOLDER IS TOLD, on the channel whoever has the phone cannot read: a PIN replaced, or their PIN now working
    // somewhere it never had. Not at a first sign-up, and not for somebody who has no PIN to protect.
    if (replaced) this.tellSignIn(GlosEvent.Pudo.PersonPinReplaced, person, { newDevice: !known });
    else if (hadPin && !known) this.tellSignIn(GlosEvent.Pudo.PersonDeviceConfirmed, person, {});
    return { person: this.requireByDid(person.personDid), isNew, token: this.mintConsumerToken(person), device };
  }

  /** Is this the key of a device this person's PIN already works on? */
  knowsDevice(personDid: string | undefined, deviceKey: string | undefined): boolean {
    return this.devices.knows(personDid, deviceKey);
  }

  /** Who is told about their sign-in: the person, and every driver record they sign in as (a driver reads the Driver app). */
  private tellSignIn(event: string, person: Person, more: Record<string, unknown>): void {
    const driverDids = person.roles.filter((r) => r.role === 'driver' && r.status === 'active').map((r) => r.entityDid);
    void this.events?.publish(event, { personDid: person.personDid, driverDids, ...more }, { source: 'pudo' }).catch(() => undefined);
  }

  /**
   * THIS DEVICE, CONFIRMED — for somebody who has an account and a PIN and is on a device that has neither been
   * seen before. The caller has checked the code to the phone; what comes back is the key the PIN will be asked
   * with. It changes nothing about the person: the PIN is the one they had.
   */
  trustDevice(phone: string): string {
    const person = this.findByPhone(phone);
    // Said to somebody who has just typed a code sent to this very number: it tells them about their own phone.
    if (!person) throw new GlosError('NOT_FOUND', 'No account signs in with this number yet');
    const device = this.devices.add(person.personDid);
    if (person.pinHash) this.tellSignIn(GlosEvent.Pudo.PersonDeviceConfirmed, person, {});
    return device;
  }

  /** How many devices this person's PIN works on — for their own account screen. */
  deviceCount(personDid: string): number {
    return this.devices.count(personDid);
  }

  /**
   * THE PHONES AND BROWSERS THIS PERSON'S PIN WORKS ON, for their own Settings: how many, when each was confirmed
   * and last used, and which one is asking. Dates and nothing else — no key and no name of a device is kept to show.
   * `keys` is what the asking browser holds (one per number that ever signed in on it); the one that is this
   * person's marks "this one".
   */
  devicesOf(personDid: string, keys?: string[], now: number = Date.now()): { count: number; here: boolean; unusedDays: number; devices: DeviceSeen[] } {
    const mine = keys?.[this.devices.whichOf(personDid, keys, now)];
    const devices = this.devices.list(personDid, mine, now);
    return { count: devices.length, here: devices.some((d) => d.here), unusedDays: DEVICE_UNUSED_DAYS, devices };
  }

  /**
   * FORGET EVERY OTHER PHONE AND BROWSER. The PIN again — an open session is not proof of who is holding the phone —
   * through the same check and the same lock as the door. Every session ends, the asker's too (a token carries the
   * person as its revocation key), so a phone that was forgotten is also signed out; the one this was done on keeps
   * its key and signs back in with the PIN. With no key of this person's among `keys`, nothing is kept.
   */
  forgetOtherDevices(personDid: string, pin: string, keys?: string[]): { forgotten: number; kept: boolean } {
    this.confirmPin(personDid, pin);
    const mine = keys?.[this.devices.whichOf(personDid, keys)];
    const forgotten = this.devices.forgetAll(personDid, mine);
    this.auth.revokeAll(personDid);
    return { forgotten, kept: Boolean(mine) };
  }

  /**
   * FORGET THIS ONE — for whoever signed in on a computer that is not theirs. No PIN: it takes something away from
   * whoever holds this device and gives nothing. `which` is the place of the forgotten key in `keys`, so the browser
   * can drop its copy. The person's other phones stay signed in: this is signing out of ONE place, and the app that
   * asked drops its own session as any sign-out does.
   */
  forgetThisDevice(personDid: string, keys?: string[]): { forgotten: boolean; which: number } {
    const which = this.devices.whichOf(personDid, keys);
    return { forgotten: this.devices.forget(personDid, keys?.[which]), which };
  }

  /**
   * IS THIS A PIN SOMEBODY MAY CHOOSE — the right number of digits, and not one that is easy to guess. It changes
   * nothing and knows nobody, so a door can ask it before anything else (`identity/enroll` does, ahead of the email).
   */
  assertPin(pin: string): void {
    if (!PIN_RE.test(pin || '')) throw new GlosError('PIN_INVALID', `PIN must be exactly ${PIN_LENGTH} digits`, { length: PIN_LENGTH });
    if (isGuessablePin(pin)) {
      throw new GlosError('PIN_GUESSABLE', 'Choose a PIN that is harder to guess: not mostly one digit, not a run like 12345 or 13579, and not a pattern like 12312', { reason: 'guessable' });
    }
  }

  /**
   * Set or change the person's 5-digit PIN (scrypt-hashed) and clear any lockout.
   *
   * The ONE place a PIN is chosen — enrolling, a forgotten PIN after a code, a change — so the guessable ones are
   * refused here and nowhere else, and no door can choose one by going round.
   */
  setPin(personDid: string, pin: string): void {
    this.assertPin(pin);
    const person = this.requireByDid(personDid);
    person.pinSalt = randomBytes(16).toString('hex');
    person.pinHash = this.hashPin(pin, person.pinSalt);
    person.pinAttempts = 0;
    person.pinLockedAt = undefined;
    person.pinLockedUntil = undefined;
    person.pinChangedAt = new Date().toISOString();
    this.save(person);
  }

  /**
   * Reopen the app with a phone + PIN — no OTP. A 4-digit PIN is only 10⁴ wide, so the lock is the credential's
   * real strength: after MAX_PIN_ATTEMPTS wrong tries it locks, and only a code sent to the phone opens it again.
   * Returns a consumer actor token.
   */
  loginWithPin(phone: string, pin: string, device?: string): { person: Person; token: AccessToken } {
    const person = this.findByPhone(phone);
    /*
     * THE PIN IS LOOKED AT ONLY ON A DEVICE THIS PERSON CONFIRMED BY A CODE. Asked FIRST, and answered the same
     * way for a number nobody has, a number with no PIN, somebody else's device key and no key at all: without a
     * device of this person's there is no PIN to guess at, from anywhere, and nothing here says who has an account.
     * A 403 of its own, because every app's answer to it is one thing: send the code.
     */
    if (!this.devices.knows(person?.personDid, device)) {
      throw new GlosError('DEVICE_NOT_KNOWN', 'This phone or browser has not signed in to this account before. Confirm the number by the code we send to it, then use your PIN here');
    }
    // Do not reveal whether the phone is registered — same error either way.
    if (!person || !person.pinHash || !person.pinSalt) throw new GlosError('AUTH_FAILED', 'Wrong phone or PIN');
    this.checkPin(person, pin, 'AUTH_FAILED', 'Wrong phone or PIN');
    // The right PIN, on this device, today: what its owner is shown, and what its ninety days are counted from.
    this.devices.used(person.personDid, device);
    return { person, token: this.mintConsumerToken(person) };
  }

  /**
   * The PIN of the person who is SIGNED IN, asked again at the moment that decides who is driving: the start of a
   * shift. A phone left signed in — in a cab, on a shared charger — is not proof of who is holding it, and a
   * colleague who picks it up must not be able to start a day's work in somebody else's name. Same counter, same
   * lock as the door: an open session is not an unlimited guessing seat.
   */
  confirmPin(personDid: string, pin: string): void {
    const person = this.requireByDid(personDid);
    if (!person.pinHash || !person.pinSalt) throw new GlosError('PIN_INVALID', 'You have no PIN yet. Sign out, then choose “First time, or forgot your PIN?”');
    this.checkPin(person, pin, 'PIN_WRONG', 'That is not your PIN');
  }

  /**
   * THE CHECK EVERY PIN GOES THROUGH. A wrong one counts; the fifth locks; a locked PIN stays locked until the
   * phone is verified by code again; and the person is told, because somebody who knows their number is trying.
   *
   * At the DOOR a wrong PIN is AUTH_FAILED (401): nobody is signed in. From somebody ALREADY signed in it is
   * PIN_WRONG (403): their session is fine, and an app that reads a 401 as 'your sign-in ended' would otherwise
   * sign a driver out for a mistyped digit — which the change-PIN screen did.
   */
  private checkPin(person: Person, pin: string, code: 'AUTH_FAILED' | 'PIN_WRONG', wrong: string): void {
    if (pinLocked(person)) throw new GlosError('PIN_LOCKED', PIN_LOCKED_SENTENCE);
    if (!this.verifyPin(pin, person)) {
      person.pinAttempts = (person.pinAttempts ?? 0) + 1;
      const lockedNow = person.pinAttempts >= MAX_PIN_ATTEMPTS;
      if (lockedNow) person.pinLockedAt = new Date().toISOString();
      this.save(person);
      if (lockedNow) {
        this.tellLocked(person);
        throw new GlosError('PIN_LOCKED', PIN_LOCKED_SENTENCE);
      }
      throw new GlosError(code, wrong);
    }
    // The right PIN, and when: what is read when somebody tells staff this account's PIN is lost.
    person.pinAttempts = 0;
    person.pinLockedUntil = undefined;
    person.pinUsedAt = new Date().toISOString();
    this.save(person);
  }

  /** Who is told a PIN locked: the person themselves, and every driver record they sign in as. */
  private tellLocked(person: Person): void {
    const driverDids = person.roles.filter((r) => r.role === 'driver' && r.status === 'active').map((r) => r.entityDid);
    void this.events?.publish(GlosEvent.Pudo.PersonPinLocked, { personDid: person.personDid, driverDids }, { source: 'pudo' }).catch(() => undefined);
  }

  /**
   * Change your PIN — proven with the CURRENT PIN, through the same check sign-in uses, so a wrong guess here counts
   * toward the lockout exactly as it would at the door. Every other session is signed out; this device gets a fresh one.
   */
  /**
   * Change the PIN of the person who is SIGNED IN, proven with their current PIN.
   *
   * The same check, reached by who the token says they are rather than by a phone number in the body. That
   * matters: `changePin(phone, …)` will change the PIN of whatever account that number names, so an app
   * calling it on behalf of a signed-in person is one typo — or one hostile body — away from changing
   * somebody else's credential, and checking afterwards is too late because the change has happened.
   *
   * The wrong-PIN counter and the lockout are the door's, unchanged: an open session is not proof of who
   * is holding the phone, and a session left open at a counter must not become an unlimited guessing seat.
   */
  changePinForPerson(personDid: string, currentPin: string, newPin: string): { person: Person; token: AccessToken } {
    const person = this.requireByDid(personDid);
    this.checkPin(person, currentPin, 'PIN_WRONG', 'That is not your current PIN');
    if (currentPin === newPin) throw new GlosError('PIN_INVALID', 'Choose a PIN different from the current one');
    this.setPin(person.personDid, newPin);
    this.auth.revokeAll(person.personDid);
    const updated = this.requireByDid(person.personDid);
    return { person: updated, token: this.mintConsumerToken(updated) };
  }

  changePin(phone: string, currentPin: string, newPin: string, device?: string): { person: Person; token: AccessToken } {
    const { person } = this.loginWithPin(phone, currentPin, device);
    if (currentPin === newPin) throw new GlosError('PIN_INVALID', 'Choose a PIN different from the current one');
    this.setPin(person.personDid, newPin);
    this.auth.revokeAll(person.personDid);
    const updated = this.requireByDid(person.personDid);
    return { person: updated, token: this.mintConsumerToken(updated) };
  }

  // --- the recovery email ---

  findByEmail(email: string): Person | undefined {
    const did = this.byEmail.get(hashEmail(email));
    return did ? this.findByDid(did) : undefined;
  }

  /** Refuse an address another account already holds — asked BEFORE anything is created, so a refusal costs nothing. */
  assertEmailFree(email: string, forPersonDid?: string): void {
    if (!isPlausibleEmail(email)) throw new GlosError('VALIDATION_FAILED', 'Enter a valid email address', { field: 'email' });
    const holder = this.byEmail.get(hashEmail(email));
    if (holder && holder !== forPersonDid) throw new GlosError('DUPLICATE', 'That email address is already used by another account', { field: 'email', register: 'person' });
  }

  /**
   * Record the person's recovery email. The CALLER has confirmed it with a code — this never trusts an address
   * nobody proved they read, because it becomes a way into the account. One inbox, one account.
   */
  setEmail(personDid: string, email: string, now: number = Date.now()): Person {
    const person = this.requireByDid(personDid);
    const address = normalizeEmail(email);
    this.assertEmailFree(address, personDid);
    this.mergeVault(person, { email: address }, 'account-safety-update');
    // REPLACED, not set for the first time and not confirmed again as the same one: what was sent to the old
    // address was sent to a mailbox this person no longer vouches for.
    const replaced = Boolean(person.emailHash) && person.emailHash !== hashEmail(address);
    if (person.emailHash) this.byEmail.delete(person.emailHash);
    person.emailHash = hashEmail(address);
    person.emailMasked = maskEmail(address);
    person.emailVerifiedAt = new Date(now).toISOString();
    this.save(person);
    if (replaced) for (const tell of this.whenEmailChanged) tell(person.personDid);
    return person;
  }

  /** Be told when somebody's recovery email is replaced by another address. Not when it is first given. */
  onEmailChanged(listener: (personDid: string) => void): void {
    this.whenEmailChanged.push(listener);
  }

  /** The address itself, for sending — revealed from the vault, never kept beside the person. */
  emailOf(person: Person): string | undefined {
    if (!person.emailVerifiedAt || !person.vaultRef || !this.vault.exists(person.vaultRef)) return undefined;
    const held = this.vault.reveal(person.vaultRef, { purpose: 'account-safety', requesterDid: person.personDid });
    return typeof held.email === 'string' && held.email ? held.email : undefined;
  }

  // --- a number that moves ---

  /** The account a number was moved OFF in the last day, if any — the old number is still its to move back to. */
  movedFrom(phoneHash: string, now: number = Date.now()): Person | undefined {
    if (!phoneHash) return undefined;
    for (const p of this.persons.values()) if (p.phoneChange?.fromHash === phoneHash && Date.parse(p.phoneChange.undoUntil) > now) return p;
    return undefined;
  }

  /**
   * WHOSE A NUMBER IS, FOR CERTAIN, RIGHT NOW — the account that something addressed to it should be kept by.
   *
   * A number an account moved OFF is still that account's while it is kept for it (`keptFor`: a week, unless its
   * holder blocks it sooner): nobody else can take it meanwhile. A number an account moved ONTO in the last day is not
   * certain yet: the move can be undone, and what was addressed to that number must not go back to another number with
   * the account.
   */
  settledAt(phoneHash: string, now: number = Date.now()): Person | undefined {
    if (!phoneHash) return undefined;
    const held = this.keptFor(phoneHash, now);
    if (held) return held;
    const here = this.persons.get(phoneHash);
    if (!here) return undefined;
    return here.phoneChange && Date.parse(here.phoneChange.undoUntil) > now ? undefined : here;
  }

  /**
   * Be told when an account moves off a number, BEFORE it does: what is addressed to that number and to no account is
   * theirs, and has to be kept by the account before the number can be anybody else's. Not told of an undo — the
   * account goes back to a number that was held for it, and takes nothing from the one it leaves.
   */
  onNumberLeft(listener: (personDid: string, fromHash: string) => void): void {
    this.whenNumberLeft.push(listener);
  }

  /**
   * THE ACCOUNT A NUMBER IS STILL KEPT FOR: it moved off it less than a week ago and its holder has not blocked it.
   * Judged from WHEN it moved, never from whether the sweep has been round yet — or there would be an hour, between
   * the undo window closing and the sweep noticing, in which the number was nobody's.
   */
  keptFor(phoneHash: string, now: number = Date.now()): Person | undefined {
    if (!phoneHash) return undefined;
    for (const p of this.persons.values()) {
      if (p.phoneChange?.fromHash === phoneHash && Date.parse(p.phoneChange.at) + OLD_NUMBER_KEPT_MS > now) return p;
      if (p.oldNumber?.hash === phoneHash && Date.parse(p.oldNumber.until) > now) return p;
    }
    return undefined;
  }

  /** Every account with an old number on record — still to be undone, still kept, or waiting to be let go. */
  withNumberChange(): Person[] {
    return [...this.persons.values()].filter((p) => p.phoneChange || p.oldNumber);
  }

  /**
   * The collection codes of this account's parcels are NOT SHOWN until then. The user, 2026-10-08: right, for an
   * account that was moved WITHOUT its PIN — by its inbox, or by two members of staff. Collecting the goods is the one
   * thing an undo cannot give back, so for the day in which the move can be undone, whoever moved it cannot read what
   * a shop will ask for. Not for somebody who moved their own account with their PIN.
   */
  codesHeldUntil(personDid: string | undefined, now: number = Date.now()): string | undefined {
    const change = personDid ? this.findByDid(personDid)?.phoneChange : undefined;
    if (!change || change.how === 'self' || Date.parse(change.undoUntil) <= now) return undefined;
    return change.undoUntil;
  }

  /** The move of this account can still be undone until then — however it was moved. What cannot be taken back waits for it. */
  undoOpenUntil(personDid: string | undefined, now: number = Date.now()): string | undefined {
    const change = personDid ? this.findByDid(personDid)?.phoneChange : undefined;
    return change && Date.parse(change.undoUntil) > now ? change.undoUntil : undefined;
  }

  /**
   * MOVE THE ACCOUNT TO ANOTHER NUMBER. The caller has proved who is asking (their PIN, their inbox, or two
   * members of staff) and that the new number is theirs (a code to it). Everything the person is — roles, PIN,
   * name, history keyed to them — stays; the key they are found under changes. The old number is remembered for
   * 24 hours so the move can be undone, and stays the account's for a week (OldNumber); nobody else can take it
   * meanwhile. An account has ONE old number: an earlier one still kept is let go by this move, and its register
   * prints come back in `freed` for the caller to release.
   */
  movePhone(personDid: string, newPhone: string, how: PhoneChange['how'], now: number = Date.now()): { person: Person; fromHash: string; freed: PhoneChange['held'] } {
    if (!isPlausiblePhone(newPhone)) throw new GlosError('PHONE_INVALID', 'Enter a valid phone number', { field: 'phone' });
    const person = this.requireByDid(personDid);
    const toHash = hashPhone(newPhone);
    if (toHash === person.phoneHash) throw new GlosError('INVALID_STATE', 'That is the number you already sign in with', { field: 'phone' });
    if (this.persons.get(toHash)) throw new GlosError('DUPLICATE', 'That number already has an account', { field: 'phone', register: 'person' });
    if (this.keptFor(toHash, now)) throw new GlosError('INVALID_STATE', KEPT_FOR_ANOTHER, { field: 'phone' });
    if (person.phoneChange && Date.parse(person.phoneChange.undoUntil) > now) {
      throw new GlosError('INVALID_STATE', 'Your number was changed less than a day ago. Undo that change, or wait until it can no longer be undone.');
    }
    const fromHash = person.phoneHash;
    // First, and before anything of the person's changes: a keeper that fails here has stopped a move that had not begun.
    for (const keep of this.whenNumberLeft) keep(person.personDid, fromHash);
    this.closeUndo(person, now);
    const freed = person.oldNumber?.held ?? [];
    person.oldNumber = undefined;
    person.phoneChange = {
      fromHash,
      at: new Date(now).toISOString(),
      undoUntil: new Date(now + NUMBER_UNDO_MS).toISOString(),
      how,
      ...(person.pinHash && person.pinSalt ? { pinHash: person.pinHash, pinSalt: person.pinSalt } : {}),
      held: [],
    };
    this.persons.delete(fromHash);
    // No device goes with a number that moves: the next PIN sign-in is confirmed by a code to the number it is now.
    this.devices.forgetAll(person.personDid);
    person.phoneHash = toHash;
    this.mergeVault(person, { phone: normalizePhone(newPhone) }, 'number-change');
    this.save(person);
    return { person, fromHash, freed };
  }

  /** Note the register prints still held on the old number, so the sweep can free them when the window closes. */
  holdPrints(personDid: string, held: PhoneChange['held']): void {
    const person = this.requireByDid(personDid);
    if (!person.phoneChange) return;
    person.phoneChange.held = held;
    this.save(person);
  }

  /** The PIN as it was BEFORE the move — what the owner knows, whatever the mover has done to the PIN since. */
  originalPinMatches(person: Person, pin: string): boolean {
    const c = person.phoneChange;
    if (!c?.pinHash || !c.pinSalt) return false;
    const candidate = Buffer.from(this.hashPin(pin || '', c.pinSalt), 'hex');
    const known = Buffer.from(c.pinHash, 'hex');
    return candidate.length === known.length && timingSafeEqual(candidate, known);
  }

  /** One more wrong try at undoing with the old number. Returns how many that makes. */
  noteUndoMiss(person: Person): number {
    if (!person.phoneChange) return 0;
    person.phoneChange.undoAttempts = (person.phoneChange.undoAttempts ?? 0) + 1;
    this.save(person);
    return person.phoneChange.undoAttempts;
  }

  /**
   * PUT THE NUMBER BACK. The PIN goes back to what it was and is LOCKED: whoever moved the number knew the PIN (or
   * held the inbox), so the owner chooses a new one with a code to the number that is theirs again. Every session ends.
   */
  undoMove(personDid: string, now: number = Date.now()): Person {
    const person = this.requireByDid(personDid);
    const change = person.phoneChange;
    if (!change || Date.parse(change.undoUntil) <= now) throw new GlosError('INVALID_STATE', 'There is no number change to undo — the 24 hours have passed');
    this.persons.delete(person.phoneHash);
    // Whoever had the account in between confirmed devices of their own: none of them survives the undo.
    this.devices.forgetAll(person.personDid);
    person.phoneHash = change.fromHash;
    person.pinHash = change.pinHash;
    person.pinSalt = change.pinSalt;
    person.pinAttempts = 0;
    person.pinLockedAt = new Date(now).toISOString();
    person.phoneChange = undefined;
    this.mergeVault(person, { phone: undefined }, 'number-change-undo');
    this.save(person);
    this.auth.revokeAll(person.personDid);
    return person;
  }

  /**
   * The undo window closed: the change stands, and what was kept to undo it — the PIN as it was — is dropped. The old
   * number stays the account's for the rest of its week.
   */
  private closeUndo(person: Person, now: number): void {
    const change = person.phoneChange;
    if (!change || Date.parse(change.undoUntil) > now) return;
    person.phoneChange = undefined;
    person.oldNumber = { hash: change.fromHash, since: change.at, until: new Date(Date.parse(change.at) + OLD_NUMBER_KEPT_MS).toISOString(), held: change.held };
    this.save(person);
  }

  /**
   * WHAT TIME HAS CLOSED, for one account: the undo window, and then the week the old number is kept. `freed` when the
   * old number was let go just now, with the register prints for the caller to release.
   */
  settleMove(personDid: string, now: number = Date.now()): { freed: boolean; held: PhoneChange['held'] } {
    const person = this.requireByDid(personDid);
    this.closeUndo(person, now);
    const old = person.oldNumber;
    if (!old || Date.parse(old.until) > now) return { freed: false, held: [] };
    person.oldNumber = undefined;
    this.save(person);
    return { freed: true, held: old.held };
  }

  /**
   * THE HOLDER BLOCKS THEIR OWN OLD NUMBER: it stops being the account's now instead of at the end of its week. Not
   * while the move can still be undone — the old number is where the account would go back to. Returns the register
   * prints to release.
   */
  blockOldNumber(personDid: string, now: number = Date.now()): PhoneChange['held'] {
    const person = this.requireByDid(personDid);
    const undo = this.undoOpenUntil(personDid, now);
    if (undo) throw new GlosError('INVALID_STATE', 'Your number change can still be undone, so the old number is kept for that. You can block it once the 24 hours have passed.', { until: undo });
    this.closeUndo(person, now);
    const old = person.oldNumber;
    if (!old) throw new GlosError('INVALID_STATE', 'This account has no old number any more');
    person.oldNumber = undefined;
    this.save(person);
    return old.held;
  }

  /** The old number an account still has, the move being past undoing: what its holder is reminded of, once a day. */
  oldNumberOf(personDid: string, now: number = Date.now()): OldNumber | undefined {
    const old = this.findByDid(personDid)?.oldNumber;
    return old && Date.parse(old.until) > now ? old : undefined;
  }

  /** The holder was reminded of their old number today. */
  noteOldNumberReminded(personDid: string, day: string): void {
    const person = this.requireByDid(personDid);
    if (!person.oldNumber) return;
    person.oldNumber.remindedOn = day;
    this.save(person);
  }

  /** What the account's own Settings say of the old number: kept until when, and whether it can be blocked yet. */
  private oldNumberView(person: Person, now: number): Pick<PersonView, 'oldNumber'> {
    const change = person.phoneChange;
    const since = person.oldNumber?.since ?? change?.at;
    const until = person.oldNumber?.until ?? (change ? new Date(Date.parse(change.at) + OLD_NUMBER_KEPT_MS).toISOString() : undefined);
    if (!since || !until || Date.parse(until) <= now) return {};
    return { oldNumber: { since, until, canBlock: !this.undoOpenUntil(person.personDid, now) } };
  }

  // --- role switching ---

  /** The person's default identity token — acting as themselves (the consumer surface). */
  mintConsumerToken(person: Person): AccessToken {
    // `did` and `personDid` are the same string here — a consumer acts as themselves — and it is still
    // stated, so the account surface can ask one question ("who is the person?") of every token it sees
    // rather than special-casing the one role where the answer happens to sit in another field.
    return this.auth.mintActorToken({ role: 'consumer', did: person.personDid, personDid: person.personDid });
  }

  /**
   * "Act as: Me · Driver · Shop." Mint an actor token for a role the person holds — the same token the
   * role's own app carries, with that role's scopes and tenant. The person is allowed to mint it purely
   * because they hold the (active) RoleLink; no new authz.
   */
  mintForRole(person: Person, role: PersonRole): { role: PersonRole; entityDid: string; token: AccessToken } {
    const link = person.roles.find((r) => r.role === role && r.status === 'active');
    if (!link) throw new GlosError('ROLE_NOT_HELD', `You do not hold an active ${role} role`);
    // ONE PHONE AT A TIME for a driver, exactly as at the driver app's own door (see driverSignIn).
    if (role === 'driver') this.auth.revokeAll(link.entityDid);
    const token = role === 'consumer'
      ? this.mintConsumerToken(person)
      : // Carries the person, so changing their PIN also ends the role sessions that PIN opened.
        this.auth.mintActorToken({ role: ROLE_TO_ACTOR[role], did: link.entityDid, tenant: link.tenant, revocationKey: person.personDid, personDid: person.personDid });
    return { role, entityDid: link.entityDid, token };
  }

  // --- migration (fold existing role accounts onto persons by phone) ---

  /**
   * A role now belongs to a different tenant — a driver moved fleets. Every person holding that link is re-pointed,
   * so their next sign-in carries the new fleet; the people touched are returned, because the sessions they already
   * hold still carry the old one and have to end.
   */
  retenant(role: PersonRole, entityDid: string, tenant: string | undefined): Person[] {
    const touched: Person[] = [];
    for (const person of this.persons.values()) {
      const links = person.roles.filter((r) => r.role === role && r.entityDid === entityDid && r.tenant !== tenant);
      if (!links.length) continue;
      for (const link of links) link.tenant = tenant;
      this.persons.set(person.phoneHash, person);
      touched.push(person);
    }
    return touched;
  }

  /**
   * Best-effort link of an already-provisioned role entity to a person. Used by the boot migration to
   * fold pre-S20 accounts onto person identities: it never throws (a bad/absent phone is skipped and
   * logged), so a migration hiccup can never block startup or the existing role apps. Returns true if a
   * link was made.
   */
  tryAttachRole(phone: string | undefined, role: PersonRole, entityDid: string, tenant?: string): boolean {
    if (!phone || !isPlausiblePhone(phone)) return false;
    try {
      this.attachRole(phone, role, entityDid, tenant);
      return true;
    } catch (err) {
      this.logger.warn(`Could not link ${role} ${entityDid} to a person: ${(err as Error).message}`);
      return false;
    }
  }

  // --- internals ---

  private save(person: Person): void {
    this.persons.set(person.phoneHash, person);
    this.byDid.set(person.personDid, person.phoneHash);
    if (person.emailHash) this.byEmail.set(person.emailHash, person.personDid);
  }

  /** Read the person's vault record, apply only what was asked, write the whole thing back — `update` REPLACES. */
  private mergeVault(person: Person, patch: Record<string, unknown>, purpose: string): void {
    const live = Boolean(person.vaultRef && this.vault.exists(person.vaultRef));
    const held = live ? this.vault.reveal(person.vaultRef as string, { purpose, requesterDid: person.personDid }) : undefined;
    const next = { ...(held ?? {}), fullName: held?.fullName ?? '', ...patch };
    if (live) this.vault.update(person.vaultRef as string, next);
    else person.vaultRef = this.vault.store(next, { region: 'local' }).vaultRef;
  }

  private hashPin(pin: string, salt: string): string {
    return scryptSync(pin, salt, 64).toString('hex');
  }

  private verifyPin(pin: string, person: Person): boolean {
    if (!person.pinHash || !person.pinSalt) return false;
    const candidate = Buffer.from(this.hashPin(pin || '', person.pinSalt), 'hex');
    const known = Buffer.from(person.pinHash, 'hex');
    return candidate.length === known.length && timingSafeEqual(candidate, known);
  }
}
