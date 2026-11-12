import { describe, expect, it } from 'vitest';
import { densityFill, invitationLink, rowReason, suggestionLine, type HubRow, type HubSuggestion } from './hubDensity';

const base: HubSuggestion = { id: 'need:KE-MRS', kind: 'hub_needed', score: 30, place: { name: 'Marsabit', lat: 2.3284, lng: 37.9899 }, zones: ['KE-MRS'], zoneNames: ['Marsabit'], hubs: ['mdp_isiolo'], hubNames: ['Isiolo'], numbers: { shops: 2, parcels: 10, km: 340, reach: 150 }, towns: [] };
const t = (key: string, p?: Record<string, string | number>) => `${key}${p ? ' ' + JSON.stringify(p) : ''}`;

describe('where hubs are needed, on the console (2026-11-12)', () => {
  it('invites from a row to the hub sign-up with the place filled in and the row’s code (the owner’s D2)', () => {
    expect(invitationLink({ name: 'Marsabit', location: { lat: 2.3284, lng: 37.9899 } }, 'K7QW3M', 'https://seebuyget.com/')).toBe('https://seebuyget.com/?join=mdp&near=2.3284%2C37.9899&place=Marsabit&row=K7QW3M');
    expect(invitationLink({}, 'K7QW3M', 'https://x.test')).toBe('https://x.test/?join=mdp&row=K7QW3M');
  });
  it('a row says the suggestion it stands for', () => {
    const row = { rowId: 'sug:need:KE-MRS', kind: 'place', source: 'optimiser', status: 'open', suggestionKind: 'hub_needed', numbers: { shops: 2, parcels: 10, km: 340, reach: 150 }, zoneNames: ['Marsabit'], hubNames: ['Isiolo'], towns: [] } as HubRow;
    expect(rowReason(row, t as never)).toContain('tower.density.line.hub_needed');
    expect(rowReason({ ...row, suggestionKind: undefined }, t as never)).toBe('');
  });
  it('colours coverage by state and demand by depth', () => {
    const zone = { code: 'Z', name: 'Z', group: 'remote', centre: { lat: 0, lng: 0 }, shops: 1, sent30: 5, received30: 5, served: false, coverage: 'too_far' as const };
    expect(densityFill(zone, 'coverage', 10)).toBe('#c62828');
    expect(densityFill({ ...zone, coverage: 'near' }, 'coverage', 10)).toBe('#2e7d32');
    expect(densityFill(zone, 'demand', 10)).toBe('#2d3c9e');
    expect(densityFill({ ...zone, sent30: 0, received30: 0 }, 'demand', 10)).toBe('#e3e7f7');
  });
  it('says each kind with its numbers', () => {
    expect(suggestionLine(base, t as never)).toContain('tower.density.line.hub_needed');
    expect(suggestionLine(base, t as never)).toContain('"km":340');
    expect(suggestionLine({ ...base, kind: 'extra_hub', numbers: { fullDays: 7, days: 14, ratio: 1.4 } }, t as never)).toContain('extra_hub_ratio');
    expect(suggestionLine({ ...base, kind: 'too_close', hubNames: ['A', 'B'], numbers: { apart: 12, min: 60 } }, t as never)).toContain('"min":60');
    expect(suggestionLine({ ...base, kind: 'road_gap', hubNames: ['A', 'B'], numbers: { apart: 520 } }, t as never)).toContain('road_gap');
  });
});
