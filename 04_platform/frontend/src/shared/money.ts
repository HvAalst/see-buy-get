import { formatMoney } from './i18n';

/**
 * MONEY AS A PERSON READS IT — shared by every app, so a figure is written the same way wherever it stands.
 *
 * In the money the answer names (a shop's company's, the money a driver is paid in, the money a register line was
 * posted in). Where no company of ours stands behind the figure there is no money to say, and it is the bare number
 * the person agreed, with two decimals.
 *
 * Always TWO decimals, whatever the money: the books keep every amount to the hundredth, a shilling of Uganda's as
 * much as Kenya's. Left to the currency's own habit a Ugandan float of 12.50 is written 13 — a figure that is not on
 * the books, beside one the shopkeeper reconciles against.
 */
export function cash(v: number | null | undefined, currency?: string): string {
  return currency ? formatMoney(Number(v) || 0, currency, 2) : (Number(v) || 0).toFixed(2);
}

/** A per-km rate, set to the thousandth, in its money where there is one. */
export function perKmText(v: number, currency?: string): string {
  return currency ? formatMoney(v, currency, 3) : v.toFixed(3);
}
