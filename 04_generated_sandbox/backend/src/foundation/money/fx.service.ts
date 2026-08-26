import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { CurrencyCode } from './currency';

/**
 * Exchange rates — the one place two currencies are allowed to meet.
 *
 * A cross-border route reaches stops that are paid in different money, and until now the quote refused
 * outright rather than add shillings to birr. Refusing was right: the alternative was a plausible wrong
 * number. This is what lets it answer instead, without giving up the reason the refusal existed.
 *
 * Three rules the rest of the system depends on:
 *
 *  - **A rate is a QUOTED FACT, not a constant.** Every rate carries when it was taken and who from, so a
 *    price can always be traced back to the rate behind it. A number with no provenance cannot be argued
 *    about, and an FX number that cannot be argued about is a number nobody will honour.
 *  - **Rates are held per currency against one base**, and a cross-rate is derived — which is how the
 *    market actually works, and it keeps the rate book one number per currency instead of n² pairs. A
 *    derived rate is only as fresh as its OLDER leg, and it says so.
 *  - **The rate book survives a restart.** A known old rate beats no rate: a deployment whose feed is down
 *    should keep quoting off the last one it had, visibly stale, rather than stop trading.
 *
 * The seeded table is deliberately explicit, like the currency map next door. A live feed is not a rewrite
 * of this service — it calls `setRate` on a schedule, and everything downstream is unchanged.
 */

/** Rates per ONE unit of the base. 129 KES to the dollar. Seeded, and replaced by whatever the feed says. */
export const FX_BASE: CurrencyCode = 'USD';
const SEED_PER_BASE: Record<CurrencyCode, number> = {
  USD: 1,
  KES: 129.0,
  ETB: 118.5,
  EUR: 0.92,
  GBP: 0.79,
  SGD: 1.34,
  CNY: 7.2,
};

/** How long a rate may go unrefreshed before a reader should treat it with suspicion. */
export const FX_RATE_MAX_AGE_H = 24;
/** How long a converted PRICE is good for. The rate may be old; what was promised is only good for this. */
export const FX_QUOTE_TTL_MIN = 30;

/** One currency's standing against the base, as last taken. */
export interface FxPoint {
  currency: CurrencyCode;
  perBase: number;
  source: string;
  at: string;
}

/** A rate as USED: which way round, what it was, where it came from, and how old it really is. */
export interface FxRate {
  from: CurrencyCode;
  to: CurrencyCode;
  rate: number; // multiply an amount in `from` by this to get `to`
  via: CurrencyCode; // the base the cross-rate was derived through
  at: string; // the older of the two legs — a derived rate is only as fresh as its stalest half
  source: string;
  stale: boolean;
}

@Injectable()
export class FxService implements OnApplicationBootstrap {
  // Durable on purpose: see the third rule above.
  private readonly points = new PersistentMap<string, FxPoint>('fx-rates');

  onApplicationBootstrap(): void {
    this.seed();
  }

  /** Idempotent, and it never overwrites: a rate already in the book came from somewhere newer than a seed. */
  seed(): void {
    const at = new Date().toISOString();
    for (const [currency, perBase] of Object.entries(SEED_PER_BASE)) {
      if (this.points.has(currency)) continue;
      this.points.set(currency, { currency, perBase, source: 'seed', at });
    }
  }

  /** The door a live feed pushes through. Nothing else about this service changes when one is wired up. */
  setRate(currency: CurrencyCode, perBase: number, source = 'feed'): FxPoint {
    const code = currency?.trim().toUpperCase();
    if (!code) throw new GlosError('FIELD_REQUIRED', 'Name the currency the rate is for');
    if (!Number.isFinite(perBase) || perBase <= 0) throw new GlosError('AMOUNT_INVALID', `A rate must be a positive number, got ${perBase}`);
    const point: FxPoint = { currency: code, perBase, source, at: new Date().toISOString() };
    this.points.set(code, point);
    return point;
  }

  /** The whole rate book, for an operator who wants to see what the prices are standing on. */
  rates(): FxPoint[] {
    return [...this.points.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  }

  point(currency: CurrencyCode): FxPoint | undefined {
    return this.points.get(currency?.trim().toUpperCase());
  }

  /**
   * The rate between two currencies, or a refusal that names the one we have no rate for.
   *
   * Same-currency asks are answered with an identity rate rather than rejected: a caller converting a
   * whole route should not have to know in advance which of its stops are foreign.
   */
  rateFor(from: CurrencyCode, to: CurrencyCode): FxRate {
    const a = from?.trim().toUpperCase();
    const b = to?.trim().toUpperCase();
    const now = Date.now();
    if (a === b) return { from: a, to: b, rate: 1, via: FX_BASE, at: new Date(now).toISOString(), source: 'identity', stale: false };

    const pa = this.requirePoint(a);
    const pb = this.requirePoint(b);
    // Cross-rate through the base: `a` per base, `b` per base, so one `a` buys pb/pa of `b`.
    const rate = pb.perBase / pa.perBase;
    if (!Number.isFinite(rate) || rate <= 0) throw new GlosError('FX_REQUIRED', `The ${a}→${b} rate is not usable (${pa.perBase} / ${pb.perBase})`);
    // A derived rate is exactly as fresh as its stalest leg, and both halves are named so a reader can
    // see which one went cold.
    const olderAt = new Date(pa.at).getTime() <= new Date(pb.at).getTime() ? pa.at : pb.at;
    const ageH = (now - new Date(olderAt).getTime()) / 3_600_000;
    return { from: a, to: b, rate, via: FX_BASE, at: olderAt, source: `${pa.source}/${pb.source}`, stale: ageH > FX_RATE_MAX_AGE_H };
  }

  /** Convert an amount, rounded to the cent. Identical currencies pass through untouched, not round-tripped. */
  convert(amount: number, from: CurrencyCode, to: CurrencyCode): number {
    if (!Number.isFinite(amount)) throw new GlosError('AMOUNT_INVALID', `Cannot convert ${amount}`);
    if (from?.trim().toUpperCase() === to?.trim().toUpperCase()) return Math.round(amount * 100) / 100;
    return Math.round(amount * this.rateFor(from, to).rate * 100) / 100;
  }

  private requirePoint(currency: CurrencyCode): FxPoint {
    const point = this.points.get(currency);
    // FX_REQUIRED keeps its meaning: the route cannot be priced because two currencies cannot be brought
    // together — only now it is a missing RATE rather than a missing capability.
    if (!point) throw new GlosError('FX_REQUIRED', `No exchange rate for ${currency || 'that currency'} — the price cannot be stated in one currency`);
    return point;
  }
}
