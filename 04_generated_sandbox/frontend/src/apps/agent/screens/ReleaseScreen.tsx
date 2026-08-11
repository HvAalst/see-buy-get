import { Button, Card, Checklist, CodeBoxes, CodeCard, ErrorNote, Note, ReadAloud, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { otpValid, releaseBlockedDetail, releaseStage } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';
import { PhotoField } from './PhotoField';

export interface ReleaseScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * Release to the customer — the walk-up flow. Find the parcel by sticker, then the screen
 * follows its status: still on the bus → mark arrived (sends the code); ready → verify the
 * 4-digit code; delivered → take the rating. One stage on screen at a time.
 */
export function ReleaseScreen({ state, actions }: ReleaseScreenProps) {
  const t = useT();
  const f = state.release;
  const p = f.parcel;
  const stage = p ? releaseStage(p.status) : null;

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.release.title')}</h1>
      <p class="scr__lede">{t('agent.release.lede')}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
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

      {p && stage === 'otp' && f.issuedOtp ? (
        <CodeCard label={t('agent.release.sandboxCode')} code={f.issuedOtp} />
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
              ? t('agent.release.aloudScan')
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
