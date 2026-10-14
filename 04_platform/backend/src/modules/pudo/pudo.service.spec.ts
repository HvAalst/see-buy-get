import { StreamableFile } from '@nestjs/common';
import { ConsignmentNoteService } from './consignment-note.service';
import { DepartureNoteService } from './departure-note.service';
import { pdfDataUrl } from '../../foundation/entity/company.test-util';
import { NoteArchiveService } from './note-archive.service';
import { NoteBundleService } from './note-bundle.service';
import { DestinationService } from './destination.service';
import { MAIL_SENDER } from '../../foundation/mail/mail.types';
import { OutboxMailSender } from '../../foundation/mail/outbox-mail.sender';
import { MailService } from '../../foundation/mail/mail.service';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { HandleService } from '../../foundation/entity/../handle/handle.service';
import { HandleDirectory } from './handle-directory.service';
import { BusinessService } from './business.service';
import { BusinessMemberGuard } from './business-member.guard';
import { BusinessClientService } from './business-client.service';
import { BorderRuleService } from './border-rules.service';
import { CompanyReadinessService } from '../../foundation/entity/company-readiness.service';
import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { GazetteerGeocoder, GEOCODER } from './geocoder';
import { HeuristicRouter, ROUTER } from './router';
import { WalletGateService, agentLedgerSummaryOf } from './wallet-gate.service';
import { CorridorService } from './corridor.service';
import { DamageReportService, fingerprintOf, termsSentence } from './damage-report.service';
import { FREIGHT_REPORT_ONLY_NOTE } from './dispatch.service';
import { DAMAGE_REPORT_STATEMENT } from './damage-report.types';
import { canonicalJson } from './note-archive.types';
import { LINK_DAYS, LINK_MAX_LIVE, LINK_MAX_OPENS } from './document-link.service';
import { paysItself, REPORT_ONLY_NOTE, ParcelService, birthplaceOf, custodianOf, custodyAt, labelDate, ownershipOf } from './parcel.service';
import { MAX_WORK_RADIUS_KM, OTP_MAX_ATTEMPTS, PICKUP_FEE, RELEASE_FEE, SHELVING_FEE, TOTE_LOAD_FEE, TRADE_CREDIT_LIMIT, TRADE_CREDIT_PARCELS, WHOLESALE } from './pudo.config';
import { AMOUNT_KEYS, DEFAULT_AMOUNTS } from './amounts';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { CargoService } from './cargo.service';
import { SbgController } from './pudo.controller';
import { IS_PUBLIC_KEY } from '../../foundation/auth/public.decorator';
import { IdentityController } from './identity.controller';
import { MediaService } from './media.service';
import { PapersWatchService } from './papers-watch.service';
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
import { ImportService } from './import.service';
import { SiteService } from './site.service';
import { TransitAuthorityService } from './transit-authority.service';
import { FieldObservationService } from './field-observation.service';
import { ContainerBoxService } from './container-box.service';
import { EmptyDepotService } from './empty-depot.service';
import { ContactCardService } from './contact-card.service';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { DispatchService, driverJobRowOf, driverJobsToCsv, fleetJobsToCsv, lockedCurrencyOf } from './dispatch.service';
import { RouteConstraintService } from './route-constraint.service';
import { MarketPulseStore } from './market-pulse.store';
import { MarketPulseService } from './market-pulse.service';
import { shipperCharge } from './pricing';
import { requiredLoadKeys, requiredUnloadKeys } from './heavy-cargo';
import { FleetManagerService } from './fleet-manager.service';
import { FleetMoveService } from './fleet-move.service';
import { FleetOfferService } from './fleet-offer.service';
import { EmailCodeService } from './email-code.service';
import { AccountRecoveryService } from './account-recovery.service';
import { AccountService } from './account.service';
import { OtpService } from './otp.service';
import { PersonService } from './person.service';
import { InviteService } from './invite.service';
import { hashPhone } from '../../foundation/identity/phone';
import { SCOPES_KEY } from '../../foundation/auth/scopes.decorator';
import { createHash, createHmac } from 'crypto';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { AuthService } from '../../foundation/auth/auth.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { EntityAdminService } from '../../foundation/entity/entity-admin.service';
import { OperatorAccountService } from '../../foundation/entity/operator-account.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { InterestService } from '../../foundation/interest/interest.service';
import { DepartureService } from './departure.service';
import { BooksService } from '../../foundation/books/books.service';
import { FxService } from '../../foundation/money/fx.service';
import { BagPlanService } from './bag-plan.service';
import { ForthcomingService } from './forthcoming.service';
import { DockService } from './dock.service';
import { ApiKeyService } from './api-key.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { ReturnService } from './return.service';
import { UnclaimedService } from './unclaimed.service';
import { MerchantRatingService } from './merchant-rating.service';
import { SandboxPayoutRail } from '../../foundation/payouts/sandbox-rail.adapter';
import { PAYOUT_RAIL } from '../../foundation/payouts/payout.types';
import { FundingService } from '../../foundation/funding/funding.service';
import { FundingPayerRegistrar } from './funding-payers';
import { SandboxFundingRail } from '../../foundation/funding/sandbox-funding-rail.adapter';
import { FUNDING_RAIL } from '../../foundation/funding/funding.types';
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
  let mailOutbox: OutboxMailSender;
  let mailSvc: MailService;
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
  let presence: PresenceService;
  let borders: BorderRuleService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, DamageReportService, RoutingService, MdpService, BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, ImportService, SiteService, TransitAuthorityService, FieldObservationService, ContainerBoxService, EmptyDepotService, ContactCardService, VehicleService, DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService, FleetMoveService, FleetOfferService, EmailCodeService, AccountRecoveryService, AccountService, OtpService, PersonService, InviteService, MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, AuthService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus, EntityService, EntityAdminService, OperatorAccountService, ConsignmentNoteService, DepartureNoteService, NoteArchiveService, NoteBundleService, DestinationService, MailService, OutboxMailSender, { provide: MAIL_SENDER, useExisting: OutboxMailSender }, PresenceService, InterestService, DepartureService, CompanyDocumentService, HandleService, HandleDirectory, BusinessService, BusinessMemberGuard, BusinessClientService, CompanyReadinessService, BorderRuleService, BooksService, FxService, ApiKeyService,
        PayoutService, ReturnService, UnclaimedService, MerchantRatingService, SandboxPayoutRail, { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail },
        FundingService, FundingPayerRegistrar, SandboxFundingRail, { provide: FUNDING_RAIL, useExisting: SandboxFundingRail },
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
    presence = moduleRef.get(PresenceService);
    borders = moduleRef.get(BorderRuleService);
    moduleRef.get(FxService).seed(); // same reason as the entity seed: compile() runs no lifecycle hooks
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
    mailOutbox = moduleRef.get(OutboxMailSender);
    mailSvc = moduleRef.get(MailService);
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

  /**
   * THE FLOAT IS NOT ONE NUMBER, and the day it stopped being one nobody would have noticed.
   *
   * Every shop's wallet is money the network holds in advance, denominated in the currency of the sister
   * that shop belongs to. Adding a shilling balance to a birr balance produces a figure denominated in
   * nothing — the exact failure the money model refuses everywhere else, and the one the operator
   * console refuses when it puts two companies side by side and declines to total the columns.
   *
   * It was one number for as long as there was one country, and it silently stopped being correct the
   * day a second sister existed.
   */
  describe('what the network holds in shop floats', () => {
    const abroad = (shopName: string) => {
      agentSeq += 1;
      const a = agents.register({
        shopName,
        zone: 'Addis',
        country: 'ET',
        location: { lat: 9.03, lng: 38.74 },
        landmark: 'by the roundabout',
        openingHours: uniformHours(),
        shelf: defaultShelf,
        fullName: `${shopName} owner`,
        nationalId: `ID-ET-${agentSeq}`,
        mobile: `+2519${agentSeq}`,
        deviceImei: `IMEI-ET-${agentSeq}`,
        requirements: eligibleReqs(),
      } as never);
      agents.submitKyc(a.did, kycDocs);
      agents.decideKyc(a.did, true);
      return agents.get(a.did);
    };

    it('writes each line of a shop’s register in the money of the books it was posted to — another company’s shop in its own', () => {
      // Every line was stamped with the network’s money: right for a Kenyan shop, and “KES” beside a birr amount for a
      // shop of another company — on its screen, in its totals and in every export.
      const home = onboardAgent('Nairobi Ledger Shop', 'NorthTown', 100);
      const et = abroad('Addis Ledger Shop');
      gate.topUp(et.did, 250);
      expect([...new Set(gate.entries({ did: home.did }).map((e) => e.currency))]).toEqual(['KES']);
      expect([...new Set(gate.entries({ did: et.did }).map((e) => e.currency))]).toEqual(['ETB']);
      expect(gate.agentLedgerSummary(et.did, {} as never)).toMatchObject({ currency: 'ETB', in: 250 });
      expect(gate.agentLedgerCsv(et.did, {} as never).split('\n')[1]).toContain(',ETB,');
      // A shop with nothing on its register yet is still in its own money.
      expect(gate.agentLedgerSummary(abroad('Addis Quiet Shop').did, {} as never)).toMatchObject({ currency: 'ETB', count: 0 });
      expect(gate.agentLedgerSummary(home.did, {} as never).currency).toBe('KES');
    });

    it('sets a shop’s price per parcel beside the shops in its own money, and says which', () => {
      // A circle drawn near a border reaches shops of another company: a median of shillings and birr is a number about
      // nothing, and the button beside it would have set this shop’s price to it.
      const asShop = (did: string) => ({ active: true, role: 'agent', did }) as never;
      const ratesFor = (actor: unknown) => controller.pricingNear(actor as never, 'pudo') as { currency?: string; benchmark: { count: number; min: number; max: number }; pins: { id: string }[] };
      const home = onboardAgent('Nairobi Rate Shop', 'NorthTown', 100);
      agents.setPrice(home.did, 7);
      const ets = [abroad('Addis Rate Shop A'), abroad('Addis Rate Shop B')];
      ets.forEach((s, i) => {
        gate.topUp(s.did, 4000);
        agents.setPrice(s.did, 300 + i * 100);
      });
      expect(ets.map((s) => agents.get(s.did).status)).toEqual(['ACTIVE', 'ACTIVE']);

      const inBirr = ratesFor(asShop(ets[0].did));
      expect(inBirr.currency).toBe('ETB');
      expect(inBirr.pins.map((p) => p.id)).not.toContain(home.did);
      expect(inBirr.pins.map((p) => p.id)).toEqual(expect.arrayContaining(ets.map((s) => s.did)));
      expect(inBirr.benchmark.min).toBeGreaterThanOrEqual(300);

      const inShillings = ratesFor(asShop(home.did));
      expect(inShillings.currency).toBe('KES');
      expect(inShillings.pins.map((p) => p.id)).toContain(home.did);
      expect(inShillings.pins.map((p) => p.id)).not.toContain(ets[0].did);
      expect(inShillings.benchmark.max).toBeLessThan(300);
    });

    it('refuses to add up register lines in two moneys rather than give a figure in nothing', () => {
      const line = (currency: string) => ({ id: currency, type: 'TOP_UP', sign: '+', amount: 10, currency, reference: 'r', refType: 'bank', at: '2026-10-14T00:00:00Z' }) as never;
      expect(agentLedgerSummaryOf([line('KES'), line('KES')])).toMatchObject({ in: 20, currency: 'KES' });
      expect(() => agentLedgerSummaryOf([line('KES'), line('ETB')])).toThrow(/more than one money \(KES, ETB\)/);
    });

    it('reports one float PER CURRENCY, and never one total across them', () => {
      const home = onboardAgent('Nairobi Float Shop', 'NorthTown', 100);
      const et = abroad('Addis Float Shop');
      gate.topUp(et.did, 250);

      const floats = gate.floats();
      const kes = floats.find((f) => f.currency === 'KES');
      const etb = floats.find((f) => f.currency === 'ETB');
      expect(etb).toEqual({ currency: 'ETB', amount: 250 });
      // The home shop's own top-up is in there, along with whatever the rest of this suite has funded.
      expect(kes?.amount).toBeGreaterThanOrEqual(100);
      expect(agents.balance(home.did)).toBe(100);
      // One entry per currency, never two rows for one money and never one row for two.
      expect(new Set(floats.map((f) => f.currency)).size).toBe(floats.length);
    });

    it('gives the single-figure caller ONE currency rather than a mixture', () => {
      // `float()` is what a place that can hold only one number gets. It is the HOME currency's float,
      // not a sum — so birr appearing in the network moves it by exactly nothing.
      const before = gate.float();
      const et = abroad('Addis Second Shop');
      gate.topUp(et.did, 4000);
      expect(gate.float()).toBe(before);
      expect(gate.floats().find((f) => f.currency === 'ETB')?.amount).toBeGreaterThanOrEqual(4000);
    });
  });

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

  /**
   * A REFUSAL CARRIES A REASON — the rule the claims queue already obeys, arriving late here.
   *
   * Rejecting sent a shop back to DRAFT and said nothing, which left it indistinguishable from a shop
   * that had never sent anything: the chase list reported no missing documents (the rejected refs were
   * still on the record), the applicant was told neither the decision nor what was wrong, and
   * `submitKyc` only accepts a full set from DRAFT, so they could not replace one bad licence anyway.
   */
  it('refuses to reject a shop without saying why', () => {
    const a = agents.register({ shopName: 'No Reason', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'gate', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'R K', nationalId: 'ID-R', mobile: '+254700444', deviceImei: 'IMEI-R', requirements: eligibleReqs() });
    agents.submitKyc(a.did, kycDocs);
    expect(() => agents.decideKyc(a.did, false)).toThrow(/why/i);
    expect(() => agents.decideKyc(a.did, false, 'ops', '   ')).toThrow(/why/i);
    // Refused, so the application is untouched and still awaiting a decision.
    expect(agents.get(a.did).status).toBe('KYC_PENDING');
  });

  it('records a rejection, clears the papers, and makes the shop chaseable as REJECTED', () => {
    const a = agents.register({ shopName: 'Second Look', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'gate', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'S L', nationalId: 'ID-S', mobile: '+254700555', deviceImei: 'IMEI-S', requirements: eligibleReqs() });
    agents.submitKyc(a.did, kycDocs);
    const rejected = agents.decideKyc(a.did, false, 'ops', 'The trading licence had expired.');
    expect(rejected.status).toBe('DRAFT');
    expect(rejected.kycRejection).toMatchObject({ reason: 'The trading licence had expired.', by: 'ops' });
    // The papers are CLEARED, or the chase list reads "nothing missing" for a shop that cannot proceed
    // and `submitKyc` (DRAFT + a full set only) gives them no way to send a replacement.
    expect(rejected.kyc).toBeUndefined();
    const row = agents.unfinished().find((r) => r.did === a.did);
    expect(row).toMatchObject({ reason: 'was-rejected', rejectedWhy: 'The trading licence had expired.', told: false });
    expect(row?.missing).toEqual(['id', 'licence', 'photos']);
    // The applicant can be told, and the event that tells them carries the reason.
    expect(events.getLog().some((e) => e.type === GlosEvent.Pudo.AgentKycRejected)).toBe(true);

    // They send a fresh set and are approved: the old refusal stops being the news.
    agents.submitKyc(a.did, kycDocs);
    expect(agents.decideKyc(a.did, true).kycRejection).toBeUndefined();
  });

  it('publishes a registration so the applicant can be told what is still needed', () => {
    // Nothing used to fire here, so nobody could be told anything at the one moment they are certain to
    // be holding the phone — and a form that answers with silence reads as "submitted, now wait".
    const a = agents.register({ shopName: 'Told Now', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'gate', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'T N', nationalId: 'ID-T', mobile: '+254700666', deviceImei: 'IMEI-T', requirements: eligibleReqs() });
    expect(events.getLog().some((e) => e.type === GlosEvent.Pudo.AgentRegistered)).toBe(true);
    expect(agents.unfinished().find((r) => r.did === a.did)).toMatchObject({ reason: 'needs-documents', told: false });
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
    const before = agents.balance(a.did)!;
    parcels.accept({ agentDid: a.did, parcelId: 'QR-V', size: 'M', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'v.jpg' });
    expect(agents.balance(a.did)!).toBeCloseTo(before - 1.6, 2);
    const voided = parcels.void('QR-V', a.did, 'torn-label.jpg');
    expect(voided.status).toBe('Voided');
    expect(agents.balance(a.did)!).toBeCloseTo(before, 2); // refunded
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
    // Not staff either: an order minted in a store's name bills that store, and staff bill nobody's float for them.
    const before = { parcels: parcels.list({ vendorId: mine.vendorId }).length, float: vendors.balanceOrNone(mine.vendorId) };
    expect(() => controller.createInbound(dto, { role: 'operator' } as never)).toThrow('A store makes its own changes, signed in as that store. Staff read a store under Stores and change nothing in its name');
    expect({ parcels: parcels.list({ vendorId: mine.vendorId }).length, float: vendors.balanceOrNone(mine.vendorId) }).toEqual(before);
  });

  /**
   * THE USER, 2026-10-12: "better that staff does not have that door to make changes."
   *
   * A staff sign-in passed the gate on every one of a store's own routes, the ones that change it as much as the
   * ones that read it — and what it changed there carried no name. Each route that changes a store is tried here
   * as staff, with what the store itself would send, and the store is read afterwards to see nothing moved.
   */
  it('staff change nothing in a store’s name: every route that changes a store refuses a staff sign-in, by name, and the store is as it was', () => {
    const origin = onboardAgent('Door O', 'NorthTown', 50);
    const dest = onboardAgent('Door D', 'SouthTown', 50);
    corridors.addCorridor({ name: 'Door N-S', originZone: 'NorthTown', destZone: 'SouthTown' });
    const store = vendors.register({ name: 'Door Store', callbackUrl: 'https://door.example/hook', secret: 'whsec_door' });
    const asStore = { active: true, role: 'genesis', did: store.did, scopes: [] } as never;
    const staff = { active: true, role: 'operator', sub: 'operator:opr_door', actorName: 'Amina Otieno', scopes: ['*'] } as never;
    vendors.topUp(store.vendorId, 100);
    // What the store has, made by the store: a key, an order not yet paid for would need no float — so one paid order.
    const key = controller.issueApiKey(store.vendorId, { kind: 'secret', mode: 'live' } as never, asStore) as { keyId: string };
    const order = { vendorId: store.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700', size: 'M', contentPhotoRef: 'c.jpg' } as never;
    const { parcel } = controller.createInbound(order, asStore) as { parcel: { parcelId: string } };
    const asItIs = () => ({
      record: JSON.stringify(vendors.get(store.vendorId)),
      keys: JSON.stringify(controller.listApiKeys(store.vendorId, asStore)),
      parcels: parcels.list({ vendorId: store.vendorId }).length,
      checkouts: vendors.checkoutsFor(store.vendorId, true).length,
    });
    const before = asItIs();

    const REFUSED = 'A store makes its own changes, signed in as that store. Staff read a store under Stores and change nothing in its name';
    const tries: Array<[string, () => unknown]> = [
      ['its address and what it charges', () => controller.updateVendor(store.vendorId, { callbackUrl: 'https://staff.example/hook' } as never, staff)],
      ['its signing secret', () => controller.rotateVendorSecret(store.vendorId, { secret: 'whsec_door' } as never, staff)],
      ['a new key', () => controller.issueApiKey(store.vendorId, { kind: 'secret', mode: 'live' } as never, staff)],
      ['revoking a key', () => controller.revokeApiKey(store.vendorId, key.keyId, staff)],
      ['a dock', () => controller.setCollectionPoint(store.vendorId, { label: 'Gate 1', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, bays: 2 } as never, staff)],
      ['closing its dock', () => controller.clearCollectionPoint(store.vendorId, staff)],
      ['a bag at its dock', () => controller.openDockBag(store.vendorId, { destZone: 'SouthTown' } as never, staff)],
      ['filling a bag', () => controller.fillDockBag(store.vendorId, 'BAG-X', { parcelIds: [parcel.parcelId] } as never, staff)],
      ['sealing a bag', () => controller.sealDockBag(store.vendorId, 'BAG-X', {} as never, staff)],
      ['a checkout', () => controller.captureCheckout(store.vendorId, { destPudoDid: dest.did, buyerMobile: '+254700111222' } as never, staff)],
      ['a payment in its name', () => controller.topUpVendor(store.vendorId, { amount: 500 } as never, staff)],
      ['an order billed to its float', () => controller.createInbound(order, staff)],
      ['settling a shipment against its float', () => controller.settleParcel(parcel.parcelId, staff)],
      ['yes to a return', () => controller.acceptReturn(store.vendorId, 'off_x', staff)],
      ['no to a return', () => controller.declineReturn(store.vendorId, 'off_x', { reason: 'no' } as never, staff)],
    ];
    for (const [what, attempt] of tries) expect({ what, said: (() => { try { attempt(); return 'DONE'; } catch (e) { return (e as Error).message; } })() }).toEqual({ what, said: REFUSED });
    expect(tries).toHaveLength(15);
    expect(asItIs()).toEqual(before);

    // What staff keep is READING, and the same store's own sign-in still changes it.
    expect(controller.getVendor(store.vendorId, staff)).toMatchObject({ vendorId: store.vendorId, callbackUrl: 'https://door.example/hook' });
    expect(controller.storeDesk(store.vendorId)).toMatchObject({ vendorId: store.vendorId });
    expect(controller.updateVendor(store.vendorId, { callbackUrl: 'https://door.example/hook2' } as never, asStore)).toMatchObject({ callbackUrl: 'https://door.example/hook2' });
    // A stranger is told it is not theirs; an unknown store is not found, whoever asks.
    expect(() => controller.updateVendor(store.vendorId, {} as never, { active: true, role: 'genesis', did: 'did:glos:another-store' } as never)).toThrow('This store is not yours to change');
    expect(() => controller.updateVendor('ven_nobody', {} as never, staff)).toThrow(/not found/i);
  });

  it('a parcel knows where it was BORN and who has HELD it — the two facts a status trail cannot give', () => {
    const origin = onboardAgent('Birth Shop', 'NorthTown', 50);
    const dest = onboardAgent('Birth Dest', 'SouthTown', 50);
    const corridor = corridors.addCorridor({ name: 'birth', originZone: 'NorthTown', destZone: 'SouthTown' });
    const driver = drivers.register({ displayName: 'Bea', fullName: 'Bea B', nationalId: 'ID-birth', mobile: '+254birth', licenceClasses: ['motorcycle'] });
    const bike = vehicles.register({ plate: 'BR-1', vehicleClass: 'motorcycle', ownerName: 'Bea' });
    fleet.couple(driver.did, bike.vehicleId);
    fleet.assignCorridor(driver.did, corridor.corridorId);
    const badge = drivers.get(driver.did).badgeId!;

    parcels.accept({ agentDid: origin.did, parcelId: 'BIRTH-1', size: 'S', destZone: 'SouthTown', destPudoDid: dest.did, senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });

    // Born at the counter — a place, with a name and a point, not merely "an origin agent id".
    expect(birthplaceOf(parcels.get('BIRTH-1'))).toMatchObject({ kind: 'counter', atId: origin.did, label: 'Birth Shop', location: origin.location });

    // …and held by that shop from the same moment.
    expect(custodianOf(parcels.get('BIRTH-1'))).toMatchObject({ holderKind: 'shop', holderId: origin.did });

    parcels.handover({ agentDid: origin.did, driverBadgeId: badge, parcelIds: ['BIRTH-1'] });
    const onBus = custodianOf(parcels.get('BIRTH-1'))!;
    // The chain names the DRIVER, not the badge that was scanned: a badge is a token, a DID is who answers.
    expect(onBus).toMatchObject({ holderKind: 'driver', holderId: driver.did });

    parcels.arrive('BIRTH-1', dest.did);
    expect(custodianOf(parcels.get('BIRTH-1'))).toMatchObject({ holderKind: 'shop', holderId: dest.did });

    // "Who had it when?" — the question a damage claim asks, which a status trail cannot answer because it
    // records where a parcel WAS, not who was answerable for it. Asked of the moment it was taken in, the
    // answer is the shop, whatever has happened to the parcel since.
    expect(custodyAt(parcels.get('BIRTH-1'), parcels.get('BIRTH-1').acceptedAt)).toMatchObject({ holderKind: 'shop', holderId: origin.did });
    expect(onBus.from).toBeTruthy(); // …and the driver's leg is a recorded fact, not an inference from status

    parcels.pickup('BIRTH-1', dest.did, releaseCodeOf('BIRTH-1'));
    expect(custodianOf(parcels.get('BIRTH-1'))).toBeUndefined(); // collected: the network holds nothing
    const chain = parcels.get('BIRTH-1').custody!.map((l) => l.holderKind);
    expect(chain).toEqual(['shop', 'driver', 'shop', 'receiver']);

    // Ownership is a different question and it never moved: the sender bought the carriage, the receiver
    // owns what is inside. Neither is the network, which only ever appears in the chain above.
    expect(ownershipOf(parcels.get('BIRTH-1'))).toMatchObject({ shipment: { kind: 'sender' }, goods: { kind: 'receiver' } });
  });

  it('a store keeps its OWN goods until a driver takes them — the dock chain has no shop leg at all', async () => {
    const dest = onboardAgent('Chain Dest', 'SouthTown', 50);
    corridors.addCorridor({ name: 'chain', originZone: 'NorthTown', destZone: 'SouthTown' });
    const store = vendors.register({ name: 'Chain Traders', location: { lat: -1.2, lng: 36.8 } });
    vendors.topUp(store.vendorId, 200);
    const asStore = { role: 'genesis', did: store.did } as never;
    controller.setCollectionPoint(store.vendorId, { label: 'Chain dock', zone: 'NorthTown', location: { lat: -1.21, lng: 36.81 } } as never, asStore);
    const parcelId = (controller.createInbound({ vendorId: store.vendorId, destPudoDid: dest.did, buyerMobile: '+254700999', size: 'M', contentPhotoRef: 'c.jpg' } as never, asStore) as any).parcel.parcelId;
    expect(parcels.get(parcelId).originAgentDid).toBeUndefined(); // no first PUDO: a fact, not missing data
    expect(parcels.get(parcelId).originZone).toBe('NorthTown'); // the dock's zone — corridors are zone-keyed

    // Born at the STORE — never at the shop it was quoted through.
    expect(birthplaceOf(parcels.get(parcelId))).toMatchObject({ kind: 'store', atId: store.vendorId, label: 'Chain Traders' });
    // And the store is holding its own goods: it is the SENDER in the chain, not a node of the network.
    expect(custodianOf(parcels.get(parcelId))).toMatchObject({ holderKind: 'sender', holderId: store.vendorId });

    const bag: any = controller.openDockBag(store.vendorId, { destZone: 'SouthTown' } as never, asStore);
    controller.fillDockBag(store.vendorId, bag.code, { parcelId } as never, asStore);
    controller.sealDockBag(store.vendorId, bag.code, {} as never, asStore);
    // Bagging is not a hand-off: the goods are still the store's while the bag stands on its own dock.
    expect(custodianOf(parcels.get(parcelId))).toMatchObject({ holderKind: 'sender' });

    const d = coupleTipper('chain', { min: 0.8, max: 1.5 });
    mdps.loadBag(bag.code, drivers.get(d.did).badgeId!);
    expect(custodianOf(parcels.get(parcelId))).toMatchObject({ holderKind: 'driver', holderId: d.did });
    // The whole point: store → driver, with no shop in between, because no shop ever touched it.
    expect(parcels.get(parcelId).custody!.map((l) => l.holderKind)).toEqual(['sender', 'driver']);
  });

  it('a vendor collects from its OWN dock: bag, seal, driver — no PUDO, no intake fee, no new powers', async () => {
    const dest = onboardAgent('Dock Dest', 'SouthTown', 50);
    corridors.addCorridor({ name: 'dock', originZone: 'NorthTown', destZone: 'SouthTown' });
    const store = vendors.register({ name: 'Njiro Traders', location: { lat: -1.2, lng: 36.8 } });
    vendors.topUp(store.vendorId, 200);
    const asStore = { role: 'genesis', did: store.did } as never;

    // The dock is the store's own address — a door, not a PUDO.
    const dock = { lat: -1.21, lng: 36.81 };
    controller.setCollectionPoint(store.vendorId, { label: 'Njiro warehouse, gate 2', zone: 'NorthTown', location: dock } as never, asStore);

    // Mint two paid parcels for the same place. KNOWN GAP (next slice): the mint still demands an origin
    // PUDO and prices that shop's node fee into the quote, even though a dock parcel never goes near it —
    // making the mint origin-less is routing surgery (planJourney/quoteShipment start at a NODE, not a
    // point). What is proven here is everything after the mint.
    const mint = (mobile: string) =>
      (controller.createInbound({ vendorId: store.vendorId, destPudoDid: dest.did, buyerMobile: mobile, size: 'M', contentPhotoRef: 'c.jpg' } as never, asStore) as any).parcel.parcelId;
    const p1 = mint('+254700111');
    const p2 = mint('+254700222');

    const plan: any = controller.dockPlan(store.vendorId, asStore);
    // THE MONEY. A dock shipment pays the DESTINATION shop's fee and nothing else: no origin shop handled
    // it, so no origin node fee is in the price. Not a discount — the absence of work.
    expect(parcels.get(p1).nodeFees).toBe(dest.pricePerParcel);
    // …and the same parcel handed in at a shop instead pays for that shop too, which is the difference the
    // store is saving by being collected from.
    const viaShop = onboardAgent('Via Shop', 'NorthTown', 50);
    const dropped = (controller.createInbound({ vendorId: store.vendorId, originPudoDid: viaShop.did, destPudoDid: dest.did, buyerMobile: '+254700444', size: 'M', contentPhotoRef: 'c.jpg' } as never, asStore) as any).parcel;
    expect(dropped.nodeFees).toBe(Math.round((viaShop.pricePerParcel + dest.pricePerParcel) * 100) / 100);

    expect(plan.groups[0]).toMatchObject({ label: 'SouthTown', parcelIds: [p1, p2] });
    expect(plan.staging).toEqual({ capacity: 2, used: 0, free: 2 });

    const bag: any = controller.openDockBag(store.vendorId, { destZone: 'SouthTown' } as never, asStore);
    controller.fillDockBag(store.vendorId, bag.code, { parcelId: p1 } as never, asStore);

    // The same completeness gate a shop answers to: a paid parcel left on a dock is as stranded as one on
    // a shelf, and the person who can fix it is standing next to it.
    expect(() => controller.sealDockBag(store.vendorId, bag.code, {} as never, asStore)).toThrow(/still on the dock/);
    controller.fillDockBag(store.vendorId, bag.code, { parcelId: p2 } as never, asStore);
    const sealed: any = controller.sealDockBag(store.vendorId, bag.code, {} as never, asStore);
    expect(sealed.tote.status).toBe('available'); // sealing is what publishes it, exactly as at a counter

    // A driver is told where to come — the dock resolves as a pickup place like a shop or a hub does.
    await Promise.resolve();
    const d = coupleTipper('dock', { min: 0.8, max: 1.5 });
    const [offer] = dispatch.suggest(d.did, { from: dock, to: dest.location });
    expect(offer).toMatchObject({ ref: bag.code, pickupLabel: 'Njiro warehouse, gate 2' });

    // Custody moves when the BAG does, not before: until the driver scans it, the goods are the store's.
    expect(parcels.get(p1).status).toBe('Created');
    dispatch.claim(offer.offerId);
    mdps.loadBag(bag.code, drivers.get(d.did).badgeId!);
    expect(parcels.get(p1).status).toBe('On_Bus');

    // And NOBODY was paid to take in a box its own owner packed — no agent earned a labour fee here.
    expect(gate.entries({ type: 'LABOR_PAYOUT' }).filter((e) => e.reference === p1 || e.reference === p2)).toEqual([]);

    // The dock is another store's business only. And it never becomes a place to send things TO.
    const other = vendors.register({ name: 'Rival' });
    expect(() => controller.openDockBag(store.vendorId, { destZone: 'SouthTown' } as never, { role: 'genesis', did: other.did } as never)).toThrow(/not yours/);
    expect((controller.networkPoints() as any[]).some((p) => p.did === store.did)).toBe(false);
  });

  it('where a courier can register: every country the network takes parcels in, with the company that would contract them — none named where it only matches, and not a country it only watches', () => {
    presence.set({ jurisdiction: 'DE', level: 'matched' });
    presence.set({ jurisdiction: 'ZM', level: 'observed' }); // recorded, but the network does not operate there
    const where = drivers.courierCountries();
    const kenya = entities.forJurisdiction('KE')!;
    expect(where).toEqual(expect.arrayContaining([{ jurisdiction: 'KE', companyName: kenya.name }, { jurisdiction: 'DE' }]));
    // Matched only: a courier may stand there, and no company of ours stands behind them. The row says so by having none.
    expect(where.find((c) => c.jurisdiction === 'DE')).not.toHaveProperty('companyName');
    // Watched only: nothing can be taken in there, so nobody can become a courier there.
    expect(where.some((c) => c.jurisdiction === 'ZM')).toBe(false);
    expect(where.every((c) => presence.can(c.jurisdiction, 'takeIn'))).toBe(true);
  });

  it('publishes EVERY country, and where the network stands in each', () => {
    /*
     * This used to publish only the countries goods may be taken in, so a picker built from it simply
     * omitted everywhere else. A driver in the Netherlands could not find their own country and concluded
     * the product could only be joined through a fleet — which is the honest reading of an absence. A
     * country you can pick and be answered about teaches you where you stand; one that is missing does not.
     */
    presence.set({ jurisdiction: 'DE', level: 'matched' });
    presence.set({ jurisdiction: 'ZM', level: 'observed' }); // recorded, but the network does not operate there
    const countries = controller.countries();
    const at = (code: string) => countries.find((c) => c.country === code);

    expect(countries.length).toBeGreaterThan(200); // the atlas, not the operating list

    // THREE STATES, and the picker shows all three rather than collapsing two of them into silence.
    expect(at('KE')).toEqual({ country: 'KE', name: 'Kenya', currency: 'KES', settles: true, settlesAs: 'SeeBuyGet Kenya', joinable: true });
    expect(at('DE')).toEqual({ country: 'DE', name: 'Germany', settles: false, joinable: true });
    expect(at('ZM')).toEqual({ country: 'ZM', name: 'Zambia', settles: false, joinable: false });

    // The COUNTRY's name, for all of them. It was the sister's ("SeeBuyGet Kenya"), which reads as a
    // company in a list of places and is unscannable among two hundred entries; who would contract you
    // is a different fact and has its own field.
    expect(at('KE')!.name).toBe('Kenya');
    expect(at('ZM')!.settlesAs).toBeUndefined();

    // Nothing is loosened by saying more: joinable is read off the same presence the server enforces.
    expect(at('DE')!.joinable).toBe(presence.resolve('DE').capabilities.takeIn);
    expect(at('ZM')!.joinable).toBe(presence.resolve('ZM').capabilities.takeIn);

    // The entity's own id is the shape of the business and stays behind the operator-only /entities.
    expect(countries.every((c) => !('entityId' in c))).toBe(true);
  });

  it('says which country each network point stands in', () => {
    // So a sign-up can suggest the areas of the country somebody is joining, rather than every area we run.
    const shop = onboardAgent('Country Point', 'NorthTown', 50);
    const point = (controller.networkPoints() as Array<{ did: string; country?: string }>).find((p) => p.did === shop.did);
    expect(point?.country).toBe('KE');
  });

  it('a store with no collection point is told how to get one, and a full dock refuses another bag', () => {
    const dest = onboardAgent('Dock2 Dest', 'SouthTown', 50);
    corridors.addCorridor({ name: 'dock2', originZone: 'NorthTown', destZone: 'SouthTown' });
    const store = vendors.register({ name: 'No Dock' });
    vendors.topUp(store.vendorId, 200);
    const asStore = { role: 'genesis', did: store.did } as never;
    expect(() => controller.openDockBag(store.vendorId, { destZone: 'SouthTown' } as never, asStore)).toThrow(/no collection point/);

    controller.setCollectionPoint(store.vendorId, { label: 'Yard', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, bays: 1 } as never, asStore);
    controller.createInbound({ vendorId: store.vendorId, destPudoDid: dest.did, buyerMobile: '+254700333', size: 'M', contentPhotoRef: 'c.jpg' } as never, asStore);
    controller.openDockBag(store.vendorId, { destZone: 'SouthTown' } as never, asStore);
    // One bay, one bag: a dock runs out of floor exactly as a shop counter does.
    expect(() => controller.openDockBag(store.vendorId, { destZone: 'EastTown' } as never, asStore)).toThrow(/room for 1 bag/);

    // A pin is not optional — a driver is sent to a point, not to a name.
    expect(() => controller.setCollectionPoint(store.vendorId, { label: 'Yard', zone: 'NorthTown', location: { lat: Number.NaN, lng: 36.8 } } as never, asStore)).toThrow(/on the map/);
    expect(() => controller.setCollectionPoint(store.vendorId, { label: 'Yard', zone: '  ', location: { lat: -1.2, lng: 36.8 } } as never, asStore)).toThrow(/zone the dock sits in/);
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
    // A confirmed payment is what puts money on a store's balance now — the route only ASKS (foundation/funding).
    vendors.topUp(mine.vendorId, 100, 'MPESA-TEST-1');
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

  it('a store’s order and an in-app send are the receiver’s ACCOUNT’s from the moment they are made, where the receiver has one', () => {
    const buyer = enrollPerson('+254700500077');
    const origin = onboardAgent('OWN O', 'NorthTown', 50);
    const dest = onboardAgent('OWN D', 'NorthTown', 50);
    const vendor = vendors.register({ name: 'OwnVendor' });
    vendors.topUp(vendor.vendorId, 50);
    const order = controller.createInbound({ vendorId: vendor.vendorId, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: '+254700500077', size: 'M', contentPhotoRef: 'c.jpg' } as never, { role: 'genesis', did: vendor.did } as never) as { parcel: any };
    expect(parcels.receiverOf(parcels.get(order.parcel.parcelId)).owner).toBe(buyer.personDid);
    // The store is handed its order back, and learns nothing about whether its buyer has an account with us.
    expect(JSON.stringify(order)).not.toContain(buyer.personDid);
    const sender = enrollPerson('+254700500078');
    const sent: any = identity.createParcel({ receiverMobile: '+254700500077', originPudoDid: origin.did, destPudoDid: dest.did, dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 1.6 } as never, asConsumer(sender.personDid));
    expect(parcels.receiverOf(parcels.get(sent.parcel.parcelId)).owner).toBe(buyer.personDid);
    // The record the drop-off shop will work with names the receiver by nothing but the number the sender typed.
    expect(JSON.stringify(parcels.get(sent.parcel.parcelId))).not.toContain(buyer.personDid);
    // Both are in the buyer's home, asked as the account — and neither by the number alone.
    expect(parcels.partyTo(buyer).received.map((v) => v.parcelId).sort()).toEqual([order.parcel.parcelId, sent.parcel.parcelId].sort());
    expect(parcels.partyTo(buyer.phoneHash).received).toEqual([]);
  });

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
    // The raw record: cash-at-counter, price-locked, both parties joined by hash — and the sender by their ACCOUNT,
    // because they made it signed in: it stays theirs whatever number they sign in with later.
    const p = parcels.get(res.parcel.parcelId);
    expect(p.paymentMode).toBe('cash');
    expect(p.paidStatus).toBe('unpaid');
    expect(p.shipmentCost).toBe(res.price.total);
    expect(p.senderPhoneHash).toBe(sender.phoneHash);
    expect(parcels.senderOf(p).owner).toBe(sender.personDid);
    expect(p.receiverPhoneHash).toBeDefined();
    await flush();
    // The twin is BORN at mint with its planned journey — before any drop-off (the DT invariant, now for people).
    expect(twin.shipment(p.parcelId)?.state).toBe('created');
    expect(context.has(p.parcelId)).toBe(true);
    // And it lands in the sender's home as 'sent' + the receiver's as 'received' immediately.
    expect(parcels.partyTo(sender).sent.some((v) => v.parcelId === p.parcelId)).toBe(true);
    expect(parcels.partyTo(hashPhone('+254700500002')!).received.some((v) => v.parcelId === p.parcelId)).toBe(true);
    // Asked by the number alone — with no account behind the asking — it is not found: it is the account's.
    expect(parcels.partyTo(sender.phoneHash).sent.some((v) => v.parcelId === p.parcelId)).toBe(false);
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
    expect(dispatch.freightsFor(hashPhone('+254700500006')!)).toHaveLength(0);
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
    // …and in what money: the selling company's, stamped on the parcel — not assumed to be the network's.
    expect(preview.currency).toBe('KES');
    parcels.get(parcelId).currency = 'ETB';
    expect((controller.intakePreview(parcelId, { role: 'agent', did: origin.did } as never) as { currency: string }).currency).toBe('ETB');
    parcels.get(parcelId).currency = 'KES';
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
    vendors.topUp(vendor.vendorId, 100, 'MPESA-TEST-2'); // the confirmed-payment path; the route only asks
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
      const before = agents.balance(origin.did)!;
      parcels.accept({ agentDid: origin.did, parcelId: 'QR-BOOK', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });

      // The shop's float drops by the wholesale unit; the RETAIL 2.0 the customer paid never appears in
      // the sister's books, because the sister never touched it. The shop is a reseller on this flow.
      expect(agents.balance(origin.did)!).toBeCloseTo(before - WHOLESALE, 2);
      expect(bal(ACCOUNT_CODES.REVENUE)).toBeCloseTo(-WHOLESALE, 2); // revenue is credit-natured
      expect(bal(ACCOUNT_CODES.CASH_CUSTODY)).toBe(100); // 2×50 topped up; no money moved on a shipment
      expect(books.balances(KE())).toEqual({ balanced: true, drift: 0 });
    });

    it('books a labour fee as the sister’s COST, not as money from nowhere', () => {
      const shop = onboardAgent('Labour Shop', 'NorthTown', 50);
      const before = agents.balance(shop.did)!;
      gate.payLabour(shop.did, 0.4, 'PUD-X', 'parcel');

      expect(agents.balance(shop.did)!).toBeCloseTo(before + 0.4, 2);
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
      expect(summary.net).toBeCloseTo(agents.balance(shop.did)!, 2);
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

      // The network does not operate in the Netherlands → registering a Dutch store is refused outright, rather
      // than quietly settling its parcels through Nairobi. (Where we only match, it stands with no sister.)
      expect(() => vendors.register({ name: 'Amsterdam Store', country: 'NL' })).toThrow(/does not operate in NL/);
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

      // A fleet incorporated where the network does not OPERATE cannot be onboarded. The question used to be
      // "is there a sister?"; it is now the presence ladder's — in a country we only match a fleet may stand
      // with no sister (cross-border.spec), and a country nobody recorded is still refused, in those words.
      expect(() =>
        managers.register({ companyName: 'Rotterdam Haulage', jurisdiction: 'NL', contactPhone: '+3180090', ownerFullName: 'N N', ownerNationalId: 'MGR-NL', location: { lat: 51.9, lng: 4.5 }, requirements: { businessRegistrationNo: 'BRN-NL', transportOperatorLicence: 'TOL-NL', taxId: 'TAX-NL' } }),
      ).toThrow(/does not operate in NL/);
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

      // A courier resident where the network does not OPERATE cannot be onboarded. Where we only match they may
      // stand with no sister (cross-border.spec); a country nobody recorded is still refused, in those words.
      expect(() =>
        drivers.register({ displayName: 'Nomad', fullName: 'N N', nationalId: 'DRV-NOMAD', mobile: '+3190001', licenceClasses: ['bike'], jurisdiction: 'NL' }),
      ).toThrow(/does not operate in NL/);
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
      expect(parcels.partyTo(rx).received.every((p) => !p.collectToken)).toBe(true);
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

    it('draws again rather than handing back the code it is replacing', () => {
      /*
       * FOUR DIGITS MEANS ONE REISSUE IN TEN THOUSAND DREW THE CODE IT HAD JUST RETIRED — and that is not
       * a near miss, it is the reissue failing silently in the direction that matters. The receiver is
       * told their old code no longer works, an operator has read a new one down the phone, and the code
       * somebody lost is still live at the counter. Caught as an intermittent failure of the test above,
       * which is exactly how this class of defect presents itself.
       *
       * Forced rather than waited for: the draw is scripted to collide once, so the retry is what is
       * actually under test instead of the odds.
       */
      const origin = onboardAgent('Same Origin', 'NorthTown', 50);
      const dest = onboardAgent('Same Dest', 'SouthTown', 50);
      const corridor = corridors.addCorridor({ name: 'N-S same', originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: 'did:glos:dsame', name: 'D', corridorId: corridor.corridorId });

      // releaseOtp() reads two bytes; everything else that wants randomness still gets the real thing.
      const crypto = require('crypto') as { randomBytes: (n: number) => Buffer };
      const real = crypto.randomBytes;
      const draws = [0, 0, 65535]; // → '1000' at arrival, '1000' again (the collision), then '9999'
      const spy = jest.spyOn(crypto, 'randomBytes').mockImplementation(((size: number) => {
        if (size === 2 && draws.length) {
          const v = draws.shift()!;
          return Buffer.from([v >> 8, v & 0xff]);
        }
        return real(size);
      }) as never);

      try {
        parcels.accept({ agentDid: origin.did, parcelId: 'QR-SAME', size: 'S', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
        parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-SAME'] });
        parcels.arrive('QR-SAME', dest.did);
        expect(releaseCodeOf('QR-SAME')).toBe('1000');

        const out = parcels.reissueRelease('QR-SAME', 'operator:ops-1');
        expect(out.otp).toBe('9999'); // the collision was thrown away, not handed to the operator
      } finally {
        spy.mockRestore();
      }

      // And the retired code is genuinely dead at the counter, which is the promise a reissue makes.
      expect(() => parcels.pickup('QR-SAME', dest.did, '1000')).toThrow(/Incorrect OTP/);
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
    expect(parcels.partyTo(rx).received[0].collectToken).toBeUndefined();
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

    // File it. No company here has stated cover, so nobody of ours has anything to decide: the problem is recorded,
    // a damage claim report is made, and the parcel is at once what it factually is again — delivered.
    const disputed = parcels.buyerDispute(parcel.parcelId, rx, me, 'Wrong item inside', 'proof.jpg');
    expect(disputed.status).toBe('Delivered');
    expect(disputed.disputeOutcome).toMatchObject({ origin: 'buyer', decision: 'report_only' });
    expect(disputed.damageReport).toEqual({ number: `DCR-${parcel.parcelId}` });
    expect(parcels.get(parcel.parcelId).dispute).toMatchObject({ state: 'resolved', decision: 'report_only', award: 0, fromStatus: 'Delivered', reason: 'Wrong item inside', decidedBy: 'the record' });
    // Both photos survive: the PoD (what arrived) AND the dispute evidence (the problem) — distinct homes.
    expect(disputed.podPhotoRef).toBe('my-photo.jpg');
    expect(disputed.disputePhotoRef).toBe('proof.jpg');
    await flush();

    // O3 routing: the VENDOR got an HMAC 'disputed' callback...
    expect(vendors.outboxFor(vendor.vendorId).map((c) => c.event)).toContain('disputed');
    // ...and NO flag waits in the control tower: there is nothing there for staff to decide.
    expect(monitor.flags().find((f) => f.type === 'Buyer_Dispute' && f.subject === parcel.parcelId)).toBeUndefined();

    // One report to a parcel: the second is refused, in words that say where the first is.
    expect(() => parcels.buyerDispute(parcel.parcelId, rx, me, 'again', 'p.jpg')).toThrow(/already reported on this parcel/);
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

    // The RECEIVER (who wrote it) keeps their evidence, and holds the damage claim report that states what they wrote.
    const mine = parcels.consumerParcel('PEER-1', rxHash);
    expect(mine.relation).toBe('received');
    expect(mine.disputePhotoRef).toBe('damage.jpg');
    expect(mine.damageReport).toEqual({ number: 'DCR-PEER-1' });

    // The SENDER sees that a problem was reported and how it ended — but NOT the receiver's free-text reason, their
    // photos, a timeline note carrying the reason, or the report that holds all three.
    const theirs = parcels.consumerParcel('PEER-1', sndHash);
    expect(theirs.relation).toBe('sent');
    expect(theirs.status).toBe('Delivered');
    expect(theirs.disputeOutcome).toMatchObject({ origin: 'buyer', decision: 'report_only' });
    expect(theirs.damageReport).toBeUndefined();
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
    // No cover stated: the report is made and the parcel is collectable again at once — the customer is standing there.
    expect(disputed.status).toBe('Ready_For_Pickup');
    expect(disputed.dispute).toMatchObject({ state: 'resolved', decision: 'report_only', origin: 'counter', reason: 'box crushed', fromStatus: 'Ready_For_Pickup' });
    expect(disputed.scans[disputed.scans.length - 1]).toMatchObject({ status: 'Ready_For_Pickup', note: 'damage claim report made' });
    // One report to a parcel, however often the button is pressed.
    expect(() => parcels.dispute(parcel.parcelId, dest.did, 'and again', 'proof2.jpg')).toThrow(/already reported on this parcel/);
    await flush();
    expect(vendors.outboxFor(vendor.vendorId).some((c) => c.event === 'disputed')).toBe(true);
  });

  describe('a dispute gets an ending', () => {
    /** Let the delivery events settle before the receiver can act on the parcel. */
    const settle = () => new Promise((r) => setImmediate(r));

    // AN AWARD NEEDS A COMPANY THAT PAYS. Everything in here is about a company that has STATED COVER and so pays a
    // claim from its own books — which no company does until it says so (the user, 2026-10-12). What a reported
    // problem ends in where none is stated is the describe after this one.
    const companies = () => ['KE', 'ET'].map((j) => entities.requireForJurisdiction(j).entityId);
    beforeEach(() => companies().forEach((id) => entities.setInsurance(id, { freeLimit: 5000 }, 'Amina Otieno')));
    afterEach(() => companies().forEach((id) => entities.setInsurance(id, { freeLimit: null }, 'Amina Otieno')));

    /** A delivered vendor order with a receiver who reports a problem — the buyer-dispute path. */
    async function disputedOrder(float = 200) {
      const origin = onboardAgent('Claims Origin', 'NorthTown');
      const dest = onboardAgent('Claims Dest', 'SouthTown');
      const corridor = corridors.addCorridor({ name: 'C', originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: 'did:glos:claimd', name: 'D', corridorId: corridor.corridorId });
      const vendor = vendors.register({ name: 'Claims Store' });
      vendors.topUp(vendor.vendorId, float);
      const buyer = '+254700931100';
      const { parcel } = parcels.createInbound({
        vendorId: vendor.vendorId, originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: buyer,
        size: 'M', contentPhotoRef: 'content.jpg', shippingPolicy: vendor.shippingPolicy,
        quote: routing.quoteShipment(origin.did, dest.did, 'M'),
      });
      parcels.intakeInbound(parcel.parcelId, origin.did);
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcel.parcelId] });
      parcels.shelve(parcel.parcelId, dest.did);
      parcels.collectConfirm(parcel.parcelId, dest.did, parcel.collectionCode!);
      await settle();
      const rx = hashPhone(buyer);
      parcels.buyerDispute(parcel.parcelId, rx, persons.ensurePerson(buyer).personDid, 'Arrived smashed', 'problem.jpg');
      return { parcel, vendor, dest };
    }

    const ke = () => entities.requireForJurisdiction('KE').entityId;
    const claimsExpense = () => books.balance(ke(), ACCOUNT_CODES.EXPENSE_CLAIMS) || 0;
    const provision = () => -books.balance(ke(), ACCOUNT_CODES.PROVISION_CLAIMS) || 0;

    it('opens a CASE, not just a status — and it names where the parcel came from', async () => {
      const { parcel } = await disputedOrder();
      const p = parcels.get(parcel.parcelId);
      expect(p.status).toBe('Disputed');
      // The thing Disputed never had: an open question with a record, and a way back to where it was.
      expect(p.dispute).toMatchObject({ state: 'open', origin: 'buyer', fromStatus: 'Delivered', reason: 'Arrived smashed' });
      expect(parcels.openDisputes().map((x) => x.parcelId)).toContain(parcel.parcelId);
    });

    /**
     * THE ANSWER REACHED NOBODY. A decision was recorded with its reason, the parcel went back to "delivered", and
     * the person who had reported broken goods could find no trace in their app that anybody had answered. Nor was
     * anybody told. And the decision was signed with whatever name the request carried.
     */
    it('shows both people on the parcel how it ended — the decision and the reason, never the receiver’s own words — and says so on the wire', async () => {
      const { parcel } = await disputedOrder();
      const buyer = hashPhone('+254700931100');
      const decided: unknown[] = [];
      events.subscribe(GlosEvent.Pudo.ParcelDisputeDecided, (e) => {
        decided.push(e.payload);
      });
      // Open: there is no outcome to show yet, and the receiver still reads what they wrote.
      const open = parcels.consumerParcel(parcel.parcelId, buyer);
      expect(open).not.toHaveProperty('disputeOutcome');
      expect(open.disputeReason).toBe('Arrived smashed');

      parcels.resolveDispute(parcel.parcelId, { decision: 'partly_upheld', award: 15, note: 'The box was crushed on our van. The scratch on the lid was there in the store’s own photograph.', by: 'Amina Otieno' });

      const mine = parcels.consumerParcel(parcel.parcelId, buyer);
      expect(mine.status).toBe('Delivered');
      expect(mine.disputeOutcome).toEqual({
        origin: 'buyer', // filed from the receiver's own app
        decision: 'partly_upheld',
        note: 'The box was crushed on our van. The scratch on the lid was there in the store’s own photograph.',
        decidedAt: expect.any(String),
        award: 15,
        currency: parcels.get(parcel.parcelId).currency ?? 'USD',
        paidTo: 'store', // a store sold this shipment: the award is the store's, to pass on
      });
      // Nothing of who decided it, how it was funded, or which account was paid.
      expect(JSON.stringify(mine.disputeOutcome)).not.toMatch(/Amina|fromProvision|ven_/);
      expect(decided).toEqual([expect.objectContaining({ parcelId: parcel.parcelId, decision: 'partly_upheld', award: 15, origin: 'buyer', note: expect.stringContaining('crushed on our van') })]);
    });

    it('a rejection is an answer too: the reason is shown, and no award is named', async () => {
      const { parcel } = await disputedOrder();
      parcels.resolveDispute(parcel.parcelId, { decision: 'rejected', note: 'The photograph shows the seal unbroken and the contents as listed.' });
      const outcome = parcels.consumerParcel(parcel.parcelId, hashPhone('+254700931100')).disputeOutcome!;
      expect(outcome).toEqual({ origin: 'buyer', decision: 'rejected', note: 'The photograph shows the seal unbroken and the contents as listed.', decidedAt: expect.any(String) });
      expect(parcels.get(parcel.parcelId).dispute).not.toHaveProperty('currency');
    });

    it('a walk-up sender reads that the award is owed to THEM — and not what the receiver wrote', async () => {
      const origin = onboardAgent('Walk Origin', 'NorthTown', 50);
      const dest = onboardAgent('Walk Dest', 'SouthTown', 50);
      const corridor = corridors.addCorridor({ name: 'W', originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: 'did:glos:walkd', name: 'D', corridorId: corridor.corridorId });
      const [sender, receiver] = ['+254700931201', '+254700931202'];
      const taken = parcels.accept({ agentDid: origin.did, parcelId: 'QR-WALK-DISPUTE', size: 'M', destZone: 'SouthTown', senderMobile: sender, receiverMobile: receiver, dropoffPhotoRef: 'r.jpg' });
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-WALK-DISPUTE'] });
      parcels.arrive('QR-WALK-DISPUTE', dest.did);
      // Reported at the counter, before it was taken away: the goods stay on the shelf.
      parcels.dispute('QR-WALK-DISPUTE', dest.did, 'The lid is cracked', 'counter.jpg');
      const slot = parcels.get('QR-WALK-DISPUTE').binSlot;
      const said: Array<{ currency?: string }> = [];
      events.subscribe<{ currency?: string }>(GlosEvent.Pudo.ParcelDisputeDecided, (e) => {
        said.push(e.payload);
      });
      const resolved = parcels.resolveDispute('QR-WALK-DISPUTE', { decision: 'upheld', award: 3, note: 'Cracked in our hands.', by: 'Brian Kamau' });

      const theirs = parcels.consumerParcel('QR-WALK-DISPUTE', hashPhone(sender));
      expect(theirs.relation).toBe('sent');
      // Raised by the SHOP, at its counter — and said so, to the sender and to the receiver alike.
      expect(theirs.disputeOutcome).toMatchObject({ origin: 'counter', decision: 'upheld', award: 3, paidTo: 'sender', note: 'Cracked in our hands.' });
      expect(parcels.consumerParcel('QR-WALK-DISPUTE', hashPhone(receiver)).disputeOutcome).toMatchObject({ origin: 'counter', decision: 'upheld' });
      // IN WHAT MONEY. A parcel taken in at a counter names no currency of its own; the award is in the money of
      // the company whose books carry it, written on the decision — and the notice once read "3.00  is owed".
      const company = entities.get(resolved.collectingEntityId ?? resolved.sellerEntityId!)!.currency;
      expect(resolved.currency).toBeUndefined();
      expect(company).toMatch(/^[A-Z]{3}$/);
      expect(resolved.dispute!.currency).toBe(company);
      expect(theirs.disputeOutcome!.currency).toBe(company);
      expect(said).toEqual([expect.objectContaining({ currency: company })]);
      expect(theirs).not.toHaveProperty('disputePhotoRef', expect.any(String));
      expect(theirs.disputeReason).toBeUndefined();
      // Decided, it is what it factually is again: on the shelf, in the slot it never left, to be collected.
      expect(parcels.get('QR-WALK-DISPUTE')).toMatchObject({ status: 'Ready_For_Pickup', binSlot: slot });
      expect(taken.otp).toBeDefined();
      expect(parcels.pickup('QR-WALK-DISPUTE', dest.did, taken.otp!, 'handed.jpg').status).toBe('Delivered');
    });

    it('names the money of the company whose books carry the award — a shop in Ethiopia is not answered in shillings', () => {
      const shop = (shopName: string, zone: string) => {
        agentSeq += 1;
        const a = agents.register({ shopName, zone, country: 'ET', location: { lat: 9.03, lng: 38.74 }, landmark: 'by the roundabout', openingHours: uniformHours(), shelf: defaultShelf, fullName: `${shopName} owner`, nationalId: `ID-ET-${agentSeq}`, mobile: `+2519${agentSeq}`, deviceImei: `IMEI-ET-${agentSeq}`, requirements: eligibleReqs() } as never);
        agents.submitKyc(a.did, kycDocs);
        agents.decideKyc(a.did, true);
        gate.topUp(a.did, 5000);
        return agents.get(a.did);
      };
      const origin = shop('Bole Counter', 'Bole');
      const dest = shop('Piassa Counter', 'Piassa');
      const corridor = corridors.addCorridor({ name: 'Addis', originZone: 'Bole', destZone: 'Piassa' });
      const driver = corridors.addDriver({ driverDid: 'did:glos:addisd', name: 'D', corridorId: corridor.corridorId });
      parcels.accept({ agentDid: origin.did, parcelId: 'QR-ADDIS-DISPUTE', size: 'M', destZone: 'Piassa', senderMobile: '+251911000001', receiverMobile: '+251911000002', dropoffPhotoRef: 'r.jpg' });
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-ADDIS-DISPUTE'] });
      parcels.arrive('QR-ADDIS-DISPUTE', dest.did);
      parcels.dispute('QR-ADDIS-DISPUTE', dest.did, 'Wet through', 'counter.jpg');
      const resolved = parcels.resolveDispute('QR-ADDIS-DISPUTE', { decision: 'upheld', award: 120, note: 'It stood under our leaking roof.', by: 'Brian Kamau' });

      expect(resolved.currency).toBeUndefined(); // a counter parcel names no money of its own
      expect(entities.requireForJurisdiction('ET').currency).toBe('ETB');
      expect(resolved.dispute!.currency).toBe('ETB');
      expect(parcels.consumerParcel('QR-ADDIS-DISPUTE', hashPhone('+251911000001')).disputeOutcome).toMatchObject({ award: 120, currency: 'ETB', paidTo: 'sender' });
    });

    it('is signed by the member of staff who is signed in — not by the name the request carries, and never by “ops”', async () => {
      const { parcel } = await disputedOrder();
      const amina = { active: true, role: 'operator', sub: 'operator:opr_a', actorName: 'Amina Otieno', scopes: ['*'] } as never;
      const decidedByAmina = controller.resolveDispute(parcel.parcelId, { decision: 'rejected', note: 'No damage is visible.', by: 'Somebody Else' } as never, amina);
      expect(decidedByAmina.dispute).toMatchObject({ decidedBy: 'Amina Otieno' });
      const last = decidedByAmina.scans[decidedByAmina.scans.length - 1];
      expect(last).toMatchObject({ by: 'Amina Otieno' });
    });

    it('pays an upheld claim to the STORE — the party that actually contracted with the sister', async () => {
      // Not the buyer. The buyer's claim is against the merchant they bought from, exactly as it would
      // be for goods broken on a shelf; ours is with the business that bought a shipment from us.
      const { parcel, vendor } = await disputedOrder();
      const before = vendors.balanceOf(vendor.vendorId);

      const resolved = parcels.resolveDispute(parcel.parcelId, { decision: 'upheld', award: 40, note: 'Crushed in transit — our handling', by: 'ops-anna' });

      expect(resolved.dispute).toMatchObject({ state: 'resolved', decision: 'upheld', award: 40, decidedBy: 'ops-anna' });
      expect(resolved.dispute?.paidTo).toEqual({ kind: 'vendor', id: vendor.vendorId });
      expect(Math.round((vendors.balanceOf(vendor.vendorId) - before) * 100) / 100).toBe(40);
      expect(books.balances(ke()).balanced).toBe(true);
    });

    it('falls through to CLAIMS EXPENSE while the provision is empty — which is the number that prices the knob', async () => {
      // Every sister's cost-of-risk is zero, so nothing has been set aside and every award is simply a
      // cost. That reading is the point: it is what somebody needs before setting that knob to anything
      // other than a guess. Draining a provision into a negative balance would hide the same fact.
      const { parcel } = await disputedOrder();
      expect(provision()).toBe(0);
      parcels.resolveDispute(parcel.parcelId, { decision: 'upheld', award: 25, note: 'ours' });
      expect(claimsExpense()).toBe(25);
      expect(books.balances(ke()).balanced).toBe(true);
    });

    it('takes what the provision holds first, and expenses only the shortfall', async () => {
      // The provision is a POOL, not a per-parcel envelope — cost of risk is collected on every shipment
      // precisely because nobody knows which one will break.
      const { parcel } = await disputedOrder();
      books.post({
        entityId: ke(), kind: 'provision-seed', ref: 'test',
        lines: [{ code: ACCOUNT_CODES.CASH_CUSTODY, amount: 30 }, { code: ACCOUNT_CODES.PROVISION_CLAIMS, amount: -30 }],
      });
      expect(provision()).toBe(30);

      parcels.resolveDispute(parcel.parcelId, { decision: 'partly_upheld', award: 50, note: 'half the goods survived' });

      expect(parcels.get(parcel.parcelId).dispute?.funding).toEqual({ fromProvision: 30, fromExpense: 20 });
      expect(provision()).toBe(0);
      expect(claimsExpense()).toBe(20);
      expect(books.balances(ke()).balanced).toBe(true);
    });

    it('closes a REJECTED case too, with its reason, and moves no money', async () => {
      // A claimant told no and given no reason has not been answered, they have been dismissed.
      const { parcel, vendor } = await disputedOrder();
      const before = vendors.balanceOf(vendor.vendorId);
      const resolved = parcels.resolveDispute(parcel.parcelId, { decision: 'rejected', award: 999, note: 'Delivery photo shows it intact at handover' });
      expect(resolved.dispute).toMatchObject({ state: 'resolved', decision: 'rejected', award: 0 });
      expect(resolved.dispute?.note).toContain('intact at handover');
      expect(resolved.dispute?.paidTo).toBeUndefined();
      expect(vendors.balanceOf(vendor.vendorId)).toBe(before); // the award on a rejection is ignored, not paid
      expect(claimsExpense()).toBe(0);
    });

    it('returns the parcel to what it FACTUALLY IS, and drains the operator queue', async () => {
      // Disputed was never a description of the goods — it described an open question. Once the question
      // has an answer the parcel is what it always was: delivered.
      const { parcel } = await disputedOrder();
      parcels.resolveDispute(parcel.parcelId, { decision: 'rejected', note: 'no evidence of damage' });
      expect(parcels.get(parcel.parcelId).status).toBe('Delivered');
      expect(parcels.openDisputes().map((x) => x.parcelId)).not.toContain(parcel.parcelId);
      // …and the case file survives the status going back, so the history is not rewritten.
      expect(parcels.get(parcel.parcelId).dispute?.decision).toBe('rejected');
    });

    it('a rejected COUNTER dispute leaves the goods collectable, not stranded', async () => {
      // The one place guessing the return status would strand somebody's parcel: a counter dispute is
      // raised while the goods are still on the shelf, so rejecting it must hand them back to the queue.
      const origin = onboardAgent('Counter Origin', 'NorthTown');
      const dest = onboardAgent('Counter Dest', 'SouthTown');
      const corridor = corridors.addCorridor({ name: 'CC', originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: 'did:glos:countd', name: 'CD', corridorId: corridor.corridorId });
      const vendor = vendors.register({ name: 'Counter Store' });
      vendors.topUp(vendor.vendorId, 200);
      const { parcel } = parcels.createInbound({
        vendorId: vendor.vendorId, originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+254700111222',
        size: 'S', contentPhotoRef: 'content.jpg', shippingPolicy: vendor.shippingPolicy,
        quote: routing.quoteShipment(origin.did, dest.did, 'S'),
      });
      parcels.intakeInbound(parcel.parcelId, origin.did);
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcel.parcelId] });
      parcels.shelve(parcel.parcelId, dest.did);
      parcels.dispute(parcel.parcelId, dest.did, 'box crushed', 'proof.jpg');
      expect(parcels.get(parcel.parcelId).dispute).toMatchObject({ origin: 'counter', fromStatus: 'Ready_For_Pickup' });

      parcels.resolveDispute(parcel.parcelId, { decision: 'rejected', note: 'packaging scuffed, contents fine' });
      expect(parcels.get(parcel.parcelId).status).toBe('Ready_For_Pickup');
    });

    it('refuses a decision with no reason, and an upheld claim that awards nothing', async () => {
      const { parcel } = await disputedOrder();
      expect(() => parcels.resolveDispute(parcel.parcelId, { decision: 'upheld', award: 10, note: '  ' })).toThrow(/reason the claimant can be shown/);
      expect(() => parcels.resolveDispute(parcel.parcelId, { decision: 'upheld', award: 0, note: 'ok' })).toThrow(/reject it instead/);
      // …and none of the refusals opened a hole: the case is untouched and still open.
      expect(parcels.get(parcel.parcelId).dispute?.state).toBe('open');
      expect(claimsExpense()).toBe(0);
    });

    it('cannot be decided twice', async () => {
      const { parcel } = await disputedOrder();
      parcels.resolveDispute(parcel.parcelId, { decision: 'upheld', award: 10, note: 'ours' });
      expect(() => parcels.resolveDispute(parcel.parcelId, { decision: 'upheld', award: 10, note: 'again' })).toThrow(/expected Disputed/);
      expect(claimsExpense()).toBe(10); // paid once
    });
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

  /**
   * WHERE NO COMPANY PAYS — which is everywhere, until a company states cover. The user, 2026-10-12, asked whether
   * an award should take two members of staff: "I wonder whether that is our jurisdiction." So a reported problem ends
   * in a damage claim report and nothing of ours decides it.
   */
  describe('a problem reported where no company has stated cover: a report, and nothing to decide', () => {
    const settle = () => new Promise((r) => setImmediate(r));
    const counterParcel = (tag: string) => {
      const origin = onboardAgent(`NoCover Origin ${tag}`, 'NorthTown', 50);
      const dest = onboardAgent(`NoCover Dest ${tag}`, 'SouthTown', 50);
      const corridor = corridors.addCorridor({ name: `NC ${tag}`, originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: `did:glos:nc${tag}`, name: 'D', corridorId: corridor.corridorId });
      const parcelId = `QR-NOCOVER-${tag}`;
      const taken = parcels.accept({ agentDid: origin.did, parcelId, size: 'M', destZone: 'SouthTown', senderMobile: '+254700951101', receiverMobile: '+254700951102', dropoffPhotoRef: 'r.jpg' });
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcelId] });
      parcels.arrive(parcelId, dest.did);
      return { parcelId, dest, code: taken.otp! };
    };

    it('a parcel is made with no cover, and declaring a value buys none', () => {
      const { parcelId } = counterParcel('A');
      expect(parcels.get(parcelId).coverLimit).toBe(0);
      expect(paysItself(parcels.get(parcelId))).toBe(false);
      expect(paysItself({ coverLimit: 5000 })).toBe(true);
      expect(paysItself({})).toBe(false);
    });

    it('at a counter: the case closes itself, the parcel is collectable again, and everybody it concerns is told on the wire', async () => {
      const { parcelId, dest, code } = counterParcel('B');
      const said: Array<Record<string, unknown>> = [];
      events.subscribe<Record<string, unknown>>(GlosEvent.Pudo.ParcelDisputeDecided, (e) => {
        said.push(e.payload);
      });
      const slot = parcels.get(parcelId).binSlot;
      const reported = parcels.dispute(parcelId, dest.did, 'The lid is cracked', 'counter.jpg');
      await settle();

      expect(reported.status).toBe('Ready_For_Pickup');
      expect(reported.binSlot).toBe(slot);
      expect(reported.dispute).toMatchObject({ state: 'resolved', decision: 'report_only', award: 0, origin: 'counter', decidedBy: 'the record' });
      expect(reported.dispute).not.toHaveProperty('paidTo');
      expect(reported.dispute).not.toHaveProperty('funding');
      expect(parcels.openDisputes().map((p) => p.parcelId)).not.toContain(parcelId);
      expect(said).toEqual([{ parcelId, decision: 'report_only', award: 0, note: REPORT_ONLY_NOTE, origin: 'counter', raisedBy: dest.did }]);
      // Both people read how it ended; only the receiver is handed the report.
      expect(parcels.consumerParcel(parcelId, hashPhone('+254700951102'))).toMatchObject({ disputeOutcome: { origin: 'counter', decision: 'report_only' }, damageReport: { number: `DCR-${parcelId}` } });
      const theirs = parcels.consumerParcel(parcelId, hashPhone('+254700951101'));
      expect(theirs.disputeOutcome).toMatchObject({ decision: 'report_only' });
      expect(theirs.disputeOutcome).not.toHaveProperty('award');
      expect(theirs).not.toHaveProperty('damageReport');
      // And it is collected as any parcel.
      expect(parcels.pickup(parcelId, dest.did, code, 'handed.jpg').status).toBe('Delivered');
    });

    it('no money moves: nothing is awarded, nothing is owed, and the books are as they were', async () => {
      const ke = entities.requireForJurisdiction('KE').entityId;
      const claims = () => books.balance(ke, ACCOUNT_CODES.EXPENSE_CLAIMS) || 0;
      const before = claims();
      const { parcelId, dest } = counterParcel('C');
      parcels.dispute(parcelId, dest.did, 'Wet through', 'counter.jpg');
      await settle();
      expect(claims()).toBe(before);
      // Nobody can award on it afterwards either: there is no open case to decide.
      expect(() => parcels.resolveDispute(parcelId, { decision: 'upheld', award: 40, note: 'goodwill' })).toThrow(/expected Disputed/);
    });

    it('a case still open from before can be closed with a reason, and never with money', () => {
      const { parcelId, dest } = counterParcel('D');
      parcels.dispute(parcelId, dest.did, 'Torn', 'counter.jpg');
      // As a record written before the default was turned round would stand: in dispute, undecided, no cover.
      const old = parcels.get(parcelId);
      old.status = 'Disputed';
      old.dispute = { state: 'open', origin: 'counter', fromStatus: 'Ready_For_Pickup', reason: 'Torn', raisedBy: dest.did, raisedAt: old.dispute!.raisedAt };

      expect(() => parcels.resolveDispute(parcelId, { decision: 'upheld', award: 40, note: 'goodwill' })).toThrow('The company that carried this parcel has stated no cover, so it pays nothing from its own books and there is nothing to award. The damage claim report is the answer: close this with a reason and no award.');
      expect(() => parcels.resolveDispute(parcelId, { decision: 'partly_upheld', award: 0.01, note: 'a little' })).toThrow(/stated no cover/);
      expect(parcels.get(parcelId).status).toBe('Disputed');
      const closed = parcels.resolveDispute(parcelId, { decision: 'rejected', note: 'The damage claim report holds the record.', by: 'Amina Otieno' });
      expect(closed).toMatchObject({ status: 'Ready_For_Pickup', dispute: { state: 'resolved', decision: 'rejected', award: 0 } });
    });

    it('a company that states cover is the one that decides: its case stays open for staff, and is capped by what it stated', async () => {
      const ke = entities.requireForJurisdiction('KE').entityId;
      entities.setInsurance(ke, { freeLimit: 300 }, 'Amina Otieno');
      try {
        const { parcelId, dest } = counterParcel('E');
        expect(parcels.get(parcelId).coverLimit).toBe(300);
        const reported = parcels.dispute(parcelId, dest.did, 'Crushed', 'counter.jpg');
        expect(reported).toMatchObject({ status: 'Disputed', dispute: { state: 'open' } });
        expect(parcels.openDisputes().map((p) => p.parcelId)).toContain(parcelId);
        expect(() => parcels.resolveDispute(parcelId, { decision: 'upheld', award: 301, note: 'ours' })).toThrow(/covered to 300.00/);
        expect(parcels.resolveDispute(parcelId, { decision: 'upheld', award: 300, note: 'ours' }).dispute).toMatchObject({ decision: 'upheld', award: 300 });
      } finally {
        entities.setInsurance(ke, { freeLimit: null }, 'Amina Otieno');
      }
    });

    it('stating cover is refused at the door for now, and taking it away is not', () => {
      const ke = entities.requireForJurisdiction('KE').entityId;
      const staff = { active: true, role: 'operator', sub: 'operator:opr_a', actorName: 'Amina Otieno', scopes: ['*'] } as never;
      expect(() => controller.setEntityInsurance(ke, { freeLimit: 5000 } as never, staff)).toThrow(/A company cannot state cover yet/);
      expect(() => controller.setEntityInsurance(ke, { premiumPct: 0.02 } as never, staff)).toThrow(/A company cannot state cover yet/);
      expect(entities.insuranceFor(ke)).toMatchObject({ freeLimit: 0, premiumPct: 0 });
      expect(() => controller.setEntityInsurance(ke, { freeLimit: null, premiumPct: null } as never, staff)).not.toThrow();
      expect(() => controller.setEntityInsurance(ke, { freeLimit: 0 } as never, staff)).not.toThrow();
    });
  });

  /**
   * THE DAMAGE CLAIM REPORT — what every reported problem ends in. The record, frozen as it stood when the problem
   * was reported, with a fingerprint; for whoever it is for, and for whoever THEY hand it to.
   */
  describe('the damage claim report', () => {
    const settle = () => new Promise((r) => setImmediate(r));
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const SENDER = '+254700961101';
    const RECEIVER = '+254700961102';
    const staff = { active: true, role: 'operator', sub: 'operator:opr_a', actorName: 'Amina Otieno', scopes: ['*'] } as never;
    const asPerson = (phone: string) => {
      const person = persons.ensurePerson(phone);
      return { active: true, role: 'consumer', did: person.personDid, sub: person.personDid, scopes: [] } as never;
    };
    const asShop = (did: string) => ({ active: true, role: 'agent', did, sub: did, scopes: [] }) as never;

    const reportsOf = () => {
      const reports = new DamageReportService(parcels, agents, media, vendors, persons, drivers, managers, mdps);
      reports.onModuleInit();
      return reports;
    };
    /** A counter parcel on the destination shelf, with a problem reported at that counter. */
    const reportedAtCounter = (tag: string) => {
      const origin = onboardAgent(`Report Origin ${tag}`, 'NorthTown', 50);
      const dest = onboardAgent(`Report Dest ${tag}`, 'SouthTown', 50);
      const corridor = corridors.addCorridor({ name: `R ${tag}`, originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: `did:glos:rep${tag}`, name: 'D', corridorId: corridor.corridorId });
      const parcelId = `QR-REPORT-${tag}`;
      const taken = parcels.accept({ agentDid: origin.did, parcelId, size: 'M', fragile: true, destZone: 'SouthTown', senderMobile: SENDER, receiverMobile: RECEIVER, dropoffPhotoRef: 'drop.jpg' });
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcelId] });
      parcels.arrive(parcelId, dest.did);
      const proof = media.upload({ ownerDid: dest.did, kind: 'dispute', dataUrl: PNG }).mediaId;
      parcels.dispute(parcelId, dest.did, 'The lid is cracked right across', proof);
      return { parcelId, origin, dest, proof, code: taken.otp! };
    };

    it('says what the record held when the problem was reported: the parcel, the terms, every hand, every step, every photograph', async () => {
      const reports = reportsOf();
      const made = jest.spyOn(reports, 'ensure');
      const { parcelId, origin, dest, proof } = reportedAtCounter('A');
      // Made IN the act of reporting — by the time reporting returns, and before anybody has asked to read it.
      expect(made).toHaveBeenCalledWith(parcelId);
      expect(made.mock.results[0].value).toMatchObject({ parcelId, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
      const report = reports.read(parcelId, staff);

      expect(report.parcelId).toBe(parcelId);
      expect(report.madeAt).toBe(parcels.get(parcelId).dispute!.raisedAt);
      const b = report.body;
      expect(b.number).toBe(`DCR-${parcelId}`);
      expect(b.statement).toBe(DAMAGE_REPORT_STATEMENT);
      expect(b.statement).toMatch(/does not judge a claim/);
      expect(b.parcel).toMatchObject({ parcelId, through: 'counter', from: `${origin.shopName}, NorthTown`, to: `${dest.shopName}, SouthTown`, size: 'M', fragile: true, currency: 'KES' });
      expect(b.parcel.shipmentId).toBe(parcels.get(parcelId).did);
      // THE TERMS it travelled under: a company of ours carried it, and has stated no cover.
      expect(b.terms).toMatchObject({ promise: 'ours', coverLimit: 0, currency: 'KES' });
      expect(termsSentence(b.terms)).toMatch(/has stated no cover: it pays nothing from its own books/);
      expect(termsSentence({ ...b.terms, coverLimit: 300 })).toMatch(/pays up to 300.00 KES from its own books/);
      expect(termsSentence({ promise: 'theirs', coverLimit: 0, currency: 'KES' })).toMatch(/carrier’s own promise/);
      // THE PROBLEM, in the words of whoever reported it, and in whose hands the parcel was.
      expect(b.problem).toEqual({ origin: 'counter', reportedAt: report.madeAt, reason: 'The lid is cracked right across', parcelWas: 'on the shelf of the collection shop, not yet handed over', heldBy: { kind: 'shop', name: dest.shopName }, shop: dest.shopName });
      // EVERY HAND: the first shop, the carrier, and the shop it was standing in — still, when it was reported.
      expect(b.custody.map((leg) => [leg.holder.kind, leg.holder.name, Boolean(leg.to)])).toEqual([
        ['shop', origin.shopName, true],
        ['driver', 'The carrier', true],
        ['shop', dest.shopName, false],
      ]);
      // EVERY STEP, each with the fingerprint it was anchored under, ending with the report itself.
      expect(b.events.map((e) => e.status)).toEqual(parcels.get(parcelId).scans.slice(0, b.events.length).map((s) => s.status));
      expect(b.events[b.events.length - 1].status).toBe('Disputed');
      expect(b.events.every((e) => typeof e.fingerprint === 'string' && e.fingerprint.length > 0)).toBe(true);
      // EVERY PHOTOGRAPH: one held as a picture, one that was only ever a reference.
      expect(b.photographs).toEqual([
        { what: 'drop_off', reference: 'drop.jpg' },
        { what: 'problem', reference: proof, mediaId: proof, takenAt: expect.any(String), sha256: expect.any(String) },
      ]);
      // No phone number, no account, no member of staff: nothing in it names a person.
      const all = JSON.stringify(report);
      expect(all).not.toMatch(/\+2547|did:glos:person|Amina/);
    });

    it('is made once and never says anything else: what happens to the parcel afterwards is not in it', async () => {
      const reports = reportsOf();
      const { parcelId, dest, code } = reportedAtCounter('B');
      await settle();
      const first = reports.read(parcelId, staff);
      // The fingerprint, worked out again from nothing but what the report says: SHA-256 over it with its keys sorted.
      expect(first.sha256).toBe(createHash('sha256').update(canonicalJson(first.body)).digest('hex'));
      expect(first.sha256).toBe(fingerprintOf(first.body));
      expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);

      // The parcel is collected a moment later, and the shop is renamed.
      await new Promise((r) => setTimeout(r, 5));
      parcels.pickup(parcelId, dest.did, code, 'handed.jpg');
      agents.get(dest.did).shopName = 'A New Name Altogether';
      const later = reports.read(parcelId, staff);
      expect(later).toEqual(first);
      expect(later.body.custody[later.body.custody.length - 1]).not.toHaveProperty('to');
      expect(JSON.stringify(later)).not.toContain('A New Name Altogether');
      expect(later.body.events.some((e) => e.status === 'Delivered')).toBe(false);

      // A problem reported before reports existed has its report made on first reading — and it says the same: only
      // what the record dates no later than the report.
      const lazy = new DamageReportService(parcels, agents, media, vendors, persons, drivers, managers, mdps);
      agents.get(dest.did).shopName = first.body.problem.shop!;
      const built = lazy.read(parcelId, staff);
      expect(built.body.custody).toEqual(first.body.custody);
      expect(built.body.events).toEqual(first.body.events);
      expect(built.sha256).toBe(first.sha256);
    });

    it('names who the network contracts with: a fleet’s company and never its driver; somebody who rides for themselves by the name they ride under', async () => {
      const reports = reportsOf();
      const fleetCo = managers.register({ companyName: 'Report Haulage', contactPhone: '+254800961', ownerFullName: 'R H', ownerNationalId: 'MGR-REP', location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: 'BRN-REP', transportOperatorLicence: 'TOL-REP', taxId: 'TAX-REP' } });
      managers.submitKyc(fleetCo.did, { businessRegCertRef: 'r.jpg', operatorLicenceRef: 'l.jpg', ownerIdRef: 'i.jpg', proofOfAddressRef: 'a.jpg' });
      managers.decideKyc(fleetCo.did, true);
      managers.recordBond(fleetCo.did);
      const employed = drivers.register({ displayName: 'Wanjiru D.', fullName: 'Wanjiru Driver', nationalId: 'DRV-REP-F', mobile: '+254733961001', licenceClasses: ['bike'], managerDid: fleetCo.did });
      const own = drivers.register({ displayName: 'Baraka R.', fullName: 'Baraka Rider', nationalId: 'DRV-REP-O', mobile: '+254733961002', licenceClasses: ['bike'] });

      const { parcelId } = reportedAtCounter('C');
      await settle();
      // The report is built from the chain of hands: here, as it would stand had those two each carried a leg.
      const p = parcels.get(parcelId);
      const at = p.custody![1];
      p.custody!.splice(1, 1, { ...at, holderId: employed.did }, { holderKind: 'driver', holderId: own.did, from: at.to!, to: at.to! }, { holderKind: 'hub', holderId: 'mdp_nowhere', from: at.to!, to: at.to! });
      const fresh = new DamageReportService(parcels, agents, media, vendors, persons, drivers, managers, mdps);
      const hands = fresh.read(parcelId, staff).body.custody.map((leg) => `${leg.holder.kind}: ${leg.holder.name}`);
      expect(hands.slice(1, 4)).toEqual(['driver: Report Haulage', 'driver: Baraka R.', 'hub: A sorting hub']);
      expect(JSON.stringify(fresh.read(parcelId, staff))).not.toMatch(/Wanjiru/);
      expect(reports.read(parcelId, staff).body.custody[1].holder.name).toBe('The carrier'); // the one already made is as it was made
    });

    it('is read by whoever it is for — the receiver, the shop that reported it, staff — and by nobody else', async () => {
      const reports = reportsOf();
      const { parcelId, origin, dest } = reportedAtCounter('D');
      await settle();
      expect(reports.read(parcelId, asPerson(RECEIVER)).body.number).toBe(`DCR-${parcelId}`);
      expect(reports.read(parcelId, asShop(dest.did)).body.number).toBe(`DCR-${parcelId}`);
      expect(reports.read(parcelId, staff).body.number).toBe(`DCR-${parcelId}`);
      // The SENDER is on the parcel, so they are told why — and are not handed what the receiver's side wrote.
      expect(() => reports.read(parcelId, asPerson(SENDER))).toThrow('The damage claim report was made for the receiver, who holds what was written and photographed. Ask them to pass it on to you.');
      // Anybody else is told nothing, not even that there is one: another person, the first shop, nobody signed in.
      expect(() => reports.read(parcelId, asPerson('+254700961199'))).toThrow(/No damage claim report on such a parcel/);
      expect(() => reports.read(parcelId, asShop(origin.did))).toThrow(/No damage claim report on such a parcel/);
      expect(() => reports.read(parcelId, undefined)).toThrow(/No damage claim report on such a parcel/);
      expect(() => reports.file(parcelId, asPerson(SENDER))).toThrow(/made for the receiver/);
      // A parcel nobody reported a problem on has no report, for anybody.
      const quiet = onboardAgent('Report Quiet', 'NorthTown', 50);
      parcels.accept({ agentDid: quiet.did, parcelId: 'QR-REPORT-QUIET', size: 'M', destZone: 'SouthTown', senderMobile: SENDER, receiverMobile: RECEIVER, dropoffPhotoRef: 'drop.jpg' });
      expect(() => reports.read('QR-REPORT-QUIET', staff)).toThrow(/No damage claim report/);
      expect(() => reports.read('QR-REPORT-QUIET', asPerson(RECEIVER))).toThrow(/No damage claim report/);
      expect(reports.ensure('QR-NO-SUCH-PARCEL')).toBeUndefined();
    });

    it('a store reads the report on its own order, and another store does not', async () => {
      const reports = reportsOf();
      const origin = onboardAgent('Report Store Origin', 'NorthTown');
      const dest = onboardAgent('Report Store Dest', 'SouthTown');
      const corridor = corridors.addCorridor({ name: 'RS', originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: 'did:glos:reps', name: 'D', corridorId: corridor.corridorId });
      const store = vendors.register({ name: 'Report Store' });
      const other = vendors.register({ name: 'Another Store' });
      vendors.topUp(store.vendorId, 200);
      const { parcel } = parcels.createInbound({ vendorId: store.vendorId, externalOrderId: 'ORD-REP-1', originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: RECEIVER, size: 'M', contentPhotoRef: 'content.jpg', subtotal: 4200, items: [{ name: 'Kettle', qty: 2 }, { name: 'Lid', qty: 1 }], shippingPolicy: store.shippingPolicy, quote: routing.quoteShipment(origin.did, dest.did, 'M') });
      parcels.intakeInbound(parcel.parcelId, origin.did);
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcel.parcelId] });
      parcels.shelve(parcel.parcelId, dest.did);
      parcels.collectConfirm(parcel.parcelId, dest.did, parcel.collectionCode!);
      await settle();
      const person = persons.ensurePerson(RECEIVER);
      parcels.buyerDispute(parcel.parcelId, person, person.personDid, 'One kettle is dented', 'problem.jpg');
      await settle();

      const mine = reports.read(parcel.parcelId, { active: true, role: 'vendor', did: store.did, sub: store.did, scopes: [] } as never);
      expect(mine.body.parcel).toMatchObject({ through: 'store', store: 'Report Store', orderNumber: 'ORD-REP-1', contents: ['2 × Kettle', 'Lid'], declaredValue: 4200 });
      // The value was stated; nothing covers it, because the company has stated no cover.
      expect(mine.body.terms.coverLimit).toBe(0);
      expect(mine.body.problem).toMatchObject({ origin: 'buyer', reason: 'One kettle is dented', parcelWas: 'handed over to the receiver' });
      // It had been handed over: it was in nobody's hands that the network answers for.
      expect(mine.body.problem).not.toHaveProperty('heldBy');
      expect(mine.body.custody[0].holder).toEqual({ kind: 'sender', name: 'Report Store' });
      expect(mine.body.photographs.map((x) => x.what)).toEqual(['contents', 'problem']);
      expect(() => reports.read(parcel.parcelId, { active: true, role: 'vendor', did: other.did, sub: other.did, scopes: [] } as never)).toThrow(/No damage claim report/);
      // ON A STORE'S ORDER TWO PARTIES MAY HAND IT ON — the receiver and the store — and each one's link is its own:
      // the other does not see it and cannot stop it.
      const asStore = { active: true, role: 'vendor', did: store.did, sub: store.did, scopes: [] } as never;
      const asBuyer = asPerson(RECEIVER);
      const theirs = reports.makeLink(parcel.parcelId, asBuyer);
      const ours = reports.makeLink(parcel.parcelId, asStore);
      expect(reports.linksFor(parcel.parcelId, asStore).map((l) => l.linkId)).toEqual([ours.link.linkId]);
      expect(reports.linksFor(parcel.parcelId, asBuyer).map((l) => l.linkId)).toEqual([theirs.link.linkId]);
      expect(() => reports.cancelLink(parcel.parcelId, theirs.link.linkId, asStore)).toThrow(/No such link on this report/);
      expect(reports.look(theirs.url.split('#report=')[1]).state).toBe('ready');
      expect(reports.cancelLink(parcel.parcelId, ours.link.linkId, asStore).state).toBe('cancelled');
      expect(reports.cancelLink(parcel.parcelId, theirs.link.linkId, staff).state).toBe('cancelled');

      // Staff's list has it, newest first, with what a reader needs to find it by.
      expect(reports.list()[0]).toMatchObject({ parcelId: parcel.parcelId, number: `DCR-${parcel.parcelId}`, origin: 'buyer', reason: 'One kettle is dented', store: 'Report Store', links: 0, opened: 0 });
      expect(reports.list()[0]).not.toHaveProperty('heldBy'); // it had been handed over
    });

    it('is handed on by a link its holder makes: unguessable, counted, limited, and theirs to cancel', async () => {
      const reports = reportsOf();
      const { parcelId, dest, proof } = reportedAtCounter('E');
      await settle();
      const receiver = asPerson(RECEIVER);
      const now = Date.parse('2026-10-12T10:00:00Z');

      // Not staff, and not the shop: a link is a way in that whoever the report is for made, can see, and can cancel.
      expect(() => reports.makeLink(parcelId, staff, now)).toThrow(/Staff read the report itself/);
      expect(() => reports.makeLink(parcelId, asShop(dest.did), now)).toThrow(/made by whoever the report is for/);
      expect(() => reports.makeLink(parcelId, asPerson(SENDER), now)).toThrow(/made for the receiver/);

      const made = reports.makeLink(parcelId, receiver, now);
      const token = made.url.split('#report=')[1];
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(made.url.startsWith('http')).toBe(true);
      expect(made.link).toMatchObject({ state: 'ready', opened: 0, expiresAt: new Date(now + LINK_DAYS * 86_400_000).toISOString() });
      // The key is nowhere but in that address.
      expect(JSON.stringify([reports.linksFor(parcelId, receiver, now), reports.list(now)])).not.toContain(token);

      const report = reports.read(parcelId, receiver);
      expect(reports.look(token, now)).toEqual({ state: 'ready', expiresAt: made.link.expiresAt, number: `DCR-${parcelId}`, parcelId, from: report.body.parcel.from, to: report.body.parcel.to, reportedAt: report.madeAt, sha256: report.sha256, opensLeft: LINK_MAX_OPENS });
      // Looking is not opening.
      expect(reports.linksFor(parcelId, receiver, now)[0].opened).toBe(0);

      // THE FILE: the page, the same facts for a machine, the photograph, and how to check the fingerprint.
      const file = reports.fetch(token, now);
      expect(file.filename).toBe(`damage-claim-report-${parcelId}.zip`);
      expect(file.bytes.subarray(0, 2).toString()).toBe('PK');
      const inside = file.bytes.toString('latin1');
      for (const name of ['damage-claim-report.html', 'report.json', 'README.txt', `photographs/problem-${proof}.png`]) expect(inside).toContain(name);
      expect(inside).toContain(report.sha256);
      expect(inside).toContain('The lid is cracked right across');
      expect(inside).toContain('Recorded by reference only: drop.jpg');
      // The bytes the fingerprint is taken over are in the file, exactly: anybody can work it out again from them.
      expect(file.bytes.includes(Buffer.from(canonicalJson(report.body), 'utf8'))).toBe(true);
      expect(reports.linksFor(parcelId, receiver, now)[0]).toMatchObject({ opened: 1, lastOpenedAt: new Date(now).toISOString() });
      expect(reports.list(now).find((r) => r.parcelId === parcelId)).toMatchObject({ links: 1, opened: 1 });
      // Signed in, the same file without a link.
      expect(reports.file(parcelId, receiver).bytes.length).toBe(file.bytes.length);

      // A key that is not ours, or nothing like one.
      expect(() => reports.look('A'.repeat(43), now)).toThrow(/not a link we made/);
      expect(() => reports.fetch('short', now)).toThrow(/not a link we made/);

      // IT STOPS: by the count, by its date, and by its holder's hand.
      for (let i = 1; i < LINK_MAX_OPENS; i += 1) reports.fetch(token, now);
      expect(reports.look(token, now)).toEqual({ state: 'used_up', expiresAt: made.link.expiresAt });
      expect(() => reports.fetch(token, now)).toThrow(/opened as often as one link can be/);
      const second = reports.makeLink(parcelId, receiver, now);
      const key2 = second.url.split('#report=')[1];
      expect(reports.look(key2, now + LINK_DAYS * 86_400_000).state).toBe('expired');
      expect(() => reports.fetch(key2, now + LINK_DAYS * 86_400_000)).toThrow(/its time is up/);
      // Somebody else's link is answered as one that does not exist.
      expect(() => reports.cancelLink(parcelId, second.link.linkId, asPerson(SENDER), now)).toThrow(/made for the receiver/);
      expect(() => reports.cancelLink(parcelId, 'drl_nothing', receiver, now)).toThrow(/No such link on this report/);
      expect(reports.cancelLink(parcelId, second.link.linkId, receiver, now).state).toBe('cancelled');
      expect(reports.cancelLink(parcelId, second.link.linkId, receiver, now + 5000).cancelledAt).toBe(new Date(now).toISOString());
      expect(() => reports.fetch(key2, now)).toThrow(/This link was cancelled/);

      // A HANDFUL AT ONCE, never a pile nobody remembers: the used-up and the cancelled ones do not count.
      for (let i = 0; i < LINK_MAX_LIVE; i += 1) reports.makeLink(parcelId, receiver, now);
      expect(() => reports.makeLink(parcelId, receiver, now)).toThrow(`This report already has ${LINK_MAX_LIVE} links that work. Cancel one to make another.`);
      // Staff see them all, and may cancel one; they are the only others who can.
      expect(reports.linksFor(parcelId, staff, now)).toHaveLength(LINK_MAX_LIVE + 2);
      expect(reports.linksFor(parcelId, asShop(dest.did), now)).toEqual([]);
    });
  });

  /**
   * THE STORE'S HALF of the damage claim report (the user, 2026-10-13: "the other half needs to be build as well, and
   * sending is indeed only emailing a link"). A store names an insurer on its shipping policy; every report on one of
   * its orders is emailed to that insurer as a link, the moment it is made; the store lists the reports on its orders.
   */
  describe('the store’s half: an insurer on the shipping policy, and the report emailed to it', () => {
    const settle = async () => {
      for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r));
    };
    const RECEIVER = '+254700971102';
    const staff = { active: true, role: 'operator', sub: 'operator:opr_a', actorName: 'Amina Otieno', scopes: ['*'] } as never;
    const asStore = (did: string) => ({ active: true, role: 'vendor', did, sub: did, scopes: [] }) as never;
    /** The report service as the module runs it: with the mail service, so a report made can be handed on. */
    const reportsOf = () => {
      const reports = new DamageReportService(parcels, agents, media, vendors, persons, drivers, managers, mdps, mailSvc);
      reports.onModuleInit();
      return reports;
    };
    /** A delivered order of the store's, with a problem reported by its buyer from their app. */
    async function reportedOrder(vendor: { vendorId: string }, tag: string, externalOrderId?: string) {
      const origin = onboardAgent(`Insurer Origin ${tag}`, 'NorthTown');
      const dest = onboardAgent(`Insurer Dest ${tag}`, 'SouthTown');
      const corridor = corridors.addCorridor({ name: `I ${tag}`, originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: `did:glos:ins${tag}`, name: 'D', corridorId: corridor.corridorId });
      const { parcel } = parcels.createInbound({ vendorId: vendor.vendorId, ...(externalOrderId ? { externalOrderId } : {}), originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: RECEIVER, size: 'M', contentPhotoRef: 'content.jpg', shippingPolicy: vendors.get(vendor.vendorId).shippingPolicy, quote: routing.quoteShipment(origin.did, dest.did, 'M') });
      parcels.intakeInbound(parcel.parcelId, origin.did);
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: [parcel.parcelId] });
      parcels.shelve(parcel.parcelId, dest.did);
      parcels.collectConfirm(parcel.parcelId, dest.did, parcel.collectionCode!);
      await settle();
      const person = persons.ensurePerson(RECEIVER);
      parcels.buyerDispute(parcel.parcelId, person, person.personDid, 'The handle came off in the box', 'problem.jpg');
      await settle();
      return parcel;
    }

    it('a store names its insurer on its shipping policy — whole or not at all, and null takes it off', () => {
      const store = vendors.register({ name: 'Insured Store' });
      expect(vendors.get(store.vendorId).shippingPolicy).not.toHaveProperty('insurer');
      vendors.updateProfile(store.vendorId, { shippingPolicy: { insurer: { name: '  Jubilee Allianz Claims ', email: ' Claims@Jubilee.Example ' } } });
      expect(vendors.get(store.vendorId).shippingPolicy.insurer).toEqual({ name: 'Jubilee Allianz Claims', email: 'claims@jubilee.example' });
      // The rest of the policy is untouched by naming an insurer, and the insurer by changing the rest.
      vendors.updateProfile(store.vendorId, { shippingPolicy: { mode: 'full' } });
      expect(vendors.get(store.vendorId).shippingPolicy).toMatchObject({ mode: 'full', insurer: { name: 'Jubilee Allianz Claims' } });
      // Half an insurer is none: a name with no address to send to, or an address that is not one.
      vendors.updateProfile(store.vendorId, { shippingPolicy: { insurer: { name: 'Somebody', email: 'not-an-address' } } });
      expect(vendors.get(store.vendorId).shippingPolicy).not.toHaveProperty('insurer');
      vendors.updateProfile(store.vendorId, { shippingPolicy: { insurer: { name: 'Jubilee', email: 'claims@jubilee.example' } } });
      vendors.updateProfile(store.vendorId, { shippingPolicy: { insurer: null } });
      expect(vendors.get(store.vendorId).shippingPolicy).not.toHaveProperty('insurer');
    });

    it('the report is emailed to the insurer as a link the moment it is made — a link the store sees on the report and can stop', async () => {
      const reports = reportsOf();
      const store = vendors.register({ name: 'Nairobi Threads' });
      vendors.topUp(store.vendorId, 200);
      vendors.updateProfile(store.vendorId, { shippingPolicy: { insurer: { name: 'Jubilee Allianz Claims', email: 'claims.threads@jubilee.example' } } });
      const parcel = await reportedOrder(store, 'A', 'ORD-20481');

      const [mail] = mailOutbox.recent('claims.threads@jubilee.example');
      expect(mail).toMatchObject({ template: 'damage-report', to: { address: 'claims.threads@jubilee.example', name: 'Jubilee Allianz Claims' }, subject: `Damage claim report DCR-${parcel.parcelId} — Nairobi Threads, order ORD-20481` });
      expect(mail.text).toContain('Nairobi Threads names Jubilee Allianz Claims as its insurer');
      expect(mail.text).toContain('The handle came off in the box');
      expect(mail.text).toContain('The receiver, from their own app');
      expect(mail.text).toMatch(/does not judge a claim for damage or loss and it offers no payment/);
      // THE LINK: a key of ours, in the part of an address no server is sent; it opens the report, signed out.
      const key = /#report=([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1];
      expect(key).toBeDefined();
      expect(reports.look(key!)).toMatchObject({ state: 'ready', number: `DCR-${parcel.parcelId}`, parcelId: parcel.parcelId });
      expect(reports.fetch(key!).filename).toBe(`damage-claim-report-${parcel.parcelId}.zip`);
      // It is the STORE's link: on the store's report, counted against the store's handful, and the store's to stop.
      const mine = reports.linksFor(parcel.parcelId, asStore(store.did));
      expect(mine).toEqual([expect.objectContaining({ state: 'ready', opened: 1 })]);
      expect(reports.linksFor(parcel.parcelId, { active: true, role: 'consumer', did: persons.ensurePerson(RECEIVER).personDid, sub: 'x', scopes: [] } as never)).toEqual([]);
      // The report says where it went, beside what it says — not inside it: the fingerprint is of what it SAYS.
      const read = reports.read(parcel.parcelId, asStore(store.did));
      expect(read.insurer).toEqual({ insurer: 'Jubilee Allianz Claims', sentTo: expect.stringMatching(/^c.*@.*example$/), at: expect.any(String) });
      expect(read.insurer!.sentTo).not.toContain('claims.threads');
      expect(read.sha256).toBe(fingerprintOf(read.body));
      expect(JSON.stringify(read.body)).not.toContain('Jubilee');
      expect(reports.cancelLink(parcel.parcelId, mine[0].linkId, asStore(store.did)).state).toBe('cancelled');
      expect(reports.look(key!).state).toBe('cancelled');
      // And the order itself says it has a report, for the store's own screen.
      expect(parcels.vendorOrderView(store.vendorId, parcel.parcelId).damageReport).toEqual({ number: `DCR-${parcel.parcelId}` });
    });

    it('lists the reports on a store’s own orders, for the store and for staff, and for nobody else', async () => {
      const reports = reportsOf();
      const store = vendors.register({ name: 'Listed Store' });
      vendors.topUp(store.vendorId, 200);
      vendors.updateProfile(store.vendorId, { shippingPolicy: { insurer: { name: 'Britam', email: 'claims.listed@britam.example' } } });
      const other = vendors.register({ name: 'Other Store' });
      const parcel = await reportedOrder(store, 'B');

      const rows = reports.listForStore(store.vendorId, asStore(store.did));
      expect(rows).toEqual([expect.objectContaining({ parcelId: parcel.parcelId, number: `DCR-${parcel.parcelId}`, origin: 'buyer', store: 'Listed Store', reason: 'The handle came off in the box', links: 1, insurer: expect.objectContaining({ insurer: 'Britam' }) })]);
      expect(reports.listForStore(store.vendorId, staff)).toHaveLength(1);
      expect(reports.listForStore(other.vendorId, asStore(other.did))).toEqual([]);
      // Another store, nobody signed in, and a store that does not exist: told nothing.
      expect(() => reports.listForStore(store.vendorId, asStore(other.did))).toThrow(/No such store/);
      expect(() => reports.listForStore(store.vendorId, undefined)).toThrow(/No such store/);
      expect(() => reports.listForStore('ven_nobody', staff)).toThrow(/No such store/);
    });

    it('sends nothing where the store names no insurer — the store reads the report in its own app', async () => {
      const reports = reportsOf();
      const store = vendors.register({ name: 'Uninsured Store' });
      vendors.topUp(store.vendorId, 200);
      const sent = mailOutbox.recent().length;
      const parcel = await reportedOrder(store, 'C');
      expect(mailOutbox.recent().filter((m) => m.template === 'damage-report')).toHaveLength(mailOutbox.recent().slice(0, mailOutbox.recent().length - sent).filter((m) => m.template === 'damage-report').length);
      expect(mailOutbox.recent().length).toBe(sent);
      const read = reports.read(parcel.parcelId, asStore(store.did));
      expect(read).not.toHaveProperty('insurer');
      expect(reports.linksFor(parcel.parcelId, asStore(store.did))).toEqual([]);
      expect(reports.listForStore(store.vendorId, asStore(store.did))[0]).not.toHaveProperty('insurer');
    });
  });

  /**
   * A FULL SHELF. A shop is approved with as few as six slots, and a shop that size is full by lunchtime — so what
   * happens to the next parcel, and to a bag of them, is not an edge. Both used to leave records half-written.
   */
  describe('a full shelf: a parcel stays as it was, and a bag goes on whole or not at all', () => {
    /** A shop in SouthTown with six slots, `taken` of them already holding something. */
    const smallShop = (tag: string, taken: number) => {
      const dest = onboardAgent(`Full Dest ${tag}`, 'SouthTown', 50);
      agents.setLocation(dest.did, { lat: -1.35, lng: 36.95 });
      shelfSvc.reconfigure(dest.did, { rows: 2, cols: 3 });
      for (let i = 0; i < taken; i += 1) shelfSvc.assign(dest.did, `WAITING-${tag}-${i}`, 'M');
      return agents.get(dest.did);
    };

    it('a parcel arriving at a full shelf is left on the bus exactly as it was, and is taken the moment a slot is free', () => {
      const origin = onboardAgent('Full Origin P', 'NorthTown', 50);
      const dest = smallShop('P', 6);
      const corridor = corridors.addCorridor({ name: 'Full P', originZone: 'NorthTown', destZone: 'SouthTown' });
      const driver = corridors.addDriver({ driverDid: 'did:glos:fullp', name: 'D', corridorId: corridor.corridorId });
      parcels.accept({ agentDid: origin.did, parcelId: 'QR-FULL-P', size: 'M', destZone: 'SouthTown', senderMobile: '+254700941101', receiverMobile: '+254700941102', dropoffPhotoRef: 'r.jpg' });
      parcels.handover({ agentDid: origin.did, driverBadgeId: driver.badgeId, parcelIds: ['QR-FULL-P'] });
      const scans = parcels.get('QR-FULL-P').scans.length;
      const paid = agents.balance(dest.did);

      expect(() => parcels.arrive('QR-FULL-P', dest.did)).toThrow(/shelf here is full/);
      // It was marked ready to collect BEFORE a slot was asked for: refused, it stayed "ready", in no slot, and
      // could never be scanned in again.
      const after = parcels.get('QR-FULL-P');
      expect(after.status).toBe('On_Bus');
      expect(after.binSlot).toBeUndefined();
      expect(after.readyAt).toBeUndefined();
      expect(after.scans).toHaveLength(scans);
      expect(agents.balance(dest.did)).toBe(paid);

      shelfSvc.release(dest.did, 'WAITING-P-0');
      expect(parcels.arrive('QR-FULL-P', dest.did)).toMatchObject({ status: 'Ready_For_Pickup', binSlot: 'Red-1' });
    });

    it('a bag that does not fit is refused whole — nothing shelved, nothing paid, the bag as it was — and received once there is room, each parcel with its slot', () => {
      const origin = onboardAgent('Full Origin B', 'NorthTown', 50);
      const dest = smallShop('B', 4); // two slots free
      const d = drivers.register({ displayName: 'HFB', fullName: 'H FB', nationalId: 'DRV-FULL-B', mobile: '+254733941177', licenceClasses: ['bike'] });
      const bike = vehicles.register({ plate: 'FB-1', vehicleClass: 'bike', ownerName: 'H', pricePerKm: 0.1, toteCapacity: 4 });
      fleet.couple(d.did, bike.vehicleId);
      const bag = totes.register(origin.did);
      totes.assign(bag.code, dest.did, dest.shopName);
      const ids = ['FULL-B-0', 'FULL-B-1', 'FULL-B-2'];
      for (const pid of ids) {
        parcels.accept({ agentDid: origin.did, parcelId: pid, size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
        mdps.fillTote(bag.code, pid);
      }
      dispatch.release(bag.code);
      const [offer] = dispatch.suggest(d.did, { from: origin.location, to: dest.location }).filter((o) => o.ref === bag.code);
      dispatch.claim(offer.offerId);
      mdps.loadBag(bag.code, drivers.get(d.did).badgeId!);
      const statuses = () => ids.map((id) => parcels.get(id).status);
      const aboard = statuses();
      const paid = agents.balance(dest.did);

      // Three parcels, two slots. The first two used to be shelved and paid for before the third was refused.
      expect(() => mdps.deliverBag(dest.did, bag.code)).toThrow(`Bag ${bag.code} holds 3 parcels and your shelf has no room for all of them. Hand over parcels that are waiting, or add a row under “Set up shelves”, then scan the bag again`);
      expect(statuses()).toEqual(aboard);
      expect(ids.map((id) => parcels.get(id).binSlot)).toEqual([undefined, undefined, undefined]);
      expect(shelfSvc.available(dest.did)).toBe(2);
      expect(totes.requireByCode(bag.code).parcels).toEqual(ids);
      expect(agents.balance(dest.did)).toBe(paid);

      // A waiting parcel is handed over; the same bag, scanned again, goes on whole.
      shelfSvc.release(dest.did, 'WAITING-B-0');
      const received = mdps.deliverBag(dest.did, bag.code);
      expect(received.delivered).toEqual(ids);
      // WHERE EACH ONE GOES: every parcel with the slot it was given, and no two in one.
      expect(received.shelved).toEqual(ids.map((id) => ({ parcelId: id, slot: parcels.get(id).binSlot })));
      expect(new Set(received.shelved.map((s) => s.slot)).size).toBe(3);
      expect(statuses()).toEqual(['Ready_For_Pickup', 'Ready_For_Pickup', 'Ready_For_Pickup']);
      expect(shelfSvc.available(dest.did)).toBe(0);
      expect(totes.requireByCode(bag.code).parcels).toEqual([]);
    });
  });

  describe('a bag is paid for the road it travels, not a flat fee', () => {
    /** A courier with a KNOWN per-km rate, and a bag from `origin` addressed to `dest`. */
    const bagRun = (tag: string, opts: { destinationNodeId: string; parcels?: number } = { destinationNodeId: '' }) => {
      const origin = onboardAgent(`Haul Origin ${tag}`, 'NorthTown', 50);
      const d = drivers.register({ displayName: `H${tag}`, fullName: `H ${tag}`, nationalId: `DRV-HAUL-${tag}`, mobile: `+2549111${tag}`, licenceClasses: ['bike'] });
      // Room for more than one bag, so a test can have the same driver claim twice.
      const bike = vehicles.register({ plate: `HV-${tag}`, vehicleClass: 'bike', ownerName: 'H', pricePerKm: 0.1, toteCapacity: 4 });
      fleet.couple(d.did, bike.vehicleId);
      const bag = totes.register(origin.did);
      totes.assign(bag.code, opts.destinationNodeId, 'Somewhere');
      for (let i = 0; i < (opts.parcels ?? 1); i += 1) {
        const pid = `HAUL-${tag}-${i}`;
        parcels.accept({ agentDid: origin.did, parcelId: pid, size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
        mdps.fillTote(bag.code, pid);
      }
      dispatch.release(bag.code);
      return { origin, d, bag };
    };

    it('locks the road price at CLAIM, from the distance, the vehicle’s own rate and what is in the bag', () => {
      // Locked here for the same reason a freight's price is: the driver agreed to the job whose distance
      // and contents were what they were at that moment.
      const dest = onboardAgent('Haul Dest A', 'SouthTown', 50); agents.setLocation(dest.did, { lat: -1.35, lng: 36.95 });
      const { origin, d, bag } = bagRun('A', { destinationNodeId: dest.did, parcels: 2 });
      const [offer] = dispatch.suggest(d.did, { from: origin.location, to: dest.location }).filter((o) => o.ref === bag.code);
      dispatch.claim(offer.offerId);

      const haul = totes.requireByCode(bag.code).haul!;
      expect(haul.basis).toBe('measured');
      expect(haul.ratePerKm).toBe(0.1); // the CARRYING vehicle's own advertised rate, not a network default
      expect(haul.units).toBe(2); // two mediums = two medium-equivalents, the buyers' own basis
      expect(haul.tripKm).toBeGreaterThan(0);
      expect(haul.road).toBeCloseTo(haul.tripKm * 0.1 * 2, 2);
    });

    it('pays the handling on LOAD and the road on ARRIVAL — a journey not yet made is not owed', () => {
      const dest = onboardAgent('Haul Dest B', 'SouthTown', 50); agents.setLocation(dest.did, { lat: -1.35, lng: 36.95 });
      const { origin, d, bag } = bagRun('B', { destinationNodeId: dest.did });
      const [offer] = dispatch.suggest(d.did, { from: origin.location, to: dest.location }).filter((o) => o.ref === bag.code);
      dispatch.claim(offer.offerId);
      const road = totes.requireByCode(bag.code).haul!.road;

      mdps.loadBag(bag.code, drivers.get(d.did).badgeId!);
      const afterLoad = gate.entries({ type: 'DRIVER_PAYOUT' }).filter((e) => e.reference === d.did);
      expect(afterLoad).toHaveLength(1);
      expect(afterLoad[0].amount).toBe(TOTE_LOAD_FEE); // the scan is real work and is earned on the spot

      mdps.deliverBag(dest.did, bag.code);
      const afterArrival = gate.entries({ type: 'DRIVER_PAYOUT' }).filter((e) => e.reference === d.did);
      expect(afterArrival).toHaveLength(2);
      // Asserted as a SET — the ledger reads newest-first, and which end of it the road lands on is not
      // what this test is about.
      expect(afterArrival.map((e) => e.amount).sort((a, b) => a - b)).toEqual([TOTE_LOAD_FEE, road].sort((a, b) => a - b));
      expect(road).toBeGreaterThan(TOTE_LOAD_FEE); // the point: the road is worth more than the fifty cents
    });

    it('records an unplaceable destination rather than inventing a distance', () => {
      // A zone nothing serves. The bag still moves and the driver is still paid to handle it, but nobody
      // guesses at a road — and `basis` is what lets an operator SEE that, instead of it rounding to zero.
      const { origin, d, bag } = bagRun('C', { destinationNodeId: 'zone-nobody-serves' });
      const [offer] = dispatch.suggest(d.did, { from: origin.location, to: { lat: -1.3, lng: 36.9 } }).filter((o) => o.ref === bag.code);
      dispatch.claim(offer.offerId);
      const haul = totes.requireByCode(bag.code).haul!;
      expect(haul.basis).toBe('unresolved');
      expect(haul.road).toBe(0);
    });

    it('tells the driver what a bag pays BEFORE they agree to it, and pays exactly that', () => {
      // The consent surface. A bag offer used to carry no price at all, and every screen fell back to the
      // flat loading fee — true while that was the whole of a bag's pay, and an understatement the moment
      // the road entered it. A driver comparing "Bag · 0.50" against a priced freight would never take one.
      const dest = onboardAgent('Haul Dest E', 'SouthTown', 50); agents.setLocation(dest.did, { lat: -1.35, lng: 36.95 });
      const { origin, d, bag } = bagRun('E', { destinationNodeId: dest.did, parcels: 2 });
      const [offer] = dispatch.suggest(d.did, { from: origin.location, to: dest.location }).filter((o) => o.ref === bag.code);

      expect(offer.earn).toBeGreaterThan(TOTE_LOAD_FEE); // not the flat fee any more
      dispatch.claim(offer.offerId);
      mdps.loadBag(bag.code, drivers.get(d.did).badgeId!);
      mdps.deliverBag(dest.did, bag.code);

      // What was promised is what arrives: the offer's figure equals the sum of the two ledger lines.
      const paid = gate.entries({ type: 'DRIVER_PAYOUT' }).filter((e) => e.reference === d.did).reduce((s, e) => s + e.amount, 0);
      expect(Math.round(paid * 100) / 100).toBe(offer.earn);
    });

    it('pays for loading a bag what the driver’s own company says — on the offer, and at the scan', () => {
      // It was a constant, in the code. The offer and the scan each read it, so a figure changed in one place
      // would have promised a driver one amount and paid another.
      entities.setAmounts(entities.requireForJurisdiction('KE').entityId, { toteLoadFee: 35 }, 'Amina Otieno');
      const dest = onboardAgent('Haul Dest G', 'SouthTown', 50); agents.setLocation(dest.did, { lat: -1.35, lng: 36.95 });
      const { origin, d, bag } = bagRun('G', { destinationNodeId: dest.did, parcels: 1 });
      expect(drivers.payTermsOf(d.did)).toEqual({ bagLoadPay: 35, currency: 'KES' });
      const [offer] = dispatch.suggest(d.did, { from: origin.location, to: dest.location }).filter((o) => o.ref === bag.code);
      dispatch.claim(offer.offerId);
      const road = totes.requireByCode(bag.code).haul!.road;
      expect(offer.earn).toBe(Math.round((35 + road) * 100) / 100);

      mdps.loadBag(bag.code, drivers.get(d.did).badgeId!);
      expect(gate.entries({ type: 'DRIVER_PAYOUT' }).filter((e) => e.reference === d.did).map((e) => e.amount)).toEqual([35]);
    });

    it('shows what the pay is MADE of — how many parcels, and how full the bag is', () => {
      // A figure with nothing behind it is a figure taken on trust. These two are also the only way to tell
      // a bag worth a whole slot in the hold from one worth a fifth of it, which is the real decision when
      // there are two spaces left and the day is not over.
      const dest = onboardAgent('Haul Dest F', 'SouthTown', 50); agents.setLocation(dest.did, { lat: -1.35, lng: 36.95 });
      const { origin, d, bag } = bagRun('F', { destinationNodeId: dest.did, parcels: 3 });
      const [offer] = dispatch.suggest(d.did, { from: origin.location, to: dest.location }).filter((o) => o.ref === bag.code);
      expect(offer.parcels).toBe(3);
      expect(offer.fillPct).toBe(totes.fillPct(totes.requireByCode(bag.code))); // the bag's own figure, not a re-derivation
      expect(offer.fillPct).toBeGreaterThan(0);
    });

    it('a freight offer carries no bag fill — it is not a bag', () => {
      // The fields are bag-only on purpose. A freight showing "0 parcels · 0% full" would be a screen
      // inventing a fact about a load that has no such property.
      const d = negotiator('PF');
      const pickup = { lat: -1.2, lng: 36.8 };
      const f = dispatch.registerFreight({ description: 'Steel', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80] });
      const [offer] = dispatch.suggest(d.did, { from: pickup, to: pickup }).filter((o) => o.ref === f.freightId);
      expect(offer.parcels).toBeUndefined();
      expect(offer.fillPct).toBeUndefined();
      expect(offer.earn).toBe(offer.price!.total); // …and its earning is still the priced total
    });

    it('a bag now knows where it is going as a PLACE, not only as a name', () => {
      // The gap that made "is this on my way?" answerable for a freight and not for a bag — and left a
      // driver navigated to the pickup and then abandoned. It is also what the road price is measured over.
      const dest = onboardAgent('Haul Dest G', 'SouthTown', 50); agents.setLocation(dest.did, { lat: -1.35, lng: 36.95 });
      const { origin, d, bag } = bagRun('G', { destinationNodeId: dest.did });
      const [offer] = dispatch.suggest(d.did, { from: origin.location, to: dest.location }).filter((o) => o.ref === bag.code);
      expect(offer.destLocation).toEqual(dest.location);
    });

    it('leaves the destination unplaced rather than guessing at one', () => {
      // A coordinate here becomes a distance and a direction. A zone centroid would look like an answer and
      // would not be one, so an unresolvable destination stays absent and every consumer can see that.
      const { origin, d, bag } = bagRun('H', { destinationNodeId: 'zone-nobody-serves' });
      const [offer] = dispatch.suggest(d.did, { from: origin.location, to: { lat: -1.3, lng: 36.9 } }).filter((o) => o.ref === bag.code);
      expect(offer.destLocation).toBeUndefined();
    });

    it('costs the driver in MINUTES, split into collecting it and then carrying it', () => {
      // Time is what a driver spends, and the only unit they can justify to a vehicle full of passengers.
      const dest = onboardAgent('Haul Dest T', 'SouthTown', 50); agents.setLocation(dest.did, { lat: -1.35, lng: 36.95 });
      const { origin, d, bag } = bagRun('T', { destinationNodeId: dest.did });
      // A road that ends where the driver was already going — near the pickup, far from the drop.
      const [offer] = dispatch.suggest(d.did, { from: origin.location, to: { lat: -1.21, lng: 36.81 } }).filter((o) => o.ref === bag.code);
      expect(offer.collectMin).toBeGreaterThanOrEqual(0);
      expect(offer.deliverMin).toBeGreaterThan(0); // the drop is well off this road, and it must SAY so
    });

    it('counts the DESTINATION, which the kilometre figure never did', () => {
      // The defect this exposes: detourKm treats a load as a single via-point, so a pickup on the doorstep
      // whose drop is far the wrong way reported a tiny detour. Two bags collected from the same doorstep,
      // going opposite ways, were indistinguishable on the old figure.
      const near = onboardAgent('Drop Near', 'NorthTown', 50); agents.setLocation(near.did, { lat: -1.205, lng: 36.805 });
      const far = onboardAgent('Drop Far', 'SouthTown', 50); agents.setLocation(far.did, { lat: -1.9, lng: 37.6 });
      const a = bagRun('N', { destinationNodeId: near.did });
      const b = bagRun('F2', { destinationNodeId: far.did });
      const road = { from: a.origin.location, to: { lat: -1.21, lng: 36.81 } };

      const [offerNear] = dispatch.suggest(a.d.did, road).filter((o) => o.ref === a.bag.code);
      const [offerFar] = dispatch.suggest(b.d.did, { from: b.origin.location, to: road.to }).filter((o) => o.ref === b.bag.code);

      expect(offerNear.detourKm).toBe(offerFar.detourKm); // the old figure cannot tell them apart…
      expect(offerFar.deliverMin!).toBeGreaterThan(offerNear.deliverMin!); // …and the new one can
    });

    describe('taking a load says where you are going', () => {
      const claimBagTo = (tag: string) => {
        const dest = onboardAgent(`Derive Dest ${tag}`, 'SouthTown', 50); agents.setLocation(dest.did, { lat: -1.35, lng: 36.95 });
        const { origin, d, bag } = bagRun(tag, { destinationNodeId: dest.did });
        const [offer] = dispatch.suggest(d.did, { from: origin.location, to: dest.location }).filter((o) => o.ref === bag.code);
        return { dest, origin, d, bag, offer };
      };

      it('derives the road from the load, and marks it as OURS', () => {
        // Both ends are known the instant a bag is claimed, and the network used to discard that — leaving a
        // driver who had just committed to a road matched against nothing.
        const { d, offer } = claimBagTo('X1');
        expect(fleet.workFor(d.did)).toBeUndefined(); // nothing said, nothing derived, yet
        dispatch.claim(offer.offerId);
        const work = fleet.workFor(d.did);
        expect(work?.kind).toBe('leg');
        // Named exactly as the load named its ends, so the road the app talks about and the job the driver
        // took are recognisably the same thing.
        expect(work).toMatchObject({ fromLabel: offer.pickupLabel, toLabel: offer.destLabel, source: 'derived' });
      });

      it('NEVER overrides a road the driver declared themselves', () => {
        // The restraint that matters. Someone who said "Nakuru" this morning and then carries a bag two
        // streets has not changed their mind, and rewriting their road with our guess is the app arguing
        // with the person driving.
        const { d, offer } = claimBagTo('X2');
        fleet.declareLeg(d.did, { fromLabel: 'Town', from: { lat: -1.2, lng: 36.8 }, toLabel: 'Nakuru', to: { lat: -0.3, lng: 36.07 } });
        dispatch.claim(offer.offerId);
        expect(fleet.workFor(d.did)).toMatchObject({ toLabel: 'Nakuru', source: 'declared' });
      });

      it('leaves a rider’s declared PATCH alone too', () => {
        // A rider working a district has chosen a shape this cannot improve on — turning it into a road
        // would make every load two streets away read as further off than it is.
        const { d, offer } = claimBagTo('X3');
        fleet.declareArea(d.did, 5);
        dispatch.claim(offer.offerId);
        expect(fleet.workFor(d.did)?.kind).toBe('area');
      });

      /** Another bag at the same shop for the same road — so the SAME driver can claim twice. */
      const anotherBag = (tag: string, origin: { did: string; location: { lat: number; lng: number } }, dest: { did: string; shopName: string }, d: { did: string }) => {
        const bag = totes.register(origin.did);
        totes.assign(bag.code, dest.did, dest.shopName);
        parcels.accept({ agentDid: origin.did, parcelId: `DERIVE-${tag}`, size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
        mdps.fillTote(bag.code, `DERIVE-${tag}`);
        dispatch.release(bag.code);
        return dispatch.suggest(d.did, { from: origin.location, to: { lat: -1.35, lng: 36.95 } }).find((o) => o.ref === bag.code)!;
      };

      it('switching it off clears it AND keeps it off for the shift', () => {
        // One decision, honoured. Without the second half, turning it off would clear a road that the very
        // next claim puts straight back — which is not a switch, it is an argument.
        const { d, origin, dest, offer } = claimBagTo('X4');
        dispatch.claim(offer.offerId);
        expect(fleet.workFor(d.did)).toBeDefined();

        fleet.setDerivedLeg(d.did, false);
        expect(fleet.workFor(d.did)).toBeUndefined();

        dispatch.claim(anotherBag('X4b', origin, dest, d).offerId); // the same driver takes another
        expect(fleet.workFor(d.did)).toBeUndefined(); // still off — it did not creep back
      });

      it('switching it back on lets the NEXT load speak again', () => {
        const { d, origin, dest, offer } = claimBagTo('X6');
        dispatch.claim(offer.offerId);
        fleet.setDerivedLeg(d.did, false);
        fleet.setDerivedLeg(d.did, true);
        expect(fleet.workFor(d.did)).toBeUndefined(); // the cleared road does not return on its own…

        dispatch.claim(anotherBag('X6b', origin, dest, d).offerId);
        expect(fleet.workFor(d.did)).toMatchObject({ source: 'derived' }); // …but the next load speaks
      });
    });

    it('a released claim releases its price too', () => {
      // The next driver's vehicle, distance and the bag's contents may all differ, so their number must be
      // struck fresh rather than inherited from somebody who walked away.
      const dest = onboardAgent('Haul Dest D', 'SouthTown', 50); agents.setLocation(dest.did, { lat: -1.35, lng: 36.95 });
      const { origin, d, bag } = bagRun('D', { destinationNodeId: dest.did });
      const [offer] = dispatch.suggest(d.did, { from: origin.location, to: dest.location }).filter((o) => o.ref === bag.code);
      dispatch.claim(offer.offerId);
      expect(totes.requireByCode(bag.code).haul).toBeDefined();
      totes.unclaim(bag.code);
      expect(totes.requireByCode(bag.code).haul).toBeUndefined();
    });
  });

  describe('a driver’s per-km rate is said in the money it earns them, beside rates in the same money', () => {
    // It read “Your rate 0.080 per km. Most drivers charge 0.080 (0.080–0.080 across 7 vehicles)”: four figures and
    // not one said what money it was — and the median was taken across every vehicle on the network, whatever it
    // is paid in, with a button beside it that sets the driver's own price to it.
    let seq = 0;
    const fleetIn = (country: string, prices: number[]) => {
      seq += 1;
      const m = managers.register({ companyName: `Rate Haulage ${seq}`, jurisdiction: country, contactPhone: `+2567009${seq}`, ownerFullName: 'R R', ownerNationalId: `MGR-RATE-${seq}`, location: { lat: 0.3, lng: 32.6 }, requirements: { businessRegistrationNo: `BRN-R${seq}`, transportOperatorLicence: `TOL-R${seq}`, taxId: `TAX-R${seq}` } } as never);
      managers.submitKyc(m.did, { businessRegCertRef: 'r.jpg', operatorLicenceRef: 'l.jpg', ownerIdRef: 'i.jpg', proofOfAddressRef: 'a.jpg' });
      managers.decideKyc(m.did, true);
      managers.recordBond(m.did);
      const owned = prices.map((p, i) => vehicles.register({ plate: `RT-${seq}-${i}`, vehicleClass: 'bike', ownerName: 'R', managerDid: m.did, pricePerKm: p }));
      const driver = drivers.register({ displayName: `Rate ${seq}`, fullName: 'R D', nationalId: `DRV-RATE-${seq}`, mobile: `+2567008${seq}`, licenceClasses: ['bike'], managerDid: m.did });
      fleet.couple(driver.did, owned[0].vehicleId);
      return { manager: m, driver, owned };
    };
    const asDriver = (did: string) => ({ active: true, role: 'driver', did }) as never;
    const ratesFor = (actor: unknown) => controller.pricingNear(actor as never, 'vehicle') as { currency?: string; benchmark: { count: number; median: number; min: number; max: number } };
    const uganda = () => {
      const ug = entities.createCompany({ kind: 'sister', jurisdiction: 'UG', name: 'SeeBuyGet Uganda' }, 'Amina Otieno');
      return entities.activate(ug.entityId, 'Amina Otieno');
    };

    it('names the money: the company’s that pays the driver — their fleet’s', () => {
      const ke = fleetIn('KE', [0.08, 0.1, 0.12]);
      expect(drivers.rateCurrencyOf(ke.owned[0])).toBe('KES');
      expect(drivers.rateCurrencyForDriver(ke.driver.did)).toBe('KES');
      expect(ratesFor(asDriver(ke.driver.did))).toMatchObject({ currency: 'KES', benchmark: { count: 3, median: 0.1, min: 0.08, max: 0.12 } });
    });

    it('sets a driver only beside vehicles priced in their own money — another country’s rates stay out of the median', () => {
      uganda();
      const ke = fleetIn('KE', [0.08, 0.1]);
      const ug = fleetIn('UG', [300, 400, 500]);
      expect(drivers.rateCurrencyOf(ug.owned[0])).toBe('UGX');

      // The point: before, both drivers were told the median of five rates in two currencies.
      expect(ratesFor(asDriver(ke.driver.did))).toMatchObject({ currency: 'KES', benchmark: { count: 2, min: 0.08, max: 0.1 } });
      expect(ratesFor(asDriver(ug.driver.did))).toMatchObject({ currency: 'UGX', benchmark: { count: 3, median: 400, min: 300, max: 500 } });
    });

    it('compares a driver whose work no company of ours pays with nobody, and names no money for them', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      fleetIn('KE', [0.1]);
      const tz = fleetIn('TZ', [0.5]);
      expect(drivers.rateCurrencyOf(tz.owned[0])).toBeUndefined(); // agreed between the two parties, in whatever money
      const answer = ratesFor(asDriver(tz.driver.did));
      expect(answer.currency).toBeUndefined();
      expect(answer.benchmark.count).toBe(0); // and the app shows nothing rather than a guess
    });

    it('leaves out a rate nobody can be said to be paid in — a vehicle with no fleet and no owner on record', () => {
      const ke = fleetIn('KE', [0.1, 0.1]);
      const nobodys = vehicles.register({ plate: 'RT-NONE', vehicleClass: 'bike', ownerName: 'Legacy', pricePerKm: 9 });
      expect(drivers.rateCurrencyOf(nobodys)).toBeUndefined();
      expect(ratesFor(asDriver(ke.driver.did)).benchmark).toMatchObject({ count: 2, max: 0.1 });
    });

    it('prices a courier’s own vehicle in the money of the company that pays the courier', () => {
      const courier = drivers.register({ displayName: 'Own Rate', fullName: 'O R', nationalId: 'DRV-RATE-OWN', mobile: '+254700800900', licenceClasses: ['bike'], jurisdiction: 'KE' });
      const own = vehicles.register({ plate: 'RT-OWN', vehicleClass: 'bike', ownerName: 'Own Rate', ownerType: 'driver_owned', ownerDriverDid: courier.did, pricePerKm: 0.2 } as never);
      expect(drivers.rateCurrencyOf(own)).toBe('KES');
      expect(ratesFor(asDriver(courier.did))).toMatchObject({ currency: 'KES', benchmark: { count: 1, median: 0.2 } });
    });

    it('answers anybody who is not a driver in the network’s money', () => {
      fleetIn('KE', [0.1]);
      expect(ratesFor({ active: true, role: 'operator', did: 'did:glos:staff' })).toMatchObject({ currency: 'KES', benchmark: { count: 1 } });
    });

    it('says once, on the driver’s session, the money everything priced for them is in — and none where nobody of ours pays them', () => {
      // The board, an offer, their own loads and their earnings were all bare numbers. The session is the one answer
      // every one of those screens already has.
      uganda();
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const session = (did: string) => controller.driverSession(did, asDriver(did)) as { currency?: string; active: boolean };
      expect(session(fleetIn('KE', [0.1]).driver.did)).toMatchObject({ active: true, currency: 'KES' });
      expect(session(fleetIn('UG', [300]).driver.did)).toMatchObject({ active: true, currency: 'UGX' });
      expect(session(fleetIn('TZ', [0.5]).driver.did).currency).toBeUndefined();
      // Off shift too: the board and the earnings are read without a vehicle.
      const idle = drivers.register({ displayName: 'Idle', fullName: 'I D', nationalId: 'DRV-RATE-IDLE', mobile: '+254700800901', licenceClasses: ['bike'], jurisdiction: 'KE' });
      expect(session(idle.did)).toMatchObject({ active: false, currency: 'KES' });
    });

    it('freezes a job’s money with its price at the claim — the register row and the exports say it, whatever the carrier does next', () => {
      // A job's export said the network's money; and a driver who later moved to a fleet in another country would have
      // read an old job in today's money. The money is now kept with the price, when the price is locked.
      uganda();
      const ug = fleetIn('UG', [300]);
      const kampala = { lat: 0.31, lng: 32.58 };
      const f = dispatch.registerFreight({ description: 'Shoes', pickupLocation: kampala, pickupLabel: 'Depot', destLabel: 'Shop', destLocation: { lat: 0.33, lng: 32.6 }, weightKg: 5, packaging: 'bagged' });
      const [offer] = dispatch.suggest(ug.driver.did, { from: kampala, to: { lat: 0.33, lng: 32.6 } }).filter((o) => o.ref === f.freightId);
      dispatch.claim(offer.offerId);
      const locked = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
      expect(locked.lockedCurrency).toBe('UGX');
      expect(driverJobRowOf(locked)).toMatchObject({ earning: locked.lockedPrice, currency: 'UGX' });
      expect(driverJobsToCsv([locked]).split('\n')[1]).toContain(',UGX,');
      expect(fleetJobsToCsv([locked], () => 'Rate D').split('\n')[1]).toContain(',UGX,'); // the fleet office's export too
      expect(lockedCurrencyOf({})).toBe('KES'); // a haul locked before the money was kept reads as it always did
    });
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

  /**
   * A DRIVER'S REFUSAL CARRIES A REASON TOO — and their papers are cleared so they can send new ones.
   *
   * The whole decision had no test: 1375 passing tests and nothing had ever refused a driver. It also had
   * no SCREEN — `fleet/drivers/kyc-queue` was live from the day the registry shipped and no console read
   * it, so a driver who uploaded an ID and a licence waited in KYC_PENDING with nobody able to look at
   * either. Silence at both ends of the same decision.
   */
  it('refuses to reject a driver without saying why, and clears their papers when it does', () => {
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const d = drivers.register({ displayName: 'Grace', fullName: 'Grace M', nationalId: 'DRV-ID-REJ', mobile: '+254900777', licenceClasses: ['van'], licenceNumber: 'L-REJ', licenceExpiresAt: future, criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'med_id', licenceCopyRef: 'med_lic' });

    expect(() => drivers.decideKyc(d.did, false, 'ops')).toThrow(/why/i);
    expect(() => drivers.decideKyc(d.did, false, 'ops', '  ')).toThrow(/why/i);
    // Refused, so the application still stands where it was.
    expect(drivers.get(d.did).status).toBe('KYC_PENDING');

    const rejected = drivers.decideKyc(d.did, false, 'ops', 'The licence photo was unreadable.');
    expect(rejected.status).toBe('DRAFT');
    expect(rejected.kycRejection).toMatchObject({ reason: 'The licence photo was unreadable.', by: 'ops' });
    // Cleared, or `submitKyc` (DRAFT + a full pair only) gives them no way to replace the bad photo.
    expect(rejected.kyc).toBeUndefined();
    expect(events.getLog().some((e) => e.type === GlosEvent.Pudo.DriverKycRejected)).toBe(true);

    // A fresh pair, and an approval drops the old refusal — a driver who got in carries no note saying
    // they once did not.
    drivers.submitKyc(d.did, { idCopyRef: 'med_id2', licenceCopyRef: 'med_lic2' });
    expect(drivers.decideKyc(d.did, true, 'ops').kycRejection).toBeUndefined();
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
    // FB5 — a reefer cannot take LOOSE goods, and carriesBulk now means only that. It read true until the
    // subtype started deciding, because every truck CLASS defaults it true and the flag used to be read as
    // "can carry sacks" — which is true of any truck, and is not what the matcher does with it.
    expect(truck.carriesBulk).toBe(false);
    expect(truck.verified).toBe(true); // full registration + factory ID
  });

  /**
   * The fleet console's credential is not everybody's business.
   *
   * GET /fleet/managers returned the RAW record to any authenticated caller, and the raw record carries
   * `loginCode` — which is the entire authentication of the fleet console. So the lowest-privilege token
   * in the network could list every fleet we host and read the code that signs in as each of them, along
   * with their tax id, transport-operator licence, business registration and depot address.
   *
   * Found by calling the endpoint with a shopkeeper's token while looking at something else. Nothing
   * failed before this test existed: leaking a field is not an error, it is a field.
   */
  it('never shows one fleet the sign-in code of another, or its papers', () => {
    const mine = managers.register({ companyName: 'Mine Haulage', contactPhone: '+254800770', ownerFullName: 'M M', ownerNationalId: 'MGR-MINE', location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: 'BRN-MINE', transportOperatorLicence: 'TOL-MINE', taxId: 'TAX-MINE' } });
    const theirs = managers.register({ companyName: 'Theirs Haulage', contactPhone: '+254800771', ownerFullName: 'T T', ownerNationalId: 'MGR-THEIRS', location: { lat: -1.3, lng: 36.9 }, requirements: { businessRegistrationNo: 'BRN-THEIRS', transportOperatorLicence: 'TOL-THEIRS', taxId: 'TAX-THEIRS' } });

    // An outsider — a shop, a driver, a vendor: anybody holding a token that is not this fleet's.
    const outside = managers.listScoped('did:glos:some-shop', false);
    for (const row of outside) {
      expect(row.companyName).toBeTruthy(); // the network's fleets are not a secret…
      expect(row.loginCode).toBeUndefined(); // …the way in to them is
      expect(row.requirements).toBeUndefined(); // registration number, transport licence, tax id
      expect(row.contactPhone).toBeUndefined();
      expect(row.vaultRef).toBeUndefined();
    }

    // A fleet still sees its OWN record whole — its papers, its code once it has one.
    const asMine = managers.listScoped(mine.did, false).find((m) => m.companyName === 'Mine Haulage');
    expect(asMine?.requirements?.taxId).toBe('TAX-MINE');
    const neighbour = managers.listScoped(mine.did, false).find((m) => m.companyName === 'Theirs Haulage');
    expect(neighbour?.requirements).toBeUndefined();

    // An operator sees everything, which is what an operator is for.
    const asOps = managers.listScoped(undefined, true);
    expect(asOps.find((m) => m.companyName === 'Theirs Haulage')?.requirements?.taxId).toBe('TAX-THEIRS');
    expect(theirs.did).toBeTruthy();
  });

  /**
   * Signing in to a fleet takes the company AND the person.
   *
   * The company code was the whole authentication: one shared secret for a company that may run twenty
   * managers across as many depots. No record of who did what, no way to cut off one leaver without
   * re-issuing to everybody, and permanent access for anybody who ever saw it.
   *
   * The code selects the fleet; the PIN proves the person; and the person must actually hold a
   * fleet_manager role for THAT company — so knowing a code and holding some unrelated account is not a
   * way in. Asserted here rather than through the console because it is the boundary, not the screen.
   */
  it('needs a person who actually manages this fleet, not merely the company code', () => {
    const m = managers.register({ companyName: 'Two Step Haulage', contactPhone: '+254800780', ownerFullName: 'T S', ownerNationalId: 'MGR-2S', location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: 'BRN-2S', transportOperatorLicence: 'TOL-2S', taxId: 'TAX-2S' } });
    managers.submitKyc(m.did, { businessRegCertRef: 'r.pdf', operatorLicenceRef: 'l.pdf', ownerIdRef: 'id.jpg', proofOfAddressRef: 'a.pdf' });
    managers.decideKyc(m.did, true, 'ops');
    managers.recordBond(m.did);

    // The manager's own person, with a PIN they set. The role link is what the registration and
    // company-lookup routes both do (tryAttachRole) — done by hand here because this exercises the
    // services rather than the controller.
    persons.enroll('+254800780', true, '24689');
    persons.tryAttachRole(m.contactPhone, 'fleet_manager', m.did, m.did);
    const mine = persons.loginWithPin('+254800780', '24689', persons.trustDevice('+254800780')).person;
    expect(mine.roles.some((r) => r.role === 'fleet_manager' && r.entityDid === m.did && r.status === 'active')).toBe(true);

    // A real account, a real PIN — and nothing to do with this fleet.
    const stranger = persons.enroll('+254800781', true, '35792').person;
    expect(persons.loginWithPin('+254800781', '35792', persons.trustDevice('+254800781')).person.personDid).toBe(stranger.personDid);
    // THE CHECK: holding the company code and a working account is not enough.
    expect(stranger.roles.some((r) => r.role === 'fleet_manager' && r.entityDid === m.did && r.status === 'active')).toBe(false);

    // …and the code alone still names the fleet without granting anything.
    expect(managers.lookup(m.loginCode!).companyName).toBe('Two Step Haulage');
  });

  it('refuses a DID as a sign-in credential — an identifier is not a secret', () => {
    // The manager's DID is stamped on their vehicles, returned by their dashboard and printed by the
    // seeder. Accepting it as a credential made every surface that exposes one into a way to sign in.
    const m = managers.register({ companyName: 'DID Haulage', contactPhone: '+254800772', ownerFullName: 'D D', ownerNationalId: 'MGR-DID', location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: 'BRN-DID', transportOperatorLicence: 'TOL-DID', taxId: 'TAX-DID' } });
    managers.submitKyc(m.did, { businessRegCertRef: 'r.pdf', operatorLicenceRef: 'l.pdf', ownerIdRef: 'id.jpg', proofOfAddressRef: 'a.pdf' });
    managers.decideKyc(m.did, true, 'ops');
    managers.recordBond(m.did);

    expect(managers.login(m.loginCode!).did).toBe(m.did); // the code works
    expect(() => managers.login(m.did)).toThrow(/Unknown sign-in code/); // the identifier does not
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

  /**
   * A bag handed ACROSS A COUNTER is cargo too.
   *
   * The test above this one claims a load off the marketplace, and that was the only way cargo ever got
   * onto a vehicle in this suite — so nothing noticed that the ordinary path recorded no driver at all.
   * `load()` wrote the carrier into locationId as a 'bus:<badge>' string prefix and nothing queried it,
   * which made a bag on a real bike invisible in two places at once: the fleet manager's live cargo, and
   * the check that stops a vehicle being given more bags than it holds.
   *
   * Found by seeding a fleet and watching a manager's dashboard report an empty vehicle that had two
   * parcels on it. The suite was green before the fix and after it.
   */
  it('counts a bag handed straight to a driver as cargo, and against the vehicle it is on', () => {
    const origin = onboardAgent('Counter Feeder', 'NorthTown', 50);
    const mdp = mdps.register({ name: 'Counter Hub', zones: ['SouthTown'], location: { lat: -1.25, lng: 36.85 } });
    const d = drivers.register({ displayName: 'Hana', fullName: 'Ha', nationalId: 'FD-2', mobile: '+254fd2', licenceClasses: ['motorcycle'] });
    const moto = vehicles.register({ plate: 'FD-2', vehicleClass: 'motorcycle', ownerName: 'Ha' });
    fleet.startSession(d.did, moto.qr);
    const badge = drivers.get(d.did).badgeId!;

    const bag = totes.register(origin.did);
    totes.assign(bag.code, mdp.mdpId, mdp.name);
    parcels.accept({ agentDid: origin.did, parcelId: 'CT-P', size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg', paymentMode: 'prepaid' });
    mdps.fillTote(bag.code, 'CT-P');

    // The shop hands it over directly. No offer, no claim — the common case.
    mdps.loadBag(bag.code, badge);

    const carried = totes.byCodeMaybe(bag.code)!;
    expect(carried.status).toBe('in_transit');
    expect(carried.claimedBy).toBeUndefined(); // nobody claimed anything…
    expect(carried.carriedBy).toBe(d.did); // …but somebody is carrying it

    const cargo = dispatch.activeCargo(new Set([d.did]));
    expect(cargo.count).toBe(1);
    expect(cargo.items[0].driverDid).toBe(d.did);
    expect(cargo.items[0].parcels).toBe(1);
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
    expect(view.shipmentCost).toBeGreaterThan(0);

    // THE SPLIT STAYS INTERNAL. A merchant sees ONE platform fee; the three layers inside it and the
    // provision set aside against claims are ours. `provision / base` IS the cost-of-risk rate, so
    // publishing the money would publish the rate by division.
    expect(view.platformFee).toBeGreaterThan(0);
    expect('rateStack' in view).toBe(false);
    expect('shipmentProvision' in view).toBe(false);

    // The shape is PINNED, not filtered. A deny-list only knows about the fields that existed when
    // somebody last thought about it — which is exactly how the two above arrived on a merchant's screen.
    // If this list needs changing, that is the moment to decide whether the new field is theirs to see.
    expect(Object.keys(view).sort()).toEqual(
      [
        'binSlot', 'buyer', 'buyerCharge', 'buyerEmail', 'buyerMobile', 'collectionCode', 'contentPhotoRef',
        'coverLimit', 'createdAt', 'currency', 'declaredValue', 'destAgentDid', 'destZone', 'did',
        'externalOrderId', 'items', 'originAgentDid', 'paidStatus', 'parcelId', 'platformFee',
        'platformFeePct', 'products', 'routeMode', 'scans', 'shipmentCost', 'shipmentPremium',
        'shipmentTax', 'size', 'status', 'subtotal', 'taxLabel', 'taxPct', 'trackingKey',
      ].sort(),
    );

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
    expect(() => accounts.signup({ role: 'pudo', email: 'shop@store.test', password: 'mkate-na-chai-1', phone, profile: { agent: agentProfile, kyc: kycDocs } })).toThrow(/Verify your phone/);

    const { code } = otp.request(phone);
    expect(() => otp.verify(phone, '0000')).toThrow(/Wrong or expired/);
    expect(otp.verify(phone, code).verified).toBe(true);

    const res = accounts.signup({ role: 'pudo', email: 'shop@store.test', password: 'mkate-na-chai-1', phone, profile: { agent: agentProfile, kyc: kycDocs } });
    expect(res.role).toBe('pudo');
    expect(res.did).toMatch(/^did:glos:/);
    expect(agents.get(res.did).status).toBe('KYC_PENDING'); // wizard submitted KYC → awaiting vetting

    // login
    expect(accounts.login('SHOP@store.test', 'mkate-na-chai-1').did).toBe(res.did); // case-insensitive email
    expect(() => accounts.login('shop@store.test', 'wrong')).toThrow(/Wrong email or password/);
    const p2 = '+254700556'; otp.verify(p2, otp.request(p2).code);
    expect(() => accounts.signup({ role: 'pudo', email: 'shop@store.test', password: 'mkate-na-chai-1', phone: p2, profile: { agent: agentProfile } })).toThrow(/already exists/);

    // forgot → reset → login with the new password
    const { resetToken } = accounts.forgot('shop@store.test');
    expect(resetToken).toMatch(/^RST-[0-9A-HJKMNP-TV-Z]{12}$/); // sixty random bits, not thirty-two
    // The same rules as wherever a password is chosen — and a refusal does not use the code up.
    expect(() => accounts.reset(resetToken!, 'secret2')).toThrow(/at least 8 characters/);
    expect(() => accounts.reset(resetToken!, 'Welcome2026!')).toThrow(/too easy to guess/);
    accounts.reset(resetToken!.toLowerCase(), 'sukari-na-maziwa-2');
    expect(() => accounts.login('shop@store.test', 'mkate-na-chai-1')).toThrow();
    expect(accounts.login('shop@store.test', 'sukari-na-maziwa-2').did).toBe(res.did);
  });

  it('signs up a self-employed driver (own vehicle); a fleet takes one on by offering a place, never by its code', () => {
    const ph1 = '+254700601'; otp.verify(ph1, otp.request(ph1).code);
    const self = accounts.signup({ role: 'driver', email: 'boda@d.test', password: 'mkate-na-chai-1', phone: ph1, profile: { driver: { displayName: 'Boda', fullName: 'B', nationalId: 'ID-D1', mobile: ph1, licenceClasses: ['bike', 'motorcycle'] }, vehicle: { plate: 'BD-1', vehicleClass: 'motorcycle', ownerName: 'B' } } });
    expect(self.role).toBe('driver');
    expect(drivers.get(self.did).status).toBe('ACTIVE'); // light registry
    expect(vehicles.list().find((v) => v.plate === 'BD-1')).toMatchObject({ ownerDriverDid: self.did }); // own vehicle registered — theirs, and nobody else's to start on

    // a fleet must be ACTIVE to take anybody on
    const m = managers.register({ companyName: 'Co', contactPhone: '+254co', ownerFullName: 'O', ownerNationalId: 'MGR-D', location: { lat: -1, lng: 36 }, requirements: { businessRegistrationNo: 'BRN-D', transportOperatorLicence: 'TOL-D', taxId: 'TAX-D' } });
    managers.submitKyc(m.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'a' });
    managers.decideKyc(m.did, true);
    const active = managers.recordBond(m.did);
    const ph2 = '+254700602'; otp.verify(ph2, otp.request(ph2).code);
    const joinerProfile = { driver: { displayName: 'Joiner', fullName: 'J', nationalId: 'ID-D2', mobile: ph2, licenceClasses: ['bike'] } };
    // The code names the company at its own sign-in. It used to make whoever typed it that fleet's driver.
    expect(() => accounts.signup({ role: 'driver', email: 'joiner@d.test', password: 'mkate-na-chai-1', phone: ph2, profile: { fleetCode: active.loginCode, ...joinerProfile } })).toThrow(/A fleet adds its own drivers/);
    // They sign up on their own, the fleet office offers a place by the number they sign in with, and THEY say yes.
    const joiner = accounts.signup({ role: 'driver', email: 'joiner@d.test', password: 'mkate-na-chai-1', phone: ph2, profile: joinerProfile });
    expect(drivers.get(joiner.did).managerDid).toBeUndefined();
    const office = { active: true, role: 'fleet_manager', did: m.did, tenant: m.did } as never;
    const offer = controller.makeFleetOffer(m.did, { phone: ph2 }, office);
    const accepted = controller.acceptFleetOffer(joiner.did, offer.offerId, auth.introspect(joiner.token.access_token) as never);
    expect(drivers.get(joiner.did).managerDid).toBe(m.did); // employed by the fleet

    // …AND THEY LEAVE THE WAY THEY CAME: by themselves. Not their office for them, not staff, not another driver.
    const asJoiner = auth.introspect(accepted.token!.access_token) as never;
    expect(() => controller.leaveFleet(joiner.did, office)).toThrow('Only the driver can leave a fleet, from their own sign-in');
    expect(() => controller.leaveFleet(joiner.did, { active: true, role: 'operator' } as never)).toThrow('Only the driver can leave a fleet');
    expect(() => controller.leaveFleet(joiner.did, auth.introspect(self.token.access_token) as never)).toThrow('Only the driver can leave a fleet');
    expect(drivers.get(joiner.did).managerDid).toBe(m.did);

    const left = controller.leaveFleet(joiner.did, asJoiner);
    expect(left).toMatchObject({ did: joiner.did, companyName: 'Co', runs: [] });
    expect(drivers.get(joiner.did)).toMatchObject({ removedFrom: { fleetDid: m.did, reason: 'own' } });
    expect(drivers.get(joiner.did).managerDid).toBeUndefined();
    // The session they asked from ended with every other one; the phone was handed a sign-in that names no fleet.
    expect(auth.introspect(accepted.token!.access_token)).toMatchObject({ active: false });
    const now = auth.introspect(left.token!.access_token);
    expect(now).toMatchObject({ active: true, role: 'driver', did: joiner.did });
    expect(now.tenant).toBeUndefined();
    // Not in a fleet, there is none to leave.
    expect(() => controller.leaveFleet(joiner.did, now as never)).toThrow('You are not in a fleet');
  });

  /*
   * JOINING AS A COURIER WITH YOUR OWN VAN, WHICH WAS NOT POSSIBLE.
   *
   * The user tried it and concluded they could only join through a fleet. They were right, and the path
   * was closed in four separate places: the join form never asked for the licence the heavy registry
   * requires (a hard LICENCE_REQUIRED), never asked for a vehicle (so the first screen said "scan the
   * sticker on the dashboard" and no sticker existed), the DRAFT notice told them a FLEET OFFICE had to
   * activate them, and nothing anywhere could clear the criminal-record check that approval demands.
   *
   * This walks the whole thing, because every one of those four was individually invisible.
   */
  it('lets an independent courier join with their own van, and work once staff have cleared them', () => {
    const phone = '+254700790';
    otp.verify(phone, otp.request(phone).code);
    const joined = accounts.signup({
      role: 'driver',
      email: 'owner@d.test',
      password: 'mkate-na-chai-1',
      phone,
      profile: {
        driver: {
          displayName: 'Owner', fullName: 'O Driver', nationalId: 'ID-OWN1', mobile: phone,
          licenceClasses: ['van'], licenceNumber: 'DL-OWN1', licenceExpiresAt: '2099-01-01', jurisdiction: 'KE',
        },
        vehicle: { plate: 'KDD 001', vehicleClass: 'van' },
      },
    });

    const driver = drivers.get(joined.did);
    expect(driver.managerDid).toBeUndefined(); // nobody's employee — the network contracts them directly
    expect(driver.status).toBe('DRAFT'); // a van is the heavy registry, and it starts unvetted

    // THEIR VAN IS ON THEIR FIRST MORNING'S SCREEN. recentVehicles is a history, so without the claim at
    // signup this is empty and the app can only tell them to scan a sticker that does not exist.
    const morning = fleet.recentVehicles(joined.did);
    expect(morning.map((v) => v.plate)).toEqual(['KDD 001']);

    // They can send their own documents — the route always allowed it; only a fleet ever had a screen.
    drivers.submitKyc(joined.did, { idCopyRef: 'media_id', licenceCopyRef: 'media_lic' });
    expect(drivers.get(joined.did).status).toBe('KYC_PENDING');

    // Approval WITHOUT the record check is still refused: the gate is real, it just had no key before.
    expect(() => drivers.decideKyc(joined.did, true, 'ops')).toThrow(/criminal-record check/);
    drivers.decideKyc(joined.did, true, 'ops', undefined, true);
    expect(drivers.get(joined.did).status).toBe('ACTIVE');

    // And the whole point: a shift starts, on their own van, with no fleet anywhere in it.
    expect(fleet.couple(joined.did, morning[0].vehicleId).status).toBe('active');
  });

  it('refuses a vehicle the courier is not licensed for, at signup rather than at the first shift', () => {
    // Registering a van while cleared only for a bicycle used to pass every check here and fail at the
    // first coupling — with the vehicle already in the network and the person already signed up.
    const phone = '+254700791';
    otp.verify(phone, otp.request(phone).code);
    expect(() =>
      accounts.signup({
        role: 'driver', email: 'mismatch@d.test', password: 'mkate-na-chai-1', phone,
        profile: {
          driver: { displayName: 'Mix', fullName: 'M X', nationalId: 'ID-MIX1', mobile: phone, licenceClasses: ['bike'] },
          vehicle: { plate: 'KDD 002', vehicleClass: 'van' },
        },
      }),
    ).toThrow(/not licence-cleared for a van/);
  });

  it('names the field somebody forgot instead of answering a 500', () => {
    // SignupDto.profile is an unvalidated Record, so a join form that omits a field reaches the service
    // with it missing. It used to call .trim() on undefined and answer "Something went wrong".
    const phone = '+254700792';
    otp.verify(phone, otp.request(phone).code);
    expect(() =>
      accounts.signup({
        role: 'driver', email: 'nofields@d.test', password: 'mkate-na-chai-1', phone,
        profile: { driver: { displayName: 'No ID', mobile: phone, licenceClasses: ['bike'] } },
      }),
    ).toThrow(/full name/);
  });

  it('S20 — one person, many roles: a driver who signs up can enroll as a consumer and send, under one account', () => {
    // A driver signs up through the existing PUDO account flow — which now links them to a person by phone.
    const phone = '+254700711'; otp.verify(phone, otp.request(phone).code);
    const driver = accounts.signup({ role: 'driver', email: 'multi@d.test', password: 'mkate-na-chai-1', phone, profile: { driver: { displayName: 'Multi', fullName: 'M', nationalId: 'ID-M1', mobile: phone, licenceClasses: ['motorcycle'] }, vehicle: { plate: 'MU-1', vehicleClass: 'motorcycle' } } });

    const linked = persons.findByPhone(phone);
    expect(linked).toBeDefined();
    expect(linked!.roles.map((r) => r.role)).toContain('driver');

    // The SAME human later enrolls the SAME phone as a consumer (to send a parcel). No second account:
    // the existing person gains a consumer role.
    const { person, isNew, token } = persons.enroll(phone, true, '24689');
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
    expect(persons.loginWithPin(phone, '24689', persons.trustDevice(phone)).person.personDid).toBe(person.personDid);
    for (let i = 0; i < 4; i++) expect(() => persons.loginWithPin(phone, '00000', persons.trustDevice(phone))).toThrow(/Wrong phone or PIN/);
    expect(() => persons.loginWithPin(phone, '00000', persons.trustDevice(phone))).toThrow(/Too many wrong PINs/); // the fifth locks it, and says so
    expect(() => persons.loginWithPin(phone, '24689', persons.trustDevice(phone))).toThrow(/Too many wrong PINs/); // locked out → OTP required
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
    const first = persons.enroll('+254700951001', true, '24689');
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
    const recv = parcels.partyTo(hashPhone(receiver));
    expect(recv.received.map((v) => v.parcelId)).toContain('S21-1');
    expect(recv.received[0].relation).toBe('received');
    expect(recv.sent).toHaveLength(0);
    expect(parcels.partyTo(hashPhone(sender)).sent[0].relation).toBe('sent');

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
    const before = agents.balance(origin.did)!;
    parcels.accept({ agentDid: origin.did, parcelId: 'CX-1', size: 'S', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'p.jpg' });
    expect(parcels.cancel('CX-1', 'ops', 'customer changed mind').status).toBe('Voided');
    expect(agents.balance(origin.did)!).toBeCloseTo(before, 2); // cash charge refunded
  });

  it('completes the bulk-freight lifecycle (register → claim → pickup → deliver, capacity released)', () => {
    const d = drivers.register({ displayName: 'Tk', fullName: 'T', nationalId: 'FR-1', mobile: '+254fr1', licenceClasses: ['truck'], licenceNumber: 'L-FR', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' }); drivers.decideKyc(d.did, true);
    // FB5 — loose cement is a TIPPER's load. It rode a flatbed here only because every truck was bulk-capable
    // by class default; now the body has to match the packaging, which is the point of the slice.
    const truck = vehicles.register({ plate: 'TK-1', vehicleClass: 'truck', truckSubtype: 'tipper', capacityKg: 10_000, ownerName: 'T' });
    fleet.couple(d.did, truck.vehicleId);
    const f = dispatch.registerFreight({ description: 'Cement 5t', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'Depot', destLabel: 'Site', weightKg: 5000, packaging: 'loose' });
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
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, packaging: 'palletised', shipperDid: vendor.vendorId });

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

  it('FP5: the fleet office puts a load on a driver on shift — the same gates as a claim, the office on the record, the shipper billed', () => {
    const d = drivers.register({ displayName: 'AS', fullName: 'A', nationalId: 'ID-AS', mobile: '+254770555', licenceClasses: ['truck'], licenceNumber: 'L-AS', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'AS-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5 });
    const vendor = vendors.register({ name: 'AssignVendor' });
    vendors.topUp(vendor.vendorId, 500);
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, packaging: 'palletised', shipperDid: vendor.vendorId });
    const office = { managerDid: 'did:fleet:office', name: 'Kilima office' };
    // Off shift: a load goes on a vehicle, and there is none.
    expect(() => dispatch.assign(f.freightId, d.did, office)).toThrow(/not on a shift/);
    fleet.couple(d.did, truck.vehicleId);
    // A negotiate load has no settled price to assign at.
    const nego = dispatch.registerFreight({ description: 'Nego', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 100, packaging: 'palletised', commitMode: 'negotiate' });
    expect(() => dispatch.assign(nego.freightId, d.did, office)).toThrow(/negotiation/);
    const noon = new Date('2026-07-22T11:00:00').getTime();
    const before = vendors.balanceOf(vendor.vendorId);
    const assigned = dispatch.assign(f.freightId, d.did, office, noon);
    expect(assigned).toMatchObject({ status: 'claimed', claimedBy: d.did, lockedPrice: 10, paidStatus: 'billed', assignedBy: { managerDid: 'did:fleet:office', name: 'Kilima office' } });
    expect(vendors.balanceOf(vendor.vendorId)).toBeCloseTo(before - shipperCharge(10), 2);
    // The driver's own list says it was put on them, and by whom.
    expect(dispatch.claimsFor(d.did).find((c) => c.ref === f.freightId)?.assignedBy).toMatchObject({ name: 'Kilima office' });
    // Taken means taken: a second office cannot put it on somebody else.
    expect(() => dispatch.assign(f.freightId, d.did, office)).toThrow(/claimed/);
    // And it advances like any claim, so the driver is paid on delivery.
    pickupOk(f, d.did);
    expect(deliverOk(f, d.did).status).toBe('delivered');
    expect(gate.entries({ type: 'DRIVER_PAYOUT' }).filter((e) => e.reference === d.did)).toHaveLength(1);
  });

  /* ------------------------------------------------------------------ CL1: the agreed term -- */

  // NOTE ON WHAT THESE CAN AND CANNOT SEE. Standing is DERIVED here and ENFORCED in the controller, and a
  // service spec never reaches a controller. So these prove the derivation, the activation and the floor;
  // the two guards that actually refuse a caller (assertFreightClaimant, requireActiveTerm) are proven in
  // the browser drive. Writing that down because this repo has been bitten once by a suite that passed
  // while the app could not do the thing.

  it('CL1: a term is selected from the eleven, per direction, and switching one ON needs a second person', () => {
    // Nothing is allowed until somebody selects it: the sets start empty everywhere.
    expect(presence.resolve('UG').incoterms).toEqual({ origin: [], destination: [] });

    // DE already stands at 'matched' in this harness, so there is no CAPABILITY gain here — only a term.
    // That alone must still become a proposal, which is the whole point of treating a term as a promise.
    const proposed = presence.propose({ jurisdiction: 'UG', level: 'matched', incoterms: { origin: ['FCA', 'CIF'] }, by: 'Amina Otieno' });
    expect(proposed.applied).toBeUndefined();
    expect(proposed.proposal?.termGains).toEqual(['FCA (as origin)', 'CIF (as origin)']);
    expect(presence.resolve('UG').incoterms.origin).toEqual([]); // nothing behaves differently until a second person

    presence.approve(proposed.proposal!.proposalId, 'Brian Kamau');
    expect(presence.resolve('UG').incoterms).toEqual({ origin: ['FCA', 'CIF'], destination: [] });

    // Selected, never invented.
    expect(() => presence.set({ jurisdiction: 'UG', level: 'matched', incoterms: { origin: ['XYZ'] } })).toThrow(/not an Incoterm/);
    // Case and duplicates are the same selection, not three.
    presence.set({ jurisdiction: 'UG', level: 'matched', incoterms: { origin: ['fca', 'FCA', ' fca '] } });
    expect(presence.resolve('UG').incoterms.origin).toEqual(['FCA']);
  });

  it('the turn-on: a company of ours is refused Established until its own entry says where it is and when it receives visitors', () => {
    // The user, 2026-10-08, on a country's company having to write its address and its visiting days before the
    // country goes live: "it's part of the turn on process." Asked at the gate itself, by name.
    const contacts = (controller as unknown as { contacts: ContactCardService }).contacts;
    entities.createCompany({ kind: 'sister', jurisdiction: 'zm', name: 'SeeBuyGet Zambia' }, 'Amina');
    const gate = () => {
      try {
        (controller as unknown as { requireReadyCompanyFor(jurisdiction: string, level: string): unknown }).requireReadyCompanyFor('ZM', 'established');
        return 'SWITCHED ON';
      } catch (e) {
        return (e as Error).message;
      }
    };
    const before = gate();
    expect(before).toMatch(/^SeeBuyGet Zambia is not ready to be switched on\. Still missing: /);
    expect(before).toContain('Where people are sent when they have to come in person');
    expect(before).toContain('The days and hours it receives visitors');

    // An address, and days without hours: half an answer is still missing.
    contacts.set('sbg-zm', { address: 'Cairo Road, Lusaka', visitDays: ['mon', 'tue'] }, 'Chanda');
    expect(gate()).not.toContain('Where people are sent');
    expect(gate()).toContain('The days and hours it receives visitors');
    contacts.set('sbg-zm', { visitFrom: '09:00', visitTo: '15:00' }, 'Chanda');
    // Still not ready — its record and its papers are another matter — but no longer for this.
    const after = gate();
    expect(after).toMatch(/Still missing: /);
    expect(after).not.toContain('Where people are sent');
    expect(after).not.toContain('The days and hours it receives visitors');
    // A lower rung asks nothing of the company at all.
    expect((controller as unknown as { requireReadyCompanyFor(jurisdiction: string, level: string): unknown }).requireReadyCompanyFor('ZM', 'observed')).toBeUndefined();
  });

  it('CL1: presence floors the menu — a term that bills duty cannot be switched on where we cannot bill', () => {
    // ZM is recorded and observed: no tax, no payouts, no money of ours at all.
    presence.set({ jurisdiction: 'MW', level: 'observed' });
    expect(presence.resolve('MW').capabilities.tax).toBe(false);
    expect(() => presence.set({ jurisdiction: 'MW', level: 'observed', incoterms: { destination: ['DDP'] } })).toThrow(/neither collect tax nor pay out/);
    // The same term as ORIGIN is untouched by that floor — it is the import side DDP puts on the seller.
    expect(() => presence.set({ jurisdiction: 'MW', level: 'observed', incoterms: { origin: ['DDP'] } })).not.toThrow();
    // And a term that bills nobody is fine either way.
    expect(() => presence.set({ jurisdiction: 'MW', level: 'observed', incoterms: { destination: ['DAP'] } })).not.toThrow();
  });

  it('CL1: who may claim follows the term — the C terms put a loss in transit on the RECEIVER', () => {
    const vendor = vendors.register({ name: 'TermVendor' });
    const at = { lat: -1.2, lng: 36.8 };
    const post = (incoterm?: string) =>
      dispatch.registerFreight({ description: 'Machinery', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', destLocation: at, weightKg: 200, packaging: 'palletised', shipperDid: vendor.vendorId, buyerMobile: '+254700111222', ...(incoterm ? { incoterm } : {}) });

    // Cost and risk come apart under CIF: the seller pays the freight to destination, risk passed at origin.
    expect(dispatch.claimantOf(post('CIF'))).toMatchObject({ party: 'receiver', term: 'CIF' });
    expect(dispatch.claimantOf(post('FCA'))).toMatchObject({ party: 'receiver', term: 'FCA' });
    expect(dispatch.claimantOf(post('EXW'))).toMatchObject({ party: 'receiver', term: 'EXW' });
    // The D terms keep the risk with the seller the whole way.
    expect(dispatch.claimantOf(post('DAP'))).toMatchObject({ party: 'sender', term: 'DAP' });
    expect(dispatch.claimantOf(post('DDP'))).toMatchObject({ party: 'sender', term: 'DDP' });

    // THE FALLBACK THAT STOPS THIS REWRITING HISTORY: a load with no term behaves exactly as before.
    const untermed = post(undefined);
    expect(untermed.incoterm).toBeUndefined();
    expect(dispatch.claimantOf(untermed)).toMatchObject({ party: 'sender' });
    expect(dispatch.claimantOf(untermed).why).toMatch(/No trade term was recorded/);

    // An unrecognised code is dropped rather than stored — it must never end up deciding who may claim.
    const bogus = dispatch.registerFreight({ description: 'Machinery', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', destLocation: at, weightKg: 200, packaging: 'palletised', incoterm: 'NOPE' });
    expect(bogus.incoterm).toBeUndefined();
    expect(dispatch.claimantOf(bogus).party).toBe('sender');
  });

  it('CL1: the receiver who may claim is the ACCOUNT the goods were for — on its new number still, and never whoever has its old one', () => {
    const vendor = vendors.register({ name: 'ClaimVendor' });
    const at = { lat: -1.2, lng: 36.8 };
    /** Somebody who signs in by email, with a number of their own behind it. */
    const anAccount = (phone: string, n: number) => {
      (otp as unknown as { rates: Map<string, unknown> }).rates.clear(); // the same number asks for a code twice in this test
      otp.verify(phone, otp.request(phone).code);
      const profile = { shopName: `Claim Shop ${n}`, zone: 'NorthTown', location: { lat: -1.2 - n / 100, lng: 36.8 }, landmark: 'x', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'Owner', nationalId: `ID-CLM-${n}`, mobile: phone, deviceImei: `IMEI-CLM-${n}`, requirements: eligibleReqs() };
      return accounts.signup({ role: 'pudo', email: `claim${n}@store.test`, password: 'mkate-na-chai-1', phone, profile: { agent: profile, kyc: kycDocs } });
    };
    /** Past the question of WHO, a claim on a load nobody has delivered is refused for that — which is a different answer. */
    const asked = (did: string, freightId: string) => {
      try {
        controller.freightClaim(freightId, { kind: 'damaged', description: 'Crushed' } as never, { role: 'agent', did } as never);
        return 'opened';
      } catch (err) {
        return (err as { code?: string }).code ?? 'other';
      }
    };
    const phone = '+254700888001';
    const receiver = anAccount(phone, 1);
    // CIF: a loss in transit is the receiver's. One order placed while the account was on the number, one before it existed.
    const order = dispatch.registerFreight({ description: 'Machinery', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', destLocation: at, weightKg: 200, packaging: 'palletised', shipperDid: vendor.vendorId, buyerMobile: phone, incoterm: 'CIF' });
    const stranger = anAccount('+254700888002', 2);
    expect(asked(receiver.did, order.freightId)).not.toBe('NOT_THE_CLAIMANT');
    expect(asked(stranger.did, order.freightId)).toBe('NOT_THE_CLAIMANT');

    // The account moves to another number — the three things the move does: the person, the shop register, and the
    // email sign-in that resolves to them.
    const person = persons.findByPhone(phone)!;
    const t0 = Date.now();
    const { fromHash } = persons.movePhone(person.personDid, '+254700888003', 'self', t0);
    const heldKey = agents.moveMobile(receiver.did, '+254700888003');
    accounts.rephone(fromHash, persons.requireByDid(person.personDid).phoneHash);
    expect(asked(receiver.did, order.freightId)).not.toBe('NOT_THE_CLAIMANT');

    // A week later the old number is somebody else's — and the goods are not.
    persons.settleMove(person.personDid, t0 + 8 * 24 * 3_600_000);
    if (heldKey) agents.releaseHeldPhone(heldKey, receiver.did);
    const newcomer = anAccount(phone, 3);
    expect(asked(newcomer.did, order.freightId)).toBe('NOT_THE_CLAIMANT');
    expect(asked(receiver.did, order.freightId)).not.toBe('NOT_THE_CLAIMANT');
  });

  it('CL1: the shop sees the term it agreed, the place it names, and who it puts the loss on', () => {
    const vendor = vendors.register({ name: 'TermRowVendor' });
    const at = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Coffee', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', destLocation: at, weightKg: 300, packaging: 'palletised', shipperDid: vendor.vendorId, incoterm: 'cif', namedPlace: 'Mombasa' });
    expect(f.incoterm).toBe('CIF'); // canonicalised on the way in
    expect(f.namedPlace).toBe('Mombasa');
    const row = dispatch.postedBy(vendor.vendorId).find((r) => r.freightId === f.freightId);
    expect(row).toMatchObject({ incoterm: 'CIF', namedPlace: 'Mombasa', claimant: 'receiver' });
  });

  it('FP8: a driver hands a claimed load back before pickup — the charge comes back, the load is on the market again, the record keeps why', () => {
    const d = drivers.register({ displayName: 'HB', fullName: 'H', nationalId: 'ID-HB', mobile: '+254770888', licenceClasses: ['truck'], licenceNumber: 'L-HB', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'HB-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5 });
    fleet.couple(d.did, truck.vehicleId);
    const vendor = vendors.register({ name: 'HandBackVendor' });
    vendors.topUp(vendor.vendorId, 500);
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, packaging: 'palletised', shipperDid: vendor.vendorId });
    const before = vendors.balanceOf(vendor.vendorId);
    const noon = new Date('2026-07-22T11:00:00').getTime();
    dispatch.assign(f.freightId, d.did, { managerDid: 'did:fleet:office', name: 'Office' }, noon);
    expect(vendors.balanceOf(vendor.vendorId)).toBeLessThan(before);
    expect(() => dispatch.handBack(f.freightId, 'did:someone-else', 'not mine')).toThrow(/another driver/);
    expect(() => dispatch.handBack(f.freightId, d.did, '')).toThrow(/why/);
    const back = dispatch.handBack(f.freightId, d.did, 'Truck broke down at the depot', noon + 60_000);
    expect(back.status).toBe('available');
    expect(back.claimedBy).toBeUndefined();
    expect(back.lockedPrice).toBeUndefined();
    expect(back.assignedBy).toBeUndefined();
    // It keeps the carrier it was given back BY — this courier drives for themselves, so the carrier is them.
    expect(back.handBacks).toEqual([{ driverDid: d.did, carrierDid: d.did, reason: 'Truck broke down at the depot', at: new Date(noon + 60_000).toISOString() }]);
    expect(vendors.balanceOf(vendor.vendorId)).toBeCloseTo(before, 2); // the charge came back
    expect(dispatch.claimsFor(d.did).find((c) => c.ref === f.freightId)).toBeUndefined();
    expect(dispatch.postedBy(vendor.vendorId).find((r) => r.freightId === f.freightId)?.handBacks).toEqual([{ reason: 'Truck broke down at the depot', at: new Date(noon + 60_000).toISOString() }]);
    // Somebody else takes it, picks it up — and from then on it cannot be handed back.
    dispatch.assign(f.freightId, d.did, { managerDid: 'did:fleet:office' }, noon + 120_000);
    pickupOk(f, d.did);
    expect(() => dispatch.handBack(f.freightId, d.did, 'changed my mind')).toThrow(/taken over/);
  });

  it('FP8: over the shift limit nothing new is taken — the board marks it, no offer comes, the commit refuses — and a real working day owes a rest', () => {
    const d = drivers.register({ displayName: 'HS', fullName: 'H', nationalId: 'ID-HS', mobile: '+254770999', licenceClasses: ['truck'], licenceNumber: 'L-HS', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'HS-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5 });
    fleet.couple(d.did, truck.vehicleId);
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, packaging: 'palletised' });
    // Fourteen hours in: the shift started long ago.
    const started = Date.now() - 14 * 3_600_000;
    fleet.activeForDriver(d.did)!.startedAt = new Date(started).toISOString();
    expect(fleet.hoursFor(d.did)).toMatchObject({ limit: 13, over: true });
    expect(dispatch.suggest(d.did, { from: pickup, to: pickup })).toEqual([]);
    const row = dispatch.board({ driverDid: d.did, from: pickup }).find((r) => r.freightId === f.freightId)!;
    expect(row.canTake).toBe(false);
    expect(row.blockers.map((b) => b.code)).toContain('HOURS_EXCEEDED');
    expect(() => dispatch.assign(f.freightId, d.did, { managerDid: 'did:fleet:office' })).toThrow(/over the 13 h limit/);
    // The shift ends; a working day was done, so the next shift waits for the rest.
    fleet.uncouple(d.did);
    expect(fleet.restHoursSince(d.did)).toBeLessThan(1);
    expect(() => fleet.couple(d.did, truck.vehicleId)).toThrow(/Rest first/);
    // Whereas a five-minute coupling owes nothing.
    const ended = [...(fleet as unknown as { assignments: Map<string, { driverDid: string; startedAt: string; endedAt?: string }> }).assignments.values()].find((a) => a.driverDid === d.did && a.endedAt)!;
    ended.startedAt = new Date(new Date(ended.endedAt!).getTime() - 5 * 60_000).toISOString();
    expect(fleet.restHoursSince(d.did)).toBeNull();
    fleet.couple(d.did, truck.vehicleId);
    expect(fleet.hoursFor(d.did).over).toBe(false);
  });

  it('FP8: an upheld claim takes back from the carrier what they were paid for the haul, never more, and the registers show it', () => {
    const d = drivers.register({ displayName: 'CB', fullName: 'C', nationalId: 'ID-CB', mobile: '+254771000', licenceClasses: ['truck'], licenceNumber: 'L-CB', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'CB-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5 });
    fleet.couple(d.did, truck.vehicleId);
    const vendor = vendors.register({ name: 'ClawbackVendor' });
    // An award needs a company that pays — one that has stated cover for dedicated freight (the user, 2026-10-13).
    entities.setInsurance(entities.requireForJurisdiction('KE').entityId, { lane: 'dedicated', freeLimit: 5000 }, 'Amina Otieno');
    vendors.topUp(vendor.vendorId, 500);
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, packaging: 'palletised', shipperDid: vendor.vendorId });
    const noon = new Date('2026-07-22T11:00:00').getTime();
    dispatch.assign(f.freightId, d.did, { managerDid: 'did:fleet:office' }, noon);
    pickupOk(f, d.did);
    deliverOk(f, d.did);
    expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)!.lockedPrice).toBe(10);
    dispatch.openFreightClaim(f.freightId, vendor.vendorId, { kind: 'damaged', description: 'Crushed' }, noon + 3_600_000);
    // Awarded 40 on a haul that paid 10: the carrier bears 10, the rest is the sister's provision.
    const decided = dispatch.resolveFreightClaim(f.freightId, { decision: 'upheld', award: 40, note: 'Photo shows crush damage' }, noon + 7_200_000);
    expect(decided.clawback).toMatchObject({ amount: 10 });
    expect(gate.entries({ type: 'DRIVER_CLAWBACK' }).filter((e) => e.reference === d.did)).toHaveLength(1);
    const row = dispatch.driverJobsPage(d.did, {} as never).items.find((r) => r.freightId === f.freightId)!;
    expect(row).toMatchObject({ earning: 10, paid: true, clawback: 10 });
    expect(dispatch.driverJobsSummary(d.did, {} as never).earned).toBe(0);
    entities.setInsurance(entities.requireForJurisdiction('KE').entityId, { lane: 'dedicated', freeLimit: null }, 'Amina Otieno');
  });

  it('FP7: the sender’s instructions are rewritten before pickup, only added to on the road, reach the driver and the board, and never the tracking page', () => {
    const d = drivers.register({ displayName: 'IN', fullName: 'I', nationalId: 'ID-IN', mobile: '+254770777', licenceClasses: ['truck'], licenceNumber: 'L-IN', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'IN-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5 });
    fleet.couple(d.did, truck.vehicleId);
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, packaging: 'palletised', postedByDid: 'did:shop:inst', instructions: 'Gate on the north side', contactName: 'Joseph', contactPhone: '+254700999888', deliveryWindow: 'before 10:00' });
    expect(f.instructions).toMatchObject({ text: 'Gate on the north side', contactName: 'Joseph', contactPhone: '+254700999888', deliveryWindow: 'before 10:00', by: 'did:shop:inst' });
    // The board carries the window (a dispatcher decides against it) and never the contact.
    const row = dispatch.board({ driverDid: d.did, from: pickup }).find((r) => r.freightId === f.freightId)!;
    expect(row.deliveryWindow).toBe('before 10:00');
    expect(JSON.stringify(row)).not.toContain('Joseph');
    // Before pickup the sender rewrites the box; blank clears it.
    dispatch.setInstructions(f.freightId, 'did:shop:inst', { text: 'Second trip', contactName: 'Joseph', contactPhone: '+254700999888' });
    let posted = dispatch.postedBy('did:shop:inst').find((r) => r.freightId === f.freightId)!;
    expect(posted.instructions).toMatchObject({ text: 'Second trip', contactName: 'Joseph' });
    expect(posted.instructions?.deliveryWindow).toBeUndefined();
    expect(posted.instructionsMode).toBe('edit');
    const noon = new Date('2026-07-22T11:00:00').getTime();
    const [offer] = dispatch.suggest(d.did, { from: pickup, to: pickup }, noon);
    dispatch.claim(offer.offerId, noon);
    // The driver holding it reads the box, phone included.
    expect(dispatch.claimsFor(d.did).find((c) => c.ref === f.freightId)?.instructions).toMatchObject({ text: 'Second trip', contactPhone: '+254700999888' });
    pickupOk(f, d.did);
    // On the road: a rewrite is refused unless it says something, and what it says is APPENDED with its time.
    expect(() => dispatch.setInstructions(f.freightId, 'did:shop:inst', { contactName: 'Somebody else' })).toThrow(/say what it is/);
    dispatch.setInstructions(f.freightId, 'did:shop:inst', { text: 'Leave it with the guard if nobody answers' }, noon + 3_600_000);
    posted = dispatch.postedBy('did:shop:inst').find((r) => r.freightId === f.freightId)!;
    expect(posted.instructionsMode).toBe('amend');
    expect(posted.instructions?.text).toBe('Second trip'); // the box is not overwritten
    expect(posted.instructions?.amendments).toEqual([{ text: 'Leave it with the guard if nobody answers', at: new Date(noon + 3_600_000).toISOString() }]);
    expect(dispatch.claimsFor(d.did).find((c) => c.ref === f.freightId)?.instructions?.amendments).toHaveLength(1);
    deliverOk(f, d.did);
    expect(() => dispatch.setInstructions(f.freightId, 'did:shop:inst', { text: 'too late' })).toThrow(/nobody left/);
    expect(dispatch.postedBy('did:shop:inst').find((r) => r.freightId === f.freightId)!.instructionsMode).toBe('none');
  });

  it('FP6: the shipper rates the carrier once the load is delivered — one verdict per load, last wins, and the driver’s composite moves', () => {
    const d = drivers.register({ displayName: 'RT', fullName: 'R', nationalId: 'ID-RT', mobile: '+254770666', licenceClasses: ['truck'], licenceNumber: 'L-RT', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'RT-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5 });
    fleet.couple(d.did, truck.vehicleId);
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, packaging: 'palletised', postedByDid: 'did:shop:rater' });
    // Nothing to judge before delivery.
    expect(() => dispatch.rateFreight(f.freightId, 'did:shop:rater', { stars: 5 })).toThrow(/delivered/);
    const noon = new Date('2026-07-22T11:00:00').getTime();
    const [offer] = dispatch.suggest(d.did, { from: pickup, to: pickup }, noon);
    dispatch.claim(offer.offerId, noon);
    // The shipper's list carries the link and the carrier, and says it cannot be rated yet.
    let row = dispatch.postedBy('did:shop:rater').find((r) => r.freightId === f.freightId)!;
    expect(row.trackingUrl).toContain('?track=' + row.trackingKey);
    expect(row.carrier).toBeUndefined(); // not taken over yet: the carriage is stamped at pickup
    expect(row.canRate).toBe(false);
    pickupOk(f, d.did);
    deliverOk(f, d.did);
    row = dispatch.postedBy('did:shop:rater').find((r) => r.freightId === f.freightId)!;
    expect(row.carrier).toMatchObject({ driverName: 'RT', plate: 'RT-1' });
    expect(row.canRate).toBe(true);
    const before = rating.driverRating(d.did).count;
    const rated = dispatch.rateFreight(f.freightId, 'did:shop:rater', { stars: 4, issues: ['LATE_PICKUP', 'BOGUS' as never] });
    expect(rated.rating).toMatchObject({ stars: 4, issues: ['LATE_PICKUP'], by: 'did:shop:rater' });
    expect(rating.driverRating(d.did).count).toBe(before + 1);
    // Last wins on the same load: the count does not grow, the stars change.
    dispatch.rateFreight(f.freightId, 'did:shop:rater', { stars: 2 });
    expect(rating.driverRating(d.did).count).toBe(before + 1);
    expect(dispatch.postedBy('did:shop:rater').find((r) => r.freightId === f.freightId)!.rating).toMatchObject({ stars: 2 });
    // Too late is too late.
    expect(() => dispatch.rateFreight(f.freightId, 'did:shop:rater', { stars: 5 }, Date.now() + 31 * 86_400_000)).toThrow(/30 days/);
    // The key finds the load, and only the load.
    expect(dispatch.freightByTrackingKey(row.trackingKey!)?.freightId).toBe(f.freightId);
    expect(dispatch.freightByTrackingKey('T-NOPE')).toBeUndefined();
  });

  it('FB0a: the locked price keeps the deadhead/loaded split — a claimed haul is not recorded as all-empty running', () => {
    const d = drivers.register({ displayName: 'SP', fullName: 'S', nationalId: 'ID-SP', mobile: '+254770123', licenceClasses: ['truck'], licenceNumber: 'L-SP', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'SP-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5 });
    fleet.couple(d.did, truck.vehicleId);

    const vendor = vendors.register({ name: 'SplitVendor' });
    vendors.topUp(vendor.vendorId, 500);
    // Three points on one line so the detour stays inside the cap: the driver starts SOUTH of the pickup and
    // the haul runs NORTH of it. Both legs are therefore non-zero — the case the old code could not express.
    const start = { lat: -1.22, lng: 36.8 };
    const pickup = { lat: -1.2, lng: 36.8 };
    const dest = { lat: -1.15, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: dest, weightKg: 200, packaging: 'palletised', shipperDid: vendor.vendorId });

    const noon = new Date('2026-07-22T11:00:00').getTime();
    const [offer] = dispatch.suggest(d.did, { from: start, to: dest }, noon);
    expect(offer.price).toBeDefined();
    expect(offer.price!.deadheadKm!).toBeGreaterThan(0);
    expect(offer.price!.loadedKm!).toBeGreaterThan(0);
    expect(offer.price!.deadheadKm! + offer.price!.loadedKm!).toBe(offer.price!.distanceKm);

    dispatch.claim(offer.offerId, noon);
    const claimed = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
    // The DURABLE breakdown — what any later market series reads off this haul. It must carry the same split
    // the offer showed, not the sum re-labelled as deadhead (the shape the pre-FB0a lock produced, which would
    // have booked every kilometre of a real haul as empty running).
    expect(claimed.priceBreakdown!.deadheadKm).toBe(offer.price!.deadheadKm);
    expect(claimed.priceBreakdown!.loadedKm).toBe(offer.price!.loadedKm);
    expect(claimed.priceBreakdown!.distanceKm).toBe(offer.price!.distanceKm);
    expect(claimed.priceBreakdown!.deadheadKm).not.toBe(claimed.priceBreakdown!.distanceKm);
    expect(claimed.lockedPrice).toBe(offer.price!.total); // and the money is unchanged by the relabelling
  });

  it('FB0b: a registered freight KEEPS its measurements and carries the body it needs', () => {
    const f = dispatch.registerFreight({
      description: 'Palletised generator',
      pickupLocation: { lat: -1.2, lng: 36.8 },
      pickupLabel: 'Depot',
      destLabel: 'Site',
      weightKg: 400,
      packaging: 'palletised',
      dimensionsCm: [120, 100, 80],
    });
    // Until FB0b these dimensions were read to classify the cargo and then dropped on the floor.
    expect(f.dimensionsCm).toEqual([120, 100, 80]);
    expect(f.bodyDerived).toEqual({ body: 'box', basis: 'measured' });
  });

  it('FB0b: an unmeasured freight still gets a body, labelled as the weaker claim it is', () => {
    // FB5 — sand is stated LOOSE rather than left to the deployment default. Nothing about 24 t implies it:
    // 24 t of bagged cement is a flatbed, and only the person at the quarry knows which this is.
    const f = dispatch.registerFreight({ description: 'Sand', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'Quarry', destLabel: 'Site', weightKg: 24_000, packaging: 'loose' });
    expect(f.dimensionsCm).toBeUndefined(); // loose bulk genuinely has no shape
    expect(f.bodyDerived).toEqual({ body: 'tipper', basis: 'weight-only' });
  });

  it('FB0b: the minter’s body pick is ADVISORY — a mismatched vehicle is still offered the load', () => {
    // The decision that makes the open board possible (user, 2026-08-30). A shop clerk cannot reliably tell a
    // skeletal from a flatbed, and if their guess BOUND the matching, the one operator who could actually have
    // taken the load would be excluded — invisibly, which is the exact failure the board exists to remove.
    const d = drivers.register({ displayName: 'AD', fullName: 'A', nationalId: 'ID-AD', mobile: '+254770321', licenceClasses: ['truck'], licenceNumber: 'L-AD', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'AD-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'] });
    fleet.couple(d.did, truck.vehicleId);

    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({
      description: 'Crate',
      pickupLocation: pickup,
      pickupLabel: 'Depot',
      destLabel: 'Site',
      destLocation: pickup,
      weightKg: 400,
      packaging: 'palletised',
      dimensionsCm: [120, 100, 80],
      bodyHint: 'skeletal', // …and the truck is a flatbed. The pick disagrees with the vehicle AND the cargo.
    });
    expect(f.bodyHint).toBe('skeletal'); // recorded — the disagreement is itself a market signal
    expect(f.bodyDerived!.body).toBe('box'); // the derivation ignores the hint entirely

    const offers = dispatch.suggest(d.did, { from: pickup, to: pickup }).filter((o) => o.ref === f.freightId);
    expect(offers).toHaveLength(1); // the hint did not filter anybody out
  });

  it('FB0b: a shipper exclusion is STORED as a preference — and not yet silently enforced', () => {
    // Deliberate sequencing. An exclusion belongs on the board as "the shipper ruled out open bodies", where
    // an operator can see it and argue with it. Enforcing it here, before any screen can show it, would drop
    // matching drivers with no explanation — invisible exclusion again. It gates at the board (FB1), not here.
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Electronics', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80], excludedBodies: ['flatbed', 'dropside'] });
    expect(f.excludedBodies).toEqual(['flatbed', 'dropside']);
    // An empty list is not an exclusion — it is stored as absent, so "no preference" and "an empty preference"
    // cannot drift apart downstream.
    const none = dispatch.registerFreight({ description: 'Electronics', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', weightKg: 400, packaging: 'palletised', excludedBodies: [] });
    expect(none.excludedBodies).toBeUndefined();
  });

  /* --- FB1: the open board --- */

  it('FB1: SHOWS EVERYTHING — a load the driver cannot take is marked, never removed', () => {
    // The decision the whole feature rests on. Hiding a job because it needs a forklift denies an operator the
    // one thing that tells them what to buy next.
    const d = drivers.register({ displayName: 'BD', fullName: 'B', nationalId: 'ID-BD', mobile: '+254771001', licenceClasses: ['truck'], licenceNumber: 'L-BD', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: 'BD-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5 });
    fleet.couple(d.did, v.vehicleId);

    const here = { lat: -1.2, lng: 36.8 };
    const takeable = dispatch.registerFreight({ description: 'Pallets', pickupLocation: here, pickupLabel: 'A', destLabel: 'B', destLocation: { lat: -1.15, lng: 36.8 }, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80] });
    const tooHeavy = dispatch.registerFreight({ description: 'Girders', pickupLocation: here, pickupLabel: 'A', destLabel: 'B', destLocation: { lat: -1.15, lng: 36.8 }, weightKg: 26_000, packaging: 'palletised', dimensionsCm: [1400, 200, 150] });

    const rows = dispatch.board({ driverDid: d.did, from: here });
    // BOTH are on the board.
    expect(rows.map((r) => r.freightId).sort()).toEqual([takeable.freightId, tooHeavy.freightId].sort());
    const heavy = rows.find((r) => r.freightId === tooHeavy.freightId)!;
    expect(heavy.canTake).toBe(false);
    expect(heavy.blockers.map((b) => b.code)).toContain('OVER_VEHICLE_CAPACITY');
    expect(rows.find((r) => r.freightId === takeable.freightId)!.canTake).toBe(true);
  });

  it('FB1: no 15 km clamp — the board answers “is it worth 80 km empty?”, which the push cannot even ask', () => {
    const d = drivers.register({ displayName: 'BF', fullName: 'B', nationalId: 'ID-BF', mobile: '+254771002', licenceClasses: ['truck'], licenceNumber: 'L-BF', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: 'BF-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5 });
    fleet.couple(d.did, v.vehicleId);

    const here = { lat: -1.2, lng: 36.8 };
    const farAway = { lat: -1.9, lng: 36.8 }; // ~78 km south — far outside MAX_WORK_RADIUS_KM
    const far = dispatch.registerFreight({ description: 'Far load', pickupLocation: farAway, pickupLabel: 'Far', destLabel: 'B', destLocation: { lat: -1.95, lng: 36.8 }, weightKg: 400, packaging: 'palletised' });

    // The push cannot see it, and should not: an interruption ought to be about something nearby.
    expect(dispatch.suggestNearby(d.did, here, MAX_WORK_RADIUS_KM).filter((o) => o.ref === far.freightId)).toHaveLength(0);
    // The board can, and reports the empty run honestly.
    const row = dispatch.board({ driverDid: d.did, from: here }).find((r) => r.freightId === far.freightId)!;
    expect(row).toBeDefined();
    expect(row.deadheadKm).toBeGreaterThan(MAX_WORK_RADIUS_KM);
    expect(row.deadheadKm + row.loadedKm).toBeCloseTo(row.totalKm, 5);
  });

  it('FB1: the radius is the OPERATOR’s — absent means the whole market', () => {
    const d = drivers.register({ displayName: 'BR', fullName: 'B', nationalId: 'ID-BR', mobile: '+254771003', licenceClasses: ['truck'], licenceNumber: 'L-BR', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: 'BR-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'] });
    fleet.couple(d.did, v.vehicleId);
    const here = { lat: -1.2, lng: 36.8 };
    const near = dispatch.registerFreight({ description: 'Near', pickupLocation: here, pickupLabel: 'A', destLabel: 'B', weightKg: 400, packaging: 'palletised' });
    const far = dispatch.registerFreight({ description: 'Far', pickupLocation: { lat: -1.9, lng: 36.8 }, pickupLabel: 'Far', destLabel: 'B', weightKg: 400, packaging: 'palletised' });

    const all = dispatch.board({ driverDid: d.did, from: here }).map((r) => r.freightId);
    expect(all).toContain(near.freightId);
    expect(all).toContain(far.freightId);
    // Narrowed by the operator, the far one drops out — their choice, not ours.
    const narrow = dispatch.board({ driverDid: d.did, from: here, radiusKm: 20 }).map((r) => r.freightId);
    expect(narrow).toContain(near.freightId);
    expect(narrow).not.toContain(far.freightId);
  });

  it('FB1: sorted by earnings per TOTAL km, empty run included', () => {
    const d = drivers.register({ displayName: 'BS', fullName: 'B', nationalId: 'ID-BS', mobile: '+254771004', licenceClasses: ['truck'], licenceNumber: 'L-BS', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: 'BS-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 100, pricePerKm: 0.1 });
    fleet.couple(d.did, v.vehicleId);
    const here = { lat: -1.2, lng: 36.8 };
    // Same haul, one at the door and one 78 km away. A flat base fee dominates, so the near one earns far more
    // per kilometre turned — which proximity sorting would also get right, but for the platform's reason.
    const atDoor = dispatch.registerFreight({ description: 'At the door', pickupLocation: here, pickupLabel: 'A', destLabel: 'B', destLocation: { lat: -1.18, lng: 36.8 }, weightKg: 400, packaging: 'palletised' });
    const wayOut = dispatch.registerFreight({ description: 'Way out', pickupLocation: { lat: -1.9, lng: 36.8 }, pickupLabel: 'Far', destLabel: 'B', destLocation: { lat: -1.88, lng: 36.8 }, weightKg: 400, packaging: 'palletised' });

    const rows = dispatch.board({ driverDid: d.did, from: here });
    expect(rows[0].freightId).toBe(atDoor.freightId);
    expect(rows[0].earningsPerKm!).toBeGreaterThan(rows.find((r) => r.freightId === wayOut.freightId)!.earningsPerKm!);
  });

  it('FB1: an uncoupled operator still sees the market — priced at nothing, and told why', () => {
    // A fabricated rate would be the single most misleading number on the screen, so there is none: no price,
    // no sort score, and one honest reason.
    const d = drivers.register({ displayName: 'BU', fullName: 'B', nationalId: 'ID-BU', mobile: '+254771005', licenceClasses: ['truck'], licenceNumber: 'L-BU', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const here = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Pallets', pickupLocation: here, pickupLabel: 'A', destLabel: 'B', weightKg: 400, packaging: 'palletised' });
    const row = dispatch.board({ driverDid: d.did, from: here }).find((r) => r.freightId === f.freightId)!;
    expect(row.price).toBeUndefined();
    expect(row.earningsPerKm ?? null).toBeNull();
    expect(row.canTake).toBe(false);
    expect(row.blockers.map((b) => b.code)).toEqual(['NO_VEHICLE']);
  });

  it('FB1: negotiate loads live HERE — the board is why they are kept out of the push', () => {
    const d = drivers.register({ displayName: 'BN', fullName: 'B', nationalId: 'ID-BN', mobile: '+254771006', licenceClasses: ['truck'], licenceNumber: 'L-BN', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: 'BN-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'] });
    fleet.couple(d.did, v.vehicleId);
    const here = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Awkward', pickupLocation: here, pickupLabel: 'A', destLabel: 'B', weightKg: 400, packaging: 'palletised', commitMode: 'negotiate' });
    expect(dispatch.suggest(d.did, { from: here, to: here }).filter((o) => o.ref === f.freightId)).toHaveLength(0);
    const row = dispatch.board({ driverDid: d.did, from: here }).find((r) => r.freightId === f.freightId)!;
    expect(row).toBeDefined();
    expect(row.commitMode).toBe('negotiate'); // …so the screen can offer "send them your price" instead of Claim
  });

  it('FB1: a claimed load is gone from the market — "show everything" is not "show history"', () => {
    const d = drivers.register({ displayName: 'BC', fullName: 'B', nationalId: 'ID-BC', mobile: '+254771007', licenceClasses: ['truck'], licenceNumber: 'L-BC', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: 'BC-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5 });
    fleet.couple(d.did, v.vehicleId);
    const here = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Pallets', pickupLocation: here, pickupLabel: 'A', destLabel: 'B', destLocation: here, weightKg: 400, packaging: 'palletised' });
    expect(dispatch.board({ driverDid: d.did, from: here }).some((r) => r.freightId === f.freightId)).toBe(true);
    const [offer] = dispatch.suggest(d.did, { from: here, to: here }).filter((o) => o.ref === f.freightId);
    dispatch.claim(offer.offerId);
    expect(dispatch.board({ driverDid: d.did, from: here }).some((r) => r.freightId === f.freightId)).toBe(false);
  });

  /* --- FB0c: negotiate before commit --- */

  const negotiator = (tag: string) => {
    const d = drivers.register({ displayName: tag, fullName: tag, nationalId: `ID-${tag}`, mobile: `+2547709${tag}`, licenceClasses: ['truck'], licenceNumber: `L-${tag}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: `${tag}-1`, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5 });
    fleet.couple(d.did, v.vehicleId);
    return d;
  };
  const pickupPt = { lat: -1.2, lng: 36.8 };
  const negotiable = (extra: Record<string, unknown> = {}) =>
    dispatch.registerFreight({ description: 'Awkward load', pickupLocation: pickupPt, pickupLabel: 'Depot', destLabel: 'Site', destLocation: { lat: -1.15, lng: 36.8 }, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80], commitMode: 'negotiate', ...extra });

  /* --- FB3b: the public market --- */

  it('FB3b: answers a caller with no account and no vehicle — with money on every row', () => {
    // The whole point. board() gives an anonymous caller a price of `undefined` on every row, because there
    // is no vehicle whose rate card to price against — which strips the one number somebody deciding whether
    // to buy a truck came for. The public market prices at the network's default instead, and says so.
    const here = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Pallets', pickupLocation: here, pickupLabel: 'Mama Njeri Shop', destLabel: 'Site', destLocation: { lat: -1.15, lng: 36.8 }, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80] });
    expect(f).toBeDefined();

    const rows = dispatch.publicMarket({ from: here });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.indicativeTotal).toBeGreaterThan(0);
      expect(r.bodyDerived?.body).toBeTruthy(); // "there is work here FOR A FLATBED" is the answer being sold
    }
    // Against the same load the signed-out board says nothing about money at all.
    expect(dispatch.board({ from: here }).every((r) => r.price === undefined)).toBe(true);
  });

  it('FB3b: publishes the WORK and withholds the LOAD’s address', () => {
    // A public list naming the shop would be a standing, anonymous inventory of valuable goods with dates
    // against them. A town and a distance answer the market question without being that.
    // A pin deliberately OFF the rounding grid, so the coarsening has something to do. (-1.2/36.8 sits
    // exactly on it, which would make the assertion below pass while proving nothing.)
    const here = { lat: -1.2137, lng: 36.8241 };
    dispatch.registerFreight({ description: 'Three crates of copper cable', pickupLocation: here, pickupLabel: 'Mama Njeri Shop', destLabel: 'Site', destLocation: { lat: -1.15, lng: 36.8 }, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80] });
    const [row] = dispatch.publicMarket({ from: here });

    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain('Mama Njeri Shop'); // no shop name
    expect(serialised).not.toContain('copper cable'); // no description of the goods
    expect(serialised).not.toMatch(/FRT-/); // no code to quote at a counter
    expect(row).not.toHaveProperty('freightId');
    expect(row).not.toHaveProperty('pickupLocation'); // the exact pin never leaves

    // The pin it DOES carry is rounded to a ~5 km grid — mappable, not meetable.
    expect(row.pickupAbout).not.toEqual(here);
    expect(row.pickupAbout).toEqual({ lat: -1.2, lng: 36.8 });
    for (const n of [row.pickupAbout.lat, row.pickupAbout.lng]) expect(Math.abs(Math.round(n / 0.05) * 0.05 - n)).toBeLessThan(1e-9);
    // …and the work itself is all there.
    expect(row.weightKg).toBe(400);
    expect(row.totalKm).toBeGreaterThan(0);
  });

  it('FB3b: names a coarse TOWN, or says nothing rather than implying precision', () => {
    // "near Nairobi" said of a load 140 km away reads as precision and is not.
    const nairobi = { lat: -1.2864, lng: 36.8172 };
    dispatch.registerFreight({ description: 'Pallets', pickupLocation: nairobi, pickupLabel: 'A', destLabel: 'B', destLocation: { lat: -1.15, lng: 36.8 }, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80] });
    expect(dispatch.publicMarket({ from: nairobi })[0].area).toBeTruthy();

    const middleOfNowhere = { lat: 2.5, lng: 40.9 }; // far from every gazetteer entry
    dispatch.registerFreight({ description: 'Pallets', pickupLocation: middleOfNowhere, pickupLabel: 'A', destLabel: 'B', destLocation: middleOfNowhere, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80] });
    const remote = dispatch.publicMarket({ from: middleOfNowhere, radiusKm: 5 })[0];
    expect(remote.area).toBeUndefined(); // no name is better than a wrong one
    expect(remote.deadheadKm).toBeDefined(); // the distance still answers
  });

  it('FB3b: the market endpoint is PUBLIC and the driver board is not', () => {
    // The whole slice fails silently if this decorator is ever lost: the page would 401 for exactly the
    // people it exists for, and every test that calls the method directly would still pass. Asserted as
    // metadata rather than through HTTP because that is where the mistake would actually be made.
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SbgController.prototype.publicMarket)).toBe(true);
    // And its opposite: the full board, which carries exact pins, shop names and codes, stays behind a token.
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SbgController.prototype.freightBoard)).toBeUndefined();
  });

  it('FB3b: the radius is the CALLER’s, with no clamp — anywhere, from anywhere', () => {
    const here = { lat: -1.2, lng: 36.8 };
    const farAway = { lat: -1.9, lng: 36.8 }; // ~78 km south, far outside MAX_WORK_RADIUS_KM
    dispatch.registerFreight({ description: 'Pallets', pickupLocation: farAway, pickupLabel: 'A', destLabel: 'B', destLocation: farAway, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80] });

    // Narrow, and it is gone; wide, and it is there. The 15 km number never enters into it.
    expect(dispatch.publicMarket({ from: here, radiusKm: 20 }).some((r) => r.deadheadKm > 50)).toBe(false);
    const wide = dispatch.publicMarket({ from: here, radiusKm: 200 }).find((r) => r.deadheadKm > 50);
    expect(wide).toBeDefined();
    expect(wide!.deadheadKm).toBeGreaterThan(MAX_WORK_RADIUS_KM);
  });

  /* --- FB4: the market series --- */

  it('FB4: stamps WHAT CARRIED a load at claim, so the series cannot be rewritten later', () => {
    // Only claimedBy was ever recorded. "Km moved by container chassis in 2026" could then only be answered
    // from what that driver is coupled to TODAY — so selling a flatbed and buying a box van would silently
    // change the body of every haul they had ever done.
    const d = negotiator('CARRY');
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Pallets', pickupLocation: pickup, pickupLabel: 'A', destLabel: 'B', destLocation: { lat: -1.15, lng: 36.8 }, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80] });
    const [offer] = dispatch.suggest(d.did, { from: pickup, to: pickup }).filter((o) => o.ref === f.freightId);
    dispatch.claim(offer.offerId);

    const claimed = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
    expect(claimed.carriedBy).toEqual({ vehicleClass: 'truck', truckSubtype: 'flatbed' });
    expect(dispatch.marketSeries({ since: 0, until: Date.now() + 1000 }).bodies.find((b) => b.body === 'flatbed')!.movedLoads).toBeGreaterThan(0);
  });

  it('FB4: scopes the series by where the LOAD is, so anyone can ask about anywhere', () => {
    const nairobi = { lat: -1.2, lng: 36.8 };
    const farAway = { lat: -1.9, lng: 36.8 }; // ~78 km south
    dispatch.registerFreight({ description: 'Pallets', pickupLocation: farAway, pickupLabel: 'A', destLabel: 'B', destLocation: farAway, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80] });

    const window = { since: 0, until: Date.now() + 1000 };
    const near = dispatch.marketSeries({ ...window, from: nairobi, radiusKm: 20 });
    const wide = dispatch.marketSeries({ ...window, from: nairobi, radiusKm: 500 });
    expect(wide.totals.offeredLoads).toBeGreaterThan(near.totals.offeredLoads);
    // And with no point at all, the whole network — a question with no natural centre must stay askable.
    expect(dispatch.marketSeries(window).totals.offeredLoads).toBeGreaterThanOrEqual(wide.totals.offeredLoads);
  });

  it('FB4: the series endpoint is PUBLIC, and refuses a period that ends before it starts', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SbgController.prototype.marketSeries)).toBe(true);
    expect(() => controller.marketSeries({ since: '2026-06-01T00:00:00.000Z', until: '2026-01-01T00:00:00.000Z' } as never)).toThrow(/start before it ends/);
  });

  it('FB2c: a shipper exclusion now BINDS at claim — because the board can finally explain it', () => {
    // Stored since FB0b and deliberately unenforced while no screen could show it: dropping a qualifying
    // driver with no reason given is the invisible exclusion the board exists to remove. Now the board marks
    // the row "the shipper has ruled out your body type", so refusing the claim only honours what was said.
    const d = negotiator('XB');
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Electronics', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80], excludedBodies: ['flatbed'] });
    const [offer] = dispatch.suggest(d.did, { from: pickup, to: pickup }).filter((o) => o.ref === f.freightId);
    expect(offer).toBeDefined(); // still OFFERED — the exclusion is a preference, not a capability
    expect(() => dispatch.claim(offer.offerId)).toThrow(/ruled out your body type/);
    // Refused before any mutation: the load stays open for a body the shipper does accept.
    expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)!.status).toBe('available');
  });

  it('FB2c: the counter’s indivisible answer is what makes a heavy load a low-loader job', () => {
    // 26 t: divisible is two ordinary trips on an open deck, indivisible is a low-loader and a permit. No
    // measurement implies it — only the person standing at the load knows.
    const pickup = { lat: -1.2, lng: 36.8 };
    const base = { pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', weightKg: 26_000, packaging: 'palletised' as const, dimensionsCm: [400, 200, 150] as [number, number, number] };
    expect(dispatch.registerFreight({ ...base, description: 'Splittable' }).bodyDerived!.body).toBe('flatbed');
    expect(dispatch.registerFreight({ ...base, description: 'One piece', indivisible: true }).bodyDerived!.body).toBe('lowboy');
  });

  it('FB2b: a poster sees THEIR loads and the prices waiting — and nobody else’s', () => {
    // Scoped at the source, not by filtering the public list. A screen that filters someone else's data has
    // already received it (the register epic's data-firewall lesson).
    const a = negotiator('PA');
    const mine = negotiable({ postedByDid: 'did:agent:mine' });
    const theirs = negotiable({ postedByDid: 'did:agent:theirs' });
    dispatch.propose({ freightId: mine.freightId, driverDid: a.did, from: pickupPt, price: 90 });

    const rows = dispatch.postedBy('did:agent:mine');
    expect(rows.map((r) => r.freightId)).toEqual([mine.freightId]);
    expect(rows[0].openProposals).toBe(1);
    expect(dispatch.postedBy('did:agent:theirs')[0].freightId).toBe(theirs.freightId);
    expect(dispatch.postedBy('did:agent:theirs')[0].openProposals).toBe(0);
    // An unknown poster gets nothing, not everything.
    expect(dispatch.postedBy('')).toEqual([]);
    expect(dispatch.postedBy('did:agent:nobody')).toEqual([]);
  });

  it('FB2b: the poster’s row carries no identifiers that join the load to a person', () => {
    // It exists to answer prices, so it holds none of the joins a tracking view would need.
    const f = negotiable({ postedByDid: 'did:agent:mine', buyerMobile: '+254700111222' });
    const [row] = dispatch.postedBy('did:agent:mine');
    expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)!.buyerPhoneHash).toBeTruthy();
    expect(row).not.toHaveProperty('buyerPhoneHash');
    expect(row).not.toHaveProperty('claimedBy');
    // FP6 — the tracking key IS on the row now, deliberately: it names the load, not a person, and the poster is
    // the one who hands it on. The carrier still appears only as a display name and a plate, never a did.
    expect(row.trackingKey).toMatch(/^T-/);
  });

  it('FB2b: the count follows the negotiation — decided prices stop waiting', () => {
    const a = negotiator('PB');
    const b = negotiator('PC');
    const f = negotiable({ postedByDid: 'did:agent:mine' });
    const pa = dispatch.propose({ freightId: f.freightId, driverDid: a.did, from: pickupPt, price: 70 });
    dispatch.propose({ freightId: f.freightId, driverDid: b.did, from: pickupPt, price: 95 });
    expect(dispatch.postedBy('did:agent:mine')[0].openProposals).toBe(2);
    dispatch.acceptProposal(pa.proposalId);
    const [after] = dispatch.postedBy('did:agent:mine');
    expect(after.openProposals).toBe(0); // one accepted, the other superseded
    expect(after.status).toBe('claimed');
    expect(after.agreedPrice).toBe(70); // the outcome, without a second call
  });

  it('FB0c: a load posted for negotiation is agreed on a price, and the acceptance is what claims it', () => {
    const d = negotiator('NG');
    const f = negotiable();
    expect(f.commitMode).toBe('negotiate');

    const p = dispatch.propose({ freightId: f.freightId, driverDid: d.did, from: { lat: -1.22, lng: 36.8 }, price: 85, note: 'Empty-running past your gate' });
    expect(p.status).toBe('open');
    // A proposal reserves NOTHING — the shipper is shopping, and a bid that quietly held the load would be a
    // claim by another name.
    expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)!.status).toBe('available');

    const { freight } = dispatch.acceptProposal(p.proposalId);
    expect(freight.status).toBe('claimed');
    expect(freight.claimedBy).toBe(d.did);
    expect(freight.lockedPrice).toBe(85); // the agreed number, not the computed one
    expect(freight.priceOrigin).toBe('negotiated');
    // The computed breakdown is kept for its DISTANCES — the market series reads them, and they are real even
    // though the price was not computed from them.
    expect(freight.priceBreakdown!.deadheadKm).toBeGreaterThan(0);
    expect(freight.priceBreakdown!.loadedKm).toBeGreaterThan(0);
    expect(freight.priceBreakdown!.total).not.toBe(85);
    expect(dispatch.proposalsFor(f.freightId)[0].status).toBe('accepted');
  });

  it('FB0c: a negotiate load cannot be claimed over the counter, and is never PUSHED at anyone', () => {
    const d = negotiator('NP');
    const f = negotiable();
    // It is not offered: a push is one decision with a Claim button, and an unsettled price cannot answer it.
    expect(dispatch.suggest(d.did, { from: pickupPt, to: pickupPt }).filter((o) => o.ref === f.freightId)).toHaveLength(0);
    expect(dispatch.suggestNearby(d.did, pickupPt, 10).filter((o) => o.ref === f.freightId)).toHaveLength(0);
    // …and it is not hidden either: it is on the freight list, where the board reads from.
    expect(dispatch.listFreight().some((x) => x.freightId === f.freightId)).toBe(true);
  });

  it('FB0c: an INSTANT load still behaves exactly as before — nothing was made to negotiate that was not asked to', () => {
    const d = negotiator('NI');
    const f = dispatch.registerFreight({ description: 'Normal', pickupLocation: pickupPt, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickupPt, weightKg: 400, packaging: 'palletised' });
    expect(f.commitMode).toBeUndefined(); // stored only when chosen — absent READS as instant
    const [offer] = dispatch.suggest(d.did, { from: pickupPt, to: pickupPt }).filter((o) => o.ref === f.freightId);
    expect(offer).toBeDefined();
    dispatch.claim(offer.offerId);
    const claimed = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
    expect(claimed.status).toBe('claimed');
    expect(claimed.priceOrigin).toBe('computed');
    expect(claimed.lockedPrice).toBe(claimed.priceBreakdown!.total);
    // And proposing on it is refused — there is nothing to negotiate.
    expect(() => dispatch.propose({ freightId: f.freightId, driverDid: d.did, from: pickupPt, price: 50 })).toThrow(/claim it instead/);
  });

  it('FB0c: one live proposal per driver — a new price REPLACES the old one', () => {
    const d = negotiator('NR');
    const f = negotiable();
    const first = dispatch.propose({ freightId: f.freightId, driverDid: d.did, from: pickupPt, price: 90 });
    const second = dispatch.propose({ freightId: f.freightId, driverDid: d.did, from: pickupPt, price: 75 });
    const mine = dispatch.proposalsFor(f.freightId).filter((p) => p.driverDid === d.did);
    expect(mine.filter((p) => p.status === 'open')).toHaveLength(1);
    expect(mine.find((p) => p.proposalId === first.proposalId)!.status).toBe('withdrawn');
    expect(mine.find((p) => p.proposalId === second.proposalId)!.status).toBe('open');
  });

  it('FB0c: accepting one price supersedes the rest — nobody is left bidding on a load that is gone', () => {
    const a = negotiator('NA');
    const b = negotiator('NB');
    const f = negotiable();
    const pa = dispatch.propose({ freightId: f.freightId, driverDid: a.did, from: pickupPt, price: 70 });
    const pb = dispatch.propose({ freightId: f.freightId, driverDid: b.did, from: pickupPt, price: 95 });
    dispatch.acceptProposal(pa.proposalId);
    // 'superseded' is deliberately not 'declined': nobody judged this number.
    expect(dispatch.proposalsFor(f.freightId).find((p) => p.proposalId === pb.proposalId)!.status).toBe('superseded');
  });

  it('FB0c: declining one price leaves the load and every other price open', () => {
    const a = negotiator('ND');
    const b = negotiator('NE');
    const f = negotiable();
    const pa = dispatch.propose({ freightId: f.freightId, driverDid: a.did, from: pickupPt, price: 200 });
    const pb = dispatch.propose({ freightId: f.freightId, driverDid: b.did, from: pickupPt, price: 80 });
    dispatch.declineProposal(pa.proposalId);
    expect(dispatch.proposalsFor(f.freightId).find((p) => p.proposalId === pb.proposalId)!.status).toBe('open');
    expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)!.status).toBe('available');
    dispatch.acceptProposal(pb.proposalId); // …and the negotiation can still conclude
    expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)!.lockedPrice).toBe(80);
  });

  it('FB0c: a driver can withdraw their own price, and only their own', () => {
    const a = negotiator('NW');
    const b = negotiator('NX');
    const f = negotiable();
    const pa = dispatch.propose({ freightId: f.freightId, driverDid: a.did, from: pickupPt, price: 60 });
    expect(() => dispatch.withdrawProposal(pa.proposalId, b.did)).toThrow(/not yours/);
    expect(dispatch.withdrawProposal(pa.proposalId, a.did).status).toBe('withdrawn');
    expect(() => dispatch.acceptProposal(pa.proposalId)).toThrow(/withdrawn/); // and it cannot be taken after
  });

  it('FB0c: the shipper’s budget binds a NEGOTIATED price too — and the proposal survives to be accepted later', () => {
    const d = negotiator('NM');
    const f = negotiable({ maxSpend: 50 });
    const p = dispatch.propose({ freightId: f.freightId, driverDid: d.did, from: pickupPt, price: 200 });
    // Agreeing above the cap would commit a haul nobody has the money for.
    expect(() => dispatch.acceptProposal(p.proposalId)).toThrow(/budget/i);
    // Nothing was mutated: the load is still open and the price is still on the table, so the shipper can
    // raise the cap and take it. A refused acceptance must not destroy the negotiation.
    expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)!.status).toBe('available');
    expect(dispatch.proposalsFor(f.freightId)[0].status).toBe('open');
  });

  it('CV2: refuses an offer the poster could never accept — at the door, to the driver', () => {
    // Found in the browser pass: a driver on a small vehicle offered a price on a load it could not carry, and
    // the shop only found out when it pressed Accept. The same checks acceptance makes are now asked first.
    const tag = 'MOTO';
    // A light-registry courier activates on registration — no KYC step to run.
    const d = drivers.register({ displayName: tag, fullName: tag, nationalId: `ID-${tag}`, mobile: `+2547709${tag}`, licenceClasses: ['motorcycle'], licenceNumber: `L-${tag}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    const moto = vehicles.register({ plate: `${tag}-1`, vehicleClass: 'motorcycle', capacityKg: 30, ownerName: 'X', baseFee: 1, pricePerKm: 0.2 });
    fleet.couple(d.did, moto.vehicleId);
    const f = negotiable(); // 400 kg, palletised

    expect(() => dispatch.propose({ freightId: f.freightId, driverDid: d.did, from: pickupPt, price: 50 })).toThrow(/no room for this load/);
    // Nothing was recorded for the poster to trip over.
    expect(dispatch.proposalsFor(f.freightId)).toEqual([]);
  });

  it('FB0c: acceptance re-checks the world as it is NOW — a de-coupled driver cannot be bound to an old price', () => {
    // A proposal is an offer to treat with a shelf life, not a reservation. The S31 mirror-at-claim lesson:
    // a second route to the same mutation must re-run every gate the first one does.
    const d = negotiator('NC');
    const f = negotiable();
    const p = dispatch.propose({ freightId: f.freightId, driverDid: d.did, from: pickupPt, price: 85 });
    fleet.uncouple(d.did);
    expect(() => dispatch.acceptProposal(p.proposalId)).toThrow(/coupled/i);
    expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)!.status).toBe('available');
  });

  it('FB0c: a driver with no vehicle cannot propose at all — a shipper never reads a bid they cannot take', () => {
    const d = drivers.register({ displayName: 'NV', fullName: 'NV', nationalId: 'ID-NV', mobile: '+254770NV', licenceClasses: ['truck'], licenceNumber: 'L-NV', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const f = negotiable();
    expect(() => dispatch.propose({ freightId: f.freightId, driverDid: d.did, from: pickupPt, price: 85 })).toThrow(/couple/i);
  });

  it('FB0c: a price must be a real number above zero', () => {
    const d = negotiator('NZ');
    const f = negotiable();
    for (const price of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => dispatch.propose({ freightId: f.freightId, driverDid: d.did, from: pickupPt, price })).toThrow(/above zero/);
    }
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
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, packaging: 'palletised', shipperDid: vendor.vendorId });
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
    const f = dispatch.registerFreight({ description: 'Machinery', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, packaging: 'palletised', shipperDid: vendor.vendorId });
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

  it('a store no sister settles posts freight that is claimed UNPAID — settled off-platform, never billed, never a refusal', () => {
    presence.set({ jurisdiction: 'DE', level: 'matched' });
    const d = drivers.register({ displayName: 'OP', fullName: 'O', nationalId: 'ID-OP', mobile: '+254771001', licenceClasses: ['truck'], licenceNumber: 'L-OP', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'OP-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5 });
    fleet.couple(d.did, truck.vehicleId);
    const vendor = vendors.register({ name: 'Berliner Möbel', country: 'DE' });
    expect(vendors.settlesWithUs(vendor.vendorId)).toBe(false);
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Wardrobe', pickupLocation: pickup, pickupLabel: 'Depot', destLabel: 'Site', destLocation: pickup, weightKg: 200, packaging: 'palletised', shipperDid: vendor.vendorId });
    const noon = new Date('2026-07-22T11:00:00').getTime();
    const [offer] = dispatch.suggest(d.did, { from: pickup, to: pickup }, noon);
    dispatch.claim(offer.offerId, noon);
    const claimed = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
    expect(claimed.paidStatus).toBe('unpaid'); // not 'billing_failed': there is no debt to us, there is no till
    expect(claimed.billed).toBeUndefined();
    expect(vendors.balanceOrNone(vendor.vendorId)).toBeNull();
    pickupOk(f, d.did);
    deliverOk(f, d.did);
    expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)!.status).toBe('delivered');
  });

  it('CA6: a foreign truck is never offered a load inside another country unless a rule allows it — and a crossing says what to carry', () => {
    const d = drivers.register({ displayName: 'CB', fullName: 'C', nationalId: 'ID-CB', mobile: '+254771002', licenceClasses: ['truck'], licenceNumber: 'L-CB', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'CB-1', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5 });
    fleet.couple(d.did, truck.vehicleId);
    expect(drivers.homeCountryOf(d.did)).toBe('KE');
    const pickup = { lat: -1.2, lng: 36.8 };
    const noon = new Date('2026-07-22T11:00:00').getTime();
    const offered = (freightId: string) => dispatch.suggest(d.did, { from: pickup, to: pickup }, noon).find((o) => o.ref === freightId);

    const domesticTz = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'Arusha yard', destLabel: 'Moshi site', destLocation: pickup, weightKg: 200, packaging: 'palletised', pickupCountry: 'TZ', destCountry: 'TZ' });
    expect(offered(domesticTz.freightId)).toBeUndefined();

    borders.set({ from: 'KE', to: 'TZ', cabotage: 'allowed', crossings: [{ name: 'Namanga', hours: '06:00–22:00' }], regionalInsurance: ['COMESA Yellow Card'], maxWeightKg: 150 }, 'Amina');
    expect(offered(domesticTz.freightId)).toBeDefined();

    const light = dispatch.registerFreight({ description: 'Tiles', pickupLocation: pickup, pickupLabel: 'Nairobi yard', destLabel: 'Arusha site', destLocation: pickup, weightKg: 100, packaging: 'palletised', pickupCountry: 'KE', destCountry: 'TZ' });
    expect(offered(light.freightId)?.border).toMatchObject({ recorded: true, crossings: [{ name: 'Namanga', hours: '06:00–22:00' }], regionalInsurance: ['COMESA Yellow Card'], maxWeightKg: 150 });

    const heavy = dispatch.registerFreight({ description: 'Steel', pickupLocation: pickup, pickupLabel: 'Nairobi yard', destLabel: 'Arusha site', destLocation: pickup, weightKg: 200, packaging: 'palletised', pickupCountry: 'KE', destCountry: 'TZ' });
    expect(offered(heavy.freightId)).toBeUndefined();

    // Claiming re-asks: a rule withdrawn after the offer was made is refused at the claim, by name.
    const offer = offered(domesticTz.freightId)!;
    borders.set({ from: 'KE', to: 'TZ', cabotage: 'forbidden' }, 'Brian');
    expect(() => dispatch.claim(offer.offerId, noon)).toThrow(/may not carry a load inside Tanzania/);
  });

  describe('credentials anybody can change — and a fleet code that is nobody else’s business', () => {
    it('changes a hub password only with the current one, and signs out every session holding the old one', () => {
      const email = 'rotate-hub@sbg.test';
      otp.verify('+254700111222', otp.request('+254700111222').code); // sign-up asks for a verified phone, as a person would
      const hub = accounts.signup({ role: 'mdp', email, password: 'first-pass', phone: '+254700111222', profile: { mdp: { name: 'Rotate Hub', zones: ['RZ'], country: 'KE', location: { lat: -1.2, lng: 36.8 } } } });
      const old = hub.token.access_token;
      expect(auth.introspect(old).active).toBe(true);

      expect(() => controller.changeAccountPassword({ email, password: 'wrong-pass', newPassword: 'second-pass-1' })).toThrow(/Wrong email or password/);
      expect(() => controller.changeAccountPassword({ email, password: 'first-pass', newPassword: 'short' })).toThrow(/at least 8/);
      expect(() => controller.changeAccountPassword({ email, password: 'first-pass', newPassword: 'first-pass' })).toThrow(/different from the current one/);

      const changed = controller.changeAccountPassword({ email, password: 'first-pass', newPassword: 'second-pass-1' });
      expect(auth.introspect(old).active).toBe(false); // every other device holding the old sign-in is out
      expect(auth.introspect(changed.token.access_token).active).toBe(true); // the one that changed it stays in
      expect(() => accounts.login(email, 'first-pass')).toThrow(/Wrong email or password/);
      expect(accounts.login(email, 'second-pass-1').did).toBe(hub.did);
    });

    it('changes a PIN only with the current one, and a wrong current PIN counts toward the lockout', () => {
      const phone = '+254700333444';
      const enrolled = persons.enroll(phone, true, '24689');
      expect(() => identity.changePin({ phone, pin: '99999', newPin: '48261', device: persons.trustDevice(phone) })).toThrow(/Wrong phone or PIN/);
      expect(() => identity.changePin({ phone, pin: '24689', newPin: '24689', device: persons.trustDevice(phone) })).toThrow(/different from the current one/);
      const r = identity.changePin({ phone, pin: '24689', newPin: '48261', device: persons.trustDevice(phone) });
      expect(r.token.access_token).toBeTruthy();
      expect(auth.introspect(enrolled.token.access_token)).toMatchObject({ active: false, reason: 'revoked' }); // the old session really ends
      expect(auth.introspect(r.token.access_token).active).toBe(true);
      expect(() => persons.loginWithPin(phone, '24689', persons.trustDevice(phone))).toThrow(/Wrong phone or PIN/);
      expect(persons.loginWithPin(phone, '48261', persons.trustDevice(phone)).token.access_token).toBeTruthy();
    });

    it('rotates a store’s signing secret only with the current one, and only for the store itself', () => {
      const store = vendors.register({ name: 'Rotating Store' });
      const first = store.secret;
      const self = { role: 'genesis', did: store.did } as never;
      // A wrong one from a store that is signed in is its own refusal — never the 401 an app reads as "signed out".
      expect(() => controller.rotateVendorSecret(store.vendorId, { secret: 'whsec_wrong' }, self)).toThrow(/not this store’s current secret/);
      const other = vendors.register({ name: 'Other Store' });
      expect(() => controller.rotateVendorSecret(store.vendorId, { secret: first }, { role: 'genesis', did: other.did } as never)).toThrow(/not yours/);

      const r = controller.rotateVendorSecret(store.vendorId, { secret: first }, self);
      expect(r.secret).toMatch(/^whsec_/);
      expect(r.secret).not.toBe(first);
      expect(r.secretRotatedAt).toBeTruthy();
      expect(() => vendors.login(store.vendorId, first)).toThrow(/Wrong store ID or secret/);
      expect(vendors.login(store.vendorId, r.secret).vendorId).toBe(store.vendorId);
    });

    it('shows a fleet its code, hides it from everyone else, lets a manager in without it, and rotates it', () => {
      const phone = '+254800950777';
      const m = managers.register({ companyName: 'Rotate Haulage', contactPhone: phone, ownerFullName: 'R R', ownerNationalId: 'MGR-ROT', location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: 'BRN-ROT', transportOperatorLicence: 'TOL-ROT', taxId: 'TAX-ROT' } });
      managers.submitKyc(m.did, { businessRegCertRef: 'r.jpg', operatorLicenceRef: 'l.jpg', ownerIdRef: 'i.jpg', proofOfAddressRef: 'a.jpg' });
      managers.decideKyc(m.did, true);
      const active = managers.recordBond(m.did);
      const code = active.loginCode!;
      persons.enroll(phone, true, '24689');
      controller.managerLookup({ code } as never); // links the registered phone to the fleet, as a first sign-in does

      // The hole: any signed-in account could read a fleet's code, tax id and licences by its DID.
      const shop = { role: 'pudo', did: 'did:glos:some-shop' } as never;
      const self = { role: 'fleet_manager', did: m.did, tenant: m.did } as never;
      const outside = controller.getManager(m.did, shop) as Record<string, unknown>;
      for (const hidden of ['loginCode', 'requirements', 'contactPhone', 'kyc', 'vaultRef']) expect(outside).not.toHaveProperty(hidden);
      expect(controller.getManager(m.did, self)).toHaveProperty('loginCode', code);

      // Forgot the code: phone + PIN names the fleets this person manages, and a chosen one signs in.
      expect(() => controller.managerChoices({ phone, pin: '00000', device: persons.trustDevice(phone) })).toThrow(/Wrong phone or PIN/);
      expect(controller.managerChoices({ phone, pin: '24689', device: persons.trustDevice(phone) }).fleets).toEqual([{ did: m.did, companyName: 'Rotate Haulage', status: 'ACTIVE' }]);
      expect(controller.managerSession({ did: m.did, phone, pin: '24689', device: persons.trustDevice(phone) } as never).token).toBeDefined();
      expect(() => controller.managerSession({ phone, pin: '24689', device: persons.trustDevice(phone) } as never)).toThrow(/fleet code, or choose the fleet/);

      // Rotating: the old code stops naming the fleet; only the fleet itself (or an operator) may do it.
      expect(() => controller.rotateManagerCode(m.did, shop)).toThrow(/not yours/);
      const rotated = controller.rotateManagerCode(m.did, self);
      expect(rotated.loginCode).toMatch(/^FM-[0-9A-F]{6}$/);
      expect(rotated.loginCode).not.toBe(code);
      expect(() => managers.login(code)).toThrow(/Unknown sign-in code/);
      expect(managers.login(rotated.loginCode!).did).toBe(m.did);
    });
  });

  describe('a driver signs in with the phone they were registered with', () => {
    it('links the registration to the person, and takes a PIN — not a driver ID', () => {
      const phone = '+254700990021';
      const d = controller.registerDriver({ displayName: 'Pin Rider', fullName: 'Pin Rider', nationalId: 'NID-PINRIDER', mobile: phone, licenceClasses: ['bike'] } as never, { active: true, role: 'operator' } as never);
      // Registered, but no PIN chosen yet: nothing opens.
      expect(() => controller.driverSignIn({ phone, pin: '13570', device: persons.trustDevice(phone) })).toThrow(/Wrong phone or PIN/);

      otp.verify(phone, otp.request(phone).code);
      persons.enroll(phone, true, '13570');
      expect(() => controller.driverSignIn({ phone, pin: '00000', device: persons.trustDevice(phone) })).toThrow(/Wrong phone or PIN/);

      const s = controller.driverSignIn({ phone, pin: '13570', device: persons.trustDevice(phone) });
      expect(s.did).toBe(d.did);
      expect(auth.introspect(s.token.access_token)).toMatchObject({ active: true, role: 'driver', did: d.did });

      // The PIN is the credential: changing it ends the session it opened.
      persons.changePin(phone, '13570', '48261', persons.trustDevice(phone));
      expect(auth.introspect(s.token.access_token)).toMatchObject({ active: false, reason: 'revoked' });
    });

    it('refuses a person who holds no driver role, even with the right PIN', () => {
      const phone = '+254700990022';
      otp.verify(phone, otp.request(phone).code);
      persons.enroll(phone, true, '48261');
      expect(() => controller.driverSignIn({ phone, pin: '48261', device: persons.trustDevice(phone) })).toThrow(/not registered to a driver/);
    });
  });

  /**
   * NOBODY DRIVES AS A COLLEAGUE BECAUSE THEY KNOW THEIR NUMBER.
   *
   * The user, 2026-10-01: "make sure there is no easy driver switch among colleagues of the same fleet — like, I know
   * the phone number of colleague X so I will take up his driver identity during something illegal." Colleagues know
   * each other's numbers. So a number must open nothing: the PIN behind it holds (five guesses, then only a code to
   * that phone), the easy PINs are refused, a sign-in elsewhere ends the colleague's, a phone left signed in cannot
   * start a shift without the PIN, and an offer addressed to the number is answered only from the driver's own sign-in.
   */
  describe('a phone number alone opens nothing — nobody drives as a colleague', () => {
    let n = 0;
    function aFleetOffice(name: string) {
      n += 1;
      const m = managers.register({ companyName: name, contactPhone: `+25480077${n}0`, ownerFullName: 'F O', ownerNationalId: `MGR-CL-${n}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-CL-${n}`, transportOperatorLicence: `TOL-CL-${n}`, taxId: `TAX-CL-${n}` } });
      managers.submitKyc(m.did, { businessRegCertRef: 'r.pdf', operatorLicenceRef: 'l.pdf', ownerIdRef: 'id.jpg', proofOfAddressRef: 'a.pdf' });
      managers.decideKyc(m.did, true, 'ops');
      managers.recordBond(m.did);
      return { did: m.did, office: { active: true, role: 'fleet_manager', did: m.did, tenant: m.did, personDid: `did:glos:mgr-${n}` } as never };
    }
    /** A rider the office registered, who chose a PIN through the phone door and signed in. */
    function aRider(fleetDid: string, office: never, pin = '13570') {
      n += 1;
      const phone = `+25471177${String(n).padStart(4, '0')}`;
      const d = controller.registerDriver({ displayName: `Rider ${n}`, fullName: `R ${n}`, nationalId: `NID-CL-${n}`, mobile: phone, licenceClasses: ['bike'] } as never, office);
      otp.verify(phone, otp.request(phone).code);
      persons.enroll(phone, true, pin);
      const signedIn = controller.driverSignIn({ phone, pin, device: persons.trustDevice(phone) });
      const bike = vehicles.register({ plate: `CL-${n}`, vehicleClass: 'bike', ownerName: 'Fleet', managerDid: fleetDid } as never);
      return { did: d.did, phone, pin, token: signedIn.token.access_token, actor: auth.introspect(signedIn.token.access_token) as never, bike };
    }

    it('a PIN locked by five wrong guesses is still locked an hour later — only a code sent to the phone opens it', () => {
      const kilima = aFleetOffice('Colleague Haulage');
      const x = aRider(kilima.did, kilima.office);
      for (let i = 0; i < 4; i++) expect(() => controller.driverSignIn({ phone: x.phone, pin: '00000', device: persons.trustDevice(x.phone) })).toThrow(/Wrong phone or PIN/);
      expect(() => controller.driverSignIn({ phone: x.phone, pin: '00000', device: persons.trustDevice(x.phone) })).toThrow(/Too many wrong PINs/);
      const anHourLater = Date.now() + 60 * 60 * 1000;
      const clock = jest.spyOn(Date, 'now').mockReturnValue(anHourLater);
      try {
        // It used to open itself after fifteen minutes: twenty guesses an hour, every hour, for whoever knew the number.
        expect(() => controller.driverSignIn({ phone: x.phone, pin: x.pin, device: persons.trustDevice(x.phone) })).toThrow(/Too many wrong PINs/);
        // The owner, with their phone in hand, verifies by code and chooses a PIN: in again.
        otp.verify(x.phone, otp.request(x.phone).code);
        persons.enroll(x.phone, true, '48261');
        expect(controller.driverSignIn({ phone: x.phone, pin: '48261', device: persons.trustDevice(x.phone) }).did).toBe(x.did);
      } finally {
        clock.mockRestore();
      }
    });

    it('refuses the PINs a colleague tries first, when a PIN is chosen', () => {
      const phone = '+254711779901';
      otp.verify(phone, otp.request(phone).code);
      // Mostly one digit; a run up, down and round the dial; every second number; the same three again; the keypad's middle column.
      for (const easy of ['00000', '77777', '12121', '11222', '55005', '12345', '98765', '78901', '13579', '24680', '97531', '12312', '45645', '02580', '25800', '08520', '70852']) {
        expect([easy, (() => { try { persons.enroll(phone, true, easy); return 'taken'; } catch (e) { return (e as { code?: string }).code; } })()]).toEqual([easy, 'PIN_GUESSABLE']);
      }
      // A PIN of the old length is not a PIN: it is the length of the one people already have for their money.
      expect(() => persons.enroll(phone, true, '2468')).toThrow(/exactly 5 digits/);
      // …and the ones that only look near to those are taken.
      for (const fine of ['13570', '24689', '48261', '90417']) expect(persons.enroll(phone, true, fine).person.pinHash).toBeTruthy();
    });

    it('one phone at a time: signing in as a driver ends that driver’s other session', () => {
      const kilima = aFleetOffice('One Phone Haulage');
      const x = aRider(kilima.did, kilima.office);
      expect(auth.introspect(x.token).active).toBe(true);
      const elsewhere = controller.driverSignIn({ phone: x.phone, pin: x.pin, device: persons.trustDevice(x.phone) });
      expect(auth.introspect(x.token)).toMatchObject({ active: false, reason: 'revoked' });
      expect(auth.introspect(elsewhere.token.access_token).active).toBe(true);
      // The role switcher is the same door: acting as the driver from another app ends the earlier one too.
      const viaSwitch = persons.mintForRole(persons.findByPhone(x.phone)!, 'driver');
      expect(auth.introspect(elsewhere.token.access_token)).toMatchObject({ active: false, reason: 'revoked' });
      expect(auth.introspect(viaSwitch.token.access_token).active).toBe(true);
    });

    it('a phone left signed in cannot start a shift without the PIN — and wrong ones count toward the lock', () => {
      const kilima = aFleetOffice('Shared Cab Haulage');
      const x = aRider(kilima.did, kilima.office);
      expect(() => controller.startSession(x.did, { vehicleId: x.bike.vehicleId } as never, x.actor)).toThrow(/Enter your PIN/);
      for (let i = 0; i < 4; i++) expect(() => controller.startSession(x.did, { vehicleId: x.bike.vehicleId, pin: '00000' } as never, x.actor)).toThrow(/That is not your PIN/);
      expect(() => controller.startSession(x.did, { vehicleId: x.bike.vehicleId, pin: '00000' } as never, x.actor)).toThrow(/Too many wrong PINs/);
      // The real owner's PIN no longer works either — the phone, verified by code, is what opens it again.
      expect(() => controller.startSession(x.did, { vehicleId: x.bike.vehicleId, pin: x.pin } as never, x.actor)).toThrow(/Too many wrong PINs/);
      expect(fleet.activeForDriver(x.did)).toBeUndefined();

      const y = aRider(kilima.did, kilima.office, '24689');
      expect((controller.startSession(y.did, { vehicleId: y.bike.vehicleId, pin: '24689' } as never, y.actor) as { status: string }).status).toBe('active');
      // Staff standing in name no PIN — they are not the driver, and are audited as staff.
      const z = aRider(kilima.did, kilima.office, '35792');
      expect((controller.startSession(z.did, { vehicleId: z.bike.vehicleId } as never, { active: true, role: 'operator' } as never) as { status: string }).status).toBe('active');
    });

    it('a colleague cannot start a shift for X, or answer X’s offer, from their own sign-in', () => {
      const kilima = aFleetOffice('Same Fleet Haulage');
      const pwani = aFleetOffice('Other Fleet Haulage');
      const x = aRider(kilima.did, kilima.office);
      const colleague = aRider(kilima.did, kilima.office, '24689');
      expect(() => controller.startSession(x.did, { vehicleId: x.bike.vehicleId, pin: colleague.pin } as never, colleague.actor)).toThrow(/Only the driver/);

      const o = controller.makeFleetOffer(pwani.did, { phone: x.phone }, pwani.office);
      expect(() => controller.acceptFleetOffer(x.did, o.offerId, colleague.actor)).toThrow(/Only the driver can say yes/);
      expect(() => controller.acceptFleetOffer(colleague.did, o.offerId, colleague.actor)).toThrow(/No such offer/);
      expect(drivers.get(x.did).managerDid).toBe(kilima.did);
    });

    it('only the driver says yes — not staff, not the fleet that offered, not the fleet they are in', () => {
      const kilima = aFleetOffice('Yes Haulage');
      const pwani = aFleetOffice('Offering Haulage');
      const x = aRider(kilima.did, kilima.office);
      const o = controller.makeFleetOffer(pwani.did, { phone: x.phone }, pwani.office);
      for (const who of [{ active: true, role: 'operator' }, pwani.office, kilima.office]) {
        expect(() => controller.acceptFleetOffer(x.did, o.offerId, who as never)).toThrow(/Only the driver can say yes/);
      }
      // The fleet they are in does not even see that somebody wants them.
      expect(() => controller.fleetOffersForDriver(x.did, kilima.office)).toThrow(/Only the driver/);

      const yes = controller.acceptFleetOffer(x.did, o.offerId, x.actor);
      expect(yes.companyName).toBe('Offering Haulage');
      expect(auth.introspect(yes.token!.access_token)).toMatchObject({ active: true, role: 'driver', did: x.did, tenant: pwani.did });
      expect(auth.introspect(x.token)).toMatchObject({ active: false, reason: 'revoked' });
    });

    it('the fleet office says WHICH VEHICLE and starts nothing — the driver starts their own shift, with their PIN', () => {
      const kilima = aFleetOffice('Which Vehicle Haulage');
      const pwani = aFleetOffice('Next Door Haulage');
      const x = aRider(kilima.did, kilima.office);
      const colleague = aRider(kilima.did, kilima.office, '24689');
      const second = vehicles.register({ plate: 'CL-SECOND', vehicleClass: 'bike', ownerName: 'Fleet', managerDid: kilima.did } as never);

      // There is no door through which the office puts a driver on shift any more.
      expect((controller as unknown as Record<string, unknown>).couple).toBeUndefined();
      const said = controller.suggestVehicle(x.did, { vehicleId: second.vehicleId }, kilima.office);
      expect(said).toMatchObject({ driverDid: x.did, plate: 'CL-SECOND' });
      expect(fleet.activeForDriver(x.did)).toBeUndefined(); // nothing started
      expect(fleet.recentVehicles(x.did)[0].vehicleId).toBe(second.vehicleId); // first on their list

      // Not a colleague's to say, not another fleet's, and never a vehicle from somewhere else.
      expect(() => controller.suggestVehicle(x.did, { vehicleId: second.vehicleId }, colleague.actor)).toThrow(/not in your fleet/);
      expect(() => controller.suggestVehicle(x.did, { vehicleId: second.vehicleId }, pwani.office)).toThrow(/not in your fleet/);
      const theirs = vehicles.register({ plate: 'CL-THEIRS', vehicleClass: 'bike', ownerName: 'Fleet', managerDid: pwani.did } as never);
      expect(() => controller.suggestVehicle(x.did, { vehicleId: theirs.vehicleId }, kilima.office)).toThrow(/not in the same fleet/);

      // The driver starts it — and only with their PIN.
      expect((controller.startSession(x.did, { vehicleId: second.vehicleId, pin: x.pin } as never, x.actor) as { status: string }).status).toBe('active');
    });

    it('only a fleet office adds drivers, and only to its own fleet — never a driver, never into somebody else’s', () => {
      const kilima = aFleetOffice('Adding Haulage');
      const pwani = aFleetOffice('Elsewhere Haulage');
      const x = aRider(kilima.did, kilima.office);
      const form = (tag: string, extra: object = {}) => ({ displayName: tag, fullName: tag, nationalId: `NID-ADD-${tag}`, mobile: `+2547118800${tag.length}${n}`, licenceClasses: ['bike'], ...extra }) as never;
      // A fleet DRIVER's token names the fleet as its tenant too — and is still not the office.
      expect(() => controller.registerDriver(form('a'), x.actor)).toThrow(/your own fleet only/);
      expect(() => controller.registerDriver(form('bb', { managerDid: pwani.did }), kilima.office)).toThrow(/your own fleet only/);
      const added = controller.registerDriver(form('ccc'), kilima.office);
      expect(drivers.get(added.did).managerDid).toBe(kilima.did);
      const byStaff = controller.registerDriver(form('dddd', { managerDid: pwani.did }), { active: true, role: 'operator' } as never);
      expect(drivers.get(byStaff.did).managerDid).toBe(pwani.did);
    });
  });

  /**
   * A PIN IS CHOSEN WITH A CONFIRMED EMAIL BEHIND IT — the user, 2026-10-01: "we need an email for account recovery
   * and safety." Asked at the door, where the PIN is first chosen, and never again once one is on record.
   */
  describe('choosing a PIN needs a recovery email, confirmed by a code', () => {
    const verifyPhone = (phone: string) => otp.verify(phone, otp.request(phone).code);
    const codeFor = (email: string) => (identity.emailRequest({ email }) as { code: string }).code;

    it('refuses a PIN with no email, and an email nobody proved they read — and spends nothing on a refusal', () => {
      const phone = '+254711660001';
      verifyPhone(phone);
      expect(() => identity.enroll({ phone, pin: '48261' })).toThrow(/Give an email address/);
      expect(() => identity.enroll({ phone, pin: '48261', email: 'not-an-address' })).toThrow(/valid email address/);
      expect(() => identity.enroll({ phone, pin: '48261', email: 'amina@example.com' })).toThrow(/Type the code we sent/);
      codeFor('amina@example.com');
      expect(() => identity.enroll({ phone, pin: '48261', email: 'amina@example.com', emailCode: '000000' })).toThrow(/Wrong or expired code/);
      // Nothing was created and the phone is still verified: the person simply tries again.
      expect(persons.findByPhone(phone)).toBeUndefined();
      expect(otp.isVerified(phone)).toBe(true);
    });

    it('takes the PIN with a confirmed email, shows it masked, and does not ask again when the PIN is forgotten', () => {
      const phone = '+254711660002';
      verifyPhone(phone);
      const code = codeFor('Juma@Example.com');
      const joined = identity.enroll({ phone, pin: '48261', email: 'Juma@Example.com', emailCode: code }) as { email?: string; hasPin: boolean; device: string };
      expect(joined).toMatchObject({ hasPin: true, email: 'j…@example.com' });
      expect(persons.findByEmail('juma@example.com')?.personDid).toBe(persons.findByPhone(phone)!.personDid);

      // Forgot the PIN, ON THE PHONE THE PIN WORKED ON: a code to the number and a new PIN. The email is not asked again.
      const start = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(start + 2 * 60 * 1000);
      try {
        verifyPhone(phone);
        const again = identity.enroll({ phone, pin: '73914', device: joined.device }) as { hasPin: boolean; device: string };
        expect(again.hasPin).toBe(true);
        expect(persons.loginWithPin(phone, '73914', again.device).person.personDid).toBe(persons.findByPhone(phone)!.personDid);
      } finally {
        clock.mockRestore();
      }
    });

    it('a PIN replaced on a phone or browser it never worked on needs the code to the recovery email as well — the account’s own', () => {
      const phone = '+254711660022';
      verifyPhone(phone);
      const joined = identity.enroll({ phone, pin: '48261', email: 'wanjiru@example.com', emailCode: codeFor('wanjiru@example.com') }) as { device: string };
      const who = persons.findByPhone(phone)!.personDid;
      const refusal = (fn: () => unknown) => {
        try {
          fn();
        } catch (e) {
          const err = e as { code?: string; params?: { field?: string; why?: string } };
          return `${err.code} ${err.params?.field ?? ''} ${err.params?.why ?? ''}`.trim();
        }
        return 'replaced';
      };
      const start = Date.now();
      const clock = jest.spyOn(Date, 'now');
      try {
        // Somebody has the code to the number — the SIM today, or the handset for a minute — and no device of this account's.
        clock.mockReturnValue(start + 2 * 60 * 1000);
        verifyPhone(phone);
        for (const device of [undefined, 'dvc_made-up']) {
          expect([device, refusal(() => identity.enroll({ phone, pin: '73914', device }))]).toEqual([device, 'FIELD_REQUIRED email pin-reset']);
        }
        // An inbox of their OWN, confirmed by its code, is an inbox — not this account's.
        const theirs = codeFor('somebody.else@example.com');
        expect(refusal(() => identity.enroll({ phone, pin: '73914', email: 'somebody.else@example.com', emailCode: theirs }))).toBe('FORBIDDEN email pin-reset');
        // The account's address, without its code, and with a wrong one.
        expect(refusal(() => identity.enroll({ phone, pin: '73914', email: 'wanjiru@example.com' }))).toBe('EMAIL_NOT_VERIFIED emailCode pin-reset');
        clock.mockReturnValue(start + 4 * 60 * 1000);
        const right = codeFor('wanjiru@example.com');
        expect(refusal(() => identity.enroll({ phone, pin: '73914', email: 'wanjiru@example.com', emailCode: right === '000000' ? '111111' : '000000' }))).not.toBe('replaced');
        // NOTHING WAS CHANGED OR SPENT by any of it: the PIN is the old one, on the old device, and the phone's code still stands.
        expect(persons.loginWithPin(phone, '48261', joined.device).person.personDid).toBe(who);
        // Both codes: the PIN is replaced, on this new device and on no other.
        const replaced = identity.enroll({ phone, pin: '73914', email: 'Wanjiru@Example.com', emailCode: right }) as { device: string; hasPin: boolean };
        expect(replaced.hasPin).toBe(true);
        expect(persons.loginWithPin(phone, '73914', replaced.device).person.personDid).toBe(who);
        expect(() => persons.loginWithPin(phone, '73914', joined.device)).toThrow(/has not signed in to this account before/);
      } finally {
        clock.mockRestore();
      }
    });

    it('refuses an address another account already holds, before anything is created', () => {
      const first = '+254711660003';
      verifyPhone(first);
      identity.enroll({ phone: first, pin: '48261', email: 'shared@example.com', emailCode: codeFor('shared@example.com') });
      const second = '+254711660004';
      verifyPhone(second);
      expect(() => identity.enroll({ phone: second, pin: '48261', email: 'shared@example.com', emailCode: '123456' })).toThrow(/already used by another account/);
      expect(persons.findByPhone(second)).toBeUndefined();
    });

    it('lets somebody in with a code and no PIN yet — but the PIN, when it comes, still needs the email', () => {
      const phone = '+254711660005';
      verifyPhone(phone);
      const guest = identity.enroll({ phone }) as { hasPin: boolean; token: { access_token: string } };
      expect(guest.hasPin).toBe(false);
      expect(() => identity.setPin({ pin: '48261' }, auth.introspect(guest.token.access_token) as never)).toThrow(/Add your email address first/);
    });
  });

  /**
   * WHO IS CALLING. Twenty-four routes changed something and never asked: no role was written on them, so any valid
   * sign-in passed the door, and inside they took no identity at all — the hub, the driver, the fleet, the offer
   * was whatever the request named. (The door's own half — which roles each admits — is in who-is-calling.spec.ts.)
   */
  describe('the routes that changed something without asking who was calling', () => {
    const as = (role: string, did?: string, tenant?: string) => ({ active: true, role, ...(did ? { did } : {}), ...(tenant ? { tenant } : {}), scopes: role === 'operator' ? ['*'] : [] }) as never;
    const staff = as('operator');
    const at = { lat: -1.2, lng: 36.8 };

    it('an offer is its own driver’s to take or leave, and a load on a van is advanced by whoever is signed in — never by a name in the request', () => {
      const d = coupleTipper('who1', { min: 0.8, max: 1.5 });
      const other = coupleTipper('who2', { min: 0.8, max: 1.5 });
      const f = dispatch.registerFreight({ description: 'Cement 5t', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', weightKg: 5000, packaging: 'loose' });
      const [offer] = dispatch.suggest(d.did, { from: at, to: { lat: -1.25, lng: 36.85 } });

      // Somebody else, signed in as themselves: knowing the offer's id is not being the driver it was made to.
      for (const who of [asDriver(other.did), as('agent', 'did:glos:a-shop'), as('driver')]) {
        expect(() => controller.claimOffer(offer.offerId, who)).toThrow('Only the driver can do this, from their own sign-in');
        expect(() => controller.ignoreOffer(offer.offerId, who)).toThrow('Only the driver can do this, from their own sign-in');
      }
      expect(dispatch.remainingCapacity(d.did)).toBe(20_000);
      controller.claimOffer(offer.offerId, asDriver(d.did));
      expect(dispatch.remainingCapacity(d.did)).toBe(15_000);

      // The other driver NAMES the one who claimed it, as the request always let them. They are still who they signed in as.
      const load = { driverDid: d.did, confirmed: requiredLoadKeys(f), securementPhotoId: 'med_test' };
      expect(() => controller.freightPickup(f.freightId, load as never, asDriver(other.did))).toThrow('This freight was claimed by another driver');
      expect(dispatch.requireFreightPublic(f.freightId).status).toBe('claimed');
      // The driver themselves — even with somebody else's name in the request: it is theirs, and they are themselves.
      expect((controller.freightPickup(f.freightId, { ...load, driverDid: other.did } as never, asDriver(d.did)) as { status: string }).status).toBe('in_transit');

      const failed = { driverDid: d.did, outcome: 'absent', note: 'Gate locked' };
      expect(() => controller.freightDeliveryFailed(f.freightId, failed as never, asDriver(other.did))).toThrow('This freight was claimed by another driver');
      expect(() => controller.freightTemp(f.freightId, { celsius: 4, driverDid: d.did } as never, asDriver(other.did))).toThrow('This freight was claimed by another driver');
      const unload = { driverDid: d.did, confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: 'med_pod' };
      expect(() => controller.freightDeliver(f.freightId, unload as never, asDriver(other.did))).toThrow('This freight was claimed by another driver');
      expect(dispatch.requireFreightPublic(f.freightId)).toMatchObject({ status: 'in_transit' });
      expect(dispatch.requireFreightPublic(f.freightId).deliveryAttempts ?? []).toEqual([]);

      // Network staff standing in NAME the driver; with nobody named there is nobody to stand in for.
      expect(() => controller.freightDeliver(f.freightId, { ...unload, driverDid: undefined } as never, staff)).toThrow('Operator must specify the subject id');
      expect((controller.freightDeliver(f.freightId, unload as never, staff) as { status: string }).status).toBe('delivered');
    });

    it('a hub’s price, its bags and what is dropped and sorted at it are the hub’s own to change', () => {
      const hub = mdps.register({ name: 'Who Hub', zones: ['WhoZone'], location: at });
      const elsewhere = mdps.register({ name: 'Another Hub', zones: ['WhoElse'], location: at });
      const own = as('mdp', hub.did);
      // Another hub, a shop, and a hub's role with no hub behind it.
      for (const who of [as('mdp', elsewhere.did), as('agent', 'did:glos:a-shop'), as('mdp')]) {
        expect(() => controller.setMdpPrice(hub.mdpId, { price: 99 } as never, who)).toThrow('Only the hub can do this, from its own sign-in');
        expect(() => controller.registerTote(hub.mdpId, who)).toThrow('Only the hub can do this, from its own sign-in');
        expect(() => controller.dropBag(hub.mdpId, { code: 'BAG-X' } as never, who)).toThrow('Only the hub can do this, from its own sign-in');
        expect(() => controller.sortParcel(hub.mdpId, { parcelId: 'p-x' } as never, who)).toThrow('Only the hub can do this, from its own sign-in');
      }
      expect(mdps.require(hub.mdpId).pricePerParcel).not.toBe(99);
      // A hub nobody registered is nobody's: said as that, before anything else.
      expect(() => controller.setMdpPrice('mdp_nobody', { price: 1 } as never, own)).toThrow(/not found|No such|Unknown/i);

      expect((controller.setMdpPrice(hub.mdpId, { price: 7 } as never, own) as { pricePerParcel: number }).pricePerParcel).toBe(7);
      expect((controller.registerTote(hub.mdpId, own) as { code: string }).code).toBeTruthy();
      // Network staff stand in for a hub.
      expect((controller.setMdpPrice(hub.mdpId, { price: 8 } as never, staff) as { pricePerParcel: number }).pricePerParcel).toBe(8);
    });

    it('a vehicle goes into the fleet of the office that registers it, whatever fleet the request names', () => {
      const aFleet = (tag: string) =>
        managers.register({ companyName: `Who Fleet ${tag}`, contactPhone: `+2547008800${tag.charCodeAt(0)}`, ownerFullName: `${tag} Owner`, ownerNationalId: `WHO-${tag}`, location: at, requirements: { businessRegistrationNo: `BRN-${tag}`, transportOperatorLicence: `TOL-${tag}`, taxId: `TAX-${tag}` } });
      const [fleetA, fleetB] = [aFleet('A'), aFleet('B')];
      for (const m of [fleetA, fleetB]) {
        managers.submitKyc(m.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'a' });
        managers.decideKyc(m.did, true);
        managers.recordBond(m.did);
      }
      const officeA = as('fleet_manager', fleetA.did, fleetA.did);
      // The office of A, naming B: the vehicle is A's.
      const van = controller.registerVehicle({ plate: 'WHO-1', vehicleClass: 'van', ownerName: 'A', managerDid: fleetB.did } as never, officeA) as { managerDid?: string; vehicleId: string };
      expect(van.managerDid).toBe(fleetA.did);
      expect(vehicles.list().filter((v) => v.managerDid === fleetB.did)).toEqual([]);
      // A sign-in with the office's role and no fleet behind it registers nothing.
      expect(() => controller.registerVehicle({ plate: 'WHO-2', vehicleClass: 'van', ownerName: 'X' } as never, as('fleet_manager'))).toThrow('A vehicle is registered by its fleet’s office');
      // Network staff name the fleet — or none, for a courier who answers to no fleet.
      expect((controller.registerVehicle({ plate: 'WHO-3', vehicleClass: 'van', ownerName: 'B', managerDid: fleetB.did } as never, staff) as { managerDid?: string }).managerDid).toBe(fleetB.did);
      expect((controller.registerVehicle({ plate: 'WHO-4', vehicleClass: 'bike', ownerName: 'Solo' } as never, staff) as { managerDid?: string }).managerDid).toBeUndefined();
    });

    it('a store’s checkout is filed by that store, and a parcel’s rating by a shop that handled it', () => {
      const store = vendors.register({ name: 'Who Store', contactEmail: 'who-store@sbg.test' } as never);
      const stranger = as('genesis', 'did:glos:another-store');
      expect(() => controller.captureCheckout(store.vendorId, { destPudoDid: 'did:glos:a-shop', buyerMobile: '+254700111222' } as never, stranger)).toThrow('This store is not yours to change');
      expect(() => controller.captureCheckout('ven_nobody', {} as never, staff)).toThrow();

      // A rating: recorded at the counter of a shop the parcel passed through — not by any shop that knows its number.
      const shop = onboardAgent('Who Rated Shop', 'NorthTown', 50);
      const elsewhere = onboardAgent('Who Other Shop', 'NorthTown', 50);
      const corridor = corridors.addCorridor({ name: 'Who N-S', originZone: 'NorthTown', destZone: 'SouthTown' });
      const bus = corridors.addDriver({ driverDid: 'did:glos:who-bus', name: 'D', corridorId: corridor.corridorId });
      parcels.accept({ agentDid: shop.did, parcelId: 'QR-WHO', size: 'M', destZone: 'SouthTown', senderMobile: '+254700111001', receiverMobile: '+254700111002', dropoffPhotoRef: 'r.jpg' });
      parcels.handover({ agentDid: shop.did, driverBadgeId: bus.badgeId, parcelIds: ['QR-WHO'] });
      const stars = { stars: 1, raterMobile: '+254700111002' };
      // Still on its way, it has no second shop yet: a sign-in with no shop behind it is not "the shop it has not reached".
      expect(parcels.get('QR-WHO').destAgentDid).toBeUndefined();
      expect(() => controller.rate('QR-WHO', stars as never, as('agent'))).toThrow('A rating is recorded by a shop that handled this parcel');
      parcels.arrive('QR-WHO', shop.did);
      parcels.pickup('QR-WHO', shop.did, releaseCodeOf('QR-WHO'));
      // Another shop, a shop's role with no shop behind it, and the driver who carried it.
      for (const who of [as('agent', elsewhere.did), as('agent'), as('driver', 'did:glos:who-bus')]) {
        expect(() => controller.rate('QR-WHO', stars as never, who)).toThrow('A rating is recorded by a shop that handled this parcel');
      }
      expect(core.get(shop.did)?.reputationScore).not.toBe(1);
      expect((controller.rate('QR-WHO', { ...stars, stars: 5 } as never, as('agent', shop.did)) as { agentComposite: number }).agentComposite).toBe(5);
      // A parcel nobody made is nobody's to rate, staff included.
      expect(() => controller.rate('QR-NOBODY-MADE', stars as never, staff)).toThrow();
    });
  });

  /**
   * A PARCEL RELEASED ON THE SENDER'S CODE. Found 2026-10-11 by walking a new installation's first day
   * (test/first-day-from-zero.e2e-spec.ts): the release asked only for the code. Not WHICH shop was asking — so any
   * shop that knew a parcel's number could burn its five tries and lock it — and it paid the shop that handed the
   * parcel over nothing for doing so: that half of its pay was paid only where an order is collected by its QR.
   */
  describe('a parcel released on the sender’s code', () => {
    const onItsShelf = (id: string) => {
      const origin = onboardAgent(`${id} Origin`, 'NorthTown', 50);
      const dest = onboardAgent(`${id} Dest`, 'SouthTown', 50);
      const corridor = corridors.addCorridor({ name: `${id} N-S`, originZone: 'NorthTown', destZone: 'SouthTown' });
      const bus = corridors.addDriver({ driverDid: `did:glos:${id}-bus`, name: 'D', corridorId: corridor.corridorId });
      parcels.accept({ agentDid: origin.did, parcelId: id, size: 'M', destZone: 'SouthTown', senderMobile: '+254700111001', receiverMobile: '+254700111002', dropoffPhotoRef: 'r.jpg' });
      parcels.handover({ agentDid: origin.did, driverBadgeId: bus.badgeId, parcelIds: [id] });
      return { origin, dest };
    };

    it('is released by the shop that holds it: another shop cannot try a code against it, right or wrong', () => {
      const { origin, dest } = onItsShelf('QR-REL-1');
      parcels.arrive('QR-REL-1', dest.did);
      const code = releaseCodeOf('QR-REL-1');
      const wrong = code === '0000' ? '1111' : '0000';
      // More tries than would lock it, from the shop it came from and from a shop that never saw it.
      for (const elsewhere of [origin.did, 'did:glos:some-other-shop']) {
        for (let i = 0; i < OTP_MAX_ATTEMPTS + 1; i++) expect(() => parcels.pickup('QR-REL-1', elsewhere, wrong)).toThrow('This parcel is on another shop’s shelf');
        expect(() => parcels.pickup('QR-REL-1', elsewhere, code)).toThrow('This parcel is on another shop’s shelf');
      }
      expect(parcels.get('QR-REL-1')).toMatchObject({ status: 'Ready_For_Pickup' });
      expect(parcels.get('QR-REL-1').otpAttempts ?? 0).toBe(0);
      expect(parcels.get('QR-REL-1').otpLockedAt).toBeUndefined();
      // At its own counter a wrong code is still counted, and the right one still releases it.
      expect(() => parcels.pickup('QR-REL-1', dest.did, wrong)).toThrow('Incorrect OTP');
      expect(parcels.get('QR-REL-1').otpAttempts).toBe(1);
      expect(parcels.pickup('QR-REL-1', dest.did, code).status).toBe('Delivered');
    });

    it('pays the shop for handing it over: shelving when it lands, the rest at release — together the whole destination leg', () => {
      const { dest } = onItsShelf('QR-REL-2');
      const before = agents.balance(dest.did) ?? 0;
      const earned = () => Math.round(((agents.balance(dest.did) ?? 0) - before) * 100) / 100;
      parcels.arrive('QR-REL-2', dest.did);
      expect(earned()).toBe(SHELVING_FEE);
      // A wrong code pays nothing.
      const code = releaseCodeOf('QR-REL-2');
      expect(() => parcels.pickup('QR-REL-2', dest.did, code === '0000' ? '1111' : '0000')).toThrow('Incorrect OTP');
      expect(earned()).toBe(SHELVING_FEE);
      parcels.pickup('QR-REL-2', dest.did, code);
      expect(earned()).toBe(PICKUP_FEE);
      expect(Math.round((SHELVING_FEE + RELEASE_FEE) * 100) / 100).toBe(PICKUP_FEE);
    });
  });

  /**
   * THE READS THAT ASKED NOBODY WHO WAS CALLING. Twenty-two reads took no identity: whatever they returned went to any
   * sign-in. Most return what is nobody's in particular. Five returned somebody's own: every shop's float and papers,
   * every hub's number, every bag on the network, any store's record by its id, and every driver's shift and position.
   */
  describe('the reads that asked nobody who was calling', () => {
    const as = (role: string, did?: string, tenant?: string) => ({ active: true, role, ...(did ? { did } : {}), ...(tenant ? { tenant } : {}), scopes: role === 'operator' ? ['*'] : [] }) as never;
    const staff = as('operator');
    const at = { lat: -1.2, lng: 36.8 };
    type Row = Record<string, unknown>;

    it('every shop: staff read the whole record; anybody else is handed the card the public map shows', () => {
      const shop = onboardAgent('Read Shop', 'NorthTown', 50);
      const full = (controller.listAgents(staff) as Row[]).find((a) => a.did === shop.did)!;
      expect(full).toMatchObject({ balance: agents.balance(shop.did), deviceImei: shop.deviceImei, vaultRef: shop.vaultRef, status: 'ACTIVE' });
      expect(full.balance).toBeGreaterThan(0);

      const onTheMap = (controller.networkPoints() as Row[]).find((p) => p.did === shop.did)!;
      // A driver (whose app asks here for the places it can route toward), another shop, a store, a shopper — and the shop itself.
      for (const who of [as('driver', 'did:glos:a-driver'), as('agent', 'did:glos:another-shop'), as('genesis', 'did:glos:a-store'), as('consumer'), as('agent', shop.did)]) {
        const card = (controller.listAgents(who) as Row[]).find((a) => a.did === shop.did)!;
        expect(card).toMatchObject({ did: shop.did, shopName: 'Read Shop', location: shop.location });
        expect(card).toEqual(onTheMap);
        for (const kept of ['balance', 'currency', 'deviceImei', 'vaultRef', 'kyc', 'requirements', 'equipmentDepositPaid', 'capacity', 'status', 'lastPingAt']) expect(card).not.toHaveProperty(kept);
      }
    });

    it('every hub: where it is and what it charges for anybody; its number and its bags for the hub itself and for staff', () => {
      const hub = mdps.register({ name: 'Read Hub', zones: ['ReadZone'], location: at, contactPhone: '+254700999001', address: 'Depot Road 1' });
      const other = mdps.register({ name: 'Other Read Hub', zones: ['ReadElse'], location: at, contactPhone: '+254700999002' });
      mdps.registerTote(hub.mdpId);
      const row = (who: never) => (controller.listMdps(who) as Row[]).find((m) => m.mdpId === hub.mdpId)!;
      for (const who of [staff, as('mdp', hub.did)]) expect(row(who)).toMatchObject({ contactPhone: '+254700999001', totes: 1, entityId: hub.entityId });
      // Another hub, a driver, a hub's role with no hub behind it, a shopper.
      for (const who of [as('mdp', other.did), as('driver', 'did:glos:a-driver'), as('mdp'), as('consumer')]) {
        expect(row(who)).toEqual({ mdpId: hub.mdpId, did: hub.did, name: 'Read Hub', country: hub.country, zones: ['ReadZone'], location: at, address: 'Depot Road 1', pricePerParcel: hub.pricePerParcel, currency: 'KES' });
        for (const kept of ['contactPhone', 'totes', 'entityId']) expect(row(who)).not.toHaveProperty(kept);
      }
    });

    it('a hub’s sort fee is said in its company’s money, and set beside the hubs in that money only', () => {
      // A circle drawn near a border reaches a hub of another company: a median of shillings and birr is a number about
      // nothing. The fee is public, and so is the money it is in — without it the figure says nothing.
      const home = mdps.register({ name: 'Nairobi Fee Hub', zones: ['FeeZone'], location: at });
      const ets = [mdps.register({ name: 'Addis Fee Hub A', zones: ['FeeAddisA'], location: at, country: 'ET' } as never), mdps.register({ name: 'Addis Fee Hub B', zones: ['FeeAddisB'], location: at, country: 'ET' } as never)];
      mdps.setPrice(home.mdpId, 0.4);
      ets.forEach((h, i) => mdps.setPrice(h.mdpId, 20 + i * 5));
      const listed = (who: never, id: string) => (controller.listMdps(who) as Row[]).find((m) => m.mdpId === id)!;
      expect(listed(as('consumer'), ets[0].mdpId).currency).toBe('ETB');
      expect(listed(as('mdp', ets[0].did), ets[0].mdpId).currency).toBe('ETB');
      expect(listed(staff, home.mdpId).currency).toBe('KES');
      type Rates = { currency?: string; benchmark: { count: number; min: number; max: number }; pins: Array<{ id: string }> };
      const ratesFor = (who: never) => controller.pricingNear(who, 'mdp') as Rates;
      const inBirr = ratesFor(as('mdp', ets[0].did));
      expect(inBirr.currency).toBe('ETB');
      expect(inBirr.pins.map((p) => p.id).sort()).toEqual(ets.map((h) => h.mdpId).sort());
      expect(inBirr.benchmark).toMatchObject({ count: 2, min: 20, max: 25 });
      const inShillings = ratesFor(as('mdp', home.did));
      expect(inShillings.currency).toBe('KES');
      expect(inShillings.pins.map((p) => p.id)).toContain(home.mdpId);
      expect(inShillings.pins.map((p) => p.id)).not.toContain(ets[0].mdpId);
      expect(inShillings.benchmark.max).toBeLessThan(20);
      // A hub’s sign-in with no hub behind it is compared with nobody.
      expect(ratesFor(as('mdp', 'did:glos:no-such-hub'))).toMatchObject({ benchmark: { count: 0 }, pins: [] });
      expect(ratesFor(as('mdp', 'did:glos:no-such-hub')).currency).toBeUndefined();
    });

    it('the bags standing at a hub are read by that hub; the whole pool by staff', () => {
      const hub = mdps.register({ name: 'Bag Hub', zones: ['BagZone'], location: at });
      const other = mdps.register({ name: 'Other Bag Hub', zones: ['BagElse'], location: at });
      const bag = mdps.registerTote(hub.mdpId);
      const codes = (list: unknown) => (list as Array<{ code: string }>).map((t) => t.code);
      expect(codes(controller.listTotes(as('mdp', hub.did), hub.mdpId))).toEqual([bag.code]);
      // Another hub, and a hub's role with no hub behind it.
      for (const who of [as('mdp', other.did), as('mdp')]) expect(() => controller.listTotes(who, hub.mdpId)).toThrow('Only the hub can do this, from its own sign-in');
      // No hub named is the whole pool, and that is not a hub's to read.
      for (const none of [undefined, '']) expect(() => controller.listTotes(as('mdp', hub.did), none)).toThrow('Name your own hub: the whole bag pool is read by network staff');
      expect(codes(controller.listTotes(staff))).toContain(bag.code);
      expect(codes(controller.listTotes(staff, other.mdpId))).toEqual([]);
    });

    it('a store’s record, and the journey of a parcel it shipped, are read by that store', () => {
      const origin = onboardAgent('Read Origin', 'NorthTown', 50);
      const dest = onboardAgent('Read Dest', 'SouthTown', 50);
      corridors.addCorridor({ name: 'Read N-S', originZone: 'NorthTown', destZone: 'SouthTown' });
      const store = vendors.register({ name: 'Read Store' });
      const stranger = vendors.register({ name: 'Another Read Store' });
      vendors.topUp(store.vendorId, 50);
      const { parcel } = parcels.createInbound({ vendorId: store.vendorId, externalOrderId: 'ORD-READ', originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+254700', size: 'M', contentPhotoRef: 'c.jpg', shippingPolicy: store.shippingPolicy, quote: routing.quoteShipment(origin.did, dest.did, 'M') });
      const own = as('genesis', store.did);
      const others = [as('genesis', stranger.did), as('genesis'), as('agent', origin.did)];

      // The record carries the store's balance: its own, and staff's.
      for (const who of [own, staff]) expect(controller.getVendor(store.vendorId, who)).toMatchObject({ vendorId: store.vendorId, balance: vendors.get(store.vendorId).balance });
      expect(controller.getVendor(store.vendorId, own)).not.toHaveProperty('secret');
      for (const who of others) expect(() => controller.getVendor(store.vendorId, who)).toThrow('This store is not yours to view');

      for (const who of [own, staff]) expect(controller.parcelRoute(parcel.parcelId, who)).toMatchObject({ planned: true });
      for (const who of others) expect(() => controller.parcelRoute(parcel.parcelId, who)).toThrow('This store is not yours to view');
      // A parcel handed in at a counter was shipped by no store: there is no store whose it could be.
      parcels.accept({ agentDid: origin.did, parcelId: 'QR-READ', size: 'M', destZone: 'SouthTown', senderMobile: '+254700111001', receiverMobile: '+254700111002', dropoffPhotoRef: 'r.jpg' });
      for (const who of [own, as('genesis')]) expect(() => controller.parcelRoute('QR-READ', who)).toThrow('This parcel was not shipped by your store');
      expect(controller.parcelRoute('QR-READ', staff)).toMatchObject({ planned: false });
    });

    it('every store: staff find one in a list made for the purpose and open it — its secret, its owner’s number and its buyers stay out of both', () => {
      const origin = onboardAgent('Desk Origin', 'NorthTown', 50);
      const dest = onboardAgent('Desk Dest', 'SouthTown', 50);
      corridors.addCorridor({ name: 'Desk N-S', originZone: 'NorthTown', destZone: 'SouthTown' });
      const OWNER = '+254711222333';
      const BUYER = '+254722000111';
      const store = vendors.register({ name: 'Desk Store', callbackUrl: 'https://desk.example/hook', ownerPhone: OWNER, address: 'Biashara St 12' });
      const other = vendors.register({ name: 'Another Desk Store' });
      vendors.topUp(store.vendorId, 50);
      const { parcel } = parcels.createInbound({ vendorId: store.vendorId, externalOrderId: 'ORD-DESK', originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: BUYER, size: 'M', contentPhotoRef: 'c.jpg', shippingPolicy: store.shippingPolicy, quote: routing.quoteShipment(origin.did, dest.did, 'M') });
      // Made by the store itself: staff make nothing in a store's name.
      const key = controller.issueApiKey(store.vendorId, { kind: 'secret', mode: 'live', label: 'Shop backend' } as never, as('genesis', store.did)) as { secret: string; hint: string; keyId: string };
      const settles = vendors.settledBy(store)!;

      // THE LIST: one row a store, made of what a list is for.
      const rows = controller.listVendors();
      const row = rows.find((r) => r.vendorId === store.vendorId)!;
      expect(row).toEqual({
        vendorId: store.vendorId,
        name: 'Desk Store',
        country: store.country,
        companyName: settles.name,
        balance: vendors.balanceOrNone(store.vendorId),
        currency: settles.currency,
        hasAccount: false,
        hasCallback: true,
        hasDock: false,
        address: 'Biashara St 12',
        createdAt: store.createdAt,
      });
      expect(row.balance).toBeGreaterThan(0);
      expect(rows.find((r) => r.vendorId === other.vendorId)).toMatchObject({ name: 'Another Desk Store', hasCallback: false, balance: 0 });
      const listed = JSON.stringify(rows);
      for (const hidden of [store.secret, other.secret, OWNER, store.did]) expect(listed).not.toContain(hidden);

      // THE STORE, OPENED: what somebody answering its call reads.
      const desk = controller.storeDesk(store.vendorId);
      expect(desk).toMatchObject({ ...row, signIn: { hasAccount: false }, contact: { phoneEnding: '333' }, dock: null, returnsWaiting: 0 });
      expect(desk.shipments).toMatchObject({ total: 1, recent: [{ parcelId: parcel.parcelId, externalOrderId: 'ORD-DESK', destZone: 'SouthTown' }] });
      expect(desk.money.recent.map((m) => `${m.sign}${m.type}`)).toEqual(expect.arrayContaining(['+TOP_UP', '-BILLING']));
      expect(desk.money.recent.every((m) => m.currency === settles.currency)).toBe(true);
      expect(desk.keys).toEqual([expect.objectContaining({ keyId: key.keyId, kind: 'secret', mode: 'live', label: 'Shop backend', hint: key.hint })]);
      expect(desk.callbacks.url).toBe('https://desk.example/hook');
      expect(desk.callbacks.pending + desk.callbacks.failed + desk.callbacks.delivered).toBe(vendors.outboxFor(store.vendorId).length);
      // What the store's own routes carry for the store, and this must not: the signing secret, the key
      // that was issued, the owner's and the buyer's numbers, and whatever would release the parcel.
      const minted = parcels.get(parcel.parcelId);
      const opened = JSON.stringify(desk);
      for (const hidden of [store.secret, key.secret, OWNER, BUYER, store.did, minted.otp, minted.collectionCode, minted.trackingKey, ...vendors.outboxFor(store.vendorId).map((c) => c.signature)]) {
        if (hidden) expect(opened).not.toContain(hidden);
      }
      expect([minted.otp, minted.trackingKey].filter(Boolean).length).toBeGreaterThan(0); // the search above had something to look for

      // A store nobody registered is not an empty one.
      expect(() => controller.storeDesk('ven_nobody')).toThrow(/not found/i);
    });

    it('who is on which vehicle, and where they last were: a fleet’s office reads its own drivers’ shifts, staff read them all', () => {
      const [fleetA, fleetB] = [activateManager('Read Fleet A', 'RA1'), activateManager('Read Fleet B', 'RB1')];
      const onShift = (tag: string, managerDid?: string) => {
        const d = drivers.register({ displayName: tag, fullName: tag, nationalId: 'ID-' + tag, mobile: '+2547' + tag, licenceClasses: ['truck'], licenceNumber: 'L-' + tag, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, ...(managerDid ? { managerDid } : {}) });
        drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
        drivers.decideKyc(d.did, true);
        const v = vehicles.register({ plate: 'RD-' + tag, vehicleClass: 'truck', truckSubtype: 'tipper', capacityKg: 20_000, ownerName: 'X', baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, ...(managerDid ? { managerDid } : {}) });
        fleet.couple(d.did, v.vehicleId);
        fleet.reportLocation(d.did, at);
        return d;
      };
      const [a1, b1, solo] = [onShift('rda1', fleetA.did), onShift('rdb1', fleetB.did), onShift('rdsolo')];
      const shifts = (who: never) => controller.listAssignments(who, 'active') as Array<{ driverDid: string; location?: unknown }>;
      const seen = (who: never) => shifts(who).map((x) => x.driverDid).sort();

      // Each office: its own drivers, with their position — and nobody else's.
      expect(shifts(as('fleet_manager', fleetA.did, fleetA.did))).toEqual([expect.objectContaining({ driverDid: a1.did, location: at })]);
      expect(seen(as('fleet_manager', fleetB.did, fleetB.did))).toEqual([b1.did]);
      // Staff: every shift, the courier's who answers to no fleet included.
      expect(seen(staff)).toEqual([a1.did, b1.did, solo.did].sort());
      // An office's role with no fleet behind it is not "every fleet".
      expect(() => controller.listAssignments(as('fleet_manager'), 'active')).toThrow('The shift list belongs to a fleet office and the network');
    });
  });

  /**
   * THE LAST ROUTES WITH NOTHING WRITTEN ON THE DOOR. Fifty-seven, each read on its own. Five answered more than the
   * caller's: the fleet dashboard (no fleet behind the sign-in read as "every fleet"), a fleet's whole record and its
   * vehicles' (a driver's token names the fleet too), the freight board (judged against whichever driver the request
   * named), and the parcel list (whichever shop the request named, or all of them).
   */
  describe('the last routes with nothing written on the door', () => {
    const as = (role: string, did?: string, tenant?: string) => ({ active: true, role, ...(did ? { did } : {}), ...(tenant ? { tenant } : {}), scopes: role === 'operator' ? ['*'] : [] }) as never;
    const staff = as('operator');
    const at = { lat: -1.2, lng: 36.8 };
    type Row = Record<string, unknown>;
    const onShift = (tag: string, managerDid?: string) => {
      const d = drivers.register({ displayName: tag, fullName: tag, nationalId: 'ID-' + tag, mobile: '+2547' + tag, licenceClasses: ['truck'], licenceNumber: 'L-' + tag, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, ...(managerDid ? { managerDid } : {}) });
      drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
      drivers.decideKyc(d.did, true);
      const v = vehicles.register({ plate: 'LD-' + tag, vehicleClass: 'truck', truckSubtype: 'tipper', capacityKg: 20_000, ownerName: 'X', baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, ...(managerDid ? { managerDid } : {}) });
      fleet.couple(d.did, v.vehicleId);
      fleet.reportLocation(d.did, at);
      return d;
    };

    it('the fleet dashboard: an office reads its own fleet, and a sign-in with no fleet behind it is not “every fleet”', () => {
      const [fleetA, fleetB] = [activateManager('Dash Fleet A', 'DA1'), activateManager('Dash Fleet B', 'DB1')];
      const [a1, b1] = [onShift('dsa1', fleetA.did), onShift('dsb1', fleetB.did)];
      const view = (who: never, manager?: string) => controller.fleetDashboard(who, manager) as { managerDid: string | null; sessions: { list: Array<{ driverDid: string }> } };
      const onDuty = (who: never, manager?: string) => view(who, manager).sessions.list.map((x) => x.driverDid).sort();
      const officeA = as('fleet_manager', fleetA.did, fleetA.did);

      expect(onDuty(officeA)).toEqual([a1.did]);
      // An office naming another fleet in the request is still its own office.
      expect(view(officeA, fleetB.did).managerDid).toBe(fleetA.did);
      expect(onDuty(officeA, fleetB.did)).toEqual([a1.did]);
      // A shop, a courier on their own, an office's role with no fleet behind it — and a driver OF that fleet.
      for (const who of [as('agent', 'did:glos:a-shop'), as('driver', 'did:glos:solo'), as('fleet_manager'), as('driver', a1.did, fleetA.did)]) {
        expect(() => view(who)).toThrow('The dashboard belongs to a fleet office and the network');
        expect(() => view(who, fleetA.did)).toThrow('The dashboard belongs to a fleet office and the network');
      }
      // Staff: one fleet by name, or every fleet.
      expect(onDuty(staff, fleetB.did)).toEqual([b1.did]);
      expect(onDuty(staff)).toEqual([a1.did, b1.did].sort());
      expect(view(staff).managerDid).toBeNull();
    });

    it('a fleet’s whole record, and its vehicles’, are its office’s: a driver of that fleet gets the outside view', () => {
      const fleetA = activateManager('Rec Fleet A', 'RC1');
      const van = vehicles.register({ plate: 'REC-1', vehicleClass: 'van', ownerName: 'Rec Owner', managerDid: fleetA.did });
      const office = as('fleet_manager', fleetA.did, fleetA.did);
      const itsDriver = as('driver', 'did:glos:rec-driver', fleetA.did);
      const otherOffice = as('fleet_manager', 'did:glos:other-fleet', 'did:glos:other-fleet');
      const outsiders = [itsDriver, as('agent', 'did:glos:a-shop'), otherOffice, as('fleet_manager')];

      const INSIDE = ['loginCode', 'vaultRef', 'contactPhone', 'requirements', 'depotAddress', 'kyc'];
      const one = (who: never) => controller.getManager(fleetA.did, who) as Row;
      const listed = (who: never) => (controller.listManagers(who) as Row[]).find((m) => m.did === fleetA.did)!;
      for (const read of [one, listed]) {
        for (const who of [office, staff]) expect(read(who)).toMatchObject({ did: fleetA.did, contactPhone: fleetA.contactPhone, requirements: fleetA.requirements });
        for (const who of outsiders) {
          expect(read(who)).toMatchObject({ did: fleetA.did, companyName: 'Rec Fleet A' });
          for (const key of INSIDE) expect(read(who)).not.toHaveProperty(key);
        }
      }

      const VEHICLE_INSIDE = ['managerDid', 'documents', 'qr', 'ownerName', 'ownerType', 'vehiclePhotoRefs'];
      const single = (who: never) => controller.getVehicle(van.vehicleId, who) as Row;
      const inList = (who: never) => (controller.listVehicles(who) as Row[]).find((x) => x.vehicleId === van.vehicleId)!;
      for (const read of [single, inList]) {
        for (const who of [office, staff]) expect(read(who)).toMatchObject({ managerDid: fleetA.did, ownerName: 'Rec Owner' });
        // Another fleet's office reads it by its id like any outsider; in its LIST it is not there at all (see below).
        for (const who of outsiders.filter((x) => read === single || x !== otherOffice)) {
          expect(read(who)).toMatchObject({ vehicleId: van.vehicleId, plate: 'REC-1' });
          for (const key of VEHICLE_INSIDE) expect(read(who)).not.toHaveProperty(key);
        }
      }
      // An office's list is its own vehicles; a driver's is the open list, where this one is one of many.
      expect((controller.listVehicles(office) as Row[]).every((x) => x.managerDid === fleetA.did)).toBe(true);
      expect(controller.listVehicles(otherOffice)).toEqual([]);
    });

    it('the freight board is judged against the caller’s own vehicle, whoever the request names', () => {
      const d = coupleTipper('brd1', { min: 0.8, max: 1.5 });
      dispatch.registerFreight({ description: 'Cement 5t', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', weightKg: 5000, packaging: 'loose' });
      const q = (driverDid?: string) => ({ lat: at.lat, lng: at.lng, ...(driverDid ? { driverDid } : {}) }) as never;
      const shop = as('agent', 'did:glos:a-shop');
      const theirs = controller.freightBoard(q(), asDriver(d.did));
      expect(theirs.items).toHaveLength(1);

      // A shop names that driver: it is answered as a shop, exactly as if it had named nobody.
      const named = controller.freightBoard(q(d.did), shop);
      expect(named).toEqual(controller.freightBoard(q(), shop));
      expect(named).not.toEqual(theirs);
      // Another driver names them: answered for their own vehicle.
      const other = coupleTipper('brd2', { min: 1, max: 1 }, 99);
      expect(controller.freightBoard(q(d.did), asDriver(other.did))).toEqual(controller.freightBoard(q(), asDriver(other.did)));
      expect(controller.freightBoard(q(d.did), asDriver(other.did))).not.toEqual(theirs);
      // Staff name a driver, and read the board as that driver sees it.
      expect(controller.freightBoard(q(d.did), staff)).toEqual(theirs);
    });

    it('the parcel list: a shop’s is its own whatever shop the request names, and a hub’s is what stands at it', () => {
      const shop = onboardAgent('List Shop', 'NorthTown', 50);
      const other = onboardAgent('List Other', 'NorthTown', 50);
      const taken = { size: 'M' as const, destZone: 'SouthTown', senderMobile: '+254700111001', receiverMobile: '+254700111002', dropoffPhotoRef: 'r.jpg' };
      corridors.addCorridor({ name: 'List N-S', originZone: 'NorthTown', destZone: 'SouthTown' });
      parcels.accept({ ...taken, agentDid: shop.did, parcelId: 'QR-L1' });
      parcels.accept({ ...taken, agentDid: other.did, parcelId: 'QR-L2' });
      const rows = (who: never, agent?: string, status = '') => controller.listParcels(status, agent, who) as Row[];
      const ids = (who: never, agent?: string, status = '') => rows(who, agent, status).map((p) => p.parcelId as string).sort();
      const own = as('agent', shop.did);

      // Its own — naming the other shop, or none, changes nothing.
      for (const agent of [shop.did, other.did, '', undefined]) expect(ids(own, agent)).toEqual(['QR-L1']);
      expect(ids(own, other.did, 'At_PUDO')).toEqual(['QR-L1']);
      // …and what a shop reads carries no phone and no code.
      for (const kept of ['senderMobile', 'receiverMobile', 'otp', 'collectionCode']) expect(rows(own)[0]).not.toHaveProperty(kept);
      // Staff name a shop, or none.
      expect(ids(staff, other.did)).toEqual(['QR-L2']);
      expect(ids(staff)).toEqual(['QR-L1', 'QR-L2']);

      // A hub: what stands at it, and nothing of another hub's.
      const hub = mdps.register({ name: 'List Hub', zones: ['ListZone'], location: at });
      const elsewhere = mdps.register({ name: 'List Hub 2', zones: ['ListElse'], location: at });
      parcels.get('QR-L1').atMdpId = hub.mdpId;
      expect(ids(as('mdp', hub.did))).toEqual(['QR-L1']);
      expect(ids(as('mdp', elsewhere.did))).toEqual([]);

      // Anybody else, and a trade with nobody behind it.
      for (const who of [as('driver', 'did:glos:a-driver'), as('genesis', 'did:glos:a-store'), as('consumer'), as('agent'), as('mdp'), as('mdp', 'did:glos:not-a-hub')]) {
        expect(() => rows(who)).toThrow('The parcel list is a shop’s or a hub’s own');
      }
    });
  });

  describe('two-person rules need named people outside a sandbox', () => {
    const before = process.env.GLOS_ENV;
    afterEach(() => {
      if (before === undefined) delete process.env.GLOS_ENV;
      else process.env.GLOS_ENV = before;
    });
    const sharedKey = { active: true, role: 'operator', sub: 'glos-operator', scopes: ['*'] } as never;
    const named = { active: true, role: 'operator', sub: 'operator:opr_x', scopes: ['*'], actorName: 'Amina Otieno' } as never;

    it('refuses the shared key in production, and lets a named staff member through to the real check', () => {
      process.env.GLOS_ENV = 'production';
      expect(() => controller.declinePresence('prop_nope', { by: 'Brian', reason: 'no' } as never, sharedKey)).toThrow(/named sign-in/);
      expect(() => controller.verifyCompanyDocument('ent_nope', 'doc_nope', { by: 'Brian' } as never, sharedKey)).toThrow(/named sign-in/);
      expect(() => controller.declinePresence('prop_nope', { reason: 'no' } as never, named)).not.toThrow(/named sign-in/);
    });

    it('tells the two apart by ACCOUNT on a company’s paper: nobody verifies their own upload under another name, and a namesake can', () => {
      const staffer = (id: string, name: string) => ({ active: true, role: 'operator', sub: `operator:${id}`, scopes: ['*'], actorName: name, revocationKey: `operator:${id}` }) as never;
      const [sam1, sam2] = [staffer('opr_s1', 'Sam Otieno'), staffer('opr_s2', 'Sam Otieno')];
      const company = entities.createCompany({ kind: 'sister', jurisdiction: 'zm', name: 'SeeBuyGet Zambia' }, 'Amina');
      const doc = controller.uploadCompanyDocument(company.entityId, { kind: 'certificate_of_incorporation', title: 'Certificate', dataUrl: pdfDataUrl('two-accounts') } as never, sam1);
      const listed = (as: never) => (controller.companyRecord(company.entityId, as) as unknown as { documents: Array<{ documentId: string; mine?: boolean }> }).documents.find((d) => d.documentId === doc.documentId);
      // The record says whose it is to each reader — and never which account.
      expect(listed(sam1)?.mine).toBe(true);
      expect(listed(sam2)?.mine).toBe(false);
      expect(JSON.stringify(listed(sam2))).not.toContain('opr_s1');
      // The uploader, whatever name is typed beside their sign-in.
      expect(() => controller.verifyCompanyDocument(company.entityId, doc.documentId, { by: 'Brian Kamau' } as never, sam1)).toThrow(/different person must verify/);
      // A colleague with the very same name is another person.
      expect(controller.verifyCompanyDocument(company.entityId, doc.documentId, {} as never, sam2)).toMatchObject({ status: 'verified', verifiedBy: 'Sam Otieno' });
    });

    it('still accepts a typed name on a laptop, so a demo can play both people', () => {
      delete process.env.GLOS_ENV;
      expect(() => controller.declinePresence('prop_nope', { by: 'Brian', reason: 'no' } as never, sharedKey)).not.toThrow(/named sign-in/);
    });
  });

  describe('emails that answer an account action', () => {
    const latest = (address: string, template: string) => mailOutbox.recent(address).find((m) => m.template === template);

    it('welcomes, sends the reset code, and says when the password changed', () => {
      const phone = '+254700990041';
      const email = 'mail-hub@sbg.test';
      otp.verify(phone, otp.request(phone).code);
      accounts.signup({ role: 'mdp', email, password: 'first-pass', phone, profile: { mdp: { name: 'Mail Hub', zones: ['MZ'], country: 'KE', location: { lat: -1.2, lng: 36.8 } } } });
      expect(latest(email, 'welcome')?.subject).toBe('Welcome to SeeBuyGet, Mail Hub');

      const issued = accounts.forgot(email);
      const reset = latest(email, 'password-reset');
      expect(reset?.text).toContain(issued.resetToken!);
      expect(reset?.html).toContain(issued.resetToken!);
      expect(reset?.tracking).toBe(false);

      accounts.reset(issued.resetToken!, 'second-pass');
      expect(latest(email, 'password-changed')?.text).toMatch(/I forgot my password/);
    });

    it('sends nothing for an email nobody holds', () => {
      accounts.forgot('nobody-at-all@sbg.test');
      expect(mailOutbox.recent('nobody-at-all@sbg.test')).toHaveLength(0);
    });
  });

  describe('one-time codes are handed back only in a sandbox', () => {
    const before = process.env.GLOS_ENV;
    afterEach(() => {
      if (before === undefined) delete process.env.GLOS_ENV;
      else process.env.GLOS_ENV = before;
    });

    it('echoes the phone code and the reset token on a laptop, and neither in production', async () => {
      const phone = '+254700990013';
      otp.verify(phone, otp.request(phone).code);
      accounts.signup({ role: 'mdp', email: 'forgot-prod@sbg.test', password: 'first-pass', phone, profile: { mdp: { name: 'Forgot Hub', zones: ['FZ'], country: 'KE', location: { lat: -1.2, lng: 36.8 } } } });

      delete process.env.GLOS_ENV;
      expect(await controller.phoneRequest({ phone: '+254700990011' } as never)).toHaveProperty('code');
      expect(controller.authForgot({ email: 'forgot-prod@sbg.test' } as never)).toHaveProperty('resetToken');

      process.env.GLOS_ENV = 'production';
      // The code is in no answer — and with nothing wired in to text it (as here), "sent" is not said either: that
      // was the answer once, and the code reached nobody. With a sender, it is { sent: true } and the code is in the
      // text alone: test/phone-code-sms.e2e-spec.ts asks that over the wire.
      await expect(controller.phoneRequest({ phone: '+254700990012' } as never)).rejects.toMatchObject({ code: 'SMS_NOT_SENT' });
      expect(controller.authForgot({ email: 'forgot-prod@sbg.test' } as never)).toEqual({ sent: true });
      // …and an email nobody holds gets the very same answer, so the route cannot be used to find accounts.
      expect(controller.authForgot({ email: 'nobody-here@sbg.test' } as never)).toEqual({ sent: true });
    });
  });

  it('S34: a bulletin freight with no shipper stays unpaid at claim but still pays the driver on delivery', () => {
    const d = drivers.register({ displayName: 'BL', fullName: 'B', nationalId: 'ID-BL', mobile: '+254770888', licenceClasses: ['truck'], licenceNumber: 'L-BL', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: 'BL-1', vehicleClass: 'truck', truckSubtype: 'tipper', capacityKg: 10_000, ownerName: 'X', baseFee: 8, pricePerKm: 0.4 });
    fleet.couple(d.did, truck.vehicleId);
    const pickup = { lat: -1.2, lng: 36.8 };
    const f = dispatch.registerFreight({ description: 'Sand 5t', pickupLocation: pickup, pickupLabel: 'Quarry', destLabel: 'Site', destLocation: pickup, weightKg: 5000, packaging: 'loose' }); // no shipperDid

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
    dispatch.deliverFreight(freight.freightId, did, { confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: 'med_pod' });

  /** A driver's own sign-in — what the driver app calls their own routes with. */
  const asDriver = (did: string) => ({ active: true, role: 'driver', did }) as never;
  const coupleTipper = (tag: string, bounds: { min: number; max: number }, baseFee = 10) => {
    const d = drivers.register({ displayName: tag, fullName: tag, nationalId: 'ID-' + tag, mobile: '+2547' + tag, licenceClasses: ['truck'], licenceNumber: 'L-' + tag, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: 'MK-' + tag, vehicleClass: 'truck', truckSubtype: 'tipper', capacityKg: 20_000, ownerName: 'X', baseFee, pricePerKm: 0.5, minMultiplier: bounds.min, maxMultiplier: bounds.max });
    fleet.couple(d.did, v.vehicleId);
    return d;
  };

  // FB5 — a flatbed carrying its own forklift: the operator the user described, and the vehicle a BAGGED load
  // actually needs. A tipper cannot take sacks (nothing lifts them); a bare flatbed cannot either.
  const coupleFlatbedWithForklift = (tag: string, bounds: { min: number; max: number }, baseFee = 10) => {
    const d = drivers.register({ displayName: tag, fullName: tag, nationalId: 'ID-' + tag, mobile: '+2547' + tag, licenceClasses: ['truck'], licenceNumber: 'L-' + tag, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: 'KA-' + tag, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 20_000, equipment: ['FLT'], ownerName: 'X', baseFee, pricePerKm: 0.5, minMultiplier: bounds.min, maxMultiplier: bounds.max });
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
    for (let i = 0; i < 5; i++) dispatch.registerFreight({ description: `Sand ${i}`, pickupLocation: pickup, pickupLabel: 'Quarry', destLabel: 'Site', destLocation: dest, weightKg: 1000, packaging: 'loose' });
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
    const f = dispatch.registerFreight({ description: 'Teff to Merkato', pickupLocation: pickup, pickupLabel: 'Coop', destLabel: 'Merkato', destLocation: dest, weightKg: 5000, packaging: 'loose', scheduledPickupAt: tomorrow }, noon);
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
    const f = dispatch.registerFreight({ description: 'Held', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: dest, weightKg: 1000, packaging: 'loose', scheduledPickupAt: new Date(t0 + 3_600_000).toISOString(), allowEarlyClaim: false }, t0);
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
    const f = dispatch.registerFreight({ description: 'Reserved', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, packaging: 'loose', shipperDid: vendor.vendorId, scheduledPickupAt: new Date(due).toISOString() }, t0);
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
    const f = dispatch.registerFreight({ description: 'Reserved', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, packaging: 'loose', shipperDid: vendor.vendorId, scheduledPickupAt: new Date(due).toISOString() }, t0);

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
    const f = dispatch.registerFreight({ description: 'Held', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, packaging: 'loose', shipperDid: vendor.vendorId, scheduledPickupAt: new Date(due).toISOString(), allowEarlyClaim: false }, t0);
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
    expect(() => dispatch.registerFreight({ description: 'Bad', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', weightKg: 1000, packaging: 'loose', scheduledPickupAt: 'not-a-date' }, t0)).toThrow();
    const past = dispatch.registerFreight({ description: 'Now', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', weightKg: 1000, packaging: 'loose', scheduledPickupAt: new Date(t0 - 3_600_000).toISOString() }, t0);
    expect(past.status).toBe('available');
    expect(past.scheduledPickupAt).toBeUndefined();
    const future = dispatch.registerFreight({ description: 'Later', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', weightKg: 1000, packaging: 'loose', scheduledPickupAt: '2026-07-25T09:00:00.000Z' }, t0);
    expect(future.scheduledPickupAt).toBe('2026-07-25T09:00:00.000Z'); // canonical UTC
  });

  it('S34b: a thin zone below the demand threshold does not surge', () => {
    const pickup = { lat: -1.35, lng: 36.95 };
    for (let i = 0; i < 2; i++) dispatch.registerFreight({ description: `L${i}`, pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: { lat: -1.36, lng: 36.96 }, weightKg: 1000, packaging: 'loose' });
    const noon = new Date('2026-07-22T11:00:00').getTime();
    const cells = marketPulse.recompute(noon);
    expect(cells.find((c) => c.demand === 2)?.organicFactor).toBe(1); // 2 < MARKET_MIN_DEMAND (3) → neutral
    expect(marketStore.factorFor(pickup, noon)).toBe(1);
  });

  it('S34b: an operator surge rule overrides organic pricing, clamped to the band + the corridor', () => {
    const pickup = { lat: -1.5, lng: 36.6 };
    const dest = { lat: -1.52, lng: 36.62 };
    dispatch.registerFreight({ description: 'One load', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: dest, weightKg: 1000, packaging: 'loose' });
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
    dispatch.registerFreight({ description: 'L', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: { lat: -1.62, lng: 36.52 }, weightKg: 1000, packaging: 'loose' });
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
    for (let i = 0; i < 4; i++) dispatch.registerFreight({ description: `F${i}`, pickupLocation: pickup, pickupLabel: 'Q', destLabel: 'S', destLocation: { lat: -1.22, lng: 36.82 }, weightKg: 1000, packaging: 'loose' });
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
    const f = dispatch.registerFreight({ description: 'Cargo', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, packaging: 'loose', maxSpend: 10 });
    expect(f.maxSpend).toBe(10);
    const pricey = coupleTipper('EXP', { min: 0.8, max: 1.5 }, 10); // charge 10.2 > 10 → over budget
    expect(dispatch.suggest(pricey.did, { from: pickup, to: pickup }, noon).map((o) => o.ref)).not.toContain(f.freightId);
    const cheap = coupleTipper('CHP', { min: 0.8, max: 1.5 }, 5); // charge 5.1 ≤ 10 → offered
    expect(dispatch.suggest(cheap.did, { from: pickup, to: pickup }, noon).map((o) => o.ref)).toContain(f.freightId);
  });

  it('S34c: claim refuses an over-budget freight (re-coupled to a pricier vehicle) and leaves it available', () => {
    const pickup = { lat: -1.71, lng: 36.41 };
    const noon = new Date('2026-07-22T11:00:00Z').getTime();
    const f = dispatch.registerFreight({ description: 'Cargo', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, packaging: 'loose', maxSpend: 6 });
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
    const f = dispatch.registerFreight({ description: 'Cargo', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, packaging: 'loose' });
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
    const base = { description: 'C', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, packaging: 'loose' } as const;
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
    const f = dispatch.registerFreight({ description: 'Pallets', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, packaging: 'loose' });
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
    const f = dispatch.registerFreight({ description: 'Pallets', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, packaging: 'loose' });
    claimFreight(d.did, pickup, f.freightId);
    pickupOk(f, d.did);
    expect(() => dispatch.deliverFreight(f.freightId, d.did)).toThrow(/checklist/i);
    const done = dispatch.deliverFreight(f.freightId, d.did, { confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: 'med_pod' });
    expect(done.status).toBe('delivered');
    expect(done.unloadReport?.confirmed).toEqual(expect.arrayContaining(requiredUnloadKeys()));
    expect(done.driverPaid).toBe(true); // the S34 payout still fires after the gate
  });

  it('S33: a claimed freight carries its cargo model + the exact checklists to the driver', () => {
    const pickup = { lat: -1.82, lng: 36.32 };
    const d = coupleTipper('CL', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, packaging: 'loose' });
    claimFreight(d.did, pickup, f.freightId);
    const claim = dispatch.claimsFor(d.did).find((c) => c.ref === f.freightId)!;
    expect(claim.cargoClass).toBe('P4'); // 200 kg
    expect((claim.loadChecklist ?? []).map((i) => i.key)).toContain('contained'); // the bulk item
    expect(claim.unloadChecklist).toHaveLength(4);
  });

  it('S33: the securement photo is linked to the freight at pickup and its retention clock anchored at delivery', () => {
    const pickup = { lat: -1.83, lng: 36.33 };
    const d = coupleTipper('MD', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, packaging: 'loose' });
    claimFreight(d.did, pickup, f.freightId);
    const adoptSpy = jest.spyOn(media, 'adopt');
    const anchorSpy = jest.spyOn(media, 'anchorFreightTerminal');
    dispatch.pickupFreight(f.freightId, d.did, { confirmed: requiredLoadKeys(f), securementPhotoId: 'med_real' });
    expect(adoptSpy).toHaveBeenCalledWith('med_real', d.did, { type: 'freight', id: f.freightId }, 'securement');
    dispatch.deliverFreight(f.freightId, d.did, { confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: 'med_pod' });
    expect(anchorSpy).toHaveBeenCalledWith(f.freightId);
    adoptSpy.mockRestore();
    anchorSpy.mockRestore();
  });

  it('S33: a securement id the driver does NOT own is never laundered onto the freight (S29 guard)', () => {
    const pickup = { lat: -1.84, lng: 36.34 };
    const d = coupleTipper('LN', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, packaging: 'loose' });
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

  // --- FP3: proof of delivery, the carrier's reservations, and the sender withdrawing a load ---

  it('FP3: delivery needs the receiver’s name and a photo of the goods; both land on the freight as the proof of delivery', () => {
    const pickup = { lat: -1.86, lng: 36.36 };
    const d = coupleTipper('POD', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, packaging: 'loose' });
    claimFreight(d.did, pickup, f.freightId);
    dispatch.pickupFreight(f.freightId, d.did, { confirmed: requiredLoadKeys(f), securementPhotoId: 'med_sec', reservations: '  Two sacks torn at the corner  ' });
    expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)?.reservations).toMatchObject({ note: 'Two sacks torn at the corner', by: d.did });
    expect(() => dispatch.deliverFreight(f.freightId, d.did, { confirmed: requiredUnloadKeys() })).toThrow(/who received/i);
    expect(() => dispatch.deliverFreight(f.freightId, d.did, { confirmed: requiredUnloadKeys(), receiverName: 'J' })).toThrow(/who received/i);
    expect(() => dispatch.deliverFreight(f.freightId, d.did, { confirmed: requiredUnloadKeys(), receiverName: 'Joseph' })).toThrow(/photo/i);
    const adoptSpy = jest.spyOn(media, 'adopt');
    const done = dispatch.deliverFreight(f.freightId, d.did, { confirmed: requiredUnloadKeys(), receiverName: ' Joseph Mwangi ', podPhotoId: 'med_pod_1', remarks: 'One sack short' });
    expect(done.status).toBe('delivered');
    expect(done.proofOfDelivery).toMatchObject({ receiverName: 'Joseph Mwangi', photoRef: 'med_pod_1', remarks: 'One sack short', by: d.did });
    expect(adoptSpy).toHaveBeenCalledWith('med_pod_1', d.did, { type: 'freight', id: f.freightId }, 'pod');
    adoptSpy.mockRestore();
    expect(dispatch.postedBy(d.did)).toEqual([]); // the driver posted nothing — the row below is the poster's
  });

  it('FP3: the sender may withdraw a claimed load before pickup — the charge comes back, the driver is told, and the job earns nothing', () => {
    const pickup = { lat: -1.2, lng: 36.8 };
    const t0 = new Date('2026-07-22T11:00:00').getTime();
    const vendor = vendors.register({ name: 'WithdrawShipper' });
    vendors.topUp(vendor.vendorId, 500);
    const f = dispatch.registerFreight({ description: 'Reserved', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 1000, packaging: 'loose', shipperDid: vendor.vendorId, scheduledPickupAt: new Date(t0 + 24 * 3_600_000).toISOString() }, t0);
    const driver = coupleTipper('WD1', { min: 0.8, max: 1.5 });
    const before = vendors.balanceOf(vendor.vendorId);
    const [offer] = dispatch.suggest(driver.did, { from: pickup, to: pickup }, t0).filter((o) => o.ref === f.freightId);
    dispatch.claim(offer.offerId, t0);
    expect(vendors.balanceOf(vendor.vendorId)).toBeLessThan(before);
    const heard: unknown[] = [];
    events.subscribe(GlosEvent.Pudo.FreightCancelled, (e) => {
      heard.push(e.payload);
    });
    expect(() => dispatch.cancelFreight(f.freightId, { did: vendor.vendorId, role: 'shipper' }, '  ')).toThrow(/why/i);
    const done = dispatch.cancelFreight(f.freightId, { did: vendor.vendorId, role: 'shipper' }, 'Customer changed their mind', t0 + 3_600_000);
    expect(done.status).toBe('cancelled');
    expect(done.cancellation).toMatchObject({ by: vendor.vendorId, role: 'shipper', reason: 'Customer changed their mind' });
    expect(done.cancellation?.refunded).toBeGreaterThan(0);
    expect(vendors.balanceOf(vendor.vendorId)).toBeCloseTo(before, 2);
    expect(heard).toEqual([expect.objectContaining({ freightId: f.freightId, driverDid: driver.did, by: 'shipper' })]);
    // The driver's register keeps the job, but it earned nothing; their capacity is free again.
    const jobs = dispatch.driverJobsPage(driver.did, {});
    expect(jobs.items.find((j) => j.freightId === f.freightId)).toMatchObject({ status: 'cancelled', earning: undefined });
    expect(dispatch.driverJobsSummary(driver.did, {}).earned).toBe(0);
    expect(dispatch.claimsFor(driver.did).find((c) => c.ref === f.freightId)).toBeUndefined();
    // The poster's row says so, and it can never be cancelled twice.
    expect(dispatch.postedBy(vendor.vendorId).find((r) => r.freightId === f.freightId)).toMatchObject({ status: 'cancelled', canCancel: false });
    expect(() => dispatch.cancelFreight(f.freightId, { did: vendor.vendorId, role: 'shipper' }, 'again')).toThrow(/already cancelled/);
  });

  it('FP4: a lapsed insurance or inspection keeps a vehicle off the road, by name, until the paper is renewed; a lapsed licence keeps the driver off', () => {
    const d = coupleTipper('PP1', { min: 0.8, max: 1.5 });
    fleet.uncouple(d.did);
    const v = vehicles.register({ plate: 'PAPERS-1', vehicleClass: 'truck', truckSubtype: 'tipper', capacityKg: 20_000, ownerName: 'X', baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, documents: { insuranceRef: 'POL-1', insuranceExpiresAt: '2026-01-31' } });
    expect(vehicles.isUsable(v.vehicleId)).toBe(false);
    expect(vehicles.offRoadReasons(v.vehicleId)).toEqual(['Insurance lapsed 31 Jan 2026']);
    expect(() => fleet.couple(d.did, v.vehicleId)).toThrow(/PAPERS-1 is off the road: Insurance lapsed 31 Jan 2026/);
    // Renewed: the date does the work, no flag to clear.
    vehicles.updateDocuments(v.vehicleId, { insuranceExpiresAt: '2099-12-31', inspectionExpiresAt: '2025-12-31' });
    expect(() => fleet.couple(d.did, v.vehicleId)).toThrow(/Inspection certificate lapsed 31 Dec 2025/);
    vehicles.updateDocuments(v.vehicleId, { inspectionExpiresAt: '2099-06-30' });
    expect(vehicles.isUsable(v.vehicleId)).toBe(true);
    expect(vehicles.viewFor(v.vehicleId, undefined, true)).toMatchObject({ offRoad: [], papers: [expect.objectContaining({ kind: 'insurance', state: 'ok' }), expect.objectContaining({ kind: 'inspection', state: 'ok' })] });
    fleet.couple(d.did, v.vehicleId);
    fleet.uncouple(d.did);
    // A driver with a recorded expiry that has passed — any registry — cannot start.
    const lapsed = drivers.register({ displayName: 'Lapsed L.', fullName: 'Lapsed L', nationalId: 'ID-LL', mobile: '+254700000777', licenceClasses: ['bike'], licenceNumber: 'L-LL', licenceExpiresAt: '2026-02-01', criminalRecordClear: true });
    expect(lapsed.status).toBe('ACTIVE'); // light registry activates at once; the date is what stops the shift
    expect(drivers.canOperate(lapsed.did)).toBe(false);
    expect(drivers.offRoadReasons(lapsed.did)).toEqual(['Driving licence lapsed 1 Feb 2026']);
    const bike = vehicles.register({ plate: 'PAPERS-B', vehicleClass: 'bike', ownerName: 'X', pricePerKm: 0.1 });
    expect(() => fleet.couple(lapsed.did, bike.vehicleId)).toThrow(/Driver cannot start a shift: Driving licence lapsed 1 Feb 2026/);
    // The fleet office records the renewal: a past date is refused as the typo it is, a future one puts them back.
    expect(() => drivers.renewLicence(lapsed.did, { expiresAt: '2026-02-01' })).toThrow(/already passed/);
    expect(() => drivers.renewLicence(lapsed.did, { number: 'L-LL', expiresAt: '2099-01-01' })).not.toThrow();
    expect(drivers.canOperate(lapsed.did)).toBe(true);
    expect(drivers.offRoadReasons(lapsed.did)).toEqual([]);
    // A new number must still be one driver's only.
    expect(() => drivers.renewLicence(lapsed.did, { number: 'L-PP1', expiresAt: '2099-01-01' })).toThrow(/already exists/);
    fleet.couple(lapsed.did, bike.vehicleId);
    fleet.uncouple(lapsed.did);
  });

  it('FP4: a courier without a fleet sends the renewed card; staff record the date FROM it, or refuse it with a reason', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const c = drivers.register({ displayName: 'Card C.', fullName: 'Card Courier', nationalId: 'ID-CARD-1', mobile: '+254700111222', licenceClasses: ['motorcycle'], licenceNumber: 'L-CARD-1', licenceExpiresAt: '2026-02-01', criminalRecordClear: true });
    expect(drivers.canOperate(c.did)).toBe(false);
    const heard: unknown[] = [];
    events.subscribe(GlosEvent.Pudo.DriverLicenceChecked, (e) => {
      heard.push(e.payload);
    });
    const report = new PapersWatchService(managers, vehicles, drivers, fleet);
    const rowOf = () => report.networkReport().couriers.find((r) => r.did === c.did)!;

    // Somebody else's photograph cannot be sent as theirs, and a date already past is the typo it is.
    const stranger = media.upload({ ownerDid: 'did:glos:someone-else', kind: 'kyc_licence', dataUrl: PNG });
    expect(() => drivers.sendLicenceRenewal(c.did, { copyRef: stranger.mediaId, expiresAt: '2099-01-01' })).toThrow(/take it again/);
    const first = media.upload({ ownerDid: c.did, kind: 'kyc_licence', dataUrl: PNG });
    expect(() => drivers.sendLicenceRenewal(c.did, { copyRef: first.mediaId, expiresAt: '2026-01-01' })).toThrow(/already passed/);

    // Sent, it waits beside the licence and switches nothing on: the courier's reading is not the record.
    drivers.sendLicenceRenewal(c.did, { copyRef: first.mediaId, expiresAt: '2030-05-31', number: 'L-CARD-2' });
    expect(drivers.canOperate(c.did)).toBe(false);
    expect(media.get(first.mediaId)).toMatchObject({ kind: 'kyc_licence', link: { type: 'driver', id: c.did } });
    expect(rowOf()).toMatchObject({ classes: ['motorcycle'], renewal: { copyRef: first.mediaId, expiresAt: '2030-05-31', number: 'L-CARD-2' } });
    // …and it goes to the top of the list, because that courier is now waiting on us.
    expect(report.networkReport().couriers[0].did).toBe(c.did);

    // A second card replaces the first, which is deleted: it was never accepted, so nothing rests on it.
    const second = media.upload({ ownerDid: c.did, kind: 'kyc_licence', dataUrl: PNG });
    drivers.sendLicenceRenewal(c.did, { copyRef: second.mediaId, expiresAt: '2030-05-31' });
    expect(media.get(first.mediaId)).toBeUndefined();

    // Refused: the reason is the courier's to read, so it is required; the photograph goes now.
    expect(() => drivers.refuseLicenceRenewal(c.did, '  ', 'Amina Otieno')).toThrow(/say why/);
    drivers.refuseLicenceRenewal(c.did, 'The date is not readable in the photo.', 'Amina Otieno');
    expect(media.get(second.mediaId)).toBeUndefined();
    expect(rowOf().renewal).toBeUndefined();
    expect(rowOf().renewalRefusal).toMatchObject({ reason: 'The date is not readable in the photo.', by: 'Amina Otieno' });
    expect(() => drivers.refuseLicenceRenewal(c.did, 'again')).toThrow(/Nothing has been sent/);

    // Sent again and recorded: the DATE is the one staff typed, the photograph becomes the licence's own
    // copy with who read it, and the courier can drive.
    const third = media.upload({ ownerDid: c.did, kind: 'kyc_licence', dataUrl: PNG });
    drivers.sendLicenceRenewal(c.did, { copyRef: third.mediaId, expiresAt: '2030-05-31' });
    expect(rowOf().renewalRefusal).toBeUndefined(); // sending again clears the old refusal
    drivers.renewLicence(c.did, { expiresAt: '2030-05-30' }, Date.now(), 'Amina Otieno');
    expect(drivers.canOperate(c.did)).toBe(true);
    expect(rowOf().licence).toMatchObject({ expiresAt: '2030-05-30', copyRef: third.mediaId, recordedBy: 'Amina Otieno' });
    expect(rowOf().renewal).toBeUndefined();
    expect(media.get(third.mediaId)?.expiresAt).toBeUndefined(); // the current card is kept, not timed

    // A later date recorded with NO card sent never leaves the old card beside the new date; the old
    // photograph starts its clock instead of waiting for the account to close.
    drivers.renewLicence(c.did, { expiresAt: '2031-01-31' }, Date.now(), 'Brian K.');
    expect(rowOf().licence.copyRef).toBeUndefined();
    expect(rowOf().licence.recordedBy).toBe('Brian K.');
    expect(media.get(third.mediaId)?.expiresAt).toBeDefined();

    // Told each time they were waiting on an answer — and not when nobody was.
    expect(heard).toEqual([
      expect.objectContaining({ did: c.did, accepted: false, reason: 'The date is not readable in the photo.' }),
      expect.objectContaining({ did: c.did, accepted: true, expiresAt: '2030-05-30' }),
    ]);

    // A fleet driver's card is NOT on this list. It goes to their own fleet's office (the test after the
    // next), and staff's queue stays what it says it is: the people who have no office.
    const mgr = activateManager('Card Fleet', 'CF1');
    const fd = mkManagedDriver(mgr.did, 'CF1D');
    const fleetCard = media.upload({ ownerDid: fd.did, kind: 'kyc_licence', dataUrl: PNG });
    drivers.sendLicenceRenewal(fd.did, { copyRef: fleetCard.mediaId, expiresAt: '2030-05-31' });
    expect(drivers.get(fd.did).licenceRenewal).toMatchObject({ copyRef: fleetCard.mediaId });
    expect(report.networkReport().couriers.some((r) => r.did === fd.did)).toBe(false);
  });

  it('FP4: a fleet driver sends the renewed card to their OWN office — it opens the photograph, records the date from it or refuses it with a reason; no other office, no colleague', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const mgr = activateManager('Card Office', 'CO1');
    const other = activateManager('Other Office', 'CO2');
    const amos = mkManagedDriver(mgr.did, 'CO1A');
    const colleague = mkManagedDriver(mgr.did, 'CO1B');
    const office = { active: true, role: 'fleet_manager', did: mgr.did, tenant: mgr.did } as never;
    const otherOffice = { active: true, role: 'fleet_manager', did: other.did, tenant: other.did } as never;
    // Exactly what a fleet driver's sign-in mints: the fleet rides in the token as its tenant.
    const asAmos = { active: true, role: 'driver', did: amos.did, tenant: mgr.did } as never;
    const asColleague = { active: true, role: 'driver', did: colleague.did, tenant: mgr.did } as never;
    const staff = { active: true, role: 'operator', sub: 'operator:opr_x', actorName: 'Amina Otieno' } as never;
    const sentTo: unknown[] = [];
    events.subscribe(GlosEvent.Pudo.DriverLicenceSent, (e) => {
      sentTo.push(e.payload);
    });
    const checked: unknown[] = [];
    events.subscribe(GlosEvent.Pudo.DriverLicenceChecked, (e) => {
      checked.push(e.payload);
    });

    // SENT, by the driver's own sign-in and nobody else's — the office that will read it least of all.
    const card = media.upload({ ownerDid: amos.did, kind: 'kyc_licence', dataUrl: PNG });
    const dto = { copyRef: card.mediaId, expiresAt: '2031-03-31', number: 'L-NEW-1' } as never;
    expect(() => controller.sendLicenceRenewal(amos.did, dto, office)).toThrow(/Only the driver/);
    expect(() => controller.sendLicenceRenewal(amos.did, dto, asColleague)).toThrow(/Only the driver/);
    const sent = controller.sendLicenceRenewal(amos.did, dto, asAmos);
    expect(sent.licenceRenewal).toMatchObject({ copyRef: card.mediaId, expiresAt: '2031-03-31', number: 'L-NEW-1' });
    // It switches nothing on, and it names the office as its reader.
    expect(drivers.get(amos.did).licence.copyRef).toBeUndefined();
    expect(sentTo).toEqual([expect.objectContaining({ did: amos.did, managerDid: mgr.did, expiresAt: '2031-03-31' })]);
    // The office's own list carries it, which is what its Drivers tab counts.
    const listed = controller.listFleetDrivers(office) as Array<{ did: string; licenceRenewal?: { copyRef: string } }>;
    expect(listed.find((d) => d.did === amos.did)?.licenceRenewal?.copyRef).toBe(card.mediaId);
    expect((controller.listFleetDrivers(otherOffice) as Array<{ did: string }>).some((d) => d.did === amos.did)).toBe(false);

    // THE PHOTOGRAPH is opened by the office of the fleet they drive for. Not another fleet's office; not
    // a colleague, whose sign-in names the same fleet; not the driver or staff by this door (each has
    // their own); and not any other photograph of the driver's, or a colleague's card under their name.
    expect(controller.driverLicenceCard(amos.did, card.mediaId, office)).toBeInstanceOf(StreamableFile);
    for (const who of [otherOffice, asColleague, asAmos, staff, undefined as never]) {
      expect(() => controller.driverLicenceCard(amos.did, card.mediaId, who)).toThrow(/not in your fleet/);
    }
    const portrait = media.upload({ ownerDid: amos.did, kind: 'avatar', dataUrl: PNG });
    expect(() => controller.driverLicenceCard(amos.did, portrait.mediaId, office)).toThrow(/No such photograph/);
    const theirs = media.upload({ ownerDid: colleague.did, kind: 'kyc_licence', dataUrl: PNG });
    drivers.sendLicenceRenewal(colleague.did, { copyRef: theirs.mediaId, expiresAt: '2031-01-31' });
    expect(() => controller.driverLicenceCard(amos.did, theirs.mediaId, office)).toThrow(/No such photograph/);
    expect(controller.driverLicenceCard(colleague.did, theirs.mediaId, office)).toBeInstanceOf(StreamableFile);

    // REFUSED by that office, in a sentence the driver reads. The photograph goes at once.
    expect(() => controller.refuseLicenceRenewal(amos.did, { reason: 'No.' } as never, otherOffice)).toThrow(/not in your fleet/);
    expect(() => controller.refuseLicenceRenewal(amos.did, { reason: 'No.' } as never, asColleague)).toThrow(/not in your fleet/);
    expect(() => controller.refuseLicenceRenewal(amos.did, { reason: 'No.' } as never, asAmos)).toThrow(/never by the driver who sent it/);
    expect(() => controller.refuseLicenceRenewal(amos.did, { reason: '  ' } as never, office)).toThrow(/say why/);
    expect(drivers.get(amos.did).licenceRenewal).toBeDefined(); // none of those took it away
    const refused = controller.refuseLicenceRenewal(amos.did, { reason: 'The corner with the date is cut off.' } as never, office);
    expect(refused.licenceRenewal).toBeUndefined();
    expect(media.get(card.mediaId)).toBeUndefined();
    expect(() => controller.driverLicenceCard(amos.did, card.mediaId, office)).toThrow(/No such photograph/);
    expect(controller.getFleetDriver(amos.did, asAmos).licenceRenewalRefusal).toMatchObject({ reason: 'The corner with the date is cut off.' });

    // SENT AGAIN AND RECORDED by the office: the date the OFFICE typed, the photograph it read it from
    // kept as the licence's own copy — and still the office's to open, a month on.
    const second = media.upload({ ownerDid: amos.did, kind: 'kyc_licence', dataUrl: PNG });
    controller.sendLicenceRenewal(amos.did, { copyRef: second.mediaId, expiresAt: '2031-03-31' } as never, asAmos);
    expect(() => controller.renewDriverLicence(amos.did, { expiresAt: '2031-03-30' } as never, otherOffice)).toThrow(/not in your fleet/);
    const recorded = controller.renewDriverLicence(amos.did, { expiresAt: '2031-03-30' } as never, office);
    expect(recorded.licence).toMatchObject({ expiresAt: '2031-03-30', copyRef: second.mediaId, recordedBy: mgr.did });
    expect(recorded.licenceRenewal).toBeUndefined();
    expect(recorded.licenceRenewalRefusal).toBeUndefined();
    expect(controller.driverLicenceCard(amos.did, second.mediaId, office)).toBeInstanceOf(StreamableFile);
    // The driver was waiting on an answer both times, and heard both.
    expect(checked).toEqual([
      expect.objectContaining({ did: amos.did, accepted: false, reason: 'The corner with the date is cut off.' }),
      expect.objectContaining({ did: amos.did, accepted: true, expiresAt: '2031-03-30' }),
    ]);

    // WHOSE OFFICE is asked today, not when the card was sent: a driver who has moved is the new
    // fleet's to read, and the one they left opens nothing of theirs.
    drivers.get(amos.did).managerDid = other.did;
    expect(() => controller.driverLicenceCard(amos.did, second.mediaId, office)).toThrow(/not in your fleet/);
    expect(controller.driverLicenceCard(amos.did, second.mediaId, otherOffice)).toBeInstanceOf(StreamableFile);
  });

  it('FP4: only the driver sends their own card; staff refuse a courier’s, and no fleet’s office does', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const c = drivers.register({ displayName: 'Own O.', fullName: 'Own Courier', nationalId: 'ID-OWN-1', mobile: '+254700111333', licenceClasses: ['motorcycle'], criminalRecordClear: true });
    const card = media.upload({ ownerDid: c.did, kind: 'kyc_licence', dataUrl: PNG });
    const dto = { copyRef: card.mediaId, expiresAt: '2030-05-31' } as never;
    // Staff cannot send one "on their behalf": the checker would be supplying the thing checked.
    expect(() => controller.sendLicenceRenewal(c.did, dto, { active: true, role: 'operator', sub: 'operator:opr_x', actorName: 'Amina Otieno' } as never)).toThrow(/Only the driver/);
    expect(() => controller.sendLicenceRenewal(c.did, dto, { active: true, role: 'driver', did: 'did:glos:another-driver' } as never)).toThrow(/Only the driver/);
    const sent = controller.sendLicenceRenewal(c.did, dto, { active: true, role: 'driver', did: c.did } as never);
    expect(sent.licenceRenewal).toMatchObject({ copyRef: card.mediaId, expiresAt: '2030-05-31' });
    // A courier has no office: a fleet's office is nobody to them, and neither refuses nor opens their card.
    const mgr = activateManager('Nobody’s Office', 'NO1');
    const anOffice = { active: true, role: 'fleet_manager', did: mgr.did, tenant: mgr.did } as never;
    expect(() => controller.refuseLicenceRenewal(c.did, { reason: 'No.' } as never, anOffice)).toThrow(/not in your fleet/);
    expect(() => controller.driverLicenceCard(c.did, card.mediaId, anOffice)).toThrow(/not in your fleet/);
    expect(() => controller.renewDriverLicence(c.did, { expiresAt: '2030-05-31' } as never, anOffice)).toThrow(/not in your fleet/);
    // A named staff sign-in's own name is what the refusal records — not whatever the body says.
    const refused = controller.refuseLicenceRenewal(c.did, { reason: 'Not a driving licence.', by: 'Somebody Else' } as never, { active: true, role: 'operator', sub: 'operator:opr_x', actorName: 'Amina Otieno' } as never);
    expect(refused.licenceRenewalRefusal).toMatchObject({ reason: 'Not a driving licence.', by: 'Amina Otieno' });
  });

  it('FP4: staff reach a courier without a fleet through the vault — one receipted look at a time, nothing beyond name and phone', () => {
    const c = drivers.register({ displayName: 'Call C.', fullName: 'Call Courier', nationalId: 'ID-CALL-1', mobile: '+254700333444', licenceClasses: ['bike'] });
    const before = vault.getAccessLog().length;
    const staff = { active: true, role: 'operator', sub: 'operator:opr_y', actorName: 'Brian K.' } as never;
    expect(controller.courierContact(c.did, staff)).toEqual({ held: true, fullName: 'Call Courier', phone: '+254700333444' });
    const log = vault.getAccessLog();
    expect(log).toHaveLength(before + 1);
    expect(log[log.length - 1]).toMatchObject({ purpose: 'papers-renewal', requesterDid: 'operator:opr_y', vaultRef: drivers.get(c.did).vaultRef });
    // A record the vault no longer holds is an answer the screen can say, not a crash.
    const gone = drivers.register({ displayName: 'Gone G.', fullName: 'Gone Courier', nationalId: 'ID-GONE-1', mobile: '+254700333555', licenceClasses: ['bike'] });
    drivers.get(gone.did).vaultRef = 'vault_that_no_longer_exists';
    expect(controller.courierContact(gone.did, staff)).toEqual({ held: false });
    // A fleet driver is reached through the fleet the network contracts, never directly.
    const mgr = activateManager('Call Fleet', 'CF2');
    const fd = mkManagedDriver(mgr.did, 'CF2D');
    expect(() => controller.courierContact(fd.did, staff)).toThrow(/fleet office/);
  });

  it('FP4: the fleet office is a ROLE — a driver whose token names the fleet records no licence, touches no vehicle papers, and reads no colleague', () => {
    const mgr = activateManager('Office Fleet', 'OF1');
    const amos = mkManagedDriver(mgr.did, 'OF1A');
    const colleague = mkManagedDriver(mgr.did, 'OF1B');
    const office = { active: true, role: 'fleet_manager', tenant: mgr.did } as never;
    // Exactly what a fleet driver's sign-in mints: the fleet rides in the token as its tenant.
    const asAmos = { active: true, role: 'driver', did: amos.did, tenant: mgr.did } as never;
    const staff = { active: true, role: 'operator', sub: 'operator:opr_x', actorName: 'Amina Otieno' } as never;

    // His own licence on his own word — the one thing the route exists to prevent — and a colleague's.
    expect(() => controller.renewDriverLicence(amos.did, { expiresAt: '2099-12-31' } as never, asAmos)).toThrow(/never by the driver/);
    expect(() => controller.renewDriverLicence(colleague.did, { expiresAt: '2099-12-31' } as never, asAmos)).toThrow(/not in your fleet/);
    expect(controller.renewDriverLicence(amos.did, { expiresAt: '2099-12-31' } as never, office).licence.expiresAt).toBe('2099-12-31');

    // The fleet's vehicle papers, and parking it: the office, not a driver who happens to drive it.
    const v = vehicles.register({ plate: 'OFF-1', vehicleClass: 'motorcycle', ownerName: 'Office Fleet', managerDid: mgr.did });
    expect(() => controller.updateVehicleDocs(v.vehicleId, { insuranceExpiresAt: '2099-01-01' } as never, asAmos)).toThrow(/not yours/);
    expect(() => controller.groundVehicle(v.vehicleId, asAmos)).toThrow(/not yours/);
    expect(() => controller.retireVehicle(v.vehicleId, asAmos)).toThrow(/not yours/);
    expect(() => controller.updateVehicleDocs(v.vehicleId, { insuranceExpiresAt: '2099-01-01' } as never, office)).not.toThrow();

    // Reading a driver's record and shift: themselves, their office, staff — never a colleague.
    expect(controller.getFleetDriver(amos.did, asAmos).did).toBe(amos.did);
    expect(controller.getFleetDriver(amos.did, office).did).toBe(amos.did);
    expect(controller.getFleetDriver(amos.did, staff).did).toBe(amos.did);
    expect(() => controller.driverSession(amos.did, asAmos)).not.toThrow();
    for (const read of [
      () => controller.getFleetDriver(colleague.did, asAmos),
      () => controller.driverSession(colleague.did, asAmos),
      () => controller.driverClaims(colleague.did, asAmos),
      () => controller.driverHours(colleague.did, asAmos),
    ]) {
      expect(read).toThrow(/theirs, their fleet office/);
    }

    // Coupling a colleague to a vehicle, or taking them off one, is the office's too.
    expect(() => controller.uncouple(colleague.did, asAmos)).toThrow(/not in your fleet/);

    // The driver list: the office sees its own, staff see everybody — and a driver, or anyone with no fleet
    // at all, sees nothing. "No tenant" used to mean "no filter", which was every driver in the network.
    const own = drivers.register({ displayName: 'Loose L.', fullName: 'Loose Courier', nationalId: 'ID-LOOSE-OF1', mobile: '+254700777001', licenceClasses: ['bike'] });
    const asOwnCourier = { active: true, role: 'driver', did: own.did } as never;
    expect(() => controller.listFleetDrivers(asAmos)).toThrow(/fleet office and the network/);
    expect(() => controller.listFleetDrivers(asOwnCourier)).toThrow(/fleet office and the network/);
    expect(controller.listFleetDrivers(office).map((d) => d.did).sort()).toEqual([amos.did, colleague.did].sort());
    expect(controller.listFleetDrivers(staff).map((d) => d.did)).toEqual(expect.arrayContaining([amos.did, colleague.did, own.did]));
  });

  it('a route that names a participant refuses a stranger, and lets the participant and the right office through', () => {
    const mgr = activateManager('Routes Fleet', 'RT1');
    const fleetDriver = mkManagedDriver(mgr.did, 'RT1A');
    const office = { active: true, role: 'fleet_manager', tenant: mgr.did } as never;
    const asFleetDriver = { active: true, role: 'driver', did: fleetDriver.did, tenant: mgr.did } as never;
    const staff = { active: true, role: 'operator', sub: 'operator:opr_x', actorName: 'Amina Otieno' } as never;
    // Anybody who signed up with a phone number — what every one of these routes used to accept.
    const stranger = { active: true, role: 'consumer', did: 'did:glos:just-a-shopper' } as never;
    const courier = drivers.register({ displayName: 'Route R.', fullName: 'Route Courier', nationalId: 'ID-RT-1', mobile: '+254700888001', licenceClasses: ['bike'] });
    const asCourier = asDriver(courier.did);
    // Let through means the OWNER CHECK passed — a business rule may still refuse ("You are not on shift"),
    // which is a different answer from "this is not yours" and is not what this test is about.
    const DENIED = /Only the driver|Only the shop|not yours|theirs, their fleet office/;

    // A driver's own shift and work: ending it, snoozing it, their dot on the map, their floor, their area.
    const own: Array<(who: never) => unknown> = [
      (who) => controller.endSession(courier.did, who),
      (who) => controller.snoozeWork(courier.did, { minutes: 30 } as never, who),
      (who) => controller.resumeWork(courier.did, who),
      (who) => controller.pingDriver(courier.did, who),
      (who) => controller.locate(courier.did, { lat: -1.28, lng: 36.82 } as never, who),
      (who) => controller.setNudgeMinEarn(courier.did, { amount: 100 } as never, who),
      (who) => controller.declareArea(courier.did, { radiusKm: 5 } as never, who),
    ];
    for (const act of own) expect(() => act(stranger)).toThrow(/Only the driver/);
    // Not the office either: a position is a claim about the driver's own phone, the floor their own decision.
    expect(() => controller.locate(fleetDriver.did, { lat: -1.28, lng: 36.82 } as never, office)).toThrow(/Only the driver/);
    expect(() => controller.setNudgeMinEarn(fleetDriver.did, { amount: 100 } as never, office)).toThrow(/Only the driver/);
    // The driver themselves can, and staff can.
    expect(() => controller.snoozeWork(courier.did, { minutes: 30 } as never, asCourier)).not.toThrow(DENIED);
    expect(() => controller.resumeWork(courier.did, staff)).not.toThrow(DENIED);
    expect(() => controller.locate(courier.did, { lat: -1.28, lng: 36.82 } as never, asCourier)).not.toThrow(DENIED);

    // What a driver has driven, run and been offered: themselves, their office, staff.
    expect(() => controller.driverVehicles(fleetDriver.did, office)).not.toThrow(DENIED);
    expect(() => controller.driverLegs(fleetDriver.did, asFleetDriver)).not.toThrow(DENIED);
    expect(() => controller.driverOffers(courier.did, stranger)).toThrow(/theirs, their fleet office/);

    // The fleet's dispatch desk and its own papers: the office — not a driver whose token names the fleet.
    expect(() => controller.fleetDispatch(mgr.did, {} as never, asFleetDriver)).toThrow(/not yours/);
    expect(() => controller.fleetAssign(mgr.did, { freightId: 'frt_none', driverDid: fleetDriver.did } as never, asFleetDriver)).toThrow(/not yours/);
    expect(() => controller.fleetDispatch(mgr.did, {} as never, office)).not.toThrow(DENIED);
    expect(() => controller.managerSubmitKyc(mgr.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'a' } as never, stranger)).toThrow(/not yours/);

    // A shop's own settings, record and float: the shop, or staff.
    const shop = onboardAgent('Routes Shop', 'RZ');
    const asShop = { active: true, role: 'agent', did: shop.did } as never;
    const shops: Array<(who: never) => unknown> = [
      (who) => controller.topUp(shop.did, { amount: 50 } as never, who),
      (who) => controller.setAgentPrice(shop.did, { price: 0.5 } as never, who),
      (who) => controller.setAvailability(shop.did, { open: false } as never, who),
      // The starter-kit deposit left this list on 2026-09-22: it is @Roles('operator') now, so the guard
      // refuses a stranger before the handler is reached. Held by `money-in.spec.ts` instead.
    ];
    for (const act of shops) expect(() => act(stranger)).toThrow(/Only the shop/);
    expect(() => controller.getAgent(shop.did, stranger)).toThrow(/not yours/);
    expect(controller.getAgent(shop.did, asShop).did).toBe(shop.did);
    expect(() => controller.setAvailability(shop.did, { open: true } as never, asShop)).not.toThrow(DENIED);
    expect(() => controller.setAvailability(shop.did, { open: true } as never, staff)).not.toThrow(DENIED);
  });

  it('FP3b: a delivery that could not be made is written down, the load stays in transit, and the sender is told', () => {
    const pickup = { lat: -1.88, lng: 36.38 };
    const d = coupleTipper('DF1', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, packaging: 'loose', postedByDid: 'did:shop:p' });
    claimFreight(d.did, pickup, f.freightId);
    expect(() => dispatch.failDelivery(f.freightId, d.did, { outcome: 'absent' })).toThrow(/expected in_transit/);
    dispatch.pickupFreight(f.freightId, d.did, { confirmed: requiredLoadKeys(f), securementPhotoId: 'med_sec' });
    const heard: unknown[] = [];
    events.subscribe(GlosEvent.Pudo.FreightDeliveryFailed, (e) => {
      heard.push(e.payload);
    });
    expect(() => dispatch.failDelivery(f.freightId, 'did:other', { outcome: 'absent' })).toThrow(/another driver/);
    const after = dispatch.failDelivery(f.freightId, d.did, { outcome: 'absent', note: 'Gate locked, no answer' });
    expect(after.status).toBe('in_transit');
    expect(after.deliveryAttempts).toEqual([expect.objectContaining({ outcome: 'absent', note: 'Gate locked, no answer', by: d.did })]);
    expect(heard).toEqual([expect.objectContaining({ freightId: f.freightId, posterDid: 'did:shop:p', outcome: 'absent', attempts: 1 })]);
    expect(() => dispatch.openFreightClaim(f.freightId, 'did:shop:p', { kind: 'damaged', description: 'broken' })).toThrow(/still on the road/);
    expect(dispatch.postedBy('did:shop:p').find((r) => r.freightId === f.freightId)).toMatchObject({ attempts: [expect.objectContaining({ outcome: 'absent' })], canClaim: false });
    // A second attempt, then delivered after all.
    dispatch.failDelivery(f.freightId, d.did, { outcome: 'refused' });
    const done = dispatch.deliverFreight(f.freightId, d.did, { confirmed: requiredUnloadKeys(), receiverName: 'Joseph', podPhotoId: 'med_pod' });
    expect(done.deliveryAttempts).toHaveLength(2);
    expect(dispatch.postedBy('did:shop:p').find((r) => r.freightId === f.freightId)?.canClaim).toBe(true);
  });

  /**
   * THE RULE HOLDS FOR FREIGHT TOO (the user, 2026-10-13). A claim is decided by staff, with an award, only where the
   * company that billed the load has STATED COVER for dedicated freight. Everywhere else — a load settled between the
   * parties, or billed by a company that has stated nothing — the claim closes itself the moment it is made, and the
   * consignment note, frozen with the claim on it, is the damage claim report. It used to wait in a queue for one
   * member of staff to award up to a million.
   */
  it('FP3b: a claim on a load nothing of ours pays for closes itself with the report; only a company that has stated cover decides, up to what it stated', () => {
    const pickup = { lat: -1.89, lng: 36.39 };
    const ke = entities.requireForJurisdiction('KE').entityId;
    entities.setInsurance(ke, { lane: 'dedicated', freeLimit: null }, 'Amina Otieno');
    const heard: Array<Record<string, unknown>> = [];
    events.subscribe<Record<string, unknown>>(GlosEvent.Pudo.FreightClaimDecided, (e) => {
      heard.push(e.payload);
    });

    // A shop's own load — settled between the parties, nothing of ours to award from.
    const d = coupleTipper('CL1', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, packaging: 'loose', postedByDid: 'did:shop:q' });
    claimFreight(d.did, pickup, f.freightId);
    dispatch.pickupFreight(f.freightId, d.did, { confirmed: requiredLoadKeys(f), securementPhotoId: 'med_sec' });
    dispatch.deliverFreight(f.freightId, d.did, { confirmed: requiredUnloadKeys(), receiverName: 'Joseph', podPhotoId: 'med_pod' });
    expect(() => dispatch.openFreightClaim(f.freightId, 'did:shop:q', { kind: 'damaged', description: 'x' })).toThrow(/what you found/);
    const t0 = Date.now();
    expect(() => dispatch.openFreightClaim(f.freightId, 'did:shop:q', { kind: 'damaged', description: 'Three bags split open' }, t0 + 8 * 86_400_000)).toThrow(/within 7 days/);
    const holdSpy = jest.spyOn(media, 'holdFreightForDispute');
    const opened = dispatch.openFreightClaim(f.freightId, 'did:shop:q', { kind: 'damaged', description: 'Three bags split open', photoRef: 'med_claim' });
    expect(holdSpy).toHaveBeenCalledWith(f.freightId, expect.any(Date));
    holdSpy.mockRestore();
    // NOBODY OF OURS DECIDES IT: closed with the report the moment it was made, and told so on the wire — nothing waits.
    expect(opened.claim).toMatchObject({ state: 'resolved', decision: 'report_only', award: 0, kind: 'damaged', raisedBy: 'did:shop:q', decidedBy: 'the record', note: FREIGHT_REPORT_ONLY_NOTE });
    expect(opened.claim).not.toHaveProperty('paidTo');
    expect(dispatch.openFreightClaims().map((x) => x.freightId)).not.toContain(f.freightId);
    expect(heard).toEqual([expect.objectContaining({ freightId: f.freightId, decision: 'report_only', award: 0, claimantDid: 'did:shop:q', posterDid: 'did:shop:q' })]);
    expect(() => dispatch.openFreightClaim(f.freightId, 'did:shop:q', { kind: 'short', description: 'again' })).toThrow(/already been decided/);
    expect(() => dispatch.resolveFreightClaim(f.freightId, { decision: 'upheld', award: 50, note: 'Photos show it' })).toThrow(/already been decided/);

    // A store's load, billed through the network by a company that has stated NO cover: the same ending.
    const vendor = vendors.register({ name: 'ClaimShipper' });
    vendors.topUp(vendor.vendorId, 1000);
    const g = dispatch.registerFreight({ description: 'Sand', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 300, packaging: 'loose', shipperDid: vendor.vendorId });
    const d2 = coupleTipper('CL2', { min: 0.8, max: 1.5 });
    claimFreight(d2.did, pickup, g.freightId);
    const billed = dispatch.listFreight().find((x) => x.freightId === g.freightId)!;
    expect(billed.paidStatus).toBe('billed');
    expect(billed.billed).toMatchObject({ coverLimit: 0 });
    dispatch.pickupFreight(g.freightId, d2.did, { confirmed: requiredLoadKeys(g), securementPhotoId: 'med_sec' });
    dispatch.deliverFreight(g.freightId, d2.did, { confirmed: requiredUnloadKeys(), receiverName: 'Anne', podPhotoId: 'med_pod' });
    const before = vendors.balanceOf(vendor.vendorId);
    const closed = dispatch.openFreightClaim(g.freightId, vendor.vendorId, { kind: 'short', description: 'Two boxes of tiles missing' });
    expect(closed.claim).toMatchObject({ state: 'resolved', decision: 'report_only', award: 0 });
    expect(vendors.balanceOf(vendor.vendorId)).toBe(before);
    expect(dispatch.claimCoverLimit(closed)).toBe(0);

    // A CLAIM STILL OPEN FROM BEFORE on such a load — as the record would stand — waits with nothing to award, and is
    // closed with a reason and never with money.
    const old = dispatch.requireFreightPublic(g.freightId);
    old.claim = { ...old.claim!, state: 'open', decision: undefined, decidedBy: undefined, decidedAt: undefined, note: undefined };
    expect(dispatch.openFreightClaims().map((x) => x.freightId)).toContain(g.freightId);
    expect(dispatch.freightClaimRowOf(old, { sender: 'ClaimShipper' })).toMatchObject({ coverable: true, awardCap: 0, capBasis: 'none' });
    expect(() => dispatch.resolveFreightClaim(g.freightId, { decision: 'upheld', award: 1, note: 'ours' })).toThrow(/stated no cover/);
    expect(() => dispatch.resolveFreightClaim(g.freightId, { decision: 'partly_upheld', award: 0.01, note: 'a little' })).toThrow(/stated no cover/);
    expect(dispatch.resolveFreightClaim(g.freightId, { decision: 'rejected', note: 'The consignment note is the report', by: 'Ops One' }).claim).toMatchObject({ state: 'resolved', decision: 'rejected', award: 0, decidedBy: 'Ops One' });
    expect(vendors.balanceOf(vendor.vendorId)).toBe(before);

    // THE COMPANY STATES COVER — and from then a load it bills carries it, stamped at billing, and its claim waits for staff.
    entities.setInsurance(ke, { lane: 'dedicated', freeLimit: 5000 }, 'Amina Otieno');
    try {
      const h = dispatch.registerFreight({ description: 'Tiles', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 300, packaging: 'loose', shipperDid: vendor.vendorId });
      const d3 = coupleTipper('CL3', { min: 0.8, max: 1.5 });
      claimFreight(d3.did, pickup, h.freightId);
      expect(dispatch.listFreight().find((x) => x.freightId === h.freightId)!.billed).toMatchObject({ coverLimit: 5000 });
      dispatch.pickupFreight(h.freightId, d3.did, { confirmed: requiredLoadKeys(h), securementPhotoId: 'med_sec' });
      dispatch.deliverFreight(h.freightId, d3.did, { confirmed: requiredUnloadKeys(), receiverName: 'Anne', podPhotoId: 'med_pod' });
      // The cover a load was billed under is the cover on its claim: stating more afterwards changes nothing on it.
      entities.setInsurance(ke, { lane: 'dedicated', freeLimit: 9000 }, 'Amina Otieno');
      const beforeAward = vendors.balanceOf(vendor.vendorId);
      const waiting = dispatch.openFreightClaim(h.freightId, vendor.vendorId, { kind: 'short', description: 'Two boxes of tiles missing', photoRef: 'med_claim' });
      expect(waiting.claim).toMatchObject({ state: 'open', kind: 'short' });
      expect(dispatch.openFreightClaims().map((x) => x.freightId)).toEqual([h.freightId]);
      const row = dispatch.freightClaimRowOf(waiting, { sender: 'ClaimShipper', carrier: 'CL3' });
      expect(row).toMatchObject({ code: h.code, coverable: true, awardCap: 5000, capBasis: 'free-limit', currency: 'KES', evidence: ['med_sec', 'med_pod', 'med_claim'], receiverName: 'Anne' });
      expect(row.carriage).toBeGreaterThan(0);
      expect(() => dispatch.resolveFreightClaim(h.freightId, { decision: 'upheld', note: 'yes' })).toThrow(/awarding something/);
      expect(() => dispatch.resolveFreightClaim(h.freightId, { decision: 'upheld', award: 5000.01, note: 'all of it' })).toThrow(/covered to 5000.00 by the company that billed it/);
      expect(() => dispatch.resolveFreightClaim(h.freightId, { decision: 'rejected', note: '' })).toThrow(/reason/);
      const paid = dispatch.resolveFreightClaim(h.freightId, { decision: 'partly_upheld', award: 120, note: 'Two boxes short of the manifest', by: 'Ops One' });
      expect(paid.claim).toMatchObject({ decision: 'partly_upheld', award: 120, paidTo: { kind: 'vendor', id: vendor.vendorId }, decidedBy: 'Ops One' });
      expect(paid.claim?.funding).toBeDefined();
      expect(vendors.balanceOf(vendor.vendorId)).toBeCloseTo(beforeAward + 120, 2);
      expect(heard[heard.length - 1]).toEqual(expect.objectContaining({ freightId: h.freightId, decision: 'partly_upheld', award: 120, claimantDid: vendor.vendorId }));
      expect(() => dispatch.resolveFreightClaim(h.freightId, { decision: 'rejected', note: 'again' })).toThrow(/already been decided/);
      expect(dispatch.openFreightClaims()).toEqual([]);
    } finally {
      entities.setInsurance(ke, { lane: 'dedicated', freeLimit: null }, 'Amina Otieno');
    }
  });

  it('FP3: a load already on the road cannot be cancelled, and open prices on a withdrawn load are superseded', () => {
    const pickup = { lat: -1.87, lng: 36.37 };
    const d = coupleTipper('WD2', { min: 0.8, max: 1.5 });
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, packaging: 'loose' });
    claimFreight(d.did, pickup, f.freightId);
    dispatch.pickupFreight(f.freightId, d.did, { confirmed: requiredLoadKeys(f), securementPhotoId: 'med_sec' });
    expect(() => dispatch.cancelFreight(f.freightId, { did: 'did:shop', role: 'shipper' }, 'too late')).toThrow(/on the road/);
    const g = dispatch.registerFreight({ description: 'Negotiated', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, packaging: 'loose', commitMode: 'negotiate', postedByDid: 'did:shop:p' });
    const p = dispatch.propose({ freightId: g.freightId, driverDid: d.did, from: pickup, price: 300 });
    dispatch.cancelFreight(g.freightId, { did: 'did:shop:p', role: 'shipper' }, 'No longer needed');
    expect(dispatch.proposalsFor(g.freightId).find((x) => x.proposalId === p.proposalId)?.status).toBe('superseded');
  });

  it('S33b: a cold-chain freight logs temperatures; an out-of-band reading breaches it (sticky) + flags the tower', () => {
    const pickup = { lat: -1.9, lng: 36.2 };
    const d = coupleReefer('CC');
    const f = dispatch.registerFreight({ description: 'Vaccines', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, packaging: 'palletised', natureCode: 'FOP' });
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
    const cf = dispatch.registerFreight({ description: 'Dairy', pickupLocation: cold, pickupLabel: 'D', destLabel: 'S', destLocation: cold, weightKg: 200, packaging: 'palletised', natureCode: 'FOP' });
    claimFreight(dr.did, cold, cf.freightId);
    expect(() => dispatch.recordTemp(cf.freightId, 5, dr.did)).toThrow(/expected in_transit/i); // claimed, not moving yet
    pickupOk(cf, dr.did);
    expect(() => dispatch.recordTemp(cf.freightId, 5, 'did:glos:someone-else')).toThrow(/another driver/i);

    const warm = { lat: -1.95, lng: 36.25 };
    const dt = coupleTipper('WM', { min: 0.8, max: 1.5 });
    const wf = dispatch.registerFreight({ description: 'Gravel', pickupLocation: warm, pickupLabel: 'D', destLabel: 'S', destLocation: warm, weightKg: 200, packaging: 'loose', natureCode: 'GEN' });
    claimFreight(dt.did, warm, wf.freightId);
    pickupOk(wf, dt.did);
    expect(() => dispatch.recordTemp(wf.freightId, 5, dt.did)).toThrow(/temperature-controlled/i); // GEN → no band
  });

  it('S33b: a claimed cold-chain freight shows the driver its safe band + last reading; a plain freight shows none', () => {
    const pickup = { lat: -1.93, lng: 36.23 };
    const d = coupleReefer('BD');
    const f = dispatch.registerFreight({ description: 'Meat', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: pickup, weightKg: 200, packaging: 'palletised', natureCode: 'FOP' });
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
    const pallet = dispatch.registerFreight({ description: 'Tiles', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'D', destLabel: 'S', weightKg: 200, packaging: 'palletised' });
    expect(pallet.cargoClass).toBe('P4'); // 200 kg
    expect(pallet.requiredEquipment.length).toBeGreaterThan(0); // discrete → needs handling gear
    const bulk = dispatch.registerFreight({ description: 'Cement 5t', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'D', destLabel: 'S', weightKg: 5000, packaging: 'loose', natureCode: 'HAZ-DUST' });
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
    const pallet = dispatch.registerFreight({ description: 'Machinery', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'D', destLabel: 'S', destLocation: { lat: -1.25, lng: 36.85 }, weightKg: 200, packaging: 'palletised' });
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
    const balBefore = agents.balance(origin.did)!;

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
    expect(agents.balance(origin.did)!).toBeCloseTo(balBefore, 2); // the agent's parcel-sized wallet was NOT charged a truck haul
  });

  it('FB2d: the counter records the CUSTOMER’s refusal, and it reaches the claim', () => {
    // At a counter the walk-in customer IS the shipper, so the exclusion is theirs to make and the clerk's
    // only to record. Until now nothing could carry it in: the exclusion has been storable since FB0b and
    // binding since FB2c, but no screen asked the one person entitled to answer.
    const origin = onboardAgent('Exclusion Shop', 'NorthTown', 50);
    const dest = onboardAgent('Exclusion Dest', 'NorthTown', 0);
    const res: any = controller.bookFreight(
      { dimensionsCm: { l: 120, w: 100, h: 100 }, weightKg: 200, destPudoDid: dest.did, budgetCap: 40, excludedBodies: ['flatbed'] } as never,
      { role: 'pudo', did: origin.did } as never,
    );
    expect(dispatch.listFreight().find((x) => x.freightId === res.freightId)!.excludedBodies).toEqual(['flatbed']);

    const d = drivers.register({ displayName: 'FB2D', fullName: 'FB2D', nationalId: 'ID-FB2D', mobile: '+2547FB2D', licenceClasses: ['truck'], licenceNumber: 'L-FB2D', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const v = vehicles.register({ plate: 'V-FB2D', vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'] });
    fleet.couple(d.did, v.vehicleId);
    const [offer] = dispatch.suggest(d.did, { from: origin.location, to: dest.location }).filter((o) => o.ref === res.freightId);
    expect(offer).toBeDefined(); // still OFFERED — a preference is shown and argued with, never hidden
    expect(() => dispatch.claim(offer.offerId)).toThrow(/ruled out your body type/);
    expect(dispatch.listFreight().find((x) => x.freightId === res.freightId)!.status).toBe('available');
  });

  it('FB2d: ruling nothing out stores no preference at all', () => {
    // "The customer did not mind" and "the customer ruled out an empty list of bodies" must not become the
    // same record, or the market series would count a refusal nobody made.
    const origin = onboardAgent('No-Exclusion Shop', 'NorthTown', 50);
    const dest = onboardAgent('No-Exclusion Dest', 'NorthTown', 0);
    const res: any = controller.bookFreight({ dimensionsCm: { l: 120, w: 100, h: 100 }, weightKg: 200, destPudoDid: dest.did, budgetCap: 40, excludedBodies: [] } as never, { role: 'pudo', did: origin.did } as never);
    expect(dispatch.listFreight().find((x) => x.freightId === res.freightId)!.excludedBodies).toBeUndefined();
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
    // FB5 — the correction this slice exists for. A co-op lot is deposited in SACKS, and it was posted
    // `bulk: true` on the reasoning that a durable commodity self-loads. It does not: sacks are lifted. The
    // old stamp told every member's lot it needed NO handling equipment, which is the "you would need a
    // forklift" signal going silent on the load that needs it most.
    expect(f.packaging).toBe('bagged');
    expect(f.bulk).toBe(false); // bulk now means LOOSE, and sacks are not loose
    expect(f.requiredEquipment.length).toBeGreaterThan(0); // something has to lift them
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
    controller.snoozeWork(rider.did, { minutes: 30 } as never, asDriver(rider.did));

    // The marketplace goes quiet on ALL surfaces at once — they share the gate, so they cannot disagree.
    expect(dispatch.suggestNearby(rider.did, origin.location, 5)).toEqual([]);
    expect(dispatch.suggest(rider.did, { from: origin.location, to: { lat: origin.location.lat - 1, lng: origin.location.lng } })).toEqual([]);
    expect(dispatch.offerNear(rider.did, origin.location)).toBeNull();

    // …but the bag they are already carrying is still theirs. Snoozing offers is not going off shift.
    expect(dispatch.claimsFor(rider.did).map((c) => c.ref)).toContain(mine.code);
    expect(mdps.loadBag(mine.code, drivers.get(rider.did).badgeId!).moved).toEqual(['SNZ-1']);

    // It ends when they say…
    controller.resumeWork(rider.did, asDriver(rider.did));
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
    // …by the driver themselves, signed in as a person, with their PIN (a shift is where who-is-driving is written down).
    const person = persons.attachRole('+254711000777', 'driver', d.did);
    persons.setPin(person.personDid, '13570');
    const me = { active: true, role: 'driver', did: d.did, personDid: person.personDid } as never;
    const asg: any = controller.startSession(d.did, { vehicleId: mine, pin: '13570' } as never, me);
    expect(asg.vehicleId).toBe(mine);
    expect(() => controller.startSession(d.did, { pin: '13570' } as never, me)).toThrow(/Scan the vehicle QR/);

    // Someone else on shift with it is SHOWN and marked, not hidden — "where is my bus?" deserves an answer.
    const other = drivers.register({ displayName: 'Other', fullName: 'O O', nationalId: 'ID-other-pick', mobile: '+2547other', licenceClasses: ['truck'], licenceNumber: 'L-o', licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(other.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(other.did, true);
    fleet.uncouple(d.did); // our driver hands it back at the end of the day…
    fleet.couple(other.did, mine); // …and it goes out with someone else
    expect(fleet.recentVehicles(other.did)[0]).toMatchObject({ vehicleId: mine, busy: true });
    expect(() => controller.startSession(d.did, { vehicleId: mine, pin: '13570' } as never, me)).toThrow(/already coupled/i);
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
    // FB5 — the vehicle that actually carries a co-op lot: the user's flatbed with its own forklift (kooiaap).
    // A tipper was the fixture while a lot posted as loose bulk; sacks need something that lifts them, and a
    // driver planning around a filling lot must be the driver who can take it when it fills.
    const truck = coupleFlatbedWithForklift('fore', { min: 0.8, max: 1.5 });
    const route = { from: owner.location, to: { lat: owner.location.lat + 3, lng: owner.location.lng + 3 } };

    // An EMPTY lot is an intention, not a load — nothing to plan around.
    expect((controller.suggestWork(truck.did, route as never, asDriver(truck.did)) as any).expected).toEqual([]);

    consignments.deposit(lot.code, 'farmer-A', 300); // 30% of a truckload, still open
    const res: any = controller.suggestWork(truck.did, route as never, asDriver(truck.did));
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
    const after: any = controller.suggestWork(truck.did, route as never, asDriver(truck.did));
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
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: pickup, pickupLabel: 'D', destLabel: 'S', destLocation: dest, weightKg: 100, packaging: 'loose' });

    // Cold-start: one bad rating does NOT bar — the driver still sees + can grab freight.
    rating.rateDriver({ driverDid: d.did, byAgentDid: 'a1', stars: 1 });
    const [coldOffer] = dispatch.suggest(d.did, { from: pickup, to: dest }).filter((o) => o.ref === f.freightId);
    expect(coldOffer).toBeDefined();

    // Push the RELIABLE rating below the floor (3 × 1★ → avg 1.0, count 3, no longer cold-start).
    rating.rateDriver({ driverDid: d.did, byAgentDid: 'a2', stars: 1 });
    rating.rateDriver({ driverDid: d.did, byAgentDid: 'a3', stars: 1 });
    expect(dispatch.suggest(d.did, { from: pickup, to: dest }).some((o) => o.ref === f.freightId)).toBe(false); // freight withheld
    expect((controller.suggestWork(d.did, { from: pickup, to: dest } as never, asDriver(d.did)) as { freightPaused: boolean }).freightPaused).toBe(true); // live verdict for the app's note
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
    const f = dispatch.registerFreight({ description: 'Cement', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'D', destLabel: 'S', destLocation: { lat: -1.25, lng: 36.85 }, weightKg: 100, packaging: 'loose' });

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
    const gapAtDest = dispatch.registerFreight({ ...base, weightKg: 200, packaging: 'palletised', originEquipment: ['MAN', 'PLT'], destEquipment: ['MAN'] });
    expect(gapAtDest.equipmentGaps).toEqual(['dest']); // origin has a pallet jack, destination only manual
    const equipped = dispatch.registerFreight({ ...base, weightKg: 200, packaging: 'palletised', originEquipment: ['MAN', 'TLT'], destEquipment: ['MAN', 'RMP'] });
    expect(equipped.equipmentGaps).toEqual([]); // both ends carry a P4-qualifying piece (tail-lift / ramp)
    const bulk = dispatch.registerFreight({ ...base, weightKg: 5000, packaging: 'loose', originEquipment: ['MAN'], destEquipment: ['MAN'] });
    expect(bulk.equipmentGaps).toEqual([]); // loose bulk self-loads → no handling gear → no gap
    const unknown = dispatch.registerFreight({ ...base, weightKg: 200, packaging: 'palletised' }); // a geo-only bulletin freight
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
    const mine = dispatch.freightsFor(hashPhone(buyer));
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

    const done = dispatch.freightsFor(hashPhone(buyer))[0];
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

  /**
   * WHAT A PARCEL COSTS AND WHAT EACH STEP PAYS — a list per country's company, in its own money (amounts.ts).
   *
   * These were constants: 1.60 to a shop's float, 0.40 for a take-in, and so on, at a dollar's scale, stamped as
   * shillings, changeable by a developer. What is held here: a company starts from those figures and nothing moves
   * until one is set; a figure set is used by every step done from then on; and what has already happened is not
   * re-priced — a parcel is refunded what it was charged.
   */
  describe('a company’s own list of amounts', () => {
    const KE = () => entities.requireForJurisdiction('KE').entityId;
    const set = (patch: Record<string, number | null>) => entities.setAmounts(KE(), patch, 'Amina Otieno');
    const row = (key: string) => entities.pricingFor(KE(), []).amounts.find((r) => r.key === key)!;
    const cash = (a: { did: string }, id: string) => parcels.accept({ agentDid: a.did, parcelId: id, size: 'M', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'v.jpg' });
    const refused = (patch: Record<string, unknown>): string => {
      try {
        entities.setAmounts(KE(), patch as never, 'Amina Otieno');
      } catch (e) {
        return (e as Error).message;
      }
      return 'taken';
    };
    /** What this shop has been paid, newest last. */
    const paidTo = (did: string) => gate.entries({ did, type: 'LABOR_PAYOUT' }).map((e) => e.amount).reverse();

    it('starts every company from today’s figures — and nothing changes until somebody sets one', () => {
      expect(DEFAULT_AMOUNTS).toEqual({ wholesale: 1.6, labourFee: 0.4, handoverFee: 0.5, shelvingFee: 0.15, releaseFee: 0.15, toteLoadFee: 0.5, mdpSortFee: 0.2, holdingFeePerDay: 0.1 });
      expect(entities.amountsFor(KE())).toEqual({ ...DEFAULT_AMOUNTS, currency: 'KES' });
      // Nobody's company: the starting figures, in no money in particular.
      expect(entities.amountsFor(undefined)).toEqual({ ...DEFAULT_AMOUNTS, currency: undefined });
      const rows = entities.pricingFor(KE(), []).amounts;
      expect(rows.map((r) => r.key)).toEqual([...AMOUNT_KEYS]);
      expect(rows.every((r) => !r.own && r.amount === r.startsAt)).toBe(true);
    });

    it('a figure set is that company’s own; one left out is left alone; null puts one back', () => {
      set({ wholesale: 160, labourFee: 40 });
      expect(entities.amountsFor(KE())).toMatchObject({ wholesale: 160, labourFee: 40, handoverFee: 0.5, currency: 'KES' });
      expect(row('wholesale')).toEqual({ key: 'wholesale', amount: 160, own: true, startsAt: 1.6 });
      expect(row('handoverFee')).toEqual({ key: 'handoverFee', amount: 0.5, own: false, startsAt: 0.5 });

      set({ labourFee: null });
      expect(entities.amountsFor(KE())).toMatchObject({ wholesale: 160, labourFee: 0.4 });
      expect(row('labourFee').own).toBe(false);
      // Money has two places.
      set({ shelvingFee: 12.347 });
      expect(row('shelvingFee').amount).toBe(12.35);
      // A step a company pays nothing for is a figure like any other.
      set({ handoverFee: 0 });
      expect(row('handoverFee')).toEqual({ key: 'handoverFee', amount: 0, own: true, startsAt: 0.5 });
    });

    it('refuses what cannot be meant, and a refusal changes nothing beside it', () => {
      expect(refused({ retail: 2 })).toContain('"retail" is not an amount on a company’s list');
      expect(refused({ labourFee: -1 })).toContain('not less than nothing');
      expect(refused({ labourFee: Number.NaN })).toContain('has to be an amount of money');
      expect(refused({ labourFee: '40' })).toContain('has to be an amount of money');
      // The price of a parcel is also the float a shop needs and the measure of its credit: at nothing, neither guards.
      expect(refused({ wholesale: 0 })).toContain('A parcel has to cost something');
      expect(refused({ labourFee: 40, wholesale: 0 })).toContain('A parcel has to cost something');
      expect(entities.amountsFor(KE())).toEqual({ ...DEFAULT_AMOUNTS, currency: 'KES' });
      // The group sells nothing and pays nobody: it has no list to set.
      expect(() => entities.setAmounts('sbg', { wholesale: 2 }, 'Amina Otieno')).toThrow();
    });

    it('is written down with who did it, naming only what changed — and a save that changes nothing is not a decision', () => {
      set({ wholesale: 160, labourFee: 40 });
      expect(entities.changes(KE(), 1)[0]).toMatchObject({ by: 'Amina Otieno', what: 'amounts', from: 'parcel price 1.6, take-in pay 0.4 (KES)', to: 'parcel price 160, take-in pay 40 (KES)' });
      const written = entities.changes(KE(), 50).length;
      set({ wholesale: 160 });
      set({});
      expect(entities.changes(KE(), 50)).toHaveLength(written);
    });

    it('is set by network staff and by that company’s own administrators — not by another company’s', () => {
      const staff = { role: 'operator', active: true, actorName: 'Amina Otieno' } as never;
      const ours = { role: 'entity_admin', active: true, tenant: KE(), actorName: 'Njeri W.' } as never;
      const theirs = { role: 'entity_admin', active: true, tenant: 'sbg-et', actorName: 'Abebe B.' } as never;

      controller.setEntityAmounts(KE(), { wholesale: 150 } as never, ours);
      expect(entities.amountsFor(KE()).wholesale).toBe(150);
      expect(entities.changes(KE(), 1)[0]).toMatchObject({ what: 'amounts', by: 'Njeri W.' });

      // Told there is no such company, as for any other of its terms: not even that it exists.
      expect(() => controller.setEntityAmounts(KE(), { wholesale: 1 } as never, theirs)).toThrow('No such company');
      expect(entities.amountsFor(KE()).wholesale).toBe(150);

      controller.setEntityAmounts(KE(), { wholesale: null } as never, staff);
      expect(entities.amountsFor(KE()).wholesale).toBe(WHOLESALE);
      expect(entities.changes(KE(), 1)[0].by).toBe('Amina Otieno');
    });

    it('a parcel at the counter costs what the shop’s company says — and is refunded what it COST, not today’s price', () => {
      set({ wholesale: 160 });
      const a = onboardAgent('Price Shop', 'NorthTown', 1000);
      const before = agents.balance(a.did)!;
      cash(a, 'QR-AM-1');
      expect(agents.balance(a.did)!).toBeCloseTo(before - 160, 2);
      expect(parcels.get('QR-AM-1').intakeCharge).toBe(160);

      // The price moves while that parcel can still be cancelled.
      set({ wholesale: 200 });
      cash(a, 'QR-AM-2');
      expect(agents.balance(a.did)!).toBeCloseTo(before - 360, 2);
      parcels.void('QR-AM-1', a.did, 'torn.jpg');
      expect(agents.balance(a.did)!).toBeCloseTo(before - 200, 2); // 160 came back; the 200 parcel stands
      expect(books.balances(KE())).toEqual({ balanced: true, drift: 0 });
    });

    it('the float that opens the counter is the price of one parcel, and the credit line is twenty of them', () => {
      const early = onboardAgent('Early Shop', 'NorthTown', 10);
      expect(gate.canTransact(early.did)).toMatchObject({ canTransact: true, threshold: 1.6, currency: 'KES', credit: { limit: 32, used: 0, available: 32 } });

      set({ wholesale: 160 });
      expect(gate.canTransact(early.did)).toMatchObject({ canTransact: true, threshold: 160, currency: 'KES', credit: { limit: 3200, used: 0, available: 3200 } });

      // Two parcels of its own money, then the whole line: the shutter comes down where the next parcel cannot be paid.
      const a = onboardAgent('Line Shop', 'NorthTown', 320);
      for (let i = 0; i < 2 + TRADE_CREDIT_PARCELS; i += 1) cash(a, `QR-LN-${i}`);
      expect(gate.canTransact(a.did)).toMatchObject({ canTransact: false, code: 'WALLET_INSUFFICIENT', threshold: 160, shortfall: 160, credit: { limit: 3200, used: 3200, available: 0 } });
      expect(agents.get(a.did).status).toBe('LOCKED');
      expect(() => cash(a, 'QR-LN-X')).toThrow('Insufficient funds');
    });

    it('a change of price is felt at every counter of that company at once — not at each shop’s next payment', () => {
      const staff = { role: 'operator', active: true, actorName: 'Amina Otieno' } as never;
      controller.setEntityAmounts(KE(), { wholesale: 160 } as never, staff);
      // One parcel of its own money and nineteen on credit: one parcel short of the end of its line — open, only just.
      const a = onboardAgent('Edge Shop', 'NorthTown', 160);
      for (let i = 0; i < TRADE_CREDIT_PARCELS; i += 1) cash(a, `QR-ED-${i}`);
      expect(agents.get(a.did).status).toBe('ACTIVE');
      // A shop approved and never funded: a price does not open it.
      agentSeq += 1;
      const waiting = agents.register({ shopName: 'Waiting Shop', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'x', openingHours: uniformHours(), shelf: defaultShelf, fullName: 'Waiting owner', nationalId: `ID-WAIT-${agentSeq}`, mobile: `+2547009${agentSeq}`, deviceImei: `IMEI-WAIT-${agentSeq}`, requirements: eligibleReqs() });
      agents.submitKyc(waiting.did, kycDocs);
      agents.decideKyc(waiting.did, true);
      expect(agents.get(waiting.did).status).toBe('APPROVED_UNFUNDED');

      // The price falls: nineteen parcels at 160 are more than twenty at 100, so the line is used up — shut, now.
      controller.setEntityAmounts(KE(), { wholesale: 100 } as never, staff);
      expect(agents.get(a.did).status).toBe('LOCKED');
      expect(gate.canTransact(a.did)).toMatchObject({ canTransact: false, threshold: 100, credit: { limit: 2000 } });
      // …and back: open again, with nobody paying anything in between.
      controller.setEntityAmounts(KE(), { wholesale: 160 } as never, staff);
      expect(agents.get(a.did).status).toBe('ACTIVE');
      expect(gate.canTransact(a.did).canTransact).toBe(true);
      expect(agents.get(waiting.did).status).toBe('APPROVED_UNFUNDED');
    });

    it('each step is paid what the company of the shop that does it says, on the day it is done', () => {
      set({ labourFee: 40, shelvingFee: 15, releaseFee: 12 });
      const { origin, dest, res } = mintInbound('AMT');
      const id = res.parcel.parcelId;

      parcels.intakeInbound(id, origin.did);
      expect(paidTo(origin.did)).toEqual([40]);
      expect(parcels.get(id).intakeLabour).toBe(40);

      parcels.get(id).status = 'On_Bus';
      parcels.arrive(id, dest.did);
      expect(paidTo(dest.did)).toEqual([15]);

      // The figure moves between the shelf and the hand-over: the hand-over is paid at the figure of its own day.
      set({ releaseFee: 20 });
      parcels.collectConfirm(id, dest.did, parcels.get(id).collectionCode!);
      expect(paidTo(dest.did)).toEqual([15, 20]);
      expect(books.balances(KE())).toEqual({ balanced: true, drift: 0 });
    });

    it('handing a batch to the driver pays that shop’s company’s figure — and a step paid nothing writes no row', () => {
      set({ handoverFee: 55 });
      const { badge } = mkFleetDriver('AMH');
      const a = onboardAgent('Batch Shop', 'NorthTown', 50);
      handOff(a, badge, 'QR-AMH-1');
      expect(paidTo(a.did)).toEqual([55]);

      set({ handoverFee: 0 });
      handOff(a, badge, 'QR-AMH-2');
      expect(paidTo(a.did)).toEqual([55]);
      expect(parcels.get('QR-AMH-2').status).toBe('On_Bus'); // the parcel moved all the same
    });

    it('a hub is paid for each parcel it sorts at its own company’s figure', () => {
      set({ mdpSortFee: 25 });
      const origin = onboardAgent('Sort Origin', 'NorthTown', 50);
      const dest = onboardAgent('Sort Dest', 'SouthTown', 50);
      const hub = mdps.register({ name: 'Sort Hub', zones: ['SouthTown'], location: { lat: -1.25, lng: 36.85 } });
      const vendor = vendors.register({ name: 'SortStore' });
      vendors.topUp(vendor.vendorId, 50);
      const { parcel } = parcels.createInbound({ vendorId: vendor.vendorId, originAgentDid: origin.did, destAgentDid: dest.did, buyerMobile: '+254700222', size: 'M', contentPhotoRef: 'content.jpg', shippingPolicy: vendor.shippingPolicy, quote: routing.quoteShipment(origin.did, dest.did, 'M') });
      parcels.intakeInbound(parcel.parcelId, origin.did);
      const bag = totes.register(origin.did);
      totes.assign(bag.code, hub.mdpId, hub.name);
      mdps.fillTote(bag.code, parcel.parcelId);
      mdps.loadBag(bag.code, 'BUS-AM');
      mdps.dropBag(hub.mdpId, bag.code);
      mdps.sortParcel(hub.mdpId, parcel.parcelId);
      const sorted = gate.entries({ type: 'LABOR_PAYOUT' }).filter((e) => e.refType === 'mdp');
      expect(sorted.map((e) => e.amount)).toEqual([25]);
    });
  });
});
