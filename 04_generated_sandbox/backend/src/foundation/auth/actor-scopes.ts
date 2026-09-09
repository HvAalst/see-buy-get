import { ActorRole } from './auth.types';

/**
 * The scope vocabulary — the single source both the token minter (S2) and the route labels (S3) draw
 * from. Scopes read `<resource>:<action>[:<reach>]`; `role` picks the app, `scopes` gate the routes.
 * `:own`/`:self` reach is enforced against the token's `tenant`/`did` in the guard (S3). The operator
 * role carries the `*` wildcard — the guard treats a caller holding `*` as satisfying any scope.
 */
export const WILDCARD_SCOPE = '*';

export const ROLE_SCOPES: Record<ActorRole, string[]> = {
  // The person, acting as themselves (S20). The consumer is authenticated for the whole Send/Buy/Get
  // surface: create a shipment, read their own parcels (sent + received, matched by phoneHash), file a
  // delivery dispute, and submit proof-of-delivery. `identity:self` gates the person's own account
  // routes (me / role-switch). Routes for dispute:file / pod:submit land in S23; the scope is defined
  // now so the token already carries the authority its future routes require.
  // NOTIF — every human role may manage its OWN push subscriptions + read its own notification inbox
  // (`notification:manage:self`, reach enforced against the token's DID). Provisioned on the role now so a
  // freshly-minted token already carries the authority its subscribe/inbox routes require.
  consumer: [
    'shipment:create',
    'parcel:read:own',
    'dispute:file',
    'pod:submit',
    'identity:self',
    'notification:manage:self',
  ],
  agent: [
    'parcel:accept',
    'parcel:handover',
    'parcel:pickup',
    'parcel:void',
    'parcel:read:own',
    'tote:manage:own',
    'agent:read:self',
    'wallet:read:self',
    'notification:manage:self',
  ],
  driver: ['driver:read:self', 'session:manage:self', 'offer:claim', 'load:read:own', 'route:manage:self', 'notification:manage:self'],
  mdp: ['mdp:read:self', 'tote:sort', 'bag:manage', 'parcel:transit', 'notification:manage:self'],
  genesis: ['shipment:create', 'vendor:read:self', 'vendor:manage:self', 'quote:read', 'parcel:read:own', 'notification:manage:self'],
  fleet_manager: ['fleet:read:own', 'fleet:manage:own', 'driver:onboard:own', 'vehicle:manage:own', 'notification:manage:self'],
  // A company's own administration: read what it charges and what its books say, and set its commercial
  // terms. `:own` reach is the company structure — its own entity, and any entity that names it as
  // parent, which is what makes the GROUP's admin able to see its sisters without a second role.
  // Deliberately NOT here: anything operational (clearing hazards, KYC decisions, payout runs). Those
  // belong to network staff, and a commercial login must not quietly become one.
  entity_admin: ['entity:read:own', 'entity:manage:own', 'books:read:own'],
  operator: [WILDCARD_SCOPE],
  anon: [],
};

/** Default scopes for an actor of this role. S3 may refine per-actor from capabilities/tier. */
export function scopesForRole(role: ActorRole): string[] {
  return [...(ROLE_SCOPES[role] ?? [])];
}

/** Does a token holding `held` scopes satisfy `required`? The `*` wildcard satisfies everything. */
export function hasScope(held: string[] | undefined, required: string): boolean {
  if (!held || held.length === 0) return false;
  return held.includes(WILDCARD_SCOPE) || held.includes(required);
}
