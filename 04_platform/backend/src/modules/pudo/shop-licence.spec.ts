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
import { GazetteerGeocoder, GEOCODER } from './geocoder';
import { HeuristicRouter, ROUTER } from './router';
import { PapersWatchService, shopLicenceNotice } from './papers-watch.service';
import { LICENCE_GRACE_DAYS, licenceStopped, requireLicenceDate, shopLicenceStanding } from './shop-licence';
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
import { GlosEvent } from '../../foundation/events/glos-events';
import { contentPhotos, evidencePhotos } from '../../../test/content-photo';
import type { FleetManagerService as Managers } from './fleet-manager.service';
import type { VehicleService as Vehicles } from './vehicle.service';
import type { DriverService as Drivers } from './driver.service';
import type { FleetService as Fleet } from './fleet.service';
import type { NotificationService } from './notification.service';
import type { Agent } from './pudo.types';

/**
 * Round 40 — A SHOP'S TRADING LICENCE THAT LAPSES (the user: "Expiry, notice, grace"). Staff note the date at approval; the
 * shop is told thirty days before; fourteen days' grace after it lapses; then no new parcel starts at the shop, or names it,
 * until the renewed licence is recorded — while what is booked, on the shelf, or on its way goes on.
 */
const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso);

describe('a shop’s trading licence', () => {
  describe('where it stands, from the date alone', () => {
    const now = at('2026-10-22T09:00:00Z');
    const runsTo = (expiresAt?: string, sent = false) => shopLicenceStanding({ ...(expiresAt ? { licence: { expiresAt } } : {}), ...(sent ? { licenceRenewal: { sentAt: '2026-10-20T00:00:00Z' } } : {}) }, now);

    it('is undated until staff note a date — and an undated licence stops nothing', () => {
      expect(runsTo()).toEqual({ state: 'none', renewalSent: false });
      expect(licenceStopped({}, now)).toBe(false);
    });

    it('is in date more than thirty days out, and running out within them', () => {
      expect(runsTo('2026-11-22')).toMatchObject({ state: 'ok', daysLeft: 32 });
      expect(runsTo('2026-11-20')).toMatchObject({ state: 'due', daysLeft: 30, stopsOn: '2026-12-05' });
    });

    it('is valid all of its last day, and lapses the day after', () => {
      expect(runsTo('2026-10-22')).toMatchObject({ state: 'due', daysLeft: 1 });
      expect(runsTo('2026-10-21')).toMatchObject({ state: 'grace', daysLeft: 0 });
    });

    it('gives fourteen days of grace after it lapses, then stops new parcels', () => {
      // Lapsed at the start of 22 Oct: the grace runs to the start of 5 Nov.
      expect(runsTo('2026-10-21')).toMatchObject({ state: 'grace', graceDaysLeft: 14, stopsOn: '2026-11-05' });
      expect(shopLicenceStanding({ licence: { expiresAt: '2026-10-21' } }, at('2026-11-04T23:59:00Z'))).toMatchObject({ state: 'grace', graceDaysLeft: 1 });
      expect(shopLicenceStanding({ licence: { expiresAt: '2026-10-21' } }, at('2026-11-05T00:00:00Z'))).toMatchObject({ state: 'stopped' });
      expect(LICENCE_GRACE_DAYS).toBe(14);
    });

    it('says when a renewed licence is waiting on staff — and still stops on the date: the date is what counts', () => {
      expect(runsTo('2026-09-01', true)).toMatchObject({ state: 'stopped', renewalSent: true });
    });
  });

  describe('the date somebody types', () => {
    const now = at('2026-10-22T09:00:00Z');
    const refused = (day: string | undefined) => {
      try {
        requireLicenceDate(day, now);
      } catch (e) {
        const r = (e as { getResponse(): { code: string; detail: string; params?: { field?: string } } }).getResponse();
        return [r.code, r.params?.field];
      }
      return null;
    };

    it('is asked for, by name', () => {
      expect(refused(undefined)).toEqual(['FIELD_REQUIRED', 'licenceExpiresAt']);
      expect(refused('  ')).toEqual(['FIELD_REQUIRED', 'licenceExpiresAt']);
    });

    it('is a day of the calendar', () => {
      expect(refused('31/12/2027')).toEqual(['VALIDATION_FAILED', 'licenceExpiresAt']);
      expect(refused('2027-02-30')).toEqual(['VALIDATION_FAILED', 'licenceExpiresAt']);
    });

    it('is still ahead: a licence already run out is a typo', () => {
      expect(refused('2026-10-21')).toEqual(['VALIDATION_FAILED', 'licenceExpiresAt']);
      expect(refused('2026-10-22')).toBeNull(); // valid all of today
      expect(requireLicenceDate(' 2027-12-31 ', now)).toBe('2027-12-31');
    });
  });

  describe('at the shop', () => {
    let agents: AgentService;
    let parcels: ParcelService;
    let gate: WalletGateService;
    let routing: RoutingService;
    let vendors: VendorService;
    let corridors: CorridorService;
    let media: MediaService;
    let events: EventBus;
    let photoBy: (ownerDid: string) => string;
    let photoOf: (vendorId: string) => string;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
          GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, BagClosureService,
          BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
          DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
          MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
          ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
          WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
          EntityService, PresenceService, BooksService, FxService,
          { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
          GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
          HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
        ],
      }).compile();
      photoBy = evidencePhotos(moduleRef);
      photoOf = contentPhotos(moduleRef);
      moduleRef.get(EntityService).seed();
      moduleRef.get(FxService).seed();
      moduleRef.get(BooksService).reset();
      agents = moduleRef.get(AgentService);
      parcels = moduleRef.get(ParcelService);
      gate = moduleRef.get(WalletGateService);
      routing = moduleRef.get(RoutingService);
      vendors = moduleRef.get(VendorService);
      corridors = moduleRef.get(CorridorService);
      media = moduleRef.get(MediaService);
      events = moduleRef.get(EventBus);
    });

    let seq = 0;
    const hours = { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null };

    /** A shop that has sent its papers and waits for staff. */
    function applying(zone = 'Nairobi') {
      seq += 1;
      const a = agents.register({
        shopName: `Licence Shop ${seq}`, zone, location: { lat: -1.2 + seq / 100, lng: 36.8 }, landmark: 'by the road', openingHours: hours,
        shelf: { rows: 3, cols: 3 }, fullName: 'Shopkeeper', nationalId: `ID-L${seq}`, mobile: `+2547420${seq}`,
        deviceImei: `IMEI-L${seq}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-${seq}`, criminalRecordClear: true },
      });
      agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'tl.jpg', shopPhotoRefs: ['shop.jpg'] });
      return a.did;
    }

    /** An approved, funded shop, open for parcels. */
    function open(zone = 'Nairobi'): string {
      const did = applying(zone);
      agents.decideKyc(did, true, 'Amina', undefined, '2099-12-31');
      gate.topUp(did, 50);
      return did;
    }

    /** Time has passed: its licence ran to `day`. Written straight onto the record, as a date in the past cannot be typed. */
    function ranTo(did: string, day: string): Agent {
      const a = agents.get(did);
      a.licence = { ...a.licence!, expiresAt: day };
      return a;
    }
    const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

    const walkUp = (agentDid: string, parcelId: string) =>
      parcels.accept({ parcelId, agentDid, destZone: 'Kisumu', size: 'M', senderMobile: '+254700111', receiverMobile: '+254700222', dropoffPhotoRef: photoBy(agentDid) } as never);

    const codeOf = (fn: () => unknown): string | undefined => {
      try {
        fn();
      } catch (e) {
        return (e as { getResponse(): { code: string } }).getResponse().code;
      }
      return undefined;
    };

    describe('approval', () => {
      it('is refused without the date the licence runs to — and nothing about the shop is written', () => {
        const did = applying();
        expect(codeOf(() => agents.decideKyc(did, true, 'Amina'))).toBe('FIELD_REQUIRED');
        const after = agents.get(did);
        expect(after.status).toBe('KYC_PENDING');
        expect(after.licence).toBeUndefined();
      });

      it('notes the date, the licence it was read from, and who read it', () => {
        const did = applying();
        const a = agents.decideKyc(did, true, 'Amina', undefined, '2027-12-31');
        expect(a.status).toBe('APPROVED_UNFUNDED');
        expect(a.licence).toMatchObject({ expiresAt: '2027-12-31', copyRef: 'tl.jpg', recordedBy: 'Amina' });
      });

      it('asks nothing of a refusal', () => {
        const did = applying();
        expect(agents.decideKyc(did, false, 'Amina', 'The licence is not readable').status).toBe('DRAFT');
      });
    });

    describe('once the grace is over', () => {
      it('starts no walk-up at the counter, and says why and what ends it', () => {
        const did = open();
        ranTo(did, daysAgo(LICENCE_GRACE_DAYS + 1));
        expect(codeOf(() => walkUp(did, 'PUD-LIC-1'))).toBe('LICENCE_LAPSED');
        try {
          walkUp(did, 'PUD-LIC-1');
        } catch (e) {
          expect((e as Error).message).toMatch(/renewed licence/);
        }
      });

      it('is not offered for a new parcel, at either end, and a parcel being made cannot name it', () => {
        const did = open();
        expect(agents.takesNew(agents.get(did))).toBe(true);
        ranTo(did, daysAgo(LICENCE_GRACE_DAYS + 1));
        expect(agents.takesNew(agents.get(did))).toBe(false);
        expect(codeOf(() => agents.assertNamedAtMint(did))).toBe('FORBIDDEN');
      });

      it('tells the counter at the gate before anybody tries — and keeps the money side apart, for what was booked before', () => {
        const did = open();
        ranTo(did, daysAgo(LICENCE_GRACE_DAYS + 1));
        expect(gate.canTransact(did)).toMatchObject({ ok: false, code: 'LICENCE_LAPSED', moneyOk: true });
      });

      it('still takes in a parcel booked to be handed in there before, and hands out what is on the shelf', () => {
        const from = open('Nairobi');
        const to = open('Kisumu');
        corridors.addCorridor({ name: 'Nairobi-Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
        const store = vendors.register({ name: `Store ${(seq += 1)}`, country: 'KE' });
        vendors.topUp(store.vendorId, 500);
        const { parcel } = parcels.createInbound({
          vendorId: store.vendorId, originAgentDid: from, destAgentDid: to, buyerMobile: '+254700999',
          contentPhotoRef: photoOf(store.vendorId), size: 'M', routeMode: 'locked', shippingPolicy: store.shippingPolicy,
          quote: routing.quoteShipment(from, to, 'M'),
        } as never);
        ranTo(from, daysAgo(LICENCE_GRACE_DAYS + 1));
        expect(parcels.intakeInbound(parcel.parcelId, from).status).toBe('At_PUDO');
      });

      it('changes nothing during the grace: the shop goes on as before', () => {
        const did = open();
        ranTo(did, daysAgo(3));
        expect(agents.licenceStandingOf(did).state).toBe('grace');
        expect(agents.takesNew(agents.get(did))).toBe(true);
        expect(walkUp(did, 'PUD-LIC-2').status).toBe('At_PUDO');
      });
    });

    describe('the renewal', () => {
      it('is sent by the shop: its own photograph, and the date it reads', () => {
        const did = open();
        const photo = photoBy(did);
        const a = agents.sendLicenceRenewal(did, { copyRef: photo, expiresAt: '2028-06-30' });
        expect(a.licenceRenewal).toMatchObject({ copyRef: photo, expiresAt: '2028-06-30' });
        expect(agents.licenceStandingOf(did).renewalSent).toBe(true);
        // What it sent switches nothing on: the date on record is still the one staff read.
        expect(agents.get(did).licence?.expiresAt).toBe('2099-12-31');
      });

      it('is refused as somebody else’s photograph, or the licence already on record', () => {
        const did = open();
        const other = open();
        expect(codeOf(() => agents.sendLicenceRenewal(did, { copyRef: photoBy(other), expiresAt: '2028-06-30' }))).toBe('PHOTO_REQUIRED');
        expect(codeOf(() => agents.sendLicenceRenewal(did, { copyRef: 'tl.jpg', expiresAt: '2028-06-30' }))).toBe('PHOTO_REQUIRED');
        expect(agents.get(did).licenceRenewal).toBeUndefined();
        // A photograph we hold, the shop's own — and already the licence on record: refused as not a renewed one.
        const first = photoBy(did);
        agents.sendLicenceRenewal(did, { copyRef: first, expiresAt: '2028-06-30' });
        agents.recordLicence(did, '2028-06-30', 'Brian');
        expect(() => agents.sendLicenceRenewal(did, { copyRef: first, expiresAt: '2029-06-30' })).toThrow(/already on record/);
        expect(agents.get(did).licenceRenewal).toBeUndefined();
        expect(media.get(first)).toBeDefined();
      });

      it('is not sent by a shop still joining: its licence goes with its other papers', () => {
        const did = applying();
        expect(codeOf(() => agents.sendLicenceRenewal(did, { copyRef: photoBy(did), expiresAt: '2028-06-30' }))).toBe('INVALID_STATE');
      });

      it('is recorded by staff from the photograph sent — and a stopped shop starts new parcels again at once', () => {
        const did = open();
        ranTo(did, daysAgo(LICENCE_GRACE_DAYS + 1));
        const photo = photoBy(did);
        agents.sendLicenceRenewal(did, { copyRef: photo, expiresAt: '2028-06-30' });
        const told: unknown[] = [];
        events.subscribe(GlosEvent.Pudo.ShopLicenceChecked, (e) => void told.push(e.payload));
        const a = agents.recordLicence(did, '2028-06-30', 'Brian');
        expect(a.licence).toMatchObject({ expiresAt: '2028-06-30', copyRef: photo, recordedBy: 'Brian' });
        expect(a.licenceRenewal).toBeUndefined();
        expect(agents.takesNew(agents.get(did))).toBe(true);
        expect(walkUp(did, 'PUD-LIC-3').status).toBe('At_PUDO');
        expect(told).toEqual([{ did, accepted: true, expiresAt: '2028-06-30' }]);
      });

      it('can date a shop approved before a date was asked, from the licence on record', () => {
        const did = open();
        delete agents.get(did).licence;
        expect(agents.recordLicence(did, '2027-03-31', 'Brian').licence).toMatchObject({ expiresAt: '2027-03-31', copyRef: 'tl.jpg' });
      });

      it('is sent back with the reason the shop is shown, and the photograph is not kept', () => {
        const did = open();
        const photo = photoBy(did);
        agents.sendLicenceRenewal(did, { copyRef: photo, expiresAt: '2028-06-30' });
        expect(codeOf(() => agents.refuseLicenceRenewal(did, '  ', 'Brian'))).toBe('REASON_REQUIRED');
        const a = agents.refuseLicenceRenewal(did, 'The date on it is 2027, not 2028', 'Brian');
        expect(a.licenceRenewal).toBeUndefined();
        expect(a.licenceRenewalRefusal).toMatchObject({ reason: 'The date on it is 2027, not 2028', by: 'Brian' });
        expect(media.get(photo)).toBeUndefined();
        expect(codeOf(() => agents.refuseLicenceRenewal(did, 'again', 'Brian'))).toBe('INVALID_STATE');
      });

      it('is not recorded to a date already past', () => {
        const did = open();
        expect(codeOf(() => agents.recordLicence(did, '2020-01-01', 'Brian'))).toBe('VALIDATION_FAILED');
        expect(agents.get(did).licence?.expiresAt).toBe('2099-12-31');
      });
    });
  });

  describe('the notices', () => {
    const now = at('2026-10-22T09:00:00Z');
    const day = (d: number) => new Date(now + d * DAY).toISOString().slice(0, 10);

    function watch(shops: Array<Partial<Agent> & { did: string }>) {
      process.env.GLOS_PERSIST = 'off';
      const inbox: Array<{ did: string; kind: string; title: string; body: string }> = [];
      const notifications = { notify: async (did: string, n: { kind: string; title: string; body: string }) => void inbox.push({ did, kind: n.kind, title: n.title, body: n.body }) } as unknown as NotificationService;
      const none = { list: () => [] };
      const agentsFake = { list: () => shops.map((s) => ({ shopName: s.did, zone: 'Nairobi', status: 'ACTIVE', ...s })), countryOf: () => 'KE' } as unknown as AgentService;
      const svc = new PapersWatchService(none as unknown as Managers, none as unknown as Vehicles, none as unknown as Drivers, { activeForDriver: () => undefined } as unknown as Fleet, notifications, undefined, undefined, agentsFake);
      return { svc, inbox };
    }

    it('tells a shop thirty days out, once, with the day new parcels would stop', async () => {
      const { svc, inbox } = watch([{ did: 'did:shop:a', licence: { expiresAt: day(20), recordedAt: '' } }, { did: 'did:shop:far', licence: { expiresAt: day(60), recordedAt: '' } }]);
      await svc.sweep(now);
      await svc.sweep(now + DAY);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({ did: 'did:shop:a', kind: 'papers_due', title: 'Your trading licence runs out in 21 days' }); // valid through day 20, so 20.6 days, said as 21
      expect(inbox[0].body).toMatch(/14 days after it lapses no new parcel/);
    });

    it('tells it again the day it lapses, and again when new parcels stop', async () => {
      const shop = { did: 'did:shop:b', licence: { expiresAt: day(-1), recordedAt: '' } };
      const { svc, inbox } = watch([shop]);
      await svc.sweep(now);
      expect(inbox.map((n) => n.title)).toEqual(['Your trading licence has lapsed']);
      expect(inbox[0].body).toMatch(/In 14 days, from 5 Nov 2026/);
      await svc.sweep(now + 14 * DAY);
      expect(inbox.map((n) => n.title)).toEqual(['Your trading licence has lapsed', 'New parcels have stopped at your shop']);
    });

    it('does not ask a shop that sent its renewed licence to send it — but still says the day it stops', async () => {
      const sent = { licenceRenewal: { copyRef: 'm1', expiresAt: day(400), sentAt: '' } };
      const { svc, inbox } = watch([
        { did: 'did:shop:c', licence: { expiresAt: day(10), recordedAt: '' }, ...sent },
        { did: 'did:shop:d', licence: { expiresAt: day(-20), recordedAt: '' }, ...sent },
      ]);
      await svc.sweep(now);
      expect(inbox.map((n) => n.did)).toEqual(['did:shop:d']);
      expect(inbox[0].body).toMatch(/The licence you sent has not been read yet/);
    });

    it('says nothing of a shop still joining, or one with no date', async () => {
      const { svc, inbox } = watch([{ did: 'did:shop:e', status: 'KYC_PENDING', licence: { expiresAt: day(5), recordedAt: '' } }, { did: 'did:shop:f' }]);
      await svc.sweep(now);
      expect(inbox).toEqual([]);
    });

    it('lists every shop for staff: a renewal waiting first, then stopped, in grace, running out, undated, in date', () => {
      const { svc } = watch([
        { did: 'ok', licence: { expiresAt: day(200), recordedAt: '' } },
        { did: 'none' },
        { did: 'due', licence: { expiresAt: day(10), recordedAt: '' } },
        { did: 'stopped', licence: { expiresAt: day(-30), recordedAt: '' } },
        { did: 'grace', licence: { expiresAt: day(-2), recordedAt: '' } },
        { did: 'sent', licence: { expiresAt: day(200), recordedAt: '' }, licenceRenewal: { copyRef: 'm', expiresAt: day(600), sentAt: '' } },
        { did: 'joining', status: 'DRAFT' },
      ]);
      expect(svc.shopRows(now).map((r) => r.did)).toEqual(['sent', 'stopped', 'grace', 'due', 'none', 'ok']);
    });

    it('words a running-out licence for the lock screen', () => {
      expect(shopLicenceNotice({ state: 'due', expiresAt: '2026-11-11', daysLeft: 1, stopsOn: '2026-11-26', renewalSent: false }).title).toBe('Your trading licence runs out in 1 day');
    });
  });
});
