import { useRegisterSW } from 'virtual:pwa-register/preact';
import { Icon, TopBar } from '../../shared/ui';
import { useT } from '../../shared/i18n';
import { JoinScreen } from './screens/JoinScreen';
import { RolesScreen } from './screens/RolesScreen';
import { SignInScreen } from './screens/SignInScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { roleMeta } from './logic';
import { useHomeApp } from './useHomeApp';
import '../../shared/screens.css';
import './home.css';

/**
 * The front door. No bottom nav: this app is a funnel, not a workspace — every screen
 * either sends you onward to a role's app or moves you one step through joining.
 */
export function App() {
  const t = useT();
  const { state, actions } = useHomeApp();
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  const subtitle =
    state.screen === 'join' && state.role
      ? t('home.subtitle.joining', { role: roleMeta(state.role, t).labelLower })
      : state.screen === 'roles'
        ? t('home.subtitle.roles')
        : state.screen === 'signin'
          ? t('home.subtitle.signin')
          : t('home.subtitle.welcome');

  return (
    <div class="app">
      <TopBar
        title={t('home.appTitle')}
        subtitle={subtitle}
        onBack={state.screen === 'welcome' ? undefined : () => (state.screen === 'join' ? actions.back() : actions.go('welcome'))}
        backLabel={t('home.back')}
        end={
          needRefresh ? (
            <button
              type="button"
              class="topbar__lead"
              onClick={() => void sw.updateServiceWorker(true)}
              aria-label={t('home.update.aria')}
              title={t('home.update.title')}
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
