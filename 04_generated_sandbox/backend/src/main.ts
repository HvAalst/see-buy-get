import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow the local frontend (e.g. http://localhost:4173) to call the API during dev.
  app.enableCors();

  // Global input validation — every DTO is validated at the edge.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // All GLOS APIs are versioned under /v1 (APIG-010, APIG-015).
  app.setGlobalPrefix('v1');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`GLOS backend listening on http://localhost:${port}/v1`, 'Bootstrap');
}

void bootstrap();
