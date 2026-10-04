import type { BusinessActivity, BusinessView, CheckState, Membership, MemberRole, NewBusiness } from './api';

/** Where somebody is in the Business app. */
export type Section = 'home' | 'loads' | 'runs' | 'clients' | 'imports' | 'yard' | 'people' | 'details';

/**
 * WHICH SECTIONS A BUSINESS IS SHOWN — from what it says it does, never from what it is allowed.
 *
 * The server decides access; this decides attention. An importer who never clears and never runs a yard should not
 * have to look past a yard register to find their containers, and a section whose every answer is "nothing here"
 * teaches somebody that the app is empty. Imports for anybody whose goods or clients come through a border: the
 * importer, the clearing agent, and the expeditor who handles both for clients.
 */
export function sectionsFor(activities: BusinessActivity[]): Section[] {
  const has = (a: BusinessActivity) => activities.includes(a);
  return [
    'home',
    // B2 — whoever sends goods, or arranges sending them for clients: post a load, or take space on a carrier's run.
    ...(has('shipper') || has('expeditor') ? (['loads', 'runs'] as Section[]) : []),
    // B4 — an expeditor's own book of the clients it sends for, as their agent.
    ...(has('expeditor') ? (['clients'] as Section[]) : []),
    ...(has('importer') || has('clearing_agent') || has('expeditor') ? (['imports'] as Section[]) : []),
    ...(has('depot') ? (['yard'] as Section[]) : []),
    'people',
    'details',
  ];
}

/**
 * WHAT THE CHECK NEEDS FROM THEM NEXT, as one step. The overview leads with it until the business is verified.
 *
 * `papers` add the two papers · `ask` ask for the check · `waiting` staff have it · `refused` put right what they
 * said, then ask again · `done` verified.
 */
export type CheckStep = 'papers' | 'ask' | 'waiting' | 'refused' | 'done';

export function checkStep(check: BusinessView['check']): CheckStep {
  if (check.state === 'verified') return 'done';
  if (check.state === 'asked' || check.state === 'checking') return 'waiting';
  if (check.missing.length) return 'papers';
  return check.state === 'refused' ? 'refused' : 'ask';
}

/** Only an owner changes who is in the business and what it says about itself. Mirrors the server; never replaces it. */
export function mayManage(role: MemberRole | undefined): boolean {
  return role === 'owner';
}

/** A viewer reads. Everybody else works. */
export function mayAct(role: MemberRole | undefined): boolean {
  return Boolean(role) && role !== 'viewer';
}

/**
 * WHICH BUSINESS TO OPEN WITHOUT ASKING, after signing in — or none, and show the list.
 *
 * An invitation always shows the list: somebody has asked them to join something, and opening a different business
 * over the top of that question is how it goes unanswered. Otherwise the one they last used, if they are still in it;
 * otherwise the only one they have. Two or more and no memory: ask.
 */
export function openOnArrival(items: Membership[], last: string | null): string | null {
  if (items.some((m) => m.state === 'invited')) return null;
  const joined = items.filter((m) => m.state === 'joined');
  if (last && joined.some((m) => m.entityId === last)) return last;
  return joined.length === 1 ? joined[0].entityId : null;
}

/**
 * IS THIS THE ONLY OWNER WHO HAS JOINED? Then they can neither leave nor become something else — the server refuses
 * both, because a business always has an owner — so the screen does not offer either. An owner who is only invited is
 * nobody's owner yet.
 */
export function isLastOwner(rows: Array<{ memberId: string; role: MemberRole; state: 'invited' | 'joined' }>, memberId: string): boolean {
  const owners = rows.filter((m) => m.role === 'owner' && m.state === 'joined');
  return owners.length === 1 && owners[0].memberId === memberId;
}

/** The tag a check state wears in a list. */
export function checkTone(state: CheckState): 'ok' | 'warn' | 'info' | 'quiet' {
  if (state === 'verified') return 'ok';
  if (state === 'refused') return 'warn';
  if (state === 'asked' || state === 'checking') return 'info';
  return 'quiet';
}

/** What the setup form is still missing, as field names — the screen says each in words. */
export function newBusinessGaps(form: NewBusiness): Array<keyof NewBusiness> {
  const gaps: Array<keyof NewBusiness> = [];
  if (!form.name.trim()) gaps.push('name');
  if (!/^[A-Za-z]{2}$/.test(form.country.trim())) gaps.push('country');
  if (!form.registrationNo.trim()) gaps.push('registrationNo');
  if (!form.activities.length) gaps.push('activities');
  if (!form.yourName.trim()) gaps.push('yourName');
  return gaps;
}

/** What the load form still needs, as field names — the screen says each in words. */
export interface LoadForm {
  description: string;
  fromSiteId: string;
  toSiteId: string;
  weightKg: string;
}
export function loadGaps(form: LoadForm): Array<keyof LoadForm> {
  const gaps: Array<keyof LoadForm> = [];
  if (!form.description.trim()) gaps.push('description');
  if (!form.fromSiteId) gaps.push('fromSiteId');
  if (!form.toSiteId) gaps.push('toSiteId');
  const kg = Number(form.weightKg);
  if (!(Number.isFinite(kg) && kg >= 1)) gaps.push('weightKg');
  return gaps;
}

/**
 * WHERE A LOAD HAS GOT, as one word for its list. `posted` waiting for a carrier · `offers` carriers have named
 * prices · `taken` a carrier has it · `moving` picked up · `delivered` · `cancelled`.
 */
export type LoadStage = 'posted' | 'offers' | 'taken' | 'moving' | 'delivered' | 'cancelled';
export function loadStage(l: { status: string; openProposals: number; pickedUpAt?: string; deliveredAt?: string; cancelledAt?: string; carrier?: unknown }): LoadStage {
  if (l.cancelledAt || l.status === 'cancelled') return 'cancelled';
  if (l.deliveredAt || l.status === 'delivered') return 'delivered';
  if (l.pickedUpAt || l.status === 'in_transit') return 'moving';
  if (l.carrier || l.status === 'claimed') return 'taken';
  return l.openProposals > 0 ? 'offers' : 'posted';
}

/** At least nine digits, the server's own test of a plausible number. */
export function phoneReady(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 9;
}

export function digitsReady(value: string, length: number): boolean {
  return new RegExp(`^\\d{${length}}$`).test(value);
}

export const ACTIVITIES: BusinessActivity[] = ['shipper', 'importer', 'expeditor', 'clearing_agent', 'depot'];
export const ROLES: MemberRole[] = ['owner', 'booker', 'finance', 'viewer'];
