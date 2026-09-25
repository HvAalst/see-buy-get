import { DepartureService } from './departure.service';
import { CorridorService } from './corridor.service';
import { CargoService } from './cargo.service';
import type { DriverService } from './driver.service';
import type { VehicleService } from './vehicle.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { EventBus } from '../../foundation/events/event-bus.service';
import type { MediaService } from './media.service';

/**
 * F5 — WHAT THE GOODS ARE, AND WHERE COVER STANDS.
 *
 * Two things a run did not ask, and the board has asked since S30 and P3 respectively. The point of this
 * file is that they are asked the SAME WAY: the same cargo natures, the same capability map, the same
 * compatibility matrix. A second vocabulary for the same fact is how two halves of one product drift into
 * disagreeing about whether a load may travel — and a shipper who found that the board protected them and
 * a run did not would be right to feel misled.
 *
 * The REAL CargoService is used throughout, never a stub. The compatibility matrix is precisely the thing
 * a stub would get wrong, and a test that invents its own answer proves only that it agrees with itself.
 */
describe('what may go on this truck, and who carries the risk', () => {
  const MANAGER = 'did:glos:fleet-cargo';
  const SHIPPER = 'did:glos:shipper-cargo';
  const OTHER = 'did:glos:shipper-other-cargo';

  const managers = { get: () => ({ jurisdiction: 'KE' }) } as unknown as FleetManagerService;
  const clearDrivers = { canOperate: () => true, offRoadReasons: () => [] } as unknown as DriverService;
  const openEverywhere = { can: () => true } as unknown as PresenceService;
  const silent = { publish: async () => undefined } as unknown as EventBus;
  const noMedia = { adopt: () => undefined } as unknown as MediaService;

  /** A plain dry-goods box body: no cold chain, no hazmat. What most of the network actually drives. */
  const PLAIN = { vehicleId: 'veh_box', plate: 'KDA 500B', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE' };

  let lanes = 0;
  const setUp = (vehicle: Record<string, unknown> = PLAIN, over: Record<string, unknown> = {}) => {
    lanes += 1;
    const corridors = new CorridorService();
    const vehicles = { get: () => vehicle, isUsable: () => true, offRoadReasons: () => [] } as unknown as VehicleService;
    const service = new DepartureService(corridors, managers, clearDrivers, vehicles, new CargoService(), noMedia, openEverywhere, silent);
    const proposed = corridors.proposeLine({ managerDid: MANAGER, company: 'Cargo Fleet', name: `Cargo line ${lanes}`, originZone: `Cargo A${lanes}`, destZone: `Cargo B${lanes}`, vehicleType: 'truck' });
    const corridor = corridors.publish(proposed.corridorId, 'did:glos:network-staff');
    const run = service.declare({
      managerDid: MANAGER,
      corridorId: corridor.corridorId,
      vehicleId: 'veh_box',
      leavesAt: new Date(Date.now() + 86_400_000).toISOString(),
      basis: 'per_trip',
      amount: 450,
      ...over,
    });
    return { service, departureId: run.departureId };
  };

  const send = (service: DepartureService, departureId: string, nature: string, shipperDid = SHIPPER, description = 'A load') =>
    service.book(departureId, { shipperDid, description, weightKg: 100, nature });

  /* ------------------------------------------------ the vehicle has to be able to carry it -- */

  describe('the vehicle', () => {
    it('refuses hazardous goods on a truck that does not carry hazmat', () => {
      // The failure this prevents, in one line: a drum of solvent on a food-grade body. It was possible
      // right up until now, because a booking was a free-text description and a weight.
      const { service, departureId } = setUp();
      expect(() => send(service, departureId, 'HAZ-CHEM')).toThrow(/KDA 500B does not carry hazmat/);
    });

    it('refuses perishables on a truck with no cold chain, and says "cold chain" rather than a field name', () => {
      const { service, departureId } = setUp();
      expect(() => send(service, departureId, 'FOP')).toThrow(/does not carry cold chain/);
    });

    it('takes them on a truck that can', () => {
      // Two runs, not one: flammables and fresh produce are incompatible with each other whatever the
      // vehicle can do, which the matrix knows and this test originally did not.
      const flammable = setUp({ ...PLAIN, hazmat: true });
      expect(send(flammable.service, flammable.departureId, 'HAZ-FLAM').booking.nature).toBe('HAZ-FLAM');
      const chilled = setUp({ ...PLAIN, coldChain: true });
      expect(send(chilled.service, chilled.departureId, 'FOP').booking.nature).toBe('FOP');
    });

    it('lets ordinary dry goods onto an ordinary truck, which is most freight', () => {
      const { service, departureId } = setUp();
      expect(send(service, departureId, 'GEN').booking.nature).toBe('GEN');
      expect(send(service, departureId, 'FOD').booking.nature).toBe('FOD');
    });

    it('refuses at the QUOTE, so the shipper hears it while they are still choosing', () => {
      const { service, departureId } = setUp();
      expect(() => service.quote(departureId, { weightKg: 100, nature: 'HAZ-CHEM' })).toThrow(/does not carry hazmat/);
    });

    it('tells a shipper what the truck CAN do, rather than only refusing afterwards', () => {
      const { service } = setUp({ ...PLAIN, hazmat: true, coldChain: true });
      const [offer] = service.offers();
      expect(offer.handles).toEqual(expect.arrayContaining(['coldChain', 'hazmat']));
    });
  });

  /* ------------------------------------------------ and the other loads on the same truck -- */

  describe('the loads already aboard — the half the board never had to solve', () => {
    it('will not put cement dust in with fresh produce', () => {
      // A run is SHARED where a board haul is one shipper's, so this is genuinely harder here. The truck
      // is fine for each of them alone, and they still must not travel together.
      const { service, departureId } = setUp({ ...PLAIN, coldChain: true });
      send(service, departureId, 'FOP', SHIPPER, 'Crates of tomatoes');
      expect(() => send(service, departureId, 'HAZ-DUST', OTHER, 'Cement')).toThrow(/Crates of tomatoes/);
    });

    it('names what is already there, because "incompatible" alone is not actionable', () => {
      const { service, departureId } = setUp({ ...PLAIN, coldChain: true });
      send(service, departureId, 'FOP', SHIPPER, 'Crates of tomatoes');
      expect(() => send(service, departureId, 'HAZ-DUST', OTHER, 'Cement')).toThrow(/must not travel together/);
    });

    it('lets two loads that may share a vehicle share it', () => {
      const { service, departureId } = setUp();
      send(service, departureId, 'GEN', SHIPPER);
      expect(send(service, departureId, 'FOD', OTHER).booking.nature).toBe('FOD');
    });

    it('checks the fleet’s OWN customers too — their goods spoil the same way', () => {
      const { service, departureId } = setUp({ ...PLAIN, coldChain: true });
      service.addOwnLoad(departureId, MANAGER, { customer: 'Kariuki', description: 'Cement', weightKg: 100, nature: 'HAZ-DUST' });
      expect(() => send(service, departureId, 'FOP', SHIPPER, 'Tomatoes')).toThrow(/Cement/);
    });

    it('and refuses the fleet’s own load against what a shipper already put on', () => {
      const { service, departureId } = setUp({ ...PLAIN, coldChain: true });
      send(service, departureId, 'FOP', SHIPPER, 'Tomatoes');
      expect(() => service.addOwnLoad(departureId, MANAGER, { customer: 'Kariuki', description: 'Cement', weightKg: 100, nature: 'HAZ-DUST' })).toThrow(/Tomatoes/);
    });

    it('stops caring once the clashing load is off the truck', () => {
      const { service, departureId } = setUp({ ...PLAIN, coldChain: true });
      const tomatoes = send(service, departureId, 'FOP', SHIPPER, 'Tomatoes').booking;
      service.cancelBooking(departureId, tomatoes.bookingId, SHIPPER);
      expect(send(service, departureId, 'HAZ-DUST', OTHER, 'Cement').booking.nature).toBe('HAZ-DUST');
    });
  });

  /* ------------------------------------------------------------------ the nature itself -- */

  describe('the nature', () => {
    it('defaults to general dry, because most freight is', () => {
      const { service, departureId } = setUp();
      expect(service.book(departureId, { shipperDid: SHIPPER, description: 'A load', weightKg: 100 }).booking.nature).toBe('GEN');
    });

    it('refuses a value nobody agreed on, and lists the ones that exist', () => {
      const { service, departureId } = setUp();
      expect(() => send(service, departureId, 'RADIOACTIVE')).toThrow(/Say what kind of goods these are/);
    });

    it('reads the enum rather than restating it', () => {
      // If a nature is added to the taxonomy, this accepts it the same day — which is the whole reason
      // requireNature() calls CARGO_NATURES.includes instead of listing the ones it happens to know.
      const { service, departureId } = setUp();
      expect(() => send(service, departureId, 'HUM')).not.toThrow();
    });
  });

  /* --------------------------------------------------------------------- where cover is -- */

  describe('cover, which is never ours', () => {
    it('carries the carrier’s own position to the shipper before they book', () => {
      const { service } = setUp(PLAIN, { coverLimit: 200000, coverPolicy: 'Jubilee GIT/2026/114' });
      expect(service.offers()[0].cover).toEqual({ limit: 200000, policy: 'Jubilee GIT/2026/114' });
    });

    it('keeps ZERO, because "I carry none" is the answer a forwarder needs', () => {
      // Not the same fact as a carrier who has not said, and the difference is the whole point: one is a
      // gap somebody can price, the other is a question nobody has asked.
      const { service } = setUp(PLAIN, { coverLimit: 0 });
      expect(service.offers()[0].cover).toEqual({ limit: 0 });
    });

    it('leaves a carrier who has said nothing unanswered rather than guessing', () => {
      const { service } = setUp();
      expect(service.offers()[0].cover).toBeUndefined();
    });

    it('is still on the booking afterwards, which is when a claim is argued', () => {
      const { service, departureId } = setUp(PLAIN, { coverLimit: 200000 });
      send(service, departureId, 'GEN');
      expect(service.forShipper(SHIPPER)[0].cover).toEqual({ limit: 200000 });
    });

    it('carries the shipper’s declared value, unverified and never a promise of ours', () => {
      const { service, departureId } = setUp(PLAIN, { coverLimit: 200000 });
      service.book(departureId, { shipperDid: SHIPPER, description: 'Solar panels', weightKg: 100, declaredValue: 450000 });
      // 450,000 declared against a 200,000 policy is exactly the gap a forwarder exists to close, and it
      // is legible here for the first time.
      expect(service.forShipper(SHIPPER)[0]).toMatchObject({ declaredValue: 450000, cover: { limit: 200000 } });
    });

    it('treats a value nobody typed as absent, not as nought', () => {
      const { service, departureId } = setUp();
      send(service, departureId, 'GEN');
      expect(service.forShipper(SHIPPER)[0].declaredValue).toBeUndefined();
    });
  });
});

/**
 * A LEGACY RUN, WITH NO VEHICLE ON ITS RECORD.
 *
 * Found by driving it, and it was the worst possible shape: every run declared before a vehicle was
 * required carries no vehicleId, and reading the capability list for one threw NOT_FOUND from inside
 * `offers()` — so ONE such record took the whole offer list down for every shipper in the network.
 *
 * The same shape as the P2 lesson, where a money question reached from a read path 403'd a whole screen.
 * The rule that falls out of it is a rule about DIRECTION: a read must answer, and a gate must refuse.
 */
describe('a run whose vehicle cannot be read', () => {
  const MANAGER = 'did:glos:fleet-legacy';
  const SHIPPER = 'did:glos:shipper-legacy';
  const managers = { get: () => ({ jurisdiction: 'KE' }) } as unknown as FleetManagerService;
  const clearDrivers = { canOperate: () => true, offRoadReasons: () => [] } as unknown as DriverService;
  const openEverywhere = { can: () => true } as unknown as PresenceService;
  const silent = { publish: async () => undefined } as unknown as EventBus;
  const noMedia = { adopt: () => undefined } as unknown as MediaService;

  /**
   * A registry that knows the truck at declaration and has forgotten it by the time anybody reads.
   *
   * Built PER TEST. A shared one leaked its forgotten state into the next test and made declare() throw
   * before the thing under test ever ran — which is its own small lesson about stubs that carry state.
   */
  const forgetful = () => {
    let known = true;
    return {
      get: () => {
        if (!known) throw new Error('No such vehicle');
        return { vehicleId: 'veh_gone', plate: 'KDA 000X', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE' };
      },
      isUsable: () => true,
      offRoadReasons: () => [],
      forget: () => {
        known = false;
      },
    };
  };

  /** A run declared against a truck the registry then loses. */
  const legacyRun = (lane: string) => {
    const vehicles = forgetful();
    const corridors = new CorridorService();
    const service = new DepartureService(corridors, managers, clearDrivers, vehicles as unknown as VehicleService, new CargoService(), noMedia, openEverywhere, silent);
    const proposed = corridors.proposeLine({ managerDid: MANAGER, company: 'Legacy Fleet', name: `Legacy ${lane}`, originZone: `Legacy ${lane}A`, destZone: `Legacy ${lane}B`, vehicleType: 'truck' });
    const corridor = corridors.publish(proposed.corridorId, 'did:glos:network-staff');
    const run = service.declare({ managerDid: MANAGER, corridorId: corridor.corridorId, vehicleId: 'veh_gone', leavesAt: new Date(Date.now() + 86_400_000).toISOString(), basis: 'per_trip', amount: 450 });
    vehicles.forget();
    return { service, departureId: run.departureId };
  };
  it('still lists the run, rather than taking every offer down with it', () => {
    const { service } = legacyRun('one');
    const offers = service.offers();
    expect(offers).toHaveLength(1);
    // "We do not know what it handles" is the honest answer, and the booking gate asks again for real.
    expect(offers[0].handles).toEqual([]);
  });
  it('but REFUSES a load that needs a capability it cannot vouch for', () => {
    // The opposite direction, on purpose: a read must answer, a gate must refuse. A vehicle nobody can
    // read is not a vehicle anybody should put a drum of solvent on.
    const { service, departureId } = legacyRun('two');
    expect(() => service.book(departureId, { shipperDid: SHIPPER, description: 'Solvent', weightKg: 100, nature: 'HAZ-CHEM' })).toThrow(/does not carry hazmat/);
    // And ordinary dry goods still travel: the refusal is about the capability, not about the record.
    expect(service.book(departureId, { shipperDid: SHIPPER, description: 'Books', weightKg: 100 }).booking.nature).toBe('GEN');
  });
});
