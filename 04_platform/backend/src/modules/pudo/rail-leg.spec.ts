import { railRefusal, railTerminalClock } from './rail-leg.types';

/*
 * THE RAIL TERMINAL'S CLOCK AND THE GATE ON THE ROAD LEG (2026-10-29, "build the clock with the blocker as you said"). Pure:
 * the same facts and the same moment give the same answer.
 */
const DAY = 86_400_000;
const at = Date.parse('2026-10-29T06:00:00Z');

describe('the rail terminal’s free days', () => {
  it('does not start before the railway said the box is there; without free days it only says when it arrived', () => {
    expect(railTerminalClock({ freeDays: 4 }, at)).toEqual({ state: 'not_started', freeDays: 4 });
    expect(railTerminalClock({ arrivedAt: new Date(at).toISOString() }, at)).toEqual({ state: 'no_free_days', startedAt: new Date(at).toISOString() });
  });

  it('runs, is due on the last free day, is over after it — and stops when our truck takes the box out', () => {
    const arrivedAt = new Date(at).toISOString();
    expect(railTerminalClock({ arrivedAt, freeDays: 4 }, at + DAY).state).toBe('running');
    expect(railTerminalClock({ arrivedAt, freeDays: 4 }, at + 3.5 * DAY).state).toBe('due_soon');
    expect(railTerminalClock({ arrivedAt, freeDays: 4 }, at + 5.2 * DAY)).toMatchObject({ state: 'over', daysOver: 2, freeUntil: new Date(at + 4 * DAY).toISOString() });
    expect(railTerminalClock({ arrivedAt, freeDays: 4, leftAt: new Date(at + 2 * DAY).toISOString() }, at + 9 * DAY)).toMatchObject({ state: 'stopped' });
    expect(railTerminalClock({ arrivedAt, freeDays: 4, leftAt: new Date(at + 4.5 * DAY).toISOString() }, at + 9 * DAY)).toMatchObject({ state: 'stopped', daysOver: 1 });
  });
});

describe('the gate on a road leg from a rail terminal', () => {
  const gate = { importId: 'imp_1', importCode: 'IMP-001', terminal: 'Nairobi Inland Container Depot' };
  it('holds until the arrival, or the importer’s word — and says why in the board’s words', () => {
    expect(railRefusal({ waitsForRail: gate })).toMatch(/^The box is still on its way by rail to Nairobi Inland Container Depot/);
    expect(railRefusal({ waitsForRail: { ...gate, arrivedAt: '2026-10-29T06:00:00Z' } })).toBeUndefined();
    expect(railRefusal({ waitsForRail: { ...gate, collectAnyway: { by: 'Wanjiku', at: '2026-10-29T06:00:00Z', reason: 'Confirmed by phone' } } })).toBeUndefined();
    expect(railRefusal({})).toBeUndefined();
    expect(railRefusal(undefined)).toBeUndefined();
  });
});
