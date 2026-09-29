import { EventBus } from '../../foundation/events/event-bus.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { NotificationService } from './notification.service';
import { OutboxPushSender } from './push-sender';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { DepartureService } from './departure.service';
import { CorridorService } from './corridor.service';
import { CargoService } from './cargo.service';
import { FleetManagerService } from './fleet-manager.service';
import { MediaService } from './media.service';
import { requiredUnloadKeys } from './heavy-cargo';
import type { AgentService } from './agent.service';
import type { DispatchService } from './dispatch.service';
import type { DriverService } from './driver.service';
import type { FleetService } from './fleet.service';
import type { Geocoder } from './geocoder';
import type { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import type { LedgerService } from '../../foundation/ledger/ledger.service';
import type { MdpService } from './mdp.service';
import type { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import type { ParcelService } from './parcel.service';
import type { PersonService } from './person.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { ToteService } from './tote.service';
import type { UnclaimedService } from './unclaimed.service';
import type { VehicleService } from './vehicle.service';
import type { VendorService } from './vendor.service';

/**
 * WHAT IS SENT TO A FLEET IS SEEN — and what a fleet does reaches the shipper.
 *
 * Four of a run's seven events told nobody. A booking was published under a comment promising "the fleet
 * office learns its space went" and nothing listened. A claim was opened and the carrier who must answer it
 * was not told; the carrier answered and the shipper was not told; a booking given back reached neither side.
 *
 * These are wired END TO END: the real DepartureService and FleetManagerService publish onto one bus that
 * the real dispatcher listens to, and the assertions read the real inbox. A dispatcher test that publishes
 * a hand-written payload proves the dispatcher agrees with the test — not with the service that publishes.
 */
describe('a fleet hears about its own runs, and a shipper hears the carrier', () => {
  const MANAGER = 'did:glos:fleet-told';
  const SHIPPER = 'did:glos:shipper-told';

  /** Handlers run on the bus after the call returns — publish is fire-and-forget at the call site. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  const setUp = () => {
    const events = new EventBus();
    const notifications = new NotificationService(new OutboxPushSender());
    const none = {} as never;
    const dispatcher = new NotificationDispatcher(
      events,
      notifications,
      { get: () => { throw new Error('no parcels here'); }, list: () => [] } as unknown as ParcelService,
      { findByHash: () => undefined } as unknown as PersonService,
      { get: () => { throw new Error('no agents here'); }, find: () => undefined, unfinished: () => [] } as unknown as AgentService,
      { list: () => [], overHours: () => false } as unknown as FleetService,
      none as ToteService,
      none as MdpService,
      { freightCarryableByDriver: () => true, worksNear: () => true, pickupPlace: () => null, offerNear: () => null, activeOffersFor: () => [] } as unknown as DispatchService,
      { sweep: () => [] } as unknown as UnclaimedService,
      { notify: () => null } as unknown as VendorService,
    );
    dispatcher.onModuleInit();

    const corridors = new CorridorService();
    const managers = { get: () => ({ jurisdiction: 'KE' }), tradingBlocks: () => [], assertMayTakeWork: () => undefined } as unknown as FleetManagerService;
    const truck = { get: () => ({ vehicleId: 'veh_1', plate: 'KDA 001A', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE' }), isUsable: () => true, offRoadReasons: () => [] } as unknown as VehicleService;
    const drivers = { canOperate: () => true, offRoadReasons: () => [] } as unknown as DriverService;
    const media = { adopt: () => true, anchorFreightTerminal: () => undefined, holdFreightForDispute: () => undefined } as unknown as MediaService;
    const departures = new DepartureService(corridors, managers, drivers, truck, new CargoService(), media, { can: () => true } as unknown as PresenceService, events);

    const proposed = corridors.proposeLine({ managerDid: MANAGER, company: 'Kilima Logistics', name: 'Nairobi – Mombasa', originZone: 'Nairobi', destZone: 'Mombasa', vehicleType: 'truck' });
    const corridor = corridors.publish(proposed.corridorId, 'did:glos:network-staff');
    const run = departures.declare({ managerDid: MANAGER, corridorId: corridor.corridorId, vehicleId: 'veh_1', leavesAt: new Date(Date.now() + 86_400_000).toISOString(), capacityKg: 6000, capacityM3: 40, basis: 'per_trip', amount: 450 });

    return { events, notifications, departures, run };
  };

  const inbox = (n: NotificationService, did: string) => n.inboxFor(did);

  it('tells the fleet office its space was sold — what, how much, and for what', async () => {
    const { notifications, departures, run } = setUp();
    departures.book(run.departureId, { shipperDid: SHIPPER, description: 'Maize, 20 bags', weightKg: 1000 });
    await settle();

    const told = inbox(notifications, MANAGER);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: 'space_sold', title: 'Space sold on Nairobi – Mombasa' });
    // In the currency the run was priced in — a Kenyan fleet sells in shillings.
    expect(told[0].body).toBe('1000 kg — Maize, 20 bags, for 450 KES. It is on the run under Runs.');
    // The shipper did it; the shipper is not told about their own booking.
    expect(inbox(notifications, SHIPPER)).toHaveLength(0);
  });

  it('tells the fleet when a shipper gives the space back', async () => {
    const { notifications, departures, run } = setUp();
    const { booking } = departures.book(run.departureId, { shipperDid: SHIPPER, description: 'Maize', weightKg: 500 });
    await settle();
    departures.cancelBooking(run.departureId, booking.bookingId, SHIPPER);
    await settle();

    const cancelled = inbox(notifications, MANAGER).filter((n) => n.kind === 'load_cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({ title: 'Space given back on Nairobi – Mombasa', body: 'The shipper cancelled Maize. That space is for sale again.' });
    expect(inbox(notifications, SHIPPER)).toHaveLength(0);
  });

  it('tells the SHIPPER when the carrier gives their space back — the side that reached nobody', async () => {
    const { notifications, departures, run } = setUp();
    const { booking } = departures.book(run.departureId, { shipperDid: SHIPPER, description: 'Maize', weightKg: 500 });
    await settle();
    departures.cancelBooking(run.departureId, booking.bookingId, MANAGER);
    await settle();

    const told = inbox(notifications, SHIPPER);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: 'load_cancelled', title: 'Kilima Logistics cancelled your booking' });
    expect(told[0].body).toMatch(/you will need another truck/);
    // The fleet did it; the fleet is told only about the sale, not about its own cancellation.
    expect(inbox(notifications, MANAGER).filter((n) => n.kind === 'load_cancelled')).toHaveLength(0);
  });

  it('never writes about a fleet’s OWN load, whoever cancels it', async () => {
    const { notifications, departures, run } = setUp();
    const { booking } = departures.addOwnLoad(run.departureId, MANAGER, { customer: 'Kariuki', description: 'Cement', weightKg: 300 });
    departures.cancelBooking(run.departureId, booking.bookingId, MANAGER);
    await settle();

    // The customer behind an own load has no account here, and the fleet did it itself.
    expect(inbox(notifications, MANAGER)).toHaveLength(0);
  });

  it('tells the carrier a claim was opened, on which load, and what to do', async () => {
    const { notifications, departures, run } = setUp();
    const { booking } = departures.book(run.departureId, { shipperDid: SHIPPER, description: 'Solar panels', weightKg: 400 });
    departures.deliver(run.departureId, booking.bookingId, MANAGER, { receiverName: 'Joseph', photoRef: 'med_pod', confirmed: requiredUnloadKeys() });
    departures.openClaim(run.departureId, booking.bookingId, SHIPPER, { kind: 'damaged', description: 'Two panels cracked', photoRef: 'med_claim' });
    await settle();

    const claim = inbox(notifications, MANAGER).find((n) => n.kind === 'claim_opened');
    expect(claim).toMatchObject({ title: 'A claim on Solar panels' });
    expect(claim?.body).toMatch(/^Damaged: Two panels cracked/);
    expect(claim?.body).toMatch(/accept it, or refuse it with your reason/);
  });

  it('tells the shipper the carrier answered — as the CARRIER’s answer, never ours', async () => {
    const { notifications, departures, run } = setUp();
    const { booking } = departures.book(run.departureId, { shipperDid: SHIPPER, description: 'Solar panels', weightKg: 400 });
    departures.deliver(run.departureId, booking.bookingId, MANAGER, { receiverName: 'Joseph', photoRef: 'med_pod', confirmed: requiredUnloadKeys() });
    departures.openClaim(run.departureId, booking.bookingId, SHIPPER, { kind: 'damaged', description: 'Two panels cracked', photoRef: 'med_claim' });
    departures.answerClaim(run.departureId, booking.bookingId, MANAGER, 'refused', 'The panels were strapped and photographed intact at loading');
    await settle();

    const answer = inbox(notifications, SHIPPER).find((n) => n.kind === 'claim_answered');
    expect(answer).toMatchObject({ title: 'Kilima Logistics refused your claim' });
    expect(answer?.body).toContain('“The panels were strapped and photographed intact at loading”');
    // Nothing here weighs a claim; a shipper who read this as our verdict would stop at the wrong door.
    expect(answer?.body).toContain('SeeBuyGet does not decide claims');
  });
});

describe('a fleet hears the answer to a document it sent', () => {
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const inAYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

  const setUp = () => {
    const events = new EventBus();
    const notifications = new NotificationService(new OutboxPushSender());
    const none = {} as never;
    new NotificationDispatcher(
      events,
      notifications,
      { list: () => [] } as unknown as ParcelService,
      none as PersonService,
      { find: () => undefined, unfinished: () => [] } as unknown as AgentService,
      { list: () => [], overHours: () => false } as unknown as FleetService,
      none as ToteService,
      none as MdpService,
      none as DispatchService,
      { sweep: () => [] } as unknown as UnclaimedService,
      none as VendorService,
    ).onModuleInit();

    const dids = new DidService({ anchor: () => 'anchor' } as unknown as LedgerService, events);
    const entities = new EntityService(dids);
    entities.seed();
    const media = new MediaService();
    const managers = new FleetManagerService(
      dids,
      { store: () => ({ vaultRef: 'vault_x' }) } as unknown as IdentityVault,
      { upsert: () => undefined } as unknown as OperationalStore,
      events,
      entities,
      { can: () => true, require: () => undefined } as unknown as PresenceService,
      { geocode: () => ({ location: { lat: -1.28, lng: 36.82 } }) } as unknown as Geocoder,
      media,
    );
    const m = managers.register({
      companyName: 'Kilima Logistics',
      jurisdiction: 'KE',
      contactPhone: '+254700009999',
      ownerFullName: 'A Owner',
      ownerNationalId: 'ID-TOLD',
      depotAddress: 'Industrial Area',
      requirements: { businessRegistrationNo: 'BRS-TOLD', transportOperatorLicence: 'TLB-TOLD', taxId: 'P05TOLD' },
    });
    const photo = () => media.upload({ ownerDid: m.did, kind: 'kyc_licence', dataUrl: PNG }).mediaId;
    return { notifications, managers, did: m.did, photo };
  };

  it('is told a document it sent was recorded, and to when', async () => {
    const { notifications, managers, did, photo } = setUp();
    managers.sendPaper(did, { kind: 'operator_licence', copyRef: photo(), expiresAt: inAYear }, { ownerDid: did });
    managers.recordPapers(did, { licenceExpiresAt: inAYear }, 'ops1@sbg.test');
    await settle();

    const told = notifications.inboxFor(did);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: 'papers_checked', title: 'Your operator licence is recorded' });
  });

  it('is told a document was turned down, with the staff member’s own reason', async () => {
    const { notifications, managers, did, photo } = setUp();
    managers.sendPaper(did, { kind: 'carrier_insurance', copyRef: photo(), expiresAt: inAYear }, { ownerDid: did });
    managers.refusePaper(did, 'carrier_insurance', 'This is the quote, not the certificate.', 'ops1@sbg.test');
    await settle();

    const told = notifications.inboxFor(did);
    expect(told[0]).toMatchObject({ kind: 'papers_checked', title: 'Your carrier insurance was not accepted' });
    expect(told[0].body).toBe('This is the quote, not the certificate. Send it again from the dashboard.');
  });

  it('is NOT told about a date staff typed with nothing sent — nobody was waiting on that', async () => {
    const { notifications, managers, did } = setUp();
    managers.recordPapers(did, { licenceExpiresAt: inAYear }, 'ops1@sbg.test');
    await settle();
    expect(notifications.inboxFor(did)).toHaveLength(0);
  });
});
