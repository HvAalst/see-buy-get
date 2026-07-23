import { useRegisterSW } from 'virtual:pwa-register/preact';
import { BottomNav, Button, Checklist, FeedbackFlash, Icon, Pill, TopBar, type NavItem } from '../../shared/ui';
import { unsortedAt } from './logic';
import { DropScreen } from './screens/DropScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LoadScreen } from './screens/LoadScreen';
import { NewToteScreen } from './screens/NewToteScreen';
import { RatesScreen } from './screens/RatesScreen';
import { SortScreen } from './screens/SortScreen';
import { SignInScreen } from './screens/SignInScreen';
import { useMdpApp, type MdpActions, type MdpState, type Screen } from './useMdpApp';
import '../../shared/screens.css';
import './mdp.css';

type Tab = 'home' | 'sort' | 'load';

export function App() {
  const { state, actions } = useMdpApp();
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  if (state.phase === 'outdated') return <UpdateGate />;
  if (state.phase === 'boot') return <Boot />;

  if (state.phase === 'signin') {
    return (
      <div class="app">
        <TopBar title="SeeBuyGet Hub" subtitle="Sign in" />
        <main class="app__scroll app__scroll--nonav">
          <SignInScreen actions={actions} error={state.error} busy={state.busy === 'signin'} />
        </main>
        <Toasts state={state} actions={actions} noNav />
      </div>
    );
  }

  const unsorted = state.hub ? unsortedAt(state.inbound, state.hub.mdpId).length : 0;
  const tab: Tab = state.screen === 'sort' || state.screen === 'drop' ? 'sort' : state.screen === 'load' || state.screen === 'newtote' ? 'load' : 'home';

  const tabs: NavItem<Tab>[] = [
    { key: 'home', label: 'My hub', icon: 'grid' },
    { key: 'sort', label: 'Sort', icon: 'scan', badge: unsorted || undefined },
    { key: 'load', label: 'Bags', icon: 'bag' },
  ];

  return (
    <div class="app">
      <TopBar
        title="SeeBuyGet Hub"
        subtitle={state.hub?.name}
        onBack={state.screen === 'home' ? undefined : () => actions.go('home')}
        backLabel="Back to my hub"
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
            <Pill tone="ok" dot>
              {state.hub ? `${state.hub.zones.length} zone${state.hub.zones.length === 1 ? '' : 's'}` : '…'}
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

      <BottomNav<Tab> items={tabs} active={tab} onSelect={(key) => actions.go(key as Screen)} />

      <Toasts state={state} actions={actions} />
      <FeedbackFlash />
    </div>
  );
}

function ScreenRouter({ screen, state, actions }: { screen: Screen; state: MdpState; actions: MdpActions }) {
  switch (screen) {
    case 'drop':
      return <DropScreen state={state} actions={actions} />;
    case 'sort':
      return <SortScreen state={state} actions={actions} />;
    case 'load':
      return <LoadScreen state={state} actions={actions} />;
    case 'newtote':
      return <NewToteScreen state={state} actions={actions} />;
    case 'rates':
      return <RatesScreen state={state} actions={actions} />;
    default:
      return <HomeScreen state={state} actions={actions} />;
  }
}

function Toasts({ state, actions, noNav }: { state: MdpState; actions: MdpActions; noNav?: boolean }) {
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
      <p>Opening the sort floor…</p>
    </div>
  );
}

function UpdateGate() {
  return (
    <div class="gate">
      <Icon name="arrowUp" size={46} class="gate__glyph" />
      <h1 class="scr__title">This app needs updating</h1>
      <p class="scr__lede">A newer version is required before you can carry on working.</p>
      <Checklist items={['Nothing on the floor is lost', 'Updating takes a few seconds']} />
      <Button onClick={() => location.reload()}>Update now</Button>
    </div>
  );
}
