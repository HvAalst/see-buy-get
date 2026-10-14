import { COLD_CHAIN_BAND, isTempBreach, loadSafetyItems, missingKeys, requiredLoadKeys, requiredUnloadKeys, tempBand, unloadSafetyItems } from './heavy-cargo';

describe('heavy-cargo safety checklist (S33)', () => {
  const keys = (ctx: { bulk: boolean; fragile: boolean; requiredCapabilities: import('./cargo.types').VehicleCapability[] }) => requiredLoadKeys(ctx);

  it('a plain discrete freight has the base items + a "stacked" item', () => {
    expect(keys({ bulk: false, fragile: false, requiredCapabilities: [] })).toEqual(['distributed', 'secured', 'within_limit', 'closed', 'stacked']);
  });

  it('a bulk freight swaps "stacked" for "contained"', () => {
    const k = keys({ bulk: true, fragile: false, requiredCapabilities: [] });
    expect(k).toContain('contained');
    expect(k).not.toContain('stacked');
  });

  it('hazmat, fragile and cold-chain each add their own item', () => {
    expect(keys({ bulk: false, fragile: false, requiredCapabilities: ['hazmat'] })).toContain('hazmat_placard');
    expect(keys({ bulk: false, fragile: true, requiredCapabilities: [] })).toContain('cushioned');
    expect(keys({ bulk: false, fragile: false, requiredCapabilities: ['coldChain'] })).toContain('reefer_set');
    // A hazmat + fragile + cold discrete load carries all three extras on top of the 5-item base.
    expect(keys({ bulk: false, fragile: true, requiredCapabilities: ['hazmat', 'coldChain'] })).toHaveLength(8);
  });

  it('every item carries a plain-language label', () => {
    for (const item of loadSafetyItems({ bulk: true, fragile: true, requiredCapabilities: ['hazmat', 'coldChain'] })) {
      expect(item.label.length).toBeGreaterThan(4);
    }
  });

  it('the unload checklist is a fixed four-item base', () => {
    expect(requiredUnloadKeys()).toEqual(['correct_site', 'intact', 'handed_over', 'gear_safe']);
    expect(unloadSafetyItems()).toHaveLength(4);
  });

  it('missingKeys reports exactly what a confirmation set is short', () => {
    const required = ['a', 'b', 'c'];
    expect(missingKeys(required, ['a', 'b', 'c'])).toEqual([]);
    expect(missingKeys(required, ['a'])).toEqual(['b', 'c']);
    expect(missingKeys(required, undefined)).toEqual(['a', 'b', 'c']);
    expect(missingKeys(required, ['a', 'b', 'c', 'extra'])).toEqual([]); // extras are ignored
  });
});

describe('cold-chain temperature (S33b)', () => {
  it('tempBand is the chilled band for a temperature-controlled nature, null otherwise', () => {
    expect(tempBand('FOP')).toEqual(COLD_CHAIN_BAND); // perishable food → coldChain
    expect(tempBand('GEN')).toBeNull();
    expect(tempBand('HAZ-CHEM')).toBeNull(); // hazmat, but not cold-chain
    expect(tempBand('HUM')).toBeNull(); // pharma is "often cold" but not a coldChain-required nature here
  });

  it('isTempBreach flags a reading outside the inclusive band', () => {
    const band = COLD_CHAIN_BAND; // { minC: 2, maxC: 8 }
    expect(isTempBreach(5, band)).toBe(false);
    expect(isTempBreach(2, band)).toBe(false); // inclusive floor
    expect(isTempBreach(8, band)).toBe(false); // inclusive ceiling
    expect(isTempBreach(1.9, band)).toBe(true);
    expect(isTempBreach(8.1, band)).toBe(true);
    expect(isTempBreach(-18, band)).toBe(true); // frozen is a breach of the chilled band
  });
});
