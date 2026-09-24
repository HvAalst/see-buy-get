import { useRegisterSW } from 'virtual:pwa-register/preact';
import { ConnectivityNote, BottomNav, Button, Checklist, FeedbackFlash, Icon, NotificationBell, OutboxNote, Pill, TopBar, type NavItem } from '../../shared/ui';
import { useT } from '../../shared/i18n';
import { BoardScreen } from './screens/BoardScreen';
import { EarningsScreen } from './screens/EarningsScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LoadsScreen } from './screens/LoadsScreen';
import { OffersScreen } from './screens/OffersScreen';
import { RouteScreen } from './screens/RouteScreen';
import { SignInScreen } from './screens/SignInScreen';
import { useDriverApp, type DriverActions, type DriverState, type Screen } from './useDriverApp';
import '../../shared/screens.css';
import './driver.css';
import { driverWorkLine } from './logic';

type Tab = 'home' | 'route' | 'board' | 'loads' | 'earnings';

export function App() {
  const t = useT();
  const { state, actions, notifications } = useDriverApp();
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  if (state.phase === 'outdated') return <UpdateGate />;
  if (state.phase === 'boot') return <Boot />;

  if (state.phase === 'signin') {
    return (
      <div class="app">
        <TopBar title={t('driver.appTitle')} subtitle={t('driver.signinSubtitle')} />
        <main class="app__scroll app__scroll--nonav">
          <SignInScreen onSignIn={actions.signIn} onSendCode={actions.sendPinCode} onSetPin={actions.setPinAndSignIn} error={state.error} />
        </main>
        <Toasts state={state} actions={actions} noNav />
      </div>
    );
  }

  const onShift = state.session.active;
  const tab: Tab = state.screen === 'offers' ? 'route' : (state.screen as Tab);


  const tabs: NavItem<Tab>[] = [
    { key: 'home', label: t('driver.nav.home'), icon: 'truck' },
    { key: 'route', label: t('driver.nav.route'), icon: 'route', disabled: !onShift },
    // FB2 — deliberately NOT gated on the shift. Deciding whether to buy a tail-lift, or whether this
    // corridor is worth running at all, is a thing an operator does at the coffee table with the engine off.
    { key: 'board', label: t('driver.nav.board'), icon: 'search' },
    { key: 'loads', label: t('driver.nav.loads'), icon: 'box', badge: state.claims.length || undefined, disabled: !onShift },
    { key: 'earnings', label: t('driver.nav.earnings'), icon: 'wallet' },
  ];

  return (
    <div class="app">
      <TopBar
        title={t('driver.appTitle')}
        subtitle={driverWorkLine(state.session, state.route, state.remainingTotes, t)}
        subtitleHint={state.driver?.displayName}
        onBack={state.screen === 'home' ? undefined : () => actions.go('home')}
        backLabel={t('driver.backToVan')}
        end={
          <>
            <NotificationBell api={notifications} />
            {needRefresh ? (
              <button
                type="button"
                class="topbar__lead"
                onClick={() => void sw.updateServiceWorker(true)}
                aria-label={t('driver.update.aria')}
                title={t('driver.update.title')}
              >
                <Icon name="refresh" size={24} />
              </button>
            ) : null}
            <Pill tone={onShift ? 'ok' : 'idle'} dot>
              {onShift ? t('driver.onShift') : t('driver.offDuty')}
            </Pill>
          </>
        }
      />

      <main class="app__scroll">
        <ConnectivityNote stale={state.stale} />
        <OutboxNote />
        <ScreenRouter screen={state.screen} state={state} actions={actions} />
      </main>

      <BottomNav<Tab>
        items={tabs}
        active={tab}
        onSelect={(key) => actions.go(key === 'route' && state.offers.length ? 'offers' : (key as Screen))}
        labels={false}
      />

      <Toasts state={state} actions={actions} />
      <FeedbackFlash />
    </div>
  );
}

function ScreenRouter({ screen, state, actions }: { screen: Screen; state: DriverState; actions: DriverActions }) {
  // A stale tab (or a restored PWA) can be pointing at an on-shift screen after the shift
  // ended — the legacy page rendered those against a null vehicle. Re-check every time.
  // Earnings is exempt: a driver reviews their jobs + pay whether or not they're on shift. So is the market
  // board — shopping for work, and deciding what to buy next, is exactly what happens off shift.
  if (!state.session.active && screen !== 'home' && screen !== 'earnings' && screen !== 'board') return <HomeScreen state={state} actions={actions} />;

  switch (screen) {
    case 'route':
      return <RouteScreen state={state} actions={actions} />;
    case 'board':
      return <BoardScreen state={state} actions={actions} />;
    case 'offers':
      return <OffersScreen state={state} actions={actions} />;
    case 'loads':
      return <LoadsScreen state={state} actions={actions} />;
    case 'earnings':
      return <EarningsScreen state={state} actions={actions} />;
    default:
      return <HomeScreen state={state} actions={actions} />;
  }
}

function Toasts({ state, actions, noNav }: { state: DriverState; actions: DriverActions; noNav?: boolean }) {
  if (state.toasts.length === 0) return null;
  return (
    <div class={`toasts${noNav ? ' toasts--nonav' : ''}`} role="status" aria-live="polite">
      {state.toasts.map((t) => (
        <button type="button" class="toast" key={t.id} onClick={() => actions.dismissToast(t.id)}>
          {t.icon ? <Icon name={t.icon} size={20} class="toast__ic" /> : null}
          <span>
            <span class="toast__t">{t.title}</span>
            {t.detail ? <span class="toast__d">{` ${t.detail}`}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

function Boot() {
  const t = useT();
  return (
    <div class="boot">
      <span class="boot__spin" aria-hidden="true" />
      <p>{t('driver.boot')}</p>
    </div>
  );
}

/**
 * A 426 is a full-screen gate, not a toast: the server has said this build may not talk to
 * it any more, so every other affordance on screen would be a lie.
 */
function UpdateGate() {
  const t = useT();
  return (
    <div class="gate">
      <Icon name="arrowUp" size={46} class="gate__glyph" />
      <h1 class="scr__title">{t('driver.gate.title')}</h1>
      <p class="scr__lede">{t('driver.gate.body')}</p>
      <Checklist items={[t('driver.gate.item1'), t('driver.gate.item2')]} />
      {/* The one solid blue CTA on this screen — it carries its mandated right chevron. */}
      <Button onClick={() => location.reload()}>{t('driver.gate.cta')}</Button>
    </div>
  );
}
