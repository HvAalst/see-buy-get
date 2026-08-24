import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
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
  /**
   * Durable. A bag is a physical object holding real parcels, and a shop fills one across a working day
   * — closing the app, or a restart, must not lose which parcels are in which bag. It was an in-memory
   * Map, which was survivable only while nothing outlived a single session.
   */
  private readonly totes = new PersistentMap<string, Tote>('pudo-totes'); // toteId → tote

  /** Re-store an in-place-mutated tote so the snapshot store flushes it. */
  private save(tote: Tote): Tote {
    this.totes.set(tote.toteId, tote);
    return tote;
  }

  /** Register a fresh (laminated) tote into the pool at a location. */
  register(locationId: string): Tote {
    // The sequence is derived from what already exists rather than kept in a field: a counter reset by a
    // restart would hand a second bag the code of one still sitting full on a shop floor.
    const seq = [...this.totes.values()].reduce((max, t) => Math.max(max, Number(t.code.split('-')[1]) || 0), 0) + 1;
    const tote: Tote = {
      toteId: `tote_${randomBytes(6).toString('hex')}`,
      code: `${TOTE_CODE_PREFIX}-${String(seq).padStart(3, '0')}`,
      status: 'free',
      locationId,
      parcels: [],
      unitsUsed: 0,
      weightKg: 0,
    };
    return this.save(tote);
  }

  /** Every tote currently at a location — the shop's bag shelf. */
  atLocation(locationId: string): Tote[] {
    return [...this.totes.values()].filter((t) => t.locationId === locationId).sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Link a free tote to a single next destination — it can now take parcels for that destination.
   *  `sealRequired` marks a SHOP bag: only the shopkeeper's seal publishes it (see Tote.sealRequired). */
  assign(code: string, destinationNodeId: string, destinationLabel: string, opts: { sealRequired?: boolean } = {}): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'free') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}, must be empty/free to assign`);
    tote.status = 'filling';
    tote.destinationNodeId = destinationNodeId;
    tote.destinationLabel = destinationLabel;
    if (opts.sealRequired) tote.sealRequired = true;
    return this.save(tote);
  }

  /** Whether a parcel of this size still fits (heavy fills a bag on its own → needs an empty one). */
  fits(tote: Tote, size: ParcelSize): boolean {
    return tote.unitsUsed + SIZE_UNITS[size] <= BAG_CAPACITY_UNITS + 1e-9;
  }

  /** Drop a parcel into the bag (capacity-checked) and connect bag ↔ parcel. */
  add(code: string, parcelId: string, size: ParcelSize): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'filling') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}, assign it to a destination first`);
    // A parcel goes in ONCE. Bagging is a scanning loop, so the same sticker WILL be waved twice, and a
    // silent second push would double-count its units and weight — the bag would report itself full while
    // half empty, and the manifest would name a parcel that is in there once.
    if (tote.parcels.includes(parcelId)) throw new GlosError('ALREADY_IN_BAG', `Parcel ${parcelId} is already in bag ${code}`, { parcelId, bagCode: code, sameBag: true });
    if (!this.fits(tote, size)) throw new GlosError('BAG_FULL', `Bag ${code} is full (${this.fillPct(tote)}%) — open a new bag for this destination`);
    if (!tote.parcels.length) tote.filledAt = new Date().toISOString();
    tote.parcels.push(parcelId);
    tote.unitsUsed = Math.round((tote.unitsUsed + SIZE_UNITS[size]) * 1000) / 1000;
    tote.weightKg = Math.round((tote.weightKg + SIZE_WEIGHT_KG[size]) * 100) / 100;
    return this.save(tote);
  }

  /** Truly full — cannot take even a small parcel (drives the auto-publish for claim). */
  isFull(tote: Tote): boolean {
    return !this.fits(tote, 'S');
  }

  /** Publish a filling bag to the dispatch marketplace (full or aged-out, or an early manual release). */
  markAvailable(code: string): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'filling') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}, only a filling bag can be published`);
    if (!tote.parcels.length) throw new GlosError('BAG_EMPTY', `Bag ${code} is empty`);
    tote.status = 'available';
    tote.availableAt = new Date().toISOString();
    return this.save(tote);
  }

  /** Record that the shop has been asked to close this bag, so the sweep asks once per reason. */
  noteSealPrompt(code: string, reason: 'full' | 'max_wait'): Tote {
    const tote = this.requireByCode(code);
    tote.sealPromptedFor = reason;
    return this.save(tote);
  }

  /** Stamp the shop's seal — the record that the completeness gate ran, separate from being published. */
  markSealed(code: string): Tote {
    const tote = this.requireByCode(code);
    tote.sealedAt = new Date().toISOString();
    return this.save(tote);
  }

  /** A driver claims an available bag (reserves it for pickup). */
  markClaimed(code: string, driverDid: string): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'available') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}, not available to claim`);
    tote.status = 'claimed';
    tote.claimedBy = driverDid;
    return this.save(tote);
  }

  /** Release a claim back to the marketplace (driver dropped it / no-show). */
  unclaim(code: string): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'claimed') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}, not claimed`);
    tote.status = 'available';
    tote.claimedBy = undefined;
    return this.save(tote);
  }

  /** Scan the bag onto a bus — the whole tote (and its parcels) moves with one scan. */
  load(code: string, driverBadgeId: string): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'filling' && tote.status !== 'available' && tote.status !== 'claimed') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}, nothing to load`);
    if (!tote.parcels.length) throw new GlosError('BAG_EMPTY', `Bag ${code} is empty`);
    tote.status = 'in_transit';
    tote.locationId = `bus:${driverBadgeId}`;
    return this.save(tote);
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
    return { tote: this.save(tote), parcels };
  }

  /**
   * A filling tote at this location already linked to the wanted destination, with room for the size.
   * `accepts` (S31) is an optional cargo-compatibility gate: a caller passes the bag's current parcelIds and
   * decides whether the incoming parcel may JOIN them — so an incompatible parcel skips this bag (the caller
   * opens a fresh one), keeping every tote internally compatible without ToteService knowing about cargo.
   */
  findFilling(locationId: string, destinationNodeId: string, size: ParcelSize, accepts?: (parcels: string[]) => boolean): Tote | undefined {
    return [...this.totes.values()].find(
      (t) =>
        t.status === 'filling' &&
        t.locationId === locationId &&
        t.destinationNodeId === destinationNodeId &&
        this.fits(t, size) &&
        (!accepts || accepts(t.parcels)),
    );
  }

  /** Looked up by scan rather than kept as a second index — one source of truth cannot drift from itself. */
  byCodeMaybe(code: string): Tote | undefined {
    return [...this.totes.values()].find((t) => t.code === code);
  }

  requireByCode(code: string): Tote {
    const tote = this.byCodeMaybe(code);
    if (!tote) throw new GlosError('NOT_FOUND', `Tote not found: ${code}`);
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
