import { describe, expect, it } from 'vitest';
import { en } from './i18n/catalogs/en';
import { HUB_DOWN_REASONS, HUB_DOWN_WORDS, isDownNow } from './hubDown';

describe('a hub down (ISO 28000 gap 12)', () => {
  it('is down until the time it was said to open again, and open without being said down', () => {
    const now = Date.parse('2026-11-11T12:00:00Z');
    expect(isDownNow(undefined, now)).toBe(false);
    expect(isDownNow({}, now)).toBe(true);
    expect(isDownNow({ until: '2026-11-11T13:00:00Z' }, now)).toBe(true);
    expect(isDownNow({ until: '2026-11-11T12:00:00Z' }, now)).toBe(false);
  });
  it('says every reason the server knows', () => {
    expect([...HUB_DOWN_REASONS]).toEqual(['power', 'flood', 'security', 'no_staff', 'authority', 'other']);
    for (const r of HUB_DOWN_REASONS) expect((en as Record<string, string>)[HUB_DOWN_WORDS[r]]).toBeTruthy();
  });
});
