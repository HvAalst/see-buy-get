import { Injectable, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { EventBus } from '../../foundation/events/event-bus.service';
import { AgentService } from './agent.service';
import { JourneyPlanService } from './journey-plan.service';
import { MdpService } from './mdp.service';
import { ParcelService } from './parcel.service';
import { nextStopOf } from './route-plan.service';
import { RoutingService, type RouteEnd } from './routing.service';
import { ToteService } from './tote.service';
import { VendorService } from './vendor.service';
import { BagClosureService } from './bag-closure.service';
import { Parcel, Tote, Vendor } from './pudo.types';

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
 * 2026-11-06 — ONE PLAN PER PARCEL HERE TOO (movement unification). A dock's parcels were bagged by the AREA they go to,
 * while their price was worked out on a route from the dock through the hubs; and they were never planned at all, so
 * nothing asked them their way and plan versus actual never saw them. Now the dock bags by each parcel's NEXT STOP — a
 * hub, or the shop a direct route runs to (an area's bag could be received by no shop) — and a parcel's plan is kept from
 * the dock the moment it is bagged: the store's "it goes now", as a shop's taking a parcel in is.
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
    private readonly agents: AgentService,
    private readonly routing: RoutingService,
    // Optional only for the tests that build the parcel module without the plans: without it, no plan is kept here.
    @Optional() private readonly journeys?: JourneyPlanService,
  ) {}

  /** Open a bag on the vendor's dock for one destination. Refused once the dock's floor is full. */
  openBag(vendorId: string, destination: string): Tote {
    const vendor = this.vendors.get(vendorId);
    const dock = this.vendors.requireCollection(vendorId);
    const to = destination?.trim();
    if (!to) throw new GlosError('FIELD_REQUIRED', 'A bag needs a destination');
    // 2026-11-06 — addressed to the stop its parcels go to next (the dock's plan, by stop): a hub that may work, called by its
    // name, or the shop a direct route runs to, which receives it (MdpService.deliverBag).
    const hub = this.mdps.list().some((m) => m.mdpId === to) ? this.mdps.working(to) : undefined;
    const shop = hub ? undefined : this.agents.find(to);
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
    return this.totes.assign(tote.code, to, hub ? hub.name : shop ? shop.shopName : to, { sealRequired: true });
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
   * than a counter can), and it is going where the bag is going — its next stop (2026-11-06).
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
    // Reading B — booked to be handed in at a hub, in bulk: the store takes it there itself.
    if (parcel.handInMdpId) throw new GlosError('WRONG_PUDO', `Parcel ${parcelId} is booked to be handed in at a hub, not for collection here`);
    // 2026-11-06 — the bag for its NEXT STOP by its plan: kept, or as it is planned from this dock now. Refused, with where it
    // goes — a dock does not send a parcel another way: the network plans it.
    const next = this.stopFor(vendor, parcel);
    if (!this.goesTo(bag, next.key)) {
      throw new GlosError('WRONG_DESTINATION', `${parcelId} goes to ${next.label} next, but this bag goes to ${bag.destinationLabel}`, {
        parcelId,
        parcelDest: next.label,
        bagDest: bag.destinationLabel,
      });
    }
    const holder = this.totes.atLocation(vendor.did).find((t) => t.parcels.includes(parcelId));
    if (holder) throw new GlosError('ALREADY_IN_BAG', `Parcel ${parcelId} is already in bag ${holder.code}`, { parcelId, bagCode: holder.code });

    const filled = this.mdps.fillTote(code, parcelId); // capacity + cargo compatibility, shared with every other bag
    // Its plan kept from this dock, now — once (JourneyPlanService.freeze keeps the first). The route checked above.
    const from = this.dockEnd(vendor);
    if (from) this.journeys?.freeze(parcelId, Date.now(), from);
    return filled;
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
    // 2026-11-06 — a parcel in ANOTHER bag on this dock (closed, waiting for its driver) is not left behind: it was counted as
    // missed, and leaving it "on purpose" marked it short-shipped while it sat in the first bag — as at a shop (0b79b7fa).
    const inOtherBags = new Set(this.totes.atLocation(vendor.did).filter((t) => t.code !== bag.code).flatMap((t) => t.parcels));
    const missed = this.waiting(vendorId)
      .filter((p) => !inBag.has(p.parcelId) && !inOtherBags.has(p.parcelId) && this.goesTo(bag, this.stopFor(vendor, p).key))
      .map((p) => p.parcelId);
    if (missed.length && !input.acknowledgeShortShip) {
      throw new GlosError('INCOMPLETE_MANIFEST', `${missed.length} paid parcel(s) for ${bag.destinationLabel} are still on the dock — bag them, or leave them on purpose.`, {
        missed,
        code,
      });
    }
    // Round 36 — closed for the road as at a counter: its coded seal's number and a photograph, or a photograph alone.
    // The photograph is the business's own where the dock is a business's place (2026-10-29), as its content photos are.
    const keepClosure = this.closures.checkClose(bag, { did: vendor.did, name: input.by?.trim() || vendor.name, place: vendor.name }, vendor.business?.did ?? vendor.did, input.closure);
    // A knowing omission is stamped exactly as a shop's is, so the control tower reads one story either way.
    if (missed.length) this.parcels.markShortShipped(missed, vendor.did, `bag ${code}`, (input.shortShipReason ?? '').trim() || 'not bagged');

    const announce = bag.status === 'filling';
    const tote = announce ? this.totes.markAvailable(code) : bag;
    this.totes.markSealed(code);
    keepClosure({ at: new Date().toISOString() });
    // 2026-11-02 — offered where the hub it goes to has room; held on the dock, the store told, where none has.
    if (announce) this.mdps.offerBag(tote.code, 'sealed');
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
      .filter((p) => p.status === 'Created' && p.paidStatus === 'ParcelPaid' && !p.originAgentDid && !p.handInMdpId && !p.shortShippedAt);
  }

  /** What to bag, and what is already open — the dock's answer to the shop's bag plan: by next stop (2026-11-06). */
  plan(vendorId: string): {
    groups: Array<{ key: string; label: string; parcelIds: string[]; openBagCode?: string }>;
    bags: Array<{ code: string; destinationLabel?: string; parcelIds: string[]; parcels: number; fillPct: number; status: string; waitsFor?: string }>;
    staging: { capacity: number; used: number; free: number };
  } {
    const vendor = this.vendors.get(vendorId);
    const dock = this.vendors.requireCollection(vendorId);
    const open = this.totes.atLocation(vendor.did).filter((t) => t.status === 'filling' || t.status === 'available');
    const byStop = new Map<string, { label: string; parcelIds: string[] }>();
    for (const parcel of this.waiting(vendorId)) {
      const next = this.stopFor(vendor, parcel);
      const group = byStop.get(next.key) ?? { label: next.label, parcelIds: [] };
      group.parcelIds.push(parcel.parcelId);
      byStop.set(next.key, group);
    }
    const staged = this.stagedBags(vendor.did);
    return {
      // Busiest first, exactly as a shop's plan: with a bay or two free, the fullest bag is the one to pack.
      groups: [...byStop.entries()]
        .sort((a, b) => b[1].parcelIds.length - a[1].parcelIds.length || a[1].label.localeCompare(b[1].label))
        .map(([key, g]) => ({ key, label: g.label, parcelIds: g.parcelIds, openBagCode: open.find((t) => t.destinationNodeId === key && t.status === 'filling')?.code })),
      // 2026-11-02 — a closed bag held on the dock for room at its hub says which hub: it goes on by itself.
      bags: open.map((t) => ({ code: t.code, destinationLabel: t.destinationLabel, parcelIds: [...t.parcels], parcels: t.parcels.length, fillPct: this.totes.fillPct(t), status: t.status, ...(t.waitsForRoom ? { waitsFor: t.waitsForRoom.hubName } : {}) })),
      staging: { capacity: dock.bays, used: staged.length, free: Math.max(0, dock.bays - staged.length) },
    };
  }

  /* --------------------------------------------------------------------------------------------------------- inside -- */

  /** This vendor's dock as the place a journey starts: its collection point — a place on the route, not a node of the network. */
  private dockEnd(vendor: Vendor): RouteEnd | undefined {
    const dock = vendor.collection;
    return dock ? { type: 'dock', id: vendor.did, label: dock.label, zone: dock.zone, country: this.vendors.dockCountryOf(vendor), location: dock.location } : undefined;
  }

  /**
   * Where a parcel on this dock goes next (2026-11-06): its kept plan's next stop; else as it is planned from this dock now —
   * a hub, or the shop a direct route runs to; else, with no route to plan, its zone, as before.
   */
  private stopFor(vendor: Vendor, parcel: Parcel): { key: string; label: string } {
    const kept = nextStopOf(parcel);
    if (kept) return { key: kept.id, label: kept.label };
    const from = parcel.destAgentDid ? this.dockEnd(vendor) : undefined;
    if (from) {
      try {
        const next = this.routing.planJourney({ from, destAgentDid: parcel.destAgentDid!, weightKg: parcel.weightKg }).hops[1];
        if (next) return { key: next.id, label: next.label };
      } catch {
        // No route from here to plan: its zone, the honest answer left.
      }
    }
    return { key: parcel.destZone, label: parcel.destZone };
  }

  /** Whether a bag goes to this stop: addressed to it, or packed for it and sent on for room (Tote.packedFor). */
  private goesTo(bag: Tote, key: string): boolean {
    return bag.destinationNodeId === key || bag.packedFor === key;
  }
}
