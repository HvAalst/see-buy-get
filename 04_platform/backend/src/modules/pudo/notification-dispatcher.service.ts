import type { PlateClaim } from './plate-claim.types';
import type { OrderHandedOn } from './fleet-overflow.types';
import { BusinessDoorService } from './business-door.service';
import type { DriverRostered } from './fleet-roster.service';
import { ITEM_WORDS, type VehicleDefectDecided, type VehicleDefectReported, type VehicleServiceDue } from './vehicle-care.service';
import { CAUSE_WORDS, type VehicleBreakdownResolved, type VehicleBrokeDown, type VehicleLoadsHandedOver } from './vehicle-breakdown.service';
import type { DeliveryTiming, PlanLeftWhy, ReceivingExceptionKind } from './dispatch.types';
import { exceptionsInWords } from './receiving';
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
import { paperDay, paperLapsesAt } from './papers';
import { VEHICLE_CLASSES } from './fleet.config';
import type { NoticeKey } from './notice-words/catalog';
import { COLLECTED_AT_SHOP_REASON, THE_COURIER } from './notice-words/system-words';
import { GeoPoint } from './pudo.types';
import { loadLink, runLink, type NotificationKind } from './notification.types';
import { at, day, money, noticeOf, said } from './notice-words/say';
import type { Said, SayValue } from './notice-words/say';
/** 2026-11-24 — a UIT or UTN running out, as FiscalCodeSweeper publishes it (DispatchService.fiscalCodesToTell). */
type FiscalCodeExpiring = ReturnType<DispatchService['fiscalCodesToTell']>[number];
import type { TamperFinding } from './tamper.types';
import { ROUTE_REASONS, RUN_REASON_SENTENCE, type GiveBackReason, type RunCancelReason } from './departure.types';

/* The payloads the run's events carry, as published in DepartureService and FleetManagerService. */
/** A load the poster pays its driver for directly: its carrier says it was paid (2026-10-27). */
/** The shipper answers a driver's "not paid": it paid, with a reference. */
interface FreightNotPaidAnswered { freightId: string; code: string; reference: string; amount: number; currency: string; driverDid?: string; officeDid?: string; destLabel?: string }
/** Delivered three days ago, nothing said: its carrier is asked whether it was paid. */
interface FreightPaidDirectAsked { freightId: string; code: string; amount: number; currency: string; driverDid: string; officeDid?: string; destLabel?: string }
interface FreightPaidDirectEvent { freightId: string; code: string; amount: number; currency: string; by: 'driver' | 'office' | 'mollie'; driverName?: string; posterDid?: string; destLabel?: string; driverDid?: string; reference?: string }
interface SpaceSold { departureId: string; bookingId: string; managerDid: string; lineName: string; shipperDid: string; description: string; weightKg: number; price: number; currency: string }
interface VehicleChanged { departureId: string; managerDid: string; company: string; lineName: string; fromPlate: string; toPlate: string; fromClass: string; toClass: string; shippers: string[] }
interface FleetChange { driverDid: string; driverName: string; fromManagerDid?: string; toManagerDid: string; toCompany: string }
interface FleetOfferMade { offerId: string; driverDid: string; fleetDid: string; companyName: string; expiresAt: string }
interface FleetOfferClosed { offerId: string; outcome: 'declined' | 'withdrawn'; fleetDid: string; driverDid: string; phoneEnding: string; companyName: string }
/** A person's parcel withdrawn at a hub, going back to the shop it was handed in at as another parcel (2026-10-27). */
interface Withdrawn { parcelId: string; returnParcelId: string; hubName: string; shopName: string; amount: number; currency: string }
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

/** "by 29 Oct at 07:56 UTC" — the end of a time to answer, said the same way. */
function byWords(iso: string): string {
  return `by ${offerDay(iso)} at ${iso.slice(11, 16)} UTC`;
}

/** 2026-11-26 — the same moment as a figure each language writes its own way ("20 Oct at 07:56 UTC" in English). */
function utcWhen(iso: string) {
  return at(`${offerDay(iso)} at ${iso.slice(11, 16)} UTC`, iso);
}
/** utcWords, as a phrase. */
function saidOn(iso: string): Said {
  return said('dispatch.on', { when: utcWhen(iso) });
}
/** byWords, as a phrase. */
function saidBy(iso: string): Said {
  return said('dispatch.by', { when: utcWhen(iso) });
}

/** Who says a load was (not) paid: the driver by name, the driver’s fleet, or "The driver". */
function directWho(p: Pick<FreightPaidDirectEvent, 'by' | 'driverName'>): SayValue {
  if (p.by === 'office') return p.driverName ? said('dispatch.paidDirect.fleetOf', { name: p.driverName }) : said('dispatch.paidDirect.fleetOfDriver');
  return p.driverName ?? said('dispatch.theDriver');
}

/**
 * A licence or paper day (paperDay): the English as before, and the day itself wherever it can be read — a plain date, or a
 * moment (2026-11-27: a moment was said in English in every language).
 */
export function paperDayShown(expiresAt: string): SayValue {
  const last = paperLapsesAt(expiresAt) - 86_400_000;
  return Number.isFinite(last) ? day(paperDay(expiresAt), new Date(last).toISOString().slice(0, 10)) : paperDay(expiresAt);
}

/* 2026-11-27 — the pieces of a notice our own code writes in English, said as phrases (notice-words/en/details.ts). */

/** Where on a load a finding was made, by its stage. */
const WHERE_SAID: Record<string, NoticeKey> = { pickup: 'dispatch.loadHeld.where.pickup', road: 'dispatch.loadHeld.where.road', delivery: 'dispatch.loadHeld.where.delivery' };

/** A delivery window as the plan says it ("08:00–12:00", "before 14:00", "from 09:30"): the words around the times as phrases. */
export function windowSaid(w: string): SayValue {
  const before = /^before (\d{2}:\d{2})$/.exec(w);
  if (before) return said('dispatch.window.before', { to: before[1] });
  const from = /^from (\d{2}:\d{2})$/.exec(w);
  return from ? said('dispatch.window.from', { from: from[1] }) : w;
}

/** A vehicle's class, said as the language names it. */
export function classSaid(c: string): SayValue {
  return (VEHICLE_CLASSES as readonly string[]).includes(c) ? said(`vehicle.class.${c}` as NoticeKey) : c;
}

/** Who carries goods on a broken-down vehicle: the fleet or courier by name, or "The courier" where no name is known. */
export function carrierSaid(carrier: string): SayValue {
  return carrier === THE_COURIER ? said('dispatch2.breakdown.theCourier') : carrier;
}

/** When a vehicle broke down, on its owner's clock: the English as before, each language writing the moment its own way. */
function breakdownWhen(p: Pick<VehicleBrokeDown, 'when' | 'zone' | 'breakdown'>): SayValue {
  return p.breakdown.reportedAt ? at(p.when, p.breakdown.reportedAt, p.zone) : p.when;
}

/** Refused at the door: the sender told before the 48 hours end (DispatchService.sweepRefusals). */
interface RefusalReminder {
  freightId: string;
  code: string;
  decideBy: string;
  pickupLabel: string;
  destLabel?: string;
  posterDid?: string;
}

/** …and what was decided — by the sender, or by the deadline (DispatchService.decideRefusal). */
interface RefusalDecided {
  freightId: string;
  code: string;
  choice: 'back' | 'elsewhere' | 'give_up';
  byDeadline: boolean;
  driverDid?: string;
  posterDid?: string;
  destLabel?: string;
  returnFreightId?: string;
  returnCode?: string;
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

/** Each coded reason a run was called off, as a phrase (first letter lower-case, as runCalledOffBody puts it after the colon). */
const RUN_REASON_SAID: Record<RunCancelReason, Said | undefined> = {
  vehicle_unavailable: said('dispatch.runOff.reason.vehicle_unavailable'),
  no_driver: said('dispatch.runOff.reason.no_driver'),
  road_closed: said('dispatch.runOff.reason.road_closed'),
  border_closed: said('dispatch.runOff.reason.border_closed'),
  not_enough_loads: said('dispatch.runOff.reason.not_enough_loads'),
  other: undefined,
};

/** runCalledOffBody as phrases: its English is the same word for word, and a shipper reads it in their own language. */
function runCalledOffSaid(p: RunCalledOff): Said {
  let words: SayValue = '';
  if (p.cancelReason) {
    const parts: SayValue[] = [RUN_REASON_SAID[p.cancelReason] ?? '', p.note ? said('dispatch.runOff.note', { note: p.note }) : ''].filter(Boolean);
    words = parts.length === 2 ? said('dispatch.runOff.joined', { a: parts[0], b: parts[1] }) : (parts[0] ?? '');
  } else {
    words = p.reason;
  }
  const head = said('dispatch.runOff.head', { words: words ? said('dispatch.runOff.colon', { words }) : '' });
  if (p.cancelReason && ROUTE_REASONS.includes(p.cancelReason)) return said('dispatch.runOff.route', { head });
  return p.alternatives ? said('dispatch.runOff.others', { head, n: p.alternatives }) : said('dispatch.runOff.none', { head });
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

/** spanWords, as a phrase. */
function saidSpan(minutes: number): Said {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  if (h === 0) return said('dispatch.unit.minutes', { n: m });
  const hours = said('dispatch.unit.hours', { n: h });
  return m % 60 === 0 ? hours : said('dispatch.span.hoursMin', { hours, mm: String(m % 60).padStart(2, '0') });
}

/** A carrier's accepted plan leaves an order on no vehicle (`left`) — or, after that was said, has it on one. */
interface OrderLeftOut { freightId: string; code: string; shipperDid: string; fleetName: string; day: string; left: boolean; why?: PlanLeftWhy; arrive?: string; window?: string }

/** Why a plan left an order out, as a sentence to its shipper. The carrier's reason, without the carrier's own business. */
const LEFT_OUT_BECAUSE: Record<PlanLeftWhy, (d: string) => Said> = {
  room: (d) => said('dispatch.leftOut.because.room', { day: day(d, d) }),
  fit: (d) => said('dispatch.leftOut.because.fit', { day: day(d, d) }),
  heavy: () => said('dispatch.leftOut.because.heavy'),
  place: () => said('dispatch.leftOut.because.place'),
  closed: (d) => said('dispatch.leftOut.because.closed', { day: day(d, d) }),
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
interface UnitHeldPayload { unitType: 'load' | 'parcel'; unitId: string; ref: string; finding: TamperFinding; where: string; stage?: string; posterDid?: string }
interface UnitReleasedPayload { unitType: 'load' | 'parcel'; unitId: string; ref: string; code?: string; reason: string; posterDid?: string }
interface FleetPaperChecked { did: string; kind: 'operator_licence' | 'carrier_insurance'; accepted: boolean; expiresAt?: string; reason?: string }
interface LicenceSent { did: string; displayName: string; expiresAt: string; managerDid?: string }
interface DisputeDecided { parcelId: string; decision: 'upheld' | 'partly_upheld' | 'rejected' | 'report_only'; award: number; currency?: string; note: string; origin: 'counter' | 'buyer'; raisedBy: string }
import { UnclaimedService } from './unclaimed.service';
import { VendorService } from './vendor.service';
import { MerchantRatingService } from './merchant-rating.service';
import { ReceiverMailBounces } from './receiver-mail-bounce.service';
import { BAGS_WAITING_H, MARKET_SUPPLY_STALE_MIN, NUDGE_COOLDOWN_MIN, NUDGE_MIN_MOVE_KM, UNCOLLECTED_REMINDER_H, UNCOLLECTED_SWEEP_MS, WIDE_OFFER_CAP, WIDE_OFFER_KM, WIDE_OFFER_SWEEP_MS } from './pudo.config';
import type { HeldByAuthority } from './load-detention.types';

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

/** What each tamper finding is, as a phrase (FINDING_WORDS, in the reader's language). */
const FINDING_SAID: Record<TamperFinding, Said> = {
  seal_not_as_written: said('dispatch.finding.seal_not_as_written'),
  seal_not_as_on_the_note: said('dispatch.finding.seal_not_as_on_the_note'),
  seal_broken: said('dispatch.finding.seal_broken'),
  wrap_cut: said('dispatch.finding.wrap_cut'),
  inspection_failed: said('dispatch.finding.inspection_failed'),
};

/** Who holds a load on the road, as a phrase (HELD_BY_WORDS). */
const HELD_BY_SAID: Record<string, Said> = {
  police: said('dispatch.heldBy.police'),
  customs: said('dispatch.heldBy.customs'),
  other: said('dispatch.heldBy.other'),
};

/** Where a parcel running late is, in the words of its notice. */
const PARCEL_WHERE: Record<'shop' | 'road' | 'hub', Said> = {
  shop: said('dispatch.where.shop'),
  road: said('dispatch.where.road'),
  hub: said('dispatch.where.hub'),
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
/** lateWords, as a phrase. */
function lateSaid(hours: number): Said {
  if (hours < 24) return said('dispatch.unit.hours', { n: Math.max(1, Math.round(hours)) });
  return said('dispatch.unit.days', { n: Math.round(hours / 24) });
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
    // A business's parcels going on to its own door (2026-10-29).
    @Optional() private readonly doors?: BusinessDoorService,
    // The store an order came from, and whether its receiver has said anything about it yet (2026-11-05).
    @Optional() private readonly merchants?: MerchantRatingService,
    // 2026-11-16 — an email to a receiver or a buyer that came back before: whoever it was for is told at once.
    @Optional() private readonly receiverBounces?: ReceiverMailBounces,
  ) {}

  /** 2026-11-16 — about to write to an address that already came back: the poster or the store is told now, not never. */
  private toldIfItCameBack(address: string | undefined): void {
    if (address && this.receiverBounces?.cameBack(address)) this.receiverBounces.bounced(address);
  }

  /** The uncollected sweep's timer. Self-unref'd: a reminder is never a reason to hold the process open. */
  private uncollectedTimer?: ReturnType<typeof setInterval>;

  /** The stalled-sign-up sweep's timer, self-unref'd for the same reason. */
  private signupTimer?: ReturnType<typeof setInterval>;

  /** The running-late sweep's timer, self-unref'd for the same reason. */
  private lateTimer?: ReturnType<typeof setInterval>;

  /** The hours sweep's timer, self-unref'd for the same reason. */
  private hoursTimer?: ReturnType<typeof setInterval>;

  /** 2026-11-06 — the sweep offering long-waiting bags further away, self-unref'd for the same reason. */
  private wideTimer?: ReturnType<typeof setInterval>;

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
    // And a closed bag nobody near has taken: nothing happens when no driver comes, so it is offered further away.
    this.wideTimer = setInterval(() => void this.sweepBagsWaiting().catch(() => undefined), WIDE_OFFER_SWEEP_MS);
    this.wideTimer.unref?.();
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
            ? noticeOf(said('dispatch.shiftHours.near.title'), said('dispatch.shiftHours.near.body', { onDuty: n.onDuty, limit }))
            : n.kind === 'over'
              ? noticeOf(said('dispatch.shiftHours.over.title'), said('dispatch.shiftHours.over.body', { onDuty: n.onDuty, limit, rest }))
              : noticeOf(said('dispatch.shiftHours.rested.title'), said('dispatch.shiftHours.rested.body', { rest }));
        await this.notifications.notify(n.driverDid, { kind: 'shift_hours', ...say, link: '/?go=home', tag: `hours:${n.kind}:${n.driverDid}` });
        told += 1;
        if (n.kind === 'over' && n.managerDid) {
          await this.notifications.notify(n.managerDid, {
            kind: 'shift_hours',
            ...noticeOf(
              said('dispatch.shiftHours.office.title', { name: n.driverName }),
              said('dispatch.shiftHours.office.body', { onDuty: n.onDuty, withPlate: n.plate ? said('dispatch.shiftHours.office.plate', { plate: n.plate }) : '', limit, rest }),
            ),
            // The office's shifts, where the driver on it is.
            link: '/?go=sessions',
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
    if (this.wideTimer) clearInterval(this.wideTimer);
  }

  onModuleInit(): void {
    // Rule 1 (buyer) — a parcel reached its destination PUDO and is ready to collect.
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.InboundCreated, (e) => this.onOrderOnItsWay(e.payload.parcelId));
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelReadyForPickup, (e) =>
      this.onParcelReadyForPickup(e.payload.parcelId),
    );
    // 2026-11-15 — on the road to its shop: its receiver is told once (plan R1: the bell only at the moments that matter).
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelHandedToBus, (e) => this.onParcelOnItsWay(e.payload.parcelId));
    // 2026-11-19 — a parcel abroad at customs: its receiver and its sender told what was decided and what they pay (step 3).
    this.events.subscribe<{ parcelId: string; step: 'released' | 'held' | 'paid' | 'lapsed' | 'someone_else' | 'given_up' }>(GlosEvent.Pudo.ParcelCustomsDecided, (e) => this.onCustomsDecided(e.payload.parcelId, e.payload.step));
    // 2026-11-15 — a load's delivery code made: its named receiver is given it, in the Send app or by email (plan R2).
    this.events.subscribe<{ freightId: string }>(GlosEvent.Pudo.DeliveryCodeIssued, (e) => this.onDeliveryCodeIssued(e.payload.freightId));
    // 2026-11-15 — a load naming its receiver is on a vehicle: a code, where the receiver can be given it (the owner: "yes").
    this.events.subscribe<{ freightId: string }>(GlosEvent.Pudo.ReceiverCodeWanted, (e) => this.onReceiverCodeWanted(e.payload.freightId));
    this.events.subscribe<{ parcelId: string; toDoor?: string }>(GlosEvent.Pudo.ParcelDelivered, (e) => this.onStoreOrderCollected(e.payload));
    // 2026-11-06 — its plan, made again, expects it later than it was promised: its people are told now (movement unification).
    this.events.subscribe<{ parcelId: string; promisedAt: string; expectedAt: string }>(GlosEvent.Pudo.ParcelExpectedLate, (e) => this.onExpectedLate(e.payload));
    // 2026-11-06 — a bag no driver could be found for in a day, and the moment one takes it on: its parcels' people told.
    this.events.subscribe<{ code: string; parcelIds: string[]; place: string }>(GlosEvent.Pudo.BagHeldUp, (e) => this.onBagHeldUp(e.payload, 'held'));
    this.events.subscribe<{ code: string; parcelIds: string[]; place: string }>(GlosEvent.Pudo.BagOnTheRoadAgain, (e) => this.onBagHeldUp(e.payload, 'moving'));
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
    // 2026-11-05 — PRE-DROP-OFF: a booking went to another shop because this one had no place left — ask it to make room.
    this.events.subscribe<{ agentDid: string; reason: 'shelf' | 'cap' }>(GlosEvent.Pudo.BookingTurnedAway, (e) => this.onBookingTurnedAway(e.payload));
    // 2026-11-06 — a booking moved to another drop-off shop by its booker: the new shop expects it, as at a booking.
    this.events.subscribe<{ parcelId: string; originAgentDid?: string }>(GlosEvent.Pudo.DropOffMoved, (e) => this.onMinted(e.payload));
    // Rule 5 (driver) — a dedicated-freight load was posted; ping active drivers near its pickup (same
    // live-GPS matching as a ready tote), so a heavy divert reaches a truck at genesis, not only via pull.
    this.events.subscribe<{ freightId: string; destLabel?: string; pickupLocation?: GeoPoint; raisedTo?: number; currency?: string }>(GlosEvent.Pudo.FreightPosted, (e) => this.onFreightPosted(e.payload));
    // FP5 (driver) — their fleet office put a load on them: it is on their list before they looked, so say so.
    this.events.subscribe<{ freightId: string; code: string; driverDid: string; byName?: string; pickupLabel: string; destLabel: string; weightKg: number; earning?: number }>(GlosEvent.Pudo.FreightAssigned, (e) => this.onFreightAssigned(e.payload));
    // FP8 (sender + office) — a driver gave a claimed load back: it is on the market again, and here is why.
    this.events.subscribe<{ freightId: string; code: string; driverName?: string; reason: string; posterDid?: string; managerDid?: string; destLabel?: string }>(GlosEvent.Pudo.FreightHandedBack, (e) => this.onFreightHandedBack(e.payload));
    // A load the poster pays its driver for directly: the driver, or their fleet's office, says it was paid (2026-10-27).
    this.events.subscribe<FreightPaidDirectEvent>(GlosEvent.Pudo.FreightPaidDirect, (e) => this.onFreightPaidDirect(e.payload));
    this.events.subscribe<FreightPaidDirectEvent>(GlosEvent.Pudo.FreightNotPaidDirect, (e) => this.onFreightNotPaidDirect(e.payload));
    this.events.subscribe<FreightPaidDirectAsked>(GlosEvent.Pudo.FreightPaidDirectAsked, (e) => this.onFreightPaidDirectAsked(e.payload));
    this.events.subscribe<FreightNotPaidAnswered>(GlosEvent.Pudo.FreightNotPaidAnswered, (e) => this.onFreightNotPaidAnswered(e.payload));
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
    this.events.subscribe<{ freightId: string; code: string; posterDid?: string; description?: string; destLabel?: string; receivedBy?: string; exceptions?: Array<{ kind: ReceivingExceptionKind; count: number }>; refusedPart?: { packages: number; of: number; decideBy: string; pickupLabel?: string } }>(GlosEvent.Pudo.FreightDelivered, (e) => this.onFreightDelivered(e.payload));
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
    this.events.subscribe<{ personDid: string; driverDids: string[]; newDevice?: boolean }>(GlosEvent.Pudo.PersonPinReplaced, (e) => {
      const n = noticeOf(said('dispatch.pinReplaced.title'), said('dispatch.pinReplaced.body'));
      return this.onSignInChanged(e.payload, 'pin-replaced', n.title, n.body, n.say);
    });
    this.events.subscribe<{ personDid: string; driverDids: string[] }>(GlosEvent.Pudo.PersonDeviceConfirmed, (e) => {
      const n = noticeOf(said('dispatch.deviceConfirmed.title'), said('dispatch.deviceConfirmed.body'));
      return this.onSignInChanged(e.payload, 'device-confirmed', n.title, n.body, n.say);
    });
    // The fleet's own licence or cover: a document it sent was recorded, or turned down with a reason.
    this.events.subscribe<FleetPaperChecked>(GlosEvent.Pudo.FleetPaperChecked, (e) => this.onFleetPaperChecked(e.payload));
    // FP3b (sender) — the driver is at the door and cannot hand over: the sender is the one who can fix it.
    this.events.subscribe<{ freightId: string; code: string; posterDid?: string; outcome: string; note?: string; destLabel?: string; attempts: number; decideBy?: string; pickupLabel?: string }>(GlosEvent.Pudo.FreightDeliveryFailed, (e) => this.onFreightDeliveryFailed(e.payload));
    // Refused at the door (the user, 2026-10-27): the sender told before the 48 hours end; the decision told to the driver.
    this.events.subscribe<RefusalReminder>(GlosEvent.Pudo.FreightRefusalReminder, (e) => this.onFreightRefusalReminder(e.payload));
    this.events.subscribe<RefusalDecided>(GlosEvent.Pudo.FreightRefusalDecided, (e) => this.onFreightRefusalDecided(e.payload));
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
    // …and approved: they are told they can drive, and that the photographs they sent are gone (the owner, 2026-10-30).
    // Not a bicycle rider switched on at sign-up: nobody looked at anything, so there is nothing to tell.
    this.events.subscribe<{ did: string; by?: string }>(GlosEvent.Pudo.DriverActivated, (e) => {
      const p = e.payload;
      if (p.by === 'light registry') return;
      void this.tell(p.did, {
        kind: 'papers_checked',
        ...noticeOf(said('dispatch.driverActivated.title'), said('dispatch.driverActivated.body')),
        // A shift starts on the home screen.
        link: '/?go=home',
        tag: `driver-papers:${p.did}`,
        data: { approved: true },
      });
    });
    // …and a hub, whose papers staff approved or sent back: the hub is the one waiting, so the hub is told.
    this.events.subscribe<{ did: string; mdpId: string; name: string; approved: boolean; reason?: string }>(GlosEvent.Pudo.HubPapersDecided, (e) => {
      const p = e.payload;
      void this.tell(p.did, {
        kind: 'papers_checked',
        ...(p.approved
          ? noticeOf(said('dispatch.hubPapers.approved.title', { name: p.name }), said('dispatch.hubPapers.approved.body'))
          : noticeOf(said('dispatch.hubPapers.refused.title', { name: p.name }), said('dispatch.hubPapers.refused.body', { reason: p.reason ?? said('dispatch.wrongWithThem') }))),
        tag: `hub-papers:${p.mdpId}`,
        data: { mdpId: p.mdpId, approved: p.approved },
      });
    });
    this.events.subscribe<{ did: string; approved: boolean; reason?: string; companyName?: string }>(GlosEvent.Pudo.DriverRideAloneDecided, (e) => this.onRideAloneDecided(e.payload));
    // 2026-11-21 — "I bought it" (PlateClaimService): the owner asked, the asker told how it ended; staff's decision told to both.
    this.events.subscribe<{ claim: PlateClaim }>(GlosEvent.Pudo.PlateClaimAsked, (e) => this.onPlateClaim('asked', e.payload.claim));
    // 2026-11-21 — a booking paid online called off (5c): its sender told the money goes back, or waits to.
    this.events.subscribe<{ parcelId: string; personDid: string; amount: number; currency: string; state?: 'asked' | 'waiting' }>(GlosEvent.Pudo.BookingRefunded, (e) => {
      const p = e.payload;
      void this.tell(p.personDid, {
        kind: 'booking_refunded',
        ...(p.state === 'waiting'
          ? noticeOf(said('dispatch.bookingRefunded.waiting.title', { parcelId: p.parcelId }), said('dispatch.bookingRefunded.waiting.body', { amount: money(`${p.currency} ${p.amount.toFixed(2)}`, p.amount, p.currency) }))
          : noticeOf(said('dispatch.bookingRefunded.asked.title', { parcelId: p.parcelId }), said('dispatch.bookingRefunded.asked.body', { amount: money(`${p.currency} ${p.amount.toFixed(2)}`, p.amount, p.currency) }))),
        link: `/?parcel=${p.parcelId}`,
        tag: `booking-refund:${p.parcelId}:${p.state ?? 'asked'}`,
        data: { parcelId: p.parcelId },
      });
    });
    // 2026-11-21 — a booking paid online when booked (5a): its sender told the label is ready, where it opens.
    this.events.subscribe<{ parcelId: string; personDid: string; amount: number; currency: string }>(GlosEvent.Pudo.BookingPaidOnline, (e) => {
      const p = e.payload;
      void this.tell(p.personDid, {
        kind: 'booking_paid',
        ...noticeOf(said('dispatch.bookingPaid.title', { parcelId: p.parcelId }), said('dispatch.bookingPaid.body')),
        link: `/?parcel=${p.parcelId}`,
        tag: `booking-paid:${p.parcelId}`,
        data: { parcelId: p.parcelId },
      });
    });
    this.events.subscribe<{ claim: PlateClaim }>(GlosEvent.Pudo.PlateClaimClosed, (e) => this.onPlateClaim('closed', e.payload.claim));
    this.events.subscribe<{ claim: PlateClaim }>(GlosEvent.Pudo.PlateClaimLapsed, (e) => this.onPlateClaim('lapsed', e.payload.claim));
    // Round 39 — the risk register: a hub, or the fleet running a corridor, is told when where it works is rated anew.
    this.events.subscribe<{ subject: 'corridor' | 'hub'; id: string; threat: string; level: string; from?: string; tell?: { did: string; name: string } }>(GlosEvent.Pudo.RiskRated, (e) => {
      const p = e.payload;
      if (!p.tell) return;
      const threats: Record<string, Said> = { pilferage: said('dispatch.riskRated.threat.pilferage'), hijacking: said('dispatch.riskRated.threat.hijacking'), unrest: said('dispatch.riskRated.threat.unrest'), extortion: said('dispatch.riskRated.threat.extortion') };
      const levels: Record<string, Said> = { low: said('dispatch.riskRated.level.low'), medium: said('dispatch.riskRated.level.medium'), high: said('dispatch.riskRated.level.high') };
      const threat = threats[p.threat] ?? p.threat;
      const high = p.subject === 'hub' ? said('dispatch.riskRated.high.hub') : said('dispatch.riskRated.high.corridor');
      const lowered = p.subject === 'hub' ? said('dispatch.riskRated.lowered.hub') : said('dispatch.riskRated.lowered.corridor');
      void this.tell(p.tell.did, {
        kind: 'risk_rated',
        ...noticeOf(said('dispatch.riskRated.title', { name: p.tell.name, level: levels[p.level] ?? p.level, threat }), p.level === 'high' ? high : p.from === 'high' ? lowered : said('dispatch.riskRated.other')),
        tag: `risk:${p.subject}:${p.id}:${p.threat}`,
        data: { subject: p.subject, id: p.id, threat: p.threat, level: p.level },
      });
    });
    // Round 39 — a light courier's ID photo looked at: seen, and their cap grows from now; or sent back, with the reason.
    this.events.subscribe<{ did: string; seen: boolean; reason?: string }>(GlosEvent.Pudo.DriverIdPhotoDecided, (e) => {
      const p = e.payload;
      void this.tell(p.did, {
        kind: 'papers_checked',
        ...(p.seen
          ? noticeOf(said('dispatch.idPhoto.seen.title'), said('dispatch.idPhoto.seen.body'))
          : noticeOf(said('dispatch.idPhoto.refused.title'), said('dispatch.idPhoto.refused.body', { reason: p.reason ?? said('dispatch.wrongWithIt') }))),
        link: '/?go=home',
        tag: `id-photo:${p.did}`,
        data: { seen: p.seen },
      });
    });
    // Round 40 — a shop's trading licence recorded to a new date, or the one it sent sent back with the reason.
    this.events.subscribe<{ did: string; accepted: boolean; expiresAt?: string; reason?: string }>(GlosEvent.Pudo.ShopLicenceChecked, (e) => {
      const p = e.payload;
      void this.tell(p.did, {
        kind: 'papers_checked',
        ...(p.accepted
          ? noticeOf(said('dispatch.shopLicence.recorded.title'), said('dispatch.shopLicence.recorded.body', { date: p.expiresAt ? paperDayShown(p.expiresAt) : said('dispatch.newDate') }))
          : noticeOf(said('dispatch.licencePhotoRefused.title'), said('dispatch.licencePhotoRefused.shopBody', { reason: p.reason ?? said('dispatch.wrongWithIt') }))),
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
        ...noticeOf(
          said('dispatch.standstill.title', { plate: c.plate, minutes: c.minutes, driver: c.driverName ? said('dispatch.dashName', { name: c.driverName }) : '' }),
          said('dispatch.standstill.body', { lat: c.location.lat.toFixed(5), lng: c.location.lng.toFixed(5) }),
        ),
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
        ...noticeOf(
          said('dispatch.silent.title', { plate: c.plate, minutes: c.minutes, driver: c.driverName ? said('dispatch.dashName', { name: c.driverName }) : '' }),
          said('dispatch.silent.body', { lat: c.location.lat.toFixed(5), lng: c.location.lng.toFixed(5) }),
        ),
        tag: `silent:${c.caseId}`,
        data: { caseId: c.caseId, lat: c.location.lat, lng: c.location.lng },
      });
    });
    // 2026-11-24 — a vehicle in Romania silent for 15 minutes: its driver checks the phone; its office calls the driver.
    this.events.subscribe<{ session?: { sessionId: string; driverDid: string; fleetDid?: string; plate: string }; minutes?: number; lastPoint?: { lat: number; lng: number } }>(GlosEvent.Pudo.TelematicsSignalLost, (e) => this.onSignalLost(e.payload));
    // 2026-11-24 — a UIT or UTN within a day of its end: the sender gives a new one; its driver and office know.
    this.events.subscribe<FiscalCodeExpiring>(GlosEvent.Pudo.FiscalCodeExpiring, (e) => this.onFiscalCodeExpiring(e.payload));
    this.events.subscribe<VehicleBreakdownResolved>(GlosEvent.Pudo.VehicleBreakdownResolved, (e) => this.onBreakdownResolved(e.payload));
    this.events.subscribe<VehicleLoadsHandedOver>(GlosEvent.Pudo.VehicleLoadsHandedOver, (e) => this.onLoadsHandedOver(e.payload));
    // FP4 (courier) — the renewed licence they sent was checked. They sent it and are waiting: either answer.
    this.events.subscribe<{ did: string; accepted: boolean; expiresAt?: string; reason?: string }>(GlosEvent.Pudo.DriverLicenceChecked, (e) => this.onLicenceChecked(e.payload));
    this.events.subscribe<LicenceSent>(GlosEvent.Pudo.DriverLicenceSent, (e) => this.onLicenceSent(e.payload));
    this.events.subscribe<DisputeDecided>(GlosEvent.Pudo.ParcelDisputeDecided, (e) => this.onParcelDisputeDecided(e.payload));
    this.events.subscribe<{ parcelId: string; reason: string }>(GlosEvent.Pudo.ParcelLost, (e) => this.onParcelLost(e.payload.parcelId, 'lost', e.payload.reason));
    this.events.subscribe<{ parcelId: string; note: string }>(GlosEvent.Pudo.ParcelFound, (e) => this.onParcelLost(e.payload.parcelId, 'found', e.payload.note));
    this.events.subscribe<Withdrawn>(GlosEvent.Pudo.ParcelWithdrawn, (e) => this.onParcelWithdrawn(e.payload));
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
            ...noticeOf(said('dispatch.noteExpiring.title', { number: payload.number }), said('dispatch.noteExpiring.body', { date: day(goes, goes) })),
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
        ...(payload.accepted
          ? noticeOf(said('dispatch.licenceChecked.recorded.title'), said('dispatch.licenceChecked.recorded.body', { date: payload.expiresAt ? paperDayShown(payload.expiresAt) : said('dispatch.newDate') }))
          : noticeOf(said('dispatch.licencePhotoRefused.title'), said('dispatch.licencePhotoRefused.driverBody', { reason: `${payload.reason}` }))),
        // Its card is on the Driver app's home: a shift starts there, and a photo is sent again from there.
        link: '/?go=home',
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
    const outcome = p.decision === 'upheld' ? said('dispatch.dispute.outcome.upheld') : p.decision === 'partly_upheld' ? said('dispatch.dispute.outcome.part') : said('dispatch.dispute.outcome.not');
    const tag = `dispute:${p.parcelId}:decided`;
    // 2026-11-02 — to a person, the parcel in the Send app, where how it ended is read (Open under the notice).
    const link = `/?parcel=${p.parcelId}`;
    const receiver = accountFor(this.parcels.receiverOf(parcel), this.persons);
    const sender = accountFor(this.parcels.senderOf(parcel), this.persons);
    if (receiver) {
      await this.tell(receiver.personDid, { kind: 'claim_decided', ...noticeOf(said(p.origin === 'buyer' ? 'dispatch.dispute.receiver.buyer.title' : 'dispatch.dispute.report.title', { parcelId: p.parcelId, outcome }), said('dispatch.note.only', { note: p.note })), tag, data: { parcelId: p.parcelId }, link });
    }
    if (sender && sender.personDid !== receiver?.personDid) {
      // Owed to the sender only where no store sold the shipment: a store's award goes to the store's float.
      const owed = p.award > 0 && p.currency && !parcel.vendorId ? said('dispatch.dispute.owed', { amount: money(`${p.award.toFixed(2)} ${p.currency}`, p.award, p.currency) }) : '';
      await this.tell(sender.personDid, { kind: 'claim_decided', ...noticeOf(said('dispatch.dispute.report.title', { parcelId: p.parcelId, outcome }), said('dispatch.dispute.sender.body', { note: p.note, owed })), tag, data: { parcelId: p.parcelId }, link });
    }
    if (p.origin === 'counter' && p.raisedBy.startsWith('did:')) {
      const slot = parcel.binSlot ? said('dispatch.dispute.slot', { slot: parcel.binSlot }) : '';
      await this.tell(p.raisedBy, { kind: 'claim_decided', ...noticeOf(said('dispatch.dispute.counter.title', { parcelId: p.parcelId }), said('dispatch.dispute.counter.body', { outcome, note: p.note, slot })), tag, data: { parcelId: p.parcelId } });
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
      const yours = side === 'receiver' ? said('dispatch.yourParcel') : said('dispatch.aParcelYouSent');
      const sentence = /[.!?]$/.test(words) ? words : `${words}.`;
      const say =
        what === 'lost'
          ? { kind: 'parcel_lost' as const, ...noticeOf(said('dispatch.parcelLost.lost.title', { yours, parcelId }), said('dispatch.parcelLost.lost.body', { words: sentence })) }
          : { kind: 'parcel_found' as const, ...noticeOf(said('dispatch.parcelLost.found.title', { yours, parcelId }), said('dispatch.parcelLost.found.body', { words: sentence })) };
      try {
        await this.notifications.notify(person.personDid, { ...say, link: `/?parcel=${parcelId}`, tag: `parcel-lost:${parcelId}`, data: { parcelId } });
      } catch (err) {
        this.logger.warn(`parcel-${what} notice failed for ${parcelId}: ${(err as Error).message}`);
      }
    }
    if (parcel.vendorId) this.vendors.notify(parcel.vendorId, what === 'lost' ? 'parcel.lost' : 'parcel.found', { parcelId, externalOrderId: parcel.externalOrderId, status: parcel.status, ...(what === 'lost' ? { reason: words } : { note: words }) });
  }

  /**
   * A PERSON'S PARCEL WITHDRAWN AT A HUB (the user, 2026-10-27: "Back to its shop, sender pays"): its sender is told where to
   * collect it and what they pay there; its receiver, that it will not come. In the app, never a text.
   */
  private async onParcelWithdrawn(p: Withdrawn): Promise<void> {
    let parcel: ReturnType<ParcelService['get']>;
    try {
      parcel = this.parcels.get(p.parcelId);
    } catch {
      return;
    }
    const sender = accountFor(this.parcels.senderOf(parcel), this.persons);
    const receiver = accountFor(this.parcels.receiverOf(parcel), this.persons);
    const cash = money(`${p.amount.toFixed(2)} ${p.currency}`, p.amount, p.currency);
    const say = async (to: string, n: ReturnType<typeof noticeOf> & { parcelId: string }) => {
      try {
        await this.notifications.notify(to, { kind: 'parcel_withdrawn', title: n.title, body: n.body, say: n.say, link: `/?parcel=${n.parcelId}`, tag: `withdrawn:${p.parcelId}`, data: { parcelId: n.parcelId } });
      } catch (err) {
        this.logger.warn(`parcel-withdrawn notice failed for ${p.parcelId}: ${(err as Error).message}`);
      }
    };
    if (sender) {
      await say(sender.personDid, {
        ...noticeOf(
          said('dispatch.withdrawn.sender.title', { parcelId: p.parcelId }),
          said('dispatch.withdrawn.sender.body', { hubName: p.hubName, shopName: p.shopName, returnParcelId: p.returnParcelId, cash }),
        ),
        parcelId: p.returnParcelId,
      });
    }
    if (receiver && receiver.personDid !== sender?.personDid) {
      await say(receiver.personDid, { ...noticeOf(said('dispatch.withdrawn.receiver.title', { parcelId: p.parcelId }), said('dispatch.withdrawn.receiver.body', { hubName: p.hubName })), parcelId: p.parcelId });
    }
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
      ...noticeOf(said('dispatch.reportNoted.title', { parcelId: p.parcelId }), said('dispatch.reportNoted.body')),
      tag: `report-note:${p.parcelId}:${p.at}`,
      data: { parcelId: p.parcelId },
      link: `/?parcel=${p.parcelId}`,
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
    // 2026-11-02 — to a person, the parcel in the Send app, where the report is (Open under the notice in the bell).
    const link = `/?parcel=${p.parcelId}`;
    const receiver = accountFor(this.parcels.receiverOf(parcel), this.persons);
    const sender = accountFor(this.parcels.senderOf(parcel), this.persons);
    if (receiver) {
      await this.tell(
        receiver.personDid,
        p.origin === 'buyer'
          ? { kind: 'claim_decided', ...noticeOf(said('dispatch.reportMade.buyer.title', { parcelId: p.parcelId }), said('dispatch.reportMade.buyer.body')), tag, data, link }
          : { kind: 'claim_decided', ...noticeOf(said('dispatch.reportMade.shop.title', { parcelId: p.parcelId }), said('dispatch.reportMade.shop.body')), tag, data, link },
      );
    }
    if (sender && sender.personDid !== receiver?.personDid) {
      // A copy is theirs too (the user, 2026-10-15): on the parcel in their own app, to read, keep and pass on.
      await this.tell(sender.personDid, { kind: 'claim_decided', ...noticeOf(said('dispatch.reportMade.sender.title', { parcelId: p.parcelId }), said('dispatch.reportMade.sender.body')), tag, data, link });
    }
    if (p.origin === 'counter' && p.raisedBy.startsWith('did:')) {
      const slot = parcel.binSlot ? said('dispatch.reportMade.slot', { slot: parcel.binSlot }) : '';
      await this.tell(p.raisedBy, { kind: 'claim_decided', ...noticeOf(said('dispatch.reportMade.counter.title', { parcelId: p.parcelId }), said('dispatch.reportMade.counter.body', { slot })), tag, data });
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
      // Two lines in the bell, and the second is where to go: the long version lost its ending to an ellipsis.
      ...noticeOf(said('dispatch.licenceSent.title', { name: p.displayName }), said('dispatch.licenceSent.body', { date: paperDayShown(p.expiresAt) })),
      tag: `papers:${p.did}:card`,
      data: { did: p.did },
      link: '/?go=drivers',
    });
  }

  private async onFreightDeliveryFailed(payload: { freightId: string; code: string; posterDid?: string; outcome: string; note?: string; destLabel?: string; attempts: number; decideBy?: string; pickupLabel?: string }): Promise<void> {
    if (!payload.posterDid) return;
    const why = payload.outcome === 'absent' ? said('dispatch.failed.why.absent') : payload.outcome === 'refused' ? said('dispatch.failed.why.refused') : payload.outcome === 'no_code' ? said('dispatch.failed.why.noCode') : said('dispatch.failed.why.other');
    const dest = payload.destLabel ?? said('dispatch.theDestination');
    const noted = payload.note ? said('dispatch.dashQuoted', { note: payload.note }) : '';
    // 2026-11-15 — no code: it went to the receiver again; if it arrived, the sender says so and the driver may deliver without it.
    const noCode = payload.outcome === 'no_code';
    // Refused: the sender decides where the goods go, and pays the way (the user, 2026-10-27) — said with the time to answer.
    const refused = payload.outcome === 'refused' && payload.decideBy && payload.pickupLabel;
    try {
      await this.notifications.notify(payload.posterDid, {
        kind: 'freight_problem',
        ...noticeOf(
          said(refused ? 'dispatch.failed.refused.title' : 'dispatch.failed.title', { code: payload.code }),
          refused
            ? said('dispatch.failed.refused.body', { dest, note: noted, pickup: payload.pickupLabel!, by: saidBy(payload.decideBy!) })
            : noCode
              ? said('dispatch.failed.noCode.body', { dest, why, note: noted })
              : said('dispatch.failed.other.body', { dest, why, note: noted }),
        ),
        // 2026-11-02 — the load itself (the owner: "wire it in"): refused, its answer comes first; otherwise its door.
        link: refused ? loadLink(payload.freightId) : loadLink(payload.freightId, 'road'),
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
        ...noticeOf(
          said('dispatch.loadHeld.title', { ref: payload.ref }),
          said('dispatch.loadHeld.body', { where: payload.stage && WHERE_SAID[payload.stage] ? said(WHERE_SAID[payload.stage]) : payload.where, finding: FINDING_SAID[payload.finding] }),
        ),
        link: loadLink(payload.unitId, 'road'),
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
        ...noticeOf(said('dispatch.loadReleased.title', { code: payload.code ?? payload.ref }), said('dispatch.loadReleased.body', { reason: payload.reason })),
        link: loadLink(payload.unitId, 'road'),
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
    const by = HELD_BY_SAID[h.by] ?? said('dispatch.heldBy.other');
    const who = h.who ? said('dispatch.paren', { who: h.who }) : '';
    const title = letGo ? said('dispatch.heldRoad.letGo.title', { code: p.code }) : said('dispatch.heldRoad.held.title', { code: p.code, by });
    const late = h.receivedAt && !letGo ? said('dispatch.heldRoad.late', { when: saidOn(h.receivedAt) }) : '';
    const body = letGo
      ? said('dispatch.heldRoad.letGo.body', { by, who, since: saidOn(h.since), until: saidOn(h.letGoAt ?? h.since), note: h.letGoNote ? said('dispatch.dashQuoted', { note: h.letGoNote }) : '' })
      : said('dispatch.heldRoad.held.body', { since: saidOn(h.since), by, who, note: h.note ? said('dispatch.dashQuoted', { note: h.note }) : '', late });
    const tag = `freight:${p.freightId}:held`;
    if (p.posterDid) await this.tell(p.posterDid, { kind: 'freight_problem', ...noticeOf(title, body), tag, data: { freightId: p.freightId }, link: loadLink(p.freightId, 'road') });
    if (p.carrierDid && p.carrierDid !== p.driverDid && p.carrierDid !== p.posterDid) {
      await this.tell(p.carrierDid, { kind: 'freight_problem', ...noticeOf(title, letGo ? body : said('dispatch.heldRoad.callDriver', { body })), tag, data: { freightId: p.freightId } });
    }
  }

  private async onFreightSealBroken(payload: { freightId: string; code: string; posterDid?: string; seal?: { number?: string; broken?: { cause?: string; note?: string } } }): Promise<void> {
    if (!payload.posterDid) return;
    const cause = payload.seal?.broken?.cause;
    const how = cause === 'police' ? said('dispatch.sealBroken.how.police') : cause === 'customs' ? said('dispatch.sealBroken.how.customs') : cause === 'repair' ? said('dispatch.sealBroken.how.repair') : cause === 'found_broken' ? said('dispatch.sealBroken.how.found') : said('dispatch.sealBroken.how.road');
    try {
      await this.notifications.notify(payload.posterDid, {
        kind: 'freight_problem',
        ...noticeOf(
          said('dispatch.sealBroken.title', { code: payload.code }),
          said('dispatch.sealBroken.body', { number: payload.seal?.number ?? '', how, note: payload.seal?.broken?.note ? said('dispatch.dashQuoted', { note: payload.seal.broken.note }) : '' }),
        ),
        link: loadLink(payload.freightId, 'seals'),
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
    const read = said('dispatch.coldChain.read', { celsius: r.celsius, when: saidOn(r.at), minC: r.band.minC, maxC: r.band.maxC });
    const late = r.receivedAt ? said('dispatch.coldChain.late', { when: saidOn(r.receivedAt) }) : '';
    const title = said('dispatch.coldChain.title', { code: p.code });
    const tag = `freight:${p.freightId}:cold_chain`;
    if (p.posterDid) {
      await this.tell(p.posterDid, { kind: 'freight_problem', ...noticeOf(title, said('dispatch.coldChain.poster', { read, late })), tag, data: { freightId: p.freightId }, link: loadLink(p.freightId, 'road') });
    }
    if (p.carrierDid && p.carrierDid !== p.driverDid && p.carrierDid !== p.posterDid) {
      await this.tell(p.carrierDid, { kind: 'freight_problem', ...noticeOf(title, said('dispatch.coldChain.carrier', { read, late })), tag, data: { freightId: p.freightId } });
    }
  }

  private async onFreightClaimDecided(payload: { freightId: string; code: string; decision: string; award: number; currency?: string; note: string; posterDid?: string; claimantDid?: string }): Promise<void> {
    const to = payload.claimantDid ?? payload.posterDid;
    if (!to) return;
    // Nobody of ours decided anything: the claimant is told where the report is, and nothing about an outcome.
    const reportOnly = payload.decision === 'report_only';
    const outcome = payload.decision === 'upheld' ? said('dispatch.dispute.outcome.upheld') : payload.decision === 'partly_upheld' ? said('dispatch.dispute.outcome.part') : said('dispatch.claim.outcome.rejected');
    try {
      await this.notifications.notify(to, {
        kind: 'claim_decided',
        ...(reportOnly
          ? noticeOf(said('dispatch.claim.report.title', { code: payload.code }), said('dispatch.claim.report.body'))
          : noticeOf(
              said('dispatch.claim.decided.title', { code: payload.code, outcome }),
              payload.award > 0 ? said('dispatch.claim.credited.body', { amount: payload.currency ? money(payload.award.toFixed(2), payload.award, payload.currency) : payload.award.toFixed(2), note: payload.note }) : said('dispatch.note.only', { note: payload.note }),
            )),
        // The poster's own claim: the load, on its claim. A receiver who claimed reads it where it receives: home.
        link: to === payload.posterDid ? loadLink(payload.freightId, 'claim') : '/',
        tag: `freight:${payload.freightId}:claim`,
        data: { freightId: payload.freightId },
      });
    } catch (err) {
      this.logger.warn(`freight-claim-decided notify failed for ${payload.freightId}: ${(err as Error).message}`);
    }
  }

  private async onFreightAssigned(payload: { freightId: string; code: string; driverDid: string; byName?: string; pickupLabel: string; destLabel: string; weightKg: number; earning?: number; currency?: string }): Promise<void> {
    try {
      await this.notifications.notify(payload.driverDid, {
        kind: 'load_assigned',
        ...noticeOf(
          said('dispatch.assigned.title', { code: payload.code }),
          said('dispatch.assigned.body', { by: payload.byName ?? said('dispatch.yourFleetOffice'), code: payload.code, kg: payload.weightKg, pickup: payload.pickupLabel, dest: payload.destLabel, earn: payload.earning != null ? said('dispatch.assigned.earn', { amount: payload.currency ? money(payload.earning.toFixed(2), payload.earning, payload.currency) : payload.earning.toFixed(2) }) : '' }),
        ),
        // 2026-11-02 — a driver's notice opens where the driver acts on it, in one tap (the owner: "drivers' safety").
        link: '/?go=loads',
        tag: `freight:${payload.freightId}`,
        data: { freightId: payload.freightId },
      });
    } catch (err) {
      this.logger.warn(`freight-assigned notify failed for ${payload.freightId}: ${(err as Error).message}`);
    }
  }

  /** To the poster: the carrier says it was paid the price agreed for this load. Their word, on the load for both sides. */
  private async onFreightPaidDirect(p: FreightPaidDirectEvent): Promise<void> {
    // 2026-11-19 — CONFIRMED BY MOLLIE (the payments plan, part 2): not anybody's word — Mollie says the payment went through.
    // The shipper is told, and the driver too, who may have walked away from the screen with the QR code on it.
    if (p.by === 'mollie') return this.onFreightPaidByMollie(p);
    if (!p.posterDid) return;
    const who = directWho(p);
    try {
      await this.notifications.notify(p.posterDid, {
        kind: 'freight_paid_direct',
        ...noticeOf(
          said('dispatch.paidDirect.title', { code: p.code }),
          said('dispatch.paidDirect.body', { who, amount: money(`${p.currency} ${p.amount.toLocaleString('en')}`, p.amount, p.currency), code: p.code, to: p.destLabel ? said('dispatch.toDest', { dest: p.destLabel }) : '' }),
        ),
        link: loadLink(p.freightId),
        tag: `freight:${p.freightId}:paid-direct`,
        data: { freightId: p.freightId },
      });
    } catch (err) {
      this.logger.warn(`freight-paid-direct notify failed for ${p.freightId}: ${(err as Error).message}`);
    }
  }

  private async onFreightPaidByMollie(p: FreightPaidDirectEvent): Promise<void> {
    const amount = money(`${p.currency} ${p.amount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, p.amount, p.currency);
    const to = p.destLabel ? said('dispatch.toDest', { dest: p.destLabel }) : '';
    const tell = async (did: string, n: ReturnType<typeof noticeOf>) => {
      try {
        await this.notifications.notify(did, { kind: 'freight_paid_direct', ...n, link: loadLink(p.freightId), tag: `freight:${p.freightId}:paid-direct`, data: { freightId: p.freightId } });
      } catch (err) {
        this.logger.warn(`freight-paid-by-mollie notify failed for ${p.freightId}: ${(err as Error).message}`);
      }
    };
    if (p.posterDid) await tell(p.posterDid, noticeOf(said('dispatch.paidMollie.poster.title', { code: p.code }), said('dispatch.paidMollie.poster.body', { amount, code: p.code, to })));
    if (p.driverDid) await tell(p.driverDid, noticeOf(said('dispatch.paidMollie.driver.title', { code: p.code, amount }), said('dispatch.paidMollie.driver.body', { amount, code: p.code, to })));
  }

  /** To the poster: the carrier says the price agreed has not been paid. The poster pays them directly; we carry no money. */
  private async onFreightNotPaidDirect(p: FreightPaidDirectEvent): Promise<void> {
    if (!p.posterDid) return;
    const who = directWho(p);
    try {
      await this.notifications.notify(p.posterDid, {
        kind: 'freight_paid_direct',
        ...noticeOf(
          said('dispatch.notPaid.title', { code: p.code }),
          said('dispatch.notPaid.body', { who, code: p.code, to: p.destLabel ? said('dispatch.toDest', { dest: p.destLabel }) : '', amount: money(`${p.currency} ${p.amount.toLocaleString('en')}`, p.amount, p.currency) }),
        ),
        // Answered on the load: that it paid, with a reference.
        link: loadLink(p.freightId),
        tag: `freight:${p.freightId}:not-paid`,
        data: { freightId: p.freightId },
      });
    } catch (err) {
      this.logger.warn(`freight-not-paid notify failed for ${p.freightId}: ${(err as Error).message}`);
    }
  }

  /** To the driver, and the office of the fleet that carried it: the shipper answers that it paid, with a reference to check. */
  private async onFreightNotPaidAnswered(p: FreightNotPaidAnswered): Promise<void> {
    const answered = noticeOf(
      said('dispatch.notPaidAnswered.title', { code: p.code }),
      said('dispatch.notPaidAnswered.body', { amount: money(`${p.currency} ${p.amount.toLocaleString('en')}`, p.amount, p.currency), code: p.code, to: p.destLabel ? said('dispatch.toDest', { dest: p.destLabel }) : '', reference: p.reference }),
    );
    for (const did of [p.driverDid, p.officeDid].filter((x): x is string => Boolean(x))) {
      try {
        // Answered under Earnings, in the Driver app and the fleet's alike (2026-11-02: a tapped notice goes there).
        await this.notifications.notify(did, { kind: 'freight_paid_direct', ...answered, link: '/?go=earnings', tag: `freight:${p.freightId}:answered`, data: { freightId: p.freightId } });
      } catch (err) {
        this.logger.warn(`not-paid-answered notify failed for ${p.freightId}: ${(err as Error).message}`);
      }
    }
  }

  /** To the driver, and the office of the fleet that carried it: delivered three days ago, were you paid? */
  private async onFreightPaidDirectAsked(p: FreightPaidDirectAsked): Promise<void> {
    const sum = money(`${p.currency} ${p.amount.toLocaleString('en')}`, p.amount, p.currency);
    const to = p.destLabel ? said('dispatch.toDest', { dest: p.destLabel }) : '';
    const asks: Array<[string, ReturnType<typeof noticeOf>]> = [
      [p.driverDid, noticeOf(said('dispatch.paidAsked.driver.title', { code: p.code }), said('dispatch.paidAsked.driver.body', { to, amount: sum }))],
      ...(p.officeDid ? [[p.officeDid, noticeOf(said('dispatch.paidAsked.office.title', { code: p.code }), said('dispatch.paidAsked.office.body', { to, amount: sum }))] as [string, ReturnType<typeof noticeOf>]] : []),
    ];
    for (const [did, n] of asks) {
      try {
        await this.notifications.notify(did, { kind: 'freight_paid_direct', ...n, link: '/?go=earnings', tag: `freight:${p.freightId}:paid-asked`, data: { freightId: p.freightId } });
      } catch (err) {
        this.logger.warn(`were-you-paid notify failed for ${p.freightId}: ${(err as Error).message}`);
      }
    }
  }

  private async onFreightHandedBack(payload: { freightId: string; code: string; driverName?: string; reason: string; posterDid?: string; managerDid?: string; destLabel?: string }): Promise<void> {
    const handedBack = noticeOf(
      said('dispatch.handedBack.title', { code: payload.code }),
      said('dispatch.handedBack.body', { driver: payload.driverName ?? said('dispatch.theDriver'), code: payload.code, to: payload.destLabel ? said('dispatch.toDest', { dest: payload.destLabel }) : '', reason: payload.reason }),
    );
    for (const to of [payload.posterDid, payload.managerDid].filter((x): x is string => Boolean(x))) {
      try {
        await this.notifications.notify(to, { kind: 'freight_problem', ...handedBack, link: to === payload.posterDid ? loadLink(payload.freightId) : '/', tag: `freight:${payload.freightId}:handback`, data: { freightId: payload.freightId } });
      } catch (err) {
        this.logger.warn(`freight-handed-back notify failed for ${payload.freightId}: ${(err as Error).message}`);
      }
    }
  }

  /** Before the 48 hours end: what happens with no answer, while there is still time to give one. */
  private async onFreightRefusalReminder(p: RefusalReminder): Promise<void> {
    if (!p.posterDid) return;
    try {
      await this.notifications.notify(p.posterDid, {
        kind: 'freight_problem',
        ...noticeOf(
          said('dispatch.refusalReminder.title', { code: p.code, by: saidBy(p.decideBy) }),
          said('dispatch.refusalReminder.body', { dest: p.destLabel ?? said('dispatch.theDoor'), pickup: p.pickupLabel, by: saidBy(p.decideBy) }),
        ),
        link: loadLink(p.freightId),
        tag: `freight:${p.freightId}:refusal-reminder`,
        data: { freightId: p.freightId },
      });
    } catch (err) {
      this.logger.warn(`refusal reminder failed for ${p.freightId}: ${(err as Error).message}`);
    }
  }

  /**
   * What became of refused goods: the driver told what to do with them — carry them on as the new load, or that they were
   * given up — and the sender told where the deadline sent them, when it was the deadline that decided.
   */
  private async onFreightRefusalDecided(p: RefusalDecided): Promise<void> {
    try {
      if (p.driverDid) {
        await this.notifications.notify(p.driverDid, {
          kind: 'load_instructions',
          ...(p.choice === 'give_up'
            ? noticeOf(said('dispatch.refusalDecided.giveUp.title', { code: p.code }), said('dispatch.refusalDecided.giveUp.body'))
            : noticeOf(
                said('dispatch.refusalDecided.carry.title', { code: p.code, dest: String(p.destLabel) }),
                said(p.byDeadline ? 'dispatch.refusalDecided.carry.deadlineBody' : 'dispatch.refusalDecided.carry.senderBody', { dest: String(p.destLabel), returnCode: String(p.returnCode) }),
              )),
          link: '/?go=loads',
          tag: `freight:${p.freightId}:refusal`,
          data: { freightId: p.returnFreightId ?? p.freightId },
        });
      }
      if (p.byDeadline && p.posterDid && p.returnCode) {
        await this.notifications.notify(p.posterDid, {
          kind: 'freight_problem',
          ...noticeOf(said('dispatch.refusalDecided.back.title', { code: p.code }), said('dispatch.refusalDecided.back.body', { dest: String(p.destLabel), returnCode: p.returnCode })),
          // The load they were refused on, which says what became of them.
          link: loadLink(p.freightId),
          tag: `freight:${p.freightId}:refusal`,
          data: { freightId: p.returnFreightId ?? p.freightId },
        });
      }
    } catch (err) {
      this.logger.warn(`refusal decided notify failed for ${p.freightId}: ${(err as Error).message}`);
    }
  }

  private async onFreightInstructed(payload: { freightId: string; code: string; driverDid: string; amended: boolean; text?: string; contactName?: string; contactPhone?: string; deliveryWindow?: string }): Promise<void> {
    const lines: Array<SayValue | undefined> = payload.amended
      ? [payload.text]
      : [payload.deliveryWindow ? said('dispatch.instructed.deliver', { window: payload.deliveryWindow }) : undefined, payload.contactName || payload.contactPhone ? said('dispatch.instructed.contact', { who: [payload.contactName, payload.contactPhone].filter(Boolean).join(', ') }) : undefined, payload.text];
    const parts = lines.filter((x): x is SayValue => Boolean(x));
    // Said as phrases: the pieces joined by " · ", two at a time.
    const body: Said = parts.length === 0 ? said('dispatch.instructed.cleared') : parts.length === 1 ? said('dispatch.note.only', { note: parts[0] }) : parts.slice(1).reduce<SayValue>((a, b) => said('dispatch.instructed.join', { first: a, second: b }), parts[0]) as Said;
    try {
      await this.notifications.notify(payload.driverDid, {
        kind: 'load_instructions',
        ...noticeOf(said(payload.amended ? 'dispatch.instructed.amended.title' : 'dispatch.instructed.changed.title', { code: payload.code }), body),
        link: '/?go=loads',
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
        ...noticeOf(
          said('dispatch.cancelled.title', { code: payload.code }),
          said('dispatch.cancelled.body', { code: payload.code, to: payload.destLabel ? said('dispatch.toDest', { dest: payload.destLabel }) : '', reason: payload.reason === COLLECTED_AT_SHOP_REASON ? said('dispatch.cancelled.reason.collectedAtShop') : payload.reason }),
        ),
        // Its capacity is free: the board, where the next load is.
        link: '/?go=board',
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
    const called = noticeOf(said('dispatch.runOff.title', { company: payload.company, originZone: payload.originZone, destZone: payload.destZone }), runCalledOffSaid(payload));
    for (const shipperDid of payload.shippers) {
      try {
        await this.notifications.notify(shipperDid, {
          kind: 'load_cancelled',
          ...called,
          // 2026-11-02 — the run, where each shipper finds its own booking (the owner: "that's why it should open").
          link: runLink(payload.departureId),
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
    const size = p.orderKg >= 1000 ? said('dispatch2.orderHandedOn.tonnes', { n: Math.round(p.orderKg / 100) / 10 }) : said('dispatch2.orderHandedOn.kg', { n: p.orderKg });
    const when = p.deliverOn ? said('dispatch.orderSplit.for', { day: day(p.deliverOn, p.deliverOn) }) : '';
    const title = p.rejoined ? said('dispatch.orderSplit.one.title', { fleet: p.fleetName, code: p.code }) : said('dispatch.orderSplit.many.title', { fleet: p.fleetName, code: p.code, loads: p.loads });
    const body = p.rejoined ? said('dispatch.orderSplit.one.body', { size, when }) : said('dispatch.orderSplit.many.body', { size, when, loads: p.loads });
    await this.tell(p.shipperDid, { kind: 'order_split', ...noticeOf(title, body), tag: `split:${p.code}:${p.loads}`, data: { loads: p.loads } });
  }

  /**
   * The shipper of an order its carrier planned outside the window it asked for. The words keep a plan a plan: "about",
   * and that the day can be planned again — and say the one thing the shipper can do with it, while there is time.
   */
  private async onOrderWindowPlanned(p: OrderWindowPlanned): Promise<void> {
    const ordered = day(p.day, p.day);
    const asked = p.window ? said('dispatch.window.asked', { window: windowSaid(p.window), day: ordered }) : said('dispatch.window.askedAny', { day: ordered });
    const estimate = said('dispatch.window.estimate');
    const data = { freightId: p.freightId };
    if (p.lateMin) {
      const by = saidSpan(p.lateMin);
      await this.tell(p.shipperDid, { kind: 'order_window', ...noticeOf(said('dispatch.window.late.title', { fleet: p.fleetName, code: p.code, arrive: p.arrive, by }), said('dispatch.window.late.body', { asked, code: p.code, arrive: p.arrive, by, estimate, fleet: p.fleetName })), tag: `window:${p.code}:late:${p.lateMin}`, data });
    } else if (p.earlyMin) {
      const by = saidSpan(p.earlyMin);
      await this.tell(p.shipperDid, { kind: 'order_window', ...noticeOf(said('dispatch.window.early.title', { fleet: p.fleetName, code: p.code, arrive: p.arrive, by }), said('dispatch.window.early.body', { asked, code: p.code, arrive: p.arrive, by, estimate, fleet: p.fleetName })), tag: `window:${p.code}:early:${p.earlyMin}`, data });
    } else {
      await this.tell(p.shipperDid, { kind: 'order_window', ...noticeOf(said('dispatch.window.inside.title', { fleet: p.fleetName, code: p.code }), said('dispatch.window.inside.body', { asked, code: p.code, arrive: p.arrive, estimate })), tag: `window:${p.code}:inside`, data });
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
      await this.tell(p.shipperDid, { kind: 'order_left_out', ...noticeOf(said('dispatch.leftOut.title', { fleet: p.fleetName, code: p.code, day: day(p.day, p.day) }), said('dispatch.leftOut.body', { because, code: p.code, fleet: p.fleetName })), tag: `left:${p.code}:${p.day}:${p.why}`, data });
    } else if (!p.arrive) {
      // On a vehicle by the office's own hand, or on a trip it had missed: no plan gave it an hour, and none is made up.
      await this.tell(p.shipperDid, { kind: 'order_window', ...noticeOf(said('dispatch.onVehicle.title', { fleet: p.fleetName, code: p.code }), said('dispatch.onVehicle.body', { fleet: p.fleetName, code: p.code })), tag: `left:${p.code}:${p.day}:on`, data });
    } else {
      const inside = p.window ? said('dispatch.planned.inside', { window: windowSaid(p.window) }) : '';
      await this.tell(p.shipperDid, { kind: 'order_window', ...noticeOf(said('dispatch.planned.title', { fleet: p.fleetName, code: p.code, day: day(p.day, p.day) }), said('dispatch.planned.body', { code: p.code, arrive: p.arrive, inside })), tag: `left:${p.code}:${p.day}:planned`, data });
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
      const where = l.status === 'in_transit' ? said('dispatch.late.where.road') : l.status === 'claimed' ? said('dispatch.late.where.driver') : said('dispatch.late.where.notOut');
      const data = { freightId: l.freightId };
      if (l.what === 'unplanned') {
        // The same fact as an order a plan left out, found by the clock instead of by a plan: its day is here.
        await this.tell(l.shipperDid, { kind: 'order_left_out', ...noticeOf(said('dispatch.late.unplanned.title', { fleet: l.fleetName, code: l.code }), said('dispatch.late.unplanned.body', { code: l.code, day: day(l.day, l.day), fleet: l.fleetName })), tag: `left:${l.code}:${l.day}:today`, data });
      } else if (l.what === 'hour') {
        await this.tell(l.shipperDid, { kind: 'order_late', ...noticeOf(said('dispatch.late.hour.title', { code: l.code }), said('dispatch.late.hour.body', { fleet: l.fleetName, arrive: String(l.arrive), where })), tag: `late:${l.code}:hour`, data });
      } else {
        await this.tell(l.shipperDid, { kind: 'order_late', ...noticeOf(said('dispatch.late.day.title', { code: l.code, day: day(l.day, l.day) }), said('dispatch.late.day.body', { fleet: l.fleetName, where })), tag: `late:${l.code}:day`, data });
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
        // 2026-11-06 — told already, before its time came, that it would be later than this (onExpectedLate): its people
        // are not told twice. Its store still hears, on its systems.
        const warned = parcel.plan?.lateTold !== undefined && Date.parse(parcel.plan.lateTold) > now;
        if (warned) {
          if (parcel.vendorId) this.vendors.notify(parcel.vendorId, 'parcel.late', { parcelId: parcel.parcelId, externalOrderId: parcel.externalOrderId, status: parcel.status, promisedAt: late.promisedAt, lateHours: late.lateHours });
          continue;
        }
        const shop = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? said('dispatch.thePickupPoint');
        const ago = lateSaid(late.lateHours);
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
              ...noticeOf(
                side === 'receiver' ? said('dispatch.parcelLate.receiver.title') : said('dispatch.parcelLate.sender.title'),
                side === 'receiver' ? said('dispatch.parcelLate.receiver.body', { shop, ago, where }) : said('dispatch.parcelLate.sender.body', { shop, ago, where }),
              ),
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

  /**
   * 2026-11-06 — WILL BE LATE, SAID BEFORE IT IS (the owner: "build as you suggest"). A parcel's plan made again — it went
   * another way, or reached a hub it was not planned to — expects it at least an hour after the time it was promised. Its
   * receiver, and a person who sent it, are told now, in the app (never a text), how much later — not when it would have
   * been past the promise. The promise is not moved: lateness is still measured against it, and when that time comes the
   * sweep does not tell them a second time (sweepParcelsLate).
   */
  private async onExpectedLate(p: { parcelId: string; promisedAt: string; expectedAt: string }): Promise<void> {
    try {
      const parcel = this.parcels.get(p.parcelId);
      if (!['At_PUDO', 'On_Bus', 'At_MDP'].includes(parcel.status)) return; // ready, or no longer on its way: nothing to warn of
      const hoursLater = Math.round(((Date.parse(p.expectedAt) - Date.parse(p.promisedAt)) / 3_600_000) * 10) / 10;
      const later = lateSaid(hoursLater);
      // 2026-11-06 — a store's own system hears it too, before the time comes (the owner: "go ahead"); a business's hears it
      // on its own (BusinessHooksService, parcel.delayed). parcel.late still follows when the time has passed.
      if (parcel.vendorId) this.vendors.notify(parcel.vendorId, 'parcel.delayed', { parcelId: parcel.parcelId, externalOrderId: parcel.externalOrderId, status: parcel.status, promisedAt: p.promisedAt, expectedAt: p.expectedAt, hoursLater });
      const shop = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? said('dispatch.thePickupPoint');
      const seen = new Set<string>();
      const sides = parcel.vendorId ? [['receiver', this.parcels.receiverOf(parcel)] as const] : ([['receiver', this.parcels.receiverOf(parcel)], ['sender', this.parcels.senderOf(parcel)]] as const);
      for (const [side, who] of sides) {
        const person = accountFor(who, this.persons);
        if (!person || seen.has(person.personDid)) continue; // a person sending to themselves is told once
        seen.add(person.personDid);
        await this.notifications.notify(person.personDid, {
          kind: 'parcel_late',
          ...noticeOf(
            side === 'receiver' ? said('dispatch.parcelLate.receiver.title') : said('dispatch.parcelLate.sender.title'),
            side === 'receiver' ? said('dispatch.expectedLate.receiver.body', { shop, later }) : said('dispatch.expectedLate.sender.body', { shop, later }),
          ),
          link: `/?parcel=${parcel.parcelId}`,
          tag: `parcel-late:${parcel.parcelId}:expected`,
          data: { parcelId: parcel.parcelId },
        });
      }
    } catch (err) {
      this.logger.warn(`expected-late notice failed for ${p.parcelId}: ${(err as Error).message}`);
    }
  }

  /**
   * 2026-11-06 — HELD UP, AND ON THE ROAD AGAIN (the owner: "notify the buyer that they will be notified when their parcel
   * is on the road again"): each parcel in a bag no driver could be found for in a day of hourly tries — its receiver, and
   * a person who sent it — told it is held up and that they are told when it moves; and, when a driver takes it on, told
   * that it does. In the app, never a text.
   */
  private async onBagHeldUp(p: { code: string; parcelIds: string[]; place: string }, what: 'held' | 'moving'): Promise<void> {
    for (const parcelId of p.parcelIds) {
      try {
        const parcel = this.parcels.get(parcelId);
        if (!['At_PUDO', 'On_Bus', 'At_MDP'].includes(parcel.status)) continue; // ready, or no longer on its way: nothing to say
        const seen = new Set<string>();
        const sides = parcel.vendorId ? [['receiver', this.parcels.receiverOf(parcel)] as const] : ([['receiver', this.parcels.receiverOf(parcel)], ['sender', this.parcels.senderOf(parcel)]] as const);
        for (const [side, who] of sides) {
          const person = accountFor(who, this.persons);
          if (!person || seen.has(person.personDid)) continue; // a person sending to themselves is told once
          seen.add(person.personDid);
          const yours = side === 'receiver' ? said('dispatch.yourParcel') : said('dispatch.aParcelYouSent');
          await this.notifications.notify(person.personDid, {
            kind: what === 'held' ? 'parcel_late' : 'parcel_moving',
            ...noticeOf(
              what === 'held' ? said('dispatch.bagHeld.held.title', { yours }) : said('dispatch.bagHeld.moving.title', { yours }),
              what === 'held'
                ? said('dispatch.bagHeld.held.body', { place: p.place })
                : side === 'receiver'
                  ? said('dispatch.bagHeld.moving.receiverBody', { place: p.place })
                  : said('dispatch.bagHeld.moving.senderBody', { place: p.place }),
            ),
            link: `/?parcel=${parcelId}`,
            tag: `parcel-${what}:${parcelId}`,
            data: { parcelId },
          });
        }
      } catch (err) {
        this.logger.warn(`${what === 'held' ? 'held-up' : 'on-the-road'} notice failed for ${parcelId}: ${(err as Error).message}`);
      }
    }
  }

  /** A load reached the other end. Whoever sent it hears it once, with who signed for it — and (D9) what they found not as the note says. */
  private async onFreightDelivered(p: { freightId: string; code: string; posterDid?: string; description?: string; destLabel?: string; receivedBy?: string; exceptions?: Array<{ kind: ReceivingExceptionKind; count: number }>; timing?: DeliveryTiming; orderedFor?: string; refusedPart?: { packages: number; of: number; decideBy: string; pickupLabel?: string } }): Promise<void> {
    if (!p.posterDid) return;
    // What the receiver found — and, said apart, a part it refused (2026-10-27): the sender decides where those go.
    const found = (p.exceptions ?? []).filter((e) => e.kind !== 'refused');
    const r = p.refusedPart;
    const pickup = r?.pickupLabel ?? said('dispatch2.freightDelivered.pickedUpWhere');
    await this.tell(p.posterDid, {
      kind: r ? 'freight_problem' : 'freight_delivered',
      ...noticeOf(
        r ? said('dispatch2.freightDelivered.titleRefused', { code: p.code, packages: r.packages, total: r.of }) : said('dispatch2.freightDelivered.title', { code: p.code }),
        said('dispatch2.freightDelivered.body', {
          when: p.timing ? said('dispatch2.freightDelivered.when', { time: p.timing.at }) : '',
          receiver: p.receivedBy ? said('dispatch2.freightDelivered.to', { name: p.receivedBy }) : '',
          place: p.destLabel ? said('dispatch2.freightDelivered.at', { place: p.destLabel }) : '',
          goods: p.description ? said('dispatch2.freightDelivered.goods', { goods: p.description.replace(/\.+$/, '') }) : '',
          timing: againstSaid(p.timing, p.orderedFor),
          found: found.length ? said('dispatch2.freightDelivered.found', { found: foundSaid(found) }) : '',
          refused: r ? said('dispatch2.freightDelivered.refused', { packages: r.packages, total: r.of, pickup, deadline: said('dispatch2.byWhen', { when: at(byWords(r.decideBy).slice(3), r.decideBy) }) }) : '',
        }),
      ),
      tag: `freight:${p.freightId}:delivered`,
      data: { freightId: p.freightId },
      link: loadLink(p.freightId),
    });
  }

  private async onOrderHandedOn(p: OrderHandedOn): Promise<void> {
    const many = p.count !== 1;
    const orders = many ? said('dispatch2.orderHandedOn.manyOrders', { count: p.count }) : (p.code ?? said('dispatch2.orderHandedOn.oneOrder'));
    const size = p.weightKg >= 1000 ? said('dispatch2.orderHandedOn.tonnes', { n: Math.round(p.weightKg / 100) / 10 }) : said('dispatch2.orderHandedOn.kg', { n: p.weightKg });
    const when = p.days.length === 1 ? said('dispatch2.orderHandedOn.daysOne', { day: day(p.days[0], p.days[0]) }) : p.days.length ? said('dispatch2.orderHandedOn.daysRange', { from: day(p.days[0], p.days[0]), to: day(p.days[p.days.length - 1], p.days[p.days.length - 1]) }) : '';
    const sizeWhen = said('dispatch2.orderHandedOn.sizeWhen', { size, when });
    const tag = `handon:${p.fromFleetDid}:${p.what}:${p.code ?? p.days.join(',')}`;
    const data = { what: p.what, count: p.count };
    // Every side of it is a fleet's, and every side is planned under Orders.
    const link = '/?go=orders';
    if (p.what === 'offered') {
      for (const to of p.toFleetDids ?? []) {
        await this.tell(to, { kind: 'order_handed_on', ...(many ? noticeOf(said('dispatch2.orderHandedOn.offeredMany.title', { fleet: p.fromFleetName, orders }), said('dispatch2.orderHandedOn.offeredMany.body', { sizeWhen })) : noticeOf(said('dispatch2.orderHandedOn.offeredOne.title', { fleet: p.fromFleetName }), said('dispatch2.orderHandedOn.offeredOne.body', { sizeWhen }))), tag, data, link });
      }
    } else if (p.what === 'withdrawn') {
      for (const to of p.toFleetDids ?? []) {
        await this.tell(to, { kind: 'order_handed_on', ...noticeOf(said('dispatch2.orderHandedOn.withdrawn.title', { fleet: p.fromFleetName }), said('dispatch2.orderHandedOn.withdrawn.body', { orders, sizeWhen })), tag, data, link });
      }
    } else if (p.what === 'taken') {
      await this.tell(p.fromFleetDid, { kind: 'order_handed_on', ...noticeOf(said('dispatch2.orderHandedOn.taken.title', { partner: p.partnerName ?? 'undefined', orders }), said('dispatch2.orderHandedOn.taken.body', { sizeWhen })), tag, data, link });
    } else if (p.what === 'ran_out') {
      // A partner that was passing an order on cannot put it on the open board: that is the fleet's it was ordered from.
      const next = p.onward ? said('dispatch2.orderHandedOn.ranOut.onward') : said('dispatch2.orderHandedOn.ranOut.noTruck');
      await this.tell(p.fromFleetDid, { kind: 'order_handed_on', ...noticeOf(said('dispatch2.orderHandedOn.ranOut.title', { orders }), said('dispatch2.orderHandedOn.ranOut.body', { sizeWhen, next })), tag, data, link });
    } else if (p.what === 'passed_on') {
      const via = p.viaName ?? 'undefined';
      const partner = p.partnerName ?? 'undefined';
      await this.tell(p.fromFleetDid, { kind: 'order_handed_on', ...(many ? noticeOf(said('dispatch2.orderHandedOn.passedMany.title', { via, orders, partner }), said('dispatch2.orderHandedOn.passedMany.body', { sizeWhen, partner })) : noticeOf(said('dispatch2.orderHandedOn.passedOne.title', { via, orders, partner }), said('dispatch2.orderHandedOn.passedOne.body', { sizeWhen, partner }))), tag, data, link });
    } else if (p.what === 'lapsed') {
      await this.tell(p.fromFleetDid, { kind: 'order_handed_on', ...noticeOf(said('dispatch2.orderHandedOn.lapsed.title', { partner: p.partnerName ?? 'undefined' }), said(many ? 'dispatch2.orderHandedOn.lapsedMany.body' : 'dispatch2.orderHandedOn.lapsedOne.body', { orders, sizeWhen })), tag, data, link });
    } else {
      await this.tell(p.fromFleetDid, { kind: 'order_handed_on', ...noticeOf(said('dispatch2.orderHandedOn.gaveBack.title', { partner: p.partnerName ?? 'undefined', orders }), said('dispatch2.orderHandedOn.gaveBack.body', { sizeWhen, reason: p.reason ?? said('dispatch2.orderHandedOn.noReason') })), tag, data, link });
    }
  }

  /** Somebody bought space on the fleet's run. What, how much, and for what — the three things the office plans around. */
  private async onSpaceSold(p: SpaceSold): Promise<void> {
    await this.tell(p.managerDid, {
      kind: 'space_sold',
      ...noticeOf(said('dispatch2.spaceSold.title', { line: p.lineName }), said('dispatch2.spaceSold.body', { weight: p.weightKg, description: p.description, price: money(`${p.price} ${p.currency}`, p.price, p.currency) })),
      tag: `departure:${p.departureId}:booking:${p.bookingId}`,
      data: { departureId: p.departureId, bookingId: p.bookingId },
      link: '/?go=runs',
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
        ...noticeOf(said('dispatch2.givenBack.shipper.title', { line: p.lineName }), said('dispatch2.givenBack.shipper.body', { description: p.description })),
        // The fleet's runs, where the space is for sale again.
        link: '/?go=runs',
        tag: `departure:${p.departureId}:booking:${p.bookingId}:cancelled`,
        data: { departureId: p.departureId, bookingId: p.bookingId },
      });
    } else if (p.by === p.managerDid) {
      // The side that used to reach nobody: the carrier took the space back, and the shipper's goods are not
      // going. WITH the carrier's reason — and the next step depends on it: goods that are not what was booked
      // can be booked again as what they are; every other reason means finding another truck.
      const why = givenBackSaid(p.reason);
      const note = p.note ? `“${p.note}”` : '';
      const reasonWords = why && note ? said('dispatch2.givenBack.joined', { words: why, note }) : why || note;
      const next = p.reason === 'goods_not_as_booked' ? said('dispatch2.givenBack.nextAgain') : said('dispatch2.givenBack.nextTruck');
      await this.tell(p.shipperDid, {
        kind: 'load_cancelled',
        ...noticeOf(
          said('dispatch2.givenBack.carrier.title', { company: p.company }),
          said('dispatch2.givenBack.carrier.body', { company: p.company, description: p.description, line: p.lineName, why: reasonWords ? said('dispatch2.givenBack.why', { reason: reasonWords }) : '', next }),
        ),
        link: runLink(p.departureId, p.bookingId),
        tag: `departure:${p.departureId}:booking:${p.bookingId}:cancelled`,
        data: { departureId: p.departureId, bookingId: p.bookingId },
      });
    }
  }

  /** A claim was opened on a load the fleet carried. The carrier is the one who has to answer it. */
  private async onRunClaimOpened(p: RunClaimOpened): Promise<void> {
    if (p.shipperDid === p.managerDid) return; // the fleet's own load: nobody here to tell
    const what = p.kind === 'damaged' ? said('dispatch2.claimOpened.damaged') : p.kind === 'short' ? said('dispatch2.claimOpened.short') : said('dispatch2.claimOpened.notReceived');
    await this.tell(p.managerDid, {
      kind: 'claim_opened',
      ...noticeOf(
        said('dispatch2.claimOpened.title', { load: p.load }),
        said('dispatch2.claimOpened.body', { what, description: p.description, amount: p.amount != null ? said('dispatch2.claimOpened.amount', { amount: money(`${p.amount} ${p.currency}`, p.amount, p.currency) }) : '' }),
      ),
      tag: `departure:${p.departureId}:claim:${p.bookingId}`,
      data: { departureId: p.departureId, bookingId: p.bookingId },
      // Where it is answered: the fleet app's Runs.
      link: '/?go=runs',
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
      ...noticeOf(
        said(p.answer === 'accepted' ? 'dispatch2.claimAnswered.accepted.title' : 'dispatch2.claimAnswered.refused.title', { company: p.company }),
        p.note ? said('dispatch2.claimAnswered.withNote.body', { load: p.load, note: p.note }) : said('dispatch2.claimAnswered.body', { load: p.load }),
      ),
      link: runLink(p.departureId, p.bookingId),
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
        ...noticeOf(said('dispatch2.vehicleChanged.title', { line: p.lineName }), said('dispatch2.vehicleChanged.body', { company: p.company, to: classSaid(p.toClass), from: classSaid(p.fromClass) })),
        link: runLink(p.departureId),
        tag: `departure:${p.departureId}:vehicle`,
        data: { departureId: p.departureId },
      });
    }
  }

  /** A document the fleet sent for its own licence or cover was read. Accepted, or not — with the reason. */
  private async onFleetPaperChecked(p: FleetPaperChecked): Promise<void> {
    const paper = p.kind === 'operator_licence' ? said('dispatch2.paperChecked.operatorLicence') : said('dispatch2.paperChecked.carrierInsurance');
    const reason = (p.reason ?? '').trimStart();
    await this.tell(p.did, {
      kind: 'papers_checked',
      ...(p.accepted
        ? noticeOf(said('dispatch2.paperChecked.recorded.title', { paper }), said('dispatch2.paperChecked.recorded.body', { date: p.expiresAt ? paperDayShown(p.expiresAt) : said('dispatch2.paperChecked.itsNewDate') }))
        : noticeOf(said('dispatch2.paperChecked.refused.title', { paper }), reason.trim() ? said('dispatch2.paperChecked.refused.body', { reason }) : said('dispatch2.paperChecked.refusedNoReason.body'))),
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
      ...noticeOf(said('dispatch2.fleetChange.joined.title', { driver: p.driverName }), said('dispatch2.fleetChange.joined.body', { driver: p.driverName, company: p.toCompany })),
      tag: `driver:${p.driverDid}:joined`,
      data: { driverDid: p.driverDid },
    });
    if (!p.fromManagerDid) return;
    await this.tell(p.fromManagerDid, {
      kind: 'roster_changed',
      ...noticeOf(said('dispatch2.fleetChange.left.title', { driver: p.driverName }), said('dispatch2.fleetChange.left.body', { driver: p.driverName })),
      tag: `driver:${p.driverDid}:left`,
      data: { driverDid: p.driverDid },
    });
  }

  /** A fleet offered this driver a place. Only they can answer, so only they are told — with how long it stays open. */
  private async onFleetOfferMade(p: FleetOfferMade): Promise<void> {
    await this.tell(p.driverDid, {
      kind: 'fleet_offer',
      ...noticeOf(said('dispatch2.fleetOffer.made.title', { company: p.companyName }), said('dispatch2.fleetOffer.made.body', { until: day(offerDay(p.expiresAt), ymdOf(p.expiresAt)) })),
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
        ...noticeOf(said('dispatch2.fleetOffer.declined.title', { ending: p.phoneEnding }), said('dispatch2.fleetOffer.declined.body')),
        tag: `fleet-offer:${p.offerId}`,
        data: { offerId: p.offerId },
      });
      return;
    }
    await this.tell(p.driverDid, {
      kind: 'fleet_offer',
      ...noticeOf(said('dispatch2.fleetOffer.withdrawn.title', { company: p.companyName }), said('dispatch2.fleetOffer.withdrawn.body')),
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
      const crew = runs.length === 1 ? said('dispatch2.driverLeft.crewOne', { run: runs[0] }) : runs.length > 1 ? said('dispatch2.driverLeft.crewMany', { count: runs.length, runs: runs.join(', ') }) : '';
      await this.tell(p.driverDid, {
        kind: 'roster_changed',
        ...noticeOf(said('dispatch2.driverLeft.own.title', { company: p.companyName }), said('dispatch2.driverLeft.stayYours')),
        tag: `driver:${p.driverDid}:removed`,
        data: { fleetDid: p.fleetDid },
      });
      await this.tell(p.fleetDid, {
        kind: 'roster_changed',
        ...noticeOf(said('dispatch2.fleetChange.left.title', { driver: p.driverName }), said('dispatch2.driverLeft.own.fleetBody', { driver: p.driverName, company: p.companyName, crew })),
        tag: `driver:${p.driverDid}:removed`,
        data: { driverDid: p.driverDid },
      });
      return;
    }
    await this.tell(p.driverDid, {
      kind: 'roster_changed',
      ...noticeOf(
        said('dispatch2.driverLeft.removed.title', { company: p.companyName }),
        removalSaid(p) ? said('dispatch2.driverLeft.removed.body', { reason: removalSaid(p) }) : said('dispatch2.driverLeft.stayYours'),
      ),
      tag: `driver:${p.driverDid}:removed`,
      data: { fleetDid: p.fleetDid },
    });
    await this.tell(p.fleetDid, {
      kind: 'roster_changed',
      ...noticeOf(said('dispatch2.driverLeft.fleetOff.title', { driver: p.driverName }), said('dispatch2.driverLeft.fleetOff.body', { driver: p.driverName, company: p.companyName })),
      tag: `driver:${p.driverDid}:removed`,
      data: { driverDid: p.driverDid },
    });
  }

  /** The office picked the vehicle; the shift is still the driver's to start. Said so they know which one, and that it waits on them. */
  private async onVehicleSuggested(p: { driverDid: string; plate: string; vehicleClass: string }): Promise<void> {
    await this.tell(p.driverDid, {
      kind: 'vehicle_today',
      ...noticeOf(said('dispatch2.vehicleToday.title', { plate: p.plate }), said('dispatch2.vehicleToday.body', { plate: p.plate, vehicleClass: classSaid(p.vehicleClass) })),
      tag: `vehicle-today:${p.driverDid}`,
      data: { plate: p.plate },
      // Its shift starts on the home screen, with that vehicle.
      link: '/?go=home',
    });
  }

  /**
   * FIVE WRONG PINS. Whoever typed them may know this person's number — a colleague, say — and the person is the only
   * one who can do anything about it, so they hear it in every inbox they read: their own and each driver record they
   * sign in as. Never a fleet's: a fleet's inbox is shared by its managers, and one person's PIN is nobody else's.
   */
  private async onSignInChanged(p: { personDid: string; driverDids: string[] }, what: string, title: string, body: string, say: ReturnType<typeof noticeOf>['say']): Promise<void> {
    for (const to of [p.personDid, ...p.driverDids]) {
      await this.tell(to, { kind: 'security', title, body, say, tag: `${what}:${p.personDid}`, data: {} });
    }
  }

  private async onPinLocked(p: { personDid: string; driverDids: string[] }): Promise<void> {
    for (const to of [p.personDid, ...p.driverDids]) {
      await this.tell(to, {
        kind: 'security',
        ...noticeOf(said('dispatch2.pinLocked.title'), said('dispatch2.pinLocked.body')),
        tag: `pin-locked:${p.personDid}`,
        data: {},
      });
    }
  }

  /**
   * `link`, where the notice is answered somewhere: `/?go=<screen>` (a screen of the app that reads it), `/?parcel=<id>`
   * (the Send app's parcel). 2026-11-02 — a tapped notification opens the app there, and Open under it in the bell goes
   * to the same place (the owner: "I need a 'mark as read' or 'respond' button"). Home otherwise.
   */
  /** 2026-11-24 — the bell for a silence in Romania (TelemetrySweeper): one tag a watch, so a long silence rings once. */
  private async onSignalLost(p: { session?: { sessionId: string; driverDid: string; fleetDid?: string; plate: string }; minutes?: number; lastPoint?: { lat: number; lng: number } }): Promise<void> {
    const s = p?.session;
    if (!s) return;
    const minutes = p.minutes ?? 15;
    const where = p.lastPoint ? said('dispatch2.signalLost.where', { lat: p.lastPoint.lat.toFixed(5), lng: p.lastPoint.lng.toFixed(5) }) : '';
    const tag = `telematics:${s.sessionId}:lost`;
    const data = { sessionId: s.sessionId, plate: s.plate, minutes };
    await this.tell(s.driverDid, { kind: 'telematics_signal_lost', ...noticeOf(said('dispatch2.signalLost.driver.title', { minutes }), said('dispatch2.signalLost.driver.body', { where })), link: '/?go=home', tag, data });
    if (s.fleetDid) await this.tell(s.fleetDid, { kind: 'telematics_signal_lost', ...noticeOf(said('dispatch2.signalLost.fleet.title', { plate: s.plate, minutes }), said('dispatch2.signalLost.fleet.body', { where })), tag, data });
  }

  /** 2026-11-24 — the bell for a code running out (FiscalCodeSweeper): one tag per code, so each is told once on each phone. */
  private async onFiscalCodeExpiring(p: FiscalCodeExpiring): Promise<void> {
    if (!p?.freightId) return;
    const country = p.country === 'RO' ? said('dispatch2.fiscal.country.RO') : said('dispatch2.fiscal.country.BG');
    const zone = p.country === 'RO' ? 'Europe/Bucharest' : 'Europe/Sofia';
    const when = said('dispatch2.fiscal.when', { time: at(new Date(p.expiresAt).toLocaleString('en-GB', { timeZone: zone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), p.expiresAt, zone), country });
    const title = p.expired ? said('dispatch2.fiscal.expired.title', { code: p.code, kind: p.kind, country }) : said('dispatch2.fiscal.expiring.title', { code: p.code, kind: p.kind, country });
    const ends = said(p.expired ? 'dispatch2.fiscal.ranOut' : 'dispatch2.fiscal.runsOut', { kind: p.kind, fiscalCode: p.fiscalCode, when });
    const tag = `fiscal:${p.freightId}:${p.country}:${p.fiscalCode}`;
    const data = { freightId: p.freightId, country: p.country, code: p.fiscalCode, expiresAt: p.expiresAt };
    if (p.senderDid) await this.tell(p.senderDid, { kind: 'fiscal_code_expiring', ...noticeOf(title, said('dispatch2.fiscal.sender.body', { ends, fine: p.country === 'RO' ? said('dispatch2.fiscal.fine') : '' })), link: loadLink(p.freightId), tag, data });
    if (p.driverDid) await this.tell(p.driverDid, { kind: 'fiscal_code_expiring', ...noticeOf(title, said('dispatch2.fiscal.driver.body', { ends })), link: '/?go=loads', tag, data });
    if (p.fleetDid) await this.tell(p.fleetDid, { kind: 'fiscal_code_expiring', ...noticeOf(title, said('dispatch2.fiscal.fleet.body', { ends })), tag, data });
  }

  private async tell(to: string, n: { kind: NotificationKind; title: string; body: string; say?: ReturnType<typeof noticeOf>['say']; tag: string; data: Record<string, unknown>; link?: string }): Promise<void> {
    try {
      await this.notifications.notify(to, { ...n, link: n.link ?? '/' });
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
        ...noticeOf(
          said('dispatch2.departureDelivered.title', { zone: payload.destZone }),
          payload.receivedBy ? said('dispatch2.departureDelivered.bodyTo', { company: payload.company, description: payload.description, receiver: payload.receivedBy }) : said('dispatch2.departureDelivered.body', { company: payload.company, description: payload.description }),
        ),
        link: runLink(payload.departureId),
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
      this.toldIfItCameBack(parcel.buyerEmail);
    } catch (err) {
      this.logger.warn(`order-on-its-way mail failed for ${parcelId}: ${(err as Error).message}`);
    }
  }

  /**
   * 2026-11-05 — A STORE'S ORDER COLLECTED: ITS RECEIVER IS ASKED, ONCE, HOW IT WAS. The rating had been there since
   * October, and nobody was asked to give one: it waited at the foot of a parcel's page for somebody to find it. A
   * store's public record is worth what its receivers say on it, so the one person who may rate the order — its
   * receiver, verified because we carried it — is asked on the bell, where the parcel's other news came. Never by text
   * (a receiver is not texted about a parcel). Not for one that went on to a business's own door: that receiver is a
   * business, not the buyer. Not once it is rated, and one notice per order — a re-published event collapses onto it.
   */
  private async onStoreOrderCollected(e: { parcelId: string; toDoor?: string }): Promise<void> {
    try {
      if (e.toDoor || !this.merchants) return;
      const parcel = this.parcels.get(e.parcelId);
      if (!parcel.vendorId || parcel.status !== 'Delivered' || this.merchants.forParcel(parcel.parcelId)) return;
      const person = accountFor(this.parcels.receiverOf(parcel), this.persons);
      if (!person) return; // a receiver with no account is asked nothing: there is nowhere to ask them
      // Asked once. The tag below folds a repeat on the phone; the bell keeps every notice, so it is looked for there.
      const asked = this.notifications.inboxFor(person.personDid).some((n) => n.kind === 'store_rate' && (n.data as { parcelId?: string } | undefined)?.parcelId === parcel.parcelId);
      if (asked) return;
      const store = this.merchants.storeOf(parcel)?.name ?? said('dispatch2.storeRate.theStore');
      await this.notifications.notify(person.personDid, {
        kind: 'store_rate',
        ...noticeOf(said('dispatch2.storeRate.title', { store }), said('dispatch2.storeRate.body')),
        // The parcel, where the rating is — one tap from the notice to the stars.
        link: `/?parcel=${parcel.parcelId}`,
        tag: `store-rate:${parcel.parcelId}`,
        data: { parcelId: parcel.parcelId, vendorId: parcel.vendorId },
      });
    } catch (err) {
      this.logger.warn(`store-rate notify failed for ${e.parcelId}: ${(err as Error).message}`);
    }
  }

  /**
   * 2026-11-15 — ON ITS WAY TO YOUR SHOP (plan R1). The first time a parcel goes on the road, its receiver — where they have
   * an account — is told once, with the shop it is going to; who has it at each hand after that is on the parcel itself
   * ("Now with …"), not on the bell. Not for one going on to a business's own door: its business is told, not its receiver.
   */
  /**
   * 2026-11-15 — A LOAD'S DELIVERY CODE TO ITS RECEIVER (plan R2). Where the poster named who receives it: with the Send app
   * on that number, they are told on the bell and see the code on the load there; without it, the code is emailed, with
   * the name the driver then checks. Never a text (rule-a-receiver-is-not-texted).
   */
  private async onDeliveryCodeIssued(freightId: string): Promise<void> {
    try {
      const f = this.dispatch.requireFreightPublic(freightId);
      if (!f.deliveryCode) return;
      // A counter's load names its walk-in sender by number: its receiver is reached by email only.
      const person = f.codeByEmailOnly ? undefined : accountFor(this.dispatch.buyerOf(f), this.persons);
      if (person) {
        await this.notifications.notify(person.personDid, {
          kind: 'load_code',
          ...noticeOf(said('dispatch2.loadCode.title', { code: f.code }), said('dispatch2.loadCode.body', { description: f.description })),
          link: '/?screen=parcels',
          tag: `load-code:${freightId}`,
          data: { freightId },
        });
        return;
      }
      if (!this.mail || !f.receiverEmail) return;
      this.dispatch.markCodeEmailed(freightId);
      await this.mail.send('load-delivery-code', { address: f.receiverEmail }, {
        code: f.deliveryCode,
        load: `${f.code} · ${f.description}`,
        from: f.postedByName ?? 'The sender',
        ...(f.receiverName ? { name: f.receiverName } : {}),
        openUrl: appUrl('send'),
      });
      this.toldIfItCameBack(f.receiverEmail);
    } catch (err) {
      this.logger.warn(`delivery code to the receiver failed for ${freightId}: ${(err as Error).message}`);
    }
  }

  /**
   * 2026-11-15 — A CODE FOR A LOAD THAT NAMES ITS RECEIVER (the owner: "yes"). Made only where the receiver can be given it
   * — the Send app on the number it names, or an email — so a driver is never stopped by a code nobody holds. The poster
   * sees it too, and can say it arrived.
   */
  private async onReceiverCodeWanted(freightId: string): Promise<void> {
    try {
      const f = this.dispatch.requireFreightPublic(freightId);
      if (f.deliveryCode || f.escrow) return;
      const reachable = Boolean(f.receiverEmail) || (!f.codeByEmailOnly && Boolean(accountFor(this.dispatch.buyerOf(f), this.persons)));
      if (reachable) this.dispatch.issueDeliveryCode(freightId);
    } catch (err) {
      this.logger.warn(`a delivery code for the receiver was not made for ${freightId}: ${(err as Error).message}`);
    }
  }

  private async onParcelOnItsWay(parcelId: string): Promise<void> {
    try {
      if (this.doors?.goesToADoor(parcelId)) return;
      const parcel = this.parcels.get(parcelId);
      if (parcel.status === 'Ready_For_Pickup' || parcel.status === 'Delivered') return;
      const person = accountFor(this.parcels.receiverOf(parcel), this.persons);
      if (!person) return;
      const told = this.notifications.inboxFor(person.personDid, 500).some((n) => n.kind === 'parcel_on_way' && (n.data as { parcelId?: string } | undefined)?.parcelId === parcelId);
      if (told) return;
      const where = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? said('dispatch2.yourPickupPoint');
      await this.notifications.notify(person.personDid, {
        kind: 'parcel_on_way',
        ...noticeOf(said('dispatch2.parcelOnWay.title'), said('dispatch2.parcelOnWay.body', { where })),
        link: `/?parcel=${parcelId}`,
        tag: `on-way:${parcelId}`,
        data: { parcelId },
      });
    } catch (err) {
      this.logger.warn(`on-its-way notify failed for ${parcelId}: ${(err as Error).message}`);
    }
  }

  /**
   * 2026-11-19 — A PARCEL ABROAD AT CUSTOMS (parcels across a border, step 3). The receiver is told what customs decided and what
   * they pay: held — what customs asks, to whom (the clearing agent, D17) and by when, and then our part at their shop; released or
   * paid — our clearance fee and the last leg, paid when they collect it (D12, D18). The sender is told of a hold, and asked what
   * is done with it when it was not paid in time (D5: back to them at their cost). In the bell; never a text.
   */
  private async onCustomsDecided(parcelId: string, step: 'released' | 'held' | 'paid' | 'lapsed' | 'someone_else' | 'given_up'): Promise<void> {
    try {
      const p = this.parcels.get(parcelId);
      const b = p.border;
      const c = b?.clearance;
      if (!b || !c) return;
      const shop = this.shopName(p.destAgentDid) ?? said('dispatch2.customs.theirShop');
      const ours = b.due ? money(`${b.due.total.toFixed(2)} ${b.due.currency}`, b.due.total, b.due.currency) : undefined;
      const owe = c.amount != null ? (c.currency ? money(`${c.amount.toFixed(2)} ${c.currency}`, c.amount, c.currency) : `${c.amount.toFixed(2)} ${c.currency ?? ''}`.trim()) : '';
      const payBy = day(c.payBy ? c.payBy.slice(0, 10) : '', c.payBy ? c.payBy.slice(0, 10) : '');
      const payee = c.payee ? said('dispatch2.customs.toPayee', { payee: c.payee }) : said('dispatch2.customs.toAgent');
      const receiver = accountFor(this.parcels.receiverOf(p), this.persons);
      const sender = accountFor(this.parcels.senderOf(p), this.persons);
      const tell = async (to: typeof receiver, words: ReturnType<typeof noticeOf>) => {
        if (!to) return;
        await this.notifications.notify(to.personDid, { kind: 'parcel_customs', ...words, link: `/?parcel=${parcelId}`, tag: `customs:${step}:${parcelId}`, data: { parcelId, step } });
      };
      if (step === 'held') {
        await tell(
          receiver,
          noticeOf(
            said('dispatch2.customs.held.receiver.title'),
            said('dispatch2.customs.held.receiver.body', { place: b.arrival.name, owe, reference: c.reference, payee, payBy, ours: ours ? said('dispatch2.customs.held.ours', { shop, ours }) : '' }),
          ),
        );
        await tell(sender, noticeOf(said('dispatch2.customs.held.sender.title'), said('dispatch2.customs.held.sender.body', { owe, payBy })));
      } else if (step === 'released' || step === 'paid') {
        await tell(receiver, noticeOf(said(step === 'paid' ? 'dispatch2.customs.paid.title' : 'dispatch2.customs.released.title'), said('dispatch2.customs.released.body', { shop, ours: ours ? said('dispatch2.customs.released.ours', { ours }) : '' })));
      } else if (step === 'lapsed') {
        // 2026-11-19 — D19: the sender chooses, in the Send app — someone else there takes it, or it is given up.
        await tell(sender, noticeOf(said('dispatch2.customs.lapsed.sender.title'), said('dispatch2.customs.lapsed.sender.body', { payBy })));
        await tell(receiver, noticeOf(said('dispatch2.customs.lapsed.receiver.title'), said('dispatch2.customs.lapsed.receiver.body', { payBy })));
      } else if (step === 'someone_else') {
        // The new receiver: what customs asks, by when, and what they then pay at the shop (D20). The new code is in the app.
        await tell(
          receiver,
          noticeOf(
            said('dispatch2.customs.someoneElse.receiver.title'),
            said('dispatch2.customs.someoneElse.receiver.body', { place: b.arrival.name, owe, reference: c.reference, payee, payBy, ours: ours ? said('dispatch2.customs.someoneElse.ours', { shop, ours }) : '' }),
          ),
        );
        await tell(sender, noticeOf(said('dispatch2.customs.someoneElse.sender.title'), said('dispatch2.customs.someoneElse.sender.body', { payBy })));
      } else if (step === 'given_up') {
        await tell(sender, noticeOf(said('dispatch2.customs.givenUp.title'), said('dispatch2.customs.givenUp.body')));
      }
    } catch (err) {
      this.logger.warn(`customs notify failed for ${parcelId}: ${(err as Error).message}`);
    }
  }

  private async onParcelReadyForPickup(parcelId: string): Promise<void> {
    try {
      // It goes on to its business's own door (2026-10-29): its receiver is not told to come for it — its business is.
      if (this.doors?.goesToADoor(parcelId)) return;
      const parcel = this.parcels.get(parcelId);
      // The email goes whether or not the buyer has an account: a push can be off, a phone can be flat, and the
      // buyer expected mail from the store's checkout anyway. The code is NOT in it — the Send app is.
      if (this.mail && parcel.buyerEmail) {
        const shop = this.shop(parcel.destAgentDid);
        const since = parcel.readyAt ?? new Date().toISOString();
        // 2026-11-15 — the store chose to email the code (plan R3), and the order gives the name the counter checks it against.
        let storeSays = false;
        try {
          storeSays = parcel.vendorId ? Boolean(this.vendors.get(parcel.vendorId).emailCodeToBuyers) : false;
        } catch {
          storeSays = false;
        }
        const code = (parcel.emailCode ?? storeSays) && parcel.receiverName && parcel.collectionCode ? parcel.collectionCode : undefined;
        if (code) this.parcels.markCodeEmailed(parcel.parcelId);
        void this.mail.send('ready-for-collection', { address: parcel.buyerEmail }, {
          ...(code ? { code, name: parcel.receiverName } : {}),
          shop: shop?.shopName ?? parcel.destZone ?? 'your pickup point',
          ...(shop?.physicalAddress || shop?.landmark ? { address: shop.physicalAddress ?? shop.landmark } : {}),
          collectBy: new Date(Date.parse(since) + UNCOLLECTED_H * 3_600_000).toISOString(),
          openUrl: `${appUrl('send')}?parcel=${encodeURIComponent(parcel.parcelId)}`,
        });
        this.toldIfItCameBack(parcel.buyerEmail);
      }
      const person = accountFor(this.parcels.receiverOf(parcel), this.persons);
      if (!person) return; // no receiver we can name, or one with no account — nothing to push to (they'll see it in-app later)

      const where = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? said('dispatch2.yourPickupPoint');
      await this.notifications.notify(person.personDid, {
        kind: 'parcel_ready',
        ...noticeOf(said('dispatch2.parcelReady.title'), said('dispatch2.parcelReady.body', { where })),
        // 2026-11-02 — the parcel itself, with its collection code: a tapped notification, or Open under it in the bell
        // (the owner: "I need a 'mark as read' or 'respond' button"). The email's link says the same.
        link: `/?parcel=${parcelId}`,
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
      // Going on to its business's door: nobody is to come for it.
      if (this.doors?.goesToADoor(parcel.parcelId)) continue;
      // "Bring your collection code" to somebody who is not being shown it is a reminder they cannot act on: it waits.
      if (this.parcels.codeHeldUntil(parcel, now)) continue;
      const person = accountFor(this.parcels.receiverOf(parcel), this.persons);
      // Stamped even when there is nobody to tell, so a receiver who signs up next week is not greeted by
      // a reminder about a parcel that has been waiting a fortnight.
      parcel.uncollectedRemindedAt = new Date(now).toISOString();
      if (!person) continue;
      try {
        const where = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? said('dispatch2.yourPickupPoint');
        await this.notifications.notify(person.personDid, {
          kind: 'parcel_ready',
          ...noticeOf(said('dispatch2.parcelWaiting.title'), said('dispatch2.parcelWaiting.body', { where })),
          link: `/?parcel=${parcel.parcelId}`,
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
      ? { kind: 'signup_rejected' as const, ...noticeOf(said('dispatch2.signup.rejected.title'), said('dispatch2.signup.rejected.body', { reason: agent.kycRejection?.reason ?? said('dispatch2.signup.rejected.wrongDocuments') })) }
      : gap === 'unfunded'
        ? { kind: 'signup_incomplete' as const, ...noticeOf(said('dispatch2.signup.unfunded.title'), said('dispatch2.signup.unfunded.body')) }
        : { kind: 'signup_incomplete' as const, ...noticeOf(said('dispatch2.signup.missing.title'), said('dispatch2.signup.missing.body', { missing: missingSaid(gap.slice('missing:'.length).split(',')) })) };

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
        ...noticeOf(said('dispatch2.driverRefused.title'), said('dispatch2.driverRefused.body', { reason: payload.reason })),
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
        ...noticeOf(
          d.safety ? said('dispatch2.defectReported.unsafe.title', { plate: p.plate, item: itemSaid(d.item) }) : said('dispatch2.defectReported.title', { plate: p.plate, item: itemSaid(d.item) }),
          said('dispatch2.defectReported.body', {
            by: d.reportedBy,
            note: d.note ? said('dispatch2.defectReported.note', { note: d.note }) : '',
            photo: d.hasPhoto ? said('dispatch2.defectReported.photo') : '',
            next: d.safety ? said('dispatch2.defectReported.nextUnsafe') : said('dispatch2.defectReported.nextSafe'),
          }),
        ),
        // 2026-11-02 — where it is decided: the fleet app's Vehicles (a tapped notification, or Open in the bell).
        link: '/?go=vehicles',
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
        ...noticeOf(
          p.state === 'overdue' ? said(p.offRoad ? 'dispatch2.serviceDue.overdueOff.title' : 'dispatch2.serviceDue.overdue.title', { plate: p.plate }) : said('dispatch2.serviceDue.soon.title', { plate: p.plate }),
          said('dispatch2.serviceDue.body', { line: p.lineSaid ?? p.line, next: p.offRoad ? said('dispatch2.serviceDue.nextOff') : said('dispatch2.serviceDue.nextOn') }),
        ),
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
      const where = b.location ? said(b.locationFrom === 'phone' ? 'dispatch2.breakdown.where.phone' : 'dispatch2.breakdown.where.last', { lat: b.location.lat.toFixed(5), lng: b.location.lng.toFixed(5) }) : said('dispatch2.breakdown.where.none');
      const aboard = b.aboard.length
        ? said('dispatch2.breakdown.aboard', { loads: b.aboard.length === 1 ? said('dispatch2.breakdown.oneLoad') : said('dispatch2.breakdown.loads', { n: b.aboard.length }), told: b.aboard.some((l) => l.shipperTold) ? said('dispatch2.breakdown.shippersTold') : '' })
        : said('dispatch2.breakdown.nothingAboard');
      const held = b.held.length ? said('dispatch2.breakdown.held', { orders: b.held.length === 1 ? said('dispatch2.breakdown.oneOrder') : said('dispatch2.breakdown.orders', { n: b.held.length }) }) : '';
      await this.tell(p.fleetDid, {
        kind: 'vehicle_breakdown',
        ...noticeOf(
          b.driverName ? said('dispatch2.breakdown.fleetDriver.title', { plate: p.plate, driver: b.driverName }) : said('dispatch2.breakdown.fleet.title', { plate: p.plate }),
          said('dispatch2.breakdown.fleet.body', { cause: causeSaid(b.cause), note: b.note, where, aboard, held }),
        ),
        tag: `breakdown:${b.breakdownId}`,
        data: { vehicleId: b.vehicleId, breakdownId: b.breakdownId, ...(b.location ? { lat: b.location.lat, lng: b.location.lng } : {}) },
      });
    }
    // A COURIER broke down with bags or parcels aboard: the couriers on a shift near it hear it, so one can go and take
    // them on (the user, 2026-10-25: "Split by the road"). Said by what there is and how far — never who the parcels are for.
    if (p.toTakeOver && b.location) {
      const bagsSaid = p.toTakeOver.bags ? (p.toTakeOver.bags === 1 ? said('dispatch2.breakdown.oneBag') : said('dispatch2.breakdown.bags', { n: p.toTakeOver.bags })) : '';
      const parcelsSaid = p.toTakeOver.parcels ? (p.toTakeOver.parcels === 1 ? said('dispatch2.breakdown.oneParcel') : said('dispatch2.breakdown.parcels', { n: p.toTakeOver.parcels })) : '';
      const what = bagsSaid && parcelsSaid ? said('dispatch2.breakdown.bagsAndParcels', { bags: bagsSaid, parcels: parcelsSaid }) : bagsSaid || parcelsSaid;
      for (const n of p.nearby ?? []) {
        await this.tell(n.driverDid, {
          kind: 'takeover_nearby',
          ...noticeOf(said('dispatch2.breakdown.nearby.title', { km: n.km }), b.driverName ? said('dispatch2.breakdown.nearbyNamed.body', { driver: b.driverName, what }) : said('dispatch2.breakdown.nearbyUnnamed.body', { what })),
          tag: `takeover:${b.breakdownId}`,
          data: { breakdownId: b.breakdownId, lat: b.location.lat, lng: b.location.lng },
          // Taken over from the home screen on shift, with the six digits.
          link: '/?go=home',
        });
      }
    }
    for (const s of p.tell) {
      await this.tell(s.shipperDid, {
        kind: 'freight_problem',
        ...noticeOf(
          s.kind === 'booking' ? said('dispatch2.breakdown.shipperBooking.title', { line: String(s.lineName) }) : s.state === 'aboard' ? said('dispatch2.breakdown.shipperAboard.title', { label: s.label }) : said('dispatch2.breakdown.shipperCollect.title', { label: s.label }),
          s.kind === 'booking'
            ? said('dispatch2.breakdown.shipperBooking.body', { carrier: carrierSaid(p.carrier), when: breakdownWhen(p), label: s.label })
            : s.state === 'aboard'
              ? said('dispatch2.breakdown.shipperAboard.body', { carrier: carrierSaid(p.carrier), when: breakdownWhen(p) })
              : said('dispatch2.breakdown.shipperCollect.body', { carrier: carrierSaid(p.carrier), when: breakdownWhen(p) }),
        ),
        tag: `breakdown:${b.breakdownId}:${s.freightId ?? s.departureId ?? s.label}`,
        data: { breakdownId: b.breakdownId, ...(s.freightId ? { freightId: s.freightId } : {}), ...(s.departureId ? { departureId: s.departureId } : {}) },
        ...(s.freightId ? { link: loadLink(s.freightId, 'road') } : s.departureId ? { link: runLink(s.departureId) } : {}),
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
        ...noticeOf(said(back ? 'dispatch2.breakdownEnd.driverBack.title' : 'dispatch2.breakdownEnd.driverWorkshop.title', { plate: p.plate }), said('dispatch2.breakdownEnd.driver.body', { by: String(b.resolvedBy), note: b.resolutionNote ?? '' })),
        link: '/?go=home',
        tag: `breakdown:${b.breakdownId}`,
        data: { vehicleId: b.vehicleId, breakdownId: b.breakdownId },
      });
    }
    for (const s of p.tell) {
      const what = s.kind === 'booking' ? said('dispatch2.breakdownEnd.whatBooking', { line: String(s.lineName) }) : said('dispatch2.breakdownEnd.whatLoad', { label: s.label });
      await this.tell(s.shipperDid, {
        kind: 'freight_problem',
        ...noticeOf(
          said(back ? 'dispatch2.breakdownEnd.back.title' : 'dispatch2.breakdownEnd.workshop.title', { what }),
          back
            ? s.state === 'aboard'
              ? said('dispatch2.breakdownEnd.backAboard.body')
              : said('dispatch2.breakdownEnd.backCollect.body')
            : s.state === 'aboard'
              ? said('dispatch2.breakdownEnd.workshopAboard.body', { carrier: carrierSaid(p.carrier) })
              : said('dispatch2.breakdownEnd.workshopCollect.body', { carrier: carrierSaid(p.carrier) }),
        ),
        tag: `breakdown:${b.breakdownId}:${s.freightId ?? s.departureId ?? s.label}:end`,
        data: { breakdownId: b.breakdownId, ...(s.freightId ? { freightId: s.freightId } : {}), ...(s.departureId ? { departureId: s.departureId } : {}) },
        ...(s.freightId ? { link: loadLink(s.freightId, 'road') } : s.departureId ? { link: runLink(s.departureId) } : {}),
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
        ...noticeOf(
          said('dispatch2.handover.courier.title', { to: h.toDriverName }),
          said('dispatch2.handover.courier.body', { what, plate: p.fromPlate, place: h.location ? said('dispatch2.handover.place', { lat: h.location.lat.toFixed(5), lng: h.location.lng.toFixed(5) }) : '', to: h.toDriverName }),
        ),
        // What the road was worth is under Earnings.
        link: '/?go=earnings',
        tag: `breakdown:${p.breakdownId}:handover`,
        data: { breakdownId: p.breakdownId },
      });
    } else if (h.proof === 'pass') {
      await this.tell(p.fleetDid, {
        kind: 'vehicle_breakdown',
        ...noticeOf(
          said('dispatch2.handover.pass.title', { from: p.fromPlate, to: h.toPlate }),
          said('dispatch2.handover.pass.body', { driver: h.toDriverName, fromDriver: p.fromDriverName ?? said('dispatch2.handover.theDriver'), what }),
        ),
        tag: `breakdown:${p.breakdownId}:handover`,
        data: { breakdownId: p.breakdownId, vehicleId: p.toVehicleId },
      });
    } else {
      await this.tell(p.toDriverDid, {
        kind: 'vehicle_breakdown',
        ...noticeOf(
          said('dispatch2.handover.office.toDriver.title', { from: p.fromPlate }),
          said('dispatch2.handover.office.toDriver.body', { by: h.by, to: h.toPlate, what, broke: h.location ? said('dispatch2.handover.office.broke', { plate: p.fromPlate, lat: h.location.lat.toFixed(5), lng: h.location.lng.toFixed(5) }) : '' }),
        ),
        link: '/?go=loads',
        tag: `breakdown:${p.breakdownId}:handover`,
        data: { breakdownId: p.breakdownId, ...(h.location ? { lat: h.location.lat, lng: h.location.lng } : {}) },
      });
      await this.tell(p.fromDriverDid, {
        kind: 'vehicle_breakdown',
        ...noticeOf(
          said('dispatch2.handover.office.fromDriver.title', { driver: h.toDriverName }),
          said('dispatch2.handover.office.fromDriver.body', { by: h.by, from: p.fromPlate, to: h.toPlate, what, driver: h.toDriverName }),
        ),
        link: '/?go=loads',
        tag: `breakdown:${p.breakdownId}:handover`,
        data: { breakdownId: p.breakdownId },
      });
    }
    for (const s of p.tell) {
      await this.tell(s.shipperDid, {
        kind: 'load_assigned',
        ...noticeOf(
          s.kind === 'booking' ? said('dispatch2.handover.shipperBooking.title', { line: String(s.lineName) }) : said('dispatch2.handover.shipperLoad.title', { label: s.label }),
          said('dispatch2.handover.shipper.body', { carrier: carrierSaid(p.carrier), collect: s.state === 'to_collect' ? said('dispatch2.handover.collect') : '' }),
        ),
        tag: `breakdown:${p.breakdownId}:${s.freightId ?? s.departureId ?? s.label}:moved`,
        data: { breakdownId: p.breakdownId, ...(s.freightId ? { freightId: s.freightId } : {}), ...(s.departureId ? { departureId: s.departureId } : {}) },
        ...(s.freightId ? { link: loadLink(s.freightId, 'road') } : s.departureId ? { link: runLink(s.departureId) } : {}),
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
        ...noticeOf(
          said(d.status === 'fixed' ? 'dispatch2.defectDecided.fixed.title' : 'dispatch2.defectDecided.safe.title', { plate: p.plate, item: itemSaid(d.item) }),
          said('dispatch2.defectDecided.body', { by: String(d.decidedBy), note: d.decisionNote ?? '', yours: d.note ? said('dispatch2.defectDecided.yours', { note: d.note }) : '' }),
        ),
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
      const dayName = new Date(`${p.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      const rosterDay = day(dayName, p.day);
      await this.notifications.notify(p.driverDid, {
        kind: 'driver_roster',
        ...(p.on
          ? noticeOf(said('dispatch2.roster.on.title', { fleet: p.fleetName, day: rosterDay }), said('dispatch2.roster.on.body'))
          : noticeOf(said('dispatch2.roster.off.title', { fleet: p.fleetName, day: rosterDay }), said('dispatch2.roster.off.body'))),
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
  /**
   * 2026-11-21 — A PLATE CLAIMED. The owner hears they are asked, with one tap to answer where it opens (the Driver app's home, a
   * fleet's Vehicles); the asker hears how it ended — and, where staff decided, both hear why. Nobody is told who owns a plate.
   */
  private async onPlateClaim(step: 'asked' | 'closed' | 'lapsed', c: PlateClaim): Promise<void> {
    const where = (p: { kind: 'driver' | 'fleet' }) => (p.kind === 'fleet' ? '/?go=vehicles' : '/?go=home');
    const data = { claimId: c.claimId, plate: c.plate, state: c.state };
    if (step === 'asked' && c.holder) {
      await this.tell(c.holder.did, {
        kind: 'plate_claim',
        ...noticeOf(said('dispatch2.plate.asked.title', { plate: c.plate }), said('dispatch2.plate.asked.body', { claimant: c.claimant.name })),
        link: where(c.holder),
        tag: `plate-claim:${c.claimId}`,
        data,
      });
      return;
    }
    if (step === 'lapsed') {
      await this.tell(c.claimant.did, {
        kind: 'plate_claim',
        ...noticeOf(said('dispatch2.plate.lapsed.title', { plate: c.plate }), c.holder ? said('dispatch2.plate.lapsedHolder.body') : said('dispatch2.plate.lapsedNobody.body')),
        link: where(c.claimant),
        tag: `plate-claim:${c.claimId}:lapsed`,
        data,
      });
      return;
    }
    const free = c.state === 'sold' || c.state === 'released' || c.state === 'freed';
    const staffReason = c.reason ?? '';
    await this.tell(c.claimant.did, {
      kind: 'plate_claim',
      ...noticeOf(
        free ? said('dispatch2.plate.free.title', { plate: c.plate }) : c.state === 'kept' ? said('dispatch2.plate.kept.title', { plate: c.plate }) : said('dispatch2.plate.stays.title', { plate: c.plate }),
        free
          ? said('dispatch2.plate.free.body', { first: c.state === 'released' ? (staffReason.trim() ? said('dispatch2.plate.freeReleased', { reason: staffReason.trimEnd() }) : said('dispatch2.plate.freeReleasedNoReason')) : said('dispatch2.plate.freeOff') })
          : c.state === 'kept'
            ? said('dispatch2.plate.kept.body')
            : staffReason.trim()
              ? said('dispatch2.plate.staffLooked', { reason: staffReason.trimEnd() })
              : said('dispatch2.plate.staffLookedNoReason'),
      ),
      link: where(c.claimant),
      tag: `plate-claim:${c.claimId}:closed`,
      data,
    });
    if (c.state === 'released' && c.holder) {
      await this.tell(c.holder.did, {
        kind: 'plate_claim',
        ...noticeOf(said('dispatch2.plate.released.title', { plate: c.plate }), said('dispatch2.plate.released.body', { reason: c.reason ?? '' })),
        link: where(c.holder),
        tag: `plate-claim:${c.claimId}:released`,
        data,
      });
    }
  }

  private async onRideAloneDecided(payload: { did: string; approved: boolean; reason?: string; companyName?: string }): Promise<void> {
    try {
      await this.notifications.notify(payload.did, {
        kind: 'papers_checked',
        ...(payload.approved
          ? noticeOf(said('dispatch2.rideAlone.approved.title'), said('dispatch2.rideAlone.approved.body', { company: payload.companyName ? said('dispatch2.rideAlone.company', { company: payload.companyName }) : '' }))
          : noticeOf(said('dispatch2.rideAlone.refused.title'), (payload.reason ?? '').trim() ? said('dispatch2.rideAlone.refused.body', { reason: (payload.reason ?? '').trimStart() }) : said('dispatch2.rideAlone.refusedNoReason.body'))),
        // 2026-11-02 — yes: a shift starts on the home screen. No: asked again in "Your fleet", a sheet the Driver app
        // opens itself on a tap (it is named in `data`, as a sheet has no address).
        link: payload.approved ? '/?go=home' : '/',
        tag: `ride-alone:${payload.did}:${Date.now()}`,
        data: { did: payload.did, about: 'ride_alone', approved: payload.approved },
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
      const where = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? said('dispatch2.yourPickupPoint');
      const person = accountFor(this.parcels.receiverOf(parcel), this.persons);
      // The rate fixed when the free time ended, in the money of the company whose shop holds it.
      const holding = this.parcels.holdingTermsOf(parcel);
      if (person) {
        await this.notifications.notify(person.personDid, {
          kind: 'parcel_ready',
          ...noticeOf(said('dispatch2.parcelUnclaimed.title'), said('dispatch2.parcelUnclaimed.body', { where, rate: money(`${holding.currency} ${holding.perDay.toFixed(2)}`, holding.perDay, holding.currency) })),
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
      const where = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? said('dispatch2.yourPickupPoint');
      // 2026-11-15 — its code was emailed: the new one is emailed too, with the same name check (the owner: "as recommended").
      // Never when the code changed because the account moved: that account is shown no code for a day, and nor is its email.
      if (this.mail && !quietFor && parcel.codeEmailedAt && parcel.buyerEmail && parcel.receiverName && parcel.collectionCode && (parcel.status === 'Ready_For_Pickup' || parcel.status === 'Unclaimed')) {
        const shop = this.shop(parcel.destAgentDid);
        this.parcels.markCodeEmailed(parcel.parcelId);
        void this.mail.send('ready-for-collection', { address: parcel.buyerEmail }, {
          shop: shop?.shopName ?? parcel.destZone ?? 'your pickup point',
          ...(shop?.physicalAddress || shop?.landmark ? { address: shop.physicalAddress ?? shop.landmark } : {}),
          collectBy: new Date(Date.parse(parcel.readyAt ?? new Date().toISOString()) + UNCOLLECTED_H * 3_600_000).toISOString(),
          openUrl: `${appUrl('send')}?parcel=${encodeURIComponent(parcel.parcelId)}`,
          code: parcel.collectionCode,
          name: parcel.receiverName,
          reissued: true,
        });
      }
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
          ...noticeOf(said('dispatch2.codeReissued.title'), said('dispatch2.codeReissued.body', { where })),
          link: `/?parcel=${parcelId}`,
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

      // 2026-11-23 — a bag on a road route: told only to the drivers of the route's fleet, and opened where its whole load is (step 3c).
      const nearby = this.nearbyActiveDrivers(pickup).filter((d) => this.dispatch.roadBagFor(d.driverDid, tote.code).may);
      if (nearby.length === 0) return;
      const road = this.dispatch.roadBagFor(nearby[0].driverDid, tote.code).to;

      const where = tote.destinationLabel ?? payload.destination;
      await Promise.all(
        nearby.map((d) =>
          this.notifications.notify(d.driverDid, {
            kind: 'load_nearby',
            ...noticeOf(said('dispatch2.loadNearYou.title'), where ? said('dispatch2.toteNearby.body', { where }) : said('dispatch2.toteNearby.bodyNoPlace')),
            link: road ? '/?go=home' : '/?go=route',
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
      const earned = offer.earn ?? offer.price?.total ?? terms.bagLoadPay;
      const earn = money(`${terms.currency} ${earned.toFixed(2)}`, earned, terms.currency);
      const what = offer.kind === 'tote' ? said('dispatch2.offer.bag') : said('dispatch2.offer.load');
      // What it costs, in the unit a driver spends. Kilometres are an abstraction at the wheel — and a
      // driver carrying passengers cannot justify eight kilometres to a bus, while "six minutes" is a
      // sentence everybody aboard understands. Two figures because they are two different commitments: the
      // detour to go and get it, and the time that carrying it then costs on top.
      const cost =
        offer.collectMin == null
          ? said('dispatch2.offer.minAway', { minutes: offer.minutesAway }) // an offer minted before the time figures existed
          : offer.deliverMin != null
            ? said('dispatch2.offer.collectDrop', { collect: offer.collectMin, drop: offer.deliverMin })
            : said('dispatch2.offer.collect', { collect: offer.collectMin }); // a destination we could not place — say less, not more
      await this.notifications.notify(driverDid, {
        kind: 'load_nearby',
        // Two buttons is what a phone gives us, and two is what the decision has. "Not now" carries a
        // one-shot capability so the service worker can free the load without holding the driver's session.
        // 2026-11-26 — the buttons in the phone's language too.
        ...noticeOf(said('dispatch2.offer.title', { what, destination: offer.destLabel, earn }), said('dispatch2.offer.body', { cost, weight: offer.weightKg, pickup: offer.pickupLabel }), [
          { action: 'take', title: said('bell.button.take') },
          { action: 'no', title: said('bell.button.notNow') },
        ]),
        link: `/?offer=${offer.offerId}`, // one tap → that one card, with the claim button on it
        tag: `load:${offer.ref}`,
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
      const where = payload.destination ? said('dispatch2.bag.where', { destination: payload.destination }) : '';
      const full = payload.reason !== 'max_wait';
      await this.notifications.notify(agentDid, {
        kind: 'bag_ready_to_close',
        ...(full
          ? noticeOf(said('dispatch2.bagFull.title'), said('dispatch2.bagFull.body', { code: payload.code, where }))
          : noticeOf(said('dispatch2.bagOpen.title'), said('dispatch2.bagOpen.body', { code: payload.code, where }))),
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
    return this.driversWithin(pickup, NotificationDispatcher.NEARBY_DRIVER_KM, NotificationDispatcher.NEARBY_DRIVER_CAP, true);
  }

  /**
   * 2026-11-06 — A CLOSED BAG NOBODY NEAR HAS TAKEN, OFFERED FURTHER AWAY (the owner: "go ahead"). As it closed it was
   * offered to the drivers within NEARBY_DRIVER_KM heading its way. Still taken by nobody after BAGS_WAITING_H, it is
   * offered once more to every working driver within WIDE_OFFER_KM — not the ones near and heading its way, told already —
   * each their own offer at their own rate, which the notice opens in one tap. Once a bag: an offer asked twice is one a
   * driver learns to ignore. A bag held for room at a full hub, or held under the tamper protocol, is not offered.
   */
  async sweepBagsWaiting(now: number = Date.now()): Promise<number> {
    let offered = 0;
    for (const tote of this.totes.list()) {
      if (tote.status !== 'available' || tote.waitsForRoom || tote.held || tote.offeredWideAt) continue;
      const since = tote.sealedAt ?? tote.availableAt;
      if (!since || now - Date.parse(since) < BAGS_WAITING_H * 3_600_000) continue;
      const place = this.dispatch.pickupPlace(tote.locationId);
      if (!place) continue;
      this.totes.markOfferedWide(tote.code, new Date(now).toISOString());
      const hours = Math.floor((now - Date.parse(since)) / 3_600_000);
      for (const d of this.driversWithin(place.loc, WIDE_OFFER_KM, WIDE_OFFER_CAP, false)) {
        if (d.km <= NotificationDispatcher.NEARBY_DRIVER_KM && this.dispatch.worksNear(d.driverDid, place.loc)) continue; // told as it closed
        const offer = this.dispatch.offerBagTo(d.driverDid, tote.code, now);
        if (!offer) continue;
        offered += 1;
        await this.notifications
          .notify(d.driverDid, {
            kind: 'load_nearby',
            ...noticeOf(
              said('dispatch2.bagWaiting.title'),
              said('dispatch2.bagWaiting.body', { place: place.label, heading: tote.destinationLabel ? said('dispatch2.bagWaiting.heading', { destination: tote.destinationLabel }) : '', hours, km: Math.round(d.km) }),
            ),
            link: `/?offer=${offer.offerId}`,
            tag: `load:${tote.code}:waiting`,
            data: { code: tote.code, offerId: offer.offerId },
          })
          .catch(() => undefined);
      }
    }
    return offered;
  }

  /** The working drivers within a distance of a place: fresh positions, not past their hours, nearest first — and, asked, heading there. */
  private driversWithin(pickup: GeoPoint, radiusKm: number, cap: number, heading: boolean): Array<{ driverDid: string; km: number }> {
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
      .filter((d) => d.km <= radiusKm)
      // …and HEADING there. Near is only half the question: a driver leaving town for the south is metres
      // from a bag going north. A driver who declared no leg is kept — we cannot say they are not going.
      .filter((d) => !heading || this.dispatch.worksNear(d.driverDid, pickup))
      .sort((a, b) => a.km - b.km)
      .slice(0, cap);
  }

  /**
   * The GENESIS scenario (Rule 4): a parcel was minted, so tell its DROP-OFF PUDO to expect it. The
   * recipient is the origin agent DID carried on the event; a mint whose origin isn't a real PUDO agent
   * (defensive — a hub/unknown node) is skipped. The copy differs for a vendor order vs a person's
   * peer-send (read from the parcel), but neither the fare nor any secret rides the lock screen — the
   * agent sees the cash due + details in-app when they scan it in.
   */
  /**
   * 2026-11-05 — A SHOP WITH NO PLACE LEFT IS ASKED TO MAKE ROOM (the owner: "notify the shop to consider opening more shelf
   * space in their app"). Bookings for it are refused and sent to shops near it with room; the shop is told once in twelve
   * hours however many were turned away, and the notice opens its shelf. A new shop at its parcel limit is told that instead:
   * its limit grows as it hands parcels on, and more shelf would not help it.
   */
  private async onBookingTurnedAway(payload: { agentDid: string; reason: 'shelf' | 'cap' }): Promise<void> {
    try {
      if (!this.agents.find(payload.agentDid)) return;
      const since = Date.now() - 12 * 3_600_000;
      const told = this.notifications.inboxFor(payload.agentDid).some((n) => n.kind === 'shelf_full' && Date.parse(n.createdAt) > since);
      if (told) return;
      const cap = payload.reason === 'cap';
      await this.notifications.notify(payload.agentDid, {
        kind: 'shelf_full',
        ...(cap
          ? noticeOf(said('dispatch2.shelfFull.cap.title'), said('dispatch2.shelfFull.cap.body'))
          : noticeOf(said('dispatch2.shelfFull.shelf.title'), said('dispatch2.shelfFull.shelf.body'))),
        link: '/?go=shelf',
        tag: `shelf-full:${payload.agentDid}`,
        data: { agentDid: payload.agentDid, reason: payload.reason },
      });
    } catch (err) {
      this.logger.warn(`shelf-full notice failed for ${payload.agentDid}: ${(err as Error).message}`);
    }
  }

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
        ...noticeOf(said('dispatch2.minted.title'), isPeerSend ? said('dispatch2.minted.peer.body') : said('dispatch2.minted.store.body')),
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
  private async onFreightPosted(payload: { freightId: string; destLabel?: string; pickupLocation?: GeoPoint; raisedTo?: number; currency?: string }): Promise<void> {
    try {
      if (!payload.pickupLocation) return;
      // Unlike a tote (any bus carries it), a dedicated freight needs a fit vehicle. Ping only the nearby
      // drivers whose CURRENT vehicle could actually carry it — a bike driver never gets a pallet alert.
      // (claim() re-checks capability regardless; this just keeps the audience honest.)
      const nearby = this.nearbyActiveDrivers(payload.pickupLocation).filter((d) => this.dispatch.freightCarryableByDriver(payload.freightId, d.driverDid));
      if (nearby.length === 0) return;
      // Its most raised (2026-10-27): news, said as such — its own notice, so a phone that showed the first alerts again
      // rather than quietly replacing it, and with the new most a driver weighs their price against.
      const raisedEn = payload.raisedTo != null ? `${payload.currency ? `${payload.currency} ` : ''}${payload.raisedTo.toLocaleString('en')}` : undefined;
      const raised = raisedEn !== undefined && payload.raisedTo != null ? (payload.currency ? money(raisedEn, payload.raisedTo, payload.currency) : raisedEn) : undefined;
      await Promise.all(
        nearby.map((d) =>
          this.notifications.notify(d.driverDid, {
            kind: 'load_nearby',
            ...noticeOf(
              raised ? said('dispatch2.freightNear.raised.title') : said('dispatch2.loadNearYou.title'),
              raised
                ? said('dispatch2.freightNear.raised.body', { load: payload.destLabel ? said('dispatch2.freightNear.theLoadTo', { destination: payload.destLabel }) : said('dispatch2.freightNear.aFreightLoad'), raised })
                : payload.destLabel
                  ? said('dispatch2.freightNear.body', { destination: payload.destLabel })
                  : said('dispatch2.freightNear.bodyNoPlace'),
            ),
            // 2026-11-02 — claimed on the Driver app's board: a tapped notification, or Open in the bell, goes there.
            link: '/?go=board',
            tag: raised ? `freight:${payload.freightId}:raised:${payload.raisedTo}` : `freight:${payload.freightId}`,
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
        ...noticeOf(said('dispatch2.busInbound.title'), n > 0 ? said('dispatch2.busInbound.body', { n }) : said('dispatch2.busInbound.bodyNone')),
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

/* 2026-11-26 — the pieces of the notices above that are said in words of their own (notice-words/en/dispatcher-b.ts). */

/** The calendar day (UTC) of a moment, as YYYY-MM-DD; empty where it is not a moment. */
function ymdOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** A span of minutes as somebody says it (see spanWords): "40 minutes", "1 hour", "2 hours 05 minutes". */
function spanSaid(minutes: number): Said {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  if (h === 0) return said('dispatch2.span.minutes', { n: m });
  const hours = said('dispatch2.span.hours', { n: h });
  return m % 60 === 0 ? hours : said('dispatch2.span.hoursMinutes', { hours, minutes: String(m % 60).padStart(2, '0') });
}

/** Where a handover fell against what was asked (see againstWhatWasAsked), or nothing. */
function againstSaid(t: DeliveryTiming | undefined, orderedFor: string | undefined): Said | '' {
  if (!t) return '';
  if (t.otherDay === 'late') return said('dispatch2.against.lateDay', { ordered: orderedFor ? day(orderedFor, orderedFor) : said('dispatch2.against.anEarlierDay'), arrived: day(t.day, t.day) });
  if (t.otherDay === 'early') return said('dispatch2.against.earlyDay', { ordered: orderedFor ? day(orderedFor, orderedFor) : said('dispatch2.against.aLaterDay'), arrived: day(t.day, t.day) });
  if (!t.window) return '';
  if (t.lateMin) return said('dispatch2.against.after', { span: spanSaid(t.lateMin), window: windowSaid(t.window) });
  if (t.earlyMin) return said('dispatch2.against.before', { span: spanSaid(t.earlyMin), window: windowSaid(t.window) });
  return said('dispatch2.against.inside', { window: windowSaid(t.window) });
}

const FOUND_KEYS = {
  short: 'dispatch2.found.short',
  over: 'dispatch2.found.over',
  damaged: 'dispatch2.found.damaged',
  wrong: 'dispatch2.found.wrong',
  refused: 'dispatch2.found.refused',
} as const satisfies Record<ReceivingExceptionKind, string>;

/** What the receiver found (see exceptionsInWords): "3 packages short, 2 packages damaged", in the note's order. */
function foundSaid(list: ReadonlyArray<{ kind: ReceivingExceptionKind; count: number }>): Said | '' {
  let out: Said | '' = '';
  for (const e of list) {
    const one = said(FOUND_KEYS[e.kind], { n: e.count });
    out = out === '' ? one : said('dispatch2.list', { first: out, next: one });
  }
  return out;
}

/** The carrier's reason for giving a booking back (see GIVE_BACK_WORDS); nothing for `other`. */
function givenBackSaid(reason: string | undefined): Said | '' {
  switch (reason) {
    case 'vehicle_unavailable':
      return said('dispatch2.givenBack.reason.vehicle_unavailable');
    case 'no_driver':
      return said('dispatch2.givenBack.reason.no_driver');
    case 'goods_not_as_booked':
      return said('dispatch2.givenBack.reason.goods_not_as_booked');
    case 'overbooked':
      return said('dispatch2.givenBack.reason.overbooked');
    default:
      return '';
  }
}

/** Why a fleet took a driver off (see removalSentence), or nothing. */
function removalSaid(p: Pick<DriverLeftFleet, 'reason' | 'note'>): Said | '' {
  if (p.reason === 'left') return said('dispatch2.driverLeft.reasonLeft');
  if (p.reason === 'ended') return said('dispatch2.driverLeft.reasonEnded');
  return p.note ? said('dispatch2.driverLeft.reasonNote', { note: p.note }) : '';
}

/** What a shop's application still lacks (see wordsFor): "a copy of your ID, your trading licence and photos of the shop". */
function missingSaid(missing: string[]): Said | string {
  const items: Array<Said | string> = missing.map((m) => (m === 'id' ? said('dispatch2.signup.missing.id') : m === 'licence' ? said('dispatch2.signup.missing.licence') : m === 'photos' ? said('dispatch2.signup.missing.photos') : m));
  if (items.length <= 1) return items[0] ?? said('dispatch2.signup.missing.documents');
  let lead = items[0];
  for (let i = 1; i < items.length - 1; i += 1) lead = said('dispatch2.list', { first: lead, next: items[i] });
  return said('dispatch2.and', { list: lead, last: items[items.length - 1] });
}

/** A part of a vehicle, in lower case, as a defect notice names it (see ITEM_WORDS). */
function itemSaid(item: keyof typeof ITEM_WORDS): Said {
  const keys = {
    tyres: 'dispatch2.item.tyres',
    brakes: 'dispatch2.item.brakes',
    lights: 'dispatch2.item.lights',
    mirrors: 'dispatch2.item.mirrors',
    horn: 'dispatch2.item.horn',
    wipers: 'dispatch2.item.wipers',
    leaks: 'dispatch2.item.leaks',
    chain: 'dispatch2.item.chain',
    load_gear: 'dispatch2.item.load_gear',
    body: 'dispatch2.item.body',
    other: 'dispatch2.item.other',
  } as const satisfies Record<keyof typeof ITEM_WORDS, string>;
  return said(keys[item]);
}

/** What broke, as a breakdown notice starts with it (see CAUSE_WORDS). */
function causeSaid(cause: keyof typeof CAUSE_WORDS): Said {
  const keys = {
    engine: 'dispatch2.cause.engine',
    tyre: 'dispatch2.cause.tyre',
    electrical: 'dispatch2.cause.electrical',
    brakes: 'dispatch2.cause.brakes',
    fuel: 'dispatch2.cause.fuel',
    accident: 'dispatch2.cause.accident',
    other: 'dispatch2.cause.other',
  } as const satisfies Record<keyof typeof CAUSE_WORDS, string>;
  return said(keys[cause]);
}
