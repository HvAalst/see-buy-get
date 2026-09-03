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
import { SbgController } from './pudo.controller';
import { IdentityController } from './identity.controller';
import { AccountService } from './account.service';
import { OtpService } from './otp.service';
import { PersonService } from './person.service';
import { InviteService } from './invite.service';
import { ApiKeyService } from './api-key.service';
import { AuthService } from '../../foundation/auth/auth.service';
import {
  BAG_CAPACITY_UNITS, DIM_DIVISOR, MEDIUM_CM3, MEDIUM_KG, SIZE_LIMITS, SIZE_TRANSPORT_FACTOR, SIZE_UNITS,
  classifySize, measuredFactor,
} from './pudo.config';
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
 * ITEM 9 — dimensional weight where the dimensions are actually known.
 *
 * The network prices transport by how much of a vehicle a parcel takes, and until now it read that off a
 * four-step table: S, M, L, HEAVY. A step function is the right instrument at a counter, where a person is
 * judging a box by eye and a tier derived from a limit table is a number they cannot be talked out of. It
 * is the wrong instrument the moment a machine has been handed real centimetres, because it throws the
 * measurement away — every box between 46 and 60 cm long paid the same two mediums, and one centimetre
 * over an edge doubled the transport.
 *
 * The rule these tests pin is therefore NOT about who is standing there. It is about whether a MEASUREMENT
 * EXISTS: measured → continuous, declared → the band it was declared as. The size TIER is still derived
 * from the same limit table either way, so nothing became under-declarable that was not before; what
 * changed is that a real measurement is no longer rounded up to the next tier.
 */
describe('dimensional weight', () => {
  let agents: AgentService;
  let routing: RoutingService;
  let corridors: CorridorService;
  let vendors: VendorService;
  let entities: EntityService;
  let parcels: ParcelService;
  let controller: SbgController;
  let identity: IdentityController;
  let persons: PersonService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, MarketPulseStore, MarketPulseService, FleetManagerService,
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        AccountService, OtpService, PersonService, InviteService, ApiKeyService, AuthService,
        WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        EntityService, BooksService, FxService,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
      controllers: [SbgController, IdentityController],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed(); // compile() runs no lifecycle hooks — the sisters are seeded by hand, as at boot
    moduleRef.get(FxService).seed();
    moduleRef.get(BooksService).reset();
    agents = moduleRef.get(AgentService);
    routing = moduleRef.get(RoutingService);
    corridors = moduleRef.get(CorridorService);
    vendors = moduleRef.get(VendorService);
    parcels = moduleRef.get(ParcelService);
    controller = moduleRef.get(SbgController);
    identity = moduleRef.get(IdentityController);
    persons = moduleRef.get(PersonService);
  });

  let seq = 0;
  const hours = { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null };
  const NAIROBI = { lat: -1.286, lng: 36.817 };
  const KISUMU = { lat: -0.09, lng: 34.77 };

  function shop(shopName: string, zone: string, location: { lat: number; lng: number }) {
    seq += 1;
    return agents.register({
      shopName, zone, location, landmark: 'by the road', openingHours: hours, shelf: { rows: 3, cols: 3 },
      fullName: `${shopName} owner`, nationalId: `ID-D${seq}`, mobile: `+2547200${seq}`, deviceImei: `IMEI-D${seq}`,
      requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    });
  }

  function route() {
    const from = shop(`Nairobi CBD ${seq}`, 'Nairobi', NAIROBI);
    const to = shop(`Kisumu Duka ${seq}`, 'Kisumu', KISUMU);
    corridors.addCorridor({ name: 'Nairobi-Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
    const store = vendors.register({ name: `Store ${seq}`, country: 'KE' });
    vendors.topUp(store.vendorId, 5000);
    return { from, to, store };
  }

  const limit = (size: 'S' | 'M' | 'L' | 'HEAVY') => SIZE_LIMITS.find((l) => l.size === size)!;
  /** The largest parcel a band will still accept — the one point where a band and a measurement can be
   *  compared without arguing about which parcel is representative. */
  const ceilingOf = (size: 'S' | 'M' | 'L' | 'HEAVY') => {
    const l = limit(size);
    return { l: l.maxCm[0], w: l.maxCm[1], h: l.maxCm[2], kg: l.maxKg };
  };

  describe('the measurement', () => {
    it('is denominated in MEDIUMS, and the M band ceiling is exactly one of them', () => {
      // The whole system counts parcels in medium-equivalents — a tote's fill, a driver's haul basis, the
      // transport factor. A second scale with its own zero would be a second currency, so this one is
      // calibrated at the point the band table already names: the biggest thing that is still a medium.
      expect(measuredFactor(ceilingOf('M'))).toBe(1);
      expect(measuredFactor(ceilingOf('M'))).toBe(SIZE_TRANSPORT_FACTOR.M);
      expect(SIZE_TRANSPORT_FACTOR.M).toBe(SIZE_UNITS.M);
    });

    it('uses the divisor the band table already declared, not one borrowed from a carrier', () => {
      // Carriers use 4000–6000 cm³/kg, and adopting one would be importing somebody else's commercial
      // policy as though it were a physical constant. This one is MEDIUM_CM3 / MEDIUM_KG: the density our
      // own M band asserts by saying a medium is at most 45×35×25 cm and at most 5 kg. Both axes are
      // therefore calibrated at the same point, which is what makes the max() between them a comparison
      // rather than a coincidence — and re-tuning the bands re-tunes this with them.
      expect(MEDIUM_CM3).toBe(45 * 35 * 25);
      expect(MEDIUM_KG).toBe(5);
      expect(DIM_DIVISOR).toBe(Math.round(MEDIUM_CM3 / MEDIUM_KG));
      expect(DIM_DIVISOR).toBe(7875);
    });

    it('charges whichever of bulk and weight actually binds', () => {
      // A duvet and a box of bolts are the same problem seen from two sides: one buys space it would not
      // pay for by weight, the other buys weight it would not pay for by space.
      const bulky = { l: 60, w: 50, h: 40, kg: 2 }; // 120000 cm³, feather-light
      const dense = { l: 20, w: 15, h: 10, kg: 5 }; // 3000 cm³, a brick
      expect(measuredFactor(bulky)).toBeCloseTo(120000 / MEDIUM_CM3, 2); // volume wins
      expect(measuredFactor(dense)).toBeCloseTo(5 / MEDIUM_KG, 2); // weight wins
    });

    it('never charges a parcel for more than the one bag it can fill', () => {
      // Transport is bought BY THE BAG, so a parcel's share of a bag is its share of that bag's cost and
      // nothing can consume more than all of it. At the heavy ceiling the raw volumetric figure is about
      // 19.5 mediums — true, and not chargeable. The cap is the heavy factor itself, so a heavy prices
      // exactly as it always has and this change cannot reach the one size already sitting at the bag.
      const heavy = ceilingOf('HEAVY');
      expect((heavy.l * heavy.w * heavy.h) / MEDIUM_CM3).toBeGreaterThan(BAG_CAPACITY_UNITS);
      expect(measuredFactor(heavy)).toBe(BAG_CAPACITY_UNITS);
      expect(measuredFactor(heavy)).toBe(SIZE_TRANSPORT_FACTOR.HEAVY);
    });

    it('refuses a measurement it cannot use — an empty field is not a free parcel', () => {
      // This function sits directly upstream of a price, so a broken form field must not become a cheap
      // shipment. Undefined, and every caller falls back to the band.
      for (const bad of [
        { l: 0, w: 20, h: 10, kg: 1 },
        { l: 30, w: -20, h: 10, kg: 1 },
        { l: 30, w: 20, h: 10, kg: 0 },
        { l: 30, w: 20, h: Number.NaN, kg: 1 },
        { l: 30, w: 20, h: Number.POSITIVE_INFINITY, kg: 1 },
      ]) {
        expect(measuredFactor(bad)).toBeUndefined();
      }
    });

    it('never gets CHEAPER as the box grows — the property that makes shading a number pointless', () => {
      // A step function pays a merchant to type 44 instead of 46. A monotone one pays nothing: every
      // centimetre taken off buys back exactly the transport that centimetre cost, and no more.
      let byLength = 0;
      for (let cm = 5; cm <= 80; cm += 1) {
        const f = measuredFactor({ l: cm, w: 30, h: 20, kg: 2 })!;
        expect(f).toBeGreaterThanOrEqual(byLength);
        byLength = f;
      }
      let byWeight = 0;
      for (let kg = 0.1; kg <= 30; kg += 0.1) {
        const f = measuredFactor({ l: 30, w: 20, h: 10, kg })!;
        expect(f).toBeGreaterThanOrEqual(byWeight);
        byWeight = f;
      }
    });
  });

  describe('the cliff at a band edge', () => {
    it('used to double the transport for one extra centimetre, and no longer does', () => {
      const atCeiling = ceilingOf('M');
      const oneCmOver = { ...atCeiling, l: atCeiling.l + 1 };
      // The tier still steps — that is what a tier is for, and the parcel really did become a large.
      expect(classifySize(atCeiling)).toBe('M');
      expect(classifySize(oneCmOver)).toBe('L');
      // What used to happen: the price stepped with it, from one medium to two.
      expect(SIZE_TRANSPORT_FACTOR[classifySize(oneCmOver)] / SIZE_TRANSPORT_FACTOR[classifySize(atCeiling)]).toBe(2);
      // What happens now: the price follows the centimetre, not the tier the centimetre pushed it into.
      const before = measuredFactor(atCeiling)!;
      const after = measuredFactor(oneCmOver)!;
      expect(after).toBeGreaterThan(before);
      expect(after / before).toBeLessThan(1.05);
    });
  });

  describe('a quote says which of the two it used', () => {
    it('prices a MEASURED parcel on its measurement and says so', () => {
      const { from, to } = route();
      const box = { l: 30, w: 20, h: 10, kg: 1.6 };
      const measured = routing.quoteShipment(from.did, to.did, classifySize(box), measuredFactor(box));
      expect(measured.factorBasis).toBe('measured');
      expect(measured.transportFactor).toBe(measuredFactor(box));
    });

    it('prices a DECLARED parcel on its band, at exactly the figure it was quoted before this existed', () => {
      // A counter parcel entered as a picked tier has no measurement to price on, and the band is the
      // honest answer for it. This is also the regression guard: every caller that passes no measurement
      // gets the number it has always got.
      const { from, to } = route();
      const declared = routing.quoteShipment(from.did, to.did, 'M');
      expect(declared.factorBasis).toBe('band');
      expect(declared.transportFactor).toBe(SIZE_TRANSPORT_FACTOR.M);
      const asL = routing.quoteShipment(from.did, to.did, 'L');
      expect(asL.transportFactor).toBe(SIZE_TRANSPORT_FACTOR.L);
      // …and the transport really is that factor times the road, unchanged.
      expect(asL.locked.transport).toBeCloseTo(declared.locked.transport * (SIZE_TRANSPORT_FACTOR.L / SIZE_TRANSPORT_FACTOR.M), 2);
    });

    it('survives the trip to a public buyer — the basis is published, the rate layers are not', () => {
      const { from, to } = route();
      const box = { l: 30, w: 20, h: 10, kg: 1.6 };
      const pub = publicQuote(routing.quoteShipment(from.did, to.did, classifySize(box), measuredFactor(box))) as unknown as Record<string, unknown>;
      expect(pub.factorBasis).toBe('measured');
      // The label and the number together, deliberately: a basis that SAYS measured beside a factor that
      // is still the band is worse than no label at all, and only asserting both can catch it.
      expect(pub.transportFactor).toBe(measuredFactor(box));
      expect(pub.rates).toBeUndefined();
    });
  });

  describe('the price on the map is the price at the till', () => {
    it('quotes a measured parcel identically whether the caller asks the map or mints it', () => {
      // The failure this exists to stop: a map pricing bands beside a mint pricing measurements. Both
      // numbers would be honest and the buyer would still watch the price move between choosing a shop
      // and paying for it, which reads as a bait.
      const { from, to, store } = route();
      const box = { l: 30, w: 20, h: 10, kg: 1.6 };
      const onTheMap = controller.quote(from.did, to.did, undefined, '30', '20', '10', '1.6') as unknown as { transportFactor: number };
      const minted = controller.createInbound({
        vendorId: store.vendorId, originPudoDid: from.did, destPudoDid: to.did, buyerMobile: '+254700900001',
        dimensionsCm: { l: box.l, w: box.w, h: box.h }, weightKg: box.kg, routeMode: 'locked', contentPhotoRef: 'c.jpg',
      } as never, { role: 'genesis', did: store.did } as never) as unknown as { parcel: { parcelId: string } };
      const parcel = parcels.get(minted.parcel.parcelId);
      expect(parcel.transportFactor).toBe(measuredFactor(box));
      expect(onTheMap.transportFactor).toBe(parcel.transportFactor);
      // …and the many-pins endpoint the vendor's drop-off map actually calls, which quotes the same way.
      const options = controller.quoteOptions('', to.did, from.did, '', undefined, '30', '20', '10', '1.6') as unknown as { options: { quote?: { transportFactor: number } }[] };
      expect(options.options[0].quote!.transportFactor).toBe(parcel.transportFactor);
    });

    it('believes the tape measure over a contradicting declared size', () => {
      // Dims and a `size` that disagree is not a puzzle: the measurement is evidence and the tier is a
      // claim, and every mint in the system already resolves it this way.
      const { from, to } = route();
      const asked = controller.quote(from.did, to.did, 'HEAVY', '30', '20', '10', '1.6') as unknown as Record<string, unknown>;
      expect(asked.size).toBe('S');
      expect(asked.factorBasis).toBe('measured');
      expect(asked.transportFactor).toBe(measuredFactor({ l: 30, w: 20, h: 10, kg: 1.6 }));
      expect(asked.transportFactor).not.toBe(SIZE_TRANSPORT_FACTOR.HEAVY);
    });

    it('lets a consumer send through on the price the wizard showed', () => {
      // The sharpest version of the same failure, and the reason it is worth a test of its own: the
      // consumer mint FAILS CLOSED on price drift, refusing any total it did not itself just quote. A
      // wizard quoting size bands beside a mint pricing centimetres would not merely mislead somebody —
      // it would bounce every send in the app with PRICE_CHANGED, quoting a price it had shown a moment
      // earlier. The two must be computed the same way or the feature does not work at all.
      const { from, to } = route();
      const box = { l: 30, w: 20, h: 10, kg: 1.6 };
      const shown = controller.quote(from.did, to.did, undefined, '30', '20', '10', '1.6') as unknown as { locked: { gross: number } };
      const sender = persons.enroll('+254700900004', true).person;
      expect(() =>
        identity.createParcel({
          receiverMobile: '+254700900005', originPudoDid: from.did, destPudoDid: to.did,
          dimensionsCm: { l: box.l, w: box.w, h: box.h }, weightKg: box.kg, expectedTotal: shown.locked.gross,
        } as never, { role: 'consumer', did: sender.personDid } as never),
      ).not.toThrow();
      // …and the guard is genuinely armed: the band price it USED to show is now refused.
      const bandPriced = controller.quote(from.did, to.did, 'S') as unknown as { locked: { gross: number } };
      expect(bandPriced.locked.gross).not.toBe(shown.locked.gross);
      expect(() =>
        identity.createParcel({
          receiverMobile: '+254700900006', originPudoDid: from.did, destPudoDid: to.did,
          dimensionsCm: { l: box.l, w: box.w, h: box.h }, weightKg: box.kg, expectedTotal: bandPriced.locked.gross,
        } as never, { role: 'consumer', did: sender.personDid } as never),
      ).toThrow(/price is now/i);
    });

    it('falls back to the declared size when the measurement is only half given', () => {
      // Three sides without a weight cannot say whether a box is books or bubble wrap. All four or none —
      // half a measurement priced as though it were whole is worse than the band it replaced.
      const { from, to } = route();
      const half = controller.quote(from.did, to.did, 'L', '30', '20', '10', undefined) as unknown as Record<string, unknown>;
      expect(half.factorBasis).toBe('band');
      expect(half.transportFactor).toBe(SIZE_TRANSPORT_FACTOR.L);
    });
  });

  describe('what a measured parcel carries afterwards', () => {
    it('stamps the factor it was SOLD at, so retuning the measure cannot reprice it', () => {
      // The durability rule the rate stack and the tax rate already follow. It matters more here than it
      // looks: the flexible rebate RE-COMPUTES a parcel's real cost at delivery, so an unstamped factor
      // would settle a shipment against a measure that changed while it was in the air.
      const { from, to, store } = route();
      const box = { l: 52, w: 38, h: 28, kg: 6 };
      const minted = controller.createInbound({
        vendorId: store.vendorId, originPudoDid: from.did, destPudoDid: to.did, buyerMobile: '+254700900002',
        dimensionsCm: { l: box.l, w: box.w, h: box.h }, weightKg: box.kg, routeMode: 'flexible', contentPhotoRef: 'c.jpg',
      } as never, { role: 'genesis', did: store.did } as never) as unknown as { parcel: { parcelId: string } };
      const stored = parcels.get(minted.parcel.parcelId);
      expect(stored.size).toBe('L'); // the tier is still derived, and this is still a large
      expect(stored.transportFactor).toBe(measuredFactor(box));
      expect(ParcelService.transportFactorOf(stored)).toBe(measuredFactor(box));
      // …and it sits BELOW the band it was classified into, which is the whole point: this is a small
      // large, and it no longer pays for the biggest box the tier admits.
      expect(stored.transportFactor!).toBeLessThan(SIZE_TRANSPORT_FACTOR.L);
    });

    it('leaves a parcel with no measurement reading its band, exactly as before', () => {
      const { from, to, store } = route();
      const minted = controller.createInbound({
        vendorId: store.vendorId, originPudoDid: from.did, destPudoDid: to.did, buyerMobile: '+254700900003',
        size: 'M', routeMode: 'locked', contentPhotoRef: 'c.jpg',
      } as never, { role: 'genesis', did: store.did } as never) as unknown as { parcel: { parcelId: string } };
      const stored = parcels.get(minted.parcel.parcelId);
      expect(ParcelService.transportFactorOf(stored)).toBe(SIZE_TRANSPORT_FACTOR.M);
    });
  });


  describe('what deliberately did NOT change', () => {
    it('keeps BAG OCCUPANCY on the bands — a bag is packed by a person, not by a formula', () => {
      // SIZE_UNITS answers a different question from the transport factor, and it only looked like the
      // same one because a medium is 1 in both. Occupancy is a HANDLING policy: nothing shares with a
      // heavy, and a bag holds fifty letters because of what sorting fifty letters costs, not because of
      // what fifty letters displace. Those three field rules cannot all be true of any volume measure —
      // fifty letters, ten mediums and one heavy differ by an order of magnitude in cubic centimetres —
      // so they are policy, and policy stays in the bands, where an agent can apply it by eye.
      expect(SIZE_UNITS.HEAVY).toBe(BAG_CAPACITY_UNITS);
      expect(SIZE_UNITS.S * 50 + SIZE_UNITS.M).toBe(BAG_CAPACITY_UNITS);
      expect(SIZE_UNITS.M * 10).toBe(BAG_CAPACITY_UNITS);
    });
  });

});
