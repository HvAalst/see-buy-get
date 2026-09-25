import { EarningsScreen } from './screens/EarningsScreen';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { ConnectivityNote, BottomNav, Button, Checklist, Icon, Pill, TopBar, type NavItem } from '../../shared/ui';
import { AccountMenu } from '../../shared/account/AccountMenu';
import { useAccount } from '../../shared/account/useAccount';
import { useT } from '../../shared/i18n';
import { DashboardScreen } from './screens/DashboardScreen';
import { DriversScreen } from './screens/DriversScreen';
import { LinesScreen } from './screens/LinesScreen';
import { RunsScreen } from './screens/RunsScreen';
import { SessionsScreen } from './screens/SessionsScreen';
import { SignInScreen } from './screens/SignInScreen';
import { VehiclesScreen } from './screens/VehiclesScreen';
import { DispatchScreen } from './screens/DispatchScreen';
import { useFleetApp, type FleetActions, type FleetState, type Screen } from './useFleetApp';
import '../../shared/screens.css';
import './fleet.css';
import { fleetWorkLine } from './logic';

export function App() {
  const t = useT();
  const { state, actions , sbg } = useFleetApp();
  // The person behind this account — their photo, PIN, address and page. The menu is ABSENT where the
  // sign-in is not a person at all (a store's shared secret), rather than opening onto a refusal.
  const account = useAccount(sbg, state.phase === 'ready');
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  if (state.phase === 'outdated') return <UpdateGate />;
  if (state.phase === 'boot') return <Boot />;

  if (state.phase === 'signin') {
    return (
      <div class="app">
        <TopBar title={t('fleet.appTitle')} subtitle={t('fleet.signInSubtitle')} />
        <main class="app__scroll app__scroll--nonav">
          <SignInScreen actions={actions} error={state.error} busy={state.busy === 'signin'} company={state.company} />
        </main>
        <Toasts state={state} actions={actions} noNav />
      </div>
    );
  }

  const onShift = state.dashboard?.sessions.active ?? 0;
  // A badge of open runs, which is the one number on this tab that changes on its own — a shipper booking
  // space is somebody else acting on the fleet's behalf, and the office should see it without looking.
  const openRuns = state.departures.filter((d) => d.status === 'open').length;

  const tabs: NavItem<Screen>[] = [
    { key: 'dash', label: t('fleet.nav.dash'), icon: 'grid' },
    { key: 'vehicles', label: t('fleet.nav.vehicles'), icon: 'truck' },
    { key: 'drivers', label: t('fleet.nav.drivers'), icon: 'person' },
    { key: 'sessions', label: t('fleet.nav.sessions'), icon: 'route', badge: onShift || undefined },
    { key: 'lines', label: t('fleet.nav.lines'), icon: 'repeat' },
    // F3 — its own tab, not a section under Lines. Drawing a line is setup, once per road; putting a
    // departure on one is the weekly work, and burying this week's run under that form inverts the two.
    { key: 'runs', label: t('fleet.nav.runs'), icon: 'clock', badge: openRuns || undefined },
  ];

  return (
    <div class="app">
      <TopBar
        title={t('fleet.appTitle')}
        subtitle={fleetWorkLine(state.dashboard, t)}
        subtitleHint={state.manager?.company}
        onBack={state.screen === 'dash' ? undefined : () => actions.go('dash')}
        backLabel={t('fleet.backLabel')}
        end={
          <>
            {needRefresh ? (
              <button
                type="button"
                class="topbar__lead"
                onClick={() => void sw.updateServiceWorker(true)}
                aria-label={t('fleet.update.aria')}
                title={t('fleet.update.title')}
              >
                <Icon name="refresh" size={24} />
              </button>
            ) : null}
            <Pill tone={onShift ? 'ok' : 'idle'} dot>
              {t('fleet.onShift', { count: onShift })}
            </Pill>
            {/* Last in the bar: live state first, the place you visit last. */}
            <AccountMenu api={account} app="fleet" onSignOut={actions.signOut} />
          </>
        }
      />

      <main class="app__scroll">
        <ConnectivityNote stale={state.stale} />
        <ScreenRouter screen={state.screen} state={state} actions={actions} />
      </main>

      <BottomNav<Screen> items={tabs} active={state.screen} onSelect={(key) => actions.go(key)} labels={false} />

      <Toasts state={state} actions={actions} />
    </div>
  );
}

function ScreenRouter({ screen, state, actions }: { screen: Screen; state: FleetState; actions: FleetActions }) {
  switch (screen) {
    case 'vehicles':
      return <VehiclesScreen state={state} actions={actions} />;
    case 'drivers':
      return <DriversScreen state={state} actions={actions} />;
    case 'sessions':
      return <SessionsScreen state={state} actions={actions} />;
    case 'lines':
      return <LinesScreen state={state} actions={actions} />;
    case 'runs':
      return <RunsScreen state={state} actions={actions} />;
    case 'earnings':
      return <EarningsScreen state={state} actions={actions} />;
    case 'dispatch':
      return <DispatchScreen state={state} actions={actions} />;
    default:
      return <DashboardScreen state={state} actions={actions} />;
  }
}

function Toasts({ state, actions, noNav }: { state: FleetState; actions: FleetActions; noNav?: boolean }) {
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
      <p>{t('fleet.boot')}</p>
    </div>
  );
}

function UpdateGate() {
  const t = useT();
  return (
    <div class="gate">
      <Icon name="arrowUp" size={46} class="gate__glyph" />
      <h1 class="scr__title">{t('fleet.gate.title')}</h1>
      <p class="scr__lede">{t('fleet.gate.body')}</p>
      <Checklist items={[t('fleet.gate.safe'), t('fleet.gate.quick')]} />
      <Button onClick={() => location.reload()}>{t('fleet.gate.cta')}</Button>
    </div>
  );
}
