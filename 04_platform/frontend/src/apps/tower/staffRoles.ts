import type { MessageKey } from '../../shared/i18n';
import type { Screen } from './useTowerApp';

/**
 * Round 38 — A MEMBER OF STAFF HOLDS ROLES (the user: "Four roles"): support (parcels, loads, cases), vetting (joining
 * and papers), money (payouts and books), administration (staff and settings). A person may hold several. The server
 * refuses every door that is not theirs (backend staff-roles.ts); the console offers only the screens that are, and
 * reads only what those screens show — a screen whose every read answers 403 teaches somebody the console is broken.
 *
 * Only a NAMED member of staff is held to roles. The setup key on a laptop is nobody in particular and reaches what it
 * always reached; a company's administrator is not staff at all. Both carry no roles here, which means "not held".
 */
export type StaffRole = 'support' | 'vetting' | 'money' | 'admin';

export const STAFF_ROLES: readonly StaffRole[] = ['support', 'vetting', 'money', 'admin'];

/** Each role's name, and what it covers. */
export const ROLE_WORDS: Record<StaffRole, { name: MessageKey; covers: MessageKey }> = {
  support: { name: 'tower.roles.support', covers: 'tower.roles.supportCovers' },
  vetting: { name: 'tower.roles.vetting', covers: 'tower.roles.vettingCovers' },
  money: { name: 'tower.roles.money', covers: 'tower.roles.moneyCovers' },
  admin: { name: 'tower.roles.admin', covers: 'tower.roles.adminCovers' },
};

/** Whether whoever is signed in holds a role. No roles at all (`undefined`): not a named member of staff, so not held to them. */
export function holds(roles: readonly string[] | undefined, role: StaffRole): boolean {
  return roles === undefined || roles.includes(role);
}

/**
 * The roles each screen is for, matching what the server says of the reads it makes. A screen not named here is for
 * every role (the overview, the market, the depots, somebody's own settings). Several roles: holding any one is enough.
 */
export const SCREEN_ROLES: Partial<Record<Screen, readonly StaffRole[]>> = {
  // support — parcels, loads and cases
  stores: ['support'],
  movers: ['support'],
  cases: ['support'],
  hazards: ['support'],
  claims: ['support'],
  disposal: ['support'],
  imports: ['support'],
  reports: ['support'],
  support: ['support'],
  // vetting — joining and papers
  approvals: ['vetting'],
  businesses: ['vetting'],
  accountmoves: ['vetting'],
  iddisputes: ['vetting'],
  paperreports: ['vetting'],
  // What people wrote from the help: support answers it.
  messages: ['support'],
  papers: ['vetting'],
  // money — payouts and books
  money: ['money'],
  // administration — staff and settings
  pilot: ['admin'],
  rates: ['admin'],
  corridors: ['admin'],
  borders: ['admin'],
  presence: ['admin'],
  pictures: ['admin'],
  connections: ['admin'],
  staffreads: ['admin'],
  // Round 39 — rating a corridor or hub changes what the network asks there: administration's.
  risks: ['admin'],
  companies: ['admin'],
  // A company's record: its settings are administration's, its papers vetting's.
  company: ['admin', 'vetting'],
};

/** Whether a screen is offered to somebody holding these roles. Holding none, a member of staff is offered only what is everybody's. */
export function offered(screen: Screen, roles: readonly string[] | undefined): boolean {
  if (roles === undefined) return true;
  const need = SCREEN_ROLES[screen];
  if (!need) return roles.length > 0;
  return need.some((r) => roles.includes(r));
}

/** Roles as the server sent them: known ones, each once, in the order above. */
export function rolesOf(raw: unknown): StaffRole[] {
  const given = Array.isArray(raw) ? raw : [];
  return STAFF_ROLES.filter((r) => given.includes(r));
}

/** Roles as a line says them: "Support, Money". */
export function rolesWords(roles: readonly StaffRole[], t: (key: MessageKey) => string): string {
  if (!roles.length) return t('tower.roles.none');
  return roles.map((r) => t(ROLE_WORDS[r].name)).join(', ');
}
