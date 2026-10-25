import type { SbgClient } from '../../lib/sbg';
import { AgreementGate } from '../../shared/documents/Agreement';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { ConnectivityNote, BottomNav, Button, Checklist, FeedbackFlash, Icon, NotificationBell, OutboxNote, Pill, Sheet, TopBar, type NavItem } from '../../shared/ui';
import { useMemo, useState } from 'preact/hooks';
import { createFiscalApi, type FiscalApi } from '../../lib/sbg/personas/fiscal';
import { AccountMenu } from '../../shared/account/AccountMenu';
import { ChangePasswordSheet } from '../../shared/account/ChangePasswordSheet';
import { agentConfig } from './api';
import { useAccount } from '../../shared/account/useAccount';
import { useT } from '../../shared/i18n';
import { AcceptScreen } from './screens/AcceptScreen';
import { ConsignmentsScreen } from './screens/ConsignmentsScreen';
import { FreightScreen } from './screens/FreightScreen';
import { BagScreen } from './screens/BagScreen';
import { HandoverScreen } from './screens/HandoverScreen';
import { HomeScreen } from './screens/HomeScreen';
import { RateDriverSheet } from './screens/RateDriverSheet';
import { LateTakeInSheet } from './screens/TakenInLabel';
import { RatesScreen } from './screens/RatesScreen';
import { RecordsScreen } from './screens/RecordsScreen';
import { useArchive, type ArchiveApiState } from '../../shared/archive/useArchive';
import { useDestination, type DestinationApiState } from '../../shared/archive/useDestination';
import { ReceiveBagScreen } from './screens/ReceiveBagScreen';
import { ReleaseScreen } from './screens/ReleaseScreen';
import { ShelfScreen } from './screens/ShelfScreen';
import { SignInScreen } from './screens/SignInScreen';
import { VoidScreen } from './screens/VoidScreen';
import { TamperScreen } from './screens/TamperScreen';
import { useAgentApp, type AgentActions, type AgentState, type Screen } from './useAgentApp';
import '../../shared/screens.css';
import './agent.css';
import { agentWorkLine } from './logic';
import { LoadFinderContext, loadFinderFor } from '../../shared/loadFinder';
import { ParcelFinderContext, parcelFinderFor } from '../../shared/parcelFinder';
import { ownerOnlyScreen, type StaffAtCounter } from './staff';

type Tab = 'home' | 'accept' | 'release' | 'records';

export function App() {
  const t = useT();
  const { state, actions, notifications , sbg } = useAgentApp();
  // The person behind this account — their photo, PIN, address and page. The menu is ABSENT where the
  // sign-in is not a person at all (a store's shared secret), rather than opening onto a refusal.
  // One of the shop's people at the counter has no account here to show: the shop's is the owner's (staff.ts).
  const account = useAccount(sbg, state.phase === 'ready' && !state.staff);
  // The shop's freight paperwork. Fetched only once Records is open: a counter is not waiting on a
  // year of consignment notes to serve the person in front of it.
  const archive = useArchive(sbg, state.phase === 'ready' && state.screen === 'records');
  const destination = useDestination(sbg, state.phase === 'ready' && state.screen === 'records');
  // The shop's tax invoices (KRA eTIMS, Kenya only), under Earnings.
  const fiscal = useMemo(() => (sbg ? createFiscalApi(sbg) : null), [sbg]);
  // Round 19 — a load's package scanned into any box at this counter finds its load: one the shop posted opens here.
  const loadFinder = useMemo(
    () =>
      sbg
        ? loadFinderFor(sbg, (found) => {
            actions.go('freight');
            void actions.openPrices(found.freightId);
          })
        : null,
    [sbg],
  );
  // Round 32 — a store parcel's GS1 barcode scanned into a parcel's box finds the parcel, for this shop's parcels.
  const parcelFinder = useMemo(() => (sbg ? parcelFinderFor(sbg) : null), [sbg]);
  // A shop signs in with an email and a password, not a PIN — so the menu offers THAT credential, and
  // the sheet lives here beside the row that opens it rather than at the foot of one screen.
  const [passwordOpen, setPasswordOpen] = useState(false);
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;

  if (state.phase === 'outdated') return <UpdateGate />;
  if (state.phase === 'boot') return <Boot />;

  if (state.phase === 'signin') {
    return (
      <div class="app">
        <TopBar title={t('agent.appTitle')} subtitle={t('agent.signInSubtitle')} />
        <main class="app__scroll app__scroll--nonav">
          <SignInScreen actions={actions} error={state.error} busy={state.busy === 'signin'} deviceAsk={state.deviceAsk} />
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
    // The shop's books and papers are the owner's.
    ...(state.staff ? [] : [{ key: 'records' as const, label: t('agent.nav.records'), icon: 'grid' as const }]),
  ];

  return (
    <LoadFinderContext.Provider value={loadFinder}>
    <ParcelFinderContext.Provider value={parcelFinder}>
    <div class="app">
      <TopBar
        title={t('agent.appTitle')}
        subtitle={agentWorkLine(state.agent, state.shopParcels, t)}
        subtitleHint={state.agent?.shopName}
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
            {/* Last in the bar: live state first, the place you visit last. */}
            {state.staff ? (
              <StaffChip who={state.staff} onSignOut={actions.signOut} />
            ) : (
              <AccountMenu api={account} app="agent" onSignOut={actions.signOut} onChangePassword={() => setPasswordOpen(true)} devices={actions.shopDevices} />
            )}
          </>
        }
      />

      <main class="app__scroll">
        <ConnectivityNote stale={state.stale} />
        <OutboxNote />
        <ScreenRouter screen={state.screen} state={state} actions={actions} archive={archive} destination={destination} fiscal={fiscal} sbg={sbg} />
      </main>

      <BottomNav<Tab> items={tabs} active={tab} onSelect={(key) => actions.go(key as Screen)} labels={false} />

      {/* REP2 — the "rate the driver" prompt (after a handover / bag-receipt); keyed so the form resets per driver. */}
      <RateDriverSheet key={state.driverRating?.driverDid ?? 'none'} state={state} actions={actions} />
      {/* A take-in made without a signal has reached SeeBuyGet: its label and code, once, wherever the shop is. */}
      <LateTakeInSheet state={state} actions={actions} />

      <Toasts state={state} actions={actions} />
      {/* What they agreed to, asked again when a version since asks it, or first when somebody else signed them up (2026-10-25). */}
      <AgreementGate sbg={state.phase === 'ready' ? sbg : null} onSignOut={actions.signOut} />
      <ChangePasswordSheet open={passwordOpen} onClose={() => setPasswordOpen(false)} config={agentConfig()} email={actions.readEmail()} onChanged={actions.adoptToken} />
      <FeedbackFlash />
    </div>
    </ParcelFinderContext.Provider>
    </LoadFinderContext.Provider>
  );
}

function ScreenRouter({ screen, state, actions, archive, destination, fiscal, sbg }: { screen: Screen; state: AgentState; actions: AgentActions; archive: ArchiveApiState; destination: DestinationApiState; fiscal: FiscalApi | null; sbg: SbgClient | null }) {
  // A notification or an old link can point one of the shop's people at an owner's screen: the counter is shown instead.
  if (state.staff && ownerOnlyScreen(screen)) return <HomeScreen state={state} actions={actions} sbg={sbg} />;
  switch (screen) {
    case 'accept':
      return <AcceptScreen state={state} actions={actions} />;
    case 'handover':
      return <HandoverScreen state={state} actions={actions} />;
    case 'bag':
      return <BagScreen state={state} actions={actions} />;
    // ONE COUNTER. 'collect' survives as a route because notifications, the home tiles and anything
    // already bookmarked point at it — but it is the same screen, because it was always the same job.
    case 'release':
    case 'collect':
      return <ReleaseScreen state={state} actions={actions} />;
    case 'receivebag':
      return <ReceiveBagScreen state={state} actions={actions} />;
    case 'void':
      return <VoidScreen state={state} actions={actions} />;
    case 'tamper':
      return <TamperScreen state={state} actions={actions} />;
    case 'rates':
      return <RatesScreen state={state} actions={actions} />;
    case 'consignments':
      return <ConsignmentsScreen state={state} actions={actions} />;
    case 'records':
      return <RecordsScreen state={state} actions={actions} archive={archive} destination={destination} fiscal={fiscal} />;
    case 'shelf':
      return <ShelfScreen state={state} actions={actions} />;
    case 'freight':
      return <FreightScreen state={state} actions={actions} />;
    default:
      return <HomeScreen state={state} actions={actions} sbg={sbg} />;
  }
}

/**
 * WHO IS AT THE COUNTER, in the bar where the shop's account menu is for the owner: their name, and signing out. There is
 * no account of theirs to open here — the shop's is the owner's, and their own is in any SeeBuyGet app.
 */
function StaffChip({ who, onSignOut }: { who: StaffAtCounter; onSignOut: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="topbar__lead" onClick={() => setOpen(true)} aria-label={t('agent.staff.chipAria', { name: who.name })} title={who.name}>
        <Icon name="person" size={24} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('agent.staff.sheetTitle', { name: who.name })}>
        <p class="t-body">{t('agent.staff.sheetLede', { shop: who.shopName })}</p>
        <Button chevron={false} onClick={onSignOut}>
          {t('agent.staff.signOut')}
        </Button>
        <Button variant="link" onClick={() => setOpen(false)}>
          {t('agent.home.notNow')}
        </Button>
      </Sheet>
    </>
  );
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
