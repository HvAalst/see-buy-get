import { useRegisterSW } from 'virtual:pwa-register/preact';
import { Icon, TopBar } from '../../shared/ui';
import { useEffect, useState } from 'preact/hooks';
import { Suspense } from 'preact/compat';
import { useT } from '../../shared/i18n';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { TownScreen } from './screens/TownScreen';
import { InfoScreen } from './screens/InfoScreen';
import { PublicShell } from './screens/PublicShell';
import { welcomeSpoken } from './logic';
import { lookAtDocumentLink, lookAtReportLink, takeDocumentLink, takeReportLink, verifyNote } from './api';
// Not in the homepage's first download: each is fetched when it is opened (lazyScreens.ts).
import { AgentsScreen, DamageReportLinkPage, DocumentLinkPage, JoinScreen, MarketScreen, NoteCheck, ProfileScreen, RolesScreen, SignInScreen, StoreScreen, directoryScreen, helpScreen, loadDirectoryPage, loadHelpPage } from './lazyScreens';
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
  // A help page is loaded before it is drawn (main.tsx); reached any other way, it is brought in here, then drawn.
  const [, helpArrived] = useState(0);
  useEffect(() => {
    if (state.screen === 'help' && !helpScreen()) void loadHelpPage().then(() => helpArrived((n) => n + 1));
    if (state.screen === 'directory' && !directoryScreen()) void loadDirectoryPage().then(() => helpArrived((n) => n + 1));
  }, [state.screen]);

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
  if (state.screen === 'help' && state.helpPage) {
    const Help = helpScreen();
    return Help ? <Help page={state.helpPage} update={needRefresh ? () => void sw.updateServiceWorker(true) : undefined} /> : null;
  }
  // The public site — the front page and the pages written to be quoted — in its own frame and look (public.css).
  const update = needRefresh ? () => void sw.updateServiceWorker(true) : undefined;
  if (state.screen === 'welcome') {
    return (
      <PublicShell update={update} readAloud={() => welcomeSpoken(t)}>
        <WelcomeScreen actions={actions} />
      </PublicShell>
    );
  }
  if (state.screen === 'info' && state.infoPage) {
    return (
      <PublicShell update={update}>
        <InfoScreen page={state.infoPage} />
      </PublicShell>
    );
  }
  // The logistics directory: the public site's frame, its code brought in before it is drawn (main.tsx).
  if (state.screen === 'directory' && state.directoryPage) {
    const Directory = directoryScreen();
    return <PublicShell update={update}>{Directory ? <Directory page={state.directoryPage} /> : <div class="pg" aria-busy="true" />}</PublicShell>;
  }

  return (
    <div class="app">
      <TopBar
        title={t('home.appTitle')}
        subtitle={subtitle}
        onBack={() => (state.screen === 'join' ? actions.back() : state.screen === 'town' ? location.assign('/') : state.screen === 'help' ? location.assign(state.helpPage?.kind === 'index' ? '/' : '/help/') : state.screen === 'info' ? location.assign(state.infoPage?.kind === 'about' ? '/' : '/about/') : actions.go('welcome'))}
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
          </>
        }
      />

      <main class={`app__scroll app__scroll--nonav${state.screen === 'info' ? ' app__scroll--land' : ''}`}>
        <Suspense fallback={<div class="scr" aria-busy="true" />}>
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
        {state.screen === 'town' && state.townSlug ? <TownScreen slug={state.townSlug} /> : null}
        {state.screen === 'info' && state.infoPage ? <InfoScreen page={state.infoPage} /> : null}
        </Suspense>
      </main>
    </div>
  );
}
