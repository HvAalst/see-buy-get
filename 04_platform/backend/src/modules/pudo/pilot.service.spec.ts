import { isoWeek, takenInAt, weekStart } from './pilot.service';
import type { Parcel } from './pudo.types';

/** The pilot's weeks run Monday to Monday, UTC, and are named as ISO weeks — the year is the one the week's Thursday falls in. */
describe('the pilot’s weeks', () => {
  it('starts each week on Monday 00:00 UTC, whatever the day', () => {
    expect(new Date(weekStart(Date.parse('2026-10-18T23:59:00Z'))).toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(new Date(weekStart(Date.parse('2026-10-12T00:00:00Z'))).toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });

  it('names a week as ISO does, across the turn of a year with fifty-three weeks', () => {
    expect(isoWeek(Date.parse('2026-10-12T00:00:00Z'))).toBe('2026-W42');
    expect(isoWeek(Date.parse('2025-12-29T00:00:00Z'))).toBe('2026-W01');
    expect(isoWeek(Date.parse('2026-12-28T00:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(Date.parse('2027-01-04T00:00:00Z'))).toBe('2027-W01');
  });

  it('counts a parcel as taken in when a counter took it — never when somebody minted it at home', () => {
    const scan = (status: string, by: string, at: string) => ({ status, by, at, note: '' });
    const minted = { originAgentDid: 'did:shop', scans: [scan('CREATED', 'did:person', '2026-10-12T08:00:00Z'), scan('At_PUDO', 'did:shop', '2026-10-13T09:00:00Z')] } as unknown as Parcel;
    const walkUp = { originAgentDid: 'did:shop', scans: [scan('CREATED', 'did:shop', '2026-10-14T10:00:00Z')] } as unknown as Parcel;
    const neverHandedIn = { originAgentDid: 'did:shop', scans: [scan('CREATED', 'did:person', '2026-10-12T08:00:00Z')] } as unknown as Parcel;
    expect([takenInAt(minted), takenInAt(walkUp), takenInAt(neverHandedIn)]).toEqual([Date.parse('2026-10-13T09:00:00Z'), Date.parse('2026-10-14T10:00:00Z'), undefined]);
  });
});
