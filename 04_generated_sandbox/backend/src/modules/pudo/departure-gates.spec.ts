import { DepartureService } from './departure.service';
import { GlosError } from '../../foundation/http/glos-error';
import { requiredUnloadKeys } from './heavy-cargo';
import { CorridorService } from './corridor.service';
import { CargoService } from './cargo.service';
import type { MediaService } from './media.service';

/** A photo store that only remembers what it was asked to adopt. */
const adoptions: Array<{ mediaId: string; by: string; role: string }> = [];
const anchored: string[] = [];
const held: string[] = [];
const adopted = () =>
  ({
    adopt: (mediaId: string, by: string, _subject: unknown, role: string) => {
      adoptions.push({ mediaId, by, role });
    },
    // Retention: a run now starts and holds its evidence clock the way the board has since S33.
    anchorFreightTerminal: (id: string) => void anchored.push(id),
    holdFreightForDispute: (id: string) => void held.push(id),
  }) as unknown as MediaService;
import type { DriverService } from './driver.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { EventBus } from '../../foundation/events/event-bus.service';
import type { VehicleService } from './vehicle.service';

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

  const managers = { get: () => ({ jurisdiction: 'KE' }), tradingBlocks: () => [], assertMayTakeWork: () => undefined } as unknown as FleetManagerService;

  /** One eight-tonne truck, in date and this fleet's. The vehicle gate is its own test. */

  const oneTruck = { get: () => ({ vehicleId: 'veh_1', plate: 'KDA 001A', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE' }), isUsable: () => true, offRoadReasons: () => [] } as unknown as VehicleService;
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
    const service = new DepartureService(corridors, managers, over.drivers ?? clearDrivers, oneTruck, new CargoService(), adopted(), over.presence ?? openEverywhere, silentBus);
    return { service, corridor: line(corridors) };
  };

  const declare = (service: DepartureService, corridorId: string) =>
    service.declare({
      managerDid: MANAGER,
      corridorId,
      vehicleId: 'veh_1',
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
      offRoadReasons: () => ['Driving licence lapsed 3 Sep 2026'],
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
      const service = new DepartureService(corridors, managers, clearDrivers, oneTruck, new CargoService(), adopted(), shutting as unknown as PresenceService, silentBus);
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
      const nowhere = { get: () => ({}), tradingBlocks: () => [], assertMayTakeWork: () => undefined } as unknown as FleetManagerService;
      const corridors = new CorridorService();
      const asked: Array<string | undefined> = [];
      const recording = { can: (j: string | undefined) => (asked.push(j), false) } as unknown as PresenceService;
      const service = new DepartureService(corridors, nowhere, clearDrivers, oneTruck, new CargoService(), adopted(), recording, silentBus);

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

  /* ------------------------------------------------------------------ the carrier -- */

  /**
   * AND THE DOOR THAT WAS NEVER THERE AT ALL: may this carrier take work?
   *
   * `requireActive` was asked before registering a vehicle and before onboarding a driver, and nowhere
   * else. SELLING SPACE — the thing suspension exists to stop — asked nothing, and the route guard
   * checked who was calling rather than whether they might still trade. Suspension closed the sign-in
   * door and left the shop open: a fleet suspended mid-session kept publishing runs and taking bookings
   * for as long as its token lasted.
   *
   * The reasons a carrier is refused live in FleetManagerService (carrier-papers.spec.ts drives them).
   * What matters HERE is which doors ask, and — just as much — which ones must never ask.
   */
  describe('the carrier', () => {
    const stopped = {
      get: () => ({ jurisdiction: 'KE' }),
      tradingBlocks: () => ['Kilima Logistics is suspended on the network'],
      assertMayTakeWork: () => {
        throw new GlosError('CARRIER_NOT_TRADING', 'This carrier is not taking new work: Kilima Logistics is suspended on the network');
      },
    } as unknown as FleetManagerService;

    const stoppedSetUp = () => {
      const corridors = new CorridorService();
      const service = new DepartureService(corridors, stopped, clearDrivers, oneTruck, new CargoService(), adopted(), openEverywhere, silentBus);
      return { service, corridor: line(corridors) };
    };

    it('will not let a suspended fleet sell new space', () => {
      const { service, corridor } = stoppedSetUp();
      expect(() => declare(service, corridor.corridorId)).toThrow(/not taking new work/);
      expect(() => declare(service, corridor.corridorId)).toThrow(/Kilima Logistics is suspended/);
    });

    it('refuses a shipper booking onto a run the carrier published BEFORE it was stopped', () => {
      // The case registration cannot answer, exactly like the wound-down country above: the run went up
      // while the fleet was fine and the shipper arrives afterwards.
      const corridors = new CorridorService();
      const swing = { get: () => ({ jurisdiction: 'KE' }), tradingBlocks: () => [] as string[], assertMayTakeWork: () => undefined as void };
      const service = new DepartureService(corridors, swing as unknown as FleetManagerService, clearDrivers, oneTruck, new CargoService(), adopted(), openEverywhere, silentBus);
      const run = declare(service, line(corridors).corridorId);

      swing.tradingBlocks = () => ['Kilima Logistics is suspended on the network'];
      swing.assertMayTakeWork = () => {
        throw new GlosError('CARRIER_NOT_TRADING', 'This carrier is not taking new work: Kilima Logistics is suspended on the network');
      };

      expect(() => service.book(run.departureId, { shipperDid: SHIPPER, description: 'Maize', weightKg: 100 })).toThrow(/not taking new work/);
      // Quoting too — pricing a run somebody may not book is a tease, and both go through assertBookable.
      expect(() => service.quote(run.departureId, { weightKg: 100 })).toThrow(/not taking new work/);
    });

    it('takes the run off the board rather than refusing at the button', () => {
      const corridors = new CorridorService();
      const swing = { get: () => ({ jurisdiction: 'KE' }), tradingBlocks: () => [] as string[], assertMayTakeWork: () => undefined as void };
      const service = new DepartureService(corridors, swing as unknown as FleetManagerService, clearDrivers, oneTruck, new CargoService(), adopted(), openEverywhere, silentBus);
      declare(service, line(corridors).corridorId);
      expect(service.offers()).toHaveLength(1);

      swing.tradingBlocks = () => ['Kilima Logistics is suspended on the network'];
      // A shipper has no way to know a carrier was stopped this morning. Letting them choose a run,
      // price it and then be told no is a worse answer than never offering it.
      expect(service.offers()).toHaveLength(0);
    });

    it('still lets the fleet record its OWN loads, which is not a sale', () => {
      const { service, corridor } = (() => {
        const corridors = new CorridorService();
        const swing = { get: () => ({ jurisdiction: 'KE' }), tradingBlocks: () => [] as string[], assertMayTakeWork: () => undefined as void };
        const svc = new DepartureService(corridors, swing as unknown as FleetManagerService, clearDrivers, oneTruck, new CargoService(), adopted(), openEverywhere, silentBus);
        const c = line(corridors);
        declare(svc, c.corridorId);
        swing.tradingBlocks = () => ['Kilima Logistics is suspended on the network'];
        swing.assertMayTakeWork = () => {
          throw new GlosError('CARRIER_NOT_TRADING', 'no');
        };
        return { service: svc, corridor: c };
      })();
      const run = service.forFleet(MANAGER)[0];

      // F4: a fleet recording a customer it already had is protecting space it has already promised
      // elsewhere. Refusing it would not stop the lorry — it would let us sell the same metres twice.
      expect(() => service.addOwnLoad(run.departureId, MANAGER, { customer: 'Kariuki', description: 'Cement', weightKg: 100 })).not.toThrow();
      void corridor;
    });

    it('never stops a run that is already under way from being finished', () => {
      const corridors = new CorridorService();
      const swing = { get: () => ({ jurisdiction: 'KE' }), tradingBlocks: () => [] as string[], assertMayTakeWork: () => undefined as void };
      const service = new DepartureService(corridors, swing as unknown as FleetManagerService, clearDrivers, oneTruck, new CargoService(), adopted(), openEverywhere, silentBus);
      const run = declare(service, line(corridors).corridorId);
      const { booking } = service.book(run.departureId, { shipperDid: SHIPPER, description: 'Maize', weightKg: 100 });
      service.assignDriver(run.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });

      swing.tradingBlocks = () => ['Kilima Logistics is suspended on the network'];
      swing.assertMayTakeWork = () => {
        throw new GlosError('CARRIER_NOT_TRADING', 'no');
      };

      /*
       * THE HALF THAT MATTERS MOST. Suspension is about new commitments; the cargo already on the lorry
       * is the shipper's, and a gate that stopped delivery would strand their goods and lose the
       * delivery signature — punishing them for their carrier's paperwork.
       */
      expect(() => service.setStatus(run.departureId, 'departed', MANAGER)).not.toThrow();
      expect(() =>
        service.deliver(run.departureId, booking.bookingId, MANAGER, {
          receiverName: 'Otieno',
          photoRef: 'med_1',
          confirmed: requiredUnloadKeys(),
        }),
      ).not.toThrow();
      expect(service.require(run.departureId).bookings[0].status).toBe('delivered');
    });
  });
});

/**
 * THE THIRD DOOR: WHICH TRUCK.
 *
 * capacityKg was a bare number somebody typed, so a fleet could publish forty tonnes on a van and nothing
 * anywhere would say otherwise — while everywhere else in this product capacity is derived from a
 * registered vehicle with a body class. A run was the one place it was invented.
 *
 * The DRIVER stays optional and the VEHICLE does not, and that asymmetry is the point: who is behind the
 * wheel on Tuesday is a rostering detail, and which vehicle is going IS the offer.
 */
describe('the vehicle a run is sold on', () => {
  const MANAGER = 'did:glos:fleet-veh';
  const managers = { get: () => ({ jurisdiction: 'KE' }), tradingBlocks: () => [], assertMayTakeWork: () => undefined } as unknown as FleetManagerService;
  const clearDrivers = { canOperate: () => true, offRoadReasons: () => [] } as unknown as DriverService;
  const openEverywhere = { can: () => true } as unknown as PresenceService;
  const silent = { publish: async () => undefined } as unknown as EventBus;

  const VAN = { vehicleId: 'veh_van', plate: 'KDA 111V', vehicleClass: 'van', capacityKg: 1200, managerDid: MANAGER, status: 'ACTIVE' };

  let lanes = 0;
  const setUp = (vehicles: Partial<VehicleService>) => {
    lanes += 1;
    const corridors = new CorridorService();
    const service = new DepartureService(corridors, managers, clearDrivers, vehicles as VehicleService, new CargoService(), adopted(), openEverywhere, silent);
    const proposed = corridors.proposeLine({ managerDid: MANAGER, company: 'Veh Fleet', name: `Veh line ${lanes}`, originZone: `Veh A${lanes}`, destZone: `Veh B${lanes}`, vehicleType: 'truck' });
    return { service, corridorId: corridors.publish(proposed.corridorId, 'did:glos:network-staff').corridorId };
  };
  const good = { get: () => VAN, isUsable: () => true, offRoadReasons: () => [] } as unknown as VehicleService;
  const declare = (service: DepartureService, corridorId: string, capacityKg?: number) =>
    service.declare({ managerDid: MANAGER, corridorId, vehicleId: 'veh_van', leavesAt: new Date(Date.now() + 86_400_000).toISOString(), basis: 'per_trip', amount: 450, ...(capacityKg != null ? { capacityKg } : {}) });

  it('will not sell more than the vehicle holds', () => {
    const { service, corridorId } = setUp(good);
    // The defect in one line: forty tonnes on a van.
    expect(() => declare(service, corridorId, 40000)).toThrow(/KDA 111V holds 1200 kg — you cannot sell 40000 kg on it/);
  });

  it('takes the vehicle’s own capacity when the fleet does not say', () => {
    const { service, corridorId } = setUp(good);
    expect(declare(service, corridorId).capacityKg).toBe(1200);
  });

  it('lets a fleet sell LESS than the whole truck, which is a real choice', () => {
    const { service, corridorId } = setUp(good);
    expect(declare(service, corridorId, 800).capacityKg).toBe(800);
  });

  it('stamps the plate and the class, so a screen can say which truck', () => {
    const { service, corridorId } = setUp(good);
    expect(declare(service, corridorId)).toMatchObject({ vehicleId: 'veh_van', plate: 'KDA 111V', vehicleClass: 'van' });
  });

  it('tells a shipper the class and never the plate', () => {
    const { service, corridorId } = setUp(good);
    declare(service, corridorId);
    const [offer] = service.offers();
    // The class changes what a shipper can send. The plate is the fleet's own business.
    expect(offer.vehicleClass).toBe('van');
    expect(JSON.stringify(offer)).not.toContain('KDA 111V');
  });

  it('refuses somebody else’s vehicle', () => {
    const theirs = { get: () => ({ ...VAN, managerDid: 'did:glos:other-fleet' }), isUsable: () => true, offRoadReasons: () => [] } as unknown as VehicleService;
    const { service, corridorId } = setUp(theirs);
    expect(() => declare(service, corridorId)).toThrow(/not one of your vehicles/);
  });

  it('refuses a vehicle that is off the road, and names the paper', () => {
    const lapsed = { get: () => VAN, isUsable: () => false, offRoadReasons: () => ['Insurance lapsed 3 Sep 2026'] } as unknown as VehicleService;
    const { service, corridorId } = setUp(lapsed);
    // Same shape as the coupling's refusal: an office can act on a named paper before the truck is due out.
    expect(() => declare(service, corridorId)).toThrow(/KDA 111V is off the road: Insurance lapsed 3 Sep 2026/);
  });

  it('says something useful for a vehicle with no lapsed paper but no standing either', () => {
    const parked = { get: () => ({ ...VAN, status: 'RETIRED' }), isUsable: () => false, offRoadReasons: () => [] } as unknown as VehicleService;
    const { service, corridorId } = setUp(parked);
    expect(() => declare(service, corridorId)).toThrow(/KDA 111V is RETIRED — it cannot take a run/);
  });
});

/**
 * HOW THE SHIPPER PAYS — gap 7b, and the gap was NOT "nothing is invoiced".
 *
 * Board freight is priced BY us and books a payable to the carrier at delivery, because the shipper paid
 * us. A departure is the fleet's own price agreed directly, so money we never collected must not become a
 * liability we pretend to hold. Inventing a receivable here would have been the wrong fix to a real
 * problem — the real problem being that a shipper agreed 450 on our screens and nothing told them who to
 * pay, when, or how.
 *
 * So: a record, never a posting. What is asserted here is that it is CARRIED to both sides, because terms
 * a shipper cannot read before booking are terms they were never told.
 */
describe('how the shipper pays the fleet', () => {
  const MANAGER = 'did:glos:fleet-pay';
  const SHIPPER = 'did:glos:shipper-pay';
  const managers = { get: () => ({ jurisdiction: 'KE' }), tradingBlocks: () => [], assertMayTakeWork: () => undefined } as unknown as FleetManagerService;
  const clearDrivers = { canOperate: () => true, offRoadReasons: () => [] } as unknown as DriverService;
  const openEverywhere = { can: () => true } as unknown as PresenceService;
  const silent = { publish: async () => undefined } as unknown as EventBus;
  const truck = { get: () => ({ vehicleId: 'veh_p', plate: 'KDA 900P', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE' }), isUsable: () => true, offRoadReasons: () => [] } as unknown as VehicleService;

  let lanes = 0;
  const setUp = () => {
    lanes += 1;
    const corridors = new CorridorService();
    const service = new DepartureService(corridors, managers, clearDrivers, truck, new CargoService(), adopted(), openEverywhere, silent);
    const proposed = corridors.proposeLine({ managerDid: MANAGER, company: 'Pay Fleet', name: `Pay line ${lanes}`, originZone: `Pay A${lanes}`, destZone: `Pay B${lanes}`, vehicleType: 'truck' });
    return { service, corridorId: corridors.publish(proposed.corridorId, 'did:glos:network-staff').corridorId };
  };
  const declare = (service: DepartureService, corridorId: string, over: Record<string, unknown> = {}) =>
    service.declare({ managerDid: MANAGER, corridorId, vehicleId: 'veh_p', leavesAt: new Date(Date.now() + 86_400_000).toISOString(), basis: 'per_trip', amount: 450, ...over });

  it('reaches the shipper BEFORE they book, like the waiting terms', () => {
    const { service, corridorId } = setUp();
    declare(service, corridorId, { settleMethod: 'mobile_money', settleWhen: 'on_delivery' });
    expect(service.offers()[0].settle).toEqual({ method: 'mobile_money', when: 'on_delivery' });
  });

  it('is still on the booking afterwards, when the offer is long gone', () => {
    const { service, corridorId } = setUp();
    const run = declare(service, corridorId, { settleMethod: 'cash', settleWhen: 'on_pickup' });
    service.book(run.departureId, { shipperDid: SHIPPER, description: 'Maize', weightKg: 100 });
    expect(service.forShipper(SHIPPER)[0].settle).toEqual({ method: 'cash', when: 'on_pickup' });
  });

  it('takes both halves or neither, because each alone is half a sentence', () => {
    const { service, corridorId } = setUp();
    expect(() => declare(service, corridorId, { settleMethod: 'cash' })).toThrow(/Say when you are paid/);
    const second = setUp();
    expect(() => declare(second.service, second.corridorId, { settleWhen: 'on_delivery' })).toThrow(/Say how you take payment/);
  });

  it('refuses a method or a moment nobody agreed on', () => {
    const { service, corridorId } = setUp();
    expect(() => declare(service, corridorId, { settleMethod: 'bitcoin', settleWhen: 'on_delivery' })).toThrow(/Say how you take payment/);
    const second = setUp();
    expect(() => declare(second.service, second.corridorId, { settleMethod: 'cash', settleWhen: 'whenever' })).toThrow(/Say when you are paid/);
  });

  it('leaves a run declared before any of this existed simply unanswered', () => {
    // Absent is a real state, and a screen reading it says the fleet has not said — never a guess about
    // somebody else's business.
    const { service, corridorId } = setUp();
    declare(service, corridorId);
    expect(service.offers()[0].settle).toBeUndefined();
  });
});
