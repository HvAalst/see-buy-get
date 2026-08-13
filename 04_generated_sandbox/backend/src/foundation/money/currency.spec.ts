import { CURRENCY_BY_JURISDICTION, FALLBACK_CURRENCY, currencyForJurisdiction } from './currency';
import { NETWORK_CURRENCY } from '../../modules/pudo/pudo.config';

describe('currency', () => {
  it('resolves the jurisdictions the network operates in', () => {
    // KE was missing until this slice, so every Kenyan wallet provisioned in dollars — the balances
    // were right and their unit was wrong, which is the one kind of money bug you cannot spot by eye.
    expect(currencyForJurisdiction('KE')).toBe('KES');
    expect(currencyForJurisdiction('NL')).toBe('EUR');
    expect(currencyForJurisdiction('GB')).toBe('GBP');
  });

  it('is case-insensitive on the jurisdiction code', () => {
    expect(currencyForJurisdiction('ke')).toBe('KES');
    expect(currencyForJurisdiction('Ke')).toBe('KES');
  });

  it('falls back for an unconfigured or missing jurisdiction', () => {
    expect(currencyForJurisdiction('ZZ')).toBe(FALLBACK_CURRENCY);
    expect(currencyForJurisdiction(undefined)).toBe(FALLBACK_CURRENCY);
    expect(currencyForJurisdiction('')).toBe(FALLBACK_CURRENCY);
  });

  it('gives this deployment a network currency of KES', () => {
    expect(NETWORK_CURRENCY).toBe('KES');
    expect(NETWORK_CURRENCY).not.toBe(FALLBACK_CURRENCY); // i.e. it resolved, rather than defaulting
  });

  it('maps every jurisdiction to a 3-letter ISO-4217 code', () => {
    for (const [country, ccy] of Object.entries(CURRENCY_BY_JURISDICTION)) {
      expect(country).toMatch(/^[A-Z]{2}$/);
      expect(ccy).toMatch(/^[A-Z]{3}$/);
    }
  });
});
