import { useRegisterSW } from 'virtual:pwa-register/preact';
import { BottomNav, Icon, NotificationBell, TopBar, type NavItem } from '../../shared/ui';
import { SendScreen } from './screens/SendScreen';
import { TrackScreen } from './screens/TrackScreen';
import { AuthScreen } from './screens/AuthScreen';
import { MyParcelsScreen } from './screens/MyParcelsScreen';
import { AccountScreen } from './screens/AccountScreen';
import { useSendApp, type Screen, type SendActions, type SendState } from './useSendApp';
import '../../shared/screens.css';
import './send.css';

/**
 * The consumer shell. Send + Track are open to everyone — the first paint is still the first question,
 * no account required (signed-off O1). The two authenticated tabs (My parcels, Account) gate behind a
 * phone+PIN sign-in only when tapped; a returning user with a live token restores silently past it.
 */
export function App() {
  const { state, actions, notifications } = useSendApp();
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  const tabs: NavItem<Screen>[] = [
    { key: 'send', label: 'Send', icon: 'send' },
    { key: 'track', label: 'Track', icon: 'search' },
    { key: 'parcels', label: 'My parcels', icon: 'box' },
    { key: 'account', label: 'Account', icon: 'person' },
  ];

  return (
    <div class="app">
      <TopBar
        title="SeeBuyGet Send"
        subtitle="See the price. Pay at the shop."
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
                  aria-label="A new version is ready — update now"
                  title="Update the app"
                >
                  <Icon name="refresh" size={24} />
                </button>
              ) : null}
            </>
          ) : null
        }
      />

      <main class="app__scroll">
        <Router state={state} actions={actions} />
      </main>

      <BottomNav<Screen> items={tabs} active={state.screen} onSelect={(key) => actions.go(key)} />
    </div>
  );
}

/** The authenticated tabs gate on sign-in; a stored session restores silently (a brief boot spinner). */
function Router({ state, actions }: { state: SendState; actions: SendActions }) {
  if (state.screen === 'track') return <TrackScreen state={state} actions={actions} />;
  if (state.screen === 'parcels' || state.screen === 'account') {
    if (state.restoring) return <Boot />;
    if (!state.identity) return <AuthScreen state={state} actions={actions} />;
    return state.screen === 'parcels' ? <MyParcelsScreen state={state} actions={actions} /> : <AccountScreen state={state} actions={actions} />;
  }
  return <SendScreen state={state} actions={actions} />;
}

function Boot() {
  return (
    <div class="boot" role="status" aria-live="polite">
      <span class="boot__spinner" aria-hidden="true" />
      <p class="boot__word">Opening your account…</p>
    </div>
  );
}
