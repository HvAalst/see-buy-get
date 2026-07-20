import { ForbiddenException } from '@nestjs/common';
import { IntrospectionResult } from './auth.types';

/**
 * Resolve WHO a request acts as, closing the self-asserted-identity hole.
 *
 * The rule: a normal actor acts as THEMSELVES — identity comes from the verified token, and any id
 * in the request body is ignored. An OPERATOR (maximally trusted, client-secret gated) may act on
 * behalf of another participant by passing an explicit id — this is what keeps the seed, ops scripts
 * and admin tooling working without a password for every entity.
 *
 * Before S3 the body field WAS the identity for everyone, so a driver's token could pickup/void/settle
 * as any agent. Now:
 *   const did = actingDid(actor, dto.agentDid);
 * gives dto.agentDid only to operators; everyone else is pinned to actor.did.
 */
export function actingDid(actor: IntrospectionResult | undefined, override?: string): string {
  if (actor?.role === 'operator') {
    const did = override ?? actor.did;
    if (!did) throw new ForbiddenException('Operator must specify the subject id');
    return did;
  }
  if (!actor?.did) throw new ForbiddenException('No actor identity on the request');
  return actor.did;
}

/**
 * A non-empty audit label for who performed an action. Prefers an explicit override (an operator may
 * name the human), else the actor's DID, else its subject (operator tokens are machine tokens with a
 * `sub` but no `did`), else a constant. Always a string — safe for audit fields.
 */
export function auditActor(actor: IntrospectionResult | undefined, override?: string): string {
  return override || actor?.did || actor?.sub || 'operator';
}

/**
 * The tenant boundary a request is scoped to. A fleet_manager sees only their own tenant; an operator
 * may target any tenant (or all) via an explicit override. Returns undefined for "all" (operator, no
 * override) so callers can list across tenants.
 */
export function actingTenant(actor: IntrospectionResult | undefined, override?: string): string | undefined {
  if (actor?.role === 'operator') return override; // operator: the given tenant, or all
  return actor?.tenant; // everyone else: pinned to their own
}
