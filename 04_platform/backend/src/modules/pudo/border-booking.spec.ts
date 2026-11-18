import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { BagClosureService } from './bag-closure.service';
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
import { JourneyPlanService } from './journey-plan.service';
import { GazetteerGeocoder, GEOCODER } from './geocoder';
import { HeuristicRouter, ROUTER } from './router';
import { BORDER_DWELL_H, BORDER_ROUTE_LEG_H, taxOn, withPlatformFee } from './pudo.config';
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
import { FxService } from '../../foundation/money/fx.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { evidencePhotos } from '../../../test/content-photo';
import type { BookedRoute } from './border-routes.types';

/*
 * 2026-11-18 — A PARCEL ABROAD AT THE COUNTER (the plan "Parcels across a border", step 2b). A shop takes a parcel in for a shop
 * in another country only on a route that is on: priced by the route (D15 — the route's price for its size, the shop's own fee
 * and our fee on top, the tax), declared at the counter (what it holds, its value from the invoice, the seal, who sends and who
 * receives it), paid there in cash, and planned through the route's departure hub and its arrival airport's warehouse.
 */
describe('a parcel abroad at the counter', () => {
  let agents: AgentService;
  let mdps: MdpService;
  let routing: RoutingService;
  let entities: EntityService;
  let parcels: ParcelService;
  let gate: WalletGateService;
  let media: MediaService;
  let plans: JourneyPlanService;
  let photoBy: (ownerDid: string) => string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, BagClosureService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector, JourneyPlanService,
        WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        EntityService, PresenceService, BooksService, FxService,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    photoBy = evidencePhotos(moduleRef);
    entities = moduleRef.get(EntityService);
    entities.seed();
    moduleRef.get(FxService).seed();
    agents = moduleRef.get(AgentService);
    mdps = moduleRef.get(MdpService);
    routing = moduleRef.get(RoutingService);
    parcels = moduleRef.get(ParcelService);
    gate = moduleRef.get(WalletGateService);
    media = moduleRef.get(MediaService);
    plans = moduleRef.get(JourneyPlanService);
    moduleRef.get(BooksService).reset();
  });

  let seq = 0;
  const hours = { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null };
  function shop(shopName: string, zone: string, location: { lat: number; lng: number }, country: string, pricePerParcel: number) {
    seq += 1;
    const a = agents.register({
      shopName, zone, country, location, pricePerParcel, landmark: 'by the road', openingHours: hours, shelf: { rows: 3, cols: 3 },
      fullName: `${shopName} owner`, nationalId: `BB-${seq}`, mobile: `+2547100${seq}`, deviceImei: `IMEI-BB-${seq}`,
      requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    });
    agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'tl.jpg', shopPhotoRefs: ['shop.jpg'] });
    agents.decideKyc(a.did, true, undefined, undefined, '2099-12-31');
    return agents.get(a.did);
  }

  const NAIROBI = { lat: -1.286, lng: 36.817 };
  const JKIA = { lat: -1.319, lng: 36.927 };
  const ADDIS = { lat: 9.03, lng: 38.74 };
  const BOLE = { lat: 8.978, lng: 38.799 };

  /** Kenya to Ethiopia: a Nairobi shop, our hub at Nairobi's airport, our warehouse hub at Addis's, an Addis shop — and the route as it would be booked. */
  function kenyaToEthiopia() {
    const from = shop('Nairobi Duka', 'Nairobi', NAIROBI, 'KE', 50);
    const to = shop('Bole Shop', 'AddisAbaba', ADDIS, 'ET', 40);
    gate.topUp(from.did, 5000);
    const departure = mdps.register({ name: 'JKIA Hub', zones: ['Nairobi'], location: JKIA }, { approvedBy: 'staff' });
    const arrival = mdps.register({ name: 'Bole Warehouse', zones: ['AddisAbaba'], country: 'ET', location: BOLE }, { approvedBy: 'staff' });
    const route: BookedRoute = {
      from: 'KE',
      to: 'ET',
      departure: { airport: 'NBO', mdpId: departure.mdpId, name: departure.name },
      arrival: { airport: 'ADD', mdpId: arrival.mdpId, name: arrival.name },
      carrier: { entityId: 'fwd-ke', name: 'Kilimanjaro Air Cargo' },
      prices: { S: 1200, M: 1900, L: 2900, currency: 'KES' },
    };
    return { from, to, departure, arrival, route };
  }

  const declaration = (agentDid: string, o: Record<string, unknown> = {}) => ({
    contents: 'Shoes',
    itemCount: 2,
    declaredValue: 45,
    currency: 'usd',
    invoicePhotoRef: media.upload({ ownerDid: agentDid, kind: 'invoice', dataUrl: PNG }).mediaId,
    contentsPhotoRef: media.upload({ ownerDid: agentDid, kind: 'content', dataUrl: PNG }).mediaId,
    seal: 'SL-004211',
    senderName: 'Wanjiru Kamau',
    receiverName: 'Abebe Bekele',
    ...o,
  });

  it('is priced by its route: the route’s price for its size, the shop’s own fee and our fee on top, the tax — and nothing of the arrival country’s', () => {
    const { from, to, route } = kenyaToEthiopia();
    const q = routing.quoteAbroad(from.did, to.did, 'M', route);
    const rates = entities.ratesFor(q.sellerEntityId, 'pudo');
    const base = Math.round((50 + 1900) * 100) / 100;
    const total = withPlatformFee(base, rates.totalPct);
    expect(q.locked).toMatchObject({ transport: 1900, base, total, gross: taxOn(total, entities.taxFor(q.sellerEntityId, 'pudo').ratePct).gross });
    expect(q.currency).toBe('KES');
    expect(q.border).toEqual({ from: 'KE', to: 'ET', departure: 'NBO', arrival: 'ADD', carrier: 'Kilimanjaro Air Cargo' });
    // Its stops are the sending country's: the receiver pays the arrival country's part there.
    expect(q.nodes.map((n) => n.country)).toEqual(q.nodes.map(() => 'KE'));
    expect(q.nodes.map((n) => n.label)).toContain('JKIA Hub');
    expect(q.nodes.map((n) => n.label)).not.toContain('Bole Shop');
    expect(() => routing.quoteAbroad(from.did, to.did, 'HEAVY', route)).toThrow(/heavy one goes as freight/);
    expect(() => routing.quoteAbroad(from.did, to.did, 'M', { ...route, prices: { ...route.prices, currency: 'EUR' } })).toThrow(/prices are in EUR, and Nairobi Duka sells in KES/);
  });

  it('goes through the route’s departure hub to its arrival airport’s warehouse, the route’s own leg timed as ours', () => {
    const { from, to, departure, arrival, route } = kenyaToEthiopia();
    const plan = routing.planJourney({ originAgentDid: from.did, destAgentDid: to.did, via: { departureMdpId: route.departure.mdpId, arrivalMdpId: route.arrival.mdpId } });
    expect(plan.hops.map((h) => h.label)).toEqual(['Nairobi Duka', departure.name, arrival.name, 'Bole Shop']);
    const leg = plan.legs.find((l) => l.fromNode === departure.mdpId)!;
    expect(leg).toMatchObject({ toNode: arrival.mdpId, crossesBorder: true, byRoute: true, borderDwellH: BORDER_DWELL_H });
    expect(Date.parse(leg.arriveAt) - Date.parse(leg.departAt)).toBeGreaterThanOrEqual((BORDER_ROUTE_LEG_H + BORDER_DWELL_H) * 3_600_000);
  });

  it('is refused by name before anything is written: no route on, no declaration, not cash, an invoice in no money, one photo twice, a photo not ours', () => {
    const { from, to, route } = kenyaToEthiopia();
    const quote = routing.quoteAbroad(from.did, to.did, 'M', route);
    const base = (id: string) => ({ parcelId: id, agentDid: from.did, destPudoDid: to.did, destZone: 'AddisAbaba', size: 'M' as const, senderMobile: '+254700111', receiverMobile: '+251900111', dropoffPhotoRef: photoBy(from.did) });
    expect(() => parcels.accept(base('PUD-AB1'))).toThrow(/no route from Kenya to Ethiopia is on/);
    expect(() => parcels.accept({ ...base('PUD-AB2'), abroadRoute: route, abroadQuote: quote })).toThrow(/needs its declaration first/);
    expect(() => parcels.accept({ ...base('PUD-AB3'), abroadRoute: route, abroadQuote: quote, abroad: declaration(from.did), paymentMode: 'prepaid' })).toThrow(/paid at this counter, in cash/);
    expect(() => parcels.accept({ ...base('PUD-AB4'), abroadRoute: route, abroadQuote: quote, abroad: declaration(from.did, { currency: 'KSH' }) })).toThrow(/KSH is not a currency/);
    const twice = base('PUD-AB5');
    expect(() => parcels.accept({ ...twice, abroadRoute: route, abroadQuote: quote, abroad: declaration(from.did, { invoicePhotoRef: twice.dropoffPhotoRef }) })).toThrow(/three photos/);
    expect(() => parcels.accept({ ...base('PUD-AB6'), abroadRoute: route, abroadQuote: quote, abroad: declaration(from.did, { invoicePhotoRef: photoBy(to.did) }) })).toThrow(/We do not hold that photo/);
    expect(parcels.list().filter((p) => p.parcelId.startsWith('PUD-AB'))).toEqual([]);
  });

  it('taken in: priced, declared, sealed and paid at the counter; the route kept as it was; its label and papers printed', () => {
    const { from, to, route } = kenyaToEthiopia();
    const quote = routing.quoteAbroad(from.did, to.did, 'M', route);
    const before = gate.canTransact(from.did).balance;
    const d = declaration(from.did);
    const p = parcels.accept({ parcelId: 'PUD-ABOK', agentDid: from.did, destPudoDid: to.did, destZone: 'AddisAbaba', size: 'M', senderMobile: '+254700111', receiverMobile: '+251900111', dropoffPhotoRef: photoBy(from.did), abroadRoute: route, abroadQuote: quote, abroad: d, expectedTotal: quote.locked.gross });
    expect(p.shipmentCost).toBe(quote.locked.gross);
    expect(p.customs).toMatchObject({ contents: 'Shoes ×2', itemCount: 2, declaredValue: 45, currency: 'USD', incoterm: 'DAP', namedPlace: 'Bole Shop, AddisAbaba' });
    expect(p.contentPhotoRef).toBe(d.contentsPhotoRef);
    expect(p.border).toMatchObject({ from: 'KE', to: 'ET', departure: { airport: 'NBO' }, arrival: { airport: 'ADD' }, carrier: { name: 'Kilimanjaro Air Cargo' }, routePrice: 1900, currency: 'KES', seal: 'SL-004211', senderName: 'Wanjiru Kamau', receiverName: 'Abebe Bekele' });
    expect(p.label?.svg).toContain('Seal SL-004211');
    expect(p.label?.svg).toContain('NBO → ADD');
    expect(p.label?.svg).toContain('Customs papers in the pouch');
    for (const said of ['Customs declaration', 'Wanjiru Kamau', 'Abebe Bekele', 'Shoes ×2 (2 items)', '45.00 USD, from the invoice', 'SL-004211', 'NBO → ADD, by Kilimanjaro Air Cargo', 'receiver’s (DAP)']) expect(p.border?.papers.svg).toContain(said);
    // Paid at the counter: the shop's float carries the price by the route — not the flat wholesale price — and the shop is
    // paid its take-in, as for any priced walk-up.
    const charged = gate.entries({ did: from.did }).filter((e) => e.reference === 'PUD-ABOK' && e.sign === '-');
    expect(charged.map((e) => e.amount)).toEqual([quote.locked.gross]);
    expect(p.intakeCharge).toBeUndefined();
    expect(gate.canTransact(from.did).balance).toBe(Math.round((before - quote.locked.gross + (p.intakeLabour ?? 0)) * 100) / 100);
    // The photos are kept with the parcel, as what they are.
    expect(media.linkedTo({ type: 'parcel', id: 'PUD-ABOK' }, 'invoice')).toEqual([d.invoicePhotoRef]);
    expect(media.linkedTo({ type: 'parcel', id: 'PUD-ABOK' }, 'content')).toEqual([d.contentsPhotoRef]);
    // A price that moved since the counter showed it is refused, as for any walk-up.
    expect(() => parcels.accept({ parcelId: 'PUD-ABMV', agentDid: from.did, destPudoDid: to.did, destZone: 'AddisAbaba', size: 'M', senderMobile: '+254700111', receiverMobile: '+251900111', dropoffPhotoRef: photoBy(from.did), abroadRoute: route, abroadQuote: quote, abroad: declaration(from.did), expectedTotal: quote.locked.gross - 1 })).toThrow(/The price is now/);
  });

  it('its plan, kept at the take-in, goes by its route; priced on the sending country’s stops, so nothing reads as off its plan', () => {
    const { from, to, departure, arrival, route } = kenyaToEthiopia();
    const quote = routing.quoteAbroad(from.did, to.did, 'M', route);
    parcels.accept({ parcelId: 'PUD-ABPL', agentDid: from.did, destPudoDid: to.did, destZone: 'AddisAbaba', size: 'M', senderMobile: '+254700111', receiverMobile: '+251900111', dropoffPhotoRef: photoBy(from.did), abroadRoute: route, abroadQuote: quote, abroad: declaration(from.did) });
    const plan = plans.freeze('PUD-ABPL')!;
    expect(plan.hops.map((h) => h.id)).toEqual([from.did, departure.mdpId, arrival.mdpId, to.did]);
    expect(plan.offPlan).toBeUndefined();
  });
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
