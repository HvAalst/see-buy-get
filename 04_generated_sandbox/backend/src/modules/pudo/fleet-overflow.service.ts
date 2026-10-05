import { Injectable } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { DispatchService } from './dispatch.service';
import { Freight } from './dispatch.types';
import { FleetPartnerService } from './fleet-partner.service';
import { HandOnBatchResult, OrderHandedOn } from './fleet-overflow.types';

/** The most orders one offer or release may carry: a day's leftovers, with room. */
export const MAX_HAND_ON_BATCH = 200;

/**
 * P4 — WHAT A FLEET CANNOT CARRY ITSELF GOES TO ITS PARTNERS FIRST, THEN TO THE OPEN BOARD.
 *
 * The user, 2026-10-05, choosing where a plan's leftovers go: "partner fleets, then board". So the office offers
 * orders to the fleets it has named — all at once, the first to take one carries it — and whatever no partner takes it
 * can release to the open board, where any checked carrier may. Both can be undone while nobody has acted on them: an
 * offer withdrawn, an order taken back off the board; and a partner that took an order can give it back, with a
 * reason, until it is on a truck.
 *
 * This is the layer that TELLS PEOPLE. Offering a batch is one message to each partner, not one an order; a partner
 * taking, leaving the last place on, or giving back an order is a message to the fleet that offered it. The order
 * itself is changed in DispatchService, which owns what an order is.
 */
@Injectable()
export class FleetOverflowService {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly partners: FleetPartnerService,
    private readonly events: EventBus,
  ) {}

  /** Offer orders to every partner the fleet has. One refusal does not stop the rest: each order says how it went. */
  offer(fleet: { did: string; name: string }, freightIds: string[], by: string, now: number = Date.now()): HandOnBatchResult {
    const ids = this.batch(freightIds);
    const partners = this.partners.activePartners(fleet.did);
    if (partners.length === 0) throw new GlosError('INVALID_STATE', 'You have no partner fleet to offer to — name one first, and have them enter your code');
    const done: Freight[] = [];
    const refused: HandOnBatchResult['refused'] = [];
    for (const id of ids) {
      try {
        done.push(this.dispatch.offerToPartners(fleet.did, id, partners, by, now));
      } catch (e) {
        refused.push({ freightId: id, why: e instanceof Error ? e.message : 'It could not be offered' });
      }
    }
    if (done.length) this.tell({ what: 'offered', fromFleetDid: fleet.did, fromFleetName: fleet.name, toFleetDids: partners.map((p) => p.fleetDid), ...summaryOf(done) });
    return { done: done.map((f) => f.code), refused, to: partners.map((p) => p.fleetName) };
  }

  withdrawOffer(fleet: { did: string; name: string }, freightId: string): Freight {
    const was = this.dispatch.offeredTo(freightId);
    const f = this.dispatch.withdrawOffer(fleet.did, freightId);
    if (was.length) this.tell({ what: 'withdrawn', fromFleetDid: fleet.did, fromFleetName: fleet.name, toFleetDids: was.map((p) => p.fleetDid), ...summaryOf([f]) });
    return f;
  }

  /** A partner takes an offered order, or leaves it. */
  answer(partner: { did: string; name: string }, freightId: string, take: boolean, by: string, now: number = Date.now()): Freight {
    const f = this.dispatch.answerOffer(partner.did, freightId, take, by, now);
    const from = { fromFleetDid: f.contract!.fleetDid, fromFleetName: f.contract!.fleetName };
    if (take) this.tell({ what: 'taken', ...from, partnerName: partner.name, ...summaryOf([f]) });
    // A partner leaving it is only news once nobody is left: until then the offer still stands with the others.
    else if (!f.handOn) this.tell({ what: 'ran_out', ...from, partnerName: partner.name, ...summaryOf([f]) });
    return f;
  }

  handBack(partner: { did: string; name: string }, freightId: string, reason: string, now: number = Date.now()): Freight {
    const f = this.dispatch.handBackToPartner(partner.did, freightId, reason, now);
    this.tell({ what: 'handed_back', fromFleetDid: f.contract!.fleetDid, fromFleetName: f.contract!.fleetName, partnerName: partner.name, reason: reason.trim().slice(0, 280), ...summaryOf([f]) });
    return f;
  }

  /** Release orders to the open board. As with an offer, each says how it went. */
  release(fleet: { did: string; name: string }, freightIds: string[], by: string, now: number = Date.now()): HandOnBatchResult {
    const done: string[] = [];
    const refused: HandOnBatchResult['refused'] = [];
    for (const id of this.batch(freightIds)) {
      try {
        done.push(this.dispatch.releaseToBoard(fleet.did, id, by, now).code);
      } catch (e) {
        refused.push({ freightId: id, why: e instanceof Error ? e.message : 'It could not be released' });
      }
    }
    return { done, refused, to: [] };
  }

  takeBack(fleet: { did: string; name: string }, freightId: string): Freight {
    return this.dispatch.takeBackFromBoard(fleet.did, freightId);
  }

  private batch(freightIds: string[]): string[] {
    const ids = [...new Set((freightIds ?? []).filter((x) => typeof x === 'string' && x.trim()))];
    if (ids.length === 0) throw new GlosError('FIELD_REQUIRED', 'Choose at least one order', { field: 'freightIds' });
    if (ids.length > MAX_HAND_ON_BATCH) throw new GlosError('INVALID_INPUT', `At most ${MAX_HAND_ON_BATCH} orders at a time`, { field: 'freightIds' });
    return ids;
  }

  private tell(payload: OrderHandedOn): void {
    void this.events.publish(GlosEvent.Pudo.OrderHandedOn, payload, { source: 'pudo' }).catch(() => undefined);
  }
}

/** What a batch is, in the three figures a carrier decides on: how many, how heavy, for which day(s). */
function summaryOf(orders: Freight[]): Pick<OrderHandedOn, 'count' | 'weightKg' | 'days' | 'code'> {
  const days = [...new Set(orders.map((f) => f.deliverOn ?? ''))].filter(Boolean).sort();
  return { count: orders.length, weightKg: Math.round(orders.reduce((s, f) => s + f.weightKg, 0)), days, ...(orders.length === 1 ? { code: orders[0].code } : {}) };
}
