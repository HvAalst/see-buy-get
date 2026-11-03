import { appUrl, type MailApp } from '../../foundation/mail/mail.templates';
import { standInCode } from '../../foundation/runtime/standin-code';
import { MailService } from '../../foundation/mail/mail.service';
import { Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'crypto';
import { isSandbox } from '../../foundation/runtime/sandbox';
import { SmsService, notSentWords } from '../../foundation/sms/sms.service';
import { DEVICE_UNUSED_DAYS, DeviceBook, type DeviceSeen, type KnownDevice } from './person-devices';
import { UNLOCK_TTL_MS, UnlockTickets, deviceHashOf, type DevicePasskey } from './passkeys';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AuthService } from '../../foundation/auth/auth.service';
import { RestingAccounts } from '../../foundation/auth/resting-accounts';
import { PASSWORD_WORDS, PasswordTries, keptLocks, spendTime } from '../../foundation/auth/password-tries';
import { assertPassword, newResetCode, readResetCode } from '../../foundation/auth/password-rules';
import { AccessToken } from '../../foundation/auth/auth.types';
import { DidService } from '../../foundation/did/did.service';
import { hashEmail, hashPhone, isPlausiblePhone } from '../../foundation/identity/phone';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { AgentService } from './agent.service';
import { DriverService } from './driver.service';
import { MdpService } from './mdp.service';
import { VehicleService } from './vehicle.service';
import { FleetService } from './fleet.service';
import { OtpService } from './otp.service';
import { PersonService } from './person.service';
import { PersonRole } from './person.types';
import { actorRoleForAccount } from './roles.map';

export type AccountRole = 'pudo' | 'driver' | 'mdp' | 'vendor';

/** A PUDO account role → the person-facing role it links to (a 'pudo' account IS an agent). */
const ACCOUNT_TO_PERSON_ROLE: Record<AccountRole, PersonRole> = { pudo: 'agent', driver: 'driver', mdp: 'mdp', vendor: 'vendor' };

interface Account {
  accountId: string;
  email: string;
  role: AccountRole;
  salt: string;
  hash: string;
  did: string; // the linked domain entity's real DID (agent / driver / MDP)
  tenant?: string; // for a fleet driver: the owning manager's DID (the token's tenant boundary)
  phoneHash?: string; // S20: the person join key captured at signup, so this login resolves to a person
  /**
   * Round 40 — the number a new phone or browser's code goes to, ENCRYPTED, for an account whose DID does not carry one
   * (a hub's is its name, a store's too). Kept from the verified number at sign-up, or given once by an account that had none.
   */
  codePhone?: string;
  createdAt: string;
  resetToken?: string;
  resetExpires?: number;
  /** When the password was last changed by its holder — for "change it regularly", and for review. */
  passwordChangedAt?: string;
  /**
   * 2026-11-03 — A SECOND KIND OF ACCOUNT UNDER ONE EMAIL (the owner: a shop "with the same email as my business account" …
   * "the email would then be linked … a confirmation mail will ask the user to click the 'yes it is me' button"). The first
   * account an email signs in to is kept under the address; another kind under the same one is kept beside it
   * (`address#role`, storeKeyOf) and signs in only once its owner clicked "Yes, it is me" in the email it was sent.
   */
  alias?: true;
  linkPending?: { token: string; askedAt: string; name?: string };
  linkedAt?: string;
}

/** Where an account is kept: the address, or — a second kind under the same address — the address and its kind. */
function storeKeyOf(account: Pick<Account, 'email' | 'role' | 'alias'>): string {
  return account.alias ? `${account.email}#${account.role}` : account.email;
}

const RESET_TTL_MS = 30 * 60 * 1000;
/** A week to click "Yes, it is me". */
const LINK_TTL_MS = 7 * 24 * 3_600_000;
/** Signing in before the click sends the email again, at most once an hour: a lost or late email is not a dead end. */
const LINK_RESEND_MS = 3_600_000;

/**
 * THE ACCOUNTS WHOSE SIGN-IN WORKS ONLY ON A PHONE OR BROWSER THEY CONFIRMED (the user, 2026-10-18: "who is at the
 * counter"). A shop's email and password, typed on a browser it has never used, open nothing until a code texted to the
 * shop's registered number is typed on it — so a password passed round, or read off a note, does not take parcels in
 * from somewhere else. Round 40 (the user: "Hubs and stores now"): a hub's and a store's are bound the same way, to the
 * number each verified at sign-up.
 */
export const DEVICE_BOUND_ROLES: readonly AccountRole[] = ['pudo', 'mdp', 'vendor'];
/** The DID controllers made from a phone number (agent, driver and fleet-manager registration). */
const PHONE_DIDS: readonly string[] = ['pudo', 'pudo-driver', 'pudo-fleet'];
/** What a bound account is called in what it is told. */
const PARTY: Record<AccountRole, string> = { pudo: 'shop', mdp: 'hub', vendor: 'store', driver: 'account' };
const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
const DEVICE_CODE_TRIES = 5;
const DEVICE_CODE_COOLDOWN_MS = 60 * 1000;

/** What a sign-in answers. `device` comes back once, when this phone or browser was just confirmed. */
export interface AccountSignIn {
  accountId: string;
  role: AccountRole;
  did: string;
  email: string;
  token: AccessToken;
  device?: string;
}

/** Which app an account signs in to — where its emails send people. */
const ACCOUNT_APP: Record<AccountRole, MailApp> = { pudo: 'agent', mdp: 'mdp', driver: 'driver', vendor: 'vendor' };
const WELCOME_ROLE = { pudo: 'shop', mdp: 'hub', driver: 'driver', vendor: 'store' } as const;
/** Refused driver sign-ups a person may have in a day — see signUpDriver. */
export const MAX_DRIVER_REFUSALS_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * AccountService — participant sign-in (email + password) for the PUDO field apps. Sign-up creates the
 * credential AND the underlying domain entity (a PUDO agent, a driver + optional own vehicle, or an MDP
 * hub) from the wizard's data, then links them. Login resolves the entity so the app can open as that
 * participant. Passwords are salted + scrypt-hashed; password reset issues a token (shown in-app — no
 * email/SMS infra in the sandbox). This is the entry gate; the apps still open by the resolved id.
 */
@Injectable()
export class AccountService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccountService.name);
  // Durable: these are real login credentials (scrypt salt + hash). A restart wiping them logs every
  // participant out permanently. Keyed by lower-cased email.
  private readonly accounts = new PersistentMap<string, Account>('pudo-accounts');
  /** Wrong passwords, counted against the address that was typed. One count for every door these accounts have. */
  private readonly tries = new PasswordTries(PASSWORD_WORDS, keptLocks('accounts'));
  /** The phones and browsers each bound account confirmed, by the hash of their key. Durable, as a person's are. */
  private readonly devices = new DeviceBook(new PersistentMap<string, KnownDevice>('account-devices'));
  /**
   * 2026-11-02 — what a fingerprint or face on one of the account's own phones unlocked: one use, two minutes, redeemed
   * where the password is checked (passkeys.ts). In memory: a ticket nobody used in two minutes is worth nothing.
   */
  private readonly unlocks = new UnlockTickets();
  /** A code texted for a browser asking to be confirmed: ten minutes, five tries. In memory, like every code here. */
  private readonly deviceCodes = new Map<string, { email: string; key?: string; code: string; sentAt: number; expires: number; attempts: number; needsPhone?: boolean; phone?: string }>();

  constructor(
    private readonly agents: AgentService,
    private readonly drivers: DriverService,
    private readonly mdps: MdpService,
    private readonly vehicles: VehicleService,
    private readonly fleet: FleetService,
    private readonly otp: OtpService,
    private readonly auth: AuthService,
    private readonly persons: PersonService,
    private readonly dids: DidService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly sms?: SmsService,
    // Round 40 — the number a hub's or a store's codes go to is kept encrypted. Optional for the specs that build this by hand.
    @Optional() private readonly crypto?: FieldEncryption,
    // Optional for the specs that build this by hand: without it, the email an account signs in with is never at rest.
    @Optional() rest?: RestingAccounts,
  ) {
    // The email a shop, hub or store signs in with is its owner's too: when they mute their account, it rests.
    rest?.answerForAddress((address) => {
      const account = this.accounts.get(address);
      return Boolean(account?.phoneHash && this.persons.findByHash(account.phoneHash)?.mutedAt);
    });
  }

  /**
   * Migration (S20): fold every existing account onto a person identity by phone. New signups link
   * inline (the phone is in hand); this catches accounts persisted before S20, deriving the phone from
   * the linked entity's DID controller. Idempotent (attach dedups by role+entity) and best-effort — a
   * link failure is logged, never fatal, so the existing role apps keep working exactly as before.
   */
  onApplicationBootstrap(): void {
    let linked = 0;
    let skipped = 0;
    for (const account of this.accounts.values()) {
      const phone = this.phoneForAccount(account);
      if (phone && this.persons.tryAttachRole(phone, ACCOUNT_TO_PERSON_ROLE[account.role], account.did, account.tenant)) linked++;
      else skipped++;
    }
    if (linked || skipped) this.logger.log(`Person migration: linked ${linked} account(s), skipped ${skipped}.`);
    // Drivers a FLEET registered have no account at all, and before phone sign-in they had no person either.
    // Idempotent: attaching a link that already exists only refreshes it.
    let drivers = 0;
    for (const driver of this.drivers.list()) {
      const phone = this.phoneForDid(driver.did);
      if (phone && this.persons.tryAttachRole(phone, 'driver', driver.did, driver.managerDid)) drivers++;
    }
    if (drivers) this.logger.log(`Person migration: ${drivers} driver(s) can sign in by phone.`);
  }

  /** Best-effort raw phone for an account: the hash captured at signup can't be reversed, so fall back
   *  to the phone embedded in the linked entity's DID controller (`pudo:<mobile>` etc.). */
  private phoneForAccount(account: Account): string | undefined {
    return this.phoneForDid(account.did);
  }

  /** Round 40 — where a new phone or browser's code goes: the number in the account's DID (a shop's), or the one kept with it. */
  private codePhoneOf(account: Account): string | undefined {
    const inDid = this.phoneForDid(account.did);
    if (inDid) return inDid;
    if (!account.codePhone || !this.crypto) return undefined;
    try {
      return this.crypto.decrypt(account.codePhone);
    } catch {
      return undefined;
    }
  }

  /** Round 40 — keep the number codes go to, encrypted; only where the DID does not already carry one. */
  private keepCodePhone(account: Account, phone: string): void {
    if (!this.crypto || this.phoneForDid(account.did)) return;
    account.codePhone = this.crypto.encrypt(phone.trim());
  }

  /** Round 40 — a phone verified by its code moments ago: what a store gives at sign-up, before the store is made. */
  assertVerifiedPhone(phone: string | undefined): string {
    if (!phone?.trim()) throw new GlosError('PHONE_REQUIRED', 'A phone number is required: a new phone or browser is confirmed by a code to it', { field: 'ownerPhone' });
    if (!this.otp.isVerified(phone)) throw new GlosError('PHONE_NOT_VERIFIED', 'Verify your phone number first', { field: 'ownerPhone' });
    return phone.trim();
  }

  private phoneForDid(did: string): string | undefined {
    const controller = this.dids.resolve(did)?.controller ?? '';
    // Only the DIDs made FROM a number carry one: a shop's, a driver's, a fleet's. A hub's and a store's are made from their
    // NAME — and a name with seven digits in it reads as a number once a country code is added (found round 40).
    const prefix = controller.slice(0, controller.indexOf(':'));
    if (!PHONE_DIDS.includes(prefix)) return undefined;
    const raw = controller.slice(controller.indexOf(':') + 1); // 'pudo-driver:+254…' → '+254…'
    return isPlausiblePhone(raw) ? raw : undefined;
  }

  /** Create a participant account + its domain entity from the sign-up wizard. Requires a verified phone. */
  signup(input: { role: AccountRole; email: string; password: string; phone: string; profile: Record<string, unknown> }): { accountId: string; role: AccountRole; did: string; email: string; entityStatus?: string; token: AccessToken; device?: string; linkPending?: boolean } {
    const email = (input.email || '').trim().toLowerCase();
    if (!email.includes('@')) throw new GlosError('EMAIL_INVALID', 'A valid email is required');
    assertPassword(input.password, [email, welcomeName(input.role, input.profile)]);
    if (!input.phone?.trim()) throw new GlosError('PHONE_REQUIRED', 'A phone number is required');
    if (!this.otp.isVerified(input.phone)) throw new GlosError('PHONE_NOT_VERIFIED', 'Verify your phone number first');
    /*
     * A REFUSAL BECAUSE THE DETAILS ARE ALREADY REGISTERED is counted against this phone's verification. It
     * names what matched, because a person who registered before needs to know which of their details did —
     * and that makes it an answer about somebody else's ID too. So a verification allows a few, and then the
     * next attempt has to verify the phone again: one verified phone cannot walk through every ID there is.
     */
    let second: boolean;
    try {
      second = this.secondKind(email, input.role);
    } catch (err) {
      this.otp.noteRefusal(input.phone);
      throw err;
    }

    let provisioned: { did: string; entityStatus?: string; tenant?: string };
    try {
      provisioned = this.provision(input.role, input.profile);
    } catch (err) {
      if (err instanceof GlosError && err.code === 'DUPLICATE') this.otp.noteRefusal(input.phone);
      throw err;
    }
    const { did, entityStatus, tenant } = provisioned;
    // S20: link this role to the person identity by phone (best-effort — never blocks the signup) and
    // remember the join key on the account so the same human is never asked to make a second account.
    this.persons.tryAttachRole(input.phone, ACCOUNT_TO_PERSON_ROLE[input.role], did, tenant);
    this.otp.consume(input.phone); // one verification → one account
    const salt = randomBytes(16).toString('hex');
    const account: Account = { accountId: `acc_${randomBytes(8).toString('hex')}`, email, role: input.role, salt, hash: this.hash(input.password, salt), did, tenant, phoneHash: hashPhone(input.phone), createdAt: new Date().toISOString(), ...(second ? { alias: true as const } : {}) };
    if (second) this.askYesItIsMe(account, welcomeName(input.role, input.profile));
    // Round 40 — a hub's codes go to the number it verified here: its DID carries its name, not a number.
    if (this.isBound(account)) this.keepCodePhone(account, input.phone);
    this.accounts.set(storeKeyOf(account), account);
    if (!second) void this.mail?.send('welcome', { address: email }, { name: welcomeName(input.role, input.profile), email, role: WELCOME_ROLE[input.role] });
    // The phone that signs up is the first one the account works on: the number was proven by a code on it moments ago.
    const device = this.isBound(account) ? this.devices.add(account.accountId) : undefined;
    return { accountId: account.accountId, role: account.role, did, email, entityStatus, token: this.mint(account), ...(device ? { device } : {}), ...(second ? { linkPending: true } : {}) };
  }

  /**
   * A DRIVER SIGNS UP AS THEMSELVES (the user, 2026-10-23: drivers choose their PIN in the sign-up). The front page made
   * every driver choose an email and a password the Driver app never asks for — it opens with the phone and a PIN — so
   * the first time they opened it they proved the phone again and chose a PIN anyway. Now the person signs in first (a
   * code, a PIN, a recovery email: `identity/enroll`), and the driver is made under that sign-in. No email account.
   *
   * The details a driver gives can be refused as already registered — and that refusal names WHICH detail, so it is an
   * answer about somebody else's ID too. The email door counted those against the phone's verification; this one counts
   * them against the person, a few a day.
   */
  signUpDriver(personDid: string, phone: string, profile: Record<string, unknown>): { did: string; entityStatus?: string } {
    const person = this.persons.requireByDid(personDid);
    if (!person.pinHash) throw new GlosError('INVALID_STATE', 'Choose your PIN first: it is how you open the Driver app');
    if (!phone?.trim() || hashPhone(phone) !== person.phoneHash) {
      throw new GlosError('FORBIDDEN', 'Sign up with the phone number you signed in with', { field: 'phone' });
    }
    const now = Date.now();
    const tries = (this.driverRefusals.get(personDid) ?? []).filter((at) => now - at < DAY_MS);
    if (tries.length >= MAX_DRIVER_REFUSALS_PER_DAY) {
      throw new GlosError('RATE_LIMITED', 'Too many sign-ups refused today. Check your details and try again tomorrow, or write to us from the help.');
    }
    // The two photographs a driver who needs a licence check took while signing up: refused before anything is made.
    const sent = profile.kyc as { idCopyRef?: string; licenceCopyRef?: string } | undefined;
    const said = (profile.driver ?? {}) as { licenceClasses?: unknown };
    const classes = Array.isArray(said.licenceClasses) ? (said.licenceClasses as string[]) : [];
    const papers = sent && this.drivers.registryFor(classes as never) === 'heavy' ? this.drivers.assertSignupPapers(personDid, sent) : undefined;
    let provisioned: { did: string; entityStatus?: string };
    try {
      provisioned = this.provision('driver', { ...profile, kyc: undefined });
    } catch (err) {
      if (err instanceof GlosError && err.code === 'DUPLICATE') this.driverRefusals.set(personDid, [...tries, now]);
      throw err;
    }
    this.persons.attachRole(phone.trim(), 'driver', provisioned.did, undefined);
    if (papers) provisioned = { ...provisioned, entityStatus: this.drivers.sendSignupPapers(provisioned.did, personDid, papers).status };
    const address = this.persons.emailOf(this.persons.requireByDid(personDid));
    if (address) void this.mail?.send('welcome', { address }, { name: welcomeName('driver', profile), email: address, role: 'driver' });
    return provisioned;
  }
  /** Refused driver sign-ups per person, by time — the cap above. Kept in memory: a restart forgives, a day forgives too. */
  private readonly driverRefusals = new Map<string, number[]>();

  /**
   * A driver moved fleets: the account they sign in to by email carries the fleet as its tenant, and that is what
   * their next token is minted from — so it follows them, or an email sign-in would still open the old fleet.
   */
  /** A person's number moved: the email sign-ins that resolved to them by the old number resolve by the new one. */
  rephone(fromHash: string, toHash: string): void {
    if (!fromHash || !toHash) return;
    for (const account of this.accounts.values()) {
      if (account.phoneHash !== fromHash) continue;
      account.phoneHash = toHash;
      this.accounts.set(storeKeyOf(account), account);
    }
  }

  retenant(did: string, tenant: string | undefined): void {
    for (const account of this.accounts.values()) {
      if (account.did !== did || account.tenant === tenant) continue;
      account.tenant = tenant;
      this.accounts.set(storeKeyOf(account), account);
    }
  }

  /** The email behind an entity's DID — for the receipts a shop is sent about its own loads. Undefined for a store or a stranger. */
  /**
   * CL1 — the join key for "is this signed-in person the receiver of that load". A freight records its buyer
   * as a PHONE HASH and never as a party, so this is the only honest way to answer it.
   */
  phoneHashForDid(did: string): string | undefined {
    for (const account of this.accounts.values()) if (account.did === did) return account.phoneHash;
    return undefined;
  }

  emailForDid(did: string): string | undefined {
    for (const a of this.accounts.values()) if (a.did === did) return a.email;
    return undefined;
  }

  /** Verify credentials → an actor-scoped token (S2). Replaces the old ?<role>=<did> URL "session". */
  async login(email: string, password: string | undefined, device?: string, now: number = Date.now(), unlock?: string, role?: AccountRole): Promise<AccountSignIn> {
    // The password — or, 2026-11-02, the ticket a fingerprint or face on this phone was just checked for, in its place.
    // 2026-11-03 — of the kind the app is for, where one address signs in to several (its shop, its hub, its store).
    const account = this.passwordRight(email, password, { unlock, device, role });
    this.refuseUntilLinked(account, now);
    // A store signs in at its own door (storeLogin): one answer there for every account that is not a store's, and here the same.
    // The password was right, and is not enough on a phone or browser this shop never confirmed: a code goes to its number.
    if (this.isBound(account) && !this.devices.knows(account.accountId, device, now)) throw await this.deviceUnknown(account, now);
    if (device) this.devices.used(account.accountId, device, now);
    return { accountId: account.accountId, role: account.role, did: account.did, email: account.email, token: this.mint(account) };
  }

  /**
   * A SECOND KIND UNDER AN ADDRESS, NOT YET CLICKED "Yes, it is me": refused, after the right password, with the email sent
   * again if the last one is an hour old (or past its week) — a lost or late email is not a dead end.
   */
  private refuseUntilLinked(account: Account, now: number): void {
    if (!account.linkPending) return;
    const again = now - Date.parse(account.linkPending.askedAt) > LINK_RESEND_MS;
    if (again) {
      this.askYesItIsMe(account, account.linkPending.name ?? '', now);
      this.accounts.set(storeKeyOf(account), account);
    }
    throw new GlosError('LINK_PENDING', `This email signs in to another SeeBuyGet account too. Click “Yes, it is me” in the email ${again ? 'we have just sent again' : 'we sent'} to ${account.email}, then sign in here.`, { email: account.email, sentAgain: again });
  }

  /**
   * The password checked, wrong ones counted and locked — the first half of every door that takes one. `role`: a door
   * for one kind of account only (a store's), refused AFTER the password, exactly as a wrong one is, so an address of
   * another kind takes as long to refuse and is answered the same.
   *
   * 2026-11-02 — OR AN UNLOCK TICKET IN THE PASSWORD'S PLACE (`unlock`, with the device key it was made on): what a
   * fingerprint or face on one of this account's own phones was just checked for (PasskeyService). Taken here, so every
   * door keeps its own token, limits and lock: a locked sign-in answers a ticket as it answers a password; the ticket
   * opens only this account, at this address, on this device, with the passkey it was made with; the right one starts
   * the count of wrong passwords again, as the right password does. A ticket is long and random — nothing to guess, so
   * a wrong one is refused without being counted, and in the same words whether the address is anybody's or not.
   */
  private passwordRight(email: string, password: string | undefined, opts: { unlock?: string; device?: string; role?: AccountRole } = {}): Account {
    const key = (email || '').trim().toLowerCase();
    // A locked sign-in answers nobody — asked before the password is looked at, so the right one learns nothing either.
    this.tries.check(key);
    const account = this.find(key, opts.role);
    if (opts.unlock) {
      const grant = this.unlocks.take(opts.unlock);
      if (!account || !grant || !opts.device || grant.owner !== account.accountId || grant.address !== hashEmail(key) || grant.deviceHash !== deviceHashOf(opts.device) || (opts.role && account.role !== opts.role)) {
        throw new GlosError('UNLOCK_FAILED', 'That unlock has run out, or was used already. Unlock again, or use the password.');
      }
      if (this.devices.passkeyOf(account.accountId, opts.device)?.id !== grant.credentialId) {
        throw new GlosError('UNLOCK_OFF', 'Unlocking with fingerprint or face is off on this phone or browser. Use the password.');
      }
      this.tries.forget(key);
      return account;
    }
    if (!account || !this.verify(password ?? '', account) || (opts.role && account.role !== opts.role)) throw this.wrongPassword(key, account, password ?? '');
    this.tries.forget(key);
    return account;
  }

  /**
   * ITS OWNER CLOSED THEIR ACCOUNT (2026-10-22): every email-and-password sign-in made with their number goes — the
   * email it is kept under is theirs — with the phones and browsers it was confirmed on. Its sessions are ended by
   * the caller, with the person's.
   */
  forgetForPhone(phoneHash: string): number {
    let gone = 0;
    for (const account of [...this.accounts.values()]) {
      if (account.phoneHash !== phoneHash) continue;
      this.devices.forgetAll(account.accountId);
      this.accounts.delete(storeKeyOf(account));
      this.auth.revokeAll(account.did);
      gone += 1;
    }
    return gone;
  }

  /** The account an address signs in to — of this kind, where a door is one kind's (2026-11-03: one address, several kinds). */
  private find(email: string, role?: AccountRole): Account | undefined {
    const key = (email || '').trim().toLowerCase();
    const first = this.accounts.get(key);
    if (!role || first?.role === role) return first;
    return this.accounts.get(`${key}#${role}`);
  }

  private isBound(account: Account): boolean {
    return DEVICE_BOUND_ROLES.includes(account.role);
  }

  /**
   * A NEW PHONE OR BROWSER: a code to the shop's registered number, and the answer that says where it went. Asked again
   * within a minute, the code already sent stands rather than a second text. In a sandbox the code comes back, as every
   * sandbox code does; nothing is texted there.
   */
  private async deviceUnknown(account: Account, now: number): Promise<GlosError> {
    const party = PARTY[account.role];
    const phone = this.codePhoneOf(account);
    if (!phone) {
      /*
       * Round 40 — AN ACCOUNT WITH NO NUMBER YET (a hub or a store made before they were bound): the password was right, and
       * the number it gives now is the one its codes go to from now on — proven by a code to it before anything is kept.
       */
      const challenge = `dp_${randomBytes(12).toString('hex')}`;
      this.deviceCodes.set(challenge, { email: account.email, key: storeKeyOf(account), code: '', sentAt: now, expires: now + DEVICE_CODE_TTL_MS, attempts: 0, needsPhone: true });
      return new GlosError('DEVICE_NOT_KNOWN', `This ${party} has no phone number yet. Give it one: a code goes to it now, and from then on a new phone or browser is confirmed by a code to that number.`, { challenge, needsPhone: true });
    }
    const ending = phone.replace(/\D/g, '').slice(-3);
    const waiting = [...this.deviceCodes.entries()].find(([, c]) => c.email === account.email && c.expires > now && now - c.sentAt < DEVICE_CODE_COOLDOWN_MS);
    let challenge = waiting?.[0];
    let code = waiting?.[1].code;
    if (!challenge || !code) {
      const texts = this.sms?.sends() ?? false;
      // The owner's stand-in code: the number's own, as if texted (foundation/runtime/standin-code.ts).
      const standIn = standInCode(phone, texts);
      if (!standIn && !texts && !isSandbox()) return new GlosError('SMS_NOT_SENT', `This phone or browser has to be confirmed by a code to the ${party}’s number, and codes cannot be texted from this server yet.`);
      if (!standIn && texts && !this.sms?.mayGoTo(phone)) return new GlosError('PHONE_NOT_SERVED', `Codes are not texted to the ${party}’s number in that country.`);
      challenge = `dc_${randomBytes(12).toString('hex')}`;
      code = standIn ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
      this.deviceCodes.set(challenge, { email: account.email, key: storeKeyOf(account), code, sentAt: now, expires: now + DEVICE_CODE_TTL_MS, attempts: 0 });
      try {
        if (!standIn) await this.sms?.sendCode(phone, code, DEVICE_CODE_TTL_MS / 60_000);
      } catch (err) {
        this.deviceCodes.delete(challenge);
        return new GlosError('SMS_NOT_SENT', notSentWords(err, `The code to the ${party}’s number could not be texted. Try again in a minute.`));
      }
    }
    return new GlosError('DEVICE_NOT_KNOWN', `This phone or browser has not signed in to this ${party} before. A code went to the ${party}’s number ending ${ending}: type it here.`, {
      challenge,
      sentTo: `•••${ending}`,
      ...(isSandbox() ? { code } : {}),
    });
  }

  /**
   * Round 40 — AN ACCOUNT WITH NO NUMBER GIVES ONE: the challenge its sign-in was answered with, and the number. A code goes
   * to that number; typed on this phone or browser (confirmDevice), the number is kept and this one is the account's first.
   */
  async addDevicePhone(challenge: string, phone: string, now: number = Date.now()): Promise<{ challenge: string; sentTo: string; code?: string }> {
    const asked = this.deviceCodes.get(challenge);
    if (!asked || !asked.needsPhone || asked.expires < now) throw new GlosError('OTP_INVALID', 'That sign-in has expired: sign in again');
    const number = phone?.trim() ?? '';
    if (!isPlausiblePhone(number)) throw new GlosError('VALIDATION_FAILED', 'A phone number, with its country code: +254 712 345678', { field: 'phone' });
    if (asked.code && now - asked.sentAt < DEVICE_CODE_COOLDOWN_MS) throw new GlosError('RATE_LIMITED', 'A code was sent a moment ago: wait a minute before asking again');
    const texts = this.sms?.sends() ?? false;
    const standIn = standInCode(number, texts);
    if (!standIn && !texts && !isSandbox()) throw new GlosError('SMS_NOT_SENT', 'Codes cannot be texted from this server yet.');
    if (!standIn && texts && !this.sms?.mayGoTo(number)) throw new GlosError('PHONE_NOT_SERVED', 'Codes are not texted to numbers in that country.');
    const code = standIn ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    try {
      if (!standIn) await this.sms?.sendCode(number, code, DEVICE_CODE_TTL_MS / 60_000);
    } catch (err) {
      throw new GlosError('SMS_NOT_SENT', notSentWords(err, 'The code could not be texted. Try again in a minute.'));
    }
    Object.assign(asked, { code, phone: number, sentAt: now, expires: now + DEVICE_CODE_TTL_MS, attempts: 0 });
    const ending = number.replace(/\D/g, '').slice(-3);
    return { challenge, sentTo: `•••${ending}`, ...(isSandbox() ? { code } : {}) };
  }

  /** The code from the account's number, typed on the new phone or browser: it is one of the account's now, and signed in. */
  confirmDevice(challenge: string, code: string, now: number = Date.now()): AccountSignIn {
    const asked = this.deviceCodes.get(challenge);
    if (!asked || asked.expires < now) {
      this.deviceCodes.delete(challenge);
      throw new GlosError('OTP_INVALID', 'Wrong or expired code');
    }
    // No number given yet, so no code was sent: nothing to check, and the sign-in still waits for its number.
    if (asked.needsPhone && !asked.phone) throw new GlosError('OTP_INVALID', 'Wrong or expired code');
    if (!safeEqualText(asked.code, String(code ?? '').trim())) {
      asked.attempts += 1;
      if (asked.attempts >= DEVICE_CODE_TRIES) {
        this.deviceCodes.delete(challenge);
        throw new GlosError('OTP_LOCKED', 'Too many wrong codes. Sign in again for a new one.');
      }
      throw new GlosError('OTP_INVALID', 'Wrong or expired code');
    }
    this.deviceCodes.delete(challenge);
    const account = this.accounts.get(asked.key ?? asked.email);
    if (!account) throw new GlosError('OTP_INVALID', 'Wrong or expired code');
    // Round 40 — the number an account without one gave, proven by this code: its codes go there from now on.
    if (asked.needsPhone && asked.phone && !this.codePhoneOf(account)) {
      this.keepCodePhone(account, asked.phone);
      this.accounts.set(storeKeyOf(account), account);
    }
    const device = this.devices.add(account.accountId, now);
    return { accountId: account.accountId, role: account.role, did: account.did, email: account.email, token: this.mint(account), device };
  }

  /** The phones and browsers this shop works on, and which one is asking. Read by the shop itself. */
  devicesOf(did: string, device?: string, now: number = Date.now()): { count: number; here: boolean; unusedDays: number; devices: DeviceSeen[] } {
    const account = this.boundAccountOf(did);
    const devices = this.devices.list(account.accountId, device, now);
    return { count: devices.length, here: devices.some((d) => d.here), unusedDays: DEVICE_UNUSED_DAYS, devices };
  }

  /**
   * Every other phone and browser forgotten, with the password: each must be confirmed by a code again, and every
   * sign-in on them ends now. This one stays, signed in afresh.
   */
  forgetOtherDevices(did: string, password: string, device: string, now: number = Date.now()): AccountSignIn & { forgotten: number; kept: boolean } {
    const account = this.boundAccountOf(did);
    this.passwordRight(account.email, password);
    if (!this.devices.knows(account.accountId, device, now)) throw new GlosError('DEVICE_NOT_KNOWN', `This phone or browser is not one of the ${PARTY[account.role]}’s: sign in on it first.`);
    const forgotten = this.devices.forgetAll(account.accountId, device);
    this.auth.revokeAll(account.did);
    return { accountId: account.accountId, role: account.role, did: account.did, email: account.email, token: this.mint(account), forgotten, kept: true };
  }

  /** This phone or browser forgotten: signing in on it asks for a code again. */
  forgetThisDevice(did: string, device: string): { forgotten: boolean; which: number } {
    const account = this.boundAccountOf(did);
    return { forgotten: this.devices.forget(account.accountId, device), which: 0 };
  }

  private boundAccountOf(did: string): Account {
    const account = [...this.accounts.values()].find((a) => a.did === did);
    if (!account || !this.isBound(account)) throw new GlosError('NOT_FOUND', 'No account of this kind signs in here');
    return account;
  }

  /**
   * A WRONG PASSWORD: counted against the address that was typed, and answered. The fifth in a quarter of an hour
   * locks the sign-in — and the holder is told, because five wrong passwords at an account are either its holder,
   * who then knows why they cannot get in, or somebody else, which they would want to know.
   *
   * An address nobody holds is counted, locked and timed exactly like one somebody does: this door tells nobody
   * who has an account, by what it says or by how long it takes to say it.
   */
  private wrongPassword(key: string, account: Account | undefined, password: string): GlosError {
    if (!account) spendTime(password);
    const { error, locked } = this.tries.wrong(key);
    if (locked && account) {
      void this.mail?.send('password-locked', { address: account.email }, { email: account.email, app: ACCOUNT_APP[account.role], when: new Date().toISOString(), until: new Date(locked.until).toISOString(), recovery: 'self-reset' });
    }
    return error;
  }

  /**
   * Mint the shift-length actor token an app carries after sign-in/up.
   *
   * IT NAMES THE PERSON where the account knows one. A shopkeeper signing in with an email and password is
   * still a human being with a photo, a PIN and an address, and the account has carried their phone hash
   * since S20 precisely so this join can be made — without it their app would have an account menu that
   * answered 403 to everything.
   */
  private mint(account: Account): AccessToken {
    const person = account.phoneHash ? this.persons.findByHash(account.phoneHash) : undefined;
    return this.auth.mintActorToken({
      role: actorRoleForAccount(account.role),
      did: account.did,
      tenant: account.tenant,
      ...(person ? { personDid: person.personDid } : {}),
    });
  }

  /* ------------------------------------------------------------------ a store's own account -- */

  /**
   * WHAT STOPS A STORE'S ACCOUNT BEING MADE — asked BEFORE the store itself is registered, so that an email somebody
   * already holds does not leave a store behind it with no way in.
   */
  checkNewAccount(email: string | undefined, password: string | undefined, name?: string, role: AccountRole = 'vendor'): string {
    const address = (email || '').trim().toLowerCase();
    if (!address.includes('@')) throw new GlosError('EMAIL_INVALID', 'A valid email is required');
    assertPassword(password, [address, name]);
    this.secondKind(address, role);
    return address;
  }

  /**
   * 2026-11-03 — WHETHER AN ADDRESS SIGNS IN TO ANOTHER KIND OF ACCOUNT ALREADY. Then this one is kept beside it, and signs in
   * once its owner clicked "Yes, it is me" in the email (askYesItIsMe). The same kind twice is refused, saying which.
   */
  private secondKind(email: string, role: AccountRole): boolean {
    const first = this.accounts.get(email);
    if (first?.role === role || this.accounts.has(`${email}#${role}`)) {
      throw new GlosError('DUPLICATE', `This email already signs in to a SeeBuyGet ${PARTY[role]}. Sign in to it, or use another email.`, { field: 'email', register: 'account', kind: PARTY[role] });
    }
    return Boolean(first);
  }

  /** The email that asks its owner "Is this you?": its button links this account to the one the address had already. */
  private askYesItIsMe(account: Account, name: string, now: number = Date.now()): void {
    const token = randomBytes(24).toString('base64url');
    account.linkPending = { token, askedAt: new Date(now).toISOString(), ...(name ? { name } : {}) };
    const first = this.accounts.get(account.email);
    void this.mail?.send('yes-it-is-me', { address: account.email }, { email: account.email, name, kind: PARTY[account.role], other: first ? PARTY[first.role] : 'account', url: `${appUrl('home')}#link=${token}` });
  }

  /**
   * The click on "Yes, it is me" (the front page, #link=…): the second kind under the address is its owner's, and signs in
   * from now on. A week to click it; once used it is spent.
   */
  confirmLink(token: string, now: number = Date.now()): { email: string; kind: string; role: AccountRole } {
    for (const account of this.accounts.values()) {
      if (!account.linkPending || account.linkPending.token !== token) continue;
      if (now - Date.parse(account.linkPending.askedAt) > LINK_TTL_MS) throw new GlosError('LINK_EXPIRED', 'This link is more than a week old. Sign in with the email and password you chose, and a new one is sent.');
      const name = account.linkPending.name;
      account.linkPending = undefined;
      account.linkedAt = new Date(now).toISOString();
      this.accounts.set(storeKeyOf(account), account);
      // The click proved the address: email to it works, and the welcome held back at sign-up follows.
      this.mail?.addressWorks(account.email);
      void this.mail?.send('welcome', { address: account.email }, { name: name || account.email, email: account.email, role: WELCOME_ROLE[account.role as keyof typeof WELCOME_ROLE] ?? 'store' });
      return { email: account.email, kind: PARTY[account.role], role: account.role };
    }
    throw new GlosError('NOT_FOUND', 'This link has been used already, or is not one of ours.');
  }

  /**
   * A STORE'S OWN ACCOUNT (the user, 2026-10-09: "store needs a email and password account setup").
   *
   * A store signed in to its console with its store id and its SIGNING SECRET: a machine credential doing a
   * person's job. It was kept on the device so the console could sign itself back in; whoever stood at the counter
   * held it; and a store that lost it was locked out for good, because replacing the secret asked for the secret.
   * So a store gets what a shop and a hub have — an email and a password, changed with the current one, reset by a
   * code sent to the address — and the secret goes back to being what it is for: its own systems.
   *
   * No phone is asked for: a store is a business with an inbox. Where its operator gave their number, the account
   * carries it, and the same person is one person across the apps.
   */
  setUpStore(input: { did: string; name: string; email: string; password: string; phone?: string; phoneVerified?: boolean }): { accountId: string; role: AccountRole; did: string; email: string; token: AccessToken; device?: string; linkPending?: boolean } {
    const email = this.checkNewAccount(input.email, input.password, input.name);
    const second = Boolean(this.accounts.get(email));
    if (this.emailForDid(input.did)) throw new GlosError('CONFLICT', 'This store already has an account: sign in with its email and password');
    const salt = randomBytes(16).toString('hex');
    const account: Account = {
      accountId: `acc_${randomBytes(8).toString('hex')}`,
      email,
      role: 'vendor',
      salt,
      hash: this.hash(input.password, salt),
      did: input.did,
      ...(input.phone?.trim() ? { phoneHash: hashPhone(input.phone) } : {}),
      createdAt: new Date().toISOString(),
      ...(second ? { alias: true as const } : {}),
    };
    if (second) this.askYesItIsMe(account, input.name);
    // Round 40 — a number verified at sign-up is where this store's codes go, and the phone or browser that signed up is its first.
    // `phoneVerified`: the caller read it before the store's person was made (pudo.controller registerVendor).
    const verified = Boolean(input.phone?.trim() && (input.phoneVerified ?? this.otp.isVerified(input.phone)));
    if (verified) {
      this.keepCodePhone(account, input.phone!);
      this.otp.consume(input.phone!);
    }
    this.accounts.set(storeKeyOf(account), account);
    if (!second) void this.mail?.send('welcome', { address: email }, { name: input.name, email, role: 'store' });
    const device = verified ? this.devices.add(account.accountId) : undefined;
    return { accountId: account.accountId, role: account.role, did: account.did, email, token: this.mint(account), ...(device ? { device } : {}), ...(second ? { linkPending: true } : {}) };
  }

  /**
   * SIGN A STORE IN by its account. One answer for a wrong password, an email nobody holds, and an email that is a
   * shop's or a courier's: this door tells nobody which accounts exist, or what kind they are.
   */
  async storeLogin(email: string, password: string | undefined, device?: string, now: number = Date.now(), unlock?: string): Promise<{ accountId: string; role: AccountRole; did: string; email: string; token: AccessToken }> {
    // The password is checked BEFORE the kind of account is looked at: a shop's address must take as long to refuse
    // as a wrong password does. It is the same count as the shops' own door — one address, one set of tries. And it is
    // the same check (2026-11-02): the password, or the ticket a fingerprint or face on this device unlocked.
    const account = this.passwordRight(email, password, { unlock, device, role: 'vendor' });
    this.refuseUntilLinked(account, now);
    // Round 40 — the password was right, and is not enough on a phone or browser this store never confirmed.
    if (!this.devices.knows(account.accountId, device, now)) throw await this.deviceUnknown(account, now);
    if (device) this.devices.used(account.accountId, device, now);
    return { accountId: account.accountId, role: account.role, did: account.did, email: account.email, token: this.mint(account) };
  }

  /**
   * IS THIS THE PASSWORD OF THE ACCOUNT BEHIND THAT DID? For a second proof from somebody already signed in — a
   * console left open is not proof that the person at it holds the account.
   */
  passwordOpens(did: string, password: string | undefined): boolean {
    for (const account of this.accounts.values()) {
      if (account.did !== did) continue;
      // The same count as the sign-in: a console left open must not be a quieter place to guess the password from.
      this.tries.check(account.email);
      if (this.verify(password ?? '', account)) {
        this.tries.forget(account.email);
        return true;
      }
      const { error, locked } = this.tries.wrong(account.email);
      if (!locked) return false;
      void this.mail?.send('password-locked', { address: account.email }, { email: account.email, app: ACCOUNT_APP[account.role], when: new Date().toISOString(), until: new Date(locked.until).toISOString(), recovery: 'self-reset' });
      throw error;
    }
    return false;
  }

  /** Issue a password-reset token (returned for the sandbox — would be emailed in production). */
  forgot(email: string, role?: AccountRole): { sent: boolean; resetToken?: string } {
    // 2026-11-03 — of the kind the app is for, where one address signs in to several.
    const account = this.find(email, role);
    if (!account) return { sent: false }; // do not reveal which emails exist
    account.resetToken = newResetCode();
    account.resetExpires = Date.now() + RESET_TTL_MS;
    this.accounts.set(storeKeyOf(account), account); // persist the reset token
    void this.mail?.send('password-reset', { address: account.email }, { email: account.email, code: account.resetToken!, minutes: RESET_TTL_MS / 60_000, app: ACCOUNT_APP[account.role] });
    return { sent: true, resetToken: account.resetToken };
  }

  /**
   * Change your own password — proven with the CURRENT one, never with a session: a tablet left signed in at a
   * counter is not proof that the person at it holds the account. Every other session is signed out, and the
   * device that made the change is handed a fresh sign-in.
   */
  changePassword(email: string, current: string, next: string, device?: string, role?: AccountRole): { accountId: string; role: AccountRole; did: string; email: string; token: AccessToken } {
    const key = (email || '').trim().toLowerCase();
    // This route proves itself with the current password, so it is a place to guess it: the same count as the sign-in.
    this.tries.check(key);
    const account = this.find(key, role);
    if (!account || !this.verify(current, account)) throw this.wrongPassword(key, account, current);
    this.tries.forget(key);
    // It hands back a sign-in, so for a bound account it is a door like any other: only on a phone the shop confirmed.
    // Asked AFTER the password, as the sign-in asks it — before, a shop's address answered differently from anybody's.
    if (this.isBound(account) && !this.devices.knows(account.accountId, device)) {
      throw new GlosError('DEVICE_NOT_KNOWN', `Change the password from a phone or browser the ${PARTY[account.role]} has signed in on.`);
    }
    assertPassword(next, [account.email]);
    if (this.verify(next, account)) throw new GlosError('VALIDATION_FAILED', 'Choose a password different from the current one');
    account.salt = randomBytes(16).toString('hex');
    account.hash = this.hash(next, account.salt);
    account.passwordChangedAt = new Date().toISOString();
    account.resetToken = undefined;
    account.resetExpires = undefined;
    this.accounts.set(storeKeyOf(account), account);
    this.auth.revokeAll(account.did);
    this.dropPasskeys(account);
    this.tellPasswordChanged(account);
    return { accountId: account.accountId, role: account.role, did: account.did, email: account.email, token: this.mint(account) };
  }

  reset(token: string, password: string): { ok: boolean } {
    const code = readResetCode(token);
    const account = code ? [...this.accounts.values()].find((a) => a.resetToken && a.resetToken === code) : undefined;
    if (!account || !account.resetExpires || account.resetExpires < Date.now()) throw new GlosError('WINDOW_EXPIRED', 'Invalid or expired reset token');
    // The same rules as wherever a password is chosen. (The code is not used up by a refusal: the person types
    // another password and carries on.)
    assertPassword(password, [account.email]);
    account.salt = randomBytes(16).toString('hex');
    account.hash = this.hash(password, account.salt);
    account.resetToken = undefined;
    account.resetExpires = undefined;
    account.passwordChangedAt = new Date().toISOString();
    this.accounts.set(storeKeyOf(account), account); // persist the new password hash
    // Whoever had the old password — which is presumably why it was reset — is signed out everywhere, and no fingerprint
    // they may have turned on with it opens the account any more.
    this.auth.revokeAll(account.did);
    this.dropPasskeys(account);
    // THE HOLDER'S OWN WAY BACK: a code that reached the address opens a locked sign-in at once, and the count of
    // wrong tries starts again. Nobody who is only guessing can do this.
    this.tries.forget(account.email);
    // The reset code reached them and was typed in: email to this address works, whatever came back before.
    this.mail?.addressWorks(account.email);
    this.tellPasswordChanged(account);
    return { ok: true };
  }

  /* ------------------------------ 2026-11-02: unlock with fingerprint or face, on the account's own phones -- */

  /**
   * A PASSWORD CHANGED OR RESET takes every passkey made with the old one off every phone (passkeys.ts): a password
   * somebody else may have learnt must not outlive being changed by way of a fingerprint it let them turn on. The phones
   * stay the account's own; turning it on again takes the new password.
   */
  private dropPasskeys(account: Account): void {
    this.devices.dropAllPasskeys(account.accountId);
    this.unlocks.dropFor(account.accountId);
  }

  /** Settings: the signed-in shop, hub or store — is this phone one of its own, and is a passkey on it? */
  passkeyHere(did: string, device: string | undefined): { known: boolean; passkey?: DevicePasskey; accountId: string; counterAt?: string } {
    const account = this.boundAccountOf(did);
    const known = this.devices.knows(account.accountId, device);
    const passkey = known ? this.devices.passkeyOf(account.accountId, device) : undefined;
    // 2026-11-02 — colleagues have opened counter sessions on this phone: it is not one for the account's fingerprint.
    const counterAt = known ? this.devices.counterAtOf(account.accountId, device) : undefined;
    return { known, accountId: account.accountId, ...(passkey ? { passkey } : {}), ...(counterAt ? { counterAt } : {}) };
  }

  /**
   * A COLLEAGUE OPENED A COUNTER SESSION — at a shop's counter or on a hub's floor — on a browser holding these keys (the
   * owner, 2026-11-02: "a 1 person shop could use fingerprint to unlock as you said"). Each of them that is one of the
   * place's own phones is noted as a phone colleagues use, and any fingerprint-or-face unlock on it is taken off at once,
   * with every ticket it handed out: whoever can unlock that phone could otherwise sign in as the shop. What was taken
   * off, by when each phone was confirmed, for the caller to tell the account. Nothing at all for a place with no
   * account of its own, or keys that are none of its phones.
   */
  counterSessionOn(did: string, keys: string[] | undefined, now: number = Date.now()): { role: AccountRole; dropped: string[] } | undefined {
    const account = [...this.accounts.values()].find((a) => a.did === did);
    if (!account || !this.isBound(account)) return undefined;
    const dropped: string[] = [];
    for (const key of (keys ?? []).slice(0, 20)) {
      const seen = this.devices.noteCounter(account.accountId, key, now);
      if (seen?.dropped) dropped.push(seen.addedAt);
    }
    if (dropped.length) this.unlocks.dropFor(account.accountId);
    return { role: account.role, dropped };
  }

  /**
   * Settings: the password again, from somebody already signed in — a phone left open at a counter is not proof of who
   * holds the account. The sign-in's count and lock; a wrong one is PASSWORD_WRONG (403), never a sign-out.
   */
  confirmPassword(did: string, password: string): void {
    if (!this.passwordOpens(did, password)) throw new GlosError('PASSWORD_WRONG', 'That is not the password');
  }

  /** Turn it on, on one of the account's own phones. The caller checked the password and the phone's answer. */
  setPasskey(did: string, device: string, passkey: DevicePasskey): boolean {
    return this.devices.setPasskey(this.boundAccountOf(did).accountId, device, passkey);
  }

  /** Turn it off on this phone — and every unlock it handed out goes too. The phone stays one of the account's. */
  dropPasskey(did: string, device: string | undefined): DevicePasskey | undefined {
    const account = this.boundAccountOf(did);
    const dropped = this.devices.dropPasskey(account.accountId, device);
    if (dropped) this.unlocks.dropFor(account.accountId);
    return dropped;
  }

  /**
   * A sign-in screen: the passkey a fingerprint or face would answer for — only for an account whose phones are its own,
   * only on one of them, only where one was turned on. Anything else is undefined, whichever of those it was: the caller
   * answers them all alike, and so says nothing about whether the address is anybody's.
   */
  unlockTarget(email: string, device: string | undefined): { accountId: string; passkey: DevicePasskey } | undefined {
    const account = this.accounts.get((email || '').trim().toLowerCase());
    if (!account || !this.isBound(account)) return undefined;
    const passkey = this.devices.passkeyOf(account.accountId, device);
    return passkey ? { accountId: account.accountId, passkey } : undefined;
  }

  /** Is this address's sign-in locked by wrong passwords? Asked of any address, an account's or not, as the sign-in asks. */
  assertNotLocked(email: string): void {
    this.tries.check((email || '').trim().toLowerCase());
  }

  /**
   * AN UNLOCK THAT DID NOT CHECK OUT, on one of the account's own phones: counted with the wrong passwords, against the
   * same lock — the fifth locks it, and its holder is told, as for a password.
   */
  failedUnlock(email: string): never {
    const key = (email || '').trim().toLowerCase();
    const { error, locked } = this.tries.wrong(key);
    const account = this.accounts.get(key);
    if (locked && account) {
      void this.mail?.send('password-locked', { address: account.email }, { email: account.email, app: ACCOUNT_APP[account.role], when: new Date().toISOString(), until: new Date(locked.until).toISOString(), recovery: 'self-reset' });
    }
    if (locked) throw error;
    throw new GlosError('UNLOCK_FAILED', 'The fingerprint or face unlock did not check out. Try again, or use the password.');
  }

  /** It unlocked: the phone's counter as it now stands, and the day. */
  passkeyUsed(accountId: string, device: string, counter: number): void {
    this.devices.passkeyUsed(accountId, device, counter);
  }

  /** The phone's fingerprint or face checked out: a ticket for the sign-in door, two minutes, one use. */
  issueUnlock(email: string, accountId: string, device: string, credentialId: string, now: number = Date.now()): string {
    const key = (email || '').trim().toLowerCase();
    return this.unlocks.issue({ owner: accountId, address: hashEmail(key), deviceHash: deviceHashOf(device), credentialId, expiresAt: now + UNLOCK_TTL_MS }, now);
  }

  // --- internals ---

  /** A password changed — always said to its holder, with how to take the account back if it was not them. */
  private tellPasswordChanged(account: Account): void {
    void this.mail?.send('password-changed', { address: account.email }, { email: account.email, when: account.passwordChangedAt ?? new Date().toISOString(), app: ACCOUNT_APP[account.role], recovery: 'self-reset' });
  }

  private provision(role: AccountRole, profile: Record<string, unknown>): { did: string; entityStatus?: string; tenant?: string } {
    // A store is registered at its own door (vendors), which makes its account in the same act (`setUpStore`).
    if (role === 'vendor') throw new GlosError('VALIDATION_FAILED', 'A store is registered from the Store app, not here');
    if (role === 'pudo') {
      const agent = this.agents.register((profile.agent ?? {}) as never);
      if (profile.kyc) this.agents.submitKyc(agent.did, profile.kyc as never);
      return { did: agent.did, entityStatus: this.agents.get(agent.did).status };
    }
    if (role === 'driver') {
      /*
       * NOBODY SIGNS THEMSELVES INTO A FLEET.
       *
       * This took the fleet's code and made whoever typed it that fleet's driver. The code names a company at its
       * own sign-in, it is handed round a depot, and it is six characters long: a stranger could guess or borrow
       * their way onto somebody's trucks and licence. A fleet takes a driver on itself — it adds a new one, or
       * offers a place to one already registered, who says yes from their own app.
       */
      if (profile.fleetCode) {
        throw new GlosError('FORBIDDEN', 'A fleet adds its own drivers. Sign up on your own, then give the fleet office the phone number you sign in with — they offer you a place and you say yes in the app.', { field: 'fleetCode' });
      }
      // `managerDid` is SET to nothing, never left out: the form is a client's object, and a fleet named inside it
      // would otherwise ride straight through to the register — the same signing-in, without even the code.
      const driver = this.drivers.register({ ...(profile.driver as object), managerDid: undefined } as never);
      /*
       * A SELF-EMPLOYED COURIER ARRIVES WITH THEIR OWN VEHICLE, OR THEY ARRIVE UNABLE TO WORK.
       *
       * This branch existed and nothing ever reached it: the front door never collected a vehicle, so a
       * courier who signed up independently landed on a screen telling them to scan the sticker on a
       * dashboard — and the only stickers in the network belonged to vehicles a FLEET had registered.
       * The honest reading of that is the one the user reached: you can only join through a fleet.
       *
       * Three things are settled here rather than trusted to the form.
       *
       * The OWNER is the driver. It is their van; `driver_owned` is what the vehicle record is for, and
       * the name on it is theirs rather than whatever a client chose to send.
       *
       * The CLASS MUST BE ONE THEY ARE CLEARED FOR. Registering a van while licensed only for a bicycle
       * produced an account that passed every check at signup and was refused at the first coupling —
       * "Driver is not licence-cleared for a van" — with a vehicle already in the network. Refusing it
       * here costs a sentence; refusing it later costs somebody their first morning.
       *
       * And it becomes a vehicle they can START ON today, not one they must have driven before.
       */
      if (profile.vehicle) {
        const wanted = profile.vehicle as { vehicleClass?: string };
        if (wanted.vehicleClass && !driver.licence.classes.includes(wanted.vehicleClass as never)) {
          throw new GlosError('CANNOT_COUPLE', `You are not licence-cleared for a ${wanted.vehicleClass}. Add it to what you can drive, or register a vehicle you are cleared for`);
        }
        // Theirs, and nobody else's: no fleet (whatever the form says), and the courier recorded as the one who drives it.
        const vehicle = this.vehicles.register({ ...(profile.vehicle as object), managerDid: undefined, ownerType: 'driver_owned', ownerName: driver.displayName, ownerDriverDid: driver.did, country: driver.jurisdiction } as never);
        this.fleet.claimOwnVehicle(driver.did, vehicle.vehicleId);
      }
      if (profile.kyc && driver.registry === 'heavy') this.drivers.submitKyc(driver.did, profile.kyc as never);
      return { did: driver.did, entityStatus: this.drivers.get(driver.did).status };
    }
    if (role === 'mdp') {
      // A hub that signs itself up is vetted from its papers before it works (the ISO 28000 check: "hubs are not vetted").
      const mdp = this.mdps.register((profile.mdp ?? {}) as never, 'joining');
      return { did: mdp.did, entityStatus: mdp.vetting?.state }; // the real DID now (was the mdp_<hex> id — a type lie)
    }
    throw new GlosError('UNKNOWN_ROLE', `Unknown account role: ${role}`);
  }

  private hash(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString('hex');
  }
  private verify(password: string, account: Account): boolean {
    const candidate = this.hash(password || '', account.salt);
    const a = Buffer.from(candidate, 'hex');
    const b = Buffer.from(account.hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Used only by tests to confirm an account exists. */
  has(email: string): boolean {
    return this.accounts.has((email || '').trim().toLowerCase());
  }
}

/** The name a welcome greets: the shop's or hub's name, or the driver's. */
function welcomeName(role: AccountRole, profile: Record<string, unknown>): string {
  const pick = (section: string, ...keys: string[]) => {
    const block = (profile?.[section] ?? {}) as Record<string, unknown>;
    for (const k of keys) if (typeof block[k] === 'string' && (block[k] as string).trim()) return (block[k] as string).trim();
    return undefined;
  };
  const name = role === 'pudo' ? pick('agent', 'shopName') : role === 'mdp' ? pick('mdp', 'name') : pick('driver', 'displayName', 'fullName');
  return name ?? 'there';
}

/** Two codes compared in constant time. */
function safeEqualText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
