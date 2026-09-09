import { BrandMark, Icon } from '../../shared/ui';
import { useT } from '../../shared/i18n';
import { CompaniesScreen } from './screens/CompaniesScreen';
import { HazardsScreen } from './screens/HazardsScreen';
import { ApprovalsScreen, ClaimsScreen, DisposalScreen } from './screens/QueuesScreen';
import { MoneyScreen } from './screens/MoneyScreen';
import { NetworkScreen } from './screens/NetworkScreen';
import { RatesScreen } from './screens/RatesScreen';
import { SignInScreen } from './screens/SignInScreen';
import { waitingLine } from './queues';
import { useTowerApp, type Screen } from './useTowerApp';
import '../../shared/console.css';
import './tower.css';

/**
 * The operator console shell: a masthead, a rail of sections, and one work area.
 *
 * No BottomNav, no TopBar, no service worker — the three things every other app in this repo has. They
 * are all answers to the same question ("a phone, in the field, maybe with no signal") and this surface
 * answers a different one. What it does keep is the shared TOKENS and the shared meanings: orange is a
 * state, blue is the action, and every string is a catalogue key.
 */
export function App() {
  const t = useT();
  const { state, actions } = useTowerApp();

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
   * The rail is built from WHAT THIS CALLER REACHES, never trimmed after the fact.
   *
   * Network staff work the hazard queue; a company's administrator does not, and a section whose every
   * row would answer 403 is worse than a missing one — it teaches somebody that the console is broken.
   * The companies view appears only for somebody who reaches more than one, because a comparison of one
   * company with itself is not a comparison.
   */
  const isOperator = state.who?.mode === 'operator';
  const manyCompanies = (state.entities?.length ?? 0) > 1;
  const sections: { key: Screen; label: string; icon: 'route' | 'wallet' | 'grid' | 'warning' | 'box' | 'badge' | 'home' | 'edit'; count: number | null }[] = [
    // Network staff's work, in the order somebody is kept waiting by it: a claim is a person waiting for
    // an answer, a disposal row is a shop holding a box, an application is a shop that cannot start.
    ...(isOperator
      ? [
          // No count beside the overview: a number there would read as "this many things need you",
          // and nothing on it is waiting for anybody.
          { key: 'network' as const, label: t('tower.nav.network'), icon: 'home' as const, count: null },
          { key: 'hazards' as const, label: t('tower.nav.hazards'), icon: 'route' as const, count: state.hazards?.length ?? null },
          { key: 'claims' as const, label: t('tower.nav.claims'), icon: 'warning' as const, count: state.claims?.length ?? null },
          { key: 'disposal' as const, label: t('tower.nav.disposal'), icon: 'box' as const, count: state.disposal?.length ?? null },
          { key: 'approvals' as const, label: t('tower.nav.approvals'), icon: 'badge' as const, count: state.approvals?.length ?? null },
        ]
      : []),
    ...(manyCompanies ? [{ key: 'companies' as const, label: t('tower.nav.companies'), icon: 'grid' as const, count: state.entities?.length ?? null }] : []),
    // No count on the rates section, and not because one is hard to compute: a number beside a section
    // means "this many things are waiting for you", and nothing here is waiting for anybody.
    { key: 'money' as const, label: t('tower.nav.money'), icon: 'wallet' as const, count: null },
    { key: 'rates' as const, label: t('tower.nav.rates'), icon: 'edit' as const, count: null },
  ];

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
                  claims: state.claims?.length ?? null,
                  disposal: state.disposal?.length ?? null,
                  approvals: state.approvals?.length ?? null,
                },
                t,
              )}
            </span>
          ) : null}
        </div>
        <div class="cons__who">
          <span>
            {t('tower.signedInAs')} <span class="cons__whoname">{state.who?.name}</span>
            {/* Which COMPANY, when it is one — an administrator of two sister companies signs in twice,
                and the difference has to be visible from the masthead, not inferred from the table. */}
            {state.who?.entityId ? <span class="ctag ctag--quiet twr-whoco">{companyName(state)}</span> : null}
          </span>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={actions.signOut}>
            {t('tower.signOut')}
          </button>
        </div>
      </header>

      <div class="cons__body">
        <nav class="cons__rail" aria-label={t('tower.rail.heading')}>
          <p class="cons__railhead">{t('tower.rail.heading')}</p>
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              class={`cons__railitem${state.screen === s.key ? ' cons__railitem--on' : ''}`}
              aria-current={state.screen === s.key ? 'page' : undefined}
              onClick={() => actions.go(s.key)}
            >
              <Icon name={s.icon} size={18} />
              <span>{s.label}</span>
              {/* null while unread: a blank count reads as zero, and zero is a different answer. */}
              {s.count === null ? null : <span class="cons__railcount">{s.count}</span>}
            </button>
          ))}
        </nav>

        <main class="cons__main">
          {state.screen === 'money' ? (
            <MoneyScreen state={state} actions={actions} />
          ) : state.screen === 'network' ? (
            <NetworkScreen state={state} actions={actions} />
          ) : state.screen === 'companies' ? (
            <CompaniesScreen state={state} actions={actions} />
          ) : state.screen === 'rates' ? (
            <RatesScreen state={state} actions={actions} />
          ) : state.screen === 'claims' ? (
            <ClaimsScreen state={state} actions={actions} />
          ) : state.screen === 'disposal' ? (
            <DisposalScreen state={state} actions={actions} />
          ) : state.screen === 'approvals' ? (
            <ApprovalsScreen state={state} actions={actions} />
          ) : (
            <HazardsScreen state={state} actions={actions} />
          )}
        </main>
      </div>
    </div>
  );
}

/** The name of the company somebody is signed in as — its id until the list arrives to name it. */
function companyName(state: { who?: { entityId?: string } | null; entities?: { entityId: string; name: string }[] | null }): string {
  const id = state.who?.entityId ?? '';
  return state.entities?.find((e) => e.entityId === id)?.name ?? id;
}
