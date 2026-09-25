import { DepartureService } from './departure.service';
import { CorridorService } from './corridor.service';
import type { DriverService } from './driver.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { EventBus } from '../../foundation/events/event-bus.service';

/**
 * THE TWO DOORS F3 AND F4 WERE NOT ASKING.
 *
 * Both were found by reading the slice back against the rest of the codebase rather than by anything
 * failing, which is the only way this class of gap ever turns up: nothing errors, because nothing asked.
 *
 *  - EVERY OTHER WAY a driver gets behind a wheel here calls canOperate() first. A departure roster is not
 *    a coupling, so it asked nothing, and a driver whose licence lapsed last month could be put on a run
 *    and stand at a gate recording a charge against a shipper.
 *  - EVERY OTHER DOOR that moves goods asks the presence ladder — driver, fleet and hub registration all
 *    refuse a country we do not reach. Declaring a departure and booking onto one asked neither.
 *
 * The second is not redundant with registration, and that is the part worth keeping: a country can be
 * WOUND DOWN under a fleet that is already standing in it. Registration passed a year ago; the run
 * declared this morning is the one that has to be refused.
 */
describe('the two doors a run has to pass', () => {
  const MANAGER = 'did:glos:fleet-gates';
  const DRIVER = 'did:glos:driver-gates';
  const SHIPPER = 'did:glos:shipper-gates';

  const managers = { get: () => ({ jurisdiction: 'KE' }) } as unknown as FleetManagerService;
  const clearDrivers = { canOperate: () => true, offRoadReasons: () => [] } as unknown as DriverService;
  const openEverywhere = { can: () => true } as unknown as PresenceService;
/** Events are their own test (departure-events.spec.ts); here they go nowhere. */
const silentBus = { publish: async () => undefined } as unknown as EventBus;

  let lanes = 0;
  const line = (corridors: CorridorService) => {
    lanes += 1;
    const proposed = corridors.proposeLine({
      managerDid: MANAGER,
      company: 'Gate Fleet',
      name: `Gate line ${lanes}`,
      originZone: `Gate origin ${lanes}`,
      destZone: `Gate dest ${lanes}`,
      vehicleType: 'truck',
    });
    return corridors.publish(proposed.corridorId, 'did:glos:network-staff');
  };

  const setUp = (over: { drivers?: DriverService; presence?: PresenceService } = {}) => {
    const corridors = new CorridorService();
    const service = new DepartureService(corridors, managers, over.drivers ?? clearDrivers, over.presence ?? openEverywhere, silentBus);
    return { service, corridor: line(corridors) };
  };

  const declare = (service: DepartureService, corridorId: string) =>
    service.declare({
      managerDid: MANAGER,
      corridorId,
      leavesAt: new Date(Date.now() + 86_400_000).toISOString(),
      capacityKg: 6000,
      capacityM3: 40,
      basis: 'per_trip',
      amount: 450,
    });

  /* ------------------------------------------------------------------ the papers -- */

  describe('the licence', () => {
    const lapsed = {
      canOperate: () => false,
      offRoadReasons: () => ['off the road: Driving licence lapsed 3 Sep 2026'],
    } as unknown as DriverService;

    it('will not roster a driver whose papers have gone', () => {
      const { service, corridor } = setUp({ drivers: lapsed });
      const run = declare(service, corridor.corridorId);
      expect(() => service.assignDriver(run.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' })).toThrow(/licence lapsed 3 Sep 2026/);
    });

    it('names the paper, because "cannot be rostered" is a thing to ring somebody about', () => {
      const { service, corridor } = setUp({ drivers: lapsed });
      const run = declare(service, corridor.corridorId);
      try {
        service.assignDriver(run.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });
        throw new Error('should have refused');
      } catch (e) {
        // The office can act on this before the truck is due out.
        expect(String((e as Error).message)).toContain('Wanjiru cannot drive this run');
      }
    });

    it('leaves the run without a driver rather than half-rostering it', () => {
      const { service, corridor } = setUp({ drivers: lapsed });
      const run = declare(service, corridor.corridorId);
      expect(() => service.assignDriver(run.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' })).toThrow();
      expect(service.require(run.departureId).driverDid).toBeUndefined();
    });

    it('rosters a driver whose papers are in order', () => {
      const { service, corridor } = setUp();
      const run = declare(service, corridor.corridorId);
      expect(service.assignDriver(run.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' }).driverDid).toBe(DRIVER);
    });

    it('says something useful even when there is no paper to name', () => {
      const suspended = { canOperate: () => false, offRoadReasons: () => [] } as unknown as DriverService;
      const { service, corridor } = setUp({ drivers: suspended });
      const run = declare(service, corridor.corridorId);
      expect(() => service.assignDriver(run.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' })).toThrow(/not an active driver/);
    });
  });

  /* ------------------------------------------------------------------ the country -- */

  describe('the country', () => {
    const woundDown = { can: () => false } as unknown as PresenceService;

    it('will not let a run be declared where we no longer operate', () => {
      const { service, corridor } = setUp({ presence: woundDown });
      expect(() => declare(service, corridor.corridorId)).toThrow(/does not operate in KE/);
    });

    it('refuses a booking onto a run in a country that has since been wound down', () => {
      // THE CASE THAT IS NOT REDUNDANT WITH REGISTRATION: the run was declared while the door was open,
      // and the shipper arrives after it shut. Registration a year ago cannot answer this.
      const corridors = new CorridorService();
      const shutting = { can: () => true };
      const service = new DepartureService(corridors, managers, clearDrivers, shutting as unknown as PresenceService, silentBus);
      const run = declare(service, line(corridors).corridorId);

      shutting.can = () => false;
      expect(() => service.book(run.departureId, { shipperDid: SHIPPER, description: 'Maize', weightKg: 100 })).toThrow(/does not operate in KE/);
      expect(() => service.quote(run.departureId, { weightKg: 100 })).toThrow(/does not operate in KE/);
      // The fleet's own work stops too: the door is about goods moving, not about who is paying.
      expect(() => service.addOwnLoad(run.departureId, MANAGER, { customer: 'Kariuki', description: 'Cement', weightKg: 100 })).toThrow(/does not operate in KE/);
    });

    it('does not refuse a fleet whose country nobody has recorded', () => {
      /*
       * FOUND BY DRIVING IT, and the gate was wrong rather than the data.
       *
       * Jurisdiction is optional at registration, so plenty of real fleets have none — and presence
       * answers "observed" for an unknown country, which grants nothing. The first version of this gate
       * therefore refused every one of them with "the network does not operate in undefined": untrue,
       * because we have decided nothing about them, and unactionable, because there is no country to fix.
       *
       * The incomplete record is a real problem and it is surfaced where it actually bites — the price
       * field says out loud that the currency is a guess.
       */
      const nowhere = { get: () => ({}) } as unknown as FleetManagerService;
      const corridors = new CorridorService();
      const asked: Array<string | undefined> = [];
      const recording = { can: (j: string | undefined) => (asked.push(j), false) } as unknown as PresenceService;
      const service = new DepartureService(corridors, nowhere, clearDrivers, recording, silentBus);

      expect(() => declare(service, line(corridors).corridorId)).not.toThrow();
      // Not "asked and forgiven" — never asked, because there is no question to put.
      expect(asked).toEqual([]);
    });

    it('asks takeIn and not merchantOfRecord, because a matched country is the point', () => {
      const asked: string[] = [];
      const recording = { can: (_j: string | undefined, cap: string) => (asked.push(cap), true) } as unknown as PresenceService;
      const { service, corridor } = setUp({ presence: recording });
      declare(service, corridor.corridorId);

      // Gating on a sister company would lock this out of exactly the markets it exists for: where we
      // only match, the fleet IS the local operator and settles with the shipper itself.
      expect(asked).toEqual(['takeIn']);
    });
  });
});
