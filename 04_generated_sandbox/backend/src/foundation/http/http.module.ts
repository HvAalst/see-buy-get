import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ProblemFilter } from './problem.filter';
import { ResponseMaskInterceptor } from './response-mask.interceptor';

/**
 * HttpModule — the global HTTP contract layer.
 *
 * Registers the ProblemFilter (every error → RFC 9457 problem+json) and the ResponseMaskInterceptor
 * (strip credential fields from every 2xx) as global providers rather than wiring them in main.ts, so
 * the e2e TestingModule — which boots AppModule directly — picks them up automatically.
 */
@Module({
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseMaskInterceptor },
  ],
})
export class HttpModule {}
