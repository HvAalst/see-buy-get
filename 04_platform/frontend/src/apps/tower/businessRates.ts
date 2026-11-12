import type { components } from '../../lib/sbg';
import type { MessageKey, Translate } from '../../shared/i18n';

export type BusinessRatesView = components['schemas']['BusinessRatesView'];
export type BusinessRateRow = components['schemas']['BusinessRateRow'];
export type BusinessRateTerms = components['schemas']['BusinessRateTerms'];

/** A rate's terms in a line: a contract card's price for each weight, or the discount in per cent. */
export function termsLine(terms: Pick<BusinessRateTerms, 'kind' | 'steps' | 'prices' | 'discountPct'>, currency: string, t: Translate): string {
  if (terms.kind === 'card') {
    const prices = (terms.steps ?? []).map((kg, i) => `${kg} kg ${currency} ${(terms.prices?.[i] ?? 0).toLocaleString()}`).join(' · ');
    return t('tower.rates.big.card' as MessageKey, { prices });
  }
  return t('tower.rates.big.discount' as MessageKey, { pct: Math.round((terms.discountPct ?? 0) * 1000) / 10 });
}

/** What the form sends: a card's prices for every weight, or a discount as a share (10 → 0.1). Nothing where it is not complete. */
export function proposalOf(draft: { vendorId: string; kind: 'card' | 'discount'; prices: string[]; extraKg: string; pct: string; note: string }, steps: number[]): { vendorId: string; kind: 'card' | 'discount'; prices?: number[]; perExtraKg?: number; discountPct?: number; note?: string } | null {
  if (!draft.vendorId) return null;
  const num = (s: string) => Number(String(s).replace(',', '.'));
  const note = draft.note.trim() ? { note: draft.note.trim() } : {};
  if (draft.kind === 'card') {
    const prices = steps.map((_, i) => num(draft.prices[i] ?? ''));
    if (prices.some((p) => !(p > 0))) return null;
    const extra = draft.extraKg.trim() ? num(draft.extraKg) : 0;
    if (!(extra >= 0)) return null;
    return { vendorId: draft.vendorId, kind: 'card', prices, perExtraKg: extra, ...note };
  }
  const pct = num(draft.pct);
  if (!(pct > 0 && pct <= 50)) return null;
  return { vendorId: draft.vendorId, kind: 'discount', discountPct: Math.round(pct * 100) / 10000, ...note };
}
