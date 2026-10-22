import { describe, expect, it } from 'vitest';
import { paperDay, renewalBlocker } from '../../shared/papers';
import { isStuck, shopLicenceNeedsLook, waitingCount, type CarrierPaperRow, type CourierPaperRow, type PapersNetworkView, type ShopLicenceRow } from './papers';
import { shopLicenceLine } from './screens/ShopLicences';
import { t } from '../../shared/i18n';

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

  /** Round 40 — a shop's trading licence, on the Papers list. */
  const shop = (standing: Partial<ShopLicenceRow['standing']>, over: Partial<ShopLicenceRow> = {}): ShopLicenceRow => ({ did: 's', shopName: 'Mama Pendo', zone: 'Nairobi', country: 'KE', status: 'ACTIVE', standing: { state: 'ok', renewalSent: false, ...standing }, ...over });
  const sent = { copyRef: 'med_3', expiresAt: '2027-10-31', sentAt: '2026-10-20T08:00:00Z' };

  it('counts a shop that sent its renewed licence — and not one merely running out, lapsed or stopped: that waits on the shop', () => {
    expect(waitingCount(view({ shops: [shop({ state: 'due', expiresAt: '2026-11-11' }), shop({ state: 'stopped', expiresAt: '2026-09-01' })] }))).toBe(0);
    expect(waitingCount(view({ shops: [shop({ state: 'stopped', expiresAt: '2026-09-01', renewalSent: true }, { renewal: sent })] }))).toBe(1);
    expect(waitingCount(view({ shops: undefined }))).toBe(0);
  });

  it('lists the shops worth a look, and counts the ones in date', () => {
    expect(shopLicenceNeedsLook(shop({ state: 'ok', expiresAt: '2027-12-31' }))).toBe(false);
    expect(shopLicenceNeedsLook(shop({ state: 'ok', expiresAt: '2027-12-31' }, { renewal: sent }))).toBe(true);
    for (const state of ['none', 'due', 'grace', 'stopped'] as const) expect(shopLicenceNeedsLook(shop({ state }))).toBe(true);
  });

  it('says on each row what its licence is doing today', () => {
    expect(shopLicenceLine(shop({ state: 'none' }), t)).toBe('Approved before its date was asked — note it from the licence on record');
    expect(shopLicenceLine(shop({ state: 'due', expiresAt: '2026-11-11' }), t)).toBe(`Runs to ${paperDay('2026-11-11')}`);
    expect(shopLicenceLine(shop({ state: 'grace', expiresAt: '2026-10-21', stopsOn: '2026-11-05' }), t)).toBe(`Ran to ${paperDay('2026-10-21')} — new parcels stop ${paperDay('2026-11-05')}`);
    expect(shopLicenceLine(shop({ state: 'stopped', expiresAt: '2026-09-01', stopsOn: '2026-09-16' }), t)).toBe(`Ran to ${paperDay('2026-09-01')} — new parcels stopped ${paperDay('2026-09-16')}`);
    expect(shopLicenceLine(shop({ state: 'stopped' }, { renewal: sent }), t)).toMatch(/^Renewed licence sent /);
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
