import { TransitAuthorityService, transitRefusal } from './transit-authority.service';

/**
 * BL1 — THE GATE ON AN UNCLEARED LOAD, calling the rule rather than restating it.
 *
 * The first draft of this spec copied the refusal logic into the test file, which would have proved
 * nothing: a test that builds its own expectation tests itself. It calls `transitRefusal` now, which is
 * the same function DispatchService calls at every point a load is taken.
 *
 * The other half of the lesson is in the service. `bondRefusal` originally read `bonded` off the
 * `Claimable` wrapper — and `wrapFreight` builds that wrapper field by field and did not copy it. The
 * gate was dead, and nothing failed. It reads the freight record now, because a record cannot forget to
 * copy a field to itself.
 */
describe('a bonded leg is refused to a carrier without the authority', () => {
  const NOW = Date.parse('2026-06-01T08:00:00.000Z');
  const bondedLeg = { bonded: true, bondCountry: 'ET', pickupCountry: 'ET' };

  /** Exactly how the service composes it: the rule, over the service that answers the question. */
  const refusalFor = (transit: TransitAuthorityService, carrierDid: string, load: Parameters<typeof transitRefusal>[0]) =>
    transitRefusal(load, (country) => transit.permits(carrierDid, country, NOW));

  const licensed = (country: string, expiresAt = '2026-12-31') => {
    const transit = new TransitAuthorityService();
    transit.declare({ carrierDid: 'fleet-a', country, reference: `${country}-TR-1`, expiresAt }, 'Hans', NOW);
    return transit;
  };

  it('refuses a carrier with nothing on record, and names the country they need it for', () => {
    const refusal = refusalFor(new TransitAuthorityService(), 'fleet-a', bondedLeg);
    expect(refusal?.code).toBe('NO_TRANSIT_AUTHORITY');
    // The sentence has to be actionable: "you need one for ET" is a thing somebody can go and get.
    expect(refusal?.message).toContain('ET');
    expect(refusal?.message).toContain('has not been cleared');
  });

  it('lets the licensed carrier take it, and nobody else', () => {
    const transit = licensed('ET');
    expect(refusalFor(transit, 'fleet-a', bondedLeg)).toBeUndefined();
    expect(refusalFor(transit, 'fleet-b', bondedLeg)).toBeDefined();
  });

  it('asks about the country the BOND runs in, not the one the truck came from', () => {
    // A Kenyan haulier holding Kenyan transit cover, at an Ethiopian dry port, is not authorised there.
    expect(refusalFor(licensed('KE'), 'fleet-a', bondedLeg)).toBeDefined();
  });

  it('leaves an ordinary leg alone', () => {
    const none = new TransitAuthorityService();
    // The delivery leg after release must NOT inherit this gate — clearing a container cannot be allowed
    // to make it harder to move, which is backwards and would strand every released box.
    expect(refusalFor(none, 'fleet-a', { bonded: false, pickupCountry: 'ET' })).toBeUndefined();
    expect(refusalFor(none, 'fleet-a', { pickupCountry: 'ET' })).toBeUndefined();
  });

  it('falls back to the leg-s own country when no bond country was stated', () => {
    expect(refusalFor(licensed('ET'), 'fleet-a', { bonded: true, pickupCountry: 'ET' })).toBeUndefined();
  });

  it('refuses once the licence lapses, with nobody withdrawing it', () => {
    const transit = licensed('ET', '2026-06-30');
    expect(refusalFor(transit, 'fleet-a', bondedLeg)).toBeUndefined();
    // The date is read at the moment of asking, like every other paper on this network.
    expect(transitRefusal(bondedLeg, (c) => transit.permits('fleet-a', c, Date.parse('2026-07-01T08:00:00.000Z')))).toBeDefined();
  });

  it('says so rather than waving it through when we cannot tell', () => {
    // No transit service at all (a deployment where it was never wired) must REFUSE, not permit. The
    // user's line was "not closing an eye and wait for trouble", and defaulting to yes is the closed eye.
    expect(transitRefusal(bondedLeg, () => false)).toBeDefined();
  });
});
