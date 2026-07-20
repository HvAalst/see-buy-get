import { Module } from '@nestjs/common';
import { M1Controller } from './m1.controller';
import { IdentityService } from './identity.service';
import { KycHub } from './kyc/kyc-hub.service';
import { EuKycProvider, GlobalKycProvider } from './kyc/stub-providers';
import { LivenessService } from './liveness/liveness.service';
import { SanctionsScreeningService } from './sanctions/sanctions.service';
import { WalletService } from './wallet/wallet.service';
import { MultiSigService } from './wallet/multi-sig.service';
import { WalletController } from './wallet/wallet.controller';
import { BackgroundCheckService } from './background-check/background-check.service';
import { SyntheticIdentityService } from './security/synthetic-identity.service';

/**
 * M1 — Unified Digital Identity & Wallet (UDIW).
 * Epic: 02_epic_domains/epic_m1_identity_wallet.md.
 * Sprint 1 (Identity Core): registration, tiers, KYC/KYB, liveness, sanctions.
 * Sprint 2 (Wallet, Courier & Security): wallet provisioning + settlement triggers + instant
 * payout (T-201..T-203), background-check VC (T-204), synthetic-identity (T-205), multi-sig
 * (T-206). Foundations (vault, DID, events, ledger, credentials) injected from global modules.
 */
@Module({
  controllers: [M1Controller, WalletController],
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
  ],
  exports: [WalletService], // SSE funds/releases via the wallet
})
export class M1Module {}
