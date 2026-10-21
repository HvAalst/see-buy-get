import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { SCREEN_META } from './nav';
import { waitingActions, waitingLine, waitingRoles } from './staff';
import { holds, offered, rolesOf, rolesWords, SCREEN_ROLES, STAFF_ROLES } from './staffRoles';
import type { Screen } from './useTowerApp';

const SCREENS = Object.keys(SCREEN_META) as Screen[];

describe('a member of staff is offered the screens of their roles (round 38)', () => {
  it('names a role for every screen but the few that are everybody’s', () => {
    // A new screen must be given its role here, or it is offered to every role — this says which ones are on purpose.
    expect(SCREENS.filter((s) => !SCREEN_ROLES[s]).sort()).toEqual(['depots', 'market', 'network', 'settings']);
    for (const s of Object.keys(SCREEN_ROLES)) expect(SCREENS).toContain(s);
  });

  it('offers support only support’s screens and everybody’s', () => {
    const mine = SCREENS.filter((s) => offered(s, ['support']));
    expect(mine).toEqual(expect.arrayContaining(['network', 'cases', 'hazards', 'claims', 'disposal', 'stores', 'imports', 'support']));
    for (const s of ['money', 'rates', 'approvals', 'papers', 'presence', 'company', 'companies'] as Screen[]) expect(mine).not.toContain(s);
  });

  it('opens a company’s record to administration and to vetting, its money to money alone', () => {
    expect(offered('company', ['admin'])).toBe(true);
    expect(offered('company', ['vetting'])).toBe(true);
    expect(offered('company', ['support', 'money'])).toBe(false);
    expect(offered('money', ['money'])).toBe(true);
    expect(offered('money', ['admin', 'vetting', 'support'])).toBe(false);
  });

  it('holds nobody to roles who has none to hold: the setup key, a company', () => {
    for (const s of SCREENS) expect(offered(s, undefined)).toBe(true);
    for (const r of STAFF_ROLES) expect(holds(undefined, r)).toBe(true);
    // An empty list is a member of staff holding nothing — offered nothing, as the server refuses them everything.
    expect(SCREENS.filter((s) => offered(s, []))).toEqual([]);
    expect(holds([], 'support')).toBe(false);
  });

  it('reads roles from the server as known ones, once each, in order', () => {
    expect(rolesOf(['money', 'boss', 'support', 'money'])).toEqual(['support', 'money']);
    expect(rolesOf(undefined)).toEqual([]);
    expect(rolesWords(['support', 'admin'], t)).toBe('Support, Administration');
    expect(rolesWords([], t)).toBe('no role');
  });
});

describe('a change of roles takes two, and never the person it is about', () => {
  it('offers the person whose roles change neither approval nor decline', () => {
    expect(waitingActions({ mine: false, aboutYou: true }, true)).toEqual([]);
    expect(waitingActions({ mine: true, aboutYou: true }, true)).toEqual(['takeBack']);
    expect(waitingActions({ mine: false, aboutYou: false }, true)).toEqual(['approve', 'decline']);
  });

  it('says what a request asks for: a new account’s roles, or the change from what is held now', () => {
    expect(waitingRoles({ roles: ['vetting'] }, t)).toBe('To hold: Vetting');
    expect(waitingRoles({ kind: 'roles', roles: ['support', 'money'], rolesNow: ['support'] }, t)).toBe('Change of roles: from Support to Support, Money');
    expect(waitingRoles({}, t)).toBeNull();
  });

  it('asks the second whether this person should hold the roles — not whether they know who it is', () => {
    const day = (iso: string) => iso.slice(0, 10);
    const change = { proposalId: 'spr_2', email: 'sam@sbg.test', name: 'Sam', askedBy: 'Amina Otieno', askedAt: '2026-10-21T09:00:00Z', until: '2026-10-28T09:00:00Z', mine: false, kind: 'roles' as const, roles: ['support', 'money'], rolesNow: ['support'] };
    expect(waitingLine(change, true, t, day)).toBe('Amina Otieno asked on 2026-10-21. Approve it only if this person should hold these roles. It waits until 2026-10-28.');
    expect(waitingLine({ ...change, aboutYou: true }, true, t, day)).toBe('Amina Otieno asked on 2026-10-21 to change your own roles, so somebody else decides it. It waits until 2026-10-28.');
    expect(waitingLine({ ...change, mine: true }, true, t, day)).toContain('You asked on 2026-10-21');
  });
});
