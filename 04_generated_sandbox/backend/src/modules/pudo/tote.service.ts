import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { BAG_CAPACITY_UNITS, SIZE_UNITS, SIZE_WEIGHT_KG, TOTE_CODE_PREFIX } from './pudo.config';
import { ParcelSize, Tote } from './pudo.types';

/**
 * ToteService — the reusable tote-bag pool used at MDP hubs (and for the PUDO→MDP leg). A tote is a
 * laminated QR (`toteId`) slotted into a bag pocket plus a human-readable `code` (BAG-007). Lifecycle:
 *   free  → assign(code, destination) → filling → add(parcel) … → load(driver) → in_transit
 *   in_transit → empty() (the receiving MDP unpacks it) → free   (the bag is reused)
 * Capacity is "fill units" (Ch 17): letters barely count, a >20 kg heavy parcel fills a bag alone.
 * The bag is the unit of handover — a driver scans ONE bag QR, not every parcel inside it.
 */
@Injectable()
export class ToteService {
  private readonly totes = new Map<string, Tote>(); // toteId → tote
  private readonly byCode = new Map<string, string>(); // code → toteId
  private seq = 0;

  /** Register a fresh (laminated) tote into the pool at a location. */
  register(locationId: string): Tote {
    this.seq += 1;
    const tote: Tote = {
      toteId: `tote_${randomBytes(6).toString('hex')}`,
      code: `${TOTE_CODE_PREFIX}-${String(this.seq).padStart(3, '0')}`,
      status: 'free',
      locationId,
      parcels: [],
      unitsUsed: 0,
      weightKg: 0,
    };
    this.totes.set(tote.toteId, tote);
    this.byCode.set(tote.code, tote.toteId);
    return tote;
  }

  /** Link a free tote to a single next destination — it can now take parcels for that destination. */
  assign(code: string, destinationNodeId: string, destinationLabel: string): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'free') throw new BadRequestException(`Bag ${code} is ${tote.status}, must be empty/free to assign`);
    tote.status = 'filling';
    tote.destinationNodeId = destinationNodeId;
    tote.destinationLabel = destinationLabel;
    return tote;
  }

  /** Whether a parcel of this size still fits (heavy fills a bag on its own → needs an empty one). */
  fits(tote: Tote, size: ParcelSize): boolean {
    return tote.unitsUsed + SIZE_UNITS[size] <= BAG_CAPACITY_UNITS + 1e-9;
  }

  /** Drop a parcel into the bag (capacity-checked) and connect bag ↔ parcel. */
  add(code: string, parcelId: string, size: ParcelSize): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'filling') throw new BadRequestException(`Bag ${code} is ${tote.status}, assign it to a destination first`);
    if (!this.fits(tote, size)) throw new BadRequestException(`Bag ${code} is full (${this.fillPct(tote)}%) — open a new bag for this destination`);
    if (!tote.parcels.length) tote.filledAt = new Date().toISOString();
    tote.parcels.push(parcelId);
    tote.unitsUsed = Math.round((tote.unitsUsed + SIZE_UNITS[size]) * 1000) / 1000;
    tote.weightKg = Math.round((tote.weightKg + SIZE_WEIGHT_KG[size]) * 100) / 100;
    return tote;
  }

  /** Truly full — cannot take even a small parcel (drives the auto-publish for claim). */
  isFull(tote: Tote): boolean {
    return !this.fits(tote, 'S');
  }

  /** Publish a filling bag to the dispatch marketplace (full or aged-out, or an early manual release). */
  markAvailable(code: string): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'filling') throw new BadRequestException(`Bag ${code} is ${tote.status}, only a filling bag can be published`);
    if (!tote.parcels.length) throw new BadRequestException(`Bag ${code} is empty`);
    tote.status = 'available';
    tote.availableAt = new Date().toISOString();
    return tote;
  }

  /** A driver claims an available bag (reserves it for pickup). */
  markClaimed(code: string, driverDid: string): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'available') throw new BadRequestException(`Bag ${code} is ${tote.status}, not available to claim`);
    tote.status = 'claimed';
    tote.claimedBy = driverDid;
    return tote;
  }

  /** Release a claim back to the marketplace (driver dropped it / no-show). */
  unclaim(code: string): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'claimed') throw new BadRequestException(`Bag ${code} is ${tote.status}, not claimed`);
    tote.status = 'available';
    tote.claimedBy = undefined;
    return tote;
  }

  /** Scan the bag onto a bus — the whole tote (and its parcels) moves with one scan. */
  load(code: string, driverBadgeId: string): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'filling' && tote.status !== 'available' && tote.status !== 'claimed') throw new BadRequestException(`Bag ${code} is ${tote.status}, nothing to load`);
    if (!tote.parcels.length) throw new BadRequestException(`Bag ${code} is empty`);
    tote.status = 'in_transit';
    tote.locationId = `bus:${driverBadgeId}`;
    return tote;
  }

  /** Unpack the bag at its destination → returns the parcelIds, frees + unlinks the tote for reuse. */
  empty(code: string, atLocationId: string): { tote: Tote; parcels: string[] } {
    const tote = this.requireByCode(code);
    const parcels = [...tote.parcels];
    tote.parcels = [];
    tote.unitsUsed = 0;
    tote.weightKg = 0;
    tote.status = 'free';
    tote.destinationNodeId = undefined;
    tote.destinationLabel = undefined;
    tote.filledAt = undefined;
    tote.availableAt = undefined;
    tote.claimedBy = undefined;
    tote.locationId = atLocationId;
    return { tote, parcels };
  }

  /** A filling tote at this location already linked to the wanted destination, with room for the size. */
  findFilling(locationId: string, destinationNodeId: string, size: ParcelSize): Tote | undefined {
    return [...this.totes.values()].find(
      (t) => t.status === 'filling' && t.locationId === locationId && t.destinationNodeId === destinationNodeId && this.fits(t, size),
    );
  }

  byCodeMaybe(code: string): Tote | undefined {
    const id = this.byCode.get(code);
    return id ? this.totes.get(id) : undefined;
  }

  requireByCode(code: string): Tote {
    const tote = this.byCodeMaybe(code);
    if (!tote) throw new NotFoundException(`Tote not found: ${code}`);
    return tote;
  }

  fillPct(tote: Tote): number {
    return Math.round((tote.unitsUsed / BAG_CAPACITY_UNITS) * 100);
  }

  list(filter: { locationId?: string; status?: Tote['status'] } = {}): Tote[] {
    return [...this.totes.values()].filter(
      (t) => (!filter.locationId || t.locationId === filter.locationId) && (!filter.status || t.status === filter.status),
    );
  }
}
