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
  kind: 'group' | 'sister' | 'partner';
  jurisdiction?: string;
  currency?: string;
  holdsCustody?: boolean;
  /** CA3 — a company created from the console is a draft until two people switch its country on. Absent = active. */
  status?: 'draft' | 'active';
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

/**
 * What this sister charges a shop or a store to put money in.
 *
 * NOT A PERCENTAGE, unlike every other knob in this module, and the difference is the whole design: it
 * recovers a per-PAYMENT cost, so a percentage would charge twice as much for a top-up that costs the
 * same to carry. Two plain amounts in the sister's own currency, and no lane — a top-up is not a lane of
 * work, so there is nothing for it to vary by and nothing for it to inherit from.
 */
export interface TopUpFeeForm {
  charge: string;
  freeAbove: string;
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

/** The form as it opens: empty where no fee was decided, which is a real state and the default one. */
export function topUpFeeFormOf(pricing: Pick<EntityPricing, 'topUpFee'>): TopUpFeeForm {
  return {
    charge: pricing.topUpFee ? String(pricing.topUpFee.amount) : '',
    freeAbove: pricing.topUpFee ? String(pricing.topUpFee.freeAbove) : '',
  };
}

/**
 * What goes on the wire. BOTH BOXES EMPTY SENDS `{}`, which REMOVES the rule — the only way to say "we
 * charge nothing here", and distinct from a fee of zero, which the server refuses on purpose.
 */
export function topUpFeePayload(form: TopUpFeeForm): { amount?: number; freeAbove?: number } {
  if (!form.charge.trim() && !form.freeAbove.trim()) return {};
  return { amount: amountOf(form.charge) ?? 0, freeAbove: amountOf(form.freeAbove) ?? 0 };
}

/**
 * The server's own bounds, said before anybody presses save.
 *
 * HALF A RULE IS THE ERROR WORTH CATCHING HERE. A threshold with no charge behind it charges nobody, and
 * a charge with no threshold is a fee nobody can escape by topping up more — which is not this fee. The
 * ceiling is the other one: past a fifth of its own threshold a charge has stopped recovering a payment
 * cost and started being a tariff on being short, which is what the free-above shape exists to prevent.
 */
export function topUpFeeFormError(form: TopUpFeeForm, t: Translate): string | null {
  const charge = form.charge.trim();
  const freeAbove = form.freeAbove.trim();
  if (!charge && !freeAbove) return null; // both empty = remove the rule, which is always allowed
  if (!charge || !freeAbove) return t('tower.topupfee.needsBoth');

  const amount = amountOf(charge);
  const threshold = amountOf(freeAbove);
  if (amount === null) return t('tower.rates.notANumber', { field: t('tower.topupfee.charge') });
  if (threshold === null) return t('tower.rates.notANumber', { field: t('tower.topupfee.freeAbove') });
  if (amount <= 0) return t('tower.topupfee.chargeTooLow');
  if (threshold <= 0) return t('tower.topupfee.thresholdTooLow');
  if (amount > threshold / 5) return t('tower.topupfee.tooSteep', { max: String(Math.round((threshold / 5) * 100) / 100) });
  return null;
}

/* ------------------------------------------------------------- a company's list of amounts -- */

export type CompanyAmount = components['schemas']['CompanyAmount'];
export type AmountKey = CompanyAmount['key'];
/** What is typed: text, one box per amount. An EMPTY box is "what every company starts from", not zero. */
export type AmountsForm = Record<AmountKey, string>;

/**
 * The order the list is READ in: what comes in first, then what goes out in the order a parcel travels — taken in,
 * handed to a driver, loaded, sorted, shelved, handed over — and last what waiting costs. The server's own order is
 * the order the figures were written in the code, which is nobody's way of thinking about a parcel.
 */
export const AMOUNT_ORDER: AmountKey[] = ['wholesale', 'labourFee', 'handoverFee', 'toteLoadFee', 'mdpSortFee', 'shelvingFee', 'releaseFee', 'holdingFeePerDay'];

const amountRow = (pricing: Pick<EntityPricing, 'amounts'>, key: AmountKey): CompanyAmount | undefined => pricing.amounts.find((r) => r.key === key);

/** The form as it opens: this company's own figures, and an empty box wherever it has not set one. */
export function amountsFormOf(pricing: Pick<EntityPricing, 'amounts'>): AmountsForm {
  const form = {} as AmountsForm;
  for (const key of AMOUNT_ORDER) {
    const row = amountRow(pricing, key);
    form[key] = row?.own ? String(row.amount) : '';
  }
  return form;
}

/**
 * What goes on the wire: ONLY what was changed. A box emptied sends `null` (back to the starting figure); a box
 * left as it was sends nothing, so saving one figure cannot quietly turn seven inherited ones into decisions.
 */
export function amountsPayload(form: AmountsForm, pricing: Pick<EntityPricing, 'amounts'>): Partial<Record<AmountKey, number | null>> {
  const out: Partial<Record<AmountKey, number | null>> = {};
  for (const key of AMOUNT_ORDER) {
    const row = amountRow(pricing, key);
    const typed = form[key].trim();
    if (!typed) {
      if (row?.own) out[key] = null;
      continue;
    }
    const n = amountOf(typed);
    if (n === null) continue; // amountsFormError has said so; nothing half-read is sent
    if (!row?.own || row.amount !== Math.round(n * 100) / 100) out[key] = n;
  }
  return out;
}

/** The server's own refusals, said before anybody presses save. */
export function amountsFormError(form: AmountsForm, pricing: Pick<EntityPricing, 'amounts'>, t: Translate): string | null {
  for (const key of AMOUNT_ORDER) {
    const typed = form[key].trim();
    if (!typed) continue;
    const n = amountOf(typed);
    if (n === null) return t('tower.rates.notANumber', { field: t(AMOUNT_LABEL[key]) });
    if (n < 0) return t('tower.amounts.negative', { field: t(AMOUNT_LABEL[key]) });
  }
  if (!(amountsInForce(form, pricing).wholesale > 0)) return t('tower.amounts.priceNeeded');
  return null;
}

/** The list as it WOULD stand if this form were saved: what is typed, else the figure every company starts from. */
export function amountsInForce(form: AmountsForm, pricing: Pick<EntityPricing, 'amounts'>): Record<AmountKey, number> {
  const out = {} as Record<AmountKey, number>;
  for (const key of AMOUNT_ORDER) {
    const typed = amountOf(form[key].trim());
    out[key] = form[key].trim() && typed !== null ? Math.round(typed * 100) / 100 : (amountRow(pricing, key)?.startsAt ?? 0);
  }
  return out;
}

/**
 * WHAT ONE COUNTER PARCEL BRINGS IN AGAINST WHAT ITS STEPS PAY OUT — said on the screen before the button is pressed.
 *
 * Not a rule the server holds: a company may decide to carry a parcel at a loss, and currencies differ too much for
 * any ceiling to mean something. But a list on which every parcel pays out more than it brings in is nearly always a
 * figure typed in the wrong box, and the one place that can be seen is here.
 */
export function counterParcelMath(amounts: Record<AmountKey, number>): { price: number; perParcel: number; over: boolean } {
  const perParcel = Math.round((amounts.mdpSortFee + amounts.shelvingFee + amounts.releaseFee) * 100) / 100;
  return { price: amounts.wholesale, perParcel, over: perParcel > amounts.wholesale };
}

export const AMOUNT_LABEL: Record<AmountKey, MessageKey> = {
  wholesale: 'tower.amounts.k.wholesale',
  labourFee: 'tower.amounts.k.labourFee',
  handoverFee: 'tower.amounts.k.handoverFee',
  toteLoadFee: 'tower.amounts.k.toteLoadFee',
  mdpSortFee: 'tower.amounts.k.mdpSortFee',
  shelvingFee: 'tower.amounts.k.shelvingFee',
  releaseFee: 'tower.amounts.k.releaseFee',
  holdingFeePerDay: 'tower.amounts.k.holdingFeePerDay',
};

export const AMOUNT_HINT: Record<AmountKey, MessageKey> = {
  wholesale: 'tower.amounts.h.wholesale',
  labourFee: 'tower.amounts.h.labourFee',
  handoverFee: 'tower.amounts.h.handoverFee',
  toteLoadFee: 'tower.amounts.h.toteLoadFee',
  mdpSortFee: 'tower.amounts.h.mdpSortFee',
  shelvingFee: 'tower.amounts.h.shelvingFee',
  releaseFee: 'tower.amounts.h.releaseFee',
  holdingFeePerDay: 'tower.amounts.h.holdingFeePerDay',
};

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
