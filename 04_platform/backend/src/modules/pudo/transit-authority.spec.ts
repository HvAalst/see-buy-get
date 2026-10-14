import { TransitAuthorityService } from './transit-authority.service';

/**
 * The permission to move uncleared goods.
 *
 * The cases worth asserting are the ones that decide whether a truck is offered somebody's uncleared
 * cargo: what counts as in date, what a renewal does to the one before it, and the two ways a permission
 * can look like cover on a screen without being cover — an expired one, and one for the wrong country.
 */
describe('permission to carry under bond', () => {
  const fresh = () => new TransitAuthorityService();
  const JAN = Date.parse('2026-01-15T09:00:00.000Z');
  const good = { carrierDid: 'fleet-a', country: 'ET', reference: 'ET-TR-4471', expiresAt: '2026-12-31' };

  it('records what the carrier states, against whoever typed it', () => {
    const s = fresh();
    const a = s.declare(good, 'Hans', JAN);
    expect(a).toMatchObject({ carrierDid: 'fleet-a', country: 'ET', reference: 'ET-TR-4471', recordedBy: 'Hans' });
    expect(s.permits('fleet-a', 'ET', JAN)).toBe(true);
  });

  it('stops at the frontier of the authority that issued it', () => {
    const s = fresh();
    s.declare(good, 'Hans', JAN);
    // A bond runs under ONE customs authority. Ethiopian transit is no standing at a Kenyan counter,
    // and a single global flag would have said it was.
    expect(s.permits('fleet-a', 'KE', JAN)).toBe(false);
    // Case is not the question being asked.
    expect(s.permits('fleet-a', 'et', JAN)).toBe(true);
  });

  it('is nobody else-s permission', () => {
    const s = fresh();
    s.declare(good, 'Hans', JAN);
    expect(s.permits('fleet-b', 'ET', JAN)).toBe(false);
    expect(s.permits(undefined, 'ET', JAN)).toBe(false);
    expect(s.permits('fleet-a', undefined, JAN)).toBe(false);
  });

  it('is good for the whole of the day it runs out, and not the day after', () => {
    const s = fresh();
    s.declare({ ...good, expiresAt: '2026-03-01' }, 'Hans', JAN);
    // Read as midnight this would stop a truck that is still legally on the road.
    expect(s.permits('fleet-a', 'ET', Date.parse('2026-03-01T22:00:00.000Z'))).toBe(true);
    expect(s.permits('fleet-a', 'ET', Date.parse('2026-03-02T00:30:00.000Z'))).toBe(false);
  });

  it('refuses a licence that has already run out rather than filing it', () => {
    const s = fresh();
    // A spent permission on a screen reads as cover and is not — worse than having none.
    expect(() => s.declare({ ...good, expiresAt: '2025-12-31' }, 'Hans', JAN)).toThrow(/ran out/);
    expect(() => s.declare({ ...good, expiresAt: 'soon' }, 'Hans', JAN)).toThrow(/YYYY-MM-DD/);
    expect(() => s.declare({ ...good, country: 'Ethiopia' }, 'Hans', JAN)).toThrow(/two-letter/);
    expect(() => s.declare({ ...good, reference: '  ' }, 'Hans', JAN)).toThrow(/licence or bond number/);
    expect(s.list('fleet-a')).toEqual([]);
  });

  it('lets a renewal supersede the one before it, instead of standing beside it', () => {
    const s = fresh();
    const first = s.declare(good, 'Hans', JAN);
    const second = s.declare({ ...good, reference: 'ET-TR-9001', expiresAt: '2027-12-31' }, 'Hans', JAN);
    // Two live authorities for one country is two answers to a question that has one.
    expect(s.liveFor('fleet-a', 'ET', JAN)?.authorityId).toBe(second.authorityId);
    expect(s.list('fleet-a')).toHaveLength(2);
    expect(s.list('fleet-a').find((a) => a.authorityId === first.authorityId)?.withdrawnReason).toContain('ET-TR-9001');
  });

  it('withdraws with a reason, and keeps the record', () => {
    const s = fresh();
    const a = s.declare(good, 'Hans', JAN);
    expect(() => s.withdraw(a.authorityId, 'Hans', '')).toThrow(/why/);
    const gone = s.withdraw(a.authorityId, 'Hans', 'Suspended by the authority', JAN);
    expect(gone.withdrawnReason).toBe('Suspended by the authority');
    expect(s.permits('fleet-a', 'ET', JAN)).toBe(false);
    // Kept, because a leg already carried under it is still a fact.
    expect(s.list('fleet-a')).toHaveLength(1);
  });
});
