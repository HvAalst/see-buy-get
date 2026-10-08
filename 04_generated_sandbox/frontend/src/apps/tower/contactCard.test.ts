import { describe, expect, it } from 'vitest';
import { addClosedDate, closedDateWords, removeClosedDate, visitorsPerHourOf } from './contactCard';

describe('a company’s closed dates, while it edits them', () => {
  it('keeps one of each date, in date order, with what the day is', () => {
    let list = addClosedDate([], '2026-12-25', ' Christmas Day ');
    list = addClosedDate(list, '2026-10-20', 'Mashujaa Day');
    list = addClosedDate(list, '2026-11-02', '');
    expect(list).toEqual([{ date: '2026-10-20', note: 'Mashujaa Day' }, { date: '2026-11-02' }, { date: '2026-12-25', note: 'Christmas Day' }]);
    // The same date again changes what it is called; it is not there twice.
    expect(addClosedDate(list, '2026-11-02', 'Stocktaking')).toEqual([{ date: '2026-10-20', note: 'Mashujaa Day' }, { date: '2026-11-02', note: 'Stocktaking' }, { date: '2026-12-25', note: 'Christmas Day' }]);
    // What is not a date changes nothing.
    expect(addClosedDate(list, '', 'x')).toBe(list);
    expect(addClosedDate(list, '25 December', 'x')).toBe(list);
    expect(addClosedDate([], '2026-10-20', 'x'.repeat(90))[0].note).toHaveLength(60);
  });

  it('removes a date and leaves the rest', () => {
    const list = [{ date: '2026-10-20', note: 'Mashujaa Day' }, { date: '2026-12-25' }];
    expect(removeClosedDate(list, '2026-10-20')).toEqual([{ date: '2026-12-25' }]);
    expect(removeClosedDate(list, '2026-01-01')).toEqual(list);
  });

  it('says a date with its weekday, so a Monday is seen to be a Monday', () => {
    expect(closedDateWords('2026-10-20')).toMatch(/Tuesday/);
    expect(closedDateWords('2026-10-20')).toMatch(/2026/);
  });
});

describe('visitors an hour, as it is typed', () => {
  it('is a whole number above zero — and anything else is zero, which means no limit', () => {
    expect(visitorsPerHourOf('3')).toBe(3);
    expect(visitorsPerHourOf(' 12 ')).toBe(12);
    for (const none of ['', '0', '-2', '2.5', 'three']) expect(visitorsPerHourOf(none)).toBe(0);
  });
});
