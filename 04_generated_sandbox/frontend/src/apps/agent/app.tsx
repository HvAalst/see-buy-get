import { useRegisterSW } from 'virtual:pwa-register/preact';
import { BottomNav, Button, Checklist, FeedbackFlash, Icon, NotificationBell, Pill, TopBar, type NavItem } from '../../shared/ui';
import { useT } from '../../shared/i18n';
import { AcceptScreen } from './screens/AcceptScreen';
import { CollectScreen } from './screens/CollectScreen';
import { ConsignmentsScreen } from './screens/ConsignmentsScreen';
import { BagScreen } from './screens/BagScreen';
import { HandoverScreen } from './screens/HandoverScreen';
import { HomeScreen } from './screens/HomeScreen';
import { RateDriverSheet } from './screens/RateDriverSheet';
import { RatesScreen } from './screens/RatesScreen';
import { RecordsScreen } from './screens/RecordsScreen';
import { ReceiveBagScreen } from './screens/ReceiveBagScreen';
import { ReleaseScreen } from './screens/ReleaseScreen';
import { ShelfScreen } from './screens/ShelfScreen';
import { SignInScreen } from './screens/SignInScreen';
import { VoidScreen } from './screens/VoidScreen';
import { useAgentApp, type AgentActions, type AgentState, type Screen } from './useAgentApp';
import '../../shared/screens.css';
import './agent.css';

type Tab = 'home' | 'accept' | 'release' | 'records';

export function App() {
  const t = useT();
  const { state, actions, notifications } = useAgentApp();
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  if (state.phase === 'outdated') return <UpdateGate />;
  if (state.phase === 'boot') return <Boot />;

  if (state.phase === 'signin') {
    return (
      <div class="app">
        <TopBar title={t('agent.appTitle')} subtitle={t('agent.signInSubtitle')} />
        <main class="app__scroll app__scroll--nonav">
          <SignInScreen actions={actions} error={state.error} busy={state.busy === 'signin'} />
        </main>
        <Toasts state={state} actions={actions} noNav />
      </div>
    );
  }

  const open = state.agent?.openState !== 'closed';
  const tab: Tab = state.screen === 'accept' ? 'accept' : state.screen === 'release' ? 'release' : state.screen === 'records' ? 'records' : 'home';

  const tabs: NavItem<Tab>[] = [
    { key: 'home', label: t('agent.nav.home'), icon: 'home' },
    { key: 'accept', label: t('agent.nav.accept'), icon: 'box' },
    { key: 'release', label: t('agent.nav.release'), icon: 'person' },
    { key: 'records', label: t('agent.nav.records'), icon: 'grid' },
  ];

  return (
    <div class="app">
      <TopBar
        title={t('agent.appTitle')}
        subtitle={state.agent?.shopName}
        onBack={state.screen === 'home' ? undefined : () => actions.go('home')}
        backLabel={t('agent.backToShop')}
        end={
          <>
            <NotificationBell api={notifications} />
            {needRefresh ? (
              <button
                type="button"
                class="topbar__lead"
                onClick={() => void sw.updateServiceWorker(true)}
                aria-label={t('agent.update.aria')}
                title={t('agent.update.title')}
              >
                <Icon name="refresh" size={24} />
              </button>
            ) : null}
            <Pill tone={open ? 'ok' : 'idle'} dot>
              {open ? t('agent.open') : t('agent.closed')}
            </Pill>
          </>
        }
      />

      <main class="app__scroll">
        {state.stale ? (
          <p class="stale">
            <Icon name="offline" size={20} />
            <span>{t('agent.stale')}</span>
          </p>
        ) : null}
        <ScreenRouter screen={state.screen} state={state} actions={actions} />
      </main>

      <BottomNav<Tab> items={tabs} active={tab} onSelect={(key) => actions.go(key as Screen)} />

      {/* REP2 — the "rate the driver" prompt (after a handover / bag-receipt); keyed so the form resets per driver. */}
      <RateDriverSheet key={state.driverRating?.driverDid ?? 'none'} state={state} actions={actions} />

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
    case 'bag':
      return <BagScreen state={state} actions={actions} />;
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
    case 'consignments':
      return <ConsignmentsScreen state={state} actions={actions} />;
    case 'records':
      return <RecordsScreen state={state} actions={actions} />;
    case 'shelf':
      return <ShelfScreen state={state} actions={actions} />;
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
  const t = useT();
  return (
    <div class="boot">
      <span class="boot__spin" aria-hidden="true" />
      <p>{t('agent.boot')}</p>
    </div>
  );
}

function UpdateGate() {
  const t = useT();
  return (
    <div class="gate">
      <Icon name="arrowUp" size={46} class="gate__glyph" />
      <h1 class="scr__title">{t('agent.update.gateTitle')}</h1>
      <p class="scr__lede">{t('agent.update.gateBody')}</p>
      <Checklist items={[t('agent.update.safe'), t('agent.update.seconds')]} />
      <Button onClick={() => location.reload()}>{t('agent.update.cta')}</Button>
    </div>
  );
}
