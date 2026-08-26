import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import { ANONYMOUS, ApiKeyService, type Caller } from './api-key.service';

/** The header a merchant key travels in. Never a query parameter — those end up in access logs. */
export const API_KEY_HEADER = 'x-sbg-key';

interface KeyedRequest {
  headers?: Record<string, string | string[] | undefined>;
  sbgCaller?: Caller;
  sbgRateKey?: string;
}

/**
 * Work out who is calling a PUBLIC endpoint, without requiring that anybody is.
 *
 * This is not authentication in the usual sense — nothing here is gated on the answer. It runs so the rest
 * of the request can know three things it otherwise could not: whose rate limit to spend, whether the
 * caller has earned the costed breakdown, and which world (test or live) the answer belongs to.
 *
 * Must run BEFORE the rate-limit guard, which reads what this leaves behind. A missing key is anonymous; a
 * key that is present and wrong throws, because degrading a typo to anonymous would let a broken
 * integration look like a working one right up until the limits started to matter.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly keys: ApiKeyService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<KeyedRequest>();
    const raw = req.headers?.[API_KEY_HEADER];
    const presented = Array.isArray(raw) ? raw[0] : raw;
    const caller = presented ? this.keys.resolve(presented) : ANONYMOUS;
    req.sbgCaller = caller;
    req.sbgRateKey = caller.rateKey;
    return true;
  }
}

/** The resolved caller, for a handler that wants to know. Always present behind ApiKeyGuard. */
export const CallerKey = createParamDecorator((_data: unknown, context: ExecutionContext): Caller => {
  return context.switchToHttp().getRequest<KeyedRequest>().sbgCaller ?? ANONYMOUS;
});
