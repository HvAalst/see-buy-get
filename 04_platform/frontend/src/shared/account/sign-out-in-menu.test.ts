import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * SIGNING OUT LIVES WITH THE ACCOUNT (the owner, 2026-11-02, of the Hub's start screen: "I get the 'Sign out of this hub'
 * but that could live in the settings only"). The account menu holds it for every app (and a colleague at the counter
 * has it on their own chip); a start screen is the work, not a door out of it.
 */
describe('signing out', () => {
  it('is offered by the account menu, and by no app’s start screen', () => {
    expect(readFileSync('src/shared/account/AccountMenu.tsx', 'utf8')).toMatch(/onSignOut\(\); \}\}>\s*\{t\('account\.menu\.signOut'\)\}/);
    const homes = readdirSync(join('src', 'apps'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join('src', 'apps', e.name, 'screens', 'HomeScreen.tsx'))
      .filter((f) => {
        try {
          readFileSync(f);
          return true;
        } catch {
          return false;
        }
      });
    // Proof the start screens were read: the hub's is among them.
    expect(homes.some((f) => f.includes(join('mdp', 'screens')))).toBe(true);
    for (const f of homes) expect({ f, signsOut: /onClick=\{actions\.signOut\}/.test(readFileSync(f, 'utf8')) }).toEqual({ f, signsOut: false });
  });
});
