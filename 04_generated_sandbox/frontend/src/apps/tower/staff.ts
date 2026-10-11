import type { Translate } from '../../shared/i18n';

/**
 * WHO IS ON STAFF, AND HOW SOMEBODY IS ADDED — as the console says it.
 *
 * A new staff sign-in takes two members of staff: one asks, a different one approves and is shown the first password.
 * One sign-in used to be able to make another alone, which let whoever held it become a second person and approve
 * their own decisions. The server decides all of it; this only chooses what to offer, so that nobody is shown a
 * button that will be refused.
 */

/** A staff account somebody asked for, waiting for a second member of staff. */
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
}

/**
 * HOW THIS SIGN-IN ADDS A PERSON.
 *  - `ask`   — an account of their own, and a colleague who could approve: they ask.
 *  - `alone` — an account of their own and nobody else can sign in: nobody could approve, so no form is offered.
 *  - `key`   — the setup key: it makes the account at once. Outside a sandbox the server lets it make the first two.
 */
export type StaffAddWay = 'ask' | 'alone' | 'key';

export function staffAddWay(named: boolean, staff: number): StaffAddWay {
  if (!named) return 'key';
  return staff >= 2 ? 'ask' : 'alone';
}

/** What whoever is looking may do with an account that waits. The setup key is nobody in particular: it decides nothing. */
export function waitingActions(p: Pick<StaffWaiting, 'mine'>, named: boolean): Array<'approve' | 'decline' | 'takeBack'> {
  if (!named) return [];
  return p.mine ? ['takeBack'] : ['approve', 'decline'];
}

/**
 * Does the panel arrive OPEN: is an account waiting that this reader can decide? Their own request is not work for
 * them, and the setup key decides nothing — so neither opens it.
 */
export function opensItself(waiting: Array<Pick<StaffWaiting, 'mine'>>, named: boolean): boolean {
  return waiting.some((p) => waitingActions(p, named).includes('approve'));
}

/** Who asked, when, and what the reader is to do about it. */
export function waitingLine(p: StaffWaiting, named: boolean, t: Translate, day: (iso: string) => string): string {
  const said = { who: p.askedBy, when: day(p.askedAt), until: day(p.until) };
  if (!named) return t('tower.staff.waiting.key', said);
  return t(p.mine ? 'tower.staff.waiting.mine' : 'tower.staff.waiting.theirs', said);
}

/** The folded panel's one line: how many can sign in, and — only when there are some — how many were asked for. */
export function staffFoldHint(staff: number, waiting: number, t: Translate): string {
  return waiting ? t('tower.network.fold.staffWaiting', { n: staff, w: waiting }) : t('tower.network.fold.staff', { n: staff });
}
