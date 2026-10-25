import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { EntityService } from '../../foundation/entity/entity.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { ConsignmentNoteService } from './consignment-note.service';
import { DispatchService, LATE_GRACE_MIN } from './dispatch.service';
import type { Freight } from './dispatch.types';
import { clockAt, clocksOfCountry, zoneName } from './fleet-clock';
import { INBOUND_CLOSINGS, type InboundClosed, type InboundClosingHow, type InboundDue, type InboundRow, type InboundView, type ReceivingPointNamed, type ReceivingPointView } from './inbound.types';
import { NotificationService } from './notification.service';
import { exceptionViewsOf, exceptionsInWords, stillExpectedOf } from './receiving';
import { Site, SiteService } from './site.service';

/** How long a load that has arrived, or was withdrawn, stays on the list after its day: a fortnight. */
const DONE_SHOWN_MS = 14 * 86_400_000;

/** What happened to a load coming in, for the receiver's bell — said by its own number where it has one. */
const STEP_EVENTS: ReadonlyArray<[string, 'picked_up' | 'delivered' | 'not_delivered' | 'withdrawn']> = [
  [GlosEvent.Pudo.FreightPickedUp, 'picked_up'],
  [GlosEvent.Pudo.FreightDelivered, 'delivered'],
  [GlosEvent.Pudo.FreightDeliveryFailed, 'not_delivered'],
  [GlosEvent.Pudo.FreightCancelled, 'withdrawn'],
];

/**
 * What a receiver closed of a load: its own record, kept beside the note and never on it (D4 — it points at the note).
 * The note says what was found at the handover, and that does not change.
 */
interface InboundClosing extends InboundClosed {
  freightId: string;
  entityId: string;
  byDid?: string;
}

/**
 * INBOUND SUPPLY, READING A (assessment.html D1–D14; the user, 2026-10-25: "Yes, A then B") — what is coming in to a
 * business at its own receiving points, and its bell told as it moves: addressed to it, on its way, delivered, not
 * delivered, withdrawn. The receiver sees the logistics half only (inbound.types.ts).
 *
 * THE RECEIVING MOMENT (D9): what the receiver found at the handover — short, over, damaged, wrong — is written on the
 * note beside its name (DispatchService.deliverFreight); what did not come, or came and is not the goods, stays here as
 * expected until the receiver closes it. ITS CLOCK (D10): when a load is expected, and whether it is late, is read on
 * the receiving place's own clock — not the carrier's, and not the supplier's.
 */
@Injectable()
export class InboundService implements OnModuleInit {
  private readonly logger = new Logger(InboundService.name);
  private readonly closings = new PersistentMap<string, InboundClosing>('inbound-closings');

  constructor(
    private readonly dispatch: DispatchService,
    private readonly sites: SiteService,
    private readonly entities: EntityService,
    private readonly notes: ConsignmentNoteService,
    @Optional() private readonly events?: EventBus,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  onModuleInit(): void {
    this.events?.subscribe<{ freightId?: string }>(GlosEvent.Pudo.InboundAddressed, (e) => this.tell(e.payload?.freightId, 'addressed'));
    for (const [type, step] of STEP_EVENTS) this.events?.subscribe<{ freightId?: string }>(type, (e) => this.tell(e.payload?.freightId, step));
  }

  /** This business's receiving points, alphabetical. */
  points(entityId: string): ReceivingPointView[] {
    return this.sites.receivingPoints(entityId).map(pointOf);
  }

  /** What a "deliver to" code names, for a supplier about to send there: the business and the place, nothing more. */
  named(code: string): ReceivingPointNamed | undefined {
    const site = this.sites.byReceivingCode(code);
    const entity = site ? this.entities.find(site.entityId) : undefined;
    return site && entity ? { name: entity.name, siteName: site.name, location: { lat: site.location.lat, lng: site.location.lng } } : undefined;
  }

  /**
   * WHAT IS COMING IN to this business: every load addressed to one of its receiving points that is still on its way or
   * waiting for a carrier — or delivered with something still expected of it — the soonest first; and then what arrived,
   * failed or was withdrawn in the last fortnight.
   */
  comingTo(entityId: string, now: number = Date.now()): InboundView {
    const mine = this.dispatch.listFreight().filter((f) => f.receiver?.entityId === entityId);
    const waiting = (f: Freight) => !isDone(f) || this.stillExpected(f) > 0;
    const open = mine.filter(waiting).sort((a, b) => whenOf(a).localeCompare(whenOf(b)));
    const done = mine.filter((f) => !waiting(f) && now - Date.parse(doneAt(f)) <= DONE_SHOWN_MS).sort((a, b) => doneAt(b).localeCompare(doneAt(a)));
    return { points: this.points(entityId), items: [...open, ...done].slice(0, 200).map((f) => this.rowOf(f, now)) };
  }

  /**
   * One load as its receiver sees it: the tracking link's view, its own number, the place, who it is from — what was found
   * at the handover and what is still expected of it, and when it is expected on the place's own clock.
   */
  rowOf(f: Freight, now: number = Date.now()): InboundRow {
    // The carrier's reading of when and whether late is the tracking link's; the receiver's row reads the place's (D10).
    const { late, expectedAbout, ...track } = this.notes.trackView(f, now);
    const due = this.dueOf(f, now);
    const exceptions = exceptionViewsOf(f);
    const closing = this.closings.get(f.freightId);
    return {
      ...track,
      ...(due ? { due } : { ...(late ? { late } : {}), ...(expectedAbout ? { expectedAbout } : {}) }),
      freightId: f.freightId,
      ...(f.trackingKey ? { trackingKey: f.trackingKey } : {}),
      ...(f.receiverRef ? { reference: f.receiverRef } : {}),
      site: { siteId: f.receiver!.siteId, name: f.receiver!.siteName },
      from: this.fromOf(f),
      ...(f.packages ? { packages: f.packages } : {}),
      ...(f.packaging ? { packaging: f.packaging } : {}),
      ...(exceptions.length ? { exceptions, stillExpected: closing ? 0 : stillExpectedOf(exceptions) } : {}),
      ...(closing ? { closed: { how: closing.how, ...(closing.note ? { note: closing.note } : {}), at: closing.at, by: closing.by } } : {}),
    };
  }

  /**
   * D9 — CLOSE WHAT IS STILL EXPECTED of a delivered load: it came after all, or it is not coming. Once, by one of the
   * receiver's people (a viewer reads it), and only where something is still expected. Its own record: the note is not
   * touched — it says what was found at the handover. Its own system hears it (inbound.closed); its supplier is not told —
   * each sees its own (D7), and the shortfall itself is on the supplier's note.
   */
  close(entityId: string, freightId: string, input: { how: InboundClosingHow; note?: string }, by: { name: string; did?: string }, now: number = Date.now()): InboundRow {
    const f = this.mineOrNone(entityId, freightId);
    if (!INBOUND_CLOSINGS.includes(input.how)) throw new GlosError('INVALID_INPUT', 'Say whether it came after all, or is not coming', { field: 'how' });
    const already = this.closings.get(freightId);
    if (already) throw new GlosError('INVALID_STATE', `${already.by} closed this on ${already.at.slice(0, 10)}: it is not expected any more`);
    if (f.status !== 'delivered' || stillExpectedOf(f.proofOfDelivery?.exceptions) === 0) throw new GlosError('INVALID_STATE', 'Nothing of this load is still expected: there is nothing to close');
    const note = input.note?.trim();
    this.closings.set(freightId, { freightId, entityId, how: input.how, ...(note ? { note: note.slice(0, 300) } : {}), at: new Date(now).toISOString(), by: by.name, ...(by.did ? { byDid: by.did } : {}) });
    void this.events?.publish(GlosEvent.Pudo.InboundClosed, { freightId, entityId, how: input.how }, { source: 'pudo' }).catch(() => undefined);
    return this.rowOf(f, now);
  }

  /** A load coming in to this business — or, for anybody else's, told it is not there. */
  private mineOrNone(entityId: string, freightId: string): Freight {
    let f: Freight | undefined;
    try {
      f = this.dispatch.requireFreightPublic(freightId);
    } catch {
      f = undefined;
    }
    if (!f || f.receiver?.entityId !== entityId) throw new GlosError('NOT_FOUND', 'Nothing of that is coming in to you');
    return f;
  }

  /** Packages still expected of a delivered load: short, and not the goods — until the receiver closes them. */
  private stillExpected(f: Freight): number {
    return f.status !== 'delivered' || this.closings.has(f.freightId) ? 0 : stillExpectedOf(f.proofOfDelivery?.exceptions);
  }

  /**
   * D10 — WHEN, ON THE PLACE'S OWN CLOCK: the day it is expected there and, once it is on the road, about when; and
   * whether that has passed there. The day an order was placed for is that day at the place; a load from the board has
   * a day once something says when it reaches the door. One clock per answer: the place's, read at one `now`.
   */
  private dueOf(f: Freight, now: number): InboundDue | undefined {
    if (isDone(f)) return undefined;
    const zone = this.placeZoneOf(f, now);
    if (!zone) return undefined;
    const at = this.dispatch.expectedAtOf(f, now);
    const day = f.deliverOn ?? (at !== undefined ? clockAt(at, zone).day : undefined);
    if (!day) return undefined;
    const today = clockAt(now, zone).day;
    const late = today > day ? 'day' : at !== undefined && now > at + LATE_GRACE_MIN * 60_000 ? 'hour' : undefined;
    return { zone, zoneName: zoneName(zone, now), day, ...(at !== undefined ? { about: clockAt(at, zone).clock } : {}), today: day === today, ...(late ? { late } : {}) };
  }

  /**
   * The receiving place's clock: that of the country the load goes to, as its note says — else its receiver's — where that
   * country keeps one clock. A country of several does not have its place guessed: nothing is read on it.
   */
  private placeZoneOf(f: Freight, now: number): string | undefined {
    const country = f.destCountry ?? (f.receiver ? this.entities.find(f.receiver.entityId)?.jurisdiction : undefined);
    const clocks = clocksOfCountry(country, now);
    return clocks.length === 1 ? clocks[0] : undefined;
  }

  /** Who a load is from: the client a forwarder sent it for, else the business that posted it, else where it is collected. */
  private fromOf(f: Freight): string {
    if (f.onBehalfOf?.name) return f.onBehalfOf.name;
    const poster = f.postedByDid ? this.entities.byDid(f.postedByDid) : undefined;
    return poster?.name ?? f.pickupLabel;
  }

  /** The receiver's bell, as the load moves — by the receiver's own number for it where it has one. */
  private async tell(freightId: string | undefined, step: 'addressed' | 'picked_up' | 'delivered' | 'not_delivered' | 'withdrawn'): Promise<void> {
    if (!freightId || !this.notifications) return;
    let f: Freight;
    try {
      f = this.dispatch.requireFreightPublic(freightId);
    } catch {
      return;
    }
    const receiver = f.receiver ? this.entities.find(f.receiver.entityId) : undefined;
    if (!f.receiver || !receiver) return;
    const what = f.receiverRef ? `Order ${f.receiverRef}` : `Load ${f.code}`;
    const from = this.fromOf(f);
    const packages = f.packages ? `${f.packages} ${f.packages === 1 ? 'package' : 'packages'}, ` : '';
    // D9 — what was found at the handover, and what stays expected of it.
    const found = f.proofOfDelivery?.exceptions?.length ? f.proofOfDelivery.exceptions : undefined;
    const still = stillExpectedOf(found);
    const foundLine = found
      ? ` ${f.proofOfDelivery?.receiverName ?? 'They'} found ${exceptionsInWords(found)}: it is on the consignment note.${still ? ` ${still} ${still === 1 ? 'package stays' : 'packages stay'} expected until you close ${still === 1 ? 'it' : 'them'} under Coming in.` : ''}`
      : '';
    const lines: Record<typeof step, { title: string; body: string }> = {
      addressed: { title: `Coming in: ${what} from ${from}`, body: `${packages}${f.weightKg.toLocaleString('en-GB')} kg, to ${f.receiver.siteName}. You are told when it is on its way.` },
      picked_up: { title: `${what} is on its way`, body: `From ${from} to ${f.receiver.siteName}: the carrier has it.` },
      delivered: { title: found ? `${what} was delivered, not all as the note says` : `${what} was delivered`, body: `At ${f.receiver.siteName}${f.proofOfDelivery?.receiverName ? `, received by ${f.proofOfDelivery.receiverName}` : ''}.${foundLine}` },
      not_delivered: { title: `${what} could not be delivered`, body: `The carrier was at ${f.receiver.siteName} and could not hand it over. ${from} is told too.` },
      withdrawn: { title: `${what} was withdrawn`, body: `${from} withdrew it: it is not coming to ${f.receiver.siteName}.` },
    };
    try {
      await this.notifications.notify(receiver.did, { kind: 'inbound', ...lines[step], link: '/business/', tag: `inbound:${f.freightId}`, data: { freightId: f.freightId, step } });
    } catch (err) {
      this.logger.warn(`inbound notice failed for ${f.freightId}: ${(err as Error).message}`);
    }
  }
}

function pointOf(site: Site): ReceivingPointView {
  return { siteId: site.siteId, name: site.name, location: { lat: site.location.lat, lng: site.location.lng }, code: site.receiving!.code, since: site.receiving!.since, by: site.receiving!.by };
}

function isDone(f: Freight): boolean {
  return f.status === 'delivered' || f.status === 'cancelled';
}

/** When a load still coming is expected to move: its day under a contract, its pickup date, or when it was posted. */
function whenOf(f: Freight): string {
  return f.deliverOn ?? f.scheduledPickupAt ?? f.createdAt;
}

function doneAt(f: Freight): string {
  return f.deliveredAt ?? f.cancellation?.at ?? f.createdAt;
}
