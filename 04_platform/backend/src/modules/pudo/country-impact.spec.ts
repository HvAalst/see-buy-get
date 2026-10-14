import { countryImpactOf } from './country-impact';

/**
 * CA9 — what lowering or closing a country leaves behind. The failure worth a test: a move that looks like a
 * setting change while parcels sit on shelves under our promise and suppliers are still owed.
 */
describe('what winding a country down leaves behind', () => {
  const base = {
    jurisdiction: 'ZM',
    toLevel: 'observed' as const,
    lost: ['takeIn' as const],
    gained: [],
    shops: [
      { did: 'shop-zm', country: 'ZM' },
      { did: 'shop-ke', country: 'KE' },
    ],
    parcels: [
      { status: 'At_PUDO', originAgentDid: 'shop-zm', takeInPromise: 'theirs' as const },
      { status: 'Ready_For_Pickup', destAgentDid: 'shop-zm', takeInPromise: 'ours' as const },
      { status: 'Unclaimed', destAgentDid: 'shop-zm' },
      { status: 'On_Bus', destAgentDid: 'shop-zm' },
      { status: 'Delivered', destAgentDid: 'shop-zm' },
      { status: 'At_PUDO', originAgentDid: 'shop-ke' },
    ],
    stores: [{ country: 'ZM' }, { country: 'KE' }],
    hubs: [{ did: 'hub-zm', country: 'ZM' }],
    fleets: [{ did: 'fleet-zm', jurisdiction: 'ZM' }],
    couriers: [
      { did: 'courier-zm', jurisdiction: 'ZM' },
      { did: 'driver-of-fleet', managerDid: 'fleet-zm' },
    ],
    freight: [
      { status: 'available', pickupCountry: 'ZM', destCountry: 'KE' },
      { status: 'claimed', pickupCountry: 'TZ', destCountry: 'ZM' },
      { status: 'delivered', pickupCountry: 'ZM', destCountry: 'ZM' },
      { status: 'available' },
    ],
    payables: [
      { entityId: 'sbg-ke', name: 'SeeBuyGet Kenya', currency: 'KES', outstanding: [{ counterparty: 'shop-zm', amount: 120 }, { counterparty: 'fleet-zm', amount: 80.5 }, { counterparty: 'shop-ke', amount: 999 }] },
      { entityId: 'sbg-et', name: 'SeeBuyGet Ethiopia', currency: 'ETB', outstanding: [{ counterparty: 'shop-ke', amount: 10 }] },
    ],
  };

  it('counts what sits on shelves there, and under whose promise', () => {
    const impact = countryImpactOf(base);
    expect(impact.shelves).toEqual({ total: 3, ours: 1, theirs: 1, unstamped: 1 });
    expect(impact.inTransit).toBe(1);
    expect(impact.closing).toBe(true);
  });

  it('counts the loads that start or end there, and never guesses a country for one with none', () => {
    expect(countryImpactOf(base).freight).toEqual({ open: 1, claimed: 1 });
  });

  it('shows what our companies still owe suppliers there — owed stays owed', () => {
    expect(countryImpactOf(base).owed).toEqual([{ entityId: 'sbg-ke', name: 'SeeBuyGet Kenya', currency: 'KES', amount: 200.5, suppliers: 2 }]);
  });

  it('counts who is registered there, a fleet’s own drivers with their fleet', () => {
    expect(countryImpactOf(base).registered).toEqual({ shops: 1, stores: 1, hubs: 1, fleets: 1, couriers: 1 });
  });

  it('says nothing is closing when goods may still be taken in', () => {
    expect(countryImpactOf({ ...base, toLevel: 'matched', lost: ['claims'] }).closing).toBe(false);
  });
});
