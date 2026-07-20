import { Module } from '@nestjs/common';
import { M6Controller } from './m6.controller';

/**
 * M6 — Open API Gateway & Developer Ecosystem (APIG).
 * Epic: 02_epic_domains/epic_m6_api_gateway.md.
 * Phase-1 slice: T-006 minimal auth shim (OAuth 2.1 / OIDC + DID token introspection vs M1).
 * Skeleton only (T-001); the full gateway is a later phase.
 */
@Module({
  controllers: [M6Controller],
})
export class M6Module {}
