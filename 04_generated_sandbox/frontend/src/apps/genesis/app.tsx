import { useRegisterSW } from 'virtual:pwa-register/preact';
import { BottomNav, Icon, TopBar, type NavItem } from '../../shared/ui';
import { SendScreen } from './screens/SendScreen';
import { TrackScreen } from './screens/TrackScreen';
import { useSendApp, type Screen } from './useSendApp';
import '../../shared/screens.css';
import './send.css';

/**
 * The consumer shell: two tabs, no sign-in, no boot phase — the first paint IS the first
 * question. The SW update prompt keeps the icon-only pattern of the signed-in apps.
 */
export function App() {
  const { state, actions } = useSendApp();
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  const tabs: NavItem<Screen>[] = [
    { key: 'send', label: 'Send', icon: 'send' },
    { key: 'track', label: 'Track', icon: 'search' },
  ];

  return (
    <div class="app">
      <TopBar
        title="SeeBuyGet Send"
        subtitle="See the price. Pay at the shop."
        end={
          needRefresh ? (
            <button
              type="button"
              class="topbar__lead"
              onClick={() => void sw.updateServiceWorker(true)}
              aria-label="A new version is ready — update now"
              title="Update the app"
            >
              <Icon name="refresh" size={24} />
            </button>
          ) : null
        }
      />

      <main class="app__scroll">{state.screen === 'track' ? <TrackScreen state={state} actions={actions} /> : <SendScreen state={state} actions={actions} />}</main>

      <BottomNav<Screen> items={tabs} active={state.screen} onSelect={(key) => actions.go(key)} />
    </div>
  );
}
