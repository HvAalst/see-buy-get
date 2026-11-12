import { Injectable, Optional } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { EntityService } from '../../foundation/entity/entity.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { VendorService } from './vendor.service';
import { PriceCardService, FIXED_STEPS, type Doer } from './price-card.service';
import { MAX_DISCOUNT_PCT, type BusinessRateDto, type BusinessRateRow, type BusinessRatesView, type BusinessRateTerms, type OwnBusinessRate, type StoredBusinessRate, type StoredBusinessRates } from './business-rate.types';

/**
 * 2026-11-12 — A LARGE SENDER'S OWN RATE (the owner's D3: "Large senders negotiate. On a fixed card they get their own lower
 * card — volume tiers or a contract card for one business account; on factors, a discount on the formula"). The country's
 * staff propose one for a sender account; a second member of staff approves it; staff end it. A contract card prices the
 * sender's parcels while the country prices by a fixed card; a discount while it prices by factors. Every change logged.
 */
@Injectable()
export class BusinessRateService {
  private readonly store = new PersistentMap<string, StoredBusinessRates>('pudo-business-rates');

  constructor(
    private readonly entities: EntityService,
    private readonly vendors: VendorService,
    @Optional() private readonly cards?: PriceCardService,
  ) {}

  /** The country's rates, the senders it has, and the weights a new contract card is priced at. */
  view(entityId: string): BusinessRatesView {
    const company = this.company(entityId);
    const mode = this.entities.pricingModeFor(entityId);
    const senders = this.vendors
      .list()
      .filter((v) => this.vendors.entityIdOrNone(v) === entityId)
      .map((v) => ({ vendorId: v.vendorId, name: v.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const rows: BusinessRateRow[] = [...this.store.values()]
      .filter((r) => r.key.startsWith(`${entityId}#`) && (r.approved || r.proposed))
      .map((r) => {
        const vendorId = (r.approved ?? r.proposed)!.vendorId;
        return {
          vendorId,
          name: senders.find((s) => s.vendorId === vendorId)?.name ?? vendorId,
          ...(r.approved ? { approved: this.terms(r.approved) } : {}),
          ...(r.proposed ? { proposed: this.terms(r.proposed) } : {}),
          idle: r.approved ? this.idle(r.approved, mode) : false,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { entityId, currency: company.currency ?? '', mode, steps: this.stepsFor(entityId), rows, senders };
  }

  /** Staff propose a sender's rate. It waits for a second member of staff; one in force stays until then. */
  propose(entityId: string, dto: BusinessRateDto, by: Doer, now: number = Date.now()): BusinessRatesView {
    this.company(entityId);
    const vendor = this.vendorOf(dto.vendorId);
    if (!vendor || this.vendors.entityIdOrNone(vendor) !== entityId) throw new GlosError('NOT_FOUND', 'That is not one of this country’s sender accounts', { field: 'vendorId' });
    const rate: StoredBusinessRate = { entityId, vendorId: vendor.vendorId, kind: dto.kind, status: 'proposed', proposedBy: by.name, proposedById: by.id, proposedAt: new Date(now).toISOString(), ...(dto.note?.trim() ? { note: dto.note.trim() } : {}) };
    if (dto.kind === 'card') {
      const steps = this.stepsFor(entityId);
      const prices = (dto.prices ?? []).map((p) => Math.round(p * 100) / 100);
      if (prices.length !== steps.length) throw new GlosError('VALIDATION_FAILED', `A contract card has a price for each of the ${steps.length} weights`, { field: 'prices' });
      if (prices.some((p) => !(p > 0))) throw new GlosError('VALIDATION_FAILED', 'Every weight needs a price above nothing', { field: 'prices' });
      if (prices.some((p, i) => i > 0 && p < prices[i - 1])) throw new GlosError('VALIDATION_FAILED', 'A heavier parcel never costs less', { field: 'prices' });
      Object.assign(rate, { steps, prices, perExtraKg: Math.round((dto.perExtraKg ?? 0) * 100) / 100 });
    } else {
      const pct = dto.discountPct;
      if (pct == null || !(pct > 0) || pct > MAX_DISCOUNT_PCT) throw new GlosError('VALIDATION_FAILED', `A discount is more than nothing and at most ${MAX_DISCOUNT_PCT * 100}%`, { field: 'discountPct' });
      rate.discountPct = Math.round(pct * 10000) / 10000;
    }
    const key = this.key(entityId, vendor.vendorId);
    const s = this.store.get(key) ?? { key };
    this.store.set(key, { ...s, proposed: rate });
    this.note(entityId, by, s.approved ? `${vendor.name}: ${this.line(s.approved)}` : `${vendor.name}: the country’s prices`, `${vendor.name}: ${this.line(rate)}, proposed`);
    return this.view(entityId);
  }

  /** A second member of staff approves it — never the one who proposed it. From now it prices the sender's parcels. */
  approve(entityId: string, vendorId: string, by: Doer, now: number = Date.now()): BusinessRatesView {
    this.company(entityId);
    const key = this.key(entityId, vendorId);
    const s = this.store.get(key);
    if (!s?.proposed) throw new GlosError('INVALID_STATE', 'No rate is waiting for this sender');
    if (s.proposed.proposedById === by.id) throw new GlosError('FORBIDDEN', 'A second person approves it: not the one who proposed it');
    const approved: StoredBusinessRate = { ...s.proposed, status: 'approved', approvedBy: by.name, approvedAt: new Date(now).toISOString() };
    this.store.set(key, { key, approved });
    const name = this.vendorOf(vendorId)?.name ?? vendorId;
    this.note(entityId, by, s.approved ? `${name}: ${this.line(s.approved)}` : `${name}: the country’s prices`, `${name}: ${this.line(approved)}`);
    return this.view(entityId);
  }

  /** Staff end a sender's rate, or take back one waiting: its parcels are priced as everybody's from now. */
  end(entityId: string, vendorId: string, by: Doer): BusinessRatesView {
    this.company(entityId);
    const key = this.key(entityId, vendorId);
    const s = this.store.get(key);
    if (!s?.approved && !s?.proposed) throw new GlosError('INVALID_STATE', 'This sender has no rate of its own');
    this.store.delete(key);
    const name = this.vendorOf(vendorId)?.name ?? vendorId;
    this.note(entityId, by, `${name}: ${this.line((s.approved ?? s.proposed)!)}`, `${name}: the country’s prices`);
    return this.view(entityId);
  }

  /** The rate that prices a sender's parcels sold by a company, where one is approved. */
  rateFor(entityId: string | undefined, vendorId: string | undefined): StoredBusinessRate | undefined {
    if (!entityId || !vendorId) return undefined;
    return this.store.get(this.key(entityId, vendorId))?.approved;
  }

  /** What a sender sees of its own rate: kind and figures, from when, and whether it prices anything now. */
  ownRate(vendorId: string): OwnBusinessRate | undefined {
    const vendor = this.vendorOf(vendorId);
    const entityId = vendor ? this.vendors.entityIdOrNone(vendor) : undefined;
    const r = this.rateFor(entityId, vendorId);
    if (!r || !entityId) return undefined;
    return {
      kind: r.kind,
      ...(r.kind === 'card' ? { steps: r.steps, prices: r.prices, perExtraKg: r.perExtraKg } : { discountPct: r.discountPct }),
      since: r.approvedAt!,
      idle: this.idle(r, this.entities.pricingModeFor(entityId)),
    };
  }

  /** A contract card prices only on a fixed card; a discount only by factors. */
  idle(r: Pick<StoredBusinessRate, 'kind'>, mode: 'fixed' | 'factors'): boolean {
    return (r.kind === 'card') !== (mode === 'fixed');
  }

  private vendorOf(vendorId: string) {
    try {
      return this.vendors.get(vendorId);
    } catch {
      return undefined;
    }
  }

  private stepsFor(entityId: string): number[] {
    return this.cards?.fixedStepsFor(entityId) ?? [...FIXED_STEPS];
  }

  private terms(r: StoredBusinessRate): BusinessRateTerms {
    return {
      kind: r.kind,
      ...(r.kind === 'card' ? { steps: r.steps, prices: r.prices, perExtraKg: r.perExtraKg } : { discountPct: r.discountPct }),
      ...(r.note ? { note: r.note } : {}),
      proposedBy: r.proposedBy,
      proposedAt: r.proposedAt,
      ...(r.approvedBy ? { approvedBy: r.approvedBy, approvedAt: r.approvedAt } : {}),
    };
  }

  private line(r: StoredBusinessRate): string {
    return r.kind === 'card' ? `a contract card (${(r.prices ?? []).join(' / ')})` : `${Math.round((r.discountPct ?? 0) * 1000) / 10}% off`;
  }

  private key(entityId: string, vendorId: string): string {
    return `${entityId}#${vendorId}`;
  }

  private company(entityId: string): Entity {
    const company = this.entities.get(entityId);
    if (company.kind !== 'sister' || !company.jurisdiction) throw new GlosError('FORBIDDEN', `${company.name} does not run a country: a sender’s rate belongs to the company that does`);
    return company;
  }

  private note(entityId: string, by: Doer, from: string, to: string): void {
    this.entities.noteChange(entityId, { by: by.name, what: 'businessRates', from, to });
  }
}
