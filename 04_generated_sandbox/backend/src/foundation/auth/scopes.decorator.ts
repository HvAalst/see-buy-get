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
