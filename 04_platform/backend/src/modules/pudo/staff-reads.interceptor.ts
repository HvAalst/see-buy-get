import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { StaffReadService } from './staff-reads.service';

/**
 * WHAT STAFF OPENED (staff-reads.types.ts): every record a member of staff reads by its name or number — a GET whose
 * address names something — is noted once it is answered. Lists, and everybody who is not staff, pass untouched.
 */
@Injectable()
export class StaffReadInterceptor implements NestInterceptor {
  constructor(private readonly reads: StaffReadService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { auth?: IntrospectionResult; route?: { path?: string } }>();
    const path = req.route?.path;
    // Staff only: StaffReadService.note says who is staff, in one place.
    if (req.method !== 'GET' || !path || !path.includes(':')) return next.handle();
    const record = Object.values((req.params ?? {}) as Record<string, string>).join(' · ');
    return next.handle().pipe(tap(() => this.reads.note(req.auth, `GET ${path}`, record)));
  }
}
