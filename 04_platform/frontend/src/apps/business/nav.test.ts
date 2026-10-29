import { describe, expect, it } from 'vitest';
import { navGroupsFor, navSectionOf } from './logic';

/*
 * THE MENU IN GROUPS (the user, 2026-10-29: "Since we are growing, we must make careful decisions regarding the
 * navigation" — by direction with the mode inside, grouped with headings). Shipments by the way the goods go; road, rail,
 * sea and air are legs inside a record, never sections; each business sees only the groups its work needs.
 */
describe('the Business app’s menu', () => {
  it('an expeditor: shipments first — overview, domestic, exports, imports — then partners and the company', () => {
    expect(navGroupsFor(['expeditor']).map((g) => [g.key, g.sections])).toEqual([
      ['shipments', ['home', 'loads', 'exports', 'imports']],
      ['partners', ['contracts', 'clients']],
      ['company', ['people', 'details']],
    ]);
  });

  it('an importer sees no domestic loads, no exports and no partners; a yard and a receiver get Places', () => {
    expect(navGroupsFor(['importer']).map((g) => g.key)).toEqual(['shipments', 'company']);
    expect(navGroupsFor(['importer'])[0].sections).toEqual(['home', 'imports']);
    expect(navGroupsFor(['importer', 'depot', 'receiver']).find((g) => g.key === 'places')?.sections).toEqual(['inbound', 'yard']);
  });

  it('no mode is a section of its own, and Space on runs is a tab of Domestic', () => {
    const all = navGroupsFor(['shipper', 'expeditor', 'importer', 'clearing_agent', 'depot', 'receiver']).flatMap((g) => g.sections);
    expect(all).not.toContain('runs');
    expect(navSectionOf('runs')).toBe('loads');
    expect(navSectionOf('exports')).toBe('exports');
  });
});
