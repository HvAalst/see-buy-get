import { KycHub } from './kyc-hub.service';
import { EuKycProvider, GlobalKycProvider } from './stub-providers';

describe('KycHub (routing + providers)', () => {
  const hub = new KycHub(new EuKycProvider(), new GlobalKycProvider());

  it('lists the registered providers', () => {
    expect(hub.listProviders()).toEqual(['eu-kyc', 'global-kyc']);
  });

  it('routes EU jurisdictions to the EU provider', () => {
    expect(hub.route('NL').name).toBe('eu-kyc');
    expect(hub.route('DE').name).toBe('eu-kyc');
  });

  it('falls back to the global provider elsewhere', () => {
    expect(hub.route('US').name).toBe('global-kyc');
    expect(hub.route(undefined).name).toBe('global-kyc');
  });

  it('passes a valid individual and rejects the FAIL sentinel', () => {
    expect(hub.verifyIndividual({ fullName: 'Jane', governmentId: 'P1', jurisdiction: 'NL' }).passed).toBe(true);
    expect(hub.verifyIndividual({ fullName: 'Jane', governmentId: 'FAIL', jurisdiction: 'US' }).passed).toBe(false);
  });
});
