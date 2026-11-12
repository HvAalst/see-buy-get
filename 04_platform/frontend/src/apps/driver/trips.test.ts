import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { nextWords, tripBodies, tripDaysWords } from './trips';

/*
 * 2026-11-12 — SAVED TRIPS (the owner: "driving route a to b monday to saturday from 5:30 AM and from b to a monday to
 * saturday from 16:00 PM"): what the Driver app says of a trip, and what it sends to save one and the one back.
 */
describe('a saved trip, said and sent', () => {
  it('says its days short, Sunday first', () => {
    expect(tripDaysWords([1, 2, 3, 4, 5, 6], t, 'driver.trips')).toBe('Mon–Sat');
    expect(tripDaysWords([5, 1, 3], t, 'driver.trips')).toBe('Mon, Wed, Fri');
    expect(tripDaysWords([0, 1, 2, 3, 4, 5, 6], t, 'driver.trips')).toBe('Every day');
    expect(tripDaysWords([0, 6], t, 'driver.trips')).toBe('Sun, Sat');
  });
  it('says when it next runs: today, tomorrow, or its weekday', () => {
    expect(nextWords({ day: '2026-11-12', clock: '16:00' }, '2026-11-12', t, 'driver.trips')).toBe('today at 16:00');
    expect(nextWords({ day: '2026-11-13', clock: '05:30' }, '2026-11-12', t, 'driver.trips')).toBe('tomorrow at 05:30');
    expect(nextWords({ day: '2026-11-16', clock: '05:30' }, '2026-11-12', t, 'driver.trips')).toBe('Mon 16 at 05:30');
    expect(nextWords(undefined, '2026-11-12', t, 'driver.trips')).toBeNull();
  });
  it('sends A → B, and B → A on the same days where a time back is given; nothing until complete', () => {
    const a = { label: 'Nairobi', lat: -1.286, lng: 36.817 };
    const b = { label: 'Nakuru', lat: -0.303, lng: 36.08 };
    expect(tripBodies(a, b, [6, 1, 2, 3, 4, 5], '05:30', '', 'Africa/Nairobi')).toEqual([
      { days: [1, 2, 3, 4, 5, 6], zone: 'Africa/Nairobi', fromLabel: 'Nairobi', fromLat: -1.286, fromLng: 36.817, toLabel: 'Nakuru', toLat: -0.303, toLng: 36.08, startTime: '05:30' },
    ]);
    const both = tripBodies(a, b, [1, 2, 3, 4, 5, 6], '05:30', '16:00', undefined, ' Morning run ')!;
    expect(both).toHaveLength(2);
    expect(both[0]).toMatchObject({ name: 'Morning run', fromLabel: 'Nairobi', startTime: '05:30' });
    expect(both[1]).toMatchObject({ fromLabel: 'Nakuru', toLabel: 'Nairobi', startTime: '16:00', days: [1, 2, 3, 4, 5, 6] });
    expect(both[1]).not.toHaveProperty('name');
    expect(tripBodies(a, b, [], '05:30', '', undefined)).toBeNull();
    expect(tripBodies(a, b, [1], '5:30', '', undefined)).toBeNull();
    expect(tripBodies(a, b, [1], '05:30', '4pm', undefined)).toBeNull();
    expect(tripBodies(undefined, b, [1], '05:30', '', undefined)).toBeNull();
  });
});
