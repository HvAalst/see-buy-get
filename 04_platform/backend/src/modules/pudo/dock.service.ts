import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { MdpService } from './mdp.service';
import { ParcelService } from './parcel.service';
import { ToteService } from './tote.service';
import { VendorService } from './vendor.service';
import { BagClosureService } from './bag-closure.service';
import { Tote } from './pudo.types';

/**
 * DockService — bagging at a vendor's OWN collection point.
 *
 * The shop path and this one are the same physical act — parcels go into a bag, the bag is closed, a driver
 * scans it once — but they answer to different people, and the differences are the whole point:
 *
 *  - the shop bags parcels it TOOK IN from strangers and was paid a labour fee for; the vendor bags its own
 *    goods and NOBODY is paid an intake fee, because nobody took anything in;
 *  - a shop parcel is At_PUDO (the network has custody); a dock parcel is still the vendor's until the
 *    driver scans the bag aboard, which is the honest reading — and it is why nothing here changes a
 *    parcel's status. Custody moves when the bag does.
 *
 * Its own service for the reason BagPlanService is: MdpService knows nothing about vendors, and teaching it
 * would drag the store ledger into the hub. Nothing depends on this one, so it reads from all of them.
 */
@Injectable()
export class DockService {
  constructor(
    private readonly vendors: VendorService,
    private readonly parcels: ParcelService,
    private readonly totes: ToteService,
    private readonly mdps: MdpService,
    private readonly events: EventBus,
    private readonly closures: BagClosureService,
  ) {}

  /** Open a bag on the vendor's dock for one destination. Refused once the dock's floor is full. */
  openBag(vendorId: string, destZone: string): Tote {
    const vendor = this.vendors.get(vendorId);
    const dock = this.vendors.requireCollection(vendorId);
    if (!destZone?.trim()) throw new GlosError('FIELD_REQUIRED', 'A bag needs a destination');
    const staged = this.stagedBags(vendor.did);
    if (staged.length >= dock.bays) {
      throw new GlosError(
        'STAGING_FULL',
        `This dock has room for ${dock.bays} bag(s) and ${staged.length} are waiting — hand one to a driver, or make room for more`,
        { capacity: dock.bays, used: staged.length },
      );
    }
    // Keyed to the vendor's DID exactly as a shop bag is keyed to the agent's, so every downstream reader
    // (dispatch, the driver's offer, the notification) resolves the pickup the same way for both.
    const tote = this.totes.register(vendor.did);
    return this.totes.assign(tote.code, destZone.trim(), destZone.trim(), { sealRequired: true });
  }

  /** The bags standing on this dock right now (the shop's staging rule, at a vendor's door). */
  stagedBags(vendorDid: string): Tote[] {
    return this.totes.atLocation(vendorDid).filter((t) => t.status === 'filling' || t.status === 'available' || t.status === 'claimed');
  }

  /**
   * Put one of this vendor's own parcels into the bag.
   *
   * Three things must hold, and each is a different way the wrong parcel could otherwise ride: it is THIS
   * vendor's parcel (not a neighbour's), the shipping is PAID (a dock cannot post unpaid freight any more
   * than a counter can), and it is going where the bag is going.
   */
  fillBag(code: string, vendorId: string, parcelId: string): { tote: Tote; fillPct: number } {
    const vendor = this.vendors.get(vendorId);
    const bag = this.totes.requireByCode(code);
    if (bag.locationId !== vendor.did) throw new GlosError('WRONG_PUDO', `Bag ${code} is not on this dock`);
    if (bag.status !== 'filling') throw new GlosError('INVALID_STATE', `Bag ${code} is ${bag.status}, it is closed`);

    const parcel = this.parcels.get(parcelId);
    if (parcel.vendorId !== vendorId) throw new GlosError('FORBIDDEN', `Parcel ${parcelId} belongs to another store`);
    if (parcel.paidStatus !== 'ParcelPaid') throw new GlosError('SHIPMENT_NOT_PAID', `Parcel ${parcelId} is not paid yet — top up, then bag it`);
    if (parcel.status !== 'Created') throw new GlosError('INVALID_STATE', `Parcel ${parcelId} is already ${parcel.status}`);
    // A parcel booked to be handed in at a SHOP is that shop's to expect — it was quoted with that shop's fee
    // and its drop-off is what the shop was told to wait for. Only a parcel with no first PUDO leaves here.
    if (parcel.originAgentDid) throw new GlosError('WRONG_PUDO', `Parcel ${parcelId} is booked for drop-off at a shop, not for collection here`);
    if (parcel.destZone !== bag.destinationNodeId) {
      throw new GlosError('WRONG_DESTINATION', `${parcelId} is going to ${parcel.destZone}, but this bag goes to ${bag.destinationLabel}`, {
        parcelId,
        parcelDest: parcel.destZone,
        bagDest: bag.destinationLabel,
      });
    }
    const holder = this.totes.atLocation(vendor.did).find((t) => t.parcels.includes(parcelId));
    if (holder) throw new GlosError('ALREADY_IN_BAG', `Parcel ${parcelId} is already in bag ${holder.code}`, { parcelId, bagCode: holder.code });

    return this.mdps.fillTote(code, parcelId); // capacity + cargo compatibility, shared with every other bag
  }

  /**
   * Close the bag and offer it. The completeness gate applies here too — a paid parcel left on a dock is as
   * stranded as one left on a shelf, and the person who can fix it is standing next to it.
   */
  sealBag(code: string, vendorId: string, input: { acknowledgeShortShip?: boolean; shortShipReason?: string; closure?: { seal?: string; photoRef?: string }; by?: string } = {}): { tote: Tote; parcels: string[]; missed: string[]; shortShipped: boolean } {
    const vendor = this.vendors.get(vendorId);
    const bag = this.totes.requireByCode(code);
    if (bag.locationId !== vendor.did) throw new GlosError('WRONG_PUDO', `Bag ${code} is not on this dock`);
    if (bag.sealedAt) throw new GlosError('INVALID_STATE', `Bag ${code} is already closed`);
    if (bag.status !== 'filling' && bag.status !== 'available') throw new GlosError('INVALID_STATE', `Bag ${code} is ${bag.status}, it can no longer be closed`);

    const inBag = new Set(bag.parcels);
    const missed = this.waiting(vendorId)
      .filter((p) => p.destZone === bag.destinationNodeId && !inBag.has(p.parcelId))
      .map((p) => p.parcelId);
    if (missed.length && !input.acknowledgeShortShip) {
      throw new GlosError('INCOMPLETE_MANIFEST', `${missed.length} paid parcel(s) for ${bag.destinationLabel} are still on the dock — bag them, or leave them on purpose.`, {
        missed,
        code,
      });
    }
    // Round 36 — closed for the road as at a counter: its coded seal's number and a photograph, or a photograph alone.
    const keepClosure = this.closures.checkClose(bag, { did: vendor.did, name: input.by?.trim() || vendor.name, place: vendor.name }, vendor.did, input.closure);
    // A knowing omission is stamped exactly as a shop's is, so the control tower reads one story either way.
    if (missed.length) this.parcels.markShortShipped(missed, vendor.did, `bag ${code}`, (input.shortShipReason ?? '').trim() || 'not bagged');

    const announce = bag.status === 'filling';
    const tote = announce ? this.totes.markAvailable(code) : bag;
    this.totes.markSealed(code);
    keepClosure({ at: new Date().toISOString() });
    if (announce) {
      void this.events
        .publish(GlosEvent.Pudo.ToteAvailable, { code: tote.code, reason: 'sealed', weightKg: tote.weightKg, destination: tote.destinationLabel }, { source: 'pudo' })
        .catch(() => undefined);
    }
    return { tote, parcels: [...bag.parcels], missed, shortShipped: missed.length > 0 };
  }

  /**
   * What is waiting on this dock: the vendor's own parcels, paid, minted for collection here, not yet gone.
   *
   * `Created` is the whole filter and it is deliberate — a parcel that reached a PUDO is At_PUDO and no
   * longer this dock's business, and an unpaid one is not the network's business at all yet.
   */
  waiting(vendorId: string) {
    return this.parcels
      .list({ vendorId })
      // …and no first PUDO: a parcel the store booked to hand in at a shop is going there, not onto this
      // dock, so it must not be demanded by the seal gate either.
      .filter((p) => p.status === 'Created' && p.paidStatus === 'ParcelPaid' && !p.originAgentDid && !p.shortShippedAt);
  }

  /** What to bag, and what is already open — the dock's answer to the shop's bag plan. */
  plan(vendorId: string): {
    groups: Array<{ key: string; label: string; parcelIds: string[]; openBagCode?: string }>;
    bags: Array<{ code: string; destinationLabel?: string; parcelIds: string[]; parcels: number; fillPct: number; status: string }>;
    staging: { capacity: number; used: number; free: number };
  } {
    const vendor = this.vendors.get(vendorId);
    const dock = this.vendors.requireCollection(vendorId);
    const open = this.totes.atLocation(vendor.did).filter((t) => t.status === 'filling' || t.status === 'available');
    const byZone = new Map<string, string[]>();
    for (const parcel of this.waiting(vendorId)) {
      const ids = byZone.get(parcel.destZone) ?? [];
      ids.push(parcel.parcelId);
      byZone.set(parcel.destZone, ids);
    }
    const staged = this.stagedBags(vendor.did);
    return {
      // Busiest first, exactly as a shop's plan: with a bay or two free, the fullest bag is the one to pack.
      groups: [...byZone.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([key, parcelIds]) => ({ key, label: key, parcelIds, openBagCode: open.find((t) => t.destinationNodeId === key && t.status === 'filling')?.code })),
      bags: open.map((t) => ({ code: t.code, destinationLabel: t.destinationLabel, parcelIds: [...t.parcels], parcels: t.parcels.length, fillPct: this.totes.fillPct(t), status: t.status })),
      staging: { capacity: dock.bays, used: staged.length, free: Math.max(0, dock.bays - staged.length) },
    };
  }
}
