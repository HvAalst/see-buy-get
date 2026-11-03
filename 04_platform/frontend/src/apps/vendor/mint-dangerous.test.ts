import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EMPTY_MINT, mintDangerous } from './logic';

/*
 * 2026-11-03 — A STORE'S HEAVY ORDER OF DANGEROUS GOODS (the gaps check of 2026-10-29 left this door open on purpose; the
 * owner: "Notice first, build now"). An order too big for the parcel network goes as a load of its own: the Store app asks
 * whether its goods are dangerous, and if so their UN number, name and class — and sends them for box 9.
 */
describe('a store’s heavy order says its dangerous goods', () => {
  const heavy = { ...EMPTY_MINT, dedicatedCargo: true };

  it('asks nothing of a parcel-sized order, or of goods that are not dangerous', () => {
    expect(mintDangerous({ ...EMPTY_MINT, dgKind: 'HAZ-FLAM' })).toEqual({ missing: false });
    expect(mintDangerous(heavy)).toEqual({ missing: false });
  });

  it('waits for all three, then sends them with the goods’ nature', () => {
    expect(mintDangerous({ ...heavy, dgKind: 'HAZ-FLAM', dg: { dgUn: '1075', dgName: '', dgClass: '2.1', dgGroup: '' } })).toEqual({ natureCode: 'HAZ-FLAM', missing: true });
    expect(mintDangerous({ ...heavy, dgKind: 'HAZ-FLAM', dg: { dgUn: 'un 1075', dgName: 'Petroleum gases, liquefied', dgClass: '2.1', dgGroup: 'II' } })).toEqual({
      natureCode: 'HAZ-FLAM',
      dangerousGoods: { unNumber: 'UN1075', properShippingName: 'Petroleum gases, liquefied', hazardClass: '2.1', packingGroup: 'II' },
      missing: false,
    });
  });

  it('is what the order screen asks and what the order sends', () => {
    const screen = readFileSync('src/apps/vendor/screens/MintScreen.tsx', 'utf8');
    // Only for an order going as a load, with the four choices, and Continue waiting for the three fields.
    expect(screen).toMatch(/\{f\.dedicatedCargo \? \(\s*<Card label=\{t\('vendor\.mint\.dangerousTitle'\)\}/);
    for (const k of ['HAZ-CHEM', 'HAZ-BIO', 'HAZ-FLAM']) expect(screen).toContain(`['${k}', `);
    expect(screen).toMatch(/<Choice\s+id="mint-dg-kind"/);
    expect(screen).toMatch(/const ready = dimsComplete\(f\) && Boolean\(f\.photoRef\) && !dangerous\.missing;/);
    const hook = readFileSync('src/apps/vendor/useVendorApp.ts', 'utf8');
    expect(hook).toMatch(/\.\.\.\(dangerous\.dangerousGoods \? \{ dangerousGoods: dangerous\.dangerousGoods \} : \{\}\)/);
  });
});
