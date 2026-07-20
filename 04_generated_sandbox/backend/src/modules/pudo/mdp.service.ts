import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { DidService } from '../../foundation/did/did.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { AgentService } from './agent.service';
import { ParcelService } from './parcel.service';
import { ToteService } from './tote.service';
import { FleetService } from './fleet.service';
import { WalletGateService } from './wallet-gate.service';
import { DEFAULT_MDP_PRICE_PER_PARCEL, MDP_SORT_FEE, TOTE_LOAD_FEE } from './pudo.config';
import { Mdp, NextHop, Tote } from './pudo.types';

/**
 * MdpService — Main Distribution Point hubs + the tote-bag sort flow (Compendium Ch 17).
 *
 * An MDP is the middle of a multi-hop journey: a regional sort centre that covers a set of zones.
 * Unlike a PUDO it does not shelve parcels — it sorts them into tote bags by next destination. The
 * field choreography this service implements:
 *
 *   1. fillTote / loadBag  — an upstream node packs a bag toward this MDP; the driver scans the BAG.
 *   2. dropBag             — the bus drops a bag; the MDP scans its code and EMPTIES it (tote freed).
 *   3. sortParcel          — the worker scans each parcel; the system computes its next destination
 *                            and the destination bag code; the worker drops it into that bag.
 *   4. loadBag             — once a destination bag is full/ready, the onward driver scans it away.
 *
 * Bulk goods never enter a tote — they go truck-direct and are rejected here.
 */
@Injectable()
export class MdpService {
  // Durable: onboarded MDP sort-hubs (a signed-up participant type).
  private readonly mdps = new PersistentMap<string, Mdp>('pudo-mdps');

  constructor(
    private readonly agents: AgentService,
    private readonly parcels: ParcelService,
    private readonly totes: ToteService,
    private readonly fleet: FleetService,
    private readonly gate: WalletGateService,
    private readonly events: EventBus,
    private readonly dids: DidService,
    private readonly core: OperationalStore,
  ) {}

  // --- registry ---

  register(input: { name: string; zones: string[]; location: { lat: number; lng: number }; contactPhone?: string; address?: string; pricePerParcel?: number }): Mdp {
    if (!input.zones?.length) throw new BadRequestException('An MDP must cover at least one zone');
    // Real DID (S2) — an MDP worker is a first-class actor and their token binds to this, not to a
    // synthetic mdp_<hex> id. A pseudonymous operational profile makes it OperationalStore-resolvable
    // (tier/tokenVersion) like every other participant. No PII goes to the core (contact/address stay
    // on the domain record only).
    const did = this.dids.generate(`mdp:${input.name}`, { role: 'pudo-mdp' }).id;
    this.core.upsert({ did, tier: 2, status: 'active', capabilities: ['pudo-mdp'], metadata: { zones: input.zones } });
    const mdp: Mdp = {
      mdpId: `mdp_${randomBytes(5).toString('hex')}`,
      did,
      name: input.name,
      zones: input.zones,
      location: input.location,
      contactPhone: input.contactPhone,
      address: input.address?.trim() || undefined,
      pricePerParcel: input.pricePerParcel ?? DEFAULT_MDP_PRICE_PER_PARCEL,
      createdAt: new Date().toISOString(),
    };
    this.mdps.set(mdp.mdpId, mdp);
    return mdp;
  }

  /** Set the hub's open-data per-parcel sort price (public, drives the shipment quote). */
  setPrice(mdpId: string, pricePerParcel: number): Mdp {
    if (pricePerParcel < 0) throw new BadRequestException('Price cannot be negative');
    const mdp = this.require(mdpId);
    mdp.pricePerParcel = Math.round(pricePerParcel * 100) / 100;
    return mdp;
  }

  list(): Mdp[] {
    return [...this.mdps.values()];
  }

  require(mdpId: string): Mdp {
    const mdp = this.mdps.get(mdpId);
    if (!mdp) throw new NotFoundException(`MDP not found: ${mdpId}`);
    return mdp;
  }

  /** The hub that last-mile-serves a delivery zone (the regional sort centre for that zone). */
  mdpForZone(zone: string): Mdp | undefined {
    return [...this.mdps.values()].find((m) => m.zones.includes(zone));
  }

  /** Register a fresh laminated tote into the pool at this MDP. */
  registerTote(mdpId: string): Tote {
    this.require(mdpId);
    return this.totes.register(mdpId);
  }

  // --- bag flow ---

  /** Pack a parcel into a bag bound for a destination (used at the origin PUDO and after sorting). */
  fillTote(code: string, parcelId: string): { tote: Tote; fillPct: number } {
    const parcel = this.parcels.get(parcelId);
    const tote = this.totes.add(code, parcelId, parcel.size);
    this.parcels.get(parcelId).toteId = tote.toteId; // connect parcel ↔ bag (still where it was)
    return { tote, fillPct: this.totes.fillPct(tote) };
  }

  /** Scan a bag onto a bus — one scan moves the whole tote and every parcel in it to On_Bus.
   * When the badge resolves to a registered fleet vehicle, the bag must fit that vehicle's limits
   * (a bike/motorcycle feeder takes ≤ its capacity and no fragile items). Unknown badges pass through. */
  loadBag(code: string, driverBadgeId: string): { tote: Tote; moved: string[] } {
    const pending = this.totes.requireByCode(code);
    const fleet = this.fleet.resolveBadge(driverBadgeId);
    // A claimed bag may only be loaded by the driver who claimed it.
    if (pending.claimedBy && (!fleet || fleet.driverDid !== pending.claimedBy)) throw new BadRequestException(`Bag ${code} is reserved for another driver`);
    if (fleet && pending.parcels.length) {
      let kg = 0;
      for (const id of pending.parcels) {
        const p = this.parcels.get(id);
        kg += p.weightKg;
        if (p.weightKg > fleet.maxParcelKg) throw new BadRequestException(`Parcel ${id} (${p.weightKg}kg) exceeds the ${fleet.maxParcelKg}kg limit of this ${fleet.vehicle.vehicleClass}`);
        if (p.fragile && !fleet.allowsFragile) throw new BadRequestException(`A ${fleet.vehicle.vehicleClass} cannot carry fragile parcels (${id})`);
      }
      if (kg > fleet.capacityKg) throw new BadRequestException(`Bag ${code} (${kg}kg) exceeds this ${fleet.vehicle.vehicleClass}'s ${fleet.capacityKg}kg capacity`);
    }
    const tote = this.totes.load(code, driverBadgeId);
    for (const parcelId of tote.parcels) {
      this.parcels.setTransit(parcelId, 'On_Bus', driverBadgeId, `bag ${tote.code} → ${tote.destinationLabel ?? tote.destinationNodeId}`, tote.toteId);
      // Graduation: the tote path must raise HANDOVER on the M4 timeline like the direct handover does.
      void this.events.publish(GlosEvent.Pudo.ParcelHandedToBus, { parcelId, driverBadgeId, toteCode: tote.code }, { source: 'pudo' }).catch(() => undefined);
    }
    if (fleet) this.gate.driverPayout(fleet.driverDid, TOTE_LOAD_FEE); // transport fee for the carrying driver
    void this.events.publish(GlosEvent.Pudo.BagLoaded, { toteId: tote.toteId, code: tote.code, driverBadgeId, destinationNodeId: tote.destinationNodeId, parcels: tote.parcels.length }, { source: 'pudo' }).catch(() => undefined);
    return { tote, moved: [...tote.parcels] };
  }

  /** A bus drops a bag at this MDP → scan the bag code, empty it; parcels become unsorted (At_MDP). */
  dropBag(mdpId: string, code: string): { mdpId: string; emptied: string[] } {
    const mdp = this.require(mdpId);
    const before = this.totes.requireByCode(code);
    if (!before.parcels.length) throw new BadRequestException(`Bag ${code} is already empty`);
    const { parcels } = this.totes.empty(code, mdpId);
    for (const parcelId of parcels) {
      const p = this.parcels.setTransit(parcelId, 'At_MDP', mdp.name, `dropped at ${mdp.name} · awaiting sort`, undefined);
      p.atMdpId = mdpId; // scope the inbound queue to this hub
    }
    void this.events.publish(GlosEvent.Pudo.BagArrivedAtMdp, { mdpId, mdpName: mdp.name, code, emptied: parcels.length }, { source: 'pudo' }).catch(() => undefined);
    return { mdpId, emptied: parcels };
  }

  /**
   * Deliver a bag at its destination PUDO: shelve each parcel for pickup (inbound) or issue an OTP
   * (outbound), then empty the tote — freeing it for reuse AND releasing the carrying driver's
   * reserved capacity. This closes the last mile of the tote flow (the PUDO-side equivalent of dropBag).
   */
  deliverBag(agentDid: string, code: string): { code: string; agentDid: string; delivered: string[] } {
    const agent = this.agents.get(agentDid);
    const tote = this.totes.requireByCode(code);
    if (!tote.parcels.length) throw new BadRequestException(`Bag ${code} is empty`);
    if (tote.destinationNodeId && tote.destinationNodeId !== agentDid) throw new BadRequestException(`Bag ${code} is addressed to ${tote.destinationLabel || tote.destinationNodeId}, not ${agent.shopName}`);
    const delivered: string[] = [];
    for (const parcelId of [...tote.parcels]) {
      const parcel = this.parcels.get(parcelId);
      if (parcel.direction === 'inbound') this.parcels.shelve(parcelId, agentDid);
      else this.parcels.arrive(parcelId, agentDid); // outbound → OTP issued to the receiver
      parcel.toteId = undefined;
      delivered.push(parcelId);
    }
    this.totes.empty(code, agentDid); // free the tote + release the driver's reserved capacity
    void this.events.publish(GlosEvent.Pudo.BagDelivered, { code, agentDid, delivered: delivered.length }, { source: 'pudo' }).catch(() => undefined);
    return { code, agentDid, delivered };
  }

  /**
   * Sort one parcel at an MDP: compute its next destination, find/open the destination bag, drop it
   * in. Returns exactly what the worker's screen shows — the next destination + the bag code to use.
   */
  sortParcel(mdpId: string, parcelId: string): { parcelId: string; nextDestination: NextHop; toteCode: string; toteId: string; fillPct: number } {
    const mdp = this.require(mdpId);
    const parcel = this.parcels.get(parcelId);
    if (parcel.status !== 'At_MDP') throw new BadRequestException(`Parcel is ${parcel.status}, must be At_MDP to sort`);
    if (!parcel.destAgentDid) throw new BadRequestException('Parcel has no destination PUDO to sort toward');

    const next = this.nextHop(mdp, parcel.destZone, parcel.destAgentDid);

    // Find a filling bag already bound to that next hop with room, else open + assign a fresh one.
    let tote = this.totes.findFilling(mdpId, next.id, parcel.size);
    if (!tote) {
      tote = this.totes.register(mdpId);
      this.totes.assign(tote.code, next.id, next.label);
    }
    this.totes.add(tote.code, parcelId, parcel.size);
    parcel.toteId = tote.toteId; // bag ↔ parcel; stays At_MDP until the bag is loaded onward
    this.gate.sortLabour(mdpId, MDP_SORT_FEE, parcelId); // MDP sort labour

    void this.events.publish(GlosEvent.Pudo.ParcelSorted, { parcelId, mdpId, nextDestinationId: next.id, nextDestinationType: next.type, toteCode: tote.code }, { source: 'pudo' }).catch(() => undefined);
    return { parcelId, nextDestination: next, toteCode: tote.code, toteId: tote.toteId, fillPct: this.totes.fillPct(tote) };
  }

  /**
   * Next hop for a parcel sitting at `mdp`, heading to `destAgentDid` in `destZone`:
   * if this MDP serves the destination zone → the destination PUDO (last mile);
   * otherwise → the MDP that serves the destination zone (inter-hub leg).
   */
  nextHop(mdp: Mdp, destZone: string, destAgentDid: string): NextHop {
    if (mdp.zones.includes(destZone)) {
      const dest = this.agents.get(destAgentDid);
      return { type: 'pudo', id: dest.did, label: dest.shopName, zone: destZone };
    }
    const onward = this.mdpForZone(destZone);
    if (!onward) throw new BadRequestException(`No MDP serves destination zone ${destZone}`);
    return { type: 'mdp', id: onward.mdpId, label: onward.name, zone: destZone };
  }
}
