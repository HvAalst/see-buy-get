import { describe, expect, it } from 'vitest';
import { dayName, HUB_WEEK, openNowLine, telOf } from './hubReach';
import { t } from './i18n';

describe('a hub’s hours and how to reach it, said the same in every app', () => {
  it('runs its week Sunday to Saturday, and names a day from the calendar, short or in full', () => {
    expect(HUB_WEEK).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    expect(HUB_WEEK.map((d) => dayName(d))).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(dayName('sat', 'long')).toBe('Saturday');
    // Something that is not a day is said as it came, never as some other day.
    expect(dayName('holiday')).toBe('holiday');
  });

  it('says whether it is open now as the server read it on the hub’s own clock: until when, or when it opens next', () => {
    expect(openNowLine({ open: true, until: '18:00' }, t)).toBe('Open until 18:00');
    expect(openNowLine({ open: true }, t)).toBe('Open now');
    expect(openNowLine({ open: false, opensDay: 'tue', opensAt: '07:00', opensToday: true }, t)).toBe('Closed · opens at 07:00');
    expect(openNowLine({ open: false, opensDay: 'mon', opensAt: '07:00' }, t)).toBe('Closed · opens Mon 07:00');
    expect(openNowLine({ open: false }, t)).toBe('Closed this week');
    // A hub that keeps no hours is not said to be closed: nothing is said at all.
    expect(openNowLine(undefined, t)).toBeNull();
  });

  it('hands a number to the phone app as digits with a leading +, whatever spaces or dashes it was written with', () => {
    expect(telOf('+254 712 345-678')).toBe('tel:+254712345678');
    expect(telOf('(020) 123 4567')).toBe('tel:0201234567');
    // Nothing but digits and + reaches the link: no letters, no second scheme.
    expect(telOf('javascript:alert(1)')).toBe('tel:1');
  });
});
