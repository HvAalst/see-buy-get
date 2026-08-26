import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { RoutingService } from './routing.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { ShippingApiService } from './shipping-api.service';
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
        EntityService, BooksService, FxService, RateLimitGuard,
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
    expect(Object.keys(q).sort()).toEqual(['eta', 'expiresAt', 'from', 'parcel', 'price', 'requires', 'route', 'to'].sort());
    expect(JSON.stringify(q)).not.toContain('entityId');
    expect(JSON.stringify(q)).not.toContain('nodeFees');
    expect(JSON.stringify(q)).not.toContain('platformFeePct');
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
