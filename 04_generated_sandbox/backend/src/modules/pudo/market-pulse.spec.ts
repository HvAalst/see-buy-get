import { MarketCellPulse, MarketPulseStore } from './market-pulse.store';

describe('MarketPulseStore (S34b)', () => {
  const cellOf = (lat: number, lng: number) => MarketPulseStore.cellFor({ lat, lng });

  describe('cellFor — the market-zone bucket', () => {
    it('buckets coordinates to a 0.1° cell', () => {
      expect(cellOf(-1.234, 36.876)).toBe('-1.2,36.9');
      expect(cellOf(-1.21, 36.84)).toBe('-1.2,36.8');
      // Two nearby points fall in the same cell; a point >0.1° away does not.
      expect(cellOf(-1.23, 36.81)).toBe(cellOf(-1.24, 36.84));
      expect(cellOf(-1.23, 36.81)).not.toBe(cellOf(-1.55, 36.81));
    });
  });

  describe('clampRaw — the engine band', () => {
    it('clamps to [0.7, 2.0] and neutralises non-finite', () => {
      expect(MarketPulseStore.clampRaw(1)).toBe(1);
      expect(MarketPulseStore.clampRaw(5)).toBe(2);
      expect(MarketPulseStore.clampRaw(0.1)).toBe(0.7);
      expect(MarketPulseStore.clampRaw(Number.NaN)).toBe(1);
      expect(MarketPulseStore.clampRaw(Number.POSITIVE_INFINITY)).toBe(1);
    });
  });

  describe('factorFor', () => {
    let store: MarketPulseStore;
    beforeEach(() => {
      store = new MarketPulseStore();
    });

    it('is a neutral 1.0 with no geo, an unsampled cell, or a bad coordinate', () => {
      expect(store.factorFor(undefined)).toBe(1);
      expect(store.factorFor({ lat: -1.2, lng: 36.8 })).toBe(1); // never sampled
      expect(store.factorFor({ lat: Number.NaN, lng: 36.8 })).toBe(1);
    });

    it('returns a sampled cell\'s organic factor', () => {
      const cell = cellOf(-1.2, 36.8);
      const pulse: MarketCellPulse = { cell, label: 'NorthTown', supply: 1, demand: 5, pressure: 5, organicFactor: 1.5, factor: 1.5, ruleApplied: false, sampledAt: 'x' };
      store.writeSnapshot([pulse]);
      expect(store.factorFor({ lat: -1.2, lng: 36.8 })).toBe(1.5);
    });

    it('an active surge rule OVERRIDES the organic factor (applied live, clamped to the band)', () => {
      const cell = cellOf(-1.2, 36.8);
      store.writeSnapshot([{ cell, label: 'NorthTown', supply: 3, demand: 3, pressure: 1, organicFactor: 1, factor: 1, ruleApplied: false, sampledAt: 'x' }]);
      store.setRule({ cell, factor: 5, reason: 'stadium', by: 'op', setAt: 'x' }); // 5 clamps to the 2.0 ceiling
      expect(store.factorFor({ lat: -1.2, lng: 36.8 })).toBe(2);
    });

    it('ignores a lapsed rule and falls back to the organic factor', () => {
      const cell = cellOf(-1.2, 36.8);
      store.writeSnapshot([{ cell, label: 'NorthTown', supply: 2, demand: 4, pressure: 2, organicFactor: 1.25, factor: 1.25, ruleApplied: false, sampledAt: 'x' }]);
      const now = Date.parse('2026-07-22T12:00:00Z');
      store.setRule({ cell, factor: 1.8, reason: 'event', by: 'op', setAt: 'x', expiresAt: new Date(now - 60_000).toISOString() });
      expect(store.factorFor({ lat: -1.2, lng: 36.8 }, now)).toBe(1.25); // rule expired → organic
      expect(store.activeRules(now)).toHaveLength(0);
    });

    it('treats an unparseable expiry as lapsed — consistently in pricing AND the watchtower (no phantom surge)', () => {
      const cell = cellOf(-1.2, 36.8);
      store.writeSnapshot([{ cell, label: 'NorthTown', supply: 1, demand: 4, pressure: 4, organicFactor: 1.3, factor: 1.3, ruleApplied: false, sampledAt: 'x' }]);
      store.setRule({ cell, factor: 1.9, reason: 'typo', by: 'op', setAt: 'x', expiresAt: 'tomorrow 6pm' }); // malformed date
      // Both read paths agree the rule does NOT apply — never a permanent, watchtower-invisible surge.
      expect(store.factorFor({ lat: -1.2, lng: 36.8 })).toBe(1.3); // organic, not the 1.9 rule
      expect(store.activeRules()).toHaveLength(0);
    });

    it('clearRule removes an override', () => {
      const cell = cellOf(-1.2, 36.8);
      store.setRule({ cell, factor: 1.6, reason: 'event', by: 'op', setAt: 'x' });
      expect(store.factorFor({ lat: -1.2, lng: 36.8 })).toBe(1.6);
      store.clearRule(cell);
      expect(store.factorFor({ lat: -1.2, lng: 36.8 })).toBe(1);
    });
  });
});
