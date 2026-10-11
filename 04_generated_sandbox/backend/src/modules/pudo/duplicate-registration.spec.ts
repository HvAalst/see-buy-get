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
import { PersonService } from './person.service';
import { AccountService } from './account.service';
import { OtpService, MAX_REFUSALS_PER_VERIFICATION } from './otp.service';
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
import { FxService } from '../../foundation/money/fx.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosError } from '../../foundation/http/glos-error';

/**
 * ONE NATIONAL ID, ONE PHONE, ONE LICENCE — asked of the real driver, shop and account services.
 *
 * The refusal now carries WHICH detail matched (`params.field`), because the apps have to say what is expected
 * next — sign in, check a number, ask a fleet to be joined by code — and they must not do it by parsing English.
 * And it is counted against the phone's verification: a refusal that names the field is also an answer about
 * somebody else's ID, so one verified phone may not ask about every ID there is.
 */
describe('registering somebody who is already registered', () => {
  let drivers: DriverService;
  let agents: AgentService;
  let accounts: AccountService;
  let otp: OtpService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        PersonService, AccountService, OtpService, AuthService,
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        EntityService, PresenceService, BooksService, FxService,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    moduleRef.get(EntityService).seed();
    moduleRef.get(FxService).seed();
    drivers = moduleRef.get(DriverService);
    agents = moduleRef.get(AgentService);
    accounts = moduleRef.get(AccountService);
    otp = moduleRef.get(OtpService);
  });

  /** The refusal as the app receives it: the code, and the field it names. */
  const refusal = (fn: () => unknown): { code: string; params?: Record<string, unknown>; message: string } => {
    try {
      fn();
    } catch (err) {
      if (err instanceof GlosError) return { code: err.code, params: err.params, message: err.message };
      throw err;
    }
    throw new Error('it was not refused');
  };

  const courier = (over: Record<string, unknown> = {}) =>
    drivers.register({ displayName: 'Peer D.', fullName: 'Peer Dan', nationalId: '27781234', mobile: '+254712345678', licenceClasses: ['motorcycle'], ...over } as never);

  describe('a driver', () => {
    it('is refused for the same phone typed another way — the old check counted these as two people', () => {
      courier();
      expect(refusal(() => courier({ nationalId: '99990000', mobile: '0712 345 678' }))).toMatchObject({ code: 'DUPLICATE', params: { field: 'phone', register: 'driver' } });
    });

    it('is refused for the same national ID written with dashes', () => {
      courier();
      expect(refusal(() => courier({ nationalId: '27-781-234', mobile: '+254700000999' }))).toMatchObject({ code: 'DUPLICATE', params: { field: 'nationalId' } });
    });

    it('frees a licence number when it is renewed under a new one, so the old number is nobody’s', () => {
      const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
      const heavy = (id: string, mobile: string, licenceNumber: string) =>
        drivers.register({ displayName: 'H', fullName: 'H H', nationalId: id, mobile, licenceClasses: ['truck'], licenceNumber, licenceExpiresAt: future, criminalRecordClear: true });
      const amos = heavy('1001', '+254700100100', 'DL-OLD');
      expect(refusal(() => heavy('1002', '+254700100200', 'dl old'))).toMatchObject({ params: { field: 'licence' } });
      drivers.renewLicence(amos.did, { number: 'DL-NEW', expiresAt: future });
      expect(heavy('1003', '+254700100300', 'DL-OLD').did).toBeDefined();
      expect(refusal(() => drivers.renewLicence(amos.did, { number: 'DL OLD', expiresAt: future }))).toMatchObject({ params: { field: 'licence' } });
    });
  });

  describe('a shop', () => {
    const shop = (over: Record<string, unknown> = {}) =>
      agents.register({
        shopName: 'Mama Sarah', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'blue gate',
        openingHours: { mon: { open: '08:00', close: '18:00' } }, shelf: { rows: 3, cols: 3 }, fullName: 'Sarah K', nationalId: '31112222', mobile: '+254722000111', deviceImei: 'IMEI-SARAH',
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true }, ...over,
      } as never);

    it('names the device a second shop is being opened from', () => {
      shop();
      expect(refusal(() => shop({ nationalId: '40000000', mobile: '+254722000999' }))).toMatchObject({ code: 'DUPLICATE', params: { field: 'device', register: 'shop' } });
    });

    it('does not stop a registered DRIVER opening a shop — one person, many roles', () => {
      courier({ nationalId: '31112222', mobile: '+254722000111' });
      expect(shop().did).toBeDefined();
    });
  });

  describe('through the sign-up form', () => {
    const verify = (phone: string) => otp.verify(phone, otp.request(phone).code);
    const signup = (phone: string, nationalId: string, email: string) =>
      accounts.signup({ role: 'driver', email, password: 'mkate-na-chai-1', phone, profile: { driver: { displayName: 'P', fullName: 'P P', nationalId, mobile: phone, licenceClasses: ['motorcycle'] } } });

    it('spends the phone’s verification after a few refusals, so one phone cannot ask about every ID', () => {
      verify('+254733000001');
      signup('+254733000001', '50000001', 'first@sbg.test');

      const prober = '+254733000002';
      verify(prober);
      for (let i = 1; i < MAX_REFUSALS_PER_VERIFICATION; i++) {
        expect(refusal(() => signup(prober, '50000001', `p${i}@sbg.test`))).toMatchObject({ params: { field: 'nationalId' } });
      }
      expect(refusal(() => signup(prober, '50000001', 'last@sbg.test'))).toMatchObject({ code: 'DUPLICATE' });
      // Spent: the next attempt is asked to verify the phone again rather than answered.
      expect(refusal(() => signup(prober, '60000001', 'next@sbg.test'))).toMatchObject({ code: 'PHONE_NOT_VERIFIED' });
      // A new code for the same phone waits out the resend cooldown — the clock is moved past it, not the rule.
      const later = Date.now() + 61_000;
      const clock = jest.spyOn(Date, 'now').mockReturnValue(later);
      verify(prober);
      expect(signup(prober, '60000001', 'next@sbg.test').did).toBeDefined();
      clock.mockRestore();
    });

    it('names an email that already has an account', () => {
      verify('+254733000003');
      signup('+254733000003', '50000003', 'taken@sbg.test');
      verify('+254733000004');
      expect(refusal(() => signup('+254733000004', '50000004', 'taken@sbg.test'))).toMatchObject({ code: 'DUPLICATE', params: { field: 'email' } });
    });
  });
});
