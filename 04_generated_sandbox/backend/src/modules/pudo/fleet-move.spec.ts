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
import { PersonService } from './person.service';
import { AccountService } from './account.service';
import { OtpService } from './otp.service';
import { FleetMoveService } from './fleet-move.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { NotificationService } from './notification.service';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { OutboxPushSender } from './push-sender';
import { PUSH_SENDER } from './notification.types';
import { requiredLoadKeys, requiredUnloadKeys } from './heavy-cargo';
import { nearestPlace } from './geo-gazetteer';
import { GazetteerGeocoder, GEOCODER } from './geocoder';
import { HeuristicRouter, ROUTER } from './router';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { DidService } from '../../foundation/did/did.service';
import { AuthService } from '../../foundation/auth/auth.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
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
import type { AgentService as Agents } from './agent.service';
import type { UnclaimedService } from './unclaimed.service';
import type { ImportService } from './import.service';

/**
 * A DRIVER MOVES TO ANOTHER FLEET — WITH THE FLEET'S CODE, AND WITHOUT TAKING THE OLD FLEET'S HISTORY.
 *
 * The user's answer, once registration stopped forgetting who is registered: a driver who wants to drive for
 * another fleet enters its code, the same code they would sign up with; it happens at once or is refused by name.
 *
 * The hard half is not the move — it is everything that asked "whose is this?" of the driver's fleet TODAY. The
 * fleet's earnings statement, its track record, its consignment notes and the money taken back on an upheld
 * claim all did. Every one of them is exercised here across a real move, on the real services.
 */
describe('a driver moving to another fleet', () => {
  let drivers: DriverService;
  let vehicles: VehicleService;
  let fleet: FleetService;
  let managers: FleetManagerService;
  let dispatch: DispatchService;
  let departures: DepartureService;
  let corridors: CorridorService;
  let vendors: VendorService;
  let persons: PersonService;
  let auth: AuthService;
  let books: BooksService;
  let entities: EntityService;
  let moves: FleetMoveService;
  let notes: ConsignmentNoteService;
  let notifications: NotificationService;
  let events: EventBus;
  let moduleOtp: () => OtpService;
  let accounts: () => AccountService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        DepartureService, PersonService, AccountService, OtpService, AuthService, FleetMoveService,
        NotificationService, OutboxPushSender, { provide: PUSH_SENDER, useExisting: OutboxPushSender },
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        EntityService, PresenceService, BooksService, FxService,
        PayoutService, SandboxPayoutRail, { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail },
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    moduleRef.get(FxService).seed();
    books = moduleRef.get(BooksService);
    books.reset();
    drivers = moduleRef.get(DriverService);
    vehicles = moduleRef.get(VehicleService);
    fleet = moduleRef.get(FleetService);
    managers = moduleRef.get(FleetManagerService);
    dispatch = moduleRef.get(DispatchService);
    departures = moduleRef.get(DepartureService);
    corridors = moduleRef.get(CorridorService);
    vendors = moduleRef.get(VendorService);
    persons = moduleRef.get(PersonService);
    auth = moduleRef.get(AuthService);
    moves = moduleRef.get(FleetMoveService);
    notifications = moduleRef.get(NotificationService);
    events = moduleRef.get(EventBus);
    moduleOtp = () => moduleRef.get(OtpService);
    accounts = () => moduleRef.get(AccountService);
    const none = {} as never;
    notes = new ConsignmentNoteService(dispatch, drivers, managers, none as Agents, vendors, events, none as ImportService);
    // The real dispatcher on the same bus, so what the fleets are told is read from the real inbox.
    new NotificationDispatcher(
      events,
      notifications,
      moduleRef.get(ParcelService),
      persons,
      moduleRef.get(AgentService),
      fleet,
      moduleRef.get(ToteService),
      moduleRef.get(MdpService),
      dispatch,
      { sweep: () => [] } as unknown as UnclaimedService,
      vendors,
    ).onModuleInit();
  });

  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  let seq = 0;
  /** A fleet all the way through onboarding — papers, a decision, the bond — so it may employ and be owed. */
  function aFleet(name: string) {
    seq += 1;
    const m = managers.register({
      companyName: name, contactPhone: `+25480010${seq}0`, ownerFullName: 'O O', ownerNationalId: `MGR-MV-${seq}`,
      location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-MV-${seq}`, transportOperatorLicence: `TOL-MV-${seq}`, taxId: `TAX-MV-${seq}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    return managers.get(m.did);
  }
  const codeOf = (did: string) => managers.get(did).loginCode!;

  /** A truck driver cleared to drive, employed by `managerDid` (or driving for themselves), with a truck to couple. */
  function aDriver(managerDid?: string) {
    seq += 1;
    const d = drivers.register({
      displayName: `Mover ${seq}`, fullName: `M ${seq}`, nationalId: `ID-MV-${seq}`, mobile: `+2547810${seq}00`,
      licenceClasses: ['truck'], licenceNumber: `L-MV-${seq}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true,
      ...(managerDid ? { managerDid } : {}),
    });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: `MV-${seq}`, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, ...(managerDid ? { managerDid } : {}) } as never);
    return { driver: drivers.get(d.did), truck };
  }

  /** One haul, taken for whoever the driver drives for now, carried and delivered. The shift ends after. */
  function aDeliveredHaul(driverDid: string, truckId: string, managerDid: string) {
    const vendor = vendors.register({ name: `Shipper ${++seq}` });
    vendors.topUp(vendor.vendorId, 500);
    const at = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', destLocation: at, weightKg: 200, packaging: 'palletised', shipperDid: vendor.vendorId });
    fleet.couple(driverDid, truckId);
    dispatch.assign(f.freightId, driverDid, { managerDid });
    dispatch.pickupFreight(f.freightId, driverDid, { confirmed: requiredLoadKeys(f), securementPhotoId: 'med_test' });
    dispatch.deliverFreight(f.freightId, driverDid, { confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: 'med_pod' });
    fleet.uncouple(driverDid);
    return { freight: dispatch.listFreight().find((x) => x.freightId === f.freightId)!, vendor };
  }

  const owedTo = (counterparty: string) => -books.balance(entities.requireForJurisdiction('KE').entityId, ACCOUNT_CODES.PAYABLE_PROVIDER, undefined, counterparty) || 0;

  /* ----------------------------------------------------------------- the move -- */

  describe('the move', () => {
    it('shows which fleet the code belongs to, and what they drive for now, before anything changes', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const { driver } = aDriver(kilima.did);
      expect(moves.check(driver.did, codeOf(pwani.did))).toMatchObject({ fleetDid: pwani.did, companyName: 'Pwani Haulage', fromCompany: 'Kilima Logistics', blockers: [] });
      expect(drivers.get(driver.did).managerDid).toBe(kilima.did);
    });

    it('moves them at once, and a courier who joins a fleet drops the residence a fleet driver never carries', () => {
      const pwani = aFleet('Pwani Haulage');
      const { driver } = aDriver();
      expect(driver.jurisdiction).toBe('KE');
      const moved = moves.move(driver.did, codeOf(pwani.did).toLowerCase());
      expect(moved.companyName).toBe('Pwani Haulage');
      expect(drivers.get(driver.did)).toMatchObject({ managerDid: pwani.did });
      expect(drivers.get(driver.did).jurisdiction).toBeUndefined();
      expect(drivers.get(driver.did).entityId).toBeUndefined();
    });

    it('refuses a code nobody has, and the fleet they are already in, in words a driver can act on', () => {
      const kilima = aFleet('Kilima Logistics');
      const { driver } = aDriver(kilima.did);
      expect(() => moves.check(driver.did, 'FM-NOPE00')).toThrow(/No fleet has that code/);
      expect(() => moves.move(driver.did, codeOf(kilima.did))).toThrow(/already drive for Kilima Logistics/);
    });
  });

  /* -------------------------------------------------- nothing unfinished left behind -- */

  describe('refused while anything is unfinished — and nothing changes', () => {
    it('on a shift', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const { driver, truck } = aDriver(kilima.did);
      fleet.couple(driver.did, truck.vehicleId);
      expect(() => moves.move(driver.did, codeOf(pwani.did))).toThrow(/on a shift — end it first/);
      expect(drivers.get(driver.did).managerDid).toBe(kilima.did);
    });

    it('with a load in hand', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const { driver, truck } = aDriver(kilima.did);
      const at = { lat: -1.2, lng: 36.8 };
      const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', destLocation: at, weightKg: 200, packaging: 'palletised' });
      fleet.couple(driver.did, truck.vehicleId);
      dispatch.assign(f.freightId, driver.did, { managerDid: kilima.did });
      const check = moves.check(driver.did, codeOf(pwani.did));
      expect(check.blockers.join(' | ')).toMatch(new RegExp(`carrying ${f.code}`));
      expect(() => moves.move(driver.did, codeOf(pwani.did))).toThrow(/Finish this first/);
      expect(drivers.get(driver.did).managerDid).toBe(kilima.did);
    });

    it('while rostered on a run of the current fleet that is still to go', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const { driver, truck } = aDriver(kilima.did);
      const line = corridors.publish(corridors.proposeLine({ managerDid: kilima.did, company: 'Kilima Logistics', name: 'Nairobi – Mombasa MV', originZone: 'Nairobi MV', destZone: 'Mombasa MV', vehicleType: 'truck' }).corridorId, 'did:glos:staff');
      const run = departures.declare({ managerDid: kilima.did, corridorId: line.corridorId, vehicleId: truck.vehicleId, leavesAt: new Date(Date.now() + 86_400_000).toISOString(), capacityKg: 6000, capacityM3: 40, basis: 'per_trip', amount: 450 });
      departures.assignDriver(run.departureId, kilima.did, { did: driver.did, name: driver.displayName });
      expect(() => moves.move(driver.did, codeOf(pwani.did))).toThrow(/on the Nairobi – Mombasa MV run — your fleet office has to take you off it/);
      expect(drivers.get(driver.did).managerDid).toBe(kilima.did);
    });
  });

  /* --------------------------------------------------- the old fleet keeps its history -- */

  describe('what the old fleet did stays the old fleet’s', () => {
    it('its earnings statement keeps the haul, and the new fleet never sees it', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const { driver, truck } = aDriver(kilima.did);
      const { freight } = aDeliveredHaul(driver.did, truck.vehicleId, kilima.did);
      moves.move(driver.did, codeOf(pwani.did));

      const name = (did: string) => drivers.get(did).displayName;
      expect(dispatch.fleetJobsPage(kilima.did, name, {} as never).items.map((r) => r.freightId)).toEqual([freight.freightId]);
      expect(dispatch.fleetJobsPage(pwani.did, name, {} as never).items).toHaveLength(0);
      // The driver still drove it, and their name stays on the old fleet's row.
      expect(dispatch.fleetJobsPage(kilima.did, name, {} as never).items[0].driverName).toBe(driver.displayName);
    });

    it('its track record keeps the haul', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const { driver, truck } = aDriver(kilima.did);
      aDeliveredHaul(driver.did, truck.vehicleId, kilima.did);
      moves.move(driver.did, codeOf(pwani.did));
      expect(dispatch.mobilisationFor(kilima.did).delivered).toBe(1);
      expect(dispatch.mobilisationFor(pwani.did).claimed).toBe(0);
      expect(dispatch.driversWhoCarriedFor(kilima.did)).toEqual([driver.did]);
    });

    it('a load given back keeps the fleet it was given back for', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const { driver, truck } = aDriver(kilima.did);
      const at = { lat: -1.2, lng: 36.8 };
      const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', destLocation: at, weightKg: 200, packaging: 'palletised' });
      fleet.couple(driver.did, truck.vehicleId);
      dispatch.assign(f.freightId, driver.did, { managerDid: kilima.did });
      dispatch.handBack(f.freightId, driver.did, 'Truck broke down');
      fleet.uncouple(driver.did);
      moves.move(driver.did, codeOf(pwani.did));
      expect(dispatch.handBacksFor(kilima.did).map((h) => h.code)).toEqual([f.code]);
      expect(dispatch.handBacksFor(pwani.did)).toHaveLength(0);
    });

    it('the lane keeps crediting the loads to the fleet that carried them', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const { driver, truck } = aDriver(kilima.did);
      const { freight } = aDeliveredHaul(driver.did, truck.vehicleId, kilima.did);
      moves.move(driver.did, codeOf(pwani.did));
      const place = nearestPlace(freight.pickupLocation!)!.name;
      const lane = dispatch.laneCarriage({ from: place, to: place, since: 0, until: Date.now() + 60_000 });
      expect(lane.carriers).toEqual([{ kind: 'fleet', id: kilima.did, loads: 1 }]);
    });

    it('its consignment notes stay readable by it, and are never readable by the new fleet', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const { driver, truck } = aDriver(kilima.did);
      const { freight } = aDeliveredHaul(driver.did, truck.vehicleId, kilima.did);
      moves.move(driver.did, codeOf(pwani.did));
      expect(notes.isParty(freight, kilima.did)).toBe(true);
      expect(notes.isParty(freight, pwani.did)).toBe(false);
      expect(notes.partiesOf(freight)).toContain(kilima.did);
      expect(notes.partiesOf(freight)).not.toContain(pwani.did);
      expect(notes.noteFor(freight.freightId).carrier).toMatchObject({ name: 'Kilima Logistics' });
    });

    it('an upheld claim weeks later takes the money back from the fleet that was paid, not the one they joined', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const { driver, truck } = aDriver(kilima.did);
      const { freight, vendor } = aDeliveredHaul(driver.did, truck.vehicleId, kilima.did);
      expect(freight.driverPayee).toMatchObject({ payeeDid: kilima.did });
      const owedKilima = owedTo(kilima.did);
      moves.move(driver.did, codeOf(pwani.did));

      dispatch.openFreightClaim(freight.freightId, vendor.vendorId, { kind: 'damaged', description: 'Crushed' });
      const decided = dispatch.resolveFreightClaim(freight.freightId, { decision: 'upheld', award: 40, note: 'Photo shows crush damage' });
      expect(decided.clawback?.amount).toBeGreaterThan(0);
      expect(owedTo(kilima.did)).toBeCloseTo(owedKilima - decided.clawback!.amount, 2);
      expect(owedTo(pwani.did)).toBe(0);
    });
  });

  /* ------------------------------------------------------------- the sign-in follows -- */

  describe('the sign-in follows the driver', () => {
    it('re-points their person link at the new fleet and ends every session that carried the old one', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const { driver } = aDriver(kilima.did);
      const person = persons.attachRole('+254781999001', 'driver', driver.did, kilima.did);
      const old = auth.mintActorToken({ role: 'driver', did: driver.did, tenant: kilima.did, revocationKey: person.personDid, personDid: person.personDid });
      const consumer = auth.mintActorToken({ role: 'consumer', did: person.personDid, personDid: person.personDid });
      expect(auth.introspect(old.access_token).active).toBe(true);

      moves.move(driver.did, codeOf(pwani.did));

      expect(persons.findByDid(person.personDid)!.roles.find((r) => r.role === 'driver')!.tenant).toBe(pwani.did);
      expect(auth.introspect(old.access_token)).toMatchObject({ active: false, reason: 'revoked' });
      // The same person's other sign-ins have nothing to do with which fleet they drive for.
      expect(auth.introspect(consumer.access_token).active).toBe(true);
      const fresh = auth.mintActorToken({ role: 'driver', did: driver.did, tenant: pwani.did });
      expect(auth.introspect(fresh.access_token)).toMatchObject({ active: true, tenant: pwani.did });
    });
  });

  describe('the sign-in by email follows too', () => {
    it('mints the next email sign-in with the new fleet, not the one the account was opened with', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const otp = moduleOtp();
      const phone = '+254781999002';
      otp.verify(phone, otp.request(phone).code);
      const opened = accounts().signup({ role: 'driver', email: 'rider@sbg.test', password: 'secret12', phone, profile: { fleetCode: codeOf(kilima.did), driver: { displayName: 'Rider', fullName: 'R R', nationalId: '88001122', mobile: phone, licenceClasses: ['motorcycle'] } } });
      expect(auth.introspect(opened.token.access_token).tenant).toBe(kilima.did);
      moves.move(opened.did, codeOf(pwani.did));
      expect(auth.introspect(opened.token.access_token).active).toBe(false);
      const again = accounts().login('rider@sbg.test', 'secret12');
      expect(auth.introspect(again.token.access_token)).toMatchObject({ active: true, tenant: pwani.did });
    });
  });

  /* ------------------------------------------------------------------ who is told -- */

  describe('who is told', () => {
    it('tells the fleet they joined who it is, and the fleet they left what it keeps — never where they went', async () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const { driver } = aDriver(kilima.did);
      moves.move(driver.did, codeOf(pwani.did));
      await settle();

      const [joined] = notifications.inboxFor(pwani.did);
      expect(joined).toMatchObject({ kind: 'roster_changed', title: `${driver.displayName} joined your fleet` });
      const [left] = notifications.inboxFor(kilima.did);
      expect(left.title).toBe(`${driver.displayName} left your fleet`);
      expect(left.body).toContain('stays in your records');
      expect(left.body).not.toContain('Pwani');
      expect(notifications.inboxFor(driver.did)).toHaveLength(0);
    });
  });
});
