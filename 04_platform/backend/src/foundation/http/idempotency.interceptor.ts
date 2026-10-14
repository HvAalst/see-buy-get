import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, from } from 'rxjs';
import { IdempotencyService } from './idempotency.service';
import { Actor } from '../auth/actor.decorator';

/**
 * Mark a handler that calls IdempotencyService ITSELF, so this interceptor leaves it alone.
 *
 * Only the merchant shipping mint needs it: that endpoint reports `replayed` on its own body, which a
 * generic wrapper cannot do, and running both would spend the same name in two scopes.
 */
export const OWN_IDEMPOTENCY = 'sbg:own-idempotency';
export const OwnIdempotency = () => SetMetadata(OWN_IDEMPOTENCY, true);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Make every write replay-safe — when the caller asks for it.
 *
 * `IdempotencyService` has existed since the merchant API needed it, and it was wired to exactly one
 * endpoint. Everything a shopkeeper or a driver actually does — take a parcel in, hand a bag to a bus,
 * shelve it, release it — was at-least-once with no way to tell a request that failed from one that
 * succeeded silently. That was survivable while every write happened online, next to a person who could
 * look at the screen and try again. It stops being survivable the moment those writes are QUEUED: a queue
 * retries by design, on a schedule nobody is watching, and without this it would be a machine for charging
 * shops twice for the same parcel.
 *
 * GLOBAL and opt-in by header, deliberately. A route that forgets to be idempotent is a route that is not,
 * and the client is the only party that knows whether an attempt is a retry — so the server promises the
 * guarantee to anyone who names their attempt, rather than to a list of endpoints somebody has to maintain.
 * Sending no key behaves exactly as before.
 *
 * The scope pins the promise to one caller AND one route: two people, or one person on two different
 * screens, can use the same key without colliding, and a key is never honoured for a different operation
 * than the one it was minted for.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    if (this.reflector.getAllAndOverride<boolean>(OWN_IDEMPOTENCY, [ctx.getHandler(), ctx.getClass()])) return next.handle();

    const request = ctx.switchToHttp().getRequest<Request & { auth?: Actor }>();
    if (!MUTATING.has(request.method)) return next.handle();

    const header = request.headers['idempotency-key'];
    const key = (Array.isArray(header) ? header[0] : header)?.trim();
    if (!key) return next.handle();

    // Who, and what they are doing. The actor comes from the guard's introspection, never from the body —
    // a caller-supplied identity here would let one person replay into another's scope.
    const who = request.auth?.sub ?? request.auth?.did ?? 'anonymous';
    const scope = `${request.method} ${request.route?.path ?? request.path}:${who}`;

    return from(
      this.idempotency
        // The fingerprint covers the BODY only. Path parameters are already in the scope, and a query
        // string on a mutating request is not something this API uses to carry state.
        .run(scope, key, request.body, async () => firstValue(next.handle()))
        .then(({ result }) => result),
    );
  }
}

/** The handler's single emission, as a promise. Nest controllers return one value, not a stream. */
function firstValue<T>(source: Observable<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let seen = false;
    source.subscribe({
      next: (v) => {
        seen = true;
        resolve(v);
      },
      error: reject,
      // A handler that returns nothing (a 204) still has to settle, or the record stays 'running' for
      // ever and every retry of a perfectly successful request is refused as in-flight.
      complete: () => {
        if (!seen) resolve(undefined as T);
      },
    });
  });
}
