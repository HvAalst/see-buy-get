import { handedAt, whenSeen } from './observed-at';

/** A report dated by when it was seen — within reason — and the arrival kept beside it when the two differ. */
describe('when it was seen', () => {
  const NOW = Date.parse('2026-10-18T12:00:00Z');
  const H = 3_600_000;

  it('takes the phone’s time, and says when it arrived, for a report kept with no signal', () => {
    expect(whenSeen('2026-10-18T09:00:00Z', NOW)).toEqual({ at: NOW - 3 * H, receivedAt: '2026-10-18T12:00:00.000Z' });
  });

  it('reads a fresh word as fresh, a clock running ahead as now, and nothing at all as now', () => {
    expect(whenSeen('2026-10-18T11:59:00Z', NOW)).toEqual({ at: NOW - 60_000 });
    expect(whenSeen('2026-10-18T15:00:00Z', NOW)).toEqual({ at: NOW });
    expect(whenSeen(undefined, NOW)).toEqual({ at: NOW });
    expect(whenSeen('not a date', NOW)).toEqual({ at: NOW });
  });

  it('dates nothing more than a week back', () => {
    expect(whenSeen('2026-09-01T00:00:00Z', NOW)).toEqual({ at: NOW - 7 * 24 * H, receivedAt: '2026-10-18T12:00:00.000Z' });
  });
});

/** A hand-over dated by the phone, never before the step before it — and late only where it is still late after that. */
describe('when it changed hands', () => {
  const NOW = Date.parse('2026-10-20T12:00:00Z');
  const H = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();

  it('takes the phone’s time where nothing before it is later, and keeps when it arrived', () => {
    expect(handedAt(iso(NOW - 2 * H), NOW, [iso(NOW - 3 * H), undefined])).toEqual({ at: iso(NOW - 2 * H), receivedAt: iso(NOW) });
  });

  it('is never before the step before it — and still says it came late where that step is long past', () => {
    expect(handedAt(iso(NOW - 3 * H), NOW, [iso(NOW - 2 * H)])).toEqual({ at: iso(NOW - 2 * H), receivedAt: iso(NOW) });
  });

  /** Found walking round 25: a reading lifted to a moment after a live one said "read with no signal; reached us" in the same minute. */
  it('is not late where the step before it lifts it to within the clocks’ allowance of now', () => {
    expect(handedAt(iso(NOW - 2 * H), NOW, [iso(NOW - 30_000)])).toEqual({ at: iso(NOW - 30_000) });
    expect(handedAt(iso(NOW - 2 * H), NOW, [iso(NOW - 3 * 60_000)])).toEqual({ at: iso(NOW - 3 * 60_000), receivedAt: iso(NOW) });
  });

  it('dates a step sent with no time of its own now, and keeps nothing beside it', () => {
    expect(handedAt(undefined, NOW, [iso(NOW - H)])).toEqual({ at: iso(NOW) });
  });
});
