import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { EntityService } from '../../foundation/entity/entity.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { ConsignmentNoteService } from './consignment-note.service';
import { DispatchService } from './dispatch.service';
import type { Freight } from './dispatch.types';
import type { InboundRow, InboundView, ReceivingPointNamed, ReceivingPointView } from './inbound.types';
import { NotificationService } from './notification.service';
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
 * INBOUND SUPPLY, READING A (assessment.html D1–D14; the user, 2026-10-25: "Yes, A then B") — what is coming in to a
 * business at its own receiving points, and its bell told as it moves: addressed to it, on its way, delivered, not
 * delivered, withdrawn. The receiver sees the logistics half only (inbound.types.ts); the receiving moment itself, with
 * what was short or broken, is the next step of this reading.
 */
@Injectable()
export class InboundService implements OnModuleInit {
  private readonly logger = new Logger(InboundService.name);

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
   * waiting for a carrier — the soonest first — and then what arrived, failed or was withdrawn in the last fortnight.
   */
  comingTo(entityId: string, now: number = Date.now()): InboundView {
    const mine = this.dispatch.listFreight().filter((f) => f.receiver?.entityId === entityId);
    const open = mine.filter((f) => !isDone(f)).sort((a, b) => whenOf(a).localeCompare(whenOf(b)));
    const done = mine.filter((f) => isDone(f) && now - Date.parse(doneAt(f)) <= DONE_SHOWN_MS).sort((a, b) => doneAt(b).localeCompare(doneAt(a)));
    return { points: this.points(entityId), items: [...open, ...done].slice(0, 200).map((f) => this.rowOf(f, now)) };
  }

  /** One load as its receiver sees it: the tracking link's view, its own number, the place, who it is from. */
  rowOf(f: Freight, now: number = Date.now()): InboundRow {
    const track = this.notes.trackView(f, now);
    return {
      ...track,
      freightId: f.freightId,
      ...(f.trackingKey ? { trackingKey: f.trackingKey } : {}),
      ...(f.receiverRef ? { reference: f.receiverRef } : {}),
      site: { siteId: f.receiver!.siteId, name: f.receiver!.siteName },
      from: this.fromOf(f),
      ...(f.packages ? { packages: f.packages } : {}),
      ...(f.packaging ? { packaging: f.packaging } : {}),
    };
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
    const lines: Record<typeof step, { title: string; body: string }> = {
      addressed: { title: `Coming in: ${what} from ${from}`, body: `${packages}${f.weightKg.toLocaleString('en-GB')} kg, to ${f.receiver.siteName}. You are told when it is on its way.` },
      picked_up: { title: `${what} is on its way`, body: `From ${from} to ${f.receiver.siteName}: the carrier has it.` },
      delivered: { title: `${what} was delivered`, body: `At ${f.receiver.siteName}${f.proofOfDelivery?.receiverName ? `, received by ${f.proofOfDelivery.receiverName}` : ''}.` },
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
