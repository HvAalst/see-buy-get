import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { pointOf, shiftDay, useLines, weekEnding } from './sites';

const none = { vehicles: 1, daysOut: 0, daysOffRoad: 0, daysIdle: 0, shifts: 0, hoursOnShift: 0, loads: 0, kgDelivered: 0, loadedKm: 0, emptyKm: 0, runs: 0, runKg: 0 };

describe('a fleet’s sites, in words', () => {
  it('reads a point typed as latitude and longitude, and nothing else', () => {
    expect(pointOf('-4.0435, 39.6301')).toEqual({ lat: -4.0435, lng: 39.6301 });
    expect(pointOf('-4.0435 39.6301')).toEqual({ lat: -4.0435, lng: 39.6301 });
    expect(pointOf('Mombasa')).toBeNull();
    expect(pointOf('95, 39')).toBeNull();
  });

  it('shows a week ending on a day, and moves by days without a clock change moving it', () => {
    expect(weekEnding('2026-10-16')).toEqual({ from: '2026-10-10', to: '2026-10-16' });
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('says how a vehicle was used from what was recorded — km only where readings were given, the loaded share only where loads were', () => {
    const used = { ...none, daysOut: 4, daysOffRoad: 1, daysIdle: 2, shifts: 5, hoursOnShift: 31.4, km: 812, loads: 9, kgDelivered: 18000, loadedKm: 360, emptyKm: 140, runs: 1, runKg: 6000 };
    expect(useLines(used, 7, t)).toEqual([
      'Out 4 of 7 days · 31 h on shift, 5 shifts',
      `${(812).toLocaleString()} km driven · 9 loads delivered, ${(18000).toLocaleString()} kg · 72% of the km to and with loads ran loaded · 1 run, ${(6000).toLocaleString()} kg booked`,
      '1 day off the road · 2 days idle',
    ]);
    expect(useLines({ ...none, daysIdle: 7 }, 7, t)).toEqual(['Out 0 of 7 days · 0 h on shift, 0 shifts', 'Nothing carried', '7 days idle']);
    // A site of three vehicles over a week has twenty-one days it could have gone out.
    expect(useLines({ ...none, vehicles: 3, daysOut: 5 }, 7, t)[0]).toBe('Out 5 of 21 vehicle-days · 0 h on shift, 0 shifts');
  });
});
