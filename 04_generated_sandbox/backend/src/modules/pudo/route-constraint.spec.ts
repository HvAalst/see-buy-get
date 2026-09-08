import { RouteConstraintService, ON_ROUTE_KM, distanceToSegmentKm } from './route-constraint.service';
import * as serviceModule from './route-constraint.service';
import { CONSTRAINT_EFFECT, CONSTRAINT_KINDS } from './route-constraint.types';

/**
 * The crowd-sourced road map — and it is a SAFETY surface, so these tests are written against the two
 * rules that make it one rather than against its happy path.
 *
 *   1. THE ASYMMETRY. Adding a constraint is cheap to believe; removing one is expensive. A refutation
 *      must never delete a hazard from everybody's map.
 *   2. ABSENCE IS NOT CLEARANCE. Every question the service cannot answer comes back as an explicit
 *      unknown. An empty answer must never be reachable by a route it did not actually check.
 *
 * Both are the kind of rule a green suite can quietly stop enforcing, because the failure looks like
 * silence rather than like an error.
 */

// A real corridor, so the geometry is exercised at a realistic scale rather than on a toy grid.
const NAIROBI = { lat: -1.2921, lng: 36.8219 };
const NAKURU = { lat: -0.3031, lng: 36.08 };
// Sits essentially on the straight line between them.
const ON_THE_ROAD = { lat: -0.7976, lng: 36.451 };
// Far off it, and well outside any radius these tests ask about.
const ELSEWHERE = { lat: -1.5, lng: 37.9 };

const svc = () => new RouteConstraintService();
const codesOf = (bs: { code: string }[]) => bs.map((b) => b.code);

describe('route constraints — the road as its drivers report it', () => {
  describe('reporting: one driver is enough to start warning everybody', () => {
    it('a single report is ACTIVE immediately — the cheap half of the asymmetry', () => {
      // Being wrong about a bridge that is not there costs a detour. That is a price worth paying at once.
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      expect(c.status).toBe('active');
      expect(s.near(ON_THE_ROAD)).toHaveLength(1);
    });

    it('folds a second sighting of the SAME obstacle into one constraint, as a confirmation', () => {
      // Three drivers reporting one bridge should make the network surer of one bridge, not draw three.
      const s = svc();
      const first = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      // ~220 m away — a different layby, the same bridge.
      const again = s.report({ kind: 'LOW_BRIDGE', at: { lat: ON_THE_ROAD.lat + 0.002, lng: ON_THE_ROAD.lng }, value: 4.2, by: 'did:driver:b' });
      expect(again.constraintId).toBe(first.constraintId);
      expect(s.near(ON_THE_ROAD)).toHaveLength(1);
      expect(s.near(ON_THE_ROAD)[0].confirmations).toBe(1);
    });

    it('does not let one driver confirm their own report, or confirm twice', () => {
      const s = svc();
      s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:b' });
      s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:b' });
      // One other driver has agreed, however many times either of them drove past.
      expect(s.near(ON_THE_ROAD)[0].confirmations).toBe(1);
    });

    it('keeps two different obstacles at one spot apart', () => {
      // A weighbridge beside a low bridge is two facts, and they do not block the same loads.
      const s = svc();
      s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.report({ kind: 'WEIGHBRIDGE', at: ON_THE_ROAD, by: 'did:driver:a' });
      expect(s.near(ON_THE_ROAD)).toHaveLength(2);
    });

    it('a measurable kind is refused without its measurement', () => {
      // "Low bridge, unknown height" cannot be checked against any load, so it would warn everybody
      // equally and mean nothing to anyone.
      const s = svc();
      expect(() => s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, by: 'did:driver:a' })).toThrow(/how high/i);
      expect(() => s.report({ kind: 'WEIGHT_LIMIT', at: ON_THE_ROAD, by: 'did:driver:a' })).toThrow(/limit/i);
      // …while a kind with nothing to measure needs nothing.
      expect(() => s.report({ kind: 'FERRY', at: ON_THE_ROAD, by: 'did:driver:a' })).not.toThrow();
    });

    it('refuses a report with no point on the map', () => {
      const s = svc();
      expect(() => s.report({ kind: 'FERRY', at: { lat: NaN, lng: 36 }, by: 'did:driver:a' })).toThrow(/point on the map/i);
    });
  });

  describe('THE ASYMMETRY: a refutation disputes, and never clears', () => {
    it('a refuted constraint KEEPS WARNING — this is the whole safety argument', () => {
      // Wrongly believing a low bridge is gone kills somebody. So one driver — mistaken, or wanting a
      // shorter route — must not be able to take a hazard off everybody else's map.
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.refute(c.constraintId, 'did:driver:b');

      expect(s.get(c.constraintId).status).toBe('disputed');
      // Still on the map…
      expect(s.near(ON_THE_ROAD)).toHaveLength(1);
      expect(s.alongRoute(NAIROBI, NAKURU)).toHaveLength(1);
      // …and still stopping a load that does not fit under it.
      expect(codesOf(s.checkRoute({ from: NAIROBI, to: NAKURU, totalHeightM: 5.2 }))).toContain('OVER_HEIGHT');
    });

    it('says out loud that it is disputed, so the driver knows what they are looking at', () => {
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.refute(c.constraintId, 'did:driver:b');
      const [b] = s.checkRoute({ from: NAIROBI, to: NAKURU, totalHeightM: 5.2 });
      expect(b.message).toMatch(/still treat it as there/i);
    });

    it('raises it to an operator rather than resolving it itself', () => {
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      expect(s.disputed()).toHaveLength(0);
      s.refute(c.constraintId, 'did:driver:b');
      expect(s.disputed().map((x) => x.constraintId)).toEqual([c.constraintId]);
    });

    it('no number of refutations clears it — the crowd cannot vote a hazard away', () => {
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      for (const d of ['b', 'c', 'd', 'e', 'f']) s.refute(c.constraintId, 'did:driver:' + d);
      expect(s.get(c.constraintId).status).toBe('disputed');
      expect(s.near(ON_THE_ROAD)).toHaveLength(1);
    });

    it('never cites one driver on both sides of the same question', () => {
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.confirm(c.constraintId, 'did:driver:b');
      s.refute(c.constraintId, 'did:driver:b');
      expect(s.get(c.constraintId).confirmedBy).not.toContain('did:driver:b');
      expect(s.get(c.constraintId).refutedBy).toContain('did:driver:b');
      // And changing their mind back moves them back, rather than counting them twice.
      s.confirm(c.constraintId, 'did:driver:b');
      expect(s.get(c.constraintId).refutedBy).not.toContain('did:driver:b');
    });

    it('a later passer-by who sees it there restores it to active', () => {
      // Evidence, not a timer. Somebody actually looked.
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.refute(c.constraintId, 'did:driver:b');
      s.confirm(c.constraintId, 'did:driver:c');
      s.confirm(c.constraintId, 'did:driver:d');
      expect(s.get(c.constraintId).status).toBe('active');
    });
  });

  describe('clearing: the operator, with a reason, and only then', () => {
    it('is the ONLY thing that takes a constraint off the map', () => {
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.clear(c.constraintId, 'did:operator:1', 'Bridge rebuilt; council confirmed 6.0 m');
      expect(s.near(ON_THE_ROAD)).toHaveLength(0);
      expect(s.checkRoute({ from: NAIROBI, to: NAKURU, totalHeightM: 5.2 })).toEqual([]);
    });

    it('refuses to clear without a reason, and keeps the reason it is given', () => {
      // "Either forgive or regret and we don't want both": a hazard removed with no recorded justification
      // is indistinguishable from somebody deleting an inconvenient bridge.
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      expect(() => s.clear(c.constraintId, 'did:operator:1', '   ')).toThrow(/why/i);
      s.clear(c.constraintId, 'did:operator:1', 'Bridge rebuilt');
      const cleared = s.get(c.constraintId);
      expect(cleared).toMatchObject({ status: 'cleared', clearedBy: 'did:operator:1', clearReason: 'Bridge rebuilt' });
      expect(cleared.clearedAt).toBeTruthy();
    });

    it('keeps a cleared constraint on the record, and out of the warnings', () => {
      // Kept for audit — the way back has to be reviewable — but never shown as a hazard again.
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.clear(c.constraintId, 'did:operator:1', 'gone');
      expect(s.get(c.constraintId).status).toBe('cleared');
      expect(s.disputed()).toHaveLength(0);
    });

    it('a driver cannot re-open a cleared one by refuting it', () => {
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.clear(c.constraintId, 'did:operator:1', 'gone');
      s.refute(c.constraintId, 'did:driver:b');
      expect(s.get(c.constraintId).status).toBe('cleared');
    });

    it('a fresh report of a cleared obstacle raises it again as a NEW constraint', () => {
      // Because the bridge can come back, and the cleared record must not swallow the new sighting.
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.clear(c.constraintId, 'did:operator:1', 'gone');
      const again = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:b' });
      expect(again.constraintId).not.toBe(c.constraintId);
      expect(again.status).toBe('active');
      expect(s.near(ON_THE_ROAD)).toHaveLength(1);
    });
  });

  describe('ABSENCE IS NOT CLEARANCE: every unanswerable question comes back as an unknown', () => {
    it('says NOT CHECKED when it does not know which road the load runs on', () => {
      // Rather than an empty list, which every caller would read as "nothing in the way".
      const s = svc();
      const [b] = s.checkRoute({ from: NAIROBI, totalHeightM: 5.2 });
      expect(b.kind).toBe('unknown');
      expect(b.code).toBe('ROUTE_NOT_CHECKED');
    });

    it('will not clear a height it was never told — an unmeasured load is an UNKNOWN, not a pass', () => {
      // The precise silent pass this feature exists to refuse.
      const s = svc();
      s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      expect(codesOf(s.checkRoute({ from: NAIROBI, to: NAKURU }))).toContain('HEIGHT_UNKNOWN');
    });

    it('will not clear a weight it was never told either', () => {
      const s = svc();
      s.report({ kind: 'WEIGHT_LIMIT', at: ON_THE_ROAD, value: 18_000, by: 'did:driver:a' });
      expect(codesOf(s.checkRoute({ from: NAIROBI, to: NAKURU }))).toContain('WEIGHT_UNKNOWN');
    });

    it('holds NO threshold that would promote a reported road to a surveyed one', () => {
      // The defect this replaced: below N reports the corridor answered NOT CHECKED, at or above it the
      // map answered for itself — so one reported ferry silenced the caveat for every bridge on the road.
      // Reports are evidence of the obstacles somebody MET, never evidence about the ones nobody met.
      expect(Object.keys(serviceModule)).not.toContain('SURVEYED_MIN_REPORTS');
      const s = svc();
      s.report({ kind: 'FERRY', at: ON_THE_ROAD, by: 'did:driver:a' });
      // The service reports what it knows and nothing more; the permanent caveat belongs to the board and
      // is tested there (freight-board.spec.ts). What matters here is that this claims nothing.
      expect(s.checkRoute({ from: NAIROBI, to: NAKURU, totalHeightM: 5.2, grossWeightKg: 40_000 })).toEqual([]);
    });
  });

  describe('what each kind DOES to a load', () => {
    it('stops a load that does not fit, and types it as PHYSICAL', () => {
      const s = svc();
      s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      const [b] = s.checkRoute({ from: NAIROBI, to: NAKURU, totalHeightM: 5.2 });
      expect(b.kind).toBe('physical');
      expect(b.code).toBe('OVER_HEIGHT');
      expect(b.message).toContain('4.2');
      // …and says nothing at all to a load that fits.
      expect(s.checkRoute({ from: NAIROBI, to: NAKURU, totalHeightM: 3.9 })).toEqual([]);
    });

    it('types a posted weight limit as LEGAL — not a thing a driver may decide to exceed', () => {
      const s = svc();
      s.report({ kind: 'WEIGHT_LIMIT', at: ON_THE_ROAD, value: 18_000, by: 'did:driver:a' });
      const [b] = s.checkRoute({ from: NAIROBI, to: NAKURU, grossWeightKg: 26_000 });
      expect(b.kind).toBe('legal');
      expect(b.code).toBe('OVER_WEIGHT');
      expect(s.checkRoute({ from: NAIROBI, to: NAKURU, grossWeightKg: 12_000 })).toEqual([]);
    });

    it('stops hazardous cargo on a prohibited road, and only hazardous cargo', () => {
      const s = svc();
      s.report({ kind: 'NO_HAZMAT', at: ON_THE_ROAD, by: 'did:driver:a' });
      expect(codesOf(s.checkRoute({ from: NAIROBI, to: NAKURU, hazmat: true }))).toEqual(['HAZMAT_PROHIBITED']);
      expect(s.checkRoute({ from: NAIROBI, to: NAKURU, hazmat: false })).toEqual([]);
    });

    it('stops everything on a washed-out road, whatever it is carrying', () => {
      const s = svc();
      s.report({ kind: 'WASHOUT', at: ON_THE_ROAD, by: 'did:driver:a' });
      expect(codesOf(s.checkRoute({ from: NAIROBI, to: NAKURU }))).toEqual(['ROAD_WASHED_OUT']);
    });

    it('never turns an ADVISORY into a reason to refuse a load', () => {
      // A ferry, a weighbridge and a checkpoint cost a haulier time and nothing else. A board that weights
      // "there is a weighbridge" the same as "this bridge will not take you" teaches them to skim past both.
      const s = svc();
      s.report({ kind: 'FERRY', at: ON_THE_ROAD, by: 'did:driver:a' });
      s.report({ kind: 'WEIGHBRIDGE', at: { lat: ON_THE_ROAD.lat + 0.02, lng: ON_THE_ROAD.lng }, by: 'did:driver:a' });
      s.report({ kind: 'CHECKPOINT', at: { lat: ON_THE_ROAD.lat + 0.04, lng: ON_THE_ROAD.lng }, by: 'did:driver:a' });
      expect(s.alongRoute(NAIROBI, NAKURU)).toHaveLength(3);
      expect(s.checkRoute({ from: NAIROBI, to: NAKURU, totalHeightM: 5.2, grossWeightKg: 40_000, hazmat: true })).toEqual([]);
    });

    it('every kind declares an effect, and only blockers carry a measure', () => {
      // The discriminated union is what keeps a ferry from ever becoming a board blocker; this is the
      // table behind it staying honest as kinds are added.
      for (const kind of CONSTRAINT_KINDS) {
        const e = CONSTRAINT_EFFECT[kind];
        expect(e).toBeDefined();
        if (!e.blocks) expect(e.measure).toBe('none');
      }
    });
  });

  describe('the geometry: generous on purpose', () => {
    it('warns about what sits on the corridor and stays quiet about what does not', () => {
      const s = svc();
      s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.report({ kind: 'LOW_BRIDGE', at: ELSEWHERE, value: 3.5, by: 'did:driver:a' });
      expect(s.alongRoute(NAIROBI, NAKURU)).toHaveLength(1);
      // A load that would fit under neither is stopped only by the one on its road.
      expect(s.checkRoute({ from: NAIROBI, to: NAKURU, totalHeightM: 5.2 })).toHaveLength(1);
    });

    it('measures off-line distance, not distance to the endpoints', () => {
      // The failure that matters is missing a bridge, not mentioning one a few km away — hence ON_ROUTE_KM.
      expect(distanceToSegmentKm(ON_THE_ROAD, NAIROBI, NAKURU)).toBeLessThan(ON_ROUTE_KM);
      expect(distanceToSegmentKm(ELSEWHERE, NAIROBI, NAKURU)).toBeGreaterThan(ON_ROUTE_KM);
      // A leg with both ends in one place is the distance to that place, not a divide-by-zero.
      expect(Number.isFinite(distanceToSegmentKm(NAKURU, NAIROBI, NAIROBI))).toBe(true);
    });

    it('gives the driver the nearest thing first', () => {
      const s = svc();
      s.report({ kind: 'WEIGHBRIDGE', at: { lat: NAIROBI.lat + 0.15, lng: NAIROBI.lng }, by: 'did:driver:a' });
      s.report({ kind: 'FERRY', at: { lat: NAIROBI.lat + 0.03, lng: NAIROBI.lng }, by: 'did:driver:a' });
      expect(s.near(NAIROBI).map((c) => c.kind)).toEqual(['FERRY', 'WEIGHBRIDGE']);
      // And nothing from the far side of the country.
      s.report({ kind: 'FERRY', at: ELSEWHERE, by: 'did:driver:a' });
      expect(s.near(NAIROBI)).toHaveLength(2);
    });
  });

  describe('what the map hands back', () => {
    it('never names who reported or refuted anything', () => {
      // Who reported a bridge is nobody else's business — and a driver identifiable as the one who slowed
      // a corridor down is a driver who stops reporting.
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.refute(c.constraintId, 'did:driver:b');
      const [seen] = s.near(ON_THE_ROAD);
      expect(Object.keys(seen)).not.toContain('reportedBy');
      expect(Object.keys(seen)).not.toContain('confirmedBy');
      expect(Object.keys(seen)).not.toContain('refutedBy');
      expect(JSON.stringify(seen)).not.toContain('did:driver:');
      // The counts survive, because they are what a reader needs.
      expect(seen).toMatchObject({ confirmations: 0, refutations: 1, status: 'disputed' });
    });

    it('does not know a constraint that was never reported', () => {
      expect(() => svc().get('rc_nope')).toThrow(/no such report/i);
    });
  });
});
