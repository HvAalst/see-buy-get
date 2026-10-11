import { INestApplication, Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { corsDelegate, ownOrigins } from './foundation/http/cors';
import { buildOpenApiDocument } from './spec/openapi';

type Env = Record<string, string | undefined>;
const sandboxOf = (env: Env) => (env.GLOS_ENV ?? '').trim().toLowerCase() !== 'production';

/**
 * WHAT THE SERVER SHOWS THE OUTSIDE — which websites it answers, and whether it hands out its own map.
 *
 * Kept out of `main.ts` so that it can be put on an application in a test and asked over the wire: what lives only
 * in the start-up file is run by nothing but a real start, and a rule about who is answered is exactly the kind that
 * is wrong for a year before anybody looks.
 *
 * Call AFTER the global prefix is set (the docs page is mounted under it) and before the application starts listening.
 */
export function applyEdge(app: INestApplication, env: Env = process.env): void {
  // WHICH WEBSITES MAY CALL THIS FROM A BROWSER: any, on a laptop; outside a sandbox our own, and — for the shipping
  // API a store's page calls — everybody's. See foundation/http/cors.ts.
  app.enableCors(corsDelegate(env));

  // The contract, as a page, at /v1/docs — on a laptop. Outside a sandbox it is not served: it is a map of every
  // route for whoever asks, and nobody who should have it needs to get it from the live server.
  if (sandboxOf(env)) {
    SwaggerModule.setup('v1/docs', app, buildOpenApiDocument(app));
    return;
  }
  const ours = ownOrigins(env);
  Logger.log(
    ours.length
      ? `Browsers on other websites are answered only from: ${ours.join(', ')} — and, for the shipping API, from anywhere.`
      : 'No site of ours is named (SBG_PUBLIC_URL, SBG_CONSOLE_URL, GLOS_CORS_ORIGINS): browsers on other websites are answered only by the shipping API. The apps work if they are served from this same address.',
    'Bootstrap',
  );
}
