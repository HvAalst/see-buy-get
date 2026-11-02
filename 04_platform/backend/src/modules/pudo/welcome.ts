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
export type WelcomeApp = 'business' | 'driver' | 'shop' | 'hub' | 'store' | 'fleet' | 'send';

const TAP = 'Tap one and it opens where you act on it.';

export const WELCOME: Record<WelcomeApp, { title: string; body: string }> = {
  business: {
    title: 'Your business’s notices arrive here',
    body: `A carrier taking a load, a problem on the road, a delivery, a claim answered, papers checked: each is told here. ${TAP}`,
  },
  driver: {
    title: 'Your notices arrive here',
    body: `Loads put on you, offers near you, messages, your shift and your vehicle: each is told here. ${TAP}`,
  },
  shop: {
    title: 'Your shop’s notices arrive here',
    body: `Parcels to take in or hand out, bags to close, money in: each is told here. ${TAP}`,
  },
  hub: {
    title: 'Your hub’s notices arrive here',
    body: `Bags coming in and arrivals at your door: each is told here. ${TAP}`,
  },
  store: {
    title: 'Your store’s notices arrive here',
    body: `Your shipments, and what reaches your dock: each is told here. ${TAP}`,
  },
  fleet: {
    title: 'Your fleet’s notices arrive here',
    body: `Your drivers, runs, orders and vehicles: each is told here. ${TAP}`,
  },
  send: {
    title: 'Your notices arrive here',
    body: `Your parcels — on their way, ready to collect, or needing you: each is told here. ${TAP}`,
  },
};

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
    default:
      return null;
  }
}
