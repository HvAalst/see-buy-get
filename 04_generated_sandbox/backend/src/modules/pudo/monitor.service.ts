import { Injectable } from '@nestjs/common';
import { AgentService } from './agent.service';
import { ParcelService } from './parcel.service';
import { CorridorService } from './corridor.service';
import { WalletGateService } from './wallet-gate.service';
import { AGENT_ONLINE_H, CONNECTIVITY_LOSS_H, GHOST_BUS_H, MDP_DWELL_H, STAGNANT_INVENTORY_H } from './pudo.config';

export interface PudoFlag {
  type: 'Stagnant_Inventory' | 'Ghost_Bus' | 'Stuck_At_MDP' | 'Connectivity_Loss' | 'Blocked_Corridor';
  subject: string;
  detail: string;
  ageHours?: number;
}

const hoursSince = (iso?: string): number => (iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : 0);

/**
 * MonitorService (P-006, ↔ M7/M4/SSE light). The exception-management half of the Control Tower done
 * with time windows instead of AI: Stagnant Inventory (> 48 h At_PUDO), Ghost Bus (> 6 h On_Bus),
 * Connectivity Loss (agent no-ping > 2 h), Blocked Corridor. Also serves the operator dashboard KPIs,
 * the finance health roll-up, and the User/Support parcel timeline.
 */
@Injectable()
export class MonitorService {
  constructor(
    private readonly agents: AgentService,
    private readonly parcels: ParcelService,
    private readonly corridors: CorridorService,
    private readonly gate: WalletGateService,
  ) {}

  /** Time-window auto-flags — 'what's on fire' (Ch 14). */
  flags(): PudoFlag[] {
    const flags: PudoFlag[] = [];

    for (const p of this.parcels.list({ status: 'At_PUDO' })) {
      const age = hoursSince(p.acceptedAt);
      if (age > STAGNANT_INVENTORY_H) flags.push({ type: 'Stagnant_Inventory', subject: p.parcelId, detail: `At_PUDO ${Math.round(age)}h`, ageHours: Math.round(age) });
    }
    for (const p of this.parcels.list({ status: 'On_Bus' })) {
      const age = hoursSince(p.handedToBusAt);
      if (age > GHOST_BUS_H) flags.push({ type: 'Ghost_Bus', subject: p.parcelId, detail: `On_Bus ${Math.round(age)}h`, ageHours: Math.round(age) });
    }
    for (const p of this.parcels.list({ status: 'At_MDP' })) {
      const age = hoursSince(p.scans[p.scans.length - 1]?.at); // since the drop/sort scan at the hub
      if (age > MDP_DWELL_H) flags.push({ type: 'Stuck_At_MDP', subject: p.parcelId, detail: `At_MDP ${Math.round(age)}h`, ageHours: Math.round(age) });
    }
    for (const a of this.agents.list()) {
      const age = hoursSince(a.lastPingAt);
      if (age > CONNECTIVITY_LOSS_H && a.status !== 'DRAFT' && a.status !== 'KYC_PENDING') flags.push({ type: 'Connectivity_Loss', subject: a.shopName, detail: `No ping ${Math.round(age)}h`, ageHours: Math.round(age) });
    }
    for (const c of this.corridors.listCorridors()) {
      if (c.status === 'blocked') flags.push({ type: 'Blocked_Corridor', subject: c.name, detail: `${c.originZone} → ${c.destZone} blocked` });
    }
    return flags;
  }

  /** Operator dashboard — answers 'is the network moving / are agents online / is money flowing / what's on fire' in 5s. */
  dashboard() {
    const allAgents = this.agents.list();
    const online = allAgents.filter((a) => hoursSince(a.lastPingAt) <= AGENT_ONLINE_H).length;
    const active = allAgents.filter((a) => a.status === 'ACTIVE').length;
    const inTransit = this.parcels.list({ status: 'On_Bus' }).length;
    const statusMix: Record<string, number> = {};
    for (const p of this.parcels.list()) statusMix[p.status] = (statusMix[p.status] ?? 0) + 1;
    const flags = this.flags();
    return {
      parcelsInTransit: inTransit,
      agentsOnline: online,
      agentsTotal: allAgents.length,
      agentRetention: allAgents.length ? Math.round((active / allAgents.length) * 100) / 100 : 0,
      systemFloat: this.gate.float(),
      criticalAlerts: flags.length,
      statusMix,
      flags,
      at: new Date().toISOString(),
    };
  }

  /** Finance health — float, today's revenue (FEE), and the typed ledger roll-up. */
  finance() {
    const today = new Date().toISOString().slice(0, 10);
    const fees = this.gate.entries({ type: 'FEE' }).filter((e) => e.at.startsWith(today));
    const todayRevenue = Math.round(fees.reduce((s, e) => s + e.amount, 0) * 100) / 100;
    return { systemFloat: this.gate.float(), todayRevenue, feeCount: fees.length, recentLedger: this.gate.entries().slice(0, 20), at: new Date().toISOString() };
  }

  /** PUDO coverage heatmap (Ch 14 Map): every registered node + its operational state, plus density
   *  cells — the spatial picture that feeds journey-leg planning. */
  heatmap() {
    const points = this.agents.list().filter((a) => a.location).map((a) => {
      const offline = hoursSince(a.lastPingAt) > CONNECTIVITY_LOSS_H;
      const state = a.status !== 'ACTIVE' ? 'inactive' : a.openState === 'closed' ? 'closed' : offline ? 'inactive' : 'open';
      return { lat: a.location.lat, lng: a.location.lng, shopName: a.shopName, zone: a.zone, state, status: a.status };
    });
    const cellMap = new Map<string, number>();
    for (const p of points) { const key = `${p.lat.toFixed(1)},${p.lng.toFixed(1)}`; cellMap.set(key, (cellMap.get(key) ?? 0) + 1); }
    const counts = {
      registered: points.length,
      open: points.filter((p) => p.state === 'open').length,
      closed: points.filter((p) => p.state === 'closed').length,
      inactive: points.filter((p) => p.state === 'inactive').length,
    };
    return { points, cells: [...cellMap.entries()].map(([cell, count]) => ({ cell, count })), counts, at: new Date().toISOString() };
  }

  /** User/Support — the parcel audit timeline ('where is my package', 'it was damaged'). */
  parcelTimeline(parcelId: string) {
    const p = this.parcels.get(parcelId);
    return { parcelId: p.parcelId, status: p.status, size: p.size, origin: p.originZone, destination: p.destZone, dropoffPhotoRef: p.dropoffPhotoRef, deliveredPhotoRef: p.deliveredPhotoRef, scans: p.scans };
  }
}
