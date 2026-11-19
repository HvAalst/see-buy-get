import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { BagClosureService } from './bag-closure.service';
import { RoutingService } from './routing.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { VendorService } from './vendor.service';
import { ParcelService, operationalParcelView } from './parcel.service';
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
import { RoutePlanService } from './route-plan.service';
import { BorderParcelsController } from './border-parcels.controller';
import { ClearingController } from './clearing.controller';
import type { PersonService } from './person.service';
import { hashPhone } from '../../foundation/identity/phone';
import type { BusinessService } from './business.service';
import type { BorderRouteService } from './border-route.service';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
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
import { inCustoms } from './pudo.types';

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
  let totes: ToteService;
  let keeper: RoutePlanService;
  let photoBy: (ownerDid: string) => string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, BagClosureService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector, JourneyPlanService, RoutePlanService,
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
    totes = moduleRef.get(ToteService);
    keeper = moduleRef.get(RoutePlanService);
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

  /*
   * 2026-11-18 — STEP 2c: AT THE HUBS. Where it leaves, it goes with the route's carrier, never in a bag for one of our drivers;
   * where it arrives, the customs warehouse receives it and records what customs decided — and until customs releases it, or it
   * is held and paid, it leaves by no path.
   */
  describe('at the hubs (step 2c)', () => {
    /** A parcel abroad taken in, its plan kept, and brought by a driver's bag to the hub it leaves from. */
    function atDeparture(id: string) {
      const trip = kenyaToEthiopia();
      const quote = routing.quoteAbroad(trip.from.did, trip.to.did, 'M', trip.route);
      parcels.accept({ parcelId: id, agentDid: trip.from.did, destPudoDid: trip.to.did, destZone: 'AddisAbaba', size: 'M', senderMobile: '+254700111', receiverMobile: '+251900111', dropoffPhotoRef: photoBy(trip.from.did), abroadRoute: trip.route, abroadQuote: quote, abroad: declaration(trip.from.did) });
      plans.freeze(id);
      parcels.setTransit(id, 'On_Bus', 'BADGE-77', 'onto the bus');
      parcels.setTransit(id, 'At_MDP', trip.departure.name, 'dropped at the hub');
      parcels.get(id).atMdpId = trip.departure.mdpId;
      keeper.arrived(parcels.get(id), trip.departure.mdpId, trip.departure.name);
      return trip;
    }

    it('where it leaves: set aside from the sort and from every bag, and handed to the route’s carrier under its reference', () => {
      const { departure, arrival } = atDeparture('PUD-AB2C1');
      expect(() => mdps.sortParcel(departure.mdpId, 'PUD-AB2C1')).toThrow(/goes abroad from here with Kilimanjaro Air Cargo: set it aside/);
      const bag = totes.register(departure.mdpId);
      expect(() => mdps.fillTote(bag.code, 'PUD-AB2C1')).toThrow(/goes abroad from here with Kilimanjaro Air Cargo/);
      expect(operationalParcelView(parcels.get('PUD-AB2C1')).abroadAside).toBe('carrier');
      expect(parcels.abroadAt(departure.mdpId).map((p) => p.parcelId)).toEqual(['PUD-AB2C1']);
      expect(() => parcels.handToRouteCarrier(['PUD-AB2C1'], departure, ' ')).toThrow(/carrier’s reference/);
      expect(() => parcels.handToRouteCarrier(['PUD-AB2C1'], arrival, 'HAWB-778812')).toThrow(/leaves from JKIA Hub, not from Bole Warehouse/);
      const [p] = parcels.handToRouteCarrier(['pud-ab2c1'], departure, 'HAWB-778812');
      expect(p).toMatchObject({ status: 'On_Bus', border: { handed: { reference: 'HAWB-778812', by: 'JKIA Hub' } } });
      expect(p.custody?.find((l) => !l.to)).toMatchObject({ holderKind: 'carrier', holderId: 'Kilimanjaro Air Cargo' });
      // The driver who brought it to the hub no longer has it.
      expect(parcels.onBusWith('BADGE-77').map((x) => x.parcelId)).not.toContain('PUD-AB2C1');
      expect(() => parcels.handToRouteCarrier(['PUD-AB2C1'], departure, 'HAWB-778812')).toThrow(/handed to Kilimanjaro Air Cargo already/);
      // Not the hub's to act on there any more; the warehouse expects it.
      expect(parcels.abroadAt(departure.mdpId)).toEqual([]);
      expect(parcels.abroadAt(arrival.mdpId).map((x) => x.parcelId)).toEqual(['PUD-AB2C1']);
    });

    it('where it arrives: received from the carrier, under customs control, and on no path out until customs decides', () => {
      const { departure, arrival } = atDeparture('PUD-AB2C2');
      expect(() => parcels.receiveFromRouteCarrier('PUD-AB2C2', arrival)).toThrow(/never handed to Kilimanjaro Air Cargo/);
      parcels.handToRouteCarrier(['PUD-AB2C2'], departure, 'HAWB-778813');
      expect(() => parcels.receiveFromRouteCarrier('PUD-AB2C2', departure)).toThrow(/arrives at Bole Warehouse, not at JKIA Hub/);
      const p = parcels.receiveFromRouteCarrier('PUD-AB2C2', arrival);
      expect(p).toMatchObject({ status: 'At_MDP', atMdpId: arrival.mdpId });
      expect(p.plan?.hops[p.plan.at!].id).toBe(arrival.mdpId);
      expect(inCustoms(p)).toBe(true);
      expect(operationalParcelView(p).abroadAside).toBe('customs');
      expect(() => mdps.sortParcel(arrival.mdpId, 'PUD-AB2C2')).toThrow(/under customs control at Bole Warehouse: customs has not decided on it yet/);
      expect(() => parcels.receiveFromRouteCarrier('PUD-AB2C2', arrival)).toThrow(/received here already/);
      // Held: what customs asks, in the arrival country's money, and its reference — both needed.
      expect(() => parcels.recordClearance('PUD-AB2C2', departure, { outcome: 'released' })).toThrow(/does not clear customs at JKIA Hub/);
      expect(() => parcels.recordClearance('PUD-AB2C2', arrival, { outcome: 'held', reference: 'ET-CUS-0042' })).toThrow(/What customs asks to be paid/);
      expect(() => parcels.recordClearance('PUD-AB2C2', arrival, { outcome: 'held', amount: 1200.5 })).toThrow(/Customs’ reference/);
      const held = parcels.recordClearance('PUD-AB2C2', arrival, { outcome: 'held', amount: 1200.5, reference: 'ET-CUS-0042' });
      expect(held.border?.clearance).toMatchObject({ outcome: 'held', amount: 1200.5, currency: 'ETB', reference: 'ET-CUS-0042', by: 'Bole Warehouse' });
      expect(() => mdps.sortParcel(arrival.mdpId, 'PUD-AB2C2')).toThrow(/held by customs until 1200.50 ETB is paid \(customs reference ET-CUS-0042\)/);
      expect(() => parcels.recordClearance('PUD-AB2C2', arrival, { outcome: 'released' })).toThrow(/recorded already: held/);
      expect(parcels.abroadAt(arrival.mdpId).map((x) => x.parcelId)).toEqual(['PUD-AB2C2']);
      // Paid (step 3): no longer under customs control.
      held.border!.clearance!.paidAt = new Date().toISOString();
      expect(inCustoms(held)).toBe(false);
    });

    it('released by customs, it goes on from the warehouse as any parcel on the floor', () => {
      const { departure, arrival, to } = atDeparture('PUD-AB2C3');
      parcels.handToRouteCarrier(['PUD-AB2C3'], departure, 'HAWB-778814');
      parcels.receiveFromRouteCarrier('PUD-AB2C3', arrival);
      parcels.recordClearance('PUD-AB2C3', arrival, { outcome: 'released' });
      expect(inCustoms(parcels.get('PUD-AB2C3'))).toBe(false);
      expect(parcels.abroadAt(arrival.mdpId)).toEqual([]);
      expect(mdps.sortParcel(arrival.mdpId, 'PUD-AB2C3').nextDestination.id).toBe(to.did);
    });
  });

  /*
   * 2026-11-19 — STEP 3: THE RECEIVER PAYS (D17, D18 — the defaults). Held: customs' amount is paid to the clearing agent directly,
   * by a day 14 days on, the warehouse says when it is; not paid by then, the sender is asked. Released or paid: our clearance fee
   * and the last leg — priced by the arrival country's company when customs decided — are paid in cash at the receiver's shop.
   */
  describe('the receiver pays (step 3)', () => {
    /** At the arrival warehouse, received from the carrier — and the hub's own doors, as the Hub app calls them. */
    function atWarehouse(id: string) {
      const trip = kenyaToEthiopia();
      const quote = routing.quoteAbroad(trip.from.did, trip.to.did, 'M', trip.route);
      parcels.accept({ parcelId: id, agentDid: trip.from.did, destPudoDid: trip.to.did, destZone: 'AddisAbaba', size: 'M', senderMobile: '+254700111', receiverMobile: '+251900111', dropoffPhotoRef: photoBy(trip.from.did), abroadRoute: trip.route, abroadQuote: quote, abroad: declaration(trip.from.did) });
      plans.freeze(id);
      parcels.setTransit(id, 'On_Bus', 'BADGE-77', 'onto the bus');
      parcels.setTransit(id, 'At_MDP', trip.departure.name, 'dropped at the hub');
      parcels.get(id).atMdpId = trip.departure.mdpId;
      keeper.arrived(parcels.get(id), trip.departure.mdpId, trip.departure.name);
      parcels.handToRouteCarrier([id], trip.departure, `HAWB-${id}`);
      parcels.receiveFromRouteCarrier(id, trip.arrival);
      const borders = { payeeIn: () => 'Addis Clearing Ltd', feeIn: () => ({ amount: 500, currency: 'ETB' }), readdressIn: () => ({ storagePerDay: 50, handlingFee: 300, currency: 'ETB' }) } as unknown as BorderRouteService;
      // The Send app's sign-in: its sender, unless a test says somebody else is asking.
      const asking = { who: { phoneHash: hashPhone('+254700111'), personDid: 'did:p:sender' } };
      const persons = { requireByDid: () => asking.who } as unknown as PersonService;
      const doors = new BorderParcelsController(mdps, parcels, routing, borders, entities, persons);
      const hub = { did: trip.arrival.did } as IntrospectionResult;
      return { ...trip, doors, hub, asking };
    }

    it('held: what customs asks is paid to the clearing agent by a day 14 days on; our part, priced by the arrival company, at the shop', () => {
      const { arrival, departure, doors, hub } = atWarehouse('PUD-AB3H');
      const before = Date.now();
      const row = doors.customs(arrival.mdpId, 'PUD-AB3H', { outcome: 'held', amount: 1200.5, reference: 'ET-CUS-0042' }, hub);
      expect(row).toMatchObject({ step: 'held', held: { amount: 1200.5, currency: 'ETB', reference: 'ET-CUS-0042', payee: 'Addis Clearing Ltd' } });
      const p = parcels.get('PUD-AB3H');
      const payBy = Date.parse(p.border!.clearance!.payBy!);
      expect(payBy - before).toBeGreaterThanOrEqual(14 * 86_400_000 - 5_000);
      expect(payBy - before).toBeLessThan(14 * 86_400_000 + 60_000);
      // Our part: the clearance fee and the last leg from the warehouse to the shop, in the arrival company's money.
      const due = p.border!.due!;
      expect(due).toMatchObject({ fee: 500, currency: 'ETB', sellerEntityId: entities.requireForJurisdiction('ET').entityId });
      expect(due.lastLeg).toBeGreaterThan(0);
      expect(due.total).toBe(Math.round((500 + due.lastLeg) * 100) / 100);
      expect(p.payAtCollection).toMatchObject({ amount: due.total, currency: 'ETB' });
      // Paid to the clearing agent, and customs released it: the warehouse says so, once.
      expect(() => doors.paid(departure.mdpId, 'PUD-AB3H', { did: departure.did } as IntrospectionResult)).toThrow(/does not clear customs at JKIA Hub/);
      doors.paid(arrival.mdpId, 'PUD-AB3H', hub);
      expect(inCustoms(parcels.get('PUD-AB3H'))).toBe(false);
      expect(() => doors.paid(arrival.mdpId, 'PUD-AB3H', hub)).toThrow(/said paid already/);
      expect(parcels.abroadAt(arrival.mdpId)).toEqual([]);
    });

    it('not paid by its day: marked once, the sender asked — it stays under customs control', () => {
      const { arrival, doors, hub } = atWarehouse('PUD-AB3L');
      doors.customs(arrival.mdpId, 'PUD-AB3L', { outcome: 'held', amount: 80, reference: 'ET-CUS-0043' }, hub);
      expect(parcels.lapseUnpaidHolds(Date.now() + 13 * 86_400_000)).toEqual([]);
      expect(parcels.lapseUnpaidHolds(Date.now() + 15 * 86_400_000)).toEqual(['PUD-AB3L']);
      expect(parcels.lapseUnpaidHolds(Date.now() + 16 * 86_400_000)).toEqual([]);
      expect(parcels.get('PUD-AB3L').border?.clearance?.lapsedAt).toBeDefined();
      expect(inCustoms(parcels.get('PUD-AB3L'))).toBe(true);
      expect(parcels.abroadAt(arrival.mdpId).map((p) => p.parcelId)).toEqual(['PUD-AB3L']);
      expect(doors.abroad(arrival.mdpId, hub).rows[0].held).toMatchObject({ lapsed: true });
    });

    /*
     * 2026-11-19 — D19, D20: NOT PAID IN TIME, ITS SENDER CHOOSES. Someone else in the destination country takes it (once): the
     * receiver is now them, the release code is made again, they have 14 more days, and at the shop they pay the warehouse days
     * and the extra handling besides our fee and the last leg. Or it is given up, and the warehouse hands it to customs.
     */
    it('not paid in time: its sender names someone else there — a new code, 14 more days, the warehouse days and handling on top', () => {
      const { arrival, doors, hub, asking } = atWarehouse('PUD-AB3S');
      doors.customs(arrival.mdpId, 'PUD-AB3S', { outcome: 'held', amount: 80, reference: 'ET-CUS-0060' }, hub);
      const actor = { did: 'did:p:sender' } as IntrospectionResult;
      expect(() => doors.choose('PUD-AB3S', { choice: 'give_up' }, actor)).toThrow(/whose day to pay has passed/);
      // Its day to pay passed yesterday.
      parcels.get('PUD-AB3S').border!.clearance!.payBy = new Date(Date.now() - 86_400_000).toISOString();
      expect(parcels.lapseUnpaidHolds()).toEqual(['PUD-AB3S']);
      // Only its sender chooses.
      const sender = asking.who;
      asking.who = { phoneHash: hashPhone('+254799999'), personDid: 'did:p:other' };
      expect(() => doors.choose('PUD-AB3S', { choice: 'give_up' }, actor)).toThrow(/No such parcel/);
      asking.who = sender;
      // Someone else: not the receiver it went to, nor the sender, and a real number.
      expect(() => doors.choose('PUD-AB3S', { choice: 'someone_else', receiverMobile: '+251900111' }, actor)).toThrow(/not the receiver it was sent to, nor you/);
      expect(() => doors.choose('PUD-AB3S', { choice: 'someone_else', receiverMobile: '+254700111' }, actor)).toThrow(/not the receiver it was sent to, nor you/);
      const before = parcels.get('PUD-AB3S');
      const oldCode = before.otp;
      const dueBefore = before.border!.due!;
      const view = doors.choose('PUD-AB3S', { choice: 'someone_else', receiverMobile: '+251911222333' }, actor);
      const p = parcels.get('PUD-AB3S');
      expect(p.receiverPhoneHash).toBe(hashPhone('+251911222333'));
      expect(p.otp).not.toBe(oldCode);
      expect(p.border?.clearance).toMatchObject({ decision: { choice: 'someone_else' } });
      expect(p.border?.clearance?.lapsedAt).toBeUndefined();
      expect(Date.parse(p.border!.clearance!.payBy!) - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
      // On top: one day at the warehouse at 50, and 300 for the handling.
      expect(p.border?.due).toMatchObject({ storage: 50, handling: 300, total: Math.round((dueBefore.fee + dueBefore.lastLeg + 350) * 100) / 100 });
      expect(p.payAtCollection?.amount).toBe(p.border?.due?.total);
      expect(view.abroad).toMatchObject({ stage: 'held', decision: 'someone_else' });
      expect(view.abroad?.choices).toBeUndefined();
      expect(doors.abroad(arrival.mdpId, hub).rows[0]).toMatchObject({ step: 'held', someoneElse: true });
      // Not paid by them either: only giving it up is left.
      parcels.lapseUnpaidHolds(Date.now() + 30 * 86_400_000);
      expect(parcels.consumerParcel('PUD-AB3S', sender).abroad?.choices).toEqual(['give_up']);
      expect(() => doors.choose('PUD-AB3S', { choice: 'someone_else', receiverMobile: '+251911444555' }, actor)).toThrow(/once already: it can only be given up now/);
    });

    it('given up: the warehouse hands it to customs to dispose of, and it is no longer ours', () => {
      const { arrival, departure, doors, hub } = atWarehouse('PUD-AB3G');
      doors.customs(arrival.mdpId, 'PUD-AB3G', { outcome: 'held', amount: 80, reference: 'ET-CUS-0061' }, hub);
      expect(() => doors.dispose(arrival.mdpId, 'PUD-AB3G', hub)).toThrow(/was not given up by its sender/);
      parcels.lapseUnpaidHolds(Date.now() + 15 * 86_400_000);
      const view = doors.choose('PUD-AB3G', { choice: 'give_up' }, { did: 'did:p:sender' } as IntrospectionResult);
      expect(view.abroad).toMatchObject({ stage: 'given_up', decision: 'give_up' });
      expect(doors.abroad(arrival.mdpId, hub).rows.map((r) => [r.parcelId, r.step])).toEqual([['PUD-AB3G', 'given_up']]);
      expect(() => doors.dispose(departure.mdpId, 'PUD-AB3G', { did: departure.did } as IntrospectionResult)).toThrow(/does not clear customs at JKIA Hub/);
      doors.dispose(arrival.mdpId, 'PUD-AB3G', hub);
      const p = parcels.get('PUD-AB3G');
      expect(p.status).toBe('Voided');
      expect(p.custody?.at(-1)).toMatchObject({ holderKind: 'customs', holderId: 'customs at ADD', to: expect.any(String) });
      expect(p.payAtCollection).toBeUndefined();
      expect(inCustoms(p)).toBe(false);
      expect(doors.abroad(arrival.mdpId, hub).rows).toEqual([]);
      expect(() => doors.dispose(arrival.mdpId, 'PUD-AB3G', hub)).toThrow(/handed to customs already/);
    });

    it('released: our part is taken in cash at the receiver’s shop as the parcel is handed over — the float asked first', () => {
      const { arrival, to, doors, hub } = atWarehouse('PUD-AB3R');
      doors.customs(arrival.mdpId, 'PUD-AB3R', { outcome: 'released' }, hub);
      const p = parcels.get('PUD-AB3R');
      expect(p.border?.clearance?.payee).toBeUndefined();
      const due = p.payAtCollection!;
      parcels.setTransit('PUD-AB3R', 'On_Bus', 'BADGE-88', 'onto the bus to its shop');
      parcels.arrive('PUD-AB3R', to.did);
      // A float that cannot take it is told to top up, before the code is tried.
      expect(() => parcels.pickup('PUD-AB3R', to.did, 'wrong')).toThrow(/Top up first: .* is due on this parcel/);
      gate.topUp(to.did, 50_000);
      parcels.pickup('PUD-AB3R', to.did, p.otp!);
      const charged = gate.entries({ did: to.did }).filter((e) => e.reference === 'PUD-AB3R' && e.sign === '-');
      expect(charged.map((e) => e.amount)).toEqual([due.amount]);
      expect(parcels.get('PUD-AB3R')).toMatchObject({ status: 'Delivered', payAtCollection: { paidAt: expect.any(String) } });
    });
  });
  /*
   * 2026-11-19 — STEP 4: THE CLEARING AGENT'S SIDE. Named by staff for an arrival country, its owner accepts in the Business app;
   * from then its people see the parcels into that country and record what customs decided, and when a held one is paid — the
   * same acts as the warehouse. A viewer reads; a business that does not clear there, or staff, is refused.
   */
  describe('the clearing agent (step 4)', () => {
    function agentAtWarehouse(id: string) {
      const trip = kenyaToEthiopia();
      const quote = routing.quoteAbroad(trip.from.did, trip.to.did, 'M', trip.route);
      parcels.accept({ parcelId: id, agentDid: trip.from.did, destPudoDid: trip.to.did, destZone: 'AddisAbaba', size: 'M', senderMobile: '+254700111', receiverMobile: '+251900111', dropoffPhotoRef: photoBy(trip.from.did), abroadRoute: trip.route, abroadQuote: quote, abroad: declaration(trip.from.did) });
      plans.freeze(id);
      parcels.setTransit(id, 'On_Bus', 'BADGE-77', 'onto the bus');
      parcels.setTransit(id, 'At_MDP', trip.departure.name, 'dropped at the hub');
      parcels.get(id).atMdpId = trip.departure.mdpId;
      keeper.arrived(parcels.get(id), trip.departure.mdpId, trip.departure.name);
      parcels.handToRouteCarrier([id], trip.departure, `HAWB-${id}`);
      let accepted = false;
      const borders = {
        clearsFor: (entityId: string) => (entityId === 'agent-et' ? [{ country: 'ET', name: 'Ethiopia', ...(accepted ? { acceptedAt: '2026-11-19T08:00:00.000Z' } : {}) }] : []),
        clearsIn: (entityId: string, country: string) => accepted && entityId === 'agent-et' && country === 'ET',
        acceptAsClearer: (country: string, entityId: string) => {
          if (country !== 'ET' || entityId !== 'agent-et') throw new Error('You are not the clearing agent named for ' + country);
          accepted = true;
        },
        payeeIn: () => 'Addis Clearing Ltd',
        feeIn: () => ({ amount: 500, currency: 'ETB' }),
      } as unknown as BorderRouteService;
      const acting = (role: string, entityId = 'agent-et') => ({ member: { name: 'Hana', role, personDid: 'did:p:hana' }, entity: { entityId, name: entityId === 'agent-et' ? 'Addis Clearing Ltd' : 'Other Agent' } });
      const businesses = {
        requireMember: (actor: { tenant: string; role: string; memberRole: string }) => acting(actor.memberRole, actor.tenant),
        requireOwner: (a: { member: { role: string } }) => {
          if (a.member.role !== 'owner') throw new Error('Only an owner of the business can do that');
        },
        mayAct: (a: { member: { role: string } }) => a.member.role !== 'viewer',
      } as unknown as BusinessService;
      const doors = new ClearingController(businesses, borders, parcels, routing, entities);
      const as = (memberRole: string, tenant = 'agent-et') => ({ role: 'business', tenant, memberRole }) as unknown as IntrospectionResult;
      return { ...trip, doors, as };
    }

    it('accepted by its owner, it sees the parcels into its country, coming and under customs control', () => {
      const { doors, as, arrival } = agentAtWarehouse('PUD-AB4A');
      expect(doors.view(as('owner'))).toEqual({ countries: [{ country: 'ET', name: 'Ethiopia', accepted: false }], rows: [] });
      expect(() => doors.customs('PUD-AB4A', { outcome: 'released' }, as('owner'))).toThrow(/Addis Clearing Ltd does not clear customs for PUD-AB4A/);
      expect(() => doors.accept('ET', as('booker'))).toThrow(/Only an owner/);
      const v = doors.accept('ET', as('owner'));
      expect(v.countries[0]).toMatchObject({ accepted: true });
      expect(v.rows.map((r) => [r.parcelId, r.step])).toEqual([['PUD-AB4A', 'coming']]);
      parcels.receiveFromRouteCarrier('PUD-AB4A', arrival);
      expect(doors.view(as('booker')).rows.map((r) => [r.parcelId, r.step])).toEqual([['PUD-AB4A', 'customs']]);
      // Only the parcels into the countries it clears in; and a decision said for another country is refused by the parcel itself.
      expect(parcels.abroadInto(['KE'])).toEqual([]);
      expect(parcels.abroadInto(['ET']).map((x) => x.parcelId)).toEqual(['PUD-AB4A']);
      expect(() => parcels.recordClearance('PUD-AB4A', { country: 'KE', name: 'Someone' }, { outcome: 'released' })).toThrow(/does not clear customs at Someone/);
      // Staff read parcels abroad on the console, not here.
      expect(() => doors.view({ role: 'operator' } as IntrospectionResult)).toThrow(/staff read parcels abroad on the console/);
    });

    it('records what customs decided and when it is paid — the warehouse’s acts, under its own name; a viewer reads', () => {
      const { doors, as, arrival } = agentAtWarehouse('PUD-AB4B');
      doors.accept('ET', as('owner'));
      expect(() => doors.customs('PUD-AB4B', { outcome: 'held', amount: 90, reference: 'ET-CUS-0050' }, as('booker'))).toThrow(/has not been received at Bole Warehouse/);
      parcels.receiveFromRouteCarrier('PUD-AB4B', arrival);
      expect(() => doors.customs('PUD-AB4B', { outcome: 'held', amount: 90, reference: 'ET-CUS-0050' }, as('viewer'))).toThrow(/A viewer reads this/);
      const row = doors.customs('PUD-AB4B', { outcome: 'held', amount: 90, reference: 'ET-CUS-0050' }, as('booker'));
      expect(row).toMatchObject({ step: 'held', held: { amount: 90, currency: 'ETB', payee: 'Addis Clearing Ltd' } });
      const p = parcels.get('PUD-AB4B');
      expect(p.border?.clearance?.by).toBe('Addis Clearing Ltd (Hana)');
      expect(p.payAtCollection?.amount).toBe(p.border?.due?.total);
      // Another agent, even accepted elsewhere, does not clear this one.
      expect(() => doors.paid('PUD-AB4B', as('owner', 'agent-other'))).toThrow(/Other Agent does not clear customs for PUD-AB4B/);
      doors.paid('PUD-AB4B', as('booker'));
      expect(inCustoms(parcels.get('PUD-AB4B'))).toBe(false);
      expect(doors.view(as('owner')).rows).toEqual([]);
    });
  });
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
