import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { RoutingService } from './routing.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { VendorService } from './vendor.service';
import { ParcelService } from './parcel.service';
import { ToteService } from './tote.service';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { DispatchService } from './dispatch.service';
import { RouteConstraintService } from './route-constraint.service';
import { WalletGateService } from './wallet-gate.service';
import { CargoService } from './cargo.service';
import { MediaService } from './media.service';
import { MarketPulseStore } from './market-pulse.store';
import { MarketPulseService } from './market-pulse.service';
import { RatingService } from './rating.service';
import { MonitorService } from './monitor.service';
import { GraduationService } from './graduation.service';
import { VendorCallbackService } from './vendor-callback.service';
import { ConsignmentService } from './consignment.service';
import { BagPlanService } from './bag-plan.service';
import { ForthcomingService } from './forthcoming.service';
import { DockService } from './dock.service';
import { FleetManagerService } from './fleet-manager.service';
import { DepartureService } from './departure.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { CarriageContractService, CONTRACT_LINK_TRIES_PER_HOUR, isDay } from './carriage-contract.service';
import { GazetteerGeocoder, GEOCODER, type Geocoder } from './geocoder';
import { OrderImportService } from './order-import.service';
import { HeuristicRouter, ROUTER } from './router';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { BooksService } from '../../foundation/books/books.service';
import { FxService } from '../../foundation/money/fx.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { SandboxPayoutRail } from '../../foundation/payouts/sandbox-rail.adapter';
import { PAYOUT_RAIL } from '../../foundation/payouts/payout.types';
import type { AgentService as Agents } from './agent.service';
import type { ImportService } from './import.service';
import type { ContractRef } from './carriage-contract.types';

import { FleetPlanService } from './fleet-plan.service';
import type { RoadDistances, RoadMatrix } from './road-matrix';
import { ROUTER as ROUTER_TOKEN, type Router } from './router';
import { requiredLoadKeys, requiredUnloadKeys } from './heavy-cargo';
import { GlosError } from '../../foundation/http/glos-error';

const DAY = 86_400_000;

/**
 * P3 — A FLEET'S PLAN FOR A DAY, on the real orders, trucks and drivers. The arithmetic has its own spec; what is
 * pinned here is everything round it: which orders and trucks go into the math, that names and clock times come out,
 * that a proposal changes nothing, that accepting writes the plan onto its orders, and that the day moving on under an
 * accepted plan is said.
 */
describe('a fleet’s plan for a day', () => {
  let dispatch: DispatchService;
  let drivers: DriverService;
  let vehicles: VehicleService;
  let managers: FleetManagerService;
  let plans: FleetPlanService;
  /** The same service, with a routing server to ask. */
  let withRoads: (roads: RoadMatrix) => FleetPlanService;
  let heuristic: Router;
  let fleetSvc: FleetService;
  let seq = 0;
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [
          AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
          GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
          BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
          DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
          DepartureService, MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
          ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
          WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
          EntityService, PresenceService, BooksService, FxService,
          PayoutService, SandboxPayoutRail, { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail },
          { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
          GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
          HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
        ],
      }).compile();
    moduleRef.get(EntityService).seed();
    moduleRef.get(FxService).seed();
    dispatch = moduleRef.get(DispatchService);
    drivers = moduleRef.get(DriverService);
    vehicles = moduleRef.get(VehicleService);
    managers = moduleRef.get(FleetManagerService);
    fleetSvc = moduleRef.get(FleetService);
    plans = new FleetPlanService(dispatch, vehicles, drivers, managers, moduleRef.get<Router>(ROUTER_TOKEN), fleetSvc, moduleRef.get(EventBus));
    plans.onModuleInit();
    heuristic = moduleRef.get<Router>(ROUTER_TOKEN);
    withRoads = (roads) => new FleetPlanService(dispatch, vehicles, drivers, managers, heuristic, fleetSvc, moduleRef.get(EventBus), roads);
  });

  const depot = { lat: -1.2, lng: 36.8 };
  const yard = { lat: -1.3, lng: 36.85 };
  const site = (n: number) => ({ lat: -1.25 + n * 0.02, lng: 36.9 + n * 0.02 });
  const dayPlus = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  const tomorrow = () => dayPlus(1);

  function aFleet(name: string) {
    seq += 1;
    const m = managers.register({
      companyName: name, contactPhone: `+25480030${seq}0`, ownerFullName: 'O O', ownerNationalId: `MGR-PL-${seq}`,
      location: depot,
      requirements: { businessRegistrationNo: `BRN-PL-${seq}`, transportOperatorLicence: `TOL-PL-${seq}`, taxId: `TAX-PL-${seq}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    return managers.get(m.did);
  }
  function aDriver(managerDid: string) {
    seq += 1;
    const d = drivers.register({
      displayName: `Driver ${seq}`, fullName: `D ${seq}`, nationalId: `ID-PL-${seq}`, mobile: `+2547830${seq}00`,
      licenceClasses: ['truck'], licenceNumber: `L-PL-${seq}`, licenceExpiresAt: new Date(Date.now() + 365 * DAY).toISOString(), criminalRecordClear: true, managerDid,
    });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    return drivers.get(d.did);
  }
  function aTruck(managerDid: string, plate: string, capacityKg: number, equipment: string[] = ['TLT', 'FLT']) {
    return vehicles.register({ plate, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg, ownerName: 'X', equipment, baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid } as never);
  }
  const contractOf = (fleet: { did: string; companyName: string }): ContractRef => ({ contractId: 'ctr_plan', fleetDid: fleet.did, fleetName: fleet.companyName, shipperName: 'Jenga Bricks' });
  function anOrder(fleet: { did: string; companyName: string }, over: { kg?: number; n?: number; day?: string; pinned?: boolean; ref?: string; window?: string; indivisible?: boolean } = {}) {
    seq += 1;
    return dispatch.registerFreight({
      description: `Bricks ${seq}`, pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: `Site ${over.n ?? seq}`,
      ...(over.pinned === false ? {} : { destLocation: site(over.n ?? 1) }),
      weightKg: over.kg ?? 2000, packaging: 'palletised', postedByDid: fleet.did, postedByName: 'Amina', contract: contractOf(fleet), deliverOn: over.day ?? tomorrow(), orderRef: over.ref ?? `WS-${seq}`,
      ...(over.window ? { deliveryWindow: over.window } : {}),
      ...(over.indivisible ? { indivisible: true } : {}),
    });
  }
  /** A fleet with an 8 t and a 3 t truck and two drivers. */
  function setUp() {
    const fleet = aFleet('Kilima Logistics');
    const big = aTruck(fleet.did, 'KPL 008T', 8000);
    const small = aTruck(fleet.did, 'KPL 003T', 3000);
    aDriver(fleet.did);
    aDriver(fleet.did);
    return { fleet, big, small };
  }

  it('puts names, trucks and clock times on the math, and changes nothing by proposing', () => {
    const { fleet, big } = setUp();
    const a = anOrder(fleet, { kg: 3000, n: 1 });
    const b = anOrder(fleet, { kg: 3000, n: 2 });
    const plan = plans.propose(fleet.did, { day: tomorrow(), dayStart: '06:30' });
    expect(plan.accepted).toBeUndefined();
    expect(plan.unplanned).toEqual([]);
    expect(plan.routes).toHaveLength(1);
    const [route] = plan.routes;
    // Six tonnes from one yard: one round on the 8 t truck, not two trucks.
    expect(route).toMatchObject({ vehicleId: big.vehicleId, plate: 'KPL 008T', capacityKg: 8000, weightKg: 6000, fullestPct: 75 });
    expect(route.trips).toHaveLength(1);
    expect(route.trips[0]).toMatchObject({ no: 1, pickupLabel: 'Jenga yard', weightKg: 6000 });
    expect(route.trips[0].stops.map((s) => s.code).sort()).toEqual([a.code, b.code].sort());
    expect(route.trips[0].stops[0]).toMatchObject({ shipperName: 'Jenga Bricks', weightKg: 3000 });
    // Clock times, counted from when the fleet says its day starts, in order.
    const times = [route.trips[0].start, ...route.trips[0].stops.map((s) => s.arrive), route.trips[0].end, route.home];
    expect(times.every((t) => /^\d{2}:\d{2}$/.test(t))).toBe(true);
    expect([...times].sort()).toEqual(times);
    expect(route.trips[0].start >= '06:30').toBe(true);
    expect(plan.totals).toMatchObject({ orders: 2, planned: 2, weightKg: 6000, plannedKg: 6000, trucksUsed: 1, trucksAvailable: 2, drivers: 2 });
    expect(plan.totals.km).toBeGreaterThan(0);
    expect(plan.settings).toMatchObject({ dayStart: '06:30', dayHours: 10 });
    expect(plan.vehicles.map((v) => [v.plate, v.excluded])).toEqual([
      ['KPL 008T', false],
      ['KPL 003T', false],
    ]);
    // A proposal is only that: no order has been told anything.
    expect(dispatch.ordersForFleet(fleet.did).every((o) => o.planned === undefined)).toBe(true);
  });

  it('plans only this fleet’s orders for this day that are still without a truck', () => {
    const { fleet } = setUp();
    const other = aFleet('Pwani Haulage');
    aTruck(other.did, 'PWN 001T', 8000);
    aDriver(other.did);
    const mine = anOrder(fleet);
    anOrder(fleet, { day: dayPlus(2) });
    anOrder(other);
    const gone = anOrder(fleet);
    dispatch.withdrawUploadedOrder(fleet.did, gone.freightId, 'Uploaded twice');
    const plan = plans.propose(fleet.did, { day: tomorrow() });
    expect(plan.totals.orders).toBe(1);
    expect(plan.routes.flatMap((r) => r.trips.flatMap((t) => t.stops.map((s) => s.freightId)))).toEqual([mine.freightId]);
  });

  it('hands back what cannot be planned, each with its reason: no point on the map, no truck that can handle it, too heavy', () => {
    const fleet = aFleet('Kilima Logistics');
    aTruck(fleet.did, 'KPL 003T', 3000, ['MAN']);
    aDriver(fleet.did);
    const lost = anOrder(fleet, { kg: 20, pinned: false });
    const pallets = anOrder(fleet, { kg: 2000 });
    const giant = anOrder(fleet, { kg: 20, n: 3 });
    const plan = plans.propose(fleet.did, { day: tomorrow() });
    const why = new Map(plan.unplanned.map((u) => [u.freightId, u.reason]));
    expect(why.get(lost.freightId)).toBe('no_pin');
    // Two tonnes on pallets wants a tail lift or a forklift; this truck has hands only.
    expect(why.get(pallets.freightId)).toBe('no_truck_can_carry');
    expect(why.has(giant.freightId)).toBe(false);
    expect(plan.totals).toMatchObject({ orders: 3, planned: 1 });
    expect(plan.unplanned.find((u) => u.freightId === lost.freightId)).toMatchObject({ code: lost.code, shipperName: 'Jenga Bricks' });
  });

  it('leaves out a truck the office leaves out, and one that is off the road — and says which is which', () => {
    const { fleet, big, small } = setUp();
    anOrder(fleet, { kg: 2000 });
    const without = plans.propose(fleet.did, { day: tomorrow(), excludeVehicleIds: [big.vehicleId] });
    expect(without.routes.map((r) => r.plate)).toEqual(['KPL 003T']);
    expect(without.vehicles.find((v) => v.vehicleId === big.vehicleId)).toMatchObject({ excluded: true });
    expect(without.totals.trucksAvailable).toBe(1);
    vehicles.ground(small.vehicleId);
    const grounded = plans.propose(fleet.did, { day: tomorrow(), excludeVehicleIds: [big.vehicleId] });
    expect(grounded.routes).toEqual([]);
    expect(grounded.vehicles.find((v) => v.vehicleId === small.vehicleId)!.offRoad).toEqual(['Marked grounded']);
    expect(grounded.unplanned[0].reason).toBe('no_trucks');
  });

  it('sends out no more trucks than there are drivers, and counts the trucks to hire for what is left', () => {
    const fleet = aFleet('Kilima Logistics');
    aTruck(fleet.did, 'KPL 005A', 5000);
    aTruck(fleet.did, 'KPL 005B', 5000);
    aDriver(fleet.did);
    // Each order fills a truck. The day is made just long enough for ONE round, measured rather than guessed.
    const pace = { speedKmh: 30, loadMin: 5, unloadMin: 5 };
    anOrder(fleet, { kg: 4000, n: 1 });
    const oneRound = plans.propose(fleet.did, { day: tomorrow(), ...pace, dayHours: 13 }).routes[0].minutes;
    anOrder(fleet, { kg: 4000, n: 1 });
    anOrder(fleet, { kg: 4000, n: 1 });
    const plan = plans.propose(fleet.did, { day: tomorrow(), ...pace, dayHours: (oneRound + 5) / 60 });
    expect(plan.totals).toMatchObject({ trucksUsed: 1, trucksAvailable: 2, drivers: 1, planned: 1 });
    expect(plan.unplanned.map((u) => u.reason)).toEqual(['no_driver', 'no_driver']);
    expect(plan.hire).toEqual({ trucks: 2, orders: 2, weightKg: 8000, capacityKg: 5000 });
  });

  it('writes an accepted plan onto its orders, keeps it as accepted, and says how the day has moved on since', () => {
    const { fleet } = setUp();
    const a = anOrder(fleet, { kg: 3000, n: 1 });
    const b = anOrder(fleet, { kg: 3000, n: 2 });
    expect(plans.state(fleet.did, tomorrow())).toEqual({ day: tomorrow(), leftOut: 0, newSince: 0, withdrawnSince: 0 });
    const kept = plans.accept(fleet.did, { day: tomorrow() }, 'Amina');
    expect(kept.accepted).toMatchObject({ by: 'Amina' });
    const rows = dispatch.ordersForFleet(fleet.did);
    expect(rows.map((r) => r.planned?.plate)).toEqual(['KPL 008T', 'KPL 008T']);
    expect(rows.map((r) => r.planned?.seq).sort()).toEqual([1, 2]);
    expect(rows[0].planned).toMatchObject({ day: tomorrow(), tripNo: 1 });
    // Still without a driver: a plan is a plan, not an assignment.
    expect(rows.every((r) => r.status === 'ordered')).toBe(true);

    // The day moves on: one more order comes in, one in the plan is withdrawn.
    anOrder(fleet, { kg: 500, n: 3 });
    dispatch.withdrawUploadedOrder(fleet.did, b.freightId, 'Customer cancelled');
    const state = plans.state(fleet.did, tomorrow());
    expect(state).toMatchObject({ leftOut: 0, newSince: 1, withdrawnSince: 1 });
    // The accepted plan is a record: it still shows both orders, exactly as accepted.
    expect(state.plan!.accepted!.by).toBe('Amina');
    expect(state.plan!.totals.planned).toBe(2);
    expect(state.plan!.routes[0].trips[0].stops.map((s) => s.freightId).sort()).toEqual([a.freightId, b.freightId].sort());
  });

  it('replaces the day’s plan when it is accepted again, and takes the truck off an order the new plan leaves out', () => {
    const { fleet, big } = setUp();
    const heavy = anOrder(fleet, { kg: 6000, n: 1 });
    const light = anOrder(fleet, { kg: 1000, n: 2 });
    plans.accept(fleet.did, { day: tomorrow() }, 'Amina');
    const plateOf = (id: string) => dispatch.ordersForFleet(fleet.did).find((r) => r.freightId === id)!.planned?.plate;
    expect(plateOf(heavy.freightId)).toBe('KPL 008T');
    // The 8 t truck goes to the workshop: the six-tonne order fits nothing else.
    const again = plans.accept(fleet.did, { day: tomorrow(), excludeVehicleIds: [big.vehicleId] }, 'Baraka');
    expect(again.accepted!.by).toBe('Baraka');
    expect(plateOf(light.freightId)).toBe('KPL 003T');
    expect(plateOf(heavy.freightId)).toBeUndefined();
    // The plan handed that order back itself: it is left out, not news.
    expect(plans.state(fleet.did, tomorrow())).toMatchObject({ leftOut: 1, newSince: 0 });
  });

  /* ------------------------------------------------------------ the rules -- */

  /**
   * P5 — A RULE THE OFFICE PUTS ON A PLAN: one order kept off one vehicle, or put on one. What the adviser changes when
   * a dispatcher says "not on that truck" — and what a dispatcher can read back and check.
   */
  describe('rules on a plan', () => {
    const truckOf = (plan: { routes: Array<{ plate: string; trips: Array<{ stops: Array<{ freightId: string }> }> }> }, freightId: string) => plan.routes.find((r) => r.trips.some((t) => t.stops.some((st) => st.freightId === freightId)))?.plate;

    it('keeps an order off a vehicle, puts one on a vehicle, and names each rule on the plan', () => {
      const { fleet, big, small } = setUp();
      const a = anOrder(fleet, { kg: 2000, n: 1 });
      const b = anOrder(fleet, { kg: 2000, n: 2 });
      const free = plans.propose(fleet.did, { day: tomorrow() });
      // Left to itself the math puts both on the big truck, in one round.
      expect([truckOf(free, a.freightId), truckOf(free, b.freightId)]).toEqual(['KPL 008T', 'KPL 008T']);
      expect(free.rules).toEqual([]);

      const kept = plans.propose(fleet.did, { day: tomorrow(), keepOff: [{ freightId: a.freightId, vehicleId: big.vehicleId }] });
      expect(truckOf(kept, a.freightId)).toBe('KPL 003T');
      expect(truckOf(kept, b.freightId)).toBeDefined();
      expect(kept.rules).toEqual([{ kind: 'keep_off', freightId: a.freightId, code: a.code, vehicleId: big.vehicleId, plate: 'KPL 008T' }]);

      const put = plans.propose(fleet.did, { day: tomorrow(), putOn: [{ freightId: b.freightId, vehicleId: small.vehicleId }] });
      expect(truckOf(put, b.freightId)).toBe('KPL 003T');
      expect(put.rules).toEqual([{ kind: 'put_on', freightId: b.freightId, code: b.code, vehicleId: small.vehicleId, plate: 'KPL 003T' }]);
    });

    it('never bends a truck to a rule: an order put on a vehicle too small for it is handed back, not squeezed on', () => {
      const { fleet, small } = setUp();
      const heavy = anOrder(fleet, { kg: 6000, n: 1 });
      const plan = plans.propose(fleet.did, { day: tomorrow(), putOn: [{ freightId: heavy.freightId, vehicleId: small.vehicleId }] });
      expect(truckOf(plan, heavy.freightId)).toBeUndefined();
      expect(plan.unplanned).toEqual([expect.objectContaining({ freightId: heavy.freightId, reason: 'no_truck_can_carry' })]);
    });

    it('refuses a rule that contradicts another, or names a vehicle or an order that is not this fleet’s', () => {
      const { fleet, big, small } = setUp();
      const other = aFleet('Pwani Haulage');
      const theirs = anOrder(other);
      const theirTruck = aTruck(other.did, 'PWN 001T', 8000);
      const a = anOrder(fleet, { kg: 2000 });
      const day = tomorrow();
      expect(() => plans.propose(fleet.did, { day, putOn: [{ freightId: a.freightId, vehicleId: big.vehicleId }, { freightId: a.freightId, vehicleId: small.vehicleId }] })).toThrow(/cannot be put on two vehicles/);
      expect(() => plans.propose(fleet.did, { day, putOn: [{ freightId: a.freightId, vehicleId: big.vehicleId }], keepOff: [{ freightId: a.freightId, vehicleId: big.vehicleId }] })).toThrow(/both put on KPL 008T and kept off it/);
      expect(() => plans.propose(fleet.did, { day, keepOff: [{ freightId: a.freightId, vehicleId: theirTruck.vehicleId }] })).toThrow(/vehicle that is not in this fleet/);
      expect(() => plans.propose(fleet.did, { day, keepOff: [{ freightId: theirs.freightId, vehicleId: big.vehicleId }] })).toThrow(/order that is not yours/);
      expect(() => plans.propose(fleet.did, { day, keepOff: [{ freightId: 'frt_nonsense', vehicleId: big.vehicleId }] })).toThrow(/order that is not yours/);
    });

    it('lets a rule go with its order: one withdrawn since is no longer a rule, and no error', () => {
      const { fleet, big } = setUp();
      const a = anOrder(fleet, { kg: 2000, n: 1 });
      const gone = anOrder(fleet, { kg: 2000, n: 2 });
      dispatch.withdrawUploadedOrder(fleet.did, gone.freightId, 'Customer cancelled');
      const plan = plans.propose(fleet.did, { day: tomorrow(), keepOff: [{ freightId: gone.freightId, vehicleId: big.vehicleId }, { freightId: a.freightId, vehicleId: big.vehicleId }] });
      expect(plan.rules.map((r) => r.code)).toEqual([a.code]);
    });

    it('is kept with an accepted plan, and written onto its orders as planned', () => {
      const { fleet, big } = setUp();
      const a = anOrder(fleet, { kg: 2000, n: 1 });
      const kept = plans.accept(fleet.did, { day: tomorrow(), keepOff: [{ freightId: a.freightId, vehicleId: big.vehicleId }] }, 'Amina');
      expect(kept.rules).toHaveLength(1);
      expect(plans.state(fleet.did, tomorrow()).plan!.rules).toEqual(kept.rules);
      expect(dispatch.ordersForFleet(fleet.did).find((r) => r.freightId === a.freightId)!.planned!.plate).toBe('KPL 003T');
    });
  });

  /* ------------------------------------------------------ delivery windows -- */

  /**
   * THE WINDOW A SHIPPER ASKED FOR. The user, 2026-10-06: an order that cannot make its window is planned all the
   * same, and said to be late. What is pinned here is the layer round the math: the words are read on the office's own
   * clock, what was read is said back, what could not be read is said to be unread, and nothing is left out for it.
   */
  describe('delivery windows', () => {
    type Stop = { freightId: string; arrive: string; deliveryWindow?: string; window?: string; windowUnread?: boolean; lateMin?: number; earlyMin?: number; waitMin?: number };
    const stopOf = (plan: { routes: Array<{ trips: Array<{ stops: Stop[] }> }> }, freightId: string) => plan.routes.flatMap((r) => r.trips.flatMap((t) => t.stops)).find((s) => s.freightId === freightId)!;

    it('plans to the window on the office’s own clock: waits for a door, is late at one it cannot make, and says what it read', () => {
      const { fleet } = setUp();
      const waits = anOrder(fleet, { kg: 1000, n: 1, window: 'after 15:00' });
      const late = anOrder(fleet, { kg: 1000, n: 2, window: 'before 07:05' });
      const unread = anOrder(fleet, { kg: 1000, n: 3, window: 'morning, call first' });
      const free = anOrder(fleet, { kg: 1000, n: 4 });
      const plan = plans.propose(fleet.did, { day: tomorrow() });
      // Nothing is left out because of a window.
      expect(plan.unplanned).toEqual([]);
      expect(stopOf(plan, waits.freightId)).toMatchObject({ deliveryWindow: 'after 15:00', window: 'from 15:00', arrive: '15:00' });
      expect(stopOf(plan, waits.freightId).waitMin).toBeGreaterThan(0);
      // Five minutes after the trucks leave, a door across town: no plan can be there. It goes all the same.
      expect(stopOf(plan, late.freightId)).toMatchObject({ window: 'before 07:05' });
      expect(stopOf(plan, late.freightId).lateMin).toBeGreaterThan(0);
      expect(stopOf(plan, late.freightId).waitMin).toBeUndefined();
      // Words that are not a time: shown, said to be unread, and planned to the day only.
      const u = stopOf(plan, unread.freightId);
      expect(u).toMatchObject({ deliveryWindow: 'morning, call first', windowUnread: true });
      expect([u.window, u.lateMin, u.waitMin, u.earlyMin]).toEqual([undefined, undefined, undefined, undefined]);
      const f = stopOf(plan, free.freightId);
      expect([f.deliveryWindow, f.window, f.windowUnread, f.lateMin]).toEqual([undefined, undefined, undefined, undefined]);
      expect(plan.totals).toMatchObject({ planned: 4, outsideWindow: 1, unreadWindows: 1 });

      // The same orders with the trucks leaving two hours later: the late door is two hours later still.
      const later = plans.propose(fleet.did, { day: tomorrow(), dayStart: '09:00' });
      expect(stopOf(later, late.freightId).lateMin).toBe(stopOf(plan, late.freightId).lateMin! + 120);
    });

    it('goes to the door that closes soonest first', () => {
      const { fleet } = setUp();
      const a = anOrder(fleet, { kg: 1000, n: 1 });
      const b = anOrder(fleet, { kg: 1000, n: 6 });
      const free = plans.propose(fleet.did, { day: tomorrow() });
      const order = (plan: typeof free) => plan.routes.flatMap((r) => r.trips.flatMap((t) => t.stops.map((s) => s.freightId)));
      const [first, second] = order(free);
      expect([first, second].sort()).toEqual([a.freightId, b.freightId].sort());
      // Whichever the road reaches second is given a window that closes just before it gets there.
      const at = stopOf(free, second).arrive;
      const [h, m] = at.split(':').map(Number);
      const closes = String(h).padStart(2, '0') + ':' + String(Math.max(0, m - 5)).padStart(2, '0');
      dispatch.withdrawUploadedOrder(fleet.did, second, 'Re-ordered with a window');
      const again = anOrder(fleet, { kg: 1000, n: second === a.freightId ? 1 : 6, window: 'before ' + closes });
      const plan = plans.propose(fleet.did, { day: tomorrow() });
      expect(order(plan)).toEqual([again.freightId, first]);
      expect(stopOf(plan, again.freightId).lateMin).toBeUndefined();
      expect(plan.totals.outsideWindow).toBe(0);
    });

    it('hands over before a window opens when the day ends first — early, said as early, and still delivered', () => {
      const { fleet } = setUp();
      const a = anOrder(fleet, { kg: 1000, n: 1, window: 'after 18:00' });
      // A ten-hour day from 07:00 is over at 17:00: there is no waiting for a door that opens at 18:00.
      const plan = plans.propose(fleet.did, { day: tomorrow() });
      expect(plan.unplanned).toEqual([]);
      const s = stopOf(plan, a.freightId);
      expect(s.earlyMin).toBeGreaterThan(0);
      expect([s.waitMin, s.lateMin]).toEqual([undefined, undefined]);
      expect(plan.totals.outsideWindow).toBe(1);
      // A longer day holds the wait, and it is on time.
      const long = plans.propose(fleet.did, { day: tomorrow(), dayHours: 13 });
      expect(stopOf(long, a.freightId)).toMatchObject({ arrive: '18:00' });
      expect(stopOf(long, a.freightId).earlyMin).toBeUndefined();
      expect(long.totals.outsideWindow).toBe(0);
    });

    it('keeps what came of a window with the accepted plan, and on the order', () => {
      const { fleet } = setUp();
      const late = anOrder(fleet, { kg: 1000, n: 2, window: 'before 07:05' });
      const kept = plans.accept(fleet.did, { day: tomorrow() }, 'Amina');
      const lateMin = stopOf(kept, late.freightId).lateMin!;
      expect(lateMin).toBeGreaterThan(0);
      expect(stopOf(plans.state(fleet.did, tomorrow()).plan!, late.freightId).lateMin).toBe(lateMin);
      expect(dispatch.ordersForFleet(fleet.did).find((r) => r.freightId === late.freightId)!.planned).toMatchObject({ lateMin });
    });
  });

  /**
   * WHAT THE SHIPPER IS SHOWN. The window an accepted plan was made to is kept on the order as it was read then, so
   * what the shipper's list says does not change when the shipper rewords what it asked for.
   */
  describe('a plan that misses a window, as the order’s shipper is shown it', () => {
    it('keeps the window it was made to on the order, and shows the list about when and by how much', () => {
      const { fleet } = setUp();
      const late = anOrder(fleet, { kg: 1000, n: 2, window: 'before 07:05' });
      const fine = anOrder(fleet, { kg: 1000, n: 3 });
      const kept = plans.accept(fleet.did, { day: tomorrow() }, 'Amina');
      const stop = kept.routes.flatMap((r) => r.trips.flatMap((t) => t.stops)).find((s) => s.freightId === late.freightId)!;
      expect(stop.lateMin).toBeGreaterThan(0);
      const mine = () => dispatch.postedBy(fleet.did);
      expect(mine().find((r) => r.freightId === late.freightId)!.outsideWindow).toEqual({ day: tomorrow(), arrive: stop.arrive, window: 'before 07:05', lateMin: stop.lateMin });
      expect(mine().find((r) => r.freightId === fine.freightId)!.outsideWindow).toBeUndefined();
      // Reworded after the plan was accepted: the list still says what the plan was made to.
      dispatch.setInstructions(late.freightId, fleet.did, { deliveryWindow: 'any time' });
      expect(mine().find((r) => r.freightId === late.freightId)!.outsideWindow).toMatchObject({ window: 'before 07:05', lateMin: stop.lateMin });
      // Planned again with the trucks leaving later: the figure follows the plan that was accepted last.
      dispatch.setInstructions(late.freightId, fleet.did, { deliveryWindow: 'before 07:05' });
      plans.accept(fleet.did, { day: tomorrow(), dayStart: '09:00' }, 'Amina');
      expect(mine().find((r) => r.freightId === late.freightId)!.outsideWindow!.lateMin).toBe(stop.lateMin! + 120);
    });
  });

  /* --------------------------------------------------- an order in several loads -- */

  /**
   * AN ORDER HEAVIER THAN THE LARGEST VEHICLE. The user, 2026-10-06: the office splits it into loads, and the shipper
   * is told. The plan says how many loads it would make; the split is the office's act; each load is then an order
   * in its own right, and the order can be put back together while nothing has been done with any of them.
   */
  describe('an order in several loads', () => {
    it('is said to be so many loads of the largest vehicle — and split, each load is planned on its own', () => {
      const { fleet } = setUp();
      const heavy = anOrder(fleet, { kg: 12000, n: 1, ref: 'WS-HEAVY' });
      const before = plans.propose(fleet.did, { day: tomorrow() });
      expect(before.unplanned).toEqual([expect.objectContaining({ freightId: heavy.freightId, reason: 'too_heavy', splitInto: 2, loadKg: 8000 })]);
      expect(before.totals.planned).toBe(0);

      const loads = dispatch.splitOrder(fleet.did, heavy.freightId, [7000, 5000], 'Amina');
      expect(loads.map((l) => [l.code === heavy.code, l.weightKg, l.partOf!.no, l.partOf!.of])).toEqual([
        [true, 7000, 1, 2],
        [false, 5000, 2, 2],
      ]);
      // The order BECAME its first load: same id, same code, same tracking link.
      expect(loads[0].freightId).toBe(heavy.freightId);
      expect(loads[0].trackingKey).toBe(heavy.trackingKey);
      expect(loads[1].trackingKey).not.toBe(heavy.trackingKey);
      // The other load is the same order in everything but its weight.
      expect(loads[1]).toMatchObject({ status: 'ordered', description: heavy.description, destLabel: heavy.destLabel, deliverOn: tomorrow(), orderRef: 'WS-HEAVY', contract: heavy.contract, postedByDid: fleet.did });
      expect(loads[1].partOf).toMatchObject({ rootId: heavy.freightId, rootCode: heavy.code, orderKg: 12000, by: 'Amina' });
      // Still one order by the shipper's own number: sending the sheet again adds nothing.
      expect(dispatch.contractOrderByRef('ctr_plan', 'WS-HEAVY')).toBeDefined();

      const after = plans.propose(fleet.did, { day: tomorrow() });
      expect(after.unplanned).toEqual([]);
      expect(after.totals).toMatchObject({ orders: 2, planned: 2, plannedKg: 12000 });
      const rows = dispatch.ordersForFleet(fleet.did);
      expect(rows.map((r) => [r.code, r.weightKg, r.partOf?.no, r.partOf?.of]).sort()).toEqual(loads.map((l) => [l.code, l.weightKg, l.partOf!.no, 2]).sort());
    });

    it('can be split again, and every load of the order is numbered anew', () => {
      const { fleet } = setUp();
      const heavy = anOrder(fleet, { kg: 12000, n: 1 });
      const [, second] = dispatch.splitOrder(fleet.did, heavy.freightId, [6000, 6000], 'Amina');
      dispatch.splitOrder(fleet.did, second.freightId, [3500, 2500], 'Baraka');
      const all = dispatch.loadsOf(heavy.freightId);
      expect(all.map((l) => [l.weightKg, l.partOf!.no, l.partOf!.of, l.partOf!.orderKg, l.partOf!.rootCode])).toEqual([
        [6000, 1, 3, 12000, heavy.code],
        [3500, 2, 3, 12000, heavy.code],
        [2500, 3, 3, 12000, heavy.code],
      ]);
      // The load that was split kept its place and its code; the new one stands right after it.
      expect(all[1].freightId).toBe(second.freightId);
      // Asked of any load, the answer is the whole order.
      expect(dispatch.loadsOf(all[2].freightId).map((l) => l.freightId)).toEqual(all.map((l) => l.freightId));
    });

    it('refuses a split that does not add up, is no split, is of goods that are one piece, or is not this fleet’s to make', () => {
      const { fleet } = setUp();
      const other = aFleet('Pwani Haulage');
      const heavy = anOrder(fleet, { kg: 12000, n: 1 });
      const split = (kgs: number[], by = fleet.did, id = heavy.freightId) => () => dispatch.splitOrder(by, id, kgs, 'Amina');
      expect(split([6000, 5000])).toThrow(/must add up to what is being split: 12000 kg/);
      expect(split([12000])).toThrow(/at least two loads/);
      expect(split([])).toThrow(/at least two loads/);
      expect(split([12000, 0])).toThrow(/at least a kilo/);
      expect(split([13000, -1000])).toThrow(/at least a kilo/);
      expect(split(Array(21).fill(12000 / 21))).toThrow(/20 loads at most/);
      expect(split([6000, 6000], other.did)).toThrow(/No such order/);
      expect(split([6000, 6000], fleet.did, 'frt_nonsense')).toThrow(/No such order/);
      // Nothing was changed by any of those.
      expect(dispatch.loadsOf(heavy.freightId).map((l) => [l.weightKg, l.partOf])).toEqual([[12000, undefined]]);

      // One piece: the plan does not offer to split it, and it is not split.
      const piece = anOrder(fleet, { kg: 11000, n: 2, indivisible: true });
      expect(plans.propose(fleet.did, { day: tomorrow() }).unplanned.find((u) => u.freightId === piece.freightId)).toMatchObject({ reason: 'too_heavy' });
      expect(plans.propose(fleet.did, { day: tomorrow() }).unplanned.find((u) => u.freightId === piece.freightId)!.splitInto).toBeUndefined();
      expect(split([6000, 5000], fleet.did, piece.freightId)).toThrow(/one piece — they cannot go in several loads/);

      // In somebody else's hands: not while it is on offer to a partner.
      dispatch.offerToPartners(fleet.did, heavy.freightId, [{ fleetDid: other.did, fleetName: other.companyName }], 'Amina');
      expect(split([6000, 6000])).toThrow(/has been handed on/);
    });

    it('is put back together while every load is still an order — and not once one of them has moved', () => {
      const { fleet } = setUp();
      const other = aFleet('Pwani Haulage');
      const heavy = anOrder(fleet, { kg: 12000, n: 1 });
      expect(() => dispatch.rejoinOrder(fleet.did, heavy.freightId, 'Amina')).toThrow(/in one load already/);
      const [, second] = dispatch.splitOrder(fleet.did, heavy.freightId, [7000, 5000], 'Amina');
      expect(() => dispatch.rejoinOrder(other.did, heavy.freightId, 'X')).toThrow(/No such order/);
      // Asked of ANY load of it.
      const whole = dispatch.rejoinOrder(fleet.did, second.freightId, 'Amina');
      expect(whole).toMatchObject({ freightId: heavy.freightId, code: heavy.code, weightKg: 12000, status: 'ordered' });
      expect(whole.partOf).toBeUndefined();
      // One order in the queue again; the load that stopped being one is in no list.
      expect(dispatch.ordersForFleet(fleet.did).map((r) => [r.code, r.weightKg])).toEqual([[heavy.code, 12000]]);
      expect(dispatch.loadsOf(heavy.freightId)).toHaveLength(1);
      expect(plans.propose(fleet.did, { day: tomorrow() }).unplanned).toEqual([expect.objectContaining({ reason: 'too_heavy', splitInto: 2 })]);
      // It can be split again, differently.
      const again = dispatch.splitOrder(fleet.did, heavy.freightId, [4000, 4000, 4000], 'Amina');
      expect(again.map((l) => l.partOf!.of)).toEqual([3, 3, 3]);
      // One of them handed to a partner: the order is no longer the office's to put back together.
      dispatch.offerToPartners(fleet.did, again[2].freightId, [{ fleetDid: other.did, fleetName: other.companyName }], 'Amina');
      expect(() => dispatch.rejoinOrder(fleet.did, heavy.freightId, 'Amina')).toThrow('Load 3 (' + again[2].code + ') is handed on');
      expect(dispatch.loadsOf(heavy.freightId)).toHaveLength(3);
    });

    it('takes a split order out of the plan it was in: its loads are planned afresh', () => {
      const { fleet } = setUp();
      const big = anOrder(fleet, { kg: 8000, n: 1 });
      plans.accept(fleet.did, { day: tomorrow() }, 'Amina');
      expect(dispatch.ordersForFleet(fleet.did)[0].planned).toBeDefined();
      const loads = dispatch.splitOrder(fleet.did, big.freightId, [5000, 3000], 'Amina');
      expect(dispatch.ordersForFleet(fleet.did).every((r) => r.planned === undefined)).toBe(true);
      expect(loads).toHaveLength(2);
    });
  });

  /* ------------------------------------------------------------ road distances -- */

  /**
   * ROAD DISTANCES. The user, 2026-10-06: real distances from an OSRM-compatible routing server. The adapter that
   * talks to one has its own spec; what is pinned here is the plan's side of it — that the day's places are asked
   * about once and nothing else is, that the math runs on the answer, that a plan says which distances it was made on
   * and why when it is the estimate, and that with nothing to ask the plan is what it always was.
   */
  describe('road distances', () => {
    type Place = { lat: number; lng: number };
    /** A routing server on which every road is three times the estimate — and which remembers what it was asked. */
    const tripled = (asked: Place[][], over: Partial<RoadDistances> = {}): RoadMatrix => ({
      between: async (points) => {
        asked.push(points);
        return { source: 'roads', km: (a, b) => heuristic.roadKm(a, b) * 3, ...over };
      },
    });
    const key = (p: Place) => p.lat + ',' + p.lng;

    it('is made on the routing server’s distances where it gives them — and says which it used', async () => {
      const { fleet } = setUp();
      anOrder(fleet, { kg: 2000, n: 1 });
      anOrder(fleet, { kg: 2000, n: 4 });
      anOrder(fleet, { kg: 500, n: 2, pinned: false });
      const asked: Place[][] = [];
      const routed = withRoads(tripled(asked));
      const estimate = plans.propose(fleet.did, { day: tomorrow() });
      expect(estimate.distances).toEqual({ source: 'estimate' });
      const plan = await routed.proposeRouted(fleet.did, { day: tomorrow() });
      expect(plan.distances).toEqual({ source: 'roads' });
      expect(plan.totals.planned).toBe(2);
      expect(plan.totals.km / estimate.totals.km).toBeCloseTo(3, 1);
      // The times follow: the office's own speed, over the longer road.
      expect(plan.routes[0].minutes).toBeGreaterThan(estimate.routes[0].minutes);
      // Asked once, about the depot, the yard and the two doors that have a point — and about nothing else.
      expect(asked).toHaveLength(1);
      expect(new Set(asked[0].map(key))).toEqual(new Set([depot, yard, site(1), site(4)].map(key)));
    });

    it('is the estimate when the routing server gives nothing — and the plan says why', async () => {
      const { fleet } = setUp();
      anOrder(fleet, { kg: 2000, n: 1 });
      const down = withRoads({ between: async () => ({ source: 'estimate', why: 'the routing server did not answer in time', km: (a, b) => heuristic.roadKm(a, b) }) });
      const plan = await down.proposeRouted(fleet.did, { day: tomorrow() });
      expect(plan.distances).toEqual({ source: 'estimate', why: 'the routing server did not answer in time' });
      expect(plan.routes).toEqual(plans.propose(fleet.did, { day: tomorrow() }).routes);
      // Legs the map had no road for are counted on the plan.
      const gappy = await withRoads(tripled([], { gaps: 2 })).proposeRouted(fleet.did, { day: tomorrow() });
      expect(gappy.distances).toEqual({ source: 'roads', gaps: 2 });
    });

    it('is the plan it always was where there is no routing server to ask', async () => {
      const { fleet } = setUp();
      anOrder(fleet, { kg: 2000, n: 1 });
      const plain = plans.propose(fleet.did, { day: tomorrow() });
      const asked = await plans.proposeRouted(fleet.did, { day: tomorrow() });
      expect(asked.distances).toEqual({ source: 'estimate' });
      expect(asked.routes).toEqual(plain.routes);
    });

    it('refuses a bad ask before the routing server is asked anything', async () => {
      const { fleet } = setUp();
      anOrder(fleet);
      const asked: Place[][] = [];
      const routed = withRoads(tripled(asked));
      await expect(routed.proposeRouted(fleet.did, { day: '2020-01-01' })).rejects.toThrow(/That day has gone/);
      await expect(routed.proposeRouted(fleet.did, { day: tomorrow(), dayHours: 20 })).rejects.toThrow(/between 1 and 13/);
      await expect(routed.acceptRouted(fleet.did, { day: 'tomorrow' }, 'Amina')).rejects.toThrow(/A day is YYYY-MM-DD/);
      expect(asked).toEqual([]);
    });

    it('keeps what it was made on with the accepted plan — which is the plan made on those distances', async () => {
      const { fleet } = setUp();
      anOrder(fleet, { kg: 2000, n: 1 });
      const asked: Place[][] = [];
      const routed = withRoads(tripled(asked));
      const proposed = await routed.proposeRouted(fleet.did, { day: tomorrow() });
      const kept = await routed.acceptRouted(fleet.did, { day: tomorrow() }, 'Amina');
      expect(kept.distances).toEqual({ source: 'roads' });
      expect(kept.totals.km).toBe(proposed.totals.km);
      expect(kept.routes[0].trips[0].stops[0].arrive).toBe(proposed.routes[0].trips[0].stops[0].arrive);
      expect(routed.state(fleet.did, tomorrow()).plan!.distances).toEqual({ source: 'roads' });
      // Accepting asked again: what is kept is never what a screen sent back, nor a table from an earlier look.
      expect(asked).toHaveLength(2);
    });
  });

  /* ------------------------------------------------------- sending it out -- */

  /**
   * P3b — THE PLAN GOES OUT A TRIP AT A TIME. A truck is given what it can carry at once: its first trip when its
   * driver starts a shift in it, the next when the last of that one is handed over. Each order goes through the door a
   * dispatcher uses; one that is refused stays in the queue with the refusal on it.
   */
  describe('sending today’s plan to the trucks', () => {
    const today = () => dayPlus(0);
    const quick = { dayHours: 13, speedKmh: 110, loadMin: 1, unloadMin: 1 };
    /** One 5 t truck, one driver, three 3 t orders for TODAY: three trips, accepted. */
    function aPlannedDay() {
      const fleet = aFleet('Kilima Logistics');
      const truck = aTruck(fleet.did, 'KPL 005T', 5000);
      const driver = aDriver(fleet.did);
      const orders = [anOrder(fleet, { kg: 3000, n: 1, day: today() }), anOrder(fleet, { kg: 3000, n: 1, day: today() }), anOrder(fleet, { kg: 3000, n: 1, day: today() })];
      const plan = plans.accept(fleet.did, { day: today(), ...quick }, 'Amina');
      expect(plan.routes[0].trips).toHaveLength(3);
      const statusOf = () => orders.map((o) => dispatch.freightStatusOf(o.freightId));
      const tripOrder = plan.routes[0].trips.map((t) => t.stops[0].freightId);
      return { fleet, truck, driver, orders, statusOf, tripOrder };
    }
    const carry = (freightId: string, driverDid: string) => {
      const f = dispatch.listFreight().find((x) => x.freightId === freightId)!;
      dispatch.pickupFreight(freightId, driverDid, { confirmed: requiredLoadKeys(f), securementPhotoId: 'med_test' });
      dispatch.deliverFreight(freightId, driverDid, { confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: 'med_pod' });
    };

    it('gives a truck its first trip when its driver starts a shift in it, and the next when that one is handed over', async () => {
      const { fleet, truck, driver, statusOf, tripOrder } = aPlannedDay();
      // Accepted, and on nobody yet: no driver is out.
      expect(statusOf()).toEqual(['ordered', 'ordered', 'ordered']);
      fleetSvc.couple(driver.did, truck.vehicleId);
      await settle();
      const now1 = tripOrder.map((id) => dispatch.freightStatusOf(id));
      expect(now1).toEqual(['claimed', 'ordered', 'ordered']);
      const first = dispatch.listFreight().find((x) => x.freightId === tripOrder[0])!;
      expect(first).toMatchObject({ claimedBy: driver.did, assignedBy: { managerDid: fleet.did, name: 'Amina (the day’s plan)' } });
      // One trip at a time: three tonnes aboard a five-tonne truck, and the next three wait.
      carry(tripOrder[0], driver.did);
      await settle();
      expect(tripOrder.map((id) => dispatch.freightStatusOf(id))).toEqual(['delivered', 'claimed', 'ordered']);
      carry(tripOrder[1], driver.did);
      await settle();
      expect(tripOrder.map((id) => dispatch.freightStatusOf(id))).toEqual(['delivered', 'delivered', 'claimed']);
    });

    it('is sent by hand for a plan accepted after the shift began — once: a truck with goods aboard waits', () => {
      const fleet = aFleet('Kilima Logistics');
      const truck = aTruck(fleet.did, 'KPL 005T', 5000);
      const driver = aDriver(fleet.did);
      fleetSvc.couple(driver.did, truck.vehicleId);
      const a = anOrder(fleet, { kg: 3000, n: 1, day: today() });
      anOrder(fleet, { kg: 3000, n: 1, day: today() });
      expect(() => plans.send(fleet.did, today())).toThrow(/No plan has been accepted for today/);
      const plan = plans.accept(fleet.did, { day: today(), ...quick }, 'Amina');
      const firstId = plan.routes[0].trips[0].stops[0].freightId;
      const sent = plans.send(fleet.did, today());
      expect(sent.trucks).toEqual([{ vehicleId: truck.vehicleId, plate: 'KPL 005T', state: 'sent', driverName: driver.displayName, tripNo: 1, sent: [dispatch.listFreight().find((x) => x.freightId === firstId)!.code], held: [] }]);
      expect(plans.send(fleet.did, today()).trucks[0]).toMatchObject({ state: 'carrying', sent: [] });
      expect(a.freightId).toBeTruthy();
    });

    it('says a truck has no driver, and that a truck has nothing left', () => {
      const { fleet, truck, driver, tripOrder } = aPlannedDay();
      expect(plans.send(fleet.did, today()).trucks[0]).toMatchObject({ state: 'no_driver', sent: [] });
      fleetSvc.couple(driver.did, truck.vehicleId);
      for (const id of tripOrder) {
        if (dispatch.freightStatusOf(id) === 'ordered') plans.send(fleet.did, today());
        carry(id, driver.did);
      }
      expect(plans.send(fleet.did, today()).trucks[0]).toMatchObject({ state: 'nothing_left' });
    });

    it('keeps an order the truck’s door refused in the queue, with the refusal on it in its own words', async () => {
      const { fleet, truck, driver, tripOrder } = aPlannedDay();
      // The door refuses — as it does a driver over their hours — from before the shift starts, so the first trip's
      // own automatic send is what meets it.
      const refusal = jest.spyOn(dispatch, 'assign').mockImplementation(() => {
        throw new GlosError('HOURS_EXCEEDED', 'On duty 14 h — over the 13 h limit. End the shift and rest before taking another load');
      });
      // A shift still starts: the plan failing to move on is never a reason a driver cannot begin.
      expect(() => fleetSvc.couple(driver.did, truck.vehicleId)).not.toThrow();
      await settle();
      const heldRow = () => dispatch.ordersForFleet(fleet.did).find((r) => r.freightId === tripOrder[0])!;
      expect(heldRow()).toMatchObject({ status: 'ordered', planned: { held: { why: expect.stringMatching(/over the 13 h limit/) } } });
      const out = plans.send(fleet.did, today());
      expect(out.trucks[0]).toMatchObject({ state: 'sent', tripNo: 1, sent: [] });
      expect(out.trucks[0].held[0].why).toMatch(/over the 13 h limit/);
      // The door opens again: the order goes on, and the old refusal comes off it.
      refusal.mockRestore();
      expect(plans.send(fleet.did, today()).trucks[0].sent).toHaveLength(1);
      expect(heldRow().status).toBe('claimed');
      expect(heldRow().planned!.held).toBeUndefined();
    });

    it('sends nothing for a day that is not today, and nothing to a truck the plan does not use', async () => {
      const fleet = aFleet('Kilima Logistics');
      const planned = aTruck(fleet.did, 'KPL 008T', 8000);
      const spare = aTruck(fleet.did, 'KPL 003T', 3000);
      const one = aDriver(fleet.did);
      const two = aDriver(fleet.did);
      const tomorrowOrder = anOrder(fleet, { kg: 2000, n: 1 });
      plans.accept(fleet.did, { day: tomorrow() }, 'Amina');
      expect(() => plans.send(fleet.did, tomorrow())).toThrow(/has not come/);
      // A shift starting today in tomorrow's truck takes nothing of tomorrow's.
      fleetSvc.couple(one.did, planned.vehicleId);
      fleetSvc.couple(two.did, spare.vehicleId);
      await settle();
      expect(dispatch.freightStatusOf(tomorrowOrder.freightId)).toBe('ordered');
    });
  });

  it('refuses a day that has gone, a day longer than a shift, and accepting a plan with nothing in it', () => {
    const { fleet } = setUp();
    expect(() => plans.propose(fleet.did, { day: dayPlus(-1) })).toThrow(/has gone/);
    expect(() => plans.propose(fleet.did, { day: 'tomorrow' })).toThrow(/YYYY-MM-DD/);
    expect(() => plans.propose(fleet.did, { day: tomorrow(), dayHours: 20 })).toThrow(/between 1 and 13/);
    expect(() => plans.propose(fleet.did, { day: tomorrow(), dayStart: '25:00' })).toThrow(/HH:MM/);
    expect(() => plans.accept(fleet.did, { day: tomorrow() }, 'Amina')).toThrow(/nothing in this plan/);
  });
});
