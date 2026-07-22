import { useRegisterSW } from 'virtual:pwa-register/preact';
import { BottomNav, Button, Checklist, Icon, Pill, TopBar, type NavItem } from '../../shared/ui';
import { HomeScreen } from './screens/HomeScreen';
import { LoadsScreen } from './screens/LoadsScreen';
import { OffersScreen } from './screens/OffersScreen';
import { RouteScreen } from './screens/RouteScreen';
import { SignInScreen } from './screens/SignInScreen';
import { useDriverApp, type DriverActions, type DriverState, type Screen } from './useDriverApp';
import './driver.css';

type Tab = 'home' | 'route' | 'loads';

export function App() {
  const { state, actions } = useDriverApp();
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  if (state.phase === 'outdated') return <UpdateGate />;
  if (state.phase === 'boot') return <Boot />;

  if (state.phase === 'signin') {
    return (
      <div class="app">
        <TopBar title="SeeBuyGet Driver" subtitle="Sign in" />
        <main class="app__scroll app__scroll--nonav">
          <SignInScreen onSignIn={actions.signIn} error={state.error} />
        </main>
        <Toasts state={state} actions={actions} noNav />
      </div>
    );
  }

  const onShift = state.session.active;
  const tab: Tab = state.screen === 'offers' ? 'route' : (state.screen as Tab);

  const tabs: NavItem<Tab>[] = [
    { key: 'home', label: 'My van', icon: 'truck' },
    { key: 'route', label: 'Find work', icon: 'route', disabled: !onShift },
    { key: 'loads', label: 'My loads', icon: 'box', badge: state.claims.length || undefined, disabled: !onShift },
  ];

  return (
    <div class="app">
      <TopBar
        title="SeeBuyGet Driver"
        subtitle={state.driver?.displayName}
        onBack={state.screen === 'home' ? undefined : () => actions.go('home')}
        backLabel="Back to my van"
        end={
          <>
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
            <Pill tone={onShift ? 'ok' : 'idle'} dot>
              {onShift ? 'On shift' : 'Off duty'}
            </Pill>
          </>
        }
      />

      <main class="app__scroll">
        {state.stale ? (
          <p class="stale">
            <Icon name="offline" size={20} />
            <span>No signal — showing what we last knew.</span>
          </p>
        ) : null}
        <ScreenRouter screen={state.screen} state={state} actions={actions} />
      </main>

      <BottomNav<Tab>
        items={tabs}
        active={tab}
        onSelect={(key) => actions.go(key === 'route' && state.offers.length ? 'offers' : (key as Screen))}
      />

      <Toasts state={state} actions={actions} />
    </div>
  );
}

function ScreenRouter({ screen, state, actions }: { screen: Screen; state: DriverState; actions: DriverActions }) {
  // A stale tab (or a restored PWA) can be pointing at an on-shift screen after the shift
  // ended — the legacy page rendered those against a null vehicle. Re-check every time.
  if (!state.session.active && screen !== 'home') return <HomeScreen state={state} actions={actions} />;

  switch (screen) {
    case 'route':
      return <RouteScreen state={state} actions={actions} />;
    case 'offers':
      return <OffersScreen state={state} actions={actions} />;
    case 'loads':
      return <LoadsScreen state={state} actions={actions} />;
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
  return (
    <div class="boot">
      <span class="boot__spin" aria-hidden="true" />
      <p>Getting your shift…</p>
    </div>
  );
}

/**
 * A 426 is a full-screen gate, not a toast: the server has said this build may not talk to
 * it any more, so every other affordance on screen would be a lie.
 */
function UpdateGate() {
  return (
    <div class="gate">
      <Icon name="arrowUp" size={46} class="gate__glyph" />
      <h1 class="scr__title">This app needs updating</h1>
      <p class="scr__lede">A newer version is required before you can carry on working.</p>
      <Checklist items={['Nothing you have claimed is lost', 'Updating takes a few seconds']} />
      {/* The one solid blue CTA on this screen — it carries its mandated right chevron. */}
      <Button onClick={() => location.reload()}>Update now</Button>
    </div>
  );
}
