import { Button, Card, Checklist, CodeBoxes, ErrorNote, Note, ReadAloud, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { handoverRoute, otpValid, releaseBlockedDetail, releaseStage } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';
import { CollectBody } from './CollectScreen';
import { PhotoField } from './PhotoField';

export interface ReleaseScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * THE COUNTER. One person is standing there wanting their parcel, so there is one screen.
 *
 * It used to be two — "Collect an order" and "Hand to a customer" — and a shopkeeper had to work out
 * which kind of customer they were facing before they could serve them. A person holding a code looks
 * identical either way, so the app's first question was one only the shopkeeper could answer, about a
 * parcel they had not found yet. The code comes first now, because it is the thing the customer has.
 *
 * What follows depends on what the code turns out to be, and the difference is forced by the secrets
 * themselves rather than chosen: an order code identifies a parcel on its own, a four-digit peer-send
 * code cannot identify anything and stays what it always was — a second factor checked against a parcel
 * already in hand. So that path still asks for the label or sticker, but SECOND, and only once we know
 * it is that kind of hand-over.
 */
export function ReleaseScreen({ state, actions }: ReleaseScreenProps) {
  const t = useT();
  const f = state.release;
  const p = f.parcel;
  const stage = p ? releaseStage(p.status) : null;
  const route = handoverRoute(state.collect.code);
  const found = state.collect.found;

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.counter.title')}</h1>
      <p class="scr__lede">{t('agent.counter.lede')}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      {/* The one question the customer can always answer. */}
      <Card>
        <ScanField
          id="counter-code"
          label={t('agent.counter.codeLabel')}
          value={state.collect.code}
          onValue={(v) => actions.setCollect({ code: v })}
          expect="collect"
          placeholder={t('agent.counter.codePh')}
          upper
          enterKeyHint="search"
          onScan={(v) => void actions.handOver(v)}
        />
        <div style="margin-top:12px">
          <Button chevron={false} onClick={() => void actions.handOver()} disabled={!state.collect.code.trim() || route === 'unknown'} busy={state.busy === 'collect-find'}>
            {t('agent.counter.go')}
          </Button>
        </div>
        {/* Said as soon as it is typed, not after a lookup: a mistyped order code that fell through to a
            search comes back "no parcel for that code", which reads as the parcel being missing rather
            than the code being wrong — and sends a shopkeeper to look at a shelf for nothing. */}
        {state.collect.code.trim() && route === 'unknown' ? (
          <p class="hint">{t('agent.counter.unknownCode')}</p>
        ) : null}
      </Card>

      {/* An ORDER code resolved a parcel by itself — straight to the shelf slot and the hand-over. */}
      {route === 'order' && found ? <CollectBody state={state} actions={actions} /> : null}

      {/* A PEER-SEND code cannot resolve anything, so now — and only now, knowing which hand-over this
          is — the shopkeeper is asked for the parcel. The code they already typed is carried over. */}
      {route === 'peer' && !p ? (
        <Card title={t('agent.counter.peerTitle')}>
          <p class="t-body">{t('agent.counter.peerBody')}</p>
          <ScanField
            id="pick-id"
            label={t('agent.release.stickerLabel')}
            value={f.stickerId}
            onValue={(v) => actions.setRelease({ stickerId: v })}
            expect="parcel"
            placeholder={t('agent.release.stickerPh')}
            upper
            enterKeyHint="search"
            onScan={(v) => void actions.findRelease(v)}
          />
          <div style="margin-top:12px">
            <Button chevron={false} onClick={() => void actions.findRelease()} disabled={!f.stickerId.trim()} busy={state.busy === 'find'}>
              {t('agent.release.findParcel')}
            </Button>
          </div>
        </Card>
      ) : null}

      {p && stage === 'arrive' ? (
        <Card title={t('agent.release.onBusTitle')} label={p.parcelId}>
          <p class="t-body">{t('agent.release.onBusBody')}</p>
          <div style="margin-top:12px">
            <Button chevron={false} onClick={() => void actions.markArrived()} busy={state.busy === 'arrive'}>
              {t('agent.release.markArrived')}
            </Button>
          </div>
        </Card>
      ) : null}

      {p && stage === 'otp' ? (
        <Card title={t('agent.release.confirmHandover')} label={p.parcelId}>
          {p.binSlot ? <p class="t-body">{t('agent.release.fetchShelf', { slot: p.binSlot })}</p> : null}
          <div class="field" style="margin-top:8px">
            <span class="field__label">{t('agent.release.enterCode')}</span>
            <CodeBoxes id="otp" label={t('agent.release.codeBoxLabel')} value={f.otp} onInput={(otp) => actions.setRelease({ otp })} />
          </div>
          <div style="margin-top:12px">
            <PhotoField
              id="handover-photo"
              value={f.photoRef}
              label={t('agent.release.handoverPhoto')}
              upload={(file) => actions.uploadPhoto('pod', file)}
              onCapture={(ref) => actions.setRelease({ photoRef: ref })}
            />
          </div>
          <div style="margin-top:12px">
            <Button chevron onClick={() => void actions.submitPickup()} disabled={!otpValid(f.otp)} busy={state.busy === 'pickup'}>
              {t('agent.release.confirmHandover')}
            </Button>
          </div>
        </Card>
      ) : null}

      {p && stage === 'rate' ? (
        <Card title={t('agent.release.rateTitle')} label={p.parcelId}>
          <p class="t-body">{t('agent.release.rateBody')}</p>
          <div class="stars" role="group" aria-label={t('agent.release.rateAria')}>
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <button
                key={n}
                type="button"
                class={`starbtn${f.stars >= n ? ' starbtn--on' : ''}`}
                aria-pressed={f.stars >= n}
                aria-label={t('agent.release.starAria', { n })}
                onClick={() => actions.setRelease({ stars: n })}
              >
                {n}
              </button>
            ))}
          </div>
          <p class="hint">{f.stars === 0 ? t('agent.release.starHint0') : f.stars >= 4 ? t('agent.release.starHintHigh') : f.stars === 3 ? t('agent.release.starHintMid') : t('agent.release.starHintLow')}</p>
          <div style="margin-top:12px">
            <Button chevron={false} onClick={() => void actions.submitRating()} disabled={!f.stars} busy={state.busy === 'rate'}>
              {t('agent.saveRating')}
            </Button>
          </div>
        </Card>
      ) : null}

      {p && stage === 'blocked' ? <Note tone="info" icon="clock" title={t('agent.release.nothingTitle')} detail={releaseBlockedDetail(p.status, t)} /> : null}

      {p && stage === 'otp' ? (
        <Card title={t('agent.release.noCodeTitle')} tone="soft">
          <Checklist items={[t('agent.release.noCode1'), t('agent.release.noCode2'), t('agent.release.noCode3')]} />
        </Card>
      ) : null}

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            !p
              ? route === 'peer'
                ? t('agent.release.aloudScan')
                : t('agent.counter.aloudCode')
              : stage === 'otp'
                ? t('agent.release.aloudOtp')
                : stage === 'arrive'
                  ? t('agent.release.aloudArrive')
                  : stage === 'rate'
                    ? t('agent.release.aloudRate')
                    : releaseBlockedDetail(p.status, t)
          }
          label={t('agent.readAloud')}
        />
      </div>
    </div>
  );
}
