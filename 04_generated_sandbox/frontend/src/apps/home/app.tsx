import { useRegisterSW } from 'virtual:pwa-register/preact';
import { Icon, TopBar } from '../../shared/ui';
import { useT } from '../../shared/i18n';
import { JoinScreen } from './screens/JoinScreen';
import { MarketScreen } from './screens/MarketScreen';
import { RolesScreen } from './screens/RolesScreen';
import { StoreScreen } from './screens/StoreScreen';
import { ProfileScreen } from './screens/ProfileScreen';
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

  /**
   * A subtitle says WHERE YOU ARE. Every one below is a state — joining as a driver, browsing the
   * market, signing in — and the welcome screen deliberately has none.
   *
   * It used to carry "Send · collect · earn", and that was the one screen it could not sit on: the
   * welcome screen is where the mark and the name appear together, and a strapline underneath is a
   * second voice saying the same thing less well. The identity introduces the product there; three
   * words competing with it only blunt both.
   */
  const subtitle =
    state.screen === 'join' && state.role
      ? t('home.subtitle.joining', { role: roleMeta(state.role, t).labelLower })
      : state.screen === 'market'
        ? t('home.subtitle.market')
        : state.screen === 'roles'
          ? t('home.subtitle.roles')
          : state.screen === 'signin'
            ? t('home.subtitle.signin')
            : undefined;

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
        {state.screen === 'market' ? <MarketScreen state={state} actions={actions} /> : null}
        {state.screen === 'store' ? <StoreScreen state={state} actions={actions} /> : null}
        {state.screen === 'profile' ? <ProfileScreen state={state} actions={actions} /> : null}
        {state.screen === 'roles' ? <RolesScreen actions={actions} /> : null}
        {state.screen === 'join' ? <JoinScreen state={state} actions={actions} /> : null}
        {state.screen === 'signin' ? <SignInScreen actions={actions} /> : null}
        {state.screen === 'welcome' ? <WelcomeScreen actions={actions} /> : null}
      </main>
    </div>
  );
}
