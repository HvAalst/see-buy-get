import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { KybBusinessInput, KycIndividualInput, KycProvider, KycResult } from './kyc.types';

const EU_JURISDICTIONS = new Set(['NL', 'DE', 'FR', 'BE', 'ES', 'IT', 'IE', 'PT', 'AT', 'PL']);

function ref(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

// Sandbox stub logic: a verification passes when the id is present and not the literal
// 'FAIL' sentinel (lets tests drive both outcomes deterministically).
function decide(idValue: string, provider: string): KycResult {
  if (!idValue || idValue.toUpperCase() === 'FAIL') {
    return { passed: false, provider, reference: ref('rej'), reason: 'document_rejected' };
  }
  return { passed: true, provider, reference: ref('ok') };
}

/** Routed for EU jurisdictions. */
@Injectable()
export class EuKycProvider implements KycProvider {
  readonly name = 'eu-kyc';
  supports(jurisdiction?: string): boolean {
    return jurisdiction ? EU_JURISDICTIONS.has(jurisdiction.toUpperCase()) : false;
  }
  verifyIndividual(input: KycIndividualInput): KycResult {
    return decide(input.governmentId, this.name);
  }
  verifyBusiness(input: KybBusinessInput): KycResult {
    return decide(input.registrationId, this.name);
  }
}

/** Default global provider — handles everything the specialised providers don't. */
@Injectable()
export class GlobalKycProvider implements KycProvider {
  readonly name = 'global-kyc';
  supports(): boolean {
    return true;
  }
  verifyIndividual(input: KycIndividualInput): KycResult {
    return decide(input.governmentId, this.name);
  }
  verifyBusiness(input: KybBusinessInput): KycResult {
    return decide(input.registrationId, this.name);
  }
}
