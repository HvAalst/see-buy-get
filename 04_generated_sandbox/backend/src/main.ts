import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import { AppModule } from './app.module';
import { isSandbox } from './foundation/runtime/sandbox';
import { readProviderEventsRaw } from './foundation/mail/provider-events.raw';
import { buildOpenApiDocument } from './spec/openapi';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow the local frontend (e.g. http://localhost:4173) to call the API during dev.
  app.enableCors();
  /*
   * WHO IS CALLING, behind a proxy. Deployed behind Cloudflare or nginx every request arrives from the proxy, so the
   * rate limits and the staff network fence (GLOS_STAFF_NETWORKS) would see one address for the whole world.
   * GLOS_TRUST_PROXY says how many hops to trust ("1"), or which ("loopback, 10.0.0.0/8"); unset trusts none.
   */
  const trustProxy = process.env.GLOS_TRUST_PROXY?.trim();
  if (!trustProxy && !isSandbox()) {
    // Said at boot, because the other way to find out is everybody being shut out at once: the limits on how often
    // one caller may try a sign-in count by address, and behind a proxy there is one address.
    Logger.warn('GLOS_TRUST_PROXY is not set. If this server is behind a proxy or a load balancer, every caller looks like one address: the per-caller limits on sign-in will count everybody together, and the staff network fence will see only the proxy.', 'Bootstrap');
  }
  if (trustProxy) {
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy);
  }

  // S26 media upload: a base64 image data URL (client-downscaled to <200 KB) inflates ~33%, so the
  // default 100 KB JSON limit is too small. 2 MB gives headroom without inviting large payloads (the
  // MediaService still hard-caps decoded bytes at MEDIA_MAX_BYTES).
  // CA4 — a company document (a certificate scan, a licence) arrives as base64 and may run to 8 MB of bytes. Only that
  // route gets the larger body; it is registered first, so the global parser below leaves an already-parsed body alone.
  // The mail provider's notices (a bounce) are believed by a signature over their BYTES: that one address is read
  // raw, before any parser below turns a body into an object and throws the bytes away.
  readProviderEventsRaw(app);
  app.use(/^\/v1\/sbg\/entities\/[^/]+\/documents$/, json({ limit: '12mb' }));
  app.use(json({ limit: '2mb' }));

  // Global input validation — every DTO is validated at the edge.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // All SeeBuyGet APIs are versioned under /v1 (APIG-010, APIG-015).
  app.setGlobalPrefix('v1');

  // Live contract docs at /v1/docs (the same document `npm run spec` emits to contracts/openapi.json).
  SwaggerModule.setup('v1/docs', app, buildOpenApiDocument(app));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`GLOS backend listening on http://localhost:${port}/v1`, 'Bootstrap');
}

void bootstrap();
