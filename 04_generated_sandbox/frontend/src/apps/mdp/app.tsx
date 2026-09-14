import { useRegisterSW } from 'virtual:pwa-register/preact';
import { OutboxNote, ConnectivityNote, BottomNav, Button, Checklist, FeedbackFlash, Icon, Pill, TopBar, type NavItem } from '../../shared/ui';
import { useT } from '../../shared/i18n';
import { fillingBags, homeSummary, unsortedAt } from './logic';
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
  const t = useT();
  const { state, actions } = useMdpApp();
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  if (state.phase === 'outdated') return <UpdateGate />;
  if (state.phase === 'boot') return <Boot />;

  if (state.phase === 'signin') {
    return (
      <div class="app">
        <TopBar title={t('mdp.appTitle')} subtitle={t('mdp.appSubtitleSignin')} />
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
    { key: 'home', label: t('mdp.nav.home'), icon: 'grid' },
    { key: 'sort', label: t('mdp.nav.sort'), icon: 'scan', badge: unsorted || undefined },
    { key: 'load', label: t('mdp.nav.bags'), icon: 'bag' },
  ];

  return (
    <div class="app">
      <TopBar
        title={t('mdp.appTitle')}
        // The SAME summary the home screen prints, from the same loaded data — the bar and the tiles
        // under it can never report different numbers because there is only one computation.
        subtitle={state.hub ? homeSummary(unsortedAt(state.inbound, state.hub.mdpId).length, fillingBags(state.totes).length, t) : undefined}
        subtitleHint={state.hub?.name}
        onBack={state.screen === 'home' ? undefined : () => actions.go('home')}
        backLabel={t('mdp.backToHub')}
        end={
          <>
            {needRefresh ? (
              <button
                type="button"
                class="topbar__lead"
                onClick={() => void sw.updateServiceWorker(true)}
                aria-label={t('mdp.update.aria')}
                title={t('mdp.update.title')}
              >
                <Icon name="refresh" size={24} />
              </button>
            ) : null}
            <Pill tone="ok" dot>
              {state.hub ? (state.hub.zones.length === 1 ? t('mdp.zoneOne', { count: state.hub.zones.length }) : t('mdp.zoneMany', { count: state.hub.zones.length })) : '…'}
            </Pill>
          </>
        }
      />

      <main class="app__scroll">
        <ConnectivityNote stale={state.stale} />
        <OutboxNote />
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
  const t = useT();
  return (
    <div class="boot">
      <span class="boot__spin" aria-hidden="true" />
      <p>{t('mdp.boot')}</p>
    </div>
  );
}

function UpdateGate() {
  const t = useT();
  return (
    <div class="gate">
      <Icon name="arrowUp" size={46} class="gate__glyph" />
      <h1 class="scr__title">{t('mdp.gate.title')}</h1>
      <p class="scr__lede">{t('mdp.gate.lede')}</p>
      <Checklist items={[t('mdp.gate.item1'), t('mdp.gate.item2')]} />
      <Button onClick={() => location.reload()}>{t('mdp.gate.cta')}</Button>
    </div>
  );
}
