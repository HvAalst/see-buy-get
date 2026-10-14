import { useState } from 'preact/hooks';
import { Button, Icon, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { DRIVER_ISSUE_LABELS } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';

/**
 * REP2 — the "rate the driver" prompt, shown right after the shop hands a batch to the bus or receives a bag,
 * while the interaction is fresh. A star rating plus the specific things that went wrong (late pickup, kept
 * overnight, arrived after hours, equipment trouble). Mount this KEYED by driverDid so the form resets per
 * driver. The server gates the submission on the real interaction, so this can't rate a stranger.
 */
export function RateDriverSheet({ state, actions }: { state: AgentState; actions: AgentActions }) {
  const t = useT();
  const rd = state.driverRating;
  const [stars, setStars] = useState(0);
  const [issues, setIssues] = useState<string[]>([]);
  const toggle = (k: string) => setIssues((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  const name = rd?.profile?.name;
  const current = rd?.profile?.rating;

  return (
    <Sheet open={Boolean(rd)} onClose={actions.dismissRateDriver} title={t('agent.rateDriver.title')}>
      <p class="t-body">{name ? t('agent.rateDriver.howNamed', { name }) : t('agent.rateDriver.howAnon')}</p>
      {current && current.count && !current.isNew ? <p class="hint">{current.count === 1 ? t('agent.rateDriver.currentOne', { avg: current.average.toFixed(1), count: current.count }) : t('agent.rateDriver.currentMany', { avg: current.average.toFixed(1), count: current.count })}</p> : null}

      <div class="stars" role="group" aria-label={t('agent.rateDriver.starsAria')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" class={`starbtn${stars >= n ? ' starbtn--on' : ''}`} aria-pressed={stars >= n} aria-label={n === 1 ? t('agent.rateDriver.starOne', { n }) : t('agent.rateDriver.starMany', { n })} onClick={() => setStars(n)}>
            <Icon name="star" size={28} />
          </button>
        ))}
      </div>

      <p class="card__note" style="margin-top:12px">{t('agent.rateDriver.wrongPrompt')}</p>
      <div class="rows" role="group" aria-label={t('agent.rateDriver.wrongAria')}>
        {DRIVER_ISSUE_LABELS.map((it) => (
          <label key={it.key} class="checkline">
            <input type="checkbox" checked={issues.includes(it.key)} onChange={() => toggle(it.key)} />
            <span>{t(it.labelKey)}</span>
          </label>
        ))}
      </div>

      <div class="scr__cta">
        <Button disabled={!stars} busy={state.busy === 'rate-driver'} onClick={() => void actions.submitDriverRating(stars, issues)}>
          {t('agent.saveRating')}
        </Button>
      </div>
      <Button variant="link" onClick={actions.dismissRateDriver}>
        {t('agent.rateDriver.skip')}
      </Button>
    </Sheet>
  );
}
