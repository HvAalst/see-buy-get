import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { GlosError } from '../../foundation/http/glos-error';
import { EntityService } from '../../foundation/entity/entity.service';
import { currencyForJurisdiction } from '../../foundation/money/currency';
import { ParcelService } from './parcel.service';
import { weekName, weekStart } from './pilot.service';
import { ZoneMapService } from './zone-map.service';

const DAY = 24 * 3_600_000;
const WEEK = 7 * DAY;
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** One pair of zones in a week: what its parcels were priced on the card, and what carrying them was planned to cost. */
export class PriceReportRow {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  band: string;
  parcels: number;
  /** The card's part of their prices, summed: before the two shops' own fees, our fee and the tax. */
  price: number;
  /** What carrying them was planned to cost, summed: the road at the cheapest carrier, the hubs' fees, the bag loading. */
  planned: number;
  /** How many were priced below what carrying them was planned to cost. */
  below: number;
}

export class PriceReportTotals {
  parcels: number;
  price: number;
  planned: number;
  below: number;
}

/**
 * PRICE AND COST PER PAIR OF ZONES, A WEEK AT A TIME (2026-11-08 — zone pricing, step 4: "a weekly report per pair of zones
 * shows the price, the planned cost and the actual cost, and flags every pair priced below cost"). A country's company
 * reads which of its pairs its card prices below what carrying them costs — the bag loading included, which no price paid
 * before. Planned costs today, at estimated distances; the actual cost joins it once real road distances are kept.
 */
export class PriceReportView {
  entityId: string;
  currency: string;
  /** The week's Sunday and Saturday (UTC): a week runs Sunday to Saturday. */
  week: string;
  weekEnds: string;
  /** Worst first: the pairs whose price falls furthest below their planned cost. */
  @ApiProperty({ type: [PriceReportRow] })
  rows: PriceReportRow[];
  @ApiProperty({ type: PriceReportTotals })
  totals: PriceReportTotals;
  /** Parcels priced from the card before planned costs were kept: in the price, not in the comparison. */
  unplanned: number;
}

@Injectable()
export class PriceReportService {
  constructor(
    private readonly parcels: ParcelService,
    private readonly zones: ZoneMapService,
    private readonly entities: EntityService,
  ) {}

  /** The week a day falls in (YYYY-MM-DD), or this week so far. */
  weekOf(entityId: string, day?: string, now: number = Date.now()): PriceReportView {
    const company = this.entities.get(entityId);
    if (company.kind !== 'sister' || !company.jurisdiction) throw new GlosError('FORBIDDEN', `${company.name} does not run a country: its price report belongs to the company that does`);
    const asked = day ? Date.parse(`${day}T00:00:00Z`) : now;
    if (!Number.isFinite(asked)) throw new GlosError('VALIDATION_FAILED', 'A week is named by a day in it: YYYY-MM-DD', { field: 'week' });
    const from = weekStart(asked);
    const to = from + WEEK;
    const names = new Map<string, string>();
    const nameOf = (version: number, code: string): string => {
      const key = `${version}#${code}`;
      if (!names.has(key)) {
        try {
          for (const z of this.zones.publishedZones(entityId, version).zones) names.set(`${version}#${z.code}`, z.name);
        } catch {
          /* a map that is gone names nothing: the code is said instead */
        }
        if (!names.has(key)) names.set(key, code);
      }
      return names.get(key)!;
    };
    const rows = new Map<string, PriceReportRow>();
    let unplanned = 0;
    for (const p of this.parcels.list()) {
      const z = p.zonePrice;
      if (!z || p.sellerEntityId !== entityId || p.status === 'Voided') continue;
      const at = Date.parse(p.acceptedAt);
      if (!(at >= from && at < to)) continue;
      if (z.plannedCost == null) {
        unplanned += 1;
        continue;
      }
      const key = `${z.from}>${z.to}`;
      const row = rows.get(key) ?? { from: z.from, fromName: nameOf(z.zoneMapVersion, z.from), to: z.to, toName: nameOf(z.zoneMapVersion, z.to), band: z.band, parcels: 0, price: 0, planned: 0, below: 0 };
      row.parcels += 1;
      row.price = r2(row.price + z.amount);
      row.planned = r2(row.planned + z.plannedCost);
      if (z.amount < z.plannedCost) row.below += 1;
      rows.set(key, row);
    }
    const list = [...rows.values()].sort((a, b) => a.price - a.planned - (b.price - b.planned) || b.parcels - a.parcels || a.from.localeCompare(b.from));
    const totals = list.reduce((t, r) => ({ parcels: t.parcels + r.parcels, price: r2(t.price + r.price), planned: r2(t.planned + r.planned), below: t.below + r.below }), { parcels: 0, price: 0, planned: 0, below: 0 });
    return { entityId, currency: company.currency ?? currencyForJurisdiction(company.jurisdiction), week: weekName(from), weekEnds: weekName(to - DAY), rows: list, totals, unplanned };
  }
}
