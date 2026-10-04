import { useState } from 'preact/hooks';
import { HelpLink } from '../../shared/guide/HelpLink';
import { BottomNav, BrandMark, Icon } from '../../shared/ui';
import { useT, type MessageKey } from '../../shared/i18n';
import type { IconName } from '../../shared/ui/Icon';
import { useWideScreen } from '../../shared/useWideScreen';
import { SettingsSheet } from '../../shared/account/SettingsSheet';
import { useAccount } from '../../shared/account/useAccount';
import { ConsoleMenu } from '../tower/ConsoleMenu';
import { ImportsScreen } from '../tower/screens/ImportsScreen';
import { DepotsScreen } from '../tower/screens/DepotsScreen';
import { sectionsFor, type Section } from './logic';
import { useBusinessApp } from './useBusinessApp';
import { SignInScreen } from './screens/SignInScreen';
import { ChooseScreen } from './screens/ChooseScreen';
import { HomeScreen } from './screens/HomeScreen';
import { PeopleScreen } from './screens/PeopleScreen';
import { DetailsScreen } from './screens/DetailsScreen';
import '../../shared/screens.css';
import '../../shared/console.css';
import '../tower/tower.css';
import './business.css';

const SECTION: Record<Section, { label: MessageKey; icon: IconName }> = {
  home: { label: 'business.nav.home', icon: 'home' },
  imports: { label: 'business.nav.imports', icon: 'box' },
  yard: { label: 'business.nav.yard', icon: 'grid' },
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
export function App() {
  const t = useT();
  const { state, actions } = useBusinessApp();
  const wide = useWideScreen();
  const [settings, setSettings] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const client = actions.businessClient();
  // The person's own account (PIN, recovery email, phone) — reached through the business session, which carries them.
  const account = useAccount(client?.client.sbg ?? null, state.phase === 'ready');

  if (state.phase === 'boot') return <div class="twr-boot" aria-busy="true" />;
  if (state.phase === 'signin') return <SignInScreen state={state} actions={actions} />;
  if (state.phase === 'choose' || !state.business) return <ChooseScreen state={state} actions={actions} />;

  const business = state.business;
  const sections = sectionsFor(business.activities);
  const section = sections.includes(state.section) ? state.section : 'home';
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
        <ConsoleMenu
          name={business.you.name}
          under={business.name}
          entries={[
            // ONE Settings entry for how this person signs in (the user: these actions live in Settings).
            { key: 'settings', icon: 'settings', label: t('business.menu.settings'), onGo: () => setSettings(true) },
            { key: 'switch', icon: 'repeat', label: t('business.menu.switch'), onGo: () => void actions.backToList() },
            { key: 'help', icon: 'info', label: t('guide.link'), onGo: () => setHelpOpen(true) },
            { key: 'out', icon: 'lock', label: t('business.signOut'), danger: true, onGo: actions.signOut },
          ]}
        />
        <HelpLink app="business" open={helpOpen} onOpenChange={setHelpOpen} />
      </header>

      <div class="cons__body">
        {wide ? (
          <nav class="cons__rail" aria-label={t('business.nav.heading')}>
            {sections.map((s) => (
              <div class="cons__railgroup" key={s}>
                <button type="button" class={`cons__railitem${section === s ? ' cons__railitem--on' : ''}`} aria-current={section === s ? 'page' : undefined} onClick={() => actions.go(s)}>
                  <Icon name={SECTION[s].icon} size={18} />
                  <span>{t(SECTION[s].label)}</span>
                </button>
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
          {section === 'imports' ? (
            <ImportsScreen state={{ who }} actions={towerActions as never} />
          ) : section === 'yard' ? (
            <DepotsScreen state={{ who }} actions={towerActions as never} />
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
        <BottomNav labels={false} items={sections.map((s) => ({ key: s, label: t(SECTION[s].label), icon: SECTION[s].icon }))} active={section} onSelect={(s) => actions.go(s as Section)} />
      )}

      <SettingsSheet open={settings} onClose={() => setSettings(false)} api={account} onSignOut={actions.signOut} />
    </div>
  );
}
