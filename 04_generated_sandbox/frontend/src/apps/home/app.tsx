import { useRegisterSW } from 'virtual:pwa-register/preact';
import { Icon, TopBar } from '../../shared/ui';
import { JoinScreen } from './screens/JoinScreen';
import { RolesScreen } from './screens/RolesScreen';
import { SignInScreen } from './screens/SignInScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { useHomeApp } from './useHomeApp';
import '../../shared/screens.css';
import './home.css';

/**
 * The front door. No bottom nav: this app is a funnel, not a workspace — every screen
 * either sends you onward to a role's app or moves you one step through joining.
 */
export function App() {
  const { state, actions } = useHomeApp();
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  const subtitle =
    state.screen === 'join' && state.role
      ? `Joining as ${state.role.label.toLowerCase()}`
      : state.screen === 'roles'
        ? 'Join the network'
        : state.screen === 'signin'
          ? 'Sign in'
          : 'Send · collect · earn';

  return (
    <div class="app">
      <TopBar
        title="SeeBuyGet"
        subtitle={subtitle}
        onBack={state.screen === 'welcome' ? undefined : () => (state.screen === 'join' ? actions.back() : actions.go('welcome'))}
        backLabel="Back"
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

      <main class="app__scroll app__scroll--nonav">
        {state.screen === 'roles' ? <RolesScreen actions={actions} /> : null}
        {state.screen === 'join' ? <JoinScreen state={state} actions={actions} /> : null}
        {state.screen === 'signin' ? <SignInScreen actions={actions} /> : null}
        {state.screen === 'welcome' ? <WelcomeScreen actions={actions} /> : null}
      </main>
    </div>
  );
}
