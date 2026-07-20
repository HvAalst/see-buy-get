import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentService } from './agent.service';
import { SHELF_COLORS } from './pudo.config';
import { ShelfSlot } from './pudo.types';

/**
 * ShelfService (chaos shelving as a grid). Each agent's shelf is rows × columns; columns are
 * colour-coded and rows numbered, so a slot reads like "Green-3". This replaces the m² hard cap with
 * a real free-slot count, assigns each parcel to a free slot, persists it for customer pickup, and
 * frees it on collection — the data the routing layer uses to avoid committing parcels to full nodes.
 */
@Injectable()
export class ShelfService {
  /** agentDid → (slotLabel → parcelId). */
  private readonly occupancy = new Map<string, Map<string, string>>();

  constructor(private readonly agents: AgentService) {}

  /** The full slot grid for an agent, with current occupancy. */
  grid(agentDid: string): ShelfSlot[] {
    const { rows, cols } = this.agents.get(agentDid).shelf;
    const occ = this.occupancy.get(agentDid) ?? new Map();
    const slots: ShelfSlot[] = [];
    for (let c = 0; c < cols; c += 1) {
      const color = SHELF_COLORS[c % SHELF_COLORS.length];
      for (let r = 1; r <= rows; r += 1) {
        const label = `${color}-${r}`;
        slots.push({ label, color, row: r, col: c + 1, occupiedBy: occ.get(label) });
      }
    }
    return slots;
  }

  capacity(agentDid: string): number {
    const { rows, cols } = this.agents.get(agentDid).shelf;
    return rows * cols;
  }

  available(agentDid: string): number {
    return this.capacity(agentDid) - (this.occupancy.get(agentDid)?.size ?? 0);
  }

  hasSpace(agentDid: string): boolean {
    return this.available(agentDid) > 0;
  }

  /** Assign the parcel to the first free slot; persists the assignment for pickup. */
  assign(agentDid: string, parcelId: string): string {
    const occ = this.occupancy.get(agentDid) ?? new Map<string, string>();
    const free = this.grid(agentDid).find((s) => !s.occupiedBy);
    if (!free) throw new BadRequestException('Shelf is full at this PUDO');
    occ.set(free.label, parcelId);
    this.occupancy.set(agentDid, occ);
    return free.label;
  }

  /** Free the slot holding this parcel (on collection / void). */
  release(agentDid: string, parcelId: string): void {
    const occ = this.occupancy.get(agentDid);
    if (!occ) return;
    for (const [label, pid] of occ) if (pid === parcelId) occ.delete(label);
  }
}
