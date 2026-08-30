import { driverJobRowOf, driverJobsSummaryOf, driverJobsToCsv, filterDriverJobs } from './dispatch.service';
import type { Freight } from './dispatch.types';

const D = 'did:driver:amos';

function freight(over: Partial<Freight>): Freight {
  return {
    freightId: 'f',
    code: 'FRT-000',
    description: 'Cargo',
    pickupLocation: { lat: 0, lng: 0 },
    pickupLabel: 'Depot',
    destLabel: 'Karen',
    weightKg: 500,
    fragile: false,
    packaging: 'loose',
    cargoClass: 'P4',
    natureCode: 'GEN',
    requiredCapabilities: [],
    requiredEquipment: [],
    equipmentGaps: [],
    status: 'delivered',
    createdAt: '2026-08-01T10:00:00Z',
    ...over,
  } as unknown as Freight;
}

const jobs: Freight[] = [
  freight({ freightId: 'A', code: 'FRT-001', claimedBy: D, status: 'delivered', lockedPrice: 120, driverPaid: true, claimedAt: '2026-08-03T10:00:00Z', deliveredAt: '2026-08-03T14:00:00Z', destLabel: 'Karen' }),
  freight({ freightId: 'B', code: 'FRT-002', description: 'Cement pallets', claimedBy: D, status: 'in_transit', lockedPrice: 80, driverPaid: false, claimedAt: '2026-08-05T10:00:00Z', destLabel: 'Westlands' }),
  freight({ freightId: 'C', code: 'FRT-003', claimedBy: 'did:driver:other', status: 'delivered', lockedPrice: 200, driverPaid: true, claimedAt: '2026-08-04T10:00:00Z' }),
  freight({ freightId: 'E', code: 'FRT-004', claimedBy: D, status: 'delivered', lockedPrice: 40, driverPaid: false, claimedAt: '2026-08-01T10:00:00Z', destLabel: 'Karen' }),
];

describe('driver jobs + earnings register (R5)', () => {
  it('sees only THIS driver’s claimed hauls, newest-first by claim date; sorts by date/earning', () => {
    expect(filterDriverJobs(jobs, D, {}).map((f) => f.freightId)).toEqual(['B', 'A', 'E']); // C (another driver) excluded
    expect(filterDriverJobs(jobs, D, { sort: 'oldest' }).map((f) => f.freightId)).toEqual(['E', 'A', 'B']);
    expect(filterDriverJobs(jobs, D, { sort: 'earn_desc' }).map((f) => f.freightId)).toEqual(['A', 'B', 'E']);
    expect(filterDriverJobs(jobs, D, { sort: 'earn_asc' }).map((f) => f.freightId)).toEqual(['E', 'B', 'A']);
  });

  it('filters by status / paid / date, and searches code / description / destination', () => {
    expect(filterDriverJobs(jobs, D, { status: 'delivered' }).map((f) => f.freightId).sort()).toEqual(['A', 'E']);
    expect(filterDriverJobs(jobs, D, { paid: 'paid' }).map((f) => f.freightId)).toEqual(['A']);
    expect(filterDriverJobs(jobs, D, { paid: 'unpaid' }).map((f) => f.freightId).sort()).toEqual(['B', 'E']);
    expect(filterDriverJobs(jobs, D, { q: 'cement' }).map((f) => f.freightId)).toEqual(['B']); // description
    expect(filterDriverJobs(jobs, D, { q: 'FRT-004' }).map((f) => f.freightId)).toEqual(['E']); // code
    expect(filterDriverJobs(jobs, D, { q: 'karen' }).map((f) => f.freightId).sort()).toEqual(['A', 'E']); // destination
    expect(filterDriverJobs(jobs, D, { from: '2026-08-04' }).map((f) => f.freightId)).toEqual(['B']);
  });

  it('summarises earned / paid / unpaid / delivered over the set (filtered view)', () => {
    expect(driverJobsSummaryOf(filterDriverJobs(jobs, D, {}))).toEqual({ earned: 240, paid: 120, unpaid: 120, delivered: 2, count: 3 });
    expect(driverJobsSummaryOf(filterDriverJobs(jobs, D, { paid: 'unpaid' }))).toEqual({ earned: 120, paid: 0, unpaid: 120, delivered: 1, count: 2 });
    expect(driverJobsSummaryOf([])).toEqual({ earned: 0, paid: 0, unpaid: 0, delivered: 0, count: 0 });
  });

  it('projects a row + exports CSV with a numeric earning and no buyer hash', () => {
    expect(driverJobRowOf(jobs[0])).toMatchObject({ freightId: 'A', code: 'FRT-001', status: 'delivered', earning: 120, paid: true, destLabel: 'Karen' });
    const csv = driverJobsToCsv(filterDriverJobs(jobs, D, { status: 'delivered', sort: 'oldest' }));
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Job,Description,Destination,Status,Class,Weight kg,Earning,Currency,Paid,Claimed,Delivered');
    expect(lines[1]).toContain('FRT-004'); // E, the oldest delivered
    expect(lines).toHaveLength(3); // header + E + A
    expect(csv).not.toContain('buyerPhoneHash');
  });
});
