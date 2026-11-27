import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { langOf, personOf, ReaderLanguageService, wordsCountryOf } from './reader-language.service';

/**
 * 2026-11-27 — THE LANGUAGE A PERSON READS IN, HEARD ON EVERY CALL (the owner: "fix everything except those waiting for a
 * lawyer"). It was kept only from the bell, so somebody whose app has none — signing in only to send a parcel — was written to
 * in English. Every call a signed-in person's app makes says the app's language (x-sbg-lang) and whose review of it it reads
 * (x-sbg-words-country): the person's, never a company's or our staff's, kept where it changed (ReaderLanguageService.heard).
 * A call that says no language — a company's own system calling the API — changes nothing.
 */
@Injectable()
export class ReaderLanguageInterceptor implements NestInterceptor {
  constructor(private readonly readers: ReaderLanguageService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() === 'http') {
      const req = ctx.switchToHttp().getRequest<Request & { auth?: IntrospectionResult }>();
      if (req.auth) this.readers.heard(personOf(req.auth), langOf(req), wordsCountryOf(req));
    }
    return next.handle();
  }
}
