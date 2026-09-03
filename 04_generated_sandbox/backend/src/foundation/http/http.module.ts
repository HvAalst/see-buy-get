import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ProblemFilter } from './problem.filter';
import { ResponseMaskInterceptor } from './response-mask.interceptor';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyService } from './idempotency.service';

/**
 * HttpModule — the global HTTP contract layer.
 *
 * Registers the ProblemFilter (every error → RFC 9457 problem+json), the ResponseMaskInterceptor
 * (strip credential fields from every 2xx) and the IdempotencyInterceptor (any write is replay-safe when
 * the caller names its attempt) as global providers rather than wiring them in main.ts, so the e2e
 * TestingModule — which boots AppModule directly — picks them up automatically.
 *
 * `@Global` because IdempotencyService must be ONE instance: the whole promise is that a name spent in
 * one place is spent everywhere, and a second copy of the store would hand out the same name twice.
 */
@Global()
@Module({
  providers: [
    IdempotencyService,
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseMaskInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [IdempotencyService],
})
export class HttpModule {}
