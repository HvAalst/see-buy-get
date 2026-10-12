import { useRegisterSW } from 'virtual:pwa-register/preact';
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
        <ConnectivityNote />
        <Router state={state} actions={actions} account={account} sbg={sbg} />
      </main>

      <BottomNav<Screen> items={tabs} active={state.screen} onSelect={(key) => actions.go(key)} labels={false} />
    </div>
  );
}

/** The authenticated tabs gate on sign-in; a stored session restores silently (a brief boot spinner). */
function Router({ state, actions, account, sbg }: { state: SendState; actions: SendActions; account: AccountApi; sbg: SbgClient | null }) {
  if (state.screen === 'track') return <TrackScreen state={state} actions={actions} />;
  if (state.screen === 'parcels' || state.screen === 'account') {
    if (state.restoring) return <Boot />;
    if (!state.identity) return <AuthScreen state={state} actions={actions} />;
    return state.screen === 'parcels' ? <MyParcelsScreen state={state} actions={actions} client={sbg} /> : <AccountScreen state={state} actions={actions} account={account} />;
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
