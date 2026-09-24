import { DepartureService } from './departure.service';
import { RATE_BASES } from './departure.types';

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
    const load = { weightKg: 40, km: 300 };

    it('prices a whole trip as a trip, whatever is in the back', () => {
      expect(DepartureService.priceOf({ basis: 'per_trip', amount: 450 }, load)).toEqual({ price: 450, units: 1 });
      // The honest default for a scheduled line: the run costs what the run costs.
      expect(DepartureService.priceOf({ basis: 'per_trip', amount: 450 }, { ...load, weightKg: 4000 })).toEqual({ price: 450, units: 1 });
    });

    it('prices distance on the line’s own kilometres', () => {
      expect(DepartureService.priceOf({ basis: 'per_km', amount: 1.2 }, load)).toEqual({ price: 360, units: 300 });
    });

    it('has no hourly basis at all, because a planned run is quoted before it leaves', () => {
      /*
       * `per_hour` was here and was wrong. A departure leaves at a stated time and runs a known distance,
       * so the driver names the price up front and the shipper agrees before anything moves — neither side
       * could sign an hourly number, because neither knows it until it is over. (The user, 2026-09-24.)
       *
       * Asserted as an ABSENCE rather than left as a silent deletion: the mistake is the intuitive one, and
       * the next person to reach for it should find this test rather than an empty space.
       */
      expect(RATE_BASES).toEqual(['per_trip', 'per_km', 'per_kg']);
      expect(RATE_BASES).not.toContain('per_hour');
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

  /**
   * WAITING TIME — the user's correction, and the reason `per_hour` came out of the basis list.
   *
   * *"It happens pretty often that a truck comes at an appointed time for loading and is then told to wait.
   * It is usually acceptable that the place where the delay happens has to pay for the waiting time."*
   *
   * The trip price never moves; this is the separate clock, and the free window is what makes it fair.
   */
  describe('what a wait costs', () => {
    // An hour of loading is simply the job; after that the driver's day is being spent.
    const terms = { freeMin: 60, perHour: 40 };

    it('charges nothing while the wait is still an ordinary one', () => {
      expect(DepartureService.waitingCharge(terms, 45)).toEqual({ billableMin: 0, amount: 0 });
      // And not a cent at the boundary: sixty minutes is what the fleet said loading may take.
      expect(DepartureService.waitingCharge(terms, 60)).toEqual({ billableMin: 0, amount: 0 });
    });

    it('charges only the minutes past the free window, never the whole wait', () => {
      // Ninety minutes on site, thirty of them billable: half an hour at 40.
      expect(DepartureService.waitingCharge(terms, 90)).toEqual({ billableMin: 30, amount: 20 });
    });

    it('is pro rata by the minute, so nearly-on-time is not billed as an hour', () => {
      /*
       * Eleven minutes over. Per STARTED hour — what much of the trade does — this is a full 40, the same
       * as the shipper who kept the truck an extra hour. That rounding is what turns a fair rule into a
       * grievance, so it is deliberately not done here.
       */
      expect(DepartureService.waitingCharge(terms, 71).amount).toBeCloseTo(7.33, 2);
      expect(DepartureService.waitingCharge(terms, 71).amount).toBeLessThan(terms.perHour);
    });

    it('charges nothing at all where the fleet never published a waiting rate', () => {
      // Absent terms mean FREE, not "unlimited and unspoken": nobody agreed to a clock nobody was shown.
      expect(DepartureService.waitingCharge(undefined, 600)).toEqual({ billableMin: 0, amount: 0 });
      expect(DepartureService.waitingCharge({ freeMin: 0, perHour: 0 }, 600)).toEqual({ billableMin: 0, amount: 0 });
    });

    it('bills from minute one where the fleet allowed no free time, and that is the fleet SAYING so', () => {
      // Legal, and visible to the shipper before they book — which is the whole reason the terms ride on the offer.
      expect(DepartureService.waitingCharge({ freeMin: 0, perHour: 60 }, 30)).toEqual({ billableMin: 30, amount: 30 });
    });
  });
});
