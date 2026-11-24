import { Test, TestingModule } from '@nestjs/testing';
import { HubTransferService } from './hub-transfer.service';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { BagClosureService } from './bag-closure.service';
import { RoutingService } from './routing.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { VendorService } from './vendor.service';
import { ParcelService, parcelCurrency, vendorOrderRowOf } from './parcel.service';
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
import { countryOfSite, crossingsOn, requireCountryCode, unionPassageOn } from './country';
import { BORDER_DWELL_H, NETWORK_JURISDICTION } from './pudo.config';
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
import { FX_SPREAD_PCT, FxService } from '../../foundation/money/fx.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { PayeeStandingRegistrar } from './payee-standing';
import { PartnerLedgerService } from './partner-ledger.service';
import { PaymentHubService } from '../../foundation/payment-hub/payment-hub.service';
import { STAND_IN_ANSWERS_AFTER_MS } from '../../foundation/payment-hub/stand-in.provider';
import { contentPhotos, evidencePhotos } from '../../../test/content-photo';
import { BorderRouteService } from './border-route.service';
import { JourneyPlanService } from './journey-plan.service';
import { ROAD_ROUTES } from './road-routes.token';
import { GlosError } from '../../foundation/http/glos-error';

/** 2026-11-23 — the road route from the Netherlands to Bulgaria, switched on or off by a test (step 3b): the routing asks it. */
const ROAD = { from: 'NL', to: 'BG', hubMdpId: 'mdp-sof', hubName: 'Sofia Central Hub', fleetDid: 'did:fleet:balkan', fleetName: 'Balkan Line', prices: { S: 18, M: 27.5, L: 39, currency: 'EUR' } };
let roadOn = false;
/** 2026-11-23 — the route's central hub and fleet, as a test registers them (step 3c). */
let roadHub = ROAD.hubMdpId;
let roadFleet = ROAD.fleetDid;
const roads = {
  roadBookable: (from: string, to: string) => {
    if (!roadOn || from !== 'NL' || to !== 'BG') throw new GlosError('INVALID_STATE', 'Parcels to Bulgaria are not sent from Netherlands yet: no route between them is on');
    return { ...ROAD, hubMdpId: roadHub, fleetDid: roadFleet, prices: { ...ROAD.prices } };
  },
};

/**
 * Crossing a border — the fact the network could not previously state.
 *
 * Every site used to resolve to the deployment's own jurisdiction by construction, so a shop in Addis
 * Ababa came out contracted to the Kenyan sister and a route to it looked exactly like a route across
 * town. These tests pin the three things that changed: a site says which country it is in, the sister
 * follows from THAT, and a journey between two countries says where it crosses — and refuses to invent
 * a price when the two ends are paid in different money.
 */
describe('crossing a border', () => {
  let agents: AgentService;
  let mdps: MdpService;
  let routing: RoutingService;
  let corridors: CorridorService;
  let vendors: VendorService;
  let entities: EntityService;
  let presence: PresenceService;
  let fx: FxService;
  let parcels: ParcelService;
  let gate: WalletGateService;
  let books: BooksService;
  let managers: FleetManagerService;
  let drivers: DriverService;
  let partners: PartnerLedgerService;
  let hub: PaymentHubService;
  let dispatch: DispatchService;
  let totes: ToteService;
  let vehicles: VehicleService;
  let fleetSvc: FleetService;
  let journeys: JourneyPlanService;

  /** Round 30 — a store's real photo of the contents, as the order door requires: one we hold, its own. */
  let photoOf: (vendorId: string) => string;
  /** Round 31 — an evidence photo we hold, uploaded by the party the act checks. */
  let photoBy: (ownerDid: string) => string;
  /** 2026-11-24 — the module itself, for the services a test reaches for once (the hub handover, slice 4). */
  let moduleRefNow: TestingModule;
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, BagClosureService, HubTransferService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        EntityService, PresenceService, BooksService, FxService, PartnerLedgerService, PaymentHubService,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
        { provide: BorderRouteService, useValue: roads },
        { provide: ROAD_ROUTES, useValue: roads },
        JourneyPlanService,
      ],
    }).compile();
    moduleRefNow = moduleRef;
    roadOn = false;
    roadHub = ROAD.hubMdpId;
    roadFleet = ROAD.fleetDid;
    dispatch = moduleRef.get(DispatchService);
    totes = moduleRef.get(ToteService);
    vehicles = moduleRef.get(VehicleService);
    fleetSvc = moduleRef.get(FleetService);
    journeys = moduleRef.get(JourneyPlanService);
    photoBy = evidencePhotos(moduleRef);
    photoOf = contentPhotos(moduleRef);
    entities = moduleRef.get(EntityService);
    presence = moduleRef.get(PresenceService);
    entities.seed(); // compile() runs no lifecycle hooks — the sisters are seeded by hand, as at boot
    fx = moduleRef.get(FxService);
    fx.seed();
    agents = moduleRef.get(AgentService);
    mdps = moduleRef.get(MdpService);
    routing = moduleRef.get(RoutingService);
    corridors = moduleRef.get(CorridorService);
    vendors = moduleRef.get(VendorService);
    parcels = moduleRef.get(ParcelService);
    gate = moduleRef.get(WalletGateService);
    books = moduleRef.get(BooksService);
    managers = moduleRef.get(FleetManagerService);
    drivers = moduleRef.get(DriverService);
    partners = moduleRef.get(PartnerLedgerService);
    hub = moduleRef.get(PaymentHubService);
    books.reset(); // each test starts on clean books — the money is derived from them
  });

  let seq = 0;
  const hours = { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null };

  function shop(shopName: string, zone: string, location: { lat: number; lng: number }, country?: string, pricePerParcel?: number) {
    seq += 1;
    return agents.register({
      shopName, zone, country, location, pricePerParcel, landmark: 'by the road', openingHours: hours, shelf: { rows: 3, cols: 3 },
      fullName: `${shopName} owner`, nationalId: `ID-${seq}`, mobile: `+2547000${seq}`, deviceImei: `IMEI-${seq}`,
      requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    });
  }

  const NAIROBI = { lat: -1.286, lng: 36.817 };

  /** A Kenyan shop approved and topped up: a walk-up at our counter is taken in for cash (4b refuses anything else). */
  function fundedShop(shopName: string) {
    const ke = shop(shopName, 'Nairobi', NAIROBI);
    agents.submitKyc(ke.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'tl.jpg', shopPhotoRefs: ['front.jpg'] });
    agents.decideKyc(ke.did, true, undefined, undefined, '2099-12-31');
    gate.topUp(ke.did, 50);
    return agents.get(ke.did);
  }
  const ADDIS = { lat: 9.03, lng: 38.74 };
  const MOYALE_KE = { lat: 3.52, lng: 39.05 }; // the Kenyan side of the border post
  const HAWASSA = { lat: 7.06, lng: 38.48 };

  describe('a site says which country it is in', () => {
    it('reads a two-letter code, and refuses anything that is not one', () => {
      expect(requireCountryCode('et')).toBe('ET');
      expect(requireCountryCode('  ke  ')).toBe('KE');
      expect(requireCountryCode(undefined)).toBe(NETWORK_JURISDICTION);
      expect(requireCountryCode('', 'ET')).toBe('ET'); // an explicit fallback, for a dock inheriting its store's
      expect(() => requireCountryCode('Ethiopia')).toThrow(/two-letter code/);
      expect(() => requireCountryCode('E')).toThrow(/two-letter code/);
    });

    it('reads a record written before sites had a country as being in the home country', () => {
      // The truth at the time: one jurisdiction, every site inside it. Defaulting on READ means an old
      // record and a new one answer the same question the same way, with nothing to backfill.
      expect(countryOfSite({})).toBe(NETWORK_JURISDICTION);
      expect(countryOfSite({ country: 'et' })).toBe('ET');
    });
  });

  describe('taking goods in where we cannot bill', () => {
    /**
     * The heart of the ladder. A country we only MATCH in can hold goods and prove it held them, and not
     * one shilling of ours moves there. The failure this guards is the opposite of a refusal: a take-in
     * that quietly posts a fee into a company that does not exist in that country, or promises a cover
     * nothing can pay.
     */
    const takeIn = (agentDid: string, parcelId: string, mode?: 'cash' | 'credit') =>
      parcels.accept({ parcelId, agentDid, destZone: 'DarEsSalaam2', size: 'M', senderMobile: '+255700111', receiverMobile: '+255700222', dropoffPhotoRef: photoBy(agentDid), ...(mode ? { paymentMode: mode } : {}) } as never);

    it('records the promise as OURS and posts, where a sister carries it', () => {
      const ke = fundedShop('Mama Sarah');
      const keEntity = entities.requireForJurisdiction('KE').entityId;
      const before = books.balance(keEntity, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, ke.did);
      const parcel = parcels.accept({ parcelId: 'PUD-KE-1', agentDid: ke.did, destZone: 'Kisumu', size: 'M', senderMobile: '+254700111', receiverMobile: '+254700222', dropoffPhotoRef: photoBy(ke.did) } as never);
      expect(parcel.takeInPromise).toBe('ours');
      expect(parcel.collectingEntityId).toBe(keEntity);
      // Taken in for cash: the shop's float is charged the parcel, on the sister that contracts it.
      expect(books.balance(keEntity, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, ke.did)).not.toBe(before);
    });

    it('takes goods in under the CARRIER’s promise, and books nothing at all', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const tz = shop('Dar Duka', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      const parcel = takeIn(tz.did, 'PUD-TZ-1', 'credit');

      expect(parcel.takeInPromise).toBe('theirs');
      // No sister is party to it, so none is named. A collecting entity here would be a posting into a
      // company that does not operate in Tanzania.
      expect(parcel.collectingEntityId).toBeUndefined();
      // …and the custody chain is there, which is the whole reason to be in the country at all.
      expect(parcel.custody?.[0]?.holderId).toBe(tz.did);
      expect(parcel.status).toBe('At_PUDO');
    });

    it('2026-11-20 — under a Partnered country’s partner, the partner owes the shop its take-in at its own figure, off our books; a void takes it back (the payments plan, 3a)', async () => {
      const partner = entities.createCompany({ kind: 'partner', jurisdiction: 'UG', name: 'Kampala Courier Ltd' }, 'Amina');
      entities.setAmounts(partner.entityId, { labourFee: 1500, wholesale: 9000 }, 'Amina');
      entities.activate(partner.entityId, 'Brian');
      presence.set({ jurisdiction: 'UG', level: 'partnered' });
      const ug = shop('Kampala Duka', 'Kampala', { lat: 0.35, lng: 32.58 }, 'UG');
      // Paid by phone first (4b): the prompt, paid, then the take-in.
      const asked = await parcels.askPhonePayment(ug.did, 'PUD-UG-1', '+256700111000');
      await hub.settle(asked.paymentId, Date.now() + STAND_IN_ANSWERS_AFTER_MS);
      const parcel = parcels.accept({ parcelId: 'PUD-UG-1', agentDid: ug.did, destZone: 'Kampala2', size: 'M', paymentMode: 'prepaid', paymentId: asked.paymentId, senderMobile: '+256700111', receiverMobile: '+256700222', dropoffPhotoRef: photoBy(ug.did) } as never);

      expect(parcel.takeInPromise).toBe('theirs');
      expect(parcel.intakeLabour).toBe(1500);
      expect(partners.ledgerOf(partner.entityId)).toMatchObject({ partnerName: 'Kampala Courier Ltd', currency: 'UGX', owed: 1500, byPayee: [{ payeeId: ug.did, payeeKind: 'shop', amount: 1500, steps: 1 }] });
      expect(partners.owedTo([ug.did]).totals).toEqual([{ partnerName: 'Kampala Courier Ltd', currency: 'UGX', amount: 1500 }]);
      // None of it on any book of ours: the partner pays, we keep the record.
      expect(books.journal({ ref: 'PUD-UG-1' })).toEqual([]);

      parcels.void('PUD-UG-1', ug.did, photoBy(ug.did));
      // …and the sender's payment given back to the phone it came from, from the partner's account (P4-d).
      await new Promise((r) => setImmediate(r));
      expect(hub.paymentsOf(partner.entityId).find((x) => x.kind === 'refund')).toMatchObject({ refundOf: asked.paymentId, state: 'paid', amount: 9000, currency: 'UGX', phoneEnds: '000' });
      const after = partners.ledgerOf(partner.entityId);
      expect(after.owed).toBe(0);
      expect(after.byPayee).toEqual([]);
      expect(after.lines.map((l) => [l.amount, l.takenBack ?? false]).sort()).toEqual([[-1500, true], [1500, false]]);
      expect(books.journal({ ref: 'PUD-UG-1' })).toEqual([]);
    });

    /* 2026-11-20 — P4-g, the owner: "as recommended but we mention for parcels that no one of sbg facilitates the distribution of
     * the pay among the beneficiaries (hubs, last leg drivers, pudo)". */
    it('where nobody holds money (Matched): the counter is told, and the label says, that the carrier pays everyone who handles it', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const tz = shop('Dar Duka CP', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      expect(parcels.takeInTerms(tz.did)).toMatchObject({ promise: 'theirs', carrierPays: true });
      const parcel = parcels.accept({ parcelId: 'PUD-TZ-CP', agentDid: tz.did, destZone: 'DarEsSalaam2', size: 'M', paymentMode: 'prepaid', senderMobile: '+255700111', receiverMobile: '+255700222', dropoffPhotoRef: photoBy(tz.did) } as never);
      expect(parcel.carrierPays).toBe(true);
      expect(parcel.label?.svg).toContain('Carrier pays all who handle it');
      expect(parcels.labelZplFor('PUD-TZ-CP')).toContain('Carrier pays all who handle it');
      // Where a partner pays its hands, and at our own counters, not said.
      const ke = fundedShop('Mama Sarah CP');
      expect(parcels.takeInTerms(ke.did).carrierPays).toBeUndefined();
      const ours = parcels.accept({ parcelId: 'PUD-KE-CP', agentDid: ke.did, destZone: 'Kisumu', size: 'M', senderMobile: '+254700111', receiverMobile: '+254700222', dropoffPhotoRef: photoBy(ke.did) } as never);
      expect(ours.carrierPays).toBeUndefined();
      expect(ours.label?.svg).not.toContain('Carrier pays');
      const partner = entities.createCompany({ kind: 'partner', jurisdiction: 'UG', name: 'Kampala Courier CP' }, 'Amina');
      entities.setAmounts(partner.entityId, { wholesale: 9000 }, 'Amina');
      entities.activate(partner.entityId, 'Brian');
      presence.set({ jurisdiction: 'UG', level: 'partnered' });
      const ug = shop('Kampala Duka CP', 'Kampala', { lat: 0.35, lng: 32.58 }, 'UG');
      expect(parcels.takeInTerms(ug.did).carrierPays).toBeUndefined();
    });

    it('takes nothing as owed under the carrier’s promise where no partner contracts — a country only Matched', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const tz = shop('Dar Duka 5', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      const parcel = parcels.accept({ parcelId: 'PUD-TZ-5', agentDid: tz.did, destZone: 'DarEsSalaam2', size: 'M', paymentMode: 'prepaid', senderMobile: '+255700111', receiverMobile: '+255700222', dropoffPhotoRef: photoBy(tz.did) } as never);
      expect(parcel.takeInPromise).toBe('theirs');
      expect(parcel.intakeLabour).toBeUndefined();
      expect(partners.owedTo([tz.did])).toEqual({ lines: [] });
    });

    /*
     * 2026-11-20 — THE PAYMENTS PLAN, 4b: a walk-up in a partner's country is paid by phone, into the partner's account, before
     * its label (P3-c, P4-a); our own counters take cash; where nobody holds money yet, as before (P4-g, asked).
     */
    describe('paid by phone, before the label (4b)', () => {
      async function partnerCounter(tag: string, list: Record<string, number> = { labourFee: 1500, wholesale: 9000 }) {
        const partner = entities.createCompany({ kind: 'partner', jurisdiction: 'UG', name: `Kampala Courier ${tag}` }, 'Amina');
        entities.setAmounts(partner.entityId, list, 'Amina');
        entities.activate(partner.entityId, 'Brian');
        presence.set({ jurisdiction: 'UG', level: 'partnered' });
        const ug = shop(`Kampala Duka ${tag}`, 'Kampala', { lat: 0.35, lng: 32.58 }, 'UG');
        const walkUp = (parcelId: string, extra: Record<string, unknown> = {}) => ({ parcelId, agentDid: ug.did, destZone: 'Kampala2', size: 'M', paymentMode: 'prepaid', senderMobile: '+256700111', receiverMobile: '+256700222', dropoffPhotoRef: photoBy(ug.did), ...extra }) as never;
        return { partner, ug, walkUp };
      }
      const paid = async (agentDid: string, parcelId: string, phone = '+256700111000') => {
        const asked = await parcels.askPhonePayment(agentDid, parcelId, phone);
        return hub.settle(asked.paymentId, Date.now() + STAND_IN_ANSWERS_AFTER_MS);
      };

      it('the counter is told: the sender pays by phone, to the partner, its own price for a parcel — and nothing until the partner has set one', async () => {
        const { ug, partner } = await partnerCounter('T');
        expect(parcels.takeInTerms(ug.did)).toMatchObject({ promise: 'theirs', cashAccepted: false, currency: 'UGX', payByPhone: { to: partner.name, price: 9000, currency: 'UGX' } });
        // A partner that has set no price of its own: no figure in nobody's money, and nothing taken in.
        const bare = await partnerCounter('B', { labourFee: 1500 });
        expect(parcels.takeInTerms(bare.ug.did).payByPhone).toBeUndefined();
        expect(() => parcels.accept(bare.walkUp('PUD-UG-B1'))).toThrow(/has not set what a parcel costs yet/);
        await expect(parcels.askPhonePayment(bare.ug.did, 'PUD-UG-B1', '+256700111000')).rejects.toThrow(/does not pay by phone/);
        // Our own counter takes cash, and is not told of a phone.
        const ke = shop('Mama Sarah Cash', 'Nairobi', NAIROBI);
        expect(parcels.takeInTerms(ke.did).payByPhone).toBeUndefined();
        await expect(parcels.askPhonePayment(ke.did, 'PUD-KE-P1', '+254700111000')).rejects.toThrow(/does not pay by phone/);
      });

      it('refused before anything is kept: no payment, one asked elsewhere or for another parcel, one still waiting, one declined, one for less than the price', async () => {
        const { ug, walkUp, partner } = await partnerCounter('R');
        const other = shop('Kampala Duka R2', 'Kampala', { lat: 0.36, lng: 32.59 }, 'UG');
        expect(() => parcels.accept(walkUp('PUD-UG-R1'))).toThrow('The sender pays by phone first: ask for the payment, then take the parcel in');
        const elsewhere = await paid(other.did, 'PUD-UG-R1');
        expect(() => parcels.accept(walkUp('PUD-UG-R1', { paymentId: elsewhere.paymentId }))).toThrow('No payment for PUD-UG-R1 was asked at this counter: ask for it again');
        const forAnother = await paid(ug.did, 'PUD-UG-R9');
        expect(() => parcels.accept(walkUp('PUD-UG-R1', { paymentId: forAnother.paymentId }))).toThrow(/No payment for PUD-UG-R1 was asked at this counter/);
        // A number paid for at one counter is paid, for this partner, at every counter: not asked twice.
        await expect(parcels.askPhonePayment(ug.did, 'PUD-UG-R1', '+256700111000')).rejects.toThrow('PUD-UG-R1 is paid already');
        const waiting = await parcels.askPhonePayment(ug.did, 'PUD-UG-R4', '+256700111000');
        expect(() => parcels.accept(walkUp('PUD-UG-R4', { paymentId: waiting.paymentId }))).toThrow('The payment is still waiting on the phone ending 000');
        const declined = await parcels.askPhonePayment(ug.did, 'PUD-UG-R2', '+256700110000');
        await hub.settle(declined.paymentId, Date.now() + STAND_IN_ANSWERS_AFTER_MS);
        expect(() => parcels.accept(walkUp('PUD-UG-R2', { paymentId: declined.paymentId }))).toThrow('The payment did not go through: ask for it again');
        // Its price went up after the sender paid: asked again, at the new price.
        const cheap = await paid(ug.did, 'PUD-UG-R3');
        entities.setAmounts(partner.entityId, { wholesale: 9500 }, 'Amina');
        expect(() => parcels.accept(walkUp('PUD-UG-R3', { paymentId: cheap.paymentId }))).toThrow('The payment was 9000, and a parcel costs 9500 now: ask for the payment again');
        // None of it kept: no parcel, nothing owed.
        for (const id of ['PUD-UG-R1', 'PUD-UG-R2', 'PUD-UG-R3', 'PUD-UG-R4']) expect(() => parcels.get(id)).toThrow();
        expect(partners.owedTo([ug.did])).toEqual({ lines: [] });
      });

      it('paid: taken in with its label, the payment kept with it — one payment, one parcel; asked again for a parcel taken in, refused', async () => {
        const { ug, walkUp, partner } = await partnerCounter('P');
        const pay = await paid(ug.did, 'PUD-UG-P1');
        const parcel = parcels.accept(walkUp('PUD-UG-P1', { paymentId: pay.paymentId }));
        expect(parcel).toMatchObject({ paidStatus: 'ParcelPaid', paidByPhone: { paymentId: pay.paymentId, amount: 9000, currency: 'UGX', test: true, partnerEntityId: partner.entityId } });
        expect(parcel.label?.svg).toContain('PUD-UG-P1');
        expect(parcels.labelZplFor('PUD-UG-P1')).toContain('PUD-UG-P1');
        expect(hub.get(pay.paymentId)?.usedFor).toBe('PUD-UG-P1');
        // Not for a second parcel, and no prompt for a parcel already taken in.
        expect(() => parcels.accept(walkUp('PUD-UG-P2', { paymentId: pay.paymentId }))).toThrow(/No payment for PUD-UG-P2 was asked at this counter/);
        await expect(parcels.askPhonePayment(ug.did, 'PUD-UG-P1', '+256700111000')).rejects.toThrow('Parcel PUD-UG-P1 already exists');
        // The counter reads its own payment; another counter does not.
        expect((await parcels.phonePaymentState(ug.did, pay.paymentId)).usedFor).toBe('PUD-UG-P1');
        const other = shop('Kampala Duka P2', 'Kampala', { lat: 0.36, lng: 32.59 }, 'UG');
        await expect(parcels.phonePaymentState(other.did, pay.paymentId)).rejects.toThrow('No payment asked at this counter has that number');
        // None of it on any book of ours.
        expect(books.journal({ ref: 'PUD-UG-P1' })).toEqual([]);
      });

      it('our fee: a percentage of every parcel’s payment, counted as it is paid, owed by the partner — and given back with a refund', async () => {
        const { ug, walkUp, partner } = await partnerCounter('F');
        hub.setFee(partner.entityId, 3, 'Staff Ann');
        const first = await paid(ug.did, 'PUD-UG-F1');
        expect(first.fee).toEqual({ pct: 3, amount: 270 });
        parcels.accept(walkUp('PUD-UG-F1', { paymentId: first.paymentId }));
        const second = await paid(ug.did, 'PUD-UG-F2');
        parcels.accept(walkUp('PUD-UG-F2', { paymentId: second.paymentId }));
        expect(hub.feeOwed(partner.entityId)).toBe(540);
        expect(await hub.accountView(partner.entityId)).toMatchObject({ feePct: 3, feeSetBy: 'Staff Ann', feeOwed: 540, balance: 18000 });
        // A try by our staff is no turnover.
        const tried = await hub.tryPayment(partner.entityId, { phone: '+256700111000', amount: 1000 }, 'Staff Ann');
        await hub.settle(tried.paymentId, Date.now() + STAND_IN_ANSWERS_AFTER_MS);
        expect(hub.feeOwed(partner.entityId)).toBe(540);
        // Voided: the payment given back, and our fee on it with it.
        parcels.void('PUD-UG-F2', ug.did, photoBy(ug.did));
        await new Promise((r) => setImmediate(r));
        expect(hub.feeOwed(partner.entityId)).toBe(270);
      });

      /* 2026-11-21 — the payments plan, 5c: a cancel used to keep the money; only a void gave it back. */
      it('called off at the counter, not only voided: the payment given back to the phone it came from, our fee with it', async () => {
        const { ug, walkUp, partner } = await partnerCounter('C');
        hub.setFee(partner.entityId, 3, 'Staff Ann');
        const pay = await paid(ug.did, 'PUD-UG-C1');
        parcels.accept(walkUp('PUD-UG-C1', { paymentId: pay.paymentId }));
        expect(hub.feeOwed(partner.entityId)).toBe(270);
        parcels.cancel('PUD-UG-C1', 'ops', 'the sender changed their mind');
        await new Promise((r) => setImmediate(r));
        expect(parcels.get('PUD-UG-C1').status).toBe('Voided');
        expect(hub.feeOwed(partner.entityId)).toBe(0);
      });

      it('where a partner contracts, nothing is taken in unpaid — not even on a server without the payment hub', async () => {
        const { walkUp } = await partnerCounter('N');
        const held = parcels as unknown as { hub?: unknown };
        const real = held.hub;
        held.hub = undefined;
        try {
          expect(() => parcels.accept(walkUp('PUD-UG-N1'))).toThrow(/Payment by phone is not set up on this server: nothing is taken in under Kampala Courier N/);
          expect(() => parcels.get('PUD-UG-N1')).toThrow();
        } finally {
          held.hub = real;
        }
      });

      it('our own counter takes cash: a walk-up sent as anything else is refused before anything is kept', () => {
        const ke = fundedShop('Mama Sarah Prepaid');
        expect(() => parcels.accept({ parcelId: 'PUD-KE-PP1', agentDid: ke.did, destZone: 'Nairobi2', size: 'M', paymentMode: 'prepaid', senderMobile: '+254700111', receiverMobile: '+254700222', dropoffPhotoRef: photoBy(ke.did) } as never)).toThrow('At Mama Sarah Prepaid the sender pays in cash: take it in as a cash parcel');
        expect(() => parcels.get('PUD-KE-PP1')).toThrow();
        expect(gate.entries({ did: ke.did, type: 'LABOR_PAYOUT' })).toEqual([]);
      });
    });

    it('does not take the whole shop list down with it', () => {
      // Found by driving it: reading a shop computes its balance, which asks who contracts it — so ONE
      // shop in a matching-only country made GET /agents answer 403 for every shop in the network. A
      // money question reached from a READ path must answer, not refuse.
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const tz = shop('Dar Duka 4', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      const ke = shop('Mama Sarah 2', 'Nairobi', NAIROBI);

      // NULL, not zero: a shop we hold no money for does not have an empty float, it has no float.
      expect(agents.balance(tz.did)).toBeNull();
      expect(agents.balance(ke.did)).toBe(0);
      expect(agents.list().map((a) => a.did)).toEqual(expect.arrayContaining([tz.did, ke.did]));
    });
    it('activates a shop we hold no float for on approval — "unfunded" is not a step it can ever leave', () => {
      // Found by driving it: approved, then stuck forever with "top up your wallet first", because only a
      // float reaching the threshold ever moved a shop to ACTIVE.
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const tz = shop('Dar Duka Active', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      const docs = { idCopyRef: 'id.jpg', tradingLicenceRef: 'tl.jpg', shopPhotoRefs: ['front.jpg'] };
      agents.submitKyc(tz.did, docs);
      expect(agents.decideKyc(tz.did, true, undefined, undefined, '2099-12-31').status).toBe('ACTIVE');
      expect(agents.canScan(tz.did)).toBe(true);

      // …and a shop with a float still waits for its first top-up, exactly as before.
      const ke = shop('Mama Sarah Unfunded', 'Nairobi', NAIROBI);
      agents.submitKyc(ke.did, docs);
      expect(agents.decideKyc(ke.did, true, undefined, undefined, '2099-12-31').status).toBe('APPROVED_UNFUNDED');
    });

    it('refuses CASH at a counter whose promise is the carrier’s', () => {
      // Cash at the counter is OUR cash: it consumes a platform credit and posts against a float we do
      // not hold there. The carrier prices and collects its own work.
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const tz = shop('Dar Duka 2', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      expect(() => takeIn(tz.did, 'PUD-TZ-2', 'cash')).toThrow(/cannot handle cash/i);
    });

    it('refuses a take-in outright where the network does not operate', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const tz = shop('Dar Duka 3', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      // The country moves back down while the shop stands open — which is why the door is asked at the
      // COUNTER and not trusted from registration.
      presence.set({ jurisdiction: 'TZ', level: 'observed' });
      expect(() => takeIn(tz.did, 'PUD-TZ-3', 'credit')).toThrow(/does not operate in TZ/);
    });
  });

  describe('P2b — the quote, the mint and the freight refuse at the door', () => {
    it('refuses to PRICE a shipment where we cannot charge anyone — in words about charging, not about a float', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const a = shop('Dar Duka Q1', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      const b = shop('Dar Duka Q2', 'DarEsSalaam', { lat: -6.8, lng: 39.28 }, 'TZ');
      let caught: Error | undefined;
      try {
        routing.quoteShipment(a.did, b.did);
      } catch (e) {
        caught = e as Error;
      }
      expect(caught?.message).toMatch(/cannot charge customers in this country/);
      expect(caught?.message).toMatch(/TZ: matching only/);
      // The late refusal this replaces spoke about holding money — true, and no use to a buyer.
      expect(caught?.message).not.toMatch(/float/);
    });

    it('asks again at the MINT, because a held quote is redeemed without being priced again', () => {
      const a = shop('Mama Sarah Q3', 'Nairobi', NAIROBI);
      const b = shop('Mama Sarah Q4', 'Nairobi', { lat: -1.3, lng: 36.85 });
      const keEntity = entities.requireForJurisdiction('KE').entityId;
      const heldQuote = { nodes: [{ country: 'KE' }], sellerEntityId: keEntity, crossesBorder: false, crossings: [] } as never;
      // The country moved down between the quote and its redemption.
      presence.set({ jurisdiction: 'KE', level: 'matched' });
      expect(() =>
        parcels.createConsumerSend({ senderPersonDid: 'did:p', senderPhoneHash: 'h', receiverMobile: '+254700999', originAgentDid: a.did, destAgentDid: b.did, dimensionsCm: { l: 10, w: 10, h: 10 }, weightKg: 1, quote: heldQuote }),
      ).toThrow(/cannot charge customers in this country/);
    });
  });

  describe('P4 — the journey decides who sells, and a foreign leg is a service bought', () => {
    const BERLIN = { lat: 52.52, lng: 13.405 };

    it('sells a journey into a country we only match, the last stop bought by the selling sister', () => {
      presence.set({ jurisdiction: 'DE', level: 'matched' });
      const ke = shop('Nairobi CBD P4', 'Nairobi', NAIROBI, 'KE', 55);
      const de = shop('Kiez Kiosk', 'Berlin', BERLIN, 'DE', 2);
      corridors.addCorridor({ name: 'Nairobi–Berlin', originZone: 'Nairobi', destZone: 'Berlin' });
      const keEntity = entities.requireForJurisdiction('KE').entityId;

      const quote = routing.quoteShipment(ke.did, de.did);
      expect(quote.sellerEntityId).toBe(keEntity);
      expect(quote.currency).toBe('KES');
      // The Kenyan sister owes the Berlin kiosk its own price, in its own money.
      expect(quote.nodes[1]).toMatchObject({ purchased: true, entityId: keEntity, currency: 'EUR', nativeFee: 2 });
      expect(quote.nodes[0].purchased).toBeUndefined();
    });

    it('refuses to price where the rate book cannot convert the currency, rather than silently pricing in dollars', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const ke = shop('Nairobi CBD P4b', 'Nairobi', NAIROBI, 'KE', 55);
      const tz = shop('Dar Duka P4', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      corridors.addCorridor({ name: 'Nairobi–Dar', originZone: 'Nairobi', destZone: 'DarEsSalaam' });
      expect(() => routing.quoteShipment(ke.did, tz.did)).toThrow(/No exchange rate for TZS/);
    });

    it('books the work of a shop with no sister as a debt of the seller — and nothing where nobody of ours sold it', () => {
      presence.set({ jurisdiction: 'DE', level: 'matched' });
      const de = shop('Kiez Kiosk 2', 'Berlin', BERLIN, 'DE', 2);
      const keEntity = entities.requireForJurisdiction('KE').entityId;

      expect(gate.payLabour(de.did, 5, 'PUD-P4-1', 'parcel', keEntity)).not.toBeNull();
      const owed = books.outstanding(keEntity, ACCOUNT_CODES.PAYABLE_PROVIDER, 'KES').find((o) => o.counterparty === de.did);
      expect(owed?.amount).toBe(5);
      // The carrier's promise: nobody of ours owes this handover, so nothing is invented.
      expect(gate.payLabour(de.did, 3, 'MAN-P4', 'manifest')).toBeNull();
    });

    it('takes that debt back when the take-in is undone — the shop has no company of ours to post to, so the seller owes it no more', () => {
      // Found 2026-10-27: a store's parcel voided or called off at such a shop threw, because the take-back posted to the
      // shop's own company, which does not exist where we only match.
      presence.set({ jurisdiction: 'DE', level: 'matched' });
      const de = shop('Kiez Kiosk 6', 'Berlin', BERLIN, 'DE', 2);
      const keEntity = entities.requireForJurisdiction('KE').entityId;
      gate.payLabour(de.did, 5, 'PUD-P4-2', 'parcel', keEntity);

      expect(gate.clawbackLabour(de.did, 5, 'PUD-P4-2', keEntity)).not.toBeNull();
      const owed = books.outstanding(keEntity, ACCOUNT_CODES.PAYABLE_PROVIDER, 'KES').find((o) => o.counterparty === de.did);
      expect(owed?.amount ?? 0).toBe(0);
      expect(books.balance(keEntity, ACCOUNT_CODES.EXPENSE_PROVIDER_FEES)).toBe(0);
      expect(books.balances(keEntity)).toEqual({ balanced: true, drift: 0 });
      // Nothing owed under the carrier's promise, so nothing to take back.
      expect(gate.clawbackLabour(de.did, 3, 'PUD-P4-3')).toBeNull();
    });

    it('owes, but does not pay out, where money may not leave to a supplier', () => {
      presence.set({ jurisdiction: 'DE', level: 'matched' });
      const de = shop('Kiez Kiosk 3', 'Berlin', BERLIN, 'DE', 2);
      const ke = shop('Nairobi CBD P4c', 'Nairobi', NAIROBI, 'KE', 55);
      const registrar = new PayeeStandingRegistrar({ registerPayeeGate: () => undefined } as never, agents, presence, entities);
      expect(registrar.reasonNotToPay(de.did)).toMatch(/cannot pay out in DE yet/);
      expect(registrar.reasonNotToPay(ke.did)).toBeNull();
      expect(registrar.reasonNotToPay('did:fleet:someone')).toBeNull(); // hubs, fleets, couriers stand where a sister does
    });

    it('tells the counter, before accepting, that the work is owed but not paid out here', () => {
      presence.set({ jurisdiction: 'DE', level: 'matched' });
      const de = shop('Kiez Kiosk 4', 'Berlin', BERLIN, 'DE', 2);
      const keEntity = entities.requireForJurisdiction('KE');
      const terms = parcels.intakeTermsFor({ originAgentDid: de.did, collectingEntityId: keEntity.entityId } as never);
      expect(terms).toMatchObject({ promise: 'ours', answeredBy: keEntity.name, paidOut: false });
    });

    it('keeps the list of shop floats readable with a shop that has no float', () => {
      presence.set({ jurisdiction: 'DE', level: 'matched' });
      shop('Kiez Kiosk 5', 'Berlin', BERLIN, 'DE', 2);
      shop('Nairobi CBD P4d', 'Nairobi', NAIROBI, 'KE', 55);
      expect(() => gate.floats()).not.toThrow();
    });
  });

  describe('a fleet where we only match — the local operator', () => {
    const DAR = { lat: -6.79, lng: 39.21 };
    let seqF = 0;
    const fleetIn = (country: string) => {
      seqF += 1;
      const m = managers.register({
        companyName: `Dar Haulage ${seqF}`,
        contactPhone: `+2557000${seqF}`,
        ownerFullName: 'Owner',
        ownerNationalId: `NID-TZ-${seqF}`,
        location: DAR,
        jurisdiction: country,
        requirements: { businessRegistrationNo: `BR-TZ-${seqF}`, transportOperatorLicence: `TOL-TZ-${seqF}`, taxId: `TAX-TZ-${seqF}` },
      } as never);
      managers.submitKyc(m.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'p' });
      managers.decideKyc(m.did, true);
      return managers.recordBond(m.did);
    };

    it('lets a fleet register and activate in a country we only match — with no sister attached', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const m = fleetIn('TZ');
      expect(m).toMatchObject({ status: 'ACTIVE', jurisdiction: 'TZ' });
      expect(m.entityId).toBeUndefined();
      // …and the money gate still refuses, by name, the moment money is asked for.
      expect(() => managers.entityIdOf(m)).toThrow(/cannot pay out in this country/i);
    });

    it('still refuses a fleet where the network does not operate at all', () => {
      expect(() => fleetIn('ZM')).toThrow(/does not take sign-ups in ZM/);
    });

    it('never fails a delivery or an earnings screen for its driver — nothing of ours pays, so nothing is booked', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const m = fleetIn('TZ');
      const d = drivers.register({ displayName: 'Juma', fullName: 'Juma', nationalId: 'NID-JUMA', mobile: '+255711000111', licenceClasses: ['bike'], managerDid: m.did } as never);
      // The earnings read answers — who is paid is the fleet — rather than refusing for want of a sister.
      expect(drivers.settlementFor(d.did, { forPayee: () => ({ settled: 0, inFlight: 0 }) })).toMatchObject({ payeeDid: m.did, paidToMe: false });
      // A payout at delivery records nothing, and throws nothing.
      expect(gate.driverPayout(d.did, 120)).toBeNull();
    });
  });

  describe('everyone who moves or sends freight, where we only match', () => {
    const DAR = { lat: -6.79, lng: 39.21 };

    it('lets an independent courier register with no sister — and refuses paying them by name', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const c = drivers.register({ displayName: 'Baraka', fullName: 'Baraka', nationalId: 'NID-BARAKA', mobile: '+255711000222', licenceClasses: ['bike'], jurisdiction: 'TZ' } as never);
      expect(c).toMatchObject({ jurisdiction: 'TZ' });
      expect(c.entityId).toBeUndefined();
      expect(() => drivers.settlingEntityIdOf(c)).toThrow(/cannot pay out in this country/i);
      // A delivery still completes: nothing of ours pays, so nothing is booked.
      expect(gate.driverPayout(c.did, 80)).toBeNull();
    });

    it('refuses a courier, a store and a hub where the network does not operate at all — before anything is kept', () => {
      expect(() => drivers.register({ displayName: 'Z', fullName: 'Z', nationalId: 'NID-ZM-1', mobile: '+260977000111', licenceClasses: ['bike'], jurisdiction: 'ZM' } as never)).toThrow(/does not take sign-ups in ZM/);
      // …and the refusal burned no fingerprint: the same person registers once the country is matched.
      presence.set({ jurisdiction: 'ZM', level: 'matched' });
      expect(drivers.register({ displayName: 'Z', fullName: 'Z', nationalId: 'NID-ZM-1', mobile: '+260977000111', licenceClasses: ['bike'], jurisdiction: 'ZM' } as never).entityId).toBeUndefined();
      expect(() => vendors.register({ name: 'Lusaka Store', country: 'MW' })).toThrow(/does not take sign-ups in MW/);
      expect(() => mdps.register({ name: 'Lilongwe Hub', zones: ['LL'], country: 'MW', location: DAR }, { approvedBy: 'staff' })).toThrow(/does not take sign-ups in MW/);
    });

    it('lets a store register with no till — every read answers, every money path refuses by name', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const v = vendors.register({ name: 'Kariakoo Traders', country: 'TZ' });
      expect(v.entityId).toBeUndefined();
      // Null, not zero: having no till with us is a different fact from an empty one.
      expect(v.balance).toBeNull();
      expect(vendors.get(v.vendorId).balance).toBeNull();
      expect(vendors.balanceOrNone(v.vendorId)).toBeNull();
      expect(vendors.settlesWithUs(v.vendorId)).toBe(false);
      expect(() => vendors.topUp(v.vendorId, 50)).toThrow(/cannot hold money in this country/i);
      expect(() => vendors.balanceOf(v.vendorId)).toThrow(/cannot hold money in this country/i);
    });

    it('lets a hub register and sort with no sister, booking nothing for the work', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const hub = mdps.register({ name: 'Dar Hub', zones: ['DAR'], country: 'TZ', location: DAR }, { approvedBy: 'staff' });
      expect(hub.entityId).toBeUndefined();
      expect(mdps.entityIdOrNone(hub)).toBeUndefined();
      expect(() => mdps.entityIdOf(hub)).toThrow(/cannot pay out in this country/i);
    });

    it('keeps a store in an established country exactly as it was', () => {
      const v = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      expect(v.entityId).toBe(entities.requireForJurisdiction('KE').entityId);
      expect(v.balance).toBe(0);
      expect(vendors.settlesWithUs(v.vendorId)).toBe(true);
      expect(vendors.topUp(v.vendorId, 50).balance).toBe(50);
    });
  });

  describe('P3 — saying it out loud, before the goods are accepted', () => {
    const takeIn = (agentDid: string, parcelId: string, mode: 'cash' | 'credit') =>
      parcels.accept({ parcelId, agentDid, destZone: 'Kisumu', size: 'M', paymentMode: mode, senderMobile: '+254700111', receiverMobile: '+254700222', dropoffPhotoRef: photoBy(agentDid) } as never);

    it('OURS names the sister and the cover it gives — and the parcel is stamped with exactly that', () => {
      const ke = fundedShop('Mama Sarah P3');
      const keEntity = entities.requireForJurisdiction('KE');
      entities.setInsurance(keEntity.entityId, { freeLimit: 5000 });

      const terms = parcels.takeInTerms(ke.did);
      expect(terms).toMatchObject({ promise: 'ours', answeredBy: keEntity.name, coverLimit: 5000, coverBasis: 'free-limit', cashAccepted: true });

      // What the counter said is what a claim will be judged against — never a second computation.
      const parcel = takeIn(ke.did, 'PUD-P3-1', 'cash');
      expect(parcel.coverLimit).toBe(5000);
    });

    it('says "no stated limit" rather than inventing one where the sister has set none', () => {
      const ke = shop('Mama Sarah P3b', 'Nairobi', NAIROBI);
      expect(parcels.takeInTerms(ke.did)).toMatchObject({ promise: 'ours', coverLimit: 0, coverBasis: 'no-stated-limit' });
    });

    it('THEIRS: nobody of ours is named, cover is zero by construction, and no cash crosses our till', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const tz = shop('Dar Duka P3', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      const terms = parcels.takeInTerms(tz.did);
      expect(terms).toMatchObject({ promise: 'theirs', jurisdiction: 'TZ', level: 'matched', coverLimit: 0, coverBasis: 'none', cashAccepted: false });
      expect(terms.answeredBy).toBeUndefined();
    });

    it('NONE, where the country moved down while the shop stood open', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const tz = shop('Dar Duka P3b', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      presence.set({ jurisdiction: 'TZ', level: 'observed' });
      expect(parcels.takeInTerms(tz.did).promise).toBe('none');
    });

    it('repeats a BOOKED parcel’s own stamped cover, not today’s free limit', () => {
      const ke = shop('Mama Sarah P3c', 'Nairobi', NAIROBI);
      const keEntity = entities.requireForJurisdiction('KE').entityId;
      entities.setInsurance(keEntity, { freeLimit: 100 });
      const terms = parcels.intakeTermsFor({ originAgentDid: ke.did, collectingEntityId: keEntity, coverLimit: 6000, declaredValue: 6000 } as never);
      expect(terms).toMatchObject({ promise: 'ours', coverLimit: 6000, coverBasis: 'declared' });
    });

    it('refuses to award a claim on goods taken in under the carrier’s promise — and still lets it be closed', () => {
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const tz = shop('Dar Duka P3c', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      const parcel = parcels.accept({ parcelId: 'PUD-P3-TZ', agentDid: tz.did, destZone: 'DarEsSalaam2', size: 'M', paymentMode: 'credit', senderMobile: '+255700111', receiverMobile: '+255700222', dropoffPhotoRef: photoBy(tz.did) } as never);
      Object.assign(parcels.get(parcel.parcelId), { status: 'Disputed', dispute: { state: 'open', origin: 'counter', fromStatus: 'At_PUDO', reason: 'crushed', raisedBy: tz.did, raisedAt: new Date().toISOString() } });

      expect(() => parcels.resolveDispute(parcel.parcelId, { decision: 'upheld', award: 40, note: 'goodwill' })).toThrow(/carrier/);
      expect(parcels.resolveDispute(parcel.parcelId, { decision: 'rejected', note: 'the carrier answers for this' }).dispute?.decision).toBe('rejected');
    });
  });

  describe('the sister follows from the country, not from the deployment', () => {
    it('contracts an Ethiopian shop to the Ethiopian sister and a Kenyan one to the Kenyan sister', () => {
      const ke = shop('Mama Sarah', 'Nairobi', NAIROBI);
      const et = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      expect(ke.country).toBe('KE');
      expect(et.country).toBe('ET');
      expect(agents.entityIdOf(ke)).toBe(entities.requireForJurisdiction('KE').entityId);
      expect(agents.entityIdOf(et)).toBe(entities.requireForJurisdiction('ET').entityId);
      expect(agents.entityIdOf(et)).not.toBe(agents.entityIdOf(ke)); // the whole point
    });

    it('refuses a shop in a country the network does not operate in, in words about the shop', () => {
      // It used to say "No daughter company operates in TZ", which is a fact about our paperwork and not
      // about their application. The refusal now names what is true of that COUNTRY, and it is asked of
      // the presence rather than of the company register.
      expect(() => shop('Dar Duka', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ')).toThrow(/does not take sign-ups in TZ yet, so a shop cannot register there/);
    });

    it('lets a shop stand where we MATCH but cannot bill, with no sister attached', () => {
      // The binary this breaks: a country we have not incorporated in used to hold no shops at all, so
      // there was no matching, no custody and no proof there either. A shop may now exist wherever goods
      // may be taken in; whether its money runs through a sister of ours is a second question.
      presence.set({ jurisdiction: 'TZ', level: 'matched' });
      const tz = shop('Dar Duka', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ');
      expect(tz.country).toBe('TZ');
      expect(tz.entityId).toBeUndefined();
      // …and the money path still refuses, by name, at the moment money is actually asked for.
      expect(() => agents.entityIdOf(tz)).toThrow(/cannot hold money in this country/i);
    });

    it('still resolves a shop registered before sites had a country', () => {
      const a = shop('Old Shop', 'Nairobi', NAIROBI);
      delete (a as { country?: string }).country;
      delete (a as { entityId?: string }).entityId;
      expect(agents.countryOf(a)).toBe('KE');
      expect(agents.entityIdOf(a)).toBe(entities.requireForJurisdiction('KE').entityId);
    });

    it('asks a hub the same question — a hub may serve zones across a border, but it stands in one country', () => {
      const hub = mdps.register({ name: 'Addis Sort', zones: ['AddisAbaba', 'Hawassa'], country: 'ET', location: ADDIS }, { approvedBy: 'staff' });
      expect(mdps.countryOf(hub)).toBe('ET');
      expect(mdps.entityIdOf(hub)).toBe(entities.requireForJurisdiction('ET').entityId);
      expect(() => mdps.register({ name: 'Dar Sort', zones: ['DarEsSalaam'], country: 'TZ', location: { lat: -6.79, lng: 39.21 } }, { approvedBy: 'staff' })).toThrow(/TZ/);
    });

    it('lets a store put its dock in another country than the one it is registered in', () => {
      // A dock earns nothing and invoices nobody, so no sister is needed where it stands — but the goods
      // are physically there, and a border is a fact about goods.
      const v = vendors.register({ name: 'Cross Trader', country: 'KE' });
      vendors.setCollectionPoint(v.vendorId, { label: 'Addis warehouse, gate 2', zone: 'AddisAbaba', country: 'et', location: ADDIS });
      expect(vendors.dockCountryOf(vendors.get(v.vendorId))).toBe('ET');

      const home = vendors.register({ name: 'Home Trader', country: 'KE' });
      vendors.setCollectionPoint(home.vendorId, { label: 'Yard', zone: 'Nairobi', location: NAIROBI });
      expect(vendors.dockCountryOf(vendors.get(home.vendorId))).toBe('KE'); // unstated = the store's own
    });
  });

  describe('a journey says where it crosses', () => {
    it('leaves a domestic route exactly as it was', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop('Mombasa Road', 'MombasaRd', { lat: -1.32, lng: 36.85 });
      corridors.addCorridor({ name: 'CBD–Mombasa Rd', originZone: 'Nairobi', destZone: 'MombasaRd' });

      const quote = routing.quoteShipment(from.did, to.did);
      expect(quote.crossesBorder).toBe(false);
      expect(quote.crossings).toEqual([]);
      expect(quote.currency).toBe('KES');
      expect(quote.nodes.map((n) => n.country)).toEqual(['KE', 'KE']);
      expect(quote.nodes.every((n) => n.currency === 'KES')).toBe(true);
      expect(quote.entityIds).toHaveLength(1);
      expect(quote.locked.total).toBeGreaterThan(0);
    });

    it('names the crossing on the LEG that drives over it, not on a stop', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });

      const plan = routing.planJourney({ originAgentDid: from.did, destAgentDid: to.did });
      expect(plan.crossesBorder).toBe(true);
      expect(plan.hops.map((h) => h.country)).toEqual(['KE', 'ET']);
      expect(plan.crossings).toEqual([{ legIndex: 0, from: 'Nairobi CBD', to: "Bambi's Super Market", fromCountry: 'KE', toCountry: 'ET' }]);
      expect(plan.legs[0].crossesBorder).toBe(true);
      expect(plan.legs[0].fromCountry).toBe('KE');
      expect(plan.legs[0].toCountry).toBe('ET');
    });

    it('puts the crossing on the hub-to-hub leg when the route runs through sort centres', () => {
      // The realistic shape of the run the network is actually for: local collection, a national trunk to
      // the border, the crossing, then the other country's own last mile. Only ONE leg is international.
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      mdps.register({ name: 'Moyale Hub', zones: ['Nairobi'], location: MOYALE_KE }, { approvedBy: 'staff' }); // KE by default
      mdps.register({ name: 'Hawassa Hub', zones: ['AddisAbaba'], country: 'ET', location: HAWASSA }, { approvedBy: 'staff' });

      const plan = routing.planJourney({ originAgentDid: from.did, destAgentDid: to.did });
      expect(plan.hops.map((h) => h.country)).toEqual(['KE', 'KE', 'ET', 'ET']);
      expect(plan.legs.map((l) => l.crossesBorder)).toEqual([false, true, false]);
      expect(plan.crossings).toHaveLength(1);
      expect(plan.crossings[0]).toMatchObject({ legIndex: 1, from: 'Moyale Hub', to: 'Hawassa Hub', fromCountry: 'KE', toCountry: 'ET' });
    });

    it('is a pure reading of the stops', () => {
      expect(crossingsOn([{ label: 'a', country: 'KE' }, { label: 'b', country: 'KE' }])).toEqual([]);
      expect(crossingsOn([{ label: 'a', country: 'KE' }])).toEqual([]);
      expect(crossingsOn([{ label: 'a', country: 'KE' }, { label: 'b', country: 'ET' }, { label: 'c', country: 'KE' }])).toHaveLength(2);
    });
  });

  describe('between EU countries, no customs (the owner’s BG-2, 2026-11-22)', () => {
    const AMSTERDAM = { lat: 52.37, lng: 4.9 };
    const SOFIA = { lat: 42.7, lng: 23.32 };
    const euShops = () => {
      // A company of ours sells in the Netherlands, in euros, and the road route to Bulgaria is on (step 3b).
      entities.createCompany({ kind: 'sister', jurisdiction: 'NL', name: 'SeeBuyGet Nederland' }, 'Owner');
      entities.activate('sbg-nl', 'Owner');
      presence.set({ jurisdiction: 'NL', level: 'established' });
      presence.set({ jurisdiction: 'BG', level: 'matched' });
      roadOn = true;
      // …ending at its central hub in Sofia (step 3c).
      roadHub = mdps.register({ name: 'Sofia Central Hub', zones: ['Sofia'], country: 'BG', location: SOFIA }, { approvedBy: 'staff' }).mdpId;
      const to = shop('Магазин Витоша', 'Sofia', SOFIA, 'BG', 2);
      corridors.addCorridor({ name: 'Amsterdam–Sofia', originZone: 'Amsterdam', destZone: 'Sofia' });
      return to;
    };
    /** A store whose goods leave from Amsterdam: its own company sells, so the quote stands on the mechanics alone. */
    const amsterdamStore = () => {
      const v = vendors.register({ name: 'Grachten Goods', country: 'NL' });
      vendors.setCollectionPoint(v.vendorId, { label: 'Warehouse, Westpoort', zone: 'Amsterdam', country: 'NL', location: AMSTERDAM });
      return vendors.get(v.vendorId);
    };
    const quoteFrom = (store: ReturnType<typeof amsterdamStore>, to: { did: string }) =>
      routing.quoteShipmentFrom({ type: 'dock', id: store.did, label: 'Warehouse, Westpoort', zone: 'Amsterdam', country: 'NL', location: AMSTERDAM }, to.did, 'M', vendors.entityIdOf(store));

    it('is no crossing, read off the stops: only a customs border is one', () => {
      expect(crossingsOn([{ label: 'a', country: 'NL' }, { label: 'b', country: 'BG' }])).toEqual([]);
      expect(crossingsOn([{ label: 'a', country: 'NL' }, { label: 'b', country: 'KE' }])).toHaveLength(1);
      expect(crossingsOn([{ label: 'a', country: 'KE' }, { label: 'b', country: 'UG' }])).toHaveLength(1);
      expect(unionPassageOn([{ country: 'NL' }, { country: 'NL' }, { country: 'BG' }])).toEqual({ union: 'EU', fromCountry: 'NL', toCountry: 'BG' });
      // Declared somewhere on the way: customs decide on it, and the declaration lists what is inside.
      expect(unionPassageOn([{ country: 'NL' }, { country: 'BG' }, { country: 'TR' }])).toBeUndefined();
      expect(unionPassageOn([{ country: 'NL' }, { country: 'NL' }])).toBeUndefined();
      expect(unionPassageOn([{ country: 'KE' }, { country: 'UG' }])).toBeUndefined();
    });

    it('a journey from Amsterdam to Sofia waits at no border post — one from Nairobi to Addis still does', () => {
      const to = euShops();
      const store = amsterdamStore();
      const plan = routing.planJourney({ from: { type: 'dock', id: store.did, label: 'Warehouse, Westpoort', zone: 'Amsterdam', country: 'NL', location: AMSTERDAM }, destAgentDid: to.did });
      // Through the hub that serves Sofia, as any journey into its zone (step 3c registers one).
      expect(plan.hops.map((h) => h.country)).toEqual(['NL', 'BG', 'BG']);
      expect(plan.crossesBorder).toBe(false);
      expect(plan.crossings).toEqual([]);
      expect(plan.legs[0]).toMatchObject({ fromCountry: 'NL', toCountry: 'BG', crossesBorder: false, borderDwellH: 0 });

      const ke = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const et = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });
      expect(routing.planJourney({ originAgentDid: ke.did, destAgentDid: et.did }).legs[0].borderDwellH).toBe(BORDER_DWELL_H);
    });

    it('a store’s parcel to Bulgaria is sold with no declaration — and says where it goes', () => {
      const to = euShops();
      const quote = quoteFrom(amsterdamStore(), to);
      expect(quote.crossesBorder).toBe(false);
      expect(quote.crossings).toEqual([]);
      expect(quote.withinUnion).toEqual({ union: 'EU', fromCountry: 'NL', toCountry: 'BG' });
    });

    it('is not written without the store’s word that it holds no alcohol, tobacco, medicines or weapons; with it, it is, and keeps the word', () => {
      const to = euShops();
      const store = amsterdamStore();
      const quote = quoteFrom(store, to);
      const mint = (extra: object) =>
        parcels.createInbound({ vendorId: store.vendorId, originZone: 'Amsterdam', destAgentDid: to.did, buyerMobile: '+359888123456', contentPhotoRef: photoOf(store.vendorId), size: 'M', shippingPolicy: store.shippingPolicy, quote, ...extra });
      const refused = (extra: object) => {
        try {
          mint(extra);
        } catch (e) {
          return e as { code: string; params?: Record<string, unknown>; message: string };
        }
        throw new Error('it was written');
      };
      const unsaid = refused({});
      expect(unsaid.code).toBe('GOODS_WITH_OWN_RULES');
      expect(unsaid.message).toMatch(/from NL to BG: say that it holds no alcohol, tobacco, medicines or weapons/);
      expect(unsaid.params).toMatchObject({ field: 'noGoodsWithOwnRules', goods: ['alcohol', 'tobacco', 'medicines', 'weapons'] });
      expect(refused({ noGoodsWithOwnRules: false }).code).toBe('GOODS_WITH_OWN_RULES');
      // Medicines by its own kind of goods: refused whatever is said.
      const pharma = refused({ noGoodsWithOwnRules: true, natureCode: 'HUM' });
      expect(pharma).toMatchObject({ code: 'GOODS_WITH_OWN_RULES', params: expect.objectContaining({ field: 'natureCode', goods: ['medicines'] }) });
      expect(parcels.list().filter((x) => x.vendorId === store.vendorId)).toHaveLength(0);

      // Said: written, with no list of contents and no value asked — nothing customs would read.
      const { parcel } = mint({ noGoodsWithOwnRules: true });
      expect(parcel.customs).toBeUndefined();
      expect(parcel.withinUnion).toMatchObject({ union: 'EU', fromCountry: 'NL', toCountry: 'BG' });
      expect(Date.parse(parcel.withinUnion!.saidNoneAt)).not.toBeNaN();
      // 2026-11-23 — and the road route it was booked on, as it stood (step 3b).
      expect(parcel.roadRoute).toEqual({ from: 'NL', to: 'BG', hubMdpId: roadHub, hubName: 'Sofia Central Hub', fleetDid: 'did:fleet:balkan', fleetName: 'Balkan Line' });
      expect(parcel.currency).toBe('EUR');
    });

    // 2026-11-23 — BOOKING ON A ROAD ROUTE (step 3b; P3-2 the sender pays the whole way, P3-3 only on a route that is on).
    it('is booked only on a road route that is on — refused by name where none is — and priced by it: its price for the size, our fee and the tax', () => {
      const to = euShops();
      const store = amsterdamStore();
      roadOn = false;
      expect(() => quoteFrom(store, to)).toThrow(/Parcels to Bulgaria are not sent from Netherlands yet: no route between them is on/);
      roadOn = true;
      const q = quoteFrom(store, to);
      expect(q.byRoad).toEqual({ from: 'NL', to: 'BG', hubMdpId: roadHub, hubName: 'Sofia Central Hub', fleetDid: 'did:fleet:balkan', fleetName: 'Balkan Line' });
      expect(q).toMatchObject({ currency: 'EUR', crossesBorder: false, crossings: [], withinUnion: { union: 'EU', fromCountry: 'NL', toCountry: 'BG' } });
      // From the store's own dock nobody's shop fee: the route's price is the whole way (P3-2), our fee and the tax on top.
      expect(q.locked.transport).toBe(27.5);
      expect(q.locked.base).toBe(27.5);
      expect(q.locked.total).toBeGreaterThanOrEqual(q.locked.base);
      expect(q.flexible).toEqual(q.locked);
      // A heavy parcel goes as a load of its own.
      expect(() => routing.quoteShipmentFrom({ type: 'dock', id: store.did, label: 'Warehouse, Westpoort', zone: 'Amsterdam', country: 'NL', location: AMSTERDAM }, to.did, 'HEAVY', vendors.entityIdOf(store))).toThrow(/a heavy one goes as a load of its own/);
    });

    // 2026-11-23 — THE RUN (step 3c; P3-1 "dedicated route drivers gather a consolidated full load and take it to the central
    // distribution hub in that nation").
    it('goes by the central hub: planned and bagged there; its bags offered only to the route fleet’s drivers, who see the whole load and take it', () => {
      const to = euShops();
      const central = mdps.require(roadHub);
      const from = shop('Grachten Winkel', 'Amsterdam', AMSTERDAM, 'NL', 3);
      // The journey: straight from the Dutch shop to the central hub, then on in Bulgaria.
      expect(routing.planJourney({ originAgentDid: from.did, destAgentDid: to.did, central: central.mdpId }).hops.map((h) => h.id)).toEqual([from.did, central.mdpId, to.did]);
      const quote = routing.quoteShipment(from.did, to.did, 'M', undefined, { consumer: true });
      expect(quote.hops.map((h) => h.id)).toEqual([from.did, central.mdpId, to.did]);
      // The route's fleet, a driver of it, and a driver of another fleet, each in a van near the Dutch shop.
      const fleetOf = (name: string, n: number) => {
        const m = managers.register({ companyName: name, contactPhone: `+3161000000${n}`, ownerFullName: 'Owner', ownerNationalId: `NID-NL-${n}`, location: AMSTERDAM, jurisdiction: 'NL', requirements: { businessRegistrationNo: `BR-NL-${n}`, transportOperatorLicence: `TOL-NL-${n}`, taxId: `TAX-NL-${n}` } } as never);
        managers.submitKyc(m.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'p' });
        managers.decideKyc(m.did, true);
        return managers.recordBond(m.did);
      };
      const driverOf = (fleetDid: string, n: number) => {
        const d = drivers.register({ displayName: `D${n}`, fullName: `Driver ${n}`, nationalId: `NID-D-${n}`, mobile: `+3162000000${n}`, licenceClasses: ['van'], licenceNumber: `L-NL-${n}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, managerDid: fleetDid } as never);
        drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' } as never);
        drivers.decideKyc(d.did, true);
        const van = vehicles.register({ plate: `NL-V-${n}`, vehicleClass: 'van', capacityKg: 1000, ownerName: 'X', baseFee: 10, pricePerKm: 0.5, managerDid: fleetDid } as never);
        fleetSvc.couple(d.did, van.vehicleId);
        return d;
      };
      const balkan = fleetOf('Balkan Line', 1);
      const other = fleetOf('Polder Vans', 2);
      roadFleet = balkan.did;
      const ours = driverOf(balkan.did, 1);
      const theirs = driverOf(other.did, 2);
      // Parcels booked to Bulgaria, and a bag at the Dutch shop for the central hub, sealed and offered.
      const booked = () => parcels.createConsumerSend({ senderPersonDid: 'did:person:anna', senderPhoneHash: 'hash-anna', receiverMobile: '+359888123456', originAgentDid: from.did, destAgentDid: to.did, dimensionsCm: { l: 30, w: 20, h: 15 }, weightKg: 2, quote, noGoodsWithOwnRules: true }).parcel.parcelId;
      const bag = totes.register(from.did);
      totes.assign(bag.code, central.mdpId, 'Sofia Central Hub');
      totes.add(bag.code, booked(), 'M');
      totes.markAvailable(bag.code);
      // The plan a parcel keeps when it is taken in goes by its route's central hub, wherever staff named it: here one in Varna,
      // which no ordinary route from Amsterdam to Sofia would pass.
      const varna = mdps.register({ name: 'Varna Central Hub', zones: ['Varna'], country: 'BG', location: { lat: 43.2141, lng: 27.9147 } }, { approvedBy: 'staff' });
      roadHub = varna.mdpId;
      const viaVarna = routing.quoteShipment(from.did, to.did, 'M', undefined, { consumer: true });
      const sent = parcels.createConsumerSend({ senderPersonDid: 'did:person:anna', senderPhoneHash: 'hash-anna', receiverMobile: '+359888123456', originAgentDid: from.did, destAgentDid: to.did, dimensionsCm: { l: 30, w: 20, h: 15 }, weightKg: 2, quote: viaVarna, noGoodsWithOwnRules: true }).parcel.parcelId;
      // …and on inside Bulgaria as any parcel goes: by the hub near the receiving shop.
      expect(journeys.freeze(sent)?.hops.map((h) => h.id)).toEqual([from.did, varna.mdpId, central.mdpId, to.did]);
      roadHub = central.mdpId;
      // Every other way a bag reaches a driver says the same: work around me, the moving driver's nudge, a bag claimed for one
      // who took it on ahead, and the "a load is near you" bell.
      expect(dispatch.suggestNearby(theirs.did, AMSTERDAM, 10).some((o) => o.ref === bag.code)).toBe(false);
      expect(dispatch.suggestNearby(ours.did, AMSTERDAM, 10).some((o) => o.ref === bag.code)).toBe(true);
      expect(dispatch.offerNear(theirs.did, AMSTERDAM)?.ref).not.toBe(bag.code);
      expect(dispatch.claimBagFor(bag.code, theirs.did)).toMatch(/only Balkan Line’s drivers carry it/);
      expect(dispatch.roadBagFor(theirs.did, bag.code)).toEqual({ may: false, to: 'BG' });
      expect(dispatch.roadBagFor(ours.did, bag.code)).toEqual({ may: true, to: 'BG' });
      // …and the drivers staff may choose for a bag waiting long, and a bag offered to one of them.
      fleetSvc.reportLocation(theirs.did, AMSTERDAM);
      fleetSvc.reportLocation(ours.did, AMSTERDAM);
      expect(dispatch.driversForBag(bag.code).map((d) => d.driverDid)).toEqual([ours.did]);
      expect(dispatch.offerBagTo(theirs.did, bag.code)).toBeNull();
      const offered = (did: string) => dispatch.suggest(did, { from: AMSTERDAM, to: AMSTERDAM }).some((o) => o.ref === bag.code);
      expect(offered(theirs.did)).toBe(false);
      expect(offered(ours.did)).toBe(true);
      // Another fleet's driver sees no load; the route's driver sees it with how full the van would be.
      expect(dispatch.roadLoad(theirs.did).routes).toEqual([]);
      const load = dispatch.roadLoad(ours.did);
      expect(load.routes).toHaveLength(1);
      expect(load.routes[0]).toMatchObject({ from: 'NL', to: 'BG', hubName: 'Sofia Central Hub', bags: [{ code: bag.code, at: 'Grachten Winkel', parcels: 1 }] });
      expect(load.vehicle).toMatchObject({ bagPlaces: 15, freeBagPlaces: 15 });
      // Taking it: another fleet's driver is refused; the route's driver takes it, and it is theirs.
      expect(dispatch.takeRoadLoad(theirs.did, [bag.code]).refused[0].why).toMatch(/not waiting for a route your fleet runs/);
      expect(dispatch.takeRoadLoad(ours.did, [bag.code, 'BAG-NONE'])).toMatchObject({ taken: [bag.code], refused: [{ code: 'BAG-NONE' }] });
      expect(totes.byCodeMaybe(bag.code)).toMatchObject({ status: 'claimed', claimedBy: ours.did });
      expect(dispatch.roadLoad(ours.did).vehicle?.freeBagPlaces).toBe(14);
      // Loaded, it rides on the van and still says where it left from: the Dutch shop, in the Netherlands (the GPS watch and
      // the manifest read it, 2026-11-24).
      mdps.closeBag(bag.code, { shopDid: from.did }, 'Test', { photoRef: photoBy(from.did) });
      mdps.loadBag(bag.code, drivers.get(ours.did).badgeId!);
      expect(totes.byCodeMaybe(bag.code)).toMatchObject({ status: 'in_transit', loadedFrom: from.did });
      expect(dispatch.bagFacts(bag.code)).toMatchObject({ from: 'NL', fromLabel: 'Grachten Winkel', to: 'BG', toLabel: 'Sofia Central Hub' });
      // With the route switched off, nobody carries a bag across.
      const bag2 = totes.register(from.did);
      totes.assign(bag2.code, central.mdpId, 'Sofia Central Hub');
      totes.add(bag2.code, booked(), 'M');
      totes.markAvailable(bag2.code);
      // A counter loading it by another fleet's driver's pass is refused, as is a take-over after a breakdown.
      mdps.closeBag(bag2.code, { shopDid: from.did }, 'Test', { photoRef: photoBy(from.did) });
      expect(() => mdps.loadBag(bag2.code, drivers.get(theirs.did).badgeId!)).toThrow(/only Balkan Line’s drivers carry it/);
      expect(() => dispatch.assertCanTakeLoads([], theirs.did, 0, [bag2.code])).toThrow(/only Balkan Line’s drivers carry it/);
      // An offer made while the route was another fleet's is refused at the claim once it is not theirs.
      roadFleet = other.did;
      const early = dispatch.suggest(theirs.did, { from: AMSTERDAM, to: AMSTERDAM }).find((o) => o.ref === bag2.code);
      expect(early).toBeDefined();
      roadFleet = balkan.did;
      expect(() => dispatch.claim(early!.offerId)).toThrow(/only Balkan Line’s drivers carry it/);
      roadOn = false;
      expect(offered(ours.did) || dispatch.suggest(ours.did, { from: AMSTERDAM, to: AMSTERDAM }).some((o) => o.ref === bag2.code)).toBe(false);
    });

    // 2026-11-24 — THE HANDOVER AT THE CENTRAL HUB (corridor compliance, slice 4; the owner: "Cross-border only").
    it('a bag from another country is handed over at the hub by name on both sides, what is wrong said there; its parcels leave on a coded seal', () => {
      const to = euShops();
      const central = mdps.require(roadHub);
      const from = shop('Grachten Winkel', 'Amsterdam', AMSTERDAM, 'NL', 3);
      const transfers = moduleRefNow.get(HubTransferService);
      const closures = moduleRefNow.get(BagClosureService);
      const fleetOf = (name: string, n: number) => {
        const m = managers.register({ companyName: name, contactPhone: `+3161000001${n}`, ownerFullName: 'Owner', ownerNationalId: `NID-NL-H${n}`, location: AMSTERDAM, jurisdiction: 'NL', requirements: { businessRegistrationNo: `BR-NL-H${n}`, transportOperatorLicence: `TOL-NL-H${n}`, taxId: `TAX-NL-H${n}` } } as never);
        managers.submitKyc(m.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'p' });
        managers.decideKyc(m.did, true);
        return managers.recordBond(m.did);
      };
      const driverOf = (fleetDid: string, n: number, name: string) => {
        const d = drivers.register({ displayName: name, fullName: `Driver ${n}`, nationalId: `NID-DH-${n}`, mobile: `+3162000001${n}`, licenceClasses: ['van'], licenceNumber: `L-NL-H${n}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, managerDid: fleetDid } as never);
        drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' } as never);
        drivers.decideKyc(d.did, true);
        const van = vehicles.register({ plate: `NL-H-${n}`, vehicleClass: 'van', capacityKg: 1000, ownerName: 'X', baseFee: 10, pricePerKm: 0.5, managerDid: fleetDid } as never);
        fleetSvc.couple(d.did, van.vehicleId);
        return d;
      };
      const balkan = fleetOf('Balkan Line', 1);
      roadFleet = balkan.did;
      roadOn = true;
      const ours = driverOf(balkan.did, 1, 'Ivo');
      const local = driverOf(fleetOf('Sofia Vans', 2).did, 2, 'Mila');
      const quote = routing.quoteShipment(from.did, to.did, 'M', undefined, { consumer: true });
      const booked = () => parcels.createConsumerSend({ senderPersonDid: 'did:person:anna', senderPhoneHash: 'hash-anna', receiverMobile: '+359888123456', originAgentDid: from.did, destAgentDid: to.did, dimensionsCm: { l: 30, w: 20, h: 15 }, weightKg: 2, quote, noGoodsWithOwnRules: true }).parcel.parcelId;
      // A bag from the Dutch shop to the central hub in Sofia, closed, loaded by the route driver's pass and read by them.
      const carried = (throughTo?: { id: string; name: string }) => {
        const bag = totes.register(from.did);
        totes.assign(bag.code, central.mdpId, 'Sofia Central Hub');
        const parcelId = booked();
        totes.add(bag.code, parcelId, 'M');
        if (throughTo) totes.markThrough(bag.code, throughTo.id, throughTo.name);
        totes.markAvailable(bag.code);
        mdps.closeBag(bag.code, { shopDid: from.did }, 'Test', { photoRef: photoBy(from.did) });
        mdps.loadBag(bag.code, drivers.get(ours.did).badgeId!);
        mdps.takeBag(bag.code, ours.did, 'Ivo', { photoRef: photoBy(ours.did), asClosed: true });
        return { code: bag.code, parcelId };
      };
      const arrived = () => ({ photoRef: photoBy(central.did), asClosed: true });
      const { code, parcelId } = carried();
      // Without the driver's pass, refused, and nothing kept: the bag still on the van, its seal not received.
      expect(() => mdps.dropBag(central.mdpId, code, arrived(), 'Petar')).toThrow(/comes from another country: scan the pass on the driver’s phone/);
      expect(totes.byCodeMaybe(code)).toMatchObject({ status: 'in_transit', carriedBy: ours.did });
      expect(closures.current(totes.byCodeMaybe(code)!)?.receipt).toBeUndefined();
      // A badge number alone hands over nothing; another driver's pass is not the one carrying it.
      expect(() => mdps.dropBag(central.mdpId, code, arrived(), 'Petar', Date.now(), { driverBadgeId: drivers.get(ours.did).badgeId! })).toThrow(/badge number on its own hands over nothing/);
      expect(() => mdps.dropBag(central.mdpId, code, arrived(), 'Petar', Date.now(), { driverBadgeId: fleetSvc.handoverPassFor(local.did)! })).toThrow(/not the driver carrying bag/);
      // What is wrong: said in words, at most five things.
      const pass = () => fleetSvc.handoverPassFor(ours.did)!;
      expect(() => mdps.dropBag(central.mdpId, code, arrived(), 'Petar', Date.now(), { driverBadgeId: pass(), exceptions: [{ note: 'x' }] })).toThrow(/Say in words what is wrong/);
      expect(() => mdps.dropBag(central.mdpId, code, arrived(), 'Petar', Date.now(), { driverBadgeId: pass(), exceptions: Array.from({ length: 6 }, () => ({ note: 'Wet corner' })) })).toThrow(/at most 5 things/);
      expect(totes.byCodeMaybe(code)?.status).toBe('in_transit');
      // Handed over: the driver by pass, Petar signed in, the seal as found, a torn corner with its photograph. The GPS watch hears
      // the driver released it.
      const told: string[] = [];
      transfers.onRelease((did) => told.push(did));
      const dropped = mdps.dropBag(central.mdpId, code, arrived(), 'Petar', Date.now(), { driverBadgeId: pass(), exceptions: [{ note: '  Corner   torn ', photoRef: photoBy(central.did) }] });
      expect(dropped.emptied).toEqual([parcelId]);
      const record = transfers.get(dropped.transferId!)!;
      expect(record).toMatchObject({ mdpId: central.mdpId, country: 'BG', bagCode: code, fromCountry: 'NL', fromPlace: 'Grachten Winkel', parcels: [parcelId], released: { driverDid: ours.did, driverName: 'Ivo', fleetDid: balkan.did }, received: { by: 'Petar', sealKind: 'photo', asClosed: true }, exceptions: [{ note: 'Corner torn', by: 'Petar' }], passedOnWhole: false, onward: [] });
      expect(record.exceptions[0].photoRef).toBeDefined();
      expect(transfers.forHub(central.mdpId).map((t) => t.transferId)).toEqual([record.transferId]);
      expect(told).toEqual([ours.did]);
      // Its parcel waits for a coded seal at this hub, and at no other.
      expect(transfers.needsCodedSeal(central.mdpId, [parcelId])).toBe(true);
      expect(transfers.needsCodedSeal('mdp_elsewhere', [parcelId])).toBe(false);
      expect((parcels.get(parcelId).custody ?? []).slice(-1)[0]?.note).toMatch(/handed over at Sofia Central Hub by Ivo to Petar/);
      // Onward: a bag of the hub's with that parcel leaves only on a coded seal; the pass that loads it closes the record.
      const onward = totes.register(central.mdpId);
      totes.assign(onward.code, to.did, 'Sofia shop');
      totes.add(onward.code, parcelId, 'M');
      expect(() => mdps.closeBag(onward.code, { mdpId: central.mdpId }, 'Petar', { photoRef: photoBy(central.did) })).toThrow(/leaves on a coded seal/);
      mdps.closeBag(onward.code, { mdpId: central.mdpId }, 'Petar', { seal: 'BG-SEAL-0042', photoRef: photoBy(central.did) });
      mdps.loadBag(onward.code, drivers.get(local.did).badgeId!);
      expect(transfers.get(record.transferId)?.onward).toEqual([expect.objectContaining({ bagCode: onward.code, parcels: [parcelId], sealNumber: 'BG-SEAL-0042', driverDid: local.did, driverName: 'Mila' })]);
      expect(transfers.needsCodedSeal(central.mdpId, [parcelId])).toBe(false);
      expect((parcels.get(parcelId).custody ?? []).slice(-1)[0]?.note).toMatch(/on seal BG-SEAL-0042/);
      // A bag of such parcels closed on a photograph alone, however it came to be, does not go.
      const second = carried();
      mdps.dropBag(central.mdpId, second.code, arrived(), 'Petar', Date.now(), { driverBadgeId: pass() });
      const loose = totes.register(central.mdpId);
      totes.assign(loose.code, to.did, 'Sofia shop');
      totes.add(loose.code, second.parcelId, 'M');
      closures.checkClose(totes.byCodeMaybe(loose.code)!, { did: central.did, name: 'Petar', place: 'Sofia Central Hub' }, central.did, { photoRef: photoBy(central.did) })({ at: new Date().toISOString() });
      expect(() => mdps.loadBag(loose.code, drivers.get(local.did).badgeId!)).toThrow(/close it on a coded seal/);
      // A whole bag passed on to a hub further on: received here by name, then resealed before anyone loads it.
      const varna = mdps.register({ name: 'Varna Hub', zones: ['Varna'], country: 'BG', location: { lat: 43.2141, lng: 27.9147 } }, { approvedBy: 'staff' });
      const through = carried({ id: varna.mdpId, name: 'Varna Hub' });
      const passed = mdps.dropBag(central.mdpId, through.code, arrived(), 'Petar', Date.now(), { driverBadgeId: pass() });
      expect(passed).toMatchObject({ reseal: true, passedOn: { final: 'Varna Hub' } });
      expect(transfers.get(passed.transferId!)?.passedOnWhole).toBe(true);
      expect(totes.byCodeMaybe(through.code)?.closureId).toBeUndefined();
      expect(() => mdps.loadBag(through.code, drivers.get(local.did).badgeId!)).toThrow(/Close bag .* first/);
      expect(() => mdps.closeBag(through.code, { mdpId: central.mdpId }, 'Petar', { photoRef: photoBy(central.did) })).toThrow(/leaves on a coded seal/);
      mdps.closeBag(through.code, { mdpId: central.mdpId }, 'Petar', { seal: 'BG-SEAL-0043', photoRef: photoBy(central.did) });
      // Inside one country, as before: a Bulgarian shop's bag received at the hub on its seal alone.
      const home = totes.register(to.did);
      totes.assign(home.code, central.mdpId, 'Sofia Central Hub');
      totes.add(home.code, booked(), 'M');
      totes.markAvailable(home.code);
      mdps.closeBag(home.code, { shopDid: to.did }, 'Test', { photoRef: photoBy(to.did) });
      mdps.loadBag(home.code, drivers.get(local.did).badgeId!);
      mdps.takeBag(home.code, local.did, 'Mila', { photoRef: photoBy(local.did), asClosed: true });
      expect(mdps.dropBag(central.mdpId, home.code, arrived(), 'Petar').transferId).toBeUndefined();
    });

    it('a walk-up at a Dutch counter to a Bulgarian shop: paid there in cash, with the sender’s word, priced by the route and keeping it', () => {
      const to = euShops();
      const counter = shop('Grachten Winkel', 'Amsterdam', AMSTERDAM, 'NL', 3);
      agents.submitKyc(counter.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'tl.jpg', shopPhotoRefs: ['front.jpg'] });
      agents.decideKyc(counter.did, true, undefined, undefined, '2099-12-31');
      gate.topUp(counter.did, 100);
      const quote = routing.quoteRoad({ agentDid: counter.did }, to.did, 'M', { consumer: true });
      let n = 0;
      const take = (extra: object) =>
        parcels.accept({ parcelId: `PUD-NLBG-${(n += 1)}`, agentDid: counter.did, destPudoDid: to.did, destZone: 'Sofia', size: 'M', senderMobile: '+31612345678', receiverMobile: '+359888123456', dropoffPhotoRef: photoBy(counter.did), walkInQuote: quote, ...extra } as never);
      expect(() => take({ paymentMode: 'credit', noGoodsWithOwnRules: true })).toThrow(/A parcel to another country is paid at this counter, in cash/);
      expect(() => take({})).toThrow(/from NL to BG: say that it holds no alcohol, tobacco, medicines or weapons/);
      expect(() => take({ noGoodsWithOwnRules: true, natureCode: 'HUM' })).toThrow(/medicines do not go to another country with us/);
      const parcel = take({ noGoodsWithOwnRules: true });
      expect(parcel.roadRoute).toMatchObject({ from: 'NL', to: 'BG', hubName: 'Sofia Central Hub', fleetName: 'Balkan Line' });
      expect(parcel.withinUnion).toMatchObject({ fromCountry: 'NL', toCountry: 'BG' });
      expect(parcel.customs).toBeUndefined();
      expect(parcel.border).toBeUndefined();
      expect(parcel.currency).toBe('EUR');
    });

    it('a person sends from a Dutch shop to a Bulgarian one on the route, with their word on what it holds — kept with the parcel', () => {
      const to = euShops();
      const from = shop('Grachten Winkel', 'Amsterdam', AMSTERDAM, 'NL', 3);
      const quote = routing.quoteShipment(from.did, to.did, 'M', undefined, { consumer: true });
      expect(quote.byRoad?.hubName).toBe('Sofia Central Hub');
      // The first shop's own fee is on top of the route's price.
      expect(quote.locked.base).toBe(30.5);
      const send = (extra: object) =>
        parcels.createConsumerSend({ senderPersonDid: 'did:person:anna', senderPhoneHash: 'hash-anna', receiverMobile: '+359888123456', originAgentDid: from.did, destAgentDid: to.did, dimensionsCm: { l: 30, w: 20, h: 15 }, weightKg: 2, quote, ...extra });
      expect(() => send({})).toThrow(/from NL to BG: say that it holds no alcohol, tobacco, medicines or weapons/);
      const { parcel } = send({ noGoodsWithOwnRules: true });
      expect(parcel.roadRoute).toMatchObject({ from: 'NL', to: 'BG', fleetName: 'Balkan Line' });
      expect(parcel.withinUnion).toMatchObject({ fromCountry: 'NL', toCountry: 'BG' });
    });
  });

  describe('and states one price across it, at a rate it will show you', () => {
    it('converts a foreign stop into the quote currency, and keeps both numbers', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI, 'KE', 55);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET', 60);
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });

      const quote = routing.quoteShipment(from.did, to.did);
      expect(quote.crossesBorder).toBe(true);
      expect(quote.currency).toBe('KES'); // the SELLING sister's money — here, the origin shop's

      // The Kenyan shop is owed shillings and quoted in shillings: one number, unconverted, unbuffered.
      expect(quote.nodes[0]).toMatchObject({ currency: 'KES', nativeFee: 55, fee: 55 });
      // Bambi's is owed 60 BIRR and always will be. What the buyer's price carries is that 60 expressed
      // in shillings at the BUFFERED rate — the seeded mid (129.0 / 118.5 to the dollar) is 65.32, and the
      // 1.5% buffer against the rate moving before settlement makes it 66.30. The buyer carries that, not
      // the shop and not the sister that has to hand the shop exactly what it asked for.
      expect(quote.nodes[1]).toMatchObject({ currency: 'ETB', nativeFee: 60, fee: 66.3 });
      expect(quote.nodeFees).toBe(121.3);
      expect(quote.fx!.buffer).toBe(0.98); // 66.30 charged − 65.32 the sisters settle at
    });

    it('shows the rate it used, where it came from, and how long the price is good for', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI, 'KE', 55);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET', 60);
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });

      const fxUsed = routing.quoteShipment(from.did, to.did).fx!;
      expect(fxUsed.base).toBe('KES');
      expect(fxUsed.rates).toHaveLength(1);
      expect(fxUsed.rates[0]).toMatchObject({ from: 'ETB', to: 'KES', via: 'USD', source: 'seed/seed', stale: false, spreadPct: FX_SPREAD_PCT });
      // BOTH numbers ride along, and that is the policy made visible: `mid` is what the two sisters will
      // settle between themselves at, `rate` is what the buyer was charged. The gap is the buffer, and it
      // is booked as a buffer rather than kept as margin — SBG does not profit from exchange rates.
      expect(fxUsed.rates[0].mid).toBeCloseTo(129.0 / 118.5, 6);
      expect(fxUsed.rates[0].rate).toBeCloseTo((129.0 / 118.5) * (1 + FX_SPREAD_PCT), 6);
      // A price built on a rate has a shelf life, even when the rate itself is fresh.
      expect(new Date(fxUsed.expiresAt).getTime()).toBeGreaterThan(new Date(fxUsed.quotedAt).getTime());
    });

    it('leaves a domestic quote with no fx block at all — nothing was converted, so nothing expires', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop('Kisumu Duka', 'Kisumu', { lat: -0.09, lng: 34.77 });
      corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
      const quote = routing.quoteShipment(from.did, to.did);
      expect(quote.fx).toBeUndefined();
      expect(quote.nodes.every((n) => n.fee === n.nativeFee)).toBe(true);
    });

    it('follows the rate when the rate moves', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI, 'KE', 55);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET', 60);
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });
      const before = routing.quoteShipment(from.did, to.did).nodes[1].fee;

      fx.setRate('ETB', 237.0, 'central-bank'); // the birr halves against the dollar
      const after = routing.quoteShipment(from.did, to.did);
      expect(after.nodes[1].nativeFee).toBe(60); // the shop's own price did not change
      expect(after.nodes[1].fee).toBeLessThan(before); // what it costs a Kenyan buyer did
      expect(after.fx!.rates[0].source).toBe('central-bank/seed'); // the ETB leg is the fresh one
    });

    it('stamps the rates onto the parcel, so a price can always be traced back to them', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI, 'KE', 55);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET', 60);
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });
      const store = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      const quote = routing.quoteShipment(from.did, to.did);

      const { parcel } = parcels.createInbound({
        vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700999',
        contentPhotoRef: photoOf(store.vendorId), size: 'M', shippingPolicy: store.shippingPolicy, quote,
        items: [{ name: 'Ankara shirt', qty: 2 }], subtotal: 3400, // it crosses a border, so it must declare
      });
      // Same reason the margin rate is stamped: a price is a promise made at a moment, and both the rate
      // and the knob behind it move. Without this the sister that collected could not later prove what it
      // owed the sister that performed the leg.
      expect(parcel.currency).toBe('KES');
      expect(parcel.fx?.rates).toEqual(quote.fx!.rates);
      expect(parcelCurrency(parcel)).toBe('KES');
      expect(vendorOrderRowOf(parcel).currency).toBe('KES');
    });

    it('leaves a domestic parcel with no rates at all, and reads an old parcel as the home currency', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop('Kisumu Duka', 'Kisumu', { lat: -0.09, lng: 34.77 });
      corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
      const store = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      const { parcel } = parcels.createInbound({
        vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700998',
        contentPhotoRef: photoOf(store.vendorId), size: 'M', shippingPolicy: store.shippingPolicy, quote: routing.quoteShipment(from.did, to.did),
      });
      expect(parcel.fx).toBeUndefined();
      expect(parcelCurrency({ ...parcel, currency: undefined })).toBe('KES'); // written before prices named a unit
    });

    it('books the buffer as a buffer, never as margin', () => {
      // SBG is not a bank profiting from exchange rates (user, 2026-08-26). What the buffer absorbs is
      // split out of revenue at billing, so a buffer that is systematically too fat shows up as a growing
      // FX number somebody has to answer for rather than quietly padding the margin.
      const store = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      vendors.topUp(store.vendorId, 500);
      vendors.billShipment(store.vendorId, 'PUD-FX', 121.3, 0.98);

      const ke = entities.requireForJurisdiction('KE').entityId;
      expect(books.balance(ke, ACCOUNT_CODES.REVENUE)).toBe(-120.32); // credit: what we actually sold
      expect(books.balance(ke, ACCOUNT_CODES.FX_GAINLOSS)).toBe(-0.98); // and what was only ever a hedge
      expect(books.balances(ke).balanced).toBe(true);
    });

    it('cannot be told the buffer was bigger than the price', () => {
      const store = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      vendors.topUp(store.vendorId, 500);
      vendors.billShipment(store.vendorId, 'PUD-ODD', 100, 250); // a caller's arithmetic mistake
      const ke = entities.requireForJurisdiction('KE').entityId;
      expect(books.balance(ke, ACCOUNT_CODES.REVENUE)).toBe(0); // clamped to the whole price, not beyond it
      expect(books.balance(ke, ACCOUNT_CODES.FX_GAINLOSS)).toBe(-100);
      expect(books.balances(ke).balanced).toBe(true);
    });

    it('still refuses when the rate book has never heard of a currency', () => {
      // The old refusal, kept where it is still true. A price that cannot be stated in one currency is
      // not a price, and inventing a rate would be worse than saying so.
      expect(() => fx.rateFor('KES', 'XOF')).toThrow(/No exchange rate for XOF/);
    });

    it('prices a store collected from its own dock at home, border or not', () => {
      // The dock path is the one the SSP quote will run on, so it must stay quotable while it is domestic.
      const to = shop('Kisumu Duka', 'Kisumu', { lat: -0.09, lng: 34.77 });
      corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
      const v = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      const quote = routing.quoteShipmentFrom(
        { type: 'dock', id: v.did, label: 'Yard', zone: 'Nairobi', country: vendors.dockCountryOf(v), location: NAIROBI },
        to.did,
        'M',
        vendors.entityIdOf(v),
      );
      expect(quote.crossesBorder).toBe(false);
      expect(quote.currency).toBe('KES');
      expect(quote.hops.map((h) => h.type)).toEqual(['dock', 'pudo']);
      expect(quote.nodes).toHaveLength(1); // the dock is on the route and not in the fee stack
      expect(quote.nodeFees).toBe(quote.nodes[0].fee);
    });
  });

  describe('and the crossing is a step, not a line on a route', () => {
    function crossBorderPair() {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI, 'KE', 55);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET', 60);
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });
      const store = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      return { from, to, store, quote: routing.quoteShipment(from.did, to.did) };
    }

    const mint = (p: ReturnType<typeof crossBorderPair>, extra: Record<string, unknown> = {}) =>
      parcels.createInbound({
        vendorId: p.store.vendorId, originAgentDid: p.from.did, destAgentDid: p.to.did, buyerMobile: '+254700999',
        contentPhotoRef: photoOf(p.store.vendorId), size: 'M', shippingPolicy: p.store.shippingPolicy, quote: p.quote, ...extra,
      } as never);

    it('will not sell a shipment that cannot legally travel, and says which part is missing', () => {
      const p = crossBorderPair();
      expect(() => mint(p)).toThrow(/a list of what is in the parcel and what the goods are worth/);
      expect(() => mint(p, { items: [{ name: 'Ankara shirt', qty: 2 }] })).toThrow(/what the goods are worth/);
      expect(() => mint(p, { subtotal: 3400 })).toThrow(/a list of what is in the parcel/);
      // A value of zero is not a declaration — an officer reads it as an undeclared parcel, not a free one.
      expect(() => mint(p, { items: [{ name: 'Ankara shirt', qty: 2 }], subtotal: 0 })).toThrow(/what the goods are worth/);
    });

    it('leaves no trace of the shipment it refused', () => {
      // Checked before an id, a DID or a ledger anchor is spent: a shipment that cannot travel should not
      // leave a half-born parcel behind for somebody to find.
      const p = crossBorderPair();
      const before = parcels.list({}).length;
      expect(() => mint(p)).toThrow();
      expect(parcels.list({}).length).toBe(before);
    });

    it('writes the paperwork from what the store already typed', () => {
      const p = crossBorderPair();
      const { parcel } = mint(p, { items: [{ name: 'Ankara shirt', qty: 2 }, { name: 'Kitenge scarf', qty: 1 }], subtotal: 3400 });
      expect(parcel.customs).toMatchObject({
        contents: 'Ankara shirt ×2, Kitenge scarf',
        itemCount: 3,
        declaredValue: 3400, // what the GOODS are worth — never the shipping price
        currency: 'KES',
        exporterId: p.store.vendorId,
        incoterm: 'DAP', // delivered at the collection shop; the importer settles duty, none of it through our books
        namedPlace: expect.stringContaining(', '),
      });
      expect(parcel.customs!.crossings).toEqual(p.quote.crossings);
      expect(parcel.customs!.importerRef).not.toContain('+254'); // the receiver is referenced, never named
    });

    it('gives the goods one value: the one the store declares, for customs and for cover alike', () => {
      const p = crossBorderPair();
      const { parcel } = mint(p, { items: [{ name: 'Ankara shirt', qty: 2 }], subtotal: 3400, declaredValue: 5000 });
      expect(parcel.customs!.declaredValue).toBe(5000);
      expect(parcel.declaredValue).toBe(5000);
      // Without a declared figure, what the buyer paid for the goods is their value, on both.
      const { parcel: plain } = mint(crossBorderPair(), { items: [{ name: 'Kitenge scarf', qty: 1 }], subtotal: 3400 });
      expect(plain.customs!.declaredValue).toBe(3400);
    });

    it('asks a domestic parcel for none of it', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop('Kisumu Duka', 'Kisumu', { lat: -0.09, lng: 34.77 });
      corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
      const store = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      const { parcel } = parcels.createInbound({
        vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700998',
        contentPhotoRef: photoOf(store.vendorId), size: 'M', shippingPolicy: store.shippingPolicy, quote: routing.quoteShipment(from.did, to.did),
      });
      expect(parcel.customs).toBeUndefined();
    });

    it('turns a walk-up counter send to another country away, and says who can', () => {
      // The counter asks for a size and a photo, never a contents list and a value. Minting an undeclared
      // international shipment and letting a border post discover it is the worse of the two answers.
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      expect(() =>
        parcels.accept({ parcelId: 'PUD-WALKUP', agentDid: from.did, destPudoDid: to.did, destZone: 'AddisAbaba', size: 'M', senderMobile: '+254700111', receiverMobile: '+251900111', dropoffPhotoRef: photoBy(from.did) } as never),
      ).toThrow(/another country/);
    });

    it('makes the leg that stops at a post read as one that stops', () => {
      const p = crossBorderPair();
      const plan = routing.planJourney({ originAgentDid: p.from.did, destAgentDid: p.to.did });
      expect(plan.legs[0].borderDwellH).toBe(BORDER_DWELL_H);

      // The same road, domestically: the wait is the difference, and it is on the leg rather than smeared
      // over the whole journey — the ETA stays optimistic by decision, but not about a queue at a border.
      const home = shop('Kisumu Duka', 'Kisumu', { lat: -0.09, lng: 34.77 });
      corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
      const domestic = routing.planJourney({ originAgentDid: p.from.did, destAgentDid: home.did });
      expect(domestic.legs[0].borderDwellH).toBe(0);
      expect(plan.totalHours).toBeGreaterThan(BORDER_DWELL_H);
    });
  });

  describe('and the two companies settle at cost', () => {
    /** A shop that can actually be paid — the wallet is provisioned at KYC approval. */
    function activeShop(shopName: string, zone: string, location: { lat: number; lng: number }, country?: string) {
      const a = shop(shopName, zone, location, country);
      agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'licence.pdf', shopPhotoRefs: ['shop.jpg'] });
      agents.decideKyc(a.did, true, undefined, undefined, '2099-12-31');
      return agents.get(a.did);
    }

    it('makes the performing sister whole and leaves it earning nothing', () => {
      // "We will recover cost only" (user, 2026-08-26). The Ethiopian sister pays its own shop in birr for
      // handling a parcel the Kenyan sister sold, and recovers exactly that — no margin, and no revenue at
      // all, because it did not sell anything. Its expense is REVERSED rather than matched with income.
      const bambi = activeShop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      const ke = entities.requireForJurisdiction('KE').entityId;
      const et = entities.requireForJurisdiction('ET').entityId;

      gate.payLabour(bambi.did, 0.3, 'PUD-XB', 'parcel', ke); // the collection fee, on a KE-sold parcel

      expect(books.balance(et, ACCOUNT_CODES.EXPENSE_PROVIDER_FEES)).toBe(0); // paid, then recharged
      expect(books.balance(et, ACCOUNT_CODES.REVENUE)).toBe(0); // it sold nothing, so it earned nothing
      expect(books.balance(et, ACCOUNT_CODES.INTERCOMPANY, undefined, ke)).toBe(0.3); // owed, in birr
      expect(books.balance(et, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, bambi.did)).toBe(-0.3); // the shop has its money
    });

    it('puts the cost on the sister that sold the shipment, in its own money, at the MID rate', () => {
      const bambi = activeShop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      const ke = entities.requireForJurisdiction('KE').entityId;
      const et = entities.requireForJurisdiction('ET').entityId;

      gate.payLabour(bambi.did, 0.3, 'PUD-XB', 'parcel', ke);

      // NOT the same number as the birr side, and that is the design: two entries, one per book, equal in
      // VALUE rather than in digits. The buyer's buffer never enters here — that is what makes it not ours.
      const cost = fx.convert(0.3, 'ETB', 'KES');
      expect(cost).not.toBe(0.3);
      expect(books.balance(ke, ACCOUNT_CODES.EXPENSE_PROVIDER_FEES)).toBe(cost);
      expect(books.balance(ke, ACCOUNT_CODES.INTERCOMPANY, undefined, et)).toBe(-cost); // negative = a payable
      expect(books.balances(ke)).toEqual({ balanced: true, drift: 0 });
      expect(books.balances(et)).toEqual({ balanced: true, drift: 0 });
    });

    it('undoes both halves when the take-in is undone — the seller’s at the rate it was booked at, not today’s — and only once', () => {
      // Found 2026-10-27: the take-back reversed the shop's float and its company's cost, and left the recharge standing, so
      // the shop's company kept a receivable for work it was no longer paid for and the seller a cost for a sale undone.
      const bambi = activeShop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      const ke = entities.requireForJurisdiction('KE').entityId;
      const et = entities.requireForJurisdiction('ET').entityId;

      gate.payLabour(bambi.did, 0.3, 'PUD-XU', 'parcel', ke);
      fx.setRate('ETB', 237.0, 'central-bank'); // the birr halves between the take-in and the void
      gate.clawbackLabour(bambi.did, 0.3, 'PUD-XU', ke);

      const settled = (entity: string, other: string) => {
        expect(books.balance(entity, ACCOUNT_CODES.EXPENSE_PROVIDER_FEES)).toBe(0);
        expect(books.balance(entity, ACCOUNT_CODES.INTERCOMPANY, undefined, other)).toBe(0);
        expect(books.balances(entity)).toEqual({ balanced: true, drift: 0 });
      };
      settled(et, ke);
      settled(ke, et);
      expect(books.balance(et, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, bambi.did)).toBe(0);
      expect(books.journal({ ref: 'PUD-XU' }).filter((e) => e.kind === 'recharge-undone')).toHaveLength(2);

      // Taken back a second time by mistake: the pair was undone once, and is never undone again.
      gate.clawbackLabour(bambi.did, 0.3, 'PUD-XU', ke);
      expect(books.journal({ ref: 'PUD-XU' }).filter((e) => e.kind === 'recharge-undone')).toHaveLength(2);
      expect(books.balance(ke, ACCOUNT_CODES.INTERCOMPANY, undefined, et)).toBe(0);
      expect(books.balance(et, ACCOUNT_CODES.INTERCOMPANY, undefined, ke)).toBe(0);
    });

    it('links the two entries by the same reference, so the pair can be found', () => {
      const bambi = activeShop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      gate.payLabour(bambi.did, 0.3, 'PUD-XB', 'parcel', entities.requireForJurisdiction('KE').entityId);
      const pair = books.journal({ ref: 'PUD-XB' }).filter((e) => e.kind === 'recharge-at-cost');
      expect(pair).toHaveLength(2);
      expect(new Set(pair.map((e) => e.entityId)).size).toBe(2); // one in each sister's book
    });

    it('recharges nobody inside one company, and nobody at all on an older parcel', () => {
      const duka = activeShop('Nairobi CBD', 'Nairobi', NAIROBI);
      const ke = entities.requireForJurisdiction('KE').entityId;

      gate.payLabour(duka.did, 0.3, 'PUD-KE', 'parcel', ke); // same sister both sides
      gate.payLabour(duka.did, 0.3, 'PUD-OLD', 'parcel'); // minted before parcels named a seller

      // The cost stays where it was paid, both times — which is exactly right for a single-sister world.
      expect(books.balance(ke, ACCOUNT_CODES.EXPENSE_PROVIDER_FEES)).toBe(0.6);
      expect(books.balance(ke, ACCOUNT_CODES.INTERCOMPANY, undefined, ke)).toBe(0);
      expect(books.journal({}).some((e) => e.kind === 'recharge-at-cost')).toBe(false);
    });
  });
  /**
   * PRE-REGISTRATION (the user, 2026-10-25: "it would be good when shops, drivers/fleets, hubs etc can preregister
   * before a country goes live. Then we have those on the network immediately"). Two members of staff mark a country
   * COMING: it takes sign-ups and their papers are checked, and nothing moves there until the day it opens.
   */
  describe('a country marked coming takes sign-ups, and holds the work until the day it opens', () => {
    const LUSAKA = { lat: -15.39, lng: 28.32 };
    const YEAR = 365 * 86_400_000;
    let seqZ = 0;
    const approvedShop = () => {
      const s = shop('Cairo Road Duka', 'Lusaka', LUSAKA, 'ZM');
      agents.submitKyc(s.did, { idCopyRef: 'i.jpg', tradingLicenceRef: 'l.jpg', shopPhotoRefs: ['s.jpg'] } as never);
      agents.decideKyc(s.did, true, undefined, undefined, '2099-12-31');
      return agents.get(s.did);
    };
    const approvedDriver = (extra: Record<string, unknown>) => {
      seqZ += 1;
      const d = drivers.register({
        displayName: `Mwila ${seqZ}`, fullName: `Mwila B ${seqZ}`, nationalId: `NID-ZM-C${seqZ}`, mobile: `+26097700${seqZ}000`,
        licenceClasses: ['truck'], licenceNumber: `L-ZM-${seqZ}`, licenceExpiresAt: new Date(Date.now() + YEAR).toISOString(), criminalRecordClear: true,
        ...extra,
      } as never);
      drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
      drivers.decideKyc(d.did, true);
      return drivers.get(d.did)!;
    };
    const activeFleet = () => {
      seqZ += 1;
      const m = managers.register({
        companyName: `Lusaka Haulage ${seqZ}`, contactPhone: `+26097710${seqZ}000`, ownerFullName: 'Owner', ownerNationalId: `NID-ZM-F${seqZ}`, location: LUSAKA, jurisdiction: 'ZM',
        requirements: { businessRegistrationNo: `BR-ZM-${seqZ}`, transportOperatorLicence: `TOL-ZM-${seqZ}`, taxId: `TAX-ZM-${seqZ}` },
      } as never);
      managers.submitKyc(m.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'p' });
      managers.decideKyc(m.did, true);
      return managers.recordBond(m.did);
    };

    it('takes a shop, a hub, a store, a fleet and a courier where it is coming — and none where nothing was decided', () => {
      expect(() => shop('Cairo Road Duka', 'Lusaka', LUSAKA, 'ZM')).toThrow(/does not take sign-ups in ZM yet, so a shop cannot register there/);
      presence.set({ jurisdiction: 'ZM', level: 'coming' });
      expect(presence.resolve('ZM').capabilities).toMatchObject({ signUp: true, takeIn: false, payouts: false, merchantOfRecord: false });
      expect(approvedShop()).toMatchObject({ country: 'ZM', status: 'ACTIVE' });
      expect(mdps.countryOf(mdps.register({ name: 'Lusaka Sort', zones: ['LSK'], country: 'ZM', location: LUSAKA }, { approvedBy: 'staff' }))).toBe('ZM');
      expect(vendors.register({ name: 'Kamwala Traders', country: 'ZM' }).country).toBe('ZM');
      expect(activeFleet()).toMatchObject({ status: 'ACTIVE', jurisdiction: 'ZM' });
      expect(approvedDriver({ jurisdiction: 'ZM' })).toMatchObject({ status: 'ACTIVE', jurisdiction: 'ZM' });
    });

    it('holds the work, said as the country not being open yet: no parcel taken in, no hub floor, no shift', () => {
      presence.set({ jurisdiction: 'ZM', level: 'coming' });
      const duka = approvedShop();
      expect(gate.canTransact(duka.did)).toMatchObject({ ok: false, code: 'COUNTRY_NOT_OPEN' });
      expect(agents.notOpenYet(duka)).toBe(true);
      expect(() => parcels.accept({ parcelId: 'PUD-ZM-1', agentDid: duka.did, destZone: 'Ndola', size: 'M', senderMobile: '+260977111222', receiverMobile: '+260977333444', dropoffPhotoRef: photoBy(duka.did) } as never)).toThrow(
        /SeeBuyGet is not open in Zambia yet: Cairo Road Duka takes parcels in from the day it opens/,
      );
      const hub = mdps.register({ name: 'Lusaka Sort', zones: ['LSK'], country: 'ZM', location: LUSAKA }, { approvedBy: 'staff' });
      expect(() => mdps.working(hub.mdpId)).toThrow(/SeeBuyGet is not open in Zambia yet: Lusaka Sort works from the day it opens/);
      // …and nothing is routed through it.
      expect(mdps.mdpForZone('LSK')).toBeUndefined();
      const courier = approvedDriver({ jurisdiction: 'ZM' });
      const fleetDriver = approvedDriver({ managerDid: activeFleet().did });
      for (const d of [courier, fleetDriver]) {
        expect(drivers.canOperate(d.did)).toBe(false);
        expect(drivers.offRoadReasons(d.did)).toContain('SeeBuyGet opens in Zambia soon: shifts start the day it opens');
      }
    });

    it('opens all of it the day the country does — and a country lowered later never strands a driver mid-work', () => {
      presence.set({ jurisdiction: 'ZM', level: 'coming' });
      const duka = approvedShop();
      const hub = mdps.register({ name: 'Lusaka Sort', zones: ['LSK'], country: 'ZM', location: LUSAKA }, { approvedBy: 'staff' });
      const courier = approvedDriver({ jurisdiction: 'ZM' });
      const fleetDriver = approvedDriver({ managerDid: activeFleet().did });

      presence.set({ jurisdiction: 'ZM', level: 'matched' });
      expect(gate.canTransact(duka.did).code).not.toBe('COUNTRY_NOT_OPEN');
      expect(agents.notOpenYet(duka)).toBe(false);
      expect(mdps.working(hub.mdpId).mdpId).toBe(hub.mdpId);
      expect(mdps.mdpForZone('LSK')?.mdpId).toBe(hub.mdpId);
      for (const d of [courier, fleetDriver]) {
        expect(drivers.canOperate(d.did)).toBe(true);
        expect(drivers.offRoadReasons(d.did)).toEqual([]);
      }
      // Only COMING holds the work: a country lowered stops new parcels by its own rules, and a driver finishing is not stopped.
      presence.set({ jurisdiction: 'ZM', level: 'observed' });
      expect(drivers.canOperate(courier.did)).toBe(true);
    });
  });
});
