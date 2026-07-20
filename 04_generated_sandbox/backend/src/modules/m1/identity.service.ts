import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { DidService } from '../../foundation/did/did.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { PiiRecord } from '../../foundation/data-firewall/data-firewall.types';
import { AccountSummary, MasterAccount, ParticipantRole, RoleRegistration } from './participant.types';
import { capabilitiesForTier, ROLE_MIN_TIER, roleStatusForTier } from './roles';
import { KycHub } from './kyc/kyc-hub.service';
import { LivenessChallenge, LivenessProof, LivenessService } from './liveness/liveness.service';
import { SanctionsScreeningService } from './sanctions/sanctions.service';
import { WalletService } from './wallet/wallet.service';
import { WalletSummary } from './wallet/wallet.types';
import { BackgroundCheckService } from './background-check/background-check.service';
import { IdentitySignals, SyntheticIdentityService } from './security/synthetic-identity.service';
import { CredentialService } from '../../foundation/credentials/credential.service';

export interface RegisterInput {
  fullName: string;
  email?: string;
  phone?: string;
  jurisdiction?: string;
  roles: ParticipantRole[];
  /** Optional device/payment fingerprints for synthetic-identity screening (UDIW-051). */
  signals?: IdentitySignals;
}

export interface VerifyIdentityInput {
  governmentId: string;
  livenessChallengeId: string;
  livenessResponse: string;
  jurisdiction?: string;
}

export interface VerifyBusinessInput {
  businessName: string;
  registrationId: string;
  jurisdiction?: string;
}

export interface VerifyIdentityOutcome {
  account: AccountSummary;
  livenessProof: LivenessProof;
  kycReference: string;
  wallet: WalletSummary;
  backgroundCheck?: { passed: boolean; credentialId?: string };
}

/**
 * IdentityService — M1 onboarding orchestration (T-101..T-105).
 * Splits every participant across the data firewall: PII → Identity Vault, operational
 * state → this account registry + Operational Core. Drives the progressive tier model,
 * routes KYC/KYB, enforces liveness, and auto-suspends on a sanctions hit.
 */
@Injectable()
export class IdentityService {
  private readonly accounts = new Map<string, MasterAccount>();

  constructor(
    private readonly vault: IdentityVault,
    private readonly core: OperationalStore,
    private readonly dids: DidService,
    private readonly events: EventBus,
    private readonly kyc: KycHub,
    private readonly liveness: LivenessService,
    private readonly sanctions: SanctionsScreeningService,
    private readonly wallet: WalletService,
    private readonly credentials: CredentialService,
    private readonly backgroundCheck: BackgroundCheckService,
    private readonly synthetic: SyntheticIdentityService,
  ) {}

  /** UDIW-010 + UDIW-014: register a master account (T1) with one or more roles. */
  register(input: RegisterInput): AccountSummary {
    if (!input.roles || input.roles.length === 0) {
      throw new BadRequestException('At least one role is required');
    }

    const pii: PiiRecord = { fullName: input.fullName, email: input.email, phone: input.phone };
    const { vaultRef } = this.vault.store(pii, { region: input.jurisdiction ?? 'GLOBAL' });

    const accountId = `acct_${randomBytes(12).toString('hex')}`;

    // Front-door risk screening (UDIW-014 sanctions, UDIW-051 synthetic identity).
    const sanctions = this.sanctions.screen(input.fullName);
    const synthetic = input.signals ? this.synthetic.screen(accountId, input.signals) : { suspicious: false };
    const reason = sanctions.hit ? 'sanctions_match' : synthetic.suspicious ? 'synthetic_identity' : undefined;

    const account: MasterAccount = {
      accountId,
      tier: 1,
      status: reason ? 'suspended' : 'active',
      roles: this.buildRoles(input.roles, 1),
      vaultRef,
      jurisdiction: input.jurisdiction,
      createdAt: new Date().toISOString(),
    };
    this.accounts.set(accountId, account);

    if (reason) {
      void this.events
        .publish(
          GlosEvent.Identity.AccountSuspended,
          { accountId, reason, list: sanctions.matchedList },
          { source: 'm1' },
        )
        .catch(() => undefined);
    }

    return this.toSummary(account);
  }

  /** UDIW-010: add a distinct operational role to an existing master account. */
  addRole(accountId: string, role: ParticipantRole): AccountSummary {
    const account = this.require(accountId);
    if (!account.roles.some((r) => r.role === role)) {
      account.roles.push(this.buildRole(role, account.tier));
    }
    return this.toSummary(account);
  }

  /** UDIW-013: issue a liveness challenge for the selfie step. */
  issueLivenessChallenge(): LivenessChallenge {
    return this.liveness.issueChallenge();
  }

  /**
   * UDIW-011/012/013/014: upgrade to Tier 2 — KYC + liveness + continuous sanctions.
   * On success a DID is generated and an Operational Core profile is created.
   */
  verifyIdentity(accountId: string, input: VerifyIdentityInput): VerifyIdentityOutcome {
    const account = this.requireActive(accountId);
    const jurisdiction = input.jurisdiction ?? account.jurisdiction;

    // Reveal name for screening/KYC (audited vault access).
    const pii = this.vault.reveal(account.vaultRef, { purpose: 'kyc-review', requesterDid: 'did:glos:system' });

    // Continuous sanctions screening (UDIW-014).
    const screening = this.sanctions.screen(pii.fullName);
    if (screening.hit) {
      this.suspend(account, screening.matchedList);
      throw new ForbiddenException('Account suspended: sanctions match');
    }

    // Liveness (UDIW-013).
    const liveness = this.liveness.verify(input.livenessChallengeId, input.livenessResponse);
    if (!liveness.passed || !liveness.proof) {
      throw new BadRequestException(`Liveness check failed: ${liveness.reason ?? 'unknown'}`);
    }

    // KYC via the routed provider (UDIW-012).
    const kyc = this.kyc.verifyIndividual({ fullName: pii.fullName, governmentId: input.governmentId, jurisdiction });
    if (!kyc.passed) {
      throw new BadRequestException(`Identity verification failed: ${kyc.reason ?? 'rejected'}`);
    }

    const previousTier = account.tier;
    if (!account.did) {
      account.did = this.dids.generate(account.accountId, { tier: 2 }).id;
    }
    account.tier = account.tier < 2 ? 2 : account.tier;
    account.status = 'active';
    this.recomputeRoles(account);
    this.syncOperationalProfile(account);

    // Auto-provision the embedded wallet (UDIW-040).
    this.wallet.provision(account.did, { jurisdiction: account.jurisdiction });

    // Background check + Background-Check-Passed VC for crowdsourced couriers (UDIW-023).
    let backgroundCheck: VerifyIdentityOutcome['backgroundCheck'];
    if (account.roles.some((r) => r.role === ParticipantRole.Carrier)) {
      const bg = this.backgroundCheck.run(account.accountId);
      if (bg.passed) {
        const vc = this.credentials.issue({
          subject: account.did,
          type: 'BackgroundCheckPassed',
          claims: { reference: bg.reference },
          ttlMs: 365 * 24 * 60 * 60 * 1000, // 1 year, then renewal required
        });
        backgroundCheck = { passed: true, credentialId: vc.id };
      } else {
        backgroundCheck = { passed: false };
      }
    }

    this.emitVerified(account, previousTier);

    return {
      account: this.toSummary(account),
      livenessProof: liveness.proof,
      kycReference: kyc.reference,
      wallet: this.wallet.summary(account.did),
      backgroundCheck,
    };
  }

  /** UDIW-011/012: upgrade to Tier 3 via business verification (KYB). */
  verifyBusiness(accountId: string, input: VerifyBusinessInput): AccountSummary {
    const account = this.requireActive(accountId);
    if (account.tier < 2) {
      throw new BadRequestException('Tier 2 (verified individual) is required before business verification');
    }
    const kyb = this.kyc.verifyBusiness({
      businessName: input.businessName,
      registrationId: input.registrationId,
      jurisdiction: input.jurisdiction ?? account.jurisdiction,
    });
    if (!kyb.passed) {
      throw new BadRequestException(`Business verification failed: ${kyb.reason ?? 'rejected'}`);
    }

    const previousTier = account.tier;
    account.tier = account.tier < 3 ? 3 : account.tier;
    this.recomputeRoles(account);
    this.syncOperationalProfile(account);
    if (account.did) this.wallet.setCorporate(account.did, true); // corporate wallet → multi-sig eligible
    this.emitVerified(account, previousTier);
    return this.toSummary(account);
  }

  getAccount(accountId: string): AccountSummary {
    return this.toSummary(this.require(accountId));
  }

  // --- internals ---

  private buildRoles(roles: ParticipantRole[], tier: 1 | 2 | 3 | 4): RoleRegistration[] {
    const unique = Array.from(new Set(roles));
    return unique.map((role) => this.buildRole(role, tier));
  }

  private buildRole(role: ParticipantRole, tier: 1 | 2 | 3 | 4): RoleRegistration {
    return {
      role,
      requiredTier: ROLE_MIN_TIER[role],
      status: roleStatusForTier(role, tier),
      addedAt: new Date().toISOString(),
    };
  }

  private recomputeRoles(account: MasterAccount): void {
    account.roles = account.roles.map((r) => ({ ...r, status: roleStatusForTier(r.role, account.tier) }));
  }

  private syncOperationalProfile(account: MasterAccount): void {
    if (!account.did) return;
    this.core.upsert({
      did: account.did,
      vaultRef: account.vaultRef,
      tier: account.tier,
      status: account.status,
      capabilities: capabilitiesForTier(account.tier),
      jurisdiction: account.jurisdiction,
    });
  }

  private suspend(account: MasterAccount, list?: string): void {
    account.status = 'suspended';
    if (account.did) this.syncOperationalProfile(account);
    void this.events
      .publish(
        GlosEvent.Identity.AccountSuspended,
        { accountId: account.accountId, reason: 'sanctions_match', list },
        { source: 'm1' },
      )
      .catch(() => undefined);
  }

  private emitVerified(account: MasterAccount, previousTier: number): void {
    void this.events
      .publish(GlosEvent.Identity.Verified, { accountId: account.accountId, did: account.did, tier: account.tier }, { source: 'm1' })
      .catch(() => undefined);
    if (account.tier !== previousTier) {
      void this.events
        .publish(
          GlosEvent.Identity.TierUpgraded,
          { accountId: account.accountId, did: account.did, from: previousTier, to: account.tier },
          { source: 'm1' },
        )
        .catch(() => undefined);
    }
  }

  private require(accountId: string): MasterAccount {
    const account = this.accounts.get(accountId);
    if (!account) throw new NotFoundException(`Account not found: ${accountId}`);
    return account;
  }

  private requireActive(accountId: string): MasterAccount {
    const account = this.require(accountId);
    if (account.status === 'suspended') throw new ForbiddenException('Account is suspended');
    return account;
  }

  private toSummary(account: MasterAccount): AccountSummary {
    return {
      accountId: account.accountId,
      did: account.did,
      tier: account.tier,
      status: account.status,
      roles: account.roles,
      jurisdiction: account.jurisdiction,
      capabilities: capabilitiesForTier(account.tier),
    };
  }
}
