import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { offered, STAFF_ROLES } from './staffRoles';

/*
 * 2026-11-03 — A PROOFREADER'S ACCOUNT (the owner: "we have credits for the proofreader accounts"): the Languages screen for
 * their country, and nothing else of the console; and where they land, it is theirs.
 */
describe('a proofreader in the console', () => {
  it('is offered Languages and their own settings, nothing of the work', () => {
    expect(STAFF_ROLES).toContain('languages');
    expect(offered('languages', ['languages'])).toBe(true);
    expect(offered('settings', ['languages'])).toBe(true);
    for (const screen of ['network', 'pilot', 'cases', 'documents', 'rates', 'imports', 'market', 'depots'] as const) expect({ screen, offered: offered(screen, ['languages']) }).toEqual({ screen, offered: false });
    // The working roles are offered what they were; the review is the proofreader's role.
    expect(offered('network', ['support'])).toBe(true);
    expect(offered('languages', ['admin'])).toBe(false);
  });

  it('lands on what is theirs', () => {
    expect(readFileSync('src/apps/tower/app.tsx', 'utf8')).toMatch(/const landOn = staffRoles && !offered\(state\.screen, staffRoles\) && state\.screen !== 'settings' \? available\[0\] : undefined;/);
  });
});
