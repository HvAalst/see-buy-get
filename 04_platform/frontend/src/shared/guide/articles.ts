import { t as translate, type MessageKey, type Translate } from '../i18n';

/**
 * HELP — the articles every app shows behind its Help link, and the front door shows at /help/, one page each.
 *
 * Their WORDS are in the translation catalog (i18n/catalogs/en.help.ts: help.<id>.title, .summary, .step1…, .note1…), so
 * help is translated like every other word; what is here is each article's shape — its address, the apps that show it,
 * how many steps and notes it has. NOTHING HERE IS THE STAFF'S: their own articles, and the staff's lines of articles
 * partners read too, are in staff-articles.ts, which only the operator console imports.
 */

export type GuideApp = 'agent' | 'mdp' | 'fleet' | 'driver' | 'vendor' | 'send' | 'home' | 'console' | 'business';
/** The apps a reader outside SeeBuyGet's staff is in. */
export type PublicApp = Exclude<GuideApp, 'console'>;

/** The task heading an article sits under for its reader (the review, 2026-10-22: "split by audience, then by task"). */
export type HelpGroup = 'start' | 'daily' | 'freight' | 'wrong' | 'account';
export const HELP_GROUPS: readonly HelpGroup[] = ['start', 'daily', 'freight', 'wrong', 'account'];

/**
 * What a note is, and so how it is drawn: worth reading in full (`note`), a warning (`careful`, a red edge), the reason
 * behind it (`why`, folded away), or for few readers (`rare`, folded away).
 */
export type NoteKind = 'note' | 'careful' | 'why' | 'rare';

export interface GuideArticle {
  /** Stable: it is the address, /help/<id>/. */
  id: string;
  /** The apps that show it. */
  apps: GuideApp[];
  /** Its task heading. Every public article has one; the staff's own (staff-articles.ts) do not need one. */
  group?: HelpGroup;
  title: string;
  summary: string;
  steps?: string[];
  notes?: string[];
  /** What each note is, in order: as many as there are notes. */
  noteKinds?: NoteKind[];
}

/** An article's shape: its words are help.<id>.* in the catalog; `notes` says what each of its notes is, in order. */
interface ArticleSpec {
  id: string;
  apps: GuideApp[];
  group: HelpGroup;
  steps?: number;
  notes?: NoteKind[];
}

/** What readers call each app — the help's own names for them. */
export const GUIDE_APPS: Record<PublicApp, MessageKey> = {
  agent: 'help.app.agent',
  mdp: 'help.app.mdp',
  fleet: 'help.app.fleet',
  driver: 'help.app.driver',
  vendor: 'help.app.vendor',
  send: 'help.app.send',
  home: 'help.app.home',
  business: 'help.app.business',
};

export const ARTICLE_SPECS: ArticleSpec[] = [
  { id: 'which-sign-in', apps: ['home'], group: 'start', steps: 6 },
  { id: 'shop-sign-in', apps: ['agent', 'mdp'], group: 'start', steps: 7 },
  { id: 'people-at-work', apps: ['agent', 'mdp'], group: 'start', steps: 4, notes: ['careful'] },
  { id: 'risk-register', apps: ['agent', 'mdp', 'console'], group: 'daily', steps: 3, notes: ['note'] },
  { id: 'security-declaration', apps: ['agent', 'mdp', 'fleet', 'driver', 'console'], group: 'start', steps: 3, notes: ['note'] },
  { id: 'new-partner-limit', apps: ['agent', 'driver', 'console'], group: 'daily', steps: 4, notes: ['why'] },
  { id: 'shop-papers', apps: ['agent'], group: 'start', steps: 5, notes: ['note', 'note'] },
  { id: 'hub-papers', apps: ['mdp'], group: 'start', steps: 5, notes: ['note', 'note'] },
  { id: 'change-password', apps: ['agent', 'mdp'], group: 'account', steps: 2, notes: ['careful', 'careful'] },
  { id: 'fleet-sign-in', apps: ['fleet'], group: 'start', steps: 5, notes: ['careful', 'why'] },
  { id: 'fleet-code', apps: ['fleet', 'console'], group: 'start', steps: 3, notes: ['note'] },
  { id: 'fleet-roster', apps: ['fleet'], group: 'start', steps: 4, notes: ['note', 'note', 'why', 'note', 'note', 'note'] },
  { id: 'driver-sign-in', apps: ['driver'], group: 'start', steps: 4, notes: ['careful', 'careful', 'why', 'why', 'rare', 'rare'] },
  { id: 'driver-fleet', apps: ['driver'], group: 'start', steps: 3, notes: ['note', 'why', 'note', 'note', 'note', 'note'] },
  { id: 'change-pin', apps: ['fleet', 'driver', 'send'], group: 'account', steps: 3, notes: ['careful', 'note', 'careful', 'note', 'rare', 'careful', 'note'] },
  { id: 'mute-account', apps: ['agent', 'mdp', 'fleet', 'driver', 'vendor', 'send', 'business'], group: 'account', steps: 3, notes: ['note', 'note', 'why'] },
  { id: 'who-you-contract-with', apps: ['agent', 'mdp', 'fleet', 'driver', 'vendor', 'business'], group: 'account', steps: 4, notes: ['note', 'why', 'rare'] },
  { id: 'account-recovery', apps: ['fleet', 'driver', 'send'], group: 'account', steps: 5, notes: ['note', 'why', 'note', 'note', 'careful', 'rare', 'rare', 'rare', 'careful', 'rare', 'rare', 'rare', 'rare', 'rare', 'note', 'why', 'note', 'rare', 'why', 'note', 'careful', 'rare', 'note'] },
  { id: 'store-sign-in', apps: ['vendor'], group: 'start', steps: 10 },
  { id: 'store-secret', apps: ['vendor'], group: 'account', steps: 4, notes: ['note', 'note', 'careful'] },
  { id: 'api-keys', apps: ['vendor'], group: 'account', steps: 3, notes: ['note'] },
  { id: 'send-sign-in', apps: ['send', 'home'], group: 'start', steps: 5 },
  { id: 'follow-shop-order', apps: ['send', 'vendor'], group: 'start', steps: 3, notes: ['note', 'note', 'why'] },
  { id: 'business-sign-in', apps: ['business', 'home'], group: 'start', steps: 5 },
  { id: 'business-people', apps: ['business'], group: 'start', steps: 4 },
  { id: 'business-check', apps: ['business', 'console'], group: 'start', steps: 2, notes: ['note'] },
  { id: 'business-bell', apps: ['business'], group: 'daily', steps: 3, notes: ['note', 'rare', 'note'] },
  { id: 'business-loads', apps: ['business'], group: 'freight', steps: 4, notes: ['why', 'note', 'note'] },
  { id: 'business-note', apps: ['business'], group: 'freight', steps: 4, notes: ['note', 'note', 'note', 'note', 'why', 'rare', 'rare'] },
  { id: 'business-runs', apps: ['business'], group: 'freight', steps: 4 },
  { id: 'business-contracts', apps: ['business'], group: 'freight', steps: 3, notes: ['why', 'note', 'rare', 'note', 'note', 'why', 'note', 'note', 'rare'] },
  { id: 'business-clients', apps: ['business'], group: 'freight', steps: 4, notes: ['note'] },
  { id: 'quotations', apps: ['business', 'console'], group: 'freight', steps: 4, notes: ['why'] },
  { id: 'shop-shelves', apps: ['agent'], group: 'start', steps: 5, notes: ['note', 'note', 'why', 'note', 'note'] },
  { id: 'message-shop', apps: ['send', 'agent'], group: 'daily', steps: 3, notes: ['careful'] },
  { id: 'parcel-problem', apps: ['send', 'agent', 'vendor', 'console'], group: 'wrong', steps: 5, notes: ['why', 'why', 'why', 'note', 'note', 'note', 'why', 'note'] },
  { id: 'thermal-labels', apps: ['agent', 'vendor', 'business'], group: 'daily', steps: 4, notes: ['note', 'why'] },
  { id: 'bag-seals', apps: ['agent', 'mdp', 'driver', 'vendor', 'console'], group: 'daily', steps: 8, notes: ['note'] },
  { id: 'held-on-the-road', apps: ['driver', 'business', 'console'], group: 'wrong', steps: 4, notes: ['note'] },
  { id: 'load-seals', apps: ['business'], group: 'freight', steps: 5, notes: ['why', 'note'] },
  { id: 'tampering', apps: ['driver', 'agent', 'mdp', 'console'], group: 'wrong', steps: 5, notes: ['note', 'why'] },
  { id: 'scan-a-parcel', apps: ['agent', 'mdp'], group: 'daily', steps: 4, notes: ['why'] },
  { id: 'gs1-codes', apps: ['vendor', 'business'], group: 'start', steps: 4, notes: ['why', 'note'] },
  { id: 'no-signal', apps: ['agent', 'mdp', 'fleet', 'driver', 'vendor', 'send'], group: 'daily', steps: 6, notes: ['careful', 'why'] },
  { id: 'consignment-note', apps: ['agent', 'driver', 'fleet'], group: 'freight', steps: 4, notes: ['why', 'careful', 'note', 'note', 'note', 'note', 'rare'] },
  { id: 'freight-delivery', apps: ['agent', 'driver'], group: 'freight', steps: 5, notes: ['note', 'why', 'note'] },
  { id: 'sender-instructions', apps: ['agent', 'driver', 'fleet'], group: 'freight', steps: 4, notes: ['note'] },
  { id: 'freight-tracking', apps: ['agent', 'send'], group: 'freight', steps: 3, notes: ['why', 'note', 'note'] },
  { id: 'manager-dispatch', apps: ['fleet', 'driver'], group: 'freight', steps: 3, notes: ['why'] },
  { id: 'fleet-orders', apps: ['fleet'], group: 'freight', steps: 4, notes: ['note', 'note'] },
  { id: 'fleet-order-sheet', apps: ['fleet'], group: 'freight', steps: 5, notes: ['note', 'note', 'note'] },
  { id: 'fleet-plan', apps: ['fleet'], group: 'freight', steps: 8, notes: ['why', 'note', 'note', 'why', 'note', 'note', 'why', 'why', 'note', 'note'] },
  { id: 'fleet-plan-adviser', apps: ['fleet'], group: 'freight', steps: 6, notes: ['note', 'note', 'note', 'note', 'why'] },
  { id: 'fleet-partners', apps: ['fleet'], group: 'freight', steps: 8, notes: ['note', 'note', 'note', 'rare'] },
  { id: 'papers-that-expire', apps: ['fleet', 'driver', 'console'], group: 'account', steps: 6, notes: ['why', 'why', 'rare'] },
  { id: 'hand-back', apps: ['driver', 'agent', 'fleet'], group: 'freight', steps: 4, notes: ['note'] },
  { id: 'hours-of-service', apps: ['driver', 'fleet'], group: 'freight', steps: 6, notes: ['why'] },
  { id: 'when-to-change', apps: ['agent', 'mdp', 'fleet', 'driver', 'vendor', 'send', 'home', 'console'], group: 'account', steps: 2, notes: ['careful'] },
];

const key = (id: string, part: string) => `help.${id}.${part}` as MessageKey;
const count = (n: number | undefined, id: string, part: 'step' | 'note', t: Translate) => (n ? Array.from({ length: n }, (_, i) => t(key(id, `${part}${i + 1}`))) : undefined);

/** One article, in the reader's language. */
export function articleOf(spec: ArticleSpec, t: Translate = translate): GuideArticle {
  const steps = count(spec.steps, spec.id, 'step', t);
  const notes = count(spec.notes?.length, spec.id, 'note', t);
  return { id: spec.id, apps: spec.apps, group: spec.group, title: t(key(spec.id, 'title')), summary: t(key(spec.id, 'summary')), ...(steps ? { steps } : {}), ...(notes ? { notes, noteKinds: spec.notes } : {}) };
}

/** Every public article, in the reader's language. */
export function articles(t: Translate = translate): GuideArticle[] {
  return ARTICLE_SPECS.map((s) => articleOf(s, t));
}

export function articlesFor(app: GuideApp, t: Translate = translate): GuideArticle[] {
  return articles(t).filter((a) => a.apps.includes(app));
}

/** One article by its address, or nothing. */
export function articleById(id: string, t: Translate = translate): GuideArticle | undefined {
  const spec = ARTICLE_SPECS.find((s) => s.id === id);
  return spec ? articleOf(spec, t) : undefined;
}
