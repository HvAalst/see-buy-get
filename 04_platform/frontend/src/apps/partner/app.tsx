import { useEffect, useState } from 'preact/hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { PasskeyOffer } from '../../shared/account/PasskeyOffer';
import { SettingsSheet } from '../../shared/account/SettingsSheet';
import { ShareSheet } from '../../shared/account/ShareSheet';
import { useAccount } from '../../shared/account/useAccount';
import { AgreementGate } from '../../shared/documents/Agreement';
import { HelpLink } from '../../shared/guide/HelpLink';
import { useT, type MessageKey } from '../../shared/i18n';
import { onLaunch } from '../../shared/launch';
import { screensOf, useScreenNav } from '../../shared/nav';
import { BottomNav, BrandMark, Icon } from '../../shared/ui';
import { AppsSheet } from '../../shared/ui/AppLauncher';
import type { IconName } from '../../shared/ui/Icon';
import { InstallGuideSheet } from '../../shared/ui/InstallBar';
import { useWideScreen } from '../../shared/useWideScreen';
import { ConsoleMenu } from '../tower/ConsoleMenu';
import { readPhone } from './api';
import type { Section } from './logic';
import { ChooseScreen } from './screens/ChooseScreen';
import { HandsScreen } from './screens/HandsScreen';
import { MoneyScreen } from './screens/MoneyScreen';
import { HomeScreen } from './screens/HomeScreen';
import { SignInScreen } from './screens/SignInScreen';
import { usePartnerApp } from './usePartnerApp';
import '../../shared/screens.css';
import '../../shared/console.css';
import '../tower/tower.css';
import './partner.css';

/** Every section, for Back and for a shortcut's `?go=` (shared/nav.ts). */
const SECTIONS = screensOf<Section>({ home: true, hands: true, money: true });

const SECTION: Record<Section, { label: MessageKey; icon: IconName }> = {
  home: { label: 'partner.app.nav.owed', icon: 'wallet' },
  hands: { label: 'partner.app.nav.hands', icon: 'person' },
  // 2026-11-21 — paid in, paid out, waiting (the payments plan, 4e).
  money: { label: 'partner.app.nav.money', icon: 'repeat' },
};
const ORDER: Section[] = ['home', 'hands', 'money'];

/**
 * 2026-11-20 — THE PARTNER APP (the payments plan, 3c; the owner: "console for staff and partner app with live view"; a
 * separate Partner app). A partner company's own people, added by SeeBuyGet's staff, sign in as themselves and read live
 * what their company owes its shops, hubs and drivers: in all, per hand, and every step. It borrows the console's design
 * system, as the Business app does — built for an office desk, and whole on a phone. Nothing here moves money: what is paid
 * in and paid out comes with step 4.
 */
export function App() {
  const t = useT();
  const { state, actions } = usePartnerApp();
  const wide = useWideScreen();
  const [settings, setSettings] = useState(false);
  const [apps, setApps] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [guide, setGuide] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // THE APP'S OWN SERVICE WORKER: the app shell kept for opening, registered in prompt mode like every app's — a new version
  // waits for the tap in the mast — and it keeps none of the partner's figures (vite.config.ts; main.tsx keepNoReads).
  const sw = useRegisterSW();
  const [needRefresh] = sw.needRefresh;
  const client = actions.partnerClient();
  // The person's own account (PIN, recovery email, phone), reached through the partner session, which carries them.
  const account = useAccount(client?.client.sbg ?? null, state.phase === 'ready');
  const open = state.phase === 'ready' && Boolean(state.partner);
  useScreenNav<Section>({ screen: state.section, home: 'home', tabs: SECTIONS, ready: open, go: actions.go, launch: SECTIONS });
  // The bell's welcome elsewhere, and the menu here: the guide to getting the most out of the app, on one tap.
  useEffect(() => onLaunch('guide', () => setGuide(true)), []);

  if (state.phase === 'boot') return <div class="twr-boot" aria-busy="true" />;
  if (state.phase === 'signin') return <SignInScreen state={state} actions={actions} />;
  if (state.phase === 'choose' || !state.partner) return <ChooseScreen state={state} actions={actions} />;

  const partner = state.partner;
  return (
    <div class="cons pa">
      <header class="cons__mast">
        <div class="cons__brand">
          <BrandMark size={26} />
          <span class="cons__brandname">{t('partner.app.title')}</span>
          <span class="cons__mastwork pa-mast__name">· {partner.name}</span>
        </div>
        <div class="pa-mast__end">
          {needRefresh ? (
            <button type="button" class="topbar__lead" onClick={() => void sw.updateServiceWorker(true)} aria-label={t('update.ready.aria')} title={t('update.ready.title')}>
              <Icon name="refresh" size={22} />
            </button>
          ) : null}
          <ConsoleMenu
            name={partner.memberName}
            under={partner.name}
            entries={[
              // ONE Settings entry for how this person signs in (the user: these actions live in Settings).
              { key: 'settings', icon: 'settings', label: t('partner.app.menu.settings'), onGo: () => setSettings(true) },
              { key: 'share', icon: 'send', label: t('account.share.title'), onGo: () => setSharing(true) },
              { key: 'install', icon: 'bell', label: t('install.menu'), onGo: () => setGuide(true) },
              { key: 'switch', icon: 'repeat', label: t('partner.app.menu.switch'), onGo: () => void actions.backToList() },
              { key: 'apps', icon: 'grid', label: t('common.allApps'), onGo: () => setApps(true) },
              { key: 'help', icon: 'info', label: t('guide.link'), onGo: () => setHelpOpen(true) },
              { key: 'out', icon: 'lock', label: t('partner.app.signOut'), danger: true, onGo: actions.signOut },
            ]}
          />
        </div>
        <HelpLink app="partner" open={helpOpen} onOpenChange={setHelpOpen} />
      </header>

      <div class="cons__body">
        {wide ? (
          <nav class="cons__rail" aria-label={t('partner.app.nav.heading')}>
            <div class="cons__railgroup">
              <p class="cons__railhead">{t('partner.app.nav.heading')}</p>
              {ORDER.map((s) => (
                <button key={s} type="button" class={`cons__railitem${state.section === s ? ' cons__railitem--on' : ''}`} aria-current={state.section === s ? 'page' : undefined} onClick={() => actions.go(s)}>
                  <Icon name={SECTION[s].icon} size={18} />
                  <span>{t(SECTION[s].label)}</span>
                </button>
              ))}
            </div>
          </nav>
        ) : null}

        <main class="cons__main">
          {/* Right after a sign-in that took a code: the fingerprint, offered once. */}
          <PasskeyOffer api={account.passkey} look="console" />
          {state.section === 'hands' ? <HandsScreen state={state} /> : state.section === 'money' ? <MoneyScreen state={state} /> : <HomeScreen state={state} />}
        </main>
      </div>

      {wide ? null : <BottomNav items={ORDER.map((s) => ({ key: s as string, label: t(SECTION[s].label), icon: SECTION[s].icon }))} active={state.section} onSelect={(s) => actions.go(s as Section)} />}

      <SettingsSheet open={settings} onClose={() => setSettings(false)} api={account} onSignOut={actions.signOut} />
      <AppsSheet open={apps} onClose={() => setApps(false)} carry={() => account.carry(readPhone() ?? undefined)} />
      <ShareSheet open={sharing} onClose={() => setSharing(false)} api={account} />
      <InstallGuideSheet open={guide} onClose={() => setGuide(false)} app="partner" />
      {/* What they agreed to, asked again when a version since asks it. */}
      <AgreementGate sbg={client?.client.sbg ?? null} onSignOut={actions.signOut} />
    </div>
  );
}
