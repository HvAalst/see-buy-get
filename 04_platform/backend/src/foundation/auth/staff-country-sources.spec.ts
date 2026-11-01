import { STAFF_AREAS } from './staff-areas.table';
import { COUNTRY_SOURCES, RECORD_KINDS, countrySourceOf, kindsInUse } from './staff-country-sources';

/**
 * 2026-11-01 — EVERY STAFF DOOR SAYS WHERE ITS RECORD'S COUNTRY COMES FROM (the owner: "everything needs to be separated
 * by country"). As who-is-calling refuses a route that says nobody, this refuses a staff door that says no country: a
 * door added without one would show a Kenya colleague the Netherlands' records without anybody deciding it should.
 */
describe('every staff door says which country its record is in', () => {
  const staffDoors = Object.entries(STAFF_AREAS)
    .filter(([, area]) => area !== 'none')
    .map(([key]) => key);

  it('reads the staff doors at all (a guard that read nothing would pass on nothing)', () => {
    expect(staffDoors.length).toBeGreaterThan(600);
  });

  it('declares a source for every one', () => {
    const missing = staffDoors.filter((key) => !countrySourceOf(key));
    expect(missing).toEqual([]);
  });

  it('names, for a record or a country in the path, a parameter the path really has', () => {
    const wrong: string[] = [];
    for (const key of staffDoors) {
      const source = countrySourceOf(key)!;
      const param = 'record' in source ? source.param : 'country' in source && source.country === 'param' ? source.name : undefined;
      if (param && !key.split(' ')[1].split('/').includes(`:${param}`)) wrong.push(`${key} → :${param}`);
    }
    expect(wrong).toEqual([]);
  });

  it('declares nothing for a door that does not exist, or that is not a staff door', () => {
    const stray = Object.keys(COUNTRY_SOURCES).filter((key) => !STAFF_AREAS[key] || STAFF_AREAS[key] === 'none');
    expect(stray).toEqual([]);
  });

  it('uses only record kinds that have a name', () => {
    for (const kind of kindsInUse()) expect(RECORD_KINDS).toContain(kind);
  });
});
