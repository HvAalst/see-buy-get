import { describe, expect, it } from 'vitest';
import { renewalBlocker } from '../../shared/papers';
import { isStuck, stuckCount, type PapersNetworkView } from './papers';

const view = (over: Partial<PapersNetworkView> = {}): PapersNetworkView => ({ couriers: [], vehicles: [], fleets: { count: 0, withLapsed: 0, lapsed: 0, due: 0 }, sweep: null, sweepEveryHours: 6, ...over });

describe('the papers the network has to put right', () => {
  it('counts the stuck — lapsed, not merely due or undated — and says nothing before it has read', () => {
    expect(stuckCount(null)).toBeNull();
    expect(stuckCount(view())).toBe(0);
    const c = (offRoad: string[]) => ({ did: 'd', displayName: 'D', status: 'ACTIVE', registry: 'light', licence: {}, papers: [], offRoad, onShift: false, drives: [] });
    const v = (offRoad: string[]) => ({ vehicleId: 'v', plate: 'P', vehicleClass: 'bike', status: 'ACTIVE', documents: {}, papers: [], offRoad });
    expect(stuckCount(view({ couriers: [c(['Driving licence lapsed 1 Feb 2026']), c([])], vehicles: [v(['Insurance lapsed 1 Sep 2026'])] }))).toBe(2);
    expect(isStuck(c([]))).toBe(false);
  });

  it('refuses an empty or past renewal date before the server has to, and accepts tomorrow', () => {
    const today = new Date(2026, 8, 15);
    expect(renewalBlocker('', today)).toBe('tower.papers.needDate');
    expect(renewalBlocker('someday', today)).toBe('tower.papers.needDate');
    expect(renewalBlocker('2026-09-15', today)).toBe('tower.papers.datePast');
    expect(renewalBlocker('2026-09-14', today)).toBe('tower.papers.datePast');
    expect(renewalBlocker('2026-09-16', today)).toBeNull();
  });
});
