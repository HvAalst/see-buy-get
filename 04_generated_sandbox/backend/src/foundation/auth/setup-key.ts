import { ForbiddenException, SetMetadata } from '@nestjs/common';
import { isSandbox } from '../runtime/sandbox';
import { hasScope } from './actor-scopes';
import { IntrospectionResult } from './auth.types';

/**
 * THE SETUP KEY IS NOBODY — and outside a sandbox it does one thing.
 *
 * The client secret (`GLOS_CLIENT_SECRET`) is one string in a server's environment. It was "the trusted-caller
 * grant": whoever held it could ask for a token AS any shop, driver, fleet or company, and its own operator token
 * could stand in for any of them on every route that lets staff do so. That is what the seeder needs on a laptop —
 * and outside one it is a single stolen string that is everybody at once, with no name on anything it does.
 *
 * The user, 2026-10-11: "client secret should not act as participant outside sandbox."
 *
 * So outside a sandbox:
 *   - nothing is given a participant's token but that participant signing in (`AuthService.mintActorTokenFor`);
 *   - the setup key's operator token reaches ONLY the routes marked `@SetupKeyMay()` — setting network staff up —
 *     and is refused everywhere else by the one guard, whatever the route's own roles say. A new route is closed to
 *     it until somebody marks it, which is the point: there is no list of what it must be kept away from;
 *   - and where a route stands in for somebody (`actingDid`, `actingTenant`), the setup key is refused there too —
 *     a mark put on the wrong route still lets it act for nobody.
 *
 * Staff are people with an account each: their token carries the key their sessions answer to, and that is how the
 * two are told apart.
 */

/** What a staff account's sign-out key starts with. A token carrying one belongs to a person. */
export const STAFF_KEY_PREFIX = 'operator:';

export const SETUP_KEY_KEY = 'authSetupKeyMay';

/** A route the SETUP KEY may use outside a sandbox. Only what sets network staff up is marked. */
export const SetupKeyMay = () => SetMetadata(SETUP_KEY_KEY, true);

/** Is this the shared setup key's token: operator rights, and no staff account behind it? */
export function isSetupKey(auth: Pick<IntrospectionResult, 'role' | 'scopes' | 'revocationKey'> | undefined): boolean {
  const operator = auth?.role === 'operator' || hasScope(auth?.scopes, '*');
  return operator && !auth?.revocationKey?.startsWith(STAFF_KEY_PREFIX);
}

/** Is this a member of network staff signed in to their own account — a person, with a name on what they do? */
export function isStaffAccount(auth: Pick<IntrospectionResult, 'role' | 'revocationKey'> | undefined): boolean {
  return auth?.role === 'operator' && Boolean(auth.revocationKey?.startsWith(STAFF_KEY_PREFIX));
}

/** Is the setup key being used where it is nobody: outside a sandbox? */
export function setupKeyOutsideSandbox(auth: Pick<IntrospectionResult, 'role' | 'scopes' | 'revocationKey'> | undefined): boolean {
  return !isSandbox() && isSetupKey(auth);
}

/**
 * STANDING IN FOR SOMEBODY is a member of staff's to do — a person with a name, whose doing it is on record. Outside
 * a sandbox the setup key stands in for nobody, whichever route it reached.
 */
export function assertMayStandIn(auth: IntrospectionResult | undefined): void {
  if (setupKeyOutsideSandbox(auth)) throw new ForbiddenException('The setup key acts for nobody. Sign in with a staff account of your own.');
}
