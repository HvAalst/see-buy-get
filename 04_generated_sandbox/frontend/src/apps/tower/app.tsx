import { HelpLink } from '../../shared/guide/HelpLink';
import { CompanyPasswordPanel } from './screens/CompanyPasswordPanel';
import { useState } from 'preact/hooks';
import { BrandMark } from '../../shared/ui';
import { useT } from '../../shared/i18n';
import { CompaniesScreen } from './screens/CompaniesScreen';
import { CompanyRecordScreen } from './screens/CompanyRecordScreen';
import { BordersScreen } from './screens/BordersScreen';
import { CorridorsScreen } from './screens/CorridorsScreen';
import { PresenceScreen } from './screens/PresenceScreen';
import { HazardsScreen } from './screens/HazardsScreen';
import { PapersScreen } from './screens/PapersScreen';
import { stuckCount } from './papers';
import { ApprovalsScreen, ClaimsScreen, DisposalScreen } from './screens/QueuesScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { MoneyScreen } from './screens/MoneyScreen';
import { PicturesScreen } from './screens/PicturesScreen';
import { SupportScreen } from './screens/SupportScreen';
import { NetworkScreen } from './screens/NetworkScreen';
import { RatesScreen } from './screens/RatesScreen';
import { ImportsScreen } from './screens/ImportsScreen';
import { MarketScreen } from './screens/MarketScreen';
import { DepotsScreen } from './screens/DepotsScreen';
import { MoversScreen } from './screens/MoversScreen';
import { SignInScreen } from './screens/SignInScreen';
import { ConsoleMenu } from './ConsoleMenu';
import { ConsolePhoneNav, ConsoleRail } from './ConsoleNav';
import { SettingsScreen } from './screens/SettingsScreen';
import { groupsFor } from './nav';
import { waitingLine } from './queues';
import { useWideScreen } from '../../shared/useWideScreen';
import { useTowerApp, type Screen } from './useTowerApp';
import '../../shared/console.css';
import './tower.css';

/**
 * The operator console shell: a masthead, a navigation, and one work area — the navigation being a
 * grouped sidebar at a desk and a bottom bar with a slide-up sheet on anything narrower.
 *
 * No TopBar and no service worker — two of the three things every other app in this repo has. They are
 * answers to a question this surface does not ask ("a phone, in the field, maybe with no signal"). The
 * third, the BottomNav, IS here, but only below 1100px: a console is run at a desk and carried to a
 * tablet, and on the tablet it should behave like everything else this network puts in a hand. What it
 * keeps everywhere is the shared TOKENS and the shared meanings: orange is a state, blue is the action,
 * and every string is a catalogue key.
 */
export function App() {
  const t = useT();
  const { state, actions } = useTowerApp();
  // Asked before the early returns, because a hook cannot be called conditionally — and read here rather
  // than left to CSS, because a stylesheet can move a menu but cannot swap it for a different one.
  const wide = useWideScreen();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  if (state.phase === 'boot') return <div class="twr-boot" aria-busy="true" />;

  if (state.phase === 'outdated') {
    return (
      <div class="twr-signin">
        <div class="twr-signin__card">
          <h1 class="cons__title">{t('tower.outdated.title')}</h1>
          <p class="cons__lede">{t('tower.outdated.body')}</p>
          <button type="button" class="cbtn cbtn--primary" style="margin-top:14px" onClick={() => location.reload()}>
            {t('tower.outdated.cta')}
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'signin') {
    return <SignInScreen actions={actions} error={state.signInError} busy={state.loading} />;
  }

  /**
   * The navigation is built from WHAT THIS CALLER REACHES, never trimmed after the fact.
   *
   * Network staff work the hazard queue; a company's administrator does not, and a section whose every
   * row would answer 403 is worse than a missing one — it teaches somebody that the console is broken.
   * The companies view appears only for somebody who reaches more than one, because a comparison of one
   * company with itself is not a comparison. `groupsFor` then does the rest: it puts each reachable
   * screen under its group and DROPS a group nothing is left in, so an administrator is offered two
   * groups rather than four, two of them empty.
   */
  const isOperator = state.who?.mode === 'operator';
  const manyCompanies = (state.entities?.length ?? 0) > 1;
  const available: Screen[] = [
    // `movers` belongs in THIS list and not below it: the route behind it is operator-only, because it
    // carries hand-back reasons and names drivers. Offered to a company administrator it was a section
    // whose every read answers 403 — the same defect already tracked against the finance endpoint, and
    // one I introduced in the slice that added the screen.
    /*
     * WHAT IS STAFF'S AND WHAT IS THEIRS — the user, looking at a company's console: "Setup and money also
     * contain a lot of info that belongs to operators and not to them."
     *
     * RATES moved in here, because what a sister charges is an operator's knob and was the first thing a
     * company administrator saw on signing in. COMPANY moved out, because their own record is theirs to
     * keep — an operator picks a company from a list, an administrator IS one.
     */
    ...(isOperator ? (['network', 'hazards', 'claims', 'disposal', 'approvals', 'papers', 'reports', 'support', 'corridors', 'presence', 'pictures', 'borders', 'movers', 'rates'] as Screen[]) : []),
    ...(manyCompanies ? (['companies'] as Screen[]) : []),
    // Their own books and what they are owed — never the network's ledger, which is not theirs to read.
    'money',
    'company',
    // Their own entry, their saved places and their password. Staff act for nobody and have none.
    ...(state.who?.entityId ? (['settings'] as Screen[]) : []),
    'imports',
    'market',
    // Y4 — offered to BOTH: a yard reads its own register here, and network staff read the directory.
    // The routes behind it answer either way, which is what the movers defect taught.
    'depots',
  ];
  const groups = groupsFor(available);

  /**
   * THE FOUR QUEUES ARE THE ONLY THINGS THAT COUNT.
   *
   * Not the companies, not the pictures, not the rates — a number beside a section reads as "this many
   * things are waiting for you", and "3" beside the companies would be a fact wearing the clothes of a
   * demand. Null while unread, everywhere: a badge of 0 says "you are up to date", which is a different
   * claim from "we have not looked yet".
   */
  const counts: Partial<Record<Screen, number | null>> = {
    hazards: state.hazards?.length ?? null,
    claims: state.claims == null && state.freightClaims == null ? null : (state.claims?.length ?? 0) + (state.freightClaims?.length ?? 0),
    disposal: state.disposal?.length ?? null,
    approvals: state.approvals?.length ?? null,
    // FP4 — only the STUCK count: a courier whose licence is merely running out is not waiting on anybody here.
    papers: stuckCount(state.papers),
    reports: state.reports?.length ?? null,
  };

  return (
    <div class="cons">
      <header class="cons__mast">
        <div class="cons__brand">
          <BrandMark size={26} />
          <span class="cons__brandname">{t('tower.appTitle')}</span>
          {/* The live line carries WORK, never identity — the same rule as the phone apps' TopBar. And it
              belongs to whoever HAS that work: the hazard queue is network staff's, so for a company
              administrator this slot stays empty rather than reporting forever that it is loading a
              queue nobody is going to fetch for them. */}
          {isOperator ? (
            <span class="cons__mastwork">
              ·{' '}
              {waitingLine(
                {
                  hazards: state.hazards?.length ?? null,
                  claims: state.claims == null && state.freightClaims == null ? null : (state.claims?.length ?? 0) + (state.freightClaims?.length ?? 0),
                  disposal: state.disposal?.length ?? null,
                  approvals: state.approvals?.length ?? null,
                },
                t,
              )}
            </span>
          ) : null}
        </div>
        {/*
          * ONE CONTROL, not six things along a line. What was here: "Signed in as X", the company, an
          * unverified tag, then Change password, Help and Sign out — four different weights competing,
          * with the identity (the thing an operator checks before a decision that names them) the
          * quietest of them. The user pointed at BondBridge's topbar, and it is right.
          *
          * The ONE thing that stays outside, visible without opening anything, is the unverified
          * warning: a name typed beside a shared setup key proves nothing, and every decision taken
          * here is attributed to it. A warning behind a click is a warning nobody reads.
          */}
        <ConsoleMenu
          name={state.who?.name ?? ''}
          under={state.who?.entityId ? companyName(state) : undefined}
          warn={state.creds?.mode === 'operator' ? t('tower.signIn.unverified') : undefined}
          entries={[
            // A company administrator manages their own entry, their places and their password. Staff
            // act for nobody, so they have no settings of their own to keep — and their password is the
            // panel that has always opened over the work area.
            ...(state.who?.entityId ? [{ key: 'settings', icon: 'edit' as const, label: t('tower.nav.settings'), onGo: () => actions.go('settings') }] : []),
            ...(state.creds && state.creds.mode !== 'operator' && !state.who?.entityId
              ? [{ key: 'password', icon: 'key' as const, label: t('tower.password.open'), onGo: () => setPasswordOpen(true) }]
              : []),
            { key: 'help', icon: 'info' as const, label: t('guide.link'), onGo: () => setHelpOpen(true) },
            { key: 'out', icon: 'lock' as const, label: t('tower.signOut'), danger: true, onGo: actions.signOut },
          ]}
        />
        <HelpLink app="console" open={helpOpen} onOpenChange={setHelpOpen} />
      </header>

      <div class="cons__body">
        {wide ? <ConsoleRail groups={groups} screen={state.screen} counts={counts} onGo={actions.go} /> : null}

        <main class="cons__main">
          {passwordOpen && state.creds && state.creds.mode !== 'operator' ? <CompanyPasswordPanel actions={actions} onClose={() => setPasswordOpen(false)} /> : null}
          {state.screen === 'settings' ? (
            <SettingsScreen state={state} actions={actions} />
          ) : state.screen === 'presence' ? (
            <PresenceScreen state={state} actions={actions} />
          ) : state.screen === 'corridors' ? (
            <CorridorsScreen state={state} actions={actions} />
          ) : state.screen === 'support' ? (
            <SupportScreen state={state} actions={actions} />
          ) : state.screen === 'pictures' ? (
            <PicturesScreen state={state} actions={actions} />
          ) : state.screen === 'money' ? (
            <MoneyScreen state={state} actions={actions} />
          ) : state.screen === 'network' ? (
            <NetworkScreen state={state} actions={actions} />
          ) : state.screen === 'borders' ? (
            <BordersScreen state={state} actions={actions} />
          ) : state.screen === 'company' ? (
            <CompanyRecordScreen state={state} actions={actions} />
          ) : state.screen === 'companies' ? (
            <CompaniesScreen state={state} actions={actions} />
          ) : state.screen === 'movers' ? (
            <MoversScreen state={state} actions={actions} />
          ) : state.screen === 'market' ? (
            <MarketScreen actions={actions} />
          ) : state.screen === 'depots' ? (
            <DepotsScreen state={state} actions={actions} />
          ) : state.screen === 'imports' ? (
            <ImportsScreen state={state} actions={actions} />
          ) : state.screen === 'rates' ? (
            <RatesScreen state={state} actions={actions} />
          ) : state.screen === 'claims' ? (
            <ClaimsScreen state={state} actions={actions} />
          ) : state.screen === 'disposal' ? (
            <DisposalScreen state={state} actions={actions} />
          ) : state.screen === 'reports' ? (
            <ReportsScreen state={state} actions={actions} />
          ) : state.screen === 'approvals' ? (
            <ApprovalsScreen state={state} actions={actions} />
          ) : state.screen === 'papers' ? (
            <PapersScreen state={state} actions={actions} />
          ) : (
            <HazardsScreen state={state} actions={actions} />
          )}
        </main>
      </div>

      {wide ? null : <ConsolePhoneNav groups={groups} screen={state.screen} counts={counts} onGo={actions.go} />}
    </div>
  );
}

/** The name of the company somebody is signed in as — its id until the list arrives to name it. */
function companyName(state: { who?: { entityId?: string } | null; entities?: { entityId: string; name: string }[] | null }): string {
  const id = state.who?.entityId ?? '';
  return state.entities?.find((e) => e.entityId === id)?.name ?? id;
}
