import { describe, expect, it } from 'vitest';
import { crossingWords, durationWords, hoursWords, passageWords, waitWords, type CrossingView } from './passages';

const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ` ${JSON.stringify(vars)}` : ''}`;
const when = (iso: string) => `@${iso.slice(11, 16)}`;

describe('a load at a border or a hub, as everybody reads it (round 14)', () => {
  it('says a duration and an allowance the way people say them', () => {
    expect(durationWords(45)).toBe('45 min');
    expect(durationWords(180)).toBe('3 h');
    expect(durationWords(200)).toBe('3 h 20 min');
    expect(hoursWords(4)).toBe('4 h');
    expect(hoursWords(9.4)).toBe('9.5 h');
    expect(hoursWords(9.2)).toBe('9 h');
    expect(hoursWords(0.4)).toBe('24 min');
  });

  it('says what the wait rests on: measured at the post, measured at the border, or our standard', () => {
    expect(waitWords({ from: 'KE', to: 'UG', post: 'Malaba', hours: 9, basis: 'measured', crossings: 23 }, t as never)).toBe('common.passage.waitMeasured {"hours":"9 h","n":23}');
    expect(waitWords({ from: 'KE', to: 'UG', hours: 7, basis: 'measured', crossings: 12, posts: ['Busia', 'Malaba'] }, t as never)).toBe('common.passage.waitMeasuredCrossing {"hours":"7 h","n":12,"posts":"Busia, Malaba"}');
    expect(waitWords({ from: 'KE', to: 'UG', post: 'Busia', hours: 4, basis: 'standard' }, t as never)).toBe('common.passage.waitStandard {"hours":"4 h"}');
  });

  it('says each step the driver said, with its time — and how long it was at the post once cleared', () => {
    expect(passageWords({ kind: 'at_border', post: 'Malaba', at: '2026-10-19T13:40:00.000Z' }, t as never, when)).toBe('common.passage.atBorder {"post":"Malaba","when":"@13:40"}');
    expect(passageWords({ kind: 'cleared_border', post: 'Malaba', at: '2026-10-19T22:10:00.000Z', waitedMin: 510 }, t as never, when)).toBe('common.passage.clearedAfter {"post":"Malaba","when":"@22:10","waited":"8 h 30 min"}');
    expect(passageWords({ kind: 'at_hub', hub: 'Kampala ICD', at: '2026-10-20T06:00:00.000Z' }, t as never, when)).toBe('common.passage.atHub {"hub":"Kampala ICD","when":"@06:00"}');
  });

  it('says where a crossing load has got to; the wait while it is still ahead or being waited; when it is expected', () => {
    const wait = { from: 'KE', to: 'UG', post: 'Malaba', hours: 4, basis: 'standard' as const };
    const ahead: CrossingView = { state: 'ahead', from: 'KE', to: 'UG', post: 'Malaba', wait, expectedAt: '2026-10-20T04:00:00.000Z' };
    expect(crossingWords(ahead, t as never, when)).toEqual({ where: 'common.passage.aheadAt {"post":"Malaba"}', wait: 'common.passage.waitStandard {"hours":"4 h"}', expected: 'common.passage.expected {"when":"@04:00"}' });
    expect(crossingWords({ ...ahead, post: undefined }, t as never, when).where).toBe('common.passage.ahead');
    expect(crossingWords({ ...ahead, state: 'at_post', since: '2026-10-19T13:40:00.000Z' }, t as never, when).where).toBe('common.passage.nowAt {"post":"Malaba","when":"@13:40"}');
    // Across: the wait is history, not an allowance.
    const across = crossingWords({ ...ahead, state: 'cleared', clearedAt: '2026-10-19T16:40:00.000Z', waitedMin: 180 }, t as never, when);
    expect(across.where).toBe('common.passage.clearedAfter {"post":"Malaba","when":"@16:40","waited":"3 h"}');
    expect(across.wait).toBeUndefined();
    // No expectation said where the server gave none.
    expect(crossingWords({ ...ahead, expectedAt: undefined }, t as never, when).expected).toBeUndefined();
  });

  it('says the pace the expectation rests on: its own lane’s trips, or the standard while too few are measured (round 21)', () => {
    const wait = { from: 'KE', to: 'UG', hours: 4, basis: 'standard' as const };
    const c: CrossingView = { state: 'ahead', from: 'KE', to: 'UG', wait, expectedAt: '2026-10-20T04:00:00.000Z', drive: { kmh: 32, basis: 'measured', trips: 5, lane: 'KE → UG', level: 'countries' } };
    expect(crossingWords(c, t as never, when).drive).toBe('common.passage.driveMeasured {"n":5,"lane":"KE → UG","kmh":32}');
    expect(crossingWords({ ...c, drive: { kmh: 55, basis: 'standard' } }, t as never, when).drive).toBe('common.passage.driveStandard {"kmh":55}');
    // No promise, no pace.
    expect(crossingWords({ ...c, expectedAt: undefined }, t as never, when).drive).toBeUndefined();
  });
});
