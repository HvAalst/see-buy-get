import { describe, expect, it } from 'vitest';
import { PULL_MARK, mayPull, pulled } from './PullToRefresh';

/*
 * PULL DOWN TO REFRESH (the owner, 2026-11-02: "make it as native as today can be").
 */
describe('pull down to refresh', () => {
  it('resists the finger, as a native list does, and arms past the mark', () => {
    expect(pulled(-20)).toBe(0);
    expect(pulled(40)).toBe(20);
    expect(pulled(PULL_MARK * 2)).toBeGreaterThanOrEqual(PULL_MARK);
    // A long drag does not pull the circle off the screen.
    expect(pulled(2000)).toBeLessThanOrEqual(110);
    expect(pulled(PULL_MARK)).toBeLessThan(PULL_MARK);
  });

  it('starts only at the very top, with one finger, never over a sheet, a map or a box scrolled on its own, nor while refreshing', () => {
    const top = { scrollY: 0, touches: 1, overSheet: false, inOwnScroller: false, busy: false };
    expect(mayPull(top)).toBe(true);
    expect(mayPull({ ...top, scrollY: 120 })).toBe(false);
    expect(mayPull({ ...top, touches: 2 })).toBe(false);
    expect(mayPull({ ...top, overSheet: true })).toBe(false);
    expect(mayPull({ ...top, inOwnScroller: true })).toBe(false);
    expect(mayPull({ ...top, busy: true })).toBe(false);
  });
});

describe('pull down to refresh, in every app once signed in', () => {
  it('passes each app’s own refresh to the layer of its signed-in screens — never the sign-in screen', async () => {
    const { readFileSync } = await import('node:fs');
    const layer = readFileSync('src/shared/ui/AppLayer.tsx', 'utf8');
    expect(layer).toMatch(/<PullToRefresh onRefresh=\{onRefresh\} \/>/);
    const want: Record<string, RegExp> = {
      agent: /<AppLayer app="agent" chats=\{actions\.chatApi\} onRefresh=\{actions\.refresh\} \/>/,
      mdp: /<AppLayer app="mdp" onRefresh=\{actions\.refresh\} \/>/,
      driver: /<AppLayer app="driver" chats=\{actions\.chatApi\} onRefresh=\{actions\.refresh\} \/>/,
      fleet: /<AppLayer app="fleet" chats=\{actions\.chatApi\} onRefresh=\{actions\.refresh\} \/>/,
      vendor: /<AppLayer app="vendor" chats=\{actions\.chatApi\} onRefresh=\{actions\.refresh\} \/>/,
      genesis: /onRefresh=\{state\.identity \? actions\.loadParcels : undefined\}/,
    };
    for (const [app, line] of Object.entries(want)) {
      const src = readFileSync(`src/apps/${app}/app.tsx`, 'utf8');
      expect({ app, wired: line.test(src) }).toEqual({ app, wired: true });
      // The sign-in screen's layer pulls nothing: there is nothing of theirs to fetch yet.
      expect({ app, onSignIn: (src.match(/onRefresh=/g) ?? []).length }).toEqual({ app, onSignIn: 1 });
    }
  });
});
