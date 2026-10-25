import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { routeKeyOf } from '../../foundation/auth/staff-roles';
import { LiveService } from './live.service';

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The writes that change no queue, no count and nothing an office reads from a list, and come every few seconds or
 * minutes from every phone that is open: where a driver is (the map hears of that from the position itself), and the
 * heartbeats that say a driver's or a shop's phone is still there. Named as STAFF_AREAS names a route, and each is
 * checked to be one there (live.spec.ts) — that table is itself checked against every route the application has — so
 * a renamed one cannot quietly start telling every console on every beat.
 */
export const QUIET_WRITES: readonly string[] = ['POST sbg/fleet/drivers/:did/locate', 'POST sbg/fleet/drivers/:did/ping', 'POST sbg/agents/:did/ping'];

/**
 * ONE LIVE VIEW, the writes (see LiveService): once a write anybody makes has been answered, the console is told
 * something changed, and so is the fleet office of whoever made it when they act for a fleet — a manager, or one of its
 * drivers, whose sign-in carries the fleet. A refused write changed nothing and says nothing.
 */
@Injectable()
export class LiveInterceptor implements NestInterceptor {
  constructor(private readonly live: LiveService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { auth?: IntrospectionResult }>();
    if (!WRITES.has(req.method) || QUIET_WRITES.includes(routeKeyOf(ctx.getHandler(), ctx.getClass()) ?? '')) return next.handle();
    return next.handle().pipe(tap(() => this.changed(req.auth)));
  }

  private changed(actor: IntrospectionResult | undefined): void {
    this.live.toConsole('changed');
    if ((actor?.role === 'fleet_manager' || actor?.role === 'driver') && actor.tenant) this.live.toFleet(actor.tenant, 'changed');
  }
}
