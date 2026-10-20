import { describe, expect, it } from 'vitest';
import { findingWords, heldLine, MIN_RELEASE_REASON, releaseBlocker } from './tamper';

const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ` ${JSON.stringify(vars)}` : ''}`;

describe('the tamper protocol, as every app says it (round 35)', () => {
  it('says what was found, and a finding it has never heard of as it came', () => {
    expect(findingWords('wrap_cut', t)).toBe('common.tamper.finding.wrap_cut');
    expect(findingWords('seal_not_as_written', t)).toBe('common.tamper.finding.seal_not_as_written');
    expect(findingWords('door_left_open', t)).toBe('door left open');
  });

  it('says a hold with where, when and what — where in the server’s own words', () => {
    const line = heldLine({ finding: 'seal_not_as_on_the_note', where: 'at delivery', since: '2026-10-20T14:03:00.000Z' }, t);
    expect(line).toMatch(/^common\.tamper\.heldLine /);
    expect(line).toContain('"where":"at delivery"');
    expect(line).toContain('"what":"common.tamper.finding.seal_not_as_on_the_note"');
    expect(line).not.toContain('2026-10-20T14:03');
  });

  it('asks a release for what was found and done, as the server does', () => {
    expect(releaseBlocker('ok', t)).toMatch(/releaseTooShort/);
    expect(releaseBlocker(' '.repeat(20), t)).toMatch(/releaseTooShort/);
    expect(releaseBlocker('x'.repeat(MIN_RELEASE_REASON), t)).toBeNull();
  });
});
