import { describe, expect, it } from 'vitest';
import {
  CLEAR_REASON_MAX,
  KIND_EFFECT,
  canClear,
  isLongWait,
  measureLabel,
  pointLabel,
  waitLabel,
  waitingHours,
  type ConstraintKind,
} from './logic';

/**
 * The operator console's pure logic.
 *
 * Written against the things this screen can get wrong SILENTLY: a wait measured from the wrong date, a
 * road sign restated in the wrong unit, an empty count that reads as zero, and a submit button that is
 * stricter than the server it submits to. None of those would throw, and all of them would put a number
 * in front of somebody deciding whether to take a warning off every driver's map.
 */

// A translate stub that returns the key plus its params, so a test asserts WHICH string was chosen
// rather than what English happens to say today.
const t = ((key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : key) as never;

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-09T12:00:00Z');

describe('the disputed-hazard queue', () => {
  describe('how long it has been waiting', () => {
    it('measures the wait from the DISPUTE, not from the report', () => {
      // The whole reason the field exists. A bridge reported in January and disputed this morning has
      // been in front of an operator since this morning.
      const row = { reportedAt: '2026-01-05T12:00:00Z', disputedAt: '2026-09-09T08:00:00Z' };
      expect(waitingHours(row, NOW)).toBe(4);
      expect(waitLabel(row, NOW, t)).toBe('tower.wait.hours(n=4)');
    });

    it('falls back to the report date for a record written before disputes were timed', () => {
      expect(waitingHours({ reportedAt: '2026-09-08T12:00:00Z' }, NOW)).toBe(24);
    });

    it('says "just now" under the hour, hours up to two days, then days', () => {
      const at = (ms: number) => ({ reportedAt: new Date(NOW - ms).toISOString() });
      expect(waitLabel(at(30 * 60_000), NOW, t)).toBe('tower.wait.now');
      expect(waitLabel(at(5 * HOUR), NOW, t)).toBe('tower.wait.hours(n=5)');
      expect(waitLabel(at(47 * HOUR), NOW, t)).toBe('tower.wait.hours(n=47)');
      expect(waitLabel(at(72 * HOUR), NOW, t)).toBe('tower.wait.days(n=3)');
    });

    it('never reports a negative wait from a clock that disagrees with the server', () => {
      // Two machines, two clocks. "Waiting -3 h" is the kind of thing that makes somebody distrust the
      // whole screen, and it says nothing useful even when it is true.
      expect(waitingHours({ reportedAt: new Date(NOW + 3 * HOUR).toISOString() }, NOW)).toBe(0);
    });

    it('marks a long wait only after a week, and nothing about it expires', () => {
      expect(isLongWait({ reportedAt: new Date(NOW - 6 * 24 * HOUR).toISOString() }, NOW)).toBe(false);
      expect(isLongWait({ reportedAt: new Date(NOW - 8 * 24 * HOUR).toISOString() }, NOW)).toBe(true);
    });
  });

  describe('the posted number, in the unit it was posted in', () => {
    it('reads a weight limit back in TONNES, the way the sign is written', () => {
      // The wire carries kilograms. A screen showing "12000" against a sign that says 12 is how somebody
      // ends up checking the wrong number.
      expect(measureLabel({ kind: 'WEIGHT_LIMIT', value: 12000 }, t)).toBe('tower.unit.tonnes(n=12)');
      expect(measureLabel({ kind: 'WEIGHT_LIMIT', value: 7500 }, t)).toBe('tower.unit.tonnes(n=7.5)');
    });

    it('reads a clearance back in metres', () => {
      expect(measureLabel({ kind: 'LOW_BRIDGE', value: 4.25 }, t)).toBe('tower.unit.metres(n=4.3)');
    });

    it('shows a dash where the kind has nothing to measure', () => {
      // A ferry has no number, and an empty cell in a numeric column reads as a missing value.
      expect(measureLabel({ kind: 'FERRY' }, t)).toBe('—');
      expect(measureLabel({ kind: 'NO_HAZMAT' }, t)).toBe('—');
    });
  });

  describe('what each kind does to a load', () => {
    it('separates the five that stop a vehicle from the three that only cost it time', () => {
      const blocking = (Object.keys(KIND_EFFECT) as ConstraintKind[]).filter((k) => KIND_EFFECT[k] === 'blocks');
      expect(blocking.sort()).toEqual(['HEIGHT_BARRIER', 'LOW_BRIDGE', 'NO_HAZMAT', 'WASHOUT', 'WEIGHT_LIMIT']);
      expect(KIND_EFFECT.WEIGHBRIDGE).toBe('advisory');
      expect(KIND_EFFECT.FERRY).toBe('advisory');
      expect(KIND_EFFECT.CHECKPOINT).toBe('advisory');
    });
  });

  describe('the clearance itself', () => {
    it('needs a reason, and treats whitespace as none', () => {
      expect(canClear('')).toBe(false);
      expect(canClear('   \n ')).toBe(false);
      expect(canClear('Council rebuilt it to 6.0 m')).toBe(true);
    });

    it('is no stricter than the server it submits to', () => {
      // A client that demands more than the contract does blocks work the network would have accepted.
      expect(canClear('x')).toBe(true);
      expect(canClear('x'.repeat(CLEAR_REASON_MAX))).toBe(true);
      expect(canClear('x'.repeat(CLEAR_REASON_MAX + 1))).toBe(false);
    });
  });

  describe('where it is', () => {
    it('writes a point at about metre precision, in the order a map expects', () => {
      expect(pointLabel({ lat: -0.79761234, lng: 36.4512999 })).toBe('-0.79761, 36.45130');
    });
  });
});
