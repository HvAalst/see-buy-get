import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { WalletGateService } from './wallet-gate.service';
import { CorridorService } from './corridor.service';
import { ParcelService } from './parcel.service';
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
import { FleetManagerService } from './fleet-manager.service';
import { AccountService } from './account.service';
import { OtpService } from './otp.service';
import { PersonService } from './person.service';
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
  let managers: FleetManagerService;
  let accounts: AccountService;
  let otp: OtpService;
  let persons: PersonService;
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
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, ToteService, VehicleService, DriverService, FleetService, DispatchService, FleetManagerService, AccountService, OtpService, PersonService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, AuthService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    agents = moduleRef.get(AgentService);
    gate = moduleRef.get(WalletGateService);
    corridors = moduleRef.get(CorridorService);
    parcels = moduleRef.get(ParcelService);
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
    managers = moduleRef.get(FleetManagerService);
    accounts = moduleRef.get(AccountService);
    otp = moduleRef.get(OtpService);
    persons = moduleRef.get(PersonService);
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

    // Public track stays sanitized — steps, NOT the handover collection code.
    const view = parcels.track(parcel.trackingKey!);
    expect(view.steps.length).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toContain(parcel.collectionCode);
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
    dispatch.pickupFreight(f.freightId);
    expect(dispatch.deliverFreight(f.freightId).status).toBe('delivered');
    expect(dispatch.remainingCapacity(d.did)).toBe(10_000); // released
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
