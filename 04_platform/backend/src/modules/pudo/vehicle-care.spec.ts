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
import { VehicleCareService } from './vehicle-care.service';

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
    care = new VehicleCareService(vehicles, managers, fleet);
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
  function anOrder(f: { did: string; companyName: string }, day: string) {
    seq += 1;
    return dispatch.registerFreight({
      description: `Bricks ${seq}`, pickupLocation: { lat: -1.3, lng: 36.85 }, pickupLabel: 'Jenga yard', destLabel: `Site ${seq}`, destLocation: { lat: -1.25, lng: 36.9 },
      weightKg: 2000, packaging: 'palletised', postedByDid: f.did, postedByName: 'Amina', contract: contractOf(f), deliverOn: day, orderRef: `WS-${seq}`,
    });
  }

  describe('off the road, and back', () => {
    it('takes a vehicle off the road from today, says why at every door, and puts it back', () => {
      const f = aFleet();
      const truck = aTruck(f.did, 'KVC 100T');
      const amos = aDriver(f.did);
      const view = care.takeOffRoad(truck.vehicleId, { reason: 'repair', note: 'brakes', untilDay: dayPlus(2) }, 'Amina');
      const line = `In the workshop until ${new Date(`${dayPlus(2)}T12:00:00Z`).getUTCDate()} `;
      expect(view).toMatchObject({ usable: false, inUse: false });
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
});
