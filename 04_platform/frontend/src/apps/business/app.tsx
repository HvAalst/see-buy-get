import { useEffect, useRef, useState } from 'preact/hooks';
import { onLaunch } from '../../shared/launch';
import { AgreementGate } from '../../shared/documents/Agreement';
import { HelpLink } from '../../shared/guide/HelpLink';
import { BottomNav, BrandMark, Icon, NotificationBell, Sheet } from '../../shared/ui';
import { useT, type MessageKey } from '../../shared/i18n';
import type { IconName } from '../../shared/ui/Icon';
import { useWideScreen } from '../../shared/useWideScreen';
import { SettingsSheet } from '../../shared/account/SettingsSheet';
import { ShareSheet } from '../../shared/account/ShareSheet';
import { useAccount } from '../../shared/account/useAccount';
import { ConsoleMenu } from '../tower/ConsoleMenu';
import { ImportsScreen } from '../tower/screens/ImportsScreen';
import { DepotsScreen } from '../tower/screens/DepotsScreen';
import { mayAct, navGroupsFor, navSectionOf, sectionsFor, type Section } from './logic';
import { useBusinessApp } from './useBusinessApp';
import { screensOf, useScreenNav } from '../../shared/nav';
import { SignInScreen } from './screens/SignInScreen';
import { ChooseScreen } from './screens/ChooseScreen';
import { HomeScreen } from './screens/HomeScreen';
import { PeopleScreen } from './screens/PeopleScreen';
import { DetailsScreen } from './screens/DetailsScreen';
import { LoadsScreen, type LoadAskedFor } from './screens/LoadsScreen';
import { RunsScreen, type RunAskedFor } from './screens/RunsScreen';
import { ClientsScreen } from './screens/ClientsScreen';
import { ContractsScreen } from './screens/ContractsScreen';
import { InboundScreen } from './screens/InboundScreen';
import { ExportsScreen } from './screens/ExportsScreen';
import { ParcelsScreen } from './screens/ParcelsScreen';
import '../../shared/screens.css';
import '../../shared/console.css';
import '../tower/tower.css';
import './business.css';

/** Every section, for Back and for a shortcut's `?go=` (shared/nav.ts); one the business does not do opens its home. */
const SECTIONS = screensOf<Section>({ home: true, loads: true, runs: true, parcels: true, contracts: true, clients: true, exports: true, imports: true, yard: true, inbound: true, people: true, details: true });

const SECTION: Record<Section, { label: MessageKey; icon: IconName }> = {
  home: { label: 'business.nav.home', icon: 'home' },
  loads: { label: 'business.nav.domestic', icon: 'truck' },
  runs: { label: 'business.nav.runs', icon: 'route' },
  parcels: { label: 'business.nav.parcels', icon: 'parcel' },
  contracts: { label: 'business.nav.contracts', icon: 'badge' },
  clients: { label: 'business.nav.clients', icon: 'bag' },
  exports: { label: 'business.nav.exports', icon: 'send' },
  imports: { label: 'business.nav.imports', icon: 'box' },
  yard: { label: 'business.nav.yard', icon: 'grid' },
  inbound: { label: 'business.nav.inbound', icon: 'box' },
  people: { label: 'business.nav.people', icon: 'person' },
  details: { label: 'business.nav.details', icon: 'badge' },
};

/**
 * THE BUSINESS APP — a customer's own workplace on the network, apart from the staff console.
 *
 * The user, 2026-10-04: a separate app for shippers and expeditors, the expeditor acting as the shipper's agent, and
 * we never handle their payments. It borrows the console's design system (it is built for a desk the same way) and
 * hosts the console's import and yard screens as they stand — the server decides what a business sign-in reaches.
 *
 * WHAT IS EVERYBODY'S AND WHAT IS AN OWNER'S is decided by the server on every request; the screens only stop offering
 * what would be refused.
 */
/** 2026-11-02 — what a notice named, and the section it opens in. */
type LinkedAsked = { section: 'loads'; load: LoadAskedFor } | { section: 'runs'; run: RunAskedFor } | { section: 'exports' | 'imports'; record: { id: string; seq: number } };

export function App() {
  const t = useT();
  const { state, actions } = useBusinessApp();
  const wide = useWideScreen();
  const [settings, setSettings] = useState(false);
  // 2026-11-01 — share SeeBuyGet, as every app's settings offer it.
  const [sharing, setSharing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [more, setMore] = useState(false);
  const client = actions.businessClient();
  // The person's own account (PIN, recovery email, phone) — reached through the business session, which carries them.
  const account = useAccount(client?.client.sbg ?? null, state.phase === 'ready');
  // 2026-11-02 — Back, as an app means it (shared/nav.ts), on a phone as at a desk: every section is top-level — the
  // rail's or the tab bar's — so they swap in place, keep their place on the page, and Back from any of them is home.
  useScreenNav<Section>({ screen: state.section, home: 'home', tabs: SECTIONS, ready: state.phase === 'ready' && Boolean(state.business) && !state.settingUp, go: actions.go, launch: SECTIONS });

  // 2026-11-02 — A RECORD A NOTICE NAMES (shared/launch.ts; the owner: "wire it in"; "we must reduce the tapping, so
  // that's why it should open"): a tap on the notice in the bell, or a tapped notification on a closed app. A load opens
  // under Loads on the part the notice is about, a booking under Runs, an export under Exports, an import under Imports —
  // once the business is open; a business with no such section is told so, in words.
  const [asked, setAsked] = useState<LinkedAsked | null>(null);
  const [loadSaid, setLoadSaid] = useState<string | null>(null);
  const asks = useRef(0);
  useEffect(() => {
    const offs = [
      onLaunch('load', (l) => setAsked({ section: 'loads', load: { ...l, seq: ++asks.current } })),
      onLaunch('run', (r) => setAsked({ section: 'runs', run: { ...r, seq: ++asks.current } })),
      onLaunch('export', (id) => setAsked({ section: 'exports', record: { id, seq: ++asks.current } })),
      onLaunch('import', (id) => setAsked({ section: 'imports', record: { id, seq: ++asks.current } })),
    ];
    return () => offs.forEach((off) => off());
  }, []);
  const open = state.phase === 'ready' && Boolean(state.business) && !state.settingUp;
  useEffect(() => {
    if (!asked || !open || !state.business) return;
    if (!sectionsFor(state.business.activities).includes(asked.section)) {
      setAsked(null);
      setLoadSaid(t('business.linked.notHere'));
      return;
    }
    setLoadSaid(null);
    if (state.section !== asked.section) actions.go(asked.section);
  }, [asked, open]);
  // Said once, where it was asked: gone with the next section.
  useEffect(() => setLoadSaid(null), [state.section]);
  const answered = () => setAsked(null);

  if (state.phase === 'boot') return <div class="twr-boot" aria-busy="true" />;
  if (state.phase === 'signin') return <SignInScreen state={state} actions={actions} />;
  // A business just signed up stays on its sign-up (2026-11-02) — the same screen, so the wizard keeps its place — until
  // its papers and the ask are done or left for later.
  if (state.phase === 'choose' || !state.business || state.settingUp) return <ChooseScreen state={state} actions={actions} />;

  const business = state.business;
  const sections = sectionsFor(business.activities);
  const section = sections.includes(state.section) ? state.section : 'home';
  // The menu in groups (2026-10-29): shipments first, by the way the goods go; then partners, places, the company.
  const groups = navGroupsFor(business.activities);
  const marked = navSectionOf(section);
  const shipments = groups.find((g) => g.key === 'shipments')?.sections ?? [];
  const others = groups.filter((g) => g.key !== 'shipments');
  const inMore = others.some((g) => g.sections.includes(marked));
  // Domestic holds two ways to send in the country: a load of your own, or space on a carrier's run.
  const domesticTabs = (section === 'loads' || section === 'runs') && sections.includes('runs') ? (
    <div class="twr-tabs" role="tablist" aria-label={t('business.nav.domestic')}>
      {(['loads', 'runs'] as Section[]).map((s) => (
        <button key={s} type="button" role="tab" aria-selected={section === s} class={`cbtn cbtn--sm ${section === s ? 'cbtn--on' : 'cbtn--ghost'}`} onClick={() => actions.go(s)}>
          {t(s === 'loads' ? 'business.nav.loads' : 'business.nav.runs')}
        </button>
      ))}
    </div>
  ) : null;
  // The console's screens read who is signed in and a client; a business member is "a company" to them.
  const who = { mode: 'company' as const, name: business.you.name, entityId: business.entityId };
  const towerActions = { client: () => client };

  return (
    <div class="cons biz">
      <header class="cons__mast">
        <div class="cons__brand">
          <BrandMark size={26} />
          <span class="cons__brandname">{t('business.appTitle')}</span>
          <span class="cons__mastwork biz-mast__name">· {business.name}</span>
        </div>
        <div class="biz-mast__end">
          {/* The business's inbox. Until this was here, what a carrier told a business — a load that could not be
              delivered, an order coming in several loads — was recorded for it and could be read by nobody. */}
          <NotificationBell api={client?.notifications ?? null} shared={{ canMark: mayAct(business.you.role) }} />
          <ConsoleMenu
            name={business.you.name}
            under={business.name}
            entries={[
              // ONE Settings entry for how this person signs in (the user: these actions live in Settings).
              { key: 'settings', icon: 'settings', label: t('business.menu.settings'), onGo: () => setSettings(true) },
              { key: 'share', icon: 'send', label: t('account.share.title'), onGo: () => setSharing(true) },
              { key: 'switch', icon: 'repeat', label: t('business.menu.switch'), onGo: () => void actions.backToList() },
              { key: 'help', icon: 'info', label: t('guide.link'), onGo: () => setHelpOpen(true) },
              { key: 'out', icon: 'lock', label: t('business.signOut'), danger: true, onGo: actions.signOut },
            ]}
          />
        </div>
        <HelpLink app="business" open={helpOpen} onOpenChange={setHelpOpen} />
      </header>

      <div class="cons__body">
        {wide ? (
          <nav class="cons__rail" aria-label={t('business.nav.heading')}>
            {groups.map((g) => (
              <div class="cons__railgroup" key={g.key}>
                {/* A heading over several; a group of one is drawn as its one item (a heading over a single row is a
                    label for a list that is not a list — the console's own rule). */}
                <p class="cons__railhead">{t(g.label)}</p>
                {g.sections.map((s) => (
                  <button key={s} type="button" class={`cons__railitem${marked === s ? ' cons__railitem--on' : ''}`} aria-current={marked === s ? 'page' : undefined} onClick={() => actions.go(s)}>
                    <Icon name={SECTION[s].icon} size={18} />
                    <span>{t(SECTION[s].label)}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        ) : null}

        <main class="cons__main">
          {state.note ? (
            <p class="cnote biz-note" role="status">
              <Icon name="check" size={16} />
              <span>{state.note}</span>
            </p>
          ) : null}
          {loadSaid ? (
            <p class="cnote biz-note" role="status">
              <Icon name="info" size={16} />
              <span>{loadSaid}</span>
            </p>
          ) : null}
          {domesticTabs}
          {section === 'loads' ? (
            <LoadsScreen business={business} actions={actions} client={client} asked={asked?.section === 'loads' ? asked.load : null} onAsked={answered} />
          ) : section === 'runs' ? (
            <RunsScreen business={business} actions={actions} client={client} asked={asked?.section === 'runs' ? asked.run : null} onAsked={answered} />
          ) : section === 'parcels' ? (
            <ParcelsScreen business={business} client={client} />
          ) : section === 'contracts' ? (
            <ContractsScreen business={business} actions={actions} client={client} />
          ) : section === 'clients' ? (
            <ClientsScreen business={business} actions={actions} client={client} />
          ) : section === 'exports' ? (
            <ExportsScreen business={business} client={client} asked={asked?.section === 'exports' ? asked.record : null} onAsked={answered} />
          ) : section === 'imports' ? (
            <ImportsScreen state={{ who }} actions={towerActions as never} asked={asked?.section === 'imports' ? asked.record : null} onAsked={answered} />
          ) : section === 'yard' ? (
            <DepotsScreen state={{ who }} actions={towerActions as never} />
          ) : section === 'inbound' ? (
            <InboundScreen business={business} client={client} />
          ) : section === 'people' ? (
            <PeopleScreen business={business} actions={actions} client={client} />
          ) : section === 'details' ? (
            <DetailsScreen business={business} actions={actions} client={client} />
          ) : (
            <HomeScreen business={business} actions={actions} client={client} />
          )}
        </main>
      </div>

      {wide ? null : (
        <>
          {/* On a phone the shipments are one tap away — the day's work — and the rest is under More. */}
          <BottomNav
            labels={false}
            items={[...shipments.map((s) => ({ key: s as string, label: t(SECTION[s].label), icon: SECTION[s].icon })), ...(others.length ? [{ key: 'more', label: t('business.nav.more'), icon: 'grid' as IconName }] : [])]}
            active={inMore ? 'more' : marked}
            onSelect={(s) => (s === 'more' ? setMore(true) : actions.go(s as Section))}
          />
          <Sheet open={more} onClose={() => setMore(false)} title={t('business.nav.more')}>
            <div class="cons__sheetlist">
              {others.map((g) => (
                <div key={g.key}>
                  <p class="cons__railhead">{t(g.label)}</p>
                  {g.sections.map((s) => (
                    <button key={s} type="button" class={`cons__sheetitem${marked === s ? ' cons__sheetitem--on' : ''}`} aria-current={marked === s ? 'page' : undefined} onClick={() => { setMore(false); actions.go(s); }}>
                      <Icon name={SECTION[s].icon} size={22} />
                      <span>{t(SECTION[s].label)}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </Sheet>
        </>
      )}

      <SettingsSheet open={settings} onClose={() => setSettings(false)} api={account} onSignOut={actions.signOut} />
      <ShareSheet open={sharing} onClose={() => setSharing(false)} api={account} />
      {/* What they agreed to, asked again when a version since asks it (2026-10-25). */}
      <AgreementGate sbg={client?.client.sbg ?? null} onSignOut={actions.signOut} />
    </div>
  );
}
