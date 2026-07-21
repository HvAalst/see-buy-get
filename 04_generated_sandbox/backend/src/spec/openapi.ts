import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * The SeeBuyGet API contract. Built once from the running Nest app and used two ways: served as live
 * docs at /v1/docs, and emitted to contracts/openapi.json (npm run spec) as the committed source that
 * the persona API library and any integrator generate their client from.
 *
 * SeeBuyGet = see → buy → get: the consumer commerce brand over the PUDO pick-up/drop-off logistics
 * backbone. The bearer scheme is the actor token minted at login (S2).
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('SeeBuyGet API')
    .setDescription(
      'SeeBuyGet — see, buy, get. The API behind the SeeBuyGet network: the PUDO pick-up/drop-off ' +
        'agents, drivers, fleets and MDP sort hubs that move a parcel, plus the seebuyget.com consumer ' +
        'web (storefront, checkout, tracking). Authenticate with the actor token minted at login.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'SBG-actor-token' }, 'actor')
    .build();

  return SwaggerModule.createDocument(app, config, {
    deepScanRoutes: true,
    // Brand-clean, persona-scoped operationIds: `<Persona>.<method>` (e.g. Pudo.accept today; when S6
    // splits PudoController into AgentController/DriverController/… these become Agent.accept,
    // Driver.claim, … automatically — no "Controller" suffix, no hand-pinned ids). The persona prefix
    // keeps them globally unique across every module's controllers.
    operationIdFactory: (controllerKey: string, methodKey: string) => `${controllerKey.replace(/Controller$/, '')}.${methodKey}`,
  });
}
