import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Credential field names that must NEVER appear in any 2xx response body, regardless of the route's
 * declared type. These are pure server-side secrets (scrypt salt + hash, raw passwords, PIN hashes) —
 * unlike the vendor signing `secret`, which register() legitimately returns once, or `resetToken`,
 * which the forgot-password flow shows in-app. So the denylist is deliberately tight.
 */
const CREDENTIAL_KEYS = new Set(['salt', 'hash', 'passwordhash', 'password', 'pinhash']);

/**
 * ResponseMaskInterceptor — the structural safety net for the response contract (S4).
 *
 * TypeScript return annotations are ERASED at runtime, so a handler typed `: AgentPublic` that returns
 * the stored entity compiles clean and ships the wallet balance. This interceptor makes the leak of a
 * known credential field structurally impossible rather than test-detected: it rebuilds every response
 * as a fresh structure with denied keys removed. Because it rebuilds (never mutates) it cannot corrupt
 * the in-memory entity the service handed back.
 *
 * S5 will extend this to prune every property not declared in the route's OpenAPI 2xx schema; until
 * those schemas exist, the credential denylist is the guaranteed floor.
 */
@Injectable()
export class ResponseMaskInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => stripCredentials(data)));
  }
}

/**
 * Return a copy of `value` with any CREDENTIAL_KEYS removed at every depth. Only plain objects and
 * arrays are rebuilt; Dates, class instances and primitives pass through by reference (untouched),
 * so nothing the service still holds is mutated.
 */
function stripCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCredentials);

  if (value !== null && typeof value === 'object' && isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (CREDENTIAL_KEYS.has(key.toLowerCase())) continue;
      out[key] = stripCredentials(val);
    }
    return out;
  }

  return value;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
