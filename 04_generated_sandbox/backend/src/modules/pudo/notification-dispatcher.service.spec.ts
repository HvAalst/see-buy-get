import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { NotificationService } from './notification.service';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { OutboxPushSender } from './push-sender';
import type { ParcelService } from './parcel.service';
import type { PersonService } from './person.service';
import type { AgentService } from './agent.service';
import type { FleetService } from './fleet.service';
import type { ToteService } from './tote.service';
import type { MdpService } from './mdp.service';
import type { DispatchService } from './dispatch.service';

type Geo = { lat: number; lng: number };

interface HarnessOpts {
  // rule 1 + rule 4 (senderMobile picks the peer-send vs vendor copy)
  parcel?: { receiverPhoneHash?: string; destAgentDid?: string; destZone?: string; senderMobile?: string } | null;
  personByHash?: Record<string, { personDid: string }>;
  // agents: did → { shopName?, location? } (used by rule 1 shop name, rule 2 pickup geo, rule 3 dest check)
  agents?: Record<string, { shopName?: string; location?: Geo }>;
  // rule 2
  totes?: Record<string, { code: string; locationId: string; destinationLabel?: string }>;
  activeDrivers?: Array<{ driverDid: string; location?: Geo; lastLocatedAt?: string }>;
  mdps?: Record<string, { location: Geo }>;
  // rule 5 — which drivers' vehicles can carry the posted freight (default: all)
  canCarry?: (driverDid: string) => boolean;
  // rules 2 + 5 — whose DECLARED WORK (a road, or a radius) covers the pickup (default: all, as no
  // declaration does)
  heading?: (driverDid: string) => boolean;
  // rule 2c — the single best load near a moving driver, and what they are already deciding
  offerNear?: () => unknown | null;
  activeOffers?: () => unknown[];
}

/** Build a dispatcher over a real EventBus + NotificationService, with fake domain lookups. */
function harness(opts: HarnessOpts) {
  const events = new EventBus();
  const outbox = new OutboxPushSender();
  const notifications = new NotificationService(outbox);

  const parcels = {
    get: (id: string) => {
      if (!opts.parcel) throw new Error(`no such parcel ${id}`);
      return opts.parcel;
    },
  } as unknown as ParcelService;
  const persons = { findByHash: (hash: string) => opts.personByHash?.[hash] } as unknown as PersonService;
  const agents = {
    get: (did: string) => {
      const a = opts.agents?.[did];
      if (!a) throw new Error('no such agent');
      return a;
    },
  } as unknown as AgentService;
  const fleet = {
    list: (_filter: { status?: string } = {}) => opts.activeDrivers ?? [],
  } as unknown as FleetService;
  const totes = { byCodeMaybe: (code: string) => opts.totes?.[code] } as unknown as ToteService;
  const mdps = {
    require: (id: string) => {
      const m = opts.mdps?.[id];
      if (!m) throw new Error('no such mdp');
      return m;
    },
  } as unknown as MdpService;
  const dispatch = {
    freightCarryableByDriver: (_freightId: string, driverDid: string) => (opts.canCarry ? opts.canCarry(driverDid) : true),
    worksNear: (driverDid: string) => (opts.heading ? opts.heading(driverDid) : true),
    // Dispatch owns "what can a load's location BE" (shop, hub, or a vendor's own dock), so the dispatcher
    // asks it rather than resolving twice. The fake answers for the two kinds these rules exercise.
    pickupPlace: (id: string) => {
      const agent = opts.agents?.[id];
      if (agent?.location) return { loc: agent.location, label: agent.shopName ?? id };
      const mdp = opts.mdps?.[id];
      return mdp ? { loc: mdp.location, label: id } : null;
    },
    offerNear: () => (opts.offerNear ? opts.offerNear() : null),
    activeOffersFor: () => (opts.activeOffers ? opts.activeOffers() : []),
    mintDeclineToken: () => 'decline-token',
  } as unknown as DispatchService;

  const dispatcher = new NotificationDispatcher(events, notifications, parcels, persons, agents, fleet, totes, mdps, dispatch);
  dispatcher.onModuleInit();
  return { events, notifications, outbox };
}

describe('NotificationDispatcher — rule 1: buyer "parcel arrived" (N2)', () => {
  it('notifies the receiver with the shop name when the parcel is ready', async () => {
    const { events, notifications } = harness({
      parcel: { receiverPhoneHash: 'hash-rx', destAgentDid: 'did:agent:9', destZone: 'Westlands' },
      personByHash: { 'hash-rx': { personDid: 'did:person:rx' } },
      agents: { 'did:agent:9': { shopName: 'Mama Njeri Shop' } },
    });
    await events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: 'P1' });
    const inbox = notifications.inboxFor('did:person:rx');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: 'parcel_ready', title: 'Your parcel has arrived' });
    expect(inbox[0].body).toBe('Ready to collect at Mama Njeri Shop.');
  });

  it('falls back to the destination zone when the shop name is unavailable', async () => {
    const { events, notifications } = harness({
      parcel: { receiverPhoneHash: 'hash-rx', destAgentDid: 'did:agent:unknown', destZone: 'Westlands' },
      personByHash: { 'hash-rx': { personDid: 'did:person:rx' } },
      agents: {},
    });
    await events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: 'P1' });
    expect(notifications.inboxFor('did:person:rx')[0].body).toBe('Ready to collect at Westlands.');
  });

  it('does nothing when the parcel has no receiver / the receiver has no account', async () => {
    const noReceiver = harness({ parcel: { destAgentDid: 'did:agent:9', destZone: 'Westlands' }, personByHash: {} });
    await noReceiver.events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: 'P1' });
    expect(noReceiver.notifications.inboxFor('did:person:rx')).toHaveLength(0);

    const noAccount = harness({
      parcel: { receiverPhoneHash: 'hash-rx', destAgentDid: 'did:agent:9', destZone: 'Westlands' },
      personByHash: {},
    });
    await noAccount.events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: 'P1' });
    expect(noAccount.notifications.inboxFor('did:person:rx')).toHaveLength(0);
  });

  it('swallows a missing-parcel lookup without throwing back into the bus', async () => {
    const { events } = harness({ parcel: null });
    await expect(events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: 'gone' })).resolves.toBeDefined();
    expect(events.getDeadLetters()).toHaveLength(0);
  });
});

describe('NotificationDispatcher — rule 2: driver "load near you" (N3)', () => {
  const at = (lat: number, lng: number): Geo => ({ lat, lng });
  const freshTs = () => new Date().toISOString();
  const staleTs = () => new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h old — past the 30-min window
  /** A driver with a live (fresh) fix by default; pass lastLocatedAt to override. */
  const D = (driverDid: string, location?: Geo, lastLocatedAt: string | undefined = freshTs()) => ({ driverDid, location, lastLocatedAt });

  it('pings only the ACTIVE drivers within range of the tote pickup, by live position', async () => {
    const { events, notifications } = harness({
      totes: { 'BAG-1': { code: 'BAG-1', locationId: 'did:agent:pickup', destinationLabel: 'Kisumu' } },
      agents: { 'did:agent:pickup': { location: at(0, 0) } },
      activeDrivers: [
        D('d-near', at(0, 0.01)), // ~1.1 km — within 8 km
        D('d-far', at(5, 5)), // ~785 km — out of range
        D('d-nogps', undefined), // no live position — cannot be "near"
      ],
    });
    await events.publish(GlosEvent.Pudo.ToteAvailable, { code: 'BAG-1' });

    const near = notifications.inboxFor('d-near');
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ kind: 'load_nearby', title: 'A load is near you' });
    expect(near[0].body).toBe('A bag heading to Kisumu is ready for pickup nearby.');
    expect(notifications.inboxFor('d-far')).toHaveLength(0);
    expect(notifications.inboxFor('d-nogps')).toHaveLength(0);
  });

  it('excludes a driver whose GPS is STALE or has no timestamp, even if the last point was near', async () => {
    const { events, notifications } = harness({
      totes: { 'BAG-5': { code: 'BAG-5', locationId: 'did:agent:pickup' } },
      agents: { 'did:agent:pickup': { location: at(0, 0) } },
      activeDrivers: [
        D('d-fresh', at(0, 0.01)), // fresh + near → notified
        D('d-stale', at(0, 0.01), staleTs()), // near but a 1h-old fix → not "near you now"
        { driverDid: 'd-nots', location: at(0, 0.01) }, // near but never timestamped → excluded (fail-safe)
      ],
    });
    await events.publish(GlosEvent.Pudo.ToteAvailable, { code: 'BAG-5' });
    expect(notifications.inboxFor('d-fresh')).toHaveLength(1);
    expect(notifications.inboxFor('d-stale')).toHaveLength(0);
    expect(notifications.inboxFor('d-nots')).toHaveLength(0);
  });

  it('resolves the pickup geo from an MDP-origin tote too', async () => {
    const { events, notifications } = harness({
      totes: { 'BAG-2': { code: 'BAG-2', locationId: 'mdp-1' } },
      mdps: { 'mdp-1': { location: at(0, 0) } },
      activeDrivers: [D('d-near', at(0, 0.02))],
    });
    await events.publish(GlosEvent.Pudo.ToteAvailable, { code: 'BAG-2' });
    expect(notifications.inboxFor('d-near')).toHaveLength(1);
    expect(notifications.inboxFor('d-near')[0].body).toBe('A bag is ready for pickup nearby.'); // no dest label
  });

  it('does nothing when the tote is unknown or its origin has no fixed geo', async () => {
    const unknownTote = harness({ totes: {}, activeDrivers: [D('d', at(0, 0))] });
    await unknownTote.events.publish(GlosEvent.Pudo.ToteAvailable, { code: 'ghost' });
    expect(unknownTote.notifications.inboxFor('d')).toHaveLength(0);

    const onBus = harness({
      totes: { 'BAG-3': { code: 'BAG-3', locationId: 'bus:badge-1' } }, // neither agent nor mdp
      activeDrivers: [D('d', at(0, 0))],
    });
    await onBus.events.publish(GlosEvent.Pudo.ToteAvailable, { code: 'BAG-3' });
    expect(onBus.notifications.inboxFor('d')).toHaveLength(0);
  });

  it('leaves out a driver whose DECLARED leg runs the other way', async () => {
    const { events, notifications } = harness({
      totes: { 'BAG-7': { code: 'BAG-7', locationId: 'did:agent:pickup', destinationLabel: 'Addis' } },
      agents: { 'did:agent:pickup': { location: at(0, 0) } },
      activeDrivers: [D('d-northbound', at(0, 0.01)), D('d-southbound', at(0, 0.01))],
      heading: (did) => did === 'd-northbound', // the other one said they are going the other way
    });
    await events.publish(GlosEvent.Pudo.ToteAvailable, { code: 'BAG-7' });
    // Both are equally NEAR. Near was only ever half the question.
    expect(notifications.inboxFor('d-northbound')).toHaveLength(1);
    expect(notifications.inboxFor('d-southbound')).toHaveLength(0);
  });

  it('asks the SHOP to close its own bag, in the words that fit the reason', async () => {
    const shop = () => harness({ agents: { 'did:agent:shop': { shopName: 'Mama Njeri Shop' } } });

    const full = shop();
    await full.events.publish(GlosEvent.Pudo.ToteNeedsSeal, { code: 'BAG-9', agentDid: 'did:agent:shop', reason: 'full', destination: 'Kisumu' });
    const inbox = full.notifications.inboxFor('did:agent:shop');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: 'bag_ready_to_close', title: 'A bag is full' });
    expect(inbox[0].body).toBe('Bag BAG-9 for Kisumu is full. Close it so a driver can take it.');

    // The aged nudge is a warning, not good news — and must not be swallowed by the "it is full" one.
    const aged = shop();
    await aged.events.publish(GlosEvent.Pudo.ToteNeedsSeal, { code: 'BAG-9', agentDid: 'did:agent:shop', reason: 'max_wait' });
    const agedRow = aged.notifications.inboxFor('did:agent:shop')[0];
    expect(agedRow).toMatchObject({ title: 'A bag has been waiting' });
    expect(agedRow.body).toContain('Close it');
  });

  it('interrupts a MOVING driver with one load, all of it decidable from the banner', async () => {
    const offer = { offerId: 'ofr_1', kind: 'tote', ref: 'BAG-9', pickupLabel: 'Mama Njeri Shop', destLabel: 'Addis', weightKg: 12, detourKm: 2, minutesAway: 6 };
    const { events, notifications } = harness({ offerNear: () => offer });

    await events.publish(GlosEvent.Pudo.DriverMoved, { driverDid: 'd-1', location: at(0, 0) });
    const inbox = notifications.inboxFor('d-1');
    expect(inbox).toHaveLength(1);
    // Everything the decision needs: what, where to, how far off the road, what it pays, where to collect.
    expect(inbox[0].title).toBe('Bag to Addis · 6 min away');
    expect(inbox[0].body).toContain('12 kg · 2 km off your road · you earn');
    expect(inbox[0].body).toContain('Waiting at Mama Njeri Shop');
    expect(inbox[0].link).toBe('/?offer=ofr_1'); // one tap → that one card
    expect(inbox[0].data).toMatchObject({ offerId: 'ofr_1', declineToken: 'decline-token' });
  });

  it('keeps quiet: a parked phone, a second load inside the cooldown, one already being decided, and one already refused', async () => {
    const offer = { offerId: 'ofr_1', kind: 'tote', ref: 'BAG-9', pickupLabel: 'Shop', destLabel: 'Addis', weightKg: 12, detourKm: 2, minutesAway: 6 };

    // A GPS that jitters where it stands is not movement.
    const parked = harness({ offerNear: () => offer });
    await parked.events.publish(GlosEvent.Pudo.DriverMoved, { driverDid: 'd', location: at(0, 0) });
    await parked.events.publish(GlosEvent.Pudo.DriverMoved, { driverDid: 'd', location: at(0, 0.0005) }); // ~55 m
    expect(parked.notifications.inboxFor('d')).toHaveLength(1); // the first fix asked; the jitter did not

    // Driving on, a SECOND load inside the cooldown waits its turn.
    const second = { ...offer, offerId: 'ofr_2', ref: 'BAG-10' };
    let next: unknown = offer;
    const moving = harness({ offerNear: () => next });
    await moving.events.publish(GlosEvent.Pudo.DriverMoved, { driverDid: 'd', location: at(0, 0) });
    next = second;
    await moving.events.publish(GlosEvent.Pudo.DriverMoved, { driverDid: 'd', location: at(0, 0.05) }); // ~5 km on
    expect(moving.notifications.inboxFor('d')).toHaveLength(1);

    // An unanswered offer is an open question — do not ask another.
    const busy = harness({ offerNear: () => offer, activeOffers: () => [offer] });
    await busy.events.publish(GlosEvent.Pudo.DriverMoved, { driverDid: 'd', location: at(0, 0) });
    expect(busy.notifications.inboxFor('d')).toHaveLength(0);

    // Nothing near, nothing said.
    const quiet = harness({ offerNear: () => null });
    await quiet.events.publish(GlosEvent.Pudo.DriverMoved, { driverDid: 'd', location: at(0, 0) });
    expect(quiet.notifications.inboxFor('d')).toHaveLength(0);
    expect(quiet.events.getDeadLetters()).toHaveLength(0);
  });

  it('says nothing when the bag is not sitting at a real PUDO', async () => {
    const hub = harness({ agents: {} });
    await hub.events.publish(GlosEvent.Pudo.ToteNeedsSeal, { code: 'BAG-9', agentDid: 'mdp-1', reason: 'full' });
    expect(hub.notifications.inboxFor('mdp-1')).toHaveLength(0);
    expect(hub.events.getDeadLetters()).toHaveLength(0);
  });

  it('caps the fan-out to the nearest N drivers', async () => {
    const drivers = Array.from({ length: 20 }, (_, i) => D(`d${i}`, at(0, 0.001 * (i + 1))));
    const { events, notifications } = harness({
      totes: { 'BAG-4': { code: 'BAG-4', locationId: 'did:agent:pickup' } },
      agents: { 'did:agent:pickup': { location: at(0, 0) } },
      activeDrivers: drivers,
    });
    await events.publish(GlosEvent.Pudo.ToteAvailable, { code: 'BAG-4' });
    const notified = drivers.filter((d) => notifications.inboxFor(d.driverDid).length > 0);
    expect(notified.length).toBe(12); // NEARBY_DRIVER_CAP
    // the nearest are the ones kept
    expect(notifications.inboxFor('d0')).toHaveLength(1);
    expect(notifications.inboxFor('d19')).toHaveLength(0);
  });
});

describe('NotificationDispatcher — rule 3: PUDO agent "bus inbound" (N3)', () => {
  it('tells the destination PUDO agent when a bag is bound for them', async () => {
    const { events, notifications } = harness({ agents: { 'did:agent:dest': { shopName: 'Dest Shop' } } });
    await events.publish(GlosEvent.Pudo.BagLoaded, { destinationNodeId: 'did:agent:dest', parcels: 3, code: 'BAG-9' });
    const inbox = notifications.inboxFor('did:agent:dest');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: 'bus_inbound', title: 'A bus is inbound' });
    expect(inbox[0].body).toBe('A bus with 3 parcels is on its way to you.');
  });

  it('uses the singular for one parcel', async () => {
    const { events, notifications } = harness({ agents: { 'did:agent:dest': {} } });
    await events.publish(GlosEvent.Pudo.BagLoaded, { destinationNodeId: 'did:agent:dest', parcels: 1 });
    expect(notifications.inboxFor('did:agent:dest')[0].body).toBe('A bus with 1 parcel is on its way to you.');
  });

  it('does NOT notify when the bag is bound for an MDP hub (re-sort leg), or has no destination', async () => {
    const toMdp = harness({ agents: {}, mdps: { 'mdp-1': { location: { lat: 0, lng: 0 } } } });
    await toMdp.events.publish(GlosEvent.Pudo.BagLoaded, { destinationNodeId: 'mdp-1', parcels: 5 });
    expect(toMdp.notifications.inboxFor('mdp-1')).toHaveLength(0);

    const noDest = harness({ agents: { 'did:agent:dest': {} } });
    await noDest.events.publish(GlosEvent.Pudo.BagLoaded, { parcels: 2 });
    expect(noDest.notifications.inboxFor('did:agent:dest')).toHaveLength(0);
  });
});

describe('NotificationDispatcher — rule 4: drop-off PUDO "a parcel is coming in" (genesis)', () => {
  it('tells the origin PUDO to expect a paid vendor mint (ParcelPaid, once — at mint or settle)', async () => {
    const { events, notifications } = harness({
      parcel: { senderMobile: 'vendor', destZone: 'Kisumu' },
      agents: { 'did:agent:origin': { shopName: 'Mama Sarah Shop' } },
    });
    await events.publish(GlosEvent.Pudo.ParcelPaid, { parcelId: 'PUD-1', originAgentDid: 'did:agent:origin', amount: 12 });
    const inbox = notifications.inboxFor('did:agent:origin');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: 'intake_expected', title: 'A parcel is coming in' });
    expect(inbox[0].body).toContain('store shipment');
    expect(JSON.stringify(inbox[0])).not.toContain('Kisumu'); // destination zone is not leaked to the drop-off shop payload
  });

  it('tells the origin PUDO to expect a person peer-send (ParcelMinted), with take-in-at-counter copy', async () => {
    const { events, notifications } = harness({
      parcel: { senderMobile: 'app' },
      agents: { 'did:agent:origin': { shopName: 'Mama Sarah Shop' } },
    });
    await events.publish(GlosEvent.Pudo.ParcelMinted, { parcelId: 'PUD-2', originAgentDid: 'did:agent:origin', destAgentDid: 'did:agent:dest' });
    const inbox = notifications.inboxFor('did:agent:origin');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].body).toContain('booked parcel');
  });

  it('skips when the origin is not a real PUDO agent, or is absent', async () => {
    const notAgent = harness({ parcel: { senderMobile: 'app' }, agents: {} });
    await notAgent.events.publish(GlosEvent.Pudo.ParcelMinted, { parcelId: 'PUD-3', originAgentDid: 'mdp-1' });
    expect(notAgent.notifications.inboxFor('mdp-1')).toHaveLength(0);

    const noOrigin = harness({ parcel: { senderMobile: 'app' }, agents: { 'did:agent:origin': {} } });
    await noOrigin.events.publish(GlosEvent.Pudo.ParcelMinted, { parcelId: 'PUD-4' });
    expect(noOrigin.notifications.inboxFor('did:agent:origin')).toHaveLength(0);
  });

  it('is idempotent — a re-published ParcelPaid for the same parcel does NOT stack a second inbox row', async () => {
    const { events, notifications } = harness({
      parcel: { senderMobile: 'vendor' },
      agents: { 'did:agent:origin': { shopName: 'Mama Sarah Shop' } },
    });
    await events.publish(GlosEvent.Pudo.ParcelPaid, { parcelId: 'PUD-5', originAgentDid: 'did:agent:origin', amount: 12 });
    await events.publish(GlosEvent.Pudo.ParcelPaid, { parcelId: 'PUD-5', originAgentDid: 'did:agent:origin', amount: 12 });
    expect(notifications.inboxFor('did:agent:origin')).toHaveLength(1); // the SW-tag can't dedupe the record — onMinted does
  });

  it('does NOT subscribe InboundCreated — so a paid mint (which fires BOTH events) notifies exactly once', async () => {
    // A paid vendor createInbound publishes InboundCreated AND ParcelPaid; Rule 4 listens to ParcelPaid only.
    const { events, notifications } = harness({
      parcel: { senderMobile: 'vendor' },
      agents: { 'did:agent:origin': { shopName: 'Mama Sarah Shop' } },
    });
    await events.publish(GlosEvent.Pudo.InboundCreated, { parcelId: 'PUD-6', originAgentDid: 'did:agent:origin', destAgentDid: 'did:agent:dest' });
    expect(notifications.inboxFor('did:agent:origin')).toHaveLength(0); // InboundCreated alone → nothing
    await events.publish(GlosEvent.Pudo.ParcelPaid, { parcelId: 'PUD-6', originAgentDid: 'did:agent:origin', amount: 12 });
    expect(notifications.inboxFor('did:agent:origin')).toHaveLength(1); // …only ParcelPaid notifies
  });
});

describe('NotificationDispatcher — rule 5: driver "load near you" for a posted freight (genesis)', () => {
  const at = (lat: number, lng: number): Geo => ({ lat, lng });
  const D = (driverDid: string, location?: Geo, lastLocatedAt: string | undefined = new Date().toISOString()) => ({ driverDid, location, lastLocatedAt });

  it('pings active drivers near the freight pickup, reusing the tote matching', async () => {
    const { events, notifications } = harness({
      activeDrivers: [D('d-near', at(0, 0.01)), D('d-far', at(5, 5)), D('d-nogps', undefined)],
    });
    await events.publish(GlosEvent.Pudo.FreightPosted, { freightId: 'frt_1', destLabel: 'Kisumu', pickupLocation: at(0, 0), weightKg: 300 });
    const near = notifications.inboxFor('d-near');
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ kind: 'load_nearby', title: 'A load is near you' });
    expect(near[0].body).toBe('A freight load to Kisumu is ready to claim nearby.');
    expect(notifications.inboxFor('d-far')).toHaveLength(0);
    expect(notifications.inboxFor('d-nogps')).toHaveLength(0);
  });

  it('does nothing when the freight has no pickup coordinate', async () => {
    const { events, notifications } = harness({ activeDrivers: [D('d', at(0, 0))] });
    await events.publish(GlosEvent.Pudo.FreightPosted, { freightId: 'frt_2', destLabel: 'Kisumu', weightKg: 300 });
    expect(notifications.inboxFor('d')).toHaveLength(0);
  });

  it('pings ONLY nearby drivers whose vehicle can carry the freight — a bike driver near a pallet is skipped', async () => {
    const { events, notifications } = harness({
      activeDrivers: [D('d-truck', at(0, 0.01)), D('d-bike', at(0, 0.011))], // both near
      canCarry: (driverDid) => driverDid === 'd-truck', // only the truck is fit for the pallet
    });
    await events.publish(GlosEvent.Pudo.FreightPosted, { freightId: 'frt_3', destLabel: 'Kisumu', pickupLocation: at(0, 0), weightKg: 300 });
    expect(notifications.inboxFor('d-truck')).toHaveLength(1);
    expect(notifications.inboxFor('d-bike')).toHaveLength(0); // near, but can't carry it
  });
});
