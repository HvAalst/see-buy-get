import { describe, expect, it } from 'vitest';
import { renewalBlocker } from '../../shared/papers';
import { isStuck, waitingCount, type CarrierPaperRow, type CourierPaperRow, type PapersNetworkView } from './papers';

const view = (over: Partial<PapersNetworkView> = {}): PapersNetworkView => ({ couriers: [], vehicles: [], fleets: { count: 0, withLapsed: 0, lapsed: 0, due: 0 }, sweep: null, sweepEveryHours: 6, ...over });

describe('the papers the network has to put right', () => {
  const c = (offRoad: string[], renewal?: CourierPaperRow['renewal']): CourierPaperRow => ({ did: 'd', displayName: 'D', status: 'ACTIVE', registry: 'light', licence: {}, papers: [], offRoad, onShift: false, drives: [], ...(renewal ? { renewal } : {}) });
  const v = (offRoad: string[]) => ({ vehicleId: 'v', plate: 'P', vehicleClass: 'bike', status: 'ACTIVE', documents: {}, papers: [], offRoad });
  const card = { copyRef: 'med_1', expiresAt: '2030-05-31', sentAt: '2026-09-21T08:00:00Z' };

  it('counts the stuck — lapsed, not merely due or undated — and says nothing before it has read', () => {
    expect(waitingCount(null)).toBeNull();
    expect(waitingCount(view())).toBe(0);
    expect(waitingCount(view({ couriers: [c(['Driving licence lapsed 1 Feb 2026']), c([])], vehicles: [v(['Insurance lapsed 1 Sep 2026'])] }))).toBe(2);
    expect(isStuck(c([]))).toBe(false);
  });

  it('counts a courier who has sent their card, lapsed or not — and a lapsed one who sent it only once', () => {
    // Merely running out waits on nobody; running out WITH the new card sent waits on us.
    expect(waitingCount(view({ couriers: [c([], card)] }))).toBe(1);
    expect(waitingCount(view({ couriers: [c(['Driving licence lapsed 1 Feb 2026'], card)] }))).toBe(1);
  });

  it('counts a fleet that sent its own papers, once however many it sent', () => {
    const op = (sent: CarrierPaperRow['sent']): CarrierPaperRow => ({ did: 'f', companyName: 'Kilima', status: 'ACTIVE', papers: [], enforced: [], notOffered: [], sent });
    const doc = { copyRef: 'med_2', expiresAt: '2027-09-01', sentAt: '2026-09-29T08:00:00Z' };
    // Lapsed and refused work is the FLEET's to act on; a document it sent is ours.
    expect(waitingCount(view({ carrierPapers: [op({}), { ...op({}), notOffered: ['Operator licence lapsed 1 Sep 2026'] }] }))).toBe(0);
    expect(waitingCount(view({ carrierPapers: [op({ operator_licence: doc, carrier_insurance: doc })] }))).toBe(1);
    // A server that predates the list is read as nothing waiting, not as broken.
    expect(waitingCount(view({ carrierPapers: undefined }))).toBe(0);
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
