import { Button, Card, ErrorNote, Icon, Note, ReadAloud } from '../../../shared/ui';
import { LADDER, ladderIndex, statusPresentation, stepTime, trackSummary } from '../logic';
import type { SendActions, SendState } from '../useSendApp';

export interface TrackScreenProps {
  state: SendState;
  actions: SendActions;
}

/**
 * The GET of See-Buy-Get: type (or tap) the tracking code, read the answer as a ladder —
 * every rung an icon + plain words, the current one highlighted. Disputed/Voided fall off
 * the ladder and render as a full-width note instead.
 */
export function TrackScreen({ state, actions }: TrackScreenProps) {
  const t = state.result;
  const offLadder = t && ladderIndex(t.status) === -1;
  const at = t ? ladderIndex(t.status) : -1;

  return (
    <div class="scr">
      <h1 class="scr__title">Where is my parcel?</h1>
      <p class="scr__lede">Type the tracking code from your message.</p>

      <Card>
        <div class="field">
          <label class="field__label" for="track-key">
            Tracking code
          </label>
          <input
            id="track-key"
            class="input input--mono"
            value={state.key}
            onInput={(e) => actions.setKey(e.currentTarget.value)}
            placeholder="T-0000"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck={false}
            enterkeyhint="search"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void actions.runTrack();
              }
            }}
          />
        </div>
        <div style="margin-top:12px">
          <Button chevron={false} onClick={() => void actions.runTrack()} disabled={!state.key.trim()} busy={state.trackState === 'loading'}>
            Find my parcel
          </Button>
        </div>
      </Card>

      {state.trackState === 'error' && state.trackError ? <ErrorNote error={state.trackError} onRetry={() => void actions.runTrack()} /> : null}

      {t && offLadder ? (
        <Note
          tone="danger"
          icon={statusPresentation(t.status).icon}
          title={statusPresentation(t.status).word}
          detail={`Ask at ${t.destination} — they can see what happened.`}
        />
      ) : null}

      {t && !offLadder ? (
        <>
          <section class={`now now--${statusPresentation(t.status).tone}`} aria-live="polite">
            <Icon name={statusPresentation(t.status).icon} size={34} class="now__ic" />
            <span class="now__body">
              <span class="now__word">{statusPresentation(t.status).word}</span>
              <span class="now__sub">
                {t.status === 'Ready_For_Pickup'
                  ? `Collect it at ${t.destination}`
                  : t.status === 'Delivered'
                    ? `Handed over at ${t.destination}`
                    : `Going to ${t.destination}`}
              </span>
            </span>
          </section>

          <Card label="The journey so far">
            <ol class="ladder">
              {LADDER.map((s, i) => {
                const p = statusPresentation(s);
                const done = i < at;
                const now = i === at;
                const step = t.steps.find((x) => x.status === s);
                return (
                  <li key={s} class={`ladder__rung${done ? ' ladder__rung--done' : ''}${now ? ' ladder__rung--now' : ''}`}>
                    <span class="ladder__ic" aria-hidden="true">
                      <Icon name={done ? 'check' : p.icon} size={20} />
                    </span>
                    <span class="ladder__body">
                      <span class="ladder__word">{p.word}</span>
                      {step ? <span class="ladder__time">{stepTime(step.at)}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>
        </>
      ) : null}

      {state.recent.length ? (
        <Card title="Parcels you looked up before" tone="soft">
          <div class="rows" role="list">
            {state.recent.map((k) => (
              <button key={k} type="button" class="row" onClick={() => void actions.runTrack(k)}>
                <span class="row__ic">
                  <Icon name="search" size={22} />
                </span>
                <span class="row__body">
                  <span class="row__t mono-t">{k}</span>
                </span>
                <span class="row__end">
                  <Icon name="chevronRight" size={22} />
                </span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <div class="scr__foot">
        <ReadAloud
          text={() => (t ? trackSummary(t) : 'Type the tracking code from your message, then tap find my parcel.')}
          label="Read this aloud"
        />
      </div>
    </div>
  );
}
