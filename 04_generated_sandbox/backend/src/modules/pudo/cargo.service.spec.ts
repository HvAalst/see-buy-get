import { CargoService } from './cargo.service';
import { CARGO_NATURES, CargoClass, COMPAT_MATRIX } from './cargo.types';

describe('CargoService — cargo classification + the incompatibility matrix (S30)', () => {
  const cargo = new CargoService();

  describe('classification by weight + dimensions', () => {
    it('maps weight bands to classes P0–P6', () => {
      const cases: Array<[number, CargoClass]> = [
        [1, 'P0'], [2, 'P0'], [2.1, 'P1'], [15, 'P1'], [16, 'P2'], [30, 'P2'],
        [31, 'P3'], [80, 'P3'], [81, 'P4'], [250, 'P4'], [251, 'P5'], [1000, 'P5'], [1001, 'P6'], [5000, 'P6'],
      ];
      for (const [kg, cls] of cases) expect(cargo.classify({ kg })).toBe(cls);
    });

    it('takes the HIGHER of the weight class and the dimensional class (light-but-oversized is oversized)', () => {
      // 1 kg is P0 by weight, but a 3 m beam blows past every parcel dimension (incl. P5's 2.2 m) → P6 by size.
      expect(cargo.classify({ kg: 1, dimsCm: [300, 20, 20] })).toBe('P6');
      // 1 kg in a 50×50×50 box: weight P0, dims exceed P0/P1 → P2 (fits 100×60×60).
      expect(cargo.classify({ kg: 1, dimsCm: [50, 50, 50] })).toBe('P2');
      // weight dominates when dims are small: 40 kg in a shoebox is still P3.
      expect(cargo.classify({ kg: 40, dimsCm: [20, 20, 10] })).toBe('P3');
    });

    it('falls back to the weight band when dimensions are absent', () => {
      expect(cargo.classify({ kg: 10 })).toBe('P1');
    });
  });

  describe('lane eligibility + the dedicated-transport gate', () => {
    it('routes P0–P1 to PUDO, P2–P3 to MDP, P4–P6 to dedicated', () => {
      expect(cargo.laneFor('P0')).toBe('pudo');
      expect(cargo.laneFor('P1')).toBe('pudo');
      expect(cargo.laneFor('P2')).toBe('mdp');
      expect(cargo.laneFor('P3')).toBe('mdp');
      expect(cargo.laneFor('P4')).toBe('dedicated');
      expect(cargo.laneFor('P6')).toBe('dedicated');
    });

    it('flags exactly P4–P6 as needing dedicated transport', () => {
      expect(['P0', 'P1', 'P2', 'P3'].every((c) => !cargo.dedicatedRequired(c as CargoClass))).toBe(true);
      expect(['P4', 'P5', 'P6'].every((c) => cargo.dedicatedRequired(c as CargoClass))).toBe(true);
    });
  });

  describe('the incompatibility matrix', () => {
    it('is symmetric across every pair', () => {
      for (const a of CARGO_NATURES) {
        for (const b of CARGO_NATURES) {
          expect(COMPAT_MATRIX[a][b]).toBe(COMPAT_MATRIX[b][a]);
        }
      }
    });

    it('never lets cement dust share a vehicle with fresh produce (the headline rule)', () => {
      expect(cargo.check('HAZ-DUST', 'FOP')).toBe('INCOMPATIBLE');
      expect(cargo.canShareVehicle('HAZ-DUST', 'FOP')).toBe(false);
      expect(cargo.canShareVehicle('FOP', 'HAZ-DUST')).toBe(false); // symmetric
    });

    it('encodes the worked examples from the spec', () => {
      expect(cargo.check('HAZ-FLAM', 'GEN')).toBe('INCOMPATIBLE'); // LPG + blankets
      expect(cargo.check('ODR', 'GEN')).toBe('SEGREGATE'); // perfume + general dry: separable
      expect(cargo.check('FRG', 'FRG')).toBe('OK'); // fragile + fragile
      expect(cargo.check('GEN', 'GEN')).toBe('OK');
      expect(cargo.check('HUM', 'HUM')).toBe('OK');
      expect(cargo.check('FOP', 'HUM')).toBe('SEGREGATE'); // vaccines + fresh veg: separable, priority-monitored
    });

    it('treats every hazardous class as incompatible with all non-matching cargo', () => {
      const haz = ['HAZ-CHEM', 'HAZ-DUST', 'HAZ-BIO', 'HAZ-FLAM'] as const;
      for (const h of haz) {
        for (const other of CARGO_NATURES) {
          if (h === other && h === 'HAZ-CHEM') continue; // chem+chem = SEGREGATE (sub-matrix, spec **)
          if (h === other) continue; // self-pairing handled per class
          expect(cargo.check(h, other)).toBe('INCOMPATIBLE');
        }
      }
    });

    it('SEGREGATE passes at parcel granularity (each parcel is its own sealed container)', () => {
      // ODR × GEN is SEGREGATE, so two such parcels MAY share a vehicle (only INCOMPATIBLE blocks).
      expect(cargo.canShareVehicle('ODR', 'GEN')).toBe(true);
      expect(cargo.canShareVehicle('GEN', 'GEN')).toBe(true);
    });

    it('applies the softer, practical prose values where the spec table was over-strict', () => {
      // Odorous goods may ride with food when each is its own sealed package (perfume + tea/produce).
      expect(cargo.check('ODR', 'FOD')).toBe('SEGREGATE');
      expect(cargo.canShareVehicle('ODR', 'FOP')).toBe(true);
      // Same-class hazmat consolidates: two cement bags (a DUST LOAD), two gas cylinders on a hazmat truck.
      expect(cargo.check('HAZ-DUST', 'HAZ-DUST')).toBe('SEGREGATE');
      expect(cargo.check('HAZ-FLAM', 'HAZ-FLAM')).toBe('SEGREGATE');
      // …but biologicals stay a dedicated-container class — even two HAZ-BIO items never share.
      expect(cargo.check('HAZ-BIO', 'HAZ-BIO')).toBe('INCOMPATIBLE');
      expect(cargo.canShareVehicle('HAZ-BIO', 'HAZ-BIO')).toBe(false);
    });
  });

  describe('nature → required vehicle capability', () => {
    it('requires a cold chain for perishables and hazmat for hazardous chemical/bio/flammable', () => {
      expect(cargo.requiredCapability('FOP')).toBe('coldChain');
      expect(cargo.requiredCapability('HAZ-CHEM')).toBe('hazmat');
      expect(cargo.requiredCapability('HAZ-BIO')).toBe('hazmat');
      expect(cargo.requiredCapability('HAZ-FLAM')).toBe('hazmat');
    });

    it('requires no special vehicle for dust (a closed body suffices — its risk is contamination) or general goods', () => {
      expect(cargo.requiredCapability('HAZ-DUST')).toBeNull();
      expect(cargo.requiredCapability('GEN')).toBeNull();
      expect(cargo.requiredCapability('FOD')).toBeNull();
    });
  });

  describe('required equipment per class', () => {
    it('escalates from manual handling to powered lifting as the class grows', () => {
      expect(cargo.requiredEquipment('P0')).toEqual(['MAN']);
      expect(cargo.requiredEquipment('P3')).toContain('HTR');
      expect(cargo.requiredEquipment('P6')).toEqual(expect.arrayContaining(['CRN', 'FLT']));
    });
  });
});
