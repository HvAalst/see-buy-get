import type { MessageKey } from '../../shared/i18n';
import { HELP_GROUPS, type GuideApp, type GuideArticle, type HelpGroup } from '../../shared/guide/articles';

/**
 * THE HELP CENTRE'S LOGIC — /help/, /help/<article>/ and /help/contact/ on the front door (the user, 2026-10-22: help in
 * the front door app). Pure, so it is the same in the build that writes the pages and in the browser that takes them over.
 */

/** Which help page an address is: the index, one article, or writing to us. Null for any other address. */
export type HelpPage = { kind: 'index' } | { kind: 'article'; id: string } | { kind: 'contact' };

export function helpPageOf(path: string): HelpPage | null {
  if (/^\/help\/?$/.test(path)) return { kind: 'index' };
  if (/^\/help\/contact\/?$/.test(path)) return { kind: 'contact' };
  const id = /^\/help\/([a-z0-9-]+)\/?$/.exec(path)?.[1];
  return id ? { kind: 'article', id } : null;
}

/** An article's address. With the trailing slash: a static host serves it from /help/<id>/index.html, at that address. */
export const articlePath = (id: string) => `/help/${id}/`;
export const HELP_PATH = '/help/';
export const CONTACT_PATH = '/help/contact/';

/** Who a reader is, in their words — and the apps whose help is theirs. */
export type HelpRole = 'send' | 'shop' | 'hub' | 'driver' | 'fleet' | 'store' | 'business';
export const HELP_ROLES: ReadonlyArray<{ role: HelpRole; label: MessageKey; apps: GuideApp[] }> = [
  { role: 'send', label: 'help.ui.role.send', apps: ['send', 'home'] },
  { role: 'shop', label: 'help.ui.role.shop', apps: ['agent'] },
  { role: 'driver', label: 'help.ui.role.driver', apps: ['driver'] },
  { role: 'hub', label: 'help.ui.role.hub', apps: ['mdp'] },
  { role: 'store', label: 'help.ui.role.store', apps: ['vendor'] },
  { role: 'fleet', label: 'help.ui.role.fleet', apps: ['fleet'] },
  { role: 'business', label: 'help.ui.role.business', apps: ['business'] },
];

/** `?for=shop` → 'shop'; anything else → null (everyone). */
export function roleOf(search: string): HelpRole | null {
  const v = new URLSearchParams(search).get('for');
  return HELP_ROLES.some((r) => r.role === v) ? (v as HelpRole) : null;
}

export function forRole(list: GuideArticle[], role: HelpRole | null): GuideArticle[] {
  if (!role) return list;
  const apps = HELP_ROLES.find((r) => r.role === role)!.apps;
  return list.filter((a) => a.apps.some((app) => apps.includes(app)));
}

/** What people ask most, first on the index: in the order they ask it. Only ids that exist are shown. */
export const MOST_ASKED = ['send-sign-in', 'follow-shop-order', 'parcel-problem', 'account-recovery', 'which-sign-in', 'driver-sign-in'];

/** One spelling for comparing: lower case, without accents, curly quotes as straight ones. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

/**
 * SEARCH, in the reader's own language: every word typed must be in the article — its title, summary, steps or notes.
 * Those whose title has them come first; otherwise the order is the help's own. An empty search finds nothing (the
 * index shows its lists instead).
 */
export function searchArticles(list: GuideArticle[], query: string): GuideArticle[] {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const scored = list
    .map((a, i) => {
      const title = fold(a.title);
      const all = fold([a.title, a.summary, ...(a.steps ?? []), ...(a.notes ?? [])].join(' '));
      if (!words.every((w) => all.includes(w))) return null;
      return { a, i, inTitle: words.filter((w) => title.includes(w)).length };
    })
    .filter((x): x is { a: GuideArticle; i: number; inTitle: number } => x !== null);
  return scored.sort((x, y) => y.inTitle - x.inTitle || x.i - y.i).map((x) => x.a);
}

/** Up to `n` articles shown in the same apps as this one, nearest in the help's order first. */
export function relatedOf(article: GuideArticle, list: GuideArticle[], n = 4): GuideArticle[] {
  const at = list.findIndex((a) => a.id === article.id);
  return list
    .map((a, i) => ({ a, d: Math.abs(i - at) }))
    .filter(({ a }) => a.id !== article.id && a.apps.some((app) => app !== 'console' && article.apps.includes(app)))
    .sort((x, y) => x.d - y.d)
    .slice(0, n)
    .map((x) => x.a);
}

/**
 * A reader's articles under their task headings, in the help's order of headings and by title within each (the review,
 * 2026-10-22: "split by audience, then by task"). A heading with nothing under it is left out.
 */
export function byGroup(list: GuideArticle[], locale: string): Array<[HelpGroup, GuideArticle[]]> {
  return HELP_GROUPS.map((g) => [g, alphabetical(list.filter((a) => (a.group ?? 'daily') === g), locale)] as [HelpGroup, GuideArticle[]]).filter(([, l]) => l.length > 0);
}

/** Whose help an article is first: the reader of the first app it is shown in. A side list needs one. */
export function roleOfArticle(a: GuideArticle): HelpRole {
  for (const app of a.apps) {
    const r = HELP_ROLES.find((x) => x.apps.includes(app));
    if (r) return r.role;
  }
  return 'send';
}

/** Every article, by title in the reader's language — the index's full list, which also lets a crawler find each page. */
export function alphabetical(list: GuideArticle[], locale: string): GuideArticle[] {
  return [...list].sort((a, b) => a.title.localeCompare(b.title, locale));
}
