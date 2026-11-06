import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { measuredFactor } from './pudo.config';
import { ParcelService } from './parcel.service';
import { Parcel } from './pudo.types';
import { RoutingService, ShipmentQuote } from './routing.service';
import { VendorService } from './vendor.service';

/**
 * 2026-11-06 — MOVING A BOOKING TO ANOTHER DROP-OFF SHOP (the owner: "moving needs a re-price, but it's not automated by us
 * so the user is aware of the implication").
 *
 * The booker — a store, a business, a person in the Send app — asks first what moving would do: the new price beside the
 * old, what it does to their balance (or what the counter takes in cash), and whether it can move at all. Then they move it,
 * saying the price they were shown; if it changed since, the move is refused with the new one (the PRICE_CHANGED pattern
 * the Send app's booking uses). We never move a booking ourselves.
 */
export interface MoveView {
  parcelId: string;
  from: { did: string; shopName: string };
  to: { did: string; shopName: string };
  /** What it cost booked where it is, and what it would cost from the new shop. */
  was: number;
  now: number;
  difference: number;
  currency?: string;
  /** Who pays it: a store's or business's balance, or the person in cash at the counter. */
  pays: 'balance' | 'counter';
  balance?: number;
  balanceAfter?: number;
  canMove: boolean;
  why?: string;
}

export interface MovedView {
  parcelId: string;
  moved: true;
  from: { did: string; shopName: string };
  to: { did: string; shopName: string };
  was: number;
  now: number;
  currency?: string;
  /** The label, made again: it names where it is handed in. */
  svg?: string;
}

@Injectable()
export class DropOffMoveService {
  constructor(
    private readonly parcels: ParcelService,
    private readonly routing: RoutingService,
    private readonly agents: AgentService,
    private readonly vendors: VendorService,
  ) {}

  /** What moving it to `toAgentDid` would do now — or why it cannot. Never writes. */
  preview(parcelId: string, toAgentDid: string): MoveView {
    const parcel = this.parcels.get(parcelId);
    const to = this.agents.find(toAgentDid);
    if (!to) throw new GlosError('NOT_FOUND', 'No such shop');
    const base = this.frame(parcel, to.did, to.shopName);
    let quote: ShipmentQuote;
    try {
      quote = this.quoteFor(parcel, to.did);
    } catch (err) {
      return { ...base, was: parcel.shipmentCost ?? 0, now: parcel.shipmentCost ?? 0, difference: 0, canMove: false, why: (err as Error).message };
    }
    const now = this.parcels.moveCostOf(parcel, quote);
    const was = parcel.shipmentCost ?? 0;
    const refused = this.parcels.moveRefusal(parcel, to.did, now);
    const balance = parcel.vendorId ? this.vendors.balanceOf(parcel.vendorId) : undefined;
    const paidStore = Boolean(parcel.vendorId && parcel.paidStatus === 'ParcelPaid');
    return {
      ...base,
      was,
      now,
      difference: Math.round((now - was) * 100) / 100,
      currency: quote.currency,
      ...(balance != null ? { balance, ...(paidStore ? { balanceAfter: Math.round((balance + was - now) * 100) / 100 } : {}) } : {}),
      canMove: !refused,
      ...(refused ? { why: refused.message } : {}),
    };
  }

  /** Move it, at the price the booker was shown: refused — with the new price — if it is no longer that. */
  move(parcelId: string, toAgentDid: string, expectedTotal: number, by: string): MovedView {
    const parcel = this.parcels.get(parcelId);
    const fromDid = parcel.originAgentDid ?? '';
    const quote = this.quoteFor(parcel, toAgentDid);
    const price = this.parcels.moveCostOf(parcel, quote);
    if (!Number.isFinite(expectedTotal) || Math.abs(expectedTotal - price) > 0.001) {
      throw new GlosError('PRICE_CHANGED', `The price from that shop is now ${price.toFixed(2)} — please look at it again before moving`, { newTotal: price });
    }
    const done = this.parcels.moveDropOff(parcelId, toAgentDid, quote, by);
    return {
      parcelId,
      moved: true,
      from: { did: fromDid, shopName: this.agents.find(fromDid)?.shopName ?? '' },
      to: { did: toAgentDid, shopName: this.agents.get(toAgentDid).shopName },
      was: done.was,
      now: done.now,
      currency: done.parcel.currency,
      ...(done.parcel.label?.svg ? { svg: done.parcel.label.svg } : {}),
    };
  }

  /** The parcel's own route from the new shop, priced on what it is — as it was priced when it was booked. */
  private quoteFor(parcel: Parcel, toAgentDid: string): ShipmentQuote {
    if (!parcel.destAgentDid) throw new GlosError('INVALID_STATE', 'This parcel has no shop it is collected at');
    const measured = parcel.dimensionsCm ? measuredFactor({ ...parcel.dimensionsCm, kg: parcel.weightKg }) : undefined;
    return this.routing.quoteShipment(toAgentDid, parcel.destAgentDid, parcel.size, measured, { kg: parcel.weightKg, fragile: parcel.fragile });
  }

  private frame(parcel: Parcel, toDid: string, toName: string): Pick<MoveView, 'parcelId' | 'from' | 'to' | 'pays'> {
    const fromDid = parcel.originAgentDid ?? '';
    return {
      parcelId: parcel.parcelId,
      from: { did: fromDid, shopName: this.agents.find(fromDid)?.shopName ?? '' },
      to: { did: toDid, shopName: toName },
      pays: parcel.vendorId ? 'balance' : 'counter',
    };
  }
}
