import { useEffect, useState } from 'preact/hooks';
import { useT, type MessageKey } from '../i18n';
import { Sheet } from './Sheet';
import { ErrorNote } from './ErrorNote';
import { frontDoorLink, frontDoorUrl, goToApp } from '../frontDoor';
import type { AppRole, MyApp, MyAppsApi } from '../account/myApps';
import type { Result, SbgError } from '../../lib/sbg';
import { withCarry } from '../account/carry';

export type LauncherApp = 'home' | 'agent' | 'mdp' | 'vendor' | 'driver' | 'fleet' | 'business' | 'genesis';

/**
 * EVERY APP OF THE NETWORK, AS ITS ICON ON A PHONE'S HOME SCREEN (the owner, 2026-11-04: "can't we make it more like google's
 * 'all of SBG apps' and then show the distinct icons as how they show in the homescreen"). The front page first, then the
 * apps a place works in, those that carry, and those that send. The console is staff's, on a desk: it is not here.
 */
export const LAUNCHER_APPS: ReadonlyArray<{ id: LauncherApp; path: string; name: MessageKey; role?: AppRole }> = [
  { id: 'home', path: '', name: 'launcher.app.home' },
  { id: 'agent', path: 'agent/', name: 'launcher.app.agent', role: 'pudo' },
  { id: 'mdp', path: 'mdp/', name: 'launcher.app.mdp', role: 'mdp' },
  { id: 'vendor', path: 'vendor/', name: 'launcher.app.vendor', role: 'vendor' },
  { id: 'driver', path: 'driver/', name: 'launcher.app.driver' },
  { id: 'fleet', path: 'fleet/', name: 'launcher.app.fleet' },
  { id: 'business', path: 'business/', name: 'launcher.app.business' },
  { id: 'genesis', path: 'send/', name: 'launcher.app.genesis' },
];

/** Which of them this page is, from its address: `/mdp/…` is the Hub, the root the front page; a page of the site, none. */
export function appHere(pathname: string | undefined): LauncherApp | null {
  const first = (pathname ?? '').split('/').filter(Boolean)[0] ?? '';
  return LAUNCHER_APPS.find((a) => a.path === (first ? `${first}/` : ''))?.id ?? null;
}

/**
 * What a tile does: this app (it only closes the sheet), one of this email's own kinds (it opens signed in), or a link.
 */
export function launcherTile(app: (typeof LAUNCHER_APPS)[number], here: LauncherApp | null, linked: ReadonlySet<AppRole>): { does: 'here' } | { does: 'own'; role: AppRole } | { does: 'link'; href: string } {
  if (app.id === here) return { does: 'here' };
  if (app.role && linked.has(app.role)) return { does: 'own', role: app.role };
  return { does: 'link', href: `${frontDoorUrl()}${app.path}` };
}

/** The icon the app installs with (scripts/gen-icons.mjs) — the very picture on the phone's home screen. */
export const launcherIcon = (path: string): string => `${frontDoorUrl()}${path}icons/icon-192.png`;

/**
 * THE SHEET OF APPS. Each opens where it lives — from an installed app in the browser, as the front door does. The kinds of
 * account this email has, once "Yes, it is me" was tapped for them, open signed in (a hand-over, myApps.ts); this app is
 * shown where it stands and only closes the sheet.
 */
export function AppsSheet({ open, onClose, myApps, carry, here = appHere(globalThis.location?.pathname) }: { open: boolean; onClose: () => void; myApps?: MyAppsApi; carry?: () => Promise<Result<{ code: string }>>; here?: LauncherApp | null }) {
  const t = useT();
  const [mine, setMine] = useState<MyApp[]>([]);
  const [busy, setBusy] = useState<AppRole | null>(null);
  const [failed, setFailed] = useState<SbgError | null>(null);
  useEffect(() => {
    if (!open || !myApps) return;
    let live = true;
    void myApps.list().then((r) => {
      if (live && r.data) setMine(r.data.apps);
    });
    return () => {
      live = false;
    };
  }, [open, myApps]);
  const linked = new Set(myApps ? mine.filter((m) => m.linked).map((m) => m.role) : []);
  const openOwn = async (role: AppRole) => {
    if (!myApps) return;
    setBusy(role);
    setFailed(null);
    const r = await myApps.open(role);
    setBusy(null);
    if (r.error) return setFailed(r.error);
    goToApp(r.data.href);
  };
  const door = frontDoorLink();
  // 2026-11-04 — from a signed-in app, an app opened here carries this account's details to its sign-up (carry.ts):
  // whoever signs up there finds the number, email, name and country filled in, and no text code to type.
  // A Shop, Hub or Store asks from one of its own phones (myApps); an app signed in with a phone and PIN, as that person.
  const carrier = myApps?.carry ?? carry;
  const openCarrying = async (href: string) => {
    const r = carrier ? await carrier() : undefined;
    goToApp(withCarry(href, r?.data?.code));
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('common.allApps')}>
      {failed ? <ErrorNote error={failed} /> : null}
      <ul class="apps-grid">
        {LAUNCHER_APPS.map((app) => {
          const face = (
            <>
              <img class="apps-grid__icon" src={launcherIcon(app.path)} alt="" width={56} height={56} loading="lazy" decoding="async" />
              <span class="apps-grid__name">{t(app.name)}</span>
            </>
          );
          const tile = launcherTile(app, here, linked);
          if (tile.does === 'here') {
            return (
              <li key={app.id}>
                <button type="button" class="apps-grid__tile apps-grid__tile--here" aria-current="page" onClick={onClose}>
                  {face}
                  <span class="apps-grid__sub">{t('launcher.here')}</span>
                </button>
              </li>
            );
          }
          if (tile.does === 'own') {
            const role = tile.role;
            return (
              <li key={app.id}>
                <button type="button" class="apps-grid__tile" aria-busy={busy === role} disabled={busy !== null} onClick={() => void openOwn(role)}>
                  {face}
                  <span class="apps-grid__sub">{t('launcher.signedIn')}</span>
                </button>
              </li>
            );
          }
          return (
            <li key={app.id}>
              <a
                class="apps-grid__tile"
                href={tile.href}
                target={door.target}
                rel={door.rel}
                onClick={(e) => {
                  if (!carrier) return;
                  e.preventDefault();
                  void openCarrying(tile.href);
                }}
              >
                {face}
              </a>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
