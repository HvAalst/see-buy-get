import { describe, expect, it } from 'vitest';
import { currenciesOf, currencyLabel } from './screens/CurrencySelect';
import { PAYMENT_TERM_WORDS, PAYMENT_TERMS, paymentTermOf } from '../business/exports';

/*
 * CHOSEN, NOT TYPED (the user, 2026-10-28: "currency should be an selector with country behind it to avoid errors";
 * "payment terms should be selected too with an 'other' option").
 */
const rows = [
  { code: 'KE', name: 'Kenya', currency: 'KES' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'BE', name: 'Belgium', currency: 'EUR' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'XX', name: 'Nowhere', currency: '' },
];

describe('a currency, chosen with the countries behind it', () => {
  it('one option per currency, each with its name and the countries that settle in it', () => {
    const list = currenciesOf(rows);
    expect(list.map((o) => o.code)).toEqual(['EUR', 'KES']);
    expect(list[1]).toEqual({ code: 'KES', name: 'Kenyan Shilling', countries: [{ code: 'KE', name: 'Kenya' }] });
    expect(list[0].countries.map((c) => c.name)).toEqual(['Belgium', 'France', 'Germany', 'Netherlands']);
  });

  it('says a currency as a person recognises it, a long list of countries shortened', () => {
    const [eur, kes] = currenciesOf(rows);
    const more = (n: number) => `and ${n} more`;
    expect(currencyLabel(kes, more)).toBe('KES — Kenyan Shilling · Kenya');
    expect(currencyLabel(eur, more)).toBe('EUR — Euro · Belgium, France, Germany and 1 more');
  });
});

describe('payment terms, chosen — or the exporter’s own words', () => {
  it('reads a saved text back as one of the usual terms, or as its own words', () => {
    for (const k of PAYMENT_TERMS) expect(paymentTermOf(PAYMENT_TERM_WORDS[k])).toBe(k);
    expect(paymentTermOf('50% in advance, 50% against copy of the bill of lading')).toBe('other');
    expect(paymentTermOf('  ')).toBe('');
  });
});
