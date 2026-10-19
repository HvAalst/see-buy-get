import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { GlosError } from './glos-error';

/**
 * THE VERSIONS OF THE API COMPANIES' OWN SYSTEMS CALL, AND WHEN ONE STOPS (the user, round 12: "A year, with notice").
 *
 * A version keeps working at least a year after it is announced as stopping, and every company holding a live key is
 * told by email when it is announced and again a month before it stops (ApiVersionNoticeService). Until then each answer
 * says which version gave it; once one is set to stop, its answers say so too — `Deprecation` and `Sunset`, the two
 * standard headers (RFC 9745, RFC 8594) — so a system that never reads email still finds out.
 *
 * The version is the path's: `/v1/...`. A version that changes what a call means is a new path, never the old one changed.
 */

export interface ApiVersion {
  version: string;
  releasedAt: string;
  /** When it was announced as stopping: the day a newer version was out and the notices began. */
  announcedAt?: string;
  /** When it stops: a year after it was announced, at the earliest. */
  retiresAt?: string;
}

/** The company API's versions. A schedule shorter than the year promised fails `checkSchedules` — and its test. */
export const API_VERSIONS: readonly ApiVersion[] = [{ version: '1', releasedAt: '2026-10-19' }];

/** The year the user promised: no version stops sooner after it is announced. */
export const MIN_NOTICE_DAYS = 365;
/** The second notice: a month before it stops. */
export const LAST_NOTICE_DAYS = 30;

/** Every schedule that breaks the promise, in words. Empty when all keep it. */
export function checkSchedules(versions: readonly ApiVersion[]): string[] {
  const broken: string[] = [];
  for (const v of versions) {
    if (!v.retiresAt) continue;
    if (!v.announcedAt) broken.push(`v${v.version} has a day it stops but none it was announced`);
    else if (Date.parse(v.retiresAt) - Date.parse(v.announcedAt) < MIN_NOTICE_DAYS * 86_400_000) broken.push(`v${v.version} stops less than ${MIN_NOTICE_DAYS} days after it was announced`);
  }
  return broken;
}

/**
 * Answers what each version of the company API must: which version it is, and — once it is set to stop — when. Made
 * with `new`, not injected (`@UseInterceptors(new ApiVersionInterceptor())`): the versions it reads are a list, which a
 * test hands it.
 */
export class ApiVersionInterceptor implements NestInterceptor {
  constructor(private readonly versions: readonly ApiVersion[] = API_VERSIONS) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ctx.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
    const req = ctx.switchToHttp().getRequest<{ originalUrl?: string; url?: string }>();
    const version = /^\/v(\d+)\//.exec(req.originalUrl ?? req.url ?? '')?.[1] ?? API_VERSIONS[API_VERSIONS.length - 1].version;
    const v = this.versions.find((x) => x.version === version);
    res.setHeader('x-sbg-api-version', version);
    if (v?.retiresAt) {
      if (Date.now() >= Date.parse(v.retiresAt)) throw new GlosError('API_VERSION_RETIRED', `Version ${version} of the API stopped on ${v.retiresAt.slice(0, 10)}; the guide says what replaced it`);
      if (v.announcedAt) res.setHeader('Deprecation', `@${Math.floor(Date.parse(v.announcedAt) / 1000)}`);
      res.setHeader('Sunset', new Date(v.retiresAt).toUTCString());
    }
    return next.handle();
  }
}
