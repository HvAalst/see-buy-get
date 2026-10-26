import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { weekForm } from '../fleet/sites';
import { arrivalGroups, arrivalsAtTheDoor, bulkBody, canSayMissed, hubArrivalWord, loadLine, onIt, replaceArrival, stillToScan, unitsOf, type HubArrival } from './arrivals';

const parcel = (parcelId: string, extra: Partial<HubArrival['parcels'][number]> = {}) => ({ parcelId, destination: 'Riverside', scanned: false, ...extra });

const arrival = (arrivalId: string, extra: Partial<HubArrival> = {}): HubArrival =>
  ({
    arrivalId,
    mdpId: 'mdp_1',
    hubName: 'Bulk Hub',
    vendorId: 'v_1',
    storeName: 'Bulk Store',
    parcels: [parcel('PUD-1'), parcel('PUD-2')],
    unitKind: 'pallet',
    units: 1,
    expectedOn: '2026-10-27',
    state: 'expected',
    createdAt: '2026-10-26T08:00:00.000Z',
    scannedCount: 0,
    ...extra,
  }) as HubArrival;

describe('coming in: a store’s parcels brought to the hub in bulk (reading B)', () => {
  it('puts an arrival in one word for the hub: due today, late, coming, scanning in, all in, some not there, withdrawn, did not come', () => {
    expect(hubArrivalWord(arrival('a', { today: true }))).toBe('due');
    expect(hubArrivalWord(arrival('a', { late: true }))).toBe('late');
    expect(hubArrivalWord(arrival('a'))).toBe('coming');
    expect(hubArrivalWord(arrival('a', { state: 'receiving', today: true }))).toBe('receiving');
    expect(hubArrivalWord(arrival('a', { state: 'received', finished: { at: 'x', by: 'y', missing: [] } }))).toBe('all_in');
    expect(hubArrivalWord(arrival('a', { state: 'received', finished: { at: 'x', by: 'y', missing: ['PUD-2'] } }))).toBe('some_missing');
    expect(hubArrivalWord(arrival('a', { state: 'withdrawn' }))).toBe('withdrawn');
    expect(hubArrivalWord(arrival('a', { state: 'missed', late: true }))).toBe('missed');
  });

  it('piles them as the floor works: at the door now (being scanned in, then late, then due), coming soonest first, done latest first', () => {
    const list = [
      arrival('later', { expectedOn: '2026-10-30' }),
      arrival('due', { today: true }),
      arrival('soon', { expectedOn: '2026-10-28' }),
      arrival('late', { late: true, expectedOn: '2026-10-25' }),
      arrival('scanning', { state: 'receiving', today: true }),
      arrival('old', { state: 'received', finished: { at: '2026-10-20T10:00:00.000Z', by: 'x', missing: [] } }),
      arrival('gone', { state: 'withdrawn', withdrawn: { at: '2026-10-22T10:00:00.000Z', by: 'x' } }),
      arrival('missed', { state: 'missed', missed: { at: '2026-10-24T10:00:00.000Z', by: 'x' } }),
    ];
    const g = arrivalGroups(list);
    expect(g.now.map((a) => a.arrivalId)).toEqual(['scanning', 'late', 'due']);
    expect(g.coming.map((a) => a.arrivalId)).toEqual(['soon', 'later']);
    expect(g.done.map((a) => a.arrivalId)).toEqual(['missed', 'gone', 'old']);
    expect(arrivalsAtTheDoor({ arrivals: list })).toBe(3);
    expect(arrivalsAtTheDoor(null)).toBe(0);
  });

  it('says what was booked to come, and what is still to scan: never a parcel scanned in or withdrawn by the store', () => {
    expect(loadLine(arrival('a', { units: 3, unitKind: 'carton', parcels: [parcel('PUD-1')] }), t)).toBe('3 cartons · 1 parcel');
    expect(loadLine(arrival('a'), t)).toBe('1 pallet · 2 parcels');
    const a = arrival('a', { parcels: [parcel('PUD-1', { scanned: true }), parcel('PUD-2', { withdrawn: true }), parcel('PUD-3')] });
    expect(stillToScan(a).map((p) => p.parcelId)).toEqual(['PUD-3']);
    expect(onIt(a).map((p) => p.parcelId)).toEqual(['PUD-1', 'PUD-3']);
  });

  it('lets the hub say an arrival did not come only once its day is over, and nothing was taken in at the door', () => {
    expect(canSayMissed(arrival('a', { late: true }))).toBe(true);
    expect(canSayMissed(arrival('a', { today: true }))).toBe(false);
    expect(canSayMissed(arrival('a', { state: 'receiving', late: true }))).toBe(false);
    expect(canSayMissed(arrival('a', { state: 'missed', late: true }))).toBe(false);
  });

  it('keeps the list as the server answers: an arrival in place of what it was, a new one first', () => {
    const view = { arrivals: [arrival('a'), arrival('b')] };
    expect(replaceArrival(view, arrival('b', { state: 'receiving' }))?.arrivals.map((a) => `${a.arrivalId}:${a.state}`)).toEqual(['a:expected', 'b:receiving']);
    expect(replaceArrival(view, arrival('c'))?.arrivals.map((a) => a.arrivalId)).toEqual(['c', 'a', 'b']);
    expect(replaceArrival(null, arrival('c'))).toBeNull();
  });

  it('reads the units counted at the door: a whole number from 1 to 100, or nothing', () => {
    expect(unitsOf('3')).toBe(3);
    expect(unitsOf(' 100 ')).toBe(100);
    for (const s of ['', '0', '101', '1.5', '-1', 'two']) expect(unitsOf(s)).toBeNull();
  });

  it('checks the hub’s days and hours as the server does before sending them: a day at least, opening before closing, doors 1 to 50', () => {
    const week = weekForm({ mon: { open: '07:00', close: '15:00' } });
    expect(bulkBody(true, week, '2')).toEqual({ body: { open: true, hours: week, doors: 2 } });
    expect(bulkBody(true, week, '')).toEqual({ body: { open: true, hours: week, doors: null } });
    // Without set hours it receives whenever it is working: no days to check.
    expect(bulkBody(false, weekForm({}), '')).toEqual({ body: { open: true, hours: null, doors: null } });
    expect(bulkBody(true, weekForm({}), '')).toEqual({ error: 'mdp.bulk.errNoDay' });
    expect(bulkBody(true, { ...week, mon: { open: '15:00', close: '07:00' } }, '')).toEqual({ error: 'mdp.bulk.errCloses' });
    expect(bulkBody(true, { ...week, mon: { open: '7', close: '15:00' } }, '')).toEqual({ error: 'mdp.bulk.errTime' });
    for (const doors of ['0', '51', '1.5', 'two']) expect(bulkBody(true, week, doors)).toEqual({ error: 'mdp.bulk.errDoors' });
  });
});
