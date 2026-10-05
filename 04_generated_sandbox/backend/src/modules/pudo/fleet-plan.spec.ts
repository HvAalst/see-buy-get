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
  function anOrder(fleet: { did: string; companyName: string }, over: { kg?: number; n?: number; day?: string; pinned?: boolean; ref?: string } = {}) {
    seq += 1;
    return dispatch.registerFreight({
      description: `Bricks ${seq}`, pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: `Site ${over.n ?? seq}`,
      ...(over.pinned === false ? {} : { destLocation: site(over.n ?? 1) }),
      weightKg: over.kg ?? 2000, packaging: 'palletised', postedByDid: fleet.did, postedByName: 'Amina', contract: contractOf(fleet), deliverOn: over.day ?? tomorrow(), orderRef: over.ref ?? `WS-${seq}`,
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
