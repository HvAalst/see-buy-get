/**
 * Money currency — the one place a jurisdiction is turned into a currency.
 *
 * Every amount in this system is a bare number today. That is survivable only while none of it is real:
 * the moment a payment rail credits a balance, an untagged `1.6` sitting next to it can no longer be
 * reconstructed — was it shillings or dollars? So the rule is that any amount LEAVING the system (a
 * ledger row, an export, an API response) says what it is, and every part of the system resolves the
 * currency from here rather than assuming one.
 *
 * The map is deliberately explicit rather than a library lookup: these are the jurisdictions the network
 * actually operates a daughter company in, and adding one is a deliberate act (it implies an entity, a
 * tax registration and a settlement account), not a data-file import.
 */

import { GlosError } from '../http/glos-error';
import { catalogueEntry } from '../countries/catalogue';

export type CurrencyCode = string;

/** ISO-3166-alpha-2 jurisdiction → ISO-4217 currency, for the markets the network operates in. */
export const CURRENCY_BY_JURISDICTION: Record<string, CurrencyCode> = {
  KE: 'KES', ET: 'ETB',
  NL: 'EUR', DE: 'EUR', FR: 'EUR', BE: 'EUR', ES: 'EUR', IT: 'EUR', IE: 'EUR', PT: 'EUR', AT: 'EUR',
  GB: 'GBP', US: 'USD', SG: 'SGD', CN: 'CNY',
};

/**
 * The currency of last resort. It is NOT a sensible default for an unmapped market — it is the marker
 * that a jurisdiction was never configured, which is why the resolver is the only way to reach it.
 */
export const FALLBACK_CURRENCY: CurrencyCode = 'USD';

/** The currency a jurisdiction settles in; FALLBACK_CURRENCY when the jurisdiction is unknown/absent. */
export function currencyForJurisdiction(jurisdiction?: string): CurrencyCode {
  // The catalogue knows what every real country settles in; the fallback is left for codes that are not a country.
  return (jurisdiction && (CURRENCY_BY_JURISDICTION[jurisdiction.toUpperCase()] ?? catalogueEntry(jurisdiction)?.currency)) || FALLBACK_CURRENCY;
}

/**
 * The currency a jurisdiction settles in — or a refusal that names the country.
 *
 * For every path that PRICES somewhere with no sister behind it (user, 2026-09-13: "refuse until mapped").
 * The fallback above silently turned a Tanzanian shop's rate into dollars, which is a price stated in money
 * nobody chose. Where a sister exists its own currency is used and this is never asked; where none does,
 * adding the country to the table is a deliberate step, like recording its presence.
 */
export function requireCurrencyFor(jurisdiction?: string): CurrencyCode {
  // Every real country's currency is known now (the catalogue). Whether the network can PRICE in it is a separate
  // question — a rate on the rate book — asked by whoever prices.
  const code = jurisdiction ? (CURRENCY_BY_JURISDICTION[jurisdiction.toUpperCase()] ?? catalogueEntry(jurisdiction)?.currency) : undefined;
  if (!code) {
    throw new GlosError('INVALID_STATE', `No currency is recorded for ${jurisdiction || 'that country'}, so nothing can be priced there yet`);
  }
  return code;
}
