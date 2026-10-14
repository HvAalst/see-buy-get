import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlosError } from './glos-error';

/**
 * A rate limit for a PUBLIC endpoint — the thing that makes "unauthenticated" different from "free".
 *
 * An endpoint anybody can call is an endpoint anybody can call a million times. Everything public in this
 * system until now was cheap and read-only; a shipment quote plans a route, so it is neither, and it is the
 * first surface a stranger can make the network do real work on.
 *
 * This is a per-caller sliding window, held in memory. That is honest for one instance and no more: behind
 * two of them a caller gets two windows, and the fix is a shared counter, not a cleverer local one. Stated
 * here rather than discovered later.
 *
 * The caller is the request IP, which is the only identity a public endpoint has. When merchant keys land,
 * the key becomes the caller and the limit becomes per-merchant — the guard does not change, only what it
 * keys on.
 */

export interface RateLimitSpec {
  /** How many requests one caller may make inside the window. */
  limit: number;
  /** The window, in seconds. */
  windowSec: number;
}

export const RATE_LIMIT_KEY = 'rateLimit';

/** Limit a route (or a whole controller) to `limit` requests per caller per `windowSec`. */
export const RateLimit = (limit: number, windowSec: number) => SetMetadata(RATE_LIMIT_KEY, { limit, windowSec } as RateLimitSpec);

/** One caller's hits inside the current window, newest last. */
type Hits = number[];

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, Hits>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const spec = this.reflector.getAllAndOverride<RateLimitSpec | undefined>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!spec) return true;

    const req = context.switchToHttp().getRequest<{ sbgRateKey?: string; ip?: string; socket?: { remoteAddress?: string }; route?: { path?: string }; url?: string }>();
    // An identified caller is counted as THEMSELVES; everyone else shares an IP bucket. `sbgRateKey` is set
    // by whatever guard ran first and worked out who this is — this one deliberately does not know or care
    // what an identity is, which is what keeps it in the foundation and out of the domain.
    const caller = req.sbgRateKey || req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${caller}:${req.route?.path ?? req.url ?? ''}`;

    const now = Date.now();
    const windowMs = spec.windowSec * 1000;
    // Drop anything that has aged out, then decide. Pruning on read is what keeps the map from growing
    // without bound: a caller who never comes back leaves at most one stale entry, cleared below.
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= spec.limit) {
      this.hits.set(key, recent);
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
      throw new GlosError('RATE_LIMITED', `Too many requests — try again in ${retryAfterSec}s`, { limit: spec.limit, windowSec: spec.windowSec, retryAfterSec });
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.sweep(now, windowMs); // a crude cap, so a flood of one-shot callers cannot pin memory
    return true;
  }

  private sweep(now: number, windowMs: number): void {
    for (const [key, hits] of this.hits) {
      if (hits.every((at) => now - at >= windowMs)) this.hits.delete(key);
    }
  }
}
