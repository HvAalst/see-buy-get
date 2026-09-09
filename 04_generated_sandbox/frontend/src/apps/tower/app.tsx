import { BrandMark, Icon } from '../../shared/ui';
import { useT } from '../../shared/i18n';
import { HazardsScreen } from './screens/HazardsScreen';
import { RatesScreen } from './screens/RatesScreen';
import { SignInScreen } from './screens/SignInScreen';
import { towerWorkLine } from './logic';
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

  const sections: { key: Screen; label: string; icon: 'route' | 'wallet'; count: number | null }[] = [
    { key: 'hazards', label: t('tower.nav.hazards'), icon: 'route', count: state.hazards?.length ?? null },
    // No count on the rates section, and not because one is hard to compute: a number beside a section
    // means "this many things are waiting for you", and nothing here is waiting for anybody.
    { key: 'rates', label: t('tower.nav.rates'), icon: 'wallet', count: null },
  ];

  return (
    <div class="cons">
      <header class="cons__mast">
        <div class="cons__brand">
          <BrandMark size={26} />
          <span class="cons__brandname">{t('tower.appTitle')}</span>
          {/* The live line carries WORK, never identity — the same rule as the phone apps' TopBar. */}
          <span class="cons__mastwork">· {towerWorkLine(state.hazards?.length ?? null, t)}</span>
        </div>
        <div class="cons__who">
          <span>
            {t('tower.signedInAs')} <span class="cons__whoname">{state.operator?.name}</span>
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
          {state.screen === 'rates' ? <RatesScreen state={state} actions={actions} /> : <HazardsScreen state={state} actions={actions} />}
        </main>
      </div>
    </div>
  );
}
