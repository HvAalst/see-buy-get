import { DepartureService } from './departure.service';

/**
 * F3 — SELLING SPACE ON A RUN THAT IS HAPPENING ANYWAY.
 *
 * The two rules worth holding are not arithmetic, and both came from the user.
 *
 * A TRUCK IS NOT A NUMBER OF KILOGRAMS. Ship tempex 300 km and it weighs almost nothing while filling the
 * hold; ship steel and the weight runs out with the hold half empty. A departure declares both axes and a
 * booking takes whichever it actually fills.
 *
 * AND THE PRICE BASIS IS DECLARED. Per kilogram is the basis an engineer reaches for first and the one
 * that loses money on exactly the loads that fill a truck — so the fleet says whether it sells the trip,
 * the distance, the hours, or the weight, and the code only applies it.
 *
 * These two are tested as the pure functions they are; the service's own guards are tested through it.
 */
describe('what a departure charges, and what fills it', () => {
  describe('the price basis, which is not one answer', () => {
    const load = { weightKg: 40, km: 300, hours: 2.5 };

    it('prices a whole trip as a trip, whatever is in the back', () => {
      expect(DepartureService.priceOf({ basis: 'per_trip', amount: 450 }, load)).toEqual({ price: 450, units: 1 });
      // The honest default for a scheduled line: the run costs what the run costs.
      expect(DepartureService.priceOf({ basis: 'per_trip', amount: 450 }, { ...load, weightKg: 4000 })).toEqual({ price: 450, units: 1 });
    });

    it('prices distance on the line’s own kilometres', () => {
      expect(DepartureService.priceOf({ basis: 'per_km', amount: 1.2 }, load)).toEqual({ price: 360, units: 300 });
    });

    it('prices time on the hours, for the work where the clock is the cost', () => {
      // City work, waiting, a tail-lift and two flights of stairs: nothing about the cargo says that.
      expect(DepartureService.priceOf({ basis: 'per_hour', amount: 60 }, load)).toEqual({ price: 150, units: 2.5 });
    });

    it('prices weight where weight really is the cost — and THAT IS THE ONE THAT LOSES MONEY ON FOAM', () => {
      /*
       * The user's own example. A pallet of tempex going 300 km weighs 40 kg and fills the truck. Priced
       * by the kilo the fleet earns 24 for a day's diesel and a driver; priced by the trip, 450. Both are
       * computed here, and the difference is the reason the basis is the fleet's to declare.
       */
      expect(DepartureService.priceOf({ basis: 'per_kg', amount: 0.6 }, load).price).toBe(24);
      expect(DepartureService.priceOf({ basis: 'per_trip', amount: 450 }, load).price).toBe(450);
    });

    it('never goes below the floor, because stopping and strapping down is the expensive part', () => {
      // A 40 kg booking at 0.6/kg is 24; a carrier who opened the back has already spent more than that.
      expect(DepartureService.priceOf({ basis: 'per_kg', amount: 0.6, minCharge: 80 }, load).price).toBe(80);
      // And the floor never RAISES a price that already cleared it.
      expect(DepartureService.priceOf({ basis: 'per_kg', amount: 0.6, minCharge: 10 }, load).price).toBe(24);
    });
  });

  describe('which axis fills the truck', () => {
    // Six tonnes and forty cubic metres — an ordinary box body.
    const truck = { capacityKg: 6000, capacityM3: 40 };

    it('says SPACE for the load that is all air, which is the whole point', () => {
      // A pallet of tempex: nothing on the scale, half the hold.
      const foam = DepartureService.bindsOn(truck, { weightKg: 40, volumeM3: 20 });
      expect(foam.binds).toBe('space');
      expect(foam.shareM3).toBeGreaterThan(foam.shareKg);
    });

    it('says WEIGHT for the load that is all mass', () => {
      // Three tonnes of steel in two cubic metres.
      expect(DepartureService.bindsOn(truck, { weightKg: 3000, volumeM3: 2 }).binds).toBe('weight');
    });

    it('falls back to weight when the two cannot be compared, rather than claiming room', () => {
      // No hold declared: there is nothing to compare a volume against.
      expect(DepartureService.bindsOn({ capacityKg: 6000 }, { weightKg: 40, volumeM3: 20 }).binds).toBe('weight');
      // Hold declared, load unmeasured: same answer, and the booking records it so nobody reads it as roomy.
      expect(DepartureService.bindsOn(truck, { weightKg: 40 }).binds).toBe('weight');
    });
  });
});
