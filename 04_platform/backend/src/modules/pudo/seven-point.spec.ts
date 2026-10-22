import { CLOSED_BODIES, CONTAINER_BODIES, inspectionAsked, INSPECTION_POINTS, requireInspection } from './seven-point';
import { TRUCK_SUBTYPES } from './fleet.config';

/**
 * Round 40 — THE 7-POINT INSPECTION (the user: "Cross-border closed loads"): which loads are inspected, and what "done" is.
 */
describe('the 7-point inspection', () => {
  const abroad = { pickupCountry: 'KE', destCountry: 'UG' };
  const home = { pickupCountry: 'KE', destCountry: 'KE' };

  describe('which loads', () => {
    it('a closed body leaving for a border: the body', () => {
      expect(inspectionAsked(abroad, { vehicleClass: 'truck', truckSubtype: 'box' })).toBe('closed');
      expect(inspectionAsked(abroad, { vehicleClass: 'truck', truckSubtype: 'refrigerated' })).toBe('closed');
      expect(inspectionAsked(abroad, { vehicleClass: 'truck', truckSubtype: 'semi_trailer' })).toBe('closed');
      expect(inspectionAsked(abroad, { vehicleClass: 'van' })).toBe('closed');
    });

    it('a container leg leaving for a border: the container — by its number, or by what carries it', () => {
      expect(inspectionAsked({ ...abroad, containerNo: 'MSKU1234565' }, { vehicleClass: 'truck', truckSubtype: 'flatbed' })).toBe('container');
      expect(inspectionAsked({ ...abroad, containerNo: 'MSKU1234565' }, undefined)).toBe('container');
      expect(inspectionAsked(abroad, { vehicleClass: 'truck', truckSubtype: 'skeletal' })).toBe('container');
    });

    it('nothing asked of a load that stays in its country, whatever carries it', () => {
      expect(inspectionAsked(home, { vehicleClass: 'truck', truckSubtype: 'box' })).toBeUndefined();
      expect(inspectionAsked({ ...home, containerNo: 'MSKU1234565' }, { vehicleClass: 'truck', truckSubtype: 'skeletal' })).toBeUndefined();
      expect(inspectionAsked({ pickupCountry: 'KE' }, { vehicleClass: 'van' })).toBeUndefined(); // a destination nobody named is not a border
    });

    it('nothing asked of an open body, a tank, or a small vehicle', () => {
      for (const truckSubtype of ['flatbed', 'dropside', 'tipper', 'tanker', 'fuel_tanker', 'lowboy', 'car_carrier']) expect(inspectionAsked(abroad, { vehicleClass: 'truck', truckSubtype })).toBeUndefined();
      for (const vehicleClass of ['bike', 'motorcycle', 'tuktuk', 'car']) expect(inspectionAsked(abroad, { vehicleClass })).toBeUndefined();
      expect(inspectionAsked(abroad, undefined)).toBeUndefined();
    });

    it('names only bodies that exist', () => {
      for (const b of [...CLOSED_BODIES, ...CONTAINER_BODIES]) expect(TRUCK_SUBTYPES).toContain(b);
    });
  });

  describe('done', () => {
    const all = INSPECTION_POINTS.map((point, i) => ({ point, photoRef: `med_${i}` }));
    const refusal = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        const r = (e as { getResponse(): { code: string; detail: string; params?: { missing?: string[] } } }).getResponse();
        return { code: r.code, detail: r.detail, missing: r.params?.missing };
      }
      return null;
    };

    it('is seven points, walked in order: front wall, the sides, floor, roof, doors, undercarriage', () => {
      expect(INSPECTION_POINTS).toEqual(['front_wall', 'left_side', 'right_side', 'floor', 'roof', 'doors', 'undercarriage']);
      expect(requireInspection('closed', [...all].reverse()).map((p) => p.point)).toEqual([...INSPECTION_POINTS]);
    });

    it('says which points are left', () => {
      expect(refusal(() => requireInspection('container', undefined))).toMatchObject({ code: 'INSPECTION_INCOMPLETE', missing: [...INSPECTION_POINTS] });
      const r = refusal(() => requireInspection('closed', all.filter((p) => p.point !== 'roof' && p.point !== 'undercarriage')))!;
      expect(r).toMatchObject({ code: 'INSPECTION_INCOMPLETE', missing: ['roof', 'undercarriage'] });
      expect(r.detail).toBe('The body is looked over at seven points, each photographed, before a load that crosses a border is taken over. Not done yet: the roof, the outside and the undercarriage.');
    });

    it('counts a point without its photograph as not done', () => {
      expect(refusal(() => requireInspection('closed', all.map((p) => (p.point === 'floor' ? { ...p, photoRef: ' ' } : p))))).toMatchObject({ missing: ['floor'] });
    });

    it('wants each point on its own photograph, and none of them the securement photo', () => {
      expect(refusal(() => requireInspection('closed', all.map((p) => ({ ...p, photoRef: 'med_same' }))))?.code).toBe('INSPECTION_INCOMPLETE');
      expect(refusal(() => requireInspection('closed', all, ['med_3']))?.detail).toMatch(/none is the photo of the secured load/);
      expect(requireInspection('closed', all, ['med_secured'])).toHaveLength(7);
    });

    it('knows no eighth point', () => {
      expect(refusal(() => requireInspection('closed', [...all, { point: 'engine', photoRef: 'med_9' }]))?.code).toBe('VALIDATION_FAILED');
    });
  });
});
