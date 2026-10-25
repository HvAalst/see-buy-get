/**
 * The names on a company's list of amounts — see `amounts.ts` for what each is and whose list applies.
 *
 * In a file of their own, with no imports, because the company's own types name them (an enum on a response class)
 * and those types are read before most of this module is: nothing here can be waiting on anything else.
 */
export const AMOUNT_KEYS = ['wholesale', 'labourFee', 'handoverFee', 'shelvingFee', 'releaseFee', 'toteLoadFee', 'mdpSortFee', 'holdingFeePerDay', 'freightPerKm', 'freightBaseFee'] as const;
export type AmountKey = (typeof AMOUNT_KEYS)[number];

export function isAmountKey(key: string): key is AmountKey {
  return (AMOUNT_KEYS as readonly string[]).includes(key);
}
