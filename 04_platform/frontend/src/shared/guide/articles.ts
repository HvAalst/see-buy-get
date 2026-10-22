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

export interface GuideArticle {
  /** Stable: it is the address, /help/<id>/. */
  id: string;
  /** The apps that show it. */
  apps: GuideApp[];
  title: string;
  summary: string;
  steps?: string[];
  notes?: string[];
}

/** An article's shape: its words are help.<id>.* in the catalog. */
interface ArticleSpec {
  id: string;
  apps: GuideApp[];
  steps?: number;
  notes?: number;
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
  { id: 'which-sign-in', apps: ['home'], steps: 6 },
  { id: 'shop-sign-in', apps: ['agent', 'mdp'], steps: 7 },
  { id: 'people-at-work', apps: ['agent', 'mdp'], steps: 4, notes: 1 },
  { id: 'risk-register', apps: ['agent', 'mdp', 'console'], steps: 3, notes: 1 },
  { id: 'security-declaration', apps: ['agent', 'mdp', 'fleet', 'driver', 'console'], steps: 3, notes: 1 },
  { id: 'new-partner-limit', apps: ['agent', 'driver', 'console'], steps: 4, notes: 1 },
  { id: 'shop-papers', apps: ['agent'], steps: 5, notes: 2 },
  { id: 'hub-papers', apps: ['mdp'], steps: 5, notes: 2 },
  { id: 'change-password', apps: ['agent', 'mdp'], steps: 2, notes: 2 },
  { id: 'fleet-sign-in', apps: ['fleet'], steps: 5, notes: 2 },
  { id: 'fleet-code', apps: ['fleet', 'console'], steps: 3, notes: 1 },
  { id: 'fleet-roster', apps: ['fleet'], steps: 4, notes: 6 },
  { id: 'driver-sign-in', apps: ['driver'], steps: 4, notes: 6 },
  { id: 'driver-fleet', apps: ['driver'], steps: 3, notes: 6 },
  { id: 'change-pin', apps: ['fleet', 'driver', 'send'], steps: 3, notes: 7 },
  { id: 'who-you-contract-with', apps: ['agent', 'mdp', 'fleet', 'driver', 'vendor', 'business'], steps: 4, notes: 3 },
  { id: 'account-recovery', apps: ['fleet', 'driver', 'send'], steps: 5, notes: 23 },
  { id: 'store-sign-in', apps: ['vendor'], steps: 10 },
  { id: 'store-secret', apps: ['vendor'], steps: 4, notes: 3 },
  { id: 'api-keys', apps: ['vendor'], steps: 3, notes: 1 },
  { id: 'send-sign-in', apps: ['send', 'home'], steps: 5 },
  { id: 'follow-shop-order', apps: ['send', 'vendor'], steps: 3, notes: 3 },
  { id: 'business-sign-in', apps: ['business', 'home'], steps: 5 },
  { id: 'business-people', apps: ['business'], steps: 4 },
  { id: 'business-check', apps: ['business', 'console'], steps: 2, notes: 1 },
  { id: 'business-bell', apps: ['business'], steps: 3, notes: 3 },
  { id: 'business-loads', apps: ['business'], steps: 4, notes: 3 },
  { id: 'business-note', apps: ['business'], steps: 4, notes: 7 },
  { id: 'business-runs', apps: ['business'], steps: 4 },
  { id: 'business-contracts', apps: ['business'], steps: 3, notes: 9 },
  { id: 'business-clients', apps: ['business'], steps: 4, notes: 1 },
  { id: 'quotations', apps: ['business', 'console'], steps: 4, notes: 1 },
  { id: 'shop-shelves', apps: ['agent'], steps: 5, notes: 5 },
  { id: 'message-shop', apps: ['send', 'agent'], steps: 3, notes: 1 },
  { id: 'parcel-problem', apps: ['send', 'agent', 'vendor', 'console'], steps: 5, notes: 8 },
  { id: 'thermal-labels', apps: ['agent', 'vendor', 'business'], steps: 4, notes: 2 },
  { id: 'bag-seals', apps: ['agent', 'mdp', 'driver', 'vendor', 'console'], steps: 8, notes: 1 },
  { id: 'held-on-the-road', apps: ['driver', 'business', 'console'], steps: 4, notes: 1 },
  { id: 'load-seals', apps: ['business'], steps: 5, notes: 2 },
  { id: 'tampering', apps: ['driver', 'agent', 'mdp', 'console'], steps: 5, notes: 2 },
  { id: 'scan-a-parcel', apps: ['agent', 'mdp'], steps: 4, notes: 1 },
  { id: 'gs1-codes', apps: ['vendor', 'business'], steps: 4, notes: 2 },
  { id: 'no-signal', apps: ['agent', 'mdp', 'fleet', 'driver', 'vendor', 'send'], steps: 6, notes: 2 },
  { id: 'consignment-note', apps: ['agent', 'driver', 'fleet'], steps: 4, notes: 7 },
  { id: 'freight-delivery', apps: ['agent', 'driver'], steps: 5, notes: 3 },
  { id: 'sender-instructions', apps: ['agent', 'driver', 'fleet'], steps: 4, notes: 1 },
  { id: 'freight-tracking', apps: ['agent', 'send'], steps: 3, notes: 3 },
  { id: 'manager-dispatch', apps: ['fleet', 'driver'], steps: 3, notes: 1 },
  { id: 'fleet-orders', apps: ['fleet'], steps: 4, notes: 2 },
  { id: 'fleet-order-sheet', apps: ['fleet'], steps: 5, notes: 3 },
  { id: 'fleet-plan', apps: ['fleet'], steps: 8, notes: 10 },
  { id: 'fleet-plan-adviser', apps: ['fleet'], steps: 6, notes: 5 },
  { id: 'fleet-partners', apps: ['fleet'], steps: 8, notes: 4 },
  { id: 'papers-that-expire', apps: ['fleet', 'driver', 'console'], steps: 6, notes: 3 },
  { id: 'hand-back', apps: ['driver', 'agent', 'fleet'], steps: 4, notes: 1 },
  { id: 'hours-of-service', apps: ['driver', 'fleet'], steps: 6, notes: 1 },
  { id: 'when-to-change', apps: ['agent', 'mdp', 'fleet', 'driver', 'vendor', 'send', 'home', 'console'], steps: 2, notes: 1 },
];

const key = (id: string, part: string) => `help.${id}.${part}` as MessageKey;
const count = (n: number | undefined, id: string, part: 'step' | 'note', t: Translate) => (n ? Array.from({ length: n }, (_, i) => t(key(id, `${part}${i + 1}`))) : undefined);

/** One article, in the reader's language. */
export function articleOf(spec: ArticleSpec, t: Translate = translate): GuideArticle {
  const steps = count(spec.steps, spec.id, 'step', t);
  const notes = count(spec.notes, spec.id, 'note', t);
  return { id: spec.id, apps: spec.apps, title: t(key(spec.id, 'title')), summary: t(key(spec.id, 'summary')), ...(steps ? { steps } : {}), ...(notes ? { notes } : {}) };
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
