import { takenInAt, weekInWords, weekName, weekStart } from './pilot.service';
import type { Parcel } from './pudo.types';

/** The pilot's weeks run Sunday to Saturday, UTC (the user, 2026-10-26), each named by its first day. */
describe('the pilot’s weeks', () => {
  it('starts each week on Sunday 00:00 UTC, whatever the day — Saturday is its last', () => {
    // Sat 24 Oct, the last minute: still the week of Sun 18 Oct. Sun 25 Oct, its first minute: a new week.
    expect(new Date(weekStart(Date.parse('2026-10-24T23:59:00Z'))).toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(new Date(weekStart(Date.parse('2026-10-25T00:00:00Z'))).toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(new Date(weekStart(Date.parse('2026-10-26T12:00:00Z'))).toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('names a week by its first day, across the turn of a year, and says it in words', () => {
    expect(weekName(Date.parse('2026-10-25T00:00:00Z'))).toBe('2026-10-25');
    // Sun 27 Dec 2026 to Sat 2 Jan 2027: the week is the one it began in.
    expect(weekName(weekStart(Date.parse('2027-01-01T08:00:00Z')))).toBe('2026-12-27');
    expect(weekInWords(Date.parse('2026-10-25T00:00:00Z'))).toBe('the week of Sunday 25 October 2026');
  });

  it('counts a parcel as taken in when a counter took it — never when somebody minted it at home', () => {
    const scan = (status: string, by: string, at: string) => ({ status, by, at, note: '' });
    const minted = { originAgentDid: 'did:shop', scans: [scan('CREATED', 'did:person', '2026-10-12T08:00:00Z'), scan('At_PUDO', 'did:shop', '2026-10-13T09:00:00Z')] } as unknown as Parcel;
    const walkUp = { originAgentDid: 'did:shop', scans: [scan('CREATED', 'did:shop', '2026-10-14T10:00:00Z')] } as unknown as Parcel;
    const neverHandedIn = { originAgentDid: 'did:shop', scans: [scan('CREATED', 'did:person', '2026-10-12T08:00:00Z')] } as unknown as Parcel;
    expect([takenInAt(minted), takenInAt(walkUp), takenInAt(neverHandedIn)]).toEqual([Date.parse('2026-10-13T09:00:00Z'), Date.parse('2026-10-14T10:00:00Z'), undefined]);
  });
});
