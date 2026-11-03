import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { apiChangeLines, type ApiChanges } from './apiChanges';
import { en } from './i18n/catalogs/en';
import { interpolate, type MessageKey } from './i18n';

/*
 * 2026-11-03 — THE API'S OWN LIST OF CHANGES, beside a company's keys (the owner: "Notice first, build now"): a rule still to
 * come first, with when it starts refusing; then the versions; then the rules in force — said the same in Business and Fleet.
 */
const words = en as Record<string, string>;
const t = (key: MessageKey, params?: Record<string, string | number>) => (params ? interpolate(words[key], params) : words[key]);

describe('the list of changes to the API', () => {
  const changes: ApiChanges = {
    versions: [{ version: '1', releasedAt: '2026-10-19' }],
    rules: [
      { id: 'packages-required', version: '1', summary: 'A load is refused without the number of its packages.', announcedAt: '2027-01-01T00:00:00Z', enforcedFrom: '2027-04-01T00:00:00Z', safety: false, noticeDays: 90, fromRelease: false },
      { id: 'dangerous-goods-un-number', version: '1', summary: 'A load of dangerous goods is refused without its UN number.', announcedAt: '2026-10-29', enforcedFrom: '2026-10-29', safety: true, noticeDays: 0, fromRelease: true },
    ],
  };

  it('puts a rule still to come first, marked, then the version, then the rules in force', () => {
    const lines = apiChangeLines(changes, Date.parse('2027-02-01T00:00:00Z'), t);
    expect(lines.map((l) => [l.key, l.coming])).toEqual([
      ['rule:packages-required', true],
      ['version:1', false],
      ['rule:dangerous-goods-un-number', false],
    ]);
    expect(lines[0].detail).toMatch(/^Version 1\. Announced .+\. From .+ a call that breaks it is refused; until then it is answered as before\.$/);
    expect(lines[2].detail).toMatch(/before any company’s system was connected\.$/);
  });

  it('once a rule refuses, it is said as in force, with the notice it was given', () => {
    const lines = apiChangeLines(changes, Date.parse('2027-05-01T00:00:00Z'), t);
    expect(lines.find((l) => l.key === 'rule:packages-required')).toMatchObject({ coming: false, detail: expect.stringMatching(/Refused since .+; announced .+, 90 days ahead\.$/) });
  });

  it('is shown beside the keys in both apps, and a rule’s notice has its icon in the bell', () => {
    expect(readFileSync('src/apps/business/screens/KeysPanel.tsx', 'utf8')).toMatch(/<ApiChangesList \/>/);
    expect(readFileSync('src/apps/fleet/screens/SystemScreen.tsx', 'utf8')).toMatch(/<ApiChangesList \/>/);
    expect(readFileSync('src/shared/ui/NotificationBell.tsx', 'utf8')).toMatch(/api_rule: 'clock'/);
    expect(readFileSync('src/shared/apiChanges.ts', 'utf8')).toMatch(/'\/v1\/sbg\/api-changes'/);
  });
});
