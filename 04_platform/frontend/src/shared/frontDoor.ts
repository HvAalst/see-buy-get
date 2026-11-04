/**
 * Where the front door is: the site's root once deployed (every app lives under it, at /send/, /driver/ …); in
 * development each app has a server of its own, and the front door's is 5180 (vite.config.ts), which proxies the others.
 * With no page around it (a test, the build) it is the root.
 */
export function frontDoorUrl(loc: Pick<Location, 'protocol' | 'hostname'> | undefined = globalThis.location, dev: boolean = import.meta.env.DEV): string {
  return dev && loc ? `${loc.protocol}//${loc.hostname}:5180/` : '/';
}

/** Is this app running installed — its own window, from the phone's home screen — rather than in a browser tab? */
export function isInstalledApp(): boolean {
  try {
    const nav = globalThis.navigator as (Navigator & { standalone?: boolean }) | undefined;
    return Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches || nav?.standalone);
  } catch {
    return false;
  }
}

/**
 * HOW A LINK TO THE FRONT DOOR OPENS (the user, 2026-10-22: "can't return to homepage when I am in the browser except
 * through the chrome back arrow"). In a browser tab it is an ordinary link: the front page, in the same tab, and Back
 * returns. In an installed app it opens in the browser, a tab of its own, so the app stays the one app it is.
 */
export function frontDoorLink(): { href: string; target?: string; rel?: string } {
  return isInstalledApp() ? { href: frontDoorUrl(), target: '_blank', rel: 'noopener' } : { href: frontDoorUrl() };
}

/** Go there: this tab, or — from an installed app, which has no address bar — a tab of its own, as the front door opens. */
export function goToApp(href: string): void {
  if (isInstalledApp()) globalThis.open?.(href, '_blank', 'noopener');
  else globalThis.location?.assign(href);
}
