import { Button, Card, ErrorNote, Icon, Note, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { toPlaceWords } from '../../../shared/placewords';
import { LADDER, freightTrackSummary, ladderIndex, mapsHref, showCollectCard, statusPresentation, stepTime, trackSummary } from '../logic';
import { isFreightTrack } from '../types';
import { FreightTrack } from './FreightTrack';
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
  const t = useT();
  // FP6 — one key, two kinds of thing. A load renders its own ladder; everything below that is the parcel's.
  const raw = state.result;
  const freight = raw && isFreightTrack(raw) ? raw : null;
  const res = raw && !isFreightTrack(raw) ? raw : null;
  const offLadder = res && ladderIndex(res.status) === -1;
  const at = res ? ladderIndex(res.status) : -1;

  return (
    <div class="scr">
      <h1 class="scr__title">{t('send.track.title')}</h1>
      <p class="scr__lede">{t('send.track.lede')}</p>

      <Card>
        <div class="field">
          <label class="field__label" for="track-key">
            {t('send.track.codeLabel')}
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
          {/* Once a result is on screen, the way-finding CTA takes the solid slot (one per screen). */}
          <Button
            variant={raw ? 'outline' : 'primary'}
            chevron={false}
            onClick={() => void actions.runTrack()}
            disabled={!state.key.trim()}
            busy={state.trackState === 'loading'}
          >
            {t('send.track.find')}
          </Button>
        </div>
      </Card>

      {state.trackState === 'error' && state.trackError ? <ErrorNote error={state.trackError} onRetry={() => void actions.runTrack()} /> : null}

      {freight ? <FreightTrack view={freight} /> : null}

      {res && offLadder ? (
        <Note
          tone="danger"
          icon={statusPresentation(res.status, t).icon}
          title={statusPresentation(res.status, t).word}
          detail={t('send.track.offDetail', { dest: res.destination })}
        />
      ) : null}

      {res && !offLadder ? (
        <>
          <section class={`now now--${statusPresentation(res.status, t).tone}`} aria-live="polite">
            <Icon name={statusPresentation(res.status, t).icon} size={34} class="now__ic" />
            <span class="now__body">
              <span class="now__word">{statusPresentation(res.status, t).word}</span>
              <span class="now__sub">
                {res.status === 'Ready_For_Pickup'
                  ? t('send.track.collectAt', { dest: res.destination })
                  : res.status === 'Delivered'
                    ? t('send.track.handedAt', { dest: res.destination })
                    : t('send.track.goingTo', { dest: res.destination })}
              </span>
            </span>
          </section>

          {showCollectCard(res.status) ? (
            <>
              <div class="row row--static" role="group" aria-label={t('send.track.whereCollect')}>
                <span class="row__ic">
                  <Icon name="home" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t">{res.destination}</span>
                  <span class="row__s">{res.destinationLandmark ?? t('send.zone', { zone: res.destZone })}</span>
                  {res.destinationLocation ? <span class="row__s words">{toPlaceWords(res.destinationLocation)}</span> : null}
                </span>
              </div>
              {res.destinationLocation ? (
                <ReadAloud
                  text={() => t('send.track.sayWords', { words: toPlaceWords(res.destinationLocation!).split(' ').join(', ') })}
                  label={t('send.track.sayWhere')}
                />
              ) : null}
              {res.status === 'Ready_For_Pickup' && mapsHref(res) ? (
                <div class="scr__cta">
                  <a class="btn btn--primary btn--full" href={mapsHref(res)!} target="_blank" rel="noopener">
                    {t('send.track.showWay')}
                    <Icon name="chevronRight" size={20} class="btn__chev" />
                  </a>
                </div>
              ) : null}
            </>
          ) : null}

          <Card label={t('send.track.journeySoFar')}>
            <ol class="ladder">
              {LADDER.map((s, i) => {
                const p = statusPresentation(s, t);
                const done = i < at;
                const now = i === at;
                const step = res.steps.find((x) => x.status === s);
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

      {/* CV5 — the invitation, where the buyer already is. A tracking code is a stranger's view of a parcel; signing in
          with the phone the store was given makes it theirs: told when it arrives, the code kept in the app, and a
          word with the shop — so what they hear no longer depends on the store's own messages alone. */}
      {res && !state.identity ? (
        <Card title={t('send.track.signUpTitle')} tone="soft">
          <p class="card__note">{t('send.track.signUpBody')}</p>
          <Button variant="outline" chevron={false} onClick={() => actions.go('account')}>
            {t('send.track.signUp')}
          </Button>
        </Card>
      ) : null}

      {state.recent.length ? (
        <Card title={t('send.track.recentTitle')} tone="soft">
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
          text={() => (freight ? freightTrackSummary(freight, t) : res ? trackSummary(res, t) : t('send.track.aloudPrompt'))}
          label={t('send.readAloud')}
        />
      </div>
    </div>
  );
}
