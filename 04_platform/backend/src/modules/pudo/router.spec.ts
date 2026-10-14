import { HeuristicRouter } from './router';
import { haversineKm } from './geo';
import { ROAD_CIRCUITY_FACTOR } from './pudo.config';

describe('HeuristicRouter — road distance / ETA / detour (G2)', () => {
  const r = new HeuristicRouter();
  const nairobi = { lat: -1.2864, lng: 36.8172 };
  const kisumu = { lat: -0.0917, lng: 34.768 };

  it('roadKm inflates the great circle by the circuity factor (roads are longer than the crow flies)', () => {
    expect(r.roadKm(nairobi, kisumu)).toBeCloseTo(haversineKm(nairobi, kisumu) * ROAD_CIRCUITY_FACTOR, 6);
    expect(r.roadKm(nairobi, kisumu)).toBeGreaterThan(haversineKm(nairobi, kisumu));
    expect(r.roadKm(nairobi, nairobi)).toBe(0);
  });

  it('etaMinutes derives from the road distance and speed, floored at 1 minute', () => {
    const km = r.roadKm(nairobi, kisumu);
    expect(r.etaMinutes(nairobi, kisumu, 60)).toBe(Math.max(1, Math.round((km / 60) * 60)));
    expect(r.etaMinutes(nairobi, nairobi, 60)).toBe(1);
  });

  it('etaMinutes guards a zero / NaN speed instead of dividing by it', () => {
    expect(r.etaMinutes(nairobi, kisumu, 0)).toBeGreaterThan(0);
    expect(r.etaMinutes(nairobi, kisumu, NaN)).toBeGreaterThan(0);
  });

  it('detourKm is 0 for a pickup on the route and positive for a backtrack', () => {
    expect(r.detourKm(nairobi, nairobi, kisumu)).toBe(0); // p == a → no diversion
    const wayOff = { lat: 1.0, lng: 40.0 };
    expect(r.detourKm(nairobi, wayOff, kisumu)).toBeGreaterThan(0);
  });
});
