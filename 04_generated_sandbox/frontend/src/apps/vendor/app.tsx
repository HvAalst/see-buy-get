import { useRegisterSW } from 'virtual:pwa-register/preact';
import { BottomNav, Button, Checklist, Icon, Pill, TopBar, type NavItem } from '../../shared/ui';
import { money } from './logic';
import { BooksScreen } from './screens/BooksScreen';
import { MintScreen } from './screens/MintScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { SignInScreen } from './screens/SignInScreen';
import { StoreScreen } from './screens/StoreScreen';
import { useVendorApp, type Screen, type VendorActions, type VendorState } from './useVendorApp';
import '../../shared/screens.css';
import './vendor.css';

export function App() {
  const { state, actions } = useVendorApp();
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  if (state.phase === 'outdated') return <UpdateGate />;
  if (state.phase === 'boot') return <Boot />;

  if (state.phase === 'signin') {
    return (
      <div class="app">
        <TopBar title="SeeBuyGet Vendor" subtitle="Sign in" />
        <main class="app__scroll app__scroll--nonav">
          <SignInScreen state={state} actions={actions} error={state.error} />
        </main>
        <Toasts state={state} actions={actions} noNav />
      </div>
    );
  }

  const tabs: NavItem<Screen>[] = [
    { key: 'orders', label: 'Orders', icon: 'box', badge: state.checkouts.length || undefined },
    { key: 'mint', label: 'Ship', icon: 'send' },
    { key: 'books', label: 'Books', icon: 'wallet' },
    { key: 'store', label: 'My store', icon: 'home' },
  ];

  return (
    <div class="app">
      <TopBar
        title="SeeBuyGet Vendor"
        subtitle={state.vendor?.name}
        onBack={state.screen === 'orders' ? undefined : () => actions.go('orders')}
        backLabel="Back to my orders"
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
            <Pill tone={(state.vendor?.balance ?? 0) > 0 ? 'ok' : 'idle'} dot>
              {money(state.vendor?.balance)}
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

      <BottomNav<Screen> items={tabs} active={state.screen} onSelect={(key) => (key === 'mint' ? actions.startMint() : actions.go(key))} />

      <Toasts state={state} actions={actions} />
    </div>
  );
}

function ScreenRouter({ screen, state, actions }: { screen: Screen; state: VendorState; actions: VendorActions }) {
  switch (screen) {
    case 'mint':
      return <MintScreen state={state} actions={actions} />;
    case 'books':
      return <BooksScreen state={state} actions={actions} />;
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
  return (
    <div class="boot">
      <span class="boot__spin" aria-hidden="true" />
      <p>Opening your store…</p>
    </div>
  );
}

function UpdateGate() {
  return (
    <div class="gate">
      <Icon name="arrowUp" size={46} class="gate__glyph" />
      <h1 class="scr__title">This app needs updating</h1>
      <p class="scr__lede">A newer version is required before you can carry on working.</p>
      <Checklist items={['Your balance and orders are safe', 'Updating takes a few seconds']} />
      <Button onClick={() => location.reload()}>Update now</Button>
    </div>
  );
}
