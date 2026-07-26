import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import { AppModule } from './app.module';
import { buildOpenApiDocument } from './spec/openapi';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow the local frontend (e.g. http://localhost:4173) to call the API during dev.
  app.enableCors();

  // S26 media upload: a base64 image data URL (client-downscaled to <200 KB) inflates ~33%, so the
  // default 100 KB JSON limit is too small. 2 MB gives headroom without inviting large payloads (the
  // MediaService still hard-caps decoded bytes at MEDIA_MAX_BYTES).
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
