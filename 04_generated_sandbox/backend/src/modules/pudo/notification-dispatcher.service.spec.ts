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

type Geo = { lat: number; lng: number };

interface HarnessOpts {
  // rule 1
  parcel?: { receiverPhoneHash?: string; destAgentDid?: string; destZone?: string } | null;
  personByHash?: Record<string, { personDid: string }>;
  // agents: did → { shopName?, location? } (used by rule 1 shop name, rule 2 pickup geo, rule 3 dest check)
  agents?: Record<string, { shopName?: string; location?: Geo }>;
  // rule 2
  totes?: Record<string, { code: string; locationId: string; destinationLabel?: string }>;
  activeDrivers?: Array<{ driverDid: string; location?: Geo; lastLocatedAt?: string }>;
  mdps?: Record<string, { location: Geo }>;
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

  const dispatcher = new NotificationDispatcher(events, notifications, parcels, persons, agents, fleet, totes, mdps);
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
