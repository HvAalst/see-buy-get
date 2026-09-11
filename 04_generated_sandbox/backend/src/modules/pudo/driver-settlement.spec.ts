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
import { PayoutService } from '../../foundation/payouts/payout.service';
import { SandboxPayoutRail } from '../../foundation/payouts/sandbox-rail.adapter';
import { PAYOUT_RAIL } from '../../foundation/payouts/payout.types';

/**
 * What the network owes the people who move things — and, until now, never wrote down.
 *
 * `driverPayout` took an OPTIONAL `entityId` and posted to the books only when one was passed. Not one of
 * the three call sites passed it. So every driver payout this network has ever made wrote a register row
 * and no double entry: the money owed to the people doing the driving was absent from the trial balance
 * and missing from `coverage().owed`, which is the single figure that answers whether a sister could pay
 * everybody today. The books said the network owed its drivers nothing.
 *
 * An optional parameter is a thing every call site forgets. It is resolved inside the payout now, so no
 * call site can.
 *
 * The other half is WHO. The network contracts a fleet or an independent courier, never a person who
 * happens to be at a wheel, so a fleet driver's money is owed to their fleet. The driver's own earnings
 * register stays keyed to the driver, because "what did I earn" and "who does the network owe" are
 * different questions and a fleet driver is entitled to the answer to the first.
 */
describe('what the network owes its drivers', () => {
  let agents: AgentService;
  let drivers: DriverService;
  let vehicles: VehicleService;
  let fleet: FleetService;
  let managers: FleetManagerService;
  let gate: WalletGateService;
  let books: BooksService;
  let entities: EntityService;
  let payouts: PayoutService;

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
    agents = moduleRef.get(AgentService);
    drivers = moduleRef.get(DriverService);
    vehicles = moduleRef.get(VehicleService);
    fleet = moduleRef.get(FleetService);
    managers = moduleRef.get(FleetManagerService);
    gate = moduleRef.get(WalletGateService);
    payouts = moduleRef.get(PayoutService);
    // A sister with money in the account: settlement can only pay what is actually held.
    books.post({
      entityId: ke(),
      kind: 'top-up',
      ref: 'funding',
      lines: [
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: 5000 },
        { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: 'did:glos:shop', amount: -5000 },
      ],
    });
  });

  let seq = 0;
  const ke = () => entities.requireForJurisdiction('KE').entityId;

  /** An independent courier — the network contracts them directly. */
  function courier() {
    seq += 1;
    return drivers.register({ displayName: `C${seq}`, fullName: `C ${seq}`, nationalId: `ID-S${seq}`, mobile: `+2547400${seq}`, licenceClasses: ['motorcycle'] });
  }

  /** A real fleet, and a driver employed by it. */
  function employed() {
    seq += 1;
    const manager = managers.register({
      companyName: `Haulage ${seq}`, contactPhone: `+2548000${seq}`, ownerFullName: 'O O', ownerNationalId: `MGR-${seq}`,
      location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-${seq}`, transportOperatorLicence: `TOL-${seq}`, taxId: `TAX-${seq}` },
    });
    // A fleet must be all the way through onboarding before it may employ anybody — papers, a decision,
    // and the operating bond. Only then can it be owed money.
    managers.submitKyc(manager.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(manager.did, true);
    managers.recordBond(manager.did);
    const driver = drivers.register({
      displayName: `E${seq}`, fullName: `E ${seq}`, nationalId: `ID-E${seq}`, mobile: `+2547500${seq}`,
      licenceClasses: ['motorcycle'], managerDid: manager.did,
    });
    return { manager, driver };
  }

  /** What the books say is owed to one counterparty. Liabilities are credits, so flipped to read. */
  const owedTo = (counterparty: string) => -books.balance(ke(), ACCOUNT_CODES.PAYABLE_PROVIDER, undefined, counterparty) || 0;

  describe('the posting that was never made', () => {
    it('writes a real double entry, not just a register row', () => {
      // THE BUG. Before this, the line below produced a ledger row a driver could read and nothing at all
      // in the books — the sister's own accounts said it owed the drivers nothing.
      const d = courier();
      const row = gate.driverPayout(d.did, 12.5);
      expect(row.entryId).toBeDefined();
      expect(owedTo(d.did)).toBe(12.5);
      // …and the expense is recognised in the same breath, which is what makes the entry balance.
      expect(books.balance(ke(), ACCOUNT_CODES.EXPENSE_PROVIDER_FEES)).toBe(12.5);
    });

    it('shows up in the one figure that says whether the sister could pay everybody', () => {
      // `coverage().owed` is the question "if everyone asked at once, could we?". A payable that never
      // posted meant that number was wrong by every driver payment the network had ever made.
      const before = books.coverage(ke()).owed;
      gate.driverPayout(courier().did, 40);
      expect(books.coverage(ke()).owed).toBe(before + 40);
    });
  });

  describe('who the money is owed to', () => {
    it('owes an INDEPENDENT courier directly', () => {
      const d = courier();
      gate.driverPayout(d.did, 10);
      expect(owedTo(d.did)).toBe(10);
    });

    it('owes a fleet driver’s earnings to their FLEET, never to them', () => {
      // We move parcels; we do not do payroll. The payable is keyed to who the network CONTRACTS with,
      // and paying the person at the wheel directly would make the network their employer.
      const { manager, driver } = employed();
      gate.driverPayout(driver.did, 30);
      expect(owedTo(manager.did)).toBe(30);
      expect(owedTo(driver.did)).toBe(0);
    });

    it('still gives the fleet driver their OWN earnings record', () => {
      // The half that must not be collapsed into the other. A fleet driver is entitled to know what their
      // day was worth even though the money goes to their employer — and a register keyed to the payee
      // would show them somebody else's work, or nothing at all.
      const { driver } = employed();
      const row = gate.driverPayout(driver.did, 30);
      expect(row.reference).toBe(driver.did);
      expect(row.refType).toBe('driver');
      expect(row.amount).toBe(30);
    });

    it('sends a fleet’s money to the sister that contracts the FLEET', () => {
      // Both are Kenyan here, so this pins the routing rather than a difference — the point is that the
      // entity comes from the fleet's own incorporation and not from wherever the parcel happened to move.
      const { manager, driver } = employed();
      expect(drivers.payeeOf(driver.did)).toEqual({ entityId: managers.entityIdOf(manager), payeeDid: manager.did });
    });
  });

  describe('what a driver is told about their own money', () => {
    it('keeps EARNED and PAID apart, because they stopped being the same thing', () => {
      // The jobs register's `paid` flag is set at DELIVERY — it means the network booked what it owes.
      // While nothing ever left the building that was harmless shorthand; the day settlement shipped it
      // became a false statement on the one screen somebody opens to check whether they were paid.
      const d = courier();
      gate.driverPayout(d.did, 60);
      const before = drivers.settlementFor(d.did, payouts);
      expect(before).toMatchObject({ payeeDid: d.did, paidToMe: true, settled: 0, inFlight: 0 });

      const [p] = payouts.runFor(ke()).raised;
      expect(drivers.settlementFor(d.did, payouts)).toMatchObject({ settled: 0, inFlight: 60 });
      payouts.settle(payouts.submit(p.payoutId).payoutId);
      expect(drivers.settlementFor(d.did, payouts)).toMatchObject({ settled: 60, inFlight: 0 });
    });

    it('tells a FLEET driver that the money goes to their fleet', () => {
      // The scope boundary made visible rather than left for somebody to discover on payday. A fleet
      // driver's earnings are real and theirs to read; the payment is their employer's to receive.
      const { manager, driver } = employed();
      gate.driverPayout(driver.did, 30);
      expect(drivers.settlementFor(driver.did, payouts)).toMatchObject({ payeeDid: manager.did, paidToMe: false });
    });
  });

  describe('the accrual is not the payment', () => {
    it('leaves the money still owed — nothing has left the building', () => {
      // The whole point of the next slice: this is a promise, not a payment. Custody is untouched, so a
      // sister with an empty account can accrue exactly as much as one with a full one.
      const d = courier();
      const held = books.coverage(ke()).held;
      gate.driverPayout(d.did, 25);
      expect(books.coverage(ke()).held).toBe(held);
      expect(owedTo(d.did)).toBe(25);
    });

    it('adds up across a day’s work rather than replacing it', () => {
      const d = courier();
      gate.driverPayout(d.did, 10);
      gate.driverPayout(d.did, 5.5);
      expect(owedTo(d.did)).toBe(15.5);
    });
  });
});
