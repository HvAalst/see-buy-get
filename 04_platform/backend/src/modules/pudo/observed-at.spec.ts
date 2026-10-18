import { whenSeen } from './observed-at';

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
