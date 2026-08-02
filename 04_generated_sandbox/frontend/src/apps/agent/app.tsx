import { useRegisterSW } from 'virtual:pwa-register/preact';
import { BottomNav, Button, Checklist, FeedbackFlash, Icon, NotificationBell, Pill, TopBar, type NavItem } from '../../shared/ui';
import { AcceptScreen } from './screens/AcceptScreen';
import { CollectScreen } from './screens/CollectScreen';
import { HandoverScreen } from './screens/HandoverScreen';
import { HomeScreen } from './screens/HomeScreen';
import { RatesScreen } from './screens/RatesScreen';
import { ReceiveBagScreen } from './screens/ReceiveBagScreen';
import { ReleaseScreen } from './screens/ReleaseScreen';
import { SignInScreen } from './screens/SignInScreen';
import { VoidScreen } from './screens/VoidScreen';
import { useAgentApp, type AgentActions, type AgentState, type Screen } from './useAgentApp';
import '../../shared/screens.css';
import './agent.css';

type Tab = 'home' | 'accept' | 'release';

export function App() {
  const { state, actions, notifications } = useAgentApp();
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  if (state.phase === 'outdated') return <UpdateGate />;
  if (state.phase === 'boot') return <Boot />;

  if (state.phase === 'signin') {
    return (
      <div class="app">
        <TopBar title="SeeBuyGet Agent" subtitle="Sign in" />
        <main class="app__scroll app__scroll--nonav">
          <SignInScreen actions={actions} error={state.error} busy={state.busy === 'signin'} />
        </main>
        <Toasts state={state} actions={actions} noNav />
      </div>
    );
  }

  const open = state.agent?.openState !== 'closed';
  const tab: Tab = state.screen === 'accept' ? 'accept' : state.screen === 'release' ? 'release' : 'home';

  const tabs: NavItem<Tab>[] = [
    { key: 'home', label: 'My shop', icon: 'home' },
    { key: 'accept', label: 'Take in', icon: 'box' },
    { key: 'release', label: 'Hand out', icon: 'person' },
  ];

  return (
    <div class="app">
      <TopBar
        title="SeeBuyGet Agent"
        subtitle={state.agent?.shopName}
        onBack={state.screen === 'home' ? undefined : () => actions.go('home')}
        backLabel="Back to my shop"
        end={
          <>
            <NotificationBell api={notifications} />
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
            <Pill tone={open ? 'ok' : 'idle'} dot>
              {open ? 'Open' : 'Closed'}
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

function ScreenRouter({ screen, state, actions }: { screen: Screen; state: AgentState; actions: AgentActions }) {
  switch (screen) {
    case 'accept':
      return <AcceptScreen state={state} actions={actions} />;
    case 'handover':
      return <HandoverScreen state={state} actions={actions} />;
    case 'release':
      return <ReleaseScreen state={state} actions={actions} />;
    case 'collect':
      return <CollectScreen state={state} actions={actions} />;
    case 'receivebag':
      return <ReceiveBagScreen state={state} actions={actions} />;
    case 'void':
      return <VoidScreen state={state} actions={actions} />;
    case 'rates':
      return <RatesScreen state={state} actions={actions} />;
    default:
      return <HomeScreen state={state} actions={actions} />;
  }
}

function Toasts({ state, actions, noNav }: { state: AgentState; actions: AgentActions; noNav?: boolean }) {
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
      <p>Opening your shop…</p>
    </div>
  );
}

function UpdateGate() {
  return (
    <div class="gate">
      <Icon name="arrowUp" size={46} class="gate__glyph" />
      <h1 class="scr__title">This app needs updating</h1>
      <p class="scr__lede">A newer version is required before you can carry on working.</p>
      <Checklist items={['Your wallet and parcels are safe', 'Updating takes a few seconds']} />
      <Button onClick={() => location.reload()}>Update now</Button>
    </div>
  );
}
