import { useT } from '../i18n';

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

/**
 * THE WAY BACK TO THE OTHER APPS (the user, 2026-10-22: "once installed, there is no other way to get out of it ... there
 * should be an option on the app homepage to return to the browser version homepage and access the other apps").
 * Beside Help: on every sign-in screen, and at the foot of the account menu. The mark in the top bar goes there too.
 */
export function AllAppsLink() {
  const t = useT();
  return (
    <a class="btn btn--link" {...frontDoorLink()}>
      {t('common.allApps')}
    </a>
  );
}

/**
 * NEW HERE? SIGN UP — on the sign-in screen of every app an account is made for on the front page (the user, 2026-10-23:
 * "the sign up process for the apps should seem more unified and straightforward"). Somebody who reached the shop's, the
 * driver's, the hub's or the fleet's door without an account had no way from it to the form that makes one.
 */
export function SignUpLink({ role }: { role: 'pudo' | 'driver' | 'mdp' | 'fleet' | 'vendor' }) {
  const t = useT();
  const door = frontDoorLink();
  return (
    <a class="btn btn--link" {...door} href={`${door.href}?join=${role}`}>
      {t('common.signUp')}
    </a>
  );
}
