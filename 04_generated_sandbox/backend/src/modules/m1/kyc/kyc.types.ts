// KYC/KYB hub contracts (T-103, UDIW-012). A pluggable provider abstraction with
// jurisdiction-based routing. The sandbox ships two stub providers; real providers
// (Onfido, Jumio, business registries, …) implement the same interface.

export interface KycIndividualInput {
  fullName: string;
  governmentId: string;
  jurisdiction?: string;
}

export interface KybBusinessInput {
  businessName: string;
  registrationId: string;
  jurisdiction?: string;
}

export interface KycResult {
  passed: boolean;
  provider: string;
  reference: string;
  reason?: string;
}

export interface KycProvider {
  readonly name: string;
  /** Whether this provider handles the given jurisdiction (routing). */
  supports(jurisdiction?: string): boolean;
  verifyIndividual(input: KycIndividualInput): KycResult;
  verifyBusiness(input: KybBusinessInput): KycResult;
}
