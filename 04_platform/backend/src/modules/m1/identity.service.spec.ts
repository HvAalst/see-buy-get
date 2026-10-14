import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { KycHub } from './kyc/kyc-hub.service';
import { EuKycProvider, GlobalKycProvider } from './kyc/stub-providers';
import { LivenessService } from './liveness/liveness.service';
import { SanctionsScreeningService } from './sanctions/sanctions.service';
import { WalletService } from './wallet/wallet.service';
import { MultiSigService } from './wallet/multi-sig.service';
import { BackgroundCheckService } from './background-check/background-check.service';
import { SyntheticIdentityService } from './security/synthetic-identity.service';
import { ParticipantRole } from './participant.types';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { DidService } from '../../foundation/did/did.service';
import { CredentialService } from '../../foundation/credentials/credential.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';

describe('IdentityService (M1 core)', () => {
  let identity: IdentityService;
  let core: OperationalStore;
  let liveness: LivenessService;
  let wallet: WalletService;
  let credentials: CredentialService;
  let events: EventBus;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        KycHub,
        EuKycProvider,
        GlobalKycProvider,
        LivenessService,
        SanctionsScreeningService,
        WalletService,
        MultiSigService,
        BackgroundCheckService,
        SyntheticIdentityService,
        IdentityVault,
        OperationalStore,
        FieldEncryption,
        DidService,
        CredentialService,
        LedgerService,
        EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();

    identity = moduleRef.get(IdentityService);
    core = moduleRef.get(OperationalStore);
    liveness = moduleRef.get(LivenessService);
    wallet = moduleRef.get(WalletService);
    credentials = moduleRef.get(CredentialService);
    events = moduleRef.get(EventBus);
  });

  function passVerifyIdentity(accountId: string, governmentId = 'P1234567') {
    const challenge = identity.issueLivenessChallenge();
    return identity.verifyIdentity(accountId, {
      governmentId,
      livenessChallengeId: challenge.challengeId,
      livenessResponse: challenge.phrase,
    });
  }

  it('registers a T1 master account with role-specific status (UDIW-010/011)', () => {
    const summary = identity.register({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      jurisdiction: 'NL',
      roles: [ParticipantRole.Shipper, ParticipantRole.Carrier],
    });

    expect(summary.tier).toBe(1);
    expect(summary.status).toBe('active');
    const byRole = Object.fromEntries(summary.roles.map((r) => [r.role, r.status]));
    expect(byRole[ParticipantRole.Shipper]).toBe('active'); // min tier 1
    expect(byRole[ParticipantRole.Carrier]).toBe('pending'); // needs tier 2
    expect(summary.did).toBeUndefined(); // no DID until verified
  });

  it('verifies identity → T2, mints a DID, activates carrier, writes an Operational profile', () => {
    const reg = identity.register({ fullName: 'Jane Doe', jurisdiction: 'NL', roles: [ParticipantRole.Carrier] });
    const outcome = passVerifyIdentity(reg.accountId);

    expect(outcome.account.tier).toBe(2);
    expect(outcome.account.did).toMatch(/^did:glos:/);
    expect(outcome.account.roles[0].status).toBe('active');
    expect(outcome.livenessProof.certId).toMatch(/^lvcert_/);
    expect(outcome.kycReference).toMatch(/_/);

    // Operational Core now has a PII-free profile keyed by the DID.
    const profile = core.get(outcome.account.did!);
    expect(profile).toBeDefined();
    expect(profile?.capabilities).toContain('last-mile-delivery');

    // Cascade events fired.
    const types = events.getLog().map((e) => e.type);
    expect(types).toContain(GlosEvent.Did.Generated);
    expect(types).toContain(GlosEvent.Identity.Verified);
    expect(types).toContain(GlosEvent.Identity.TierUpgraded);
  });

  it('rejects a failed liveness check', () => {
    const reg = identity.register({ fullName: 'Jane Doe', roles: [ParticipantRole.Carrier] });
    const challenge = identity.issueLivenessChallenge();
    expect(() =>
      identity.verifyIdentity(reg.accountId, {
        governmentId: 'P1',
        livenessChallengeId: challenge.challengeId,
        livenessResponse: 'wrong words here',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a failed KYC document', () => {
    const reg = identity.register({ fullName: 'Jane Doe', roles: [ParticipantRole.Carrier] });
    expect(() => passVerifyIdentity(reg.accountId, 'FAIL')).toThrow(BadRequestException);
  });

  it('auto-suspends a sanctioned registration and blocks verification (UDIW-014)', () => {
    const reg = identity.register({ fullName: 'OFAC Test Person', roles: [ParticipantRole.Shipper] });
    expect(reg.status).toBe('suspended');
    expect(events.getLog().some((e) => e.type === GlosEvent.Identity.AccountSuspended)).toBe(true);
    expect(() => passVerifyIdentity(reg.accountId)).toThrow(ForbiddenException);
  });

  it('upgrades to T3 via business verification, activating warehouse role', () => {
    const reg = identity.register({
      fullName: 'Jane Doe',
      jurisdiction: 'NL',
      roles: [ParticipantRole.WarehouseOperator],
    });
    passVerifyIdentity(reg.accountId); // T2 first
    const summary = identity.verifyBusiness(reg.accountId, { businessName: 'Acme BV', registrationId: 'NL-123' });

    expect(summary.tier).toBe(3);
    expect(summary.roles[0].status).toBe('active');
    expect(summary.capabilities).toContain('freight-forwarding');
  });

  it('keeps liveness challenges single-use', () => {
    const challenge = liveness.issueChallenge();
    expect(liveness.verify(challenge.challengeId, challenge.phrase).passed).toBe(true);
    expect(liveness.verify(challenge.challengeId, challenge.phrase).passed).toBe(false); // reused
  });

  it('provisions a wallet and issues a background-check VC for a verified courier (T-201/204)', () => {
    const reg = identity.register({ fullName: 'Jane Doe', jurisdiction: 'NL', roles: [ParticipantRole.Carrier] });
    const outcome = passVerifyIdentity(reg.accountId);

    // Wallet auto-provisioned in the local currency, with a WalletProvisioned event.
    expect(outcome.wallet.walletId).toMatch(/^wal_/);
    expect(outcome.wallet.settlementCurrency).toBe('EUR');
    expect(wallet.get(outcome.account.did!)).toBeDefined();
    expect(events.getLog().some((e) => e.type === GlosEvent.Wallet.Provisioned)).toBe(true);

    // Background-check VC issued and valid.
    expect(outcome.backgroundCheck?.passed).toBe(true);
    const vcId = outcome.backgroundCheck!.credentialId!;
    expect(credentials.verify(vcId).active).toBe(true);
    expect(credentials.hasValid(outcome.account.did!, 'BackgroundCheckPassed')).toBe(true);
  });

  it('does not run a background check for a non-courier (shipper only)', () => {
    const reg = identity.register({ fullName: 'Jane Doe', roles: [ParticipantRole.Shipper] });
    // Shipper is active at T1; push to T2 to provision the wallet without a carrier role.
    const outcome = passVerifyIdentity(reg.accountId);
    expect(outcome.backgroundCheck).toBeUndefined();
    expect(outcome.wallet.walletId).toMatch(/^wal_/);
  });

  it('auto-suspends a synthetic-identity cluster sharing a payment instrument (T-205)', () => {
    const signals = { paymentInstrumentHash: 'card-hash-xyz' };
    identity.register({ fullName: 'A One', roles: [ParticipantRole.Shipper], signals });
    identity.register({ fullName: 'B Two', roles: [ParticipantRole.Shipper], signals });
    const third = identity.register({ fullName: 'C Three', roles: [ParticipantRole.Shipper], signals });
    expect(third.status).toBe('suspended'); // 3rd account sharing the instrument trips the cluster
  });
});
