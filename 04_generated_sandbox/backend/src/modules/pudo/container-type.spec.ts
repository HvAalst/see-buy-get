import { CONTAINER_TYPES, containerType, standsOn, outOfGauge } from './container-type';

/**
 * CL7 — what kind of box it is.
 *
 * The question these tests exist for: *"how does booking an open top container differ from an extra high
 * 40ft container in our system? or a food grade 20ft liquid tank from a crude oil product tank
 * container?"* The answer was that it did not differ at all, so what is worth guarding is that the
 * differences which matter are now reachable — and that the ones a code CANNOT answer are still refused
 * rather than guessed.
 */
describe('a container is not just a container', () => {
  it('knows the 30 cm that decides a bridge', () => {
    // The whole difference between a routine movement and one that has to be routed.
    expect(containerType('42G1')!.heightM).toBeCloseTo(2.591, 3);
    expect(containerType('45G1')!.heightM).toBeCloseTo(2.896, 3);
    expect(containerType('45G1')!.heightM - containerType('42G1')!.heightM).toBeCloseTo(0.305, 2);
    // Same footprint, same bodies — only the height differs, which is exactly why it was invisible.
    expect(containerType('45G1')!.lengthFt).toBe(containerType('42G1')!.lengthFt);
  });

  it('adds the deck, because a height without one is not an answer', () => {
    const highCube = containerType('45G1');
    // A high-cube on a 1.3 m chassis stands at 4.20 m. A 4.2 m bridge is not a theoretical problem.
    expect(standsOn(1.3, highCube)).toBe(4.2);
    expect(standsOn(1.15, highCube)).toBe(4.05);
    // Half a sum is no sum. Either half missing answers undefined, which the map reads as HEIGHT_UNKNOWN.
    expect(standsOn(undefined, highCube)).toBeUndefined();
    expect(standsOn(1.3, undefined)).toBeUndefined();
  });

  it('REFUSES to answer for an open box until somebody says how tall the cargo is', () => {
    const openTop = containerType('42U1')!;
    // The box's own height is the FLOOR the cargo sits on. Answering with it would clear a load standing
    // a metre above it — the silent pass the whole hazard map exists to refuse.
    expect(standsOn(1.3, openTop)).toBeUndefined();
    expect(standsOn(1.3, openTop, 3.4)).toBe(4.7);
  });

  it('knows when a load stands proud of an open box', () => {
    const openTop = containerType('22U1')!;
    expect(outOfGauge(openTop, 3.2)).toBe(true);
    expect(outOfGauge(openTop, 2.0)).toBe(false);
    // A closed box is never out of gauge, whatever anybody types: the roof settles it.
    expect(outOfGauge(containerType('42G1'), 9)).toBe(false);
    // And an open box with nothing declared is not a claim either way.
    expect(outOfGauge(openTop, undefined)).toBe(false);
  });

  it('says what has to lift it, and what can carry it', () => {
    // A box needs a chassis. An open top cannot be top-lifted — it is craned, because there is no roof
    // to grip, and that changes which yards can handle it.
    expect(containerType('42G1')!.equipment).toContain('TLT');
    expect(containerType('42U1')!.equipment).not.toContain('TLT');
    expect(containerType('42U1')!.equipment).toContain('CRN');
    expect(containerType('22G1')!.bodies).toContain('skeletal');
    // The sidelifter is the difference between a depot delivery and a farm gate.
    expect(containerType('22G1')!.bodies).toContain('container_selfloader');
  });

  it('CANNOT tell a food tank from a fuel tank, and does not pretend to', () => {
    const low = containerType('22T1')!;
    const high = containerType('22T6')!;
    // Both are 20ft tanks; the digit is a test-pressure band and says nothing about the cargo. What
    // makes one food-grade is its last cargoes and a cleaning certificate, which live on the
    // consignment as the importer's declaration — see the import spec.
    expect(low.kind).toBe('tank');
    expect(high.kind).toBe('tank');
    expect(JSON.stringify(low)).not.toMatch(/food|fuel|crude|edible/i);
  });

  it('is a catalogue, so an unknown code is refused rather than parsed', () => {
    // Deliberately NOT an ISO 6346 parser: a parser answers confidently about codes nobody here has
    // booked, and is wrong in the corners. What is listed is what somebody has seen.
    expect(containerType('99Z9')).toBeUndefined();
    expect(containerType('')).toBeUndefined();
    expect(containerType(undefined)).toBeUndefined();
    // Case and whitespace are a person typing, not a different box.
    expect(containerType(' 45g1 ')!.code).toBe('45G1');
  });

  it('gives every entry the facts a booking needs', () => {
    for (const c of CONTAINER_TYPES) {
      expect(c.code).toMatch(/^[0-9A-Z]{4}$/);
      expect(c.heightM).toBeGreaterThan(2);
      expect(c.heightM).toBeLessThan(3);
      expect(c.bodies.length).toBeGreaterThan(0);
      // A box with no way to lift it is a box nobody can move off a quay.
      expect(c.equipment.length).toBeGreaterThan(0);
    }
  });
});
