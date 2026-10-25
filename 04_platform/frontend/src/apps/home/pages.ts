import type { MessageKey } from '../../shared/i18n';
import type { HelpRole } from './help';

/**
 * THE PAGES WRITTEN TO BE QUOTED — /about/ and /for/<who>/ (the user, 2026-10-22: "a marketing page for agentic search
 * optimization"). Built into HTML at build time, one address each, every word in the catalog (en.pages.ts).
 */
export type Audience = 'shops' | 'drivers' | 'fleets' | 'hubs' | 'stores' | 'business';
export type Notice = 'terms' | 'privacy' | 'cookies';
export type InfoPage = { kind: 'about' } | { kind: 'for'; who: Audience } | { kind: 'notice'; which: Notice };

export const ABOUT_PATH = '/about/';
export const TERMS_PATH = '/terms/';
export const PRIVACY_PATH = '/privacy/';
export const COOKIES_PATH = '/cookies/';
export const forPath = (who: Audience) => `/for/${who}/`;

export interface AudienceSpec {
  who: Audience;
  /** Where joining starts: the front door's join, or the app itself. */
  join: string;
  /** The help for this reader. */
  help: HelpRole;
  /** How many steps, things needed and questions the catalog has for it (pages.for.<who>.step1 …). */
  steps: number;
  needs: number;
  questions: number;
  /** What the reader is called on the front page's cards. */
  label: MessageKey;
  blurb: MessageKey;
}

export const AUDIENCES: readonly AudienceSpec[] = [
  { who: 'shops', join: '/?join=pudo', help: 'shop', steps: 4, needs: 3, questions: 3, label: 'home.role.pudo.label', blurb: 'home.role.pudo.blurb' },
  { who: 'drivers', join: '/?join=driver', help: 'driver', steps: 4, needs: 3, questions: 3, label: 'home.role.driver.label', blurb: 'home.role.driver.promise' },
  // A fleet signs itself up on the front page since 2026-10-23, and had no page of its own to be found by.
  { who: 'fleets', join: '/?join=fleet', help: 'fleet', steps: 4, needs: 3, questions: 3, label: 'home.role.fleet.label', blurb: 'home.role.fleet.blurb' },
  { who: 'hubs', join: '/?join=mdp', help: 'hub', steps: 4, needs: 2, questions: 2, label: 'home.role.mdp.label', blurb: 'home.role.mdp.blurb' },
  { who: 'stores', join: '/?join=vendor', help: 'store', steps: 4, needs: 3, questions: 3, label: 'home.role.vendor.label', blurb: 'home.role.vendor.blurb' },
  { who: 'business', join: '/business/', help: 'business', steps: 4, needs: 2, questions: 2, label: 'pages.for.business.title', blurb: 'pages.for.business.lede' },
];

/**
 * THE TERMS OF USE, YOUR DATA, AND COOKIES — the three documents every sign-up agrees to. Their text is written by staff
 * in the console and read from the server (shared/documents); only their addresses and search titles live here.
 */
export const NOTICES: Record<Notice, { path: string }> = {
  terms: { path: TERMS_PATH },
  privacy: { path: PRIVACY_PATH },
  cookies: { path: COOKIES_PATH },
};

/** pages.<terms|privacy|cookies>.<part>, typed. */
export const noticeKey = (which: Notice, part: string) => `pages.${which}.${part}` as MessageKey;

/** Which page an address is, or null. */
export function infoPageOf(path: string): InfoPage | null {
  if (/^\/about\/?$/.test(path)) return { kind: 'about' };
  const notice = /^\/(terms|privacy|cookies)\/?$/.exec(path)?.[1];
  if (notice) return { kind: 'notice', which: notice as Notice };
  const who = /^\/for\/([a-z]+)\/?$/.exec(path)?.[1];
  return who && AUDIENCES.some((a) => a.who === who) ? { kind: 'for', who: who as Audience } : null;
}

/** pages.for.<who>.<part>, typed. */
export const pageKey = (who: Audience, part: string) => `pages.for.${who}.${part}` as MessageKey;
export const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** The countries a list of town pages is in, by name in the reader's language, in order of first appearance. */
export function countriesOf(towns: Array<{ country: string }>, locale: string): string {
  const codes = [...new Set(towns.map((t) => t.country).filter(Boolean))];
  try {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return codes.map((c) => names.of(c) ?? c).join(', ');
  } catch {
    return codes.join(', ');
  }
}
