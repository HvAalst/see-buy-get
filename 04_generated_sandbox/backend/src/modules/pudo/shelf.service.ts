import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { CONSOLIDATION_MAX_ITEMS, SHELF_COLORS } from './pudo.config';
import { ParcelSize, ShelfSlot } from './pudo.types';

/**
 * ShelfService (chaos shelving as a grid). Each agent's shelf is rows × columns; columns are
 * colour-coded and rows numbered, so a slot reads like "Green-3". This replaces the m² hard cap with
 * a real free-slot count, assigns each parcel to a slot, persists it for customer pickup, and frees it
 * on collection — the data the routing layer uses to avoid committing parcels to full nodes.
 *
 * A slot may be a CONSOLIDATION ("bundle") slot the agent designates: it pools multiple small (S) parcels
 * — letters and envelopes — so they don't each burn a whole slot. A bundle slot holds up to
 * CONSOLIDATION_MAX_ITEMS; a normal slot holds exactly one. Occupancy is therefore a list per slot.
 */
@Injectable()
export class ShelfService {
  /** agentDid → (slotLabel → parcelIds on it). A normal slot holds 0..1; a bundle slot 0..MAX. */
  private readonly occupancy = new Map<string, Map<string, string[]>>();

  constructor(private readonly agents: AgentService) {}

  private occ(agentDid: string): Map<string, string[]> {
    let m = this.occupancy.get(agentDid);
    if (!m) {
      m = new Map();
      this.occupancy.set(agentDid, m);
    }
    return m;
  }

  /** The labels the agent has designated as consolidation (bundle) slots. */
  private bundleLabels(agentDid: string): Set<string> {
    return new Set(this.agents.get(agentDid).shelf.consolidationSlots ?? []);
  }

  private hasRoom(s: ShelfSlot): boolean {
    return s.consolidation ? (s.items?.length ?? 0) < (s.maxItems ?? CONSOLIDATION_MAX_ITEMS) : !s.occupiedBy;
  }

  /** The full slot grid for an agent, with current occupancy + consolidation marks. */
  grid(agentDid: string): ShelfSlot[] {
    const { rows, cols } = this.agents.get(agentDid).shelf;
    const occ = this.occupancy.get(agentDid) ?? new Map<string, string[]>();
    const bundles = this.bundleLabels(agentDid);
    const slots: ShelfSlot[] = [];
    for (let c = 0; c < cols; c += 1) {
      const color = SHELF_COLORS[c % SHELF_COLORS.length];
      for (let r = 1; r <= rows; r += 1) {
        const label = `${color}-${r}`;
        const items = occ.get(label) ?? [];
        if (bundles.has(label)) {
          slots.push({ label, color, row: r, col: c + 1, consolidation: true, items: [...items], maxItems: CONSOLIDATION_MAX_ITEMS });
        } else {
          slots.push({ label, color, row: r, col: c + 1, occupiedBy: items[0] });
        }
      }
    }
    return slots;
  }

  capacity(agentDid: string): number {
    const { rows, cols } = this.agents.get(agentDid).shelf;
    return rows * cols;
  }

  /** Slots that can still take at least one more parcel (a free normal slot, or a bundle slot with room). */
  available(agentDid: string): number {
    return this.grid(agentDid).filter((s) => this.hasRoom(s)).length;
  }

  hasSpace(agentDid: string): boolean {
    return this.available(agentDid) > 0;
  }

  /**
   * Assign the parcel to a slot for pickup. A SMALL (S) parcel prefers a bundle slot with room — so letters
   * and envelopes pool instead of each burning a whole slot — and falls back to a free normal slot. A larger
   * parcel takes a free normal slot only (never a bundle slot). Persists the assignment for pickup.
   */
  assign(agentDid: string, parcelId: string, size: ParcelSize): string {
    const grid = this.grid(agentDid);
    const bundle = size === 'S' ? grid.find((s) => s.consolidation && this.hasRoom(s)) : undefined;
    const target = bundle ?? grid.find((s) => !s.consolidation && !s.occupiedBy);
    if (!target) throw new GlosError('SHELF_FULL', 'Shelf is full at this PUDO');
    const occ = this.occ(agentDid);
    const items = occ.get(target.label) ?? [];
    items.push(parcelId);
    occ.set(target.label, items);
    return target.label;
  }

  /** Free the slot (or the bundle-slot entry) holding this parcel — on collection / void. */
  release(agentDid: string, parcelId: string): void {
    const occ = this.occupancy.get(agentDid);
    if (!occ) return;
    for (const [label, items] of occ) {
      const i = items.indexOf(parcelId);
      if (i >= 0) {
        items.splice(i, 1);
        if (!items.length) occ.delete(label);
        return;
      }
    }
  }
}
