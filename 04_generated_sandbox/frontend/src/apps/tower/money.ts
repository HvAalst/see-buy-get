import type { components } from '../../lib/sbg';
import type { MessageKey, Translate } from '../../shared/i18n';

/**
 * The console's money logic — percentages, provenance, and the difference between a number somebody chose
 * and a number they inherited.
 *
 * Its own module rather than more of `logic.ts`, because the console grows one section at a time and each
 * one has its own vocabulary. This one's whole subject is the seam between what an operator TYPES (a
 * percentage, because that is how a rate is discussed) and what the network STORES (a fraction, because
 * that is how a rate is applied). Getting that seam wrong charges a hundred times too much, so it exists
 * exactly once and is tested on its own.
 */

export type EntityPricing = components['schemas']['EntityPricing'];
export type LanePricing = components['schemas']['LanePricing'];
export type PricingBounds = components['schemas']['PricingBounds'];
export type RateOrigin = components['schemas']['RateOrigins']['marginPct'];
export type RuleOrigin = LanePricing['taxOrigin'];

/** `GET /entities` is untyped in the contract, so the console states the fields it actually reads. */
export interface EntityRow {
  entityId: string;
  name: string;
  kind: 'group' | 'sister';
  jurisdiction?: string;
  currency?: string;
  holdsCustody?: boolean;
}

/** The lanes, in the order the table shows them, with the key each one is stored under. */
export const LANE_KEYS = ['pudo', 'mdp', 'dedicated'] as const;
export type LaneKey = (typeof LANE_KEYS)[number];

export const LANE_LABEL: Record<LaneKey, MessageKey> = {
  pudo: 'tower.lane.pudo',
  mdp: 'tower.lane.mdp',
  dedicated: 'tower.lane.dedicated',
};

export function laneLabel(lane: string | undefined, t: Translate): string {
  if (!lane) return t('tower.lane.default');
  return lane in LANE_LABEL ? t(LANE_LABEL[lane as LaneKey]) : lane;
}

/* --------------------------------------------------------------- percentages -- */

/**
 * A stored fraction as a percentage STRING — 0.0225 → "2.25", and 0.02 → "2".
 *
 * Trailing zeros are dropped because these go into input boxes an operator will edit, and a box that
 * reads "2.0000" invites somebody to select-all and retype rather than adjust.
 */
export function pctText(fraction: number): string {
  const pct = Math.round(fraction * 1_000_000) / 10_000; // four decimals of a fraction = two of a percent
  return String(pct);
}

/** A percentage for reading rather than editing: always the same width, so a column of them lines up. */
export function pctLabel(fraction: number, digits = 2): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/**
 * What an operator typed, as the fraction the network stores.
 *
 * Returns null for anything that is not a number, and that is the ONLY defence against the mistake this
 * whole module exists for: 16 typed into a box that means fractions is a 1600% rate. Blank is not an
 * error here — blank is how the screen says "inherit this", so it is answered separately.
 */
export function pctToFraction(text: string): number | null {
  const trimmed = text.trim().replace('%', '').replace(',', '.');
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 100) * 10_000) / 10_000;
}

/** A money amount as typed. Same discipline, no scaling: a cover limit is currency, not a rate. */
export function amountOf(text: string): number | null {
  const trimmed = text.trim().replace(/[\s,]/g, '');
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/* ------------------------------------------------------------------ the form -- */

/**
 * THE RULE THE WHOLE EDITOR RESTS ON: an empty box INHERITS.
 *
 * Every knob in this system resolves through fallbacks — lane, then sister, then the pre-layers number,
 * then the network default — and the API says "leave it alone" with `undefined` and "clear it back to the
 * fallback" with `null`. A form with a value in every box cannot express the second, so it would quietly
 * convert every inherited number into one this lane now owns the moment anybody saved anything.
 *
 * So a box holds only what is set AT THIS LEVEL, and shows what it would inherit as a placeholder. Empty
 * means inherit, and clearing a box is how you give a number back.
 */
export interface RateForm {
  costOfRisk: string;
  profitOnRisk: string;
  margin: string;
}

export interface TaxForm {
  rate: string;
  label: string;
  registration: string;
}

export interface CoverForm {
  freeLimit: string;
  premium: string;
}

/** The form as it opens: only the layers this level actually holds, so an empty box means inherited. */
export function rateFormOf(row: LanePricing): RateForm {
  // A lane row shows a value only where the LANE holds it; the default row, only where the sister does.
  // Everything else is inherited, and an inherited number belongs in the placeholder, not in the box.
  const level: RateOrigin = row.lane ? 'lane' : 'sister';
  const at = (origin: RateOrigin, value: number) => (origin === level ? pctText(value) : '');
  return {
    costOfRisk: at(row.rateOrigin.costOfRiskPct, row.rates.costOfRiskPct),
    profitOnRisk: at(row.rateOrigin.profitOnRiskPct, row.rates.profitOnRiskPct),
    margin: at(row.rateOrigin.marginPct, row.rates.marginPct),
  };
}

export function taxFormOf(row: LanePricing, registration: string | undefined): TaxForm {
  const level: RuleOrigin = row.lane ? 'lane' : 'sister';
  const owned = row.taxOrigin === level;
  return {
    rate: owned ? pctText(row.tax.ratePct) : '',
    label: owned ? (row.tax.label ?? '') : '',
    registration: registration ?? '',
  };
}

export function coverFormOf(row: LanePricing): CoverForm {
  const level: RuleOrigin = row.lane ? 'lane' : 'sister';
  const owned = row.insuranceOrigin === level;
  return {
    freeLimit: owned && row.insurance.freeLimit ? String(row.insurance.freeLimit) : '',
    premium: owned && row.insurance.premiumPct ? pctText(row.insurance.premiumPct) : '',
  };
}

/* ----------------------------------------------------------------- payloads -- */

/** A blank box sends `null` — "clear it, I want the fallback" — and a filled one sends the fraction. */
function layer(text: string): number | null {
  return text.trim() ? pctToFraction(text) : null;
}

export function ratesPayload(form: RateForm, lane?: string): { lane?: string; costOfRiskPct: number | null; profitOnRiskPct: number | null; marginPct: number | null } {
  return {
    ...(lane ? { lane } : {}),
    costOfRiskPct: layer(form.costOfRisk),
    profitOnRiskPct: layer(form.profitOnRisk),
    marginPct: layer(form.margin),
  };
}

export function taxPayload(form: TaxForm, lane?: string): { lane?: string; ratePct: number | null; label: string | null; registration: string | null } {
  return {
    ...(lane ? { lane } : {}),
    ratePct: layer(form.rate),
    label: form.label.trim() || null,
    // The registration is the SISTER's, not the lane's, and it is sent on every save so that setting a
    // rate and the authority to charge it stays one act — which is the shape the server insists on.
    registration: form.registration.trim() || null,
  };
}

export function coverPayload(form: CoverForm, lane?: string): { lane?: string; freeLimit: number | null; premiumPct: number | null } {
  return {
    ...(lane ? { lane } : {}),
    freeLimit: form.freeLimit.trim() ? amountOf(form.freeLimit) : null,
    premiumPct: layer(form.premium),
  };
}

/* --------------------------------------------------------------- validation -- */

/**
 * The same refusals the service makes, said BEFORE the operator commits to the save.
 *
 * Every bound here comes off the response rather than out of this file: a client holding its own copy of
 * a money bound is a client that will one day accept what the server refuses. What this adds is only
 * timing — and, for the sum, an explanation, because "they add up, they do not compound" is the one thing
 * about these three knobs that is genuinely surprising.
 */
export function rateFormError(form: RateForm, bounds: PricingBounds, t: Translate): string | null {
  const parts: [string, string][] = [
    ['tower.rates.costOfRisk', form.costOfRisk],
    ['tower.rates.profitOnRisk', form.profitOnRisk],
    ['tower.rates.margin', form.margin],
  ];
  let sum = 0;
  for (const [key, text] of parts) {
    if (!text.trim()) continue;
    const value = pctToFraction(text);
    if (value === null) return t('tower.rates.notANumber', { field: t(key as MessageKey) });
    if (value < bounds.minRatePct || value > bounds.maxRatePct) {
      return t('tower.rates.outOfBounds', { field: t(key as MessageKey), min: pctLabel(bounds.minRatePct, 0), max: pctLabel(bounds.maxRatePct, 0) });
    }
    sum += value;
  }
  // Only the layers set HERE are summed, which is not the whole story — the rest are inherited and the
  // server will judge the resolved total. Said plainly rather than pretended otherwise: this catches the
  // obvious case early, and the server catches the resolved one with a message this screen shows.
  // ROUNDED THE WAY THE SERVER ROUNDS, and not because it is tidier: 10% + 10% + 10% in binary floating
  // point is 0.30000000000000004, which is over a 30% ceiling by a number no operator can see. The service
  // rounds its total to four decimals before comparing, so a client that does not would refuse a save the
  // network would have taken — and the operator would have no way to tell which of them was wrong.
  const total = Math.round(sum * 10_000) / 10_000;
  if (total > bounds.maxRatePct) return t('tower.rates.sumOverCeiling', { sum: pctLabel(total), max: pctLabel(bounds.maxRatePct, 0) });
  return null;
}

export function taxFormError(form: TaxForm, bounds: PricingBounds, t: Translate): string | null {
  if (!form.rate.trim()) return null; // no rate at this level: nothing to check, and nothing to register for
  const rate = pctToFraction(form.rate);
  if (rate === null) return t('tower.rates.notANumber', { field: t('tower.tax.rate') });
  if (rate < bounds.minTaxPct || rate > bounds.maxTaxPct) {
    return t('tower.rates.outOfBounds', { field: t('tower.tax.rate'), min: pctLabel(bounds.minTaxPct, 0), max: pctLabel(bounds.maxTaxPct, 0) });
  }
  // The server's rule, said early: charging tax without a registration is money taken from a customer in
  // the name of an authority that has never heard of you.
  if (rate > 0 && !form.registration.trim()) return t('tower.tax.needsRegistration');
  return null;
}

export function coverFormError(form: CoverForm, bounds: PricingBounds, t: Translate): string | null {
  if (form.premium.trim()) {
    const premium = pctToFraction(form.premium);
    if (premium === null) return t('tower.rates.notANumber', { field: t('tower.cover.premium') });
    if (premium < 0 || premium > bounds.maxPremiumPct) {
      return t('tower.rates.outOfBounds', { field: t('tower.cover.premium'), min: '0%', max: pctLabel(bounds.maxPremiumPct, 0) });
    }
  }
  if (form.freeLimit.trim()) {
    const limit = amountOf(form.freeLimit);
    if (limit === null) return t('tower.rates.notANumber', { field: t('tower.cover.freeLimit') });
    if (limit < 0) return t('tower.cover.negative');
  }
  return null;
}

/* ---------------------------------------------------------------- provenance -- */

const ORIGIN_KEY: Record<string, MessageKey> = {
  lane: 'tower.origin.lane',
  sister: 'tower.origin.sister',
  'legacy-fee': 'tower.origin.legacyFee',
  network: 'tower.origin.network',
  none: 'tower.origin.none',
};

export function originLabel(origin: string, t: Translate): string {
  return t(ORIGIN_KEY[origin] ?? 'tower.origin.network');
}

/**
 * Is this number DECIDED at the level being looked at, or has it fallen through from somewhere wider?
 *
 * The distinction the table has to draw. Two lanes showing 2% can be two completely different situations —
 * one a decision, the other the absence of one — and only one of them changes if the default changes.
 */
export function isOwnedHere(origin: string, lane: string | undefined): boolean {
  return lane ? origin === 'lane' : origin === 'sister';
}
