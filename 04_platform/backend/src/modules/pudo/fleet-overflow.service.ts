import { Injectable } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { DispatchService } from './dispatch.service';
import { Freight } from './dispatch.types';
import { FleetPartnerService } from './fleet-partner.service';
import { FleetPartnership } from './fleet-partner.types';
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

  /**
   * PASS ORDERS ON. A partner that took orders offers them to the fleets it has named itself — if, and only if, the
   * fleet each order was ordered from has said this partner may (the user, 2026-10-06: "only if I allowed that
   * partner"). Each order says how it went; the fleets it is offered to get one message for the batch.
   */
  passOn(partner: { did: string; name: string }, freightIds: string[], by: string, now: number = Date.now()): HandOnBatchResult {
    const ids = this.batch(freightIds);
    const own = this.partners.activePartners(partner.did);
    if (own.length === 0) throw new GlosError('INVALID_STATE', 'You have no partner fleet of your own to pass work on to — name one first, and have them enter your code');
    const done: Freight[] = [];
    const refused: HandOnBatchResult['refused'] = [];
    for (const id of ids) {
      try {
        const from = this.dispatch.contractFleetOf(id);
        // Not this fleet's to pass on: said as "no such order", like any order that is somebody else's.
        if (!from || this.dispatch.carrierOfOrderId(id) !== partner.did || from.fleetDid === partner.did) throw new GlosError('NOT_FOUND', 'No such order');
        if (!this.partners.mayPassOn(from.fleetDid, partner.did)) throw new GlosError('FORBIDDEN', `${from.fleetName} has not said its orders may be passed on — carry it, or give it back`);
        done.push(this.dispatch.passOnOffer(partner.did, id, own, by, now));
      } catch (e) {
        refused.push({ freightId: id, why: e instanceof Error ? e.message : 'It could not be passed on' });
      }
    }
    const to = new Map(done.flatMap((f) => f.handOn?.onward?.offeredTo ?? []).map((p) => [p.fleetDid, p.fleetName]));
    if (done.length) this.tell({ what: 'offered', fromFleetDid: partner.did, fromFleetName: partner.name, toFleetDids: [...to.keys()], ...summaryOf(done) });
    return { done: done.map((f) => f.code), refused, to: [...to.values()] };
  }

  /** The offering fleet's switch: may this partner pass its orders on. Turned off, the partner's open offers to do so lapse. */
  setPassOn(fleet: { did: string; name: string }, partnershipId: string, allowed: boolean): FleetPartnership {
    const p = this.partners.setPassOn(fleet.did, partnershipId, allowed);
    if (!allowed) this.lapse(p);
    return p;
  }

  /** An arrangement ended, by either side. With it goes the leave to pass on: open offers to do so lapse. */
  endPartnership(fleetDid: string, partnershipId: string, by: string): FleetPartnership {
    const p = this.partners.end(fleetDid, partnershipId, by);
    this.lapse(p);
    return p;
  }

  /**
   * The leave to pass on is gone. Orders the partner already passed on stay where they are — somebody is carrying
   * them. Offers still open are taken back, and everybody on them is told: the fleets that were asked, and the partner.
   */
  private lapse(p: FleetPartnership): void {
    if (!p.toFleetDid) return;
    const open = this.dispatch.onwardOffersOf(p.fromFleetDid, p.toFleetDid);
    if (open.length === 0) return;
    const asked = new Set(open.flatMap((f) => this.dispatch.offeredTo(f.freightId).map((x) => x.fleetDid)));
    for (const f of open) this.dispatch.withdrawOffer(p.toFleetDid, f.freightId);
    this.tell({ what: 'withdrawn', fromFleetDid: p.toFleetDid, fromFleetName: p.partnerName, toFleetDids: [...asked], ...summaryOf(open) });
    this.tell({ what: 'lapsed', fromFleetDid: p.toFleetDid, fromFleetName: p.partnerName, partnerName: p.fromFleetName, ...summaryOf(open) });
  }

  withdrawOffer(fleet: { did: string; name: string }, freightId: string): Freight {
    const was = this.dispatch.offeredTo(freightId);
    const f = this.dispatch.withdrawOffer(fleet.did, freightId);
    if (was.length) this.tell({ what: 'withdrawn', fromFleetDid: fleet.did, fromFleetName: fleet.name, toFleetDids: was.map((p) => p.fleetDid), ...summaryOf([f]) });
    return f;
  }

  /** A partner takes an offered order, or leaves it. */
  answer(partner: { did: string; name: string }, freightId: string, take: boolean, by: string, now: number = Date.now()): Freight {
    const was = this.dispatch.handOnOf(freightId);
    const f = this.dispatch.answerOffer(partner.did, freightId, take, by, now, (contractFleetDid, holderDid) => this.partners.mayPassOn(contractFleetDid, holderDid));
    if (was?.onward && was.partner) {
      // An order a partner was passing on. The partner hears what its own partner did; the fleet the order was
      // ordered from hears only when its goods have actually gone a fleet further.
      const holder = { fromFleetDid: was.partner.fleetDid, fromFleetName: was.partner.fleetName };
      if (take) {
        this.tell({ what: 'taken', ...holder, partnerName: partner.name, ...summaryOf([f]) });
        this.tell({ what: 'passed_on', fromFleetDid: f.contract!.fleetDid, fromFleetName: f.contract!.fleetName, partnerName: partner.name, viaName: was.partner.fleetName, ...summaryOf([f]) });
      } else if (!f.handOn?.onward) this.tell({ what: 'ran_out', ...holder, partnerName: partner.name, onward: true, ...summaryOf([f]) });
      return f;
    }
    const from = { fromFleetDid: f.contract!.fleetDid, fromFleetName: f.contract!.fleetName };
    if (take) this.tell({ what: 'taken', ...from, partnerName: partner.name, ...summaryOf([f]) });
    // A partner leaving it is only news once nobody is left: until then the offer still stands with the others.
    else if (!f.handOn) this.tell({ what: 'ran_out', ...from, partnerName: partner.name, ...summaryOf([f]) });
    return f;
  }

  handBack(partner: { did: string; name: string }, freightId: string, reason: string, now: number = Date.now()): Freight {
    const f = this.dispatch.handBackToPartner(partner.did, freightId, reason, now);
    // It went back to whoever it came from — the partner that passed it on, where there was one — and that is who is told.
    const to = f.handOn?.state === 'partner' && f.handOn.partner ? f.handOn.partner : { fleetDid: f.contract!.fleetDid, fleetName: f.contract!.fleetName };
    this.tell({ what: 'handed_back', fromFleetDid: to.fleetDid, fromFleetName: to.fleetName, partnerName: partner.name, reason: reason.trim().slice(0, 280), ...(f.handOn ? { onward: true } : {}), ...summaryOf([f]) });
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
