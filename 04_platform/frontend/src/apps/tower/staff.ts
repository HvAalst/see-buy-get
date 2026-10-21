import type { MessageKey, Translate } from '../../shared/i18n';
import { rolesOf, rolesWords } from './staffRoles';

/**
 * WHO IS ON STAFF, AND HOW SOMEBODY IS ADDED — as the console says it.
 *
 * A new staff sign-in takes two people: one member of staff asks, a different one approves. No password is made for
 * anybody to hold: the new person is emailed a link, to their own address, to choose one. The setup key is nobody in
 * particular — it makes the first account on a new installation, and is the second person only for somebody who is
 * the only one able to sign in. The server decides all of it; this only chooses what to offer, so that nobody is
 * shown a button that will be refused.
 */

/**
 * THE STAFF LIST as the server answered it — and whether that list is ALL the caller reaches. Outside a sandbox the
 * setup key sets network staff up and does nothing else; the server says so here (`setupOnly`), and the console
 * shows that one screen instead of opening on a page of refusals. A server that predates a field is read as without it.
 */
export function staffListOf<Row>(data: unknown): { items: Row[]; waiting: StaffWaiting[]; setupOnly: boolean } {
  const d = (data ?? {}) as { items?: Row[]; waiting?: StaffWaiting[]; setupOnly?: unknown };
  return { items: Array.isArray(d.items) ? d.items : [], waiting: Array.isArray(d.waiting) ? d.waiting : [], setupOnly: d.setupOnly === true };
}

/** A staff account somebody asked for, waiting for a second person. */
export interface StaffWaiting {
  proposalId: string;
  email: string;
  name: string;
  askedBy: string;
  askedAt: string;
  /** When it stops waiting. */
  until: string;
  /** Asked for by whoever is looking: theirs to take back, never to approve. */
  mine: boolean;
  /** The one who asked is the only one able to sign in: there is no colleague to be their second, so the setup key is. */
  forSetupKey?: boolean;
  /** Round 38 — the roles asked for. */
  roles?: string[];
  /** Round 38 — `roles`: a change of an existing member of staff's roles, not a new account. */
  kind?: 'roles';
  /** Round 38 — for a change of roles: the roles they hold now. */
  rolesNow?: string[];
  /** Round 38 — for a change of roles: whose. */
  operatorId?: string;
  /** Round 38 — a change of the reader's own roles: theirs to read, never to approve or decline. */
  aboutYou?: boolean;
}

/**
 * HOW THIS SIGN-IN ADDS A PERSON.
 *  - `ask` — an account of their own: they ask, and a second person approves.
 *  - `key` — the setup key: it makes the account at once. Outside a sandbox the server lets it only while nobody can
 *            sign in, and says so otherwise.
 */
export type StaffAddWay = 'ask' | 'key';

export function staffAddWay(named: boolean): StaffAddWay {
  return named ? 'ask' : 'key';
}

/**
 * What whoever is looking may do with an account that waits. A member of staff decides a colleague's and takes back
 * their own. The setup key is the second person only where there is no colleague to be it — and it only says yes:
 * saying no is the asker's own to do, by taking it back.
 */
export function waitingActions(p: Pick<StaffWaiting, 'mine' | 'forSetupKey' | 'aboutYou'>, named: boolean): Array<'approve' | 'decline' | 'takeBack'> {
  if (!named) return p.forSetupKey ? ['approve'] : [];
  if (p.mine) return ['takeBack'];
  // Round 38 — a change of your own roles is decided by others: you may neither wave it through nor stop it.
  return p.aboutYou ? [] : ['approve', 'decline'];
}

/** Round 38 — what a waiting request asks for, in roles: a new account's, or a change from the roles held now. */
export function waitingRoles(p: Pick<StaffWaiting, 'kind' | 'roles' | 'rolesNow'>, t: Translate): string | null {
  if (!p.roles?.length) return null;
  const words = (roles: readonly string[]) => rolesWords(rolesOf(roles), t);
  return p.kind === 'roles' ? t('tower.roles.waitingChange', { from: words(p.rolesNow ?? []), to: words(p.roles) }) : t('tower.roles.waitingNew', { roles: words(p.roles) });
}

/**
 * Does the panel arrive OPEN: is an account waiting that this reader can approve? Their own request is not work for
 * them, and the setup key has none unless it is somebody's only possible second.
 */
export function opensItself(waiting: Array<Pick<StaffWaiting, 'mine' | 'forSetupKey'>>, named: boolean): boolean {
  return waiting.some((p) => waitingActions(p, named).includes('approve'));
}

/** Who asked, when, and what the reader is to do about it. */
export function waitingLine(p: StaffWaiting, named: boolean, t: Translate, day: (iso: string) => string): string {
  const said = { who: p.askedBy, when: day(p.askedAt), until: day(p.until) };
  if (!named) return t(p.forSetupKey ? 'tower.staff.waiting.keyApproves' : 'tower.staff.waiting.key', said);
  if (p.mine) return t(p.forSetupKey ? 'tower.staff.waiting.mineKey' : 'tower.staff.waiting.mine', said);
  // Round 38 — a change of roles: about the person reading it, or a question of whether they should hold them.
  if (p.kind === 'roles') return t(p.aboutYou ? 'tower.roles.waitingAboutYou' : 'tower.roles.waitingTheirs', said);
  return t('tower.staff.waiting.theirs', said);
}

/** The folded panel's one line: how many are on staff, and — only when there are some — how many were asked for. */
export function staffFoldHint(staff: number, waiting: number, t: Translate): string {
  return waiting ? t('tower.network.fold.staffWaiting', { n: staff, w: waiting }) : t('tower.network.fold.staff', { n: staff });
}

/** Somebody who has not chosen a password yet: whether the link in their email still works. */
export function linkWords(until: string, now: number, t: Translate, when: (iso: string) => string): string {
  return Date.parse(until) > now ? t('tower.staff.linkUntil', { when: when(until) }) : t('tower.staff.linkLapsed');
}

/* ------------------------------------------------ the link a new member of staff is emailed -- */

/**
 * The token off the link, when the console was opened by one: `…/#welcome=<token>`. After the `#`, so that it is
 * never sent to a server as part of an address — not in a request line, a log or a referrer.
 */
export function welcomeTokenFrom(hash: string | undefined): string | null {
  const m = /^#welcome=([\w-]{16,200})$/.exec((hash ?? '').trim());
  return m ? m[1] : null;
}

/** What is wrong with a password typed twice, said before the server is asked. The server judges the rest. */
export function passwordBlocker(password: string, again: string): MessageKey | null {
  if (password.length < 10) return 'tower.welcome.needTen';
  if (password !== again) return 'tower.welcome.noMatch';
  return null;
}
