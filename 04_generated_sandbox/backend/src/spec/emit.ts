import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from './openapi';

/**
 * Emit contracts/openapi.json from the compiled app. Must run against `dist` (`nest build` first): the
 * @nestjs/swagger CLI plugin injects the schema metadata at BUILD time, so running the TS directly
 * would emit empty schemas. GLOS_PERSIST=off keeps the boot from touching disk.
 */
async function emit(): Promise<void> {
  process.env.GLOS_PERSIST = 'off';
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');
  await app.init();

  const doc = buildOpenApiDocument(app);
  const out = resolve(process.cwd(), 'contracts', 'openapi.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');

  await app.close();
  const paths = Object.keys(doc.paths).length;
  const schemas = Object.keys(doc.components?.schemas ?? {}).length;
  // eslint-disable-next-line no-console
  console.log(`Wrote ${out} — ${paths} paths, ${schemas} schemas.`);
}

emit().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
