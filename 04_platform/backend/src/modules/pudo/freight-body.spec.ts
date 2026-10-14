import { BODY_BECAUSE, bodyOf, canonicalBody, excludedByShipper } from './freight-body';

// A discrete, unremarkable palletised load — the baseline every case below varies one fact away from.
const pallet = { requiredCapabilities: [] as never[], bulk: false, weightKg: 400, dimensionsCm: [120, 100, 80] as [number, number, number] };

describe('canonicalBody (FB0b)', () => {
  it('resolves a load to exactly ONE body — the demand figure is meaningless otherwise', () => {
    // If a load counted toward every body that could possibly carry it, every corridor would show demand for
    // everything and "flatbed offered vs containers moved" would say nothing at all.
    expect(canonicalBody(pallet).body).toBe('box');
  });

  describe('the ladder, hardest constraint first', () => {
    it('cold chain outranks everything — the cargo spoils, it is not a preference', () => {
      // Bulk AND oversize AND indivisible, but perishable: still a reefer.
      expect(canonicalBody({ ...pallet, requiredCapabilities: ['coldChain'], bulk: true, weightKg: 30_000, indivisible: true }).body).toBe('refrigerated');
    });

    it('hazmat outranks shape and size', () => {
      expect(canonicalBody({ ...pallet, requiredCapabilities: ['hazmat'], weightKg: 30_000 }).body).toBe('hazmat');
    });

    it('loose bulk tips or augers — it never sits on a deck', () => {
      expect(canonicalBody({ ...pallet, bulk: true, weightKg: 24_000, dimensionsCm: undefined }).body).toBe('tipper');
    });

    it('an indivisible piece too big to split is a low-loader', () => {
      expect(canonicalBody({ ...pallet, weightKg: 26_000, indivisible: true }).body).toBe('lowboy');
      expect(canonicalBody({ ...pallet, dimensionsCm: [1400, 250, 200], indivisible: true }).body).toBe('lowboy');
    });

    it('the SAME load, divisible, is two ordinary trips instead — indivisibility is the whole difference', () => {
      // The one fact that separates "a permit and a low-loader" from "book it twice".
      expect(canonicalBody({ ...pallet, weightKg: 26_000, indivisible: true }).body).toBe('lowboy');
      expect(canonicalBody({ ...pallet, weightKg: 26_000, indivisible: false }).body).toBe('flatbed');
    });

    it('what will not go through a box van door needs an open deck', () => {
      expect(canonicalBody({ ...pallet, weightKg: 12_000 }).body).toBe('flatbed'); // over a closed body's payload
      expect(canonicalBody({ ...pallet, dimensionsCm: [900, 100, 80] }).body).toBe('flatbed'); // too long
      expect(canonicalBody({ ...pallet, dimensionsCm: [300, 260, 250] }).body).toBe('flatbed'); // too tall lying down
    });
  });

  it('judges height on the SHORTEST extent — a load is laid down the best way round', () => {
    // 250×120×100 is a tall load standing up and an ordinary one on its side. Nobody ships it standing up.
    expect(canonicalBody({ ...pallet, dimensionsCm: [250, 120, 100] }).body).toBe('box');
    // …and the same three numbers in any other order must give the same answer.
    expect(canonicalBody({ ...pallet, dimensionsCm: [100, 250, 120] }).body).toBe('box');
    expect(canonicalBody({ ...pallet, dimensionsCm: [120, 100, 250] }).body).toBe('box');
  });

  describe('basis — how much the derivation actually had to work with', () => {
    it('says MEASURED when it saw the load', () => {
      expect(canonicalBody(pallet).basis).toBe('measured');
    });

    it('says WEIGHT-ONLY when nobody measured it, rather than passing the guess off as a measurement', () => {
      // Someone invests real money on this series. "We measured this" and "we guessed from its weight" are
      // not the same claim, so the answer carries which one it is.
      const unmeasured = canonicalBody({ ...pallet, dimensionsCm: undefined });
      expect(unmeasured.basis).toBe('weight-only');
      expect(unmeasured.body).toBe('box'); // still answered — labelled, not withheld
    });

    it('a light-but-huge crate is exactly what weight-only gets wrong — and the label is the warning', () => {
      const measured = canonicalBody({ ...pallet, weightKg: 300, dimensionsCm: [900, 200, 200] });
      const unmeasured = canonicalBody({ ...pallet, weightKg: 300, dimensionsCm: undefined });
      expect(measured.body).toBe('flatbed');
      expect(unmeasured.body).toBe('box'); // under-called, because weight alone cannot see the 9 metres
      expect(unmeasured.basis).toBe('weight-only');
    });
  });

  it('every body it can return has a reason to show', () => {
    // The board prints BODY_BECAUSE under the load; a body with no entry would render a blank explanation.
    const reachable = ['refrigerated', 'hazmat', 'tipper', 'lowboy', 'flatbed', 'box'];
    for (const body of reachable) expect(BODY_BECAUSE[body]).toBeTruthy();
  });

  it('never returns NaN-driven nonsense for a corrupt weight', () => {
    expect(canonicalBody({ ...pallet, weightKg: Number.NaN }).body).toBe('box');
    expect(canonicalBody({ ...pallet, weightKg: undefined as never }).body).toBe('box');
  });
});

describe('bodyOf — the stamp, and the fallback', () => {
  it('returns the STAMPED conclusion, even when the ladder would now say otherwise', () => {
    // The point of freezing it: "kilometres of flatbed offered in 2026" must not change when someone tunes a
    // threshold in this file in 2027. A stamped record is history, not a live opinion.
    const stamped = bodyOf({ ...pallet, bodyDerived: { body: 'skeletal', basis: 'measured' } });
    expect(stamped.body).toBe('skeletal');
    expect(canonicalBody(pallet).body).toBe('box'); // …which is not what the ladder says today
  });

  it('derives live for a freight registered before the stamp existed, and admits it is weight-only', () => {
    const legacy = bodyOf({ requiredCapabilities: [], bulk: false, weightKg: 400 });
    expect(legacy.body).toBe('box');
    expect(legacy.basis).toBe('weight-only'); // a pre-FB0b record has no stored dimensions either
  });
});

describe('excludedByShipper', () => {
  it('is a PREFERENCE, kept apart from physics', () => {
    // The board has to be able to say "the shipper ruled out open bodies" rather than dressing it as a law.
    // A preference can be renegotiated; an axle limit cannot, and showing both the same way teaches an
    // operator to ignore both.
    expect(excludedByShipper('flatbed', ['flatbed', 'dropside'])).toBe(true);
    expect(excludedByShipper('box', ['flatbed'])).toBe(false);
    expect(excludedByShipper('flatbed', undefined)).toBe(false);
    expect(excludedByShipper('flatbed', [])).toBe(false);
  });
});
