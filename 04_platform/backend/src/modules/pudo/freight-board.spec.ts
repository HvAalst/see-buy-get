import { BLOCKER_KIND_MEANING, blockersFor, takeable, type BoardLoad, type BoardVehicle } from './freight-board';
import { BLOCKER_KINDS } from './dispatch.types';

// An ordinary palletised load and a truck that can take it — every case varies one thing away from this.
const load = (over: Partial<BoardLoad> = {}): BoardLoad => ({ weightKg: 400, fragile: false, bulk: false, requiredCapabilities: [], requiredEquipment: [], ...over });
const truck = (over: Partial<BoardVehicle> = {}): BoardVehicle => ({ truckSubtype: 'flatbed', capacityKg: 10_000, equipment: ['TLT'], hazmat: false, coldChain: false, carriesBulk: false, allowsFragile: true, ...over });
const ok = { remainingKg: 10_000, ratingBelowFloor: false };
const codes = (bs: { code: string }[]) => bs.map((b) => b.code);

describe('blockersFor (FB1)', () => {
  it('with no vehicle says so — and still says what a lorry would not have fixed', () => {
    // A carrier's transit authority is not a property of a vehicle. Sending somebody to couple a truck
    // so they can then discover they needed a licence is a wasted trip.
    const licence = { kind: 'legal' as const, code: 'NO_TRANSIT_AUTHORITY', message: 'needs a transit authority for ET' };
    const bs = blockersFor(load(), null, { ...ok, routeBlockers: [licence] });
    expect(codes(bs)).toEqual(['NO_TRANSIT_AUTHORITY', 'NO_VEHICLE']);
    // Everything else still waits for something to judge it against.
    expect(codes(blockersFor(load({ weightKg: 99999 }), null, ok))).toEqual(['NO_VEHICLE']);
  });

  it('says nothing when the driver can simply take it', () => {
    expect(blockersFor(load(), truck(), ok)).toEqual([]);
    expect(takeable([])).toBe(true);
  });

  it('reports EVERY reason at once, not the first one it finds', () => {
    // "You need a tail-lift" is a different investment decision from "you need a tail-lift AND 12 more tonnes
    // of payload". An operator shown one reason at a time fixes the wrong thing.
    const bs = blockersFor(load({ weightKg: 20_000, requiredEquipment: ['FLT'] }), truck({ equipment: [] }), ok);
    expect(codes(bs)).toEqual(expect.arrayContaining(['OVER_VEHICLE_CAPACITY', 'MISSING_EQUIPMENT']));
  });

  describe('the kinds are what make a marked load useful', () => {
    it('missing equipment is RESOLVABLE — it is the investment signal the board exists for', () => {
      const [b] = blockersFor(load({ requiredEquipment: ['TLT', 'RMP'] }), truck({ equipment: [] }), ok);
      expect(b.kind).toBe('resolvable');
      expect(b.code).toBe('MISSING_EQUIPMENT');
      // ANY-OF: name every piece that would unlock the load, so the operator can buy the cheapest of them.
      expect(b.message).toContain('tail-lift');
      expect(b.message).toContain('ramp');
    });

    it('hazmat is LEGAL and cold chain is PHYSICAL — not the same kind of no', () => {
      // Carrying hazardous goods uncertified is illegal; carrying a perishable warm is merely ruinous. An
      // operator deciding what to buy needs to know which one they are looking at.
      const haz = blockersFor(load({ requiredCapabilities: ['hazmat'] }), truck(), ok);
      const cold = blockersFor(load({ requiredCapabilities: ['coldChain'] }), truck(), ok);
      expect(haz[0].kind).toBe('legal');
      expect(cold[0].kind).toBe('physical');
    });

    it('a shipper exclusion is a PREFERENCE — never dressed up as physics', () => {
      const [b] = blockersFor(load({ excludedBodies: ['flatbed'] }), truck({ truckSubtype: 'flatbed' }), ok);
      expect(b.kind).toBe('preference');
      expect(b.code).toBe('BODY_EXCLUDED');
      // …and it only bites the excluded body.
      expect(blockersFor(load({ excludedBodies: ['flatbed'] }), truck({ truckSubtype: 'box' }), ok)).toEqual([]);
    });

    it('over-budget is a PREFERENCE too, and says the shipper may still move', () => {
      const [b] = blockersFor(load({ maxSpend: 50 }), truck(), { ...ok, indicativeCharge: 120 });
      expect(b.kind).toBe('preference');
      expect(b.message).toMatch(/raise it/);
      expect(blockersFor(load({ maxSpend: 200 }), truck(), { ...ok, indicativeCharge: 120 })).toEqual([]);
    });

    it('distinguishes a vehicle that is TOO SMALL from one that is merely FULL', () => {
      // Reading "too heavy" when the answer is "deliver what you are holding" would tell an operator to buy a
      // bigger truck they do not need.
      const small = blockersFor(load({ weightKg: 20_000 }), truck({ capacityKg: 10_000 }), ok);
      expect(codes(small)).toEqual(['OVER_VEHICLE_CAPACITY']);
      expect(small[0].kind).toBe('physical');
      const full = blockersFor(load({ weightKg: 5_000 }), truck({ capacityKg: 10_000 }), { ...ok, remainingKg: 1_000 });
      expect(codes(full)).toEqual(['OVER_REMAINING_CAPACITY']);
      expect(full[0].kind).toBe('resolvable'); // deliverable today, not a purchase
    });

    it('a below-floor rating is RESOLVABLE — it recovers', () => {
      const [b] = blockersFor(load(), truck(), { ...ok, ratingBelowFloor: true });
      expect(b.kind).toBe('resolvable');
      expect(b.code).toBe('RATING_BELOW_FLOOR');
    });
  });

  describe('the unknown route — absence of a report is not clearance', () => {
    it('marks an oversize body as NOT SURVEYED rather than passing it silently', () => {
      // Nobody surveys these roads. A board that says nothing about an unchecked bridge is a board that
      // implies there is not one.
      const [b] = blockersFor(load({ derivedBody: 'lowboy' }), truck(), ok);
      expect(b.kind).toBe('unknown');
      expect(b.code).toBe('ROUTE_NOT_SURVEYED');
    });

    it('an unsurveyed route does NOT make the load untakeable — it is a warning, not our refusal', () => {
      // The operator drives the road; deciding for them that they cannot would be the platform overreaching.
      const bs = blockersFor(load({ derivedBody: 'lowboy' }), truck(), ok);
      expect(takeable(bs)).toBe(true);
      // …but any real blocker alongside it still does.
      expect(takeable([...bs, { kind: 'physical', code: 'X', message: 'x' }])).toBe(false);
    });

    it('does not cry wolf on an ordinary body', () => {
      expect(codes(blockersFor(load({ derivedBody: 'box' }), truck(), ok))).not.toContain('ROUTE_NOT_SURVEYED');
    });

    it('REPORTS DO NOT PROMOTE A ROAD TO SURVEYED — the caveat survives finding something', () => {
      // The defect this replaced: any report on the corridor switched the caveat off, so one reported
      // weighbridge on a 400 km road read as a clearance for every bridge on it. Reports are evidence of
      // the obstacles somebody MET; they are never evidence about the ones nobody met.
      const found = [{ kind: 'physical' as const, code: 'OVER_HEIGHT', message: '4.2 m limit' }];
      const bs = blockersFor(load({ derivedBody: 'lowboy' }), truck(), { ...ok, routeBlockers: found });
      expect(codes(bs)).toEqual(expect.arrayContaining(['OVER_HEIGHT', 'ROUTE_NOT_SURVEYED']));
    });

    it('carries what the map found on a body that gets no blanket caveat', () => {
      // An ordinary box body is not warned about bridges in general — but a bridge somebody actually
      // reported on its road is a fact about this load, and it is shown.
      const found = [{ kind: 'legal' as const, code: 'HAZMAT_PROHIBITED', message: 'no hazmat on this road' }];
      const bs = blockersFor(load({ derivedBody: 'box' }), truck(), { ...ok, routeBlockers: found });
      expect(codes(bs)).toEqual(['HAZMAT_PROHIBITED']);
    });
  });

  it('with no vehicle it says so ONCE, instead of inventing failures for a truck that is not there', () => {
    const bs = blockersFor(load({ weightKg: 99_999, requiredEquipment: ['FLT'], requiredCapabilities: ['hazmat'] }), null, { remainingKg: 0, ratingBelowFloor: false });
    expect(codes(bs)).toEqual(['NO_VEHICLE']);
    expect(bs[0].kind).toBe('resolvable');
  });

  it('says a load is not takeable while the security declaration is not in force — with or without a lorry (round 39)', () => {
    const words = 'Your fleet has not signed its security declaration: nothing new is taken on until it has.';
    const coupled = blockersFor(load(), truck(), { ...ok, declaration: words });
    expect(coupled).toEqual([{ kind: 'resolvable', code: 'DECLARATION_REQUIRED', message: words }]);
    expect(takeable(coupled)).toBe(false);
    expect(codes(blockersFor(load(), null, { ...ok, declaration: words }))).toEqual(['DECLARATION_REQUIRED', 'NO_VEHICLE']);
  });

  it('every kind it can emit is one the screen knows how to describe', () => {
    for (const kind of BLOCKER_KINDS) expect(BLOCKER_KIND_MEANING[kind]).toBeTruthy();
  });
});
