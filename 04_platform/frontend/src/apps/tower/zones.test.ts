import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { UPLOAD_LIMITS } from '../../shared/upload';
import { EMPTY_AREA_FORM, areaFormProblem, decodePolygon, decodeRing, groupColour, groupName, groupsProblem, publishFrom, workingMap, zonesHint, type ZoneSetup } from './zones';

const GROUPS = [
  { key: 'urban', name: 'Urban' },
  { key: 'rural', name: 'Rural' },
  { key: 'remote', name: 'Remote' },
];
const MAP = { version: 1, status: 'in_force' as const, createdAt: '', createdBy: '', areas: { setId: 's', source: '', licence: '', attribution: '', level: '', count: 1, importedAt: '', importedBy: '' }, zones: [] };
const setup = (over: Partial<ZoneSetup> = {}): ZoneSetup => ({ entityId: 'x', country: 'XX', groups: GROUPS, scheduled: [], versions: [], outside: [], ...over });

describe('a country’s zones in the console (2026-11-08)', () => {
  it('reads the shapes the server sends: the encoding’s own worked example, latitude first', () => {
    expect(decodeRing('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
    // A polygon is its rings separated by a space, outer first.
    expect(decodeRing('_p~iF~ps|U')).toEqual([[38.5, -120.2]]);
    expect(decodePolygon('_p~iF~ps|U _ulLnnqC')).toEqual([decodeRing('_p~iF~ps|U'), decodeRing('_ulLnnqC')]);
  });

  it('works on the draft when one is open, else on the map in force', () => {
    expect(workingMap(null)).toBeUndefined();
    expect(workingMap(setup({ inForce: MAP }))?.version).toBe(1);
    expect(workingMap(setup({ inForce: MAP, draft: { ...MAP, version: 2, status: 'draft' } }))?.version).toBe(2);
  });

  it('says in one line what is in force, what is being worked on, or that there is nothing yet', () => {
    expect(zonesHint(setup(), t)).toBe(t('tower.zones.hint.none'));
    expect(zonesHint(setup({ inForce: { ...MAP, zones: [{ code: 'Z0001', name: 'A', group: 'urban', areas: 1, areaKm2: 1, centre: { lat: 0, lng: 0 } }] } }), t)).toBe('Map 1 in force · 1 zone');
    expect(zonesHint(setup({ inForce: MAP, draft: { ...MAP, version: 2, status: 'draft' } }), t)).toBe('Draft 2 · 0 zones');
  });

  it('names and colours a group by its place in the country’s list; a group it does not know is said by its key', () => {
    expect(groupName(GROUPS, 'rural')).toBe('Rural');
    expect(groupName(GROUPS, 'g9')).toBe('g9');
    expect(groupColour(GROUPS, 'urban')).not.toBe(groupColour(GROUPS, 'rural'));
    expect(groupColour(GROUPS, 'remote')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('stops a boundary file before it is sent: no file, too large, or the licence’s three things unsaid', () => {
    expect(areaFormProblem(EMPTY_AREA_FORM)).toBe('tower.zones.import.needFile');
    const filled = { ...EMPTY_AREA_FORM, text: '{}', fileName: 'areas.geojson', source: 'A survey', licence: 'CC BY 4.0', attribution: 'Its contributors' };
    expect(areaFormProblem(filled)).toBeNull();
    expect(areaFormProblem({ ...filled, text: 'x'.repeat(UPLOAD_LIMITS.zoneAreasText + 1) })).toBe('tower.zones.import.tooLarge');
    expect(areaFormProblem({ ...filled, source: ' ' })).toBe('tower.zones.import.needSource');
    expect(areaFormProblem({ ...filled, licence: '' })).toBe('tower.zones.import.needLicence');
    expect(areaFormProblem({ ...filled, attribution: '' })).toBe('tower.zones.import.needCredit');
  });

  it('checks the groups as typed: at least one, at most eight, no name twice', () => {
    expect(groupsProblem([{ name: ' ' }])).toBe('tower.zones.groups.needOne');
    expect(groupsProblem(Array.from({ length: 9 }, (_, i) => ({ name: `G${i}` })))).toBe('tower.zones.groups.tooMany');
    expect(groupsProblem([{ name: 'Urban' }, { name: 'urban' }])).toBe('tower.zones.groups.twice');
    expect(groupsProblem(GROUPS)).toBeNull();
  });

  it('publishes now for today, and from midnight of a later day', () => {
    expect(publishFrom('2026-11-08', '2026-11-08')).toBeUndefined();
    expect(publishFrom('', '2026-11-08')).toBeUndefined();
    expect(publishFrom('2026-11-10', '2026-11-08')).toBe(new Date('2026-11-10T00:00:00').toISOString());
  });
});
