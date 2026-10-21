import { RequestMethod, type ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { STAFF_AREAS, type StaffArea } from './staff-areas.table';

/**
 * Round 38 — A MEMBER OF STAFF HOLDS ROLES (the user: "Four roles"): support (parcels, loads, cases), vetting (joining and
 * papers), money (payouts and books), administration (staff and settings). A person may hold several; each reaches only
 * the doors of theirs (STAFF_AREAS). A staff token carries its holder's roles as they were at sign-in; changing them signs
 * the person out, so the next sign-in carries the new ones.
 *
 * Only a NAMED member of staff is held to roles — a session of a staff account. The setup key and a sandbox's machine
 * key are no person: the setup key has its own narrow doors (setup-key.ts) and the machine key exists on a laptop only.
 */
export const STAFF_ROLES = ['support', 'vetting', 'money', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** The words of each role, as a refusal says them. */
export const ROLE_WORDS: Record<StaffRole, string> = {
  support: 'support (parcels, loads and cases)',
  vetting: 'vetting (joining and papers)',
  money: 'money (payouts and books)',
  admin: 'administration (staff and settings)',
};

/** A route as STAFF_AREAS names it: its method and its path, the controller's and the handler's joined, no slashes at the ends. */
export function routeKeyOf(handler: object, controller: object): string | undefined {
  const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
  if (verb === undefined) return undefined;
  const path = [Reflect.getMetadata(PATH_METADATA, controller), Reflect.getMetadata(PATH_METADATA, handler)]
    .map((p) => String(p ?? ''))
    .join('/')
    .split('/')
    .filter(Boolean)
    .join('/');
  return `${RequestMethod[verb]} ${path}`;
}

/** The area of the route this request is on; undefined for one STAFF_AREAS does not name. */
export function staffAreaOf(context: ExecutionContext): StaffArea | undefined {
  const key = routeKeyOf(context.getHandler(), context.getClass());
  return key ? STAFF_AREAS[key] : undefined;
}

/** May somebody holding these roles pass a door of this area? `any` for every role; `none` and a door not named for nobody. */
export function staffMay(roles: readonly string[] | undefined, area: StaffArea | undefined): boolean {
  if (!area || area === 'none') return false;
  if (area === 'any') return Boolean(roles?.length);
  return Boolean(roles?.includes(area));
}

/** What a member of staff is told at a door that is not theirs: which role it is for. */
export function staffRefusal(area: StaffArea | undefined): string {
  if (!area || area === 'none') return 'This is not a door for network staff.';
  if (area === 'any') return 'Your staff account holds no role yet: an administrator gives you one, and a second approves it.';
  return `This is for staff who hold the ${ROLE_WORDS[area]} role. An administrator can give it to you; a second one approves it.`;
}

/** Roles as given: known ones only, each once, in the order above. */
export function rolesOf(raw: readonly unknown[] | undefined): StaffRole[] {
  const given = new Set((raw ?? []).filter((r): r is StaffRole => typeof r === 'string' && (STAFF_ROLES as readonly string[]).includes(r)));
  return STAFF_ROLES.filter((r) => given.has(r));
}
