import type { MessageKey } from '../../shared/i18n';
import type { IconName } from '../../shared/ui/Icon';
import type { Screen } from './useTowerApp';

/**
 * How the console is navigated — four groups, on a phone and on a desk.
 *
 * It began as ten flat sections in a rail, which is one too many for a sidebar and far too many for the
 * horizontal strip that rail became on a narrow screen. Ten things side by side is not a menu, it is a
 * search problem.
 *
 * THE GROUPS ANSWER FOUR DIFFERENT QUESTIONS, which is what makes them groups rather than shelves:
 *
 *   OVERVIEW       is anything wrong?
 *   WAITING ON YOU what will not move until a person acts? — and it is the only one that carries a count
 *   MONEY          what do we hold, owe, and pay?
 *   SETUP          what do we charge, and how do we present ourselves?
 *
 * "Activity" was the obvious name for the second and it is the wrong one: an activity feed is a record of
 * what happened, and every screen in that group is a thing that has NOT happened yet.
 */

export interface NavGroup {
  key: 'overview' | 'waiting' | 'money' | 'setup';
  labelKey: MessageKey;
  icon: IconName;
  screens: Screen[];
}

/**
 * Every group, in the order they are read. The order is a claim about priority: what is wrong, what is
 * waiting, what is owed, and only then what is configured.
 */
export const NAV_GROUPS: NavGroup[] = [
  // Y4's yard register sits here rather than under setup: a yard's own list is read every morning, and an
  // operator reading it is asking the market question — which yards exist and what do they say they hold.
  { key: 'overview', labelKey: 'tower.group.overview', icon: 'home', screens: ['network', 'market', 'movers', 'depots'] },
  {
    key: 'waiting',
    labelKey: 'tower.group.waiting',
    icon: 'clock',
    // `support` belongs here rather than in a group of its own: somebody looking a parcel up is doing it
    // because a person is waiting on the other end of a phone.
    screens: ['hazards', 'claims', 'disposal', 'approvals', 'businesses', 'papers', 'imports', 'reports', 'support'],
  },
  { key: 'money', labelKey: 'tower.group.money', icon: 'wallet', screens: ['money'] },
  { key: 'setup', labelKey: 'tower.group.setup', icon: 'edit', screens: ['settings', 'companies', 'company', 'rates', 'corridors', 'borders', 'presence', 'pictures', 'connections'] },
];

/**
 * What each screen is CALLED and what it is drawn as, in one place.
 *
 * It used to be spelled out inline where the rail was built, which was survivable while there was one
 * rail and became a duplication the moment the same ten screens had to be listed again in a sheet. A
 * screen named twice is a screen that will eventually be named two different things.
 */
export const SCREEN_META: Record<Screen, { labelKey: MessageKey; icon: IconName }> = {
  network: { labelKey: 'tower.nav.network', icon: 'home' },
  hazards: { labelKey: 'tower.nav.hazards', icon: 'route' },
  claims: { labelKey: 'tower.nav.claims', icon: 'warning' },
  disposal: { labelKey: 'tower.nav.disposal', icon: 'box' },
  approvals: { labelKey: 'tower.nav.approvals', icon: 'badge' },
  businesses: { labelKey: 'tower.nav.businesses', icon: 'grid' },
  papers: { labelKey: 'tower.nav.papers', icon: 'truck' },
  imports: { labelKey: 'tower.nav.imports', icon: 'box' },
  market: { labelKey: 'tower.nav.market', icon: 'scale' },
  movers: { labelKey: 'tower.nav.movers', icon: 'truck' },
  reports: { labelKey: 'tower.nav.reports', icon: 'send' },
  support: { labelKey: 'tower.nav.support', icon: 'search' },
  money: { labelKey: 'tower.nav.money', icon: 'wallet' },
  companies: { labelKey: 'tower.nav.companies', icon: 'grid' },
  company: { labelKey: 'tower.nav.company', icon: 'badge' },
  settings: { labelKey: 'tower.nav.settings', icon: 'edit' },
  rates: { labelKey: 'tower.nav.rates', icon: 'edit' },
  corridors: { labelKey: 'tower.nav.corridors', icon: 'route' },
  borders: { labelKey: 'tower.nav.borders', icon: 'pin' },
  presence: { labelKey: 'tower.nav.presence', icon: 'pin' },
  depots: { labelKey: 'tower.nav.depots', icon: 'box' },
  pictures: { labelKey: 'tower.nav.pictures', icon: 'camera' },
  connections: { labelKey: 'tower.nav.connections', icon: 'repeat' },
};

/** Which group a screen lives in. Every screen has exactly one home. */
export function groupOf(screen: Screen): NavGroup['key'] | null {
  return NAV_GROUPS.find((g) => g.screens.includes(screen))?.key ?? null;
}

/**
 * The groups this caller can actually see, holding only the screens they can reach.
 *
 * Built from what is AVAILABLE rather than trimmed afterwards, and a group whose every screen is out of
 * reach disappears entirely — an empty group is a promise of somewhere to go that goes nowhere. A
 * company administrator, who reaches neither the queues nor the overview, is left with two groups.
 */
export function groupsFor(available: Screen[]): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, screens: g.screens.filter((s) => available.includes(s)) })).filter((g) => g.screens.length > 0);
}

/**
 * THE ONLY GROUP THAT CARRIES A NUMBER is the one whose screens are work.
 *
 * A count on a group icon reads as "this many things need you". The companies group would happily show a
 * 3, and the 3 would mean "we have three companies" — a fact, dressed as a demand. So the badge is the
 * sum of the queues that are genuinely waiting on a person, and every other group carries none.
 *
 * Returns null while nothing has been read: a badge of 0 says "you are up to date", which is a different
 * claim from "we have not looked yet" and is the one thing a queue count must never get wrong.
 */
export function groupBadge(group: NavGroup, counts: Partial<Record<Screen, number | null>>): number | null {
  if (group.key !== 'waiting') return null;
  const known = group.screens.map((s) => counts[s]).filter((n): n is number => typeof n === 'number');
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

/**
 * Does tapping this group open the sheet, or go straight there?
 *
 * A sheet listing one destination is a tap that asks a question with one answer. Groups holding a single
 * screen navigate directly — which is most of why Overview and Money feel instant on a phone.
 */
export function opensSheet(group: NavGroup): boolean {
  return group.screens.length > 1;
}

/** Where tapping a group lands when it does not open a sheet. */
export function firstScreen(group: NavGroup): Screen {
  return group.screens[0];
}

/**
 * Which group the console is currently IN.
 *
 * The bottom bar marks a group rather than a screen, so it has to answer this for whatever screen is
 * open — including one that is no longer offered (a company administrator restored into an operator's
 * last screen). It falls back to the first group on offer rather than to none: a navigation with
 * nothing marked tells somebody they are nowhere.
 */
export function activeGroupKey(groups: NavGroup[], screen: Screen): NavGroup['key'] | null {
  return groups.find((g) => g.screens.includes(screen))?.key ?? groups[0]?.key ?? null;
}
