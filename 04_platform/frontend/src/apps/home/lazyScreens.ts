import type { ComponentType } from 'preact';
import { lazy } from 'preact/compat';
import { loadHelpWords } from '../../shared/i18n';
import type { HelpScreen as HelpScreenComponent } from './screens/HelpScreen';

/*
 * WHAT THE HOMEPAGE DOES NOT DRAW IS NOT IN ITS FIRST DOWNLOAD (the user, 2026-10-23: "the loading time of the homepage
 * should be short for a low quality phone with poor connection"). The front page, the pages written to be quoted and the
 * town pages arrive as finished HTML and are taken over by the code in the first download. Every other screen — joining,
 * the market, signing in, a store's or a person's page, checking a note — is fetched the moment it is opened.
 */
function screen<P>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  return lazy(() => load().then((component) => ({ default: component })));
}

export const JoinScreen = screen(() => import('./screens/JoinScreen').then((m) => m.JoinScreen));
export const MarketScreen = screen(() => import('./screens/MarketScreen').then((m) => m.MarketScreen));
export const RolesScreen = screen(() => import('./screens/RolesScreen').then((m) => m.RolesScreen));
export const StoreScreen = screen(() => import('./screens/StoreScreen').then((m) => m.StoreScreen));
export const ProfileScreen = screen(() => import('./screens/ProfileScreen').then((m) => m.ProfileScreen));
export const AgentsScreen = screen(() => import('./screens/AgentsScreen').then((m) => m.AgentsScreen));
export const SignInScreen = screen(() => import('./screens/SignInScreen').then((m) => m.SignInScreen));
export const NoteCheck = screen(() => import('../../shared/archive/NoteCheck').then((m) => m.NoteCheck));
export const DocumentLinkPage = screen(() => import('../../shared/archive/DocumentLinkPage').then((m) => m.DocumentLinkPage));
export const DamageReportLinkPage = screen(() => import('../../shared/damage/DamageReportLinkPage').then((m) => m.DamageReportLinkPage));

/*
 * THE HELP: a page of its own, finished HTML at build time — so its code and its words (the biggest catalog there is)
 * are brought in BEFORE it is drawn (main.tsx, prerender.tsx), never in the middle of taking over its markup.
 */
let help: typeof HelpScreenComponent | null = null;

/** The help screen, once it is here. */
export function helpScreen(): typeof HelpScreenComponent | null {
  return help;
}

/** Bring the help screen and the help's words in, once. */
export async function loadHelpPage(): Promise<void> {
  if (help) return;
  const [m] = await Promise.all([import('./screens/HelpScreen'), loadHelpWords()]);
  help = m.HelpScreen;
}
