import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, SCREEN_META, activeGroupKey, firstScreen, groupBadge, groupOf, groupsFor, opensSheet } from './nav';
import type { Screen } from './useTowerApp';

const ALL: Screen[] = ['network', 'market', 'movers', 'hazards', 'claims', 'disposal', 'approvals', 'papers', 'imports', 'reports', 'support', 'money', 'companies', 'company', 'rates', 'corridors', 'borders', 'presence', 'pictures'];

/**
 * The console's navigation.
 *
 * Four failures these tests exist to prevent, and every one of them is a thing a menu can say without
 * anybody noticing: a screen with no home, a group that promises somewhere to go and goes nowhere, a
 * count that means "we have three companies" while looking like "three things need you", and a badge of
 * zero standing in for a question nobody has asked yet.
 */
describe('every screen has exactly one home', () => {
  it('places all ten', () => {
    for (const screen of ALL) expect(groupOf(screen)).not.toBeNull();
  });

  it('never places one in two groups', () => {
    // A screen in two groups is a screen somebody can be looking at while the menu says they are
    // somewhere else.
    const seen = NAV_GROUPS.flatMap((g) => g.screens);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual([...ALL].sort());
  });

  it('reads in the order of what matters: wrong, waiting, owed, configured', () => {
    expect(NAV_GROUPS.map((g) => g.key)).toEqual(['overview', 'waiting', 'money', 'setup']);
  });
});

describe('what a caller is offered', () => {
  it('gives network staff all four groups', () => {
    expect(groupsFor(ALL).map((g) => g.key)).toEqual(['overview', 'waiting', 'money', 'setup']);
  });

  it('drops a group whose every screen is out of reach', () => {
    // A company administrator reaches neither the queues nor the overview. An empty group would be a
    // promise of somewhere to go that goes nowhere.
    const groups = groupsFor(['money', 'rates', 'companies']);
    expect(groups.map((g) => g.key)).toEqual(['money', 'setup']);
    expect(groups.find((g) => g.key === 'setup')?.screens).toEqual(['companies', 'rates']);
  });

  it('keeps a group that has one reachable screen left', () => {
    expect(groupsFor(['rates']).map((g) => g.key)).toEqual(['setup']);
  });

  it('offers nothing at all rather than empty groups', () => {
    expect(groupsFor([])).toEqual([]);
  });
});

describe('the badge', () => {
  const waiting = NAV_GROUPS.find((g) => g.key === 'waiting')!;
  const setup = NAV_GROUPS.find((g) => g.key === 'setup')!;

  it('adds up only the things genuinely waiting on a person', () => {
    expect(groupBadge(waiting, { hazards: 3, claims: 1, disposal: 0, approvals: 2 })).toBe(6);
  });

  it('never puts a number on a group that is not work', () => {
    // "3" beside the companies would mean "we have three companies" — a fact wearing the clothes of a
    // demand.
    expect(groupBadge(setup, { companies: 3, rates: 9, pictures: 24 })).toBeNull();
    expect(groupBadge(NAV_GROUPS[0], { network: 5 })).toBeNull();
  });

  it('says NOTHING rather than zero before anything has been read', () => {
    // A badge of 0 claims "you are up to date". Nothing read yet is a different claim, and this is the
    // one count that must never confuse them.
    expect(groupBadge(waiting, {})).toBeNull();
    expect(groupBadge(waiting, { hazards: null, claims: null })).toBeNull();
    expect(groupBadge(waiting, { hazards: 0, claims: 0, disposal: 0, approvals: 0 })).toBe(0);
  });

  it('counts the queues it HAS read rather than waiting for all of them', () => {
    expect(groupBadge(waiting, { hazards: 2, claims: null })).toBe(2);
  });
});

describe('tapping a group', () => {
  it('opens a sheet only where there is a choice to make', () => {
    // A sheet listing one destination is a tap that asks a question with one answer.
    expect(opensSheet(NAV_GROUPS.find((g) => g.key === 'waiting')!)).toBe(true);
    expect(opensSheet(NAV_GROUPS.find((g) => g.key === 'money')!)).toBe(false);
    // Overview held one screen until the market view joined it; two destinations is a real choice, so the
    // sheet is now the right answer there rather than a tap that asks a question with one answer.
    expect(opensSheet(NAV_GROUPS.find((g) => g.key === 'overview')!)).toBe(true);
  });

  it('goes straight to the only screen when a group has been narrowed to one', () => {
    const [setup] = groupsFor(['rates']);
    expect(opensSheet(setup)).toBe(false);
    expect(firstScreen(setup)).toBe('rates');
  });
});

describe('every screen can be drawn', () => {
  it('names and pictures all ten', () => {
    // A screen reachable from a menu that has no label is a blank row somebody has to click to identify.
    for (const screen of ALL) {
      expect(SCREEN_META[screen].labelKey).toBeTruthy();
      expect(SCREEN_META[screen].icon).toBeTruthy();
    }
  });

  it('gives no two screens the same label', () => {
    const labels = ALL.map((s) => SCREEN_META[s].labelKey);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('which group the console is in', () => {
  it('answers with the group holding the open screen', () => {
    const groups = groupsFor(ALL);
    expect(activeGroupKey(groups, 'disposal')).toBe('waiting');
    expect(activeGroupKey(groups, 'rates')).toBe('setup');
  });

  it('falls back to the first group on offer when the open screen is not one of them', () => {
    // A company administrator restored into an operator's last screen. Marking NOTHING would tell them
    // they are nowhere; the first group is at least somewhere they can be.
    expect(activeGroupKey(groupsFor(['money', 'rates']), 'hazards')).toBe('money');
  });

  it('answers null only when there is nothing to offer', () => {
    expect(activeGroupKey([], 'money')).toBeNull();
  });
});
