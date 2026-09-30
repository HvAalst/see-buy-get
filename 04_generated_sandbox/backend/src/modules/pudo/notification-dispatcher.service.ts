import { UNCOLLECTED_H } from './pudo.config';
import { appUrl } from '../../foundation/mail/mail.templates';
import { MailService } from '../../foundation/mail/mail.service';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { NotificationService } from './notification.service';
import { ParcelService } from './parcel.service';
import { PersonService } from './person.service';
import { AgentService, signupGapOf } from './agent.service';
import { FleetService } from './fleet.service';
import { ToteService } from './tote.service';
import { MdpService } from './mdp.service';
import { DispatchService } from './dispatch.service';
import { haversineKm } from './geo';
import { paperDay } from './papers';
import { GeoPoint } from './pudo.types';
import type { NotificationKind } from './notification.types';
import type { GiveBackReason } from './departure.types';

/* The payloads the run's events carry, as published in DepartureService and FleetManagerService. */
interface SpaceSold { departureId: string; bookingId: string; managerDid: string; lineName: string; shipperDid: string; description: string; weightKg: number; price: number; currency: string }
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
interface FleetPaperChecked { did: string; kind: 'operator_licence' | 'carrier_insurance'; accepted: boolean; expiresAt?: string; reason?: string }
import { UnclaimedService } from './unclaimed.service';
import { VendorService } from './vendor.service';
import { HOLDING_FEE_PER_DAY, MARKET_SUPPLY_STALE_MIN, NETWORK_CURRENCY, NUDGE_COOLDOWN_MIN, NUDGE_MIN_MOVE_KM, TOTE_LOAD_FEE, UNCOLLECTED_REMINDER_H, UNCOLLECTED_SWEEP_MS } from './pudo.config';

/** How often to look for somebody who started joining and stopped. */
const SIGNUP_SWEEP_MS = 60 * 60 * 1000;

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
  }

  onModuleDestroy(): void {
    if (this.uncollectedTimer) clearInterval(this.uncollectedTimer);
    if (this.signupTimer) clearInterval(this.signupTimer);
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
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelReleaseCodeReissued, (e) =>
      this.onReleaseCodeReissued(e.payload.parcelId),
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
    this.events.subscribe<{ departureId: string; company: string; lineName: string; originZone: string; destZone: string; leavesAt: string; shippers: string[]; reason: string }>(GlosEvent.Pudo.DepartureCancelled, (e) => this.onDepartureCancelled(e.payload));
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
    this.events.subscribe<BookingGivenBack>(GlosEvent.Pudo.DepartureBookingCancelled, (e) => this.onBookingGivenBack(e.payload));
    this.events.subscribe<RunClaimOpened>(GlosEvent.Pudo.DepartureClaimOpened, (e) => this.onRunClaimOpened(e.payload));
    this.events.subscribe<RunClaimAnswered>(GlosEvent.Pudo.DepartureClaimAnswered, (e) => this.onRunClaimAnswered(e.payload));
    // The fleet's own licence or cover: a document it sent was recorded, or turned down with a reason.
    this.events.subscribe<FleetPaperChecked>(GlosEvent.Pudo.FleetPaperChecked, (e) => this.onFleetPaperChecked(e.payload));
    // FP3b (sender) — the driver is at the door and cannot hand over: the sender is the one who can fix it.
    this.events.subscribe<{ freightId: string; code: string; posterDid?: string; outcome: string; note?: string; destLabel?: string; attempts: number }>(GlosEvent.Pudo.FreightDeliveryFailed, (e) => this.onFreightDeliveryFailed(e.payload));
    // FP3b (claimant) — their claim was decided; they are shown the reason.
    this.events.subscribe<{ freightId: string; code: string; decision: string; award: number; note: string; posterDid?: string; claimantDid?: string }>(GlosEvent.Pudo.FreightClaimDecided, (e) => this.onFreightClaimDecided(e.payload));
    // ONBOARDING (applicant) — they finished the form and are not finished. Told now, while they are still
    // holding the phone; the sweep below is for everyone this event never fired for.
    this.events.subscribe<{ did: string; shopName?: string }>(GlosEvent.Pudo.AgentRegistered, (e) => this.onSignupStalled(e.payload.did));
    // ONBOARDING (applicant) — we looked and said no. A decision they are shown, with its reason.
    this.events.subscribe<{ did: string; reason: string }>(GlosEvent.Pudo.AgentKycRejected, (e) => this.onSignupStalled(e.payload.did));
    // …and the same for a driver, who was left in exactly the same silence.
    this.events.subscribe<{ did: string; reason: string }>(GlosEvent.Pudo.DriverKycRejected, (e) => this.onDriverRefused(e.payload));
    // FP4 (courier) — the renewed licence they sent was checked. They sent it and are waiting: either answer.
    this.events.subscribe<{ did: string; accepted: boolean; expiresAt?: string; reason?: string }>(GlosEvent.Pudo.DriverLicenceChecked, (e) => this.onLicenceChecked(e.payload));

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

  private async onFreightClaimDecided(payload: { freightId: string; code: string; decision: string; award: number; note: string; posterDid?: string; claimantDid?: string }): Promise<void> {
    const to = payload.claimantDid ?? payload.posterDid;
    if (!to) return;
    const outcome = payload.decision === 'upheld' ? 'upheld' : payload.decision === 'partly_upheld' ? 'upheld in part' : 'rejected';
    try {
      await this.notifications.notify(to, {
        kind: 'claim_decided',
        title: `Your claim on ${payload.code} was ${outcome}`,
        body: `${payload.award > 0 ? `${payload.award.toFixed(2)} is credited to your balance. ` : ''}${payload.note}`,
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
  private async onDepartureCancelled(payload: { departureId: string; company: string; lineName: string; originZone: string; destZone: string; leavesAt: string; shippers: string[]; reason: string }): Promise<void> {
    for (const shipperDid of payload.shippers) {
      try {
        await this.notifications.notify(shipperDid, {
          kind: 'load_cancelled',
          title: `${payload.company} called off the ${payload.originZone} → ${payload.destZone} run`,
          body: `The run you booked space on is not happening${payload.reason ? `: ${payload.reason}` : ''}. Your goods were not collected — you will need another truck.`,
          link: '/',
          tag: `departure:${payload.departureId}:cancelled`,
          data: { departureId: payload.departureId },
        });
      } catch (err) {
        this.logger.warn(`departure-cancelled notify failed for ${shipperDid}: ${(err as Error).message}`);
      }
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

  /** One notification, and one failure logged rather than thrown — the house rule for every handler here. */
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
   * carries only the parcelId, so we read the parcel for the receiver's phoneHash, resolve it to their
   * person account, and push. A receiver with no account yet (never signed up) is silently skipped —
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
      const hash = parcel.receiverPhoneHash;
      if (!hash) return; // no receiver identity on this parcel (e.g. a legacy record) — nothing to target
      const person = this.persons.findByHash(hash);
      if (!person) return; // the receiver has no account — nothing to push to (they'll see it in-app later)

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
      const hash = parcel.receiverPhoneHash;
      const person = hash ? this.persons.findByHash(hash) : undefined;
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
      const hash = parcel.receiverPhoneHash;
      const person = hash ? this.persons.findByHash(hash) : undefined;
      if (person) {
        await this.notifications.notify(person.personDid, {
          kind: 'parcel_ready',
          title: 'Time to collect your parcel',
          body: `It is still at ${where} and still yours. Holding now costs ${HOLDING_FEE_PER_DAY} a day — tell us what you want to do.`,
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
  private async onReleaseCodeReissued(parcelId: string): Promise<void> {
    try {
      const parcel = this.parcels.get(parcelId);
      const where = this.shopName(parcel.destAgentDid) ?? parcel.destZone ?? 'your pickup point';
      // On a PEER SEND the sender is told as well: they are the relay to a receiver with no app (the same
      // role the store plays on a vendor order), so a rotated code that reached only the receiver would
      // strand exactly the person the relay exists for. A vendor order tells the buyer only — its store
      // gets the new code over the callback instead.
      const targets = parcel.vendorId ? [parcel.receiverPhoneHash] : [parcel.receiverPhoneHash, parcel.senderPhoneHash];
      const seen = new Set<string>();
      for (const hash of targets) {
        if (!hash) continue;
        const person = this.persons.findByHash(hash);
        if (!person || seen.has(person.personDid)) continue; // a person sending to themselves is told once
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
      const earn = `${NETWORK_CURRENCY} ${(offer.earn ?? offer.price?.total ?? TOTE_LOAD_FEE).toFixed(2)}`;
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
