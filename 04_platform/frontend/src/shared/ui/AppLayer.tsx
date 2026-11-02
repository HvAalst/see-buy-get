import { InstallBar, type InstallApp } from './InstallBar';
import type { ConversationsApi } from '../../lib/sbg';
import { SharedInLayer } from '../conversation/SharedIn';
import { receivesShares } from '../conversation/sharedInLogic';
import { PullToRefresh } from './PullToRefresh';

/**
 * 2026-11-02 — WHAT EVERY INSTALLED APP HAS, in one place (the owner: "make it as native as today can be"): first in
 * every scroll area of the shop, hub, driver, fleet, store and Send apps, signed in or not. The call to install
 * (pinned until installed) lives here; so does what reaches the app from outside it — something shared to it from
 * another app — and the app-wide gestures. One line in each app's shell, so a new layer is added once, not six times.
 */
export interface AppLayerProps {
  app: InstallApp;
  /**
   * 2026-11-02 — where something shared to the app can go (the owner: "sharing in in-chat"): this person's chats once
   * signed in; `null` while signed out, when what was shared waits an hour for the sign-in; absent while that is not
   * known yet (a session being restored). Only the five apps with chats receive shares (sharedInLogic.ts, SHARE_APPS): the hub
   * has no chats and passes nothing.
   */
  chats?: ConversationsApi | null;
  /** The Send app signs in from inside it: the way there, offered beside what waits for the sign-in. */
  onSignIn?: () => void;
  /** 2026-11-02 — what pulling down at the top of a screen fetches again: the app's own refresh, once signed in. */
  onRefresh?: () => unknown;
}

export function AppLayer({ app, chats, onSignIn, onRefresh }: AppLayerProps) {
  return (
    <>
      <InstallBar app={app} />
      {receivesShares(app) ? <SharedInLayer app={app} chats={chats} onSignIn={onSignIn} /> : null}
      <PullToRefresh onRefresh={onRefresh} />
    </>
  );
}
