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
import { DispatchService, driverJobRowOf, driverJobsSummaryOf } from './dispatch.service';
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
import { FleetOfferService, MAX_OFFERS_PER_DAY, OFFER_DAYS } from './fleet-offer.service';
import { ownerDrivers } from './handle-directory.service';
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
import type { FleetDriver } from './fleet.types';

const DAY = 86_400_000;

/**
 * A DRIVER CHANGES FLEET — BECAUSE A FLEET NAMED THEM AND THEY SAID YES, AND NEVER BY A CODE.
 *
 * The user's catch (2026-10-01): the fleet code is six characters of hexadecimal, it names the company at its own
 * sign-in, and it is handed round a depot — anybody could guess or borrow their way onto somebody's trucks. Now a
 * fleet offers a place to a driver it names by the phone number they sign in with; only that driver's own sign-in
 * can take it; a fleet can take a driver off; and a fleet's trucks are for its own drivers.
 *
 * And the half that was never about the code: everything that asked "whose is this?" of the driver's fleet TODAY —
 * the earnings statement, the track record, the consignment notes, the money taken back on an upheld claim — is
 * exercised here across a real move, on the real services.
 */
describe('a driver changing fleet', () => {
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
  let offers: FleetOfferService;
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
        DepartureService, PersonService, AccountService, OtpService, AuthService, FleetMoveService, FleetOfferService,
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
    offers = moduleRef.get(FleetOfferService);
    notifications = moduleRef.get(NotificationService);
    events = moduleRef.get(EventBus);
    moduleOtp = () => moduleRef.get(OtpService);
    accounts = () => moduleRef.get(AccountService);
    const none = {} as never;
    notes = new ConsignmentNoteService(dispatch, drivers, managers, none as Agents, vendors, events, none as ImportService);
    // The real dispatcher on the same bus, so what everybody is told is read from the real inbox.
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

  /**
   * A truck driver cleared to drive, employed by `managerDid` (or driving for themselves), with a truck of that
   * fleet's to couple — and linked to the person behind their phone, exactly as registering them does.
   */
  function aDriver(managerDid?: string) {
    seq += 1;
    const phone = `+2547810${seq}00`;
    const d = drivers.register({
      displayName: `Mover ${seq}`, fullName: `M ${seq}`, nationalId: `ID-MV-${seq}`, mobile: phone,
      licenceClasses: ['truck'], licenceNumber: `L-MV-${seq}`, licenceExpiresAt: new Date(Date.now() + 365 * DAY).toISOString(), criminalRecordClear: true,
      ...(managerDid ? { managerDid } : {}),
    });
    persons.attachRole(phone, 'driver', d.did, managerDid);
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = aTruck(managerDid);
    return { driver: drivers.get(d.did), truck, phone };
  }

  function aTruck(managerDid?: string, ownerDriverDid?: string) {
    seq += 1;
    return vehicles.register({ plate: `MV-${seq}`, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, ...(managerDid ? { managerDid } : {}), ...(ownerDriverDid ? { ownerDriverDid } : {}) } as never);
  }

  /** The whole way in: the fleet offers by phone, the driver says yes. */
  function joins(fleetDid: string, d: { driver: FleetDriver; phone: string }, now?: number) {
    const o = offers.offer(fleetDid, d.phone, undefined, now);
    return offers.accept(o.offerId, d.driver.did, now);
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

  /* ------------------------------------------------------------- the offer -- */

  describe('a fleet offers a place, and only the driver it named can take it', () => {
    it('is addressed by the number they sign in with, shows the driver who wants them, and changes nothing until they say yes', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      const made = offers.offer(pwani.did, d.phone);
      expect(made).toMatchObject({ status: 'open', phoneEnding: d.phone.slice(-3) });
      // Before a yes, the number names nobody to the office — no name, nothing about where they drive now.
      expect(made).not.toHaveProperty('driverName');
      expect(JSON.stringify(offers.forFleet(pwani.did))).not.toContain(d.driver.displayName);
      expect(JSON.stringify(offers.forFleet(pwani.did))).not.toContain('Kilima');

      expect(offers.forDriver(d.driver.did)).toEqual([expect.objectContaining({ offerId: made.offerId, companyName: 'Pwani Haulage', fromCompany: 'Kilima Logistics', blockers: [] })]);
      expect(drivers.get(d.driver.did).managerDid).toBe(kilima.did);
    });

    it('moves them at once on yes; a courier drops the residence a fleet driver never carries; the office now sees who', () => {
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver();
      expect(d.driver.jurisdiction).toBe('KE');
      const moved = joins(pwani.did, d);
      expect(moved.companyName).toBe('Pwani Haulage');
      expect(drivers.get(d.driver.did)).toMatchObject({ managerDid: pwani.did });
      expect(drivers.get(d.driver.did).jurisdiction).toBeUndefined();
      expect(drivers.get(d.driver.did).entityId).toBeUndefined();
      expect(offers.forFleet(pwani.did)).toEqual([expect.objectContaining({ status: 'accepted', driverName: d.driver.displayName })]);
    });

    it('refuses a number nobody signs in with and a driver already theirs; a second offer is the same offer', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      expect(() => offers.offer(pwani.did, '+254799000111')).toThrow(/No driver signs in with that number/);
      expect(() => offers.offer(kilima.did, d.phone)).toThrow(/already drive for you/);
      const first = offers.offer(pwani.did, d.phone);
      expect(offers.offer(pwani.did, d.phone).offerId).toBe(first.offerId);
      expect(offers.forDriver(d.driver.did)).toHaveLength(1);
    });

    it('is bound to the DRIVER the number named: another driver cannot take it, not even a colleague in the same fleet', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const x = aDriver(kilima.did);
      const colleague = aDriver(kilima.did);
      const o = offers.offer(pwani.did, x.phone);
      expect(() => offers.accept(o.offerId, colleague.driver.did)).toThrow(/No such offer/);
      expect(() => offers.decline(o.offerId, colleague.driver.did)).toThrow(/No such offer/);
      expect(offers.forDriver(colleague.driver.did)).toHaveLength(0);
      expect(drivers.get(colleague.driver.did).managerDid).toBe(kilima.did);
      expect(drivers.get(x.driver.did).managerDid).toBe(kilima.did);
    });

    it('no closes it, and the fleet hears it by the number it typed — never by name', async () => {
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver();
      const o = offers.offer(pwani.did, d.phone);
      offers.decline(o.offerId, d.driver.did);
      await settle();
      const [said] = notifications.inboxFor(pwani.did);
      expect(said).toMatchObject({ kind: 'roster_changed', title: `The driver on •••${d.phone.slice(-3)} said no` });
      expect(said.body).not.toContain(d.driver.displayName);
      expect(() => offers.accept(o.offerId, d.driver.did)).toThrow(/already answered/);
      expect(drivers.get(d.driver.did).managerDid).toBeUndefined();
    });

    it(`lapses after ${OFFER_DAYS} days by itself — nothing is left waiting on an answer`, () => {
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver();
      const t0 = Date.now();
      const o = offers.offer(pwani.did, d.phone, undefined, t0);
      const later = t0 + OFFER_DAYS * DAY + 1;
      expect(offers.forDriver(d.driver.did, later)).toHaveLength(0);
      expect(offers.forFleet(pwani.did, later)).toEqual([expect.objectContaining({ offerId: o.offerId, status: 'lapsed' })]);
      expect(() => offers.accept(o.offerId, d.driver.did, later)).toThrow(/lapsed — ask Pwani Haulage to offer you a place again/);
      // …and the fleet can simply offer again.
      expect(offers.offer(pwani.did, d.phone, undefined, later).offerId).not.toBe(o.offerId);
    });

    it('the fleet can take an open offer back, and the driver is told it is gone', async () => {
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver();
      const o = offers.offer(pwani.did, d.phone);
      await settle();
      expect(notifications.inboxFor(d.driver.did)[0]).toMatchObject({ kind: 'fleet_offer', title: 'Pwani Haulage offers you a place in their fleet' });
      offers.withdraw(o.offerId, pwani.did);
      await settle();
      expect(notifications.inboxFor(d.driver.did).map((n) => n.title)).toContain('Pwani Haulage took back its offer');
      expect(() => offers.accept(o.offerId, d.driver.did)).toThrow(/took this offer back/);
      expect(() => offers.withdraw(o.offerId, aFleet('Somebody Else').did)).toThrow(/No such offer/);
    });

    it(`caps a fleet at ${MAX_OFFERS_PER_DAY} offers a day, refused ones included — no going through a phone book`, () => {
      const pwani = aFleet('Pwani Haulage');
      const t0 = Date.now();
      for (let i = 0; i < MAX_OFFERS_PER_DAY; i++) expect(() => offers.offer(pwani.did, `+2547990${String(i).padStart(5, '0')}`, undefined, t0)).toThrow(/No driver signs in/);
      const d = aDriver();
      expect(() => offers.offer(pwani.did, d.phone, undefined, t0)).toThrow(/offers in a day — try again tomorrow/);
      expect(offers.offer(pwani.did, d.phone, undefined, t0 + DAY + 1).status).toBe('open');
    });
  });

  /* -------------------------------------------------- nothing unfinished left behind -- */

  describe('saying yes is refused while anything is unfinished — and nothing changes', () => {
    it('on a shift', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      fleet.couple(d.driver.did, d.truck.vehicleId);
      const o = offers.offer(pwani.did, d.phone);
      expect(offers.forDriver(d.driver.did)[0].blockers).toEqual(['you are on a shift — end it first']);
      expect(() => offers.accept(o.offerId, d.driver.did)).toThrow(/on a shift — end it first/);
      expect(drivers.get(d.driver.did).managerDid).toBe(kilima.did);
      // Still open: finishing the shift and saying yes is the way through.
      fleet.uncouple(d.driver.did);
      expect(offers.accept(o.offerId, d.driver.did).companyName).toBe('Pwani Haulage');
    });

    it('with a load in hand', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      const at = { lat: -1.2, lng: 36.8 };
      const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', destLocation: at, weightKg: 200, packaging: 'palletised' });
      fleet.couple(d.driver.did, d.truck.vehicleId);
      dispatch.assign(f.freightId, d.driver.did, { managerDid: kilima.did });
      const o = offers.offer(pwani.did, d.phone);
      expect(offers.forDriver(d.driver.did)[0].blockers.join(' | ')).toMatch(new RegExp(`carrying ${f.code}`));
      expect(() => offers.accept(o.offerId, d.driver.did)).toThrow(/Finish this first/);
      expect(drivers.get(d.driver.did).managerDid).toBe(kilima.did);
    });

    it('while rostered on a run of the current fleet that is still to go', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      const line = corridors.publish(corridors.proposeLine({ managerDid: kilima.did, company: 'Kilima Logistics', name: 'Nairobi – Mombasa MV', originZone: 'Nairobi MV', destZone: 'Mombasa MV', vehicleType: 'truck' }).corridorId, 'did:glos:staff');
      const run = departures.declare({ managerDid: kilima.did, corridorId: line.corridorId, vehicleId: d.truck.vehicleId, leavesAt: new Date(Date.now() + DAY).toISOString(), capacityKg: 6000, capacityM3: 40, basis: 'per_trip', amount: 450 });
      departures.assignDriver(run.departureId, kilima.did, { did: d.driver.did, name: d.driver.displayName });
      const o = offers.offer(pwani.did, d.phone);
      expect(() => offers.accept(o.offerId, d.driver.did)).toThrow(/on the Nairobi – Mombasa MV run — your fleet office has to take you off it/);
      expect(drivers.get(d.driver.did).managerDid).toBe(kilima.did);
    });
  });

  /* --------------------------------------------------- the old fleet keeps its history -- */

  describe('what the old fleet did stays the old fleet’s', () => {
    it('its earnings statement keeps the haul, and the new fleet never sees it', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      const { freight } = aDeliveredHaul(d.driver.did, d.truck.vehicleId, kilima.did);
      joins(pwani.did, d);

      const name = (did: string) => drivers.get(did).displayName;
      expect(dispatch.fleetJobsPage(kilima.did, name, {} as never).items.map((r) => r.freightId)).toEqual([freight.freightId]);
      expect(dispatch.fleetJobsPage(pwani.did, name, {} as never).items).toHaveLength(0);
      expect(dispatch.fleetJobsPage(kilima.did, name, {} as never).items[0].driverName).toBe(d.driver.displayName);
    });

    it('its track record keeps the haul', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      aDeliveredHaul(d.driver.did, d.truck.vehicleId, kilima.did);
      joins(pwani.did, d);
      expect(dispatch.mobilisationFor(kilima.did).delivered).toBe(1);
      expect(dispatch.mobilisationFor(pwani.did).claimed).toBe(0);
      expect(dispatch.driversWhoCarriedFor(kilima.did)).toEqual([d.driver.did]);
    });

    it('a load given back keeps the fleet it was given back for', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      const at = { lat: -1.2, lng: 36.8 };
      const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', destLocation: at, weightKg: 200, packaging: 'palletised' });
      fleet.couple(d.driver.did, d.truck.vehicleId);
      dispatch.assign(f.freightId, d.driver.did, { managerDid: kilima.did });
      dispatch.handBack(f.freightId, d.driver.did, 'Truck broke down');
      fleet.uncouple(d.driver.did);
      joins(pwani.did, d);
      expect(dispatch.handBacksFor(kilima.did).map((h) => h.code)).toEqual([f.code]);
      expect(dispatch.handBacksFor(pwani.did)).toHaveLength(0);
    });

    it('the lane keeps crediting the loads to the fleet that carried them', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      const { freight } = aDeliveredHaul(d.driver.did, d.truck.vehicleId, kilima.did);
      joins(pwani.did, d);
      const place = nearestPlace(freight.pickupLocation!)!.name;
      const lane = dispatch.laneCarriage({ from: place, to: place, since: 0, until: Date.now() + 60_000 });
      expect(lane.carriers).toEqual([{ kind: 'fleet', id: kilima.did, loads: 1 }]);
    });

    it('its consignment notes stay readable by it, and are never readable by the new fleet', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      const { freight } = aDeliveredHaul(d.driver.did, d.truck.vehicleId, kilima.did);
      joins(pwani.did, d);
      expect(notes.isParty(freight, kilima.did)).toBe(true);
      expect(notes.isParty(freight, pwani.did)).toBe(false);
      expect(notes.partiesOf(freight)).toContain(kilima.did);
      expect(notes.partiesOf(freight)).not.toContain(pwani.did);
      expect(notes.noteFor(freight.freightId).carrier).toMatchObject({ name: 'Kilima Logistics' });
    });

    it('an upheld claim weeks later takes the money back from the fleet that was paid, not the one they joined', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      const { freight, vendor } = aDeliveredHaul(d.driver.did, d.truck.vehicleId, kilima.did);
      expect(freight.driverPayee).toMatchObject({ payeeDid: kilima.did });
      const owedKilima = owedTo(kilima.did);
      joins(pwani.did, d);

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
      const d = aDriver(kilima.did);
      const person = persons.findByPhone(d.phone)!;
      const old = auth.mintActorToken({ role: 'driver', did: d.driver.did, tenant: kilima.did, revocationKey: person.personDid, personDid: person.personDid });
      const consumer = auth.mintActorToken({ role: 'consumer', did: person.personDid, personDid: person.personDid });
      expect(auth.introspect(old.access_token).active).toBe(true);

      joins(pwani.did, d);

      expect(persons.findByDid(person.personDid)!.roles.find((r) => r.role === 'driver')!.tenant).toBe(pwani.did);
      expect(auth.introspect(old.access_token)).toMatchObject({ active: false, reason: 'revoked' });
      // The same person's other sign-ins have nothing to do with which fleet they drive for.
      expect(auth.introspect(consumer.access_token).active).toBe(true);
    });

    it('mints the next email sign-in with the new fleet', () => {
      const pwani = aFleet('Pwani Haulage');
      const otp = moduleOtp();
      const phone = '+254781999002';
      otp.verify(phone, otp.request(phone).code);
      const opened = accounts().signup({ role: 'driver', email: 'rider@sbg.test', password: 'mkate-na-chai-1', phone, profile: { driver: { displayName: 'Rider', fullName: 'R R', nationalId: '88001122', mobile: phone, licenceClasses: ['motorcycle'] } } });
      expect(auth.introspect(opened.token.access_token).tenant).toBeUndefined();
      const o = offers.offer(pwani.did, phone);
      offers.accept(o.offerId, opened.did);
      expect(auth.introspect(opened.token.access_token).active).toBe(false);
      const again = accounts().login('rider@sbg.test', 'mkate-na-chai-1');
      expect(auth.introspect(again.token.access_token)).toMatchObject({ active: true, tenant: pwani.did });
    });
  });

  /* ------------------------------------------------------ nobody signs themselves in -- */

  describe('nobody signs themselves into a fleet', () => {
    it('refuses a sign-up carrying a fleet code, and ignores a fleet named inside the form', () => {
      const kilima = aFleet('Kilima Logistics');
      const otp = moduleOtp();
      const phone = '+254781999003';
      otp.verify(phone, otp.request(phone).code);
      expect(() =>
        accounts().signup({ role: 'driver', email: 'coded@sbg.test', password: 'mkate-na-chai-1', phone, profile: { fleetCode: kilima.loginCode, driver: { displayName: 'Coded', fullName: 'C C', nationalId: '88001133', mobile: phone, licenceClasses: ['motorcycle'] } } }),
      ).toThrow(/A fleet adds its own drivers/);

      const phone2 = '+254781999004';
      otp.verify(phone2, otp.request(phone2).code);
      const sneaky = accounts().signup({ role: 'driver', email: 'sneaky@sbg.test', password: 'mkate-na-chai-1', phone: phone2, profile: { driver: { displayName: 'Sneaky', fullName: 'S S', nationalId: '88001144', mobile: phone2, licenceClasses: ['motorcycle'], managerDid: kilima.did }, vehicle: { plate: 'KMSNK 1', vehicleClass: 'motorcycle', managerDid: kilima.did } } });
      expect(drivers.get(sneaky.did).managerDid).toBeUndefined();
      expect(vehicles.list({ managerDid: kilima.did })).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------------- the fleet takes one off -- */

  describe('a fleet takes a driver off', () => {
    it('with a reason the driver is shown; they keep what is theirs and are between fleets, not their own boss', async () => {
      const kilima = aFleet('Kilima Logistics');
      const d = aDriver(kilima.did);
      const { freight } = aDeliveredHaul(d.driver.did, d.truck.vehicleId, kilima.did);
      const left = moves.remove(kilima.did, d.driver.did, { reason: 'left' });
      expect(left.managerDid).toBeUndefined();
      expect(left.removedFrom).toMatchObject({ fleetDid: kilima.did, companyName: 'Kilima Logistics', reason: 'left' });
      expect(drivers.isIndependent(left)).toBe(false);
      expect(drivers.canOperate(d.driver.did)).toBe(false);
      expect(drivers.offRoadReasons(d.driver.did)[0]).toMatch(/not in a fleet — Kilima Logistics took you off/);
      // The fleet keeps what it did.
      expect(dispatch.fleetJobsPage(kilima.did, (x) => x, {} as never).items.map((r) => r.freightId)).toEqual([freight.freightId]);
      // No public page: between fleets is not an owner-driver.
      expect(ownerDrivers(drivers.list()).map((x) => x.did)).not.toContain(d.driver.did);

      await settle();
      const [told] = notifications.inboxFor(d.driver.did);
      expect(told).toMatchObject({ kind: 'roster_changed', title: 'Kilima Logistics took you off their fleet' });
      expect(told.body).toContain('They say you no longer work for them.');
      expect(notifications.inboxFor(kilima.did)[0].title).toBe(`${d.driver.displayName} is off your fleet`);
    });

    it('cannot start a shift on the fleet’s truck — or anyone’s — until a fleet takes them on; then on that fleet’s', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      moves.remove(kilima.did, d.driver.did, { reason: 'ended' });
      expect(() => fleet.couple(d.driver.did, d.truck.vehicleId)).toThrow(/not in a fleet — Kilima Logistics took you off/);
      expect(() => fleet.couple(d.driver.did, aTruck().vehicleId)).toThrow(/not in a fleet/);

      joins(pwani.did, d);
      expect(drivers.get(d.driver.did).removedFrom).toBeUndefined();
      expect(() => fleet.couple(d.driver.did, d.truck.vehicleId)).toThrow(/not one of your fleet's vehicles/);
      expect(fleet.couple(d.driver.did, aTruck(pwani.did).vehicleId).status).toBe('active');
    });

    it('ends a shift with nothing aboard; refuses while a load is in their hands or they are on one of the fleet’s runs', () => {
      const kilima = aFleet('Kilima Logistics');
      const onShift = aDriver(kilima.did);
      fleet.couple(onShift.driver.did, onShift.truck.vehicleId);
      moves.remove(kilima.did, onShift.driver.did, { reason: 'left' });
      expect(fleet.activeForDriver(onShift.driver.did)).toBeUndefined();

      const loaded = aDriver(kilima.did);
      const at = { lat: -1.2, lng: 36.8 };
      const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', destLocation: at, weightKg: 200, packaging: 'palletised' });
      fleet.couple(loaded.driver.did, loaded.truck.vehicleId);
      dispatch.assign(f.freightId, loaded.driver.did, { managerDid: kilima.did });
      expect(() => moves.remove(kilima.did, loaded.driver.did, { reason: 'left' })).toThrow(new RegExp(`${loaded.driver.displayName} is carrying ${f.code} — it has to be delivered or handed back`));
      expect(drivers.get(loaded.driver.did).managerDid).toBe(kilima.did);

      const rostered = aDriver(kilima.did);
      const line = corridors.publish(corridors.proposeLine({ managerDid: kilima.did, company: 'Kilima Logistics', name: 'Nairobi – Nakuru RM', originZone: 'Nairobi RM', destZone: 'Nakuru RM', vehicleType: 'truck' }).corridorId, 'did:glos:staff');
      const run = departures.declare({ managerDid: kilima.did, corridorId: line.corridorId, vehicleId: rostered.truck.vehicleId, leavesAt: new Date(Date.now() + DAY).toISOString(), capacityKg: 6000, capacityM3: 40, basis: 'per_trip', amount: 450 });
      departures.assignDriver(run.departureId, kilima.did, { did: rostered.driver.did, name: rostered.driver.displayName });
      expect(() => moves.remove(kilima.did, rostered.driver.did, { reason: 'left' })).toThrow(/is on the Nairobi – Nakuru RM run — put somebody else on it first/);
    });

    it('only its own drivers, and "other" needs the fleet’s own words', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      expect(() => moves.remove(pwani.did, d.driver.did, { reason: 'left' })).toThrow(/not in your fleet/);
      expect(() => moves.remove(kilima.did, d.driver.did, { reason: 'other' })).toThrow(/in your own words/);
      expect(drivers.get(d.driver.did).managerDid).toBe(kilima.did);
      moves.remove(kilima.did, d.driver.did, { reason: 'other', note: 'Never came back after leave' });
      expect(drivers.get(d.driver.did).removedFrom?.note).toBe('Never came back after leave');
    });

    it('ends their sessions, and the person link names no fleet', () => {
      const kilima = aFleet('Kilima Logistics');
      const d = aDriver(kilima.did);
      const person = persons.findByPhone(d.phone)!;
      const old = auth.mintActorToken({ role: 'driver', did: d.driver.did, tenant: kilima.did, revocationKey: person.personDid, personDid: person.personDid });
      moves.remove(kilima.did, d.driver.did, { reason: 'left' });
      expect(auth.introspect(old.access_token)).toMatchObject({ active: false, reason: 'revoked' });
      expect(persons.findByDid(person.personDid)!.roles.find((r) => r.role === 'driver')!.tenant).toBeUndefined();
    });
  });

  /* ------------------------------------------------------ whose vehicle it is -- */

  describe('a vehicle is driven by the drivers it belongs to', () => {
    it('a fleet’s truck only by that fleet’s drivers — not a driver of another fleet, not a courier on their own', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const theirs = aDriver(pwani.did);
      const courier = aDriver();
      const kilimaTruck = aTruck(kilima.did);
      expect(() => fleet.couple(theirs.driver.did, kilimaTruck.vehicleId)).toThrow(/not one of your fleet's vehicles/);
      expect(() => fleet.couple(courier.driver.did, kilimaTruck.vehicleId)).toThrow(/not one of your fleet's vehicles/);
      expect(fleet.couple(aDriver(kilima.did).driver.did, kilimaTruck.vehicleId).status).toBe('active');
    });

    it('a courier’s own van only by that courier — and that is never something the public sees', () => {
      const owner = aDriver();
      const other = aDriver();
      const van = aTruck(undefined, owner.driver.did);
      expect(() => fleet.couple(other.driver.did, van.vehicleId)).toThrow(/another courier's own vehicle/);
      expect(fleet.couple(owner.driver.did, van.vehicleId).status).toBe('active');
      expect(vehicles.viewFor(van.vehicleId, undefined, false)).not.toHaveProperty('ownerDriverDid');
    });
  });

  /* ------------------------------------------------------------------ who is told -- */

  describe('who is told', () => {
    it('tells the fleet they joined who it is, and the fleet they left what it keeps — never where they went', async () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const d = aDriver(kilima.did);
      joins(pwani.did, d);
      await settle();

      const [joined] = notifications.inboxFor(pwani.did);
      expect(joined).toMatchObject({ kind: 'roster_changed', title: `${d.driver.displayName} joined your fleet` });
      expect(joined.body).toContain('said yes to your offer');
      const [left] = notifications.inboxFor(kilima.did);
      expect(left.title).toBe(`${d.driver.displayName} left your fleet`);
      expect(left.body).toContain('stays in your records');
      expect(left.body).not.toContain('Pwani');
      // The driver was told of the offer — and of nothing else; they did the rest themselves.
      expect(notifications.inboxFor(d.driver.did).map((n) => n.kind)).toEqual(['fleet_offer']);
    });

    it('five wrong PINs tell the person — in their own inbox and their driver’s, never the fleet’s', async () => {
      const kilima = aFleet('Kilima Logistics');
      const d = aDriver(kilima.did);
      const person = persons.findByPhone(d.phone)!;
      persons.setPin(person.personDid, '13570');
      // The phone the PIN is typed on was confirmed by a code — and THAT is news: their PIN works somewhere it never had.
      const theirPhone = persons.trustDevice(d.phone);
      await settle();
      expect(notifications.inboxFor(d.driver.did)).toHaveLength(1);
      expect(notifications.inboxFor(d.driver.did)[0]).toMatchObject({ kind: 'security', title: 'A new phone or browser can use your PIN' });
      expect(notifications.inboxFor(d.driver.did)[0].body).toContain('forgot your PIN');
      expect(notifications.inboxFor(person.personDid)[0]).toMatchObject({ kind: 'security', title: 'A new phone or browser can use your PIN' });
      expect(notifications.inboxFor(kilima.did)).toHaveLength(0);
      for (let i = 0; i < 4; i++) expect(() => persons.loginWithPin(d.phone, '00000', theirPhone)).toThrow(/Wrong phone or PIN/);
      await settle();
      expect(notifications.inboxFor(d.driver.did)).toHaveLength(1); // four wrong is a typo, not news
      expect(() => persons.loginWithPin(d.phone, '00000', theirPhone)).toThrow(/Too many wrong PINs/);
      await settle();
      expect(notifications.inboxFor(d.driver.did)[0]).toMatchObject({ kind: 'security', title: 'Your PIN was locked' });
      expect(notifications.inboxFor(d.driver.did)[0].body).toContain('verify your phone by code');
      expect(notifications.inboxFor(person.personDid)[0]).toMatchObject({ kind: 'security' });
      expect(notifications.inboxFor(kilima.did)).toHaveLength(0);
    });
  });

  /**
   * B2 — A LOAD A CUSTOMER'S BUSINESS POSTED IS SETTLED BETWEEN THE PARTIES.
   *
   * The user, 2026-10-04: "we don't handle their payments at all." The network's older rule owes a carrier we contract
   * with their earning on delivery whoever the shipper was; for a business's load that would be a second debt for the
   * same work, owed by a company that never held the money.
   */
  describe('a business’s own load', () => {
    it('owes the carrier nothing on our books, and their register says the shipper pays them', () => {
      const kilima = aFleet('Kilima Freight');
      const d = aDriver(kilima.did);
      const business = entities.createBusiness({ name: `Abebe Import ${++seq}`, jurisdiction: 'KE', profile: { activities: ['shipper'], registrationNo: `R-${seq}`, createdBy: 'Abebe', createdByPersonDid: 'did:glos:abebe' } });
      const at = { lat: -1.2, lng: 36.8 };
      const before = owedTo(kilima.did);
      const f = dispatch.registerFreight({ description: 'Coffee, 40 bags', pickupLocation: at, pickupLabel: 'Warehouse', destLabel: 'Port', destLocation: at, weightKg: 200, packaging: 'palletised', postedByDid: business.did, postedByName: 'Abebe Kebede' });
      expect(f.settlement).toBe('between_parties');
      expect(f.postedByName).toBe('Abebe Kebede');
      fleet.couple(d.driver.did, d.truck.vehicleId);
      dispatch.assign(f.freightId, d.driver.did, { managerDid: kilima.did });
      dispatch.pickupFreight(f.freightId, d.driver.did, { confirmed: requiredLoadKeys(f), securementPhotoId: 'med_test' });
      dispatch.deliverFreight(f.freightId, d.driver.did, { confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: 'med_pod' });
      fleet.uncouple(d.driver.did);

      const done = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
      expect(done.lockedPrice).toBeGreaterThan(0);
      expect(owedTo(kilima.did)).toBe(before);
      const row = driverJobRowOf(done);
      expect(row).toMatchObject({ paid: false, direct: true });
      const summary = driverJobsSummaryOf([done]);
      expect(summary).toMatchObject({ unpaid: 0, direct: done.lockedPrice });
    });

    it('still owes the carrier for a load somebody else posted — the older rule is untouched', () => {
      const kilima = aFleet('Kilima Older');
      const d = aDriver(kilima.did);
      const before = owedTo(kilima.did);
      const { freight } = aDeliveredHaul(d.driver.did, d.truck.vehicleId, kilima.did);
      expect(freight.settlement).toBeUndefined();
      expect(owedTo(kilima.did)).toBeGreaterThan(before);
    });
  });
});
