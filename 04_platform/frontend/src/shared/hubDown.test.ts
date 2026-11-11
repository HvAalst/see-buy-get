import { describe, expect, it } from 'vitest';
import { en } from './i18n/catalogs/en';
import { confirmedInTime, confirmOpen, HUB_DOWN_REASONS, HUB_DOWN_WORDS, isDownNow, unconfirmedPast } from './hubDown';

describe('a hub down (ISO 28000 gap 12)', () => {
  const until = '2026-11-12T12:00:00Z';
  const at = (iso: string) => Date.parse(iso);
  it('opens at the time it gave only if it confirmed in the day before; not confirmed, it stays down', () => {
    expect(isDownNow(undefined, at(until))).toBe(false);
    expect(isDownNow({ until }, at('2026-11-12T11:00:00Z'))).toBe(true);
    expect(isDownNow({ until }, at('2026-11-12T13:00:00Z'))).toBe(true);
    expect(unconfirmedPast({ until }, at('2026-11-12T13:00:00Z'))).toBe(true);
    // Confirmed three days early: not counted. In the last day: counted.
    expect(confirmedInTime({ until, confirmedAt: '2026-11-09T12:00:00Z' })).toBe(false);
    expect(isDownNow({ until, confirmedAt: '2026-11-09T12:00:00Z' }, at('2026-11-12T13:00:00Z'))).toBe(true);
    expect(isDownNow({ until, confirmedAt: '2026-11-12T08:00:00Z' }, at('2026-11-12T13:00:00Z'))).toBe(false);
    expect(unconfirmedPast({ until, confirmedAt: '2026-11-12T08:00:00Z' }, at('2026-11-12T13:00:00Z'))).toBe(false);
  });
  it('may confirm from a day before the time it gave', () => {
    expect(confirmOpen({ until }, at('2026-11-11T11:00:00Z'))).toBe(false);
    expect(confirmOpen({ until }, at('2026-11-11T12:00:00Z'))).toBe(true);
  });
  it('says every reason the server knows', () => {
    expect([...HUB_DOWN_REASONS]).toEqual(['power', 'flood', 'security', 'no_staff', 'authority', 'other']);
    for (const r of HUB_DOWN_REASONS) expect((en as Record<string, string>)[HUB_DOWN_WORDS[r]]).toBeTruthy();
  });
});
