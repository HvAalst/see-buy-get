import type { Translate } from './i18n';

/**
 * SIZE OR WEIGHT, WHICHEVER IS MORE (the user, 2026-10-27: "build the say"): a measured parcel's quote says which of the two
 * set its price, and what it counts as in kilograms. A box counts by its size as length × width × height ÷ 7,875 (the
 * density SeeBuyGet's own medium declares: 45 × 35 × 25 cm is 5 kg), and is never charged more than one whole bag.
 */
export interface ChargedBy {
  by: 'size' | 'weight';
  countsAsKg: number;
  weighsKg: number;
  wholeBag?: true;
}

/** "7.6", "5", "12.5": a kilogram figure as a person writes it. */
const kg = (n: number) => String(Math.round(n * 10) / 10);

/** The one line under a measured parcel's price: what set it. Nothing for a parcel priced by its size band. */
export function sizePriceLine(c: ChargedBy | undefined, t: Translate): string | null {
  if (!c) return null;
  if (c.wholeBag) return t('common.sizePrice.wholeBag', { counts: kg(c.countsAsKg) });
  return c.by === 'size' ? t('common.sizePrice.bySize', { counts: kg(c.countsAsKg), weighs: kg(c.weighsKg) }) : t('common.sizePrice.byWeight', { weighs: kg(c.weighsKg), counts: kg(c.countsAsKg) });
}
