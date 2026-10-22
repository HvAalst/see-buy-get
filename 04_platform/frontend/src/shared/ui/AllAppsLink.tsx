import { useT } from '../i18n';

/**
 * Where the front door is: the site's root once deployed (every app lives under it, at /send/, /driver/ …); in
 * development each app has a server of its own, and the front door's is 5180 (vite.config.ts), which proxies the others.
 */
export function frontDoorUrl(loc: Pick<Location, 'protocol' | 'hostname'> = location, dev: boolean = import.meta.env.DEV): string {
  return dev ? `${loc.protocol}//${loc.hostname}:5180/` : '/';
}

/**
 * THE WAY BACK TO THE OTHER APPS (the user, 2026-10-22: "once installed, there is no other way to get out of it ... there
 * should be an option on the app homepage to return to the browser version homepage and access the other apps").
 *
 * It opens the front door in the BROWSER — a tab of its own, not this app's window — so an installed app stays the one
 * app it is, and the front door is where another is chosen or installed. Beside Help: on every sign-in screen, and at
 * the foot of the account menu.
 */
export function AllAppsLink() {
  const t = useT();
  return (
    <a class="btn btn--link" href={frontDoorUrl()} target="_blank" rel="noopener">
      {t('common.allApps')}
    </a>
  );
}
