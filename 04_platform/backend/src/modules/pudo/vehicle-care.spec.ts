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
import { GazetteerGeocoder, GEOCODER } from './geocoder';
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
import { PayoutService } from '../../foundation/payouts/payout.service';
import { SandboxPayoutRail } from '../../foundation/payouts/sandbox-rail.adapter';
import { PAYOUT_RAIL } from '../../foundation/payouts/payout.types';
import type { ContractRef } from './carriage-contract.types';

import { FleetPlanService } from './fleet-plan.service';
import { ROUTER as ROUTER_TOKEN, type Router } from './router';
import { clockAt } from './fleet-clock';
import { CHECKLIST, VehicleCareService } from './vehicle-care.service';
import { VehicleBreakdownService } from './vehicle-breakdown.service';
import { requiredLoadKeys, requiredUnloadKeys } from './heavy-cargo';
import { GlosEvent } from '../../foundation/events/glos-events';

const DAY = 86_400_000;

/**
 * A VEHICLE'S UPKEEP — what decides whether a vehicle goes out, on the real vehicles, drivers, shifts and plans. See
 * vehicle-care.types for what it is and, by decision, what it is not (no parts, no mechanics' time, no costs).
 */
describe('a vehicle’s upkeep', () => {
  let vehicles: VehicleService;
  let drivers: DriverService;
  let managers: FleetManagerService;
  let fleet: FleetService;
  let dispatch: DispatchService;
  let plans: FleetPlanService;
  let care: VehicleCareService;
  let breakdowns: VehicleBreakdownService;
  let bus: EventBus;
  let media: MediaService;
  let seq = 0;

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
    vehicles = moduleRef.get(VehicleService);
    drivers = moduleRef.get(DriverService);
    managers = moduleRef.get(FleetManagerService);
    fleet = moduleRef.get(FleetService);
    dispatch = moduleRef.get(DispatchService);
    plans = new FleetPlanService(dispatch, vehicles, drivers, managers, moduleRef.get<Router>(ROUTER_TOKEN), fleet, moduleRef.get(EventBus));
    bus = moduleRef.get(EventBus);
    media = moduleRef.get(MediaService);
    breakdowns = new VehicleBreakdownService(vehicles, managers, fleet, drivers, dispatch, moduleRef.get(DepartureService), media, bus);
    care = new VehicleCareService(vehicles, managers, fleet, drivers, media, bus, breakdowns);
  });

  // Kenyan fleets: their days are Nairobi's.
  const dayPlus = (n: number, from = Date.now()) => clockAt(from + n * DAY, 'Africa/Nairobi').day;

  function aFleet(name = 'Kilima Logistics') {
    seq += 1;
    const m = managers.register({
      companyName: name, contactPhone: `+25480040${seq}0`, ownerFullName: 'O O', ownerNationalId: `MGR-VC-${seq}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-VC-${seq}`, transportOperatorLicence: `TOL-VC-${seq}`, taxId: `TAX-VC-${seq}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    return managers.get(m.did);
  }
  function aDriver(managerDid: string) {
    seq += 1;
    const d = drivers.register({
      displayName: `Driver ${seq}`, fullName: `D ${seq}`, nationalId: `ID-VC-${seq}`, mobile: `+2547840${seq}00`,
      licenceClasses: ['truck'], licenceNumber: `L-VC-${seq}`, licenceExpiresAt: new Date(Date.now() + 365 * DAY).toISOString(), criminalRecordClear: true, managerDid,
    });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    return drivers.get(d.did);
  }
  function aTruck(managerDid: string, plate = `KVC ${100 + seq}T`) {
    seq += 1;
    return vehicles.register({ plate, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 8000, ownerName: 'X', equipment: ['TLT', 'FLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid } as never);
  }
  const contractOf = (f: { did: string; companyName: string }): ContractRef => ({ contractId: 'ctr_vc', fleetDid: f.did, fleetName: f.companyName, shipperName: 'Jenga Bricks' });
  /** An order under the fleet's contract — typed in by its own office, unless the shipper placed it. */
  function anOrder(f: { did: string; companyName: string }, day: string, postedByDid = f.did) {
    seq += 1;
    return dispatch.registerFreight({
      description: `Bricks ${seq}`, pickupLocation: { lat: -1.3, lng: 36.85 }, pickupLabel: 'Jenga yard', destLabel: `Site ${seq}`, destLocation: { lat: -1.25, lng: 36.9 },
      weightKg: 2000, packaging: 'palletised', postedByDid, postedByName: 'Amina', contract: contractOf(f), deliverOn: day, orderRef: `WS-${seq}`,
    });
  }

  describe('off the road, and back', () => {
    it('takes a vehicle off the road from today, says why at every door, and puts it back', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 100T');
      const amos = aDriver(f.did);
      const view = care.takeOffRoad(truck.vehicleId, { reason: 'repair', note: 'brakes', untilDay: dayPlus(2) }, 'Amina');
      const line = `In the workshop until ${new Date(`${dayPlus(2)}T12:00:00Z`).getUTCDate()} `;
      expect(view).toMatchObject({ usable: false, inUse: false, today: dayPlus(0) }); // the fleet's day, Nairobi's
      expect(view.offRoad[0]).toMatch(new RegExp(`^${line}.*: brakes$`));
      expect(vehicles.isUsable(truck.vehicleId)).toBe(false);
      // The door a driver uses says the same words.
      expect(() => fleet.couple(amos.did, truck.vehicleId)).toThrow(/KVC 100T is off the road: In the workshop until .*: brakes/);
      // Back on the road, now.
      expect(care.backOnTheRoad(truck.vehicleId, 'Amina')).toMatchObject({ usable: true, offRoad: [], spells: [] });
      expect(() => fleet.couple(amos.did, truck.vehicleId)).not.toThrow();
    });

    it('comes back by itself the day after its last day, and keeps a spell to come off the days before it', () => {
      const f = aFleet();
      const truck = aTruck(f.did);
      care.takeOffRoad(truck.vehicleId, { reason: 'service', fromDay: dayPlus(1), untilDay: dayPlus(2) }, 'Amina');
      expect(vehicles.isUsable(truck.vehicleId)).toBe(true); // today: still on the road
      expect(vehicles.isUsable(truck.vehicleId, Date.now() + DAY)).toBe(false);
      expect(vehicles.isUsable(truck.vehicleId, Date.now() + 3 * DAY)).toBe(true); // the day after the last
      // Asked for a day, not for now: what a plan asks.
      expect(vehicles.offRoadReasons(truck.vehicleId, Date.now(), dayPlus(2))[0]).toMatch(/^In for a service until /);
      expect(vehicles.offRoadReasons(truck.vehicleId, Date.now(), dayPlus(3))).toEqual([]);
    });

    it('is left out of the plan for its days only, and says why on the plan', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 200T');
      aDriver(f.did);
      anOrder(f, dayPlus(1));
      anOrder(f, dayPlus(2));
      care.takeOffRoad(truck.vehicleId, { reason: 'repair', fromDay: dayPlus(1), untilDay: dayPlus(1) }, 'Amina');
      const tomorrow = plans.propose(f.did, { day: dayPlus(1) });
      expect(tomorrow.routes).toEqual([]);
      expect(tomorrow.vehicles[0].offRoad).toEqual([expect.stringMatching(/^In the workshop until /)]);
      expect(plans.propose(f.did, { day: dayPlus(2) }).routes.map((r) => r.plate)).toEqual(['KVC 200T']);
    });

    it('refuses wrong days, a second reason for the same days, and a retired vehicle — before anything is kept', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 300T');
      expect(() => care.takeOffRoad(truck.vehicleId, { reason: 'repair', fromDay: dayPlus(-1) }, 'Amina')).toThrow(/starts today or later/);
      expect(() => care.takeOffRoad(truck.vehicleId, { reason: 'repair', fromDay: dayPlus(3), untilDay: dayPlus(2) }, 'Amina')).toThrow(/on or after the first/);
      expect(() => care.takeOffRoad(truck.vehicleId, { reason: 'repair', fromDay: dayPlus(400) }, 'Amina')).toThrow(/next 365 days at most/);
      care.takeOffRoad(truck.vehicleId, { reason: 'repair', fromDay: dayPlus(2), untilDay: dayPlus(4) }, 'Amina');
      expect(() => care.takeOffRoad(truck.vehicleId, { reason: 'service', fromDay: dayPlus(4) }, 'Amina')).toThrow(/KVC 300T is already off the road from .* to .* \(in the workshop\): end that first/);
      // Days that do not touch it are fine.
      expect(() => care.takeOffRoad(truck.vehicleId, { reason: 'service', fromDay: dayPlus(5), untilDay: dayPlus(5) }, 'Amina')).not.toThrow();
      expect(care.view(truck.vehicleId).spells.map((s) => s.reason)).toEqual(['repair', 'service']);
      vehicles.retire(truck.vehicleId);
      expect(() => care.takeOffRoad(truck.vehicleId, { reason: 'repair', fromDay: dayPlus(9) }, 'Amina')).toThrow(/retired/);
    });

    it('calls off a spell that has not begun, ends one once, and finds none of another vehicle’s', () => {
      const f = aFleet();
      const [a, b] = [aTruck(f.did), aTruck(f.did)];
      const { spells } = care.takeOffRoad(a.vehicleId, { reason: 'service', fromDay: dayPlus(3) }, 'Amina');
      expect(() => care.endSpell(b.vehicleId, spells[0].spellId, 'Amina')).toThrow(/No such spell/);
      expect(care.endSpell(a.vehicleId, spells[0].spellId, 'Amina').spells).toEqual([]);
      expect(() => care.endSpell(a.vehicleId, spells[0].spellId, 'Amina')).toThrow(/already ended/);
      expect(vehicles.isUsable(a.vehicleId, Date.now() + 4 * DAY)).toBe(true);
    });

    it('back on the road ends today’s spell and keeps the ones to come; and returns a vehicle grounded the old way', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 400T');
      care.takeOffRoad(truck.vehicleId, { reason: 'accident', untilDay: dayPlus(1) }, 'Amina');
      care.takeOffRoad(truck.vehicleId, { reason: 'service', fromDay: dayPlus(5), untilDay: dayPlus(5) }, 'Amina');
      const back = care.backOnTheRoad(truck.vehicleId, 'Amina');
      expect(back.usable).toBe(true);
      expect(back.spells.map((s) => s.reason)).toEqual(['service']);
      expect(() => care.backOnTheRoad(truck.vehicleId, 'Amina')).toThrow(/not off the road for a reason this can end/);
      const old = aTruck(f.did, 'KVC 401T');
      vehicles.ground(old.vehicleId);
      expect(care.view(old.vehicleId)).toMatchObject({ grounded: true, usable: false, offRoad: ['Grounded'] });
      expect(care.backOnTheRoad(old.vehicleId, 'Amina')).toMatchObject({ usable: true });
      expect(vehicles.get(old.vehicleId).status).toBe('ACTIVE');
    });

    it('leaves a shift that is running alone, says the vehicle is in use, and stops the next one', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 500T');
      const amos = aDriver(f.did);
      fleet.couple(amos.did, truck.vehicleId);
      const view = care.takeOffRoad(truck.vehicleId, { reason: 'repair' }, 'Amina');
      expect(view).toMatchObject({ inUse: true, usable: false });
      expect(fleet.activeForVehicle(truck.vehicleId)).toBeDefined();
      fleet.uncouple(amos.did);
      expect(() => fleet.couple(amos.did, truck.vehicleId)).toThrow(/off the road: In the workshop$/);
      // The driver's own list of vehicles says why, before they get to the yard.
      expect(fleet.recentVehicles(amos.did).find((v) => v.vehicleId === truck.vehicleId)!.offRoad).toEqual(['In the workshop']);
    });
  });
  describe('the odometer', () => {
    const HOUR = 3_600_000;

    it('keeps each reading, newest first, and refuses one lower than the last — in words a driver can act on', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 600T');
      const t0 = Date.now() - 2 * DAY;
      care.recordReading(truck.vehicleId, 120_000, { by: 'Amos', source: 'shift_start' }, t0);
      care.recordReading(truck.vehicleId, 120_340, { by: 'Amos', source: 'shift_end' }, t0 + 9 * HOUR);
      const view = care.view(truck.vehicleId);
      expect(view.odometer).toMatchObject({ km: 120_340, source: 'shift_end', by: 'Amos' });
      expect(view.readings.map((r) => r.km)).toEqual([120_340, 120_000]);
      expect(() => care.checkReading(truck.vehicleId, 119_999)).toThrow("KVC 600T's last reading was 120,340 km: a reading cannot go back. If the meter was changed, the office records the new one.");
      expect(() => care.checkReading(truck.vehicleId, 12.5)).toThrow(/whole kilometres/);
      expect(() => care.checkReading(truck.vehicleId, 120_340)).not.toThrow();
    });

    it('takes a new meter from the office, lower than the last, and counts on from it', () => {
      const f = aFleet();
      const truck = aTruck(f.did);
      care.recordReading(truck.vehicleId, 300_000, { by: 'Amos', source: 'shift_end' });
      const fresh = care.recordReading(truck.vehicleId, 12, { by: 'Amina', source: 'office', newMeter: true }, Date.now() + 1000);
      expect(fresh).toMatchObject({ km: 12, newMeter: true });
      expect(fresh).not.toHaveProperty('doubtful');
      expect(care.view(truck.vehicleId).odometer!.km).toBe(12);
      expect(() => care.checkReading(truck.vehicleId, 11)).toThrow(/last reading was 12 km/);
    });

    it('keeps a jump bigger than a vehicle can drive, and says it is doubtful', () => {
      const f = aFleet();
      const truck = aTruck(f.did);
      const t0 = Date.now() - 3 * DAY;
      care.recordReading(truck.vehicleId, 50_000, { by: 'Amos', source: 'shift_start' }, t0);
      // Three days: up to 4,500 km is likely.
      expect(care.recordReading(truck.vehicleId, 54_000, { by: 'Amos', source: 'shift_start' }, t0 + 3 * DAY)).not.toHaveProperty('doubtful');
      // An hour later, 5,000 km more: a slip of the finger, kept and said.
      const slip = care.recordReading(truck.vehicleId, 59_000, { by: 'Amos', source: 'shift_end' }, t0 + 3 * DAY + HOUR);
      expect(slip.doubtful).toBe('5,000 km since the last reading — more than 1,500 km in a day');
    });

    it('never stands in the way of a shift ending: a reading that cannot be kept is not kept, and says why', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 700T');
      care.recordReading(truck.vehicleId, 80_000, { by: 'Amos', source: 'shift_start' });
      expect(care.recordEndReading(truck.vehicleId, 79_000, { by: 'Amos' }, Date.now() + HOUR)).toEqual({ kept: false, why: expect.stringMatching(/^KVC 700T's last reading was 80,000 km/) });
      expect(care.recordEndReading(truck.vehicleId, 80_250, { by: 'Amos' }, Date.now() + HOUR)).toEqual({ kept: true });
      expect(care.view(truck.vehicleId).odometer!.km).toBe(80_250);
    });
  });
  describe('service due dates', () => {
    const HOUR = 3_600_000;
    const words = (day: string) => {
      const d = new Date(`${day}T12:00:00Z`);
      return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    };
    const shift = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
    const noonOf = (day: string) => Date.parse(`${day}T09:00:00Z`); // noon in Nairobi

    it('counts from when it was registered: six months or 15,000 km for a truck, whichever comes first — soon a fortnight before, overdue after', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 900T');
      const v = vehicles.get(truck.vehicleId);
      const first = care.view(truck.vehicleId).service;
      expect(first).toMatchObject({ plan: { everyKm: 15_000, everyMonths: 6, source: 'class' }, state: 'ok', from: 'registered' });
      expect(first).not.toHaveProperty('dueKm'); // no reading yet to count km from
      const due = first.dueDay!;
      expect(first.line).toBe(`Next service by ${words(due)}`);
      // The first reading starts the km count.
      care.recordReading(truck.vehicleId, 120_000, { by: 'Amos', source: 'shift_start' });
      expect(care.view(truck.vehicleId).service).toMatchObject({ dueKm: 135_000, currentKm: 120_000, state: 'ok', line: `Next service by ${words(due)} or at 135,000 km, whichever comes first` });
      // By the day: soon a fortnight before, overdue the day after.
      expect(care.serviceDue(v, Date.now(), shift(due, -15)).state).toBe('ok');
      expect(care.serviceDue(v, Date.now(), shift(due, -14)).state).toBe('soon');
      expect(care.serviceDue(v, Date.now(), due).state).toBe('soon');
      expect(care.serviceDue(v, Date.now(), shift(due, 1))).toMatchObject({ state: 'overdue', line: `Service overdue: it was due by ${words(due)}` });
      // By the km: a tenth of the 15,000 before, it is soon; at 135,000, overdue.
      care.recordReading(truck.vehicleId, 133_499, { by: 'Amos', source: 'shift_end' }, Date.now() + 9 * HOUR);
      expect(care.view(truck.vehicleId).service.state).toBe('ok');
      care.recordReading(truck.vehicleId, 133_500, { by: 'Amos', source: 'shift_start' }, Date.now() + DAY);
      expect(care.view(truck.vehicleId, Date.now() + DAY).service).toMatchObject({ state: 'soon', line: `Service due soon: by ${words(due)} or at 135,000 km, whichever comes first (it reads 133,500 km)` });
      care.recordReading(truck.vehicleId, 135_000, { by: 'Amos', source: 'shift_end' }, Date.now() + DAY + 9 * HOUR);
      const late = care.view(truck.vehicleId, Date.now() + DAY + 9 * HOUR).service;
      expect(late).toMatchObject({ state: 'overdue', line: 'Service overdue: it was due at 135,000 km, and reads 135,000 km' });
      // Most fleets only want to be told: it still goes out, and its row says so.
      expect(vehicles.isUsable(truck.vehicleId)).toBe(true);
      const row = vehicles.listFor({ managerDid: f.did }, f.did, false).find((x) => x.vehicleId === truck.vehicleId)!;
      expect(row.notes).toEqual(['Service overdue: it was due at 135,000 km, and reads 135,000 km']);
      // Another fleet does not see it.
      expect(vehicles.listFor({ managerDid: f.did }, aFleet('Pwani Haulage').did, false).find((x) => x.vehicleId === truck.vehicleId)).not.toHaveProperty('notes');
    });

    it('a service recorded starts the count again; a repair does not — and a km that cannot be is refused before anything is kept', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 910T');
      const today = dayPlus(0);
      care.recordReading(truck.vehicleId, 120_000, { by: 'Amos', source: 'shift_start' }, Date.now() - 5 * DAY);
      care.recordReading(truck.vehicleId, 121_000, { by: 'Amos', source: 'shift_start' }, Date.now() - 2 * DAY);
      // A service before the first reading at more km than it showed later, or after one at fewer: neither can be.
      expect(() => care.recordService(truck.vehicleId, { day: dayPlus(-3), what: 'service', km: 119_000 }, { by: 'Amina' })).toThrow(`KVC 910T read 120,000 km on ${words(dayPlus(-5))}: a service after that is not at fewer`);
      expect(() => care.recordService(truck.vehicleId, { day: dayPlus(-3), what: 'service', km: 121_500 }, { by: 'Amina' })).toThrow(`KVC 910T read 121,000 km on ${words(dayPlus(-2))}: a service before that is not at more`);
      expect(() => care.recordService(truck.vehicleId, { day: dayPlus(1), what: 'service' }, { by: 'Amina' })).toThrow('A service is recorded once it is done: the day is today or earlier');
      expect(care.view(truck.vehicleId).services).toEqual([]);
      // Serviced today at 121,400 km: the next is 15,000 km on, and today's reading is kept too.
      const view = care.recordService(truck.vehicleId, { day: today, what: 'service', km: 121_400, workshop: 'Mombasa Road Motors', note: 'Oil, filters, brake pads' }, { by: 'Amina' });
      expect(view.service).toMatchObject({ from: 'service', dueKm: 136_400, currentKm: 121_400, state: 'ok' });
      expect(view.odometer).toMatchObject({ km: 121_400, source: 'office', by: 'Amina' });
      expect(view.services[0]).toMatchObject({ day: today, what: 'service', km: 121_400, workshop: 'Mombasa Road Motors', note: 'Oil, filters, brake pads', by: 'Amina' });
      expect(view.services[0]).not.toHaveProperty('photoRef');
      // A repair afterwards — 50 km on, at another garage — is on the record, and the next service is due where it was.
      const after = care.recordService(truck.vehicleId, { day: today, what: 'repair', km: 121_450, note: 'Mirror replaced' }, { by: 'Amina' }, Date.now() + HOUR);
      expect(after.services.map((s) => s.what)).toEqual(['repair', 'service']);
      expect(after.service).toMatchObject({ from: 'service', fromDay: today, dueKm: 136_400, currentKm: 121_450, dueDay: view.service.dueDay });
      // A service a while ago, recorded now, with no km: the count runs from the first reading on or after that day.
      const older = aTruck(f.did, 'KVC 920T');
      care.recordReading(older.vehicleId, 40_000, { by: 'Amos', source: 'shift_start' }, Date.now() - 20 * DAY);
      care.recordReading(older.vehicleId, 42_000, { by: 'Amos', source: 'shift_start' }, Date.now() - 10 * DAY);
      care.recordReading(older.vehicleId, 43_000, { by: 'Amos', source: 'shift_start' }, Date.now() - DAY);
      expect(care.recordService(older.vehicleId, { day: dayPlus(-12), what: 'service' }, { by: 'Amina' }).service).toMatchObject({ dueKm: 57_000, currentKm: 43_000 });
    });

    it('does not lose the count when the meter is changed', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 930T');
      care.recordReading(truck.vehicleId, 299_900, { by: 'Amos', source: 'shift_start' }, Date.now() - 5 * DAY);
      care.recordService(truck.vehicleId, { day: dayPlus(-4), what: 'service', km: 300_000 }, { by: 'Amina' });
      care.recordReading(truck.vehicleId, 305_000, { by: 'Amos', source: 'shift_end' }, Date.now() - 3 * DAY);
      care.recordReading(truck.vehicleId, 0, { by: 'Amina', source: 'office', newMeter: true }, Date.now() - 2 * DAY);
      care.recordReading(truck.vehicleId, 4_000, { by: 'Amos', source: 'shift_end' }, Date.now() - DAY);
      // 5,000 km on the old meter and 4,000 on the new: 6,000 to go, on the new meter's count.
      expect(care.view(truck.vehicleId).service).toMatchObject({ dueKm: 10_000, currentKm: 4_000, state: 'ok' });
    });

    it('takes the office’s own schedule, and goes back to the class’s usual', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 940T');
      expect(() => care.setServicePlan(truck.vehicleId, {}, 'Amina')).toThrow('Say how often: every so many km, every so many months, or both');
      const own = care.setServicePlan(truck.vehicleId, { everyKm: 5000 }, 'Amina').service;
      expect(own).toMatchObject({ plan: { everyKm: 5000, source: 'office' }, state: 'unknown', line: 'Serviced every 5,000 km — no odometer reading yet to count from' });
      expect(own.plan).not.toHaveProperty('everyMonths');
      expect(care.setServicePlan(truck.vehicleId, { useClassUsual: true }, 'Amina').service.plan).toEqual({ everyKm: 15_000, everyMonths: 6, source: 'class' });
      // A bike goes by the calendar alone; a month that is shorter ends on its last day.
      seq += 1;
      const bike = vehicles.register({ plate: `KVC ${seq}B`, vehicleClass: 'bike', capacityKg: 20, ownerName: 'X', baseFee: 1, pricePerKm: 0.1, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid: f.did } as never);
      expect(care.recordService(bike.vehicleId, { day: '2026-08-31', what: 'service' }, { by: 'Amina' }).service).toMatchObject({ plan: { everyMonths: 3, source: 'class' }, dueDay: '2026-11-30' });
      expect(care.setServicePlan(bike.vehicleId, { everyMonths: 6 }, 'Amina').service.dueDay).toBe('2027-02-28');
    });

    it('where the fleet says so, an overdue service keeps it off the road — at every door, and on a day a plan asks about — until a service is recorded', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 950T');
      const amos = aDriver(f.did);
      const due = care.recordService(truck.vehicleId, { day: dayPlus(0), what: 'service', km: 60_000 }, { by: 'Amina' }).service.dueDay!;
      // One rule changed leaves the other as it was.
      care.setSettings(f.did, { requireDailyCheck: true });
      care.setSettings(f.did, { serviceOverdue: 'off_road' });
      expect(care.settingsOf(f.did)).toEqual({ requireDailyCheck: true, serviceOverdue: 'off_road' });
      // A plan for the day it falls due may use it; one for the day after may not.
      expect(vehicles.isUsable(truck.vehicleId, Date.now(), due)).toBe(true);
      expect(vehicles.isUsable(truck.vehicleId, Date.now(), shift(due, 1))).toBe(false);
      expect(vehicles.offRoadReasons(truck.vehicleId, Date.now(), shift(due, 1))).toEqual([`Service overdue: it was due by ${words(due)}`]);
      // Overdue by the km, today: off the road, said at the door a driver uses.
      care.recordReading(truck.vehicleId, 75_000, { by: 'Amina', source: 'office' }, Date.now() + HOUR);
      expect(vehicles.isUsable(truck.vehicleId)).toBe(false);
      expect(() => fleet.couple(amos.did, truck.vehicleId)).toThrow('KVC 950T is off the road: Service overdue: it was due at 75,000 km, and reads 75,000 km');
      // The row says it once — off the road, not also a note.
      const row = vehicles.listFor({ managerDid: f.did }, f.did, false).find((x) => x.vehicleId === truck.vehicleId)!;
      expect(row.offRoad).toEqual(['Service overdue: it was due at 75,000 km, and reads 75,000 km']);
      expect(row.notes).toEqual([]);
      // Serviced: back on the road.
      care.recordService(truck.vehicleId, { day: dayPlus(0), what: 'service', km: 75_010 }, { by: 'Amina' }, Date.now() + 2 * HOUR);
      expect(vehicles.isUsable(truck.vehicleId)).toBe(true);
      expect(() => fleet.couple(amos.did, truck.vehicleId)).not.toThrow();
      // Back to warning only: a fleet's rule, changed by itself alone.
      expect(care.setSettings(f.did, { serviceOverdue: 'warn' })).toEqual({ requireDailyCheck: true, serviceOverdue: 'warn' });
    });

    it('tells the office once when a service comes due soon, once when it is overdue — and again only for the next one', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 960T');
      const told: Array<{ fleetDid: string; plate: string; state: string; line: string; offRoad: boolean }> = [];
      bus.subscribe<{ fleetDid: string; plate: string; state: string; line: string; offRoad: boolean }>(GlosEvent.Pudo.VehicleServiceDue, (e) => {
        told.push(e.payload);
      });
      const due = care.recordService(truck.vehicleId, { day: dayPlus(0), what: 'service' }, { by: 'Amina' }).service.dueDay!;
      const mine = () => care.sweepServiceDue(noonOf(shift(due, 0)) - 10 * DAY).filter((n) => n.plate === 'KVC 960T');
      expect(care.sweepServiceDue().filter((n) => n.plate === 'KVC 960T')).toEqual([]);
      expect(mine()).toEqual([{ fleetDid: f.did, vehicleId: truck.vehicleId, plate: 'KVC 960T', state: 'soon', line: `Service due soon: by ${words(due)}`, offRoad: false }]);
      expect(mine()).toEqual([]); // told once
      const late = () => care.sweepServiceDue(noonOf(shift(due, 2))).filter((n) => n.plate === 'KVC 960T');
      expect(late()).toMatchObject([{ state: 'overdue', line: `Service overdue: it was due by ${words(due)}`, offRoad: false }]);
      expect(late()).toEqual([]);
      expect(told.filter((n) => n.plate === 'KVC 960T').map((n) => n.state)).toEqual(['soon', 'overdue']);
      // A service recorded: a new count, told afresh when it comes due.
      const next = care.recordService(truck.vehicleId, { day: dayPlus(0), what: 'service' }, { by: 'Amina' }, Date.now() + HOUR).service.dueDay!;
      expect(care.sweepServiceDue(noonOf(shift(next, -3))).filter((n) => n.plate === 'KVC 960T').map((n) => n.state)).toEqual(['soon']);
      // A courier's own vehicle tells no office.
      const own = vehicles.register({ plate: 'KVC 961M', vehicleClass: 'motorcycle', capacityKg: 50, ownerName: 'X', baseFee: 1, pricePerKm: 0.1, minMultiplier: 0.8, maxMultiplier: 1.5 } as never);
      expect(care.sweepServiceDue(noonOf(shift(dayPlus(0), 400))).some((n) => n.vehicleId === own.vehicleId)).toBe(false);
    });

    it('keeps the job card only when it is the uploader’s own, and makes it the vehicle’s', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 970T');
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const theirs = media.upload({ ownerDid: f.did, kind: 'job_card', dataUrl: png });
      const someoneElses = media.upload({ ownerDid: 'did:glos:somebody', kind: 'job_card', dataUrl: png });
      expect(() => care.recordService(truck.vehicleId, { day: dayPlus(0), what: 'service', photoRef: someoneElses.mediaId }, { by: 'Amina', byDid: f.did })).toThrow(/not one you took/);
      expect(care.view(truck.vehicleId).services).toEqual([]);
      const view = care.recordService(truck.vehicleId, { day: dayPlus(0), what: 'service', photoRef: theirs.mediaId }, { by: 'Amina', byDid: f.did });
      expect(view.services[0]).toMatchObject({ hasPhoto: true });
      expect(care.servicePhoto(truck.vehicleId, view.services[0].recordId, 'full').contentType).toBe('image/png');
      expect(() => care.servicePhoto(truck.vehicleId, 'svc_nope', 'full')).toThrow(/No job card/);
      expect(() => media.removeByOwner(theirs.mediaId, f.did)).toThrow(/kept as evidence/);
    });
  });

  describe('a breakdown on the road', () => {
    const JENGA = 'did:glos:jenga-bricks';
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    type Told = { fleetDid?: string; plate: string; carrier: string; breakdown: { breakdownId: string }; tell: Array<Record<string, unknown>> };
    let broke: Told[];
    let ended: Told[];
    beforeEach(() => {
      broke = [];
      ended = [];
      bus.subscribe<Told>(GlosEvent.Pudo.VehicleBrokeDown, (e) => {
        broke.push(e.payload);
      });
      bus.subscribe<Told>(GlosEvent.Pudo.VehicleBreakdownResolved, (e) => {
        ended.push(e.payload);
      });
    });
    /** A truck of a fleet, out on a shift with one of its drivers. */
    function outOnTheRoad(plate: string) {
      const f = aFleet();
      const truck = aTruck(f.did, plate);
      const amos = aDriver(f.did);
      fleet.couple(amos.did, truck.vehicleId);
      return { f, truck, amos, who: { by: amos.displayName, byDid: amos.did } };
    }
    const onTruck = (f: { did: string }, freightId: string, driverDid: string, pickUp: boolean) => {
      dispatch.assign(freightId, driverDid, { managerDid: f.did, name: 'Amina' });
      if (pickUp) dispatch.pickupFreight(freightId, driverDid, { confirmed: requiredLoadKeys(dispatch.requireFreightPublic(freightId)), securementPhotoId: 'med_test' });
    };

    it('is reported by the driver with where the phone is: off the road at once, and the office and the shippers told — never by the plate', () => {
      const { f, truck, amos, who } = outOnTheRoad('KVC 980T');
      const aboard = anOrder(f, dayPlus(0), JENGA);
      onTruck(f, aboard.freightId, amos.did, true);
      const toCollect = anOrder(f, dayPlus(0), JENGA);
      onTruck(f, toCollect.freightId, amos.did, false);
      const own = anOrder(f, dayPlus(0)); // typed in by the fleet's own office: nobody to tell
      onTruck(f, own.freightId, amos.did, false);
      const b = breakdowns.report(truck.vehicleId, who, { cause: 'engine', note: 'Steam from the bonnet', lat: -1.31, lng: 36.84 });
      expect(b).toMatchObject({ plate: 'KVC 980T', cause: 'engine', driverDid: amos.did, driverName: amos.displayName, location: { lat: -1.31, lng: 36.84 }, locationFrom: 'phone', status: 'open', held: [] });
      expect(b.aboard).toHaveLength(3);
      expect(b.aboard).toEqual(
        expect.arrayContaining([
          { kind: 'freight', id: aboard.freightId, label: aboard.code, state: 'aboard', shipperTold: true },
          { kind: 'freight', id: toCollect.freightId, label: toCollect.code, state: 'to_collect', shipperTold: true },
          { kind: 'freight', id: own.freightId, label: own.code, state: 'to_collect', shipperTold: false },
        ]),
      );
      // Off the road at once, said at every door.
      expect(vehicles.isUsable(truck.vehicleId)).toBe(false);
      expect(vehicles.offRoadReasons(truck.vehicleId)).toEqual([expect.stringMatching(new RegExp(`^Broken down \\(engine\\), reported by ${amos.displayName} on \\d+ \\w{3} \\d{4} at \\d\\d:\\d\\d: Steam from the bonnet$`))]);
      // The office, and the shippers to tell: by what they sent, never the plate.
      expect(broke).toHaveLength(1);
      expect(broke[0]).toMatchObject({ fleetDid: f.did, plate: 'KVC 980T', carrier: 'Kilima Logistics' });
      expect(broke[0].tell).toHaveLength(2);
      expect(broke[0].tell).toEqual(
        expect.arrayContaining([
          { shipperDid: JENGA, kind: 'freight', label: aboard.code, state: 'aboard', freightId: aboard.freightId },
          { shipperDid: JENGA, kind: 'freight', label: toCollect.code, state: 'to_collect', freightId: toCollect.freightId },
        ]),
      );
      expect(JSON.stringify(broke[0].tell)).not.toContain('KVC 980T');
      // The driver's shift goes on: they are standing beside it.
      expect(fleet.activeForDriver(amos.did)?.vehicleId).toBe(truck.vehicleId);
    });

    it('is refused before anything is kept when it says nothing, half a position, a photo not theirs, or twice — and takes the last known position', () => {
      const { truck, amos, who } = outOnTheRoad('KVC 981T');
      expect(() => breakdowns.report(truck.vehicleId, who, { cause: 'tyre', note: '  ' })).toThrow('Say what happened');
      expect(() => breakdowns.report(truck.vehicleId, who, { cause: 'tyre', note: 'Blow-out', lat: -1.3 })).toThrow('A position is a latitude and a longitude together');
      const someoneElses = media.upload({ ownerDid: 'did:glos:somebody', kind: 'defect', dataUrl: PNG });
      expect(() => breakdowns.report(truck.vehicleId, who, { cause: 'tyre', note: 'Blow-out', photoRef: someoneElses.mediaId })).toThrow(/not one you took/);
      expect(vehicles.isUsable(truck.vehicleId)).toBe(true);
      expect(broke).toEqual([]);
      // No position from the phone: the shift's last known one.
      fleet.reportLocation(amos.did, { lat: -1.28, lng: 36.81 });
      const theirs = media.upload({ ownerDid: amos.did, kind: 'defect', dataUrl: PNG });
      const b = breakdowns.report(truck.vehicleId, who, { cause: 'tyre', note: 'Blow-out, rear left', photoRef: theirs.mediaId });
      expect(b).toMatchObject({ location: { lat: -1.28, lng: 36.81 }, locationFrom: 'last_known', hasPhoto: true, aboard: [], held: [] });
      expect(b).not.toHaveProperty('photoRef');
      expect(breakdowns.photo(truck.vehicleId, b.breakdownId, 'full').contentType).toBe('image/png');
      expect(() => media.removeByOwner(theirs.mediaId, amos.did)).toThrow(/kept as evidence/);
      expect(() => breakdowns.report(truck.vehicleId, who, { cause: 'engine', note: 'Again' })).toThrow(/^KVC 981T is already reported broken down \(.+\): the office has it$/);
    });

    it('holds today’s planned trips for it, and the plan sends it nothing more while it is off the road', () => {
      const { f, truck, who } = outOnTheRoad('KVC 982T');
      const one = anOrder(f, dayPlus(0));
      const two = anOrder(f, dayPlus(0));
      plans.accept(f.did, { day: dayPlus(0) }, 'Amina');
      expect(dispatch.plannedOrdersOn(f.did, dayPlus(0), truck.vehicleId).map((x) => x.code).sort()).toEqual([one.code, two.code].sort());
      const b = breakdowns.report(truck.vehicleId, who, { cause: 'fuel', note: 'Ran dry outside Athi River' });
      expect([...b.held].sort()).toEqual([one.code, two.code].sort());
      expect(dispatch.requireFreightPublic(one.freightId).planned?.held?.why).toBe('KVC 982T broke down on the road: plan the day again to put it on another truck');
      // Its driver is on the shift with nothing aboard — the plan would have sent the next trip. Not to a truck off the road.
      const sent = plans.send(f.did, dayPlus(0)).trucks.find((t) => t.vehicleId === truck.vehicleId)!;
      expect(sent).toMatchObject({ state: 'off_road', sent: [] });
      expect(sent.held).toHaveLength(2);
      expect(sent.held[0].why).toMatch(/^KVC 982T is off the road: Broken down \(fuel\)/);
      expect(dispatch.requireFreightPublic(one.freightId).status).toBe('ordered');
    });

    it('ends back on the road as the office says, with what was done: the driver and the shippers of what is still aboard are told', () => {
      const { f, truck, amos, who } = outOnTheRoad('KVC 983T');
      const load = anOrder(f, dayPlus(0), JENGA);
      onTruck(f, load.freightId, amos.did, true);
      const b = breakdowns.report(truck.vehicleId, who, { cause: 'engine', note: 'Overheating' });
      expect(() => care.resolveBreakdown(truck.vehicleId, b.breakdownId, { outcome: 'back_on_road', note: ' ' }, 'Amina')).toThrow('Say what was done');
      expect(() => care.resolveBreakdown(truck.vehicleId, 'brk_nope', { outcome: 'back_on_road', note: 'x' }, 'Amina')).toThrow('No such breakdown on this vehicle');
      const view = care.resolveBreakdown(truck.vehicleId, b.breakdownId, { outcome: 'back_on_road', note: 'Fan belt replaced at the roadside' }, 'Amina');
      expect(view).toMatchObject({ usable: true, offRoad: [] });
      expect(view.breakdowns[0]).toMatchObject({ breakdownId: b.breakdownId, status: 'resolved', outcome: 'back_on_road', resolvedBy: 'Amina', resolutionNote: 'Fan belt replaced at the roadside' });
      expect(ended).toHaveLength(1);
      expect(ended[0].tell).toEqual([{ shipperDid: JENGA, kind: 'freight', label: load.code, state: 'aboard', freightId: load.freightId }]);
      expect(() => care.resolveBreakdown(truck.vehicleId, b.breakdownId, { outcome: 'back_on_road', note: 'Again' }, 'Amina')).toThrow('That breakdown has already been resolved');
      // A load delivered since is nobody's news any more.
      const again = breakdowns.report(truck.vehicleId, who, { cause: 'engine', note: 'Overheating again' });
      dispatch.deliverFreight(load.freightId, amos.did, { confirmed: requiredUnloadKeys(), receiverName: 'Site foreman', podPhotoId: 'med_pod' });
      care.resolveBreakdown(truck.vehicleId, again.breakdownId, { outcome: 'back_on_road', note: 'Radiator topped up' }, 'Amina');
      expect(ended[1].tell).toEqual([]);
    });

    it('ends in the workshop: off the road as a repair until the day said — refused whole when those days are taken', () => {
      const { truck, who } = outOnTheRoad('KVC 984T');
      const b = breakdowns.report(truck.vehicleId, who, { cause: 'electrical', note: 'Dead, will not crank' });
      care.takeOffRoad(truck.vehicleId, { reason: 'service', fromDay: dayPlus(2), untilDay: dayPlus(2) }, 'Amina');
      expect(() => care.resolveBreakdown(truck.vehicleId, b.breakdownId, { outcome: 'workshop', note: 'Towed to Mombasa Road Motors' }, 'Amina')).toThrow(/already off the road from/);
      expect(breakdowns.of(truck.vehicleId)[0].status).toBe('open'); // nothing written
      const view = care.resolveBreakdown(truck.vehicleId, b.breakdownId, { outcome: 'workshop', note: 'Towed to Mombasa Road Motors', untilDay: dayPlus(1) }, 'Amina');
      expect(view.usable).toBe(false);
      expect(view.offRoad).toEqual([expect.stringMatching(/^In the workshop until .+: Towed to Mombasa Road Motors$/)]);
      expect(view.breakdowns[0]).toMatchObject({ status: 'resolved', outcome: 'workshop' });
      expect(ended[0]).toMatchObject({ plate: 'KVC 984T', tell: [] });
    });

    it('is the owning fleet’s to see: on the vehicle’s sheet, and on the fleet’s list of what is broken down now', () => {
      const { f, truck, who } = outOnTheRoad('KVC 985T');
      breakdowns.report(truck.vehicleId, who, { cause: 'accident', note: 'Hit by a matatu, nobody hurt' });
      expect(care.view(truck.vehicleId).breakdowns).toHaveLength(1);
      expect(breakdowns.openForFleet(f.did).map((b) => b.plate)).toEqual(['KVC 985T']);
      expect(breakdowns.openForFleet(aFleet('Pwani Haulage').did)).toEqual([]);
    });
  });

  describe('the daily check, and defects', () => {
    const allOk = (vehicleClass: keyof typeof CHECKLIST) => CHECKLIST[vehicleClass].map((c) => ({ item: c.item, ok: true }));
    let told: Array<{ fleetDid?: string; plate: string; defect: { item: string; safety: boolean } }>;
    beforeEach(() => {
      told = [];
      bus.subscribe<{ fleetDid?: string; plate: string; defect: { item: string; safety: boolean } }>(GlosEvent.Pudo.VehicleDefectReported, (e) => {
        told.push(e.payload);
      });
    });

    it('asks a truck about its brakes, tyres and lights, and the rest; says who checked it today', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 800T');
      const amos = aDriver(f.did);
      const sheet = care.checkSheet(amos.did, { vehicleQr: truck.qr });
      expect(sheet).toMatchObject({ vehicleId: truck.vehicleId, plate: 'KVC 800T', vehicleClass: 'truck', required: false });
      expect(sheet.items.filter((i) => i.safety).map((i) => i.item)).toEqual(['tyres', 'brakes', 'lights']);
      expect(sheet).not.toHaveProperty('checkedTodayBy');
      const result = care.submitCheck(amos.did, { vehicleId: truck.vehicleId }, allOk('truck'));
      expect(result).toMatchObject({ clean: true, found: [], alreadyOpen: [], usable: true });
      expect(care.checkSheet(amos.did, { vehicleId: truck.vehicleId }).checkedTodayBy).toBe(amos.displayName);
      expect(care.view(truck.vehicleId)).toMatchObject({ lastCheckBy: amos.displayName, lastCheckClean: true });
    });

    it('takes a vehicle off the road for a safety problem found at the check, tells its office, and not for a minor one', async () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 810T');
      const amos = aDriver(f.did);
      const answers = allOk('truck').map((a) => (a.item === 'brakes' ? { ...a, ok: false, note: 'pulling left' } : a.item === 'mirrors' ? { ...a, ok: false, note: 'cracked' } : a));
      const result = care.submitCheck(amos.did, { vehicleId: truck.vehicleId }, answers);
      expect(result.clean).toBe(false);
      expect(result.found.map((d) => [d.item, d.safety])).toEqual([
        ['brakes', true],
        ['mirrors', false],
      ]);
      expect(result.usable).toBe(false);
      expect(result.offRoad).toEqual([expect.stringMatching(new RegExp(`^Brakes reported unsafe by ${amos.displayName} on .*: pulling left$`))]);
      expect(() => fleet.couple(amos.did, truck.vehicleId)).toThrow(/KVC 810T is off the road: Brakes reported unsafe/);
      await new Promise((r) => setImmediate(r));
      expect(told.map((t) => [t.fleetDid, t.plate, t.defect.item, t.defect.safety])).toEqual([
        [f.did, 'KVC 810T', 'brakes', true],
        [f.did, 'KVC 810T', 'mirrors', false],
      ]);
      // A second check the next morning finds the same brakes: not reported twice.
      const again = care.submitCheck(amos.did, { vehicleId: truck.vehicleId }, answers, Date.now() + DAY);
      expect(again.found).toEqual([]);
      expect(again.alreadyOpen.map((d) => d.item)).toEqual(['brakes', 'mirrors']);
    });

    it('is refused whole when an item is missing or twice, a problem says nothing, or the vehicle is not theirs to drive', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 820T');
      const amos = aDriver(f.did);
      const other = aDriver(aFleet('Pwani Haulage').did);
      const answers = allOk('truck');
      expect(() => care.submitCheck(amos.did, { vehicleId: truck.vehicleId }, answers.slice(1))).toThrow(/Answer every item: tyres is not answered/);
      expect(() => care.submitCheck(amos.did, { vehicleId: truck.vehicleId }, [...answers, answers[0]])).toThrow(/Tyres is answered twice/);
      expect(() => care.submitCheck(amos.did, { vehicleId: truck.vehicleId }, [...answers.slice(0, -1), { item: 'chain', ok: true }])).toThrow(/A truck is not checked for chain/);
      expect(() => care.submitCheck(amos.did, { vehicleId: truck.vehicleId }, answers.map((a) => (a.item === 'lights' ? { ...a, ok: false } : a)))).toThrow(/Say what is wrong with the lights, or add a photo/);
      expect(() => care.submitCheck(other.did, { vehicleId: truck.vehicleId }, answers)).toThrow(/KVC 820T is not a vehicle you drive/);
      expect(() => care.submitCheck(amos.did, { vehicleQr: 'NO-SUCH-QR' }, answers)).toThrow(/No vehicle has that QR/);
      expect(care.view(truck.vehicleId)).not.toHaveProperty('lastCheckBy');
      expect(told).toEqual([]);
    });

    it('takes a defect reported later off the road only when the driver says it is not safe — and not twice', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 830T');
      const amos = aDriver(f.did);
      const minor = care.reportDefect(truck.vehicleId, { by: amos.displayName, byDid: amos.did }, { item: 'horn', note: 'quiet', safe: true });
      expect(minor).toMatchObject({ item: 'horn', safety: false, found: 'report', status: 'open' });
      expect(vehicles.isUsable(truck.vehicleId)).toBe(true);
      care.reportDefect(truck.vehicleId, { by: amos.displayName, byDid: amos.did }, { item: 'other', note: 'steering shakes at speed', safe: false });
      expect(vehicles.offRoadReasons(truck.vehicleId)).toEqual([expect.stringMatching(/^Something else reported unsafe by .*: steering shakes at speed$/)]);
      expect(() => care.reportDefect(truck.vehicleId, { by: 'Grace' }, { item: 'horn', note: 'still quiet', safe: true })).toThrow(/Horn on KVC 830T is already reported/);
      expect(() => care.reportDefect(truck.vehicleId, { by: 'Grace' }, { item: 'body', note: '  ', safe: true })).toThrow(/Say what is wrong/);
    });

    it('is back on the road when the office says fixed, or safe to drive as it is — each with its reason — and the driver is told', async () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 840T');
      const amos = aDriver(f.did);
      const decided: Array<{ defect: { status: string; decisionNote?: string; reportedByDid?: string } }> = [];
      bus.subscribe<{ defect: { status: string; decisionNote?: string; reportedByDid?: string } }>(GlosEvent.Pudo.VehicleDefectDecided, (e) => {
        decided.push(e.payload);
      });
      const brakes = care.reportDefect(truck.vehicleId, { by: amos.displayName, byDid: amos.did }, { item: 'brakes', note: 'pulling left', safe: false });
      const tyre = care.reportDefect(truck.vehicleId, { by: amos.displayName, byDid: amos.did }, { item: 'tyres', note: 'worn front left', safe: false });
      expect(() => care.decideDefect(truck.vehicleId, brakes.defectId, 'fixed', ' ', 'Amina')).toThrow(/Say what was done/);
      expect(() => care.decideDefect(truck.vehicleId, tyre.defectId, 'cleared', '', 'Amina')).toThrow(/Say why it is safe to drive as it is/);
      care.decideDefect(truck.vehicleId, brakes.defectId, 'fixed', 'New pads at Ngong Road workshop', 'Amina');
      expect(vehicles.isUsable(truck.vehicleId)).toBe(false); // the tyre still
      const view = care.decideDefect(truck.vehicleId, tyre.defectId, 'cleared', 'Within the legal tread; replaced at the next service', 'Amina');
      expect(view.usable).toBe(true);
      expect(view.defects).toEqual([]);
      expect(view.decided.map((d) => [d.item, d.status, d.decidedBy])).toEqual([
        ['tyres', 'cleared', 'Amina'],
        ['brakes', 'fixed', 'Amina'],
      ]);
      expect(() => care.decideDefect(truck.vehicleId, brakes.defectId, 'fixed', 'again', 'Amina')).toThrow(/already been decided/);
      await new Promise((r) => setImmediate(r));
      expect(decided.map((d) => [d.defect.status, d.defect.reportedByDid])).toEqual([
        ['fixed', amos.did],
        ['cleared', amos.did],
      ]);
    });

    it('refuses a shift in an unchecked vehicle only where the fleet asks for a check, and not once it is checked today', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 850T');
      const amos = aDriver(f.did);
      expect(care.checkBlocker(truck.vehicleId)).toBeUndefined();
      expect(care.setSettings(f.did, { requireDailyCheck: true })).toEqual({ requireDailyCheck: true, serviceOverdue: 'warn' });
      expect(care.checkBlocker(truck.vehicleId)).toBe('Check KVC 850T first: Kilima Logistics asks for a daily check before a shift');
      expect(care.checkSheet(amos.did, { vehicleId: truck.vehicleId }).required).toBe(true);
      care.submitCheck(amos.did, { vehicleId: truck.vehicleId }, allOk('truck'));
      expect(care.checkBlocker(truck.vehicleId)).toBeUndefined();
      // Tomorrow is another day.
      expect(care.checkBlocker(truck.vehicleId, Date.now() + DAY)).toMatch(/^Check KVC 850T first/);
      // Another fleet's rule is not this one's.
      expect(care.settingsOf(aFleet('Pwani Haulage').did)).toEqual({ requireDailyCheck: false, serviceOverdue: 'warn' });
    });

    it('keeps a photo only when it is the driver’s own, and makes it the vehicle’s: no longer theirs to delete', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 860T');
      const amos = aDriver(f.did);
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const theirs = media.upload({ ownerDid: amos.did, kind: 'defect', dataUrl: png });
      const someoneElses = media.upload({ ownerDid: 'did:glos:somebody', kind: 'defect', dataUrl: png });
      expect(() => care.reportDefect(truck.vehicleId, { by: amos.displayName, byDid: amos.did }, { item: 'body', note: 'dent', photoRef: someoneElses.mediaId, safe: true })).toThrow(/not one you took/);
      const d = care.reportDefect(truck.vehicleId, { by: amos.displayName, byDid: amos.did }, { item: 'body', note: 'dent in the left door', photoRef: theirs.mediaId, safe: true });
      expect(d).toMatchObject({ hasPhoto: true });
      expect(d).not.toHaveProperty('photoRef');
      expect(care.defectPhoto(truck.vehicleId, d.defectId, 'full').contentType).toBe('image/png');
      expect(() => care.defectPhoto(truck.vehicleId, 'dft_nope', 'full')).toThrow(/No photograph/);
      expect(() => media.removeByOwner(theirs.mediaId, amos.did)).toThrow(/kept as evidence/);
    });
  });
});
