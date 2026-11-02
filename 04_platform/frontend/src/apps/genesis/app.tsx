import { AppLayer } from '../../shared/ui/AppLayer';
import { useEffect, useState } from 'preact/hooks';
import { onLaunch } from '../../shared/launch';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { AgreementGate } from '../../shared/documents/Agreement';
import { BottomNav, ConnectivityNote, Icon, NotificationBell, TopBar, type NavItem } from '../../shared/ui';
import { useT } from '../../shared/i18n';
import type { SbgClient } from '../../lib/sbg';
import { useAccount, type AccountApi } from '../../shared/account/useAccount';
import { SendScreen } from './screens/SendScreen';
import { TrackScreen } from './screens/TrackScreen';
import { AuthScreen } from './screens/AuthScreen';
import { MyParcelsScreen } from './screens/MyParcelsScreen';
import { AccountScreen } from './screens/AccountScreen';
import { useSendApp, type Screen, type SendActions, type SendState } from './useSendApp';
import '../../shared/screens.css';
import './send.css';
import { sendWorkLine } from './logic';
import { screensOf, useBackLayer, useScreenNav } from '../../shared/nav';
import { NavScreen } from '../../shared/ui/NavScreen';

// 2026-11-02 — Back, as an app means it (shared/nav.ts): Send is home and the other three are tabs, so they swap in
// place and Back from any of them is Send. A shortcut may open any of the four.
const TABS: readonly Screen[] = ['track', 'parcels', 'account'];
const LAUNCH = screensOf<Screen>({ send: true, track: true, parcels: true, account: true });

/**
 * The consumer shell. Send + Track are open to everyone — the first paint is still the first question,
 * no account required (signed-off O1). The two authenticated tabs (My parcels, Account) gate behind a
 * phone+PIN sign-in only when tapped; a returning user with a live token restores silently past it.
 */
export function App() {
  const t = useT();
  const { state, actions, notifications, sbg } = useSendApp();
  // The person's own account — the recovery email and phone number behind Settings. Loaded once signed in.
  const account = useAccount(sbg, Boolean(state.identity));
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;
  // No sign-in shell to wait for: Send and Track are open to everyone, and the two that need a person ask on the tab.
  const nav = useScreenNav<Screen>({ screen: state.screen, home: 'send', tabs: TABS, ready: true, go: actions.go, launch: LAUNCH });
  // One parcel open on My parcels is a step in of its own: Back puts it down before it leaves the tab.
  useBackLayer(state.screen === 'parcels' && Boolean(state.openParcelId), actions.closeParcel);
  // 2026-11-02 — the bell's welcome opens the guide to getting the most out of the app, kept on the Account screen, on
  // one tap (`?guide=1`, shared/launch.ts; the owner: "a tooltip on how to get more out of the app").
  const [guideAsked, setGuideAsked] = useState(0);
  useEffect(
    () =>
      onLaunch('guide', () => {
        actions.go('account');
        setGuideAsked((n) => n + 1);
      }),
    [],
  );

  const tabs: NavItem<Screen>[] = [
    { key: 'send', label: t('send.nav.send'), icon: 'send' },
    { key: 'track', label: t('send.nav.track'), icon: 'search' },
    { key: 'parcels', label: t('send.nav.parcels'), icon: 'box' },
    { key: 'account', label: t('send.nav.account'), icon: 'person' },
  ];

  return (
    <div class="app">
      <TopBar
        title={t('send.appTitle')}
        subtitle={sendWorkLine(state.parcels, t)}
        end={
          notifications || needRefresh ? (
            <>
              {/* The bell appears once signed in (My parcels / Account) — that is where the buyer
                  wants "your parcel has arrived" — and stays hidden on the anonymous Send/Track surfaces. */}
              {notifications ? <NotificationBell api={notifications} /> : null}
              {needRefresh ? (
                <button
                  type="button"
                  class="topbar__lead"
                  onClick={() => void sw.updateServiceWorker(true)}
                  aria-label={t('send.update.aria')}
                  title={t('send.update.title')}
                >
                  <Icon name="refresh" size={24} />
                </button>
              ) : null}
            </>
          ) : null
        }
      />

      <main class="app__scroll">
        {/* 2026-11-02 — what every installed app has: the call to install, what is shared to it, its gestures. */}
        <AppLayer app="send" chats={state.identity ? actions.chatApi : state.restoring ? undefined : null} onSignIn={() => actions.go('parcels')} onRefresh={state.identity ? actions.loadParcels : undefined} />
        <ConnectivityNote />
        <NavScreen nav={nav}>
          <Router state={state} actions={actions} account={account} sbg={sbg} guideAsked={guideAsked} onGuideShown={() => setGuideAsked(0)} />
        </NavScreen>
      </main>

      <BottomNav<Screen> items={tabs} active={state.screen} onSelect={(key) => actions.go(key)} labels={false} />
      {/* What they agreed to, asked again when a version since asks it (2026-10-25). Only once signed in. */}
      <AgreementGate sbg={state.identity ? sbg : null} onSignOut={() => actions.signOut()} />
    </div>
  );
}

/** The authenticated tabs gate on sign-in; a stored session restores silently (a brief boot spinner). */
function Router({ state, actions, account, sbg, guideAsked = 0, onGuideShown }: { state: SendState; actions: SendActions; account: AccountApi; sbg: SbgClient | null; guideAsked?: number; onGuideShown?: () => void }) {
  if (state.screen === 'track') return <TrackScreen state={state} actions={actions} />;
  if (state.screen === 'parcels' || state.screen === 'account') {
    if (state.restoring) return <Boot />;
    if (!state.identity) return <AuthScreen state={state} actions={actions} />;
    return state.screen === 'parcels' ? <MyParcelsScreen state={state} actions={actions} client={sbg} /> : <AccountScreen state={state} actions={actions} account={account} guideAsked={guideAsked} onGuideShown={onGuideShown} />;
  }
  return <SendScreen state={state} actions={actions} />;
}

function Boot() {
  const t = useT();
  return (
    <div class="boot" role="status" aria-live="polite">
      <span class="boot__spinner" aria-hidden="true" />
      <p class="boot__word">{t('send.boot')}</p>
    </div>
  );
}
