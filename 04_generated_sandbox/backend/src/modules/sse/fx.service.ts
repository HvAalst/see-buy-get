import { Injectable } from '@nestjs/common';

// Real-time FX engine (SSE-071) for cross-border settlement (SSE-042). Sandbox rate table with
// a transparent fixed spread and a 60-second rate lock; production sources a liquidity network.

const USD_VALUE: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, SGD: 0.74, CNY: 0.14 };
const SPREAD = 0.005; // 0.5%, transparent

export interface FxQuote {
  from: string;
  to: string;
  rate: number; // mid rate from→to
  spread: number;
  lockedUntilMs: number; // 60s lock
}

@Injectable()
export class FxService {
  quote(from: string, to: string, now: number = Date.now()): FxQuote {
    const rate = this.midRate(from, to);
    return { from, to, rate: round6(rate), spread: SPREAD, lockedUntilMs: now + 60_000 };
  }

  /** Convert an amount, applying the spread in the recipient's favour-adverse direction. */
  convert(amount: number, from: string, to: string): { converted: number; rate: number; spread: number } {
    if (from === to) return { converted: round2(amount), rate: 1, spread: 0 };
    const rate = this.midRate(from, to);
    const effective = rate * (1 - SPREAD);
    return { converted: round2(amount * effective), rate: round6(rate), spread: SPREAD };
  }

  supported(currency: string): boolean {
    return currency in USD_VALUE;
  }

  private midRate(from: string, to: string): number {
    const f = USD_VALUE[from] ?? 1;
    const t = USD_VALUE[to] ?? 1;
    return f / t;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
