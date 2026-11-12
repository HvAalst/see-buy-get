import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { laneWords, offPlanWords, planFoldHint, type PlanLane, detourWords } from './planVsActual';

const lane = (over: Partial<PlanLane> = {}): PlanLane => ({ from: 'CBD', to: 'Kisumu', arrived: 3, onTime: 1, late: 2, typicalLateHours: 6.5, routeKnown: 3, routeKept: 2, worst: { parcelId: 'P-9', lateHours: 10 }, ...over });

describe('a lane against its plans, as the console says it', () => {
  it('says on time out of how many, how late the late ones usually were, and how many went as planned', () => {
    expect(laneWords(lane(), t)).toEqual({ lane: 'CBD → Kisumu', via: '', onTime: '1 of 3', late: 'usually 6.5 h late', route: '2 of 3', worst: 'P-9, 10 h' });
    // 2026-11-12 — along the road map: the hubs its latest parcel passed.
    expect(laneWords(lane({ hubs: ['Nairobi Hub', 'Nakuru Hub', 'Kisumu Hub'] }), t).via).toBe('via Nairobi Hub → Nakuru Hub → Kisumu Hub');
  });

  it('says "never late" rather than nought hours, and "not recorded" rather than nought of nought', () => {
    expect(laneWords(lane({ late: 0, onTime: 3, typicalLateHours: 0, worst: undefined }), t)).toMatchObject({ late: 'never late', worst: '' });
    expect(laneWords(lane({ routeKnown: 0, routeKept: 0 }), t).route).toBe('not recorded');
  });

  it('says on the closed fold how many lanes ran late — one, many, none — or that there is nothing yet', () => {
    expect(planFoldHint([lane(), lane({ late: 0 })], t)).toBe('1 lane ran late');
    expect(planFoldHint([lane(), lane()], t)).toBe('2 lanes ran late');
    expect(planFoldHint([lane({ late: 0 })], t)).toBe('Every lane on time');
    expect(planFoldHint([], t)).toBe('Nothing to read yet');
    expect(planFoldHint(null, t)).toBe('Reading the lanes…');
  });
});

/* 2026-11-06 — MOVEMENT UNIFICATION: a lane says how many of its parcels went another way than their plan, and why. */
describe('the steps a lane’s parcels took off their plans', () => {
  it('says nothing where none did', () => {
    expect(offPlanWords({ offPlan: 0, offPlanReasons: {} }, t)).toBe('');
    expect(offPlanWords({}, t)).toBe('');
  });

  it('counts them, the commonest reason first, each in words', () => {
    const said = offPlanWords({ offPlan: 3, offPlanReasons: { arrived_elsewhere: 1, no_transport: 2 } }, t);
    expect(said).toBe(t('tower.plan.offPlan', { count: 3, why: `${t('tower.plan.why.noTransport')} (2), ${t('tower.plan.why.arrivedElsewhere')} (1)` }));
  });
});

/* 2026-11-06 — what the ways not priced cost (the owner: "I follow point 1 to 6"). */
describe('a lane’s detours, in words', () => {
  it('says what was paid at stops not priced, and the priced stops not used — each money apart, never added', () => {
    const words = detourWords({ detours: { parcels: 3, paid: [{ currency: 'KES', amount: 1200 }, { currency: 'UGX', amount: 40000 }], unused: [{ currency: 'KES', amount: 800 }] } }, t as never);
    expect(words).toBe('3 paid at stops not priced: 1,200.00 KES · 40,000.00 UGX — priced stops not used: 800.00 KES');
    expect(detourWords({ detours: { parcels: 1, paid: [{ currency: 'KES', amount: 60 }], unused: [] } }, t as never)).toBe('1 paid at a stop not priced: 60.00 KES');
    expect(detourWords({}, t as never)).toBe('');
  });
});
