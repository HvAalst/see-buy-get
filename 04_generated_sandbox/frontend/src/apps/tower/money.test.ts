import { describe, expect, it } from 'vitest';
import {
  AMOUNT_HINT,
  AMOUNT_LABEL,
  AMOUNT_ORDER,
  amountOf,
  amountsFormError,
  amountsFormOf,
  amountsInForce,
  amountsPayload,
  counterParcelMath,
  type CompanyAmount,
  coverFormError,
  coverFormOf,
  coverPayload,
  laneLabel,
  pctLabel,
  pctText,
  pctToFraction,
  rateFormError,
  rateFormOf,
  ratesPayload,
  taxFormError,
  taxFormOf,
  taxPayload,
  isOwnedHere,
  type LanePricing,
  type PricingBounds,
} from './money';

/**
 * The console's money logic.
 *
 * Two failures this file exists to prevent, both silent:
 *
 *   1. THE UNIT SEAM. An operator types 16 meaning sixteen percent; the network stores 0.16. Getting that
 *      backwards charges a hundred times too much and looks like a working screen.
 *   2. THE INHERITANCE SEAM. Every knob resolves through fallbacks, and a form that puts the RESOLVED
 *      value in every box converts an inherited number into one that lane now owns, for every lane, the
 *      first time anybody saves anything. Nothing would look wrong until the default was changed and
 *      nothing moved.
 */

const t = ((key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : key) as never;

const BOUNDS: PricingBounds = { minRatePct: 0, maxRatePct: 0.3, minTaxPct: 0, maxTaxPct: 0.4, maxPremiumPct: 0.1 };

const row = (over: Partial<LanePricing> = {}): LanePricing => ({
  rates: { costOfRiskPct: 0, profitOnRiskPct: 0, marginPct: 0.02, totalPct: 0.02 },
  rateOrigin: { costOfRiskPct: 'network', profitOnRiskPct: 'network', marginPct: 'network' },
  tax: { ratePct: 0, label: 'Tax' },
  taxOrigin: 'none',
  insurance: { premiumPct: 0, freeLimit: 0 },
  insuranceOrigin: 'none',
  ...over,
});

describe('percentages and the fractions underneath them', () => {
  it('reads a stored fraction as the percentage an operator talks in', () => {
    expect(pctText(0.02)).toBe('2');
    expect(pctText(0.0225)).toBe('2.25');
    expect(pctText(0)).toBe('0');
  });

  it('turns what they type back into a fraction, and never off by a hundred', () => {
    expect(pctToFraction('16')).toBe(0.16);
    expect(pctToFraction('2.25')).toBe(0.0225);
    expect(pctToFraction('0')).toBe(0);
    // Round-trips, which is the property that actually matters: what the box shows is what it stores.
    for (const f of [0, 0.005, 0.02, 0.0225, 0.16, 0.3]) expect(pctToFraction(pctText(f))).toBe(f);
  });

  it('forgives the three things people actually type', () => {
    expect(pctToFraction(' 16 ')).toBe(0.16);
    expect(pctToFraction('16%')).toBe(0.16);
    expect(pctToFraction('2,5')).toBe(0.025); // a comma decimal — most of this network's languages use one
  });

  it('refuses anything that is not a number rather than guessing at one', () => {
    for (const junk of ['abc', '--', '1.2.3', '%']) expect(pctToFraction(junk)).toBeNull();
  });

  it('does not scale a money amount, because a cover limit is not a rate', () => {
    expect(amountOf('5000')).toBe(5000);
    expect(amountOf('5,000')).toBe(5000);
    expect(amountOf('abc')).toBeNull();
  });

  it('reads a rate back at a fixed width, so a column of them lines up', () => {
    expect(pctLabel(0.02)).toBe('2.00%');
    expect(pctLabel(0.3, 0)).toBe('30%');
  });
});

describe('what the boxes start with — an empty box INHERITS', () => {
  it('leaves a box empty when the number came from anywhere wider than this level', () => {
    const inherited = row({ lane: 'pudo', rateOrigin: { costOfRiskPct: 'sister', profitOnRiskPct: 'network', marginPct: 'legacy-fee' } });
    expect(rateFormOf(inherited)).toEqual({ costOfRisk: '', profitOnRisk: '', margin: '' });
  });

  it('fills a box only where this level is what holds the number', () => {
    const own = row({
      lane: 'dedicated',
      rates: { costOfRiskPct: 0.01, profitOnRiskPct: 0.02, marginPct: 0.05, totalPct: 0.08 },
      rateOrigin: { costOfRiskPct: 'lane', profitOnRiskPct: 'sister', marginPct: 'lane' },
    });
    expect(rateFormOf(own)).toEqual({ costOfRisk: '1', profitOnRisk: '', margin: '5' });
  });

  it('reads the DEFAULT row against the sister, not against a lane', () => {
    // The same origin means different things on the two kinds of row, and getting this backwards makes
    // the default row look permanently inherited — from itself.
    const sisterDefault = row({ rates: { costOfRiskPct: 0, profitOnRiskPct: 0, marginPct: 0.03, totalPct: 0.03 }, rateOrigin: { costOfRiskPct: 'network', profitOnRiskPct: 'network', marginPct: 'sister' } });
    expect(rateFormOf(sisterDefault).margin).toBe('3');
    expect(isOwnedHere('sister', undefined)).toBe(true);
    expect(isOwnedHere('sister', 'pudo')).toBe(false);
    expect(isOwnedHere('lane', 'pudo')).toBe(true);
  });

  it('does not treat the pre-layers knob as a margin somebody set HERE', () => {
    // 'legacy-fee' is a real number and a real fallback, and typing it back in is an upgrade the operator
    // should make deliberately — not something a form does for them by pre-filling the box.
    const legacy = row({ rates: { costOfRiskPct: 0, profitOnRiskPct: 0, marginPct: 0.05, totalPct: 0.05 }, rateOrigin: { costOfRiskPct: 'network', profitOnRiskPct: 'network', marginPct: 'legacy-fee' } });
    expect(rateFormOf(legacy).margin).toBe('');
  });

  it('opens the tax and cover forms the same way, whole rather than field by field', () => {
    const taxed = row({ lane: 'pudo', tax: { ratePct: 0.16, label: 'VAT' }, taxOrigin: 'lane' });
    expect(taxFormOf(taxed, 'KE-VAT-1')).toEqual({ rate: '16', label: 'VAT', registration: 'KE-VAT-1' });
    const inherited = row({ lane: 'pudo', tax: { ratePct: 0.16, label: 'VAT' }, taxOrigin: 'sister' });
    expect(taxFormOf(inherited, 'KE-VAT-1')).toEqual({ rate: '', label: '', registration: 'KE-VAT-1' });

    const covered = row({ insurance: { premiumPct: 0.02, freeLimit: 5000 }, insuranceOrigin: 'sister' });
    expect(coverFormOf(covered)).toEqual({ freeLimit: '5000', premium: '2' });
    expect(coverFormOf(row({ lane: 'mdp', insurance: { premiumPct: 0.02, freeLimit: 5000 }, insuranceOrigin: 'sister' }))).toEqual({ freeLimit: '', premium: '' });
  });
});

describe('what the boxes send', () => {
  it('sends a blank box as null — "clear it, I want the fallback"', () => {
    // undefined would mean "leave it alone", which is a different intention and would make clearing a
    // knob impossible from this screen.
    expect(ratesPayload({ costOfRisk: '', profitOnRisk: '2', margin: '' }, 'pudo')).toEqual({
      lane: 'pudo',
      costOfRiskPct: null,
      profitOnRiskPct: 0.02,
      marginPct: null,
    });
  });

  it('omits the lane entirely on the default row', () => {
    expect(ratesPayload({ costOfRisk: '1', profitOnRisk: '', margin: '' })).toEqual({ costOfRiskPct: 0.01, profitOnRiskPct: null, marginPct: null });
  });

  it('sends the registration with every tax save, because the rate and the authority are one act', () => {
    expect(taxPayload({ rate: '16', label: 'VAT', registration: 'KE-1' })).toEqual({ ratePct: 0.16, label: 'VAT', registration: 'KE-1' });
    expect(taxPayload({ rate: '', label: '', registration: '' }, 'mdp')).toEqual({ lane: 'mdp', ratePct: null, label: null, registration: null });
  });

  it('keeps the cover limit as money and the premium as a rate', () => {
    expect(coverPayload({ freeLimit: '5000', premium: '2' })).toEqual({ freeLimit: 5000, premiumPct: 0.02 });
  });
});

describe('the refusals, said before the operator commits', () => {
  it('catches the typo that matters', () => {
    expect(rateFormError({ costOfRisk: 'x', profitOnRisk: '', margin: '' }, BOUNDS, t)).toContain('tower.rates.notANumber');
  });

  it('holds each layer to the bound the SERVER published, not to one of its own', () => {
    expect(rateFormError({ costOfRisk: '', profitOnRisk: '', margin: '31' }, BOUNDS, t)).toContain('tower.rates.outOfBounds');
    expect(rateFormError({ costOfRisk: '', profitOnRisk: '', margin: '30' }, BOUNDS, t)).toBeNull();
  });

  it('adds the three layers rather than compounding them, and says so when they go over', () => {
    // 5+5+5 applied in sequence is 15.76%; these are summed, and an operator has to be able to predict
    // the effect of a knob or it is not a knob worth having.
    expect(rateFormError({ costOfRisk: '10', profitOnRisk: '10', margin: '10' }, BOUNDS, t)).toBeNull();
    const over = rateFormError({ costOfRisk: '15', profitOnRisk: '15', margin: '5' }, BOUNDS, t);
    expect(over).toContain('tower.rates.sumOverCeiling');
    expect(over).toContain('sum=35.00%');
  });

  it('refuses a tax rate above zero with nobody to collect it for', () => {
    expect(taxFormError({ rate: '16', label: 'VAT', registration: '' }, BOUNDS, t)).toBe('tower.tax.needsRegistration');
    expect(taxFormError({ rate: '16', label: 'VAT', registration: 'KE-1' }, BOUNDS, t)).toBeNull();
    // Zero is a complete answer and needs no registration at all.
    expect(taxFormError({ rate: '0', label: '', registration: '' }, BOUNDS, t)).toBeNull();
    // And a blank rate is not a rate of zero — it is "inherit", which this level cannot be wrong about.
    expect(taxFormError({ rate: '', label: '', registration: '' }, BOUNDS, t)).toBeNull();
  });

  it('bounds the premium and lets the free limit be as generous as a sister likes', () => {
    // A sister promising to carry more risk itself costs a customer nothing, so there is no ceiling on it.
    expect(coverFormError({ freeLimit: '10000000', premium: '' }, BOUNDS, t)).toBeNull();
    expect(coverFormError({ freeLimit: '', premium: '11' }, BOUNDS, t)).toContain('tower.rates.outOfBounds');
    expect(coverFormError({ freeLimit: '-1', premium: '' }, BOUNDS, t)).toBe('tower.cover.negative');
  });
});

describe('the lanes', () => {
  it('names the default row as a default rather than as an empty lane', () => {
    expect(laneLabel(undefined, t)).toBe('tower.lane.default');
    expect(laneLabel('pudo', t)).toBe('tower.lane.pudo');
    // A lane the server grows that this build has never heard of shows its key rather than nothing.
    expect(laneLabel('barge', t)).toBe('barge');
  });
});

/**
 * A COMPANY'S LIST OF AMOUNTS — what a parcel costs and what each step pays.
 *
 * The inheritance seam again, in money this time: an EMPTY box is "what every company starts from", a typed 0 is a
 * decision, and saving one figure must not turn the seven beside it into decisions nobody took.
 */
describe('a company’s list of amounts', () => {
  const STARTS: Record<string, number> = { wholesale: 1.6, labourFee: 0.4, handoverFee: 0.5, shelvingFee: 0.15, releaseFee: 0.15, toteLoadFee: 0.5, mdpSortFee: 0.2, holdingFeePerDay: 0.1 };
  const list = (own: Record<string, number> = {}): { amounts: CompanyAmount[] } => ({
    amounts: Object.keys(STARTS).map((key) => ({ key: key as CompanyAmount['key'], amount: own[key] ?? STARTS[key], own: key in own, startsAt: STARTS[key] })),
  });
  const typed = (pricing: { amounts: CompanyAmount[] }, over: Record<string, string>) => ({ ...amountsFormOf(pricing), ...over });

  it('has a box, a label and a line of explanation for every amount the server keeps — and no other', () => {
    expect([...AMOUNT_ORDER].sort()).toEqual(Object.keys(STARTS).sort());
    expect(Object.keys(AMOUNT_LABEL).sort()).toEqual(Object.keys(STARTS).sort());
    expect(Object.keys(AMOUNT_HINT).sort()).toEqual(Object.keys(STARTS).sort());
    // Read in the order a parcel travels: what comes in first, what waiting costs last.
    expect(AMOUNT_ORDER[0]).toBe('wholesale');
    expect(AMOUNT_ORDER[AMOUNT_ORDER.length - 1]).toBe('holdingFeePerDay');
  });

  it('opens with this company’s OWN figures, and an empty box wherever it has set none', () => {
    expect(amountsFormOf(list())).toEqual({ wholesale: '', labourFee: '', handoverFee: '', toteLoadFee: '', mdpSortFee: '', shelvingFee: '', releaseFee: '', holdingFeePerDay: '' });
    expect(amountsFormOf(list({ wholesale: 160, handoverFee: 0 }))).toMatchObject({ wholesale: '160', handoverFee: '0', labourFee: '' });
  });

  it('sends only what was changed', () => {
    const stored = list({ wholesale: 160 });
    expect(amountsPayload(amountsFormOf(stored), stored)).toEqual({});
    expect(amountsPayload(typed(stored, { labourFee: '40' }), stored)).toEqual({ labourFee: 40 });
    // Typed as it stands: not a change.
    expect(amountsPayload(typed(stored, { wholesale: '160.00' }), stored)).toEqual({});
    expect(amountsPayload(typed(stored, { wholesale: '175' }), stored)).toEqual({ wholesale: 175 });
  });

  it('an emptied box puts the figure back; a typed 0 is a decision; the starting figure typed is one too', () => {
    const stored = list({ wholesale: 160, handoverFee: 55 });
    expect(amountsPayload(typed(stored, { handoverFee: '' }), stored)).toEqual({ handoverFee: null });
    expect(amountsPayload(typed(stored, { handoverFee: '0' }), stored)).toEqual({ handoverFee: 0 });
    // A box that was empty and stays empty says nothing — it does not send the greyed figure.
    expect(amountsPayload(typed(stored, { labourFee: '  ' }), stored)).toEqual({});
    // "0.4" typed where nothing was set makes it this company's own 0.4: it no longer follows the starting figure.
    expect(amountsPayload(typed(stored, { labourFee: '0.4' }), stored)).toEqual({ labourFee: 0.4 });
  });

  it('says the server’s refusals before the button is pressed', () => {
    const stored = list();
    expect(amountsFormError(amountsFormOf(stored), stored, t)).toBeNull();
    expect(amountsFormError(typed(stored, { labourFee: 'forty' }), stored, t)).toBe('tower.rates.notANumber(field=tower.amounts.k.labourFee)');
    expect(amountsFormError(typed(stored, { releaseFee: '-1' }), stored, t)).toBe('tower.amounts.negative(field=tower.amounts.k.releaseFee)');
    expect(amountsFormError(typed(stored, { wholesale: '0' }), stored, t)).toBe('tower.amounts.priceNeeded');
    // Nothing unreadable is sent beside what can be read.
    expect(amountsPayload(typed(stored, { labourFee: 'forty', releaseFee: '12' }), stored)).toEqual({ releaseFee: 12 });
    // A step paid nothing is allowed; only the price of a parcel must be something.
    expect(amountsFormError(typed(stored, { handoverFee: '0' }), stored, t)).toBeNull();
  });

  it('works out the list as it WOULD stand, and says what one counter parcel brings in against what it pays out', () => {
    const stored = list({ wholesale: 160 });
    const draft = typed(stored, { shelvingFee: '15', releaseFee: '12' });
    expect(amountsInForce(draft, stored)).toMatchObject({ wholesale: 160, shelvingFee: 15, releaseFee: 12, mdpSortFee: 0.2, labourFee: 0.4 });
    expect(counterParcelMath(amountsInForce(draft, stored))).toEqual({ price: 160, perParcel: 27.2, over: false });
    // The figure typed in the wrong box: every parcel would pay out more than it brings in — said loudly, not refused.
    const slip = typed(list(), { shelvingFee: '160' });
    expect(counterParcelMath(amountsInForce(slip, list()))).toMatchObject({ price: 1.6, over: true });
    // An emptied box is read at the starting figure, not at what the company had.
    expect(amountsInForce(typed(stored, { wholesale: '' }), stored).wholesale).toBe(1.6);
  });
});
