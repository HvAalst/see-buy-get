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

import { FleetSiteService } from './fleet-site.service';
import { FleetUseService } from './fleet-use.service';
import { VehicleCareService } from './vehicle-care.service';
import { VehicleBreakdownService } from './vehicle-breakdown.service';
import { requiredLoadKeys, requiredUnloadKeys } from './heavy-cargo';
import { FleetRosterService } from './fleet-roster.service';
const DAY = 86_400_000;

/**
 * A FLEET'S SITES — and the day's plan from each of them. On the real vehicles, drivers, roster and plan.
 */
describe('a fleet’s sites', () => {
  let vehicles: VehicleService;
  let drivers: DriverService;
  let managers: FleetManagerService;
  let dispatch: DispatchService;
  let fleet: FleetService;
  let sites: FleetSiteService;
  let roster: FleetRosterService;
  let plans: FleetPlanService;
  let care: VehicleCareService;
  let breakdowns: VehicleBreakdownService;
  let use: FleetUseService;
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
    dispatch = moduleRef.get(DispatchService);
    fleet = moduleRef.get(FleetService);
    const bus = moduleRef.get(EventBus);
    sites = new FleetSiteService(managers, vehicles, drivers);
    roster = new FleetRosterService(drivers, managers, bus, sites);
    plans = new FleetPlanService(dispatch, vehicles, drivers, managers, moduleRef.get<Router>(ROUTER_TOKEN), fleet, bus, undefined, roster, sites);
    breakdowns = new VehicleBreakdownService(vehicles, managers, fleet, drivers, dispatch, moduleRef.get(DepartureService), moduleRef.get(MediaService), bus);
    care = new VehicleCareService(vehicles, managers, fleet, drivers, moduleRef.get(MediaService), bus, breakdowns);
    use = new FleetUseService(managers, vehicles, fleet, dispatch, moduleRef.get(DepartureService), sites, care, breakdowns);
  });

  const dayPlus = (n: number, from = Date.now()) => clockAt(from + n * DAY, 'Africa/Nairobi').day;
  const NAIROBI = { lat: -1.2, lng: 36.8 };
  const MOMBASA = { lat: -4.04, lng: 39.66 };

  function aFleet(name = 'Kilima Logistics') {
    seq += 1;
    const m = managers.register({
      companyName: name, contactPhone: `+25480050${seq}0`, ownerFullName: 'O O', ownerNationalId: `MGR-ST-${seq}`, location: NAIROBI, depotAddress: 'Enterprise Road, Nairobi',
      requirements: { businessRegistrationNo: `BRN-ST-${seq}`, transportOperatorLicence: `TOL-ST-${seq}`, taxId: `TAX-ST-${seq}` },
    } as never);
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    return managers.get(m.did);
  }
  function aDriver(managerDid: string) {
    seq += 1;
    const d = drivers.register({
      displayName: `Driver ${seq}`, fullName: `D ${seq}`, nationalId: `ID-ST-${seq}`, mobile: `+2547850${seq}00`,
      licenceClasses: ['truck'], licenceNumber: `L-ST-${seq}`, licenceExpiresAt: new Date(Date.now() + 365 * DAY).toISOString(), criminalRecordClear: true, managerDid,
    });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    return drivers.get(d.did);
  }
  function aTruck(managerDid: string, plate: string) {
    seq += 1;
    return vehicles.register({ plate, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 8000, ownerName: 'X', equipment: ['TLT', 'FLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid } as never);
  }
  const contractOf = (f: { did: string; companyName: string }): ContractRef => ({ contractId: 'ctr_st', fleetDid: f.did, fleetName: f.companyName, shipperName: 'Jenga Bricks' });
  function anOrder(f: { did: string; companyName: string }, day: string, near: { lat: number; lng: number }) {
    seq += 1;
    return dispatch.registerFreight({
      description: `Bricks ${seq}`, pickupLocation: { lat: near.lat - 0.05, lng: near.lng + 0.03 }, pickupLabel: 'Yard', destLabel: `Site ${seq}`, destLocation: { lat: near.lat + 0.03, lng: near.lng + 0.06 },
      weightKg: 2000, packaging: 'palletised', postedByDid: f.did, postedByName: 'Amina', contract: contractOf(f), deliverOn: day, orderRef: `ST-${seq}`,
    });
  }

  describe('the sites themselves', () => {
    it('starts with the depot the fleet signed up with; the office adds sites, changes them, and closes one nobody works from', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KST 100T');
      expect(sites.view(f.did).sites).toEqual([expect.objectContaining({ siteId: 'depot', name: 'Depot', address: 'Enterprise Road, Nairobi', main: true, loadingBays: 2, shifts: [], vehicles: 1, drivers: 0 })]);
      // A site is a name and a point on the map.
      expect(() => sites.add(f.did, { name: 'Mombasa yard' }, 'Amina')).toThrow('Put the site on the map: a plan measures from where it is');
      expect(() => sites.add(f.did, { name: '  ', ...MOMBASA }, 'Amina')).toThrow('Name the site');
      const two = sites.add(f.did, { name: 'Mombasa yard', ...MOMBASA, loadingBays: 3, hours: { mon: { open: '06:00', close: '18:00' }, sun: null } }, 'Amina');
      const mombasa = two.sites.find((s) => s.name === 'Mombasa yard')!;
      expect(mombasa).toMatchObject({ main: false, loadingBays: 3, location: MOMBASA, hours: { mon: { open: '06:00', close: '18:00' }, sun: null } });
      expect(() => sites.add(f.did, { name: 'mombasa YARD', ...MOMBASA }, 'Amina')).toThrow('There is already a site called mombasa YARD');
      expect(() => sites.update(f.did, mombasa.siteId, { hours: { tue: { open: '18:00', close: '06:00' } } }, 'Amina')).toThrow('On tue the site closes before it opens');
      // The depot is renamed like any other site, and stays the main one.
      expect(sites.update(f.did, 'depot', { name: 'Nairobi depot' }, 'Amina').sites[0]).toMatchObject({ siteId: 'depot', name: 'Nairobi depot', main: true });
      // Nobody's home quietly becomes somewhere else: a site is closed only when nobody works from it.
      sites.setHome(f.did, 'vehicle', truck.vehicleId, mombasa.siteId, 'Amina');
      expect(() => sites.close(f.did, mombasa.siteId, 'Amina')).toThrow('Move 1 vehicle to another site before closing Mombasa yard');
      sites.setHome(f.did, 'vehicle', truck.vehicleId, 'depot', 'Amina');
      expect(sites.close(f.did, mombasa.siteId, 'Amina').sites.map((s) => s.name)).toEqual(['Nairobi depot']);
      expect(() => sites.close(f.did, 'depot', 'Amina')).toThrow('This is the fleet’s only site: add another before closing it');
    });

    it('keeps another fleet’s vehicles and drivers out, and a site that is not open', () => {
      const f = aFleet();
      const other = aFleet('Pwani Haulage');
      const theirs = aTruck(other.did, 'KST 200T');
      const two = sites.add(f.did, { name: 'Mombasa yard', ...MOMBASA }, 'Amina');
      const mombasa = two.sites[1].siteId;
      expect(() => sites.setHome(f.did, 'vehicle', theirs.vehicleId, mombasa, 'Amina')).toThrow('KST 200T is not one of this fleet’s vehicles');
      expect(() => sites.setHome(f.did, 'driver', aDriver(other.did).did, mombasa, 'Amina')).toThrow('That driver is not in this fleet');
      expect(() => sites.setHome(f.did, 'vehicle', aTruck(f.did, 'KST 201T').vehicleId, 'site_nope', 'Amina')).toThrow('No such open site of this fleet');
    });
  });

  describe('the plan from every site', () => {
    /** A fleet in Nairobi and Mombasa, a truck and a driver at each, and an order near each. */
    function twoCities() {
      const f = aFleet();
      const mombasa = sites.add(f.did, { name: 'Mombasa yard', ...MOMBASA }, 'Amina').sites[1].siteId;
      const nbi = aTruck(f.did, 'KST 300T');
      const msa = aTruck(f.did, 'KST 301T');
      sites.setHome(f.did, 'vehicle', msa.vehicleId, mombasa, 'Amina');
      const wanjiru = aDriver(f.did);
      const baraka = aDriver(f.did);
      sites.setHome(f.did, 'driver', baraka.did, mombasa, 'Amina');
      const nbiOrder = anOrder(f, dayPlus(1), NAIROBI);
      const msaOrder = anOrder(f, dayPlus(1), MOMBASA);
      return { f, mombasa, nbi, msa, wanjiru, baraka, nbiOrder, msaOrder };
    }

    it('starts each truck from the site it works from', () => {
      const { f, mombasa, nbi, msa, nbiOrder, msaOrder } = twoCities();
      const plan = plans.propose(f.did, { day: dayPlus(1) });
      const nbiRoute = plan.routes.find((r) => r.vehicleId === nbi.vehicleId)!;
      const msaRoute = plan.routes.find((r) => r.vehicleId === msa.vehicleId)!;
      expect(nbiRoute).toMatchObject({ siteId: 'depot', siteName: 'Depot' });
      expect(msaRoute).toMatchObject({ siteId: mombasa, siteName: 'Mombasa yard' });
      expect(nbiRoute.trips[0].stops.map((s) => s.code)).toEqual([nbiOrder.code]);
      expect(msaRoute.trips[0].stops.map((s) => s.code)).toEqual([msaOrder.code]);
      // From its own yard: a few kilometres to the collection, not the 450 from Nairobi.
      expect(msaRoute.trips[0].emptyKm).toBeLessThan(20);
      expect(plan.sites).toEqual([
        { siteId: 'depot', name: 'Depot', trucksAvailable: 1, trucksUsed: 1, drivers: 1 },
        { siteId: mombasa, name: 'Mombasa yard', trucksAvailable: 1, trucksUsed: 1, drivers: 1 },
      ]);
    });

    it('sends no more trucks out of a site than drivers start there — and the roster says where a driver starts for a day', () => {
      const { f, mombasa, msa, wanjiru, baraka, nbiOrder, msaOrder } = twoCities();
      // Only Wanjiru drives that day, from Nairobi: Mombasa's truck has nobody, and its order says why.
      roster.set(f.did, dayPlus(1), [wanjiru.did], 'Amina');
      let plan = plans.propose(f.did, { day: dayPlus(1) });
      expect(plan.unplanned).toEqual([expect.objectContaining({ code: msaOrder.code, reason: 'no_driver' })]);
      expect(plan.sites!.find((s) => s.siteId === mombasa)).toMatchObject({ drivers: 0, trucksUsed: 0 });
      // That day she starts in Mombasa instead: Mombasa's truck goes out, and now Nairobi's order waits for a driver.
      const view = roster.set(f.did, dayPlus(1), [wanjiru.did], 'Amina', Date.now(), [{ driverDid: wanjiru.did, siteId: mombasa }]);
      expect(view.list.find((d) => d.driverDid === wanjiru.did)).toMatchObject({ rostered: true, siteId: mombasa, homeSiteId: 'depot' });
      expect(view.list.find((d) => d.driverDid === baraka.did)).toMatchObject({ rostered: false, siteId: mombasa, homeSiteId: mombasa });
      plan = plans.propose(f.did, { day: dayPlus(1) });
      expect(plan.routes.map((r) => r.vehicleId)).toEqual([msa.vehicleId]);
      expect(plan.unplanned).toEqual([expect.objectContaining({ code: nbiOrder.code, reason: 'no_driver' })]);
      // A start at a site that is not the fleet's, or for a driver who is not on the day: refused, and nothing kept.
      expect(() => roster.set(f.did, dayPlus(1), [wanjiru.did], 'Amina', Date.now(), [{ driverDid: wanjiru.did, siteId: 'site_nope' }])).toThrow('A start names a site that is not one of this fleet’s open sites');
      expect(() => roster.set(f.did, dayPlus(1), [wanjiru.did], 'Amina', Date.now(), [{ driverDid: baraka.did, siteId: mombasa }])).toThrow('A start is given for a driver who is not on the day');
      expect(roster.view(f.did, dayPlus(1)).list.find((d) => d.driverDid === wanjiru.did)!.siteId).toBe(mombasa);
    });
  });

  describe('how the vehicles were used', () => {
    it('counts, per vehicle and per site, days out, off the road and idle, hours on shift, km, loads and runs — from what was recorded', () => {
      const f = aFleet();
      const mombasa = sites.add(f.did, { name: 'Mombasa yard', ...MOMBASA }, 'Amina').sites[1].siteId;
      const out = aTruck(f.did, 'KST 400T');
      const broken = aTruck(f.did, 'KST 401T');
      const idle = aTruck(f.did, 'KST 402T');
      sites.setHome(f.did, 'vehicle', broken.vehicleId, mombasa, 'Amina');
      const amos = aDriver(f.did);
      // Out today: a shift, two readings, one load delivered.
      fleet.couple(amos.did, out.vehicleId);
      care.recordReading(out.vehicleId, 10_000, { by: 'Amos', source: 'shift_start' });
      const load = anOrder(f, dayPlus(0), NAIROBI);
      dispatch.assign(load.freightId, amos.did, { managerDid: f.did, name: 'Amina' });
      dispatch.pickupFreight(load.freightId, amos.did, { confirmed: requiredLoadKeys(dispatch.requireFreightPublic(load.freightId)), securementPhotoId: 'med_test' });
      dispatch.deliverFreight(load.freightId, amos.did, { confirmed: requiredUnloadKeys(), receiverName: 'Site foreman', podPhotoId: 'med_pod' });
      care.recordReading(out.vehicleId, 10_180, { by: 'Amos', source: 'shift_end' }, Date.now() + 1000);
      fleet.endSession(amos.did);
      // One reading alone says nothing about km driven.
      care.recordReading(idle.vehicleId, 5_000, { by: 'Amina', source: 'office' });
      // Broken down today, and not out.
      breakdowns.report(broken.vehicleId, { by: 'Amina' }, { cause: 'engine', note: 'Will not start' });

      const week = use.view(f.did, dayPlus(-6), dayPlus(0));
      expect(week.days).toBe(7);
      const of = (id: string) => week.vehicles.find((v) => v.vehicleId === id)!;
      expect(of(out.vehicleId)).toMatchObject({ siteId: 'depot', daysOut: 1, daysOffRoad: 0, daysIdle: 6, shifts: 1, km: 180, loads: 1, kgDelivered: 2000, runs: 0 });
      expect(of(out.vehicleId).loadedKm).toBeGreaterThan(0);
      expect(of(broken.vehicleId)).toMatchObject({ siteId: mombasa, siteName: 'Mombasa yard', daysOut: 0, daysOffRoad: 1, daysIdle: 6, shifts: 0, loads: 0 });
      expect(of(broken.vehicleId)).not.toHaveProperty('km'); // no readings: no number, never a guess
      expect(of(idle.vehicleId)).toMatchObject({ daysOut: 0, daysOffRoad: 0, daysIdle: 7 });
      expect(of(idle.vehicleId)).not.toHaveProperty('km');
      // A total says km only where every vehicle has it.
      expect(week.totals).toMatchObject({ vehicles: 3, daysOut: 1, daysOffRoad: 1, daysIdle: 19, shifts: 1, loads: 1, kgDelivered: 2000 });
      expect(week.totals).not.toHaveProperty('km');
      expect(week.sites).toEqual([
        expect.objectContaining({ siteId: 'depot', vehicles: 2, daysOut: 1, daysIdle: 13 }),
        expect.objectContaining({ siteId: mombasa, vehicles: 1, daysOffRoad: 1, daysIdle: 6 }),
      ]);
      expect(week.sites[0]).not.toHaveProperty('km'); // the idle truck at the depot gave no readings
      // Days still to come are not counted; wrong days are refused.
      expect(use.view(f.did, dayPlus(-2), dayPlus(5)).days).toBe(3);
      expect(() => use.view(f.did, dayPlus(0), dayPlus(-1))).toThrow('The last day comes on or after the first');
      expect(() => use.view(f.did, dayPlus(-40), dayPlus(0))).toThrow('At most 31 days at a time');
    });
  });
});
