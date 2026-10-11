import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { MIN_TIER_KEY, ROLES_KEY, SCOPES_KEY } from './scopes.decorator';
import { hasScope } from './actor-scopes';
import { staffNetworkAllows } from './staff-network';
import { SETUP_KEY_KEY, setupKeyOutsideSandbox } from './setup-key';
import { ActorRole, IntrospectionResult } from './auth.types';
import { Tier } from '../data-firewall/data-firewall.types';

/**
 * Strict mode (S3). When on, any route carrying neither @Public() nor @Scopes()/@Roles() is denied —
 * a default-deny that mechanically forces every route to declare its authorization. ON in CI (catches
 * unlabelled routes in review), OFF in prod by default so the incremental caller migration is not a
 * hard-fail while the frontend still sends anonymous tokens (see the S3 rollout decision).
 */
const STRICT = process.env.GLOS_AUTHZ_STRICT === '1';

/**
 * The ONE global guard (T-006, extended in S3). It authenticates, then authorizes — in a single
 * APP_GUARD. A second APP_GUARD would run in module-registration order and could see request.auth
 * undefined and fail OPEN, so roles/scopes/tier are folded in here after the claims are populated.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    // --- authenticate ---
    const request = context.switchToHttp().getRequest<Request & { auth?: IntrospectionResult }>();
    const token = AuthGuard.extractBearer(request.header('authorization'));
    if (!token) throw new UnauthorizedException('Missing Bearer token');

    const auth = this.authService.introspect(token);
    if (!auth.active) throw new UnauthorizedException(`Inactive token: ${auth.reason ?? 'unknown'}`);
    request.auth = auth;
    // A staff token works only from where staff work, when a deployment says where that is (GLOS_STAFF_NETWORKS).
    if (auth.role === 'operator' && !staffNetworkAllows(request.ip)) throw new ForbiddenException('Staff access is open only from the networks SeeBuyGet staff work on');
    // THE SETUP KEY IS NOBODY. Outside a sandbox it sets network staff up and does nothing else: refused here, before
    // any role or scope is read, on every route that is not marked for it — the unlabelled ones included.
    if (setupKeyOutsideSandbox(auth) && !this.reflector.getAllAndOverride<boolean>(SETUP_KEY_KEY, targets)) {
      throw new ForbiddenException('The setup key only sets network staff up. Sign in with a staff account of your own for everything else.');
    }

    // --- authorize ---
    const requiredRoles = this.reflector.getAllAndOverride<ActorRole[]>(ROLES_KEY, targets);
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, targets);
    const minTier = this.reflector.getAllAndOverride<Tier>(MIN_TIER_KEY, targets);
    const labelled = Boolean(requiredRoles?.length || requiredScopes?.length || minTier);

    if (!labelled) {
      if (STRICT) throw new ForbiddenException('Route has no authorization policy (@Public/@Scopes/@Roles required)');
      return true; // prod default: a valid token is enough for an unlabelled route (pre-migration)
    }

    // Operator satisfies everything — the `*` scope is granted only to operator tokens.
    const isOperator = auth.role === 'operator' || hasScope(auth.scopes, '*');
    if (isOperator) return true;

    if (requiredRoles?.length && (!auth.role || !requiredRoles.includes(auth.role))) {
      throw new ForbiddenException(`Requires role: ${requiredRoles.join(' | ')}`);
    }
    if (minTier && (auth.tier ?? 0) < minTier) {
      throw new ForbiddenException(`Requires assurance tier ${minTier}`);
    }
    if (requiredScopes?.length) {
      const missing = requiredScopes.filter((s) => !hasScope(auth.scopes, s));
      if (missing.length) throw new ForbiddenException(`Missing scope: ${missing.join(', ')}`);
    }
    return true;
  }

  private static extractBearer(header?: string): string | null {
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
