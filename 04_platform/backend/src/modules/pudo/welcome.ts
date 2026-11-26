/**
 * 2026-11-02 — THE BELL'S FIRST NOTICE (the owner: "I want the business app to get a welcome notification with a short
 * text describing what the bell will be used for and a tooltip on how to get more out of the app"; and every app: each
 * bell starts empty).
 *
 * Sent once per inbox (NotificationService.welcomeOnce): a business's when it is set up, or — one set up before this —
 * when one of its people next reads its bell; anybody else's the first time they read it in their app, which is right
 * after their first sign-in there. Two short sentences, as every notice here is written: what arrives in THIS app's
 * bell, and that a tap opens where it is acted on. Its link opens the app's guide to getting the most out of it (home
 * screen, notifications, battery) — `/?guide=1`, read in the apps by shared/launch.ts.
 */
import { noticeOf, said } from './notice-words/say';

export type WelcomeApp = 'business' | 'driver' | 'shop' | 'hub' | 'store' | 'fleet' | 'send' | 'partner';

const APPS: readonly WelcomeApp[] = ['business', 'driver', 'shop', 'hub', 'store', 'fleet', 'partner', 'send'];

/** 2026-11-26 — an app's welcome as phrases, said to each reader in their language (notice-words/en/bell.ts). */
export function welcomeNotice(app: WelcomeApp): ReturnType<typeof noticeOf> {
  return noticeOf(said(`welcome.${app}.title` as const), said(`welcome.${app}.body` as const, { tap: said('welcome.tap') }));
}

/** Each app's welcome in English, as it is sent. */
export const WELCOME = Object.fromEntries(APPS.map((app) => [app, { title: welcomeNotice(app).title, body: welcomeNotice(app).body }])) as Record<WelcomeApp, { title: string; body: string }>;

/** The app's guide to getting the most out of it, opened on one tap. */
export const GUIDE_LINK = '/?guide=1';

/** Which app's bell a signed-in role reads. Staff, and a company's administrators, read no bell. */
export function welcomeAppOf(role: string | undefined): WelcomeApp | null {
  switch (role) {
    case 'business':
      return 'business';
    case 'driver':
      return 'driver';
    case 'agent':
      return 'shop';
    case 'mdp':
      return 'hub';
    case 'genesis':
      return 'store';
    case 'fleet_manager':
      return 'fleet';
    case 'consumer':
      return 'send';
    case 'partner':
      return 'partner';
    default:
      return null;
  }
}
