import { fleetEarningsSummaryOf, fleetJobsToCsv, filterFleetJobs } from './dispatch.service';
import type { Freight } from './dispatch.types';

/**
 * FP1 — the fleet's register. Pure functions over the freights, exactly as the driver's register is; what is new is
 * the cut by driver and by month, and that the set is "my drivers' hauls" rather than "mine".
 */
describe('the fleet’s earnings register', () => {
  const haul = (over: Partial<Freight>): Freight =>
    ({ freightId: 'fr', code: 'FR-1', description: 'Maize', destLabel: 'Nairobi', status: 'delivered', cargoClass: 'dry', weightKg: 100, lockedPrice: 1000, driverPaid: true, claimedAt: '2026-09-02T08:00:00Z', createdAt: '2026-09-01T08:00:00Z', claimedBy: 'did:amos', ...over }) as Freight;
  const rows = [
    haul({ freightId: 'a', code: 'FR-A', claimedBy: 'did:amos', lockedPrice: 1000 }),
    haul({ freightId: 'b', code: 'FR-B', claimedBy: 'did:grace', lockedPrice: 2500, claimedAt: '2026-08-20T08:00:00Z' }),
    haul({ freightId: 'c', code: 'FR-C', claimedBy: 'did:amos', lockedPrice: 400, status: 'in_transit', driverPaid: false }),
    haul({ freightId: 'x', code: 'FR-X', claimedBy: 'did:stranger', lockedPrice: 9999 }),
  ];
  // Which hauls were taken for the fleet is the service's to answer (DispatchService.carrierOf); here it is these two drivers'.
  const fleet = (f: Freight) => f.claimedBy === 'did:amos' || f.claimedBy === 'did:grace';
  const nameOf = (did: string) => ({ 'did:amos': 'Amos K.', 'did:grace': 'Grace M.' })[did] ?? did;

  it('holds only the fleet’s own drivers’ hauls, and can narrow to one driver', () => {
    expect(filterFleetJobs(rows, fleet, {}).map((f) => f.code)).toEqual(['FR-A', 'FR-C', 'FR-B']);
    expect(filterFleetJobs(rows, fleet, { driver: 'did:grace' }).map((f) => f.code)).toEqual(['FR-B']);
    expect(filterFleetJobs(rows, fleet, { paid: 'unpaid' }).map((f) => f.code)).toEqual(['FR-C']);
  });

  it('cuts the total by driver (most first) and by month (newest first)', () => {
    const s = fleetEarningsSummaryOf(filterFleetJobs(rows, fleet, {}), nameOf);
    expect(s).toMatchObject({ earned: 3900, paid: 3500, unpaid: 400, delivered: 2, count: 3 });
    expect(s.byDriver).toEqual([
      { driverDid: 'did:grace', driverName: 'Grace M.', earned: 2500, delivered: 1, count: 1 },
      { driverDid: 'did:amos', driverName: 'Amos K.', earned: 1400, delivered: 1, count: 2 },
    ]);
    expect(s.byMonth).toEqual([
      { month: '2026-09', earned: 1400, delivered: 1, count: 2 },
      { month: '2026-08', earned: 2500, delivered: 1, count: 1 },
    ]);
  });

  it('exports with the driver as the first column', () => {
    const csv = fleetJobsToCsv(filterFleetJobs(rows, fleet, { driver: 'did:grace' }), nameOf);
    expect(csv.split('\n')[0]).toMatch(/^Driver,Job,/);
    expect(csv).toContain('Grace M.,FR-B,Maize');
    expect(csv).not.toContain('FR-X');
  });
});
