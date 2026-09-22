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
import { FundingPayerRegistrar } from './funding-payers';
import { NotificationService } from './notification.service';
import { OutboxPushSender } from './push-sender';
import { PUSH_SENDER } from './notification.types';
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
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { FxService } from '../../foundation/money/fx.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { FundingService } from '../../foundation/funding/funding.service';
import { SandboxFundingRail } from '../../foundation/funding/sandbox-funding-rail.adapter';
import { FUNDING_RAIL } from '../../foundation/funding/funding.types';

/**
 * A SHOP'S FLOAT, AND WHOSE WORD IT RESTS ON.
 *
 * Until 2026-09-22 a shop pressed "Top up 5,000" in its own app and the books recorded 5,000 of cash held
 * and 5,000 owed back to that shop. Nothing outside the building had said anything. The cash figure on the
 * operator's Money screen — the one that decides whether a sister can pay its drivers this afternoon — was
 * a claim by the party who benefits from it.
 *
 * The user's decision, in their words: *"if a shop tops up then we need proof of that, but sbg staff
 * confirming every top up is a tough call. we need psp, airtime or mobile money webhook confirmation. And
 * that must be visible in the books."*
 *
 * So these tests hold the whole path to two questions. Does asking move anything (it must not), and when
 * the rail confirms, do the books say something an auditor could check — the payer credited GROSS, the
 * provider's cut booked as ours, and the custody figure equal to what actually landed in the account.
 */
describe('a shop’s float rests on a confirmed payment', () => {
  let agents: AgentService;
  let vendors: VendorService;
  let gate: WalletGateService;
  let books: BooksService;
  let entities: EntityService;
  let funding: FundingService;
  let rail: SandboxFundingRail;
  let notifications: NotificationService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        EntityService, PresenceService, BooksService, FxService,
        FundingService, FundingPayerRegistrar, NotificationService, OutboxPushSender, { provide: PUSH_SENDER, useExisting: OutboxPushSender }, SandboxFundingRail, { provide: FUNDING_RAIL, useExisting: SandboxFundingRail },
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed(); // compile() runs no lifecycle hooks — the sisters are seeded by hand, as at boot
    moduleRef.get(FxService).seed();
    books = moduleRef.get(BooksService);
    books.reset();
    agents = moduleRef.get(AgentService);
    vendors = moduleRef.get(VendorService);
    gate = moduleRef.get(WalletGateService);
    funding = moduleRef.get(FundingService);
    rail = moduleRef.get(SandboxFundingRail);
    notifications = moduleRef.get(NotificationService);
    // …and neither does compile() call onModuleInit, so the payers register themselves by hand here.
    moduleRef.get(FundingPayerRegistrar).onModuleInit();
  });

  let seq = 0;
  const ke = () => entities.requireForJurisdiction('KE').entityId;
  const uniformHours = () => ({ mon: { open: '08:00', close: '18:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null });

  function shop(approve = true) {
    seq += 1;
    const a = agents.register({
      shopName: `Duka ${seq}`, zone: 'nairobi-west', location: { lat: -1.2, lng: 36.8 }, landmark: 'by the market',
      openingHours: uniformHours(), shelf: { rows: 3, cols: 3 }, fullName: `Owner ${seq}`, nationalId: `ID-${seq}`,
      mobile: `+25471${seq}`, deviceImei: `IMEI-${seq}`,
      requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-${seq}`, criminalRecordClear: true },
    });
    if (approve) {
      agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'licence.pdf', shopPhotoRefs: ['shop.jpg'] });
      agents.decideKyc(a.did, true);
    }
    return agents.get(a.did);
  }

  /** The provider says money landed — signed, and read back through the same verification a live
   *  callback meets. Never a hand-built payment: the signature check is the point. */
  function railConfirms(reference: string, amount: number, fee = 0, providerRef = `MPX${(seq += 1)}`) {
    const { headers, body } = rail.simulate({ providerRef, reference, amount, currency: 'KES', fee });
    return funding.confirm(rail.verify(headers, body));
  }

  const held = () => books.balance(ke(), ACCOUNT_CODES.CASH_CUSTODY);
  const paymentFees = () => books.balance(ke(), ACCOUNT_CODES.EXPENSE_PAYMENT_FEES);

  describe('asking', () => {
    it('moves no money and writes no journal entry', () => {
      const a = shop();
      const request = funding.open({ payerKind: 'agent', payerDid: a.did, amount: 5000 });
      expect(request.status).toBe('awaiting');
      expect(agents.balance(a.did)).toBe(0);
      expect(held()).toBe(0);
      // The thing the shop is given instead of a balance: a reference, and how to pay against it.
      expect(request.reference).toMatch(/^SBG-/);
    });

    it('is refused for a shop that is not approved yet', () => {
      const draft = shop(false);
      expect(() => funding.open({ payerKind: 'agent', payerDid: draft.did, amount: 5000 })).toThrow(/not approved yet/);
    });

    it('names the sister that collects — rule 1, collection follows the payer', () => {
      const a = shop();
      const request = funding.open({ payerKind: 'agent', payerDid: a.did, amount: 5000 });
      expect(request.entityId).toBe(ke());
      expect(request.currency).toBe('KES');
    });
  });

  describe('when the rail confirms', () => {
    it('credits the float and puts the cash in custody', () => {
      const a = shop();
      const request = funding.open({ payerKind: 'agent', payerDid: a.did, amount: 5000 });
      railConfirms(request.reference, 5000);
      expect(agents.balance(a.did)).toBe(5000);
      expect(held()).toBe(5000);
      // Owed back to the shop, not earned by us: we charge for service, never for balance.
      expect(books.balance(ke(), ACCOUNT_CODES.REVENUE)).toBe(0);
    });

    it('credits the shop the GROSS and books the provider’s cut as our own expense', () => {
      /*
       * The money model, 2026-08-18: "Credit the GROSS at top-up — never net-credit, which pushes an
       * opaque deduction onto the least sophisticated party." And `expense.payment_fees` has existed since
       * the books were built with the note that it is the first thing to break reconciliation if left
       * out — until today nothing but a unit test had ever posted to it.
       */
      const a = shop();
      const request = funding.open({ payerKind: 'agent', payerDid: a.did, amount: 5000 });
      railConfirms(request.reference, 5000, 75);
      expect(agents.balance(a.did)).toBe(5000); // what the shopkeeper paid in
      expect(held()).toBe(4925); // what is actually in the account
      expect(paymentFees()).toBe(75); // and the difference has a name
    });

    it('records what the payment was, so the books can be walked back to it', () => {
      const a = shop();
      const request = funding.open({ payerKind: 'agent', payerDid: a.did, amount: 5000 });
      const { funding: done } = railConfirms(request.reference, 5000, 75, 'MPESA-QJ7X2');
      expect(done?.providerRef).toBe('MPESA-QJ7X2');
      expect(done?.entryId).toBeTruthy();
      expect(books.journal({ entityId: ke() }).some((e) => e.entryId === done?.entryId && e.ref === "MPESA-QJ7X2")).toBe(true);
    });

    it('keeps the books balanced', () => {
      const a = shop();
      const request = funding.open({ payerKind: 'agent', payerDid: a.did, amount: 5000 });
      railConfirms(request.reference, 5000, 75);
      expect(books.balances(ke()).balanced).toBe(true); // the whole book sums to zero, or it is not double entry
    });

    it('settles trade credit first, out of the money that arrived', () => {
      const a = shop();
      gate.chargeShipping(a.did, 30, 'PCL-1'); // scanned on the credit line with an empty float
      expect(agents.balance(a.did)).toBe(-30);
      const request = funding.open({ payerKind: 'agent', payerDid: a.did, amount: 1000 });
      railConfirms(request.reference, 1000);
      expect(agents.balance(a.did)).toBe(970);
      expect(books.balance(ke(), ACCOUNT_CODES.RECEIVABLE_AGENT)).toBe(0);
    });

    it('credits the amount that ARRIVED when a shop pays less than it asked for', () => {
      const a = shop();
      const request = funding.open({ payerKind: 'agent', payerDid: a.did, amount: 5000 });
      railConfirms(request.reference, 500);
      expect(agents.balance(a.did)).toBe(500);
      expect(held()).toBe(500);
    });
  });

  describe('the shop is told', () => {
    it('gets a notification the moment the payment is confirmed', () => {
      /*
       * They paid at a kiosk and walked back to the counter. Before this, the only way to learn the money
       * had landed was to reopen the app and press "Check again" — a shopkeeper at a till, unable to
       * scan, refreshing a screen. `WalletToppedUp` was published all along and nothing subscribed to it.
       */
      const a = shop();
      const request = funding.open({ payerKind: 'agent', payerDid: a.did, amount: 5000 });
      railConfirms(request.reference, 5000);
      const inbox = notifications.inboxFor(a.did);
      expect(inbox.map((n) => n.kind)).toContain('money_in');
      const told = inbox.find((n) => n.kind === 'money_in')!;
      expect(told.title).toMatch(/came through/);
      expect(told.body).toContain('5000.00');
      // Short enough to be read on a lock screen — the lesson the papers notifications cost us.
      expect(told.body.length).toBeLessThan(80);
    });

    it('is told when a payment is taken back, because their balance just fell', () => {
      const a = shop();
      const request = funding.open({ payerKind: 'agent', payerDid: a.did, amount: 5000 });
      railConfirms(request.reference, 5000);
      funding.reverse(request.fundingId, 'recalled by the sender');
      expect(notifications.inboxFor(a.did).filter((n) => n.kind === 'money_in').map((n) => n.title)).toContain('A payment was taken back');
    });

    it('sends a STORE its own signed callback instead, because it has no inbox to read', () => {
      const store = vendors.register({ name: 'Soko Online', country: 'KE', location: { lat: -1.3, lng: 36.8 }, callbackUrl: 'https://soko.example/hook' });
      const request = funding.open({ payerKind: 'vendor', payerDid: store.vendorId, amount: 2000 });
      railConfirms(request.reference, 2000);
      const sent = vendors.outboxFor(store.vendorId);
      expect(sent[0]?.event).toBe('balance_topped_up');
      expect(JSON.parse(sent[0].body).data.amount).toBe(2000);
    });
  });

  describe('when a confirmed payment comes back', () => {
    it('takes the float back out and leaves the provider’s fee spent', () => {
      const a = shop();
      const request = funding.open({ payerKind: 'agent', payerDid: a.did, amount: 5000 });
      railConfirms(request.reference, 5000, 75);
      funding.reverse(request.fundingId, 'recalled by the sender');
      expect(agents.balance(a.did)).toBe(0);
      // Out of pocket by exactly the fee, visibly — which is the true position after a reversal.
      expect(held()).toBe(-75);
      expect(paymentFees()).toBe(75);
      expect(books.balances(ke()).balanced).toBe(true);
    });
  });

  describe('a store’s prepaid balance', () => {
    it('rests on the same confirmation', () => {
      const store = vendors.register({ name: 'Soko Online', country: 'KE', location: { lat: -1.3, lng: 36.8 } });
      const request = funding.open({ payerKind: 'vendor', payerDid: store.vendorId, amount: 2000 });
      expect(vendors.balanceOrNone(store.vendorId)).toBe(0);
      railConfirms(request.reference, 2000, 30);
      expect(vendors.balanceOrNone(store.vendorId)).toBe(2000);
      expect(held()).toBe(1970);
      expect(paymentFees()).toBe(30);
      expect(books.balances(ke()).balanced).toBe(true);
    });
  });
});
