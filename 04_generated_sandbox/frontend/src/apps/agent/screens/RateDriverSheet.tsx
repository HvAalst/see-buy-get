import { useState } from 'preact/hooks';
import { Button, Icon, Sheet } from '../../../shared/ui';
import { DRIVER_ISSUE_LABELS } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';

/**
 * REP2 — the "rate the driver" prompt, shown right after the shop hands a batch to the bus or receives a bag,
 * while the interaction is fresh. A star rating plus the specific things that went wrong (late pickup, kept
 * overnight, arrived after hours, equipment trouble). Mount this KEYED by driverDid so the form resets per
 * driver. The server gates the submission on the real interaction, so this can't rate a stranger.
 */
export function RateDriverSheet({ state, actions }: { state: AgentState; actions: AgentActions }) {
  const rd = state.driverRating;
  const [stars, setStars] = useState(0);
  const [issues, setIssues] = useState<string[]>([]);
  const toggle = (k: string) => setIssues((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  const name = rd?.profile?.name;
  const current = rd?.profile?.rating;

  return (
    <Sheet open={Boolean(rd)} onClose={actions.dismissRateDriver} title="Rate the driver">
      <p class="t-body">{name ? `How did ${name} do on this run?` : 'How did the driver do on this run?'}</p>
      {current && current.count && !current.isNew ? <p class="hint">{`Currently rated ${current.average.toFixed(1)} by ${current.count} shop${current.count === 1 ? '' : 's'}.`}</p> : null}

      <div class="stars" role="group" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" class={`starbtn${stars >= n ? ' starbtn--on' : ''}`} aria-pressed={stars >= n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setStars(n)}>
            <Icon name="star" size={28} />
          </button>
        ))}
      </div>

      <p class="card__note" style="margin-top:12px">Anything that went wrong? (optional)</p>
      <div class="rows" role="group" aria-label="What went wrong">
        {DRIVER_ISSUE_LABELS.map((it) => (
          <label key={it.key} class="checkline">
            <input type="checkbox" checked={issues.includes(it.key)} onChange={() => toggle(it.key)} />
            <span>{it.label}</span>
          </label>
        ))}
      </div>

      <div class="scr__cta">
        <Button disabled={!stars} busy={state.busy === 'rate-driver'} onClick={() => void actions.submitDriverRating(stars, issues)}>
          Save the rating
        </Button>
      </div>
      <Button variant="link" onClick={actions.dismissRateDriver}>
        Skip
      </Button>
    </Sheet>
  );
}
