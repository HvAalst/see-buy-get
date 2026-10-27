import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { NotificationService } from './notification.service';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { OutboxPushSender } from './push-sender';
import type { ParcelService } from './parcel.service';
import type { PersonService } from './person.service';
import { signupGapOf, type AgentService } from './agent.service';
import type { AgentStatus } from './pudo.types';
import type { FleetService } from './fleet.service';
import type { ToteService } from './tote.service';
import type { MdpService } from './mdp.service';
import type { DispatchService } from './dispatch.service';
import type { UnclaimedService } from './unclaimed.service';
import type { VendorService } from './vendor.service';

type Geo = { lat: number; lng: number };

interface HarnessOpts {
  /** Shops mid-onboarding, keyed by did. MUTABLE: the dispatcher stamps its nudge onto these records. */
  signups?: Record<string, { status: AgentStatus; shopName?: string; kyc?: { idCopyRef?: string; tradingLicenceRef?: string; shopPhotoRefs?: string[] }; kycRejection?: { reason: string; at: string }; signupNudgedFor?: string }>;
  /** What the window-closing half of the shelf sweep found, so the final-notice cases can name it. */
  unclaimedSweep?: () => Array<{ parcelId: string }>;
  // rule 1 + rule 4 (senderMobile picks the peer-send vs vendor copy)
  parcel?: { receiverPhoneHash?: string; senderPhoneHash?: string; vendorId?: string; binSlot?: string; destAgentDid?: string; destZone?: string; senderMobile?: string } | null;
  personByHash?: Record<string, { personDid: string }>;
  // agents: did → { shopName?, location? } (used by rule 1 shop name, rule 2 pickup geo, rule 3 dest check)
  agents?: Record<string, { shopName?: string; location?: Geo }>;
  // rule 2
  totes?: Record<string, { code: string; locationId: string; destinationLabel?: string }>;
  activeDrivers?: Array<{ driverDid: string; location?: Geo; lastLocatedAt?: string }>;
  /** FP8 — drivers past the 13-hour shift limit, who may not be offered anything. */
  overHours?: string[];
  mdps?: Record<string, { location: Geo }>;
  // rule 5 — which drivers' vehicles can carry the posted freight (default: all)
  canCarry?: (driverDid: string) => boolean;
  // rules 2 + 5 — whose DECLARED WORK (a road, or a radius) covers the pickup (default: all, as no
  // declaration does)
  heading?: (driverDid: string) => boolean;
  // the uncollected sweep — what is sitting on destination shelves right now
  onShelf?: unknown[];
  // what the dispatcher said to stores' systems, as [vendorId, event, payload]
  vendorCalls?: unknown[][];
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
    // The uncollected sweep reads the shelf rather than reacting to an event — there IS no event when
    // nothing happens, which is the whole reason nobody was being told.
    list: () => opts.onShelf ?? [],
    // No account is named for any parcel here: each side is found by the number it was addressed to.
    receiverOf: (p: { receiverPhoneHash?: string }) => ({ hash: p.receiverPhoneHash }),
    senderOf: (p: { senderPhoneHash?: string }) => ({ hash: p.senderPhoneHash }),
    // What a day of holding costs is the parcel service's to say: the rate fixed on the parcel, in its shop's money.
    holdingTermsOf: (p: { holdingFeePerDay?: number }) => ({ perDay: p.holdingFeePerDay ?? 0.1, currency: 'KES' }),
    // …and nobody's account was moved without its PIN: every code is shown to whoever it belongs to.
    codeHeldUntil: () => undefined,
  } as unknown as ParcelService;
  const persons = { findByHash: (hash: string) => opts.personByHash?.[hash] } as unknown as PersonService;
  const agents = {
    get: (did: string) => {
      const a = opts.agents?.[did];
      if (!a) throw new Error('no such agent');
      return a;
    },
    // Onboarding: the dispatcher reads the shop RECORD (and writes its nudge stamp onto it), so the fake
    // hands back the same mutable object the test holds — a copy would hide the stamp that stops a repeat.
    find: (did: string) => opts.signups?.[did],
    unfinished: () =>
      Object.entries(opts.signups ?? {})
        .filter(([, a]) => a.status === 'DRAFT' || a.status === 'APPROVED_UNFUNDED')
        .map(([did, a]) => ({ did, told: Boolean(a.signupNudgedFor) && a.signupNudgedFor === signupGapOf(a) })),
  } as unknown as AgentService;
  const fleet = {
    list: (_filter: { status?: string } = {}) => opts.activeDrivers ?? [],
    // FP8 — nobody is over the shift limit unless a test says so.
    overHours: (driverDid: string) => (opts.overHours ?? []).includes(driverDid),
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
    // What scanning a bag aboard pays this driver, and in what money — their own company's.
    driverPayTerms: () => ({ bagLoadPay: 0.5, currency: 'KES' }),
    activeOffersFor: () => (opts.activeOffers ? opts.activeOffers() : []),
    mintDeclineToken: () => 'decline-token',
  } as unknown as DispatchService;

  // The window-closing half of the shelf sweep, stubbed: these cases are about who gets TOLD what, and a
  // real UnclaimedService would drag a shelf, a wallet and a return book into every one of them.
  const unclaimed = { sweep: () => (opts.unclaimedSweep ? opts.unclaimedSweep() : []) } as unknown as UnclaimedService;
  const vendors = {
    notify: (...call: unknown[]) => {
      opts.vendorCalls?.push(call);
      return null;
    },
  } as unknown as VendorService;

  const dispatcher = new NotificationDispatcher(events, notifications, parcels, persons, agents, fleet, totes, mdps, dispatch, unclaimed, vendors);
  dispatcher.onModuleInit();
  return { events, notifications, outbox, dispatcher };
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

  it('does not ping a driver who is past the shift limit and could not take the load anyway', async () => {
    /*
     * FP8, and the half that was missing. `suggestWork` returns nothing to a driver over 13 hours, the
     * board marks the row and the claim refuses it — but this path checked none of that, so the one
     * channel that reaches a driver who is NOT looking at the app was the one still offering them work.
     * A lock-screen nudge toward a load they would be turned away from, sent to the very person the
     * limit exists to protect.
     */
    const { events, notifications } = harness({
      totes: { 'BAG-9': { code: 'BAG-9', locationId: 'did:agent:pickup', destinationLabel: 'Kisumu' } },
      agents: { 'did:agent:pickup': { location: at(0, 0) } },
      activeDrivers: [D('d-rested', at(0, 0.01)), D('d-tired', at(0, 0.01))],
      overHours: ['d-tired'],
    });
    await events.publish(GlosEvent.Pudo.ToteAvailable, { code: 'BAG-9' });

    expect(notifications.inboxFor('d-rested')).toHaveLength(1);
    expect(notifications.inboxFor('d-tired')).toHaveLength(0);
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
    const offer = { offerId: 'ofr_1', kind: 'tote', ref: 'BAG-9', pickupLabel: 'Mama Njeri Shop', destLabel: 'Addis', weightKg: 12, detourKm: 2, minutesAway: 6, earn: 3.68, collectMin: 4, deliverMin: 11 };
    const { events, notifications } = harness({ offerNear: () => offer });

    await events.publish(GlosEvent.Pudo.DriverMoved, { driverDid: 'd-1', location: at(0, 0) });
    const inbox = notifications.inboxFor('d-1');
    expect(inbox).toHaveLength(1);
    // The three things a driver decides on at the wheel, in that order: what it pays, what it costs them to
    // go and get it, and what carrying it then costs on top. Kilometres are an abstraction here — minutes
    // are what a driver spends and the only unit they can justify to a bus full of passengers.
    expect(inbox[0].title).toBe('Bag to Addis · you earn KES 3.68');
    expect(inbox[0].body).toContain('+4 min to collect · +11 min to drop');
    expect(inbox[0].body).toContain('12 kg · waiting at Mama Njeri Shop');
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

/**
 * The sweep — because nothing happens when a parcel is NOT collected.
 *
 * Every other rule here reacts to an event. This one cannot: the failure being watched for is an absence,
 * and an absence publishes nothing. A receiver used to be told once, on a notification tagged so that
 * republishing collapses onto it — so if they were on a bus or the phone was flat, that was the whole
 * conversation, and the parcel then sat on a shop's shelf holding a slot with nobody aware of it.
 */
/**
 * A PARCEL RUNNING LATE — the same absence as the uncollected shelf, earlier in the journey: nothing happens when a
 * parcel does not arrive by the time it was promised, so a sweep says it.
 */
describe('NotificationDispatcher — a parcel running late', () => {
  const HOUR = 3_600_000;
  const onItsWay = (over: Record<string, unknown> = {}) => ({
    parcelId: 'PUD-LATE',
    status: 'On_Bus',
    receiverPhoneHash: 'hash-r',
    senderPhoneHash: 'hash-s',
    destAgentDid: 'did:glos:shop',
    destZone: 'Kisumu',
    plan: { hops: [], mdpRouted: false, pickupReadyAt: new Date(Date.now() - 5 * HOUR).toISOString(), plannedAt: new Date(Date.now() - 30 * HOUR).toISOString() },
    ...over,
  });
  const people = { 'hash-r': { personDid: 'did:glos:person-r' }, 'hash-s': { personDid: 'did:glos:person-s' } };
  const shop = { 'did:glos:shop': { shopName: "Mama Sarah's" } };
  /** The harness sweeps once as it starts; the parcels are put on the road after that, as they would be. */
  const started = (over: Record<string, unknown> = {}) => {
    const list: unknown[] = [];
    const vendorCalls: unknown[][] = [];
    return { ...harness({ onShelf: list, personByHash: people, agents: shop, vendorCalls, ...over }), list, vendorCalls };
  };

  it('tells the receiver and the person who sent it — once — how late, and where it is', async () => {
    const { dispatcher, notifications, list } = started();
    list.push(onItsWay());
    expect(await dispatcher.sweepParcelsLate()).toBe(1);
    const [r] = notifications.inboxFor('did:glos:person-r');
    expect(r).toMatchObject({ kind: 'parcel_late', title: 'Your parcel is running late', body: "It should have been ready at Mama Sarah's about 5 hours ago. It is on its way. You are told when it is ready to collect.", link: '/?parcel=PUD-LATE' });
    const [s] = notifications.inboxFor('did:glos:person-s');
    expect(s).toMatchObject({ kind: 'parcel_late', title: 'A parcel you sent is running late' });
    expect(s.body).toBe("It should have been ready at Mama Sarah's about 5 hours ago. It is on its way. Its tracking page shows where it is.");
    // Once, however often the sweep runs.
    expect(await dispatcher.sweepParcelsLate()).toBe(0);
    expect(notifications.inboxFor('did:glos:person-r')).toHaveLength(1);
  });

  it('says nothing within the grace, before it was handed in, once it has arrived, or with no promise kept', async () => {
    const { dispatcher, notifications, list } = started();
    list.push(
      onItsWay({ parcelId: 'A', plan: { hops: [], mdpRouted: false, pickupReadyAt: new Date(Date.now() - HOUR).toISOString() } }),
      onItsWay({ parcelId: 'B', status: 'Created' }),
      onItsWay({ parcelId: 'C', status: 'Ready_For_Pickup' }),
      onItsWay({ parcelId: 'D', plan: undefined }),
    );
    expect(await dispatcher.sweepParcelsLate()).toBe(0);
    expect(notifications.inboxFor('did:glos:person-r')).toHaveLength(0);
  });

  it('a store’s order: the buyer is told in the app, the store on its own systems — and nobody else', async () => {
    const { dispatcher, notifications, list, vendorCalls } = started();
    list.push(onItsWay({ status: 'At_MDP', vendorId: 'vnd_1', externalOrderId: 'ORD-9' }));
    expect(await dispatcher.sweepParcelsLate()).toBe(1);
    expect(notifications.inboxFor('did:glos:person-r')[0].body).toContain('It is at a sorting hub.');
    expect(notifications.inboxFor('did:glos:person-s')).toHaveLength(0);
    expect(vendorCalls).toEqual([['vnd_1', 'parcel.late', { parcelId: 'PUD-LATE', externalOrderId: 'ORD-9', status: 'At_MDP', promisedAt: expect.any(String), lateHours: 5 }]]);
  });

  it('says a day late in days, and a parcel still at the shop it was handed in at as that', async () => {
    const { dispatcher, notifications, list } = started();
    list.push(onItsWay({ status: 'At_PUDO', plan: { hops: [], mdpRouted: false, pickupReadyAt: new Date(Date.now() - 50 * HOUR).toISOString() } }));
    await dispatcher.sweepParcelsLate();
    expect(notifications.inboxFor('did:glos:person-r')[0].body).toBe("It should have been ready at Mama Sarah's about 2 days ago. It is still at the shop it was handed in at. You are told when it is ready to collect.");
  });

  it('marks a parcel it could tell nobody about, so somebody who signs up later is not told stale news', async () => {
    const { dispatcher, list } = started({ personByHash: {} });
    const late = onItsWay();
    list.push(late);
    expect(await dispatcher.sweepParcelsLate()).toBe(1);
    expect((late as { lateToldAt?: string }).lateToldAt).toBeDefined();
    expect(await dispatcher.sweepParcelsLate()).toBe(0);
  });

  it('tells a person who sent a parcel to themselves once, not twice', async () => {
    const { dispatcher, notifications, list } = started();
    list.push(onItsWay({ senderPhoneHash: 'hash-r' }));
    await dispatcher.sweepParcelsLate();
    expect(notifications.inboxFor('did:glos:person-r')).toHaveLength(1);
  });
});

describe('NotificationDispatcher — the uncollected reminder', () => {
  const HOUR = 3_600_000;
  const shelved = (over: Record<string, unknown> = {}) => ({
    parcelId: 'PUD-WAITING',
    status: 'Ready_For_Pickup',
    receiverPhoneHash: 'hash-r',
    destAgentDid: 'did:glos:shop',
    destZone: 'Kisumu',
    readyAt: new Date(Date.now() - 30 * HOUR).toISOString(),
    ...over,
  });
  const receiver = { 'hash-r': { personDid: 'did:glos:person-r' } };
  const shop = { 'did:glos:shop': { shopName: "Mama Sarah's" } };

  it('reminds a receiver whose parcel has been waiting', async () => {
    const { dispatcher, notifications } = harness({ onShelf: [shelved()], personByHash: receiver, agents: shop });
    expect(await dispatcher.remindUncollected()).toBe(1);
    const [note] = notifications.inboxFor('did:glos:person-r');
    expect(note.title).toMatch(/still waiting/i);
    expect(note.body).toContain("Mama Sarah's");
  });

  it('arrives ALONGSIDE the arrival notice, not on top of it', async () => {
    // The reminder carries its own tag. Reusing the arrival one would collapse it onto a notification the
    // receiver has already seen and dismissed — which is the bug being fixed, not a way to fix it. Asserted
    // as what the receiver actually ends up holding, which is the thing that matters and the stronger claim.
    const { dispatcher, notifications, events } = harness({
      parcel: shelved(),
      onShelf: [shelved()],
      personByHash: receiver,
      agents: shop,
    });
    await events.publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId: 'PUD-WAITING' });
    await new Promise((r) => setImmediate(r));
    await dispatcher.remindUncollected();

    const inbox = notifications.inboxFor('did:glos:person-r');
    expect(inbox).toHaveLength(2);
    expect(inbox.map((n) => n.title)).toEqual(expect.arrayContaining([expect.stringMatching(/arrived/i), expect.stringMatching(/still waiting/i)]));
  });

  it('says nothing while the parcel has only just arrived', async () => {
    const { dispatcher } = harness({ onShelf: [shelved({ readyAt: new Date(Date.now() - HOUR).toISOString() })], personByHash: receiver, agents: shop });
    expect(await dispatcher.remindUncollected()).toBe(0);
  });

  it('reminds ONCE, however often the sweep runs', async () => {
    // Hourly sweep, day-scale problem. A parcel that nags somebody daily is an app they turn off, and
    // then they hear nothing about the next parcel either.
    const { dispatcher } = harness({ onShelf: [shelved()], personByHash: receiver, agents: shop });
    expect(await dispatcher.remindUncollected()).toBe(1);
    expect(await dispatcher.remindUncollected()).toBe(0);
  });

  it('marks a parcel it could not tell anybody about, so they are not greeted by stale news', async () => {
    // A receiver with no account has nowhere to push to. Stamping anyway means somebody who signs up next
    // week is not met by a reminder about a parcel that has been sitting a fortnight.
    const waiting = shelved();
    const { dispatcher } = harness({ onShelf: [waiting], personByHash: {}, agents: shop });
    expect(await dispatcher.remindUncollected()).toBe(0);
    expect((waiting as { uncollectedRemindedAt?: string }).uncollectedRemindedAt).toBeDefined();
  });

  it('will not age a parcel it has no honest clock for', async () => {
    // Records written before the arrival was stamped. Guessing from the scan list would reset the clock
    // every time somebody fumbled a collection code.
    const { dispatcher } = harness({ onShelf: [shelved({ readyAt: undefined })], personByHash: receiver, agents: shop });
    expect(await dispatcher.remindUncollected()).toBe(0);
  });
});

/**
 * Where a notification actually LANDS when somebody taps it.
 *
 * Found by walking the built site rather than by a failing test, because nothing here could fail: a
 * notification link is a string, and a string is always a valid string. The final notice shipped with
 * link: '/parcel/PUD-1', which the push service worker resolves against the app's scope to
 * /send/parcel/PUD-1 — a path that does not exist in a build where each app is one index.html. The one
 * notification in this network that asks a person to make a decision opened a 404.
 *
 * THE RULE: a deep link is a QUERY on the app root, never a path segment. '/' means this app's home and
 * '/?x=y' means home with something selected; anything else is a page the build does not contain. The
 * driver's offer link had always been the right shape — the new one simply did not copy it.
 */
describe('NotificationDispatcher — a dispute is decided, and the people it concerns are told', () => {
  const people = { 'hash-rx': { personDid: 'did:person:rx' }, 'hash-tx': { personDid: 'did:person:tx' } };
  const walkUp = { receiverPhoneHash: 'hash-rx', senderPhoneHash: 'hash-tx', binSlot: 'Amber-2' };
  const decided = (over: Record<string, unknown>) => ({ parcelId: 'P1', decision: 'upheld', award: 40, currency: 'KES', note: 'It broke in our hands.', origin: 'buyer', raisedBy: 'did:person:rx', ...over });

  it('tells the receiver how their report ended, with the reason as it was written', async () => {
    const { events, notifications } = harness({ parcel: walkUp, personByHash: people });
    await events.publish(GlosEvent.Pudo.ParcelDisputeDecided, decided({}));
    const told = notifications.inboxFor('did:person:rx');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: 'claim_decided', title: 'Your report on parcel P1 was upheld', body: 'It broke in our hands.', data: { parcelId: 'P1' } });
  });

  it('tells a walk-up sender what is owed to them, in a named money', async () => {
    const { events, notifications } = harness({ parcel: walkUp, personByHash: people });
    await events.publish(GlosEvent.Pudo.ParcelDisputeDecided, decided({ decision: 'partly_upheld', award: 12.5 }));
    const told = notifications.inboxFor('did:person:tx');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: 'claim_decided', title: 'The report on parcel P1 was upheld in part', body: 'It broke in our hands. 12.50 KES is owed to you for it.' });
    expect(notifications.inboxFor('did:person:rx')[0].title).toBe('Your report on parcel P1 was upheld in part');
  });

  it('promises the sender nothing when the store was paid, when nothing was awarded, or when the money has no name', async () => {
    const body = async (parcel: Record<string, unknown>, over: Record<string, unknown>) => {
      const { events, notifications } = harness({ parcel, personByHash: people });
      await events.publish(GlosEvent.Pudo.ParcelDisputeDecided, decided(over));
      return notifications.inboxFor('did:person:tx')[0];
    };
    // A store sold the shipment: the award went to the store's float, not to whoever the store names as sender.
    expect((await body({ ...walkUp, vendorId: 'ven_1' }, {})).body).toBe('It broke in our hands.');
    expect(await body(walkUp, { decision: 'rejected', award: 0, currency: undefined, note: 'No damage is visible.' })).toMatchObject({ title: 'The report on parcel P1 was not upheld', body: 'No damage is visible.' });
    // An amount without a currency is not a sentence anybody should be sent ("40.00  is owed to you").
    expect((await body(walkUp, { currency: undefined })).body).toBe('It broke in our hands.');
  });

  it('tells the shop that raised it at its counter, with the slot the parcel is still standing in', async () => {
    const { events, notifications } = harness({ parcel: walkUp, personByHash: people });
    await events.publish(GlosEvent.Pudo.ParcelDisputeDecided, decided({ decision: 'rejected', award: 0, currency: undefined, note: 'The wrap is torn, the contents are whole.', origin: 'counter', raisedBy: 'did:agent:9' }));
    const told = notifications.inboxFor('did:agent:9');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: 'claim_decided', title: 'The dispute on parcel P1 was decided', body: 'It was not upheld. The wrap is torn, the contents are whole. It is on your shelf at Amber-2, to be handed over as any parcel.' });
    // The two people on the parcel hear of it as well — and the receiver is not told it was THEIR report: the shop
    // raised it, perhaps before they had ever come for the parcel.
    expect(notifications.inboxFor('did:person:rx').map((n) => n.title)).toEqual(['The report on parcel P1 was not upheld']);
    expect(notifications.inboxFor('did:person:tx').map((n) => n.title)).toEqual(['The report on parcel P1 was not upheld']);
  });

  it('does not tell a shop about a report a person filed from their own app, and tells one person once when they sent it to themselves', async () => {
    const { events, notifications } = harness({ parcel: { receiverPhoneHash: 'hash-rx', senderPhoneHash: 'hash-rx' }, personByHash: people });
    await events.publish(GlosEvent.Pudo.ParcelDisputeDecided, decided({}));
    const told = notifications.inboxFor('did:person:rx');
    expect(told.map((n) => n.title)).toEqual(['Your report on parcel P1 was upheld']);
  });

  it('tells the SENDER when the receiver adds a note to the report after handover — the receiver who wrote it, nobody; the same person on both ends, nobody', async () => {
    const both = harness({ parcel: walkUp, personByHash: people });
    await both.events.publish(GlosEvent.Pudo.DamageReportNoted, { parcelId: 'P1', number: 'DCR-P1', at: '2026-10-16T09:30:00.000Z' });
    expect(both.notifications.inboxFor('did:person:tx')).toEqual([expect.objectContaining({ kind: 'claim_decided', title: 'The receiver added a note to the report on parcel P1', data: { parcelId: 'P1' } })]);
    expect(both.notifications.inboxFor('did:person:tx')[0].body).not.toMatch(/upheld|decided/);
    expect(both.notifications.inboxFor('did:person:rx')).toEqual([]);
    const self = harness({ parcel: { receiverPhoneHash: 'hash-rx', senderPhoneHash: 'hash-rx' }, personByHash: people });
    await self.events.publish(GlosEvent.Pudo.DamageReportNoted, { parcelId: 'P1', number: 'DCR-P1', at: '2026-10-16T09:30:00.000Z' });
    expect(self.notifications.inboxFor('did:person:rx')).toEqual([]);
  });

  it('where nobody of ours decides it: the receiver is told where the report is, the sender who holds it, the shop that its parcel can go', async () => {
    const made = (over: Record<string, unknown>) => decided({ decision: 'report_only', award: 0, currency: undefined, note: 'No company of the network decides a claim on this parcel or pays one.', ...over });
    // Reported by the receiver, from their own app.
    const mine = harness({ parcel: walkUp, personByHash: people });
    await mine.events.publish(GlosEvent.Pudo.ParcelDisputeDecided, made({}));
    expect(mine.notifications.inboxFor('did:person:rx')).toEqual([expect.objectContaining({ kind: 'claim_decided', title: 'A damage claim report was made for parcel P1', body: 'It holds the record of who held your parcel, and the photographs. Open the parcel to read it, or to pass it to an insurer.', data: { parcelId: 'P1' } })]);
    expect(mine.notifications.inboxFor('did:person:tx')).toEqual([expect.objectContaining({ title: 'A problem was reported on parcel P1', body: 'A damage claim report was made. A copy is yours: open the parcel in your app to read it, keep the file, or pass it to an insurer.' })]);
    // Nothing in either says "upheld" or "not upheld": nobody judged anything.
    const words = [...mine.notifications.inboxFor('did:person:rx'), ...mine.notifications.inboxFor('did:person:tx')].map((n) => `${n.title} ${n.body}`).join(' ');
    expect(words).not.toMatch(/upheld|decided|owed/);

    // Reported by the shop, at its counter: the receiver may not have been there, and the parcel can still be collected.
    const counter = harness({ parcel: walkUp, personByHash: people });
    await counter.events.publish(GlosEvent.Pudo.ParcelDisputeDecided, made({ origin: 'counter', raisedBy: 'did:agent:9' }));
    expect(counter.notifications.inboxFor('did:person:rx')).toEqual([expect.objectContaining({ title: 'The shop reported a problem with parcel P1', body: 'A damage claim report was made, and it is on the parcel in your app. The parcel can still be collected.' })]);
    expect(counter.notifications.inboxFor('did:agent:9')).toEqual([expect.objectContaining({ kind: 'claim_decided', title: 'The damage claim report for parcel P1 is made', body: 'The receiver has it in their app. It is on your shelf at Amber-2, and can be handed over as any parcel.' })]);
    // A report somebody filed from their app is not answered to a shop, and one person on both ends is told once.
    const self = harness({ parcel: { receiverPhoneHash: 'hash-rx', senderPhoneHash: 'hash-rx' }, personByHash: people });
    await self.events.publish(GlosEvent.Pudo.ParcelDisputeDecided, made({}));
    expect(self.notifications.inboxFor('did:person:rx').map((n) => n.title)).toEqual(['A damage claim report was made for parcel P1']);
  });

  it('is silent, without throwing into the bus, when nobody on the parcel has an account or the parcel is gone', async () => {
    const none = harness({ parcel: walkUp, personByHash: {} });
    await expect(none.events.publish(GlosEvent.Pudo.ParcelDisputeDecided, decided({}))).resolves.not.toThrow();
    expect([...none.notifications.inboxFor('did:person:rx'), ...none.notifications.inboxFor('did:person:tx')]).toEqual([]);
    const gone = harness({ parcel: null });
    await expect(gone.events.publish(GlosEvent.Pudo.ParcelDisputeDecided, decided({}))).resolves.not.toThrow();
  });
});

describe('NotificationDispatcher — a freight claim that nobody of ours decides', () => {
  it('tells the claimant where the report is, and nothing about an outcome', async () => {
    const { events, notifications } = harness({});
    await events.publish(GlosEvent.Pudo.FreightClaimDecided, { freightId: 'f1', code: 'FRT-9', decision: 'report_only', award: 0, note: 'No company of the network decides a claim on this load or pays one.', posterDid: 'did:shop:p', claimantDid: 'did:shop:p' });
    const told = notifications.inboxFor('did:shop:p');
    expect(told).toEqual([expect.objectContaining({ kind: 'claim_decided', title: 'A damage claim report was made for FRT-9', body: 'Nobody of the network decides it or pays. The consignment note, frozen with your claim on it, is the report: open the load to read it, and to pass it on by a link to the carrier or an insurer.' })]);
    expect(`${told[0].title} ${told[0].body}`).not.toMatch(/upheld|rejected|credited/);
    // A decision a company that stated cover made is still told as one.
    await events.publish(GlosEvent.Pudo.FreightClaimDecided, { freightId: 'f2', code: 'FRT-10', decision: 'partly_upheld', award: 120, note: 'Two boxes short of the manifest', posterDid: 'did:shop:p', claimantDid: 'did:shop:p' });
    expect(notifications.inboxFor('did:shop:p').map((n) => n.title)).toEqual(['Your claim on FRT-10 was upheld in part', 'A damage claim report was made for FRT-9']);
  });
});

describe('notification deep links resolve to a page that exists', () => {
  const rx = { 'hash-rx': { personDid: 'did:person:rx' } };
  const store = { 'did:agent:9': { shopName: "Mama Sarah's" } };
  const shelfParcel = {
    parcelId: 'PUD-1',
    receiverPhoneHash: 'hash-rx',
    destAgentDid: 'did:agent:9',
    destZone: 'Westlands',
  };

  it('sends the final notice somewhere the send app can actually open', async () => {
    const { notifications, dispatcher } = harness({
      parcel: shelfParcel,
      personByHash: rx,
      agents: store,
      unclaimedSweep: () => [{ parcelId: 'PUD-1' }],
    });
    await dispatcher.sweepShelf();

    // By its payload rather than its tag: the durable inbox record deliberately drops `tag`, which is a
    // push-collapsing hint for the service worker and not a fact about the notification.
    const notice = notifications.inboxFor('did:person:rx').find((n) => n.data?.parcelId === 'PUD-1');
    expect(notice).toBeDefined();
    // What holding costs is said as money: an amount AND what it is an amount of.
    expect(notice!.body).toContain('Holding now costs KES 0.10 a day');
    // A path segment is the bug. Home, or home with a selection — nothing else is served.
    expect(notice!.link).toBe('/?parcel=PUD-1');
    expect(notice!.link === '/' || notice!.link!.startsWith('/?')).toBe(true);
  });
});

describe('NotificationDispatcher — FP3: the driver whose claimed load was withdrawn', () => {
  it('tells the claiming driver why, with the destination and the reason', async () => {
    const { events, notifications } = harness({});
    await events.publish(GlosEvent.Pudo.FreightCancelled, { freightId: 'frt_9', code: 'FRT-009', driverDid: 'd-amos', reason: 'Customer changed their mind', by: 'shipper', destLabel: 'Riverside Corner' });
    const inbox = notifications.inboxFor('d-amos');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: 'load_cancelled', title: 'Load FRT-009 was cancelled' });
    expect(inbox[0].body).toBe('The sender withdrew FRT-009 to Riverside Corner before pickup: Customer changed their mind. Nothing to collect; your capacity is free again.');
  });

  it('says nothing when nobody had claimed the load', async () => {
    const { events, notifications } = harness({});
    await events.publish(GlosEvent.Pudo.FreightCancelled, { freightId: 'frt_8', code: 'FRT-008', reason: 'No longer needed', by: 'shipper' });
    expect(notifications.inboxFor('d-amos')).toHaveLength(0);
  });
});

describe('NotificationDispatcher — FP3b: the sender whose load could not be delivered, and the claimant whose claim was decided', () => {
  it('tells the sender what happened at the door, and that the driver still has the goods', async () => {
    const { events, notifications } = harness({});
    await events.publish(GlosEvent.Pudo.FreightDeliveryFailed, { freightId: 'frt_7', code: 'FRT-007', posterDid: 'did:shop:p', outcome: 'absent', note: 'Gate locked', destLabel: 'Riverside Corner', attempts: 1 });
    const inbox = notifications.inboxFor('did:shop:p');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: 'freight_problem', title: 'Load FRT-007 could not be delivered' });
    expect(inbox[0].body).toContain('nobody was there to receive it — "Gate locked". The driver still has the goods.');
  });

  it('tells the claimant the decision, the money when there is any, and the reason', async () => {
    const { events, notifications } = harness({});
    await events.publish(GlosEvent.Pudo.FreightClaimDecided, { freightId: 'frt_7', code: 'FRT-007', decision: 'partly_upheld', award: 120, note: 'Two boxes short of the manifest', posterDid: 'did:shop:p', claimantDid: 'ven_1' });
    expect(notifications.inboxFor('ven_1')[0]).toMatchObject({ kind: 'claim_decided', title: 'Your claim on FRT-007 was upheld in part', body: '120.00 is credited to your balance. Two boxes short of the manifest' });
    expect(notifications.inboxFor('did:shop:p')).toHaveLength(0);
  });
});

/**
 * ONBOARDING — the loose end: a shop that registered and heard nothing.
 *
 * The console could see these shops and could even name the missing papers. The applicant, who is the
 * only party able to finish the job, was told nothing at all — so an application that stopped looked
 * from the inside exactly like one that had been submitted and was being reviewed.
 */
describe('NotificationDispatcher — onboarding: the applicant is told what is missing', () => {
  it('names the missing documents the moment they finish registering', async () => {
    const shop: { status: AgentStatus; shopName: string } = { status: 'DRAFT', shopName: 'Yukel Shop' };
    const { events, notifications } = harness({ signups: { 'did:agent:new': shop } });
    await events.publish(GlosEvent.Pudo.AgentRegistered, { did: 'did:agent:new', shopName: 'Yukel Shop' });
    const inbox = notifications.inboxFor('did:agent:new');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: 'signup_incomplete', title: 'Your shop application is not finished' });
    // Named, not counted: "3 missing" is a number somebody has to ring us to decode.
    expect(inbox[0].body).toBe('We still need a copy of your ID, your trading licence and photos of the shop. Nobody is reviewing it until then.');
    // …and it says nobody is reviewing it, which is the thing they had assumed was happening.
  });

  it('says it ONCE per gap, and says it again when the gap changes', async () => {
    const shop: { status: AgentStatus; kyc?: { idCopyRef?: string }; signupNudgedFor?: string } = { status: 'DRAFT' };
    const { events, notifications, dispatcher } = harness({ signups: { 'did:agent:s': shop } });
    await events.publish(GlosEvent.Pudo.AgentRegistered, { did: 'did:agent:s' });
    expect(notifications.inboxFor('did:agent:s')).toHaveLength(1);

    // A sweep over an unchanged gap adds nothing: a notification repeated on a timer is how an inbox
    // becomes a thing people stop reading.
    expect(await dispatcher.sweepSignups()).toBe(0);
    expect(notifications.inboxFor('did:agent:s')).toHaveLength(1);

    // They send the ID. That is progress, so what is LEFT is news again.
    shop.kyc = { idCopyRef: 'med_id' };
    expect(await dispatcher.sweepSignups()).toBe(1);
    const inbox = notifications.inboxFor('did:agent:s');
    expect(inbox).toHaveLength(2);
    expect(inbox[0].body).toBe('We still need your trading licence and photos of the shop. Nobody is reviewing it until then.');
  });

  it('tells a shop that was REJECTED what was wrong with it', async () => {
    const shop: { status: AgentStatus; kycRejection: { reason: string; at: string } } = { status: 'DRAFT', kycRejection: { reason: 'The trading licence had expired.', at: '2026-09-17T10:00:00.000Z' } };
    const { events, notifications } = harness({ signups: { 'did:agent:r': shop } });
    await events.publish(GlosEvent.Pudo.AgentKycRejected, { did: 'did:agent:r', reason: 'The trading licence had expired.' });
    const inbox = notifications.inboxFor('did:agent:r');
    expect(inbox[0]).toMatchObject({ kind: 'signup_rejected', title: 'Your application needs another look' });
    // The REASON travels with the refusal. A rejection they cannot act on leaves them where silence did.
    expect(inbox[0].body).toContain('The trading licence had expired.');
    expect(inbox[0].body).toContain('Send the documents again');
  });

  it('sweeps up everyone who was already stuck before any of this existed', async () => {
    // Nothing happens when a person goes quiet, so no event will ever fire for these two. The sweep is
    // the only shape that fits the absence of an event — the uncollected shelf's reasoning exactly.
    const { notifications, dispatcher } = harness({
      signups: {
        'did:agent:old': { status: 'DRAFT' },
        'did:agent:unfunded': { status: 'APPROVED_UNFUNDED' },
        'did:agent:live': { status: 'ACTIVE' }, // nothing to say to a shop that is simply open
      },
    });
    expect(await dispatcher.sweepSignups()).toBe(2);
    expect(notifications.inboxFor('did:agent:old')).toHaveLength(1);
    expect(notifications.inboxFor('did:agent:unfunded')[0]).toMatchObject({ title: 'One step left to open' });
    expect(notifications.inboxFor('did:agent:live')).toHaveLength(0);
  });

  it('stamps the shop even when the notification cannot be delivered, so no backlog builds up', async () => {
    // The uncollected-reminder rule: a shop that enables notifications next week must not be greeted by
    // a pile of nudges about one gap it has been sitting in all along.
    const shop: { status: AgentStatus; signupNudgedFor?: string } = { status: 'DRAFT' };
    const { dispatcher } = harness({ signups: { 'did:agent:q': shop } });
    await dispatcher.sweepSignups();
    expect(shop.signupNudgedFor).toBe('missing:id,licence,photos');
  });
});
