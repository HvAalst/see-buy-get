import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { RoutingService } from './routing.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { ShippingApiService } from './shipping-api.service';
import { QuoteBookService } from './quote-book.service';
import { TRADE_CREDIT_LIMIT } from './pudo.config';
import { ANONYMOUS, ApiKeyService, type Caller } from './api-key.service';
import { ShippingApiController } from './shipping-api.controller';
import { VendorService } from './vendor.service';
import { ParcelService } from './parcel.service';
import { ToteService } from './tote.service';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { DispatchService } from './dispatch.service';
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
import { RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { IdempotencyService } from '../../foundation/http/idempotency.service';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { BooksService } from '../../foundation/books/books.service';
import { FxService } from '../../foundation/money/fx.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';

/**
 * The public quote — a price a BUYER can see before deciding to buy.
 *
 * Every price before this was computed for a vendor who had already decided to ship: authenticated, against
 * two shop DIDs, with a parcel about to exist. These tests pin what changes when the person asking has
 * decided nothing, holds no account, and has never heard of a DID.
 */
describe('the public shipping quote', () => {
  let agents: AgentService;
  let corridors: CorridorService;
  let shipping: ShippingApiService;
  let controller: ShippingApiController;
  let gate: WalletGateService;
  let vendors: VendorService;
  let apiKeys: ApiKeyService;
  let parcels: ParcelService;
  let quoteBook: QuoteBookService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ShippingApiController],
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
        BagPlanService, ForthcomingService, DockService, ShippingApiService, ToteService, ConsignmentService,
        VehicleService, DriverService, FleetService, DispatchService, MarketPulseStore, MarketPulseService,
        FleetManagerService, MediaService, CargoService, DigitalTwinService, TrackingService,
        TrackingContextService, NormalizationService, ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        EntityService, BooksService, FxService, RateLimitGuard, ApiKeyService, IdempotencyService, QuoteBookService,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    moduleRef.get(EntityService).seed();
    moduleRef.get(FxService).seed();
    agents = moduleRef.get(AgentService);
    corridors = moduleRef.get(CorridorService);
    shipping = moduleRef.get(ShippingApiService);
    controller = moduleRef.get(ShippingApiController);
    gate = moduleRef.get(WalletGateService);
    vendors = moduleRef.get(VendorService);
    apiKeys = moduleRef.get(ApiKeyService);
    parcels = moduleRef.get(ParcelService);
    quoteBook = moduleRef.get(QuoteBookService);
    moduleRef.get(BooksService).reset();
  });

  let seq = 0;
  const hours = { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null };

  /** A shop somebody can actually stand at: signed up, vetted, funded. */
  function shop(shopName: string, zone: string, location: { lat: number; lng: number }, country?: string, active = true) {
    seq += 1;
    const a = agents.register({
      shopName, zone, country, location, landmark: 'by the road', openingHours: hours, shelf: { rows: 3, cols: 3 },
      fullName: `${shopName} owner`, nationalId: `ID-${seq}`, mobile: `+2547000${seq}`, deviceImei: `IMEI-${seq}`,
      requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    });
    if (!active) return agents.get(a.did);
    agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'l.pdf', shopPhotoRefs: ['s.jpg'] });
    agents.decideKyc(a.did, true);
    gate.topUp(a.did, 50);
    return agents.get(a.did);
  }

  const NAIROBI = { lat: -1.286, lng: 36.817 };
  const KISUMU = { lat: -0.09, lng: 34.77 };
  const ADDIS = { lat: 9.03, lng: 38.74 };

  function domesticPair() {
    const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
    const to = shop('Kisumu Duka', 'Kisumu', KISUMU);
    corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
    return { from, to };
  }

  it('answers a place, not a DID — and creates nothing', () => {
    const { from, to } = domesticPair();
    const before = agents.list().map((a) => a.did).join();

    const q = shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 2 });

    expect(q.from.pointId).toBe(from.did);
    expect(q.to).toMatchObject({ pointId: to.did, name: 'Kisumu Duka', area: 'Kisumu', country: 'KE' });
    expect(q.price.currency).toBe('KES');
    expect(q.price.amount).toBeGreaterThan(0);
    expect(q.eta.readyAt).toMatch(/^\d{4}-/);
    expect(q.route.hops[0]).toBe('Nairobi CBD');
    // A quote is a question. Asking it changes nothing — no parcel, no account, no slot held.
    expect(agents.list().map((a) => a.did).join()).toBe(before);
  });

  it('never understates: the headline price is the ceiling, with the cheaper figure beside it', () => {
    // A buyer told 400 and charged 480 at checkout has been misled; one told 480 and charged 400 has not.
    domesticPair();
    const q = shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, size: 'M' });
    expect(q.price.amount).toBeGreaterThanOrEqual(q.price.minimum);
  });

  it('derives the size from the measurements, exactly as every mint does', () => {
    domesticPair();
    const small = shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, dimensionsCm: { l: 10, w: 8, h: 4 }, weightKg: 0.4 });
    const large = shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, dimensionsCm: { l: 60, w: 45, h: 35 }, weightKg: 12 });
    expect(small.parcel.size).toBe('S');
    expect(large.parcel.size).toBe('L');
    expect(large.price.amount).toBeGreaterThan(small.price.amount); // a bigger box costs more to move
  });

  it('sends a load too big for the pick-up network to dedicated freight instead of pricing it', () => {
    domesticPair();
    expect(() =>
      shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, dimensionsCm: { l: 200, w: 120, h: 120 }, weightKg: 400 }),
    ).toThrow(/dedicated freight/);
  });

  it('takes a collection point by id — what a checkout already holds', () => {
    const { from, to } = domesticPair();
    const q = shipping.quote({ from: { pointId: from.did }, to: { pointId: to.did }, size: 'M' });
    expect(q.to.pointId).toBe(to.did);
  });

  it('offers only shops somebody can actually stand at', () => {
    const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
    const draft = shop('Half Signed Up', 'Kisumu', KISUMU, 'KE', false);
    corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });

    // Named directly, or found by area: both refuse — an appointment nobody will keep is not an answer.
    expect(() => shipping.quote({ from: { pointId: from.did }, to: { pointId: draft.did }, size: 'M' })).toThrow(/not taking parcels yet/);
    expect(() => shipping.quote({ from: { pointId: from.did }, to: { country: 'KE', area: 'Kisumu' }, size: 'M' })).toThrow(/no collection point in Kisumu/);
  });

  it('says what it needs rather than guessing', () => {
    domesticPair();
    expect(() => shipping.quote({ from: { country: 'KE' }, to: { country: 'KE', area: 'Kisumu' }, size: 'M' })).toThrow(/Say where to collect from/);
    expect(() => shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE' }, size: 'M' })).toThrow(/Say where to send to/);
    expect(() => shipping.quote({ from: { pointId: 'did:glos:nope' }, to: { country: 'KE', area: 'Kisumu' }, size: 'M' })).toThrow(/No collection point/);
  });

  it('refuses to quote a shipment from a place to itself', () => {
    const { from } = domesticPair();
    expect(() => shipping.quote({ from: { pointId: from.did }, to: { pointId: from.did }, size: 'M' })).toThrow(/two ends/);
  });

  it('prices across a border, names the crossing, and says the declaration will be needed', () => {
    shop('Nairobi CBD', 'Nairobi', NAIROBI);
    shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
    corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });

    const q = shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'ET', area: 'AddisAbaba' }, size: 'M' });
    expect(q.route.crossesBorder).toBe(true);
    expect(q.route.crossings[0]).toMatchObject({ fromCountry: 'KE', toCountry: 'ET' });
    // Said at QUOTE time, not left for the mint to refuse — an integrator should know before they build.
    expect(q.requires).toEqual(['customs_declaration']);
    // A converted price stands on a rate, so it has a shelf life; a domestic one does not.
    expect(q.expiresAt).toBeDefined();
  });

  it('shows the price and not the cost sheet', () => {
    // The participant stack — every shop, its fee, the sister owed it — is open data we publish
    // deliberately, but handing a competitor a costed route on an unauthenticated call is a different act.
    domesticPair();
    const q = shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, size: 'M' }) as unknown as Record<string, unknown>;
    // The breakdown key is ABSENT rather than undefined, so there is nothing for a reader to probe at.
    expect(Object.keys(q).sort()).toEqual(['eta', 'expiresAt', 'from', 'mode', 'parcel', 'price', 'requires', 'route', 'to'].sort());
    expect(JSON.stringify(q)).not.toContain('entityId');
    expect(JSON.stringify(q)).not.toContain('nodeFees');
    expect(JSON.stringify(q)).not.toContain('platformFeePct');
  });

  describe('and who is asking', () => {
    const issue = (kind: 'publishable' | 'secret', mode: 'test' | 'live' = 'live') => {
      const store = vendors.register({ name: `Store ${(seq += 1)}`, country: 'KE' });
      return { store, ...apiKeys.issue(store.vendorId, kind, mode) };
    };
    const ask = (caller?: Caller) =>
      shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, size: 'M' }, caller);

    it('answers a stranger, and keeps the cost sheet back', () => {
      // The quote surface stays public: a merchant should see a price before they have an account, or the
      // product never gets integrated in the first place.
      domesticPair();
      const q = ask();
      expect(q.price.amount).toBeGreaterThan(0);
      expect(q.breakdown).toBeUndefined();
      expect(q.mode).toBe('live');
    });

    it('gives a server-side key the costed route, and a page key nothing extra', () => {
      domesticPair();
      const secret = apiKeys.resolve(issue('secret').secret);
      const publishable = apiKeys.resolve(issue('publishable').secret);

      const open = ask(publishable);
      expect(open.breakdown).toBeUndefined(); // a key in a page is a key a competitor can read

      const full = ask(secret).breakdown!;
      expect(full.nodes.map((n) => n.label)).toEqual(['Nairobi CBD', 'Kisumu Duka']);
      expect(full.nodeFees).toBeGreaterThan(0);
      expect(full.platformFeePct).toBeGreaterThanOrEqual(0);
    });

    it('always says which world answered', () => {
      domesticPair();
      expect(ask(apiKeys.resolve(issue('publishable', 'test').secret)).mode).toBe('test');
      expect(ask(apiKeys.resolve(issue('publishable', 'live').secret)).mode).toBe('live');
    });

    it('spends the merchant’s own rate limit, not their visitors’ shared one', () => {
      const { secret } = issue('publishable');
      expect(apiKeys.resolve(secret).rateKey).toMatch(/^key_/);
      expect(ANONYMOUS.rateKey).toBeUndefined(); // …and a stranger falls back to their IP
    });
  });

  describe('turning a price into a shipment', () => {
    const merchant = (mode: 'test' | 'live' = 'live') => {
      const store = vendors.register({ name: `Store ${(seq += 1)}`, country: 'KE' });
      vendors.topUp(store.vendorId, 500);
      return { store, caller: apiKeys.resolve(apiKeys.issue(store.vendorId, 'secret', mode).secret) };
    };
    const order = (over: Record<string, unknown> = {}) => ({
      from: { country: 'KE', area: 'Nairobi' },
      to: { country: 'KE', area: 'Kisumu' },
      dimensionsCm: { l: 30, w: 20, h: 10 },
      weightKg: 2,
      buyerMobile: '+254700999',
      contentPhotoRef: 'contents.jpg',
      externalOrderId: 'SO-1',
      ...over,
    });

    it('mints against whoever the KEY belongs to — there is no store field to change', () => {
      domesticPair();
      const { store, caller } = merchant();
      const made = shipping.mint(order(), caller);
      expect(made.simulated).toBe(false);
      expect(made.paid).toBe(true);
      expect(made.shipmentId).toMatch(/^PUD-/);
      expect(made.trackingKey).toMatch(/^T-/);
      expect(made.externalOrderId).toBe('SO-1');
      expect(parcels.get(made.shipmentId).vendorId).toBe(store.vendorId);
    });

    it('never hands the merchant the collection code', () => {
      // The handover secret is the only thing between a stranger and the parcel, and it belongs to the
      // person collecting, in their own app. A merchant does not need it.
      domesticPair();
      const made = shipping.mint(order(), merchant().caller);
      expect(JSON.stringify(made)).not.toContain(parcels.get(made.shipmentId).collectionCode);
      expect(JSON.stringify(made)).not.toContain('collectionCode');
    });

    it('refuses a publishable key and a stranger — a credential that ships things is not a page credential', () => {
      domesticPair();
      const store = vendors.register({ name: 'Page Key Store', country: 'KE' });
      const pk = apiKeys.resolve(apiKeys.issue(store.vendorId, 'publishable', 'live').secret);
      expect(() => shipping.mint(order(), pk)).toThrow(/secret key/);
      expect(() => shipping.mint(order(), ANONYMOUS)).toThrow(/secret key/);
    });

    it('asks for the two things a shipment cannot be sent without', () => {
      domesticPair();
      const { caller } = merchant();
      expect(() => shipping.mint(order({ buyerMobile: '  ' }), caller)).toThrow(/somebody has to be told/i);
      expect(() => shipping.mint(order({ contentPhotoRef: '' }), caller)).toThrow(/photo of the contents/i);
    });

    it('runs a TEST key through every check and then commits nothing', () => {
      // The whole promise of a sandbox: a request refused in test is refused live for the same reason, and
      // one that works in test would have worked. What it cannot give you is something to track.
      domesticPair();
      const before = parcels.list({}).length;
      const made = shipping.mint(order(), merchant('test').caller);

      expect(made.mode).toBe('test');
      expect(made.simulated).toBe(true);
      expect(made.shipmentId).toMatch(/^test_/);
      expect(made.price.amount).toBeGreaterThan(0); // priced by the same arithmetic a live one is
      expect(made.collect.name).toBe('Kisumu Duka');
      expect(made.did).toBeUndefined(); // nothing to track, and it does not pretend otherwise
      expect(made.label).toBeUndefined();
      expect(parcels.list({}).length).toBe(before); // no parcel
    });

    it('refuses in test for exactly the reasons it refuses live', () => {
      domesticPair();
      const live = merchant('live').caller;
      const test = merchant('test').caller;
      const tooBig = order({ dimensionsCm: { l: 200, w: 120, h: 120 }, weightKg: 400 });
      const nowhere = order({ to: { country: 'KE', area: 'Nowhere' } });

      for (const caller of [live, test]) {
        expect(() => shipping.mint(tooBig, caller)).toThrow(/dedicated freight/);
        expect(() => shipping.mint(nowhere, caller)).toThrow(/no collection point in Nowhere/);
        expect(() => shipping.mint(order({ contentPhotoRef: '' }), caller)).toThrow(/photo/i);
      }
    });

    it('will not sell a border crossing that cannot legally travel, in either mode', () => {
      shop('Nairobi CBD', 'Nairobi', NAIROBI);
      shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });
      const abroad = order({ to: { country: 'ET', area: 'AddisAbaba' } });

      expect(() => shipping.mint(abroad, merchant('test').caller)).toThrow(/what is in the parcel/);
      const made = shipping.mint({ ...abroad, items: [{ name: 'Ankara shirt', qty: 2 }], subtotal: 3400 }, merchant('live').caller);
      expect(made.route.crossesBorder).toBe(true);
      expect(parcels.get(made.shipmentId).customs?.declaredValue).toBe(3400);
    });

    it('spends an idempotency key at most once, through the endpoint', async () => {
      // The half that is not safe to repeat. A dropped response leaves a merchant unable to tell a request
      // that failed from one that succeeded silently, and both of their options are wrong without this.
      domesticPair();
      const { caller } = merchant();
      const dto = order() as never;

      const first = (await controller.mint(dto, caller, 'order-88')) as { shipmentId: string; replayed: boolean };
      const again = (await controller.mint(dto, caller, 'order-88')) as { shipmentId: string; replayed: boolean };

      expect(first.replayed).toBe(false);
      expect(again.replayed).toBe(true);
      expect(again.shipmentId).toBe(first.shipmentId); // the same shipment, not a second one
      expect(parcels.list({}).filter((p) => p.externalOrderId === 'SO-1')).toHaveLength(1);

      // The same name for a different order is the merchant's own bookkeeping going wrong — refused.
      await expect(controller.mint(order({ weightKg: 9 }) as never, caller, 'order-88')).rejects.toThrow(/already used/);
    });

    it('mints at the price the buyer was SHOWN, not the one the world moved to', () => {
      // The whole point. Between the product page and the checkout, everything a price rests on is free to
      // move — a shop's own advertised rate, a margin, a carrier range. Neither party did anything wrong,
      // and without this the buyer is simply charged the difference.
      const { from, to } = domesticPair();
      const { caller } = merchant();
      const quoted = shipping.quote({ from: { pointId: from.did }, to: { pointId: to.did }, size: 'M' }, caller);
      expect(quoted.quoteId).toMatch(/^qt_/);

      agents.setPrice(to.did, 40); // the destination shop puts its rate up, as it is free to do

      const fresh = shipping.quote({ from: { pointId: from.did }, to: { pointId: to.did }, size: 'M' }, caller);
      expect(fresh.price.amount).toBeGreaterThan(quoted.price.amount); // the world really did move

      const made = shipping.mint({ quoteId: quoted.quoteId, buyerMobile: '+254700999', contentPhotoRef: 'c.jpg' }, caller);
      expect(made.price.amount).toBe(quoted.price.amount);
      expect(parcels.get(made.shipmentId).shipmentCost).toBe(quoted.price.amount);
    });

    it('holds a price only for somebody it will recognise later', () => {
      // An anonymous quote is a calculation; a keyed one is a promise. We cannot promise a price to
      // somebody we have no way to know at the counter — and it is the honest reason a key is worth having.
      domesticPair();
      expect(shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, size: 'M' }).quoteId).toBeUndefined();
    });

    it('spends a quote once, and only once a shipment exists', () => {
      domesticPair();
      const { caller } = merchant();
      const quoted = shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, size: 'M' }, caller);

      // A mint that THREW leaves the price held: the merchant fixes what was wrong and redeems the same
      // promise, rather than going back to the buyer with a different number.
      expect(() => shipping.mint({ quoteId: quoted.quoteId, buyerMobile: '+254700999', contentPhotoRef: '' }, caller)).toThrow(/photo/i);
      expect(quoteBook.get(quoted.quoteId!)?.redeemedAt).toBeUndefined();

      const made = shipping.mint({ quoteId: quoted.quoteId, buyerMobile: '+254700999', contentPhotoRef: 'c.jpg' }, caller);
      expect(quoteBook.get(quoted.quoteId!)?.redeemedAs).toBe(made.shipmentId);
      // One name, one shipment. A promise made for one parcel is not a licence to mint ten at a stale price.
      expect(() => shipping.mint({ quoteId: quoted.quoteId, buyerMobile: '+254700999', contentPhotoRef: 'c.jpg' }, caller)).toThrow(/already been used/);
    });

    it('refuses a quote that has expired, that belongs to somebody else, or that was made in the other world', () => {
      domesticPair();
      const mine = merchant();
      const theirs = merchant();
      const quoted = shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, size: 'M' }, mine.caller);
      const body = { quoteId: quoted.quoteId, buyerMobile: '+254700999', contentPhotoRef: 'c.jpg' };

      // A stranger's quote reads as one that never existed: that an id they guessed belongs to a real
      // merchant is a fact they have not earned.
      expect(() => shipping.mint(body, theirs.caller)).toThrow(/No such quote/);

      const testKey = apiKeys.resolve(apiKeys.issue(mine.store.vendorId, 'secret', 'test').secret);
      expect(() => shipping.mint(body, testKey)).toThrow(/cannot be used with a test one/);

      const held = quoteBook.get(quoted.quoteId!)!;
      held.expiresAt = new Date(Date.now() - 1000).toISOString();
      expect(() => shipping.mint(body, mine.caller)).toThrow(/expired/);
    });

    it('holds the price, not the world', () => {
      // A held quote survives the route getting dearer — that is the promise. It must not survive the
      // route becoming impossible: minting into a shop that has stopped taking parcels would turn a price
      // promise into an undeliverable parcel.
      const { to } = domesticPair();
      const { caller } = merchant();
      const quoted = shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, size: 'M' }, caller);

      agents.setAvailability(to.did, false); // merely closed for the day — still honoured
      expect(shipping.mint({ quoteId: quoted.quoteId, buyerMobile: '+254700999', contentPhotoRef: 'c.jpg' }, caller).price.amount).toBe(quoted.price.amount);

      const second = shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { pointId: to.did }, size: 'M' }, caller);
      gate.chargeShipping(to.did, 50 + TRADE_CREDIT_LIMIT, 'drain'); // float AND credit line spent → LOCKED
      agents.refreshLock(to.did);
      expect(agents.get(to.did).status).toBe('LOCKED');
      expect(() => shipping.mint({ quoteId: second.quoteId, buyerMobile: '+254700999', contentPhotoRef: 'c.jpg' }, caller)).toThrow(/no longer taking parcels/);
    });

    it('will not be told two different things about one shipment', () => {
      domesticPair();
      const { caller } = merchant();
      const quoted = shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, size: 'M' }, caller);
      expect(() =>
        shipping.mint({ quoteId: quoted.quoteId, size: 'L', buyerMobile: '+254700999', contentPhotoRef: 'c.jpg' }, caller),
      ).toThrow(/not both/);
      expect(() => shipping.mint({ buyerMobile: '+254700999', contentPhotoRef: 'c.jpg' }, caller)).toThrow(/Send a quoteId, or say where/);
    });

    it('lets a developer rehearse the same checkout without minting a fresh quote each time', () => {
      // A dry run makes no commitment, and spending a name IS one. Same rule, not an exception to it.
      domesticPair();
      const { caller } = merchant('test');
      const quoted = shipping.quote({ from: { country: 'KE', area: 'Nairobi' }, to: { country: 'KE', area: 'Kisumu' }, size: 'M' }, caller);
      const body = { quoteId: quoted.quoteId, buyerMobile: '+254700999', contentPhotoRef: 'c.jpg' };
      expect(shipping.mint(body, caller).simulated).toBe(true);
      expect(shipping.mint(body, caller).simulated).toBe(true);
      expect(quoteBook.get(quoted.quoteId!)?.redeemedAt).toBeUndefined();
    });

    it('says so plainly when the store cannot pay for it', () => {
      // Not an error: the shipment exists and is waiting on money. A label is a claim on the network, so
      // it does not issue until it is paid for.
      domesticPair();
      const store = vendors.register({ name: 'Broke Store', country: 'KE' }); // no top-up
      const caller = apiKeys.resolve(apiKeys.issue(store.vendorId, 'secret', 'live').secret);
      const made = shipping.mint(order(), caller);
      expect(made.paid).toBe(false);
      expect(made.label).toBeUndefined();
    });
  });

  it('lists the countries and areas a picker is built from, and no half-signed-up shop', () => {
    domesticPair();
    shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
    shop('Half Signed Up', 'Nakuru', { lat: -0.3, lng: 36.07 }, 'KE', false);

    expect(controller.areas()).toEqual([
      { country: 'ET', areas: ['AddisAbaba'] },
      { country: 'KE', areas: ['Kisumu', 'Nairobi'] }, // Nakuru is not an area we serve — nobody there is live
    ]);
  });
});

describe('the public rate limit', () => {
  /** A minimal context: the guard only ever reads the decorator's spec and who is calling. */
  const contextFor = (ip: string, handler: () => void): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ ip, route: { path: '/v1/sbg/shipping/quotes' } }) }),
    }) as unknown as ExecutionContext;

  it('lets an unmarked route through untouched', () => {
    const guard = new RateLimitGuard(new Reflector());
    expect(guard.canActivate(contextFor('1.1.1.1', () => undefined))).toBe(true);
  });

  it('counts per caller, and says how long to wait', () => {
    // An endpoint anybody can call is an endpoint anybody can call a million times — the whole reason this
    // exists. One caller running out must not touch another.
    const reflector = { getAllAndOverride: () => ({ limit: 2, windowSec: 60 }) } as unknown as Reflector;
    const guard = new RateLimitGuard(reflector);
    const handler = () => undefined;

    expect(guard.canActivate(contextFor('1.1.1.1', handler))).toBe(true);
    expect(guard.canActivate(contextFor('1.1.1.1', handler))).toBe(true);
    expect(() => guard.canActivate(contextFor('1.1.1.1', handler))).toThrow(/try again in \d+s/);
    expect(guard.canActivate(contextFor('2.2.2.2', handler))).toBe(true); // a different caller is unaffected
  });

  it('forgets a caller once their window has passed', () => {
    const reflector = { getAllAndOverride: () => ({ limit: 1, windowSec: 60 }) } as unknown as Reflector;
    const guard = new RateLimitGuard(reflector);
    const handler = () => undefined;
    jest.useFakeTimers({ now: new Date('2026-08-26T10:00:00Z') });
    try {
      expect(guard.canActivate(contextFor('1.1.1.1', handler))).toBe(true);
      expect(() => guard.canActivate(contextFor('1.1.1.1', handler))).toThrow();
      jest.setSystemTime(new Date('2026-08-26T10:01:01Z'));
      expect(guard.canActivate(contextFor('1.1.1.1', handler))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
