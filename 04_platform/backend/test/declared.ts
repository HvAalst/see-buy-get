import type { INestApplication } from '@nestjs/common';
import { DECLARATIONS, SecurityDeclarationService, type DeclarationKind } from '../src/modules/pudo/security-declaration.service';

/**
 * Round 39 — A FIXTURE PARTNER SIGNS ITS SECURITY DECLARATION, as a real one does at joining: a shop, a hub, a fleet's office
 * or a rider in no fleet takes on nothing new until it has (security-declaration.service.ts). For the tests that are about
 * something else; test/security-declarations.e2e-spec.ts is about the declaration itself, and signs over the wire.
 */
export function declared(app: INestApplication, kind: DeclarationKind, ...dids: Array<string | undefined>): void {
  const declarations = app.get(SecurityDeclarationService);
  for (const did of dids) if (did) declarations.sign(kind, did, DECLARATIONS[kind].version, 'Test fixture');
}
