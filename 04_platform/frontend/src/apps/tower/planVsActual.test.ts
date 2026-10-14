import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { laneWords, planFoldHint, type PlanLane } from './planVsActual';

const lane = (over: Partial<PlanLane> = {}): PlanLane => ({ from: 'CBD', to: 'Kisumu', arrived: 3, onTime: 1, late: 2, typicalLateHours: 6.5, routeKnown: 3, routeKept: 2, worst: { parcelId: 'P-9', lateHours: 10 }, ...over });

describe('a lane against its plans, as the console says it', () => {
  it('says on time out of how many, how late the late ones usually were, and how many went as planned', () => {
    expect(laneWords(lane(), t)).toEqual({ lane: 'CBD → Kisumu', onTime: '1 of 3', late: 'usually 6.5 h late', route: '2 of 3', worst: 'P-9, 10 h' });
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
