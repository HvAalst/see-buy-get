import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { arrivalWord, bookableDays, bookingReady, hoursLine, hubOriginOf, HUB_ORIGIN, todayAt } from './hubs';

const day = { open: '07:00', close: '15:00' };

describe('a store handing its parcels in at a hub, in bulk (reading B)', () => {
  it('keeps a hub chosen as where a parcel starts apart from a shop: "hub:<id>", and nothing else is one', () => {
    expect(hubOriginOf(`${HUB_ORIGIN}mdp_1`)).toBe('mdp_1');
    expect(hubOriginOf('did:agent:shop-1')).toBeNull();
    expect(hubOriginOf(HUB_ORIGIN)).toBeNull();
  });

  it('says when a hub receives as a site’s hours are said everywhere: days of the same hours run together, the rest closed', () => {
    expect(hoursLine({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: null, sun: null }, t)).toBe('Mon–Fri 07:00–15:00 · Sat–Sun closed');
    expect(hoursLine(undefined, t)).toBeNull();
  });

  it('reads today on the hub’s own clock, not the reader’s — and the reader’s where the hub keeps none', () => {
    // 22:30 in London on Mon 26 Oct is 01:30 on Tue 27 Oct in Nairobi.
    const at = Date.parse('2026-10-26T22:30:00Z');
    expect(todayAt('Africa/Nairobi', at)).toBe('2026-10-27');
    expect(todayAt('Europe/London', at)).toBe('2026-10-26');
    expect(todayAt('Not/AZone', at)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayAt(undefined, at)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('offers only the days the hub receives, from today on its clock — every day where it keeps no hours', () => {
    // Fri 30 Oct 2026: a hub open Mon–Fri offers Fri, then Mon and Tue — never the weekend.
    expect(bookableDays({ mon: day, tue: day, wed: day, thu: day, fri: day }, '2026-10-30', 5)).toEqual(['2026-10-30', '2026-11-02', '2026-11-03']);
    expect(bookableDays({ sat: day }, '2026-10-30', 9)).toEqual(['2026-10-31', '2026-11-07']);
    expect(bookableDays(undefined, '2026-10-30', 3)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    // Across the end of a month and a year, by the calendar, not by adding hours.
    expect(bookableDays(undefined, '2026-12-31', 2)).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('puts an arrival in one word: coming, late, being taken in, all in, some not there, withdrawn, did not come', () => {
    expect(arrivalWord({ state: 'expected' })).toBe('expected');
    expect(arrivalWord({ state: 'expected', late: true })).toBe('late');
    expect(arrivalWord({ state: 'receiving', late: true })).toBe('receiving');
    expect(arrivalWord({ state: 'received', finished: { missing: [] } } as never)).toBe('all_in');
    expect(arrivalWord({ state: 'received', finished: { missing: ['PUD-1'] } } as never)).toBe('some_missing');
    expect(arrivalWord({ state: 'withdrawn' })).toBe('withdrawn');
    expect(arrivalWord({ state: 'missed', late: true })).toBe('missed');
  });

  it('sends a booking only with a parcel on it, its units counted 1 to 100, and a day', () => {
    const ok = { parcelIds: ['PUD-1'], units: '2', expectedOn: '2026-10-30' };
    expect(bookingReady(ok)).toBe(true);
    expect(bookingReady({ ...ok, parcelIds: [] })).toBe(false);
    for (const units of ['0', '', '1.5', '101', 'two']) expect(bookingReady({ ...ok, units })).toBe(false);
    expect(bookingReady({ ...ok, units: '100' })).toBe(true);
    expect(bookingReady({ ...ok, expectedOn: '' })).toBe(false);
    expect(bookingReady({ ...ok, expectedOn: '30/10/2026' })).toBe(false);
  });
});
