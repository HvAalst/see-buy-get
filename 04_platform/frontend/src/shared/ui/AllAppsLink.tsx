import { useState } from 'preact/hooks';
import { useT } from '../i18n';
import { frontDoorLink } from '../frontDoor';
import { AppsSheet } from './AppLauncher';
import type { MyAppsApi } from '../account/myApps';

// Where the front door is, and how a link to it opens: shared/frontDoor.ts (kept importable from here, where they were).
export { frontDoorLink, frontDoorUrl, isInstalledApp } from '../frontDoor';

/**
 * THE WAY BACK TO THE OTHER APPS (the user, 2026-10-22: "once installed, there is no other way to get out of it ... there
 * should be an option on the app homepage to return to the browser version homepage and access the other apps").
 * Beside Help: on every sign-in screen, and at the foot of the account menu. The mark in the top bar goes to the front page.
 * `buttonClass` lets an app drawn in the console's buttons (Business) draw it in its own.
 *
 * 2026-11-04 (the owner: "it redirects to the homepage. that is a bit cheap way out") — it opens the apps themselves, as
 * their icons (AppLauncher.tsx); the front page is the first of them.
 */
export function AllAppsLink({ buttonClass = 'btn btn--link', myApps }: { buttonClass?: string; myApps?: MyAppsApi } = {}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class={buttonClass} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {t('common.allApps')}
      </button>
      <AppsSheet open={open} onClose={() => setOpen(false)} myApps={myApps} />
    </>
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
