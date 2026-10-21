import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { MIN_TIER_KEY, ROLES_KEY, SCOPES_KEY, SIGNED_IN_KEY } from './scopes.decorator';
import { hasScope } from './actor-scopes';
import { staffNetworkAllows } from './staff-network';
import { SETUP_KEY_KEY, isStaffAccount, setupKeyOutsideSandbox } from './setup-key';
import { STAFF_OUTSIDE_SANDBOX_KEY } from './engine-surface';
import { staffAreaOf, staffMay, staffRefusal } from './staff-roles';
import { AT_THE_COUNTER_KEY, OWNER_ONLY, isShopStaff } from './at-the-counter';
import { isSandbox } from '../runtime/sandbox';
import { ActorRole, IntrospectionResult } from './auth.types';
import { Tier } from '../data-firewall/data-firewall.types';

/** What a route with nothing written on it is told. Said to staff as well: nobody looked at it, so it is nobody's. */
export const NOBODY_SAID = 'This route does not say who it is for, so it is open to nobody';

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

    // THE ENGINE UNDERNEATH (engine-surface.ts): outside a sandbox its own routes are for network staff only — one
    // marked @Public included, so that mark is read before "public" is.
    const engine = !isSandbox() && this.reflector.getAllAndOverride<boolean>(STAFF_OUTSIDE_SANDBOX_KEY, targets) === true;

    if (!engine && this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

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

    if (engine && !isStaffAccount(auth)) throw new ForbiddenException('Outside a sandbox this part of the server is for network staff only.');

    // --- authorize ---
    const requiredRoles = this.reflector.getAllAndOverride<ActorRole[]>(ROLES_KEY, targets);
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, targets);
    const minTier = this.reflector.getAllAndOverride<Tier>(MIN_TIER_KEY, targets);
    // "Anybody signed in" is a policy too, when it is written down (@SignedIn): the route was looked at.
    const signedIn = this.reflector.getAllAndOverride<boolean>(SIGNED_IN_KEY, targets) === true;
    const labelled = Boolean(requiredRoles?.length || requiredScopes?.length || minTier || signedIn);
    const engineMarked = this.reflector.getAllAndOverride<boolean>(STAFF_OUTSIDE_SANDBOX_KEY, targets) === true;

    // THE DOOR, TURNED ROUND. A route with nothing written on it used to be let in with any valid sign-in and
    // trusted to decide inside; a setting could refuse it instead and was never switched on. Every route of the
    // product now says who it is for (modules/pudo/who-is-calling.spec.ts reads all of them), so one that says
    // nothing is one nobody looked at, and it is refused — to staff too. The engine underneath is the one exception,
    // and its own mark makes it: staff-only outside a sandbox (above), and on a laptop the demo it always was.
    if (!labelled && !engineMarked) throw new ForbiddenException(`${NOBODY_SAID}. It needs @Public, @Roles, @Scopes or @SignedIn.`);

    // Round 38 — A MEMBER OF STAFF HOLDS ROLES (staff-roles.ts; the user: "Four roles"): each door staff pass is for
    // support, vetting, money or administration — or any of them — and a named member of staff passes only theirs. Asked
    // before any other label lets them through, the engine's unwritten routes included; a door the table does not name is
    // nobody's.
    if (isStaffAccount(auth)) {
      const area = staffAreaOf(context);
      if (!staffMay(auth.staffRoles, area)) throw new ForbiddenException(staffRefusal(area));
    }

    // The engine's unwritten routes: past the marks above, open — to staff anywhere else, to a sign-in on a laptop.
    if (!labelled) return true;

    // THE PEOPLE AT A SHOP'S COUNTER (at-the-counter.ts) sign in as the shop: let through only a door marked for them.
    // Read off the handler alone — a mark on a whole controller would open a route added to it later without anybody deciding.
    if (isShopStaff(auth) && this.reflector.get<boolean>(AT_THE_COUNTER_KEY, context.getHandler()) !== true) throw new ForbiddenException(OWNER_ONLY);

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
