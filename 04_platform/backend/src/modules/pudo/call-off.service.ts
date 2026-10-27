import { Injectable, Logger, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { CallOffView, CalledOffView } from './call-off.types';
import { MdpService } from './mdp.service';
import { NotificationService } from './notification.service';
import { ParcelService, parcelCurrency } from './parcel.service';
import { coverFor, measuredFactor } from './pudo.config';
import type { Agent, Mdp, Parcel, ParcelStatus } from './pudo.types';
import { RoutingService, type ShipmentQuote } from './routing.service';
import { ToteService } from './tote.service';
import { VendorService } from './vendor.service';

/** Withdrawn, its money back in full: before it left the shop it was handed in at, or before it was handed in at all. */
const WITHDRAWN_BEFORE: ReadonlyArray<ParcelStatus> = ['Created', 'At_PUDO'];

/** Why it cannot be called off where it is, in the store's words. */
const WHY_NOT: Partial<Record<ParcelStatus, string>> = {
  On_Bus: 'A driver is carrying it: it cannot be called off on the road.',
  Ready_For_Pickup: 'It is waiting at the shop for the buyer, whose goods they are.',
  Unclaimed: 'It is waiting at the shop for the buyer, whose goods they are.',
  Delivered: 'It was collected.',
  Disputed: 'The buyer reported a problem with it: that is settled first.',
  Voided: 'It was called off already.',
  Returned: 'It is on its way back already.',
  Lost: 'It was declared lost.',
};

type Plan = { hub: Mdp; shop: Agent; quote: ShipmentQuote; price: number };

/**
 * A STORE CALLS ONE OF ITS PARCELS OFF (call-off.types.ts). Withdrawn before it left the shop it was handed in at, the money
 * back in full — ParcelService.cancel, as it always was. AT A HUB (the user, 2026-10-27: "Comes back, store pays"): turned round
 * there, to the shop it was handed in at, as a new parcel the store pays for; what was carried is not given back. As with a
 * courier's intercept, the goods never sit nowhere: the hub is told, prints the new label, puts it over the old one, and sorts
 * it like any parcel there. Said before it is asked — what it would do and cost — and refused, before anything is written,
 * where it cannot be done.
 */
@Injectable()
export class CallOffService {
  private readonly logger = new Logger(CallOffService.name);

  constructor(
    private readonly parcels: ParcelService,
    private readonly vendors: VendorService,
    private readonly routing: RoutingService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly totes: ToteService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  /** What calling it off would do now. */
  preview(vendorId: string, parcelId: string): CallOffView {
    const p = this.owned(vendorId, parcelId);
    if (WITHDRAWN_BEFORE.includes(p.status)) return { parcelId, outcome: 'refund', amount: this.refundOf(p), currency: parcelCurrency(p) };
    if (p.status !== 'At_MDP') return { parcelId, outcome: 'no', why: this.whyNot(p) };
    const plan = this.planBack(p);
    if ('why' in plan) return { parcelId, outcome: 'no', why: plan.why };
    return { parcelId, outcome: 'bring_back', amount: plan.price, currency: plan.quote.currency, backTo: plan.shop.shopName, atHub: plan.hub.name };
  }

  /** Call it off: withdrawn and refunded, or turned round at the hub that has it — or refused, saying why. */
  callOff(vendorId: string, parcelId: string, by: string, reason?: string, now: number = Date.now()): CalledOffView {
    const p = this.owned(vendorId, parcelId);
    if (WITHDRAWN_BEFORE.includes(p.status)) {
      const amount = this.refundOf(p);
      const done = this.parcels.cancel(parcelId, by, reason);
      return { parcelId, status: done.status, outcome: 'refund', amount, currency: parcelCurrency(done) };
    }
    if (p.status !== 'At_MDP') throw new GlosError('INVALID_STATE', this.whyNot(p));
    const plan = this.planBack(p);
    if ('why' in plan) throw new GlosError('INVALID_STATE', plan.why);
    const { hub, shop, quote, price } = plan;
    // Checked BEFORE anything moves, against the whole price: a store's "call it off" that failed afterwards would leave the
    // goods at a hub with no parcel to carry them.
    if (this.vendors.balanceOf(vendorId) + 1e-9 < price) {
      throw new GlosError('WALLET_INSUFFICIENT', `Top up first — bringing it back to ${shop.shopName} costs ${price.toFixed(2)} ${quote.currency}`);
    }
    // Sorted already: in a bag still at the hub (one on the road would have taken the parcel with it). It comes out of it.
    const bag = p.toteId ? this.totes.list().find((t) => t.toteId === p.toteId) : undefined;
    if (bag?.status === 'in_transit') throw new GlosError('INVALID_STATE', 'Its bag has left the hub: it cannot be called off on the road.');
    const vendor = this.vendors.get(vendorId);
    const { back } = this.parcels.turnBackAtHub(
      parcelId,
      { quote, hub: { mdpId: hub.mdpId, name: hub.name, zone: this.routing.hubEnd(hub.mdpId).zone }, toAgentDid: shop.did, receiverMobile: vendor.contactMobile ?? '', shippingPolicy: vendor.shippingPolicy, by, reason },
      now,
    );
    if (bag?.parcels.includes(parcelId)) this.totes.takeOut(bag.code, parcelId, p.size);
    this.tellHub(hub, p, back, shop, bag?.code);
    return { parcelId, status: 'Returned', outcome: 'bring_back', amount: back.shipmentCost ?? price, currency: parcelCurrency(back), returnParcelId: back.parcelId, backTo: shop.shopName, atHub: hub.name };
  }

  /** The way back, worked out — or why there is none. Nothing is written. */
  private planBack(p: Parcel): Plan | { why: string } {
    if (p.held) return { why: 'It is held: operations decide what happens to it first.' };
    if (!p.atMdpId) return { why: 'Nobody recorded which hub has it: SeeBuyGet looks into it.' };
    if (!p.originAgentDid) return { why: 'It was not handed in at a shop, so there is no shop to bring it back to: it carries on to the buyer.' };
    const shop = this.agents.get(p.originAgentDid);
    if (!this.agents.takesNew(shop)) return { why: `${shop.shopName} is not taking parcels for now, so it cannot come back there: it carries on to the buyer.` };
    const hub = this.mdps.require(p.atMdpId);
    // The hub must be able to sort it toward that shop — to it, or to the hub serving its area — or the goods would wait there
    // under a new label with nowhere to go.
    try {
      this.mdps.nextHop(hub, shop.zone, shop.did);
    } catch {
      return { why: `${hub.name} sends nothing toward ${shop.zone}, so it cannot come back to ${shop.shopName}: it carries on to the buyer.` };
    }
    const vendor = this.vendors.get(p.vendorId!);
    // The same box, measured as it was: re-measured, it could change size between two legs of one journey.
    const measured = p.dimensionsCm ? measuredFactor({ ...p.dimensionsCm, kg: p.weightKg }) : undefined;
    let quote: ShipmentQuote;
    try {
      quote = this.routing.quoteShipmentFrom(this.routing.hubEnd(hub.mdpId), shop.did, p.size, this.vendors.entityIdOf(vendor), measured, { kg: p.weightKg, fragile: p.fragile });
    } catch (e) {
      if (e instanceof GlosError) return { why: `It cannot be brought back from ${hub.name}: ${e.message}` };
      throw e;
    }
    if (quote.crossesBorder) return { why: 'Coming back it would cross a border, which needs papers of its own: it carries on to the buyer.' };
    // What the new parcel will cost, exactly as it is billed: the cheapest way back, and the cover the store buys with it.
    const price = Math.round((quote.locked.gross + coverFor({ declaredValue: p.declaredValue, ...quote.insurance }).premium) * 100) / 100;
    return { hub, shop, quote, price };
  }

  /** The hub has a box under a label that is no longer the one it travels on: what to do, said where the floor reads it. */
  private tellHub(hub: Mdp, old: Parcel, back: Parcel, shop: Agent, bagCode?: string): void {
    const outOfBag = bagCode ? ` Take it out of bag ${bagCode}.` : '';
    const body = `${old.parcelId} was called off by its store: it goes back to ${shop.shopName} as ${back.parcelId}.${outOfBag} Print its new label, put it over the old one, then sort ${back.parcelId}.`;
    void this.notifications
      ?.notify(hub.did, { kind: 'hub_arrival', title: 'Called off: a new label', body, link: '/', tag: `called-off:${old.parcelId}`, data: { parcelId: old.parcelId, returnParcelId: back.parcelId } })
      .catch((err: Error) => this.logger.warn(`called-off notice not sent: ${err.message}`));
  }

  private refundOf(p: Parcel): number {
    return p.paidStatus === 'ParcelPaid' && (p.shipmentCost ?? 0) > 0 ? (p.shipmentCost ?? 0) : 0;
  }

  private whyNot(p: Parcel): string {
    if (p.status === 'Returned' && p.returnParcelId) return `It is on its way back already, as ${p.returnParcelId}.`;
    return WHY_NOT[p.status] ?? `It cannot be called off now (${p.status}).`;
  }

  /** The store's own parcel, or one it cannot tell from a parcel that does not exist. */
  private owned(vendorId: string, parcelId: string): Parcel {
    let p: Parcel;
    try {
      p = this.parcels.get(parcelId);
    } catch {
      throw new GlosError('NOT_FOUND', `No order ${parcelId}`);
    }
    if (p.vendorId !== vendorId) throw new GlosError('NOT_FOUND', `No order ${parcelId}`);
    return p;
  }
}
