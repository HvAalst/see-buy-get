import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { findingWords } from '../../shared/tamper';
import { inspectionBody, inspectionDone, inspectionPoints, inspectionReady, POINT_KEYS, type InspectionLook } from './inspection';

/**
 * Round 40 — THE 7-POINT INSPECTION on the Driver app (the user: "Cross-border closed loads"): shown only when the load asks
 * for it; the pickup waits until each point is ticked with its own photograph; and what it sends is each point with its photo.
 */
describe('the 7-point inspection on the Driver app', () => {
  const POINTS = ['front_wall', 'left_side', 'right_side', 'floor', 'roof', 'doors', 'undercarriage'];
  const asks = { inspection: { kind: 'closed' as const, points: POINTS } };
  const all = (over: Partial<Record<string, InspectionLook>> = {}) => Object.fromEntries(POINTS.map((p, i) => [p, over[p] ?? { ticked: true, photo: `med_${i}` }])) as Record<string, InspectionLook>;

  it('asks nothing of a load that does not ask for it', () => {
    expect(inspectionReady({}, {})).toBe(true);
    expect(inspectionBody({}, {})).toBeUndefined();
    expect(inspectionPoints(null)).toEqual([]);
  });

  it('waits for every point: ticked, and with its photograph', () => {
    expect(inspectionReady(asks, {})).toBe(false);
    expect(inspectionReady(asks, all())).toBe(true);
    expect(inspectionReady(asks, all({ roof: { ticked: false, photo: 'med_4' } }))).toBe(false);
    expect(inspectionReady(asks, all({ roof: { ticked: true, photo: '' } }))).toBe(false);
    expect(inspectionDone(asks, all({ roof: { ticked: true, photo: '' } }))).toBe(6);
  });

  it('wants each point on its own photograph', () => {
    expect(inspectionReady(asks, all({ roof: { ticked: true, photo: 'med_0' } }))).toBe(false);
  });

  it('sends each point with its photograph, in the order the server gave', () => {
    expect(inspectionBody(asks, all())).toEqual(POINTS.map((point, i) => ({ point, photoRef: `med_${i}` })));
  });

  it('leaves out a point this build does not know, rather than guessing what it is called', () => {
    expect(inspectionPoints({ inspection: { kind: 'container', points: [...POINTS, 'engine'] } })).toEqual(POINTS);
  });

  it('names every point and what to look for there, and the finding when something is found', () => {
    for (const p of POINTS) {
      const k = POINT_KEYS[p as keyof typeof POINT_KEYS];
      expect(t(k.label)).not.toBe(k.label);
      expect(t(k.look)).not.toBe(k.look);
    }
    expect(findingWords('inspection_failed', t)).toMatch(/^the 7-point inspection found something/);
  });
});
