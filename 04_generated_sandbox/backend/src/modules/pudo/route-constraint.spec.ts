import { RouteConstraintService, ON_ROUTE_KM, distanceToSegmentKm } from './route-constraint.service';
import * as serviceModule from './route-constraint.service';
import { CONSTRAINT_EFFECT, CONSTRAINT_KINDS } from './route-constraint.types';
import { SbgController } from './pudo.controller';
import { ReportConstraintDto } from './pudo.dto';
import { ROLES_KEY } from '../../foundation/auth/scopes.decorator';
import { IS_PUBLIC_KEY } from '../../foundation/auth/public.decorator';

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

/**
 * A hazard photo is LINKED to its constraint so the retention sweep cannot reclaim it as an abandoned
 * upload, and its clock starts only when an operator clears the hazard. The fake records both so the
 * tests can assert them without dragging a BlobStore into every case.
 */
const mediaFake = () => {
  const linked: Array<{ mediaId: string; owner: string; type: string; id: string; kind: string }> = [];
  const anchored: string[] = [];
  return {
    calls: { linked, anchored },
    service: {
      // ADOPT, not link. The service must hand the media store an OWNER to check against, because a
      // posted hazard photo is now readable by every peer — see the adoption test below.
      adopt: (mediaId: string, owner: string, link: { type: string; id: string }, kind: string) =>
        linked.push({ mediaId, owner, type: link.type, id: link.id, kind }),
      anchorConstraintCleared: (constraintId: string) => anchored.push(constraintId),
    },
  };
};

const svc = (media = mediaFake().service) => new RouteConstraintService(media as never);
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

  /**
   * WHAT EACH SIDE SAID, kept apart — the defect that made the operator's queue undecidable.
   *
   * A refutation used to append its words to the reporter's note with a '·' between them, so the one
   * screen whose job is choosing between "it is there" and "it is gone" was handed a single sentence
   * built out of both. Add a photograph to each side and the merge becomes indefensible.
   */
  describe('the accounts: who said what, and what they photographed', () => {
    it('keeps the refuter’s words OFF the reporter’s note', () => {
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, note: 'Just past the river bend', by: 'did:driver:a' });
      const after = s.refute(c.constraintId, 'did:driver:b', 'Bridge is gone, road is wide open');

      // The reporter's note is still the reporter's, word for word.
      expect(after.note).toBe('Just past the river bend');
      expect(after.note).not.toContain('wide open');
      // …and both accounts are on the record, each on its own side of the question.
      expect(after.accounts).toHaveLength(2);
      expect(after.accounts[0]).toMatchObject({ stance: 'there', note: 'Just past the river bend' });
      expect(after.accounts[1]).toMatchObject({ stance: 'gone', note: 'Bridge is gone, road is wide open' });
    });

    it('carries a photograph on either side, and never an identity', () => {
      const s = svc();
      const c = s.report({ kind: 'WASHOUT', at: ON_THE_ROAD, note: 'Whole lane went', photoRef: 'med_washout', by: 'did:driver:a' });
      const after = s.refute(c.constraintId, 'did:driver:b', 'Graded and open', 'med_clear');

      expect(after.accounts.map((a) => a.photoRef)).toEqual(['med_washout', 'med_clear']);
      // A driver identifiable as the one who slowed a corridor down is a driver who stops reporting.
      for (const a of after.accounts) expect(a).not.toHaveProperty('by');
    });

    it('ADOPTS each photo as the account-giver’s own, so the sweep cannot reclaim it and nobody can launder', () => {
      // Two things at once, and the second is why this is adopt() and not link().
      //
      // An unlinked upload is purged as an abandoned capture, which would leave an account citing a
      // photograph that no longer exists — a footnote pointing at nothing. That is what the link was for.
      //
      // But the media store now serves a POSTED hazard photo to every authenticated peer, and `link()` is
      // ownership-blind. Blind-linking a client-supplied ref would let anybody name somebody else's KYC
      // id as their hazard photo and read it straight back. So the OWNER goes with the ref, every time,
      // and it is the DID of whoever gave that account — never the reporter's for a refuter's photo.
      const m = mediaFake();
      const s = svc(m.service);
      const c = s.report({ kind: 'WASHOUT', at: ON_THE_ROAD, photoRef: 'med_washout', by: 'did:driver:a' });
      s.refute(c.constraintId, 'did:driver:b', undefined, 'med_clear');

      expect(m.calls.linked).toEqual([
        { mediaId: 'med_washout', owner: 'did:driver:a', type: 'constraint', id: c.constraintId, kind: 'hazard' },
        { mediaId: 'med_clear', owner: 'did:driver:b', type: 'constraint', id: c.constraintId, kind: 'hazard' },
      ]);
      // No retention clock yet: a bridge does not come down because a window elapsed.
      expect(m.calls.anchored).toEqual([]);
      s.clear(c.constraintId, 'ops', 'Confirmed rebuilt by the county');
      expect(m.calls.anchored).toEqual([c.constraintId]);
    });

    it('does not CITE a photograph the media store refused to adopt', () => {
      // Somebody names a media id that is not theirs — another driver's licence copy, say. The store
      // refuses it, and the account must not go on record citing a photograph no reader can produce:
      // that is "2 photos, none shown" written into the record instead of onto a screen.
      const refusing = { adopt: () => false, anchorConstraintCleared: () => undefined };
      const s = new RouteConstraintService(refusing as never);
      const c = s.report({ kind: 'WASHOUT', at: ON_THE_ROAD, note: 'Whole lane went', photoRef: 'med_not_mine', by: 'did:driver:a' });

      expect(c.accounts[0].note).toBe('Whole lane went'); // what they SAID still stands
      expect(c.accounts[0].photoRef).toBeUndefined(); // the citation does not
      expect(c.status).toBe('active'); // and the road still warns: the photo was never the warning
    });

    it('does not turn one driver saying the same thing twice into two witnesses', () => {
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.refute(c.constraintId, 'did:driver:b', 'gone');
      const after = s.refute(c.constraintId, 'did:driver:b', 'still gone, I looked again');

      expect(after.accounts).toHaveLength(2);
      // Their account is REPLACED, not appended: the record cites each person once.
      expect(after.accounts[1].note).toBe('still gone, I looked again');
    });

    it('stops citing somebody on both sides when they change their mind', () => {
      const s = svc();
      const c = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      s.refute(c.constraintId, 'did:driver:b', 'gone');
      const after = s.confirm(c.constraintId, 'did:driver:b', 'my mistake — it is there, I was a turn early');

      expect(after.accounts).toHaveLength(2);
      expect(after.accounts[1]).toMatchObject({ stance: 'there' });
      expect(after.refutations).toBe(0);
    });

    it('a report with NO photo is exactly as much of a warning as one with', () => {
      // The photo is what an OPERATOR clears on. It is never what makes the road dangerous, and requiring
      // it would silence the driver at a washout at night who cannot safely stop.
      const s = svc();
      const c = s.report({ kind: 'WASHOUT', at: ON_THE_ROAD, by: 'did:driver:a' });
      expect(c.status).toBe('active');
      expect(c.accounts[0].photoRef).toBeUndefined();
      expect(codesOf(s.checkRoute({ from: NAIROBI, to: NAKURU }))).toContain('ROAD_WASHED_OUT');
    });
  });

  describe("the operator's queue: how long a hazard has been waiting on THEM", () => {
    // The queue is the only place a dispute is ever resolved, so its order is the order the network's
    // hazards actually get looked at. Sorting it on the wrong date is a silent failure: the screen looks
    // right, and the disputes raised today sit at the bottom for as long as the map has old hazards on it.
    const at = (iso: string, fn: () => void) => {
      jest.useFakeTimers({ now: new Date(iso) });
      try {
        fn();
      } finally {
        jest.useRealTimers();
      }
    };

    it('starts the clock when somebody says it is gone, not when it was reported', () => {
      const s = svc();
      let id = '';
      at('2026-01-05T08:00:00Z', () => {
        id = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' }).constraintId;
      });
      at('2026-09-09T08:00:00Z', () => s.refute(id, 'did:driver:b'));
      const [row] = s.disputed();
      expect(row.reportedAt).toContain('2026-01-05');
      expect(row.disputedAt).toContain('2026-09-09');
    });

    it('does not restart the clock when a second driver repeats the same claim', () => {
      // Otherwise a hazard nobody has looked at for a fortnight drops back down the queue every time
      // another driver drives past it — the ones being ignored hardest would be the hardest to find.
      const s = svc();
      let id = '';
      at('2026-09-01T08:00:00Z', () => {
        id = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' }).constraintId;
        s.refute(id, 'did:driver:b');
      });
      at('2026-09-09T08:00:00Z', () => s.refute(id, 'did:driver:c'));
      expect(s.disputed()[0].disputedAt).toContain('2026-09-01');
    });

    it('takes the clock away again when the crowd talks it back to active', () => {
      // It is not waiting on anybody any more, and a stale wait would reappear as an ancient one if the
      // same constraint were ever disputed again.
      const s = svc();
      let id = '';
      at('2026-09-01T08:00:00Z', () => {
        id = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' }).constraintId;
        s.refute(id, 'did:driver:b');
      });
      s.confirm(id, 'did:driver:c');
      s.confirm(id, 'did:driver:d');
      expect(s.get(id).status).toBe('active');
      expect(s.get(id).disputedAt).toBeUndefined();
      at('2026-09-09T08:00:00Z', () => s.refute(id, 'did:driver:e'));
      expect(s.disputed()[0].disputedAt).toContain('2026-09-09');
    });

    it('puts the longest-waiting dispute first even when it is the newest hazard on the map', () => {
      // The case that separates the two dates. Sorting by reportedAt passes every other test in this file
      // and puts these two rows in exactly the wrong order.
      const s = svc();
      let oldBridge = '';
      let newBridge = '';
      at('2026-01-05T08:00:00Z', () => {
        oldBridge = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' }).constraintId;
      });
      at('2026-08-01T08:00:00Z', () => {
        newBridge = s.report({ kind: 'HEIGHT_BARRIER', at: ELSEWHERE, value: 3.1, by: 'did:driver:a' }).constraintId;
        s.refute(newBridge, 'did:driver:b');
      });
      at('2026-09-09T08:00:00Z', () => s.refute(oldBridge, 'did:driver:b'));
      expect(s.disputed().map((c) => c.constraintId)).toEqual([newBridge, oldBridge]);
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

    it('hands back a view from EVERY write, not just the reads', () => {
      // The leak that is easy to leave open: the list endpoints strip identities, and then report/refute
      // hand the whole record straight back to the caller — so refuting a bridge would tell you exactly
      // who reported it. Every path out of this service returns the same narrow shape.
      const s = svc();
      const reported = s.report({ kind: 'LOW_BRIDGE', at: ON_THE_ROAD, value: 4.2, by: 'did:driver:a' });
      const confirmed = s.confirm(reported.constraintId, 'did:driver:b');
      const refuted = s.refute(reported.constraintId, 'did:driver:c');
      const cleared = s.clear(reported.constraintId, 'did:operator:1', 'gone');
      for (const out of [reported, confirmed, refuted, cleared]) {
        expect(JSON.stringify(out)).not.toContain('did:');
        expect(out).not.toHaveProperty('reportedBy');
        expect(out).not.toHaveProperty('confirmedBy');
        expect(out).not.toHaveProperty('refutedBy');
      }
    });

    it('does not know a constraint that was never reported', () => {
      expect(() => svc().get('rc_nope')).toThrow(/no such report/i);
    });
  });

  /**
   * WHO may do which half, asserted on the routes themselves.
   *
   * @Roles is metadata that only the real AuthGuard enforces, and no spec here builds one — so a test that
   * called these methods directly would pass with the decorator deleted. This reads the metadata instead:
   * it proves the routes are LABELLED correctly, which is the half that gets lost in an edit. That the
   * guard then honours the label is auth.guard.ts's own business, and is tested there.
   */
  describe('the HTTP surface: reporting is open, clearing is not', () => {
    it('lets any authenticated driver report, confirm and refute', () => {
      // The whole premise. A hazard map that only operators may add to is a hazard map nobody reports to.
      for (const route of ['reportConstraint', 'confirmConstraint', 'refuteConstraint'] as const) {
        expect(Reflect.getMetadata(ROLES_KEY, SbgController.prototype[route])).toBeUndefined();
        // …but never anonymously: an unauthenticated report cannot be held against anybody.
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, SbgController.prototype[route])).toBeUndefined();
      }
    });

    it('reserves CLEARING, and the queue it is done from, to an operator', () => {
      // Clearing is the single action that takes a warning off everybody's map. It is the expensive half
      // of the asymmetry, and the HTTP layer has to hold that line as firmly as the service does.
      expect(Reflect.getMetadata(ROLES_KEY, SbgController.prototype.clearConstraint)).toEqual(['operator']);
      expect(Reflect.getMetadata(ROLES_KEY, SbgController.prototype.disputedConstraints)).toEqual(['operator']);
    });

    it('gives a reporter no way to say they are somebody else', () => {
      // Identity comes from the verified token; there is deliberately no `by` on the report body. A map
      // whose attribution is self-asserted is one anybody can poison anonymously.
      expect(Object.keys(new ReportConstraintDto())).not.toContain('by');
      expect(new ReportConstraintDto()).not.toHaveProperty('reportedBy');
    });
  });
});
