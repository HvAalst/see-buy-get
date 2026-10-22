import { useRegisterSW } from 'virtual:pwa-register/preact';
import { Icon, TopBar } from '../../shared/ui';
import { useT } from '../../shared/i18n';
import { JoinScreen } from './screens/JoinScreen';
import { AgentsScreen } from './screens/AgentsScreen';
import { MarketScreen } from './screens/MarketScreen';
import { RolesScreen } from './screens/RolesScreen';
import { StoreScreen } from './screens/StoreScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SignInScreen } from './screens/SignInScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { TownScreen } from './screens/TownScreen';
import { HelpScreen } from './screens/HelpScreen';
import { NoteCheck } from '../../shared/archive/NoteCheck';
import { lookAtDocumentLink, lookAtReportLink, takeDocumentLink, takeReportLink, verifyNote } from './api';
import { DamageReportLinkPage } from '../../shared/damage/DamageReportLinkPage';
import { DocumentLinkPage } from '../../shared/archive/DocumentLinkPage';
import { roleMeta } from './logic';
import { useHomeApp } from './useHomeApp';
import '../../shared/screens.css';
import './home.css';
import './landing.css';

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
            : state.screen === 'help'
              ? t('help.ui.title')
              : undefined;

  // The help is a reading page of its own (help.css): its own top bar, its own look — not inside the app's.
  if (state.screen === 'help' && state.helpPage) return <HelpScreen page={state.helpPage} />;

  return (
    <div class="app">
      <TopBar
        title={t('home.appTitle')}
        subtitle={subtitle}
        onBack={state.screen === 'welcome' ? undefined : () => (state.screen === 'join' ? actions.back() : state.screen === 'town' ? location.assign('/') : state.screen === 'help' ? location.assign(state.helpPage?.kind === 'index' ? '/' : '/help/') : actions.go('welcome'))}
        backLabel={t('home.back')}
        end={
          <>
            {needRefresh ? (
              <button
                type="button"
                class="topbar__lead"
                onClick={() => void sw.updateServiceWorker(true)}
                aria-label={t('home.update.aria')}
                title={t('home.update.title')}
              >
                <Icon name="refresh" size={24} />
              </button>
            ) : null}
            {/* The returning visitor's door, on every visit and in the same place: the top right. */}
            {state.screen === 'welcome' ? (
              <a
                class="topbar__signin"
                href="/?go=signin"
                onClick={(e) => {
                  e.preventDefault();
                  actions.go('signin');
                }}
              >
                {t('home.landing.signIn')}
              </a>
            ) : null}
          </>
        }
      />

      <main class={`app__scroll app__scroll--nonav${state.screen === 'welcome' ? ' app__scroll--land' : ''}`}>
        {state.screen === 'market' ? <MarketScreen state={state} actions={actions} /> : null}
        {state.screen === 'store' ? <StoreScreen state={state} actions={actions} /> : null}
        {state.screen === 'profile' ? <ProfileScreen state={state} actions={actions} /> : null}
        {state.screen === 'agents' ? <AgentsScreen state={state} actions={actions} /> : null}
        {state.screen === 'roles' ? <RolesScreen actions={actions} /> : null}
        {state.screen === 'join' ? <JoinScreen state={state} actions={actions} /> : null}
        {state.screen === 'signin' ? <SignInScreen actions={actions} /> : null}
        {state.screen === 'verify' ? (
          <NoteCheck
            /* Null for a call that never landed, so the screen can tell "we could not reach us" from
               "we did not issue this" — two very different things to say to somebody with a document. */
            check={async (sha256) => {
              const r = await verifyNote(sha256);
              return r.error || !r.data ? null : r.data;
            }}
            initial={state.verifyInitial}
            bare
          />
        ) : null}
        {state.screen === 'document' && state.docKey !== undefined ? (
          <DocumentLinkPage linkKey={state.docKey} look={lookAtDocumentLink} take={takeDocumentLink} onVerify={() => actions.go('verify')} />
        ) : null}
        {state.screen === 'report' && state.reportKey !== undefined ? <DamageReportLinkPage linkKey={state.reportKey} look={lookAtReportLink} take={takeReportLink} /> : null}
        {state.screen === 'welcome' ? <WelcomeScreen actions={actions} /> : null}
        {state.screen === 'town' && state.townSlug ? <TownScreen slug={state.townSlug} /> : null}
      </main>
    </div>
  );
}
