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
 * A non-empty audit label for who performed an action.
 *
 * Prefers the VERIFIED name the token carries (a named account established it at login), then an
 * explicit override — which is how the operator console names the human at a keyboard, because its one
 * shared key cannot — then the actor's DID, then its subject (operator tokens are machine tokens with a
 * `sub` but no `did`), else a constant. Always a string — safe for audit fields.
 */
export function auditActor(actor: IntrospectionResult | undefined, override?: string): string {
  // The token's own name wins over an override: a name carried by a signed token was established at
  // login, while an override is whatever the caller put in the body. The override still serves the
  // operator console, whose shared key genuinely cannot say who is at the keyboard.
  return actor?.actorName || override || actor?.did || actor?.sub || 'operator';
}

/**
 * THE PERSON BEHIND THE TOKEN — for the surfaces that belong to a human rather than to a role.
 *
 * A driver's avatar, their PIN, their address and the invites they have sent are not facts about the
 * driver RECORD; they are facts about the person holding the phone, who may also keep a shop and manage a
 * fleet. Every role in this network signs in through the same identity spine, so the token knows — and
 * this is the one question the account surface has to ask of it.
 *
 * Throws rather than falling back to `did`. A machine credential and the shared operator key are not
 * anybody, and quietly treating the acting DID as a person would let a client_credentials token write a
 * profile onto whatever record its id happened to name.
 *
 * NO OPERATOR OVERRIDE, deliberately, and it is the difference between this and `actingDid`. An operator
 * acting on behalf of a shop is ordinary administration; an operator setting a person's PIN or reading
 * their address is impersonation. Staff who need to help somebody into their account have the rotation
 * paths built for exactly that, which leave a record.
 */
export function actingPerson(actor: IntrospectionResult | undefined): string {
  if (!actor?.personDid) {
    throw new ForbiddenException('This is your own account — sign in with your phone and PIN to reach it');
  }
  return actor.personDid;
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
