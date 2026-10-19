import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Chip, ErrorNote, Note, OpenInMaps, Pill } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import type { SbgClient } from '../../../lib/sbg';
import { WATCH_CHOICES, caseLine, casesInOrder, minutesWords, outcomeWord, standstillApi, watchLine, type StandstillCase, type StandstillOutcome, type StandstillView } from '../standstill';

/** Read again every minute: a vehicle standing still is news while it stands, not when the screen is next opened. */
const REFRESH_MS = 60_000;

/**
 * Round 16 — a vehicle standing still. Its office reads each case first on the dashboard: which vehicle, who drives it,
 * how long and since when, where (a tap to the maps app), and says how it was once it has called the driver. The watch
 * itself — on, off, how long is too long — is set here too, by any manager of the fleet.
 */
export function StandstillCard({ sbg, did }: { sbg: SbgClient | null; did?: string }) {
  const t = useT();
  const [view, setView] = useState<StandstillView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [setting, setSetting] = useState(false);
  const api = sbg && did ? standstillApi(sbg, did) : null;

  const load = () => {
    if (!api) return;
    void api.view().then((r) => (r.data ? setView(r.data) : undefined));
  };
  useEffect(() => {
    load();
    const every = setInterval(load, REFRESH_MS);
    return () => clearInterval(every);
  }, [sbg, did]);

  if (!api || !view) return null;
  const when = (iso: string) => formatDate(iso, { hour: '2-digit', minute: '2-digit' });
  const cases = casesInOrder(view.cases);
  const standing = cases.filter((c) => c.state === 'open').length;

  const set = async (on: boolean, afterMin: number) => {
    if (busy) return; // a chip tapped twice sets it once
    setBusy(`set-${on ? afterMin : 'off'}`);
    setError(null);
    const r = await api.setSettings(on, afterMin);
    setBusy(null);
    if (r.error || !r.data) return setError(r.error);
    setView({ ...view, settings: r.data });
    setSetting(false);
  };
  const answered = (c: StandstillCase) => setView({ ...view, cases: view.cases.map((x) => (x.caseId === c.caseId ? c : x)) });

  return (
    <Card title={t('fleet.still.title')} aside={standing ? <Pill tone="warn" dot>{t('fleet.still.standing', { n: standing })}</Pill> : undefined}>
      {cases.length === 0 ? <p class="card__note">{view.settings.on ? t('fleet.still.none') : t('fleet.still.offNone')}</p> : null}
      {cases.map((c) => (
        <StandstillRow key={c.caseId} c={c} api={api} when={when} onAnswered={answered} />
      ))}
      <p class="hint">
        {watchLine(view.settings, t)}{' '}
        <Button variant="link" full={false} onClick={() => setSetting(!setting)}>
          {setting ? t('common.cancel') : t('fleet.still.change')}
        </Button>
      </p>
      {setting ? (
        <>
          <p class="hint">{t('fleet.still.settingLede')}</p>
          <div class="chips" role="radiogroup" aria-label={t('fleet.still.title')}>
            {WATCH_CHOICES.map((n) => (
              <Chip key={n} label={t('fleet.still.after', { minutes: minutesWords(n) })} active={view.settings.on && view.settings.afterMin === n} onClick={() => void set(true, n)} />
            ))}
            <Chip label={t('fleet.still.turnOff')} active={!view.settings.on} onClick={() => void set(false, view.settings.afterMin)} />
          </div>
        </>
      ) : null}
      {error ? <ErrorNote error={error as never} showDetail /> : null}
    </Card>
  );
}

/** One vehicle: how long it has stood, where, and — once its office has called — how it was. */
function StandstillRow({ c, api, when, onAnswered }: { c: StandstillCase; api: ReturnType<typeof standstillApi>; when: (iso: string) => string; onAnswered: (c: StandstillCase) => void }) {
  const t = useT();
  const [wrong, setWrong] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<StandstillOutcome | null>(null);
  const [error, setError] = useState<unknown>(null);
  const say = async (outcome: StandstillOutcome) => {
    setBusy(outcome);
    setError(null);
    const r = await api.answer(c.caseId, outcome, note);
    setBusy(null);
    if (r.error || !r.data) return setError(r.error);
    setWrong(false);
    onAnswered(r.data);
  };
  const tone = c.state === 'open' ? 'warn' : c.answer?.outcome === 'problem' ? 'danger' : 'idle';
  return (
    <div style="margin-top:12px">
      <div class="kv">
        <span>
          <span class="mono-t">{c.plate}</span>
          {c.driverName ? ` · ${c.driverName}` : ''}
        </span>
        <Pill tone={tone}>{c.state === 'open' ? t('fleet.still.stateOpen') : c.state === 'answered' ? t('fleet.still.stateAnswered') : t('fleet.still.stateOver')}</Pill>
      </div>
      <p class="hint">{caseLine(c, t, when)}</p>
      {c.answer ? <p class="hint">{t('fleet.still.answeredBy', { outcome: outcomeWord(c.answer.outcome, t), by: c.answer.by, when: when(c.answer.at) }) + (c.answer.note ? ` “${c.answer.note}”` : '')}</p> : null}
      {c.state !== 'over' ? <OpenInMaps point={c.location} label={t('fleet.still.where')} /> : null}
      {c.state === 'open' ? (
        wrong ? (
          <>
            <div class="field">
              <label class="field__label" for={`still-${c.caseId}`}>
                {t('fleet.still.whatsWrong')}
              </label>
              <textarea id={`still-${c.caseId}`} class="input" rows={3} maxLength={500} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
            </div>
            <div class="btnrow">
              <Button chevron={false} danger full={false} disabled={!note.trim()} busy={busy === 'problem'} onClick={() => void say('problem')}>
                {t('fleet.still.sayWrong')}
              </Button>
              <Button variant="link" full={false} onClick={() => setWrong(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p class="hint">{t('fleet.still.callFirst')}</p>
            <div class="btnrow">
              <Button chevron={false} full={false} busy={busy === 'all_well'} onClick={() => void say('all_well')}>
                {t('fleet.still.outcome.all_well')}
              </Button>
              <Button chevron={false} variant="outline" full={false} busy={busy === 'no_answer'} onClick={() => void say('no_answer')}>
                {t('fleet.still.outcome.no_answer')}
              </Button>
              <Button chevron={false} variant="outline" full={false} onClick={() => setWrong(true)}>
                {t('fleet.still.outcome.problem')}
              </Button>
            </div>
          </>
        )
      ) : null}
      {c.state === 'answered' && c.answer?.outcome === 'no_answer' ? <Note tone="warn" icon="phone" title={t('fleet.still.noAnswerStill')} /> : null}
      {error ? <ErrorNote error={error as never} showDetail /> : null}
    </div>
  );
}
