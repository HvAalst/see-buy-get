import { describe, expect, it } from 'vitest';
import { caseLine, casesInOrder, minutesWords, watchLine, type StandstillCase } from './standstill';

const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ` ${JSON.stringify(vars)}` : ''}`;
const when = (iso: string) => `@${iso.slice(11, 16)}`;
const base: StandstillCase = { caseId: 'c1', plate: 'KDA 123T', location: { lat: -0.3, lng: 36.08 }, since: '2026-10-19T08:00:00.000Z', openedAt: '2026-10-19T08:46:00.000Z', minutes: 52, afterMin: 45, state: 'open' };

describe('a vehicle standing still, as the fleet office reads it (round 16)', () => {
  it('says minutes as people say them, and what the watch is set to', () => {
    expect(minutesWords(52)).toBe('52 min');
    expect(minutesWords(70)).toBe('1 h 10 min');
    expect(minutesWords(120)).toBe('2 h');
    expect(watchLine({ on: true, afterMin: 45, asStarted: true }, t as never)).toBe('fleet.still.watchOn {"minutes":"45 min"}');
    expect(watchLine({ on: false, afterMin: 45, asStarted: false }, t as never)).toBe('fleet.still.watchOff');
  });

  it('says how long a vehicle has stood — and how it ended', () => {
    expect(caseLine(base, t as never, when)).toBe('fleet.still.lineStanding {"minutes":"52 min","since":"@08:00"}');
    expect(caseLine({ ...base, state: 'over', minutes: 75, over: { why: 'moved', at: '2026-10-19T09:15:00.000Z' } }, t as never, when)).toBe('fleet.still.lineOver {"minutes":"1 h 15 min","since":"@08:00","how":"fleet.still.over.moved"}');
  });

  it('lists a vehicle still standing first, then one answered, then one over', () => {
    const cases = [
      { ...base, caseId: 'over', state: 'over' as const, openedAt: '2026-10-19T10:00:00.000Z' },
      { ...base, caseId: 'answered', state: 'answered' as const },
      { ...base, caseId: 'old', openedAt: '2026-10-19T07:00:00.000Z' },
      { ...base, caseId: 'new', openedAt: '2026-10-19T09:00:00.000Z' },
    ];
    expect(casesInOrder(cases).map((c) => c.caseId)).toEqual(['new', 'old', 'answered', 'over']);
  });
});
