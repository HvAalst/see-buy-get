// M6 auth contracts (T-006, APIG-011 subset). Widened in S2 to carry actor identity.

import { Tier } from '../data-firewall/data-firewall.types';

export type GrantType = 'client_credentials' | 'did';

/**
 * WHICH APP a token belongs to → routing + the default UI register. Orthogonal to `scopes`, which
 * gate individual routes. `anon` is the unauthenticated public (tracking, checkout).
 */
export type ActorRole =
  | 'consumer'
  | 'agent'
  | 'driver'
  | 'mdp'
  | 'genesis'
  | 'fleet_manager'
  /** Administers a COMPANY — a sister, or the group. `tenant` is the entityId; reach follows the
   *  company structure from there (see EntityService.mayAdminister). */
  | 'entity_admin'
  | 'operator'
  | 'anon';

export interface IssueTokenInput {
  /** Subject: a client id (client_credentials) or a DID (did-bound / actor). */
  sub: string;
  type: GrantType;
  ttlSeconds?: number;
  // --- actor claims (participant/actor tokens; omitted for plain machine client_credentials) ---
  role?: ActorRole;
  /** The verified subject DID (equals `sub` for actor tokens). */
  did?: string;
  /** What the caller MAY do — <resource>:<action>[:<reach>], derived from capabilities at mint. */
  scopes?: string[];
  /** Multi-tenancy boundary — a fleet driver/manager's owning managerDid, or an admin's entityId. */
  tenant?: string;
  /**
   * The HUMAN acting, when the token was minted against a named account.
   *
   * Not decoration and not a display string: it is what an audit trail records, and it is here rather
   * than in a request body because a self-asserted name is a name anybody can type. Absent on tokens
   * that are not a person — a machine credential, or the shared operator key, which is exactly why the
   * operator console has to ask somebody to type theirs.
   */
  actorName?: string;
  /** Assurance level; gates which scopes may be granted (@MinTier). */
  tier?: Tier;
  /** Revocation counter, copied from the actor's profile at mint; compared on introspect. */
  tokenVersion?: number;
}

export interface AccessToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

/**
 * What the guard attaches to `request.auth`. IMPORTANT: introspect() builds this by an explicit
 * whitelist projection (auth.service.ts) — any claim not copied here is silently dropped. Every actor
 * field below must be projected there or @Actor()/@Scopes() see nothing.
 */
export interface IntrospectionResult {
  active: boolean;
  sub?: string;
  type?: GrantType;
  exp?: number;
  reason?: string;
  // --- actor identity (present on actor tokens) ---
  role?: ActorRole;
  did?: string;
  scopes?: string[];
  tenant?: string;
  /** The named human behind this token, when there is one. See IssueTokenInput.actorName. */
  actorName?: string;
  tier?: Tier;
}

export interface TokenClaims {
  sub: string;
  type: GrantType;
  iat: number;
  exp: number;
  /** Claim-schema version, so a future shape change is detectable. */
  ver?: 1;
  // --- actor claims ---
  role?: ActorRole;
  did?: string;
  scopes?: string[];
  tenant?: string;
  actorName?: string;
  tier?: Tier;
  tokenVersion?: number;
}
