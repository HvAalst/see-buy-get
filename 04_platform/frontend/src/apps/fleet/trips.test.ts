import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { nextWords, tripDaysWords } from '../driver/trips';
import { fleetTripBodies } from './screens/FleetTripsCard';

/*
 * 2026-11-12 — A FLEET'S TRIPS (the owner: "as a general option, also for a fleet"): what the Fleet app's form sends — its
 * driver, its vehicle, the days and the time, the trip back, and the space for sale on the way there.
 */
describe('a fleet’s trip, as the form sends it', () => {
  const form = { driverDid: 'did:amos', vehicleId: 'veh_1', from: { label: 'Depot', pin: { lat: -1.3, lng: 36.85 } }, to: { label: 'Nakuru', pin: { lat: -0.3, lng: 36.08 } }, days: [6, 1, 2, 3, 4, 5], time: '05:30', back: '', sell: false, corridorId: 'cor_1', capacityKg: '', basis: 'per_trip', amount: '' };
  it('sends the trip for its driver in its vehicle, the days in order; the trip back only where a time is given', () => {
    expect(fleetTripBodies(form)).toEqual([{ driverDid: 'did:amos', vehicleId: 'veh_1', days: [1, 2, 3, 4, 5, 6], fromLabel: 'Depot', fromLat: -1.3, fromLng: 36.85, toLabel: 'Nakuru', toLat: -0.3, toLng: 36.08, startTime: '05:30' }]);
    const both = fleetTripBodies({ ...form, back: '16:00' })!;
    expect(both[1]).toMatchObject({ fromLabel: 'Nakuru', toLabel: 'Depot', startTime: '16:00' });
  });
  it('sells space on the way there only, on a line, with a price — never without a vehicle', () => {
    const sold = fleetTripBodies({ ...form, sell: true, amount: '12,5', capacityKg: '2000', basis: 'per_kg', back: '16:00' })!;
    expect(sold[0].sell).toEqual({ corridorId: 'cor_1', basis: 'per_kg', amount: 12.5, capacityKg: 2000 });
    expect(sold[1]).not.toHaveProperty('sell');
    expect(fleetTripBodies({ ...form, sell: true, amount: '' })).toBeNull();
    expect(fleetTripBodies({ ...form, sell: true, amount: '10', vehicleId: '' })).toBeNull();
    expect(fleetTripBodies({ ...form, sell: true, amount: '10', corridorId: '' })).toBeNull();
  });
  it('sends nothing until it is complete', () => {
    expect(fleetTripBodies({ ...form, driverDid: '' })).toBeNull();
    expect(fleetTripBodies({ ...form, to: { label: 'Nakuru', pin: null } })).toBeNull();
    expect(fleetTripBodies({ ...form, days: [] })).toBeNull();
    expect(fleetTripBodies({ ...form, time: '25:00' })).toBeNull();
  });
  it('says its days and its next run in the Fleet app’s own words', () => {
    expect(tripDaysWords([1, 2, 3, 4, 5, 6], t, 'fleet.trips')).toBe('Mon–Sat');
    expect(nextWords({ day: '2026-11-13', clock: '05:30' }, '2026-11-12', t, 'fleet.trips')).toBe('tomorrow at 05:30');
  });
});
