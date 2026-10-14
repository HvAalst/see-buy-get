import { describe, expect, it } from 'vitest';
import { currencyReady, quoteFigure, quoteTone } from './quote';

describe('a quotation, as a screen reads it', () => {
  it('says the figure in the currency it was quoted in, never converted', () => {
    expect(quoteFigure({ amount: 18000, currency: 'ETB' })).toBe('18,000 ETB');
    expect(quoteFigure({ amount: 12.5, currency: 'USD' })).toBe('12.5 USD');
  });

  it('reads as settled only once a party said it is paid', () => {
    expect(quoteTone({ status: 'paid' })).toBe('ok');
    expect(quoteTone({ status: 'open' })).toBe('warn');
    expect(quoteTone(null)).toBe('quiet');
  });

  it('takes a currency as three letters', () => {
    expect([currencyReady('etb'), currencyReady('USD '), currencyReady('birr'), currencyReady('')]).toEqual([true, true, false, false]);
  });
});
