import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { GazetteerGeocoder, GEOCODER } from './geocoder';
import { HeuristicRouter, ROUTER } from './router';
import { WalletGateService } from './wallet-gate.service';
import { CorridorService } from './corridor.service';
import { ParcelService, labelDate } from './parcel.service';
import { MAX_WORK_RADIUS_KM, OTP_MAX_ATTEMPTS, TRADE_CREDIT_LIMIT, TRADE_CREDIT_PARCELS, WHOLESALE } from './pudo.config';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { CargoService } from './cargo.service';
import { SbgController } from './pudo.controller';
import { IdentityController } from './identity.controller';
import { MediaService } from './media.service';
import { MonitorService } from './monitor.service';
import { RatingService, MIN_PUBLIC_RATINGS } from './rating.service';
import { GraduationService } from './graduation.service';
import { VendorService } from './vendor.service';
import { VendorCallbackService } from './vendor-callback.service';
import { ShelfService } from './shelf.service';
import { RoutingService } from './routing.service';
import { MdpService } from './mdp.service';
import { ToteService } from './tote.service';
import { ConsignmentService } from './consignment.service';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { DispatchService } from './dispatch.service';
import { MarketPulseStore } from './market-pulse.store';
import { MarketPulseService } from './market-pulse.service';
import { shipperCharge } from './pricing';
import { requiredLoadKeys, requiredUnloadKeys } from './heavy-cargo';
import { FleetManagerService } from './fleet-manager.service';
import { AccountService } from './account.service';
import { OtpService } from './otp.service';
import { PersonService } from './person.service';
import { InviteService } from './invite.service';
import { hashPhone } from '../../foundation/identity/phone';
import { SCOPES_KEY } from '../../foundation/auth/scopes.decorator';
import { createHmac } from 'crypto';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { AuthService } from '../../foundation/auth/auth.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { BooksService } from '../../foundation/books/books.service';
import { BagPlanService } from './bag-plan.service';
import { ForthcomingService } from './forthcoming.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';

describe('PUDO Light', () => {
  let agents: AgentService;
  let gate: WalletGateService;
  let corridors: CorridorService;
  let parcels: ParcelService;
  let media: MediaService;
  let monitor: MonitorService;
  let rating: RatingService;
  let shelfSvc: ShelfService;
  let routing: RoutingService;
  let mdps: MdpService;
  let totes: ToteService;
  let consignments: ConsignmentService;
  let vehicles: VehicleService;
  let drivers: DriverService;
  let fleet: FleetService;
  let dispatch: DispatchService;
  let marketPulse: MarketPulseService;
  let marketStore: MarketPulseStore;
  let controller: SbgController;
  let identity: IdentityController;
  let managers: FleetManagerService;
  let accounts: AccountService;
  let otp: OtpService;
  let persons: PersonService;
  let invites: InviteService;
  let auth: AuthService;
  let graduation: GraduationService;
  let vendors: VendorService;
  let vendorCallback: VendorCallbackService;
  let twin: DigitalTwinService;
  let tracking: TrackingService;
  let context: TrackingContextService;
  let dids: DidService;
  let entities: EntityService;
  let books: BooksService;
  let bagPlans: BagPlanService;
  let vault: IdentityVault;
  let core: OperationalStore;
  let events: EventBus;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, BagPlanService, ForthcomingService, ToteService, ConsignmentService, VehicleService, DriverService, FleetService, DispatchService, MarketPulseStore, MarketPulseService, FleetManagerService, AccountService, OtpService, PersonService, InviteService, MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, AuthService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus, EntityService, BooksService,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
      controllers: [SbgController, IdentityController],
    }).compile();
    // compile() does not run lifecycle hooks, so the group + its sisters are seeded by hand — the same
    // registry the app seeds at boot, and everything that names an entity needs it present.
    entities = moduleRef.get(EntityService);
    entities.seed();
    books = moduleRef.get(BooksService);
    bagPlans = moduleRef.get(BagPlanService);
    books.reset(); // each test starts on clean books — the money is derived from them now
    agents = moduleRef.get(AgentService);
    gate = moduleRef.get(WalletGateService);
    corridors = moduleRef.get(CorridorService);
    parcels = moduleRef.get(ParcelService);
    media = moduleRef.get(MediaService);
    monitor = moduleRef.get(MonitorService);
    rating = moduleRef.get(RatingService);
    shelfSvc = moduleRef.get(ShelfService);
    routing = moduleRef.get(RoutingService);
    mdps = moduleRef.get(MdpService);
    totes = moduleRef.get(ToteService);
    consignments = moduleRef.get(ConsignmentService);
    vehicles = moduleRef.get(VehicleService);
    drivers = moduleRef.get(DriverService);
    fleet = moduleRef.get(FleetService);
    dispatch = moduleRef.get(DispatchService);
    marketPulse = moduleRef.get(MarketPulseService);
    marketStore = moduleRef.get(MarketPulseStore);
    controller = moduleRef.get(SbgController);
    identity = moduleRef.get(IdentityController);
    managers = moduleRef.get(FleetManagerService);
    accounts = moduleRef.get(AccountService);
    otp = moduleRef.get(OtpService);
    persons = moduleRef.get(PersonService);
    invites = moduleRef.get(InviteService);
    auth = moduleRef.get(AuthService);
    graduation = moduleRef.get(GraduationService);
    vendors = moduleRef.get(VendorService);
    vendorCallback = moduleRef.get(VendorCallbackService);
    twin = moduleRef.get(DigitalTwinService);
    tracking = moduleRef.get(TrackingService);
    context = moduleRef.get(TrackingContextService);
    dids = moduleRef.get(DidService);
    vault = moduleRef.get(IdentityVault);
    core = moduleRef.get(OperationalStore);
    events = moduleRef.get(EventBus);
  });

  let agentSeq = 0;
  const eligibleReqs = () => ({ androidVersion: 13, reliablePower: true, tradingLicence: 'TL-100', criminalRecordClear: true });
  const uniformHours = (open = '08:00', close = '18:00') => ({ mon: { open, close }, tue: { open, close }, wed: { open, close }, thu: { open, close }, fri: { open, close }, sat: { open, close }, sun: null });
  const defaultShelf = { rows: 3, cols: 3 }; // 9 slots
  const kycDocs = { idCopyRef: 'id.jpg', tradingLicenceRef: 'licence.pdf', shopPhotoRefs: ['shop-1.jpg'] };

  /** The release code the SENDER/RECEIVER hold. Minted with the parcel now, never handed out at arrival. */
  const releaseCodeOf = (parcelId: string) => parcels.get(parcelId).otp!;

  function onboardAgent(shopName: string, zone: string, topUp = 0) {
    agentSeq += 1;
    const a = agents.register({ shopName, zone, location: { lat: -1.2, lng: 36.8 }, landmark: 'next to the market', openingHours: uniformHours(), shelf: defaultShelf, fullName: `${shopName} owner`, nationalId: `ID-${agentSeq}`, mobile: `+25470${agentSeq}`, deviceImei: `IMEI-${agentSeq}`, requirements: eligibleReqs() });
    agents.submitKyc(a.did, kycDocs);
    agents.decideKyc(a.did, true);
    if (topUp > 0) gate.topUp(a.did, topUp);
    return agents.get(a.did);
  }

  it('onboards an agent through the 5-state machine, activating on first top-up', () => {
    const a = agents.register({ shopName: "Mama Sarah's", zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'blue gate', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'Sarah K', nationalId: 'ID-999', mobile: '+254700111', deviceImei: 'IMEI-X', requirements: eligibleReqs() });
    expect(a.status).toBe('DRAFT');
    expect(agents.submitKyc(a.did, kycDocs).status).toBe('KYC_PENDING');
    expect(agents.decideKyc(a.did, true).status).toBe('APPROVED_UNFUNDED'); // wallet provisioned, scan disabled
    expect(agents.canScan(a.did)).toBe(false);
    gate.topUp(a.did, 50);
    expect(agents.get(a.did).status).toBe('ACTIVE');
    expect(agents.canScan(a.did)).toBe(true);
    expect(events.getLog().some((e) => e.type === GlosEvent.Pudo.AgentActivated)).toBe(true);
  });

  it('rejects applicants that fail the eligibility filter (Ch 18.1)', () => {
    const base = { shopName: 'S', zone: 'NorthTown', location: { lat: -1, lng: 36 }, landmark: 'x', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'A', nationalId: 'ID-E', mobile: '+254E', deviceImei: 'IMEI-E', requirements: eligibleReqs() };
    expect(() => agents.register({ ...base, shelf: { rows: 1, cols: 1 } })).toThrow(/slots/);
    expect(() => agents.register({ ...base, openingHours: uniformHours('08:00', '12:00') })).toThrow(/hours/); // 4h/day < 10
    expect(() => agents.register({ ...base, requirements: { ...eligibleReqs(), androidVersion: 8 } })).toThrow(/Android/);
    expect(() => agents.register({ ...base, requirements: { ...eligibleReqs(), tradingLicence: '' } })).toThrow(/licence/);
    expect(() => agents.register({ ...base, requirements: { ...eligibleReqs(), criminalRecordClear: false } })).toThrow(/criminal/);
    expect(agents.register(base).status).toBe('DRAFT'); // eligible → accepted
  });

  it('rejects duplicate national ID / mobile / device (Ch 18.5 dedup)', () => {
    const a = { shopName: 'Dup', zone: 'NorthTown', location: { lat: -1, lng: 36 }, landmark: 'x', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'A', nationalId: 'ID-DUP', mobile: '+254DUP', deviceImei: 'IMEI-DUP', requirements: eligibleReqs() };
    agents.register(a);
    expect(() => agents.register({ ...a, mobile: '+254X', deviceImei: 'IMEI-X' })).toThrow(/national ID/);
    expect(() => agents.register({ ...a, nationalId: 'ID-X', deviceImei: 'IMEI-X' })).toThrow(/mobile/);
    expect(() => agents.register({ ...a, nationalId: 'ID-X', mobile: '+254X' })).toThrow(/device/);
  });

  it('bundles small parcels into a consolidation slot, keeps larger ones on their own (shelf)', () => {
    const a = onboardAgent('Bundler', 'BundleTown', 50);
    agents.setShelf(a.did, { rows: 3, cols: 2, consolidationSlots: ['Red-1'] }); // 6 slots; Red-1 is a bundle slot

    // Two small parcels pool into the one bundle slot — it does not burn two slots.
    expect(shelfSvc.assign(a.did, 'p-s1', 'S')).toBe('Red-1');
    expect(shelfSvc.assign(a.did, 'p-s2', 'S')).toBe('Red-1');
    // A large parcel skips the bundle slot and takes a normal one.
    const big = shelfSvc.assign(a.did, 'p-l1', 'L');
    expect(big).not.toBe('Red-1');

    const grid = shelfSvc.grid(a.did);
    const bundle = grid.find((s) => s.label === 'Red-1')!;
    expect(bundle.consolidation).toBe(true);
    expect(bundle.items).toEqual(['p-s1', 'p-s2']);
    expect(grid.find((s) => s.label === big)!.occupiedBy).toBe('p-l1');

    // Release frees just that one parcel from the bundle; the other stays put.
    shelfSvc.release(a.did, 'p-s1');
    expect(shelfSvc.grid(a.did).find((s) => s.label === 'Red-1')!.items).toEqual(['p-s2']);
  });

  describe('My-shop editors: the pin and the shop-front photo', () => {
    // A minimal valid 1×1 PNG (real magic bytes, so it passes the MediaService signature check).
    const PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const shopPhotoFor = (ownerDid: string) => media.upload({ ownerDid, kind: 'avatar', dataUrl: PNG }).mediaId;

    it('moves the shop pin', () => {
      const a = onboardAgent('Pin Shop', 'PinTown', 50);
      agents.setLocation(a.did, { lat: -1.29, lng: 36.82 });
      expect(agents.get(a.did).location).toEqual({ lat: -1.29, lng: 36.82 });
    });

    it('links an OWNED shop photo and purges the previous one on replace', () => {
      const a = onboardAgent('Photo Shop', 'PhotoTown', 50);
      const first = shopPhotoFor(a.did);
      agents.setShopfront(a.did, first);
      expect(agents.get(a.did).shopfrontMediaId).toBe(first);
      expect(media.get(first)!.link).toEqual({ type: 'agent', id: a.did });

      const second = shopPhotoFor(a.did);
      agents.setShopfront(a.did, second);
      expect(agents.get(a.did).shopfrontMediaId).toBe(second);
      expect(media.get(first)).toBeUndefined(); // one shop photo — the old bytes + ref are gone

      agents.setShopfront(a.did, ''); // clearing drops the bytes too
      expect(agents.get(a.did).shopfrontMediaId).toBeUndefined();
      expect(media.get(second)).toBeUndefined();
    });

    it('refuses a photo the shop does not own, or one not uploaded AS a shop photo', () => {
      const a = onboardAgent('Guard Shop', 'GuardTown', 50);
      const notMine = shopPhotoFor(dids.generate('pudo-agent:stranger').id);
      expect(() => agents.setShopfront(a.did, notMine)).toThrow(/not yours/);

      // A dropoff/PoD photo the shop owns sits in a LOCKED evidence bin: re-kinding it as the shop front
      // would strip it out of that bin AND a later replace would hard-delete it mid-case (S29). Refuse.
      const podId = media.upload({ ownerDid: a.did, kind: 'pod', dataUrl: PNG }).mediaId;
      expect(() => agents.setShopfront(a.did, podId)).toThrow(/shop photo/i);
      expect(media.get(podId)!.kind).toBe('pod'); // untouched: not re-kinded
      expect(media.get(podId)!.link).toBeUndefined(); // untouched: not re-linked to the shop
      expect(agents.get(a.did).shopfrontMediaId).toBeUndefined();
    });
  });

  it('requires KYC documents to move to KYC_PENDING (Ch 18.5)', () => {
    const a = agents.register({ shopName: 'K', zone: 'NorthTown', location: { lat: -1, lng: 36 }, landmark: 'x', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'A', nationalId: 'ID-KYC', mobile: '+254KYC', deviceImei: 'IMEI-KYC', requirements: eligibleReqs() });
    expect(() => agents.submitKyc(a.did, { idCopyRef: '', tradingLicenceRef: 'l', shopPhotoRefs: [] })).toThrow(/KYC/);
    expect(agents.submitKyc(a.did, kycDocs).status).toBe('KYC_PENDING');
  });

  it('records the refundable equipment deposit (Ch 18.3)', () => {
    const a = onboardAgent('Deposit Shop', 'NorthTown', 10);
    expect(agents.get(a.did).equipmentDepositPaid).toBe(false);
    agents.recordDeposit(a.did);
    expect(agents.get(a.did).equipmentDepositPaid).toBe(true);
  });

  it('accepts an address and/or a map pin; geocodes a pin from the address (Ch 18.6)', () => {
    const byAddr = agents.register({ shopName: 'Addr Shop', zone: 'NorthTown', physicalAddress: '12 Market Road, Kibera', landmark: 'x', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'A', nationalId: 'ID-ADDR', mobile: '+254ADDR', deviceImei: 'IMEI-ADDR', requirements: eligibleReqs() });
    expect(typeof byAddr.location.lat).toBe('number');
    expect(byAddr.physicalAddress).toContain('Market');
    expect(() => agents.register({ shopName: 'No Loc', zone: 'NorthTown', landmark: 'x', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'A', nationalId: 'ID-NL', mobile: '+254NL', deviceImei: 'IMEI-NL', requirements: eligibleReqs() })).toThrow(/pin|address/);
  });

  it('shows open / temporarily-closed PUDOs on the coverage heatmap (feeds leg planning)', () => {
    const open = onboardAgent('Open Shop', 'NorthTown', 50);
    const closed = onboardAgent('Closed Shop', 'SouthTown', 50);
    agents.setAvailability(closed.did, false);
    const hm = monitor.heatmap();
    expect(hm.counts.registered).toBeGreaterThanOrEqual(2);
    expect(hm.counts.open).toBeGreaterThanOrEqual(1);
    expect(hm.counts.closed).toBeGreaterThanOrEqual(1);
    expect(hm.points.find((p) => p.shopName === 'Closed Shop')?.state).toBe('closed');
    expect(hm.points.find((p) => p.shopName === 'Open Shop')?.state).toBe('open');
    expect(hm.cells.length).toBeGreaterThan(0);
    expect(agents.get(open.did).openState).toBe('open');
  });

  it('assigns parcels to colour/number shelf slots and tracks availability (replaces the m² cap)', () => {
    const origin = onboardAgent('Grid Origin', 'NorthTown', 50);
    const dest = onboardAgent('Grid Dest', 'SouthTown', 50);
    expect(shelfSvc.capacity(dest.did)).toBe(9); // 3 × 3
    expect(shelfSvc.available(dest.did)).toBe(9);
    const corridor = corridors.addCorridor({ name: 'g', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:dgrid', name: 'D', corridorId: corridor.corridorId });
    parcels.accept({ agentDid: origin.did, parcelId: 'QR-S1', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-S1'] });
    const arr = parcels.arrive('QR-S1', dest.did);
    expect(arr.binSlot).toMatch(/^(Red|Orange|Amber|Green|Teal|Blue|Indigo|Violet|Pink|Brown)-[1-3]$/); // colour-column + row-number
    expect(shelfSvc.available(dest.did)).toBe(8); // slot committed for pickup
    parcels.pickup('QR-S1', dest.did, releaseCodeOf('QR-S1'));
    expect(shelfSvc.available(dest.did)).toBe(9); // freed on pickup
  });

  it('assigns a first-mile node (nearest open PUDO with free capacity) and computes the leg + ETA', () => {
    const origin = onboardAgent('Route Origin', 'NorthTown', 50);
    const dest = onboardAgent('Route Dest', 'SouthTown', 50);
    corridors.addCorridor({ name: 'r', originZone: 'NorthTown', destZone: 'SouthTown' });

    const pick = routing.assignFirstMileNode({ location: { lat: -1.2, lng: 36.8 }, zone: 'NorthTown' });
    expect(pick.agentDid).toBe(origin.did); // the open NorthTown node

    const plan = routing.planJourney({ originAgentDid: origin.did, destAgentDid: dest.did, weightKg: 5 });
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0].fromNode).toBe(origin.did);
    expect(plan.legs[0].toNode).toBe(dest.did);
    expect(plan.originNode.committed).toBe(true);
    // The pickup-ready time never precedes arrival, and is corrected to opening hours.
    expect(new Date(plan.pickupReadyAt).getTime()).toBeGreaterThanOrEqual(new Date(plan.transitArrivalAt).getTime());
  });

  it('keeps the Golden Record in the vault, never in the operational core (data firewall)', () => {
    const a = onboardAgent('Vault Shop', 'NorthTown', 10);
    const profile = core.get(a.did)!;
    expect(profile.tier).toBe(2);
    expect(profile.capabilities).toContain('pudo-agent');
    expect(JSON.stringify(profile)).not.toContain('Vault Shop owner'); // no PII in the core
    expect(vault.reveal(profile.vaultRef!, { purpose: 'test', requesterDid: 'did:test' }).fullName).toBe('Vault Shop owner');
  });

  it('runs the steel thread: accept → handover → arrive → pickup, all anchored', () => {
    const origin = onboardAgent('North PUDO', 'NorthTown', 50);
    const dest = onboardAgent('South PUDO', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'N-S Express', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:driver1', name: 'John', corridorId: corridor.corridorId });

    const p = parcels.accept({ agentDid: origin.did, parcelId: 'QR-0001', size: 'M', destZone: 'SouthTown', senderMobile: '+254700', receiverMobile: '+254711', dropoffPhotoRef: 'photo-1.jpg' });
    expect(p.status).toBe('At_PUDO');

    const h = parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-0001'] });
    expect(h.handed).toEqual(['QR-0001']);
    expect(parcels.get('QR-0001').status).toBe('On_Bus');

    const code = releaseCodeOf('QR-0001'); // minted at accept, held by the sender + receiver
    expect(code).toMatch(/^\d{4}$/);
    const arrival = parcels.arrive('QR-0001', dest.did);
    expect(arrival).not.toHaveProperty('otp'); // the shop that hands it over is never told the secret
    const delivered = parcels.pickup('QR-0001', dest.did, code, 'delivered.jpg');
    expect(delivered.status).toBe('Delivered');
    expect(delivered.scans.every((s) => s.anchorTxId)).toBe(true);
    expect(events.getLog().some((e) => e.type === GlosEvent.Pudo.ParcelDelivered)).toBe(true);
  });

  it('rejects a wrong OTP at pickup', () => {
    const origin = onboardAgent('A', 'NorthTown', 50);
    const corridor = corridors.addCorridor({ name: 'N-S', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:d', name: 'D', corridorId: corridor.corridorId });
    parcels.accept({ agentDid: origin.did, parcelId: 'QR-OTP', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-OTP'] });
    parcels.arrive('QR-OTP', origin.did);
    expect(() => parcels.pickup('QR-OTP', origin.did, '0000')).toThrow();
  });

  it('burns the pickup OTP after repeated wrong codes (S0)', () => {
    // The OTP is read aloud by the agent, never SMS'd — so it is the ONLY check between a
    // stranger and someone else's parcel, and must not be brute-forceable.
    const origin = onboardAgent('A', 'NorthTown', 50);
    const corridor = corridors.addCorridor({ name: 'N-S', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:d', name: 'D', corridorId: corridor.corridorId });
    parcels.accept({ agentDid: origin.did, parcelId: 'QR-LOCK', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-LOCK'] });
    parcels.arrive('QR-LOCK', origin.did);
    const otp = releaseCodeOf('QR-LOCK');
    const wrong = otp === '0000' ? '1111' : '0000';

    for (let i = 0; i < 4; i++) expect(() => parcels.pickup('QR-LOCK', origin.did, wrong)).toThrow('Incorrect OTP');
    expect(() => parcels.pickup('QR-LOCK', origin.did, wrong)).toThrow('Too many wrong codes');
    // Locked: even the correct code is refused until an operator reissues.
    expect(() => parcels.pickup('QR-LOCK', origin.did, otp)).toThrow('Too many wrong codes');
    expect(parcels.get('QR-LOCK').status).toBe('Ready_For_Pickup');
  });

  it("enforces 'no money, no scan' at the END of the credit line, not at an empty float (lite NFR-SSE-01)", () => {
    const a = onboardAgent('Broke Shop', 'NorthTown', 3.2); // exactly two cash parcels of its own money
    const scan = (id: string) => parcels.accept({ agentDid: a.did, parcelId: id, size: 'S', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'a.jpg' });

    scan('QR-A');
    scan('QR-B');
    // Float is empty — but a customer standing at the counter with cash is not turned away. The shop
    // keeps scanning on trade credit, and its balance goes honestly negative.
    expect(agents.balance(a.did)).toBe(0);
    expect(agents.get(a.did).status).toBe('ACTIVE');
    scan('QR-C');
    expect(agents.balance(a.did)).toBeCloseTo(-WHOLESALE, 2);
    expect(agents.creditOwed(a.did)).toBeCloseTo(WHOLESALE, 2);

    // Spend the rest of the line — twenty parcels' worth in total — and the shutter comes down.
    for (let i = 1; i < TRADE_CREDIT_PARCELS; i++) scan(`QR-C${i}`);
    const gateState = gate.canTransact(a.did);
    expect(gateState.credit.available).toBe(0);
    expect(gateState.ok).toBe(false); // legacy alias
    expect(gateState.canTransact).toBe(false);
    expect(gateState.code).toBe('WALLET_INSUFFICIENT'); // a low-literacy UI maps this to the top-up icon
    expect(gateState.shortfall).toBeGreaterThan(0);
    expect(() => scan('QR-D')).toThrow();

    // A top-up clears the debt FIRST, before it rebuilds any spendable float.
    gate.topUp(a.did, TRADE_CREDIT_LIMIT + 10);
    expect(agents.creditOwed(a.did)).toBe(0);
    expect(agents.balance(a.did)).toBeCloseTo(10, 2);
    expect(books.balances(entities.requireForJurisdiction('KE').entityId)).toEqual({ balanced: true, drift: 0 });
  });

  it('voids a parcel within the window and refunds the agent', () => {
    const a = onboardAgent('Void Shop', 'NorthTown', 10);
    const before = agents.balance(a.did);
    parcels.accept({ agentDid: a.did, parcelId: 'QR-V', size: 'M', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'v.jpg' });
    expect(agents.balance(a.did)).toBeCloseTo(before - 1.6, 2);
    const voided = parcels.void('QR-V', a.did, 'torn-label.jpg');
    expect(voided.status).toBe('Voided');
    expect(agents.balance(a.did)).toBeCloseTo(before, 2); // refunded
    expect(gate.entries({ did: a.did }).some((e) => e.type === 'REFUND')).toBe(true);
  });

  it('chooses bus vs truck by weight and flags a blocked corridor (M3/M4 light)', () => {
    expect(corridors.chooseVehicle(100)).toBe('bus');
    expect(corridors.chooseVehicle(600)).toBe('truck');
    const c = corridors.addCorridor({ name: 'Blocked Rd', originZone: 'X', destZone: 'Y' });
    corridors.setStatus(c.corridorId, 'blocked');
    expect(monitor.flags().some((f) => f.type === 'Blocked_Corridor')).toBe(true);
  });

  it('graduates a delivered-parcel rating into the shared operational core (↔ M5)', () => {
    const origin = onboardAgent('Rated Shop', 'NorthTown', 50);
    const corridor = corridors.addCorridor({ name: 'N-S', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:d2', name: 'D', corridorId: corridor.corridorId });
    parcels.accept({ agentDid: origin.did, parcelId: 'QR-R', size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'r.jpg' });
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-R'] });
    const arr = parcels.arrive('QR-R', origin.did);
    parcels.pickup('QR-R', origin.did, releaseCodeOf('QR-R'));

    const r = rating.rate({ parcelId: 'QR-R', stars: 5, raterMobile: '+2' });
    expect(r.agentComposite).toBe(5);
    expect(core.get(origin.did)?.reputationScore).toBe(5); // written back to the GLOS operational core
    expect(rating.agentRating(origin.did).count).toBe(1);
  });

  it('REP1: agentRating exposes `average` + a cold-start "New" flag; ratings are one-per-parcel + PII-hashed', () => {
    const origin = onboardAgent('Rep Shop', 'NorthTown', 50);
    const corridor = corridors.addCorridor({ name: 'NS-rep', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:d-rep', name: 'D', corridorId: corridor.corridorId });
    const deliver = (parcelId: string) => {
      parcels.accept({ agentDid: origin.did, parcelId, size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'r.jpg' } as never);
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcelId] } as never);
      const arr = parcels.arrive(parcelId, origin.did);
      parcels.pickup(parcelId, origin.did, releaseCodeOf(parcelId));
    };

    // Rename fix: the aggregate is `average` (what the frontend reads) — the mis-named `stars` is gone.
    deliver('QR-R1');
    rating.rate({ parcelId: 'QR-R1', stars: 4, raterMobile: '+254700111' });
    let r = rating.agentRating(origin.did);
    expect(r.average).toBe(4);
    expect((r as { stars?: number }).stars).toBeUndefined();
    expect(r.count).toBe(1);
    expect(r.isNew).toBe(true); // 1 < MIN_PUBLIC_RATINGS

    // Idempotent: re-rating the SAME parcel replaces (last-wins) — the count never inflates.
    rating.rate({ parcelId: 'QR-R1', stars: 2, raterMobile: '+254700111' });
    r = rating.agentRating(origin.did);
    expect(r.count).toBe(1);
    expect(r.average).toBe(2);

    // PII at rest: the record hashes the rater — never the cleartext number.
    const rec = rating.list().find((x) => x.parcelId === 'QR-R1')!;
    expect(rec.raterHash).toBeTruthy();
    expect(rec.raterHash).not.toBe('+254700111');
    expect((rec as { raterMobile?: string }).raterMobile).toBeUndefined();

    // Cold-start clears once real volume arrives (≥ MIN distinct parcels rated).
    for (let i = 2; i <= MIN_PUBLIC_RATINGS; i++) {
      deliver(`QR-R${i}`);
      rating.rate({ parcelId: `QR-R${i}`, stars: 5, raterMobile: `+2547002${i}` });
    }
    expect(rating.agentRating(origin.did).count).toBe(MIN_PUBLIC_RATINGS);
    expect(rating.agentRating(origin.did).isNew).toBe(false);
  });

  it('REP1: the public reputation profile is PII-free (name/zone/pin/rating/since) and 404s a non-provider', () => {
    const origin = onboardAgent('Profile Shop', 'NorthTown', 50);
    const p = controller.reputationProfile(origin.did) as Record<string, unknown> & { rating: { count: number; isNew: boolean } };
    expect(p.kind).toBe('agent');
    expect(p.name).toBe(origin.shopName);
    expect(p.zone).toBe('NorthTown');
    expect(p.rating.count).toBe(0);
    expect(p.rating.isNew).toBe(true);
    expect(p.since).toBeTruthy();
    // No operational/PII leakage on the public surface.
    expect(p.balance).toBeUndefined();
    expect(p.vaultRef).toBeUndefined();
    expect(p.deviceImei).toBeUndefined();
    expect(() => controller.reputationProfile('did:glos:not-a-shop')).toThrow();
  });

  it('graduates a PUDO parcel onto the M4 timeline + M7 twin (one pane of glass)', async () => {
    const flush = () => new Promise((r) => setImmediate(r));
    twin.onModuleInit();
    graduation.onModuleInit();
    const origin = onboardAgent('North', 'NorthTown', 50);
    const dest = onboardAgent('South', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'N-S', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:dg', name: 'D', corridorId: corridor.corridorId });

    parcels.accept({ agentDid: origin.did, parcelId: 'QR-G', size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'g.jpg' });
    await flush();
    // M7 control tower (digital twin) now shows the PUDO parcel, located + tagged.
    expect(twin.shipment('QR-G')).toBeDefined();
    expect(twin.shipment('QR-G')?.location).toBeDefined();
    expect(twin.shipment('QR-G')?.props.source).toBe('pudo');

    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-G'] });
    await flush();
    const arr = parcels.arrive('QR-G', dest.did);
    await flush();
    parcels.pickup('QR-G', dest.did, releaseCodeOf('QR-G'));
    await flush();
    await flush();

    // M4 has a real anchored timeline; both editions on one spine.
    const tl = tracking.getTimeline('QR-G');
    expect(tl.events.some((e) => e.type === 'PICKUP')).toBe(true);
    expect(tl.currentState).toBe('DELIVERED');
    expect(twin.shipment('QR-G')?.state).toBe('delivered');
  });

  // --- DT: the digital twin is BORN at creation (shipment DID + twin + planned journey + label) ---

  const mintInbound = (tag: string) => {
    const origin = onboardAgent(`${tag} Origin`, 'NorthTown', 50);
    const dest = onboardAgent(`${tag} Dest`, 'NorthTown', 50);
    const vendor = vendors.register({ name: `${tag}Vendor` });
    vendors.topUp(vendor.vendorId, 50);
    const res = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700111', size: 'M', contentPhotoRef: 'c.jpg' } as never, { role: 'genesis', did: vendor.did } as never) as { parcel: any; paid: boolean };
    return { origin, dest, vendor, res };
  };

  it('DT: an inbound parcel is born with a shipment DID + a digital twin + its planned journey AT MINT', async () => {
    const flush = () => new Promise((r) => setImmediate(r));
    twin.onModuleInit();
    graduation.onModuleInit();
    const { res } = mintInbound('DT');
    expect(res.paid).toBe(true);
    // A real, resolvable GLOS identity for the shipment (the twin's id).
    expect(res.parcel.did).toMatch(/^did:glos:/);
    expect(dids.exists(res.parcel.did)).toBe(true);
    await flush();
    // The digital twin exists at 'created' with its planned route — BEFORE any physical intake.
    const t = twin.shipment(res.parcel.parcelId);
    expect(t).toBeDefined();
    expect(t?.state).toBe('created');
    expect(t?.props.source).toBe('pudo');
    expect(String(t?.props.route)).toContain('→'); // the hop chain
    // The m4 planned route + milestones are registered from creation.
    expect(context.has(res.parcel.parcelId)).toBe(true);
    const ctx = context.get(res.parcel.parcelId);
    expect(ctx?.milestones.some((m) => m.name === 'PICKUP')).toBe(true);
    expect(ctx?.milestones.some((m) => m.name === 'DELIVERY')).toBe(true);
    // …while the parcel is still 'Created' — the twin exists AHEAD of physical custody.
    expect(res.parcel.status).toBe('Created');
  });

  it('DT: intake advances the created twin to picked_up without clobbering its created-time journey', async () => {
    const flush = () => new Promise((r) => setImmediate(r));
    twin.onModuleInit();
    graduation.onModuleInit();
    const { origin, res } = mintInbound('DTI');
    await flush();
    // The created journey's first leg carries the SHOP NAME (planJourney), not the zone (the one-leg fallback).
    expect(context.get(res.parcel.parcelId)?.legs[0].origin).toBe('DTI Origin');
    parcels.intakeInbound(res.parcel.parcelId, origin.did);
    await flush();
    expect(twin.shipment(res.parcel.parcelId)?.state).toBe('picked_up');
    expect(context.get(res.parcel.parcelId)?.legs[0].origin).toBe('DTI Origin'); // NOT re-registered to the zone
  });

  it('DT: the public track surfaces the twin id + its planned route from creation', () => {
    const { res } = mintInbound('DTT');
    const tr = controller.track(res.parcel.trackingKey) as { did?: string; plannedRoute?: { hops: string[] } };
    expect(tr.did).toBe(res.parcel.did);
    expect(tr.plannedRoute?.hops.length).toBeGreaterThanOrEqual(2); // origin PUDO … dest PUDO
  });

  it('DT: the authenticated buyer view carries the twin id', () => {
    const { res } = mintInbound('DTB');
    const view = parcels.consumerParcel(res.parcel.parcelId, hashPhone('+254700111')!);
    expect(view.did).toBe(res.parcel.did);
  });

  it('DT: an outbound (walk-up) parcel gets a shipment DID + a printable label (tracking key, no collection code)', () => {
    const origin = onboardAgent('OB', 'NorthTown', 50);
    const p = parcels.accept({ agentDid: origin.did, parcelId: 'QR-OB', size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'g.jpg' });
    expect(p.did).toMatch(/^did:glos:/);
    expect(p.label).toBeDefined();
    expect(p.label!.svg).toContain(p.trackingKey!); // the public key is printed on the label
    expect(p.label!.svg).not.toContain('Collect at the shop'); // outbound → no collection-code line
    // The reprint endpoint returns the same label.
    expect(controller.parcelLabel('QR-OB').parcelId).toBe('QR-OB');
  });

  // --- PG0: the vendor WRITE surface is owner-gated (mint / settle / top-up / profile) ---

  it('PG0: minting is owner-scoped — another store (or no actor) cannot bill this store', () => {
    const origin = onboardAgent('PG0 O', 'NorthTown', 50);
    const dest = onboardAgent('PG0 D', 'NorthTown', 50);
    const mine = vendors.register({ name: 'Mine' });
    const other = vendors.register({ name: 'Other' });
    vendors.topUp(mine.vendorId, 100);
    const dto = { vendorId: mine.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700', size: 'M', contentPhotoRef: 'c.jpg' } as never;
    expect(() => controller.createInbound(dto, { role: 'genesis', did: other.did } as never)).toThrow(/not yours/);
    expect(() => controller.createInbound(dto, undefined as never)).toThrow(/not yours/);
    const own: any = controller.createInbound(dto, { role: 'genesis', did: mine.did } as never);
    expect(own.parcel).toBeDefined();
    const op: any = controller.createInbound(dto, { role: 'operator' } as never);
    expect(op.parcel).toBeDefined();
  });

  it('PG0: settle / top-up / profile updates are gated to the owning store', () => {
    const origin = onboardAgent('PG0S O', 'NorthTown', 50);
    const dest = onboardAgent('PG0S D', 'NorthTown', 50);
    const mine = vendors.register({ name: 'MineS' });
    const other = vendors.register({ name: 'OtherS' });
    // Mint with an empty balance so the order lands unpaid and there is something to settle.
    const minted: any = controller.createInbound({ vendorId: mine.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700', size: 'M', contentPhotoRef: 'c.jpg' } as never, { role: 'genesis', did: mine.did } as never);
    expect(minted.paid).toBe(false);
    expect(() => controller.settleParcel(minted.parcel.parcelId, { role: 'genesis', did: other.did } as never)).toThrow(/not yours/);
    expect(() => controller.topUpVendor(mine.vendorId, { amount: 100 } as never, { role: 'genesis', did: other.did } as never)).toThrow(/not yours/);
    expect(() => controller.updateVendor(mine.vendorId, { callbackUrl: 'https://evil.example/hook' } as never, { role: 'genesis', did: other.did } as never)).toThrow(/not yours/);
    controller.topUpVendor(mine.vendorId, { amount: 100 } as never, { role: 'genesis', did: mine.did } as never);
    const settled: any = controller.settleParcel(minted.parcel.parcelId, { role: 'genesis', did: mine.did } as never);
    expect(settled.paid).toBe(true);
    // The owner-ALLOW side of the profile gate — without it, an always-throw regression stays green.
    const updated: any = controller.updateVendor(mine.vendorId, { callbackUrl: 'https://mine.example/hook' } as never, { role: 'genesis', did: mine.did } as never);
    expect(updated.callbackUrl).toBe('https://mine.example/hook');
  });

  it('PG0: a mint cannot bind another store’s checkout handoff', () => {
    const origin = onboardAgent('PG0C O', 'NorthTown', 50);
    const dest = onboardAgent('PG0C D', 'NorthTown', 50);
    const mine = vendors.register({ name: 'MineC' });
    const other = vendors.register({ name: 'OtherC' });
    vendors.topUp(mine.vendorId, 100);
    const chk = vendors.captureCheckout({ vendorId: other.vendorId, destAgentDid: dest.did, buyerEmail: 'b@example.com', buyerMobile: '+254700999', externalOrderId: 'EXT-1' });
    expect(() => controller.createInbound({ vendorId: mine.vendorId, checkoutId: chk.id, originPudoDid: origin.did, destPudoDid: dest.did, size: 'M', contentPhotoRef: 'c.jpg' } as never, { role: 'genesis', did: mine.did } as never)).toThrow(/different store/);
    // The victim's handoff is untouched — still open in THEIR inbox.
    expect(vendors.checkout(chk.id).consumed).toBe(false);
  });

  it('PG0: the four write routes carry their scope labels (guard metadata pinned)', () => {
    expect(Reflect.getMetadata(SCOPES_KEY, SbgController.prototype.updateVendor)).toEqual(['vendor:manage:self']);
    expect(Reflect.getMetadata(SCOPES_KEY, SbgController.prototype.topUpVendor)).toEqual(['vendor:manage:self']);
    expect(Reflect.getMetadata(SCOPES_KEY, SbgController.prototype.settleParcel)).toEqual(['shipment:create']);
    expect(Reflect.getMetadata(SCOPES_KEY, SbgController.prototype.createInbound)).toEqual(['shipment:create']);
  });

  it('PG0: a storeless walk-up parcel cannot be settled by a store token', () => {
    const origin = onboardAgent('PG0W', 'NorthTown', 50);
    const store = vendors.register({ name: 'StoreW' });
    parcels.accept({ agentDid: origin.did, parcelId: 'QR-PG0', size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'g.jpg' });
    expect(() => controller.settleParcel('QR-PG0', { role: 'genesis', did: store.did } as never)).toThrow(/minting store/);
  });

  // --- PG1: parcel genesis from the sender's own phone (the Send app mints, identically) ---

  const enrollPerson = (phone: string) => persons.enroll(phone, true).person;
  const asConsumer = (personDid: string) => ({ role: 'consumer', did: personDid }) as never;

  it('PG1: a signed-in sender mints in-app — DID, locked price, journey twin and label at creation', async () => {
    const flush = () => new Promise((r) => setImmediate(r));
    twin.onModuleInit();
    graduation.onModuleInit();
    const origin = onboardAgent('PG1 O', 'NorthTown', 50);
    const dest = onboardAgent('PG1 D', 'NorthTown', 50);
    const sender = enrollPerson('+254700500001');
    const res: any = identity.createParcel({ receiverMobile: '+254700500002', originPudoDid: origin.did, destPudoDid: dest.did, dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 1.6 } as never, asConsumer(sender.personDid));
    // The response is the sender's authenticated twin VIEW — never the raw parcel.
    expect(res.parcel.relation).toBe('sent');
    expect(res.parcel.did).toMatch(/^did:glos:/);
    expect(res.parcel.status).toBe('Created');
    // The drop-off credential: a printable label carrying the PUBLIC tracking key, no handover secret.
    expect(res.label.svg).toContain(res.parcel.trackingKey);
    // The price is ALWAYS the locked (cheapest) leg — flexible's rebate rail is vendor-only, so a person
    // is never quoted the ceiling. Tied to the live quote, not just non-zero.
    expect(res.price.routeMode).toBe('locked');
    const liveQuote: any = routing.quoteShipment(origin.did, dest.did, parcels.get(res.parcel.parcelId).size);
    expect(res.price.total).toBe(liveQuote.locked.total);
    expect(res.price.ceiling).toBe(liveQuote.flexible.total);
    expect(res.journey.hops.length).toBeGreaterThanOrEqual(2);
    // Nothing in the response leaks the receiver's number.
    expect(JSON.stringify(res)).not.toContain('+254700500002');
    // The raw record: cash-at-counter, price-locked, both parties joined by hash.
    const p = parcels.get(res.parcel.parcelId);
    expect(p.paymentMode).toBe('cash');
    expect(p.paidStatus).toBe('unpaid');
    expect(p.shipmentCost).toBe(res.price.total);
    expect(p.senderPhoneHash).toBe(sender.phoneHash);
    expect(p.receiverPhoneHash).toBeDefined();
    await flush();
    // The twin is BORN at mint with its planned journey — before any drop-off (the DT invariant, now for people).
    expect(twin.shipment(p.parcelId)?.state).toBe('created');
    expect(context.has(p.parcelId)).toBe(true);
    // And it lands in the sender's home as 'sent' + the receiver's as 'received' immediately.
    expect(parcels.forPhoneHash(sender.phoneHash).sent.some((v) => v.parcelId === p.parcelId)).toBe(true);
    expect(parcels.forPhoneHash(hashPhone('+254700500002')!).received.some((v) => v.parcelId === p.parcelId)).toBe(true);
  });

  it('PG1: genesis parity — a person mint and a vendor mint of the SAME box price identically', () => {
    const origin = onboardAgent('PGP O', 'NorthTown', 50);
    const dest = onboardAgent('PGP D', 'NorthTown', 50);
    const vendor = vendors.register({ name: 'PGPV' });
    vendors.topUp(vendor.vendorId, 200);
    const vendorRes: any = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700500004', dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 1.6, routeMode: 'locked', contentPhotoRef: 'c.jpg' } as never, { role: 'genesis', did: vendor.did } as never);
    const sender = enrollPerson('+254700500003');
    const mine: any = identity.createParcel({ receiverMobile: '+254700500004', originPudoDid: origin.did, destPudoDid: dest.did, dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 1.6 } as never, asConsumer(sender.personDid));
    const a: any = parcels.get(mine.parcel.parcelId);
    const b: any = vendorRes.parcel;
    // Identity artefacts exist on both (but differ per shipment).
    for (const k of ['did', 'trackingKey', 'label']) {
      expect(a[k]).toBeDefined();
      expect(b[k]).toBeDefined();
    }
    // The SAME box on the SAME lane must derive and price IDENTICALLY — the epic's thesis, pinned.
    for (const k of ['size', 'cargoClass', 'routeMode', 'routeKm', 'nodeFees', 'transportCost', 'platformFee', 'shipmentCost', 'ceilingCost']) {
      expect(a[k]).toEqual(b[k]);
    }
  });

  it('PG1: a thin item (a 0.5 cm letter) mints — the size floor is 1 mm, not 1 cm', () => {
    const origin = onboardAgent('PGT O', 'NorthTown', 50);
    const dest = onboardAgent('PGT D', 'NorthTown', 50);
    const sender = enrollPerson('+254700540001');
    const res: any = identity.createParcel({ receiverMobile: '+254700540002', originPudoDid: origin.did, destPudoDid: dest.did, dimensionsCm: { l: 21, w: 10, h: 0.5 }, weightKg: 0.02 } as never, asConsumer(sender.personDid));
    expect(res.parcel.did).toMatch(/^did:glos:/);
    expect(res.parcel.size).toBe('S');
  });

  it('intake redesign: a walk-up accept DERIVES the tier from measured dims (no manual size picker)', () => {
    const origin = onboardAgent('AD1', 'NorthTown', 50);
    const p = parcels.accept({ agentDid: origin.did, parcelId: 'QR-AD1', dimensionsCm: { l: 42, w: 30, h: 18 }, weightKg: 3.5, destZone: 'SouthTown', senderMobile: '+254700700001', receiverMobile: '+254700700002', dropoffPhotoRef: 'g.jpg' } as never);
    expect(p.size).toBe('M'); // 42×30×18 @ 3.5 kg → M per SIZE_LIMITS
    expect(p.dimensionsCm).toEqual({ l: 42, w: 30, h: 18 });
    // A thin letter derives to S (the 1 mm floor lets it through).
    const p2 = parcels.accept({ agentDid: origin.did, parcelId: 'QR-AD1B', dimensionsCm: { l: 21, w: 10, h: 0.5 }, weightKg: 0.02, destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'g.jpg' } as never);
    expect(p2.size).toBe('S');
  });

  it('intake redesign: a genuinely heavy walk-up is refused (routes to dedicated freight, not the bus)', () => {
    const origin = onboardAgent('AD2', 'NorthTown', 50);
    expect(() => parcels.accept({ agentDid: origin.did, parcelId: 'QR-AD2', dimensionsCm: { l: 120, w: 100, h: 100 }, weightKg: 300, destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'g.jpg' } as never)).toThrow(/dedicated freight/);
  });

  it('intake redesign: dims WITHOUT weight still derive the tier (parity with the vendor mint — not the M fallback)', () => {
    const origin = onboardAgent('AD3', 'NorthTown', 50);
    const p = parcels.accept({ agentDid: origin.did, parcelId: 'QR-AD3', dimensionsCm: { l: 60, w: 50, h: 40 }, destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'g.jpg' } as never);
    expect(p.size).toBe('L'); // 60×50×40 → L, derived from dims alone
  });

  it('intake redesign: a parcel cannot be sent to the shop taking it in (origin ≠ destination)', () => {
    const origin = onboardAgent('AD4', 'NorthTown', 50);
    expect(() => parcels.accept({ agentDid: origin.did, parcelId: 'QR-AD4', dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 1.6, destZone: origin.zone, destPudoDid: origin.did, senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'g.jpg' } as never)).toThrow(/shop taking it in/);
  });

  it('intake redesign: the public geocode resolves a known place (for the Address → nearest-PUDO mode)', () => {
    const g: any = controller.geocode('Westlands');
    expect(typeof g.location.lat).toBe('number');
    expect(typeof g.location.lng).toBe('number');
    expect(g.confidence).toBe('exact');
    expect(() => controller.geocode('')).toThrow(); // a blank query is refused
  });

  it('PG1: a P4+ load is refused (no un-billable person freight) — nothing is registered', () => {
    const origin = onboardAgent('PG1H O', 'NorthTown', 50);
    const dest = onboardAgent('PG1H D', 'NorthTown', 50);
    const sender = enrollPerson('+254700500005');
    expect(() => identity.createParcel({ receiverMobile: '+254700500006', originPudoDid: origin.did, destPudoDid: dest.did, dimensionsCm: { l: 120, w: 100, h: 100 }, weightKg: 300 } as never, asConsumer(sender.personDid))).toThrow(/dedicated freight/);
    // No orphaned freight was minted for either party.
    expect(dispatch.freightsForPhoneHash(hashPhone('+254700500006')!)).toHaveLength(0);
    const home: any = identity.myParcels(asConsumer(sender.personDid));
    expect(home.freights).toHaveLength(0);
    expect(home.sent).toHaveLength(0);
  });

  // --- PG2: the counter half of the in-app mint — intake, preview, and the projected list ---

  const mintPeerSend = (tag: string, phoneSeq: string) => {
    const origin = onboardAgent(`${tag} O`, 'NorthTown', 50);
    const dest = onboardAgent(`${tag} D`, 'NorthTown', 50);
    const sender = enrollPerson(`+2547006${phoneSeq}001`);
    const res: any = identity.createParcel({ receiverMobile: `+2547006${phoneSeq}002`, originPudoDid: origin.did, destPudoDid: dest.did, dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 1.6 } as never, asConsumer(sender.personDid));
    return { origin, dest, sender, parcelId: res.parcel.parcelId as string, due: res.price.total as number };
  };

  it('PG2: drop-off of a pre-minted send — cash remitted at the locked price, labour fee earned, twin advances', async () => {
    const flush = () => new Promise((r) => setImmediate(r));
    twin.onModuleInit();
    graduation.onModuleInit();
    const { origin, parcelId, due } = mintPeerSend('PG2', '00');
    await flush();
    const before = gate.canTransact(origin.did).balance;
    const p: any = controller.intake(parcelId, { dropoffPhotoRef: 'drop.jpg' } as never, { role: 'agent', did: origin.did } as never);
    expect(p.status).toBe('At_PUDO');
    expect(p.paidStatus).toBe('ParcelPaid');
    expect(p.dropoffPhotoRef).toBe('drop.jpg');
    // The shop remits the LOCKED price it just collected in cash, and earns the same labour fee as any intake.
    expect(gate.canTransact(origin.did).balance).toBeCloseTo(before - due + 0.4, 2);
    await flush();
    // The twin (born at mint) ADVANCES to picked_up — its created-time journey is kept, not re-registered.
    expect(twin.shipment(parcelId)?.state).toBe('picked_up');
    expect(context.get(parcelId)?.legs[0].origin).toBe('PG2 O');
  });

  it('PG2: intake is refused at the wrong shop, without a photo, twice, and on an unfunded shop wallet', () => {
    const { origin, parcelId } = mintPeerSend('PG2R', '10');
    const elsewhere = onboardAgent('PG2R X', 'NorthTown', 50);
    expect(() => controller.intake(parcelId, { dropoffPhotoRef: 'd.jpg' } as never, { role: 'agent', did: elsewhere.did } as never)).toThrow(/shop the sender chose/);
    expect(() => controller.intake(parcelId, {} as never, { role: 'agent', did: origin.did } as never)).toThrow(/photo/);
    // Double intake: the first succeeds, the second finds the parcel already At_PUDO.
    controller.intake(parcelId, { dropoffPhotoRef: 'd.jpg' } as never, { role: 'agent', did: origin.did } as never);
    expect(() => controller.intake(parcelId, { dropoffPhotoRef: 'd.jpg' } as never, { role: 'agent', did: origin.did } as never)).toThrow(/expected Created/);
    // A shop that never funded its wallet cannot remit — the no-money-no-scan gate holds for peer sends too.
    const brokeOrigin = onboardAgent('PG2B O', 'NorthTown', 0);
    const dest = onboardAgent('PG2B D', 'NorthTown', 50);
    const sender = enrollPerson('+254700620001');
    const res: any = identity.createParcel({ receiverMobile: '+254700620002', originPudoDid: brokeOrigin.did, destPudoDid: dest.did, dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 1.6 } as never, asConsumer(sender.personDid));
    expect(() => controller.intake(res.parcel.parcelId, { dropoffPhotoRef: 'd.jpg' } as never, { role: 'agent', did: brokeOrigin.did } as never)).toThrow(/Insufficient funds/);
  });

  it('PG2: the intake preview tells the counter what is due — and only the booked shop may ask', () => {
    const { origin, dest, parcelId, due } = mintPeerSend('PG2P', '30');
    const preview: any = controller.intakePreview(parcelId, { role: 'agent', did: origin.did } as never);
    expect(preview.kind).toBe('peer_send');
    expect(preview.intakeReady).toBe(true);
    expect(preview.cashDue).toBe(due);
    expect(preview.destShopName).toBe(dest.shopName);
    expect(JSON.stringify(preview)).not.toContain('+2547006');
    const elsewhere = onboardAgent('PG2P X', 'NorthTown', 50);
    expect(() => controller.intakePreview(parcelId, { role: 'agent', did: elsewhere.did } as never)).toThrow(/another shop/);
  });

  it('PG2: voiding a peer-send nets the shop wallet to zero — refunds the LOCKED price + claws back the labour fee', () => {
    const { origin, parcelId, due } = mintPeerSend('PG2V', '40');
    expect(due).not.toBeCloseTo(2.0, 2); // the price is NOT the WHOLESALE+labour coincidence — the bug would hide there
    const before = gate.canTransact(origin.did).balance;
    controller.intake(parcelId, { dropoffPhotoRef: 'd.jpg' } as never, { role: 'agent', did: origin.did } as never);
    expect(gate.canTransact(origin.did).balance).toBeCloseTo(before - due + 0.4, 2); // remitted the cash, earned labour
    parcels.void(parcelId, origin.did, 'torn.jpg');
    // A full reversal: the locked price back, the labour fee clawed back → exactly the pre-intake balance.
    expect(gate.canTransact(origin.did).balance).toBeCloseTo(before, 2);
  });

  it('PG2: operator-cancelling an At_PUDO peer-send reverses the intake the same way', () => {
    const { origin, parcelId, due } = mintPeerSend('PG2X', '50');
    const before = gate.canTransact(origin.did).balance;
    controller.intake(parcelId, { dropoffPhotoRef: 'd.jpg' } as never, { role: 'agent', did: origin.did } as never);
    expect(gate.canTransact(origin.did).balance).toBeCloseTo(before - due + 0.4, 2);
    controller.cancelParcel(parcelId, { reason: 'test' } as never, { role: 'operator' } as never);
    expect(gate.canTransact(origin.did).balance).toBeCloseTo(before, 2);
  });

  it('PG2: a legacy walk-up cash void still refunds WHOLESALE (the peer-send fix left it untouched)', () => {
    const origin = onboardAgent('PG2W2', 'NorthTown', 50);
    const before = gate.canTransact(origin.did).balance;
    parcels.accept({ agentDid: origin.did, parcelId: 'QR-PG2W2', size: 'M', destZone: 'SouthTown', senderMobile: '+254700611200', receiverMobile: '+254700611201', dropoffPhotoRef: 'g.jpg' });
    expect(gate.canTransact(origin.did).balance).toBeCloseTo(before - 1.6, 2); // walk-up cash charged WHOLESALE, no labour
    parcels.void('QR-PG2W2', origin.did, 'torn.jpg');
    expect(gate.canTransact(origin.did).balance).toBeCloseTo(before, 2);
  });

  it('PG2: the parcel list is PROJECTED — no phones, hashes or handover secrets for non-operators', () => {
    const origin = onboardAgent('PG2L', 'NorthTown', 50);
    parcels.accept({ agentDid: origin.did, parcelId: 'QR-PG2L', size: 'M', destZone: 'SouthTown', senderMobile: '+254700611119', receiverMobile: '+254700611118', dropoffPhotoRef: 'g.jpg' });
    const rows: any[] = controller.listParcels('At_PUDO', origin.did, { role: 'agent', did: origin.did } as never) as never;
    const mine = rows.find((r) => r.parcelId === 'QR-PG2L');
    expect(mine).toBeDefined();
    expect(mine.destZone).toBe('SouthTown'); // the operational fields the screens use survive
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain('+254700611119');
    expect(dump).not.toContain('PhoneHash');
    expect(dump).not.toContain('collectionCode');
    expect(dump).not.toContain('"otp"');
    // The operator watchtower still sees the raw record.
    const raw: any[] = controller.listParcels('At_PUDO', origin.did, { role: 'operator' } as never) as never;
    expect(JSON.stringify(raw.find((r) => r.parcelId === 'QR-PG2L'))).toContain('+254700611119');
  });

  it('PG1: the mint fails closed on price drift — a wrong expectedTotal is refused, the right one goes through', () => {
    const origin = onboardAgent('PGD O', 'NorthTown', 50);
    const dest = onboardAgent('PGD D', 'NorthTown', 50);
    const s1 = enrollPerson('+254700530001');
    const s2 = enrollPerson('+254700530003');
    // A stale/incorrect consented total is rejected with the fresh price in the error params.
    let thrown: any;
    try {
      identity.createParcel({ receiverMobile: '+254700530002', originPudoDid: origin.did, destPudoDid: dest.did, dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 1.6, expectedTotal: 999999 } as never, asConsumer(s1.personDid));
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.code).toBe('PRICE_CHANGED');
    expect(thrown?.params?.newTotal).toBeGreaterThan(0);
    // The correct locked total (the same route quotes the same price) mints normally.
    const good: any = identity.createParcel({ receiverMobile: '+254700530004', originPudoDid: origin.did, destPudoDid: dest.did, dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 1.6, expectedTotal: thrown.params.newTotal } as never, asConsumer(s2.personDid));
    expect(good.parcel.did).toMatch(/^did:glos:/);
    expect(good.price.total).toBe(thrown.params.newTotal);
  });

  it('PG2: an unpaid Created vendor order is NOT intakeReady (the counter must not take it in before the store pays)', () => {
    const origin = onboardAgent('PG2U O', 'NorthTown', 50);
    const dest = onboardAgent('PG2U D', 'NorthTown', 50);
    const vendor = vendors.register({ name: 'PG2U' }); // no top-up → the mint lands unpaid
    const minted: any = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700', size: 'M', contentPhotoRef: 'c.jpg' } as never, { role: 'genesis', did: vendor.did } as never);
    expect(minted.paid).toBe(false);
    const preview: any = controller.intakePreview(minted.parcel.parcelId, { role: 'agent', did: origin.did } as never);
    expect(preview.kind).toBe('vendor_order');
    expect(preview.status).toBe('Created');
    expect(preview.intakeReady).toBe(false); // awaiting the store's payment
    // Once settled it becomes intakeable.
    controller.topUpVendor(vendor.vendorId, { amount: 100 } as never, { role: 'genesis', did: vendor.did } as never);
    controller.settleParcel(minted.parcel.parcelId, { role: 'genesis', did: vendor.did } as never);
    const after: any = controller.intakePreview(minted.parcel.parcelId, { role: 'agent', did: origin.did } as never);
    expect(after.intakeReady).toBe(true);
  });

  it('PG1: same-shop sends and implausible receiver numbers are refused before anything is created', () => {
    const origin = onboardAgent('PG1S', 'NorthTown', 50);
    const dest = onboardAgent('PG1S D', 'NorthTown', 50);
    const sender = enrollPerson('+254700500007');
    expect(() => identity.createParcel({ receiverMobile: '+254700500008', originPudoDid: origin.did, destPudoDid: origin.did, dimensionsCm: { l: 10, w: 10, h: 5 }, weightKg: 0.5 } as never, asConsumer(sender.personDid))).toThrow(/different shops/);
    // A typo'd receiver number would orphan the parcel from every home — the phone join IS the delivery contract.
    expect(() => identity.createParcel({ receiverMobile: 'abc', originPudoDid: origin.did, destPudoDid: dest.did, dimensionsCm: { l: 10, w: 10, h: 5 }, weightKg: 0.5 } as never, asConsumer(sender.personDid))).toThrow(/valid receiver phone/);
    const home: any = identity.myParcels(asConsumer(sender.personDid));
    expect(home.sent).toHaveLength(0);
  });

  it('runs the inbound e-commerce flow: webhook → intake → bus → shelve → collect, with vendor callbacks', async () => {
    const flush = () => new Promise((r) => setImmediate(r));
    vendorCallback.onModuleInit();
    const origin = onboardAgent('Origin PUDO', 'NorthTown', 50);
    const dest = onboardAgent('Dest PUDO', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'N-S', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:di', name: 'D', corridorId: corridor.corridorId });
    const vendor = vendors.register({ name: 'ACME', callbackUrl: 'https://acme.example/hook', secret: 'whsec' });

    // Vendor prepays the daughter company, then mints → ParcelPaid + phygital label + collection code.
    vendors.topUp(vendor.vendorId, 50);
    const quote = routing.quoteShipment(origin.did, dest.did, 'M');
    const { parcel, label, paid } = parcels.createInbound({ vendorId: vendor.vendorId, externalOrderId: 'ORD-1', originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+254700', size: 'M', contentPhotoRef: 'content.jpg', items: [{ name: 'Rice 5kg', qty: 2 }], shippingPolicy: vendor.shippingPolicy, quote });
    expect(paid).toBe(true);
    expect(parcel.direction).toBe('inbound');
    expect(parcel.status).toBe('Created');
    expect(parcel.paidStatus).toBe('ParcelPaid');
    expect(parcel.collectionCode).toMatch(/^COL-/);
    expect(label!.svg).toContain('<svg');

    parcels.intakeInbound(parcel.parcelId, origin.did);
    expect(parcels.get(parcel.parcelId).status).toBe('At_PUDO');
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcel.parcelId] });
    const shelf = parcels.shelve(parcel.parcelId, dest.did);
    expect(shelf.binSlot).toMatch(/^[A-Za-z]+-[1-9]$/); // colour-column + row-number slot
    await flush();

    // Buyer presents the collection code → resolves at the destination PUDO.
    const found = parcels.collect(parcel.collectionCode!, dest.did);
    expect(found.parcel.parcelId).toBe(parcel.parcelId);
    const delivered = parcels.collectConfirm(parcel.parcelId, dest.did, parcel.collectionCode!);
    expect(delivered.status).toBe('Delivered');
    await flush();

    // Vendor got HMAC-signed status callbacks (ready_for_pickup + collected).
    const cbs = vendors.outboxFor(vendor.vendorId);
    expect(cbs.map((c) => c.event)).toEqual(expect.arrayContaining(['ready_for_pickup', 'collected']));
    expect(createHmac('sha256', 'whsec').update(cbs[0].body).digest('hex')).toBe(cbs[0].signature);
  });

  describe('tote genesis at a shop — one scan, a load of parcels', () => {
    function shopWithTwoWaiting() {
      const origin = onboardAgent('Bag Origin', 'NorthTown', 50);
      onboardAgent('Bag Dest', 'SouthTown', 50);
      const corridor = corridors.addCorridor({ name: 'N-S bag', originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: 'did:glos:dbag', name: 'D', corridorId: corridor.corridorId });
      for (const id of ['QR-B1', 'QR-B2']) {
        parcels.accept({ agentDid: origin.did, parcelId: id, size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
      }
      return { origin, driver };
    }

    it('opens a bag at the shop, fills it, and moves every parcel on ONE driver scan', () => {
      const { origin, driver } = shopWithTwoWaiting();
      const bag = mdps.openShopBag(origin.did, 'SouthTown');
      expect(bag.code).toMatch(/^BAG-/);
      expect(bag.status).toBe('filling');
      expect(bag.destinationLabel).toBe('SouthTown');

      mdps.fillTote(bag.code, 'QR-B1');
      mdps.fillTote(bag.code, 'QR-B2');
      const sealed = mdps.sealShopBag(bag.code, origin.did);
      expect(sealed.missed).toEqual([]);
      expect(sealed.parcels).toEqual(['QR-B1', 'QR-B2']);
      expect(sealed.tote.status).toBe('available'); // published, so a driver can claim it

      // The whole point: the driver scans the BAG once and both parcels are on the bus.
      const moved = mdps.loadBag(bag.code, driver.badgeId);
      expect(moved.moved.sort()).toEqual(['QR-B1', 'QR-B2']);
      expect(parcels.get('QR-B1').status).toBe('On_Bus');
      expect(parcels.get('QR-B2').status).toBe('On_Bus');
    });

    it('plans several bags at once, keyed by NEXT HOP — direct where the route is direct', () => {
      // The Hawassa case: one shop, parcels for three places. Some go straight out; some route via the hub.
      const shop = onboardAgent('Hawassa Shop', 'Hawassa', 50);
      const addis = onboardAgent('Addis PUDO', 'Addis', 50);
      const arba = onboardAgent('Arba Minch PUDO', 'ArbaMinch', 50);
      corridors.addCorridor({ name: 'Hawassa-Addis', originZone: 'Hawassa', destZone: 'Addis' });
      corridors.addCorridor({ name: 'Hawassa-ArbaMinch', originZone: 'Hawassa', destZone: 'ArbaMinch' });

      const drop = (id: string, zone: string, destPudoDid: string) =>
        parcels.accept({ agentDid: shop.did, parcelId: id, size: 'S', destZone: zone, destPudoDid, senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
      drop('QR-AA1', 'Addis', addis.did);
      drop('QR-AA2', 'Addis', addis.did);
      drop('QR-AM1', 'ArbaMinch', arba.did);

      const plan = bagPlans.forShop(shop.did);
      // Two groups, busiest first — two bags' worth of work, not one queue of loose parcels.
      expect(plan.groups.map((g) => g.label)).toEqual(['Addis', 'ArbaMinch']);
      expect(plan.groups[0].parcelIds.sort()).toEqual(['QR-AA1', 'QR-AA2']);
      expect(plan.groups[0].via).toBe('direct'); // a direct corridor: no hub in the middle
      expect(plan.groups.every((g) => g.openBagCode === undefined)).toBe(true);
      expect(plan.bags).toEqual([]);

      // Open the Addis bag; the plan now points at it, and the other group is still waiting for its own.
      const bag = mdps.openShopBag(shop.did, 'Addis');
      mdps.fillShopBag(bag.code, shop.did, 'QR-AA1');
      const after = bagPlans.forShop(shop.did);
      expect(after.groups.find((g) => g.label === 'Addis')?.openBagCode).toBe(bag.code);
      expect(after.groups.find((g) => g.label === 'ArbaMinch')?.openBagCode).toBeUndefined();
      expect(after.bags).toHaveLength(1);
      expect(after.bags[0]).toMatchObject({ code: bag.code, destinationLabel: 'Addis', parcels: 1, status: 'filling' });

      // And a second bag for the other place can be open at the same time — the whole point.
      const bag2 = mdps.openShopBag(shop.did, 'ArbaMinch');
      expect(bagPlans.forShop(shop.did).bags.map((b) => b.code).sort()).toEqual([bag.code, bag2.code].sort());
    });

    it('refuses a parcel that is going somewhere else — a bag cannot carry the wrong city', () => {
      const { origin } = shopWithTwoWaiting();
      onboardAgent('Far Dest', 'EastTown', 50);
      corridors.addCorridor({ name: 'N-E bag', originZone: 'NorthTown', destZone: 'EastTown' });
      parcels.accept({ agentDid: origin.did, parcelId: 'QR-EAST', size: 'S', destZone: 'EastTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });

      const bag = mdps.openShopBag(origin.did, 'SouthTown');
      // The seal gate only checks that everything EXPECTED is IN the bag — it would never have noticed a
      // stowaway going the other way, which is why the check has to happen at the moment it is added.
      expect(() => mdps.fillShopBag(bag.code, origin.did, 'QR-EAST')).toThrow(/going to EastTown, but this bag goes to SouthTown/);
      expect(totes.requireByCode(bag.code).parcels).toEqual([]);

      mdps.fillShopBag(bag.code, origin.did, 'QR-B1'); // the right way → accepted
      expect(totes.requireByCode(bag.code).parcels).toEqual(['QR-B1']);
    });

    it('takes a parcel once — the same sticker scanned twice, and a parcel already in another bag', () => {
      const { origin } = shopWithTwoWaiting();
      const bag = mdps.openShopBag(origin.did, 'SouthTown');
      mdps.fillShopBag(bag.code, origin.did, 'QR-B1');

      // The scanning accident: the same sticker waved again. A silent second push would double-count its
      // units, so the bag would report itself full while half empty.
      const before = totes.requireByCode(bag.code).unitsUsed;
      expect(() => mdps.fillShopBag(bag.code, origin.did, 'QR-B1')).toThrow(/already in bag/);
      expect(totes.requireByCode(bag.code).parcels).toEqual(['QR-B1']);
      expect(totes.requireByCode(bag.code).unitsUsed).toBe(before);

      // And a parcel sitting in a bag already sealed on the shop floor cannot be scanned into the next one:
      // it stays At_PUDO until the driver takes it, so nothing else would have stopped two manifests
      // claiming the same parcel.
      mdps.fillShopBag(bag.code, origin.did, 'QR-B2');
      mdps.sealShopBag(bag.code, origin.did);
      const next = mdps.openShopBag(origin.did, 'SouthTown');
      expect(() => mdps.fillShopBag(next.code, origin.did, 'QR-B1')).toThrow(new RegExp(`already in bag ${bag.code}`));
      expect(totes.requireByCode(next.code).parcels).toEqual([]);
    });

    it('will not fill another shop’s bag, a closed bag, or with a parcel that is not waiting here', () => {
      const { origin } = shopWithTwoWaiting();
      const other = onboardAgent('Other Filler', 'NorthTown', 50);
      const bag = mdps.openShopBag(origin.did, 'SouthTown');
      expect(() => mdps.fillShopBag(bag.code, other.did, 'QR-B1')).toThrow(/not opened at this shop/);
      expect(() => mdps.fillShopBag(bag.code, origin.did, 'QR-NOPE')).toThrow(/not found/i);

      mdps.fillShopBag(bag.code, origin.did, 'QR-B1');
      mdps.fillShopBag(bag.code, origin.did, 'QR-B2');
      mdps.sealShopBag(bag.code, origin.did);
      expect(() => mdps.fillShopBag(bag.code, origin.did, 'QR-B1')).toThrow(/it is closed/);
    });

    it('refuses to seal a bag that leaves a waiting parcel behind, unless it is deliberate', () => {
      const { origin } = shopWithTwoWaiting();
      const bag = mdps.openShopBag(origin.did, 'SouthTown');
      mdps.fillTote(bag.code, 'QR-B1'); // QR-B2 is still on the shelf

      // The S25 gate has to live HERE for a bagged hand-over: loadBag is atomic and driver-initiated, so
      // a half-filled bag would otherwise sail past with no refusal and no record.
      expect(() => mdps.sealShopBag(bag.code, origin.did)).toThrow(/still on the shelf/);
      expect(totes.requireByCode(bag.code).status).toBe('filling'); // nothing mutated on the refusal
      expect(parcels.get('QR-B2').shortShippedAt).toBeUndefined();

      const sealed = mdps.sealShopBag(bag.code, origin.did, { acknowledgeShortShip: true, shortShipReason: 'no room' });
      expect(sealed.missed).toEqual(['QR-B2']);
      expect(sealed.shortShipped).toBe(true);
      // Stamped exactly as a handover short-ship is — same marker, same reason field, same event.
      expect(parcels.get('QR-B2').shortShippedAt).toBeTruthy();
      expect(parcels.get('QR-B2').shortShipReason).toBe('no room');
      expect(events.getLog().some((e) => e.type === GlosEvent.Pudo.ParcelShortShipped)).toBe(true);
      // …and the reason never reaches the timeline both twins can read.
      expect(JSON.stringify(parcels.get('QR-B2').scans)).not.toContain('no room');
    });

    it('will not seal another shop’s bag, an empty one, or one already sealed', () => {
      const { origin } = shopWithTwoWaiting();
      const other = onboardAgent('Other Shop', 'NorthTown', 50);
      const bag = mdps.openShopBag(origin.did, 'SouthTown');
      expect(() => mdps.sealShopBag(bag.code, other.did)).toThrow(/not opened at this shop/);

      const empty = mdps.openShopBag(origin.did, 'EastTown'); // nothing waiting for EastTown
      expect(() => mdps.sealShopBag(empty.code, origin.did)).toThrow(/empty/);

      mdps.fillTote(bag.code, 'QR-B1');
      mdps.fillTote(bag.code, 'QR-B2');
      mdps.sealShopBag(bag.code, origin.did);
      // Closed once: a second seal would re-run the gate over parcels dropped off after the bag was shut
      // and short-ship them for missing a bus they were never on.
      expect(() => mdps.sealShopBag(bag.code, origin.did)).toThrow(/already closed/);
    });

    it('sealing PUBLISHES and tells the drivers — the shop saying "ready now" must reach someone', async () => {
      const { origin } = shopWithTwoWaiting();
      const bag = mdps.openShopBag(origin.did, 'SouthTown');
      mdps.fillShopBag(bag.code, origin.did, 'QR-B1');
      mdps.fillShopBag(bag.code, origin.did, 'QR-B2');

      const sealed = mdps.sealShopBag(bag.code, origin.did);
      expect(sealed.tote.status).toBe('available');
      expect(sealed.tote.sealedAt).toBeTruthy(); // the gate ran — a record distinct from being published
      await Promise.resolve();
      const announced = events.getLog().filter((e) => e.type === GlosEvent.Pudo.ToteAvailable);
      expect(announced).toHaveLength(1);
      expect(announced[0].payload).toMatchObject({ code: bag.code, reason: 'sealed' });
    });

    it('the sweep never publishes a SHOP bag — it asks the shop to close it, once per reason', async () => {
      const { origin } = shopWithTwoWaiting();
      const bag = mdps.openShopBag(origin.did, 'SouthTown');
      mdps.fillShopBag(bag.code, origin.did, 'QR-B1');
      mdps.fillShopBag(bag.code, origin.did, 'QR-B2');

      // Not full, not aged → nothing at all.
      expect(dispatch.publishReady()).not.toContain(bag.code);
      await Promise.resolve();
      expect(events.getLog().filter((e) => e.type === GlosEvent.Pudo.ToteNeedsSeal)).toHaveLength(0);

      // Aged past the max wait: still NOT published — a bag on a counter is open until a human shuts it,
      // and publishing it would advertise a bag no driver can take (and lock the shop out of the gate).
      const later = Date.now() + 25 * 3_600_000;
      expect(dispatch.publishReady(later)).not.toContain(bag.code);
      expect(totes.requireByCode(bag.code).status).toBe('filling');
      await Promise.resolve();
      const asked = events.getLog().filter((e) => e.type === GlosEvent.Pudo.ToteNeedsSeal);
      expect(asked).toHaveLength(1);
      expect(asked[0].payload).toMatchObject({ code: bag.code, agentDid: origin.did, reason: 'max_wait' });

      // …and a sweep running every few minutes must not nag the counter every few minutes.
      dispatch.publishReady(later + 3_600_000);
      await Promise.resolve();
      expect(events.getLog().filter((e) => e.type === GlosEvent.Pudo.ToteNeedsSeal)).toHaveLength(1);

      // The shop closes it, and only then does it reach the marketplace.
      expect(mdps.sealShopBag(bag.code, origin.did).tote.status).toBe('available');
    });

    it('after a seal the plan points at a NEW bag, not back into the closed one', () => {
      const { origin } = shopWithTwoWaiting();
      const bag = mdps.openShopBag(origin.did, 'SouthTown');
      mdps.fillShopBag(bag.code, origin.did, 'QR-B1');
      mdps.sealShopBag(bag.code, origin.did, { acknowledgeShortShip: true, shortShipReason: 'later bus' });

      // The sealed bag is still on the floor waiting for its driver, so it stays on the bag list — but the
      // group must not point the shop back into it, or the next parcel has nowhere to go.
      const plan = bagPlans.forShop(origin.did);
      expect(plan.bags.map((b) => b.code)).toContain(bag.code);
      expect(plan.groups.find((g) => g.label === 'SouthTown')?.openBagCode).toBeUndefined();
    });

    it('a shop can only stage as many bags as it has floor room for — and says how many', () => {
      const { origin } = shopWithTwoWaiting();
      onboardAgent('East Dest', 'EastTown', 50);
      onboardAgent('West Dest', 'WestTown', 50);

      // The default is deliberately modest: a small counter is the common case.
      expect(bagPlans.forShop(origin.did).staging).toEqual({ capacity: 2, used: 0, free: 2 });

      const one = mdps.openShopBag(origin.did, 'SouthTown');
      const two = mdps.openShopBag(origin.did, 'EastTown');
      expect(bagPlans.forShop(origin.did).staging).toEqual({ capacity: 2, used: 2, free: 0 });
      expect(() => mdps.openShopBag(origin.did, 'WestTown')).toThrow(/room for 2 bag/);

      // A SEALED bag still takes up the same square metre — it is standing there waiting for its driver.
      mdps.fillShopBag(one.code, origin.did, 'QR-B1');
      mdps.sealShopBag(one.code, origin.did, { acknowledgeShortShip: true, shortShipReason: 'later bus' });
      expect(bagPlans.forShop(origin.did).staging.used).toBe(2);
      expect(() => mdps.openShopBag(origin.did, 'WestTown')).toThrow(/room for 2 bag/);

      // Room comes back when a bag actually LEAVES.
      const driver = coupleTipper('bays', { min: 0.8, max: 1.5 });
      mdps.loadBag(one.code, drivers.get(driver.did).badgeId!);
      expect(bagPlans.forShop(origin.did).staging).toEqual({ capacity: 2, used: 1, free: 1 });
      expect(mdps.openShopBag(origin.did, 'WestTown').code).toBeTruthy();

      // The limit cannot be walked around by opening a bare tote and ADDRESSING it afterwards — two calls
      // the same app can make. A bag becomes staged when it is addressed, so the gate lives there too.
      const bare = totes.register(origin.did); // flat and unassigned: takes no floor room, so registering is fine
      expect(() => mdps.assignTote(bare.code, 'WestTown', 'WestTown')).toThrow(/room for 2 bag/);

      // …or when the shop says it has more floor than we assumed. The declaration is the shop's, like the shelf's.
      expect(() => agents.setBagBays(origin.did, 0)).toThrow(/between 1 and/);
      agents.setBagBays(origin.did, 4);
      expect(bagPlans.forShop(origin.did).staging).toEqual({ capacity: 4, used: 2, free: 2 });
      expect(two.code).toBeTruthy();
    });

    it('refuses the manual early-release for a shop bag — closing it IS the shop’s release', () => {
      const { origin } = shopWithTwoWaiting();
      const bag = mdps.openShopBag(origin.did, 'SouthTown');
      mdps.fillShopBag(bag.code, origin.did, 'QR-B1');
      // Otherwise a bag reaches the marketplace with QR-B2 still on the shelf and no short-ship record —
      // the exact hole the completeness gate exists to close.
      expect(() => dispatch.release(bag.code)).toThrow(/close it at the counter/);
      expect(totes.requireByCode(bag.code).status).toBe('filling');
    });

    it('a bag published some other way can still be closed — the shop is never locked out of the gate', async () => {
      const { origin } = shopWithTwoWaiting();
      // A hand-built bag (no seal step) that an operator published: the shape a legacy/auto-published bag
      // has after a restart. Sealing must still reconcile it rather than refusing with "it is available".
      const bag = totes.register(origin.did);
      totes.assign(bag.code, 'SouthTown', 'SouthTown');
      mdps.fillTote(bag.code, 'QR-B1');
      dispatch.release(bag.code);
      expect(totes.requireByCode(bag.code).status).toBe('available');

      const sealed = mdps.sealShopBag(bag.code, origin.did, { acknowledgeShortShip: true, shortShipReason: 'went on an earlier bus' });
      expect(sealed.missed).toEqual(['QR-B2']); // the gate ran: the one left behind is recorded
      expect(sealed.tote.sealedAt).toBeTruthy();
      expect(sealed.tote.status).toBe('available'); // unchanged — it was already published
      await Promise.resolve();
      // …and the drivers are not told twice about the same bag.
      expect(events.getLog().filter((e) => e.type === GlosEvent.Pudo.ToteAvailable)).toHaveLength(1);
    });
  });

  describe('the books — every movement has two sides', () => {
    const KE = () => entities.requireForJurisdiction('KE').entityId;
    const bal = (code: (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES], cp?: string) => books.balance(KE(), code, undefined, cp);

    it('a top-up holds money without earning any — we charge for service, not for balance', () => {
      const shop = onboardAgent('Books Shop', 'NorthTown', 0);
      gate.topUp(shop.did, 100);

      expect(agents.balance(shop.did)).toBe(100);
      expect(bal(ACCOUNT_CODES.CASH_CUSTODY)).toBe(100); // the sister holds it
      expect(bal(ACCOUNT_CODES.DEPOSIT_AGENT, shop.did)).toBe(-100); // and owes it back
      expect(bal(ACCOUNT_CODES.REVENUE)).toBe(0); // nothing earned yet
      expect(books.balances(KE())).toEqual({ balanced: true, drift: 0 });
    });

    it('refuses a top-up for a shop that is not approved yet', () => {
      const draft = agents.register({ shopName: 'Draft Shop', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'x', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'D D', nationalId: 'ID-DRAFT-BK', mobile: '+254700DRAFTBK', deviceImei: 'IMEI-DRAFT-BK', requirements: eligibleReqs() });
      expect(() => gate.topUp(draft.did, 50)).toThrow(/not approved yet/);
      expect(books.journal({ entityId: KE() })).toHaveLength(0);
    });

    it('earns the wholesale unit when a walk-up parcel actually moves, and never sees the retail cash', () => {
      const origin = onboardAgent('Books Origin', 'NorthTown', 50);
      onboardAgent('Books Dest', 'SouthTown', 50);
      const before = agents.balance(origin.did);
      parcels.accept({ agentDid: origin.did, parcelId: 'QR-BOOK', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });

      // The shop's float drops by the wholesale unit; the RETAIL 2.0 the customer paid never appears in
      // the sister's books, because the sister never touched it. The shop is a reseller on this flow.
      expect(agents.balance(origin.did)).toBeCloseTo(before - WHOLESALE, 2);
      expect(bal(ACCOUNT_CODES.REVENUE)).toBeCloseTo(-WHOLESALE, 2); // revenue is credit-natured
      expect(bal(ACCOUNT_CODES.CASH_CUSTODY)).toBe(100); // 2×50 topped up; no money moved on a shipment
      expect(books.balances(KE())).toEqual({ balanced: true, drift: 0 });
    });

    it('books a labour fee as the sister’s COST, not as money from nowhere', () => {
      const shop = onboardAgent('Labour Shop', 'NorthTown', 50);
      const before = agents.balance(shop.did);
      gate.payLabour(shop.did, 0.4, 'PUD-X', 'parcel');

      expect(agents.balance(shop.did)).toBeCloseTo(before + 0.4, 2);
      expect(bal(ACCOUNT_CODES.EXPENSE_PROVIDER_FEES)).toBeCloseTo(0.4, 2);
      expect(books.balances(KE())).toEqual({ balanced: true, drift: 0 });
    });

    it('keeps the shop’s REGISTER and the books in agreement — every row linked, and the net equal', () => {
      const shop = onboardAgent('Reg Shop', 'NorthTown', 50);
      onboardAgent('Reg Dest', 'SouthTown', 50);
      parcels.accept({ agentDid: shop.did, parcelId: 'QR-REG', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
      gate.payLabour(shop.did, 0.4, 'PUD-REG', 'parcel');
      gate.topUp(shop.did, 10);

      const rows = gate.entries({ did: shop.did });
      expect(rows.length).toBeGreaterThan(2);
      // Every money row points at the journal entry that moved the money, so a row and its posting can
      // never be told apart — the register is a VIEW of the books, not a second set of them.
      for (const row of rows) {
        expect(row.entryId).toBeTruthy();
        expect(books.journal().some((e) => e.entryId === row.entryId)).toBe(true);
      }
      // And the stronger guarantee: the register's net EQUALS the balance the books derive. Linkage
      // proves the rows came from somewhere; this proves they still say the same thing.
      const summary = gate.agentLedgerSummary(shop.did, {});
      expect(summary.net).toBeCloseTo(agents.balance(shop.did), 2);
    });

    it('keeps the STORE’s register and the books in agreement too', () => {
      const vendor = vendors.register({ name: 'Reg Store' });
      vendors.topUp(vendor.vendorId, 60);
      vendors.billShipment(vendor.vendorId, 'PUD-VREG', 12);
      vendors.rebate(vendor.vendorId, 'PUD-VREG', 2);

      const rows = vendors.settlementsFor(vendor.vendorId);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.entryId).toBeTruthy();
        expect(books.journal().some((e) => e.entryId === row.entryId)).toBe(true);
      }
      expect(vendors.vendorLedgerSummary(vendor.vendorId, {}).net).toBeCloseTo(vendors.balanceOf(vendor.vendorId), 2);
    });

    it('shows credit LENT separately from cash held — cover asks what could be paid today', () => {
      const shop = onboardAgent('Lent Shop', 'NorthTown', 50);
      onboardAgent('Lent Dest', 'SouthTown', 50);
      // Drain the float, then scan two more parcels on the credit line.
      gate.chargeShipping(shop.did, 50, 'PUD-DRAIN');
      parcels.accept({ agentDid: shop.did, parcelId: 'QR-L1', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
      parcels.accept({ agentDid: shop.did, parcelId: 'QR-L2', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });

      const c = books.coverage(KE());
      expect(c.lent).toBeCloseTo(2 * WHOLESALE, 2); // two parcels' worth is out with a shopkeeper
      expect(agents.creditOwed(shop.did)).toBeCloseTo(2 * WHOLESALE, 2);
      // Credit out is an asset, but it cannot pay a driver this afternoon, so cover excludes it.
      expect(c.cover).toBeCloseTo(c.held - c.owed, 2);
      expect(books.balances(KE())).toEqual({ balanced: true, drift: 0 });
    });

    it('keeps a vendor float as a deposit too, earned only when the shipment is billed', () => {
      const origin = onboardAgent('V Origin', 'NorthTown', 50);
      const dest = onboardAgent('V Dest', 'SouthTown', 50);
      corridors.addCorridor({ name: 'N-S books', originZone: 'NorthTown', destZone: 'SouthTown' });
      const vendor = vendors.register({ name: 'Books Store' });
      vendors.topUp(vendor.vendorId, 50);

      expect(vendors.balanceOf(vendor.vendorId)).toBe(50);
      expect(bal(ACCOUNT_CODES.DEPOSIT_VENDOR, vendor.vendorId)).toBe(-50);
      const revenueBefore = bal(ACCOUNT_CODES.REVENUE);

      const quote = routing.quoteShipment(origin.did, dest.did, 'M');
      const { parcel } = parcels.createInbound({ vendorId: vendor.vendorId, externalOrderId: 'ORD-BK', originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+254700', size: 'M', contentPhotoRef: 'c.jpg', shippingPolicy: vendor.shippingPolicy, quote });

      // Billed at the mint → the deposit is drawn down and the sister has finally earned something.
      expect(vendors.balanceOf(vendor.vendorId)).toBeCloseTo(50 - (parcel.shipmentCost ?? 0), 2);
      expect(bal(ACCOUNT_CODES.REVENUE)).toBeCloseTo(revenueBefore - (parcel.shipmentCost ?? 0), 2);
      // The cached figure on the record never disagrees with the postings.
      expect(vendors.get(vendor.vendorId).balance).toBe(vendors.balanceOf(vendor.vendorId));
      expect(books.balances(KE())).toEqual({ balanced: true, drift: 0 });
    });

    it('read-repairs a stale cached vendor balance rather than showing a figure the postings deny', () => {
      const vendor = vendors.register({ name: 'Stale Store' });
      vendors.topUp(vendor.vendorId, 40);
      // Simulate a record written before the books existed (or by a path that missed the sync).
      vendors.get(vendor.vendorId).balance = 999;
      expect(vendors.get(vendor.vendorId).balance).toBe(40); // repaired on read, from the postings
    });

    it('stays balanced across a whole parcel lifecycle, and the mother has no books at all', () => {
      const origin = onboardAgent('Life Origin', 'NorthTown', 50);
      const dest = onboardAgent('Life Dest', 'SouthTown', 50);
      const corridor = corridors.addCorridor({ name: 'N-S life', originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: 'did:glos:dlife', name: 'D', corridorId: corridor.corridorId });
      parcels.accept({ agentDid: origin.did, parcelId: 'QR-LIFE', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-LIFE'] });
      parcels.arrive('QR-LIFE', dest.did);
      parcels.pickup('QR-LIFE', dest.did, parcels.get('QR-LIFE').otp!, 'delivered.jpg');

      expect(parcels.get('QR-LIFE').status).toBe('Delivered');
      expect(books.balances(KE())).toEqual({ balanced: true, drift: 0 });
      // Held against owed — the honest picture, in one read.
      const cover = books.coverage(KE());
      expect(cover.currency).toBe('KES');
      expect(cover.held).toBe(100);
      // The group keeps no books: not an empty set of accounts, but no accounts at all.
      expect(books.trialBalance(entities.group().entityId)).toHaveLength(0);
    });
  });

  describe('entities — who collects, and who performs', () => {
    it('contracts a shop and a hub to the sister that operates their jurisdiction', () => {
      const ke = entities.requireForJurisdiction('KE');
      const shop = onboardAgent('Entity Shop', 'NorthTown', 50);
      expect(agents.get(shop.did).entityId).toBe(ke.entityId);
      expect(agents.entityIdOf(agents.get(shop.did))).toBe(ke.entityId);

      const hub = mdps.register({ name: 'Entity Hub', zones: ['NorthTown'], location: { lat: -1.2, lng: 36.8 } });
      expect(hub.entityId).toBe(ke.entityId);
      // A record written before entities existed still resolves — to the network's home sister.
      expect(mdps.entityIdOf({ ...hub, entityId: undefined })).toBe(ke.entityId);
    });

    it('collects a WALK-UP through the origin shop’s sister (the counter takes the cash)', () => {
      const ke = entities.requireForJurisdiction('KE');
      const origin = onboardAgent('Collect Origin', 'NorthTown', 50);
      onboardAgent('Collect Dest', 'SouthTown', 50);
      const p = parcels.accept({ agentDid: origin.did, parcelId: 'QR-ENT', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
      expect(p.collectingEntityId).toBe(ke.entityId);
    });

    it('collects a VENDOR order through the store’s sister, and refuses a store we cannot invoice', () => {
      const ke = entities.requireForJurisdiction('KE');
      const origin = onboardAgent('Vendor Origin', 'NorthTown', 50);
      const dest = onboardAgent('Vendor Dest', 'SouthTown', 50);
      corridors.addCorridor({ name: 'N-S ent', originZone: 'NorthTown', destZone: 'SouthTown' });
      const vendor = vendors.register({ name: 'Entity Store' });
      expect(vendor.entityId).toBe(ke.entityId);
      vendors.topUp(vendor.vendorId, 50);
      const quote = routing.quoteShipment(origin.did, dest.did, 'M');
      const { parcel } = parcels.createInbound({ vendorId: vendor.vendorId, externalOrderId: 'ORD-ENT', originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+254700', size: 'M', contentPhotoRef: 'c.jpg', shippingPolicy: vendor.shippingPolicy, quote });
      expect(parcel.collectingEntityId).toBe(ke.entityId);

      // No daughter company in the Netherlands → registering a Dutch store is refused outright, rather
      // than quietly settling its parcels through Nairobi.
      expect(() => vendors.register({ name: 'Amsterdam Store', country: 'NL' })).toThrow(/No daughter company operates in NL/);
    });

    it('names the sister owed each node fee on a quote', () => {
      const ke = entities.requireForJurisdiction('KE');
      const origin = onboardAgent('Quote Origin', 'NorthTown', 50);
      const dest = onboardAgent('Quote Dest', 'SouthTown', 50);
      corridors.addCorridor({ name: 'N-S quote', originZone: 'NorthTown', destZone: 'SouthTown' });
      const quote = routing.quoteShipment(origin.did, dest.did, 'M');
      expect(quote.nodes.length).toBeGreaterThan(0);
      expect(quote.nodes.every((n) => n.entityId === ke.entityId)).toBe(true);
      expect(quote.entityIds).toEqual([ke.entityId]); // one company performs the whole domestic journey
    });

    it('contracts a FLEET as a supplier, in its country of incorporation', () => {
      const ke = entities.requireForJurisdiction('KE');
      const fleet = managers.register({ companyName: 'Entity Haulage', contactPhone: '+254800900', ownerFullName: 'O O', ownerNationalId: 'MGR-ENT', location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: 'BRN-ENT', transportOperatorLicence: 'TOL-ENT', taxId: 'TAX-ENT' } });
      expect(fleet.jurisdiction).toBe('KE');
      expect(fleet.entityId).toBe(ke.entityId);

      // A fleet incorporated where no sister operates cannot be paid, so it cannot be onboarded.
      expect(() =>
        managers.register({ companyName: 'Rotterdam Haulage', jurisdiction: 'NL', contactPhone: '+3180090', ownerFullName: 'N N', ownerNationalId: 'MGR-NL', location: { lat: 51.9, lng: 4.5 }, requirements: { businessRegistrationNo: 'BRN-NL', transportOperatorLicence: 'TOL-NL', taxId: 'TAX-NL' } }),
      ).toThrow(/No daughter company operates in NL/);
    });

    it('pays a fleet driver through their FLEET, and never asks where they live', () => {
      const ke = entities.requireForJurisdiction('KE');
      const fleet = managers.register({ companyName: 'Payroll Haulage', contactPhone: '+254800901', ownerFullName: 'P P', ownerNationalId: 'MGR-PAY', location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: 'BRN-PAY', transportOperatorLicence: 'TOL-PAY', taxId: 'TAX-PAY' } });
      managers.submitKyc(fleet.did, { businessRegCertRef: 'r.jpg', operatorLicenceRef: 'l.jpg', ownerIdRef: 'i.jpg', proofOfAddressRef: 'a.jpg' });
      managers.decideKyc(fleet.did, true);
      managers.recordBond(fleet.did);

      const employed = drivers.register({ displayName: 'Employed', fullName: 'E E', nationalId: 'DRV-EMP', mobile: '+254900901', licenceClasses: ['bike'], managerDid: fleet.did });
      // We move parcels; we do not do payroll. The network pays the fleet, so it never records where
      // the fleet's driver lives — the field is absent, not merely unused.
      expect(employed.jurisdiction).toBeUndefined();
      expect(employed.entityId).toBeUndefined();
      expect(drivers.isIndependent(employed)).toBe(false);
      expect(drivers.settlingEntityIdOf(employed)).toBe(ke.entityId); // via the fleet, as its supplier
    });

    it('pays an INDEPENDENT courier directly, settled where they legally reside', () => {
      const ke = entities.requireForJurisdiction('KE');
      const courier = drivers.register({ displayName: 'Solo', fullName: 'S S', nationalId: 'DRV-SOLO', mobile: '+254900902', licenceClasses: ['bike'] });
      expect(courier.jurisdiction).toBe('KE');
      expect(courier.entityId).toBe(ke.entityId);
      expect(drivers.isIndependent(courier)).toBe(true);
      expect(drivers.settlingEntityIdOf(courier)).toBe(ke.entityId);

      // A courier resident where no sister operates cannot be settled, so they cannot be onboarded —
      // which is also what makes the nomad currency rule structural rather than a policy to police.
      expect(() =>
        drivers.register({ displayName: 'Nomad', fullName: 'N N', nationalId: 'DRV-NOMAD', mobile: '+3190001', licenceClasses: ['bike'], jurisdiction: 'NL' }),
      ).toThrow(/No daughter company operates in NL/);
    });

    it('lets a sister set its OWN margin, and refuses an implausible one', () => {
      const ke = entities.requireForJurisdiction('KE');
      expect(entities.feePctOf(ke.entityId)).toBe(0.02); // the network default until a sister turns it

      entities.setFeePct(ke.entityId, 0.05);
      expect(entities.feePctOf(ke.entityId)).toBe(0.05);

      expect(() => entities.setFeePct(ke.entityId, 0.9)).toThrow(/between 0% and 25%/);
      expect(() => entities.setFeePct(ke.entityId, -0.01)).toThrow(/between 0% and 25%/);
      // The mother earns a licence fee, not a slice of parcels she is not a party to.
      expect(() => entities.setFeePct(entities.group().entityId, 0.03)).toThrow(/holding company/);
    });

    it('prices a quote at the sister’s rate, and LOCKS that rate to the parcel', () => {
      const origin = onboardAgent('Fee Origin', 'NorthTown', 50);
      const dest = onboardAgent('Fee Dest', 'SouthTown', 50);
      corridors.addCorridor({ name: 'N-S fee', originZone: 'NorthTown', destZone: 'SouthTown' });
      const ke = entities.requireForJurisdiction('KE');
      entities.setFeePct(ke.entityId, 0.10);

      const quote = routing.quoteShipment(origin.did, dest.did, 'M');
      expect(quote.platformFeePct).toBe(0.10);
      expect(quote.locked.total).toBeCloseTo(Math.round(quote.locked.base * 1.1 * 100) / 100, 2);

      const vendor = vendors.register({ name: 'Fee Store' });
      vendors.topUp(vendor.vendorId, 200);
      const { parcel } = parcels.createInbound({ vendorId: vendor.vendorId, externalOrderId: 'ORD-FEE', originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+254700', size: 'M', contentPhotoRef: 'c.jpg', shippingPolicy: vendor.shippingPolicy, quote });
      expect(parcel.platformFeePct).toBe(0.10);

      // The knob turns again mid-flight; the parcel keeps the rate it was quoted at.
      entities.setFeePct(ke.entityId, 0.02);
      expect(parcels.get(parcel.parcelId).platformFeePct).toBe(0.10);
      expect(parcels.get(parcel.parcelId).shipmentCost).toBe(parcel.shipmentCost);
    });

    it('never names the mother as a collector — she is not a party to customer transactions', () => {
      const group = entities.group();
      const origin = onboardAgent('Mother Origin', 'NorthTown', 50);
      onboardAgent('Mother Dest', 'SouthTown', 50);
      const p = parcels.accept({ agentDid: origin.did, parcelId: 'QR-MUM', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
      expect(p.collectingEntityId).not.toBe(group.entityId);
      expect(() => entities.requireTransacting(group.entityId)).toThrow(/holding company/);
    });
  });

  describe('the release secret never rides on the parcel', () => {
    /** Mint a paid inbound order and walk it to the destination shelf, ready to collect. */
    function readyInbound(tag: string) {
      const origin = onboardAgent(`Origin ${tag}`, 'NorthTown', 50);
      const dest = onboardAgent(`Dest ${tag}`, 'SouthTown', 50);
      const corridor = corridors.addCorridor({ name: `N-S ${tag}`, originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: `did:glos:d${tag}`, name: 'D', corridorId: corridor.corridorId });
      const vendor = vendors.register({ name: `Store ${tag}`, callbackUrl: `https://store-${tag}.example/hook`, secret: 'whsec' });
      vendors.topUp(vendor.vendorId, 50);
      const quote = routing.quoteShipment(origin.did, dest.did, 'M');
      const { parcel, label } = parcels.createInbound({ vendorId: vendor.vendorId, externalOrderId: `ORD-${tag}`, originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+254700', size: 'M', contentPhotoRef: 'content.jpg', shippingPolicy: vendor.shippingPolicy, quote });
      parcels.intakeInbound(parcel.parcelId, origin.did);
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcel.parcelId] });
      parcels.shelve(parcel.parcelId, dest.did);
      return { parcel, label, origin, dest, vendor };
    }

    it('prints the creation DATE and the public tracking key — never the collection code', () => {
      const { parcel, label } = readyInbound('LBL');
      const printed = parcels.labelFor(parcel.parcelId).svg;

      // The code that opens the parcel is not written on the parcel.
      expect(label!.svg).not.toContain(parcel.collectionCode);
      expect(printed).not.toContain(parcel.collectionCode);
      expect(printed).not.toContain('Collect at the shop with this code');
      // What it does carry: the public key (safe to print) and the day it was born.
      expect(printed).toContain(parcel.trackingKey);
      expect(printed).toContain(`Created ${labelDate(parcel.acceptedAt)}`);
      expect(labelDate(parcel.acceptedAt)).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
      // An unparseable stamp prints nothing rather than the word "Invalid" on a customer's parcel.
      expect(labelDate(undefined)).toBe('');
      expect(labelDate('not-a-date')).toBe('');
    });

    it('burns the collection code after repeated wrong tries, and a burned code opens nothing', () => {
      const { parcel, dest } = readyInbound('LOCK');
      const right = parcel.collectionCode!;

      for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
        expect(() => parcels.collectConfirm(parcel.parcelId, dest.did, 'COL-WRONG')).toThrow(/does not match/);
      }
      expect(() => parcels.collectConfirm(parcel.parcelId, dest.did, 'COL-WRONG')).toThrow(/Too many wrong codes/);

      // Burned: even the right code is refused, at the lookup as well as the confirm — the counter is
      // told to call the control tower instead of being walked to a step that cannot succeed.
      expect(() => parcels.collect(right, dest.did)).toThrow(/Too many wrong codes/);
      expect(() => parcels.collectConfirm(parcel.parcelId, dest.did, right)).toThrow(/Too many wrong codes/);
      expect(parcels.get(parcel.parcelId).status).toBe('Ready_For_Pickup'); // still on the shelf, not lost
    });

    it('an operator reissue ROTATES the code, unlocks the parcel, and leaves the old code dead', async () => {
      const flush = () => new Promise((r) => setImmediate(r));
      vendorCallback.onModuleInit();
      const { parcel, dest, vendor } = readyInbound('REISS');
      const old = parcel.collectionCode!;
      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        try { parcels.collectConfirm(parcel.parcelId, dest.did, 'COL-WRONG'); } catch { /* burning it */ }
      }

      const out = parcels.reissueRelease(parcel.parcelId, 'operator:ops-1');
      expect(out.kind).toBe('collection');
      expect(out.otp).toBeUndefined(); // the new code is NOT handed to the operator
      const fresh = parcels.get(parcel.parcelId).collectionCode!;
      expect(fresh).toMatch(/^COL-/);
      expect(fresh).not.toBe(old); // rotated, not merely unlocked — the burner's code must not come back

      // The old code is dead; the new one releases.
      expect(() => parcels.collect(old, dest.did)).toThrow(/No parcel awaiting collection/);
      expect(parcels.collect(fresh, dest.did).parcel.parcelId).toBe(parcel.parcelId);
      expect(parcels.collectConfirm(parcel.parcelId, dest.did, fresh).status).toBe('Delivered');

      // The store is re-told, with the ROTATED code, so it can reach a buyer who has no app.
      await flush();
      const ready = vendors.outboxFor(vendor.vendorId).filter((c) => c.event === 'ready_for_pickup');
      expect(ready.length).toBeGreaterThanOrEqual(2); // the arrival, then the reissue
      // The store must have been handed the ROTATED code (asserted by content, not by outbox order —
      // the two callbacks can land in the same millisecond). The old code appears once: the arrival
      // callback, correct when it was sent.
      expect(ready.filter((c) => c.body.includes(fresh))).toHaveLength(1);
      expect(ready.filter((c) => c.body.includes(old))).toHaveLength(1);
    });

    it('gives a peer-send code to the SENDER and RECEIVER at genesis — never to the shop that releases it', () => {
      const origin = onboardAgent('Genesis Origin', 'NorthTown', 50);
      const dest = onboardAgent('Genesis Dest', 'SouthTown', 50);
      const corridor = corridors.addCorridor({ name: 'N-S gen', originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: 'did:glos:dgen', name: 'D', corridorId: corridor.corridorId });
      const senderPhone = '+254700900001';
      const receiverPhone = '+254700900002';
      const accepted = parcels.accept({ agentDid: origin.did, parcelId: 'QR-GEN', size: 'S', destZone: 'SouthTown', destPudoDid: dest.did, senderMobile: senderPhone, receiverMobile: receiverPhone, dropoffPhotoRef: 'p.jpg' });

      // Born with the parcel, at the origin counter — not at the far end.
      expect(accepted.otp).toMatch(/^\d{4}$/);
      const code = accepted.otp!;

      // BOTH parties can read it from their own twin, from the moment of drop-off: the sender because they
      // are the free relay to a receiver with no smartphone, the receiver so they can travel knowing it.
      const rx = hashPhone(receiverPhone)!;
      const tx = hashPhone(senderPhone)!;
      expect(parcels.consumerParcel('QR-GEN', rx).collectToken).toEqual({ code, qrPayload: `sbg:collect:${code}` });
      expect(parcels.consumerParcel('QR-GEN', tx).collectToken).toEqual({ code, qrPayload: `sbg:collect:${code}` });
      // ...but never on the list surface, and never to a stranger.
      expect(parcels.forPhoneHash(rx).received.every((p) => !p.collectToken)).toBe(true);
      expect(() => parcels.consumerParcel('QR-GEN', hashPhone('+254700900009')!)).toThrow(/No such parcel/);

      // Arrival hands the destination shop a shelf slot and nothing else — no secret in the response.
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-GEN'] });
      const arrival = parcels.arrive('QR-GEN', dest.did);
      expect(arrival).not.toHaveProperty('otp');
      expect(arrival.binSlot).toBeTruthy();
      expect(releaseCodeOf('QR-GEN')).toBe(code); // arrival does NOT rotate what the parties already hold

      // The code the sender phoned through is the one that opens the parcel.
      expect(parcels.pickup('QR-GEN', dest.did, code, 'delivered.jpg').status).toBe('Delivered');
      // Terminal: the twin stops handing the code out once there is nothing left to release.
      expect(parcels.consumerParcel('QR-GEN', rx).collectToken).toBeUndefined();
    });

    it('reissues a peer-send OTP the same way (one recovery path for both release paths)', () => {
      const origin = onboardAgent('OTP Origin', 'NorthTown', 50);
      const dest = onboardAgent('OTP Dest', 'SouthTown', 50);
      const corridor = corridors.addCorridor({ name: 'N-S otp', originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: 'did:glos:dotp', name: 'D', corridorId: corridor.corridorId });
      parcels.accept({ agentDid: origin.did, parcelId: 'QR-REISS', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-REISS'] });
      const original = releaseCodeOf('QR-REISS');
      parcels.arrive('QR-REISS', dest.did);

      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        try { parcels.pickup('QR-REISS', dest.did, '0000'); } catch { /* burning it */ }
      }
      expect(() => parcels.pickup('QR-REISS', dest.did, original)).toThrow(/Too many wrong codes/);

      const out = parcels.reissueRelease('QR-REISS', 'operator:ops-1');
      expect(out.kind).toBe('otp');
      expect(out.otp).toMatch(/^\d{4}$/); // to the OPERATOR, who phones the sender — never to the shop
      expect(out.otp).not.toBe(original);
      expect(() => parcels.pickup('QR-REISS', dest.did, original)).toThrow(/Incorrect OTP/); // the old one is dead
      expect(parcels.pickup('QR-REISS', dest.did, out.otp!, 'delivered.jpg').status).toBe('Delivered');
    });
  });

  it('quotes from open-data rates, gates on prepaid, derives size, then rebates the flexible over-hold on delivery', () => {
    const origin = onboardAgent('Origin PUDO', 'NorthTown', 50);
    const dest = onboardAgent('Dest PUDO', 'SouthTown', 50);
    agents.setPrice(origin.did, 0.5);
    agents.setPrice(dest.did, 0.5);
    const corridor = corridors.addCorridor({ name: 'N-S', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:dq', name: 'D', corridorId: corridor.corridorId });
    const vendor = vendors.register({ name: 'Quote Co', location: { lat: -1.28, lng: 36.82 }, shippingPolicy: { mode: 'capped', freeOverSubtotal: 50, buyerContributionCap: 3 } });

    // Buyer picks the destination PUDO at checkout → handoff captured (no dropdown on the vendor side).
    const handoff = vendors.captureCheckout({ vendorId: vendor.vendorId, destAgentDid: dest.did, buyerEmail: 'buyer@example.com', externalOrderId: 'WEB-1', subtotal: 20, source: 'node' });
    expect(vendors.checkoutsFor(vendor.vendorId).map((c) => c.id)).toContain(handoff.id);

    // Open-data quote: node fees (origin 0.5 + dest 0.5) + transport + 2%; flexible ≥ locked.
    const quote = routing.quoteShipment(origin.did, dest.did, 'M');
    expect(quote.nodeFees).toBeCloseTo(1.0);
    expect(quote.flexible.total).toBeGreaterThanOrEqual(quote.locked.total);
    expect(quote.flexible.total).toBeCloseTo(Math.round(quote.flexible.base * 1.02 * 100) / 100);

    // Unpaid vendor (balance 0) → mint yields an UNPAID parcel, label withheld, intake refused.
    const unpaid = parcels.createInbound({ vendorId: vendor.vendorId, externalOrderId: handoff.externalOrderId, originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+254700', buyerEmail: handoff.buyerEmail, dimensionsCm: { l: 40, w: 30, h: 20 }, weightKg: 4, contentPhotoRef: 'content.jpg', subtotal: handoff.subtotal, shippingPolicy: vendor.shippingPolicy, routeMode: 'flexible', quote });
    expect(unpaid.paid).toBe(false);
    expect(unpaid.label).toBeNull();
    expect(unpaid.parcel.size).toBe('M');
    expect(unpaid.parcel.paidStatus).toBe('unpaid');
    expect(() => parcels.intakeInbound(unpaid.parcel.parcelId, origin.did)).toThrow();

    // Prepay → settle → ParcelPaid + label issues; buyer-charge is reported (capped, subtotal 20 < 50).
    vendors.topUp(vendor.vendorId, 50);
    const settled = parcels.settleUnpaid(unpaid.parcel.parcelId);
    const parcel = settled.parcel;
    expect(settled.paid).toBe(true);
    expect(settled.label!.svg).toContain('<svg');
    expect(parcel.paidStatus).toBe('ParcelPaid');
    expect(parcel.routeMode).toBe('flexible');
    expect(parcel.buyerCharge).toBeCloseTo(Math.min(3, parcel.shipmentCost!));
    vendors.consumeCheckout(handoff.id, parcel.parcelId);
    expect(vendors.checkoutsFor(vendor.vendorId)).toHaveLength(0);
    expect(vendors.settlementsFor(vendor.vendorId).some((s) => s.type === 'BILLING' && s.parcelId === parcel.parcelId)).toBe(true);

    // Move + deliver → the flexible over-hold (ceiling − actual) is rebated to the vendor's balance.
    const balBefore = vendors.balanceOf(vendor.vendorId);
    parcels.intakeInbound(parcel.parcelId, origin.did);
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcel.parcelId] });
    parcels.shelve(parcel.parcelId, dest.did);
    parcels.collectConfirm(parcel.parcelId, dest.did, parcel.collectionCode!);
    expect(parcel.rebate).toBeGreaterThanOrEqual(0);
    expect(vendors.balanceOf(vendor.vendorId)).toBeCloseTo(Math.round((balBefore + (parcel.rebate ?? 0)) * 100) / 100);

    // O2 audit (S22): the public track carries status + coarse location ONLY — no PII, no handover
    // secret, no vendor order id. Steps expose status + time; the raw operator note (which carried the
    // externalOrderId) is never on this surface.
    const view = parcels.track(parcel.trackingKey!);
    expect(view.steps.length).toBeGreaterThan(0);
    const json = JSON.stringify(view);
    expect(json).not.toContain(parcel.collectionCode); // handover secret
    expect(json).not.toContain('WEB-1'); // vendor externalOrderId (previously leaked via the step note)
    expect(json).not.toContain('buyer@example.com'); // buyer email
    expect(json).not.toContain('+254700'); // buyer mobile
    expect(view.steps.every((s) => !('note' in s))).toBe(true);
  });

  it('S22 — the receiver gets an in-app collection token (QR + typed code) only when it is theirs to collect', () => {
    const origin = onboardAgent('S22 Origin', 'NorthTown', 50);
    const dest = onboardAgent('S22 Dest', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'S22', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:s22', name: 'D', corridorId: corridor.corridorId });
    const vendor = vendors.register({ name: 'S22 Co' });
    vendors.topUp(vendor.vendorId, 50);
    const buyer = '+254700900500';
    const { parcel } = parcels.createInbound({ vendorId: vendor.vendorId, externalOrderId: 'ORD-S22', originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: buyer, size: 'M', contentPhotoRef: 'content.jpg', shippingPolicy: vendor.shippingPolicy, quote: routing.quoteShipment(origin.did, dest.did, 'M') });
    const rx = hashPhone(buyer);

    // Before it is collectable there is no token, even for the receiver.
    parcels.intakeInbound(parcel.parcelId, origin.did);
    expect(parcels.consumerParcel(parcel.parcelId, rx).collectToken).toBeUndefined();

    // Shelved → Ready_For_Pickup: the receiver's DETAIL view now carries the QR + the typed COL code.
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcel.parcelId] });
    parcels.shelve(parcel.parcelId, dest.did);
    const twin = parcels.consumerParcel(parcel.parcelId, rx);
    expect(twin.relation).toBe('received');
    expect(twin.collectToken).toEqual({ code: parcel.collectionCode, qrPayload: `sbg:collect:${parcel.collectionCode}` });

    // Exposure minimised: the token is NOT in the list view — only the owner-scoped detail carries it.
    expect(parcels.forPhoneHash(rx).received[0].collectToken).toBeUndefined();
  });

  it('S23 — the receiver files a delivery dispute + PoD from their app; routed to the vendor + the control tower', async () => {
    const flush = () => new Promise((r) => setImmediate(r));
    vendorCallback.onModuleInit();
    const origin = onboardAgent('S23 Origin', 'NorthTown', 50);
    const dest = onboardAgent('S23 Dest', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'S23', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:s23d', name: 'D', corridorId: corridor.corridorId });
    const vendor = vendors.register({ name: 'S23 Store', callbackUrl: 'https://s23.example/hook', secret: 'whsec23' });
    vendors.topUp(vendor.vendorId, 50);
    const buyer = '+254700930500';
    const { parcel } = parcels.createInbound({ vendorId: vendor.vendorId, externalOrderId: 'ORD-S23', originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: buyer, size: 'M', contentPhotoRef: 'content.jpg', shippingPolicy: vendor.shippingPolicy, quote: routing.quoteShipment(origin.did, dest.did, 'M') });
    parcels.intakeInbound(parcel.parcelId, origin.did);
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcel.parcelId] });
    parcels.shelve(parcel.parcelId, dest.did);
    parcels.collectConfirm(parcel.parcelId, dest.did, parcel.collectionCode!);
    await flush();
    const rx = hashPhone(buyer);
    const me = persons.ensurePerson(buyer).personDid;
    expect(parcels.get(parcel.parcelId).status).toBe('Delivered');

    // Proactive PoD: the receiver photographs what they got — kept alongside the agent's photos.
    expect(parcels.attachPod(parcel.parcelId, rx, me, 'my-photo.jpg').podPhotoRef).toBe('my-photo.jpg');

    // Guards: a non-receiver gets a 404 (existence not confirmed); a reason + photo are mandatory.
    expect(() => parcels.buyerDispute(parcel.parcelId, hashPhone('+254700999999'), 'x', 'r', 'p.jpg')).toThrow(/No such parcel/);
    expect(() => parcels.buyerDispute(parcel.parcelId, rx, me, '', 'p.jpg')).toThrow(/reason and a photo/);

    // File the dispute → Disputed, buyer reason retained.
    const disputed = parcels.buyerDispute(parcel.parcelId, rx, me, 'Wrong item inside', 'proof.jpg');
    expect(disputed.status).toBe('Disputed');
    expect(disputed.disputeReason).toBe('Wrong item inside');
    // Both photos survive: the PoD (what arrived) AND the dispute evidence (the problem) — distinct homes.
    expect(disputed.podPhotoRef).toBe('my-photo.jpg');
    expect(disputed.disputePhotoRef).toBe('proof.jpg');
    await flush();

    // O3 routing: the VENDOR got an HMAC 'disputed' callback...
    expect(vendors.outboxFor(vendor.vendorId).map((c) => c.event)).toContain('disputed');
    // ...AND the control tower shows a Buyer_Dispute flag naming the origin.
    const flag = monitor.flags().find((f) => f.type === 'Buyer_Dispute' && f.subject === parcel.parcelId);
    expect(flag).toBeDefined();
    expect(flag!.detail).toContain('vendor order');

    // A delivered parcel is required — you cannot dispute one still in flight (or twice).
    expect(() => parcels.buyerDispute(parcel.parcelId, rx, me, 'again', 'p.jpg')).toThrow(/once the parcel is delivered/);
  });

  it('S23 — a peer-send dispute never leaks the buyer reason or photos to the sender counterparty', () => {
    const origin = onboardAgent('Peer Origin', 'NorthTown', 50);
    const dest = onboardAgent('Peer Dest', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'Peer', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:peer', name: 'D', corridorId: corridor.corridorId });
    const sender = '+254700940001';
    const receiver = '+254700940002';
    // Walk-up peer send: sender drops it, it rides the bus, arrives, the receiver collects with the OTP.
    parcels.accept({ agentDid: origin.did, parcelId: 'PEER-1', size: 'M', destZone: 'SouthTown', destPudoDid: dest.did, senderMobile: sender, receiverMobile: receiver, dropoffPhotoRef: 'drop.jpg', paymentMode: 'cash' });
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['PEER-1'] });
    parcels.arrive('PEER-1', dest.did);
    const otp = releaseCodeOf('PEER-1');
    parcels.pickup('PEER-1', dest.did, otp);
    expect(parcels.get('PEER-1').status).toBe('Delivered');

    const rxHash = hashPhone(receiver);
    const sndHash = hashPhone(sender);
    parcels.buyerDispute('PEER-1', rxHash, 'did:glos:person:x', 'call me at 14 Acacia Rd 0712345678', 'damage.jpg');

    // The RECEIVER (who wrote it) sees their reason + evidence.
    const mine = parcels.consumerParcel('PEER-1', rxHash);
    expect(mine.relation).toBe('received');
    expect(mine.disputeReason).toContain('Acacia');
    expect(mine.disputePhotoRef).toBe('damage.jpg');

    // The SENDER sees the status flip to Disputed — but NOT the buyer's free-text reason, photos, or a
    // timeline note carrying the reason (it was addressed to the control tower, not the counterparty).
    const theirs = parcels.consumerParcel('PEER-1', sndHash);
    expect(theirs.relation).toBe('sent');
    expect(theirs.status).toBe('Disputed');
    expect(theirs.disputeReason).toBeUndefined();
    expect(theirs.disputePhotoRef).toBeUndefined();
    expect(theirs.podPhotoRef).toBeUndefined();
    expect(JSON.stringify(theirs)).not.toContain('Acacia');
  });

  it('files a dispute with mandatory photo proof at collection (notifies the vendor)', async () => {
    const flush = () => new Promise((r) => setImmediate(r));
    vendorCallback.onModuleInit();
    const origin = onboardAgent('O', 'NorthTown', 50);
    const dest = onboardAgent('D', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'C', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:dx', name: 'D', corridorId: corridor.corridorId });
    const vendor = vendors.register({ name: 'V', callbackUrl: 'https://v.example/hook' });
    vendors.topUp(vendor.vendorId, 50);
    const { parcel } = parcels.createInbound({ vendorId: vendor.vendorId, originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+1', size: 'S', contentPhotoRef: 'content.jpg', shippingPolicy: vendor.shippingPolicy, quote: routing.quoteShipment(origin.did, dest.did, 'S') });
    parcels.intakeInbound(parcel.parcelId, origin.did);
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcel.parcelId] });
    parcels.shelve(parcel.parcelId, dest.did);

    expect(() => parcels.dispute(parcel.parcelId, dest.did, 'damaged', '')).toThrow(); // photo proof mandatory
    const disputed = parcels.dispute(parcel.parcelId, dest.did, 'box crushed', 'proof.jpg');
    expect(disputed.status).toBe('Disputed');
    await flush();
    expect(vendors.outboxFor(vendor.vendorId).some((c) => c.event === 'disputed')).toBe(true);
  });

  it('enforces tote-bag capacity: 10 mediums, 50 letters + 1 medium, and a heavy fills a bag alone (Ch 17)', () => {
    const hub = mdps.register({ name: 'Cap MDP', zones: ['SouthTown'], location: { lat: -1.25, lng: 36.85 } });

    // 10 mediums fill a bag; the 11th is rejected.
    const t1 = mdps.registerTote(hub.mdpId);
    totes.assign(t1.code, 'dest-1', 'Dest 1');
    for (let i = 0; i < 10; i += 1) totes.add(t1.code, `M-${i}`, 'M');
    expect(() => totes.add(t1.code, 'M-11', 'M')).toThrow(/full/);

    // 50 letters + 1 medium = exactly full.
    const t2 = mdps.registerTote(hub.mdpId);
    totes.assign(t2.code, 'dest-1', 'Dest 1');
    for (let i = 0; i < 50; i += 1) totes.add(t2.code, `S-${i}`, 'S');
    totes.add(t2.code, 'M-x', 'M');
    expect(() => totes.add(t2.code, 'S-51', 'S')).toThrow(/full/);

    // A >20 kg heavy parcel fills a bag on its own — nothing shares with it.
    const t3 = mdps.registerTote(hub.mdpId);
    totes.assign(t3.code, 'dest-1', 'Dest 1');
    totes.add(t3.code, 'H-1', 'HEAVY');
    expect(() => totes.add(t3.code, 'S-1', 'S')).toThrow(/full/);
    const t4 = mdps.registerTote(hub.mdpId);
    totes.assign(t4.code, 'dest-1', 'Dest 1');
    totes.add(t4.code, 'M-0', 'M');
    expect(() => totes.add(t4.code, 'H-2', 'HEAVY')).toThrow(/full/); // a heavy needs an empty bag
  });

  it('routes a journey through an MDP hub (PUDO → MDP → PUDO) when a hub covers the zones', () => {
    const origin = onboardAgent('Hub Origin', 'NorthTown', 50);
    const dest = onboardAgent('Hub Dest', 'SouthTown', 50);
    mdps.register({ name: 'Central MDP', zones: ['NorthTown', 'SouthTown'], location: { lat: -1.25, lng: 36.85 } });

    const plan = routing.planJourney({ originAgentDid: origin.did, destAgentDid: dest.did, weightKg: 5 });
    expect(plan.mdpRouted).toBe(true);
    expect(plan.hops.map((h) => h.type)).toEqual(['pudo', 'mdp', 'pudo']); // one shared hub
    expect(plan.legs).toHaveLength(2);
    expect(plan.legs[0].legType).toBe('to_mdp');
    expect(plan.legs[1].legType).toBe('last_mile');
    expect(new Date(plan.pickupReadyAt).getTime()).toBeGreaterThanOrEqual(new Date(plan.transitArrivalAt).getTime());
  });

  it('runs the MDP tote-bag flow: pack → bus scans the bag → drop+empty → sort each parcel → re-bag', async () => {
    const flush = () => new Promise((r) => setImmediate(r));
    twin.onModuleInit();
    graduation.onModuleInit();
    const origin = onboardAgent('Pack Origin', 'NorthTown', 50);
    const dest = onboardAgent('Pack Dest', 'SouthTown', 50);
    const hub = mdps.register({ name: 'Central MDP', zones: ['SouthTown'], location: { lat: -1.25, lng: 36.85 } });
    const vendor = vendors.register({ name: 'ShopX' });

    // Three inbound parcels destined for the SouthTown PUDO, intaken at the origin.
    vendors.topUp(vendor.vendorId, 50);
    const packQuote = routing.quoteShipment(origin.did, dest.did, 'M');
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { parcel } = parcels.createInbound({ vendorId: vendor.vendorId, originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: `+2547${i}`, size: 'M', contentPhotoRef: 'content.jpg', shippingPolicy: vendor.shippingPolicy, quote: packQuote });
      parcels.intakeInbound(parcel.parcelId, origin.did);
      ids.push(parcel.parcelId);
    }

    // Origin packs a bag toward the hub; the driver scans the BAG (one scan moves every parcel).
    const bag = totes.register(origin.did);
    totes.assign(bag.code, hub.mdpId, hub.name);
    ids.forEach((id) => mdps.fillTote(bag.code, id));
    const loaded = mdps.loadBag(bag.code, 'BUS-1');
    expect(loaded.moved).toHaveLength(3);
    ids.forEach((id) => expect(parcels.get(id).status).toBe('On_Bus'));

    // Bus drops the bag at the MDP → scan the code, empty it; parcels become unsorted (At_MDP), tote freed.
    const dropped = mdps.dropBag(hub.mdpId, bag.code);
    expect(dropped.emptied).toHaveLength(3);
    ids.forEach((id) => expect(parcels.get(id).status).toBe('At_MDP'));
    expect(totes.requireByCode(bag.code).status).toBe('free');

    // Worker scans each parcel → system returns the next destination + the destination bag code.
    const sort0 = mdps.sortParcel(hub.mdpId, ids[0]);
    expect(sort0.nextDestination.type).toBe('pudo'); // this hub serves the dest zone → last mile
    expect(sort0.nextDestination.id).toBe(dest.did);
    const sort1 = mdps.sortParcel(hub.mdpId, ids[1]);
    expect(sort1.toteCode).toBe(sort0.toteCode); // same destination → same bag
    mdps.sortParcel(hub.mdpId, ids[2]);
    expect(totes.requireByCode(sort0.toteCode).parcels).toHaveLength(3);
    await flush();
    expect(twin.shipment(ids[0])?.props.hub).toBe('Central MDP'); // multi-hop visible on the twin

    // Onward bus scans the destination bag away — one scan, all three parcels move.
    const onward = mdps.loadBag(sort0.toteCode, 'BUS-2');
    expect(onward.moved).toHaveLength(3);
    ids.forEach((id) => expect(parcels.get(id).status).toBe('On_Bus'));
  });

  // --- S31: cargo enforcement on the multi-hop tote/MDP path (+ the dispatch marketplace) ---

  it('S31: fillTote refuses to drop incompatible cargo into the same bag', () => {
    const origin = onboardAgent('Fill Origin', 'NorthTown', 50);
    const dest = onboardAgent('Fill Dest', 'NorthTown', 50); // same zone → a local quote needs no corridor
    const vendor = vendors.register({ name: 'FillCo' });
    vendors.topUp(vendor.vendorId, 50);
    const quote = routing.quoteShipment(origin.did, dest.did, 'M');
    const mk = (nature: 'HAZ-DUST' | 'FOP', mob: string) => {
      const p = parcels.createInbound({ vendorId: vendor.vendorId, originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: mob, size: 'M', contentPhotoRef: 'c.jpg', natureCode: nature, shippingPolicy: vendor.shippingPolicy, quote }).parcel;
      parcels.intakeInbound(p.parcelId, origin.did);
      return p.parcelId;
    };
    const dust = mk('HAZ-DUST', '+254700001');
    const fop = mk('FOP', '+254700002');
    const bag = totes.register(origin.did);
    totes.assign(bag.code, dest.did, 'Dest');
    mdps.fillTote(bag.code, dust); // cement goes in first
    expect(() => mdps.fillTote(bag.code, fop)).toThrow(/incompatible/i); // fresh produce is refused
    expect(totes.requireByCode(bag.code).parcels).toEqual([dust]); // the bag is unchanged
  });

  it('S31: sortParcel never co-totes incompatible cargo — it opens a fresh bag instead', () => {
    const origin = onboardAgent('Sort Origin', 'NorthTown', 50);
    const dest = onboardAgent('Sort Dest', 'SouthTown', 50);
    const hub = mdps.register({ name: 'Sort MDP', zones: ['SouthTown'], location: { lat: -1.25, lng: 36.85 } });
    const vendor = vendors.register({ name: 'SortCo' });
    vendors.topUp(vendor.vendorId, 50);
    const quote = routing.quoteShipment(origin.did, dest.did, 'M');
    const toMdp = (nature: 'HAZ-DUST' | 'FOP', mob: string) => {
      const p = parcels.createInbound({ vendorId: vendor.vendorId, originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: mob, size: 'M', contentPhotoRef: 'c.jpg', natureCode: nature, shippingPolicy: vendor.shippingPolicy, quote }).parcel;
      parcels.intakeInbound(p.parcelId, origin.did);
      // each rides its OWN first-leg bag to the hub (they can't share), then lands At_MDP
      const b = totes.register(origin.did);
      totes.assign(b.code, hub.mdpId, hub.name);
      mdps.fillTote(b.code, p.parcelId);
      mdps.loadBag(b.code, 'BUS-1');
      mdps.dropBag(hub.mdpId, b.code);
      return p.parcelId;
    };
    const dust = toMdp('HAZ-DUST', '+254700003');
    const fop = toMdp('FOP', '+254700004');

    // Both are bound for the same PUDO, but sorting must land them in DIFFERENT bags.
    const sDust = mdps.sortParcel(hub.mdpId, dust);
    const sFop = mdps.sortParcel(hub.mdpId, fop);
    expect(sDust.nextDestination.id).toBe(dest.did);
    expect(sFop.nextDestination.id).toBe(dest.did); // same next hop…
    expect(sFop.toteCode).not.toBe(sDust.toteCode); // …yet never the same bag
  });

  it('S31: loadBag refuses a perishable bag onto a vehicle with no cold chain', () => {
    const origin = onboardAgent('Bag Origin', 'NorthTown', 50);
    const corridor = corridors.addCorridor({ name: 'bag', originZone: 'NorthTown', destZone: 'SouthTown' });
    const d = drivers.register({ displayName: 'Feeder', fullName: 'F F', nationalId: 'DRV-ID-BAG', mobile: '+254900077', licenceClasses: ['bike'] });
    const bike = vehicles.register({ plate: 'BG-1', vehicleClass: 'bike', ownerName: 'F F' }); // no reefer → coldChain false
    fleet.couple(d.did, bike.vehicleId, corridor.corridorId);
    parcels.accept({ agentDid: origin.did, parcelId: 'FISH-BAG', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', natureCode: 'FOP' });
    const bag = totes.register(origin.did);
    totes.assign(bag.code, 'dest-node', 'Dest');
    mdps.fillTote(bag.code, 'FISH-BAG');
    expect(() => mdps.loadBag(bag.code, d.badgeId!)).toThrow(/coldChain/); // the whole bag is refused
    expect(parcels.get('FISH-BAG').status).not.toBe('On_Bus'); // nothing moved
  });

  it('S31: the dispatch marketplace does not offer a perishable tote to a vehicle lacking cold chain', () => {
    const origin = onboardAgent('Disp Origin', 'NorthTown', 50);
    const d = drivers.register({ displayName: 'Disp', fullName: 'D D', nationalId: 'DRV-ID-DISP', mobile: '+254900088', licenceClasses: ['bike'] });
    const bike = vehicles.register({ plate: 'DP-1', vehicleClass: 'bike', ownerName: 'D D' });
    fleet.couple(d.did, bike.vehicleId);
    // A GEN control tote + an FOP tote, both waiting at the origin on the bike's route.
    parcels.accept({ agentDid: origin.did, parcelId: 'GEN-DISP', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', natureCode: 'GEN' });
    parcels.accept({ agentDid: origin.did, parcelId: 'FOP-DISP', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', natureCode: 'FOP' });
    const genBag = totes.register(origin.did); totes.assign(genBag.code, 'dn', 'Dest'); mdps.fillTote(genBag.code, 'GEN-DISP'); dispatch.release(genBag.code);
    const fopBag = totes.register(origin.did); totes.assign(fopBag.code, 'dn', 'Dest'); mdps.fillTote(fopBag.code, 'FOP-DISP'); dispatch.release(fopBag.code);

    const offers = dispatch.suggest(d.did, { from: origin.location, to: { lat: -1.3, lng: 36.95 } });
    const refs = offers.map((o) => o.ref);
    expect(refs).toContain(genBag.code); // the general tote is offered…
    expect(refs).not.toContain(fopBag.code); // …but the perishable one is filtered out
  });

  it('S31: claim() re-checks capability — re-coupling to an incapable vehicle cannot reserve a cold tote', () => {
    const origin = onboardAgent('Claim Origin', 'NorthTown', 50);
    // A heavy driver, activated via KYC and licence-cleared for trucks (so they can couple to either truck).
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const d = drivers.register({ displayName: 'Reefer', fullName: 'R R', nationalId: 'DRV-ID-CLAIM', mobile: '+254900099', licenceClasses: ['truck'], licenceNumber: 'L-CLAIM', licenceExpiresAt: future, criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'id.jpg', licenceCopyRef: 'lic.jpg' });
    drivers.decideKyc(d.did, true, 'ops');
    const reefer = vehicles.register({ plate: 'RF-1', vehicleClass: 'truck', truckSubtype: 'refrigerated', ownerName: 'R R' }); // coldChain true
    const plain = vehicles.register({ plate: 'PL-1', vehicleClass: 'truck', truckSubtype: 'flatbed', ownerName: 'R R' }); // coldChain false
    parcels.accept({ agentDid: origin.did, parcelId: 'FOP-CLAIM', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', natureCode: 'FOP' });
    const bag = totes.register(origin.did); totes.assign(bag.code, 'dn', 'Dest'); mdps.fillTote(bag.code, 'FOP-CLAIM'); dispatch.release(bag.code);

    // Coupled to the reefer, the perishable tote IS offered.
    fleet.couple(d.did, reefer.vehicleId);
    const [offer] = dispatch.suggest(d.did, { from: origin.location, to: { lat: -1.3, lng: 36.95 } });
    expect(offer?.ref).toBe(bag.code);
    // Re-couple to a non-cold truck, then try to claim the still-pending offer → refused, tote stays available.
    fleet.uncouple(d.did);
    fleet.couple(d.did, plain.vehicleId);
    expect(() => dispatch.claim(offer.offerId)).toThrow(/capability|coldChain/i);
    expect(totes.requireByCode(bag.code).status).toBe('available'); // never reserved to an incapable driver
    expect(totes.requireByCode(bag.code).claimedBy).toBeUndefined();
  });

  it('onboards a bike courier on the light registry — ACTIVE immediately with a badge (Ch 19)', () => {
    const d = drivers.register({ displayName: 'Boda J.', fullName: 'James K', nationalId: 'DRV-ID-1', mobile: '+254900001', licenceClasses: ['bike'] });
    expect(d.registry).toBe('light');
    expect(d.status).toBe('ACTIVE'); // no KYC gate for a bike
    expect(d.badgeId).toMatch(/^DRV-/);
    expect(drivers.canOperate(d.did)).toBe(true);
  });

  it('requires full KYC + a valid licence for a heavy-registry driver (Ch 19)', () => {
    expect(() => drivers.register({ displayName: 'T', fullName: 'Tom', nationalId: 'DRV-ID-2', mobile: '+254900002', licenceClasses: ['truck'] })).toThrow(/licence number/);
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(() => drivers.register({ displayName: 'T', fullName: 'Tom', nationalId: 'DRV-ID-2', mobile: '+254900002', licenceClasses: ['truck'], licenceNumber: 'L-1', licenceExpiresAt: past })).toThrow(/expired/);
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const d = drivers.register({ displayName: 'Tom', fullName: 'Tom', nationalId: 'DRV-ID-2', mobile: '+254900002', licenceClasses: ['truck'], licenceNumber: 'L-1', licenceExpiresAt: future, criminalRecordClear: true });
    expect(d.registry).toBe('heavy');
    expect(d.status).toBe('DRAFT'); // not active until vetted
    expect(d.badgeId).toBeUndefined();
    drivers.submitKyc(d.did, { idCopyRef: 'id.jpg', licenceCopyRef: 'lic.jpg' });
    expect(drivers.get(d.did).status).toBe('KYC_PENDING');
    drivers.decideKyc(d.did, true, 'ops');
    expect(drivers.get(d.did).status).toBe('ACTIVE');
    expect(drivers.get(d.did).badgeId).toMatch(/^DRV-/);
  });

  it('registers vehicles with system-computed capacity + a verified (priority) flag from docs', () => {
    const bike = vehicles.register({ plate: 'BIKE-1', vehicleClass: 'bike', ownerName: 'James' });
    expect(bike.capacityKg).toBe(20); // light class is fixed
    expect(bike.allowsFragile).toBe(false);
    expect(bike.verified).toBe(false);
    expect(() => vehicles.register({ plate: 'T-1', vehicleClass: 'truck', ownerName: 'X' })).toThrow(/sub-type/);
    const truck = vehicles.register({ plate: 't-1', vehicleClass: 'truck', truckSubtype: 'refrigerated', capacityKg: 12_000, ownerName: 'Fleet Co', ownerType: 'fleet_owned', documents: { registrationPhotoRef: 'reg.jpg', factoryId: 'VIN-123' } });
    expect(truck.plate).toBe('T-1');
    expect(truck.capacityKg).toBe(12_000);
    expect(truck.coldChain).toBe(true);
    expect(truck.carriesBulk).toBe(true);
    expect(truck.verified).toBe(true); // full registration + factory ID
  });

  it('onboards a fleet manager through its own filter → KYC → vetting → bond → ACTIVE (Ch 19)', () => {
    const base = { companyName: 'Acme Haulage', contactPhone: '+254800001', ownerFullName: 'A Owner', ownerNationalId: 'MGR-1', location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: 'BRN-1', transportOperatorLicence: 'TOL-1', taxId: 'TAX-1' } };
    // Eligibility filter
    expect(() => managers.register({ ...base, requirements: { ...base.requirements, transportOperatorLicence: '' } })).toThrow(/operator licence/);
    expect(() => managers.register({ ...base, location: undefined, depotAddress: undefined as never })).toThrow(/depot/);

    const m = managers.register(base);
    expect(m.status).toBe('DRAFT');
    expect(JSON.stringify(core.get(m.did))).not.toContain('A Owner'); // PII vaulted, not in the core
    // Dedup
    expect(() => managers.register({ ...base, contactPhone: '+254X' })).toThrow(/business registration/);

    expect(() => managers.recordBond(m.did)).toThrow(/APPROVED/); // bond only after approval
    expect(managers.submitKyc(m.did, { businessRegCertRef: 'r.pdf', operatorLicenceRef: 'l.pdf', ownerIdRef: 'id.jpg', proofOfAddressRef: 'a.pdf' }).status).toBe('KYC_PENDING');
    expect(managers.decideKyc(m.did, true, 'ops').status).toBe('APPROVED');
    const activated = managers.recordBond(m.did);
    expect(activated.status).toBe('ACTIVE');
    expect(managers.isActive(m.did)).toBe(true);
    expect(events.getLog().some((e) => e.type === GlosEvent.Pudo.FleetManagerActivated)).toBe(true);

    // Console sign-in: a login code is issued at activation; it resolves the manager, gibberish does not.
    expect(activated.loginCode).toMatch(/^FM-/);
    expect(managers.login(activated.loginCode!).did).toBe(m.did);
    expect(() => managers.login('FM-NOPE')).toThrow(/sign-in code/);
  });

  it('only an ACTIVE fleet manager may register vehicles + drivers, and the dashboard scopes to them', () => {
    const reg = (n: string) => managers.register({ companyName: `Co${n}`, contactPhone: `+2548000${n}`, ownerFullName: `O${n}`, ownerNationalId: `MGR-${n}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-${n}`, transportOperatorLicence: `TOL-${n}`, taxId: `TAX-${n}` } });
    const activate = (did: string) => { managers.submitKyc(did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'a' }); managers.decideKyc(did, true); managers.recordBond(did); };
    const a = reg('A'); const b = reg('B');

    // A DRAFT manager cannot build a fleet yet.
    expect(() => vehicles.register({ plate: 'X-1', vehicleClass: 'van', ownerName: 'O', managerDid: a.did })).toThrow(/must be ACTIVE/);
    activate(a.did); activate(b.did);

    const vA = vehicles.register({ plate: 'AV-1', vehicleClass: 'motorcycle', ownerName: 'OA', managerDid: a.did });
    const dA = drivers.register({ displayName: 'DA', fullName: 'Da', nationalId: 'DRV-MA', mobile: '+254ma', licenceClasses: ['motorcycle'], managerDid: a.did });
    vehicles.register({ plate: 'BV-1', vehicleClass: 'van', ownerName: 'OB', managerDid: b.did });
    fleet.startSession(dA.did, vA.qr);

    const dashA = fleet.overview(a.did);
    expect(dashA.vehicles.total).toBe(1); // only A's vehicle
    expect(dashA.drivers.total).toBe(1);
    expect(dashA.sessions.active).toBe(1);
    const dashB = fleet.overview(b.did);
    expect(dashB.vehicles.total).toBe(1);
    expect(dashB.sessions.active).toBe(0); // B has no driver on shift
  });

  it('registers trucks from the extensive sub-type catalog with computed capacity + capabilities', () => {
    const reefer = vehicles.register({ plate: 'R-1', vehicleClass: 'truck', truckSubtype: 'refrigerated', ownerName: 'X' });
    expect(reefer.coldChain).toBe(true);
    expect(reefer.capacityKg).toBe(9000); // sub-type default
    const fuel = vehicles.register({ plate: 'F-1', vehicleClass: 'truck', truckSubtype: 'fuel_tanker', ownerName: 'X' });
    expect(fuel.liquid && fuel.hazmat).toBe(true);
    const lowboy = vehicles.register({ plate: 'L-1', vehicleClass: 'truck', truckSubtype: 'lowboy', ownerName: 'X' });
    expect(lowboy.oversized).toBe(true);
    expect(lowboy.capacityKg).toBe(40_000);
    expect(vehicles.register({ plate: 'TP-1', vehicleClass: 'truck', truckSubtype: 'tipper', ownerName: 'X' }).carriesBulk).toBe(true);
  });

  it('rolls up the fleet dashboard: sessions + working hours + live positions + active cargo', () => {
    const origin = onboardAgent('Dash Feeder', 'NorthTown', 50);
    const mdp = mdps.register({ name: 'Hub', zones: ['SouthTown'], location: { lat: -1.25, lng: 36.85 } });
    const d = drivers.register({ displayName: 'Dora', fullName: 'Do', nationalId: 'FD-1', mobile: '+254fd1', licenceClasses: ['motorcycle'] });
    const moto = vehicles.register({ plate: 'FD-1', vehicleClass: 'motorcycle', ownerName: 'Do' });
    fleet.startSession(d.did, moto.qr);
    fleet.reportLocation(d.did, { lat: -1.2, lng: 36.8 });

    const bag = totes.register(origin.did);
    totes.assign(bag.code, mdp.mdpId, mdp.name);
    parcels.accept({ agentDid: origin.did, parcelId: 'FD-P', size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', paymentMode: 'prepaid' });
    mdps.fillTote(bag.code, 'FD-P');
    dispatch.release(bag.code);
    const [offer] = dispatch.suggest(d.did, { from: origin.location, to: { lat: -1.3, lng: 36.95 } });
    dispatch.claim(offer.offerId);

    const ov = fleet.overview();
    expect(ov.sessions.active).toBe(1);
    expect(ov.sessions.list[0].driverName).toBe('Dora');
    expect(ov.positions).toHaveLength(1); // reported GPS
    expect(ov.drivers.onShift).toBe(1);
    expect(ov.vehicles.inUse).toBe(1);

    const cargo = dispatch.activeCargo();
    expect(cargo.count).toBe(1);
    expect(cargo.totalKg).toBe(5); // one medium parcel
    expect(cargo.items[0].driverDid).toBe(d.did);
  });

  it('flexibly couples a driver to a vehicle and re-assigns to another (separate IDs, not bound)', () => {
    const d = drivers.register({ displayName: 'Multi', fullName: 'Mary', nationalId: 'DRV-ID-3', mobile: '+254900003', licenceClasses: ['bike', 'motorcycle'] });
    const bike = vehicles.register({ plate: 'BK-9', vehicleClass: 'bike', ownerName: 'Mary' });
    const moto = vehicles.register({ plate: 'MT-9', vehicleClass: 'motorcycle', ownerName: 'Mary' });
    const a1 = fleet.couple(d.did, bike.vehicleId);
    expect(a1.status).toBe('active');
    expect(drivers.get(d.did).assignedVehicleId).toBe(bike.vehicleId);
    expect(() => fleet.couple(d.did, moto.vehicleId)).toThrow(/already coupled/);
    fleet.uncouple(d.did);
    expect(drivers.get(d.did).assignedVehicleId).toBeUndefined();
    const a2 = fleet.couple(d.did, moto.vehicleId); // re-coupled to a different vehicle
    expect(a2.vehicleId).toBe(moto.vehicleId);
  });

  it('blocks coupling a driver to a vehicle class their licence does not cover', () => {
    const bikeOnly = drivers.register({ displayName: 'B', fullName: 'Ben', nationalId: 'DRV-ID-4', mobile: '+254900004', licenceClasses: ['bike'] });
    const van = vehicles.register({ plate: 'VN-1', vehicleClass: 'van', ownerName: 'X' });
    expect(() => fleet.couple(bikeOnly.did, van.vehicleId)).toThrow(/not licence-cleared/);
  });

  it('runs a driver shift session: scan the vehicle QR to start (couple), close to end (decouple)', () => {
    const d = drivers.register({ displayName: 'Shift', fullName: 'Sh', nationalId: 'SES-1', mobile: '+254ses1', licenceClasses: ['motorcycle'] });
    const moto = vehicles.register({ plate: 'SS-1', vehicleClass: 'motorcycle', ownerName: 'Sh' });
    expect(moto.qr).toMatch(/^VEH-/);
    expect(fleet.sessionFor(d.did).active).toBe(false);
    expect(() => fleet.startSession(d.did, 'VEH-NOPE')).toThrow(/Unknown vehicle QR/);

    const s = fleet.startSession(d.did, moto.qr); // scan the dashboard sticker
    expect(s.vehicleId).toBe(moto.vehicleId);
    const sess = fleet.sessionFor(d.did);
    expect(sess.active).toBe(true);
    if (sess.active) expect(sess.vehicle.plate).toBe('SS-1');
    expect(drivers.get(d.did).assignedVehicleId).toBe(moto.vehicleId);

    fleet.endSession(d.did);
    expect(fleet.sessionFor(d.did).active).toBe(false);
    expect(drivers.get(d.did).assignedVehicleId).toBeUndefined();
  });

  it('enforces vehicle limits at handover — a bike rejects fragile + over-weight parcels (micro feeder)', () => {
    const origin = onboardAgent('Fleet Origin', 'NorthTown', 50);
    const corridor = corridors.addCorridor({ name: 'feeder', originZone: 'NorthTown', destZone: 'SouthTown' });
    const d = drivers.register({ displayName: 'Boda', fullName: 'Boda B', nationalId: 'DRV-ID-5', mobile: '+254900005', licenceClasses: ['bike'] });
    const bike = vehicles.register({ plate: 'BD-1', vehicleClass: 'bike', ownerName: 'Boda B' });
    fleet.couple(d.did, bike.vehicleId, corridor.corridorId);

    parcels.accept({ agentDid: origin.did, parcelId: 'F-LIGHT', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
    parcels.accept({ agentDid: origin.did, parcelId: 'F-FRAGILE', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', fragile: true });
    parcels.accept({ agentDid: origin.did, parcelId: 'F-HEAVY', size: 'HEAVY', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });

    const r = parcels.handover({ agentDid: origin.did, driverBadgeId: d.badgeId!, parcelIds: ['F-LIGHT', 'F-FRAGILE', 'F-HEAVY'] });
    expect(r.handed).toEqual(['F-LIGHT']); // only the small, non-fragile parcel rides the bike
    expect(r.rejected.find((x) => x.parcelId === 'F-FRAGILE')?.reason).toMatch(/fragile/);
    expect(r.rejected.find((x) => x.parcelId === 'F-HEAVY')?.reason).toMatch(/over_20kg|vehicle_full/);
    expect(r.vehicle).toBe('bus'); // a bike maps onto the bus corridor-vehicle
  });

  it('S30: refuses to load incompatible cargo on one vehicle — cement dust never rides with fresh produce', () => {
    const origin = onboardAgent('Cargo Origin', 'NorthTown', 50);
    onboardAgent('Cargo Dest', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'cargo', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:cargo', name: 'C', corridorId: corridor.corridorId });
    parcels.accept({ agentDid: origin.did, parcelId: 'CEMENT', size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', natureCode: 'HAZ-DUST' });
    parcels.accept({ agentDid: origin.did, parcelId: 'TOMATO', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', natureCode: 'FOP' });

    // Both are scanned (so the S25 completeness gate is satisfied), but they cannot ride together.
    const r = parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['CEMENT', 'TOMATO'] });
    expect(r.handed).toEqual(['CEMENT']); // the first loads; the incompatible one cannot join it
    expect(r.rejected.find((x) => x.parcelId === 'TOMATO')?.reason).toBe('incompatible_cargo');
    const left = parcels.get('TOMATO');
    expect(left.status).toBe('At_PUDO'); // left behind for a later, compatible vehicle
    expect(left.shortShipReason).toBe('incompatible_cargo');
    expect(parcels.get('CEMENT').cargoClass).toBe('P1'); // 5 kg → P1, still a PUDO-lane parcel
  });

  it('S30: a perishable is refused by a vehicle with no cold chain (the previously-dead flags, now enforced)', () => {
    const origin = onboardAgent('Cold Origin', 'NorthTown', 50);
    onboardAgent('Cold Dest', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'cold', originZone: 'NorthTown', destZone: 'SouthTown' });
    const d = drivers.register({ displayName: 'Feeder', fullName: 'Feeder F', nationalId: 'DRV-ID-COLD', mobile: '+254900099', licenceClasses: ['bike'] });
    const bike = vehicles.register({ plate: 'CC-1', vehicleClass: 'bike', ownerName: 'Feeder F' }); // no reefer → coldChain false
    fleet.couple(d.did, bike.vehicleId, corridor.corridorId);
    parcels.accept({ agentDid: origin.did, parcelId: 'FISH', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', natureCode: 'FOP' });

    const r = parcels.handover({ agentDid: origin.did, driverBadgeId: d.badgeId!, parcelIds: ['FISH'] });
    expect(r.handed).toEqual([]);
    expect(r.rejected.find((x) => x.parcelId === 'FISH')?.reason).toBe('vehicle_missing_coldChain');
  });

  it('S30: refuses a palletised/oversized inbound order — it needs dedicated freight, not the PUDO network', () => {
    const origin = onboardAgent('Dedic Origin', 'NorthTown', 50);
    const dest = onboardAgent('Dedic Dest', 'NorthTown', 50); // same zone → a local quote needs no corridor
    const vendor = vendors.register({ name: 'Pallet Co' });
    const quote = routing.quoteShipment(origin.did, dest.did, 'HEAVY');
    expect(() =>
      parcels.createInbound({
        vendorId: vendor.vendorId, originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+254700',
        weightKg: 300, contentPhotoRef: 'content.jpg', shippingPolicy: vendor.shippingPolicy, quote,
      }),
    ).toThrow(/dedicated/i);
  });

  it('handover 100%-gate (S25): refuses an incomplete manifest and names the parcels left behind', () => {
    const origin = onboardAgent('Gate Origin', 'NorthTown', 50);
    onboardAgent('Gate Dest', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'gate', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:gate', name: 'G', corridorId: corridor.corridorId });
    parcels.accept({ agentDid: origin.did, parcelId: 'G-A', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
    parcels.accept({ agentDid: origin.did, parcelId: 'G-B', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });

    // Scanning only one of the two waiting parcels is refused — nothing moves.
    try {
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['G-A'] });
      throw new Error('expected INCOMPLETE_MANIFEST');
    } catch (e) {
      const err = e as { code?: string; params?: { missed?: string[] } };
      expect(err.code).toBe('INCOMPLETE_MANIFEST');
      expect(err.params?.missed).toEqual(['G-B']);
    }
    expect(parcels.get('G-A').status).toBe('At_PUDO'); // the refusal is transactional — G-A did not ride
    expect(parcels.get('G-B').status).toBe('At_PUDO');

    // Scanning both completes it: expected is reported, nothing missed.
    const r = parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['G-A', 'G-B'] });
    expect(r.handed.sort()).toEqual(['G-A', 'G-B']);
    expect(r.expected.sort()).toEqual(['G-A', 'G-B']);
    expect(r.missed).toEqual([]);
    expect(r.shortShipped).toBe(false);
  });

  it('handover short-ship (S25): an acknowledged short load rides the scanned parcel and flags the rest', () => {
    const origin = onboardAgent('SS Origin', 'NorthTown', 50);
    onboardAgent('SS Dest', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'ss', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:ss', name: 'S', corridorId: corridor.corridorId });
    parcels.accept({ agentDid: origin.did, parcelId: 'SS-A', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
    parcels.accept({ agentDid: origin.did, parcelId: 'SS-B', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });

    const r = parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['SS-A'], acknowledgeShortShip: true, shortShipReason: 'no space left' });
    expect(r.handed).toEqual(['SS-A']);
    expect(r.shortShipped).toBe(true);
    expect(r.missed).toEqual(['SS-B']);
    expect(parcels.get('SS-A').status).toBe('On_Bus');

    // The left-behind parcel is stamped and immediately visible to the control tower (not after 48 h).
    const left = parcels.get('SS-B');
    expect(left.status).toBe('At_PUDO');
    expect(left.shortShippedAt).toBeDefined();
    expect(left.shortShipReason).toBe('no space left');
    const flag = monitor.flags().find((f) => f.type === 'Short_Shipped' && f.subject === 'SS-B');
    expect(flag).toBeDefined();

    // Loading it onto the next bus clears the short-ship marker.
    const next = parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['SS-B'] });
    expect(next.handed).toEqual(['SS-B']);
    expect(parcels.get('SS-B').shortShippedAt).toBeUndefined();
    expect(monitor.flags().some((f) => f.type === 'Short_Shipped')).toBe(false);
  });

  it('handover gate ignores parcels bound for another corridor (S25): they are not "missed"', () => {
    const origin = onboardAgent('Multi Origin', 'NorthTown', 50);
    onboardAgent('South Dest', 'SouthTown', 50);
    onboardAgent('East Dest', 'EastTown', 50);
    const south = corridors.addCorridor({ name: 'south', originZone: 'NorthTown', destZone: 'SouthTown' });
    corridors.addCorridor({ name: 'east', originZone: 'NorthTown', destZone: 'EastTown' });
    const southDriver = corridors.addDriver({ driverDid: 'did:glos:south', name: 'S', corridorId: south.corridorId });
    parcels.accept({ agentDid: origin.did, parcelId: 'M-SOUTH', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
    parcels.accept({ agentDid: origin.did, parcelId: 'M-EAST', size: 'S', destZone: 'EastTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });

    // The south bus only demands the south parcel; the east-bound one waits for its own corridor.
    const r = parcels.handover({ agentDid: origin.did, driverBadgeId: southDriver.badgeId, parcelIds: ['M-SOUTH'] });
    expect(r.handed).toEqual(['M-SOUTH']);
    expect(r.expected).toEqual(['M-SOUTH']);
    expect(r.missed).toEqual([]);
    expect(parcels.get('M-EAST').status).toBe('At_PUDO');
  });

  it('handover short-ship reconciles what LOADED, not what was scanned (S25): a vehicle-rejected parcel is flagged, not silently left', () => {
    // Regression for the gate-bypass: a parcel the agent SCANS but the vehicle refuses (fragile on a bike)
    // must not slip through as "complete" — it is a genuine left-behind and the control tower must see it now.
    const origin = onboardAgent('Bike Origin', 'NorthTown', 50);
    const corridor = corridors.addCorridor({ name: 'bike', originZone: 'NorthTown', destZone: 'SouthTown' });
    const d = drivers.register({ displayName: 'Boda', fullName: 'Boda B', nationalId: 'DRV-ID-SS', mobile: '+254900055', licenceClasses: ['bike'] });
    const bike = vehicles.register({ plate: 'BD-SS', vehicleClass: 'bike', ownerName: 'Boda B' });
    fleet.couple(d.did, bike.vehicleId, corridor.corridorId);
    parcels.accept({ agentDid: origin.did, parcelId: 'BK-LIGHT', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
    parcels.accept({ agentDid: origin.did, parcelId: 'BK-FRAGILE', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', fragile: true });

    // The agent scans BOTH (no omission), so the gate does not block — but the bike cannot take the fragile one.
    const r = parcels.handover({ agentDid: origin.did, driverBadgeId: d.badgeId!, parcelIds: ['BK-LIGHT', 'BK-FRAGILE'] });
    expect(r.handed).toEqual(['BK-LIGHT']);
    expect(r.missed).toEqual(['BK-FRAGILE']); // reconciled from what actually loaded — not [] just because it was scanned
    expect(r.shortShipped).toBe(true);

    const left = parcels.get('BK-FRAGILE');
    expect(left.status).toBe('At_PUDO');
    expect(left.shortShippedAt).toBeDefined();
    expect(left.shortShipReason).toMatch(/fragile/); // the vehicle's concrete reason, not a generic default
    const flag = monitor.flags().find((fl) => fl.type === 'Short_Shipped' && fl.subject === 'BK-FRAGILE');
    expect(flag).toBeDefined(); // visible to the control tower immediately, not after the 48 h stagnant window
  });

  it('short-ship reason stays off the counterparty twin timeline (S25): the note is generic, the reason control-tower only', () => {
    // Regression for the PII leak: the free-text reason must live only on shortShipReason (ops), never in a
    // scan note, which toConsumerView copies into BOTH the sender's and receiver's twin timelines.
    const origin = onboardAgent('Leak Origin', 'NorthTown', 50);
    onboardAgent('Leak Dest', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'leak', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:leak', name: 'L', corridorId: corridor.corridorId });
    const sender = '+254700955001';
    const receiver = '+254700955002';
    parcels.accept({ agentDid: origin.did, parcelId: 'LK-A', size: 'S', destZone: 'SouthTown', senderMobile: sender, receiverMobile: receiver, dropoffPhotoRef: 'p.jpg' });
    parcels.accept({ agentDid: origin.did, parcelId: 'LK-B', size: 'S', destZone: 'SouthTown', senderMobile: sender, receiverMobile: receiver, dropoffPhotoRef: 'p.jpg' });

    const secret = 'consignee refused, balance unpaid';
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['LK-A'], acknowledgeShortShip: true, shortShipReason: secret });

    // The raw parcel keeps the reason for the control tower / monitor flag…
    expect(parcels.get('LK-B').shortShipReason).toBe(secret);
    // …but neither the receiver's nor the sender's twin timeline may carry it.
    const rx = parcels.consumerParcel('LK-B', hashPhone(receiver));
    const snd = parcels.consumerParcel('LK-B', hashPhone(sender));
    expect(JSON.stringify(rx)).not.toContain('consignee refused');
    expect(JSON.stringify(snd)).not.toContain('consignee refused');
    // The generic short-ship note is still on the timeline (visible delay is fine — the words are not).
    expect(rx.timeline.some((s) => (s.note ?? '').includes('short-ship'))).toBe(true);
  });

  it('vendor order detail hides the control-tower short-ship marker (S25 leak fix): reason never reaches the merchant', () => {
    const origin = onboardAgent('VO Origin', 'NorthTown', 50);
    const dest = onboardAgent('VO Dest', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'vo', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:vo', name: 'V', corridorId: corridor.corridorId });
    const vendor = vendors.register({ name: 'V', callbackUrl: 'https://v.example/hook' });
    vendors.topUp(vendor.vendorId, 50);
    const { parcel } = parcels.createInbound({ vendorId: vendor.vendorId, originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+254700966001', size: 'S', contentPhotoRef: 'content.jpg', shippingPolicy: vendor.shippingPolicy, quote: routing.quoteShipment(origin.did, dest.did, 'S') });
    parcels.intakeInbound(parcel.parcelId, origin.did);

    // Short-ship the vendor's parcel with a private operator reason (nothing else scanned).
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [], acknowledgeShortShip: true, shortShipReason: 'private ops note about the buyer' });
    expect(parcels.get(parcel.parcelId).shortShipReason).toBe('private ops note about the buyer'); // raw record keeps it for ops

    // The merchant's order-detail view must NOT carry the reason or the marker.
    const view = parcels.vendorOrderView(vendor.vendorId, parcel.parcelId);
    expect('shortShipReason' in view).toBe(false);
    expect('shortShippedAt' in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain('private ops note');
    // …but it still carries the normal order detail the console needs.
    expect(view.parcelId).toBe(parcel.parcelId);
    expect(view.status).toBe('At_PUDO');
    expect(view.vendorId).toBe(vendor.vendorId);

    // Wrong vendor cannot read it at all.
    expect(() => parcels.vendorOrderView('vendor_other', parcel.parcelId)).toThrow(/does not belong/);
  });

  it('media (S26): a real drop-off photo links to its parcel and its 90-day clock starts at delivery', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const origin = onboardAgent('Media Origin', 'NorthTown', 50);
    const dest = onboardAgent('Media Dest', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'm', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:m', name: 'M', corridorId: corridor.corridorId });

    // The agent uploads a real drop-off photo, then accepts the parcel referencing that mediaId.
    const { mediaId } = media.upload({ ownerDid: origin.did, kind: 'dropoff', dataUrl: PNG });
    parcels.accept({ agentDid: origin.did, parcelId: 'MED-1', size: 'S', destZone: 'SouthTown', destPudoDid: dest.did, senderMobile: '+254700970001', receiverMobile: '+254700970002', dropoffPhotoRef: mediaId });

    // Linked to the parcel, in the shipment-proof bin, clock NOT yet started.
    const linked = media.get(mediaId)!;
    expect(linked.link).toEqual({ type: 'parcel', id: 'MED-1' });
    expect(linked.retentionClass).toBe('shipment-proof');
    expect(linked.expiresAt).toBeUndefined();

    // Ride the bus, arrive, collect with the OTP → Delivered anchors the 90-day retention.
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['MED-1'] });
    parcels.arrive('MED-1', dest.did);
    const otp = releaseCodeOf('MED-1');
    parcels.pickup('MED-1', dest.did, otp);
    expect(parcels.get('MED-1').status).toBe('Delivered');
    expect(media.get(mediaId)!.expiresAt).toBeDefined(); // the clock is running only now
  });

  it('media (S26): vehicle registration links the owner’s body + trailer photos to the vehicle', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const body = media.upload({ ownerDid: 'did:mgr', kind: 'vehicle', dataUrl: PNG });
    const trailer = media.upload({ ownerDid: 'did:mgr', kind: 'vehicle', dataUrl: PNG }); // kind corrected by link
    const v = vehicles.register({ plate: 'KDA-777', vehicleClass: 'bike', ownerName: 'Owner', managerDid: undefined, vehiclePhotoRefs: [body.mediaId], trailerPhotoRefs: [trailer.mediaId] });

    expect(v.vehiclePhotoRefs).toEqual([body.mediaId]);
    expect(media.get(body.mediaId)!.link).toEqual({ type: 'vehicle', id: v.vehicleId });
    expect(media.get(trailer.mediaId)!.kind).toBe('trailer'); // link re-derived the kind
    expect(media.get(body.mediaId)!.retentionClass).toBe('vehicle-asset');
    // An asset image is the owner's to remove; it is never auto-scheduled while the vehicle is active.
    expect(media.get(body.mediaId)!.expiresAt).toBeUndefined();
  });

  it('media (S26 leak fix): the vehicle detail hides the owner id + photo mediaIds from a non-owner', () => {
    const v = vehicles.register({ plate: 'KDA-888', vehicleClass: 'bike', ownerName: 'Owner', vehiclePhotoRefs: ['med_x'], trailerPhotoRefs: ['med_y'] });
    // An operator sees the full record (the photo mediaIds + docs are present)…
    expect((vehicles.viewFor(v.vehicleId, undefined, true) as typeof v).vehiclePhotoRefs).toEqual(['med_x']);
    // …any non-owner tenant sees only the public marketplace fields, never the media refs / owner / QR.
    const stranger = vehicles.viewFor(v.vehicleId, 'did:mgr:B', false);
    expect(stranger.vehicleClass).toBe('bike'); // public
    expect(stranger.pricePerKm).toBeGreaterThanOrEqual(0);
    expect('vehiclePhotoRefs' in stranger).toBe(false);
    expect('trailerPhotoRefs' in stranger).toBe(false);
    expect('managerDid' in stranger).toBe(false);
    expect('documents' in stranger).toBe(false);
    expect('qr' in stranger).toBe(false);
    expect('ownerName' in stranger).toBe(false); // a driver-owned vehicle's ownerName is the driver's real name (PII)
    expect('ownerType' in stranger).toBe(false);
    // The open-data LIST is scoped the same way — a non-owner row never carries the media refs.
    const listed = vehicles.listFor({}, 'did:mgr:B', false).find((r) => r.plate === 'KDA-888')!;
    expect('vehiclePhotoRefs' in listed).toBe(false);
    expect(vehicles.listFor({}, undefined, true).find((r) => r.plate === 'KDA-888')!.vehiclePhotoRefs).toEqual(['med_x']);
  });

  it('media (S26): a buyer dispute holds the delivery proof + its own photo on one clock, and rejects reusing the PoD', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const origin = onboardAgent('Dsp Origin', 'NorthTown', 50);
    const dest = onboardAgent('Dsp Dest', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'd', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = corridors.addDriver({ driverDid: 'did:glos:d', name: 'D', corridorId: corridor.corridorId });
    const receiver = '+254700980002';
    parcels.accept({ agentDid: origin.did, parcelId: 'DSP-1', size: 'M', destZone: 'SouthTown', destPudoDid: dest.did, senderMobile: '+254700980001', receiverMobile: receiver, dropoffPhotoRef: 'drop.jpg' });
    parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['DSP-1'] });
    parcels.arrive('DSP-1', dest.did);
    const otp = releaseCodeOf('DSP-1');
    parcels.pickup('DSP-1', dest.did, otp);

    const rx = hashPhone(receiver);
    const pod = media.upload({ ownerDid: 'did:rx', kind: 'pod', dataUrl: PNG });
    parcels.attachPod('DSP-1', rx, 'did:rx', pod.mediaId); // PoD anchored to a 90-day shipment-proof clock
    const podClock = media.get(pod.mediaId)!.expiresAt!;

    // Reusing the PoD as the dispute photo is refused — the problem needs its own capture.
    expect(() => parcels.buyerDispute('DSP-1', rx, 'did:rx', 'wrong item', pod.mediaId)).toThrow(/not the delivery photo/);

    const problem = media.upload({ ownerDid: 'did:rx', kind: 'dispute', dataUrl: PNG });
    parcels.buyerDispute('DSP-1', rx, 'did:rx', 'wrong item', problem.mediaId);
    // Both the PoD and the problem photo are now on ONE dispute-evidence clock (PoD not swept mid-case).
    expect(media.get(pod.mediaId)!.retentionClass).toBe('dispute-evidence');
    expect(new Date(media.get(pod.mediaId)!.expiresAt!).getTime()).toBeGreaterThan(new Date(podClock).getTime());
    expect(media.get(problem.mediaId)!.expiresAt).toBeDefined();
  });

  it('media (S26): the vendor content photo is linked to its parcel and survives the orphan reaper', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const origin = onboardAgent('Ct Origin', 'NorthTown', 50);
    const dest = onboardAgent('Ct Dest', 'SouthTown', 50);
    corridors.addCorridor({ name: 'ct', originZone: 'NorthTown', destZone: 'SouthTown' });
    const vendor = vendors.register({ name: 'V', callbackUrl: 'https://v.example/hook' });
    vendors.topUp(vendor.vendorId, 50);
    const content = media.upload({ ownerDid: vendor.vendorId, kind: 'content', dataUrl: PNG });
    const { parcel } = parcels.createInbound({ vendorId: vendor.vendorId, originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+254700985001', size: 'S', contentPhotoRef: content.mediaId, shippingPolicy: vendor.shippingPolicy, quote: routing.quoteShipment(origin.did, dest.did, 'S') });

    // Linked to the parcel in the shipment-proof bin — NOT an orphan the reaper may reclaim.
    expect(media.get(content.mediaId)!.link).toEqual({ type: 'parcel', id: parcel.parcelId });
    expect(media.get(content.mediaId)!.retentionClass).toBe('shipment-proof');
    // Even long after upload it is kept (linked, awaiting its terminal-state clock), never hard-deleted.
    media.sweep(new Date(Date.now() + 72 * 60 * 60 * 1000));
    expect(media.get(content.mediaId)).toBeDefined();
  });

  it('publishes a PUDO tote for claim when full, and otherwise after the 24 h max wait (Ch 19)', () => {
    const origin = onboardAgent('Dispatch PUDO', 'NorthTown', 50);
    const mdp = mdps.register({ name: 'South Hub', zones: ['SouthTown'], location: { lat: -1.3, lng: 36.9 } });

    // (a) a full bag is published immediately
    const full = totes.register(origin.did);
    totes.assign(full.code, mdp.mdpId, mdp.name);
    for (let i = 0; i < 10; i += 1) {
      parcels.accept({ agentDid: origin.did, parcelId: `D-${i}`, size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', paymentMode: 'prepaid' });
      mdps.fillTote(full.code, `D-${i}`);
    }
    expect(dispatch.publishReady()).toContain(full.code);
    expect(totes.requireByCode(full.code).status).toBe('available');

    // (b) a partial bag waits — published only once it has aged past 24 h
    const partial = totes.register(origin.did);
    totes.assign(partial.code, mdp.mdpId, mdp.name);
    parcels.accept({ agentDid: origin.did, parcelId: 'D-P', size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', paymentMode: 'prepaid' });
    mdps.fillTote(partial.code, 'D-P');
    expect(dispatch.publishReady()).not.toContain(partial.code);
    expect(dispatch.publishReady(Date.now() + 25 * 3_600_000)).toContain(partial.code);
  });

  it('suggests on-route loads sized to remaining capacity; a claim reserves it against the vehicle total', () => {
    const origin = onboardAgent('Feeder PUDO', 'NorthTown', 50);
    const mdp = mdps.register({ name: 'Hub', zones: ['SouthTown'], location: { lat: -1.25, lng: 36.85 } });
    const d = drivers.register({ displayName: 'Moto', fullName: 'Mo', nationalId: 'DSP-1', mobile: '+254dsp1', licenceClasses: ['motorcycle'] });
    const moto = vehicles.register({ plate: 'MT-1', vehicleClass: 'motorcycle', ownerName: 'Mo' }); // 50 kg total
    fleet.couple(d.did, moto.vehicleId);

    const bag = totes.register(origin.did);
    totes.assign(bag.code, mdp.mdpId, mdp.name);
    parcels.accept({ agentDid: origin.did, parcelId: 'DS-1', size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', paymentMode: 'prepaid' });
    parcels.accept({ agentDid: origin.did, parcelId: 'DS-2', size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', paymentMode: 'prepaid' });
    mdps.fillTote(bag.code, 'DS-1');
    mdps.fillTote(bag.code, 'DS-2');
    dispatch.release(bag.code);

    const offers = dispatch.suggest(d.did, { from: origin.location, to: { lat: -1.3, lng: 36.95 } });
    expect(offers).toHaveLength(1);
    expect(offers[0].weightKg).toBe(10); // 2 × medium
    expect(offers[0].message).toMatch(/Claim it/);

    expect(dispatch.remainingCapacity(d.did)).toBe(50);
    dispatch.claim(offers[0].offerId);
    expect(totes.requireByCode(bag.code).status).toBe('claimed');
    expect(totes.requireByCode(bag.code).claimedBy).toBe(d.did);
    expect(dispatch.remainingCapacity(d.did)).toBe(40); // 50 − 10 reserved
  });

  it('auto-ignores an unanswered offer when it lapses, and blocks a late claim', () => {
    const origin = onboardAgent('Lapse PUDO', 'NorthTown', 50);
    const mdp = mdps.register({ name: 'Hub', zones: ['SouthTown'], location: { lat: -1.25, lng: 36.85 } });
    const d = drivers.register({ displayName: 'Moto', fullName: 'Mo', nationalId: 'DSP-2', mobile: '+254dsp2', licenceClasses: ['motorcycle'] });
    const moto = vehicles.register({ plate: 'MT-2', vehicleClass: 'motorcycle', ownerName: 'Mo' });
    fleet.couple(d.did, moto.vehicleId);
    const bag = totes.register(origin.did);
    totes.assign(bag.code, mdp.mdpId, mdp.name);
    parcels.accept({ agentDid: origin.did, parcelId: 'L-1', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', paymentMode: 'prepaid' });
    mdps.fillTote(bag.code, 'L-1');
    dispatch.release(bag.code);

    const [offer] = dispatch.suggest(d.did, { from: origin.location, to: { lat: -1.3, lng: 36.95 } });
    const later = Date.now() + 11 * 60_000; // past the 10-minute offer TTL
    expect(dispatch.activeOffersFor(d.did, later)).toHaveLength(0); // auto-ignored
    expect(() => dispatch.claim(offer.offerId, later)).toThrow(/lapsed/);
  });

  it('reserves a claimed bag for its driver — another driver cannot load it away', () => {
    const origin = onboardAgent('Reserve PUDO', 'NorthTown', 50);
    const mdp = mdps.register({ name: 'Hub', zones: ['SouthTown'], location: { lat: -1.25, lng: 36.85 } });
    const a = drivers.register({ displayName: 'A', fullName: 'Amos', nationalId: 'DSP-A', mobile: '+254dspa', licenceClasses: ['motorcycle'] });
    const b = drivers.register({ displayName: 'B', fullName: 'Ben', nationalId: 'DSP-B', mobile: '+254dspb', licenceClasses: ['motorcycle'] });
    fleet.couple(a.did, vehicles.register({ plate: 'MA-1', vehicleClass: 'motorcycle', ownerName: 'Amos' }).vehicleId);
    fleet.couple(b.did, vehicles.register({ plate: 'MB-1', vehicleClass: 'motorcycle', ownerName: 'Ben' }).vehicleId);
    const bag = totes.register(origin.did);
    totes.assign(bag.code, mdp.mdpId, mdp.name);
    parcels.accept({ agentDid: origin.did, parcelId: 'R-1', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', paymentMode: 'prepaid' });
    mdps.fillTote(bag.code, 'R-1');
    dispatch.release(bag.code);

    const [offer] = dispatch.suggest(a.did, { from: origin.location, to: { lat: -1.3, lng: 36.95 } });
    dispatch.claim(offer.offerId);
    expect(() => mdps.loadBag(bag.code, b.badgeId!)).toThrow(/reserved for another driver/);
    const loaded = mdps.loadBag(bag.code, a.badgeId!);
    expect(loaded.moved).toContain('R-1');
    expect(totes.requireByCode(bag.code).status).toBe('in_transit');
  });

  it('requires a verified phone, then signs a PUDO participant up; signs in; resets the password', () => {
    const phone = '+254700555';
    const agentProfile = { shopName: 'Signup Shop', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'x', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'Owner', nationalId: 'ID-SU1', mobile: phone, deviceImei: 'IMEI-SU1', requirements: eligibleReqs() };
    // unverified phone is rejected
    expect(() => accounts.signup({ role: 'pudo', email: 'shop@store.test', password: 'secret1', phone, profile: { agent: agentProfile, kyc: kycDocs } })).toThrow(/Verify your phone/);

    const { code } = otp.request(phone);
    expect(() => otp.verify(phone, '0000')).toThrow(/Wrong or expired/);
    expect(otp.verify(phone, code).verified).toBe(true);

    const res = accounts.signup({ role: 'pudo', email: 'shop@store.test', password: 'secret1', phone, profile: { agent: agentProfile, kyc: kycDocs } });
    expect(res.role).toBe('pudo');
    expect(res.did).toMatch(/^did:glos:/);
    expect(agents.get(res.did).status).toBe('KYC_PENDING'); // wizard submitted KYC → awaiting vetting

    // login
    expect(accounts.login('SHOP@store.test', 'secret1').did).toBe(res.did); // case-insensitive email
    expect(() => accounts.login('shop@store.test', 'wrong')).toThrow(/Wrong email or password/);
    const p2 = '+254700556'; otp.verify(p2, otp.request(p2).code);
    expect(() => accounts.signup({ role: 'pudo', email: 'shop@store.test', password: 'secret1', phone: p2, profile: { agent: agentProfile } })).toThrow(/already exists/);

    // forgot → reset → login with the new password
    const { resetToken } = accounts.forgot('shop@store.test');
    expect(resetToken).toMatch(/^RST-/);
    accounts.reset(resetToken!, 'secret2');
    expect(() => accounts.login('shop@store.test', 'secret1')).toThrow();
    expect(accounts.login('shop@store.test', 'secret2').did).toBe(res.did);
  });

  it('signs up a self-employed driver (own vehicle) and a fleet driver (joins via manager code)', () => {
    const ph1 = '+254700601'; otp.verify(ph1, otp.request(ph1).code);
    const self = accounts.signup({ role: 'driver', email: 'boda@d.test', password: 'secret1', phone: ph1, profile: { driver: { displayName: 'Boda', fullName: 'B', nationalId: 'ID-D1', mobile: ph1, licenceClasses: ['bike', 'motorcycle'] }, vehicle: { plate: 'BD-1', vehicleClass: 'motorcycle', ownerName: 'B' } } });
    expect(self.role).toBe('driver');
    expect(drivers.get(self.did).status).toBe('ACTIVE'); // light registry
    expect(vehicles.list().some((v) => v.plate === 'BD-1')).toBe(true); // own vehicle registered

    // a fleet must be ACTIVE to join
    const m = managers.register({ companyName: 'Co', contactPhone: '+254co', ownerFullName: 'O', ownerNationalId: 'MGR-D', location: { lat: -1, lng: 36 }, requirements: { businessRegistrationNo: 'BRN-D', transportOperatorLicence: 'TOL-D', taxId: 'TAX-D' } });
    managers.submitKyc(m.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'a' });
    managers.decideKyc(m.did, true);
    const active = managers.recordBond(m.did);
    const ph2 = '+254700602'; otp.verify(ph2, otp.request(ph2).code);
    const fleetDriver = accounts.signup({ role: 'driver', email: 'joiner@d.test', password: 'secret1', phone: ph2, profile: { fleetCode: active.loginCode, driver: { displayName: 'Joiner', fullName: 'J', nationalId: 'ID-D2', mobile: ph2, licenceClasses: ['bike'] } } });
    expect(drivers.get(fleetDriver.did).managerDid).toBe(m.did); // employed by the fleet
  });

  it('S20 — one person, many roles: a driver who signs up can enroll as a consumer and send, under one account', () => {
    // A driver signs up through the existing PUDO account flow — which now links them to a person by phone.
    const phone = '+254700711'; otp.verify(phone, otp.request(phone).code);
    const driver = accounts.signup({ role: 'driver', email: 'multi@d.test', password: 'secret1', phone, profile: { driver: { displayName: 'Multi', fullName: 'M', nationalId: 'ID-M1', mobile: phone, licenceClasses: ['bike'] }, vehicle: { plate: 'MU-1', vehicleClass: 'motorcycle', ownerName: 'M' } } });

    const linked = persons.findByPhone(phone);
    expect(linked).toBeDefined();
    expect(linked!.roles.map((r) => r.role)).toContain('driver');

    // The SAME human later enrolls the SAME phone as a consumer (to send a parcel). No second account:
    // the existing person gains a consumer role.
    const { person, isNew, token } = persons.enroll(phone, true, '1234');
    expect(isNew).toBe(false); // the driver already existed as a person
    expect(person.personDid).toBe(linked!.personDid); // one identity
    expect(person.roles.map((r) => r.role).sort()).toEqual(['consumer', 'driver']);

    // The consumer token acts as the person, with the consumer scopes.
    const asConsumer = auth.introspect(token.access_token);
    expect(asConsumer.active).toBe(true);
    expect(asConsumer.role).toBe('consumer');
    expect(asConsumer.did).toBe(person.personDid);
    expect(asConsumer.scopes).toContain('shipment:create');

    // Switch to the driver role → a real driver actor token bound to the DRIVER's DID (not the person's).
    const asDriver = auth.introspect(persons.mintForRole(person, 'driver').token.access_token);
    expect(asDriver.role).toBe('driver');
    expect(asDriver.did).toBe(driver.did);
    expect(asDriver.scopes).toContain('offer:claim');

    // Reopen with the 4-digit PIN (no OTP). Wrong PINs lock after 5 tries; the right PIN still works before that.
    expect(persons.loginWithPin(phone, '1234').person.personDid).toBe(person.personDid);
    for (let i = 0; i < 5; i++) expect(() => persons.loginWithPin(phone, '0000')).toThrow(/Wrong phone or PIN/);
    expect(() => persons.loginWithPin(phone, '1234')).toThrow(/Too many wrong PINs/); // locked out → OTP required
  });

  it('S28 — invite per contact: one token per contact, deduped credit, capped, no oracle, no inflation', () => {
    const inviter = persons.ensurePerson('+254700950001').personDid;

    // ONE token PER contact: each create mints a DISTINCT token (the sender maps each to a contact on-device).
    const a = invites.create(inviter, ['whatsapp']);
    const b = invites.create(inviter, ['sms']);
    expect(b.token).not.toBe(a.token);
    expect(invites.forInviter(inviter).invites).toHaveLength(2); // two contacts invited → two tokens

    // A NEW person joining through a SPECIFIC token flips that token's count (the "Jane joined" signal),
    // deduped per person; the other token stays at 0 (still "pending").
    const j1 = persons.ensurePerson('+254700950002').personDid;
    const j2 = persons.ensurePerson('+254700950003').personDid;
    invites.accept(a.token, j1);
    invites.accept(a.token, j1); // idempotent — already credited
    invites.accept(b.token, j2);
    const view = invites.forInviter(inviter);
    expect(view.joined).toBe(2); // total across tokens
    expect(view.invites.find((i) => i.token === a.token)?.joined).toBe(1); // a: joined
    expect(view.invites.find((i) => i.token === b.token)?.joined).toBe(1); // b: joined
    invites.accept(a.token, inviter); // you cannot credit yourself
    expect(invites.forInviter(inviter).joined).toBe(2);

    // PII-free: the inviter's view exposes no number, no hash, no joiner identity (names live on the device).
    const json = JSON.stringify(invites.forInviter(inviter));
    expect(json).not.toContain('950002');
    expect(json).not.toContain(j1);

    // NO membership oracle + NO inflation: creating a token and READING it can never credit anyone — status
    // flips ONLY on a real enrol-time accept() with that token, never healed from existing membership.
    const attacker = persons.ensurePerson('+254700950007').personDid;
    invites.create(attacker); // targets nobody — the model holds no phone to probe
    expect(invites.forInviter(attacker).joined).toBe(0);
    expect(invites.forInviter(attacker).joined).toBe(0); // reading again can never inflate

    // Capped per person so the store can't be spammed (already has 2; mint up to 100, then refuse).
    for (let i = 0; i < 98; i++) invites.create(inviter);
    expect(invites.forInviter(inviter).invites).toHaveLength(100);
    expect(() => invites.create(inviter)).toThrow(/most 100 open invites/);

    // The public landing preview validates the token, nothing more.
    expect(invites.preview(a.token).valid).toBe(true);
    expect(invites.preview('not-a-token').valid).toBe(false);
  });

  it('S28 — an invite credits only a genuinely NEW joiner; a returning member stays pending (no oracle)', () => {
    const inviter = persons.ensurePerson('+254700951000').personDid;
    const t = invites.create(inviter).token;

    // A brand-new person enrolling through the link is credited — mimicking the controller's `isNew && accept`.
    const first = persons.enroll('+254700951001', true, '1234');
    expect(first.isNew).toBe(true);
    if (first.isNew) invites.accept(t, first.person.personDid);
    expect(invites.byToken(t)!.joiners).toHaveLength(1);

    // The SAME person following an invite again is NOT new, so the controller never calls accept — the
    // token stays put. This is the load-bearing guard against crediting (and thereby probing) existing members.
    const again = persons.enroll('+254700951001', true);
    expect(again.isNew).toBe(false);
    if (again.isNew) invites.accept(t, again.person.personDid); // guard NOT taken
    expect(invites.byToken(t)!.joiners).toHaveLength(1); // a returning member never inflates the count
  });

  it('S21 — links a parcel to its sender + receiver by phone hash; the receiver sees a PII-free twin', () => {
    const origin = onboardAgent('S21 Origin', 'NorthTown', 50);
    const sender = '+254700811';
    const receiver = '+254700822';
    parcels.accept({ agentDid: origin.did, parcelId: 'S21-1', size: 'M', destZone: 'EastTown', senderMobile: sender, receiverMobile: receiver, dropoffPhotoRef: 'p.jpg', paymentMode: 'prepaid' });

    // The receiver sees it as 'received'; the sender as 'sent' — one parcel, two authenticated views.
    const recv = parcels.forPhoneHash(hashPhone(receiver));
    expect(recv.received.map((v) => v.parcelId)).toContain('S21-1');
    expect(recv.received[0].relation).toBe('received');
    expect(recv.sent).toHaveLength(0);
    expect(parcels.forPhoneHash(hashPhone(sender)).sent[0].relation).toBe('sent');

    // Owner-scoped single fetch; a non-party gets 404 (the parcel's existence is not confirmed to them).
    expect(parcels.consumerParcel('S21-1', hashPhone(receiver)).relation).toBe('received');
    expect(() => parcels.consumerParcel('S21-1', hashPhone('+254700999'))).toThrow(/No such parcel/);

    // The twin carries NO PII — neither mobile, nor either phone HASH, appears anywhere in it — but does
    // carry a status timeline. (Asserted on the whole values, not on a 3-digit fragment of them: the twin
    // legitimately contains random material — a shipment DID, a release code — that will eventually
    // collide with any short substring and fail this test for no reason.)
    const view = parcels.consumerParcel('S21-1', hashPhone(sender));
    const json = JSON.stringify(view);
    expect(json).not.toContain(sender);
    expect(json).not.toContain(receiver);
    expect(json).not.toContain(hashPhone(sender));
    expect(json).not.toContain(hashPhone(receiver));
    expect(view.timeline.length).toBeGreaterThan(0);
  });

  it('closes the tote last mile: an outbound parcel nominates a dest PUDO, is MDP-sorted, and delivered as a bag', () => {
    const origin = onboardAgent('TM Origin', 'NorthTown', 50);
    const dest = onboardAgent('TM Dest', 'EastTown', 50);
    const hub = mdps.register({ name: 'East Hub', zones: ['EastTown'], location: { lat: -1.25, lng: 36.9 } });

    // Outbound parcel that nominates its destination PUDO → has destAgentDid → MDP-sortable (P1 #2).
    parcels.accept({ agentDid: origin.did, parcelId: 'TM-1', size: 'M', destZone: 'EastTown', destPudoDid: dest.did, senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', paymentMode: 'prepaid' });
    expect(parcels.get('TM-1').destAgentDid).toBe(dest.did);

    const bag = totes.register(origin.did);
    totes.assign(bag.code, hub.mdpId, hub.name);
    mdps.fillTote(bag.code, 'TM-1');
    mdps.loadBag(bag.code, 'BUS-1');
    mdps.dropBag(hub.mdpId, bag.code);
    const sort = mdps.sortParcel(hub.mdpId, 'TM-1'); // works for outbound now
    expect(sort.nextDestination.id).toBe(dest.did);
    mdps.loadBag(sort.toteCode, 'BUS-2'); // onward to the dest PUDO
    expect(parcels.get('TM-1').status).toBe('On_Bus');

    // Dest PUDO receives the whole bag → parcel shelved for pickup + tote freed (P1 #1: no leak).
    const r = mdps.deliverBag(dest.did, sort.toteCode);
    expect(r.delivered).toContain('TM-1');
    expect(parcels.get('TM-1').status).toBe('Ready_For_Pickup');
    expect(totes.requireByCode(sort.toteCode).status).toBe('free');
    // MDP sort labour was booked (P3 #7); driver transport fee fires for fleet-resolved badges only.
    expect(gate.entries({ type: 'LABOR_PAYOUT' }).some((e) => e.refType === 'mdp')).toBe(true);
  });

  it('cancels a not-yet-delivered parcel and refunds a cash charge (reverse logistics)', () => {
    const origin = onboardAgent('Cx Shop', 'NorthTown', 50);
    const before = agents.balance(origin.did);
    parcels.accept({ agentDid: origin.did, parcelId: 'CX-1', size: 'S', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
    expect(parcels.cancel('CX-1', 'ops', 'customer changed mind').status).toBe('Voided');
    expect(agents.balance(origin.did)).toBeCloseTo(before, 2); // cash charge refunded
  });

  it('completes the bulk-freight lifecycle (register → claim → pickup → deliver, capacity released)', () => {
    const d = drivers.register({ displayName: 'Tk', fullName: 'T', nationalId: 'FR-1', mobile: '+254fr1', licenceClasses: ['truck'], licenceNumber: 'L-FR', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' }); drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'TK-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'T' });
    fleet.couple(d.did, truck.vehicleId);
    const f = dispatch.registerFreight({ description: 'Cement 5t', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'Depot', destLabel: 'Site', weightKg: 5000, bulk: true });
    const [offer] = dispatch.suggest(d.did, { from: { lat: -1.2, lng: 36.8 }, to: { lat: -1.25, lng: 36.85 } });
    dispatch.claim(offer.offerId);
    expect(dispatch.remainingCapacity(d.did)).toBe(5000); // 10000 − 5000 reserved
    // S32b: only the driver who CLAIMED it may advance it (a claimed freight is their obligation).
    expect(() => dispatch.pickupFreight(f.freightId, 'did:glos:someone-else')).toThrow(/another driver/);
    pickupOk(f, d.did);
    expect(deliverOk(f, d.did).status).toBe('delivered');
    expect(dispatch.remainingCapacity(d.did)).toBe(10_000); // released
  });

  // --- S34: dynamic freight pricing (priced offer → price lock + shipper billing → driver payout) ---

  it('S34: prices a freight offer, locks + bills the shipper at claim, pays the driver on delivery', () => {
    const d = drivers.register({ displayName: 'PR', fullName: 'P', nationalId: 'ID-PR', mobile: '+254770777', licenceClasses: ['truck'], licenceNumber: 'L-PR', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    // A KNOWN profile: base 10, 0.5/km, corridor [0.8, 1.5], carrying the tail-lift a P4 discrete load needs.
    const truck = vehicles.register({ plate: 'PR-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5 });
    expect(truck.baseFee).toBe(10);
    expect([truck.minMultiplier, truck.maxMultiplier]).toEqual([0.8, 1.5]);
    fleet.couple(d.did, truck.vehicleId);

    // A vendor pre-pays; a diverted-style freight names them as the shipper.
    const vendor = vendors.register({ name: 'PriceVendor' });
    vendors.topUp(vendor.vendorId, 500);
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, bulk: false, shipperDid: vendor.vendorId });

    // Driver starts AT the pickup and the haul is zero-length → the price is the flat base fee only, at an
    // off-peak neutral multiplier. A fixed 11:00 clock keeps the multiplier deterministic (off-peak → 1.0).
    const noon = new Date('2026-07-22T11:00:00').getTime();
    const [offer] = dispatch.suggest(d.did, { from: pickup, to: pickup }, noon);
    expect(offer.kind).toBe('freight');
    expect(offer.price).toBeDefined();
    expect(offer.price!.multiplier).toBe(1);
    expect(offer.price!.total).toBe(10); // base 10 + 0 km × rate

    const before = vendors.balanceOf(vendor.vendorId);
    dispatch.claim(offer.offerId, noon);
    const claimed = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
    expect(claimed.lockedPrice).toBe(10);
    expect(claimed.priceBreakdown?.total).toBe(10);
    expect(claimed.paidStatus).toBe('billed');
    expect(vendors.balanceOf(vendor.vendorId)).toBeCloseTo(before - shipperCharge(10), 2); // earning + platform fee

    // Deliver → the driver is paid the locked earning exactly once (a single DRIVER_PAYOUT ledger row).
    pickupOk(f, d.did);
    deliverOk(f, d.did);
    const payouts = gate.entries({ type: 'DRIVER_PAYOUT' }).filter((e) => e.reference === d.did);
    expect(payouts).toHaveLength(1);
    expect(payouts[0].amount).toBe(10);
    expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)!.driverPaid).toBe(true);
  });

  it('S34: a legacy vehicle with no pricing profile prices at its class default — never NaN into money', () => {
    const d = drivers.register({ displayName: 'LG', fullName: 'L', nationalId: 'ID-LG', mobile: '+254770999', licenceClasses: ['truck'], licenceNumber: 'L-LG', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'LG-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'] });
    // Simulate a vehicle PERSISTED before S34a: strip the three new pricing fields, exactly as PersistentMap.load()
    // rehydrates an old on-disk record (no migration/backfill). The pricing read path must not read these raw.
    delete (truck as unknown as Record<string, unknown>).baseFee;
    delete (truck as unknown as Record<string, unknown>).minMultiplier;
    delete (truck as unknown as Record<string, unknown>).maxMultiplier;
    fleet.couple(d.did, truck.vehicleId);

    const vendor = vendors.register({ name: 'LegacyVendor' });
    vendors.topUp(vendor.vendorId, 500);
    const start = vendors.balanceOf(vendor.vendorId);
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, bulk: false, shipperDid: vendor.vendorId });
    const noon = new Date('2026-07-22T11:00:00').getTime();
    const [offer] = dispatch.suggest(d.did, { from: pickup, to: pickup }, noon);
    expect(offer.price).toBeDefined();
    expect(Number.isFinite(offer.price!.total)).toBe(true);
    expect(offer.price!.total).toBe(10); // truck class default base fee (fleet.config) + 0 km

    dispatch.claim(offer.offerId, noon);
    const claimed = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
    expect(Number.isFinite(claimed.lockedPrice!)).toBe(true);
    expect(claimed.lockedPrice).toBe(10);
    expect(claimed.paidStatus).toBe('billed');
    // The durable prepaid balance stayed FINITE (the NaN-corruption bug the review found), decremented exactly.
    expect(Number.isFinite(vendors.balanceOf(vendor.vendorId))).toBe(true);
    expect(vendors.balanceOf(vendor.vendorId)).toBeCloseTo(start - shipperCharge(10), 2);

    pickupOk(f, d.did);
    deliverOk(f, d.did);
    const payouts = gate.entries({ type: 'DRIVER_PAYOUT' }).filter((e) => e.reference === d.did);
    expect(payouts).toHaveLength(1);
    expect(Number.isFinite(payouts[0].amount)).toBe(true);
    expect(payouts[0].amount).toBe(10);
  });

  it('S34: an underfunded KNOWN shipper is flagged billing_failed (distinct from a bulletin), driver still paid', () => {
    const d = drivers.register({ displayName: 'BF', fullName: 'B', nationalId: 'ID-BF', mobile: '+254771000', licenceClasses: ['truck'], licenceNumber: 'L-BF', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'BF-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5 });
    fleet.couple(d.did, truck.vehicleId);
    const vendor = vendors.register({ name: 'BrokeVendor' }); // balance 0 — never topped up
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, bulk: false, shipperDid: vendor.vendorId });
    const noon = new Date('2026-07-22T11:00:00').getTime();
    const [offer] = dispatch.suggest(d.did, { from: pickup, to: pickup }, noon);
    dispatch.claim(offer.offerId, noon);
    const claimed = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
    expect(claimed.paidStatus).toBe('billing_failed'); // a real debt to collect — NOT the same as a bulletin 'unpaid'
    expect(vendors.balanceOf(vendor.vendorId)).toBe(0); // billShipment rejected → balance untouched (no NaN, no negative)
    pickupOk(f, d.did);
    deliverOk(f, d.did);
    expect(gate.entries({ type: 'DRIVER_PAYOUT' }).filter((e) => e.reference === d.did)).toHaveLength(1); // labour is owed regardless
  });

  it('S34: a bulletin freight with no shipper stays unpaid at claim but still pays the driver on delivery', () => {
    const d = drivers.register({ displayName: 'BL', fullName: 'B', nationalId: 'ID-BL', mobile: '+254770888', licenceClasses: ['truck'], licenceNumber: 'L-BL', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'BL-1', vehicleClass: 'truck', truckSubtype: 'tipper', capacityKg: 10_000, ownerName: 'X', baseFee: 8, pricePerKm: 0.4 });
    fleet.couple(d.did, truck.vehicleId);
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Sand 5t', pickupLocation: pickup, pickupLabel: 'Quarry', destLabel: 'Site', destLocation: pickup, weightKg: 5000, bulk: true }); // no shipperDid

    const noon = new Date('2026-07-22T11:00:00').getTime();
    const [offer] = dispatch.suggest(d.did, { from: pickup, to: pickup }, noon);
    dispatch.claim(offer.offerId, noon);
    const claimed = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
    expect(claimed.lockedPrice).toBe(8);
    expect(claimed.paidStatus).toBe('unpaid'); // no shipper to bill — settled off-platform
    pickupOk(f, d.did);
    deliverOk(f, d.did);
    expect(gate.entries({ type: 'DRIVER_PAYOUT' }).filter((e) => e.reference === d.did)).toHaveLength(1); // driver still paid
  });

  // --- S34b: the dynamic market-pulse engine (per-zone supply/demand surge, admin rules, corridor clamp) ---

  // S33 — advance a freight through the safety gate: a complete load-safety checklist (derived from the freight)
  // + a securement photo at pickup, a complete unload checklist at delivery. (A fake mediaId is fine — link()
  // no-ops on an unknown id.)
  const pickupOk = (freight: { freightId: string; bulk: boolean; fragile: boolean; requiredCapabilities: import('./cargo.types').VehicleCapability[] }, did?: string) =>
    dispatch.pickupFreight(freight.freightId, did, { confirmed: requiredLoadKeys(freight), securementPhotoId: 'med_test' });
  const deliverOk = (freight: { freightId: string }, did?: string) =>
    dispatch.deliverFreight(freight.freightId, did, { confirmed: requiredUnloadKeys() });

  const coupleTipper = (tag: string, bounds: { min: number; max: number }, baseFee = 10) => {
    const d = drivers.register({ displayName: tag, fullName: tag, nationalId: 'ID-' + tag, mobile: '+2547' + tag, licenceClasses: ['truck'], licenceNumber: 'L-' + tag, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: 'MK-' + tag, vehicleClass: 'truck', truckSubtype: 'tipper', capacityKg: 20_000, ownerName: 'X', baseFee, pricePerKm: 0.5, minMultiplier: bounds.min, maxMultiplier: bounds.max });
    fleet.couple(d.did, v.vehicleId);
    return d;
  };

  // S33b — a refrigerated truck (coldChain) carrying a tail-lift, so it can be offered a discrete cold-chain (FOP) freight.
  const coupleReefer = (tag: string) => {
    const d = drivers.register({ displayName: tag, fullName: tag, nationalId: 'ID-' + tag, mobile: '+2547' + tag, licenceClasses: ['truck'], licenceNumber: 'L-' + tag, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: 'RF-' + tag, vehicleClass: 'truck', truckSubtype: 'refrigerated', capacityKg: 20_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5 });
    fleet.couple(d.did, v.vehicleId);
    return d;
  };

  it('S34b: a high-demand zone surges the freight multiplier, clamped to each vehicle corridor', () => {
    const pickup = { lat: -1.2, lng: 36.8 };
    const dest = { lat: -1.22, lng: 36.82 };
    // 5 open loads in one cell, no vehicles reporting a position there → pressure 5 → factor clampRaw(2.0).
    for (let i = 0; i < 5; i++) dispatch.registerFreight({ description: `Sand ${i}`, pickupLocation: pickup, pickupLabel: 'Quarry', destLabel: 'Site', destLocation: dest, weightKg: 1000, bulk: true });
    const noon = new Date('2026-07-22T11:00:00').getTime();
    marketPulse.recompute(noon);
    expect(marketStore.factorFor(pickup, noon)).toBe(2);

    // A [0.8,1.5] tipper: seasonal 1.0 × market 2.0 = 2.0, clamped to its 1.5 ceiling.
    const narrow = coupleTipper('SRG', { min: 0.8, max: 1.5 });
    expect(dispatch.suggest(narrow.did, { from: pickup, to: dest }, noon)[0].price!.multiplier).toBe(1.5);
    // A [0.8,2.0] tipper captures more of the surge — but never beyond its own ceiling.
    const wide = coupleTipper('WID', { min: 0.8, max: 2 });
    expect(dispatch.suggest(wide.did, { from: pickup, to: dest }, noon)[0].price!.multiplier).toBe(2);

    // The watchtower surfaces the hot cell (hottest first, with a human zone label).
    const insight = marketPulse.insight(noon);
    expect(insight.cells[0].demand).toBe(5);
    expect(insight.cells[0].factor).toBe(2);
  });

  it('F1: a scheduled load is RESERVABLE ahead of its date (early claim, default) but pickup is gated to the date', () => {
    const pickup = { lat: -1.2, lng: 36.8 };
    const dest = { lat: -1.22, lng: 36.82 };
    const noon = new Date('2026-07-22T11:00:00').getTime();
    const tomorrow = new Date(noon + 24 * 3_600_000).toISOString();
    const f = dispatch.registerFreight({ description: 'Teff to Merkato', pickupLocation: pickup, pickupLabel: 'Coop', destLabel: 'Merkato', destLocation: dest, weightKg: 5000, bulk: true, scheduledPickupAt: tomorrow }, noon);
    expect(f.status).toBe('scheduled');
    expect(f.allowEarlyClaim).toBe(true); // default

    const driver = coupleTipper('F1E', { min: 0.8, max: 1.5 });
    // Offered BEFORE its date (a scarce truck can commit early) and the offer carries the pickup date.
    const [offer] = dispatch.suggest(driver.did, { from: pickup, to: dest }, noon).filter((o) => o.ref === f.freightId);
    expect(offer).toBeDefined();
    dispatch.claim(offer.offerId, noon);
    expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)!.status).toBe('claimed');
    // But it can't be PICKED UP before its date (the cargo isn't ready) …
    expect(() => dispatch.pickupFreight(f.freightId, driver.did, { securementPhotoId: 'x.jpg' }, noon)).toThrow(/before then/);
    // … and on/after the date the date-gate is open (it now fails on the safety checklist, not the date).
    expect(() => dispatch.pickupFreight(f.freightId, driver.did, {}, noon + 24 * 3_600_000 + 1)).toThrow(/checklist|secured load/i);
  });

  it('F1: allowEarlyClaim=false holds a scheduled load out of the marketplace until due, then promotes it', () => {
    const pickup = { lat: -1.2, lng: 36.8 };
    const dest = { lat: -1.22, lng: 36.82 };
    const t0 = new Date('2026-07-22T11:00:00').getTime();
    const f = dispatch.registerFreight({ description: 'Held', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: dest, weightKg: 1000, bulk: true, scheduledPickupAt: new Date(t0 + 3_600_000).toISOString(), allowEarlyClaim: false }, t0);
    expect(f.status).toBe('scheduled');
    const driver = coupleTipper('F1H', { min: 0.8, max: 1.5 });
    expect(dispatch.suggest(driver.did, { from: pickup, to: dest }, t0).some((o) => o.ref === f.freightId)).toBe(false); // not offered before due
    expect(dispatch.publishReadyFreight(t0)).not.toContain(f.freightId);
    expect(dispatch.publishReadyFreight(t0 + 3_600_001)).toContain(f.freightId); // due → promoted
    expect(dispatch.suggest(driver.did, { from: pickup, to: dest }, t0 + 3_600_002).some((o) => o.ref === f.freightId)).toBe(true);
  });

  it('F1: a no-show early claim is released back to the marketplace + the shipper is rebated', () => {
    const pickup = { lat: -1.2, lng: 36.8 };
    const t0 = new Date('2026-07-22T11:00:00').getTime();
    const due = t0 + 24 * 3_600_000;
    const vendor = vendors.register({ name: 'CoopShipper' });
    vendors.topUp(vendor.vendorId, 500);
    const f = dispatch.registerFreight({ description: 'Reserved', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, bulk: true, shipperDid: vendor.vendorId, scheduledPickupAt: new Date(due).toISOString() }, t0);
    const driver = coupleTipper('F1N', { min: 0.8, max: 1.5 });
    const before = vendors.balanceOf(vendor.vendorId);
    const [offer] = dispatch.suggest(driver.did, { from: pickup, to: pickup }, t0).filter((o) => o.ref === f.freightId);
    dispatch.claim(offer.offerId, t0); // reserved early → the vendor is billed
    expect(vendors.balanceOf(vendor.vendorId)).toBeLessThan(before);
    // The driver never shows: past the pickup date + grace, still not picked up → released + rebated.
    dispatch.publishReadyFreight(due + 13 * 3_600_000);
    const rel = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
    expect(rel.status).toBe('available');
    expect(rel.claimedBy).toBeUndefined();
    expect(vendors.balanceOf(vendor.vendorId)).toBeCloseTo(before, 2); // charge undone
  });

  it('F1: a released no-show load can be re-claimed without thrashing — no re-release, no ledger churn', () => {
    const pickup = { lat: -1.2, lng: 36.8 };
    const t0 = new Date('2026-07-22T11:00:00').getTime();
    const due = t0 + 24 * 3_600_000;
    const vendor = vendors.register({ name: 'CoopShipper2' });
    vendors.topUp(vendor.vendorId, 500);
    const f = dispatch.registerFreight({ description: 'Reserved', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, bulk: true, shipperDid: vendor.vendorId, scheduledPickupAt: new Date(due).toISOString() }, t0);

    // First driver reserves early, then no-shows → released + rebated, and the now-past date is cleared.
    const d1 = coupleTipper('F1R1', { min: 0.8, max: 1.5 });
    const [o1] = dispatch.suggest(d1.did, { from: pickup, to: pickup }, t0).filter((o) => o.ref === f.freightId);
    dispatch.claim(o1.offerId, t0);
    dispatch.publishReadyFreight(due + 13 * 3_600_000);
    const freed = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
    expect(freed.status).toBe('available');
    expect(freed.scheduledPickupAt).toBeUndefined(); // stale date gone → a plain ship-now load

    // A second driver re-claims the freed load. Its no-show grace now runs from THIS claim, and the load
    // carries no past date — so the maintenance pass fired by the very next suggest() can't re-release it.
    const reclaimAt = due + 20 * 3_600_000;
    const d2 = coupleTipper('F1R2', { min: 0.8, max: 1.5 });
    const [o2] = dispatch.suggest(d2.did, { from: pickup, to: pickup }, reclaimAt).filter((o) => o.ref === f.freightId);
    expect(o2).toBeDefined();
    dispatch.claim(o2.offerId, reclaimAt);
    const billings = () => vendors.settlementsFor(vendor.vendorId).filter((s) => s.type === 'BILLING').length;
    const rebates = () => vendors.settlementsFor(vendor.vendorId).filter((s) => s.type === 'REBATE').length;
    const [b0, r0, bal0] = [billings(), rebates(), vendors.balanceOf(vendor.vendorId)];

    dispatch.publishReadyFreight(reclaimAt + 1); // the exact thrash trigger — the pass right after re-claim
    dispatch.publishReadyFreight(reclaimAt + 6 * 3_600_000); // still within the fresh 12h grace
    const settled = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
    expect(settled.status).toBe('claimed'); // held by the re-claimer, not churned back to the market
    expect(settled.claimedBy).toBe(d2.did);
    expect(billings()).toBe(b0); // no phantom re-bill
    expect(rebates()).toBe(r0); // no phantom re-rebate
    expect(vendors.balanceOf(vendor.vendorId)).toBeCloseTo(bal0, 2);
    // The no-show release books a truthful, searchable ledger note (not the parcel-path 'flexible-route rebate').
    expect(vendors.settlementsFor(vendor.vendorId).some((s) => s.type === 'REBATE' && s.note === 'freight no-show release')).toBe(true);
  });

  it('F1: a promoted scheduled load claimed long after its date is not instantly re-released (grace runs from the claim)', () => {
    const pickup = { lat: -1.2, lng: 36.8 };
    const t0 = new Date('2026-07-22T11:00:00').getTime();
    const due = t0 + 3_600_000;
    const vendor = vendors.register({ name: 'CoopShipper3' });
    vendors.topUp(vendor.vendorId, 500);
    // Held off the market (no early claim), then promoted at its date — the promotion keeps the pickup date.
    const f = dispatch.registerFreight({ description: 'Held', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, bulk: true, shipperDid: vendor.vendorId, scheduledPickupAt: new Date(due).toISOString(), allowEarlyClaim: false }, t0);
    dispatch.publishReadyFreight(due + 1); // → 'available' (scheduledPickupAt still set)

    // A driver claims it well after the date + the 12h grace (it sat unclaimed on the market a while).
    const claimAt = due + 50 * 3_600_000;
    const d = coupleTipper('F1P', { min: 0.8, max: 1.5 });
    const [o] = dispatch.suggest(d.did, { from: pickup, to: pickup }, claimAt).filter((x) => x.ref === f.freightId);
    expect(o).toBeDefined();
    dispatch.claim(o.offerId, claimAt);
    dispatch.publishReadyFreight(claimAt + 1); // must NOT no-show it: its grace anchors to the claim, not the old date
    const held = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
    expect(held.status).toBe('claimed');
    expect(held.claimedBy).toBe(d.did);
  });

  it('F1: an unparseable schedule is refused (fail-closed); a past date ships now; a future date is canonicalised', () => {
    const pickup = { lat: -1.2, lng: 36.8 };
    const t0 = new Date('2026-07-22T11:00:00').getTime();
    expect(() => dispatch.registerFreight({ description: 'Bad', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', weightKg: 1000, bulk: true, scheduledPickupAt: 'not-a-date' }, t0)).toThrow();
    const past = dispatch.registerFreight({ description: 'Now', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', weightKg: 1000, bulk: true, scheduledPickupAt: new Date(t0 - 3_600_000).toISOString() }, t0);
    expect(past.status).toBe('available');
    expect(past.scheduledPickupAt).toBeUndefined();
    const future = dispatch.registerFreight({ description: 'Later', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', weightKg: 1000, bulk: true, scheduledPickupAt: '2026-07-25T09:00:00.000Z' }, t0);
    expect(future.scheduledPickupAt).toBe('2026-07-25T09:00:00.000Z'); // canonical UTC
  });

  it('S34b: a thin zone below the demand threshold does not surge', () => {
    const pickup = { lat: -1.35, lng: 36.95 };
    for (let i = 0; i < 2; i++) dispatch.registerFreight({ description: `L${i}`, pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: { lat: -1.36, lng: 36.96 }, weightKg: 1000, bulk: true });
    const noon = new Date('2026-07-22T11:00:00').getTime();
    const cells = marketPulse.recompute(noon);
    expect(cells.find((c) => c.demand === 2)?.organicFactor).toBe(1); // 2 < MARKET_MIN_DEMAND (3) → neutral
    expect(marketStore.factorFor(pickup, noon)).toBe(1);
  });

  it('S34b: an operator surge rule overrides organic pricing, clamped to the band + the corridor', () => {
    const pickup = { lat: -1.5, lng: 36.6 };
    const dest = { lat: -1.52, lng: 36.62 };
    dispatch.registerFreight({ description: 'One load', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: dest, weightKg: 1000, bulk: true });
    const noon = new Date('2026-07-22T11:00:00').getTime();
    const cell = marketPulse.cellFor(pickup);
    // A lone load would be neutral, but the operator declares a festival surge.
    marketPulse.setSurgeRule({ cell, factor: 1.8, reason: 'festival', by: 'op' }, noon);
    expect(marketStore.factorFor(pickup, noon)).toBe(1.8);
    const d = coupleTipper('RUL', { min: 0.8, max: 1.5 });
    expect(dispatch.suggest(d.did, { from: pickup, to: dest }, noon)[0].price!.multiplier).toBe(1.5); // clamped to ceiling
    // Lifting the rule returns the zone to neutral.
    marketPulse.clearSurgeRule(cell, noon);
    expect(marketStore.factorFor(pickup, noon)).toBe(1);
    expect(marketPulse.insight(noon).rules).toHaveLength(0);
  });

  it('S34b: the watchtower reflects a lapsed surge rule at once (no stale baked factor)', () => {
    const pickup = { lat: -1.6, lng: 36.5 };
    dispatch.registerFreight({ description: 'L', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: { lat: -1.62, lng: 36.52 }, weightKg: 1000, bulk: true });
    const t0 = new Date('2026-07-22T11:00:00Z').getTime();
    const cell = marketPulse.cellFor(pickup);
    // A rule that lapses in 60s; setSurgeRule recomputes, baking factor 1.8 into the snapshot cell.
    marketPulse.setSurgeRule({ cell, factor: 1.8, reason: 'brief', by: 'op', expiresAt: new Date(t0 + 60_000).toISOString() }, t0);
    const before = marketPulse.insight(t0);
    expect(before.cells.find((c) => c.cell === cell)?.factor).toBe(1.8);
    expect(before.rules).toHaveLength(1);
    // 90s later the rule has lapsed but the 120s recompute has NOT fired — the watchtower must already show organic.
    const after = marketPulse.insight(t0 + 90_000);
    const afterCell = after.cells.find((c) => c.cell === cell);
    expect(afterCell?.ruleApplied).toBe(false);
    expect(afterCell?.factor).toBe(1); // organic (1 load < threshold), not the stale baked 1.8
    expect(after.rules).toHaveLength(0);
    expect(marketStore.factorFor(pickup, t0 + 90_000)).toBe(1); // and pricing agrees
  });

  it('S34b: the operator market-pulse endpoints recompute and return the insight', () => {
    const pickup = { lat: -1.2, lng: 36.8 };
    for (let i = 0; i < 4; i++) dispatch.registerFreight({ description: `F${i}`, pickupLocation: pickup, pickupLabel: 'Q', destLabel: 'S', destLocation: { lat: -1.22, lng: 36.82 }, weightKg: 1000, bulk: true });
    const out = controller.recomputeMarketPulse();
    expect(out.cells.length).toBeGreaterThan(0);
    const insight = controller.marketPulse();
    expect(insight.cells[0].demand).toBe(4);
    expect(insight.cells[0].factor).toBe(1.75); // 4 loads, 0 vehicles → 1 + 0.25·(4−1)
  });

  // --- S34c: shipper-budget matching + the driver's min-earn filter ---
  // A 0-distance haul (pickup==dest, route from==pickup) prices at the base fee only → deterministic:
  // a base-fee-10 tipper earns 10, the shipper is charged withPlatformFee(10) = 10.2.

  it('S34c: a shipper budget hides an over-budget freight offer; a cheaper vehicle still gets it', () => {
    const pickup = { lat: -1.7, lng: 36.4 };
    const noon = new Date('2026-07-22T11:00:00Z').getTime();
    const f = dispatch.registerFreight({ description: 'Cargo', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, bulk: true, maxSpend: 10 });
    expect(f.maxSpend).toBe(10);
    const pricey = coupleTipper('EXP', { min: 0.8, max: 1.5 }, 10); // charge 10.2 > 10 → over budget
    expect(dispatch.suggest(pricey.did, { from: pickup, to: pickup }, noon).map((o) => o.ref)).not.toContain(f.freightId);
    const cheap = coupleTipper('CHP', { min: 0.8, max: 1.5 }, 5); // charge 5.1 ≤ 10 → offered
    expect(dispatch.suggest(cheap.did, { from: pickup, to: pickup }, noon).map((o) => o.ref)).toContain(f.freightId);
  });

  it('S34c: claim refuses an over-budget freight (re-coupled to a pricier vehicle) and leaves it available', () => {
    const pickup = { lat: -1.71, lng: 36.41 };
    const noon = new Date('2026-07-22T11:00:00Z').getTime();
    const f = dispatch.registerFreight({ description: 'Cargo', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, bulk: true, maxSpend: 6 });
    const d = drivers.register({ displayName: 'RC', fullName: 'R', nationalId: 'ID-RC', mobile: '+254772000', licenceClasses: ['truck'], licenceNumber: 'L-RC', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const cheap = vehicles.register({ plate: 'RC-CHP', vehicleClass: 'truck', truckSubtype: 'tipper', capacityKg: 20_000, ownerName: 'X', baseFee: 5, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5 }); // charge 5.1 ≤ 6
    const pricey = vehicles.register({ plate: 'RC-EXP', vehicleClass: 'truck', truckSubtype: 'tipper', capacityKg: 20_000, ownerName: 'X', baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5 }); // charge 10.2 > 6
    fleet.couple(d.did, cheap.vehicleId);
    const [offer] = dispatch.suggest(d.did, { from: pickup, to: pickup }, noon);
    expect(offer.ref).toBe(f.freightId); // within budget on the cheap vehicle → offered
    fleet.uncouple(d.did);
    fleet.couple(d.did, pricey.vehicleId); // re-couple to a pricier vehicle AFTER the offer
    expect(() => dispatch.claim(offer.offerId, noon)).toThrow(/budget/i);
    expect(dispatch.listFreight({ status: 'available' }).some((x) => x.freightId === f.freightId)).toBe(true); // stays open
  });

  it('S34c: a driver min-earn filter hides freight paying less than the floor', () => {
    const pickup = { lat: -1.72, lng: 36.42 };
    const noon = new Date('2026-07-22T11:00:00Z').getTime();
    const f = dispatch.registerFreight({ description: 'Cargo', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, bulk: true });
    const d = coupleTipper('ME', { min: 0.8, max: 1.5 }, 10); // earns 10
    expect(dispatch.suggest(d.did, { from: pickup, to: pickup }, noon, 20).map((o) => o.ref)).not.toContain(f.freightId); // floor 20 > 10 → hidden
    expect(dispatch.suggest(d.did, { from: pickup, to: pickup }, noon, 5).map((o) => o.ref)).toContain(f.freightId); // floor 5 < 10 → shown
  });

  it('S34c: a diverted order carries the vendor\'s shipping-policy freight budget', () => {
    const origin = onboardAgent('Budget Origin', 'NorthTown', 50);
    const dest = onboardAgent('Budget Dest', 'NorthTown', 50);
    const vendor = vendors.register({ name: 'CapVendor', shippingPolicy: { maxTransportSpend: 25 } });
    vendors.topUp(vendor.vendorId, 500);
    const res = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700', weightKg: 300, contentPhotoRef: 'c.jpg' } as never, { role: 'genesis', did: vendor.did } as never) as { diverted?: boolean; freight?: { maxSpend?: number } };
    expect(res.diverted).toBe(true);
    expect(res.freight?.maxSpend).toBe(25);
  });

  it('S34c: a zero/negative budget means NO cap (never a load nobody can move)', () => {
    const pickup = { lat: -1.73, lng: 36.43 };
    const base = { description: 'C', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, bulk: true } as const;
    expect(dispatch.registerFreight({ ...base, maxSpend: 0 }).maxSpend).toBeUndefined();
    expect(dispatch.registerFreight({ ...base, maxSpend: -5 }).maxSpend).toBeUndefined();
    expect(vendors.register({ name: 'ZeroCap', shippingPolicy: { maxTransportSpend: 0 } }).shippingPolicy.maxTransportSpend).toBeUndefined();
  });

  // --- S33a: the heavy-cargo safety gate (load-safety checklist + securement photo; unload checklist) ---

  const claimFreight = (did: string, pickup: { lat: number; lng: number }, freightId: string) => {
    const noon = new Date('2026-07-22T11:00:00Z').getTime();
    const offer = dispatch.suggest(did, { from: pickup, to: pickup }, noon).find((o) => o.ref === freightId)!;
    dispatch.claim(offer.offerId, noon);
  };

  it('S33: pickup is refused until the load-safety checklist is complete AND a securement photo is attached', () => {
    const pickup = { lat: -1.8, lng: 36.3 };
    const d = coupleTipper('SG', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Pallets', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, bulk: true });
    claimFreight(d.did, pickup, f.freightId);

    expect(() => dispatch.pickupFreight(f.freightId, d.did)).toThrow(/checklist/i); // nothing confirmed
    expect(() => dispatch.pickupFreight(f.freightId, d.did, { confirmed: ['distributed'], securementPhotoId: 'm' })).toThrow(/checklist/i); // partial
    expect(() => dispatch.pickupFreight(f.freightId, d.did, { confirmed: requiredLoadKeys(f) })).toThrow(/photo/i); // complete but no photo
    expect(dispatch.listFreight({ status: 'claimed' }).some((x) => x.freightId === f.freightId)).toBe(true); // a failed gate never advanced it

    const moved = dispatch.pickupFreight(f.freightId, d.did, { confirmed: requiredLoadKeys(f), securementPhotoId: 'med_secure' });
    expect(moved.status).toBe('in_transit');
    expect(moved.loadSafety?.securementPhotoRef).toBe('med_secure');
    expect(moved.loadSafety?.confirmed).toEqual(expect.arrayContaining(requiredLoadKeys(f)));
  });

  it('S33: delivery is refused until the unload checklist is complete; then it stamps the report and still pays', () => {
    const pickup = { lat: -1.81, lng: 36.31 };
    const d = coupleTipper('UN', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Pallets', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, bulk: true });
    claimFreight(d.did, pickup, f.freightId);
    pickupOk(f, d.did);
    expect(() => dispatch.deliverFreight(f.freightId, d.did)).toThrow(/checklist/i);
    const done = dispatch.deliverFreight(f.freightId, d.did, { confirmed: requiredUnloadKeys() });
    expect(done.status).toBe('delivered');
    expect(done.unloadReport?.confirmed).toEqual(expect.arrayContaining(requiredUnloadKeys()));
    expect(done.driverPaid).toBe(true); // the S34 payout still fires after the gate
  });

  it('S33: a claimed freight carries its cargo model + the exact checklists to the driver', () => {
    const pickup = { lat: -1.82, lng: 36.32 };
    const d = coupleTipper('CL', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, bulk: true });
    claimFreight(d.did, pickup, f.freightId);
    const claim = dispatch.claimsFor(d.did).find((c) => c.ref === f.freightId)!;
    expect(claim.cargoClass).toBe('P4'); // 200 kg
    expect((claim.loadChecklist ?? []).map((i) => i.key)).toContain('contained'); // the bulk item
    expect(claim.unloadChecklist).toHaveLength(4);
  });

  it('S33: the securement photo is linked to the freight at pickup and its retention clock anchored at delivery', () => {
    const pickup = { lat: -1.83, lng: 36.33 };
    const d = coupleTipper('MD', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, bulk: true });
    claimFreight(d.did, pickup, f.freightId);
    const adoptSpy = jest.spyOn(media, 'adopt');
    const anchorSpy = jest.spyOn(media, 'anchorFreightTerminal');
    dispatch.pickupFreight(f.freightId, d.did, { confirmed: requiredLoadKeys(f), securementPhotoId: 'med_real' });
    expect(adoptSpy).toHaveBeenCalledWith('med_real', d.did, { type: 'freight', id: f.freightId }, 'securement');
    dispatch.deliverFreight(f.freightId, d.did, { confirmed: requiredUnloadKeys() });
    expect(anchorSpy).toHaveBeenCalledWith(f.freightId);
    adoptSpy.mockRestore();
    anchorSpy.mockRestore();
  });

  it('S33: a securement id the driver does NOT own is never laundered onto the freight (S29 guard)', () => {
    const pickup = { lat: -1.84, lng: 36.34 };
    const d = coupleTipper('LN', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, bulk: true });
    claimFreight(d.did, pickup, f.freightId);
    // Another actor's media (a 1×1 PNG in the dispute-evidence bin). The driver passes ITS id as the securement.
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const victim = media.upload({ ownerDid: 'did:glos:victim', kind: 'dispute', dataUrl: PNG });
    dispatch.pickupFreight(f.freightId, d.did, { confirmed: requiredLoadKeys(f), securementPhotoId: victim.mediaId });
    const ref = media.get(victim.mediaId)!;
    expect(ref.kind).toBe('dispute'); // NOT re-kinded to securement
    expect(ref.link?.type).not.toBe('freight'); // NOT re-linked to the freight — the victim's evidence is untouched
  });

  // --- S33b: cold-chain temperature monitoring (the first temp-band concept) ---

  it('S33b: a cold-chain freight logs temperatures; an out-of-band reading breaches it (sticky) + flags the tower', () => {
    const pickup = { lat: -1.9, lng: 36.2 };
    const d = coupleReefer('CC');
    const f = dispatch.registerFreight({ description: 'Vaccines', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, bulk: false, natureCode: 'FOP' });
    claimFreight(d.did, pickup, f.freightId);
    pickupOk(f, d.did); // → in_transit

    const r1 = dispatch.recordTemp(f.freightId, 5, d.did); // in-band
    expect(r1.tempBreached).toBeFalsy();
    expect(r1.tempReadings).toHaveLength(1);
    const r2 = dispatch.recordTemp(f.freightId, 12, d.did); // out of band → breach
    expect(r2.tempBreached).toBe(true);
    const r3 = dispatch.recordTemp(f.freightId, 4, d.did); // recovers, but the breach is STICKY
    expect(r3.tempBreached).toBe(true);
    expect(r3.tempReadings).toHaveLength(3);
    expect(r3.tempReadings!.map((t) => t.breach)).toEqual([false, true, false]);

    // The operator watchtower flags the in-transit breach; the buyer sees only the boolean.
    expect(monitor.flags().some((fl) => fl.type === 'Temp_Breach' && fl.subject === f.code)).toBe(true);
    expect(DispatchService.toShipmentView(dispatch.listFreight().find((x) => x.freightId === f.freightId)!).tempBreached).toBe(true);
  });

  it('S33b: recordTemp is refused off in_transit, for a non-cold-chain freight, and by another driver', () => {
    const cold = { lat: -1.91, lng: 36.21 };
    const dr = coupleReefer('RF');
    const cf = dispatch.registerFreight({ description: 'Dairy', pickupLocation: cold, pickupLabel: 'D', destLabel: 'S', destLocation: cold, weightKg: 200, bulk: false, natureCode: 'FOP' });
    claimFreight(dr.did, cold, cf.freightId);
    expect(() => dispatch.recordTemp(cf.freightId, 5, dr.did)).toThrow(/expected in_transit/i); // claimed, not moving yet
    pickupOk(cf, dr.did);
    expect(() => dispatch.recordTemp(cf.freightId, 5, 'did:glos:someone-else')).toThrow(/another driver/i);

    const warm = { lat: -1.95, lng: 36.25 };
    const dt = coupleTipper('WM', { min: 0.8, max: 1.5 });
    const wf = dispatch.registerFreight({ description: 'Gravel', pickupLocation: warm, pickupLabel: 'D', destLabel: 'S', destLocation: warm, weightKg: 200, bulk: true, natureCode: 'GEN' });
    claimFreight(dt.did, warm, wf.freightId);
    pickupOk(wf, dt.did);
    expect(() => dispatch.recordTemp(wf.freightId, 5, dt.did)).toThrow(/temperature-controlled/i); // GEN → no band
  });

  it('S33b: a claimed cold-chain freight shows the driver its safe band + last reading; a plain freight shows none', () => {
    const pickup = { lat: -1.93, lng: 36.23 };
    const d = coupleReefer('BD');
    const f = dispatch.registerFreight({ description: 'Meat', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, bulk: false, natureCode: 'FOP' });
    claimFreight(d.did, pickup, f.freightId);
    pickupOk(f, d.did);
    dispatch.recordTemp(f.freightId, 6, d.did);
    const claim = dispatch.claimsFor(d.did).find((c) => c.ref === f.freightId)!;
    expect(claim.tempBand).toEqual({ minC: 2, maxC: 8 });
    expect(claim.lastTempC).toBe(6);
    expect(claim.tempBreached).toBeFalsy();
  });

  // --- S32: the dedicated-transport lane (equipment manifest + freight cargo model + P4+ divert) ---

  it('S32: a vehicle carries a load/unload equipment manifest (MAN baseline + subtype + declared)', () => {
    expect(vehicles.register({ plate: 'EQ-1', vehicleClass: 'bike', ownerName: 'X' }).equipment).toEqual(['MAN']);
    const crane = vehicles.register({ plate: 'EQ-2', vehicleClass: 'truck', truckSubtype: 'crane', ownerName: 'X' });
    expect(crane.equipment).toEqual(expect.arrayContaining(['MAN', 'CRN'])); // subtype-implied (a Hiab self-loads)
    const declared = vehicles.register({ plate: 'EQ-3', vehicleClass: 'truck', truckSubtype: 'flatbed', ownerName: 'X', equipment: ['TLT', 'PLT'] });
    expect(declared.equipment).toEqual(expect.arrayContaining(['MAN', 'TLT', 'PLT'])); // fleet-declared kit
  });

  it('S32: registered freight gets a cargo model — class + required capability + equipment (discrete vs bulk)', () => {
    const pallet = dispatch.registerFreight({ description: 'Tiles', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'D', destLabel: 'S', weightKg: 200, bulk: false });
    expect(pallet.cargoClass).toBe('P4'); // 200 kg
    expect(pallet.requiredEquipment.length).toBeGreaterThan(0); // discrete → needs handling gear
    const bulk = dispatch.registerFreight({ description: 'Cement 5t', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'D', destLabel: 'S', weightKg: 5000, bulk: true, natureCode: 'HAZ-DUST' });
    expect(bulk.requiredEquipment).toEqual([]); // loose bulk self-loads (tipper/silo) → no handling equipment
    expect(bulk.natureCode).toBe('HAZ-DUST');
  });

  it('S32: a discrete heavy freight is offered only to a vehicle carrying the required equipment', () => {
    const mkTruck = (tag: string, equipment: ('MAN' | 'HTR' | 'PLT' | 'FLT' | 'TLT' | 'CRN' | 'RMP' | 'STR')[]) => {
      const d = drivers.register({ displayName: tag, fullName: tag, nationalId: 'ID-' + tag, mobile: '+2547' + tag, licenceClasses: ['truck'], licenceNumber: 'L-' + tag, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
      drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
      drivers.decideKyc(d.did, true);
      const v = vehicles.register({ plate: 'V-' + tag, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment });
      fleet.couple(d.did, v.vehicleId);
      return d;
    };
    const equipped = mkTruck('EQP', ['TLT']); // a tail-lift can handle a P4 load
    const bare = mkTruck('BAR', []); // MAN only — no lifting gear
    const pallet = dispatch.registerFreight({ description: 'Machinery', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'D', destLabel: 'S', destLocation: { lat: -1.25, lng: 36.85 }, weightKg: 200, bulk: false });
    expect(pallet.requiredEquipment).toContain('TLT');

    const route = { from: { lat: -1.2, lng: 36.8 }, to: { lat: -1.25, lng: 36.85 } };
    expect(dispatch.suggest(equipped.did, route).map((o) => o.ref)).toContain(pallet.freightId); // offered
    expect(dispatch.suggest(bare.did, route).map((o) => o.ref)).not.toContain(pallet.freightId); // filtered out
  });

  it('S32: a P4+ vendor order is DIVERTED into dedicated freight, not minted as a PUDO parcel', () => {
    const origin = onboardAgent('Div Origin', 'NorthTown', 50);
    const dest = onboardAgent('Div Dest', 'NorthTown', 50); // same zone → the non-diverted control order quotes fine
    const vendor = vendors.register({ name: 'PalletVendor' });
    vendors.topUp(vendor.vendorId, 50);

    const diverted: any = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700', weightKg: 300, contentPhotoRef: 'c.jpg', natureCode: 'GEN' } as never, { role: 'genesis', did: vendor.did } as never);
    expect(diverted.diverted).toBe(true);
    expect(diverted.cargoClass).toBe('P5'); // 300 kg
    expect(diverted.freight.freightId).toBeDefined();
    expect(diverted.freight.requiredEquipment.length).toBeGreaterThan(0); // discrete → real handling gear
    expect(diverted.freight.shipperDid).toBe(vendor.vendorId); // the vendor is the shipper

    const normal: any = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700', size: 'M', contentPhotoRef: 'c.jpg' } as never, { role: 'genesis', did: vendor.did } as never);
    expect(normal.diverted).toBeUndefined(); // a normal order still mints a parcel
    expect(normal.parcel).toBeDefined();
  });

  // --- F2: the counter books a too-big walk-up as FREIGHT (cash off-platform, the agent is the originator) ---

  it('F2: the counter books a dedicated walk-up as freight — unpaid cash off-platform, maxSpend=cap, tracking code, agent wallet untouched', () => {
    const origin = onboardAgent('Counter Shop', 'NorthTown', 50); // funded → we can prove the wallet is never billed
    const dest = onboardAgent('Far Shop', 'NorthTown', 0);
    const balBefore = agents.balance(origin.did);

    const res: any = controller.bookFreight(
      { dimensionsCm: { l: 120, w: 100, h: 100 }, weightKg: 200, destPudoDid: dest.did, budgetCap: 40, customerMobile: '+254700900' } as never,
      { role: 'pudo', did: origin.did } as never,
    );
    expect(res.code).toMatch(/^FRT-/);
    expect(res.trackingKey).toBeTruthy();
    expect(res.status).toBe('available'); // immediate
    expect(res.cargoClass).toBe('P4'); // 200 kg discrete
    expect(res.maxSpend).toBe(40); // the cash cap became the ceiling

    const f = dispatch.listFreight().find((x) => x.freightId === res.freightId)!;
    expect(f.shipperDid).toBeUndefined(); // no on-platform shipper → it settles as cash off-platform
    expect(f.pickupLabel).toBe(origin.shopName); // the booking shop is the origin
    expect(f.buyerPhoneHash).toBeTruthy();
    expect(f.buyerPhoneHash).not.toBe('+254700900'); // the customer is joined by HASH, never the cleartext

    // A fit truck claims it: the shipper side is 'unpaid' (never billed to a wallet); the agent's balance is untouched.
    const d = drivers.register({ displayName: 'F2E', fullName: 'F2E', nationalId: 'ID-F2E', mobile: '+2547F2E', licenceClasses: ['truck'], licenceNumber: 'L-F2E', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: 'V-F2E', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'] });
    fleet.couple(d.did, v.vehicleId);
    const [offer] = dispatch.suggest(d.did, { from: origin.location, to: dest.location }).filter((o) => o.ref === res.freightId);
    expect(offer).toBeDefined();
    dispatch.claim(offer.offerId);
    const claimed = dispatch.listFreight().find((x) => x.freightId === res.freightId)!;
    expect(claimed.paidStatus).toBe('unpaid'); // no wallet billed — cash settles off-platform
    expect(agents.balance(origin.did)).toBeCloseTo(balBefore, 2); // the agent's parcel-sized wallet was NOT charged a truck haul
  });

  it('F2: a bus-sized load is refused as freight — take it in as a normal parcel', () => {
    const origin = onboardAgent('Small Shop', 'NorthTown', 50);
    const dest = onboardAgent('Other Shop', 'NorthTown', 0);
    expect(() =>
      controller.bookFreight({ dimensionsCm: { l: 20, w: 20, h: 10 }, weightKg: 1, destPudoDid: dest.did, budgetCap: 40 } as never, { role: 'pudo', did: origin.did } as never),
    ).toThrow(/normal parcel/);
  });

  it('F2: the counter cannot book freight to its own shop', () => {
    const origin = onboardAgent('Self Shop', 'NorthTown', 50);
    expect(() =>
      controller.bookFreight({ dimensionsCm: { l: 120, w: 100, h: 100 }, weightKg: 200, destPudoDid: origin.did, budgetCap: 40 } as never, { role: 'pudo', did: origin.did } as never),
    ).toThrow(/different destination/);
  });

  it('F2: a planned counter freight is scheduled for later (reusing F1); an immediate one is available now', () => {
    const origin = onboardAgent('Plan Shop', 'NorthTown', 50);
    const dest = onboardAgent('Plan Dest', 'NorthTown', 0);
    const tomorrow = new Date(Date.now() + 24 * 3_600_000).toISOString();
    const planned: any = controller.bookFreight({ dimensionsCm: { l: 120, w: 100, h: 100 }, weightKg: 200, destPudoDid: dest.did, budgetCap: 40, scheduledPickupAt: tomorrow, allowEarlyClaim: false } as never, { role: 'pudo', did: origin.did } as never);
    expect(planned.status).toBe('scheduled');
    expect(planned.scheduledPickupAt).toBe(tomorrow); // canonical UTC (already ISO)
    const now: any = controller.bookFreight({ dimensionsCm: { l: 120, w: 100, h: 100 }, weightKg: 200, destPudoDid: dest.did, budgetCap: 40 } as never, { role: 'pudo', did: origin.did } as never);
    expect(now.status).toBe('available');
    expect(now.scheduledPickupAt).toBeUndefined();
  });

  it('F2: a non-operator is pinned to its own shop; an operator may book on behalf of a shop', () => {
    const shopA = onboardAgent('Shop A', 'NorthTown', 50);
    const shopB = onboardAgent('Shop B', 'NorthTown', 50);
    const dest = onboardAgent('Dest Shop', 'NorthTown', 0);
    // A books but names B — the token pin ignores the override: the origin is A (the caller), not B.
    const asA: any = controller.bookFreight({ agentDid: shopB.did, dimensionsCm: { l: 120, w: 100, h: 100 }, weightKg: 200, destPudoDid: dest.did, budgetCap: 40 } as never, { role: 'pudo', did: shopA.did } as never);
    expect(dispatch.listFreight().find((x) => x.freightId === asA.freightId)!.pickupLabel).toBe(shopA.shopName);
    // An operator override books from the named shop.
    const asOp: any = controller.bookFreight({ agentDid: shopB.did, dimensionsCm: { l: 120, w: 100, h: 100 }, weightKg: 200, destPudoDid: dest.did, budgetCap: 40 } as never, { role: 'operator' } as never);
    expect(dispatch.listFreight().find((x) => x.freightId === asOp.freightId)!.pickupLabel).toBe(shopB.shopName);
  });

  // --- F3: consolidation consignments (durable dry commodities) — the bulk analogue of totes ---

  it('F3: opens a durable consolidation lot; refuses a perishable commodity and a non-positive target', () => {
    const owner = onboardAgent('Coop Hub', 'NorthTown', 50);
    const lot = consignments.open({ ownerDid: owner.did, natureCode: 'FOD', pickupLabel: owner.shopName, pickupLocation: owner.location, destLabel: 'Merkato', targetKg: 10000 });
    expect(lot.status).toBe('open');
    expect(lot.code).toMatch(/^LOT-/);
    // A perishable (cold-chain, tempBand != null) can't consolidate — it books freight directly.
    expect(() => consignments.open({ ownerDid: owner.did, natureCode: 'FOP', pickupLabel: owner.shopName, pickupLocation: owner.location, destLabel: 'Merkato', targetKg: 10000 })).toThrow(/perishable/);
    expect(() => consignments.open({ ownerDid: owner.did, natureCode: 'FOD', pickupLabel: owner.shopName, pickupLocation: owner.location, destLabel: 'Merkato', targetKg: 0 })).toThrow(/target/);
  });

  it('F3: deposits accumulate and a FULL lot auto-posts as one bulk, off-platform (no shipper) freight', () => {
    const owner = onboardAgent('Coop Full', 'NorthTown', 50);
    const dest = { lat: -1.28, lng: 36.82 };
    const lot = consignments.open({ ownerDid: owner.did, natureCode: 'FOD', pickupLabel: owner.shopName, pickupLocation: owner.location, destLabel: 'Merkato', destLocation: dest, targetKg: 1000, maxSpend: 200 });
    consignments.deposit(lot.code, 'farmer-A', 400);
    consignments.deposit(lot.code, 'farmer-B', 500);
    expect(consignments.requireByCode(lot.code).status).toBe('open'); // 900 < 1000 → still filling
    const full = consignments.deposit(lot.code, 'farmer-C', 200); // 1100 ≥ 1000 → auto-posts
    expect(full.status).toBe('posted');
    expect(full.freightId).toBeDefined();
    expect(full.weightKg).toBe(1100);
    expect(full.deposits.length).toBe(3);

    const f = dispatch.listFreight().find((x) => x.freightId === full.freightId)!;
    expect(f.bulk).toBe(true); // loose durable commodity → tipper/hopper, no handling equipment
    expect(f.weightKg).toBe(1100);
    expect(f.natureCode).toBe('FOD');
    expect(f.pickupLabel).toBe(owner.shopName); // the coop's site is the pickup
    expect(f.shipperDid).toBeUndefined(); // OFF-PLATFORM — no shipper billed on-platform
    expect(f.maxSpend).toBe(200); // the cash cap rode across to the haul

    // A posted lot is closed to further deposits.
    expect(() => consignments.deposit(lot.code, 'farmer-D', 50)).toThrow(/posted/);
  });

  it('F3: the aged sweep runs from the FIRST DEPOSIT (not open) — posts an aged partial, holds a late-filled or empty lot', () => {
    const owner = onboardAgent('Coop Aged', 'NorthTown', 50);
    const t0 = new Date('2026-07-22T09:00:00Z').getTime();
    const base = { ownerDid: owner.did, natureCode: 'FOD' as const, pickupLabel: owner.shopName, pickupLocation: owner.location, destLabel: 'Merkato', targetKg: 10000 };

    const partial = consignments.open(base, t0);
    consignments.deposit(partial.code, 'farmer-A', 300, t0); // first goods at t0
    const empty = consignments.open(base, t0); // never receives a deposit
    // A standing lot opened at t0 whose FIRST goods only arrive at t0+100h must NOT be force-posted right after.
    const late = consignments.open(base, t0);
    consignments.deposit(late.code, 'farmer-B', 300, t0 + 100 * 3_600_000);

    const posted = consignments.publishReadyConsignments(t0 + 101 * 3_600_000); // 101h after open
    expect(posted).toContain(partial.consignmentId); // its goods waited 101h ≥ 96h → aged out, posts what accumulated
    expect(posted).not.toContain(empty.consignmentId); // empty → nothing to ship, stays open
    expect(posted).not.toContain(late.consignmentId); // goods only 1h old → the deposit gets its full window
    expect(consignments.requireByCode(partial.code).status).toBe('posted');
    expect(consignments.requireByCode(empty.code).status).toBe('open');
    expect(consignments.requireByCode(late.code).status).toBe('open');
  });

  it('F3: consignment endpoints are owner-scoped — another shop cannot deposit into a lot', () => {
    const owner = onboardAgent('Coop Owner', 'NorthTown', 50);
    const other = onboardAgent('Other Shop', 'NorthTown', 50);
    const lot: any = controller.openConsignment({ natureCode: 'FOD', destLabel: 'Merkato', targetKg: 5000 } as never, { role: 'pudo', did: owner.did } as never);
    expect(lot.pickupLabel).toBe(owner.shopName); // the owner's site is resolved as the pickup
    // Another shop cannot deposit into someone else's lot.
    expect(() => controller.depositConsignment(lot.code, { memberRef: 'x', weightKg: 100 } as never, { role: 'pudo', did: other.did } as never)).toThrow(/not yours/);
    // The owner can, and an operator can list on their behalf.
    const after: any = controller.depositConsignment(lot.code, { memberRef: 'farmer-A', weightKg: 100 } as never, { role: 'pudo', did: owner.did } as never);
    expect(after.weightKg).toBe(100);
    const listed: any[] = controller.listConsignments(owner.did, undefined as never, { role: 'operator' } as never) as never;
    expect(listed.some((l) => l.code === lot.code)).toBe(true);
  });

  it('F3: a co-op lot is collected where the CROP is, not at the counter that owns it', () => {
    const owner = onboardAgent('Coop Owner', 'NorthTown', 50);
    const shed = { lat: 6.61, lng: 38.41 }; // the co-op store, some way out of town

    // Both ends are address-less: the truck loads at the shed and delivers to a market. The pin the shop
    // placed is what the haul is priced between — and what decides which drivers hear about it.
    const lot: any = controller.openConsignment(
      { natureCode: 'FOD', pickupLabel: 'Aleta Wondo co-op store', pickupLocation: shed, destLabel: 'Merkato', targetKg: 1000 } as never,
      { role: 'pudo', did: owner.did } as never,
    );
    expect(lot.pickupLabel).toBe('Aleta Wondo co-op store');
    expect(lot.pickupLocation).toEqual(shed);

    // A NAMED site with no pin that the gazetteer does not recognise falls back to the shop's own pin: a
    // best-guess centroid would send a truck further astray than the counter, which is at least a real place.
    const unknown: any = controller.openConsignment(
      { natureCode: 'FOD', pickupLabel: 'the third shed past the river', destLabel: 'Merkato', targetKg: 1000 } as never,
      { role: 'pudo', did: owner.did } as never,
    );
    expect(unknown.pickupLabel).toBe('the third shed past the river'); // the humans still get the name
    expect(unknown.pickupLocation).toEqual(owner.location);

    // And the freight the lot becomes is picked up THERE — the coordinate the drivers are matched on.
    consignments.deposit(lot.code, 'farmer-A', 1200); // full → auto-posts
    const posted = consignments.requireByCode(lot.code);
    expect(posted.status).toBe('posted');
    expect(dispatch.listFreight().find((f) => f.freightId === posted.freightId)?.pickupLocation).toEqual(shed);
  });

  // --- the DECLARED LEG: where the driver says this shift is going ---

  it('declares the leg at coupling, remembers the road, and matches loads to the heading — not just to how near', () => {
    const hawassa = { lat: 7.06, lng: 38.47 };
    const addis = { lat: 9.03, lng: 38.74 };
    const arbaMinch = { lat: 6.03, lng: 37.55 }; // the other way out of Hawassa
    const d = coupleTipper('leg', { min: 0.8, max: 1.5 });
    const vehicleId = drivers.get(d.did).assignedVehicleId!;
    fleet.uncouple(d.did); // coupleTipper already coupled; re-couple declaring where we are going

    const asg = fleet.couple(d.did, vehicleId, undefined, { fromLabel: 'Hawassa', from: hawassa, toLabel: 'Addis', to: addis });
    expect(asg.work).toMatchObject({ fromLabel: 'Hawassa', toLabel: 'Addis' });

    // A pickup ON the road is worth telling them about; one down the OTHER road is not — both are equally
    // near the driver, which is exactly why proximity alone was never the question.
    expect(dispatch.worksNear(d.did, { lat: 8.0, lng: 38.6 })).toBe(true);
    expect(dispatch.worksNear(d.did, arbaMinch)).toBe(false);

    // The road is remembered for next time — a driver who must name two places every morning stops declaring.
    expect(fleet.recentLegs(d.did)[0]).toMatchObject({ fromLabel: 'Hawassa', toLabel: 'Addis' });

    // Turning round mid-shift is the normal case, not a correction.
    fleet.declareLeg(d.did, { fromLabel: 'Addis', from: addis, toLabel: 'Hawassa', to: hawassa });
    expect(fleet.workFor(d.did)).toMatchObject({ fromLabel: 'Addis', toLabel: 'Hawassa' });
    expect(fleet.recentLegs(d.did).map((l) => l.toLabel)).toEqual(['Hawassa', 'Addis']); // newest first, both kept

    // Re-running the SAME road moves it back to the top rather than stacking a duplicate.
    fleet.declareLeg(d.did, { fromLabel: 'Hawassa', from: hawassa, toLabel: 'Addis', to: addis });
    expect(fleet.recentLegs(d.did).map((l) => l.toLabel)).toEqual(['Addis', 'Hawassa']);

    // A driver who has declared NOTHING is never silenced — we cannot say they are not heading there.
    const quiet = coupleTipper('quiet', { min: 0.8, max: 1.5 });
    expect(dispatch.worksNear(quiet.did, arbaMinch)).toBe(true);
  });

  it('a rider declares a PATCH, not a road — and the patch travels with them', () => {
    const town = { lat: 7.06, lng: 38.47 };
    const acrossTown = { lat: 7.09, lng: 38.47 }; // ~3.3 km north
    const nextTown = { lat: 7.3, lng: 38.47 }; // ~27 km north
    const rider = coupleTipper('patch', { min: 0.8, max: 1.5 });

    fleet.declareArea(rider.did, 5);
    expect(fleet.workFor(rider.did)).toMatchObject({ kind: 'area', radiusKm: 5 });

    // Standing in town, work across town is theirs; the next town is not. No destination was ever named —
    // for a bajaj there is no "on the way", only how far they must ride to fetch it.
    fleet.reportLocation(rider.did, town);
    expect(dispatch.worksNear(rider.did, acrossTown)).toBe(true);
    expect(dispatch.worksNear(rider.did, nextTown)).toBe(false);

    // Ride to the next town and the patch comes along — the same load is now theirs, with nothing re-declared.
    fleet.reportLocation(rider.did, nextTown);
    expect(dispatch.worksNear(rider.did, nextTown)).toBe(true);
    expect(dispatch.worksNear(rider.did, town)).toBe(false);

    // A radius is a distance a person can ride, not a number a form will take on trust.
    expect(() => fleet.declareArea(rider.did, 0)).toThrow(/between 1 and/);
    expect(() => fleet.declareArea(rider.did, 500)).toThrow(/between 1 and/);
    // …and declaring a road afterwards replaces the patch: a day has ONE shape at a time.
    fleet.declareLeg(rider.did, { fromLabel: 'Town', from: town, toLabel: 'Next', to: nextTown });
    expect(fleet.workFor(rider.did)).toMatchObject({ kind: 'leg' });
  });

  it('snoozes NEW offers without touching the load already on the bike', () => {
    const origin = onboardAgent('Snooze Origin', 'NorthTown', 50);
    corridors.addCorridor({ name: 'snooze', originZone: 'NorthTown', destZone: 'SouthTown' });
    const rider = coupleTipper('snooze', { min: 0.8, max: 1.5 });
    const bagAt = (parcelId: string) => {
      parcels.accept({ agentDid: origin.did, parcelId, size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
      const bag = totes.register(origin.did);
      totes.assign(bag.code, 'SouthTown', 'SouthTown');
      mdps.fillTote(bag.code, parcelId);
      dispatch.release(bag.code);
      return bag;
    };
    const mine = bagAt('SNZ-1');
    const other = bagAt('SNZ-2');

    // Claim one, then stop for lunch.
    const [offer] = dispatch.suggestNearby(rider.did, origin.location, 5);
    expect(offer.ref).toBe(mine.code);
    dispatch.claim(offer.offerId);
    controller.snoozeWork(rider.did, { minutes: 30 } as never);

    // The marketplace goes quiet on ALL surfaces at once — they share the gate, so they cannot disagree.
    expect(dispatch.suggestNearby(rider.did, origin.location, 5)).toEqual([]);
    expect(dispatch.suggest(rider.did, { from: origin.location, to: { lat: origin.location.lat - 1, lng: origin.location.lng } })).toEqual([]);
    expect(dispatch.offerNear(rider.did, origin.location)).toBeNull();

    // …but the bag they are already carrying is still theirs. Snoozing offers is not going off shift.
    expect(dispatch.claimsFor(rider.did).map((c) => c.ref)).toContain(mine.code);
    expect(mdps.loadBag(mine.code, drivers.get(rider.did).badgeId!).moved).toEqual(['SNZ-1']);

    // It ends when they say…
    controller.resumeWork(rider.did);
    expect(dispatch.suggestNearby(rider.did, origin.location, 5).map((o) => o.ref)).toContain(other.code);

    // …or on its own, so a snooze nobody remembers cannot cost them an afternoon.
    fleet.snooze(rider.did, 30);
    expect(fleet.acceptingWork(rider.did)).toBe(false);
    expect(fleet.acceptingWork(rider.did, Date.now() + 31 * 60_000)).toBe(true);
    // Reading it as expired CLEARS it, so the driver's screen and the matcher can never disagree.
    expect(fleet.sessionFor(rider.did)).toMatchObject({ assignment: { snoozedUntil: undefined } });

    // And it cannot outlive the shift: a new day never starts snoozed.
    fleet.snooze(rider.did);
    fleet.uncouple(rider.did);
    fleet.couple(rider.did, drivers.get(rider.did).assignedVehicleId ?? vehicles.list().find((v) => v.plate === 'MK-SNOOZE')!.vehicleId);
    expect(fleet.acceptingWork(rider.did)).toBe(true);
  });

  it('finds work AROUND a rider, sorted by how far they must ride, and stops at their radius', () => {
    const near = onboardAgent('Patch Near', 'NorthTown', 50);
    const far = onboardAgent('Patch Far', 'NorthTown', 50);
    corridors.addCorridor({ name: 'patch', originZone: 'NorthTown', destZone: 'SouthTown' });
    // ~9 km apart as the crow flies, ~12 km by road (the router's circuity) — outside a 5 km patch, inside 15.
    agents.setLocation(far.did, { lat: near.location.lat + 0.08, lng: near.location.lng });
    const rider = coupleTipper('find', { min: 0.8, max: 1.5 });

    const bagAt = (agentDid: string, parcelId: string) => {
      parcels.accept({ agentDid, parcelId, size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
      const bag = totes.register(agentDid);
      totes.assign(bag.code, 'SouthTown', 'SouthTown');
      mdps.fillTote(bag.code, parcelId);
      dispatch.release(bag.code);
      return bag;
    };
    const here = bagAt(near.did, 'PATCH-1');
    const yonder = bagAt(far.did, 'PATCH-2');

    const offers = dispatch.suggestNearby(rider.did, near.location, 5);
    expect(offers.map((o) => o.ref)).toEqual([here.code]); // the far one is outside the patch, not "a long detour"
    expect(offers[0].detourKm).toBe(0); // for a rider this is the ride to fetch it, and it is at their feet

    // Widen the patch and the far load becomes theirs — the rider decides how far they will go, within reason.
    const wide = dispatch.suggestNearby(rider.did, near.location, MAX_WORK_RADIUS_KM).map((o) => o.ref);
    expect(wide).toEqual([here.code, yonder.code]); // nearest first: the ride is the whole cost for a rider
    // An absurd radius is CLAMPED, not honoured. A patch is a district someone can actually ride; a rider
    // asking for 200 km is asking for the line-haul marketplace, and should declare a road instead.
    expect(dispatch.suggestNearby(rider.did, near.location, 200).map((o) => o.ref)).toEqual(wide);
  });

  it('offers the ONE load a moving driver is about to pass — and nothing they are heading away from', () => {
    const origin = onboardAgent('Nudge Origin', 'NorthTown', 50);
    const far = onboardAgent('Nudge Far', 'EastTown', 50);
    corridors.addCorridor({ name: 'nudge', originZone: 'NorthTown', destZone: 'SouthTown' });
    const d = coupleTipper('nudge', { min: 0.8, max: 1.5 });

    const bagAt = (agentDid: string, parcelId: string, zone: string) => {
      parcels.accept({ agentDid, parcelId, size: 'S', destZone: zone, senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
      const bag = totes.register(agentDid);
      totes.assign(bag.code, zone, zone);
      mdps.fillTote(bag.code, parcelId);
      dispatch.release(bag.code);
      return bag;
    };
    const near = bagAt(origin.did, 'NUDGE-1', 'SouthTown');

    // Standing at the shop, that bag is the one worth interrupting for — and the offer is MINTED, so the
    // pop-up has a price, a card to open and something to claim.
    const offer = dispatch.offerNear(d.did, origin.location);
    expect(offer).toMatchObject({ ref: near.code, kind: 'tote', driverDid: d.did, status: 'pending' });

    // Asked again, it is the SAME offer — a driver is never asked twice about one load at two prices.
    expect(dispatch.offerNear(d.did, origin.location)?.offerId).toBe(offer!.offerId);

    // A load down the road they are NOT taking stays silent (the declared leg, reused).
    const east = { lat: origin.location.lat, lng: origin.location.lng + 0.6 }; // a long way off a southbound run
    agents.setLocation(far.did, east);
    fleet.declareLeg(d.did, { fromLabel: 'North', from: origin.location, toLabel: 'South', to: { lat: origin.location.lat - 2, lng: origin.location.lng } });
    bagAt(far.did, 'NUDGE-2', 'EastTown');
    expect(dispatch.offerNear(d.did, east)).toBeNull();
  });

  it('declines from the lock screen with a one-shot capability that can do nothing else', () => {
    const origin = onboardAgent('Decline Origin', 'NorthTown', 50);
    corridors.addCorridor({ name: 'decline', originZone: 'NorthTown', destZone: 'SouthTown' });
    const d = coupleTipper('decl', { min: 0.8, max: 1.5 });
    parcels.accept({ agentDid: origin.did, parcelId: 'DECL-1', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
    const bag = totes.register(origin.did);
    totes.assign(bag.code, 'SouthTown', 'SouthTown');
    mdps.fillTote(bag.code, 'DECL-1');
    dispatch.release(bag.code);

    const offer = dispatch.offerNear(d.did, origin.location)!;
    const token = dispatch.mintDeclineToken(offer.offerId);

    // It declines exactly that offer, freeing the load for someone else the moment the driver says no.
    expect(controller.declineOffer({ token } as never)).toMatchObject({ offerId: offer.offerId, status: 'ignored' });
    // …and then it is spent. A capability that could be replayed is a capability worth stealing.
    expect(() => controller.declineOffer({ token } as never)).toThrow(/already been used/);
    expect(() => controller.declineOffer({ token: 'made-up' } as never)).toThrow(/already been used|expired/);
  });

  it('a bus runs out of BAG SPACES long before it runs out of kilos', () => {
    const origin = onboardAgent('Bagspace Origin', 'NorthTown', 200);
    const dest = onboardAgent('Bagspace Dest', 'SouthTown', 200);
    corridors.addCorridor({ name: 'bagspace', originZone: 'NorthTown', destZone: 'SouthTown' });

    // A conductor's bus: 500 kg, and a boot that holds two bags for this test.
    const d = drivers.register({ displayName: 'Conductor', fullName: 'C C', nationalId: 'ID-bus-cap', mobile: '+254900bus', licenceClasses: ['bus'], licenceNumber: 'L-bus', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const bus = vehicles.register({ plate: 'BUS-CAP', vehicleClass: 'bus', capacityKg: 500, toteCapacity: 2, ownerName: 'Owner' });
    fleet.couple(d.did, bus.vehicleId);

    // Three bags of letters. By WEIGHT all three fit many times over — that was the whole problem.
    const bags = ['A', 'B', 'C'].map((tag) => {
      parcels.accept({ agentDid: origin.did, parcelId: `LET-${tag}`, size: 'S', destZone: 'SouthTown', destPudoDid: dest.did, senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
      const bag = mdps.openShopBag(origin.did, 'SouthTown');
      mdps.fillShopBag(bag.code, origin.did, `LET-${tag}`);
      mdps.sealShopBag(bag.code, origin.did, { acknowledgeShortShip: true, shortShipReason: 'one per bag for the test' });
      agents.setBagBays(origin.did, 9); // the shop's floor is not what this test is about
      return bag;
    });
    expect(dispatch.remainingCapacity(d.did)).toBeGreaterThan(400); // kilos are nowhere near the limit
    expect(dispatch.remainingTotes(d.did)).toBe(2);

    const claimBag = (code: string) => {
      const offer = dispatch.suggest(d.did, { from: origin.location, to: dest.location }).find((o) => o.ref === code);
      return offer ? dispatch.claim(offer.offerId) : undefined;
    };
    expect(claimBag(bags[0].code)).toBeTruthy();
    expect(claimBag(bags[1].code)).toBeTruthy();
    expect(dispatch.remainingTotes(d.did)).toBe(0);

    // The third is not even OFFERED — the list stops promising what the boot cannot take.
    expect(dispatch.suggest(d.did, { from: origin.location, to: dest.location }).some((o) => o.ref === bags[2].code)).toBe(false);

    // And the physical scan refuses it too: a full boot is full whatever the scales say.
    const badge = drivers.get(d.did).badgeId!;
    expect(() => mdps.loadBag(bags[2].code, badge)).toThrow(/all 2 bag\(s\) it holds/);
    // A bag this driver already RESERVED is not charged for the space twice.
    expect(mdps.loadBag(bags[0].code, badge).moved).toEqual(['LET-A']);
  });

  it('offers the vehicles this driver has driven before — the day starts at a coffee table, not at the bus', () => {
    const d = coupleTipper('picker', { min: 0.8, max: 1.5 });
    const mine = drivers.get(d.did).assignedVehicleId!;
    fleet.uncouple(d.did);

    // Driving one is what puts it on the list; nothing else does.
    const listed: any[] = fleet.recentVehicles(d.did);
    expect(listed.map((v) => v.vehicleId)).toEqual([mine]);
    expect(listed[0]).toMatchObject({ busy: false, plate: expect.any(String), capacityKg: 20_000 });

    // Naming a known vehicle starts the day exactly as scanning its dashboard would.
    const asg: any = controller.startSession(d.did, { vehicleId: mine } as never);
    expect(asg.vehicleId).toBe(mine);
    expect(() => controller.startSession(d.did, {} as never)).toThrow(/Scan the vehicle QR/);

    // Someone else on shift with it is SHOWN and marked, not hidden — "where is my bus?" deserves an answer.
    const other = drivers.register({ displayName: 'Other', fullName: 'O O', nationalId: 'ID-other-pick', mobile: '+2547other', licenceClasses: ['truck'], licenceNumber: 'L-o', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(other.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(other.did, true);
    fleet.uncouple(d.did); // our driver hands it back at the end of the day…
    fleet.couple(other.did, mine); // …and it goes out with someone else
    expect(fleet.recentVehicles(other.did)[0]).toMatchObject({ vehicleId: mine, busy: true });
    expect(() => controller.startSession(d.did, { vehicleId: mine } as never)).toThrow(/already coupled/i);
  });

  it('refuses a leg that is off shift, or half-named', () => {
    const d = coupleTipper('legbad', { min: 0.8, max: 1.5 });
    const here = { lat: 7.06, lng: 38.47 };
    expect(() => fleet.declareLeg(d.did, { fromLabel: 'Hawassa', from: here, toLabel: '  ', to: here })).toThrow(/needs a start and an end/);
    expect(() => fleet.declareLeg(d.did, { fromLabel: 'Hawassa', from: here, toLabel: 'Addis', to: { lat: Number.NaN, lng: 38.7 } })).toThrow(/needs a point for each end/);
    fleet.uncouple(d.did);
    expect(() => fleet.declareLeg(d.did, { fromLabel: 'Hawassa', from: here, toLabel: 'Addis', to: here })).toThrow(/Start a shift/);
  });

  it('F3: a FILLING lot is advisory — a driver can plan around it, and cannot claim it', () => {
    const owner = onboardAgent('Coop Owner', 'NorthTown', 50);
    const shed = { lat: owner.location.lat + 0.02, lng: owner.location.lng + 0.02 };
    const lot: any = controller.openConsignment(
      { natureCode: 'FOD', pickupLabel: 'Co-op store', pickupLocation: shed, destLabel: 'Merkato', destLocation: { lat: owner.location.lat + 3, lng: owner.location.lng + 3 }, targetKg: 1000 } as never,
      { role: 'pudo', did: owner.did } as never,
    );
    const truck = coupleTipper('fore', { min: 0.8, max: 1.5 });
    const route = { from: owner.location, to: { lat: owner.location.lat + 3, lng: owner.location.lng + 3 } };

    // An EMPTY lot is an intention, not a load — nothing to plan around.
    expect((controller.suggestWork(truck.did, route as never) as any).expected).toEqual([]);

    consignments.deposit(lot.code, 'farmer-A', 300); // 30% of a truckload, still open
    const res: any = controller.suggestWork(truck.did, route as never);
    expect(res.expected).toHaveLength(1);
    expect(res.expected[0]).toMatchObject({ kind: 'consignment', code: lot.code, weightKg: 300, targetKg: 1000, fillPct: 30, pickupLabel: 'Co-op store' });
    // Nothing claimable rides on it: no offer, no ref — a driver plans, the co-op promises nothing.
    expect(res.expected[0].offerId).toBeUndefined();
    expect(res.expected[0].ref).toBeUndefined();
    expect(res.offers.some((o: any) => o.pickupLabel === 'Co-op store')).toBe(false);
    // It names the LATEST it can go — the aged-out date the sweep will enforce, not a guess.
    expect(new Date(res.expected[0].readyBy).getTime()).toBeGreaterThan(Date.now());

    // Once it posts, it leaves the advisory list and becomes ordinary claimable freight.
    consignments.deposit(lot.code, 'farmer-B', 800); // → full → posts
    const after: any = controller.suggestWork(truck.did, route as never);
    expect(after.expected).toEqual([]);
    expect(after.offers.some((o: any) => o.pickupLabel === 'Co-op store')).toBe(true);
  });

  // --- REP2: an AGENT rates a DRIVER on the movement leg (verified interaction, one-per-pair, driver profile) ---

  const mkFleetDriver = (tag: string) => {
    const corridor = corridors.addCorridor({ name: `RC-${tag}`, originZone: 'NorthTown', destZone: 'SouthTown' });
    const d = coupleTipper(tag, { min: 0.8, max: 1.5 });
    fleet.assignCorridor(d.did, corridor.corridorId);
    return { d, badge: drivers.get(d.did).badgeId! };
  };
  const handOff = (agent: { did: string }, badge: string, parcelId: string) => {
    parcels.accept({ agentDid: agent.did, parcelId, size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'r.jpg' } as never);
    parcels.handover({ agentDid: agent.did, driverBadgeId: badge, parcelIds: [parcelId] } as never);
  };

  it('REP2: an agent rates a driver it served (issues + stars); the driver gets a PII-free profile; a stranger is refused', () => {
    const agent = onboardAgent('Rating Shop', 'NorthTown', 50);
    const { d, badge } = mkFleetDriver('RD1');
    handOff(agent, badge, 'QR-RD1');

    const res: any = controller.rateDriver(d.did, { stars: 2, issues: ['LATE_PICKUP', 'EQUIPMENT_FAILURE', 'LATE_PICKUP'] } as never, { role: 'pudo', did: agent.did } as never);
    expect(res.driverComposite).toBe(2);
    expect(res.rating.issues.slice().sort()).toEqual(['EQUIPMENT_FAILURE', 'LATE_PICKUP']); // deduped + validated
    expect(rating.driverRating(d.did)).toMatchObject({ average: 2, count: 1, isNew: true });

    // The driver's PUBLIC profile resolves — display name + rating only, never PII.
    const profile = controller.reputationProfile(d.did) as Record<string, unknown> & { rating: { count: number } };
    expect(profile.kind).toBe('driver');
    expect(profile.name).toBeTruthy();
    expect(profile.rating.count).toBe(1);
    expect(profile.nationalId).toBeUndefined();
    expect(profile.licenceNumber).toBeUndefined();
    expect(profile.mobile).toBeUndefined();

    // A shop that never dealt with this driver cannot rate them (a badge is not a secret).
    const stranger = onboardAgent('Stranger Shop', 'NorthTown', 50);
    expect(() => controller.rateDriver(d.did, { stars: 5 } as never, { role: 'pudo', did: stranger.did } as never)).toThrow(/handed parcels to|received/);
  });

  it('REP2: one rating per agent↔driver pair (last-wins); the composite averages across agents', () => {
    const a1 = onboardAgent('Coop A1', 'NorthTown', 50);
    const a2 = onboardAgent('Coop A2', 'NorthTown', 50);
    const { d, badge } = mkFleetDriver('RD2');
    handOff(a1, badge, 'QR-A1');
    handOff(a2, badge, 'QR-A2');

    controller.rateDriver(d.did, { stars: 4 } as never, { role: 'pudo', did: a1.did } as never);
    controller.rateDriver(d.did, { stars: 2 } as never, { role: 'pudo', did: a1.did } as never); // a1 revises — last-wins, not a 2nd vote
    expect(rating.driverRating(d.did)).toMatchObject({ average: 2, count: 1 });
    controller.rateDriver(d.did, { stars: 4 } as never, { role: 'pudo', did: a2.did } as never); // a2 adds → avg (2+4)/2
    expect(rating.driverRating(d.did)).toMatchObject({ average: 3, count: 2 });
  });

  it('REP2: the DEST shop that receives a parcel can rate the carrying driver (the bag-receipt half of the gate)', () => {
    const origin = onboardAgent('Origin Shop', 'NorthTown', 50);
    const dest = onboardAgent('Dest Shop', 'SouthTown', 50);
    const { d, badge } = mkFleetDriver('RD3'); // corridor NorthTown → SouthTown
    parcels.accept({ agentDid: origin.did, parcelId: 'QR-DEST', size: 'M', destZone: 'SouthTown', destPudoDid: dest.did, senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'r.jpg' } as never);
    parcels.handover({ agentDid: origin.did, driverBadgeId: badge, parcelIds: ['QR-DEST'] } as never);
    // The DEST shop (the one that receives the driver's late bag) can rate them — the interaction is proven by
    // the parcel it is the destination of, carried by this driver.
    const res: any = controller.rateDriver(d.did, { stars: 3, issues: ['KEPT_OVERNIGHT'] } as never, { role: 'pudo', did: dest.did } as never);
    expect(res.driverComposite).toBe(3);
    expect(rating.driverRating(d.did).count).toBe(1);

    // The fix that makes the bag path work: an On_Bus leg stamps the carrying driver's badge onto the parcel
    // (a bag-carried parcel used to keep it undefined, so the dest shop could never prove the interaction).
    parcels.accept({ agentDid: origin.did, parcelId: 'QR-BAG', size: 'M', destZone: 'SouthTown', destPudoDid: dest.did, senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'r.jpg' } as never);
    parcels.setTransit('QR-BAG', 'On_Bus', badge, 'bag leg');
    expect(parcels.get('QR-BAG').driverBadgeId).toBe(badge);
  });

  // --- REP3: DERIVED reputation — a FLEET (aggregate of its drivers) + an MDP hub (operational scorecard) ---

  const activateManager = (name: string, n: string) => {
    const m = managers.register({ companyName: name, contactPhone: `+2548${n}`, ownerFullName: `O${n}`, ownerNationalId: `MGR-${n}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-${n}`, transportOperatorLicence: `TOL-${n}`, taxId: `TAX-${n}` } } as never);
    managers.submitKyc(m.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'a' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    return m;
  };
  const mkManagedDriver = (mgrDid: string, tag: string) =>
    drivers.register({ displayName: tag, fullName: tag, nationalId: `ND-${tag}`, mobile: `+2547${tag}`, licenceClasses: ['motorcycle'], criminalRecordClear: true, managerDid: mgrDid } as never);

  it('REP3: a FLEET inherits the count-weighted aggregate of its drivers ratings', () => {
    const mgr = activateManager('Speedy Freight', 'R3');
    const d1 = mkManagedDriver(mgr.did, 'FD1');
    const d2 = mkManagedDriver(mgr.did, 'FD2');
    rating.rateDriver({ driverDid: d1.did, byAgentDid: 'a1', stars: 4 });
    rating.rateDriver({ driverDid: d1.did, byAgentDid: 'a2', stars: 2 }); // d1: sum 6, count 2
    rating.rateDriver({ driverDid: d2.did, byAgentDid: 'a1', stars: 3 }); // d2: sum 3, count 1

    const fr = rating.fleetRating(mgr.did, [d1.did, d2.did]);
    expect(fr.average).toBe(3); // (6+3)/(2+1) — count-weighted, not a mean-of-means
    expect(fr.count).toBe(3);

    const profile = controller.reputationProfile(mgr.did) as Record<string, unknown> & { rating: { average: number }; memberCount: number };
    expect(profile.kind).toBe('fleet');
    expect(profile.name).toBe('Speedy Freight');
    expect(profile.rating.average).toBe(3);
    expect(profile.memberCount).toBe(2);
  });

  it('REP3: an MDP hub resolves a derived operational scorecard (an empty hub reads clean)', () => {
    const hub = mdps.register({ name: 'Central Hub', zones: ['NorthTown'], location: { lat: -1.2, lng: 36.8 } });
    expect(monitor.mdpScorecard(hub.mdpId)).toEqual({ handling: 0, stuck: 0, onTimeRate: 1 });
    const profile = controller.reputationProfile(hub.did) as Record<string, unknown> & { scorecard: { onTimeRate: number } };
    expect(profile.kind).toBe('mdp');
    expect(profile.name).toBe('Central Hub');
    expect(profile.scorecard.onTimeRate).toBe(1);
  });

  // --- REP4: the ENFORCING guard — a below-floor driver loses the freight marketplace (recoverably) ---

  it('REP4: a below-floor driver is barred from freight (suggest withholds, claim refuses); cold-start exempt; recoverable', () => {
    const pickup = { lat: -1.2, lng: 36.8 };
    const dest = { lat: -1.25, lng: 36.85 };
    const d = coupleTipper('R4', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: dest, weightKg: 100, bulk: true });

    // Cold-start: one bad rating does NOT bar — the driver still sees + can grab freight.
    rating.rateDriver({ driverDid: d.did, byAgentDid: 'a1', stars: 1 });
    const [coldOffer] = dispatch.suggest(d.did, { from: pickup, to: dest }).filter((o) => o.ref === f.freightId);
    expect(coldOffer).toBeDefined();

    // Push the RELIABLE rating below the floor (3 × 1★ → avg 1.0, count 3, no longer cold-start).
    rating.rateDriver({ driverDid: d.did, byAgentDid: 'a2', stars: 1 });
    rating.rateDriver({ driverDid: d.did, byAgentDid: 'a3', stars: 1 });
    expect(dispatch.suggest(d.did, { from: pickup, to: dest }).some((o) => o.ref === f.freightId)).toBe(false); // freight withheld
    expect((controller.suggestWork(d.did, { from: pickup, to: dest } as never) as { freightPaused: boolean }).freightPaused).toBe(true); // live verdict for the app's note
    expect(() => dispatch.claim(coldOffer.offerId)).toThrow(/network minimum|paused/i); // stale offer refused too

    // Recoverable: enough good ratings pull the average back over the floor → freight returns.
    for (const a of ['a4', 'a5', 'a6', 'a7']) rating.rateDriver({ driverDid: d.did, byAgentDid: a, stars: 5 }); // (3 + 20)/7 ≈ 3.29 ≥ 2.5
    expect(dispatch.suggest(d.did, { from: pickup, to: dest }).some((o) => o.ref === f.freightId)).toBe(true);
  });

  it('REP4: the operator reputation-review queue lists providers below the floor', () => {
    const d = coupleTipper('R4B', { min: 0.8, max: 1.5 });
    for (const a of ['a1', 'a2', 'a3']) rating.rateDriver({ driverDid: d.did, byAgentDid: a, stars: 1 }); // avg 1, count 3
    const review = controller.reputationReview() as { belowFloor: Array<{ did: string; kind: string }> };
    expect(review.belowFloor.some((x) => x.did === d.did && x.kind === 'driver')).toBe(true);
  });

  it('S32: claim() re-checks bulk — a re-coupled non-bulk vehicle cannot reserve a bulk freight', () => {
    const d = drivers.register({ displayName: 'BLK', fullName: 'B', nationalId: 'ID-BLK', mobile: '+254900101', licenceClasses: ['truck', 'van'], licenceNumber: 'L-BLK', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const tipper = vehicles.register({ plate: 'BT-1', vehicleClass: 'truck', truckSubtype: 'tipper', capacityKg: 10_000, ownerName: 'X' }); // carriesBulk true
    const van = vehicles.register({ plate: 'VN-9', vehicleClass: 'van', ownerName: 'X' }); // carriesBulk false
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'D', destLabel: 'S', destLocation: { lat: -1.25, lng: 36.85 }, weightKg: 100, bulk: true });

    fleet.couple(d.did, tipper.vehicleId);
    const [offer] = dispatch.suggest(d.did, { from: { lat: -1.2, lng: 36.8 }, to: { lat: -1.25, lng: 36.85 } });
    expect(offer?.ref).toBe(f.freightId); // a bulk-capable truck IS offered the bulk load
    fleet.uncouple(d.did);
    fleet.couple(d.did, van.vehicleId);
    expect(() => dispatch.claim(offer.offerId)).toThrow(/capability|equipment/i); // the van can't carry bulk
    expect(dispatch.listFreight({ status: 'available' }).some((x) => x.freightId === f.freightId)).toBe(true); // stays free
  });

  // --- S32c: site equipment profiles (both-ends gap, advisory) + the classify cargo-class signal ---

  it('S32c: flags a SITE equipment gap for discrete heavy freight — advisory, per end', () => {
    const base = { description: 'Pallet', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'D', destLabel: 'S' } as const;
    // A P4 discrete load needs a qualifying piece (HTR/PLT/TLT/RMP) at EACH end.
    const gapAtDest = dispatch.registerFreight({ ...base, weightKg: 200, bulk: false, originEquipment: ['MAN', 'PLT'], destEquipment: ['MAN'] });
    expect(gapAtDest.equipmentGaps).toEqual(['dest']); // origin has a pallet jack, destination only manual
    const equipped = dispatch.registerFreight({ ...base, weightKg: 200, bulk: false, originEquipment: ['MAN', 'TLT'], destEquipment: ['MAN', 'RMP'] });
    expect(equipped.equipmentGaps).toEqual([]); // both ends carry a P4-qualifying piece (tail-lift / ramp)
    const bulk = dispatch.registerFreight({ ...base, weightKg: 5000, bulk: true, originEquipment: ['MAN'], destEquipment: ['MAN'] });
    expect(bulk.equipmentGaps).toEqual([]); // loose bulk self-loads → no handling gear → no gap
    const unknown = dispatch.registerFreight({ ...base, weightKg: 200, bulk: false }); // a geo-only bulletin freight
    expect(unknown.equipmentGaps).toEqual([]); // site equipment unknown → nothing to flag
  });

  it('S32c: a diverted P4+ order flags an equipment gap at PUDOs that cannot handle it', () => {
    const origin = onboardAgent('Gap Origin', 'NorthTown', 50); // a plain shop → MAN only
    const dest = onboardAgent('Gap Dest', 'NorthTown', 50);
    const vendor = vendors.register({ name: 'GapVendor' });
    vendors.topUp(vendor.vendorId, 50);
    const res: any = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700', weightKg: 300, contentPhotoRef: 'c.jpg' } as never, { role: 'genesis', did: vendor.did } as never);
    expect(res.diverted).toBe(true);
    expect(res.freight.equipmentGaps.slice().sort()).toEqual(['dest', 'origin']); // neither shop can lift a pallet
  });

  it('S32c: size/classify returns the cargo class + whether it needs dedicated freight', () => {
    const light: any = controller.classify({ l: 20, w: 20, h: 10, kg: 1 } as never);
    expect(light.cargoClass).toBe('P0');
    expect(light.dedicated).toBe(false);
    const heavy: any = controller.classify({ l: 120, w: 100, h: 100, kg: 300 } as never);
    expect(heavy.dedicated).toBe(true); // P5 → dedicated freight
  });

  it('S32d: a diverted order stays in the buyer\'s shipments with a tracking key + a growing timeline', () => {
    const origin = onboardAgent('Ship Origin', 'NorthTown', 50);
    const dest = onboardAgent('Ship Dest', 'NorthTown', 50);
    const vendor = vendors.register({ name: 'ShipVendor' });
    vendors.topUp(vendor.vendorId, 50);
    const buyer = '+254700123456';
    const res: any = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: buyer, externalOrderId: 'ORD-99', weightKg: 300, contentPhotoRef: 'c.jpg' } as never, { role: 'genesis', did: vendor.did } as never);
    expect(res.diverted).toBe(true);
    expect(res.freight.trackingKey).toMatch(/^T-/);

    // The buyer (by phone hash) finds their freight in "my shipments" — just created so far.
    const mine = dispatch.freightsForPhoneHash(hashPhone(buyer));
    expect(mine).toHaveLength(1);
    expect(mine[0].code).toBe(res.freight.code);
    expect(mine[0].externalOrderId).toBe('ORD-99');
    expect(mine[0].timeline.map((t: { status: string }) => t.status)).toEqual(['available']);

    // A driver claims → picks up → delivers; the buyer's timeline grows with each step.
    const d = drivers.register({ displayName: 'FT', fullName: 'F', nationalId: 'ID-FT', mobile: '+254900202', licenceClasses: ['truck'], licenceNumber: 'L-FT', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'FT-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'] });
    fleet.couple(d.did, truck.vehicleId);
    const [offer] = dispatch.suggest(d.did, { from: origin.location, to: { lat: -1.3, lng: 36.95 } });
    dispatch.claim(offer.offerId);
    pickupOk(res.freight, d.did);
    deliverOk(res.freight, d.did);

    const done = dispatch.freightsForPhoneHash(hashPhone(buyer))[0];
    expect(done.status).toBe('delivered');
    expect(done.timeline.map((t: { status: string }) => t.status)).toEqual(['available', 'claimed', 'in_transit', 'delivered']);
  });

  it('serves the operator dashboard KPIs (M7 light)', () => {
    const a = onboardAgent('Dash Shop', 'NorthTown', 20);
    parcels.accept({ agentDid: a.did, parcelId: 'QR-D', size: 'S', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'd.jpg' });
    const d = monitor.dashboard();
    expect(d.agentsTotal).toBeGreaterThanOrEqual(1);
    expect(d.systemFloat).toBeGreaterThan(0);
    expect(d.statusMix.At_PUDO).toBeGreaterThanOrEqual(1);
    expect(monitor.finance().systemFloat).toBe(d.systemFloat);
  });
});
