import type { OrderHandedOn } from './fleet-overflow.types';
import type { DriverRostered } from './fleet-roster.service';
import { ITEM_WORDS, type VehicleDefectDecided, type VehicleDefectReported, type VehicleServiceDue } from './vehicle-care.service';
import { CAUSE_WORDS, type VehicleBreakdownResolved, type VehicleBrokeDown, type VehicleLoadsHandedOver } from './vehicle-breakdown.service';
import type { DeliveryTiming, PlanLeftWhy } from './dispatch.types';
import { UNCOLLECTED_H } from './pudo.config';
import { runningLate } from './parcel.service';
import { appUrl } from '../../foundation/mail/mail.templates';
import { MailService } from '../../foundation/mail/mail.service';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { NotificationService } from './notification.service';
import { ParcelService } from './parcel.service';
import { accountFor } from './addressed-to';
import { PersonService } from './person.service';
import { AgentService, signupGapOf } from './agent.service';
import { FleetService, MAX_ON_DUTY_HOURS, MIN_REST_HOURS } from './fleet.service';
import { ToteService } from './tote.service';
import { MdpService } from './mdp.service';
import { DispatchService } from './dispatch.service';
import { haversineKm } from './geo';
import { paperDay } from './papers';
import { GeoPoint } from './pudo.types';
import type { NotificationKind } from './notification.types';
import { FINDING_WORDS, type TamperFinding } from './tamper.types';
import { ROUTE_REASONS, RUN_REASON_SENTENCE, type GiveBackReason, type RunCancelReason } from './departure.types';

/* The payloads the run's events carry, as published in DepartureService and FleetManagerService. */
interface SpaceSold { departureId: string; bookingId: string; managerDid: string; lineName: string; shipperDid: string; description: string; weightKg: number; price: number; currency: string }
interface VehicleChanged { departureId: string; managerDid: string; company: string; lineName: string; fromPlate: string; toPlate: string; fromClass: string; toClass: string; shippers: string[] }
interface FleetChange { driverDid: string; driverName: string; fromManagerDid?: string; toManagerDid: string; toCompany: string }
interface FleetOfferMade { offerId: string; driverDid: string; fleetDid: string; companyName: string; expiresAt: string }
interface FleetOfferClosed { offerId: string; outcome: 'declined' | 'withdrawn'; fleetDid: string; driverDid: string; phoneEnding: string; companyName: string }
interface DriverLeftFleet { driverDid: string; driverName: string; fleetDid: string; companyName: string; reason: 'left' | 'ended' | 'other' | 'own'; note?: string; /** The runs they came off, when it was they who left. */ runs?: string[] }

const OFFER_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "8 Oct" — the day an offer lapses, as a person reads it. */
function offerDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${OFFER_MONTHS[d.getUTCMonth()]}`;
}

/** "on 20 Oct at 07:56 UTC" — a moment on the road, said so that nobody needs to know where the reader is. */
function utcWords(iso: string): string {
  return `on ${offerDay(iso)} at ${iso.slice(11, 16)} UTC`;
}

/** Round 25 — a cold chain broken on the road, as dispatch publishes it (FreightTempBreach). */
interface ColdChainBroken {
  freightId: string;
  code: string;
  driverDid?: string;
  posterDid?: string;
  carrierDid?: string;
  reading?: { celsius: number; at: string; receivedAt?: string; band: { minC: number; maxC: number } };
}

/** Why a fleet took a driver off, in the words the driver is shown — the fleet's own words when it chose to give them. */
function removalSentence(p: Pick<DriverLeftFleet, 'reason' | 'note'>): string {
  if (p.reason === 'left') return 'They say you no longer work for them.';
  if (p.reason === 'ended') return 'They say they ended your contract.';
  return p.note ? `Their reason: “${p.note}”` : '';
}
interface RunCalledOff { departureId: string; company: string; lineName: string; originZone: string; destZone: string; leavesAt: string; shippers: string[]; reason: string; cancelReason?: RunCancelReason; note?: string; alternatives?: number }

/**
 * What a shipper on a called-off run is told — and what to do next depends on what the reason is ABOUT.
 *
 * A breakdown, a missing driver or too little booked is about THIS carrier: other trucks on the route still
 * go, so the shipper is pointed at them, with how many are open. A closed road or border is about the ROUTE:
 * every truck there meets it, so pointing them at another run would send them into the same closure.
 * A run called off before reasons were coded keeps the old sentence.
 */
export function runCalledOffBody(p: RunCalledOff): string {
  const coded = p.cancelReason ? RUN_REASON_SENTENCE[p.cancelReason] : '';
  const words = p.cancelReason ? [coded ? coded.charAt(0).toLowerCase() + coded.slice(1) : '', p.note ? `“${p.note}”` : ''].filter(Boolean).join(' — ') : p.reason;
  const head = `The run you booked space on is not happening${words ? `: ${words}` : ''}.`;
  if (p.cancelReason && ROUTE_REASONS.includes(p.cancelReason)) {
    return `${head} Other trucks on this route meet the same closure — check before you book another run on it.`;
  }
  const others = p.alternatives ? ` ${p.alternatives === 1 ? 'One other run on this route is' : `${p.alternatives} other runs on this route are`} open for booking.` : '';
  return `${head} Your goods were not collected — you will need another truck.${others}`;
}

/** A carrier's accepted plan has an order outside the window its shipper asked for — or, with neither figure, inside it again. */
interface OrderWindowPlanned { freightId: string; code: string; shipperDid: string; fleetName: string; day: string; arrive: string; window?: string; lateMin?: number; earlyMin?: number }

/** A span of minutes as somebody says it: "40 minutes", "1 hour", "2 hours 05 minutes". */
export function spanWords(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  const hours = h === 1 ? '1 hour' : `${h} hours`;
  if (h === 0) return m === 1 ? '1 minute' : `${m} minutes`;
  return m % 60 === 0 ? hours : `${hours} ${String(m % 60).padStart(2, '0')} minutes`;
}

/** A carrier's accepted plan leaves an order on no vehicle (`left`) — or, after that was said, has it on one. */
interface OrderLeftOut { freightId: string; code: string; shipperDid: string; fleetName: string; day: string; left: boolean; why?: PlanLeftWhy; arrive?: string; window?: string }

/** Why a plan left an order out, as a sentence to its shipper. The carrier's reason, without the carrier's own business. */
const LEFT_OUT_BECAUSE: Record<PlanLeftWhy, (day: string) => string> = {
  room: (day) => `Its plan for ${day} has no room for it: the vehicles going out are full, or the day is too short.`,
  fit: (day) => `None of the vehicles in its plan for ${day} can carry it as it was ordered.`,
  heavy: () => 'It is heavier than its largest vehicle carries. It may bring it in several loads, and you are told if it does.',
  place: () => 'The place it goes to has no point on the map, so it could not be planned. A fuller address will help.',
  closed: (day) => `The place it is collected from is closed on ${day} by the loading hours you keep for it. Change those hours under your places, or the day.`,
};

/**
 * Where a handover fell against what was asked, as a sentence to whoever sent the load — or nothing, where there was
 * nothing to hold it against. The day first; then the window. "Inside" is said too: it is the answer a sender wants.
 */
export function againstWhatWasAsked(t: DeliveryTiming | undefined, orderedFor: string | undefined): string {
  if (!t) return '';
  if (t.otherDay === 'late') return ` It was ordered for ${orderedFor ?? 'an earlier day'} and arrived on ${t.day}.`;
  if (t.otherDay === 'early') return ` It was ordered for ${orderedFor ?? 'a later day'} and arrived early, on ${t.day}.`;
  if (!t.window) return '';
  if (t.lateMin) return ` That is ${spanWords(t.lateMin)} after the window you asked for (${t.window}).`;
  if (t.earlyMin) return ` That is ${spanWords(t.earlyMin)} before the window you asked for (${t.window}).`;
  return ` That is inside the window you asked for (${t.window}).`;
}

interface BookingGivenBack { departureId: string; bookingId: string; managerDid: string; company: string; lineName: string; shipperDid: string; kind: 'sold' | 'own'; by: string; description: string; reason?: string; note?: string }

/**
 * The carrier's reason, as the shipper's notification says it. Keyed by the contract's own list so a reason
 * added there without words here is a type error — never a code printed in somebody's notification. `other`
 * says nothing of its own: the carrier's sentence is the reason.
 */
const GIVE_BACK_WORDS: Record<string, string> = {
  vehicle_unavailable: 'the truck is off the road',
  no_driver: 'there is no driver for the run',
  goods_not_as_booked: 'the goods are not what was booked',
  overbooked: 'the space was promised twice',
  other: '',
} satisfies Record<GiveBackReason, string>;
interface RunClaimOpened { departureId: string; bookingId: string; managerDid: string; shipperDid: string; company: string; lineName: string; load: string; kind: string; description: string; amount?: number; currency: string }
interface RunClaimAnswered { departureId: string; bookingId: string; shipperDid: string; managerDid: string; company: string; load: string; answer: 'accepted' | 'refused'; note?: string }
/** Round 35 — held under the tamper protocol, and released (tamper.service.ts). */
interface UnitHeldPayload { unitType: 'load' | 'parcel'; unitId: string; ref: string; finding: TamperFinding; where: string; posterDid?: string }
interface UnitReleasedPayload { unitType: 'load' | 'parcel'; unitId: string; ref: string; code?: string; reason: string; posterDid?: string }
interface FleetPaperChecked { did: string; kind: 'operator_licence' | 'carrier_insurance'; accepted: boolean; expiresAt?: string; reason?: string }
interface LicenceSent { did: string; displayName: string; expiresAt: string; managerDid?: string }
interface DisputeDecided { parcelId: string; decision: 'upheld' | 'partly_upheld' | 'rejected' | 'report_only'; award: number; currency?: string; note: string; origin: 'counter' | 'buyer'; raisedBy: string }
import { UnclaimedService } from './unclaimed.service';
import { VendorService } from './vendor.service';
import { MARKET_SUPPLY_STALE_MIN, NUDGE_COOLDOWN_MIN, NUDGE_MIN_MOVE_KM, UNCOLLECTED_REMINDER_H, UNCOLLECTED_SWEEP_MS } from './pudo.config';
import { HELD_BY_WORDS, type HeldByAuthority } from './load-detention.types';
import { licenceDay } from './shop-licence';

/** A load held by an authority, or let go, as the event says it. */
interface HeldOnTheRoad {
  freightId: string;
  code: string;
  driverDid?: string;
  posterDid?: string;
  carrierDid?: string;
  held?: HeldByAuthority;
}

/** How often to look for somebody who started joining and stopped. */
const SIGNUP_SWEEP_MS = 60 * 60 * 1000;
/** How often the loads that should have arrived are looked at. A shipper learns of a late load within this long. */
const LATE_SWEEP_MS = 10 * 60 * 1000;

/** Where a parcel running late is, in the words of its notice. */
const PARCEL_WHERE: Record<'shop' | 'road' | 'hub', string> = {
  shop: 'It is still at the shop it was handed in at.',
  road: 'It is on its way.',
  hub: 'It is at a sorting hub.',
};

/** How late, as a person says it: hours up to a day, then days. */
function lateWords(hours: number): string {
  if (hours < 24) {
    const h = Math.max(1, Math.round(hours));
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  const d = Math.round(hours / 24);
  return d === 1 ? '1 day' : `${d} days`;
}
/** How often the shift clocks are looked at. A driver hears of the limit within this of passing it. */
const HOURS_SWEEP_MS = 5 * 60 * 1000;

/**
 * The missing documents as a sentence, NAMED rather than counted.
 *
 * "2 missing" is a number the applicant has to ring somebody to decode, which is the opposite of the
 * point — the console already learned this lesson for the staff side of the same list. The last item gets
 * an "and" because this is read by a shopkeeper, not parsed.
 */
function wordsFor(missing: string[]): string {
  const words = missing.map((m) => (m === 'id' ? 'a copy of your ID' : m === 'licence' ? 'your trading licence' : m === 'photos' ? 'photos of the shop' : m));
  if (words.length <= 1) return words[0] ?? 'your documents';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * NotificationDispatcher (N2/N3) — the bridge from the event cascade to a person's devices. It
 * subscribes to domain events and, for each, resolves WHO should hear about it and pushes a real
 * notification (recorded to the inbox + fanned out to their subscribed devices). It is the outbound,
 * consumer-facing sibling of VendorCallbackService (which relays the same milestones to the store).
 *
 * Every handler is best-effort and self-contained: it catches its own errors so a notification failure
 * never throws back into the bus (which would retry/dead-letter the event and disturb other
 * subscribers) — a missed notification must never break the shipment flow that triggered it.
 *
 * Scenarios: the BUYER ("your parcel has arrived"), the DRIVER ("a load is near you" — a ready tote OR a
 * freshly-posted freight), and the PUDO AGENT ("a bus with your parcels is inbound" on arrival, and — at
 * GENESIS — "a parcel is coming in" so the DROP-OFF shop expects a minted vendor order / peer-send).
 */
@Injectable()
export class NotificationDispatcher implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDispatcher.name);

  /** "Near you" radius + a fan-out cap so one tote never pings a whole city of drivers. */
  private static readonly NEARBY_DRIVER_KM = 8;
  private static readonly NEARBY_DRIVER_CAP = 12;

  /**
   * What each driver has already been asked while moving: where they were when we last looked, when we last
   * interrupted them, and which loads they have already been offered. In memory on purpose — this is
   * politeness state, not a record. The worst a restart costs is one driver hearing about one load a second
   * time, which is a far smaller price than persisting chatter.
   */
  private readonly nudges = new Map<string, { at?: GeoPoint; lastPushAt?: number; told: Set<string> }>();

  constructor(
    private readonly events: EventBus,
    private readonly notifications: NotificationService,
    private readonly parcels: ParcelService,
    private readonly persons: PersonService,
    private readonly agents: AgentService,
    private readonly fleet: FleetService,
    private readonly totes: ToteService,
    private readonly mdps: MdpService,
    private readonly dispatch: DispatchService,
    private readonly unclaimed: UnclaimedService,
    private readonly vendors: VendorService,
    /** The buyer's email — the channel that works before they have an account. Optional for the hand-built specs. */
    @Optional() private readonly mail?: MailService,
  ) {}

  /** The uncollected sweep's timer. Self-unref'd: a reminder is never a reason to hold the process open. */
  private uncollectedTimer?: ReturnType<typeof setInterval>;

  /** The stalled-sign-up sweep's timer, self-unref'd for the same reason. */
  private signupTimer?: ReturnType<typeof setInterval>;

  /** The running-late sweep's timer, self-unref'd for the same reason. */
  private lateTimer?: ReturnType<typeof setInterval>;

  /** The hours sweep's timer, self-unref'd for the same reason. */
  private hoursTimer?: ReturnType<typeof setInterval>;

  onApplicationBootstrap(): void {
    // Every other notification here is a REACTION to an event. This one cannot be: nothing happens when a
    // parcel is not collected, which is exactly why nobody was ever told. A sweep is the only shape that
    // fits the absence of an event.
    void this.sweepShelf().catch(() => undefined);
    this.uncollectedTimer = setInterval(() => void this.sweepShelf().catch(() => undefined), UNCOLLECTED_SWEEP_MS);
    this.uncollectedTimer.unref?.();
    // And the same shape for the people who started joining and stopped. Runs at boot so a shop stuck
    // since before any of this existed is told on the next restart rather than never.
    void this.sweepSignups().catch(() => undefined);
    this.signupTimer = setInterval(() => void this.sweepSignups().catch(() => undefined), SIGNUP_SWEEP_MS);
    this.signupTimer.unref?.();
    // And a load that has not arrived: the third absence nobody was told about.
    // …and a parcel past the time it was promised, the same absence on the parcel side.
    const late = () => {
      void this.sweepLate().catch(() => undefined);
      void this.sweepParcelsLate().catch(() => undefined);
    };
    late();
    this.lateTimer = setInterval(late, LATE_SWEEP_MS);
    this.lateTimer.unref?.();
    // And a shift that has run long: nothing HAPPENS when thirteen hours pass, so nothing ever said so.
    void this.sweepHours().catch(() => undefined);
    this.hoursTimer = setInterval(() => void this.sweepHours().catch(() => undefined), HOURS_SWEEP_MS);
    this.hoursTimer.unref?.();
  }

  /**
   * THE DRIVER'S HOURS, SAID BY THE CLOCK.
   *
   * An hour before the shift limit; at the limit — what is still theirs to do, what is not, and when they may start
   * again; and, to a driver who asked, the moment their rest is over. The fleet's office is told when one of its
   * drivers passes the limit, because it is the office that would otherwise go on planning loads for them.
   *
   * What is due is TAKEN from the fleet service, which notes each as said before handing it over: a notice is sent
   * once, however often this runs. Returns how many drivers were told.
   */
  async sweepHours(now: number = Date.now()): Promise<number> {
    let told = 0;
    for (const n of this.fleet.takeHoursNotices(now)) {
      try {
        const rest = MIN_REST_HOURS;
        const limit = MAX_ON_DUTY_HOURS;
        const say =
          n.kind === 'near'
            ? { title: 'Less than an hour until the shift limit', body: `You have been on shift ${n.onDuty} hours; the limit is ${limit}. After that no new load is offered or can be taken. What is already aboard you still deliver.` }
            : n.kind === 'over'
              ? { title: 'You have reached the shift limit', body: `You have been on shift ${n.onDuty} hours; the limit is ${limit}. Deliver what is aboard: no new load is offered or can be taken. Then end your shift and rest. You can start again ${rest} hours after you end it.` }
              : { title: 'Your rest is over', body: `It is ${rest} hours since your last shift ended. You can start a shift again.` };
        await this.notifications.notify(n.driverDid, { kind: 'shift_hours', ...say, link: '/', tag: `hours:${n.kind}:${n.driverDid}` });
        told += 1;
        if (n.kind === 'over' && n.managerDid) {
          await this.notifications.notify(n.managerDid, {
            kind: 'shift_hours',
            title: `${n.driverName} has reached the shift limit`,
            body: `On shift ${n.onDuty} hours${n.plate ? ` with ${n.plate}` : ''}; the limit is ${limit}. They deliver what is aboard and take nothing new, then rest ${rest} hours. Plan no new load for them until they have.`,
            link: '/',
            tag: `hours:over:${n.driverDid}`,
          });
        }
      } catch (err) {
        this.logger.warn(`hours notice failed for ${n.driverDid}: ${(err as Error).message}`);
      }
    }
    return told;
  }

  onModuleDestroy(): void {
    if (this.uncollectedTimer) clearInterval(this.uncollectedTimer);
    if (this.signupTimer) clearInterval(this.signupTimer);
    if (this.lateTimer) clearInterval(this.lateTimer);
    if (this.hoursTimer) clearInterval(this.hoursTimer);
  }

  onModuleInit(): void {
    // Rule 1 (buyer) — a parcel reached its destination PUDO and is ready to collect.
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.InboundCreated, (e) => this.onOrderOnItsWay(e.payload.parcelId));
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelReadyForPickup, (e) =>
      this.onParcelReadyForPickup(e.payload.parcelId),
    );
    // Rule 1b (buyer) — the release secret was burned and an operator rotated it. The buyer is very
    // likely standing at the counter right now, so this is urgent and must NOT collapse onto the
    // parcel-ready notification (a fresh tag), or the one message telling them their code changed
    // would be swallowed by the one they already read.
    this.events.subscribe<{ parcelId: string; quietFor?: string }>(GlosEvent.Pudo.ParcelReleaseCodeReissued, (e) =>
      this.onReleaseCodeReissued(e.payload.parcelId, e.payload.quietFor),
    );
    // Rule 2 (driver) — a tote was published to the claim marketplace; ping active drivers near its pickup.
    this.events.subscribe<{ code: string; weightKg?: number; destination?: string }>(GlosEvent.Pudo.ToteAvailable, (e) =>
      this.onToteAvailable(e.payload),
    );
    // Rule 2b (PUDO agent) — a bag the shop must CLOSE itself is ready to go. The sweep cannot publish a
    // shop bag (it is open on a counter until a human shuts it), so the nudge is the whole mechanism that
    // stops a full bag sitting there all afternoon.
    this.events.subscribe<{ code: string; agentDid?: string; reason?: 'full' | 'max_wait'; destination?: string }>(GlosEvent.Pudo.ToteNeedsSeal, (e) =>
      this.onToteNeedsSeal(e.payload),
    );
    // Rule 2c (driver) — the driver MOVED. Everything else here fires when a load appears; this one fires
    // when the driver does, which is the only way to catch a bag that has been waiting since morning on a
    // road they are driving down now.
    this.events.subscribe<{ driverDid: string; location: GeoPoint }>(GlosEvent.Pudo.DriverMoved, (e) => this.onDriverMoved(e.payload));
    // Rule 3 (PUDO agent) — a bag went onto a bus bound for a PUDO; tell that shop its parcels are inbound.
    this.events.subscribe<{ destinationNodeId?: string; parcels?: number; code?: string }>(GlosEvent.Pudo.BagLoaded, (e) =>
      this.onBagLoaded(e.payload),
    );
    // Rule 4 (PUDO agent, at GENESIS) — a parcel was minted + PAID; tell its DROP-OFF PUDO to expect it.
    // ParcelPaid fires exactly ONCE per vendor parcel (at a paid mint, OR at a settle after a top-up), so
    // this catches both without double-recording; a person's peer-send fires ParcelMinted (cash at the
    // counter, no prepay). Both carry originAgentDid; an unpaid vendor order is silent until it settles.
    this.events.subscribe<{ parcelId: string; originAgentDid?: string }>(GlosEvent.Pudo.ParcelPaid, (e) => this.onMinted(e.payload));
    this.events.subscribe<{ parcelId: string; originAgentDid?: string }>(GlosEvent.Pudo.ParcelMinted, (e) => this.onMinted(e.payload));
    // Rule 5 (driver) — a dedicated-freight load was posted; ping active drivers near its pickup (same
    // live-GPS matching as a ready tote), so a heavy divert reaches a truck at genesis, not only via pull.
    this.events.subscribe<{ freightId: string; destLabel?: string; pickupLocation?: GeoPoint }>(GlosEvent.Pudo.FreightPosted, (e) => this.onFreightPosted(e.payload));
    // FP5 (driver) — their fleet office put a load on them: it is on their list before they looked, so say so.
    this.events.subscribe<{ freightId: string; code: string; driverDid: string; byName?: string; pickupLabel: string; destLabel: string; weightKg: number; earning?: number }>(GlosEvent.Pudo.FreightAssigned, (e) => this.onFreightAssigned(e.payload));
    // FP8 (sender + office) — a driver gave a claimed load back: it is on the market again, and here is why.
    this.events.subscribe<{ freightId: string; code: string; driverName?: string; reason: string; posterDid?: string; managerDid?: string; destLabel?: string }>(GlosEvent.Pudo.FreightHandedBack, (e) => this.onFreightHandedBack(e.payload));
    // FP7 (driver) — the sender changed the instructions on a load they hold: what to do at the door has changed.
    this.events.subscribe<{ freightId: string; code: string; driverDid: string; amended: boolean; text?: string; contactName?: string; contactPhone?: string; deliveryWindow?: string }>(GlosEvent.Pudo.FreightInstructed, (e) => this.onFreightInstructed(e.payload));
    // FP3 (driver) — a load they had claimed was withdrawn by its sender: their day just changed, tell them why.
    this.events.subscribe<{ freightId: string; code: string; driverDid?: string; reason: string; destLabel?: string }>(GlosEvent.Pudo.FreightCancelled, (e) => this.onFreightCancelled(e.payload));
    /*
     * F3/F4 (shippers) — a run they have goods on was called off, or their goods arrived.
     *
     * The first of these is the one that had to exist. A departure could be cancelled with five shippers
     * aboard and nothing reached any of them: the type said in as many words that everybody booked on it
     * has to be told, and nobody was. It is also the worst possible thing to be silent about — a shipper
     * who does not know has not started looking for another truck.
     */
    this.events.subscribe<RunCalledOff>(GlosEvent.Pudo.DepartureCancelled, (e) => this.onDepartureCancelled(e.payload));
    this.events.subscribe<{ departureId: string; company: string; shipperDid: string; kind: 'sold' | 'own'; description: string; destZone: string; receivedBy?: string }>(GlosEvent.Pudo.DepartureDelivered, (e) => this.onDepartureDelivered(e.payload));
    /*
     * THE HALF OF A RUN THAT WAS PUBLISHED AND NEVER DELIVERED.
     *
     * Four of a run's seven events told nobody. A booking was published under a comment promising "the fleet
     * office learns its space went" and nothing listened; a claim was opened on a load and the carrier who
     * has to answer it was not told; the carrier answered and the shipper who raised it was not told; a
     * booking given back reached neither side. Each is a party waiting on the other with no way to know.
     */
    this.events.subscribe<SpaceSold>(GlosEvent.Pudo.DepartureBooked, (e) => this.onSpaceSold(e.payload));
    this.events.subscribe<OrderHandedOn>(GlosEvent.Pudo.OrderHandedOn, (e) => this.onOrderHandedOn(e.payload));
    // An order is coming in several loads — or in one after all. Its shipper placed one order and is told what became of it.
    this.events.subscribe<{ code: string; loads: number; rejoined: boolean; orderKg: number; deliverOn?: string; fleetName: string; shipperDid?: string }>(GlosEvent.Pudo.OrderSplit, (e) => this.onOrderSplit(e.payload));
    // A carrier's accepted plan leaves an order on no vehicle — or has it on one after all. Its shipper is told.
    this.events.subscribe<OrderLeftOut>(GlosEvent.Pudo.OrderLeftOut, (e) => this.onOrderLeftOut(e.payload));
    // A load reached the other end: whoever sent it is told, as the shipper of a run always was.
    this.events.subscribe<{ freightId: string; code: string; posterDid?: string; description?: string; destLabel?: string; receivedBy?: string }>(GlosEvent.Pudo.FreightDelivered, (e) => this.onFreightDelivered(e.payload));
    // A carrier's plan for the day has an order outside the window its shipper asked for — or inside it after all.
    this.events.subscribe<OrderWindowPlanned>(GlosEvent.Pudo.OrderWindowPlanned, (e) => this.onOrderWindowPlanned(e.payload));
    this.events.subscribe<BookingGivenBack>(GlosEvent.Pudo.DepartureBookingCancelled, (e) => this.onBookingGivenBack(e.payload));
    this.events.subscribe<RunClaimOpened>(GlosEvent.Pudo.DepartureClaimOpened, (e) => this.onRunClaimOpened(e.payload));
    this.events.subscribe<RunClaimAnswered>(GlosEvent.Pudo.DepartureClaimAnswered, (e) => this.onRunClaimAnswered(e.payload));
    // A different truck on a run shippers are booked on — said only when what THEY can see (the class) changed.
    this.events.subscribe<VehicleChanged>(GlosEvent.Pudo.DepartureVehicleChanged, (e) => this.onVehicleChanged(e.payload));
    // A driver took a fleet's offer. They said yes; both fleets are told.
    this.events.subscribe<FleetChange>(GlosEvent.Pudo.DriverChangedFleet, (e) => this.onDriverChangedFleet(e.payload));
    // A fleet offered a driver a place — only that driver can answer, so only they hear of it. And the answer back.
    this.events.subscribe<FleetOfferMade>(GlosEvent.Pudo.FleetOfferMade, (e) => this.onFleetOfferMade(e.payload));
    this.events.subscribe<FleetOfferClosed>(GlosEvent.Pudo.FleetOfferClosed, (e) => this.onFleetOfferClosed(e.payload));
    // A fleet took a driver off: the driver learns it, and why, from us — not from a refused shift tomorrow morning.
    this.events.subscribe<DriverLeftFleet>(GlosEvent.Pudo.DriverLeftFleet, (e) => this.onDriverLeftFleet(e.payload));
    // The office chose a vehicle for a driver. It started nothing, so the driver has to hear of it to start.
    this.events.subscribe<{ driverDid: string; plate: string; vehicleClass: string }>(GlosEvent.Pudo.DriverVehicleSuggested, (e) => this.onVehicleSuggested(e.payload));
    // Five wrong PINs for one number: whoever typed them may know it. The owner is the only one who can act.
    this.events.subscribe<{ personDid: string; driverDids: string[] }>(GlosEvent.Pudo.PersonPinLocked, (e) => this.onPinLocked(e.payload));
    // A PIN replaced by a code, or working on a device it never had: said in the app as well as to the inbox.
    this.events.subscribe<{ personDid: string; driverDids: string[]; newDevice?: boolean }>(GlosEvent.Pudo.PersonPinReplaced, (e) =>
      this.onSignInChanged(e.payload, 'pin-replaced', 'Your PIN was replaced', 'Your PIN was replaced with a code sent to your phone number. It now works only on the phone or browser it was replaced on. If it was not you, replace it again straight away: “forgot your PIN” on the sign-in screen.'),
    );
    this.events.subscribe<{ personDid: string; driverDids: string[] }>(GlosEvent.Pudo.PersonDeviceConfirmed, (e) =>
      this.onSignInChanged(e.payload, 'device-confirmed', 'A new phone or browser can use your PIN', 'A code sent to your number was typed on a phone or browser that had not signed in to your account before. Your PIN now works there too. If it was not you, replace your PIN straight away: “forgot your PIN” on the sign-in screen.'),
    );
    // The fleet's own licence or cover: a document it sent was recorded, or turned down with a reason.
    this.events.subscribe<FleetPaperChecked>(GlosEvent.Pudo.FleetPaperChecked, (e) => this.onFleetPaperChecked(e.payload));
    // FP3b (sender) — the driver is at the door and cannot hand over: the sender is the one who can fix it.
    this.events.subscribe<{ freightId: string; code: string; posterDid?: string; outcome: string; note?: string; destLabel?: string; attempts: number }>(GlosEvent.Pudo.FreightDeliveryFailed, (e) => this.onFreightDeliveryFailed(e.payload));
    // Round 15 — a seal on its load found broken on the road: the shipper is told at once.
    this.events.subscribe<{ freightId: string; code: string; posterDid?: string; seal?: { number?: string; broken?: { cause?: string; note?: string } } }>(GlosEvent.Pudo.FreightSealBroken, (e) => this.onFreightSealBroken(e.payload));
    this.events.subscribe<HeldOnTheRoad>(GlosEvent.Pudo.FreightHeld, (e) => this.onFreightHeld(e.payload, false));
    this.events.subscribe<HeldOnTheRoad>(GlosEvent.Pudo.FreightLetGo, (e) => this.onFreightHeld(e.payload, true));
    // Round 35 — its load held under the tamper protocol, and released: the shipper whose goods they are is told both.
    this.events.subscribe<UnitHeldPayload>(GlosEvent.Pudo.UnitHeld, (e) => this.onLoadHeld(e.payload));
    this.events.subscribe<UnitReleasedPayload>(GlosEvent.Pudo.UnitReleased, (e) => this.onLoadReleased(e.payload));
    // Round 25 — its cold chain broken on the road: the shipper and the office of the fleet carrying it are told at once.
    this.events.subscribe<ColdChainBroken>(GlosEvent.Pudo.FreightTempBreach, (e) => this.onColdChainBroken(e.payload));
    // FP3b (claimant) — their claim was decided; they are shown the reason.
    this.events.subscribe<{ freightId: string; code: string; decision: string; award: number; note: string; posterDid?: string; claimantDid?: string }>(GlosEvent.Pudo.FreightClaimDecided, (e) => this.onFreightClaimDecided(e.payload));
    // ONBOARDING (applicant) — they finished the form and are not finished. Told now, while they are still
    // holding the phone; the sweep below is for everyone this event never fired for.
    this.events.subscribe<{ did: string; shopName?: string }>(GlosEvent.Pudo.AgentRegistered, (e) => this.onSignupStalled(e.payload.did));
    // ONBOARDING (applicant) — we looked and said no. A decision they are shown, with its reason.
    this.events.subscribe<{ did: string; reason: string }>(GlosEvent.Pudo.AgentKycRejected, (e) => this.onSignupStalled(e.payload.did));
    // …and the same for a driver, who was left in exactly the same silence.
    this.events.subscribe<{ did: string; reason: string }>(GlosEvent.Pudo.DriverKycRejected, (e) => this.onDriverRefused(e.payload));
    // …and a hub, whose papers staff approved or sent back: the hub is the one waiting, so the hub is told.
    this.events.subscribe<{ did: string; mdpId: string; name: string; approved: boolean; reason?: string }>(GlosEvent.Pudo.HubPapersDecided, (e) => {
      const p = e.payload;
      void this.tell(p.did, {
        kind: 'papers_checked',
        title: p.approved ? `${p.name} is approved` : `${p.name}: your papers were not accepted`,
        body: p.approved ? 'SeeBuyGet has seen your papers. The hub can take bags in and sort from now on.' : `${p.reason ?? 'Something was wrong with them.'} Send them again from the Hub app.`,
        tag: `hub-papers:${p.mdpId}`,
        data: { mdpId: p.mdpId, approved: p.approved },
      });
    });
    this.events.subscribe<{ did: string; approved: boolean; reason?: string; companyName?: string }>(GlosEvent.Pudo.DriverRideAloneDecided, (e) => this.onRideAloneDecided(e.payload));
    // Round 39 — the risk register: a hub, or the fleet running a corridor, is told when where it works is rated anew.
    this.events.subscribe<{ subject: 'corridor' | 'hub'; id: string; threat: string; level: string; from?: string; tell?: { did: string; name: string } }>(GlosEvent.Pudo.RiskRated, (e) => {
      const p = e.payload;
      if (!p.tell) return;
      const threat = p.threat === 'extortion' ? 'roadblock extortion' : p.threat;
      const high = p.subject === 'hub'
        ? 'From now a bag leaves it only on a coded seal, and none is loaded there between 19:00 and 06:00.'
        : 'From now parcels travel on it only in a bag closed on a coded seal, and nothing goes onto it between 19:00 and 06:00.';
      const lowered = p.subject === 'hub' ? 'A bag may leave it on a photograph again, and loading at night is allowed again.' : 'Loose parcels may go onto it again, and at night.';
      void this.tell(p.tell.did, {
        kind: 'risk_rated',
        title: `${p.tell.name} is rated ${p.level} for ${threat}`,
        body: p.level === 'high' ? high : p.from === 'high' ? lowered : 'SeeBuyGet rates the risks where you work, and looks at them again every quarter.',
        tag: `risk:${p.subject}:${p.id}:${p.threat}`,
        data: { subject: p.subject, id: p.id, threat: p.threat, level: p.level },
      });
    });
    // Round 39 — a light courier's ID photo looked at: seen, and their cap grows from now; or sent back, with the reason.
    this.events.subscribe<{ did: string; seen: boolean; reason?: string }>(GlosEvent.Pudo.DriverIdPhotoDecided, (e) => {
      const p = e.payload;
      void this.tell(p.did, {
        kind: 'papers_checked',
        title: p.seen ? 'SeeBuyGet has seen your ID' : 'Your ID photo was not accepted',
        body: p.seen ? 'From now, how many parcels you may carry at once grows with each one you hand on.' : `${p.reason ?? 'Something was wrong with it.'} Send another from the Driver app’s home screen.`,
        tag: `id-photo:${p.did}`,
        data: { seen: p.seen },
      });
    });
    // Round 40 — a shop's trading licence recorded to a new date, or the one it sent sent back with the reason.
    this.events.subscribe<{ did: string; accepted: boolean; expiresAt?: string; reason?: string }>(GlosEvent.Pudo.ShopLicenceChecked, (e) => {
      const p = e.payload;
      void this.tell(p.did, {
        kind: 'papers_checked',
        title: p.accepted ? 'Your trading licence is recorded' : 'Your licence photo was not accepted',
        body: p.accepted ? `SeeBuyGet has your trading licence to ${p.expiresAt ? licenceDay(p.expiresAt) : 'its new date'}.` : `${p.reason ?? 'Something was wrong with it.'} Send another from the Shop app’s home screen.`,
        tag: `shop-licence:${p.did}`,
        data: { accepted: p.accepted },
      });
    });
    this.events.subscribe<DriverRostered>(GlosEvent.Pudo.DriverRostered, (e) => this.onDriverRostered(e.payload));
    this.events.subscribe<VehicleDefectReported>(GlosEvent.Pudo.VehicleDefectReported, (e) => this.onDefectReported(e.payload));
    this.events.subscribe<VehicleDefectDecided>(GlosEvent.Pudo.VehicleDefectDecided, (e) => this.onDefectDecided(e.payload));
    this.events.subscribe<VehicleServiceDue>(GlosEvent.Pudo.VehicleServiceDue, (e) => this.onServiceDue(e.payload));
    this.events.subscribe<VehicleBrokeDown>(GlosEvent.Pudo.VehicleBrokeDown, (e) => this.onVehicleBrokeDown(e.payload));
    // Round 16 — a vehicle standing still away from any stop: its fleet's office is told, to call the driver.
    this.events.subscribe<{ fleetDid?: string; case?: { caseId: string; plate: string; driverName?: string; minutes: number; location: { lat: number; lng: number } } }>(GlosEvent.Pudo.VehicleStandingStill, (e) => {
      const c = e.payload?.case;
      if (!e.payload?.fleetDid || !c) return;
      void this.tell(e.payload.fleetDid, {
        kind: 'vehicle_standstill',
        title: `${c.plate} has stood still for ${c.minutes} minutes${c.driverName ? ` — ${c.driverName}` : ''}`,
        body: `Away from any of its stops, your sites or the network’s hubs, at ${c.location.lat.toFixed(5)}, ${c.location.lng.toFixed(5)}. Call the driver, and say how it was on the dashboard.`,
        tag: `standstill:${c.caseId}`,
        data: { caseId: c.caseId, lat: c.location.lat, lng: c.location.lng },
      });
    });
    // Round 17 — the phone on a shift gone silent: its office is told where it was last heard, to call the driver.
    this.events.subscribe<{ fleetDid?: string; case?: { caseId: string; plate: string; driverName?: string; minutes: number; since: string; location: { lat: number; lng: number } } }>(GlosEvent.Pudo.VehicleGoneSilent, (e) => {
      const c = e.payload?.case;
      if (!e.payload?.fleetDid || !c) return;
      void this.tell(e.payload.fleetDid, {
        kind: 'vehicle_silent',
        title: `${c.plate}: its phone has said nothing for ${c.minutes} minutes${c.driverName ? ` — ${c.driverName}` : ''}`,
        body: `Last heard at ${c.location.lat.toFixed(5)}, ${c.location.lng.toFixed(5)}, away from any of its stops, your sites or the network’s hubs. The app may be closed, or the phone off or out of signal. Call the driver, and say how it was on the dashboard.`,
        tag: `silent:${c.caseId}`,
        data: { caseId: c.caseId, lat: c.location.lat, lng: c.location.lng },
      });
    });
    this.events.subscribe<VehicleBreakdownResolved>(GlosEvent.Pudo.VehicleBreakdownResolved, (e) => this.onBreakdownResolved(e.payload));
    this.events.subscribe<VehicleLoadsHandedOver>(GlosEvent.Pudo.VehicleLoadsHandedOver, (e) => this.onLoadsHandedOver(e.payload));
    // FP4 (courier) — the renewed licence they sent was checked. They sent it and are waiting: either answer.
    this.events.subscribe<{ did: string; accepted: boolean; expiresAt?: string; reason?: string }>(GlosEvent.Pudo.DriverLicenceChecked, (e) => this.onLicenceChecked(e.payload));
    this.events.subscribe<LicenceSent>(GlosEvent.Pudo.DriverLicenceSent, (e) => this.onLicenceSent(e.payload));
    this.events.subscribe<DisputeDecided>(GlosEvent.Pudo.ParcelDisputeDecided, (e) => this.onParcelDisputeDecided(e.payload));
    this.events.subscribe<{ parcelId: string; reason: string }>(GlosEvent.Pudo.ParcelLost, (e) => this.onParcelLost(e.payload.parcelId, 'lost', e.payload.reason));
    this.events.subscribe<{ parcelId: string; note: string }>(GlosEvent.Pudo.ParcelFound, (e) => this.onParcelLost(e.payload.parcelId, 'found', e.payload.note));
    this.events.subscribe<{ parcelId: string; number: string; at: string }>(GlosEvent.Pudo.DamageReportNoted, (e) => this.onDamageReportNoted(e.payload));

    // Retention: the parties hear about it a month before the document goes, not afterwards.
    this.events.subscribe<{ docId: string; number: string; parties: string[]; goesAt: string }>(GlosEvent.Pudo.NoteExpiringSoon, (e) =>
      this.onNoteExpiring(e.payload),
    );
  }


  /**
   * A CONSIGNMENT NOTE IS ABOUT TO GO, and everybody who was a party to it is told while they can still
   * take a copy.
   *
   * The date has been printed on the document since the day it was frozen, which is exactly the kind of
   * thing nobody re-reads eleven months later. A retention period people are not reminded of is a trap,
   * and the one thing that makes deleting somebody's evidence defensible is that they were told in time
   * to keep it. What remains afterwards can confirm a copy they hold is genuine — it cannot give them
   * another one, and the message says so.
   */
  private async onNoteExpiring(payload: { docId: string; number: string; parties: string[]; goesAt: string }): Promise<void> {
    try {
      const goes = payload.goesAt.slice(0, 10);
      await Promise.all(
        (payload.parties ?? []).map((did) =>
          this.notifications.notify(did, {
            kind: 'note_expiring',
            title: `Keep your copy of ${payload.number}`,
            body: `We delete this consignment note on ${goes}. Download it now — afterwards we can confirm a copy you hold is genuine, but we cannot give you another one.`,
            link: '/',
            // One per document, however many times a sweep runs.
            tag: `note-expiring:${payload.docId}`,
            data: { docId: payload.docId, number: payload.number, goesAt: payload.goesAt },
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`note-expiring notify failed for ${payload.docId}: ${(err as Error).message}`);
    }
  }

  private async onLicenceChecked(payload: { did: string; accepted: boolean; expiresAt?: string; reason?: string }): Promise<void> {
    try {
      await this.notifications.notify(payload.did, {
        kind: 'papers_checked',
        title: payload.accepted ? 'Your licence is recorded' : 'Your licence photo was not accepted',
        body: payload.accepted
          ? `Recorded to ${payload.expiresAt ? paperDay(payload.expiresAt) : "its new date"}. You can start a shift.`
          : `${payload.reason} Send a new photo from the app.`,
        link: '/',
        tag: `papers:${payload.did}:checked`,
        data: { did: payload.did },
      });
    } catch (err) {
      this.logger.warn(`licence check notice failed for ${payload.did}: ${(err as Error).message}`);
    }
  }

  /**
   * A DISPUTE ON A PARCEL WAS DECIDED — and each of the people it concerns is told, in their own inbox.
   *
   * The receiver: the outcome and the network's reason — as THEIR report where they filed it from their app,
   * and as "the report" where the shop raised it at its counter, which they may never have heard of. The
   * sender, who paid for the shipment: the same, and — where something was awarded on a parcel no
   * store sold — that it is owed to them. And the shop that raised it at its counter, which is still holding
   * the goods: that the question is answered and the parcel can be handed over again.
   *
   * Nothing here is a text. Each goes to an account, where there is one; a person with no account reads it the
   * day they open the app, because the outcome is on the parcel itself.
   */
  private async onParcelDisputeDecided(p: DisputeDecided): Promise<void> {
    let parcel: ReturnType<ParcelService['get']>;
    try {
      parcel = this.parcels.get(p.parcelId);
    } catch {
      return;
    }
    if (p.decision === 'report_only') return this.onDamageReportMade(p, parcel);
    const outcome = p.decision === 'upheld' ? 'upheld' : p.decision === 'partly_upheld' ? 'upheld in part' : 'not upheld';
    const tag = `dispute:${p.parcelId}:decided`;
    const receiver = accountFor(this.parcels.receiverOf(parcel), this.persons);
    const sender = accountFor(this.parcels.senderOf(parcel), this.persons);
    if (receiver) {
      await this.tell(receiver.personDid, { kind: 'claim_decided', title: `${p.origin === 'buyer' ? 'Your report' : 'The report'} on parcel ${p.parcelId} was ${outcome}`, body: p.note, tag, data: { parcelId: p.parcelId } });
    }
    if (sender && sender.personDid !== receiver?.personDid) {
      // Owed to the sender only where no store sold the shipment: a store's award goes to the store's float.
      const owed = p.award > 0 && p.currency && !parcel.vendorId ? ` ${p.award.toFixed(2)} ${p.currency} is owed to you for it.` : '';
      await this.tell(sender.personDid, { kind: 'claim_decided', title: `The report on parcel ${p.parcelId} was ${outcome}`, body: `${p.note}${owed}`, tag, data: { parcelId: p.parcelId } });
    }
    if (p.origin === 'counter' && p.raisedBy.startsWith('did:')) {
      const slot = parcel.binSlot ? ` It is on your shelf at ${parcel.binSlot}, to be handed over as any parcel.` : '';
      await this.tell(p.raisedBy, { kind: 'claim_decided', title: `The dispute on parcel ${p.parcelId} was decided`, body: `It was ${outcome}. ${p.note}${slot}`, tag, data: { parcelId: p.parcelId } });
    }
  }

  /**
   * LOST, AND FOUND AGAIN (the user, 2026-10-18: staff declare it after a search). Said to the receiver and to a person
   * who sent it — in the app, never a text — and to a store on its webhook. Lost says what staff found and that the
   * damage claim report is theirs to pass on; the network does not judge what the parcel was worth.
   */
  private async onParcelLost(parcelId: string, what: 'lost' | 'found', words: string): Promise<void> {
    let parcel: ReturnType<ParcelService['get']>;
    try {
      parcel = this.parcels.get(parcelId);
    } catch {
      return;
    }
    const sides = parcel.vendorId ? [['receiver', this.parcels.receiverOf(parcel)] as const] : ([['receiver', this.parcels.receiverOf(parcel)], ['sender', this.parcels.senderOf(parcel)]] as const);
    const seen = new Set<string>();
    for (const [side, who] of sides) {
      const person = accountFor(who, this.persons);
      if (!person || seen.has(person.personDid)) continue;
      seen.add(person.personDid);
      const yours = side === 'receiver' ? 'Your parcel' : 'A parcel you sent';
      const said = /[.!?]$/.test(words) ? words : `${words}.`;
      const say =
        what === 'lost'
          ? { kind: 'parcel_lost' as const, title: `${yours} ${parcelId} could not be found`, body: `SeeBuyGet looked for it and declared it lost: ${said} Its damage claim report is yours, to pass to whoever covers it. If it turns up, you are told.` }
          : { kind: 'parcel_found' as const, title: `${yours} ${parcelId} was found`, body: `It had been declared lost, and turned up: ${said} It carries on from where it was.` };
      try {
        await this.notifications.notify(person.personDid, { ...say, link: `/?parcel=${parcelId}`, tag: `parcel-lost:${parcelId}`, data: { parcelId } });
      } catch (err) {
        this.logger.warn(`parcel-${what} notice failed for ${parcelId}: ${(err as Error).message}`);
      }
    }
    if (parcel.vendorId) this.vendors.notify(parcel.vendorId, what === 'lost' ? 'parcel.lost' : 'parcel.found', { parcelId, externalOrderId: parcel.externalOrderId, status: parcel.status, ...(what === 'lost' ? { reason: words } : { note: words }) });
  }

  /**
   * THE RECEIVER ADDED A NOTE to a damage claim report, after handover: the sender is told, because their copy now
   * says more. What the note says is in the report, not in the message — a notice is read on a lock screen.
   */
  private async onDamageReportNoted(p: { parcelId: string; number: string; at: string }): Promise<void> {
    let parcel: ReturnType<ParcelService['get']>;
    try {
      parcel = this.parcels.get(p.parcelId);
    } catch {
      return;
    }
    const receiver = accountFor(this.parcels.receiverOf(parcel), this.persons);
    const sender = accountFor(this.parcels.senderOf(parcel), this.persons);
    if (!sender || sender.personDid === receiver?.personDid) return;
    await this.tell(sender.personDid, {
      kind: 'claim_decided',
      title: `The receiver added a note to the report on parcel ${p.parcelId}`,
      body: 'What they found after it was handed over is on the damage claim report, beside it and dated. Open the parcel in your app to read it.',
      tag: `report-note:${p.parcelId}:${p.at}`,
      data: { parcelId: p.parcelId },
    });
  }

  /**
   * A PROBLEM WAS REPORTED, AND NOBODY OF OURS DECIDES IT: a damage claim report was made instead.
   *
   * The receiver is told where it is — on the parcel in their app, theirs to read and to pass to an insurer. Where
   * the SHOP reported it at its counter they may not have been there, so they are told that too, and that the parcel
   * can still be collected. The sender is told a problem was reported and who holds the report: what the receiver
   * wrote and photographed is the receiver's to show them. And the shop is told its parcel can be handed over.
   */
  private async onDamageReportMade(p: DisputeDecided, parcel: ReturnType<ParcelService['get']>): Promise<void> {
    const tag = `dispute:${p.parcelId}:report`;
    const data = { parcelId: p.parcelId };
    const receiver = accountFor(this.parcels.receiverOf(parcel), this.persons);
    const sender = accountFor(this.parcels.senderOf(parcel), this.persons);
    if (receiver) {
      await this.tell(
        receiver.personDid,
        p.origin === 'buyer'
          ? { kind: 'claim_decided', title: `A damage claim report was made for parcel ${p.parcelId}`, body: 'It holds the record of who held your parcel, and the photographs. Open the parcel to read it, or to pass it to an insurer.', tag, data }
          : { kind: 'claim_decided', title: `The shop reported a problem with parcel ${p.parcelId}`, body: 'A damage claim report was made, and it is on the parcel in your app. The parcel can still be collected.', tag, data },
      );
    }
    if (sender && sender.personDid !== receiver?.personDid) {
      // A copy is theirs too (the user, 2026-10-15): on the parcel in their own app, to read, keep and pass on.
      await this.tell(sender.personDid, { kind: 'claim_decided', title: `A problem was reported on parcel ${p.parcelId}`, body: 'A damage claim report was made. A copy is yours: open the parcel in your app to read it, keep the file, or pass it to an insurer.', tag, data });
    }
    if (p.origin === 'counter' && p.raisedBy.startsWith('did:')) {
      const slot = parcel.binSlot ? ` It is on your shelf at ${parcel.binSlot}, and can be handed over as any parcel.` : '';
      await this.tell(p.raisedBy, { kind: 'claim_decided', title: `The damage claim report for parcel ${p.parcelId} is made`, body: `The receiver has it in their app.${slot}`, tag, data });
    }
  }

  /**
   * A driver sent their renewed licence, and their fleet's office is who reads it. The office is told,
   * because nothing else would bring it to the Drivers tab: the driver is off the road, or about to be,
   * until somebody there opens the card. A courier without a fleet tells nobody here — network staff read
   * a queue that counts what is waiting.
   *
   * Said again when they send a different photograph: the office may have asked for a clearer one, and
   * the date they read may have changed with it. On a phone the newer notice takes the older one's place.
   */
  private async onLicenceSent(p: LicenceSent): Promise<void> {
    if (!p.managerDid) return;
    await this.tell(p.managerDid, {
      kind: 'papers_sent',
      title: `${p.displayName} sent their renewed licence`,
      // Two lines in the bell, and the second is where to go: the long version lost its ending to an ellipsis.
      body: `They read the new expiry as ${paperDay(p.expiresAt)}. Read the card under Drivers.`,
      tag: `papers:${p.did}:card`,
      data: { did: p.did },
    });
  }

  private async onFreightDeliveryFailed(payload: { freightId: string; code: string; posterDid?: string; outcome: string; note?: string; destLabel?: string; attempts: number }): Promise<void> {
    if (!payload.posterDid) return;
    const why = payload.outcome === 'absent' ? 'nobody was there to receive it' : payload.outcome === 'refused' ? 'the receiver refused it' : 'the driver could not reach the place';
    try {
      await this.notifications.notify(payload.posterDid, {
        kind: 'freight_problem',
        title: `Load ${payload.code} could not be delivered`,
        body: `The driver was at ${payload.destLabel ?? 'the destination'} and ${why}${payload.note ? ` — "${payload.note}"` : ''}. The goods are still on the van. Ring the receiver, or message the driver about where to take it.`,
        link: '/',
        tag: `freight:${payload.freightId}:attempt${payload.attempts}`,
        data: { freightId: payload.freightId },
      });
    } catch (err) {
      this.logger.warn(`freight-delivery-failed notify failed for ${payload.freightId}: ${(err as Error).message}`);
    }
  }

  /**
   * ROUND 35 — A LOAD HELD UNDER THE TAMPER PROTOCOL. The shipper owns the goods: what was found, where, and that nobody
   * takes them over or receives them until operations has looked. Never by text, never the name of who found it.
   */
  private async onLoadHeld(payload: UnitHeldPayload): Promise<void> {
    if (payload.unitType !== 'load' || !payload.posterDid) return;
    try {
      await this.notifications.notify(payload.posterDid, {
        kind: 'freight_problem',
        title: `Load ${payload.ref} is held`,
        body: `Found ${payload.where}: ${FINDING_WORDS[payload.finding]}. It was photographed and SeeBuyGet operations has been told; the load does not change hands until operations releases it. What was found is on the consignment note.`,
        link: '/',
        tag: `freight:${payload.unitId}:held`,
        data: { freightId: payload.unitId },
      });
    } catch (err) {
      this.logger.warn(`load-held notify failed for ${payload.unitId}: ${(err as Error).message}`);
    }
  }

  private async onLoadReleased(payload: UnitReleasedPayload): Promise<void> {
    if (payload.unitType !== 'load' || !payload.posterDid) return;
    try {
      await this.notifications.notify(payload.posterDid, {
        kind: 'freight_problem',
        title: `Load ${payload.code ?? payload.ref} is released`,
        body: `SeeBuyGet operations released it: "${payload.reason}". It may change hands again; what was found stays on its consignment note.`,
        link: '/',
        tag: `freight:${payload.unitId}:held`,
        data: { freightId: payload.unitId },
      });
    } catch (err) {
      this.logger.warn(`load-released notify failed for ${payload.unitId}: ${(err as Error).message}`);
    }
  }

  /**
   * A LOAD HELD BY AN AUTHORITY ON THE ROAD, as its driver said — and let go. The shipper owns the goods and the fleet's
   * office can call its driver; each hears who holds it and where, in the driver's words, and when. Never by text.
   */
  private async onFreightHeld(p: HeldOnTheRoad, letGo: boolean): Promise<void> {
    const h = p.held;
    if (!h) return;
    const by = HELD_BY_WORDS[h.by] ?? 'an authority';
    const who = h.who ? ` (${h.who})` : '';
    const title = letGo ? `Load ${p.code} was let go` : `Load ${p.code} is held by ${by}`;
    const late = h.receivedAt && !letGo ? ` The driver said it with no signal; it reached us ${utcWords(h.receivedAt)}.` : '';
    const body = letGo
      ? `It was held by ${by}${who} from ${utcWords(h.since)} until ${utcWords(h.letGoAt ?? h.since)}, as the driver said${h.letGoNote ? ` — "${h.letGoNote}"` : ''}. It is on its way again.`
      : `The driver said ${utcWords(h.since)} that ${by}${who} holds it${h.note ? ` — "${h.note}"` : ''}.${late} SeeBuyGet operations has been told. You are told again when it is let go.`;
    const tag = `freight:${p.freightId}:held`;
    if (p.posterDid) await this.tell(p.posterDid, { kind: 'freight_problem', title, body, tag, data: { freightId: p.freightId } });
    if (p.carrierDid && p.carrierDid !== p.driverDid && p.carrierDid !== p.posterDid) {
      await this.tell(p.carrierDid, { kind: 'freight_problem', title, body: letGo ? body : `${body} Call the driver.`, tag, data: { freightId: p.freightId } });
    }
  }

  private async onFreightSealBroken(payload: { freightId: string; code: string; posterDid?: string; seal?: { number?: string; broken?: { cause?: string; note?: string } } }): Promise<void> {
    if (!payload.posterDid) return;
    const cause = payload.seal?.broken?.cause;
    const how = cause === 'police' ? 'by the police' : cause === 'customs' ? 'by customs' : cause === 'repair' ? 'for a repair on the road' : cause === 'found_broken' ? 'found so by the driver' : 'on the road';
    try {
      await this.notifications.notify(payload.posterDid, {
        kind: 'freight_problem',
        title: `A seal on load ${payload.code} was broken`,
        body: `Seal ${payload.seal?.number ?? ''} was broken ${how}${payload.seal?.broken?.note ? ` — "${payload.seal.broken.note}"` : ''}. The driver photographed it, and any official paper. A copy of the consignment note is kept with it: if anything is missing at delivery, that is what a damage claim report is made from.`,
        link: '/',
        tag: `freight:${payload.freightId}:seal:${payload.seal?.number ?? ''}`,
        data: { freightId: payload.freightId },
      });
    } catch (err) {
      this.logger.warn(`seal-broken notify failed for ${payload.freightId}: ${(err as Error).message}`);
    }
  }

  /**
   * ROUND 25 — A COLD CHAIN BROKEN IS TOLD (the user: "A breach is told"; "The shipper and the fleet"). Until now the
   * breach was a flag in the control tower and a line on the note, and nobody who could act heard of it. The shipper owns
   * the goods and decides whether to take them; the fleet's office can act on the road. Each hears the reading, when it
   * was read — and, read with no signal, that it reached us later and may not be how the load is now. Never by text. An
   * owner-driver is their own carrier and read it themselves: nobody else to tell on that side.
   */
  private async onColdChainBroken(p: ColdChainBroken): Promise<void> {
    const r = p.reading;
    if (!r) return;
    const read = `${r.celsius} °C was read ${utcWords(r.at)}, outside the ${r.band.minC}–${r.band.maxC} °C it must be kept in.`;
    const late = r.receivedAt ? ` The driver read it with no signal, and it reached us ${utcWords(r.receivedAt)}: it may be different now.` : '';
    const title = `The cold chain on load ${p.code} was broken`;
    const tag = `freight:${p.freightId}:cold_chain`;
    if (p.posterDid) {
      await this.tell(p.posterDid, { kind: 'freight_problem', title, body: `${read}${late} The consignment note says so, and a copy of it is kept as it stands now: if the goods cannot be taken at delivery, that is what a damage claim report is made from.`, tag, data: { freightId: p.freightId } });
    }
    if (p.carrierDid && p.carrierDid !== p.driverDid && p.carrierDid !== p.posterDid) {
      await this.tell(p.carrierDid, { kind: 'freight_problem', title, body: `${read}${late} The shipper has been told. Call the driver to check the cooling unit.`, tag, data: { freightId: p.freightId } });
    }
  }

  private async onFreightClaimDecided(payload: { freightId: string; code: string; decision: string; award: number; note: string; posterDid?: string; claimantDid?: string }): Promise<void> {
    const to = payload.claimantDid ?? payload.posterDid;
    if (!to) return;
    // Nobody of ours decided anything: the claimant is told where the report is, and nothing about an outcome.
    const reportOnly = payload.decision === 'report_only';
    const outcome = payload.decision === 'upheld' ? 'upheld' : payload.decision === 'partly_upheld' ? 'upheld in part' : 'rejected';
    try {
      await this.notifications.notify(to, {
        kind: 'claim_decided',
        title: reportOnly ? `A damage claim report was made for ${payload.code}` : `Your claim on ${payload.code} was ${outcome}`,
        body: reportOnly
          ? 'Nobody of the network decides it or pays. The consignment note, frozen with your claim on it, is the report: open the load to read it, and to pass it on by a link to the carrier or an insurer.'
          : `${payload.award > 0 ? `${payload.award.toFixed(2)} is credited to your balance. ` : ''}${payload.note}`,
        link: '/',
        tag: `freight:${payload.freightId}:claim`,
        data: { freightId: payload.freightId },
      });
    } catch (err) {
      this.logger.warn(`freight-claim-decided notify failed for ${payload.freightId}: ${(err as Error).message}`);
    }
  }

  private async onFreightAssigned(payload: { freightId: string; code: string; driverDid: string; byName?: string; pickupLabel: string; destLabel: string; weightKg: number; earning?: number }): Promise<void> {
    try {
      await this.notifications.notify(payload.driverDid, {
        kind: 'load_assigned',
        title: `Load ${payload.code} was put on you`,
        body: `${payload.byName ?? 'Your fleet office'} assigned you ${payload.code}: ${payload.weightKg} kg from ${payload.pickupLabel} to ${payload.destLabel}${payload.earning != null ? ` — you earn ${payload.earning.toFixed(2)}` : ''}. It is under My loads; collect it at the pickup.`,
        link: '/',
        tag: `freight:${payload.freightId}`,
        data: { freightId: payload.freightId },
      });
    } catch (err) {
      this.logger.warn(`freight-assigned notify failed for ${payload.freightId}: ${(err as Error).message}`);
    }
  }

  private async onFreightHandedBack(payload: { freightId: string; code: string; driverName?: string; reason: string; posterDid?: string; managerDid?: string; destLabel?: string }): Promise<void> {
    const body = `${payload.driverName ?? 'The driver'} could not take ${payload.code}${payload.destLabel ? ` to ${payload.destLabel}` : ''}: ${payload.reason}. It is back on the market for another driver; any charge has come back.`;
    for (const to of [payload.posterDid, payload.managerDid].filter((x): x is string => Boolean(x))) {
      try {
        await this.notifications.notify(to, { kind: 'freight_problem', title: `Load ${payload.code} was handed back`, body, link: '/', tag: `freight:${payload.freightId}:handback`, data: { freightId: payload.freightId } });
      } catch (err) {
        this.logger.warn(`freight-handed-back notify failed for ${payload.freightId}: ${(err as Error).message}`);
      }
    }
  }

  private async onFreightInstructed(payload: { freightId: string; code: string; driverDid: string; amended: boolean; text?: string; contactName?: string; contactPhone?: string; deliveryWindow?: string }): Promise<void> {
    const lines = payload.amended
      ? [payload.text]
      : [payload.deliveryWindow ? `Deliver: ${payload.deliveryWindow}` : undefined, payload.contactName || payload.contactPhone ? `Contact: ${[payload.contactName, payload.contactPhone].filter(Boolean).join(', ')}` : undefined, payload.text];
    const body = lines.filter(Boolean).join(' · ') || 'The sender cleared their instructions.';
    try {
      await this.notifications.notify(payload.driverDid, {
        kind: 'load_instructions',
        title: payload.amended ? `New instruction for ${payload.code}` : `Instructions for ${payload.code} changed`,
        body,
        link: '/',
        tag: `freight:${payload.freightId}:instructions`,
        data: { freightId: payload.freightId },
      });
    } catch (err) {
      this.logger.warn(`freight-instructed notify failed for ${payload.freightId}: ${(err as Error).message}`);
    }
  }

  private async onFreightCancelled(payload: { freightId: string; code: string; driverDid?: string; reason: string; destLabel?: string }): Promise<void> {
    if (!payload.driverDid) return;
    try {
      await this.notifications.notify(payload.driverDid, {
        kind: 'load_cancelled',
        title: `Load ${payload.code} was cancelled`,
        body: `The sender withdrew ${payload.code}${payload.destLabel ? ` to ${payload.destLabel}` : ''} before pickup: ${payload.reason}. Nothing to collect; your capacity is free again.`,
        link: '/',
        tag: `freight:${payload.freightId}`,
        data: { freightId: payload.freightId },
      });
    } catch (err) {
      this.logger.warn(`freight-cancelled notify failed for ${payload.freightId}: ${(err as Error).message}`);
    }
  }

  /**
   * A run somebody's goods were on is not happening.
   *
   * Every shipper aboard, each once — the event already de-duplicates them and leaves the fleet's own
   * customers out, because the fleet is the one doing the telling. THE REASON IS IN THE BODY and is the
   * only part they can act on: "the run is off" leaves somebody ringing round for a lorry with nothing
   * to tell the next carrier.
   *
   * One failure does not stop the rest. Five shippers and a bad DID among them must not mean four
   * people never hear.
   */
  private async onDepartureCancelled(payload: RunCalledOff): Promise<void> {
    const body = runCalledOffBody(payload);
    for (const shipperDid of payload.shippers) {
      try {
        await this.notifications.notify(shipperDid, {
          kind: 'load_cancelled',
          title: `${payload.company} called off the ${payload.originZone} → ${payload.destZone} run`,
          body,
          link: '/',
          tag: `departure:${payload.departureId}:cancelled`,
          data: { departureId: payload.departureId },
        });
      } catch (err) {
        this.logger.warn(`departure-cancelled notify failed for ${shipperDid}: ${(err as Error).message}`);
      }
    }
  }

/**
   * P4 — orders moved between a fleet and its partners. Each message says what a planner needs to act on it: how many,
   * how heavy, for which day — and, when a partner gives one back, why.
   */
  /** The shipper of an order its carrier split. An order the carrier's own office typed in has nobody here to tell: its tracking page says it. */
  private async onOrderSplit(p: { code: string; loads: number; rejoined: boolean; orderKg: number; deliverOn?: string; fleetName: string; shipperDid?: string }): Promise<void> {
    if (!p.shipperDid) return;
    const size = p.orderKg >= 1000 ? `${Math.round(p.orderKg / 100) / 10} t` : `${p.orderKg} kg`;
    const when = p.deliverOn ? ` for ${p.deliverOn}` : '';
    const title = p.rejoined ? `${p.fleetName} will bring ${p.code} in one load after all` : `${p.fleetName} will bring ${p.code} in ${p.loads} loads`;
    const body = p.rejoined ? `${size}${when}, in one delivery as you ordered it.` : `${size}${when}. It is more than one vehicle carries, so it comes in ${p.loads} deliveries; each is signed for on its own, and your tracking link shows them all.`;
    await this.tell(p.shipperDid, { kind: 'order_split', title, body, tag: `split:${p.code}:${p.loads}`, data: { loads: p.loads } });
  }

  /**
   * The shipper of an order its carrier planned outside the window it asked for. The words keep a plan a plan: "about",
   * and that the day can be planned again — and say the one thing the shipper can do with it, while there is time.
   */
  private async onOrderWindowPlanned(p: OrderWindowPlanned): Promise<void> {
    const asked = p.window ? `You asked for ${p.window} on ${p.day}.` : `You asked for a delivery window on ${p.day}.`;
    const estimate = 'A plan’s time is an estimate, and the day can still be planned again.';
    const data = { freightId: p.freightId };
    if (p.lateMin) {
      const by = spanWords(p.lateMin);
      await this.tell(p.shipperDid, { kind: 'order_window', title: `${p.fleetName} plans ${p.code} for about ${p.arrive} — ${by} after your window`, body: `${asked} Its plan for that day has ${p.code} at the door about ${p.arrive}, ${by} after that. ${estimate} If this cannot work, speak to ${p.fleetName} now.`, tag: `window:${p.code}:late:${p.lateMin}`, data });
    } else if (p.earlyMin) {
      const by = spanWords(p.earlyMin);
      await this.tell(p.shipperDid, { kind: 'order_window', title: `${p.fleetName} plans ${p.code} for about ${p.arrive} — ${by} before your window`, body: `${asked} Its plan for that day has ${p.code} at the door about ${p.arrive}, ${by} before that: the day does not leave its vehicle room to wait. ${estimate} If this cannot work, speak to ${p.fleetName} now.`, tag: `window:${p.code}:early:${p.earlyMin}`, data });
    } else {
      await this.tell(p.shipperDid, { kind: 'order_window', title: `${p.fleetName} now plans ${p.code} inside your window`, body: `${asked} Its plan for that day now has ${p.code} at the door about ${p.arrive}. ${estimate}`, tag: `window:${p.code}:inside`, data });
    }
  }

  /**
   * The shipper of an order its carrier's accepted plan leaves on no vehicle. It says what the shipper can do with it —
   * speak to the carrier while the day can still be planned again — and nothing about the carrier's drivers or trucks.
   * That it is on a vehicle after all is news about a time, and is said as one.
   */
  private async onOrderLeftOut(p: OrderLeftOut): Promise<void> {
    const data = { freightId: p.freightId };
    if (p.left) {
      const because = LEFT_OUT_BECAUSE[p.why ?? 'room'](p.day);
      await this.tell(p.shipperDid, { kind: 'order_left_out', title: `${p.fleetName} has not put ${p.code} on a vehicle for ${p.day}`, body: `${because} As its plan stands, ${p.code} is on no vehicle. The day can still be planned again: speak to ${p.fleetName} now.`, tag: `left:${p.code}:${p.day}:${p.why}`, data });
    } else if (!p.arrive) {
      // On a vehicle by the office's own hand, or on a trip it had missed: no plan gave it an hour, and none is made up.
      await this.tell(p.shipperDid, { kind: 'order_window', title: `${p.fleetName} now has ${p.code} on a vehicle`, body: `${p.fleetName} has put ${p.code} on a vehicle. There is no planned hour for it; you are told when it is delivered.`, tag: `left:${p.code}:${p.day}:on`, data });
    } else {
      const inside = p.window ? `, inside the window you asked for (${p.window})` : '';
      await this.tell(p.shipperDid, { kind: 'order_window', title: `${p.fleetName} now has ${p.code} on a vehicle for ${p.day}`, body: `Its plan has ${p.code} at the door about ${p.arrive}${inside}. A plan’s time is an estimate, and the day can still be planned again.`, tag: `left:${p.code}:${p.day}:planned`, data });
    }
  }

  /**
   * RUNNING LATE. A load that should have arrived and has not is the absence of an event, so it is swept for: each
   * shipper is told once that its order is on no vehicle on its day, once that the hour its carrier planned has
   * passed, and once more if the whole day goes. On the
   * carrier's own clock — which is why this could not exist before a fleet had one. Answers how many were told.
   */
  async sweepLate(now: number = Date.now()): Promise<number> {
    const due = this.dispatch.takeLateToTell(now);
    for (const l of due) {
      const where = l.status === 'in_transit' ? 'It is on the road.' : l.status === 'claimed' ? 'It is with its driver and has not been collected yet.' : 'It has not gone out yet.';
      const data = { freightId: l.freightId };
      if (l.what === 'unplanned') {
        // The same fact as an order a plan left out, found by the clock instead of by a plan: its day is here.
        await this.tell(l.shipperDid, { kind: 'order_left_out', title: `${l.fleetName} has not put ${l.code} on a vehicle, and it is for today`, body: `${l.code} was ordered for ${l.day}. The day’s work has begun, and ${l.fleetName} has it on no vehicle. Speak to ${l.fleetName} now.`, tag: `left:${l.code}:${l.day}:today`, data });
      } else if (l.what === 'hour') {
        await this.tell(l.shipperDid, { kind: 'order_late', title: `${l.code} is running late`, body: `${l.fleetName} planned to be at the door about ${l.arrive} and has not delivered it. ${where} A plan’s time is an estimate; speak to ${l.fleetName} if you need to know more.`, tag: `late:${l.code}:hour`, data });
      } else {
        await this.tell(l.shipperDid, { kind: 'order_late', title: `${l.code} did not arrive on ${l.day}`, body: `It was ordered for that day, and ${l.fleetName} has not delivered it. ${where} Speak to ${l.fleetName} now.`, tag: `late:${l.code}:day`, data });
      }
    }
    return due.length;
  }

  /**
   * A PARCEL RUNNING LATE (see runningLate). Nothing happens when a parcel does not arrive in time, so a sweep says it:
   * once, to the receiver and to a person who sent it, in the app — never a text (the user, 2026-10-11) — and to a
   * store's systems on its webhook. Stamped even when there is nobody to tell, so somebody who signs up next week is not
   * told about a parcel that was late last week. Answers how many parcels were found late.
   */
  async sweepParcelsLate(now: number = Date.now()): Promise<number> {
    let found = 0;
    for (const status of ['At_PUDO', 'On_Bus', 'At_MDP'] as const) {
      for (const parcel of this.parcels.list({ status })) {
        const late = runningLate(parcel, now);
        if (!late || parcel.lateToldAt) continue;
        parcel.lateToldAt = new Date(now).toISOString();
        found += 1;
        const shop = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? 'the pickup point';
        const ago = lateWords(late.lateHours);
        const where = PARCEL_WHERE[late.where];
        const seen = new Set<string>();
        // A store's order: the buyer is told, and the store hears on its systems. A person's send: both people.
        const sides = parcel.vendorId ? [['receiver', this.parcels.receiverOf(parcel)] as const] : ([['receiver', this.parcels.receiverOf(parcel)], ['sender', this.parcels.senderOf(parcel)]] as const);
        for (const [side, who] of sides) {
          const person = accountFor(who, this.persons);
          if (!person || seen.has(person.personDid)) continue; // a person sending to themselves is told once
          seen.add(person.personDid);
          try {
            await this.notifications.notify(person.personDid, {
              kind: 'parcel_late',
              title: side === 'receiver' ? 'Your parcel is running late' : 'A parcel you sent is running late',
              body: side === 'receiver' ? `It should have been ready at ${shop} about ${ago} ago. ${where} You are told when it is ready to collect.` : `It should have been ready at ${shop} about ${ago} ago. ${where} Its tracking page shows where it is.`,
              link: `/?parcel=${parcel.parcelId}`,
              tag: `parcel-late:${parcel.parcelId}`,
              data: { parcelId: parcel.parcelId },
            });
          } catch (err) {
            this.logger.warn(`parcel-late notice failed for ${parcel.parcelId}: ${(err as Error).message}`);
          }
        }
        if (parcel.vendorId) this.vendors.notify(parcel.vendorId, 'parcel.late', { parcelId: parcel.parcelId, externalOrderId: parcel.externalOrderId, status: parcel.status, promisedAt: late.promisedAt, lateHours: late.lateHours });
      }
    }
    return found;
  }

  /** A load reached the other end. Whoever sent it hears it once, with who signed for it. */
  private async onFreightDelivered(p: { freightId: string; code: string; posterDid?: string; description?: string; destLabel?: string; receivedBy?: string; timing?: DeliveryTiming; orderedFor?: string }): Promise<void> {
    if (!p.posterDid) return;
    const when = p.timing ? ` at ${p.timing.at}` : '';
    const goods = p.description ? `: ${p.description.replace(/\.+$/, '')}` : '';
    await this.tell(p.posterDid, { kind: 'freight_delivered', title: `${p.code} was delivered`, body: `Handed over${when}${p.receivedBy ? ` to ${p.receivedBy}` : ''}${p.destLabel ? ` at ${p.destLabel}` : ''}${goods}.${againstWhatWasAsked(p.timing, p.orderedFor)}`, tag: `freight:${p.freightId}:delivered`, data: { freightId: p.freightId } });
  }

  private async onOrderHandedOn(p: OrderHandedOn): Promise<void> {
    const many = p.count !== 1;
    const what = many ? `${p.count} orders` : (p.code ?? '1 order');
    const size = p.weightKg >= 1000 ? `${Math.round(p.weightKg / 100) / 10} t` : `${p.weightKg} kg`;
    const when = p.days.length === 1 ? `for ${p.days[0]}` : p.days.length ? `for ${p.days[0]} to ${p.days[p.days.length - 1]}` : '';
    const tag = `handon:${p.fromFleetDid}:${p.what}:${p.code ?? p.days.join(',')}`;
    const data = { what: p.what, count: p.count };
    if (p.what === 'offered') {
      for (const to of p.toFleetDids ?? []) {
        await this.tell(to, { kind: 'order_handed_on', title: `${p.fromFleetName} offers you ${many ? what : 'an order'}`, body: `${size} ${when}. Take ${many ? 'them' : 'it'} or leave ${many ? 'them' : 'it'} under Orders — the first fleet to take an order carries it.`, tag, data });
      }
    } else if (p.what === 'withdrawn') {
      for (const to of p.toFleetDids ?? []) {
        await this.tell(to, { kind: 'order_handed_on', title: `${p.fromFleetName} took back an offer`, body: `${what}, ${size} ${when}, is no longer on offer to you.`, tag, data });
      }
    } else if (p.what === 'taken') {
      await this.tell(p.fromFleetDid, { kind: 'order_handed_on', title: `${p.partnerName} took ${what}`, body: `${size} ${when}. It is theirs to plan and carry now; you still see it under Orders.`, tag, data });
    } else if (p.what === 'ran_out') {
      // A partner that was passing an order on cannot put it on the open board: that is the fleet's it was ordered from.
      const next = p.onward ? 'It is still yours to carry — or to give back to the fleet you took it from.' : 'It is back with you without a truck — the open board is the next step.';
      await this.tell(p.fromFleetDid, { kind: 'order_handed_on', title: `No partner took ${what}`, body: `${size} ${when}. ${next}`, tag, data });
    } else if (p.what === 'passed_on') {
      await this.tell(p.fromFleetDid, { kind: 'order_handed_on', title: `${p.viaName} passed ${what} on to ${p.partnerName}`, body: `${size} ${when}. ${p.partnerName} carries ${many ? 'them' : 'it'} now, as you allowed; you still see ${many ? 'them' : 'it'} under Orders.`, tag, data });
    } else if (p.what === 'lapsed') {
      await this.tell(p.fromFleetDid, { kind: 'order_handed_on', title: `${p.partnerName} no longer lets you pass its orders on`, body: `${what}, ${size} ${when}: your offer to your own partners was taken back. ${many ? 'They are' : 'It is'} still yours to carry, or to give back.`, tag, data });
    } else {
      await this.tell(p.fromFleetDid, { kind: 'order_handed_on', title: `${p.partnerName} gave ${what} back`, body: `${size} ${when}. They said: ${p.reason ?? 'no reason given'}. It is back with you without a truck.`, tag, data });
    }
  }

  /** Somebody bought space on the fleet's run. What, how much, and for what — the three things the office plans around. */
  private async onSpaceSold(p: SpaceSold): Promise<void> {
    await this.tell(p.managerDid, {
      kind: 'space_sold',
      title: `Space sold on ${p.lineName}`,
      body: `${p.weightKg} kg — ${p.description}, for ${p.price} ${p.currency}. It is on the run under Runs.`,
      tag: `departure:${p.departureId}:booking:${p.bookingId}`,
      data: { departureId: p.departureId, bookingId: p.bookingId },
    });
  }

  /**
   * A booking was given back — and whoever did NOT do it is told. Never the one who did: they know.
   *
   * A fleet's OWN load is nobody's business but the fleet's. Its "shipper" is the fleet itself, and the
   * customer behind it has no account here; the fleet is the one who tells them.
   */
  private async onBookingGivenBack(p: BookingGivenBack): Promise<void> {
    if (p.kind === 'own') return;
    if (p.by === p.shipperDid) {
      await this.tell(p.managerDid, {
        kind: 'load_cancelled',
        title: `Space given back on ${p.lineName}`,
        body: `The shipper cancelled ${p.description}. That space is for sale again.`,
        tag: `departure:${p.departureId}:booking:${p.bookingId}:cancelled`,
        data: { departureId: p.departureId, bookingId: p.bookingId },
      });
    } else if (p.by === p.managerDid) {
      // The side that used to reach nobody: the carrier took the space back, and the shipper's goods are not
      // going. WITH the carrier's reason — and the next step depends on it: goods that are not what was booked
      // can be booked again as what they are; every other reason means finding another truck.
      const why = GIVE_BACK_WORDS[p.reason ?? ''] ?? '';
      const said = [why, p.note ? `“${p.note}”` : ''].filter(Boolean).join(' — ');
      const next = p.reason === 'goods_not_as_booked' ? 'Book again with what you are actually sending.' : 'Your goods will not travel on that run — you will need another truck.';
      await this.tell(p.shipperDid, {
        kind: 'load_cancelled',
        title: `${p.company} cancelled your booking`,
        body: `${p.company} gave back the space for ${p.description} on ${p.lineName}${said ? `: ${said}` : ''}. ${next}`,
        tag: `departure:${p.departureId}:booking:${p.bookingId}:cancelled`,
        data: { departureId: p.departureId, bookingId: p.bookingId },
      });
    }
  }

  /** A claim was opened on a load the fleet carried. The carrier is the one who has to answer it. */
  private async onRunClaimOpened(p: RunClaimOpened): Promise<void> {
    if (p.shipperDid === p.managerDid) return; // the fleet's own load: nobody here to tell
    const what = p.kind === 'damaged' ? 'Damaged' : p.kind === 'short' ? 'Short — less arrived than was loaded' : 'Not received';
    await this.tell(p.managerDid, {
      kind: 'claim_opened',
      title: `A claim on ${p.load}`,
      body: `${what}: ${p.description}${p.amount != null ? ` — they put it at ${p.amount} ${p.currency}` : ''}. Answer it under Runs: accept it, or refuse it with your reason.`,
      tag: `departure:${p.departureId}:claim:${p.bookingId}`,
      data: { departureId: p.departureId, bookingId: p.bookingId },
    });
  }

  /**
   * The carrier answered. Said as THE CARRIER's answer, because it is: nothing here weighs a claim, and a
   * shipper who read this as our verdict would stop where they should be taking it to the carrier's insurer.
   */
  private async onRunClaimAnswered(p: RunClaimAnswered): Promise<void> {
    if (p.shipperDid === p.managerDid) return;
    await this.tell(p.shipperDid, {
      kind: 'claim_answered',
      title: `${p.company} ${p.answer === 'accepted' ? 'accepted' : 'refused'} your claim`,
      body: `On ${p.load}${p.note ? `: “${p.note}”` : '.'} This is the carrier’s answer, kept with the consignment note — SeeBuyGet does not decide claims.`,
      tag: `departure:${p.departureId}:claim:${p.bookingId}:answered`,
      data: { departureId: p.departureId, bookingId: p.bookingId },
    });
  }

  /**
   * Another truck on the run. A shipper is shown a vehicle's CLASS and never its plate, so a truck swapped for
   * another truck changes nothing they can see and they are not bothered with it; a truck swapped for a van is
   * news about their goods, and they are told.
   */
  private async onVehicleChanged(p: VehicleChanged): Promise<void> {
    if (p.fromClass === p.toClass) return;
    for (const shipperDid of p.shippers) {
      await this.tell(shipperDid, {
        kind: 'load_assigned',
        title: `A different vehicle on ${p.lineName}`,
        body: `${p.company} put another vehicle on the run your goods are booked on: it now goes on a ${p.toClass} instead of a ${p.fromClass}. Your booking stands.`,
        tag: `departure:${p.departureId}:vehicle`,
        data: { departureId: p.departureId },
      });
    }
  }

  /** A document the fleet sent for its own licence or cover was read. Accepted, or not — with the reason. */
  private async onFleetPaperChecked(p: FleetPaperChecked): Promise<void> {
    const paper = p.kind === 'operator_licence' ? 'operator licence' : 'carrier insurance';
    await this.tell(p.did, {
      kind: 'papers_checked',
      title: p.accepted ? `Your ${paper} is recorded` : `Your ${paper} was not accepted`,
      body: p.accepted ? `Recorded to ${p.expiresAt ? paperDay(p.expiresAt) : 'its new date'}.` : `${p.reason ?? ''} Send it again from the dashboard.`.trim(),
      tag: `papers:${p.did}:${p.kind}:checked`,
      data: { kind: p.kind },
    });
  }

  /**
   * A driver said yes to a fleet's offer. The fleet they joined learns who; the fleet they left learns it from us
   * rather than from an empty seat — and is told what it keeps. It is NOT told which fleet they went to: where
   * somebody works next is theirs to say, and a roster change is not a reason to publish it.
   */
  private async onDriverChangedFleet(p: FleetChange): Promise<void> {
    await this.tell(p.toManagerDid, {
      kind: 'roster_changed',
      title: `${p.driverName} joined your fleet`,
      body: `${p.driverName} said yes to your offer and now drives for ${p.toCompany}. Their licence and their past trips came with them — check their papers under Drivers.`,
      tag: `driver:${p.driverDid}:joined`,
      data: { driverDid: p.driverDid },
    });
    if (!p.fromManagerDid) return;
    await this.tell(p.fromManagerDid, {
      kind: 'roster_changed',
      title: `${p.driverName} left your fleet`,
      body: `${p.driverName} now drives for another fleet. Every trip they did for you stays in your records and on your earnings statement.`,
      tag: `driver:${p.driverDid}:left`,
      data: { driverDid: p.driverDid },
    });
  }

  /** A fleet offered this driver a place. Only they can answer, so only they are told — with how long it stays open. */
  private async onFleetOfferMade(p: FleetOfferMade): Promise<void> {
    await this.tell(p.driverDid, {
      kind: 'fleet_offer',
      title: `${p.companyName} offers you a place in their fleet`,
      body: `Open “Your fleet” in the app to say yes or no. The offer is open until ${offerDay(p.expiresAt)}, and nothing changes unless you say yes.`,
      tag: `fleet-offer:${p.offerId}`,
      data: { offerId: p.offerId, fleetDid: p.fleetDid },
    });
  }

  /** The other side of an offer that closed: the fleet hears a "no", the driver hears the offer is gone. */
  private async onFleetOfferClosed(p: FleetOfferClosed): Promise<void> {
    if (p.outcome === 'declined') {
      // By the number the office typed, and no more: until somebody says yes, a number names nobody to a fleet.
      await this.tell(p.fleetDid, {
        kind: 'roster_changed',
        title: `The driver on •••${p.phoneEnding} said no`,
        body: 'They turned down your offer of a place. Nothing changed on your roster.',
        tag: `fleet-offer:${p.offerId}`,
        data: { offerId: p.offerId },
      });
      return;
    }
    await this.tell(p.driverDid, {
      kind: 'fleet_offer',
      title: `${p.companyName} took back its offer`,
      body: 'The place they offered you is no longer open. Nothing changed for you.',
      tag: `fleet-offer:${p.offerId}`,
      data: { offerId: p.offerId },
    });
  }

  /**
   * A fleet took a driver off. The DRIVER is told what happened and why, and what it means — before a refused shift
   * tells them in worse words. The FLEET's inbox records it too: it has several managers, and the others should not
   * learn it from a roster that is one shorter.
   */
  private async onDriverLeftFleet(p: DriverLeftFleet): Promise<void> {
    if (p.reason === 'own') {
      // THE DRIVER LEFT. Nobody took them off, and neither notice says somebody did. The office is told what it now
      // has to do — the runs with nobody on them — because it was not asked and may not be looking.
      const runs = p.runs ?? [];
      const crew = runs.length === 1 ? ` They were on the ${runs[0]} run: it has no driver now.` : runs.length > 1 ? ` They were on ${runs.length} of your runs (${runs.join(', ')}): those have no driver now.` : '';
      await this.tell(p.driverDid, {
        kind: 'roster_changed',
        title: `You left ${p.companyName}`,
        body: 'Your trips, papers and ratings stay yours. To drive again, a fleet has to offer you a place — give its office the phone number you sign in with.',
        tag: `driver:${p.driverDid}:removed`,
        data: { fleetDid: p.fleetDid },
      });
      await this.tell(p.fleetDid, {
        kind: 'roster_changed',
        title: `${p.driverName} left your fleet`,
        body: `${p.driverName} left ${p.companyName} by their own choice.${crew} Every trip they did for you stays in your records and on your earnings statement.`,
        tag: `driver:${p.driverDid}:removed`,
        data: { driverDid: p.driverDid },
      });
      return;
    }
    await this.tell(p.driverDid, {
      kind: 'roster_changed',
      title: `${p.companyName} took you off their fleet`,
      body: `${removalSentence(p)} Your trips, papers and ratings stay yours. To drive again, a fleet has to offer you a place — give its office the phone number you sign in with.`.trim(),
      tag: `driver:${p.driverDid}:removed`,
      data: { fleetDid: p.fleetDid },
    });
    await this.tell(p.fleetDid, {
      kind: 'roster_changed',
      title: `${p.driverName} is off your fleet`,
      body: `${p.driverName} no longer drives for ${p.companyName}. Every trip they did for you stays in your records and on your earnings statement.`,
      tag: `driver:${p.driverDid}:removed`,
      data: { driverDid: p.driverDid },
    });
  }

  /** The office picked the vehicle; the shift is still the driver's to start. Said so they know which one, and that it waits on them. */
  private async onVehicleSuggested(p: { driverDid: string; plate: string; vehicleClass: string }): Promise<void> {
    await this.tell(p.driverDid, {
      kind: 'vehicle_today',
      title: `Your vehicle today: ${p.plate}`,
      body: `Your fleet office put ${p.plate} (${p.vehicleClass}) at the top of your list. Your shift starts when you start it, with your PIN.`,
      tag: `vehicle-today:${p.driverDid}`,
      data: { plate: p.plate },
    });
  }

  /**
   * FIVE WRONG PINS. Whoever typed them may know this person's number — a colleague, say — and the person is the only
   * one who can do anything about it, so they hear it in every inbox they read: their own and each driver record they
   * sign in as. Never a fleet's: a fleet's inbox is shared by its managers, and one person's PIN is nobody else's.
   */
  private async onSignInChanged(p: { personDid: string; driverDids: string[] }, what: string, title: string, body: string): Promise<void> {
    for (const to of [p.personDid, ...p.driverDids]) {
      await this.tell(to, { kind: 'security', title, body, tag: `${what}:${p.personDid}`, data: {} });
    }
  }

  private async onPinLocked(p: { personDid: string; driverDids: string[] }): Promise<void> {
    for (const to of [p.personDid, ...p.driverDids]) {
      await this.tell(to, {
        kind: 'security',
        title: 'Your PIN was locked',
        body: 'Someone typed a wrong PIN five times for your number, so nobody can sign in with it now. To sign in again, verify your phone by code and choose a new PIN. If it was not you, somebody knows your number: choose a PIN they cannot guess.',
        tag: `pin-locked:${p.personDid}`,
        data: {},
      });
    }
  }

  private async tell(to: string, n: { kind: NotificationKind; title: string; body: string; tag: string; data: Record<string, unknown> }): Promise<void> {
    try {
      await this.notifications.notify(to, { ...n, link: '/' });
    } catch (err) {
      this.logger.warn(`${n.kind} notify failed for ${to}: ${(err as Error).message}`);
    }
  }

  /** Their goods reached the other end. The fleet's own customers are not ours to write to. */
  private async onDepartureDelivered(payload: { departureId: string; company: string; shipperDid: string; kind: 'sold' | 'own'; description: string; destZone: string; receivedBy?: string }): Promise<void> {
    if (payload.kind === 'own') return;
    try {
      await this.notifications.notify(payload.shipperDid, {
        kind: 'freight_delivered',
        title: `Delivered in ${payload.destZone}`,
        body: `${payload.company} handed over ${payload.description}${payload.receivedBy ? ` to ${payload.receivedBy}` : ''}.`,
        link: '/',
        tag: `departure:${payload.departureId}:delivered`,
        data: { departureId: payload.departureId },
      });
    } catch (err) {
      this.logger.warn(`departure-delivered notify failed for ${payload.shipperDid}: ${(err as Error).message}`);
    }
  }

  /**
   * The buyer scenario: on ParcelReadyForPickup, tell the RECEIVER their parcel is waiting. The event
   * carries only the parcelId, so we read the parcel for the account it belongs to — or, while it belongs to
   * none, the account on the number it was addressed to — and push. Never the number alone once an account has it:
   * the account may have moved to another number, and somebody else may be on this one.
   * A receiver with no account yet (never signed up) is silently skipped —
   * there is nowhere to push to, and the collection code is still delivered in-app when they sign in.
   */
  /**
   * A store's order has been handed to the network: tell the BUYER by email, if the store gave us one.
   *
   * Before an account exists, email is the one channel we hold ourselves — the alternative is that the buyer hears
   * only what the store's own system tells them. The email invites the sign-in that makes the next message a push.
   */
  private async onOrderOnItsWay(parcelId: string): Promise<void> {
    if (!this.mail) return;
    try {
      const parcel = this.parcels.get(parcelId);
      if (!parcel.buyerEmail || !parcel.vendorId) return;
      let store = 'Your store';
      try {
        store = this.vendors.get(parcel.vendorId).name;
      } catch {
        /* a store that cannot be read is still a store — the email just names it generically */
      }
      await this.mail.send('order-on-its-way', { address: parcel.buyerEmail }, {
        store,
        ...(parcel.externalOrderId ? { orderRef: parcel.externalOrderId } : {}),
        shop: this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? 'the shop you chose',
        trackingUrl: parcel.trackingKey ? `${appUrl('send')}?track=${encodeURIComponent(parcel.trackingKey)}` : appUrl('send'),
      });
    } catch (err) {
      this.logger.warn(`order-on-its-way mail failed for ${parcelId}: ${(err as Error).message}`);
    }
  }

  private async onParcelReadyForPickup(parcelId: string): Promise<void> {
    try {
      const parcel = this.parcels.get(parcelId);
      // The email goes whether or not the buyer has an account: a push can be off, a phone can be flat, and the
      // buyer expected mail from the store's checkout anyway. The code is NOT in it — the Send app is.
      if (this.mail && parcel.buyerEmail) {
        const shop = this.shop(parcel.destAgentDid);
        const since = parcel.readyAt ?? new Date().toISOString();
        void this.mail.send('ready-for-collection', { address: parcel.buyerEmail }, {
          shop: shop?.shopName ?? parcel.destZone ?? 'your pickup point',
          ...(shop?.physicalAddress || shop?.landmark ? { address: shop.physicalAddress ?? shop.landmark } : {}),
          collectBy: new Date(Date.parse(since) + UNCOLLECTED_H * 3_600_000).toISOString(),
          openUrl: `${appUrl('send')}?parcel=${encodeURIComponent(parcel.parcelId)}`,
        });
      }
      const person = accountFor(this.parcels.receiverOf(parcel), this.persons);
      if (!person) return; // no receiver we can name, or one with no account — nothing to push to (they'll see it in-app later)

      const where = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? 'your pickup point';
      await this.notifications.notify(person.personDid, {
        kind: 'parcel_ready',
        title: 'Your parcel has arrived',
        body: `Ready to collect at ${where}.`,
        link: '/',
        // One notification per parcel-ready — a re-published event collapses onto the same one.
        tag: `parcel-ready:${parcelId}`,
        data: { parcelId },
      });
    } catch (err) {
      this.logger.warn(`parcel-ready notify failed for ${parcelId}: ${(err as Error).message}`);
    }
  }

  /**
   * The reminder nobody was getting.
   *
   * A receiver was told once, on a notification tagged so that re-publishing collapses onto the same one.
   * If they were on a bus, or the phone was flat, that was the entire conversation — and the parcel then
   * sat on a shop's shelf holding a slot with nothing in the system aware of it.
   *
   * ONE reminder, not a series. A parcel waiting a day is worth a nudge; an app that nags daily about a
   * parcel is an app somebody turns notifications off for, and then hears nothing about the next one
   * either. Its own tag, deliberately — reusing the arrival tag would collapse onto a notification the
   * receiver has already dismissed, which is the bug this is fixing rather than a way to fix it.
   *
   * Driven by the same sweep that raises the operator flag, so the two cannot drift apart: the reminder
   * fires before the flag, because its whole job is to stop the flag being needed.
   */
  async remindUncollected(now: number = Date.now()): Promise<number> {
    let sent = 0;
    for (const parcel of this.parcels.list({ status: 'Ready_For_Pickup' })) {
      const since = parcel.readyAt;
      if (!since) continue; // written before the fact was stamped — no honest clock to age it from
      if (now - new Date(since).getTime() < UNCOLLECTED_REMINDER_H * 3_600_000) continue;
      if (parcel.uncollectedRemindedAt) continue; // said once
      // "Bring your collection code" to somebody who is not being shown it is a reminder they cannot act on: it waits.
      if (this.parcels.codeHeldUntil(parcel, now)) continue;
      const person = accountFor(this.parcels.receiverOf(parcel), this.persons);
      // Stamped even when there is nobody to tell, so a receiver who signs up next week is not greeted by
      // a reminder about a parcel that has been waiting a fortnight.
      parcel.uncollectedRemindedAt = new Date(now).toISOString();
      if (!person) continue;
      try {
        const where = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? 'your pickup point';
        await this.notifications.notify(person.personDid, {
          kind: 'parcel_ready',
          title: 'Your parcel is still waiting',
          body: `It is at ${where}. Bring your collection code.`,
          link: '/',
          tag: `parcel-waiting:${parcel.parcelId}`,
          data: { parcelId: parcel.parcelId },
        });
        sent += 1;
      } catch (err) {
        this.logger.warn(`uncollected reminder failed for ${parcel.parcelId}: ${(err as Error).message}`);
      }
    }
    return sent;
  }

  /**
   * One pass over the destination shelf: nudge, then close the window on whatever the nudge did not save.
   *
   * ORDER IS THE DESIGN. The reminder runs first and is deliberately earlier (24h against 72h) because
   * its entire job is to stop the second half being needed. Only then does a parcel nobody answered for
   * become 'Unclaimed', and only then is its store asked whether it wants it home.
   */
  /* ------------------------------------------------------------------ onboarding -- */

  /**
   * TELL AN APPLICANT WHAT IS STILL NEEDED — or that we said no, and why.
   *
   * The loose end this closes: a shop that registered and sent nothing sat in DRAFT indefinitely. The
   * console could see it and could even name the missing papers, and the shop was told nothing, so the
   * only party who could finish the job was the only party not informed. Registering and hearing silence
   * reads as "submitted, now wait" — which is why these applications went quiet rather than being
   * abandoned.
   *
   * SAID ONCE PER GAP, stamped against the gap itself (`signupGapOf`). Sending one document changes the
   * gap and earns a fresh message about what is left; ignoring one earns nothing further, because a
   * notification repeated on a timer is how an inbox becomes something people stop reading.
   */
  private async onSignupStalled(did: string): Promise<void> {
    const agent = this.agents.find(did);
    if (!agent) return;
    const gap = signupGapOf(agent);
    if (!gap) return; // nothing to say
    if (agent.signupNudgedFor === gap) return; // already said, about exactly this
    // Stamped BEFORE the send and regardless of whether it lands, the uncollected-reminder rule: a shop
    // that enables notifications next week must not be greeted by a backlog of nudges about one gap.
    agent.signupNudgedFor = gap;

    const rejected = gap.startsWith('rejected:');
    const message = rejected
      ? { kind: 'signup_rejected' as const, title: 'Your application needs another look', body: `${agent.kycRejection?.reason ?? 'Something was wrong with the documents.'} Send the documents again when you have them.` }
      : gap === 'unfunded'
        ? { kind: 'signup_incomplete' as const, title: 'One step left to open', body: 'Your shop is approved. Put the first money into your float and you can start taking parcels.' }
        : { kind: 'signup_incomplete' as const, title: 'Your shop application is not finished', body: `We still need ${wordsFor(gap.slice('missing:'.length).split(','))}. Nobody is reviewing it until then.` };

    try {
      await this.notifications.notify(did, {
        ...message,
        link: '/',
        // Keyed to the GAP, not to the shop: a new gap is a new notification rather than one quietly
        // overwriting the message about the last one.
        tag: `signup:${did}:${gap}`,
        data: { did, gap },
      });
    } catch (err) {
      this.logger.warn(`signup nudge failed for ${did}: ${(err as Error).message}`);
    }
  }

  /**
   * A DRIVER whose papers we refused — told, with the reason, on the event alone.
   *
   * No sweep behind this one: a rejection is an event, so there is no absence to sweep for. A driver who
   * simply never sent papers sits in DRAFT and is the fleet's or their own business, not a queue anybody
   * here is waiting on.
   */
  private async onDriverRefused(payload: { did: string; reason: string }): Promise<void> {
    try {
      await this.notifications.notify(payload.did, {
        kind: 'signup_rejected',
        title: 'Your papers need another look',
        body: `${payload.reason} Send your ID and licence again when you have them.`,
        link: '/',
        tag: `driver-papers:${payload.did}:${Date.now()}`,
        data: { did: payload.did },
      });
    } catch (err) {
      this.logger.warn(`driver refusal notice failed for ${payload.did}: ${(err as Error).message}`);
    }
  }

  /** A defect reported on one of a fleet's vehicles: its office hears, at once — and whether it is off the road. */
  private async onDefectReported(p: VehicleDefectReported): Promise<void> {
    if (!p.fleetDid) return; // a courier's own vehicle: they reported it themselves, and decide it themselves
    const d = p.defect;
    try {
      await this.notifications.notify(p.fleetDid, {
        kind: 'vehicle_defect',
        title: d.safety ? `${p.plate} is off the road: ${ITEM_WORDS[d.item].toLowerCase()} reported unsafe` : `${p.plate}: ${ITEM_WORDS[d.item].toLowerCase()} reported`,
        body: `${d.reportedBy}${d.note ? `: “${d.note}”` : ''}${d.hasPhoto ? ' (with a photo)' : ''}. ${d.safety ? 'No shift starts in it until you mark it fixed, or safe to drive as it is, under Vehicles → Upkeep.' : 'It can still go out; mark it fixed when it is, under Vehicles → Upkeep.'}`,
        link: '/',
        tag: `defect:${d.defectId}`,
        data: { vehicleId: d.vehicleId, defectId: d.defectId },
      });
    } catch (err) {
      this.logger.warn(`defect notice failed for ${d.defectId}: ${(err as Error).message}`);
    }
  }

  /** A fleet's vehicle due for a service soon, or overdue: its office hears — and whether that keeps it off the road. */
  private async onServiceDue(p: VehicleServiceDue): Promise<void> {
    try {
      await this.notifications.notify(p.fleetDid, {
        kind: 'vehicle_service',
        title: p.state === 'overdue' ? `${p.plate}: service overdue${p.offRoad ? ' — off the road' : ''}` : `${p.plate}: service due soon`,
        body: `${p.line}. ${p.offRoad ? 'No shift starts in it until a service is recorded under Vehicles → Upkeep.' : 'Record it under Vehicles → Upkeep once it is done.'}`,
        link: '/',
        tag: `service:${p.vehicleId}`,
        data: { vehicleId: p.vehicleId },
      });
    } catch (err) {
      this.logger.warn(`service notice failed for ${p.vehicleId}: ${(err as Error).message}`);
    }
  }

  /**
   * A VEHICLE BROKE DOWN: its office hears at once, with where. The shippers of what is aboard it, or on its way to be
   * collected by it, hear too — by what they sent, never the plate, which a shipper is not shown.
   */
  private async onVehicleBrokeDown(p: VehicleBrokeDown): Promise<void> {
    const b = p.breakdown;
    if (p.fleetDid) {
      const where = b.location ? `${b.locationFrom === 'phone' ? 'Where the phone was' : 'Last known position'}: ${b.location.lat.toFixed(5)}, ${b.location.lng.toFixed(5)}` : 'No position known';
      const aboard = b.aboard.length ? `${b.aboard.length === 1 ? 'One load' : `${b.aboard.length} loads`} aboard or to collect${b.aboard.some((l) => l.shipperTold) ? ': their shippers have been told' : ''}.` : 'Nothing aboard.';
      const held = b.held.length ? ` ${b.held.length === 1 ? 'One planned order' : `${b.held.length} planned orders`} for today held: plan the day again.` : '';
      await this.tell(p.fleetDid, {
        kind: 'vehicle_breakdown',
        title: `${p.plate} has broken down${b.driverName ? ` — ${b.driverName}` : ''}`,
        body: `${CAUSE_WORDS[b.cause]}: “${b.note}”. ${where}. ${aboard}${held} Say how it ends under Vehicles → Upkeep.`,
        tag: `breakdown:${b.breakdownId}`,
        data: { vehicleId: b.vehicleId, breakdownId: b.breakdownId, ...(b.location ? { lat: b.location.lat, lng: b.location.lng } : {}) },
      });
    }
    // A COURIER broke down with bags or parcels aboard: the couriers on a shift near it hear it, so one can go and take
    // them on (the user, 2026-10-25: "Split by the road"). Said by what there is and how far — never who the parcels are for.
    if (p.toTakeOver && b.location) {
      const what = [p.toTakeOver.bags ? (p.toTakeOver.bags === 1 ? 'one bag' : `${p.toTakeOver.bags} bags`) : '', p.toTakeOver.parcels ? (p.toTakeOver.parcels === 1 ? 'one parcel' : `${p.toTakeOver.parcels} parcels`) : ''].filter(Boolean).join(' and ');
      for (const n of p.nearby ?? []) {
        await this.tell(n.driverDid, {
          kind: 'takeover_nearby',
          title: `A courier broke down ${n.km} km from you`,
          body: `${b.driverName ?? 'They'} ${b.driverName ? 'has' : 'have'} ${what} to take on. Go to them, and take them over with the six digits on their phone: the road that is left is yours, paid when you hand each bag in.`,
          tag: `takeover:${b.breakdownId}`,
          data: { breakdownId: b.breakdownId, lat: b.location.lat, lng: b.location.lng },
        });
      }
    }
    for (const s of p.tell) {
      await this.tell(s.shipperDid, {
        kind: 'freight_problem',
        title: s.kind === 'booking' ? `${s.lineName}: the vehicle carrying your goods broke down` : s.state === 'aboard' ? `Load ${s.label}: the vehicle carrying it broke down` : `Load ${s.label}: the vehicle coming to collect it broke down`,
        body:
          s.kind === 'booking'
            ? `${p.carrier} reported it on the road, ${p.when}, with your goods aboard (${s.label}). Your booking stands; you will be told how they go on.`
            : s.state === 'aboard'
              ? `${p.carrier} reported it on the road, ${p.when}. Your goods are still with the driver; you will be told how they go on.`
              : `${p.carrier} reported it on the road, ${p.when}, before it collected your goods. You will be told when they are collected.`,
        tag: `breakdown:${b.breakdownId}:${s.freightId ?? s.departureId ?? s.label}`,
        data: { breakdownId: b.breakdownId, ...(s.freightId ? { freightId: s.freightId } : {}), ...(s.departureId ? { departureId: s.departureId } : {}) },
      });
    }
  }

  /** How a breakdown ended: the driver who was out in it hears, and so do the shippers of what is still aboard. */
  private async onBreakdownResolved(p: VehicleBreakdownResolved): Promise<void> {
    const b = p.breakdown;
    const back = b.outcome === 'back_on_road';
    const driver = b.driverDid ?? b.reportedByDid;
    if (driver) {
      await this.tell(driver, {
        kind: 'vehicle_breakdown',
        title: back ? `${p.plate} is back on the road` : `${p.plate} is going to the workshop`,
        body: `${b.resolvedBy}: “${b.resolutionNote ?? ''}”.`,
        tag: `breakdown:${b.breakdownId}`,
        data: { vehicleId: b.vehicleId, breakdownId: b.breakdownId },
      });
    }
    for (const s of p.tell) {
      const what = s.kind === 'booking' ? `${s.lineName}:` : `Load ${s.label}:`;
      await this.tell(s.shipperDid, {
        kind: 'freight_problem',
        title: back ? `${what} the vehicle is back on the road` : `${what} the vehicle went to the workshop`,
        body: back
          ? s.state === 'aboard'
            ? 'The vehicle carrying your goods is moving again.'
            : 'The vehicle coming to collect your goods is moving again.'
          : s.state === 'aboard'
            ? `${p.carrier} will move your goods to another vehicle; you will be told when they go on.`
            : `${p.carrier} will send another vehicle to collect your goods.`,
        tag: `breakdown:${b.breakdownId}:${s.freightId ?? s.departureId ?? s.label}:end`,
        data: { breakdownId: b.breakdownId, ...(s.freightId ? { freightId: s.freightId } : {}), ...(s.departureId ? { departureId: s.departureId } : {}) },
      });
    }
  }

  /**
   * A BREAKDOWN'S LOADS TAKEN OVER. The office hears when the drivers did it between them; the driver taking them hears
   * when the office did it, and so does the driver they were with. The shippers of what moved hear their goods are
   * moving again — never by the plate.
   */
  private async onLoadsHandedOver(p: VehicleLoadsHandedOver): Promise<void> {
    const h = p.handover;
    const what = h.loads.join(', ');
    if (!p.fleetDid) {
      // A COURIER's bags and parcels, gone on with another courier: no office to tell. The courier they were with keeps
      // a line of it in their bell — what went, with whom, and that the road they drove is theirs.
      await this.tell(p.fromDriverDid, {
        kind: 'vehicle_breakdown',
        title: `Your bags and parcels went on with ${h.toDriverName}`,
        body: `${what}, taken over at ${p.fromPlate}${h.location ? ` (${h.location.lat.toFixed(5)}, ${h.location.lng.toFixed(5)})` : ''}. The road you drove with each bag is paid to you now; ${h.toDriverName} is paid the rest when they hand it in.`,
        tag: `breakdown:${p.breakdownId}:handover`,
        data: { breakdownId: p.breakdownId },
      });
    } else if (h.proof === 'pass') {
      await this.tell(p.fleetDid, {
        kind: 'vehicle_breakdown',
        title: `${p.fromPlate}'s loads are on ${h.toPlate} now`,
        body: `${h.toDriverName} took them over from ${p.fromDriverName ?? 'the driver'}, with their code: ${what}.`,
        tag: `breakdown:${p.breakdownId}:handover`,
        data: { breakdownId: p.breakdownId, vehicleId: p.toVehicleId },
      });
    } else {
      await this.tell(p.toDriverDid, {
        kind: 'vehicle_breakdown',
        title: `The loads of ${p.fromPlate} are yours now`,
        body: `${h.by} put them on ${h.toPlate}: ${what}.${h.location ? ` ${p.fromPlate} broke down at ${h.location.lat.toFixed(5)}, ${h.location.lng.toFixed(5)}.` : ''}`,
        tag: `breakdown:${p.breakdownId}:handover`,
        data: { breakdownId: p.breakdownId, ...(h.location ? { lat: h.location.lat, lng: h.location.lng } : {}) },
      });
      await this.tell(p.fromDriverDid, {
        kind: 'vehicle_breakdown',
        title: `Your loads went to ${h.toDriverName}`,
        body: `${h.by} moved them from ${p.fromPlate} to ${h.toPlate}: ${what}. Hand them over when ${h.toDriverName} arrives.`,
        tag: `breakdown:${p.breakdownId}:handover`,
        data: { breakdownId: p.breakdownId },
      });
    }
    for (const s of p.tell) {
      await this.tell(s.shipperDid, {
        kind: 'load_assigned',
        title: s.kind === 'booking' ? `${s.lineName}: your goods are moving again` : `Load ${s.label} is moving again`,
        body: `${p.carrier} moved your goods to another of its vehicles after the breakdown${s.state === 'to_collect' ? ': that one will collect them' : ''}.`,
        tag: `breakdown:${p.breakdownId}:${s.freightId ?? s.departureId ?? s.label}:moved`,
        data: { breakdownId: p.breakdownId, ...(s.freightId ? { freightId: s.freightId } : {}), ...(s.departureId ? { departureId: s.departureId } : {}) },
      });
    }
  }

  /** The office's word on a defect: the driver who reported it hears which. */
  private async onDefectDecided(p: VehicleDefectDecided): Promise<void> {
    const d = p.defect;
    if (!d.reportedByDid) return;
    try {
      await this.notifications.notify(d.reportedByDid, {
        kind: 'vehicle_defect',
        title: `${p.plate}: ${ITEM_WORDS[d.item].toLowerCase()} — ${d.status === 'fixed' ? 'fixed' : 'safe to drive as it is'}`,
        body: `${d.decidedBy}: “${d.decisionNote ?? ''}”. You reported it${d.note ? ` (“${d.note}”)` : ''}.`,
        link: '/',
        tag: `defect:${d.defectId}`,
        data: { vehicleId: d.vehicleId, defectId: d.defectId },
      });
    } catch (err) {
      this.logger.warn(`defect decision notice failed for ${d.defectId}: ${(err as Error).message}`);
    }
  }

  /**
   * A day of the driver's changed on their fleet's roster. Said by the day's name, not its number: "Thursday 16 October".
   * Being left off a day starts nothing and stops nothing — a shift can still be started — so it says who to speak to.
   */
  private async onDriverRostered(p: DriverRostered): Promise<void> {
    try {
      const day = new Date(`${p.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      await this.notifications.notify(p.driverDid, {
        kind: 'driver_roster',
        title: p.on ? `${p.fleetName} has you down to drive on ${day}` : `${p.fleetName} no longer has you down to drive on ${day}`,
        body: p.on ? 'Start your shift that day as you always do. Your days are under “Your fleet”.' : 'If you were going to drive that day, speak to your fleet’s office. Your days are under “Your fleet”.',
        link: '/',
        // On the phone a later change to the same day replaces this one; the inbox keeps both, newest first.
        tag: `roster:${p.day}:${p.driverDid}`,
        data: { day: p.day },
      });
    } catch (err) {
      this.logger.warn(`roster notice failed for ${p.driverDid}: ${(err as Error).message}`);
    }
  }

  /**
   * A DRIVER IN NO FLEET ASKED TO RIDE FOR THEMSELVES on something heavy, and staff decided: told either way, on the
   * event. Yes says who they ride for now; no says why, in staff's words, and that they may ask again.
   */
  private async onRideAloneDecided(payload: { did: string; approved: boolean; reason?: string; companyName?: string }): Promise<void> {
    try {
      await this.notifications.notify(payload.did, {
        kind: 'papers_checked',
        title: payload.approved ? 'You ride for yourself now' : 'Your ask to ride for yourself was not approved',
        body: payload.approved
          ? `The network read your ID and licence${payload.companyName ? ` and ${payload.companyName} contracts you directly` : ''}. Your vehicle is on your list: start a shift when you are ready.`
          : `${payload.reason ?? ''} You are still in no fleet: ask again from “Your fleet”, or take a fleet's place when one is offered.`.trim(),
        link: '/',
        tag: `ride-alone:${payload.did}:${Date.now()}`,
        data: { did: payload.did },
      });
    } catch (err) {
      this.logger.warn(`ride-alone notice failed for ${payload.did}: ${(err as Error).message}`);
    }
  }

  /**
   * One pass over everybody who started joining and stopped.
   *
   * The event above cannot cover the ones that matter most: a shop that registered before any of this
   * existed, one that sent two documents of three and drifted, one approved and never funded. Nothing
   * happens when a person goes quiet, and a sweep is the only shape that fits the absence of an event —
   * the same reasoning as the uncollected shelf, and the reason that list existed in the console with
   * nobody having told any of the shops on it.
   */
  async sweepSignups(): Promise<number> {
    let sent = 0;
    for (const row of this.agents.unfinished()) {
      if (row.told) continue;
      const before = this.agents.find(row.did)?.signupNudgedFor;
      await this.onSignupStalled(row.did);
      if (this.agents.find(row.did)?.signupNudgedFor !== before) sent += 1;
    }
    return sent;
  }

  async sweepShelf(now: number = Date.now()): Promise<{ reminded: number; closed: number }> {
    const reminded = await this.remindUncollected(now);
    let closed = 0;
    for (const parcel of this.unclaimed.sweep(now)) {
      closed += 1;
      await this.finalNotice(parcel.parcelId);
    }
    return { reminded, closed };
  }

  /**
   * The last message: your collection window has closed, and here is what you can do about it.
   *
   * It must not read as a threat, because the parcel is not being taken away — it is still on the shelf
   * and their code still opens it. What has changed is that it now costs something to sit there. The
   * FOUR THINGS THEY CAN DO are the substance of this notification; the deep link is what makes the
   * difference between somebody who would have answered and somebody who could not find how.
   *
   * The store is told in the same pass, because the person paying for the outcome should not learn about
   * it from a return offer arriving out of nowhere.
   */
  private async finalNotice(parcelId: string): Promise<void> {
    try {
      const parcel = this.parcels.get(parcelId);
      const where = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? 'your pickup point';
      const person = accountFor(this.parcels.receiverOf(parcel), this.persons);
      // The rate fixed when the free time ended, in the money of the company whose shop holds it.
      const holding = this.parcels.holdingTermsOf(parcel);
      if (person) {
        await this.notifications.notify(person.personDid, {
          kind: 'parcel_ready',
          title: 'Time to collect your parcel',
          body: `It is still at ${where} and still yours. Holding now costs ${holding.currency} ${holding.perDay.toFixed(2)} a day — tell us what you want to do.`,
          // A QUERY, not a path. Each app is a single index.html, so '/parcel/PUD-1' resolves against
          // the SW scope to /send/parcel/PUD-1 — which does not exist, and the one notification that
          // asks somebody to make a decision would open a 404. Same shape as the driver's offer link.
          link: `/?parcel=${parcelId}`,
          // Its own tag: collapsing this onto the reminder would swallow the one message that changes
          // the terms behind one the receiver has already read and dismissed.
          tag: `parcel-unclaimed:${parcelId}`,
          data: { parcelId },
        });
      }
      // The store hears it too — they are about to be asked to pay for a journey home, and finding that
      // out from the offer alone is being handed a bill with no story attached to it.
      if (parcel.vendorId) {
        this.vendors.notify(parcel.vendorId, 'parcel.unclaimed', {
          parcelId,
          externalOrderId: parcel.externalOrderId,
          destAgentDid: parcel.destAgentDid,
          unclaimedAt: parcel.unclaimedAt,
        });
      }
    } catch (err) {
      this.logger.warn(`final notice failed for ${parcelId}: ${(err as Error).message}`);
    }
  }

  /**
   * The reissue scenario: the parcel's release secret was rotated, so the code the receiver is holding
   * no longer works. Push them the new one's existence — the code itself lives in their twin, never in a
   * notification body (a lock-screen preview is readable by anyone holding the phone).
   */
  private async onReleaseCodeReissued(parcelId: string, quietFor?: string): Promise<void> {
    try {
      const parcel = this.parcels.get(parcelId);
      const where = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? 'your pickup point';
      // On a PEER SEND the sender is told as well: they are the relay to a receiver with no app (the same
      // role the store plays on a vendor order), so a rotated code that reached only the receiver would
      // strand exactly the person the relay exists for. A vendor order tells the buyer only — its store
      // gets the new code over the callback instead.
      const targets = parcel.vendorId ? [this.parcels.receiverOf(parcel)] : [this.parcels.receiverOf(parcel), this.parcels.senderOf(parcel)];
      const seen = new Set<string>();
      for (const side of targets) {
        const person = accountFor(side, this.persons);
        if (!person || seen.has(person.personDid)) continue; // a person sending to themselves is told once
        // The code changed BECAUSE this account's number did: it is told by the notice about that, which says when
        // the code shows again — "open the app for the new code" would be untrue for a day.
        if (person.personDid === quietFor) continue;
        seen.add(person.personDid);
        await this.notifications.notify(person.personDid, {
          kind: 'parcel_ready',
          title: 'The pickup code has changed',
          body: `Open the app for the new code — the parcel is at ${where}.`,
          link: '/',
          tag: `parcel-code-reissued:${parcelId}`,
          data: { parcelId },
        });
      }
    } catch (err) {
      this.logger.warn(`code-reissued notify failed for ${parcelId}: ${(err as Error).message}`);
    }
  }

  /** Best-effort human label for a PUDO — its shop name, else undefined (caller falls back to the zone). */
  private shopName(agentDid?: string): string | undefined {
    return this.shop(agentDid)?.shopName;
  }

  private shop(agentDid?: string): { shopName: string; landmark?: string; physicalAddress?: string } | undefined {
    if (!agentDid) return undefined;
    try {
      return this.agents.get(agentDid);
    } catch {
      return undefined;
    }
  }

  /**
   * The driver scenario: a tote was published to the claim marketplace. The event carries only the
   * tote code (no geo), so we read the tote for where it sits, resolve that node's coordinates, and ping
   * the ACTIVE drivers whose LIVE position is within range — the honest "near you", matched on the
   * driver's real GPS, not a declared route. Capped and distance-sorted so one tote never pings a city.
   */
  private async onToteAvailable(payload: { code: string; destination?: string }): Promise<void> {
    try {
      const tote = this.totes.byCodeMaybe(payload.code);
      if (!tote) return;
      const pickup = this.nodeLocation(tote.locationId);
      if (!pickup) return; // the origin isn't a fixed point (on a bus, or unknown) — can't say "near you"

      const nearby = this.nearbyActiveDrivers(pickup);
      if (nearby.length === 0) return;

      const where = tote.destinationLabel ?? payload.destination;
      await Promise.all(
        nearby.map((d) =>
          this.notifications.notify(d.driverDid, {
            kind: 'load_nearby',
            title: 'A load is near you',
            body: where ? `A bag heading to ${where} is ready for pickup nearby.` : 'A bag is ready for pickup nearby.',
            link: '/',
            // One notification per tote per driver — a re-publish collapses onto the same one.
            tag: `load:${tote.code}`,
            data: { code: tote.code },
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`load-nearby notify failed for ${payload.code}: ${(err as Error).message}`);
    }
  }

  /**
   * The moving driver: a load they are about to drive past, offered while they can still act on it.
   *
   * The whole design problem here is restraint. A pop-up that interrupts someone at the wheel earns its place
   * only if it is rare, relevant and answerable in one glance, so four rules stand between a GPS fix and a
   * buzz — and every one of them exists because breaking it turns the feature into the thing drivers switch
   * off, after which they hear nothing at all:
   *   1. they must have actually MOVED (a parked phone's GPS jitters all day);
   *   2. one interruption per cooldown, however much they drive;
   *   3. silence while they already have an unanswered offer — one open question at a time;
   *   4. never the same load twice, even after they ignore it.
   * What survives all four is ONE load (offerNear picks the best), already priced and offered, so the pop-up
   * is a decision and not an advertisement.
   */
  private async onDriverMoved(payload: { driverDid: string; location: GeoPoint }): Promise<void> {
    const { driverDid, location } = payload;
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return;
    try {
      const now = Date.now();
      const seen = this.nudges.get(driverDid) ?? { told: new Set<string>() };
      // 1. Real movement only. The last point is NOT updated when they have barely moved, so a slow crawl
      // still accumulates into a real move rather than being reset to zero on every heartbeat.
      if (seen.at && haversineKm(seen.at, location) < NUDGE_MIN_MOVE_KM) return;
      seen.at = location;
      this.nudges.set(driverDid, seen);
      // 2 + 3. Not too often, and not while they are already deciding something.
      if (seen.lastPushAt && now - seen.lastPushAt < NUDGE_COOLDOWN_MIN * 60_000) return;
      if (this.dispatch.activeOffersFor(driverDid, now).length > 0) return;

      const offer = this.dispatch.offerNear(driverDid, location, now);
      if (!offer) return;
      if (seen.told.has(offer.ref)) return; // 4. asked once, answered or not
      seen.told.add(offer.ref);
      seen.lastPushAt = now;

      // Everything needed to decide, in the two lines a lock screen will actually show: what and where to,
      // how far off the road, what it pays, and where to collect it.
      // The offer's OWN figure for both kinds. This used to fall back to the flat loading fee for a bag,
      // which was true while that was all a bag paid — and became an understatement the moment a bag
      // started earning for the road as well. A lock screen is where somebody agrees to a job; the number
      // on it has to be the number they get.
      // In the money of the company that settles this driver; and where the offer carries no figure at all, the
      // one thing certain: what scanning a bag aboard pays there.
      const terms = this.dispatch.driverPayTerms(driverDid);
      const earn = `${terms.currency} ${(offer.earn ?? offer.price?.total ?? terms.bagLoadPay).toFixed(2)}`;
      const what = offer.kind === 'tote' ? 'Bag' : 'Load';
      // What it costs, in the unit a driver spends. Kilometres are an abstraction at the wheel — and a
      // driver carrying passengers cannot justify eight kilometres to a bus, while "six minutes" is a
      // sentence everybody aboard understands. Two figures because they are two different commitments: the
      // detour to go and get it, and the time that carrying it then costs on top.
      const cost =
        offer.collectMin == null
          ? `${offer.minutesAway} min away` // an offer minted before the time figures existed
          : offer.deliverMin != null
            ? `+${offer.collectMin} min to collect · +${offer.deliverMin} min to drop`
            : `+${offer.collectMin} min to collect`; // a destination we could not place — say less, not more
      await this.notifications.notify(driverDid, {
        kind: 'load_nearby',
        title: `${what} to ${offer.destLabel} · you earn ${earn}`,
        body: `${cost}\n${offer.weightKg} kg · waiting at ${offer.pickupLabel}`,
        link: `/?offer=${offer.offerId}`, // one tap → that one card, with the claim button on it
        tag: `load:${offer.ref}`,
        // Two buttons is what a phone gives us, and two is what the decision has. "Not now" carries a
        // one-shot capability so the service worker can free the load without holding the driver's session.
        actions: [
          { action: 'take', title: 'Take it' },
          { action: 'no', title: 'Not now' },
        ],
        data: { offerId: offer.offerId, ref: offer.ref, declineToken: this.dispatch.mintDeclineToken(offer.offerId, now) },
      });
    } catch (err) {
      this.logger.warn(`driver-moved notify failed for ${driverDid}: ${(err as Error).message}`);
    }
  }

  /**
   * The shop scenario: one of this shop's own bags is ready to leave, but only the shop can close it. Two
   * different messages, because they are two different situations at a counter: "it is full" is good news
   * (close it and it goes), while "it has been open a day" is a warning that the parcels inside are late.
   * Tagged per reason so the second one is not swallowed by the first.
   */
  private async onToteNeedsSeal(payload: { code: string; agentDid?: string; reason?: 'full' | 'max_wait'; destination?: string }): Promise<void> {
    const agentDid = payload.agentDid;
    if (!agentDid) return;
    try {
      this.agents.get(agentDid); // the bag must be sitting at a real PUDO (throws for a hub/unknown node)
    } catch {
      return;
    }
    try {
      const where = payload.destination ? ` for ${payload.destination}` : '';
      const full = payload.reason !== 'max_wait';
      await this.notifications.notify(agentDid, {
        kind: 'bag_ready_to_close',
        title: full ? 'A bag is full' : 'A bag has been waiting',
        body: full
          ? `Bag ${payload.code}${where} is full. Close it so a driver can take it.`
          : `Bag ${payload.code}${where} has been open since yesterday. Close it, or the parcels inside will keep waiting.`,
        link: '/',
        tag: `bag-seal:${payload.code}:${payload.reason ?? 'full'}`,
        data: { code: payload.code },
      });
    } catch (err) {
      this.logger.warn(`bag-needs-seal notify failed for ${payload.code}: ${(err as Error).message}`);
    }
  }

  /**
   * The active drivers whose LIVE position is within range of a pickup, distance-sorted and capped — the
   * honest "near you", matched on real GPS not a declared route. "Near you" must mean near you NOW: an
   * active coupling keeps its LAST reported GPS forever (the app can background / lose signal without
   * ending the session), so a frozen hours-old position is not live. Apply the SAME freshness window the
   * market engine uses for this exact list (MARKET_SUPPLY_STALE_MIN) — a missing/too-old (or unparseable →
   * fail-safe excluded) fix drops out. Shared by the tote rule (2) and the freight rule (5).
   */
  private nearbyActiveDrivers(pickup: GeoPoint): Array<{ driverDid: string; km: number }> {
    const now = Date.now();
    const staleMs = MARKET_SUPPLY_STALE_MIN * 60_000;
    return this.fleet
      .list({ status: 'active' })
      .filter((a) => a.location && a.lastLocatedAt && now - new Date(a.lastLocatedAt).getTime() <= staleMs)
      /*
       * FP8 — AND NOT PAST THE SHIFT LIMIT.
       *
       * `suggestWork` returns nothing to a driver over 13 hours, the board marks the row, and the claim
       * refuses it. This path did none of that, so the one channel that reaches a driver who is NOT
       * looking at the app was the one channel still offering them work: a lock-screen nudge toward a
       * load they would be turned away from, sent to the person the limit exists to protect.
       *
       * The mirror-at-claim rule (S31) with the sides swapped — what refuses a load must not advertise it.
       */
      .filter((a) => !this.fleet.overHours(a.driverDid, now))
      .map((a) => ({ driverDid: a.driverDid, km: haversineKm(a.location as GeoPoint, pickup) }))
      .filter((d) => d.km <= NotificationDispatcher.NEARBY_DRIVER_KM)
      // …and HEADING there. Near is only half the question: a driver leaving town for the south is metres
      // from a bag going north. A driver who declared no leg is kept — we cannot say they are not going.
      .filter((d) => this.dispatch.worksNear(d.driverDid, pickup))
      .sort((a, b) => a.km - b.km)
      .slice(0, NotificationDispatcher.NEARBY_DRIVER_CAP);
  }

  /**
   * The GENESIS scenario (Rule 4): a parcel was minted, so tell its DROP-OFF PUDO to expect it. The
   * recipient is the origin agent DID carried on the event; a mint whose origin isn't a real PUDO agent
   * (defensive — a hub/unknown node) is skipped. The copy differs for a vendor order vs a person's
   * peer-send (read from the parcel), but neither the fare nor any secret rides the lock screen — the
   * agent sees the cash due + details in-app when they scan it in.
   */
  private async onMinted(payload: { parcelId: string; originAgentDid?: string }): Promise<void> {
    const originDid = payload.originAgentDid;
    if (!originDid) return;
    try {
      this.agents.get(originDid); // the drop-off must be a real PUDO agent (throws for a hub/unknown node)
    } catch {
      return;
    }
    try {
      // Idempotent: a mint publishes ParcelPaid AND (for a paid vendor) fires once, but a future re-fire /
      // a naive second subscription must not stack a second inbox row (the dedupe tag is SW-only, not on the
      // record). If this parcel already told this shop it's coming, do nothing — mirrors graduation.onCreated.
      const already = this.notifications.inboxFor(originDid).some((n) => n.kind === 'intake_expected' && (n.data as { parcelId?: string } | undefined)?.parcelId === payload.parcelId);
      if (already) return;
      const parcel = this.parcels.get(payload.parcelId);
      const isPeerSend = parcel.senderMobile === 'app';
      await this.notifications.notify(originDid, {
        kind: 'intake_expected',
        title: 'A parcel is coming in',
        body: isPeerSend
          ? 'A booked parcel is on its way to your counter — take it in when the sender drops it off.'
          : 'A store shipment is on its way to your counter — scan it in when it arrives.',
        link: '/',
        // One notification per minted parcel — a re-published mint/settle collapses onto the same one.
        tag: `intake:${payload.parcelId}`,
        data: { parcelId: payload.parcelId },
      });
    } catch (err) {
      this.logger.warn(`intake-expected notify failed for ${payload.parcelId}: ${(err as Error).message}`);
    }
  }

  /**
   * The freight scenario (Rule 5): a dedicated-freight load was posted to the marketplace. Unlike a tote
   * the load carries its own pickup coordinate, so we match drivers on it directly and push. Reuses the
   * exact live-GPS matching of Rule 2, so a heavy divert reaches a nearby truck at genesis.
   */
  private async onFreightPosted(payload: { freightId: string; destLabel?: string; pickupLocation?: GeoPoint }): Promise<void> {
    try {
      if (!payload.pickupLocation) return;
      // Unlike a tote (any bus carries it), a dedicated freight needs a fit vehicle. Ping only the nearby
      // drivers whose CURRENT vehicle could actually carry it — a bike driver never gets a pallet alert.
      // (claim() re-checks capability regardless; this just keeps the audience honest.)
      const nearby = this.nearbyActiveDrivers(payload.pickupLocation).filter((d) => this.dispatch.freightCarryableByDriver(payload.freightId, d.driverDid));
      if (nearby.length === 0) return;
      await Promise.all(
        nearby.map((d) =>
          this.notifications.notify(d.driverDid, {
            kind: 'load_nearby',
            title: 'A load is near you',
            body: payload.destLabel ? `A freight load to ${payload.destLabel} is ready to claim nearby.` : 'A freight load is ready to claim nearby.',
            link: '/',
            tag: `freight:${payload.freightId}`,
            data: { freightId: payload.freightId },
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`freight-nearby notify failed for ${payload.freightId}: ${(err as Error).message}`);
    }
  }

  /**
   * The PUDO-agent scenario: a bag went onto a bus committed to its next hop. If that hop is a PUDO
   * AGENT (the final pickup point), tell the shop its parcels are inbound. A bag bound for an MDP hub is
   * a re-sort leg, not "your parcels are coming", so agents.get throws for a non-agent node and we skip.
   */
  private async onBagLoaded(payload: { destinationNodeId?: string; parcels?: number; code?: string }): Promise<void> {
    try {
      const dest = payload.destinationNodeId;
      if (!dest) return;
      try {
        this.agents.get(dest); // verify the destination is a PUDO agent (throws for an MDP / unknown node)
      } catch {
        return;
      }
      const n = payload.parcels ?? 0;
      await this.notifications.notify(dest, {
        kind: 'bus_inbound',
        title: 'A bus is inbound',
        body: n > 0 ? `A bus with ${n} parcel${n === 1 ? '' : 's'} is on its way to you.` : 'A bus is on its way to your shop.',
        link: '/',
        tag: payload.code ? `bus:${payload.code}` : undefined,
        data: { code: payload.code },
      });
    } catch (err) {
      this.logger.warn(`bus-inbound notify failed: ${(err as Error).message}`);
    }
  }

  /**
   * Where a bag is standing. Asks DISPATCH rather than resolving it here: a load's location can be a shop, a
   * hub or a vendor's dock, and two copies of that question would drift the day a fourth kind appears.
   */
  private nodeLocation(nodeId: string): GeoPoint | undefined {
    try {
      return this.dispatch.pickupPlace(nodeId)?.loc;
    } catch {
      return undefined;
    }
  }
}
