import { EventBus } from '../../foundation/events/event-bus.service';
import { NotificationService } from './notification.service';
import { OutboxPushSender } from './push-sender';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { DepartureService } from './departure.service';
import { CorridorService } from './corridor.service';
import { CargoService } from './cargo.service';
import { RouteConstraintService } from './route-constraint.service';
import type { AgentService } from './agent.service';
import type { DispatchService } from './dispatch.service';
import type { DriverService } from './driver.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { FleetService } from './fleet.service';
import type { MdpService } from './mdp.service';
import type { MediaService } from './media.service';
import type { ParcelService } from './parcel.service';
import type { PersonService } from './person.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { ToteService } from './tote.service';
import type { UnclaimedService } from './unclaimed.service';
import type { VehicleService } from './vehicle.service';
import type { VendorService } from './vendor.service';

/**
 * CALLING OFF A WHOLE RUN — WHY, AND WHAT EACH REASON SETS MOVING.
 *
 * The reasons are not alike, and what the system does next depends on what each is ABOUT (user, 2026-09-30:
 * "the multiple choice might need to trigger an action for the system as well. road closure has a whole
 * different impact"). A breakdown is about THIS carrier: other trucks on the route still go, so the shipper is
 * pointed at them. A closed road is about the ROUTE: every truck there meets it, so pointing them at another run
 * would send them into the same closure — and the closure goes onto the hazard map through the ordinary report
 * procedure, never on the carrier's word alone. A closed border waits in front of staff.
 *
 * And before any of it, the kind thing: put another truck on the run instead. Final either way — "the choice
 * should be hard, not another half decided pending".
 *
 * Wired across the seam: the real run service, the real hazard map, the real dispatcher and inbox on one bus.
 */
describe('a carrier calling off a whole run', () => {
  const MANAGER = 'did:glos:fleet-off';
  const SHIPPER = 'did:glos:shipper-off';
  const OTHER_FLEET = 'did:glos:someone-else';
  const DRIVER = 'did:glos:driver-off';
  const HERE = { lat: -1.52, lng: 37.26 };

  type Truck = { vehicleId: string; plate: string; vehicleClass: string; capacityKg: number; managerDid: string; status: string; coldChain?: boolean; usable?: boolean };
  const FLEET_TRUCKS: Record<string, Truck> = {
    veh_1: { vehicleId: 'veh_1', plate: 'KDA 001A', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE', coldChain: true },
    veh_2: { vehicleId: 'veh_2', plate: 'KDA 002B', vehicleClass: 'truck', capacityKg: 6000, managerDid: MANAGER, status: 'ACTIVE' },
    veh_van: { vehicleId: 'veh_van', plate: 'KDA 111V', vehicleClass: 'van', capacityKg: 1200, managerDid: MANAGER, status: 'ACTIVE' },
    veh_cold: { vehicleId: 'veh_cold', plate: 'KDA 333C', vehicleClass: 'truck', capacityKg: 5000, managerDid: MANAGER, status: 'ACTIVE', coldChain: true },
    veh_down: { vehicleId: 'veh_down', plate: 'KDA 404D', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE', usable: false },
    veh_theirs: { vehicleId: 'veh_theirs', plate: 'KBZ 999Z', vehicleClass: 'truck', capacityKg: 8000, managerDid: OTHER_FLEET, status: 'ACTIVE' },
  };

  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  let lanes = 0;
  const setUp = (opts: { cleared?: (cls: string) => boolean } = {}) => {
    lanes += 1;
    const events = new EventBus();
    const notifications = new NotificationService(new OutboxPushSender());
    const none = {} as never;
    new NotificationDispatcher(
      events,
      notifications,
      { list: () => [] } as unknown as ParcelService,
      none as PersonService,
      { find: () => undefined, unfinished: () => [] } as unknown as AgentService,
      { list: () => [], overHours: () => false } as unknown as FleetService,
      none as ToteService,
      none as MdpService,
      none as DispatchService,
      { sweep: () => [] } as unknown as UnclaimedService,
      none as VendorService,
    ).onModuleInit();

    const media = { adopt: () => true, anchorFreightTerminal: () => undefined, holdFreightForDispute: () => undefined } as unknown as MediaService;
    const hazards = new RouteConstraintService(media);
    const vehicles = {
      get: (id: string) => {
        const v = FLEET_TRUCKS[id];
        if (!v) throw new Error(`no vehicle ${id}`);
        return v;
      },
      isUsable: (id: string) => FLEET_TRUCKS[id]?.usable !== false,
      offRoadReasons: (id: string) => (FLEET_TRUCKS[id]?.usable === false ? ['Insurance lapsed 3 Sep 2026'] : []),
    } as unknown as VehicleService;
    const drivers = { canOperate: () => true, offRoadReasons: () => [], clearedFor: (_did: string, cls: string) => (opts.cleared ? opts.cleared(cls) : true) } as unknown as DriverService;
    const managers = { get: () => ({ jurisdiction: 'KE' }), tradingBlocks: () => [], assertMayTakeWork: () => undefined } as unknown as FleetManagerService;
    const corridors = new CorridorService();
    const runs = new DepartureService(corridors, managers, drivers, vehicles, new CargoService(), media, { can: () => true } as unknown as PresenceService, events, hazards);

    const proposed = corridors.proposeLine({ managerDid: MANAGER, company: 'Kilima Logistics', name: `Nairobi – Mombasa ${lanes}`, originZone: `Nairobi ${lanes}`, destZone: `Mombasa ${lanes}`, vehicleType: 'truck' });
    const corridor = corridors.publish(proposed.corridorId, 'did:glos:network-staff');
    const declare = (vehicleId = 'veh_1', days = 1) =>
      runs.declare({ managerDid: MANAGER, corridorId: corridor.corridorId, vehicleId, leavesAt: new Date(Date.now() + days * 86_400_000).toISOString(), capacityKg: 6000, capacityM3: 40, basis: 'per_trip', amount: 450 });
    const run = declare();
    const book = (weightKg = 500, nature = 'GEN') => runs.book(run.departureId, { shipperDid: SHIPPER, description: 'Maize', weightKg, nature }).booking;

    return { runs, hazards, notifications, run, declare, book };
  };

  /* ------------------------------------------------------------------------ the reason -- */

  describe('the reason', () => {
    it('is required once somebody is aboard, and nothing changes without it', () => {
      const { runs, run, book } = setUp();
      book();
      expect(() => runs.setStatus(run.departureId, 'cancelled', MANAGER)).toThrow(/Say why you are calling it off/);
      expect(runs.require(run.departureId).status).toBe('open');
    });

    it('takes “other” only with the carrier’s own words', () => {
      const { runs, run, book } = setUp();
      book();
      expect(() => runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'other', note: '  ' })).toThrow(/needs your own words/);
      expect(runs.require(run.departureId).status).toBe('open');
    });

    it('refuses a reason that is not on the list', () => {
      const { runs, run, book } = setUp();
      book();
      expect(() => runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'felt_like_it' })).toThrow(/Unknown reason/);
    });

    it('is not asked of a fleet tidying away a run nobody booked', () => {
      const { runs, run } = setUp();
      expect(runs.setStatus(run.departureId, 'cancelled', MANAGER).status).toBe('cancelled');
    });

    it('is kept coded for the apps, and as a sentence for the consignment note', () => {
      const { runs, run, book } = setUp();
      book();
      const off = runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'vehicle_unavailable', note: 'Gearbox went at Mtito Andei' });
      expect(off.cancellation).toMatchObject({ reason: 'vehicle_unavailable', note: 'Gearbox went at Mtito Andei' });
      expect(off.cancelledReason).toBe('The truck is off the road — Gearbox went at Mtito Andei');
    });

    it('still reads a bare sentence as “other, in these words”', () => {
      const { runs, run, book } = setUp();
      book();
      const off = runs.setStatus(run.departureId, 'cancelled', MANAGER, 'The truck threw a rod');
      expect(off.cancellation).toMatchObject({ reason: 'other', note: 'The truck threw a rod' });
      expect(off.cancelledReason).toBe('The truck threw a rod');
    });
  });

  /* ------------------------------------------------------------------ where it ends -- */

  describe('once it is off, or gone', () => {
    it('keeps the reason the shippers were given: calling it off again rewrites nothing and files nothing', async () => {
      const { runs, hazards, notifications, run, book } = setUp();
      book();
      runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'road_closed', note: 'Bridge out', closure: HERE });
      const again = runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'border_closed', note: 'Changed my mind', closure: { lat: -3.99, lng: 39.6 } });
      await settle();

      expect(again.cancellation).toMatchObject({ reason: 'road_closed', note: 'Bridge out' });
      expect(again.cancelledReason).toBe('The road is closed — Bridge out');
      expect(hazards.near({ lat: -3.99, lng: 39.6 }, 5)).toHaveLength(0);
      expect(notifications.inboxFor(SHIPPER)).toHaveLength(1);
    });

    it('will not reopen a run whose shippers were told to find another truck', () => {
      const { runs, run, book } = setUp();
      book();
      runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'no_driver' });
      for (const status of ['open', 'closed', 'departed'] as const) {
        expect(() => runs.setStatus(run.departureId, status, MANAGER)).toThrow(/called off and stays off/);
      }
      expect(runs.require(run.departureId).status).toBe('cancelled');
    });

    it('will not call off a run that has left — the goods are on it, and “not collected” would be untrue', async () => {
      const { runs, notifications, run, book } = setUp();
      book();
      runs.setStatus(run.departureId, 'departed', MANAGER);
      expect(() => runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'vehicle_unavailable' })).toThrow(/has gone — the goods are on it/);
      expect(() => runs.setStatus(run.departureId, 'open', MANAGER)).toThrow(/has gone/);
      await settle();
      expect(runs.require(run.departureId)).toMatchObject({ status: 'departed' });
      expect(runs.require(run.departureId).cancellation).toBeUndefined();
      expect(notifications.inboxFor(SHIPPER).filter((n) => /not happening/.test(n.body))).toHaveLength(0);
    });
  });

  /* ----------------------------------------------------- what the shipper is told to do -- */

  describe('what the shipper is told to do next', () => {
    it('after a breakdown: find another truck — and how many runs on this route are open', async () => {
      const { runs, notifications, run, declare, book } = setUp();
      declare('veh_2', 2); // the fleet's other run on the same route, still open
      book();
      runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'vehicle_unavailable' });
      await settle();

      const body = notifications.inboxFor(SHIPPER)[0].body;
      expect(body).toBe('The run you booked space on is not happening: the truck is off the road. Your goods were not collected — you will need another truck. One other run on this route is open for booking.');
    });

    it('after a closed road: NOT sent to another run on the same road', async () => {
      const { runs, notifications, run, declare, book } = setUp();
      declare('veh_2', 2);
      book();
      runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'road_closed', note: 'Police closed it at Sultan Hamud' });
      await settle();

      const body = notifications.inboxFor(SHIPPER)[0].body;
      expect(body).toContain('the road is closed — “Police closed it at Sultan Hamud”');
      expect(body).toContain('Other trucks on this route meet the same closure');
      expect(body).not.toMatch(/another truck|open for booking/);
    });

    it('reads the same on the shipper’s own screen a fortnight later', () => {
      const { runs, run, declare, book } = setUp();
      declare('veh_2', 2);
      book();
      runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'no_driver' });
      const row = runs.forShipper(SHIPPER).find((b) => b.departureId === run.departureId);
      expect(row?.runCancellation).toMatchObject({ reason: 'no_driver' });
      expect(row?.alternatives).toBe(1);
    });

    it('offers no alternatives on screen when the road itself is closed', () => {
      const { runs, run, declare, book } = setUp();
      declare('veh_2', 2);
      book();
      runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'road_closed' });
      expect(runs.forShipper(SHIPPER).find((b) => b.departureId === run.departureId)?.alternatives).toBeUndefined();
    });
  });

  /* ------------------------------------------------------- closures, through the procedure -- */

  describe('a closed road or border, on the hazard map', () => {
    it('files an ordinary hazard report where the carrier put the pin, attributed to them', () => {
      const { runs, hazards, run, book } = setUp();
      book();
      const off = runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'road_closed', note: 'Bridge out', closure: HERE, reportedBy: 'did:glos:fleet-office-person' });

      const [report] = hazards.near(HERE, 1);
      expect(report).toMatchObject({ kind: 'ROAD_CLOSED', status: 'active' });
      // The run and the map point at each other.
      expect(off.cancellation?.constraintId).toBe(report.constraintId);
    });

    it('is not a shortcut: a second carrier at the same spot CORROBORATES rather than duplicating', () => {
      const first = setUp();
      first.book();
      first.runs.setStatus(first.run.departureId, 'cancelled', MANAGER, { reason: 'road_closed', closure: HERE, reportedBy: 'did:glos:a' });
      // Same map, a different reporter.
      first.hazards.report({ kind: 'ROAD_CLOSED', at: HERE, by: 'did:glos:b' });
      const [report] = first.hazards.near(HERE, 1);
      expect(report.confirmations).toBeGreaterThanOrEqual(1);
      expect(first.hazards.near(HERE, 1)).toHaveLength(1);
    });

    it('puts a closed BORDER in front of staff, disputed or not — and leaves a closed road for drivers to argue', () => {
      const { runs, hazards, run, declare, book } = setUp();
      book();
      runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'border_closed', closure: { lat: -3.99, lng: 39.6 } });
      const second = declare('veh_2', 3);
      runs.setStatus(second.departureId, 'cancelled', MANAGER, { reason: 'road_closed', closure: HERE });

      const staff = hazards.disputed().map((c) => c.kind);
      expect(staff).toContain('BORDER_CLOSED');
      expect(staff).not.toContain('ROAD_CLOSED');
    });

    it('refuses a pin that does not go with a closure — before anything changes', () => {
      const { runs, hazards, run, book } = setUp();
      book();
      expect(() => runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'vehicle_unavailable', closure: HERE })).toThrow(/goes with a road or a border/);
      expect(runs.require(run.departureId).status).toBe('open');
      expect(hazards.near(HERE, 1)).toHaveLength(0);
    });

    it('leaves no report behind when the cancellation itself is refused', () => {
      const { runs, hazards, run, book } = setUp();
      book();
      expect(() => runs.setStatus(run.departureId, 'cancelled', 'did:glos:not-theirs', { reason: 'road_closed', closure: HERE })).toThrow(/not your departure/);
      expect(hazards.near(HERE, 1)).toHaveLength(0);
    });

    it('lets a carrier who does not know WHERE still call it off honestly', () => {
      const { runs, hazards, run, book } = setUp();
      book();
      expect(runs.setStatus(run.departureId, 'cancelled', MANAGER, { reason: 'road_closed' }).status).toBe('cancelled');
      expect(hazards.near(HERE, 50)).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------ the kind thing: another truck -- */

  describe('putting another truck on the run instead', () => {
    it('is done at once and completely — no request, nothing pending', () => {
      const { runs, run, book } = setUp();
      book(500);
      const swapped = runs.swapVehicle(run.departureId, MANAGER, 'veh_2');
      expect(swapped).toMatchObject({ vehicleId: 'veh_2', plate: 'KDA 002B', vehicleClass: 'truck', status: 'open' });
      // What was offered is kept — 6000 kg fits a 6000 kg truck.
      expect(swapped.capacityKg).toBe(6000);
    });

    it('cuts what is offered to what the new truck holds, never below what is booked', () => {
      const { runs, run, book } = setUp();
      book(900);
      const swapped = runs.swapVehicle(run.departureId, MANAGER, 'veh_van');
      expect(swapped.capacityKg).toBe(1200);
      expect(runs.remaining(swapped).kg).toBe(300);
    });

    it('refuses a truck too small for what shippers have already booked, and changes nothing', () => {
      const { runs, run, book } = setUp();
      book(2000);
      expect(() => runs.swapVehicle(run.departureId, MANAGER, 'veh_van')).toThrow(/holds 1200 kg — 2000 kg is already booked/);
      expect(runs.require(run.departureId).plate).toBe('KDA 001A');
    });

    it('refuses a truck that cannot carry what is aboard', () => {
      const { runs, run, book } = setUp();
      book(300, 'FOP'); // perishable food, on the cold-chain truck
      expect(() => runs.swapVehicle(run.departureId, MANAGER, 'veh_2')).toThrow(/does not carry cold chain — Maize on this run needs/);
      expect(runs.swapVehicle(run.departureId, MANAGER, 'veh_cold').plate).toBe('KDA 333C');
    });

    it('refuses a driver who is not cleared to drive the new one — put another driver on first', () => {
      const { runs, run } = setUp({ cleared: (cls) => cls === 'truck' });
      runs.assignDriver(run.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });
      expect(() => runs.swapVehicle(run.departureId, MANAGER, 'veh_van')).toThrow(/Wanjiru is not cleared to drive a van/);
    });

    it('refuses somebody else’s truck, one off the road, the same truck, and a run that has left', () => {
      const { runs, run } = setUp();
      expect(() => runs.swapVehicle(run.departureId, MANAGER, 'veh_theirs')).toThrow(/not one of your vehicles/);
      expect(() => runs.swapVehicle(run.departureId, MANAGER, 'veh_down')).toThrow(/off the road: Insurance lapsed/);
      expect(() => runs.swapVehicle(run.departureId, MANAGER, 'veh_1')).toThrow(/already the truck on this run/);
      runs.setStatus(run.departureId, 'departed', MANAGER);
      expect(() => runs.swapVehicle(run.departureId, MANAGER, 'veh_2')).toThrow(/only change before it leaves/);
    });

    it('tells shippers only when what THEY can see changed — the class, never the plate', async () => {
      const truckForTruck = setUp();
      truckForTruck.book(500);
      truckForTruck.runs.swapVehicle(truckForTruck.run.departureId, MANAGER, 'veh_2');
      await settle();
      expect(truckForTruck.notifications.inboxFor(SHIPPER)).toHaveLength(0);

      const truckForVan = setUp();
      truckForVan.book(500);
      truckForVan.runs.swapVehicle(truckForVan.run.departureId, MANAGER, 'veh_van');
      await settle();
      const [told] = truckForVan.notifications.inboxFor(SHIPPER);
      expect(told.body).toContain('it now goes on a van instead of a truck. Your booking stands.');
      expect(told.body).not.toContain('KDA');
    });
  });
});
