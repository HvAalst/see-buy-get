import { useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Note } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { historyOf, type AdviserFailure, type AdviserTurn, type PlanAdvice, type PlanAsk, type ordersApi } from '../orders';

const FAILED: Record<AdviserFailure, MessageKey> = {
  not_configured: 'fleet.adviser.failed.off',
  busy: 'fleet.adviser.failed.busy',
  unreachable: 'fleet.adviser.failed.unreachable',
  declined: 'fleet.adviser.failed.declined',
};

/**
 * P5 — THE ADVISER OVER A DAY'S PLAN.
 *
 * The user, 2026-10-05: the math plans, AI advises. So this box takes a question or an instruction in the
 * dispatcher's own words and shows two things apart from each other: what the adviser SAID, and what actually
 * CHANGED in what the planner was asked — the second worked out by the server, not taken from the first. When they
 * disagree the dispatcher can see it.
 *
 * It only ever hands the board a proposal. Accepting stays the dispatcher's, on the board.
 */
export function PlanAdviser({ api, ask, busy, onAdvice }: { api: ReturnType<typeof ordersApi>; ask: PlanAsk; busy: boolean; onAdvice: (advice: PlanAdvice) => void }) {
  const t = useT();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<AdviserTurn[]>([]);
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const [stopped, setStopped] = useState<{ failed: AdviserFailure; changed: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    void api.adviserStatus().then((r) => {
      if (live) setConfigured(Boolean(r.data?.configured));
    });
    return () => {
      live = false;
    };
  }, [api]);

  const send = async () => {
    const said = text.trim();
    if (!said || asking) return;
    setAsking(true);
    setStopped(null);
    setError(null);
    const r = await api.advise(ask, said, historyOf(turns));
    setAsking(false);
    if (r.error || !r.data) return setError(r.error);
    // The plan that came back is the planner's, whether or not the adviser had a last word about it.
    onAdvice(r.data);
    if (r.data.failed) {
      if (r.data.failed === 'not_configured') setConfigured(false);
      // What was typed stays in the box, to send again.
      return setStopped({ failed: r.data.failed, changed: r.data.changed });
    }
    setTurns([...turns, { role: 'user', text: said }, { role: 'assistant', text: r.data.reply, changed: r.data.changed }]);
    setText('');
  };

  if (configured === null) return null;
  return (
    <Card title={t('fleet.adviser.title')}>
      {configured === false ? (
        <p class="hint">{t('fleet.adviser.off')}</p>
      ) : (
        <>
          <p class="hint">{t('fleet.adviser.what')}</p>
          {turns.length ? (
            <ol class="adviser__turns" aria-live="polite">
              {turns.map((turn, i) => (
                <li key={i} class={`adviser__turn adviser__turn--${turn.role}`}>
                  <span class="adviser__who">{t(turn.role === 'user' ? 'fleet.adviser.you' : 'fleet.adviser.it')}</span>
                  <p class="adviser__text">{turn.text}</p>
                  {turn.role !== 'assistant' ? null : turn.changed?.length ? (
                    <div class="adviser__changed">
                      <span>{t('fleet.adviser.changed')}</span>
                      <ul>
                        {turn.changed.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p class="adviser__same">{t('fleet.adviser.unchanged')}</p>
                  )}
                </li>
              ))}
            </ol>
          ) : null}
          {stopped ? <Note tone="warn" icon="warning" title={t(FAILED[stopped.failed])} detail={stopped.changed.length ? t('fleet.adviser.changedBefore', { what: stopped.changed.join('; ') }) : undefined} /> : null}
          {error ? <ErrorNote error={error as never} showDetail onRetry={() => void send()} /> : null}
          <div class="field adviser__ask">
            <label class="field__label" for="adv-text">
              {t('fleet.adviser.label')}
            </label>
            <textarea id="adv-text" class="input" rows={2} maxLength={1000} value={text} placeholder={t('fleet.adviser.placeholder')} onInput={(e) => setText(e.currentTarget.value)} />
          </div>
          <div class="plan__acts">
            <Button chevron={false} busy={asking} disabled={!text.trim() || asking || busy} onClick={() => void send()}>
              {t('fleet.adviser.ask')}
            </Button>
          </div>
          <p class="hint">{t('fleet.adviser.sent')}</p>
        </>
      )}
    </Card>
  );
}
