import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AgentService } from './agent.service';
import { CONSOLIDATION_MAX_ITEMS, MIN_SLOTS, SHELF_COLORS } from './pudo.config';
import { Agent, ParcelSize, ShelfConfig, ShelfSlot } from './pudo.types';

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
  /**
   * agentDid → (slotLabel → parcelIds on it). A normal slot holds 0..1; a bundle slot 0..MAX.
   *
   * KEPT ON DISK. It was a plain Map, and the comment above said "persists it": what was persisted was the
   * label written on each parcel, not which slots were taken. So after every restart every shelf in the
   * network read as EMPTY — the routing layer sent parcels to shops that were full, and the next parcel to
   * arrive was given "Red-1" while the parcel already in Red-1 was still waiting to be collected. Two
   * parcels told to be in one place is the one thing a chaos shelf exists to prevent, and a live server
   * restarts on every deploy.
   */
  private readonly occupancy = new PersistentMap<string, Record<string, string[]>>('pudo-shelf-occupancy');

  constructor(private readonly agents: AgentService) {}

  private occ(agentDid: string): Record<string, string[]> {
    return this.occupancy.get(agentDid) ?? {};
  }

  /** Replace one shop's occupancy whole — the store writes on `set`, and an edit in place would not reach the disk. */
  private put(agentDid: string, occ: Record<string, string[]>): void {
    if (Object.keys(occ).length) this.occupancy.set(agentDid, occ);
    else this.occupancy.delete(agentDid);
  }

  /** The labels the agent has designated as consolidation (bundle) slots. */
  private bundleLabels(agentDid: string): Set<string> {
    return new Set(this.agents.get(agentDid).shelf.consolidationSlots ?? []);
  }

  private hasRoom(s: ShelfSlot): boolean {
    return s.consolidation ? (s.items?.length ?? 0) < (s.maxItems ?? CONSOLIDATION_MAX_ITEMS) : !s.occupiedBy;
  }

  /** Every slot label a grid of this shape has, in the order parcels are given them. */
  private static labels(shelf: Pick<ShelfConfig, 'rows' | 'cols'>): string[] {
    const out: string[] = [];
    for (let c = 0; c < shelf.cols; c += 1) for (let r = 1; r <= shelf.rows; r += 1) out.push(`${SHELF_COLORS[c % SHELF_COLORS.length]}-${r}`);
    return out;
  }

  /** The full slot grid for an agent, with current occupancy + consolidation marks. */
  grid(agentDid: string): ShelfSlot[] {
    const { rows, cols } = this.agents.get(agentDid).shelf;
    const occ = this.occ(agentDid);
    const bundles = this.bundleLabels(agentDid);
    const slots: ShelfSlot[] = [];
    for (let c = 0; c < cols; c += 1) {
      const color = SHELF_COLORS[c % SHELF_COLORS.length];
      for (let r = 1; r <= rows; r += 1) {
        const label = `${color}-${r}`;
        const items = occ[label] ?? [];
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
   * Would every one of these parcels find a place, given what is standing on the shelf now? Counted the way
   * `assign` places them: a small one in a slot kept for small ones while there is room, anything else — and
   * a small one with nowhere to pool — in a free slot of its own.
   *
   * Asked BEFORE a bag is opened, so that a bag goes onto the shelf whole or not at all.
   */
  fits(agentDid: string, sizes: ParcelSize[]): boolean {
    const grid = this.grid(agentDid);
    let free = grid.filter((s) => !s.consolidation && !s.occupiedBy).length;
    let pooled = grid.filter((s) => s.consolidation).reduce((room, s) => room + Math.max(0, (s.maxItems ?? CONSOLIDATION_MAX_ITEMS) - (s.items?.length ?? 0)), 0);
    for (const size of sizes) {
      if (size === 'S' && pooled > 0) pooled -= 1;
      else if (free > 0) free -= 1;
      else return false;
    }
    return true;
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
    if (!target) throw new GlosError('SHELF_FULL', 'The shelf here is full. Hand over a parcel that is waiting, or add a row under “Set up shelves”, then scan this one again');
    const occ = this.occ(agentDid);
    this.put(agentDid, { ...occ, [target.label]: [...(occ[target.label] ?? []), parcelId] });
    return target.label;
  }

  /** Free the slot (or the bundle-slot entry) holding this parcel — on collection / void. */
  release(agentDid: string, parcelId: string): void {
    const occ = this.occ(agentDid);
    for (const [label, items] of Object.entries(occ)) {
      const i = items.indexOf(parcelId);
      if (i < 0) continue;
      const rest = [...items.slice(0, i), ...items.slice(i + 1)];
      const next = { ...occ };
      if (rest.length) next[label] = rest;
      else delete next[label];
      this.put(agentDid, next);
      return;
    }
  }

  /**
   * A SHOP CHANGES THE SHAPE OF ITS SHELF — and may not change it out from under a parcel.
   *
   * The grid was replaced with whatever was typed. A shop that went from three columns to two while a parcel
   * sat in the third kept that parcel on its record, labelled for a slot that no longer existed: it dropped
   * off the shop's own shelf view, and the buyer who came for it was sent to a place that was not there. The
   * same happened to a bundle of letters the moment their slot was un-marked — it showed the first and lost
   * the rest. So a change is refused while it would strand something, and says which slot and what is in it.
   *
   * Three limits that are not new, only now kept on this path as well: at least the slots a shop needs to
   * be a shop at all (the rule it was approved under); at most one column per colour, because a column IS a
   * colour and an eleventh would be a second "Red"; and a bundle slot has to be a slot of this shelf.
   */
  reconfigure(agentDid: string, shelf: ShelfConfig): Agent {
    const rows = Math.floor(Number(shelf.rows));
    const cols = Math.floor(Number(shelf.cols));
    if (!(rows >= 1) || !(cols >= 1)) throw new GlosError('INVALID_INPUT', 'Shelf needs at least one row and column');
    if (cols > SHELF_COLORS.length) throw new GlosError('INVALID_INPUT', `A shelf has at most ${SHELF_COLORS.length} columns: each column is a colour, and there are ${SHELF_COLORS.length}`);
    if (rows * cols < MIN_SLOTS) throw new GlosError('INVALID_INPUT', `A shop keeps at least ${MIN_SLOTS} slots (rows × columns)`);
    const labels = new Set(ShelfService.labels({ rows, cols }));
    const bundles = [...new Set((shelf.consolidationSlots ?? []).map((l) => l.trim()).filter(Boolean))];
    const unknown = bundles.filter((l) => !labels.has(l));
    if (unknown.length) throw new GlosError('INVALID_INPUT', `${unknown.join(', ')} ${unknown.length === 1 ? 'is not a slot' : 'are not slots'} of a ${rows} × ${cols} shelf`);

    const held = Object.entries(this.occ(agentDid)).filter(([, items]) => items.length > 0);
    const gone = held.filter(([label]) => !labels.has(label));
    if (gone.length) {
      throw new GlosError('INVALID_STATE', `${gone.map(([label, items]) => `${label} holds ${items.join(', ')}`).join('; ')}. Hand ${gone.length === 1 && gone[0][1].length === 1 ? 'it' : 'those'} over first, or keep the shelf large enough for ${gone.length === 1 ? 'that slot' : 'those slots'}`, { slots: gone.map(([label]) => label) });
    }
    const crowded = held.filter(([label, items]) => items.length > 1 && !bundles.includes(label));
    if (crowded.length) {
      throw new GlosError('INVALID_STATE', `${crowded.map(([label, items]) => `${label} holds ${items.length} parcels`).join('; ')}. It stays a slot for several small parcels until they are collected`, { slots: crowded.map(([label]) => label) });
    }
    return this.agents.setShelf(agentDid, { rows, cols, ...(bundles.length ? { consolidationSlots: bundles } : {}) });
  }
}
