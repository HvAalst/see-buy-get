import { COUNTRY_CATALOGUE } from './catalogue';
import { customsBorderBetween, customsUnionOf, EU_MEMBERS, unionBetween } from './customs-union';

/** 2026-11-22 — the EU as one customs territory (the owner's BG-2: "As recommended for all eu nations"). */
describe('one customs territory across the EU', () => {
  it('holds the 27 member states, each a country we know, Greece as GR', () => {
    expect(EU_MEMBERS).toHaveLength(27);
    expect(new Set(EU_MEMBERS).size).toBe(27);
    const known = new Set(COUNTRY_CATALOGUE.map((c) => c.code));
    expect(EU_MEMBERS.filter((c) => !known.has(c))).toEqual([]);
    expect(EU_MEMBERS).toContain('GR');
    expect(EU_MEMBERS).toEqual(expect.arrayContaining(['NL', 'BG', 'RO', 'HR', 'DE', 'BE']));
    // Not members: the United Kingdom, Switzerland, Norway, Turkey (a customs union for some goods, still declared), and
    // the outermost regions with codes of their own, which are outside the VAT area.
    for (const c of ['GB', 'CH', 'NO', 'TR', 'RE', 'GF', 'KE']) expect(customsUnionOf(c)).toBeUndefined();
  });

  it('puts no customs border between two members, and one between a member and anyone else', () => {
    expect(customsBorderBetween('NL', 'BG')).toBe(false);
    expect(customsBorderBetween('nl', ' bg ')).toBe(false);
    expect(unionBetween('NL', 'BG')).toBe('EU');
    expect(customsBorderBetween('NL', 'KE')).toBe(true);
    expect(customsBorderBetween('BG', 'TR')).toBe(true);
    expect(customsBorderBetween('NL', 'GB')).toBe(true);
    // East Africa's members still clear goods at their borders.
    expect(customsBorderBetween('KE', 'UG')).toBe(true);
    expect(unionBetween('KE', 'UG')).toBeUndefined();
  });

  it('is no border, and no union, inside one country or where a country is not known', () => {
    expect(customsBorderBetween('NL', 'NL')).toBe(false);
    expect(unionBetween('NL', 'NL')).toBeUndefined();
    expect(customsBorderBetween('NL', undefined)).toBe(false);
    expect(unionBetween(undefined, 'BG')).toBeUndefined();
  });
});
