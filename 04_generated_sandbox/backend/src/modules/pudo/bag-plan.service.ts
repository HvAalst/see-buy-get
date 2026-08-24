import { Injectable } from '@nestjs/common';
import { AgentService } from './agent.service';
import { ParcelService } from './parcel.service';
import { RoutingService } from './routing.service';
import { ToteService } from './tote.service';
import { Parcel } from './pudo.types';

/** One bag's worth of work: the parcels sharing a next hop, and the open bag for it if there is one. */
export interface BagGroup {
  key: string; // the next hop's id — an MDP id, or a zone when the route runs direct
  label: string;
  via: 'direct' | 'hub';
  parcelIds: string[];
  openBagCode?: string;
}

/**
 * BagPlanService — what a shop should be bagging right now.
 *
 * Its own service rather than a method on MdpService because RoutingService already depends on
 * MdpService: asking the hub service to consult routing would close a cycle. Nothing depends on this
 * one, so it can read from all three freely.
 */
@Injectable()
export class BagPlanService {
  constructor(
    private readonly agents: AgentService,
    private readonly parcels: ParcelService,
    private readonly totes: ToteService,
    private readonly routing: RoutingService,
  ) {}

  /**
   * Group the shop's waiting parcels by their NEXT HOP — not their final destination, which is the
   * distinction the network actually runs on.
   *
   * Several parcels for Addis Ababa leave a Hawassa shop as ONE bag straight for Addis, bypassing the
   * local hub entirely, while another bag goes to that hub and a third to Arba Minch. Routing decides
   * which; a shopkeeper should never have to work out whether a given parcel goes direct. So each group
   * is one bag's worth of work, and several bags are open at once by design.
   */
  forShop(agentDid: string): { groups: BagGroup[]; bags: Array<{ code: string; destinationLabel?: string; parcelIds: string[]; parcels: number; fillPct: number; status: string }> } {
    this.agents.get(agentDid); // 404 for an unknown shop
    const open = this.totes.atLocation(agentDid).filter((t) => t.status === 'filling' || t.status === 'available');
    const byKey = new Map<string, BagGroup>();

    for (const parcel of this.parcels.list({ status: 'At_PUDO', agentDid })) {
      if (parcel.originAgentDid !== agentDid) continue;
      const hop = this.nextHopFor(parcel);
      const group = byKey.get(hop.key) ?? { ...hop, parcelIds: [] };
      group.parcelIds.push(parcel.parcelId);
      byKey.set(hop.key, group);
    }

    return {
      // Busiest first: the bag with the most parcels in it is the one worth packing next.
      groups: [...byKey.values()]
        .sort((a, b) => b.parcelIds.length - a.parcelIds.length || a.label.localeCompare(b.label))
        .map((g) => ({ ...g, openBagCode: open.find((t) => t.destinationNodeId === g.key)?.code })),
      // parcelIds, not just a count: a shop fills a bag across a working day, so re-opening one has to show
      // what is already inside it — otherwise the screen says "0 in the bag" over a bag holding three.
      bags: open.map((t) => ({ code: t.code, destinationLabel: t.destinationLabel, parcelIds: [...t.parcels], parcels: t.parcels.length, fillPct: this.totes.fillPct(t), status: t.status })),
    };
  }

  /**
   * Where this parcel goes NEXT from here. A route through a hub stops at the hub; a direct route runs to
   * the destination zone. Routing is only asked when it can answer — a parcel with no nominated
   * destination PUDO has no plannable journey yet, and its zone is the honest next hop.
   */
  private nextHopFor(parcel: Parcel): { key: string; label: string; via: 'direct' | 'hub' } {
    if (parcel.destAgentDid) {
      try {
        const plan = this.routing.planJourney({ originAgentDid: parcel.originAgentDid, destAgentDid: parcel.destAgentDid, weightKg: parcel.weightKg });
        const hub = plan.hops.find((h) => h.type === 'mdp');
        if (hub) return { key: hub.id, label: hub.label, via: 'hub' };
      } catch {
        // No plannable route (no corridor, no hub) — the zone is still a true answer, so fall through.
      }
    }
    return { key: parcel.destZone, label: parcel.destZone, via: 'direct' };
  }
}
