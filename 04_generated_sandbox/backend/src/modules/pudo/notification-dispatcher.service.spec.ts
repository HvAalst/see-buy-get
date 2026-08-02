import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { NotificationService } from './notification.service';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { OutboxPushSender } from './push-sender';
import type { ParcelService } from './parcel.service';
import type { PersonService } from './person.service';
import type { AgentService } from './agent.service';

/** Build a dispatcher over a real EventBus + NotificationService, with fake domain lookups. */
function harness(opts: {
  parcel?: { receiverPhoneHash?: string; destAgentDid?: string; destZone?: string } | null;
  personByHash?: Record<string, { personDid: string }>;
  shopByDid?: Record<string, { shopName: string }>;
}) {
  const events = new EventBus();
  const outbox = new OutboxPushSender();
  const notifications = new NotificationService(outbox);

  const parcels = {
    get: (id: string) => {
      if (!opts.parcel) throw new Error(`no such parcel ${id}`);
      return opts.parcel;
    },
  } as unknown as ParcelService;
  const persons = {
    findByHash: (hash: string) => opts.personByHash?.[hash],
  } as unknown as PersonService;
  const agents = {
    get: (did: string) => {
      const a = opts.shopByDid?.[did];
      if (!a) throw new Error('no such agent');
      return a;
    },
  } as unknown as AgentService;

  const dispatcher = new NotificationDispatcher(events, notifications, parcels, persons, agents);
  dispatcher.onModuleInit();
  return { events, notifications, outbox };
}

describe('NotificationDispatcher — rule 1: buyer "parcel arrived" (N2)', () => {
  it('notifies the receiver with the shop name when the parcel is ready', async () => {
    const { events, notifications, outbox } = harness({
      parcel: { receiverPhoneHash: 'hash-rx', destAgentDid: 'did:agent:9', destZone: 'Westlands' },
      personByHash: { 'hash-rx': { personDid: 'did:person:rx' } },
      shopByDid: { 'did:agent:9': { shopName: 'Mama Njeri Shop' } },
    });

    await events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: 'P1' });

    const inbox = notifications.inboxFor('did:person:rx');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: 'parcel_ready', title: 'Your parcel has arrived' });
    expect(inbox[0].body).toBe('Ready to collect at Mama Njeri Shop.');
    expect(inbox[0].data).toMatchObject({ parcelId: 'P1' });
    // No device subscribed → nothing in the outbox, but the inbox record still exists (not lost).
    expect(outbox.outboxFor('did:person:rx')).toHaveLength(0);
  });

  it('falls back to the destination zone when the shop name is unavailable', async () => {
    const { events, notifications } = harness({
      parcel: { receiverPhoneHash: 'hash-rx', destAgentDid: 'did:agent:unknown', destZone: 'Westlands' },
      personByHash: { 'hash-rx': { personDid: 'did:person:rx' } },
      shopByDid: {}, // agents.get throws → falls back to the zone
    });
    await events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: 'P1' });
    expect(notifications.inboxFor('did:person:rx')[0].body).toBe('Ready to collect at Westlands.');
  });

  it('pushes to the receiver’s device when they have one', async () => {
    const { events, notifications, outbox } = harness({
      parcel: { receiverPhoneHash: 'hash-rx', destAgentDid: 'did:agent:9', destZone: 'Westlands' },
      personByHash: { 'hash-rx': { personDid: 'did:person:rx' } },
      shopByDid: { 'did:agent:9': { shopName: 'Mama Njeri Shop' } },
    });
    notifications.subscribe('did:person:rx', 'consumer', { endpoint: 'https://push/1', keys: { p256dh: 'p', auth: 'a' } });
    await events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: 'P1' });
    expect(outbox.outboxFor('did:person:rx')).toHaveLength(1);
  });

  it('does nothing when the parcel has no receiver identity', async () => {
    const { events, notifications } = harness({
      parcel: { destAgentDid: 'did:agent:9', destZone: 'Westlands' }, // no receiverPhoneHash
      personByHash: {},
    });
    await events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: 'P1' });
    expect(notifications.inboxFor('did:person:rx')).toHaveLength(0);
  });

  it('does nothing when the receiver has no account yet', async () => {
    const { events, notifications } = harness({
      parcel: { receiverPhoneHash: 'hash-rx', destAgentDid: 'did:agent:9', destZone: 'Westlands' },
      personByHash: {}, // findByHash returns undefined
    });
    await events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: 'P1' });
    expect(notifications.inboxFor('did:person:rx')).toHaveLength(0);
  });

  it('swallows a missing-parcel lookup without throwing back into the bus', async () => {
    const { events } = harness({ parcel: null }); // parcels.get throws
    await expect(events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: 'gone' })).resolves.toBeDefined();
    // No dead-letter: the handler caught its own error, so the bus recorded a clean delivery.
    expect(events.getDeadLetters()).toHaveLength(0);
  });
});
