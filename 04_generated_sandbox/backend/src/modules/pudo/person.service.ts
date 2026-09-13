import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DidService } from '../../foundation/did/did.service';
import { AuthService } from '../../foundation/auth/auth.service';
import { AccessToken } from '../../foundation/auth/auth.types';
import { hashPhone, isPlausiblePhone } from '../../foundation/identity/phone';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { MediaService } from './media.service';
import { Person, PersonRole, PersonView, ROLE_TO_ACTOR, RoleLink, toView } from './person.types';

/** Wrong-PIN attempts before the PIN is locked and a fresh OTP is required. */
const MAX_PIN_ATTEMPTS = 5;
/** How long a locked PIN stays locked. A person can always re-enter by re-verifying their phone (OTP). */
const PIN_LOCK_MS = 15 * 60 * 1000;
/** A 4-digit numeric PIN — the BondBridge credential shape, chosen for a phone-first consumer. */
const PIN_RE = /^\d{4}$/;

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
  // Derived index personDid → phoneHash, so an authenticated request (token.did = personDid) resolves
  // in O(1). Rebuilt from the durable map at construction and kept in step on every save().
  private readonly byDid = new Map<string, string>();

  constructor(
    private readonly dids: DidService,
    private readonly auth: AuthService,
    private readonly vault: IdentityVault,
    private readonly media: MediaService,
  ) {
    for (const p of this.persons.values()) this.byDid.set(p.personDid, p.phoneHash);
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
  setProfile(personDid: string, input: { displayName?: string; avatarMediaId?: string }): Person {
    const person = this.requireByDid(personDid);

    if (input.displayName !== undefined) {
      const name = input.displayName.trim();
      if (!name) throw new GlosError('FIELD_REQUIRED', 'A display name cannot be empty');
      if (name.length > 80) throw new GlosError('INVALID_INPUT', 'That name is too long');
      // Update in place when the vault entry still exists; otherwise (re)create it. The vault store is
      // in-memory while person.vaultRef is persisted, so after a restart a stale ref must re-seed rather
      // than throw NotFoundException out of vault.update() — see profile() for the read side of this.
      if (person.vaultRef && this.vault.exists(person.vaultRef)) this.vault.update(person.vaultRef, { fullName: name });
      else person.vaultRef = this.vault.store({ fullName: name }, { region: 'local' }).vaultRef;
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
   * Reveal is guarded by vault.exists(): the vault store is in-memory but person.vaultRef is persisted,
   * so after a restart a stale ref must degrade to "no name" rather than throw and 404 the whole
   * authenticated surface (this method is on the hot path of me/enroll/login/setProfile).
   */
  profile(person: Person): { displayName?: string; avatarMediaId?: string } {
    const displayName = person.vaultRef && this.vault.exists(person.vaultRef)
      ? this.vault.reveal(person.vaultRef, { purpose: 'self-profile', requesterDid: person.personDid }).fullName
      : undefined;
    return { displayName, avatarMediaId: person.avatarMediaId };
  }

  /** The full self-view: the PII-free projection plus the revealed profile. For the acting person ONLY. */
  view(person: Person): PersonView {
    return { ...toView(person), ...this.profile(person) };
  }

  // --- consumer auth (phone + OTP → PIN) ---

  /**
   * Enroll (or return) the consumer for an OTP-verified phone. Requires the phone to have been verified
   * through the OtpService already (the controller runs the OTP step first, exactly as signup does), so
   * this never trusts an unverified number. Optionally sets the PIN in the same step (the phone-first
   * happy path). Returns a consumer actor token.
   */
  enroll(phone: string, otpVerified: boolean, pin?: string): { person: Person; isNew: boolean; token: AccessToken } {
    if (!otpVerified) throw new GlosError('PHONE_NOT_VERIFIED', 'Verify your phone number first');
    const isNew = !this.findByPhone(phone);
    const person = this.attachRole(phone, 'consumer', ''); // entityDid resolved to personDid inside
    if (pin !== undefined) this.setPin(person.personDid, pin);
    return { person: this.requireByDid(person.personDid), isNew, token: this.mintConsumerToken(person) };
  }

  /** Set or change the person's 4-digit PIN (scrypt-hashed) and clear any lockout. */
  setPin(personDid: string, pin: string): void {
    if (!PIN_RE.test(pin || '')) throw new GlosError('PIN_INVALID', 'PIN must be exactly 4 digits');
    const person = this.requireByDid(personDid);
    person.pinSalt = randomBytes(16).toString('hex');
    person.pinHash = this.hashPin(pin, person.pinSalt);
    person.pinAttempts = 0;
    person.pinLockedUntil = undefined;
    person.pinChangedAt = new Date().toISOString();
    this.save(person);
  }

  /**
   * Reopen the app with a phone + PIN — no OTP. Rate-limited: after MAX_PIN_ATTEMPTS wrong tries the PIN
   * locks for PIN_LOCK_MS and the person must re-verify by OTP (a 4-digit PIN is only 10⁴ wide, so the
   * lockout is the credential's real strength). Returns a consumer actor token.
   */
  loginWithPin(phone: string, pin: string): { person: Person; token: AccessToken } {
    const person = this.findByPhone(phone);
    // Do not reveal whether the phone is registered — same error either way.
    if (!person || !person.pinHash || !person.pinSalt) throw new GlosError('AUTH_FAILED', 'Wrong phone or PIN');
    if (person.pinLockedUntil && person.pinLockedUntil > Date.now()) {
      throw new GlosError('PIN_LOCKED', 'Too many wrong PINs. Verify your phone by code to sign in.');
    }
    // The lockout has elapsed → grant a fresh attempt window rather than re-locking on the first miss.
    if (person.pinLockedUntil) {
      person.pinAttempts = 0;
      person.pinLockedUntil = undefined;
      this.save(person);
    }
    if (!this.verifyPin(pin, person)) {
      person.pinAttempts = (person.pinAttempts ?? 0) + 1;
      if (person.pinAttempts >= MAX_PIN_ATTEMPTS) person.pinLockedUntil = Date.now() + PIN_LOCK_MS;
      this.save(person);
      throw new GlosError('AUTH_FAILED', 'Wrong phone or PIN');
    }
    if (person.pinAttempts || person.pinLockedUntil) {
      person.pinAttempts = 0;
      person.pinLockedUntil = undefined;
      this.save(person);
    }
    return { person, token: this.mintConsumerToken(person) };
  }

  /**
   * Change your PIN — proven with the CURRENT PIN, through the same check sign-in uses, so a wrong guess here counts
   * toward the lockout exactly as it would at the door. Every other session is signed out; this device gets a fresh one.
   */
  changePin(phone: string, currentPin: string, newPin: string): { person: Person; token: AccessToken } {
    const { person } = this.loginWithPin(phone, currentPin);
    if (currentPin === newPin) throw new GlosError('PIN_INVALID', 'Choose a PIN different from the current one');
    this.setPin(person.personDid, newPin);
    this.auth.revokeAll(person.personDid);
    const updated = this.requireByDid(person.personDid);
    return { person: updated, token: this.mintConsumerToken(updated) };
  }

  // --- role switching ---

  /** The person's default identity token — acting as themselves (the consumer surface). */
  mintConsumerToken(person: Person): AccessToken {
    return this.auth.mintActorToken({ role: 'consumer', did: person.personDid });
  }

  /**
   * "Act as: Me · Driver · Shop." Mint an actor token for a role the person holds — the same token the
   * role's own app carries, with that role's scopes and tenant. The person is allowed to mint it purely
   * because they hold the (active) RoleLink; no new authz.
   */
  mintForRole(person: Person, role: PersonRole): { role: PersonRole; entityDid: string; token: AccessToken } {
    const link = person.roles.find((r) => r.role === role && r.status === 'active');
    if (!link) throw new GlosError('ROLE_NOT_HELD', `You do not hold an active ${role} role`);
    const token = role === 'consumer'
      ? this.mintConsumerToken(person)
      : this.auth.mintActorToken({ role: ROLE_TO_ACTOR[role], did: link.entityDid, tenant: link.tenant });
    return { role, entityDid: link.entityDid, token };
  }

  // --- migration (fold existing role accounts onto persons by phone) ---

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
