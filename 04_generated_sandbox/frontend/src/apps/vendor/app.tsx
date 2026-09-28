import { useRegisterSW } from 'virtual:pwa-register/preact';
import { ConnectivityNote, BottomNav, Button, Checklist, Icon, NotificationBell, Pill, TopBar, type NavItem } from '../../shared/ui';
import { AccountMenu } from '../../shared/account/AccountMenu';
import { useAccount } from '../../shared/account/useAccount';
import { ArchiveSection } from '../../shared/archive/ArchiveSection';
import { useArchive, type ArchiveApiState } from '../../shared/archive/useArchive';
import { useDestination, type DestinationApiState } from '../../shared/archive/useDestination';
import { useT } from '../../shared/i18n';
import { money, vendorWorkLine } from './logic';
import { BooksScreen } from './screens/BooksScreen';
import { DockScreen } from './screens/DockScreen';
import { MintScreen } from './screens/MintScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { SignInScreen } from './screens/SignInScreen';
import { StoreScreen } from './screens/StoreScreen';
import { useVendorApp, type Screen, type VendorActions, type VendorState } from './useVendorApp';
import '../../shared/screens.css';
import './vendor.css';

export function App() {
  const t = useT();
  const { state, actions, sbg } = useVendorApp();
  // The person behind this account — their photo, PIN, address and page. The menu is ABSENT where the
  // sign-in is not a person at all (a store signs in with a shared secret), rather than opening onto a refusal.
  const account = useAccount(sbg, state.phase === 'ready');
  // A store that ships is a party to a consignment note, and the note — not the order list — is what an
  // insurer, a customs officer or a buyer's lawyer asks for. Fetched only when the screen is open.
  const archive = useArchive(sbg, state.phase === 'ready' && state.screen === 'notes');
  const destination = useDestination(sbg, state.phase === 'ready' && state.screen === 'notes');
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  if (state.phase === 'outdated') return <UpdateGate />;
  if (state.phase === 'boot') return <Boot />;

  if (state.phase === 'signin') {
    return (
      <div class="app">
        <TopBar title={t('vendor.appTitle')} subtitle={t('vendor.signInSubtitle')} />
        <main class="app__scroll app__scroll--nonav">
          <SignInScreen state={state} actions={actions} error={state.error} />
        </main>
        <Toasts state={state} actions={actions} noNav />
      </div>
    );
  }

  const tabs: NavItem<Screen>[] = [
    { key: 'orders', label: t('vendor.nav.orders'), icon: 'box', badge: state.checkouts.length || undefined },
    { key: 'mint', label: t('vendor.nav.ship'), icon: 'send' },
    { key: 'books', label: t('vendor.nav.books'), icon: 'wallet' },
    // Shown to every store, including those with no dock — the capability has been complete and invisible,
    // and a tab a merchant can find is the only way they learn it exists. Its empty state is the pitch.
    { key: 'dock', label: t('vendor.nav.dock'), icon: 'truck', badge: state.dock?.staging.used || undefined },
    { key: 'notes', label: t('vendor.nav.notes'), icon: 'badge' },
    { key: 'store', label: t('vendor.nav.store'), icon: 'home' },
  ];

  return (
    <div class="app">
      <TopBar
        title={t('vendor.appTitle')}
        subtitle={vendorWorkLine(state.orderStats, t)}
        subtitleHint={state.vendor?.name}
        onBack={state.screen === 'orders' ? undefined : () => actions.go('orders')}
        backLabel={t('vendor.backToOrders')}
        end={
          <>
            <NotificationBell api={actions.notifications} />
            {needRefresh ? (
              <button
                type="button"
                class="topbar__lead"
                onClick={() => void sw.updateServiceWorker(true)}
                aria-label={t('vendor.update.aria')}
                title={t('vendor.update.title')}
              >
                <Icon name="refresh" size={24} />
              </button>
            ) : null}
            {state.vendor?.balance === null ? null : (
              <Pill tone={(state.vendor?.balance ?? 0) > 0 ? 'ok' : 'idle'} dot>
                {money(state.vendor?.balance)}
              </Pill>
            )}
            {/* Last in the bar: live state first, the place you visit last. */}
            <AccountMenu api={account} app="vendor" onSignOut={actions.signOut} />
          </>
        }
      />

      <main class="app__scroll">
        <ConnectivityNote stale={state.stale} />
        <ScreenRouter screen={state.screen} state={state} actions={actions} archive={archive} destination={destination} />
      </main>

      <BottomNav<Screen> items={tabs} active={state.screen} onSelect={(key) => (key === 'mint' ? actions.startMint() : actions.go(key))} labels={false} />

      <Toasts state={state} actions={actions} />
    </div>
  );
}

function ScreenRouter({ screen, state, actions, archive, destination }: { screen: Screen; state: VendorState; actions: VendorActions; archive: ArchiveApiState; destination: DestinationApiState }) {
  switch (screen) {
    case 'notes':
      return (
        <div class="scr">
          <ArchiveSection archive={archive} destination={destination} />
        </div>
      );
    case 'mint':
      return <MintScreen state={state} actions={actions} />;
    case 'books':
      return <BooksScreen state={state} actions={actions} />;
    case 'dock':
      return <DockScreen state={state} actions={actions} />;
    case 'store':
      return <StoreScreen state={state} actions={actions} />;
    default:
      return <OrdersScreen state={state} actions={actions} />;
  }
}

function Toasts({ state, actions, noNav }: { state: VendorState; actions: VendorActions; noNav?: boolean }) {
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
      <p>{t('vendor.boot')}</p>
    </div>
  );
}

function UpdateGate() {
  const t = useT();
  return (
    <div class="gate">
      <Icon name="arrowUp" size={46} class="gate__glyph" />
      <h1 class="scr__title">{t('vendor.updateGate.title')}</h1>
      <p class="scr__lede">{t('vendor.updateGate.body')}</p>
      <Checklist items={[t('vendor.updateGate.safe'), t('vendor.updateGate.seconds')]} />
      <Button onClick={() => location.reload()}>{t('vendor.updateGate.cta')}</Button>
    </div>
  );
}
