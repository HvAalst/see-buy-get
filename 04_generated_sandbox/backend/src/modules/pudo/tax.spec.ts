import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { RoutingService, publicQuote } from './routing.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
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
import { coverFor, taxOn, WHOLESALE } from './pudo.config';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
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

/**
 * Tax — the layer that was declared and never computed.
 *
 * `PAYABLE_TAX` has been in the chart of accounts since the books were written, documented as *"never
 * revenue, not for a moment"*, and nothing had ever posted a line to it. Every price the network quoted
 * was a NET price presented to a customer as final.
 *
 * What these tests pin is the three things that had to be true at once. The rate is a per-sister knob and
 * it is ZERO until an operator sets one, so the day this shipped nothing repriced. What a customer pays is
 * the gross and what the sister earns is the net, and the gap between them lands in a liability rather
 * than in revenue. And the rate a shipment was SOLD at outlives every later change to it — because a tax
 * rate is changed by a government, on a date, and every sale before that date was correctly taxed at the
 * old one.
 */
describe('tax', () => {
  let agents: AgentService;
  let routing: RoutingService;
  let corridors: CorridorService;
  let vendors: VendorService;
  let entities: EntityService;
  let parcels: ParcelService;
  let gate: WalletGateService;
  let books: BooksService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, MarketPulseStore, MarketPulseService, FleetManagerService,
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        EntityService, BooksService, FxService,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed(); // compile() runs no lifecycle hooks — the sisters are seeded by hand, as at boot
    moduleRef.get(FxService).seed();
    agents = moduleRef.get(AgentService);
    routing = moduleRef.get(RoutingService);
    corridors = moduleRef.get(CorridorService);
    vendors = moduleRef.get(VendorService);
    parcels = moduleRef.get(ParcelService);
    gate = moduleRef.get(WalletGateService);
    books = moduleRef.get(BooksService);
    books.reset(); // each test starts on clean books — the money is derived from them
  });

  let seq = 0;
  const hours = { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null };
  const NAIROBI = { lat: -1.286, lng: 36.817 };
  const KISUMU = { lat: -0.09, lng: 34.77 };

  function shop(shopName: string, zone: string, location: { lat: number; lng: number }) {
    seq += 1;
    return agents.register({
      shopName, zone, location, landmark: 'by the road', openingHours: hours, shelf: { rows: 3, cols: 3 },
      fullName: `${shopName} owner`, nationalId: `ID-${seq}`, mobile: `+2547100${seq}`, deviceImei: `IMEI-T${seq}`,
      requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    });
  }

  /** A Kenyan route with a store funded to ship over it. */
  function route() {
    const from = shop(`Nairobi CBD ${seq}`, 'Nairobi', NAIROBI);
    const to = shop(`Kisumu Duka ${seq}`, 'Kisumu', KISUMU);
    corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
    const store = vendors.register({ name: `Store ${seq}`, country: 'KE' });
    vendors.topUp(store.vendorId, 5000);
    return { from, to, store };
  }

  const ke = () => entities.requireForJurisdiction('KE').entityId;
  /** Sixteen percent, charged by a sister registered to charge it. */
  const chargeVat = (lane?: string) => entities.setTax(ke(), { lane, ratePct: 0.16, label: 'VAT', registration: 'P051234567X' });

  function mint(store: { vendorId: string; shippingPolicy: unknown }, from: { did: string }, to: { did: string }, routeMode: 'locked' | 'flexible' = 'locked') {
    return parcels.createInbound({
      vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: `+25470012${seq}`,
      contentPhotoRef: 'contents.jpg', size: 'M', shippingPolicy: store.shippingPolicy as never, routeMode,
      quote: routing.quoteShipment(from.did, to.did),
    });
  }

  /** What a sister's books say it earned and what they say it owes an authority. Flipped for a human:
   *  revenue and liabilities are natural credits, so they read negative in the books. */
  const earned = () => -books.balance(ke(), ACCOUNT_CODES.REVENUE) || 0; // `|| 0` so an empty account reads 0, not -0
  const owedToTheAuthority = () => -books.balance(ke(), ACCOUNT_CODES.PAYABLE_TAX) || 0;

  describe('the arithmetic', () => {
    it('adds tax ON TOP and keeps the three figures adding up', () => {
      // Summed rather than multiplied out, so `net + tax === gross` holds exactly at two decimals. A
      // receipt whose lines do not add to its own total is a penny a merchant reconciles for an hour.
      const t = taxOn(100, 0.16);
      expect(t).toEqual({ net: 100, tax: 16, gross: 116 });
      expect(t.net + t.tax).toBe(t.gross);

      const odd = taxOn(12.37, 0.16);
      expect(odd.net + odd.tax).toBe(odd.gross);
      expect(odd.gross).toBe(14.35);
    });

    it('is the identity at zero, which is the default everywhere', () => {
      expect(taxOn(12.37, 0)).toEqual({ net: 12.37, tax: 0, gross: 12.37 });
    });

    it('never invents a negative tax or a NaN price', () => {
      expect(taxOn(10, -0.5)).toEqual({ net: 10, tax: 0, gross: 10 });
      expect(taxOn(Number.NaN, 0.16)).toEqual({ net: 0, tax: 0, gross: 0 });
    });
  });

  describe('the quote', () => {
    it('changes nothing at all until a sister is told to charge', () => {
      // The whole shape of the release: the seam is wired everywhere, and on the day it shipped every
      // price in the network was the number it was the day before.
      const { from, to } = route();
      const q = routing.quoteShipment(from.did, to.did);
      expect(q.tax.ratePct).toBe(0);
      expect(q.locked.tax).toBe(0);
      expect(q.locked.gross).toBe(q.locked.total);
      expect(q.flexible.gross).toBe(q.flexible.total);
    });

    it('taxes the whole price INCLUDING the platform fee — what is taxed is the sale, not the profit', () => {
      const { from, to } = route();
      chargeVat();
      const q = routing.quoteShipment(from.did, to.did);
      expect(q.locked.tax).toBe(Math.round(q.locked.total * 0.16 * 100) / 100);
      expect(q.locked.gross).toBe(Math.round((q.locked.total + q.locked.tax) * 100) / 100);
      // …and the sister's own price is untouched by it. `total` is the figure every margin question is
      // asked of, and tax must not be able to flatter or spoil the answer.
      expect(q.locked.total).toBe(Math.round((q.locked.base + q.locked.fee) * 100) / 100);
    });

    it('names the tax and the authority collecting it — the one part of a price that is nobody’s secret', () => {
      const { from, to } = route();
      chargeVat();
      expect(routing.quoteShipment(from.did, to.did).tax).toEqual({ ratePct: 0.16, label: 'VAT', registration: 'P051234567X' });
    });

    it('follows the SELLING sister, on the lane the size ships in', () => {
      // A parcel of this size ships on the `pudo` lane. Zero-rate that lane and the quote goes untaxed
      // even though the sister charges on everything else.
      const { from, to } = route();
      chargeVat();
      entities.setTax(ke(), { lane: 'pudo', ratePct: 0 });
      expect(routing.quoteShipment(from.did, to.did).locked.tax).toBe(0);
    });
  });

  describe('the books', () => {
    it('bills the GROSS, earns the NET, and owes the difference to an authority', () => {
      const { from, to, store } = route();
      chargeVat();
      const before = vendors.balanceOf(store.vendorId);
      const { parcel } = mint(store, from, to);

      expect(parcel.shipmentTax).toBeGreaterThan(0);
      expect(parcel.shipmentCost).toBe(Math.round(((parcel.shipmentCost! - parcel.shipmentTax!) + parcel.shipmentTax!) * 100) / 100);
      // The store paid the whole charge…
      expect(Math.round((before - vendors.balanceOf(store.vendorId)) * 100) / 100).toBe(parcel.shipmentCost);
      // …and only the part that was ours was earned.
      expect(earned()).toBe(Math.round((parcel.shipmentCost! - parcel.shipmentTax!) * 100) / 100);
      expect(owedToTheAuthority()).toBe(parcel.shipmentTax);
      // Never revenue, not for a moment — and the books still balance to the cent.
      expect(books.balances(ke()).balanced).toBe(true);
    });

    it('books nothing to the tax account when nobody is charging tax', () => {
      const { from, to, store } = route();
      mint(store, from, to);
      expect(owedToTheAuthority()).toBe(0);
      expect(books.balances(ke()).balanced).toBe(true);
    });

    it('un-owes the tax when a sale is refunded, not just the revenue', () => {
      // A voided sale un-owes its tax as surely as it un-earns its revenue. Reversing the gross out of
      // revenue alone would leave the sister liable for tax on a sale that no longer exists — it would
      // remit that tax out of its own pocket, and nothing in the books would say why.
      const a = shop('Void Test', 'Nairobi', NAIROBI);
      agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'licence.pdf', shopPhotoRefs: ['shop-1.jpg'] });
      agents.decideKyc(a.did, true); // a shop can only hold a balance once it is approved
      chargeVat();
      const bill = taxOn(WHOLESALE, 0.16);
      gate.topUp(a.did, 500, 'bank-1');
      gate.chargeShipping(a.did, bill.gross, 'PUD-VOID', bill.tax);
      expect(owedToTheAuthority()).toBe(bill.tax);

      gate.refund(a.did, bill.gross, 'PUD-VOID', bill.tax);
      expect(owedToTheAuthority()).toBe(0);
      expect(earned()).toBe(0);
      expect(books.balances(ke()).balanced).toBe(true);
    });

    it('gives back the tax inside a flexible rebate, in proportion to what was given back', () => {
      // The ceiling is gross and so is the actual, so the rebate is gross too — and the tax inside it is
      // the difference between two figures we HELD, never a rate re-applied to the rebate.
      const { from, to, store } = route();
      chargeVat();
      const { parcel } = mint(store, from, to, 'flexible');
      expect(parcel.ceilingTax).toBeGreaterThan(0);
      expect(parcel.ceilingCost).toBe(Math.round((parcel.ceilingCost! - parcel.ceilingTax! + parcel.ceilingTax!) * 100) / 100);
      // The held tax is the tax on the held price, at the same rate as everything else on this parcel.
      expect(parcel.ceilingTax).toBe(taxOn(Math.round((parcel.ceilingCost! - parcel.ceilingTax!) * 100) / 100, 0.16).tax);
    });
  });

  describe('durability — a rate change does not reach a sale already made', () => {
    it('stamps the rate, the name and the money on the parcel at mint', () => {
      const { from, to, store } = route();
      chargeVat();
      const { parcel } = mint(store, from, to);
      expect(parcel.taxPct).toBe(0.16);
      expect(parcel.taxLabel).toBe('VAT');
    });

    it('settles an unpaid parcel at the rate it was SOLD at, not today’s', () => {
      // A rate is changed by a government, on a date. Recomputing at settlement would restate a sale the
      // authority itself does not restate — and would charge a customer a rate nobody quoted them.
      const { from, to, store } = route();
      chargeVat();
      const poor = vendors.register({ name: 'Broke Store', country: 'KE' });
      const { parcel, paid } = parcels.createInbound({
        vendorId: poor.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700555',
        contentPhotoRef: 'contents.jpg', size: 'M', shippingPolicy: poor.shippingPolicy, quote: routing.quoteShipment(from.did, to.did),
      });
      expect(paid).toBe(false); // no float — it sits unpaid, carrying its stamped price
      const stampedTax = parcel.shipmentTax!;

      entities.setTax(ke(), { ratePct: 0.05 }); // the rate changes while the parcel waits
      vendors.topUp(poor.vendorId, 5000);
      parcels.settleUnpaid(parcel.parcelId);

      expect(owedToTheAuthority()).toBe(stampedTax); // the tax it was SOLD with, not the new rate
      expect(parcels.get(parcel.parcelId).taxPct).toBe(0.16);
      expect(books.balances(ke()).balanced).toBe(true);
    });

    it('reads a parcel from before tax existed as carrying none — never today’s rate', () => {
      // The deliberate difference from `platformFeePct`, whose absence means "the network default". A
      // shipment sold before any sister charged tax genuinely carried none, and reading a current rate
      // back onto it would invent a liability nobody ever collected.
      const { from, to, store } = route();
      const { parcel } = mint(store, from, to);
      expect(parcel.taxPct).toBe(0);
      expect(parcel.shipmentTax).toBe(0);
      chargeVat();
      expect(parcels.get(parcel.parcelId).taxPct).toBe(0);
    });
  });

  /**
   * The other slice carved out of the same payment.
   *
   * Cost of risk has been in every price since the rate stack shipped — it is one of the three layers the
   * platform fee is made of. What it had never been is money SET ASIDE: the whole fee landed in revenue,
   * which made carrying risk look like earning right up until somebody claimed. These tests pin that
   * moving it changes no price, only where the money sits.
   */
  describe('the cost-of-risk layer accrues to the claims provision', () => {
    const provision = () => -books.balance(ke(), ACCOUNT_CODES.PROVISION_CLAIMS) || 0;
    /** 10% cost of risk, and nothing else changed — margin stays at the network default. */
    const chargeRisk = () => entities.setRates(ke(), { costOfRiskPct: 0.1 });

    it('is a SLICE of the fee, never a fourth term on the price', () => {
      const { from, to } = route();
      const before = routing.quoteShipment(from.did, to.did).locked;
      chargeRisk();
      const after = routing.quoteShipment(from.did, to.did).locked;

      // The price DID rise, because a rate was turned up — but the provision is inside that fee, not
      // beside it: base + fee is still exactly the total.
      expect(after.provision).toBe(Math.round(after.base * 0.1 * 100) / 100);
      expect(Math.round((after.base + after.fee) * 100) / 100).toBe(after.total);
      expect(before.provision).toBe(0);
    });

    it('sets the slice aside instead of earning it, and the books still balance', () => {
      const { from, to, store } = route();
      chargeRisk();
      const { parcel } = mint(store, from, to);

      expect(parcel.shipmentProvision).toBeGreaterThan(0);
      expect(provision()).toBe(parcel.shipmentProvision);
      // Revenue is what is left after the cover — the two together are the whole charge.
      expect(Math.round((earned() + provision()) * 100) / 100).toBe(parcel.shipmentCost);
      expect(books.balances(ke()).balanced).toBe(true);
    });

    it('accrues NOTHING while the knob is at zero — which is every sister today', () => {
      const { from, to, store } = route();
      const { parcel } = mint(store, from, to);
      expect(parcel.shipmentProvision).toBe(0);
      expect(provision()).toBe(0);
      expect(earned()).toBe(parcel.shipmentCost); // exactly as before this existed
    });

    it('releases the cover when the sale is undone — a shipment nobody makes carries no risk', () => {
      const a = shop('Provision Void', 'Nairobi', NAIROBI);
      agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'l.pdf', shopPhotoRefs: ['s.jpg'] });
      agents.decideKyc(a.did, true);
      gate.topUp(a.did, 500, 'bank-1');
      gate.chargeShipping(a.did, 10, 'PUD-P1', 0, 2);
      expect(provision()).toBe(2);
      expect(earned()).toBe(8);

      gate.refund(a.did, 10, 'PUD-P1', 0, 2);
      expect(provision()).toBe(0);
      expect(earned()).toBe(0);
      expect(books.balances(ke()).balanced).toBe(true);
    });

    it('settles an unpaid parcel at the cover it was SOLD with, not today’s rate', () => {
      const { from, to } = route();
      chargeRisk();
      const poor = vendors.register({ name: 'Broke Store', country: 'KE' });
      const { parcel, paid } = parcels.createInbound({
        vendorId: poor.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700556',
        contentPhotoRef: 'contents.jpg', size: 'M', shippingPolicy: poor.shippingPolicy, quote: routing.quoteShipment(from.did, to.did),
      });
      expect(paid).toBe(false);
      const stamped = parcel.shipmentProvision!;
      expect(stamped).toBeGreaterThan(0);

      entities.setRates(ke(), { costOfRiskPct: 0 }); // the knob is turned back down while it waits
      vendors.topUp(poor.vendorId, 5000);
      parcels.settleUnpaid(parcel.parcelId);

      expect(provision()).toBe(stamped);
      expect(books.balances(ke()).balanced).toBe(true);
    });

    it('never leaves the building — the public quote carries no cover figure', () => {
      // `provision` is `base × costOfRiskPct` and `base` is public, so publishing it would publish the
      // knob by division. Stripping the `rates` object alone is not enough: a secret that can be divided
      // out of two public numbers is not a secret, and that is exactly how it slipped back in here
      // through a different field than the one that had been fixed.
      const { from, to } = route();
      chargeRisk();
      const open = publicQuote(routing.quoteShipment(from.did, to.did));
      expect((open as { rates?: unknown }).rates).toBeUndefined();
      expect((open.locked as { provision?: number }).provision).toBeUndefined();
      expect((open.flexible as { provision?: number }).provision).toBeUndefined();
      expect(open.locked.total).toBeGreaterThan(0); // …and everything a buyer is owed is still there
      expect(open.tax).toBeDefined();
    });

    it('never lets the slices sum past the payment they came from', () => {
      // Three clamps on one amount. A caller's arithmetic mistake must not be able to move our own money
      // between our own accounts, so an absurd provision is capped by what is actually left.
      const a = shop('Clamp', 'Nairobi', NAIROBI);
      agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'l.pdf', shopPhotoRefs: ['s.jpg'] });
      agents.decideKyc(a.did, true);
      gate.topUp(a.did, 500, 'bank-1');
      gate.chargeShipping(a.did, 10, 'PUD-P2', 4, 999);
      expect(provision()).toBe(6); // everything after the tax, and not a cent more
      expect(earned()).toBe(0);
      expect(books.balances(ke()).balanced).toBe(true);
    });
  });

  /**
   * Declared value and its premium — the half of item 8 that faces the customer.
   *
   * Cost of risk (above) is what the NETWORK sets aside out of its own fee. This is what a SHIPPER buys:
   * a free limit the sister carries on everything, and a declared value above it that costs a premium.
   * It is the piece that makes a damage award defensible, because until it existed the network's
   * liability was undefined and an adjudicator had a number to type with nothing to check it against.
   */
  describe('declared value and the cover it buys', () => {
    const provision = () => -books.balance(ke(), ACCOUNT_CODES.PROVISION_CLAIMS) || 0;
    /** Walk a parcel to the destination shelf, where a counter dispute can legally be raised. */
    function toShelf(parcelId: string, from: { did: string }, to: { did: string }) {
      const driver = corridors.addDriver({ driverDid: `did:glos:cov${seq}`, name: 'D', corridorId: corridors.addCorridor({ name: `Cov${seq}`, originZone: 'Nairobi', destZone: 'Kisumu' }).corridorId });
      parcels.intakeInbound(parcelId, from.did);
      parcels.handover({ agentDid: from.did, driverBadgeId: driver.badgeId, parcelIds: [parcelId] });
      parcels.shelve(parcelId, to.did);
    }

    /** 5,000 covered free, 2% on anything declared above it. */
    const coverPolicy = () => entities.setInsurance(ke(), { freeLimit: 5000, premiumPct: 0.02 });

    it('covers nothing until a sister says otherwise, and charges nothing either', () => {
      const { from, to } = route();
      expect(routing.quoteShipment(from.did, to.did).insurance).toEqual({ premiumPct: 0, freeLimit: 0 });
    });

    it('charges the premium only on the part that is NOT already covered', () => {
      // Charging the whole declared value would bill somebody for cover they already had — the kind of
      // small dishonesty nobody forgives twice.
      coverPolicy();
      const cover = coverFor({ declaredValue: 8000, premiumPct: 0.02, freeLimit: 5000 });
      expect(cover.premium).toBe(60); // 2% of the 3,000 above the limit, not of 8,000
      expect(cover.limit).toBe(8000);
    });

    it('treats the free limit as a FLOOR, not a swap — declaring less never reduces cover', () => {
      const cover = coverFor({ declaredValue: 900, premiumPct: 0.02, freeLimit: 5000 });
      expect(cover.limit).toBe(5000);
      expect(cover.premium).toBe(0); // nothing to charge for: it was covered anyway
    });

    it('reads a merchant order’s SUBTOTAL as the declaration — nobody is asked what they already said', () => {
      const { from, to, store } = route();
      coverPolicy();
      const { parcel } = parcels.createInbound({
        vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700771',
        contentPhotoRef: 'contents.jpg', size: 'M', shippingPolicy: store.shippingPolicy, subtotal: 9000,
        quote: routing.quoteShipment(from.did, to.did),
      });
      expect(parcel.declaredValue).toBe(9000);
      expect(parcel.coverLimit).toBe(9000);
      expect(parcel.shipmentPremium).toBe(80); // 2% of the 4,000 above the free limit
    });

    it('bills the premium as its OWN line on top, and sets it aside rather than earning it', () => {
      const { from, to, store } = route();
      coverPolicy();
      const bare = routing.quoteShipment(from.did, to.did).locked.gross;
      const before = vendors.balanceOf(store.vendorId);
      const { parcel } = parcels.createInbound({
        vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700772',
        contentPhotoRef: 'contents.jpg', size: 'M', shippingPolicy: store.shippingPolicy, subtotal: 6000,
        quote: routing.quoteShipment(from.did, to.did),
      });
      expect(parcel.shipmentPremium).toBe(20); // 2% of 1,000
      // The shipping price is untouched; the premium is added beside it, never hidden inside the fee.
      expect(parcel.shipmentCost).toBe(Math.round((bare + 20) * 100) / 100);
      expect(Math.round((before - vendors.balanceOf(store.vendorId)) * 100) / 100).toBe(parcel.shipmentCost);
      // …and it is money held against a promise, not money earned for a service performed.
      expect(provision()).toBe(20);
      expect(books.balances(ke()).balanced).toBe(true);
    });

    it('CAPS an upheld award at the cover — the whole point of declaring', async () => {
      const { from, to, store } = route();
      coverPolicy();
      const { parcel } = parcels.createInbound({
        vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700773',
        contentPhotoRef: 'contents.jpg', size: 'M', shippingPolicy: store.shippingPolicy, subtotal: 6000,
        quote: routing.quoteShipment(from.did, to.did),
      });
      toShelf(parcel.parcelId, from, to);
      parcels.dispute(parcel.parcelId, to.did, 'crushed', 'proof.jpg');

      expect(() => parcels.resolveDispute(parcel.parcelId, { decision: 'upheld', award: 6001, note: 'over' })).toThrow(/covered to 6000.00 \(declared\)/);
      const ok = parcels.resolveDispute(parcel.parcelId, { decision: 'upheld', award: 6000, note: 'total loss, declared value paid' });
      expect(ok.dispute?.award).toBe(6000);
    });

    it('a ZERO limit means NO POLICY STATED, not a policy of nothing', async () => {
      // Every sister starts at zero, because a free limit invented in this codebase would be a promise
      // nobody costed. Reading that as a hard cap would have made damage resolution inert on the day
      // cover shipped — an operator who has DECIDED to pay could not.
      const { from, to, store } = route();
      const { parcel } = parcels.createInbound({
        vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700774',
        contentPhotoRef: 'contents.jpg', size: 'M', shippingPolicy: store.shippingPolicy,
        quote: routing.quoteShipment(from.did, to.did),
      });
      expect(parcel.coverLimit).toBe(0);
      toShelf(parcel.parcelId, from, to);
      parcels.dispute(parcel.parcelId, to.did, 'crushed', 'proof.jpg');
      expect(parcels.resolveDispute(parcel.parcelId, { decision: 'upheld', award: 40, note: 'goodwill' }).dispute?.award).toBe(40);
    });

    it('stamps the policy, so changing it cannot rewrite what was promised', () => {
      const { from, to, store } = route();
      coverPolicy();
      const { parcel } = parcels.createInbound({
        vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700775',
        contentPhotoRef: 'contents.jpg', size: 'M', shippingPolicy: store.shippingPolicy, subtotal: 6000,
        quote: routing.quoteShipment(from.did, to.did),
      });
      entities.setInsurance(ke(), { freeLimit: 0, premiumPct: null }); // the sister withdraws cover entirely
      expect(parcels.get(parcel.parcelId).coverLimit).toBe(6000); // …but not on a shipment already sold
    });

    it('bounds the premium, and lets a sister carry as much free risk as it likes', () => {
      // A premium is a CHARGE, so a mistyped one reaches somebody's money. A free limit is the sister
      // promising to carry more itself, which costs a customer nothing and is nobody's business to refuse.
      expect(() => entities.setInsurance(ke(), { premiumPct: 2 })).toThrow(/fraction/);
      expect(() => entities.setInsurance(ke(), { freeLimit: -1 })).toThrow(/cannot be negative/);
      expect(entities.setInsurance(ke(), { freeLimit: 10_000_000 }).insurance?.freeLimit).toBe(10_000_000);
    });
  });
});
