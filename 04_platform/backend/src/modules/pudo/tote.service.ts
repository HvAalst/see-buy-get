import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'crypto';
import { graiFromScan } from '../../foundation/gs1/gs1';
import { BAG_CAPACITY_UNITS, SIZE_UNITS, SIZE_WEIGHT_KG, TOTE_CODE_PREFIX } from './pudo.config';
import { ParcelSize, Tote, ToteHaul, ToteHaulPart } from './pudo.types';
import type { Step } from './observed-at';
import type { UnitHold } from './tamper.types';

/** A bag step heard of as it happens: dated now. */
const stepNow = (): Step => ({ at: new Date().toISOString() });

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

  /** Round 36 — closed for the road (BagClosureService): how, and which closing. Nothing more goes in. */
  markClosed(code: string, kind: 'seal' | 'photo', closureId: string): Tote {
    const tote = this.requireByCode(code);
    tote.closedWith = kind;
    tote.closureId = closureId;
    return this.save(tote);
  }

  /** Round 36 — held under the tamper protocol, and released. */
  hold(toteId: string, hold: UnitHold): Tote {
    const tote = this.requireById(toteId);
    tote.held = hold;
    return this.save(tote);
  }

  unhold(toteId: string): Tote {
    const tote = this.requireById(toteId);
    delete tote.held;
    return this.save(tote);
  }

  requireById(toteId: string): Tote {
    const tote = this.totes.get(toteId);
    if (!tote) throw new GlosError('NOT_FOUND', 'No such bag');
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
  add(code: string, parcelId: string, size: ParcelSize, step: Step = stepNow()): Tote {
    const tote = this.requireByCode(code);
    // Round 36 — closed for the road: its seal is on, and nothing more goes in (said before its status, which only says it
    // is no longer filling).
    if (tote.closureId) throw new GlosError('INVALID_STATE', `Bag ${code} is closed: open another bag for this destination`);
    if (tote.status !== 'filling') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}, assign it to a destination first`);
    // A parcel goes in ONCE. Bagging is a scanning loop, so the same sticker WILL be waved twice, and a
    // silent second push would double-count its units and weight — the bag would report itself full while
    // half empty, and the manifest would name a parcel that is in there once.
    if (tote.parcels.includes(parcelId)) throw new GlosError('ALREADY_IN_BAG', `Parcel ${parcelId} is already in bag ${code}`, { parcelId, bagCode: code, sameBag: true });
    if (!this.fits(tote, size)) throw new GlosError('BAG_FULL', `Bag ${code} is full (${this.fillPct(tote)}%) — open a new bag for this destination`);
    if (!tote.parcels.length) {
      tote.filledAt = step.at;
      tote.filledReceivedAt = step.receivedAt;
    }
    tote.parcels.push(parcelId);
    tote.unitsUsed = Math.round((tote.unitsUsed + SIZE_UNITS[size]) * 1000) / 1000;
    tote.weightKg = Math.round((tote.weightKg + SIZE_WEIGHT_KG[size]) * 100) / 100;
    return this.save(tote);
  }

  /**
   * Round 35 — set apart under the tamper protocol: out of a bag that has not left, so the bag goes on without it and
   * nobody loads it by mistake. Its room and weight come back; a bag it leaves empty is as it was before its first parcel.
   */
  takeOut(code: string, parcelId: string, size: ParcelSize): Tote {
    const tote = this.requireByCode(code);
    if (tote.status === 'in_transit') throw new GlosError('INVALID_STATE', `Bag ${code} has left: it is opened where it arrives`);
    if (!tote.parcels.includes(parcelId)) return tote;
    tote.parcels = tote.parcels.filter((id) => id !== parcelId);
    tote.unitsUsed = Math.max(0, Math.round((tote.unitsUsed - SIZE_UNITS[size]) * 1000) / 1000);
    tote.weightKg = Math.max(0, Math.round((tote.weightKg - SIZE_WEIGHT_KG[size]) * 100) / 100);
    if (!tote.parcels.length) {
      delete tote.filledAt;
      delete tote.filledReceivedAt;
    }
    return this.save(tote);
  }

  /** Truly full — cannot take even a small parcel (drives the auto-publish for claim). */
  isFull(tote: Tote): boolean {
    return !this.fits(tote, 'S');
  }

  /** Publish a filling bag to the dispatch marketplace (full or aged-out, or an early manual release). */
  markAvailable(code: string, at: string = new Date().toISOString()): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'filling') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}, only a filling bag can be published`);
    if (!tote.parcels.length) throw new GlosError('BAG_EMPTY', `Bag ${code} is empty`);
    tote.status = 'available';
    tote.availableAt = at;
    return this.save(tote);
  }

  /** Record that the shop has been asked to close this bag, so the sweep asks once per reason. */
  noteSealPrompt(code: string, reason: 'full' | 'max_wait'): Tote {
    const tote = this.requireByCode(code);
    tote.sealPromptedFor = reason;
    return this.save(tote);
  }

  /** Stamp the shop's seal — the record that the completeness gate ran, separate from being published. */
  markSealed(code: string, step: Step = stepNow()): Tote {
    const tote = this.requireByCode(code);
    tote.sealedAt = step.at;
    tote.sealedReceivedAt = step.receivedAt;
    return this.save(tote);
  }

  /**
   * 2026-11-02 — WHICH HUB A BAG GOES TO, chosen with room on its floor (MdpService.placeBag): a bag addressed to a hub is
   * addressed to another; a bag addressed to a zone is given the hub it is driven to. Only before a driver has it.
   */
  pointTo(code: string, to: { destinationNodeId?: string; destinationLabel?: string; toHubId?: string }): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'filling' && tote.status !== 'available') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}: where it goes is fixed`);
    // 2026-11-05 — sent on to another hub: the first address is kept, for the shop's check of what belongs in it (Tote.packedFor).
    if (to.destinationNodeId && tote.destinationNodeId && to.destinationNodeId !== tote.destinationNodeId && !tote.packedFor) tote.packedFor = tote.destinationNodeId;
    if (to.destinationNodeId) tote.destinationNodeId = to.destinationNodeId;
    if (to.destinationLabel) tote.destinationLabel = to.destinationLabel;
    if (to.toHubId) tote.toHubId = to.toHubId;
    return this.save(tote);
  }

  /** 2026-11-02 — held for room at the hub it goes to, or let go on (`undefined`). */
  /** 2026-11-06 — carried to a shop that was closed, handed in at the one its buyers' choosing settled on (ShopChoiceService). */
  readdressCarried(code: string, destinationNodeId: string, destinationLabel: string): Tote {
    const tote = this.requireByCode(code);
    tote.destinationNodeId = destinationNodeId;
    tote.destinationLabel = destinationLabel;
    delete tote.toHubId;
    return this.save(tote);
  }

  /**
   * 2026-11-11 — SENT TO ANOTHER HUB BY THE NETWORK, the one it went to being down: claimed or on a vehicle as well — where it
   * goes is fixed for everybody else, not for the network that fixed it. Kept, with why.
   */
  redirectTo(code: string, to: { destinationNodeId: string; destinationLabel: string } | { toHubId: string }, entry: NonNullable<Tote['redirects']>[number]): Tote {
    const tote = this.requireByCode(code);
    if ('toHubId' in to) tote.toHubId = to.toHubId;
    else {
      if (tote.destinationNodeId && tote.destinationNodeId !== to.destinationNodeId && !tote.packedFor) tote.packedFor = tote.destinationNodeId;
      tote.destinationNodeId = to.destinationNodeId;
      tote.destinationLabel = to.destinationLabel;
    }
    tote.redirects = [...(tote.redirects ?? []), entry];
    return this.save(tote);
  }

  markWaiting(code: string, wait: Tote['waitsForRoom']): Tote {
    const tote = this.requireByCode(code);
    tote.waitsForRoom = wait;
    return this.save(tote);
  }

  /** 2026-11-06 — offered once more, to drivers further away, after waiting long for one near (NotificationDispatcher). */
  markOfferedWide(code: string, at: string): Tote {
    const tote = this.requireByCode(code);
    tote.offeredWideAt = at;
    return this.save(tote);
  }

  /** A driver claims an available bag (reserves it for pickup). */
  markClaimed(code: string, driverDid: string): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'available') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}, not available to claim`);
    // 2026-11-02 — a bag held for room at its hub is offered to nobody, so nobody takes it.
    if (tote.waitsForRoom) throw new GlosError('BAG_WAITS_FOR_ROOM', `Bag ${code} waits for room at ${tote.waitsForRoom.hubName}: it goes on by itself when there is room`, { hubId: tote.waitsForRoom.hubId });
    tote.status = 'claimed';
    tote.claimedBy = driverDid;
    return this.save(tote);
  }

  /** Stamp what carrying this bag is worth, at the moment it is claimed. See Tote.haul for why it is
   *  locked rather than computed on arrival. */
  lockHaul(code: string, haul: ToteHaul): Tote {
    const tote = this.requireByCode(code);
    tote.haul = haul;
    return this.save(tote);
  }

  /**
   * TAKEN OVER ON THE ROAD: a bag with a driver whose vehicle broke down goes on with another (VehicleBreakdownService).
   * A bag on their vehicle is on the other's now; one they had claimed and not yet collected is the other's to collect.
   * The stretch of road the first driver drove, already paid them, is kept on its haul — the rest is paid on arrival.
   */
  takeOver(code: string, toDriverDid: string, toBadgeId: string | undefined, part?: ToteHaulPart): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'claimed' && tote.status !== 'in_transit') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}: nobody is carrying it`);
    if (tote.status === 'claimed') tote.claimedBy = toDriverDid;
    else {
      tote.carriedBy = toDriverDid;
      if (tote.claimedBy) tote.claimedBy = toDriverDid;
      if (toBadgeId) tote.locationId = `bus:${toBadgeId}`;
    }
    if (part && tote.haul) tote.haul = { ...tote.haul, parts: [...(tote.haul.parts ?? []), part] };
    return this.save(tote);
  }

  /** Release a claim back to the marketplace (driver dropped it / no-show). */
  unclaim(code: string): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'claimed') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}, not claimed`);
    tote.status = 'available';
    // The price was struck for the driver who is walking away from it. The next claimer's vehicle, distance
    // and the bag's contents may all differ, so their price must be struck fresh rather than inherited.
    tote.haul = undefined;
    tote.claimedBy = undefined;
    return this.save(tote);
  }

  /** Scan the bag onto a bus — the whole tote (and its parcels) moves with one scan. */
  load(code: string, driverBadgeId: string, driverDid?: string): Tote {
    const tote = this.requireByCode(code);
    if (tote.status !== 'filling' && tote.status !== 'available' && tote.status !== 'claimed') throw new GlosError('INVALID_STATE', `Bag ${code} is ${tote.status}, nothing to load`);
    if (!tote.parcels.length) throw new GlosError('BAG_EMPTY', `Bag ${code} is empty`);
    tote.status = 'in_transit';
    tote.locationId = `bus:${driverBadgeId}`;
    // WHO IS CARRYING IT, as a field. locationId already said so, but as a 'bus:<badge>' string prefix —
    // a fact nothing could query, and so a fact the fleet map and the capacity check both missed.
    // Optional because a badge that resolves to no coupled driver still loads: the bag is on a bus either
    // way, and refusing the load would strand real parcels over a bookkeeping gap.
    if (driverDid) tote.carriedBy = driverDid;
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
    // 2026-11-02 — arrived: the hub it was sent to, and any wait for room there, are over with the journey.
    tote.toHubId = undefined;
    tote.packedFor = undefined;
    tote.waitsForRoom = undefined;
    tote.filledAt = undefined;
    tote.filledReceivedAt = undefined;
    tote.availableAt = undefined;
    tote.claimedBy = undefined;
    tote.carriedBy = undefined; // it is off the vehicle — see Tote.carriedBy
    // Round 36 — received and opened: its closing is over (kept by BagClosureService); the bag is used again.
    tote.closedWith = undefined;
    tote.closureId = undefined;
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
    // 2026-11-09 — or by its GRAI, as any GS1 scanner hands it over: the same bag.
    const grai = graiFromScan(code);
    return [...this.totes.values()].find((t) => t.code === code || (grai !== undefined && t.grai === grai));
  }

  /** 2026-11-09 — its GRAI, given once and kept: a bag that has one keeps it. */
  giveGrai(toteId: string, grai: string): Tote {
    const tote = this.requireById(toteId);
    if (tote.grai) return tote;
    tote.grai = grai;
    return this.save(tote);
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
