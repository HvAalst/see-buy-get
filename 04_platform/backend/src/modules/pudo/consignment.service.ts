import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { CargoNature } from './cargo.types';
import { Consignment, GeoPoint } from './pudo.types';
import { tempBand } from './heavy-cargo';
import { DispatchService } from './dispatch.service';
import { CONSIGNMENT_MAX_WAIT_H, MAX_CONSIGNMENT_TARGET_KG } from './pudo.config';

/**
 * ConsignmentService (F3) — the consolidation pool for durable dry commodities. A cooperative (an aggregating
 * PUDO) opens a LOT, members deposit their kg into it, and when the lot is FULL (>= targetKg) or has AGED it
 * posts itself to the dispatch marketplace as ONE bulk freight — the bulk analogue of a Tote publishing
 * full-or-aged. Deliberate constraints:
 *   - PERISHABLES never consolidate: a cold-chain commodity (tempBand != null) must book freight directly
 *     (F2 immediate/planned), it can't sit while a truckload builds.
 *   - Settlement is OFF-PLATFORM (like an F2 counter freight): the posted freight carries no shipperDid, so it
 *     stays 'unpaid' — the cooperative pays the haul and splits it among members off-platform (thin model).
 *   - THIN attribution: a deposit's memberRef is a free-text label, not an on-platform identity.
 * The freight registration reuses the F1 path (dispatch.registerFreight); no new money plumbing.
 */
@Injectable()
export class ConsignmentService {
  /**
   * The lots themselves — a cooperative's members' deposits — kept across a restart. They were held in memory alone,
   * so a deploy emptied every open lot and the kilos its members had brought in with it.
   */
  private readonly lots = new PersistentMap<string, Consignment>('consignment-lots'); // consignmentId → lot
  /** code → consignmentId: an index, rebuilt from the lots, never a second record. */
  private readonly byCode = new Map<string, string>();
  /** The last LOT number given: carried on from the lots kept, so a restart never gives LOT-001 again. */
  private seq = 0;

  constructor(private readonly dispatch: DispatchService) {
    for (const lot of this.lots.values()) {
      this.byCode.set(lot.code, lot.consignmentId);
      const n = Number(/^LOT-(\d+)$/.exec(lot.code)?.[1] ?? 0);
      if (n > this.seq) this.seq = n;
    }
  }

  /**
   * Open a consolidation lot. Rejects a perishable commodity (it books freight directly, never consolidates)
   * and a non-positive / oversized truckload target. pickup* is the owner's aggregation site (resolved by the
   * caller from the owner agent); dest* is where the truckload goes.
   */
  open(
    input: {
      ownerDid: string;
      natureCode?: CargoNature;
      pickupLabel: string;
      pickupLocation: GeoPoint;
      destLabel: string;
      destLocation?: GeoPoint;
      targetKg: number;
      maxSpend?: number;
    },
    now: number = Date.now(),
  ): Consignment {
    const natureCode: CargoNature = input.natureCode ?? 'GEN';
    if (tempBand(natureCode)) {
      throw new GlosError('INVALID_INPUT', 'A perishable commodity cannot be consolidated — book it as freight directly (immediate or planned).');
    }
    if (!(input.targetKg > 0)) throw new GlosError('INVALID_INPUT', 'A consignment needs a positive truckload target (kg).');
    if (input.targetKg > MAX_CONSIGNMENT_TARGET_KG) throw new GlosError('INVALID_INPUT', `A consignment target cannot exceed ${MAX_CONSIGNMENT_TARGET_KG} kg.`);

    this.seq += 1;
    const lot: Consignment = {
      consignmentId: `csn_${randomBytes(6).toString('hex')}`,
      code: `LOT-${String(this.seq).padStart(3, '0')}`,
      status: 'open',
      ownerDid: input.ownerDid,
      natureCode,
      pickupLabel: input.pickupLabel,
      pickupLocation: input.pickupLocation,
      destLabel: input.destLabel,
      destLocation: input.destLocation,
      targetKg: Math.round(input.targetKg * 100) / 100,
      weightKg: 0,
      deposits: [],
      // A positive, finite cap only (mirrors registerFreight): a zero/negative/NaN budget means "no cap".
      maxSpend: input.maxSpend != null && Number.isFinite(input.maxSpend) && input.maxSpend > 0 ? Math.round(input.maxSpend * 100) / 100 : undefined,
      openedAt: new Date(now).toISOString(),
    };
    this.lots.set(lot.consignmentId, lot);
    this.byCode.set(lot.code, lot.consignmentId);
    return lot;
  }

  /** Record a member deposit (kg). Auto-posts the instant the lot fills; the aged case is the sweep's job. */
  deposit(code: string, memberRef: string, weightKg: number, now: number = Date.now()): Consignment {
    const lot = this.requireByCode(code);
    if (lot.status !== 'open') throw new GlosError('INVALID_STATE', `Lot ${code} is ${lot.status}, not open for deposits.`);
    if (!memberRef.trim()) throw new GlosError('FIELD_REQUIRED', 'A member reference is required for the deposit.');
    if (!(weightKg > 0)) throw new GlosError('INVALID_INPUT', 'A deposit weight must be positive.');

    // The aged-out clock runs from the FIRST deposit (when goods actually arrived), NOT from when the empty
    // lot was opened — a standing lot opened weeks ahead must still give its first deposit the full wait window
    // to accumulate a truckload, else the sweep would force-post a tiny partial freight the moment goods land
    // (mirrors a tote ageing from filledAt, and the F1 lesson: anchor a timer to the action, not a fixed date).
    if (!lot.filledAt) lot.filledAt = new Date(now).toISOString();
    lot.deposits.push({ memberRef: memberRef.trim(), weightKg: Math.round(weightKg * 100) / 100, at: new Date(now).toISOString() });
    lot.weightKg = Math.round((lot.weightKg + weightKg) * 100) / 100;
    this.lots.set(lot.consignmentId, lot);
    if (this.isFull(lot)) this.post(lot, now); // full → straight to the marketplace
    return lot;
  }

  isFull(lot: Consignment): boolean {
    return lot.weightKg >= lot.targetKg;
  }

  /**
   * Sweep: post every OPEN lot that is full OR has aged past CONSIGNMENT_MAX_WAIT_H, provided it carries some
   * weight (an empty aged lot has nothing to ship — it stays open). Returns the consignmentIds posted.
   */
  publishReadyConsignments(now: number = Date.now()): string[] {
    const posted: string[] = [];
    for (const lot of this.lots.values()) {
      if (lot.status !== 'open' || lot.weightKg <= 0) continue;
      // Age from the first deposit (filledAt), never from openedAt — see deposit(). filledAt is always set here
      // because an open lot with weight has had a deposit.
      const aged = lot.filledAt != null && now > new Date(lot.filledAt).getTime() + CONSIGNMENT_MAX_WAIT_H * 3_600_000;
      if (this.isFull(lot) || aged) {
        this.post(lot, now);
        posted.push(lot.consignmentId);
      }
    }
    return posted;
  }

  /**
   * Post a lot to the dispatch marketplace as ONE bulk freight (F1 path). OFF-PLATFORM: no shipperDid, so the
   * freight settles 'unpaid' (the cooperative pays the haul off-platform); an optional cash cap rides as
   * maxSpend. Loose durable commodity → bulk (a tipper/hopper self-loads; no handling equipment required).
   */
  private post(lot: Consignment, now: number): Consignment {
    if (lot.status !== 'open') return lot;
    const freight = this.dispatch.registerFreight(
      {
        description: `Consolidated ${lot.natureCode} lot ${lot.code} — ${lot.deposits.length} deposit(s), ${lot.weightKg} kg`,
        pickupLocation: lot.pickupLocation,
        pickupLabel: lot.pickupLabel,
        destLabel: lot.destLabel,
        destLocation: lot.destLocation,
        weightKg: lot.weightKg,
        natureCode: lot.natureCode,
        // FB5 — a co-op lot is deposited in SACKS, not poured. It was set `bulk: true` on the reasoning that
        // a durable commodity self-loads, which is exactly the conflation this slice removes: sacks of maize
        // are lifted by hand or forklift, and calling them loose told every member's lot it needed no
        // handling equipment and wanted a tipper.
        packaging: 'bagged',
        maxSpend: lot.maxSpend,
        // shipperDid intentionally omitted — off-platform cash settlement (the F2 model): no wallet is billed.
      },
      now,
    );
    lot.status = 'posted';
    lot.postedAt = new Date(now).toISOString();
    lot.freightId = freight.freightId;
    this.lots.set(lot.consignmentId, lot);
    return lot;
  }

  byCodeMaybe(code: string): Consignment | undefined {
    const id = this.byCode.get(code);
    return id ? this.lots.get(id) : undefined;
  }

  requireByCode(code: string): Consignment {
    const lot = this.byCodeMaybe(code);
    if (!lot) throw new GlosError('NOT_FOUND', `Consignment not found: ${code}`);
    return lot;
  }

  /** The lots owned by a cooperative (owner-scoped), or every lot when no owner filter is given (operator). */
  list(filter: { ownerDid?: string; status?: Consignment['status'] } = {}): Consignment[] {
    return [...this.lots.values()]
      .filter((l) => (!filter.ownerDid || l.ownerDid === filter.ownerDid) && (!filter.status || l.status === filter.status))
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }
}
