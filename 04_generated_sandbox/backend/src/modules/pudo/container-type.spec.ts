import { CONTAINER_TYPES, allContainerCodes, containerType, heightUnstated, outOfGauge, standsOn } from './container-type';

/**
 * CL7 — every ISO 6346 size/type code, not a shortlist of them.
 *
 * The question these exist for: *"how does booking an open top container differ from an extra high 40ft
 * container in our system? or a food grade 20ft liquid tank from a crude oil product tank container?"* —
 * and then, of the first answer: *"we need to list them all rather."*
 *
 * So the guards are of two kinds. That the differences which matter are reachable for ANY valid code, and
 * that the places where the standard itself declines to be specific are still refused rather than filled
 * in with a plausible number.
 */
describe('a container is not just a container', () => {
  it('resolves any code from the three tables, not from a list somebody kept', () => {
    // A 30ft ventilated box and a 45ft pallet-wide flat rack were never on the shortlist, and neither is
    // exotic. Both resolve now because the tables are the standard rather than a sample of it.
    expect(containerType('32V0')).toMatchObject({ lengthFt: 30, kind: 'vented' });
    expect(containerType('LNP3')).toMatchObject({ lengthFt: 45, kind: 'flat', palletWide: true });
    // …as does a 10ft general purpose, a 24ft, a 48ft and a 53ft.
    expect(containerType('12G1')?.lengthFt).toBe(10);
    expect(containerType('C2G1')?.lengthFt).toBe(24);
    expect(containerType('M5G1')?.lengthFt).toBe(48);
    expect(containerType('P5G1')?.lengthFt).toBe(53);
  });

  it('knows the 30 cm that decides a bridge', () => {
    // The whole difference between a routine movement and one that has to be routed.
    expect(containerType('42G1')!.heightM).toBeCloseTo(2.591, 3);
    expect(containerType('45G1')!.heightM).toBeCloseTo(2.896, 3);
    expect(containerType('45G1')!.heightM! - containerType('42G1')!.heightM!).toBeCloseTo(0.305, 2);
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

  /**
   * WHERE THE STANDARD ITSELF DECLINES TO SAY. Four size codes are open ranges, and a system that filled
   * them in with a plausible figure would be making up the one number a bridge depends on.
   */
  describe('a code that does not state its own height', () => {
    it('gives no height at all rather than a plausible one', () => {
      const tall = containerType('46G1')!; // '6' = taller than 2896 mm, and the standard stops there
      expect(tall.heightM).toBeUndefined();
      expect(heightUnstated(tall)).toBe(true);
      // …and it says so where a person reads it, rather than showing a blank.
      expect(tall.label).toMatch(/taller than 2896 mm/);
      // No height means no sum, which means HEIGHT_UNKNOWN at every low bridge on the route.
      expect(standsOn(1.3, tall)).toBeUndefined();
    });

    it('takes a MEASURED figure in its place, because somebody looking at the box knows better', () => {
      const tall = containerType('46G1')!;
      expect(standsOn(1.3, tall, 3.1)).toBe(4.4);
    });

    it('holds the short end of the range too', () => {
      const short = containerType('49P0')!; // '9' = shorter than 1219 mm
      expect(short.heightM).toBeUndefined();
      expect(short.label).toMatch(/shorter than 1219 mm/);
    });

    it('is a different thing from a height it DOES state', () => {
      expect(heightUnstated(containerType('45G1'))).toBe(false);
      expect(heightUnstated(containerType('28G1'))).toBe(false); // '8' = 1295 mm, a half-height
      expect(containerType('28G1')!.heightM).toBeCloseTo(1.295, 3);
    });
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
    // A closed box is top-lifted by its corner castings. An open one is CRANED — there is no roof to
    // grip — and that changes which yards can handle it at all.
    expect(containerType('42G1')!.equipment).toContain('TLT');
    expect(containerType('42U1')!.equipment).not.toContain('TLT');
    expect(containerType('42U1')!.equipment).toContain('CRN');
    // Every box needs a chassis. Length decides what else: a 20ft will sit on a flatbed, a 40ft will not.
    expect(containerType('22G1')!.bodies).toContain('flatbed');
    expect(containerType('42G1')!.bodies).not.toContain('flatbed');
    // The sidelifter handles the 20–40ft family: a depot delivery versus a farm gate.
    expect(containerType('42G1')!.bodies).toContain('container_selfloader');
    expect(containerType('L5G1')!.bodies).not.toContain('container_selfloader');
    // No roof means the cargo may be over-height, which is a lowboy conversation.
    expect(containerType('42U1')!.bodies).toContain('lowboy');
  });

  it('holds the box this region actually exports in', () => {
    // The worst omission of the shortlist: a 22V0 is what East African coffee leaves in — passive vents
    // low and high so a hygroscopic crop breathes instead of sweating into its own sacks.
    const vented = containerType('22V0')!;
    expect(vented.kind).toBe('vented');
    expect(vented.group).toBe('ventilated');
    // It looks like a dry box and is a different booking: same height, same bodies, not the same box.
    expect(vented.heightM).toBeCloseTo(containerType('22G1')!.heightM!, 3);
    expect(vented.kind).not.toBe(containerType('22G1')!.kind);
  });

  it('holds the ones that are not general-purpose boxes at all', () => {
    // A livestock carrier and a car carrier are named-cargo codes, and each is its own paperwork.
    expect(containerType('22S0')).toMatchObject({ kind: 'named', group: 'named cargo' });
    expect(containerType('42S1')!.label).toMatch(/automobile carrier/);
    // Live fish needs power, which follows from the type rather than from anybody's preference.
    expect(containerType('22S2')!.needsPower).toBe(true);
    // A bolster is a bare platform; a half-height exists because dense cargo is over its axle limits
    // long before the box is full.
    expect(containerType('22P0')!.group).toBe('platform');
    expect(containerType('29P0')!.openTop).toBe(true);
    // An insulated box has no machinery at all, so nothing to plug in and nothing to fail.
    expect(containerType('22H5')).toMatchObject({ kind: 'insulated', needsPower: false });
    // And the air/surface box, which is a different world again.
    expect(containerType('22A0')!.kind).toBe('air');
  });

  it('CANNOT tell a food tank from a fuel tank, and does not pretend to', () => {
    const nonDangerous = containerType('22T1')!;
    const dangerous = containerType('22T4')!;
    const gas = containerType('22T7')!;
    // The digit is a test-pressure band grouped into liquids/dangerous liquids/gases, and says nothing
    // about the cargo. What makes one food-grade is its last cargoes and a cleaning certificate, which
    // live on the consignment as the importer's declaration — see the import spec.
    expect(nonDangerous.group).toMatch(/non-dangerous/);
    expect(dangerous.group).toMatch(/dangerous liquids/);
    expect(gas.group).toMatch(/gases/);
    expect(JSON.stringify(nonDangerous)).not.toMatch(/food|fuel|crude|edible/i);
    // And no figure in bar anywhere: a wrong one is worse than none, and we certify no tanks.
    expect(JSON.stringify([nonDangerous, dangerous, gas])).not.toMatch(/bar\b/);
  });

  it('refuses what is not an ISO code, rather than carrying it as a label', () => {
    // 45GI is a typo for 45G1. Accepting it would lose the height, the body and the bridge check in
    // silence, which is worse for the person typing than being told.
    expect(containerType('45GI')).toBeUndefined();
    expect(containerType('99Z9')).toBeUndefined();
    expect(containerType('45G')).toBeUndefined();
    expect(containerType('45G11')).toBeUndefined();
    expect(containerType('')).toBeUndefined();
    expect(containerType(undefined)).toBeUndefined();
    // Case and whitespace are a person typing, not a different box.
    expect(containerType(' 45g1 ')!.code).toBe('45G1');
  });

  it('gives every code the tables can build the facts a booking needs', () => {
    const all = allContainerCodes();
    // Thousands of combinations, which is exactly why a dropdown offers a suggestion list instead.
    expect(all.length).toBeGreaterThan(2000);
    for (const code of all) {
      const spec = containerType(code)!;
      expect(spec).toBeDefined();
      expect(spec.bodies.length).toBeGreaterThan(0);
      // A box with no way to lift it is a box nobody can move off a quay.
      expect(spec.equipment.length).toBeGreaterThan(0);
      // A height is either a real figure or absent. It is never zero, and never a guess.
      if (spec.heightM != null) expect(spec.heightM).toBeGreaterThan(0.5);
    }
  });

  it('offers a suggestion list that is not the boundary of what it accepts', () => {
    // The confusion between the two is what made the first version a shortlist with an escape hatch.
    expect(CONTAINER_TYPES.length).toBeGreaterThan(20);
    expect(CONTAINER_TYPES.length).toBeLessThan(allContainerCodes().length);
    for (const suggested of CONTAINER_TYPES) expect(containerType(suggested.code)).toBeDefined();
  });
});
