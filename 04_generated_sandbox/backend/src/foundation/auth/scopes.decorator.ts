import { SetMetadata } from '@nestjs/common';
import { ActorRole } from './auth.types';
import { Tier } from '../data-firewall/data-firewall.types';

/**
 * Authorization metadata. Same reflector pattern as @Public(). The guard reads these AFTER it has
 * populated request.auth (S3). Declaring them here (S2) is inert — nothing enforces yet — so routes
 * can be labelled and merged incrementally without changing behaviour until the guard is switched on.
 */
export const SCOPES_KEY = 'authScopes';
export const ROLES_KEY = 'authRoles';
export const MIN_TIER_KEY = 'authMinTier';

/** Require the caller's token to hold every listed scope (the `*` wildcard satisfies any). */
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);

/** Restrict a route/controller to specific actor roles. */
export const Roles = (...roles: ActorRole[]) => SetMetadata(ROLES_KEY, roles);

/** Require a minimum assurance tier. */
export const MinTier = (tier: Tier) => SetMetadata(MIN_TIER_KEY, tier);

/**
 * ANYBODY SIGNED IN, whoever they are — said out loud. For a route that names nobody and belongs to nobody: a
 * calculation, a list every participant reads. Not a default. A route with no policy written on it says nothing;
 * this says "it was looked at, and it is for everybody who is signed in".
 */
export const SIGNED_IN_KEY = 'authSignedIn';
export const SignedIn = () => SetMetadata(SIGNED_IN_KEY, true);
