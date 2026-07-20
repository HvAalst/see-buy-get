import { Injectable } from '@nestjs/common';
import { EuKycProvider, GlobalKycProvider } from './stub-providers';
import { KybBusinessInput, KycIndividualInput, KycProvider, KycResult } from './kyc.types';

/**
 * KycHub — the abstraction + rule-based routing layer (T-103, UDIW-012).
 * Specialised providers are tried in order by jurisdiction; the global provider is the
 * fallback. Providers swap in/out without callers (IdentityService) changing.
 */
@Injectable()
export class KycHub {
  private readonly providers: KycProvider[];

  constructor(
    private readonly euProvider: EuKycProvider,
    private readonly globalProvider: GlobalKycProvider,
  ) {
    // Order matters: specialised first, global fallback last.
    this.providers = [this.euProvider, this.globalProvider];
  }

  route(jurisdiction?: string): KycProvider {
    return this.providers.find((p) => p !== this.globalProvider && p.supports(jurisdiction)) ?? this.globalProvider;
  }

  listProviders(): string[] {
    return this.providers.map((p) => p.name);
  }

  verifyIndividual(input: KycIndividualInput): KycResult {
    return this.route(input.jurisdiction).verifyIndividual(input);
  }

  verifyBusiness(input: KybBusinessInput): KycResult {
    return this.route(input.jurisdiction).verifyBusiness(input);
  }
}
