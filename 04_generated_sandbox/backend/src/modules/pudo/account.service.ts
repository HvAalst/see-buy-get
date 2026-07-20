import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AgentService } from './agent.service';
import { DriverService } from './driver.service';
import { MdpService } from './mdp.service';
import { VehicleService } from './vehicle.service';
import { FleetManagerService } from './fleet-manager.service';
import { OtpService } from './otp.service';

export type AccountRole = 'pudo' | 'driver' | 'mdp';

interface Account {
  accountId: string;
  email: string;
  role: AccountRole;
  salt: string;
  hash: string;
  did: string; // the linked domain entity (agent DID / driver DID / MDP id)
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
export class AccountService {
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
  ) {}

  /** Create a participant account + its domain entity from the sign-up wizard. Requires a verified phone. */
  signup(input: { role: AccountRole; email: string; password: string; phone: string; profile: Record<string, unknown> }): { accountId: string; role: AccountRole; did: string; email: string; entityStatus?: string } {
    const email = (input.email || '').trim().toLowerCase();
    if (!email.includes('@')) throw new BadRequestException('A valid email is required');
    if ((input.password || '').length < 6) throw new BadRequestException('Password must be at least 6 characters');
    if (!input.phone?.trim()) throw new BadRequestException('A phone number is required');
    if (!this.otp.isVerified(input.phone)) throw new BadRequestException('Verify your phone number first');
    if (this.accounts.has(email)) throw new ConflictException('An account with this email already exists');

    const { did, entityStatus } = this.provision(input.role, input.profile);
    this.otp.consume(input.phone); // one verification → one account
    const salt = randomBytes(16).toString('hex');
    const account: Account = { accountId: `acc_${randomBytes(8).toString('hex')}`, email, role: input.role, salt, hash: this.hash(input.password, salt), did, createdAt: new Date().toISOString() };
    this.accounts.set(email, account);
    return { accountId: account.accountId, role: account.role, did, email, entityStatus };
  }

  /** Verify credentials → the linked participant (role + did) so the app can open. */
  login(email: string, password: string): { accountId: string; role: AccountRole; did: string; email: string } {
    const account = this.accounts.get((email || '').trim().toLowerCase());
    if (!account || !this.verify(password, account)) throw new UnauthorizedException('Wrong email or password');
    return { accountId: account.accountId, role: account.role, did: account.did, email: account.email };
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
    if ((password || '').length < 6) throw new BadRequestException('Password must be at least 6 characters');
    const account = [...this.accounts.values()].find((a) => a.resetToken && a.resetToken === (token || '').trim().toUpperCase());
    if (!account || !account.resetExpires || account.resetExpires < Date.now()) throw new BadRequestException('Invalid or expired reset token');
    account.salt = randomBytes(16).toString('hex');
    account.hash = this.hash(password, account.salt);
    account.resetToken = undefined;
    account.resetExpires = undefined;
    this.accounts.set(account.email, account); // persist the new password hash
    return { ok: true };
  }

  // --- internals ---

  private provision(role: AccountRole, profile: Record<string, unknown>): { did: string; entityStatus?: string } {
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
      return { did: driver.did, entityStatus: this.drivers.get(driver.did).status };
    }
    if (role === 'mdp') {
      const mdp = this.mdps.register((profile.mdp ?? {}) as never);
      return { did: mdp.mdpId };
    }
    throw new BadRequestException(`Unknown account role: ${role}`);
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
