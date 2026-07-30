import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { WalletGateService } from './wallet-gate.service';
import { CorridorService } from './corridor.service';
import { ParcelService } from './parcel.service';
import { CargoService } from './cargo.service';
import { SbgController } from './pudo.controller';
import { MediaService } from './media.service';
import { MonitorService } from './monitor.service';
import { RatingService } from './rating.service';
import { GraduationService } from './graduation.service';
import { VendorService } from './vendor.service';
import { VendorCallbackService } from './vendor-callback.service';
import { ShelfService } from './shelf.service';
import { RoutingService } from './routing.service';
import { MdpService } from './mdp.service';
import { ToteService } from './tote.service';
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
import { createHmac } from 'crypto';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { AuthService } from '../../foundation/auth/auth.service';
import { DidService } from '../../foundation/did/did.service';
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
  let vehicles: VehicleService;
  let drivers: DriverService;
  let fleet: FleetService;
  let dispatch: DispatchService;
  let marketPulse: MarketPulseService;
  let marketStore: MarketPulseStore;
  let controller: SbgController;
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
  let vault: IdentityVault;
  let core: OperationalStore;
  let events: EventBus;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, ToteService, VehicleService, DriverService, FleetService, DispatchService, MarketPulseStore, MarketPulseService, FleetManagerService, AccountService, OtpService, PersonService, InviteService, MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, AuthService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
      controllers: [SbgController],
    }).compile();
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
    vehicles = moduleRef.get(VehicleService);
    drivers = moduleRef.get(DriverService);
    fleet = moduleRef.get(FleetService);
    dispatch = moduleRef.get(DispatchService);
    marketPulse = moduleRef.get(MarketPulseService);
    marketStore = moduleRef.get(MarketPulseStore);
    controller = moduleRef.get(SbgController);
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
    vault = moduleRef.get(IdentityVault);
    core = moduleRef.get(OperationalStore);
    events = moduleRef.get(EventBus);
  });

  let agentSeq = 0;
  const eligibleReqs = () => ({ androidVersion: 13, reliablePower: true, tradingLicence: 'TL-100', criminalRecordClear: true });
  const uniformHours = (open = '08:00', close = '18:00') => ({ mon: { open, close }, tue: { open, close }, wed: { open, close }, thu: { open, close }, fri: { open, close }, sat: { open, close }, sun: null });
  const defaultShelf = { rows: 3, cols: 3 }; // 9 slots
  const kycDocs = { idCopyRef: 'id.jpg', tradingLicenceRef: 'licence.pdf', shopPhotoRefs: ['shop-1.jpg'] };

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
    parcels.pickup('QR-S1', dest.did, arr.otp);
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

    const arrival = parcels.arrive('QR-0001', dest.did);
    expect(arrival.otp).toMatch(/^\d{4}$/);
    const delivered = parcels.pickup('QR-0001', dest.did, arrival.otp, 'delivered.jpg');
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
    const { otp } = parcels.arrive('QR-LOCK', origin.did);
    const wrong = otp === '0000' ? '1111' : '0000';

    for (let i = 0; i < 4; i++) expect(() => parcels.pickup('QR-LOCK', origin.did, wrong)).toThrow('Incorrect OTP');
    expect(() => parcels.pickup('QR-LOCK', origin.did, wrong)).toThrow('Too many wrong codes');
    // Locked: even the correct code is refused until an operator reissues.
    expect(() => parcels.pickup('QR-LOCK', origin.did, otp)).toThrow('Too many wrong codes');
    expect(parcels.get('QR-LOCK').status).toBe('Ready_For_Pickup');
  });

  it("enforces 'no money, no scan': draining the wallet locks the agent (lite NFR-SSE-01)", () => {
    const a = onboardAgent('Broke Shop', 'NorthTown', 3.2); // exactly two cash parcels
    parcels.accept({ agentDid: a.did, parcelId: 'QR-A', size: 'S', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'a.jpg' });
    expect(agents.get(a.did).status).toBe('ACTIVE'); // balance 1.60 → still scannable
    parcels.accept({ agentDid: a.did, parcelId: 'QR-B', size: 'S', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'b.jpg' });
    expect(agents.get(a.did).status).toBe('LOCKED'); // balance 0 → locked
    const gateState = gate.canTransact(a.did);
    expect(gateState.ok).toBe(false); // legacy alias
    expect(gateState.canTransact).toBe(false);
    expect(gateState.code).toBe('WALLET_INSUFFICIENT'); // a low-literacy UI maps this to the top-up icon
    expect(gateState.shortfall).toBeGreaterThan(0);
    expect(() => parcels.accept({ agentDid: a.did, parcelId: 'QR-C', size: 'S', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'c.jpg' })).toThrow();
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
    parcels.pickup('QR-R', origin.did, arr.otp);

    const r = rating.rate({ parcelId: 'QR-R', stars: 5, raterMobile: '+2' });
    expect(r.agentComposite).toBe(5);
    expect(core.get(origin.did)?.reputationScore).toBe(5); // written back to the GLOS operational core
    expect(rating.agentRating(origin.did).count).toBe(1);
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
    parcels.pickup('QR-G', dest.did, arr.otp);
    await flush();
    await flush();

    // M4 has a real anchored timeline; both editions on one spine.
    const tl = tracking.getTimeline('QR-G');
    expect(tl.events.some((e) => e.type === 'PICKUP')).toBe(true);
    expect(tl.currentState).toBe('DELIVERED');
    expect(twin.shipment('QR-G')?.state).toBe('delivered');
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
    const { otp } = parcels.arrive('PEER-1', dest.did);
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
    const { otp } = parcels.arrive('MED-1', dest.did);
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
    const { otp } = parcels.arrive('DSP-1', dest.did);
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

    // The twin carries NO PII — neither mobile appears anywhere in it — but does carry a status timeline.
    const view = parcels.consumerParcel('S21-1', hashPhone(sender));
    const json = JSON.stringify(view);
    expect(json).not.toContain('811');
    expect(json).not.toContain('822');
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
    const res = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700', weightKg: 300, contentPhotoRef: 'c.jpg' } as never) as { diverted?: boolean; freight?: { maxSpend?: number } };
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

    const diverted: any = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700', weightKg: 300, contentPhotoRef: 'c.jpg', natureCode: 'GEN' } as never);
    expect(diverted.diverted).toBe(true);
    expect(diverted.cargoClass).toBe('P5'); // 300 kg
    expect(diverted.freight.freightId).toBeDefined();
    expect(diverted.freight.requiredEquipment.length).toBeGreaterThan(0); // discrete → real handling gear
    expect(diverted.freight.shipperDid).toBe(vendor.vendorId); // the vendor is the shipper

    const normal: any = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700', size: 'M', contentPhotoRef: 'c.jpg' } as never);
    expect(normal.diverted).toBeUndefined(); // a normal order still mints a parcel
    expect(normal.parcel).toBeDefined();
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
    const res: any = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700', weightKg: 300, contentPhotoRef: 'c.jpg' } as never);
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
    const res: any = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: buyer, externalOrderId: 'ORD-99', weightKg: 300, contentPhotoRef: 'c.jpg' } as never);
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
