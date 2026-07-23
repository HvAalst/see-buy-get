import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AuthService } from '../../foundation/auth/auth.service';
import { AccessToken } from '../../foundation/auth/auth.types';
import { DidService } from '../../foundation/did/did.service';
import { hashPhone, isPlausiblePhone } from '../../foundation/identity/phone';
import { AgentService } from './agent.service';
import { DriverService } from './driver.service';
import { MdpService } from './mdp.service';
import { VehicleService } from './vehicle.service';
import { FleetManagerService } from './fleet-manager.service';
import { OtpService } from './otp.service';
import { PersonService } from './person.service';
import { PersonRole } from './person.types';
import { actorRoleForAccount } from './roles.map';

export type AccountRole = 'pudo' | 'driver' | 'mdp';

/** A PUDO account role → the person-facing role it links to (a 'pudo' account IS an agent). */
const ACCOUNT_TO_PERSON_ROLE: Record<AccountRole, PersonRole> = { pudo: 'agent', driver: 'driver', mdp: 'mdp' };

interface Account {
  accountId: string;
  email: string;
  role: AccountRole;
  salt: string;
  hash: string;
  did: string; // the linked domain entity's real DID (agent / driver / MDP)
  tenant?: string; // for a fleet driver: the owning manager's DID (the token's tenant boundary)
  phoneHash?: string; // S20: the person join key captured at signup, so this login resolves to a person
  createdAt: string;
  resetToken?: string;
  resetExpires?: number;
}

const RESET_TTL_MS = 30 * 60 * 1000;

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

  constructor(
    private readonly agents: AgentService,
    private readonly drivers: DriverService,
    private readonly mdps: MdpService,
    private readonly vehicles: VehicleService,
    private readonly managers: FleetManagerService,
    private readonly otp: OtpService,
    private readonly auth: AuthService,
    private readonly persons: PersonService,
    private readonly dids: DidService,
  ) {}

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
  }

  /** Best-effort raw phone for an account: the hash captured at signup can't be reversed, so fall back
   *  to the phone embedded in the linked entity's DID controller (`pudo:<mobile>` etc.). */
  private phoneForAccount(account: Account): string | undefined {
    const controller = this.dids.resolve(account.did)?.controller ?? '';
    const raw = controller.slice(controller.indexOf(':') + 1); // 'pudo-driver:+254…' → '+254…'
    return isPlausiblePhone(raw) ? raw : undefined;
  }

  /** Create a participant account + its domain entity from the sign-up wizard. Requires a verified phone. */
  signup(input: { role: AccountRole; email: string; password: string; phone: string; profile: Record<string, unknown> }): { accountId: string; role: AccountRole; did: string; email: string; entityStatus?: string; token: AccessToken } {
    const email = (input.email || '').trim().toLowerCase();
    if (!email.includes('@')) throw new GlosError('EMAIL_INVALID', 'A valid email is required');
    if ((input.password || '').length < 6) throw new GlosError('PASSWORD_TOO_SHORT', 'Password must be at least 6 characters');
    if (!input.phone?.trim()) throw new GlosError('PHONE_REQUIRED', 'A phone number is required');
    if (!this.otp.isVerified(input.phone)) throw new GlosError('PHONE_NOT_VERIFIED', 'Verify your phone number first');
    if (this.accounts.has(email)) throw new GlosError('DUPLICATE', 'An account with this email already exists');

    const { did, entityStatus, tenant } = this.provision(input.role, input.profile);
    // S20: link this role to the person identity by phone (best-effort — never blocks the signup) and
    // remember the join key on the account so the same human is never asked to make a second account.
    this.persons.tryAttachRole(input.phone, ACCOUNT_TO_PERSON_ROLE[input.role], did, tenant);
    this.otp.consume(input.phone); // one verification → one account
    const salt = randomBytes(16).toString('hex');
    const account: Account = { accountId: `acc_${randomBytes(8).toString('hex')}`, email, role: input.role, salt, hash: this.hash(input.password, salt), did, tenant, phoneHash: hashPhone(input.phone), createdAt: new Date().toISOString() };
    this.accounts.set(email, account);
    return { accountId: account.accountId, role: account.role, did, email, entityStatus, token: this.mint(account) };
  }

  /** Verify credentials → an actor-scoped token (S2). Replaces the old ?<role>=<did> URL "session". */
  login(email: string, password: string): { accountId: string; role: AccountRole; did: string; email: string; token: AccessToken } {
    const account = this.accounts.get((email || '').trim().toLowerCase());
    if (!account || !this.verify(password, account)) throw new GlosError('AUTH_FAILED', 'Wrong email or password');
    return { accountId: account.accountId, role: account.role, did: account.did, email: account.email, token: this.mint(account) };
  }

  /** Mint the shift-length actor token an app carries after sign-in/up. */
  private mint(account: Account): AccessToken {
    return this.auth.mintActorToken({ role: actorRoleForAccount(account.role), did: account.did, tenant: account.tenant });
  }

  /** Issue a password-reset token (returned for the sandbox — would be emailed in production). */
  forgot(email: string): { sent: boolean; resetToken?: string } {
    const account = this.accounts.get((email || '').trim().toLowerCase());
    if (!account) return { sent: false }; // do not reveal which emails exist
    account.resetToken = `RST-${randomBytes(4).toString('hex').toUpperCase()}`;
    account.resetExpires = Date.now() + RESET_TTL_MS;
    this.accounts.set(account.email, account); // persist the reset token
    return { sent: true, resetToken: account.resetToken };
  }

  reset(token: string, password: string): { ok: boolean } {
    if ((password || '').length < 6) throw new GlosError('PASSWORD_TOO_SHORT', 'Password must be at least 6 characters');
    const account = [...this.accounts.values()].find((a) => a.resetToken && a.resetToken === (token || '').trim().toUpperCase());
    if (!account || !account.resetExpires || account.resetExpires < Date.now()) throw new GlosError('WINDOW_EXPIRED', 'Invalid or expired reset token');
    account.salt = randomBytes(16).toString('hex');
    account.hash = this.hash(password, account.salt);
    account.resetToken = undefined;
    account.resetExpires = undefined;
    this.accounts.set(account.email, account); // persist the new password hash
    return { ok: true };
  }

  // --- internals ---

  private provision(role: AccountRole, profile: Record<string, unknown>): { did: string; entityStatus?: string; tenant?: string } {
    if (role === 'pudo') {
      const agent = this.agents.register((profile.agent ?? {}) as never);
      if (profile.kyc) this.agents.submitKyc(agent.did, profile.kyc as never);
      return { did: agent.did, entityStatus: this.agents.get(agent.did).status };
    }
    if (role === 'driver') {
      let managerDid: string | undefined;
      if (profile.fleetCode) managerDid = this.managers.login(String(profile.fleetCode)).did; // join an existing fleet
      const driver = this.drivers.register({ ...(profile.driver as object), managerDid } as never);
      if (!managerDid && profile.vehicle) this.vehicles.register((profile.vehicle ?? {}) as never); // self-employed: own vehicle
      if (profile.kyc && driver.registry === 'heavy') this.drivers.submitKyc(driver.did, profile.kyc as never);
      return { did: driver.did, entityStatus: this.drivers.get(driver.did).status, tenant: managerDid };
    }
    if (role === 'mdp') {
      const mdp = this.mdps.register((profile.mdp ?? {}) as never);
      return { did: mdp.did }; // the real DID now (was the mdp_<hex> id — a type lie)
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
