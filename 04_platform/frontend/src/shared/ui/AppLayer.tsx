import { InstallBar, type InstallApp } from './InstallBar';

/**
 * 2026-11-02 — WHAT EVERY INSTALLED APP HAS, in one place (the owner: "make it as native as today can be"): first in
 * every scroll area of the shop, hub, driver, fleet, store and Send apps, signed in or not. The call to install
 * (pinned until installed) lives here; so does what reaches the app from outside it — something shared to it from
 * another app — and the app-wide gestures. One line in each app's shell, so a new layer is added once, not six times.
 */
export interface AppLayerProps {
  app: InstallApp;
}

export function AppLayer({ app }: AppLayerProps) {
  return <InstallBar app={app} />;
}
