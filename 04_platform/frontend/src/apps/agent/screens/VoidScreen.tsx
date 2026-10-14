import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, Icon, Note, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { voidCountdownLabel, voidRemainingMs, voidableParcels } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';
import { PhotoField } from './PhotoField';

export interface VoidScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * Reverse logistics (compendium Ch 16.1): "Agent taps Void Transaction on a recently-
 * completed entry." A wrong size, a wrong destination, a duplicate scan — undo it inside
 * the 5-minute window with a photo of the torn label, and the wallet is refunded.
 *
 * The countdown ticks every second so a parcel drops off the list the moment its window
 * closes; the server is still the clock and rejects a late void, which the red signal
 * announces. The torn-label photo is required by both this screen and the backend — it is
 * the proof the label is destroyed and cannot be re-used.
 */
export function VoidScreen({ state, actions }: VoidScreenProps) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const rows = voidableParcels(state.shopParcels, now);
  const loading = state.shopParcelsState === 'loading';
  const selected = state.void.parcelId ? state.shopParcels.find((p) => p.parcelId === state.void.parcelId) ?? null : null;
  const selectedMs = selected ? voidRemainingMs(selected.acceptedAt, now) : 0;

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.void.title')}</h1>
      <p class="scr__lede">{t('agent.void.lede')}</p>

      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('void')} /> : null}

      <Card label={t('agent.void.canUndo', { count: rows.length })}>
        {loading ? (
          <p class="hint">{t('agent.void.getting')}</p>
        ) : rows.length === 0 ? (
          <p class="hint">{t('agent.void.nothingCard')}</p>
        ) : (
          <div class="rows" role="list">
            {rows.map((p) => (
              <button key={p.parcelId} type="button" class="row" onClick={() => actions.openVoid(p.parcelId)}>
                <span class="row__ic">
                  <Icon name="box" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t mono-t">{p.parcelId}</span>
                  <span class="row__s">{`${p.size} · ${t('agent.void.toZone', { zone: p.destZone })}`}</span>
                </span>
                <span class="row__end">
                  <Pill tone="warn" dot>
                    {voidCountdownLabel(voidRemainingMs(p.acceptedAt, now), t)}
                  </Pill>
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            rows.length
              ? (rows.length === 1 ? t('agent.void.aloudOne', { count: rows.length }) : t('agent.void.aloudMany', { count: rows.length }))
              : t('agent.void.aloudNone')
          }
          label={t('agent.readAloud')}
        />
      </div>

      <Sheet open={Boolean(selected)} onClose={() => actions.openVoid(null)} title={t('agent.void.sheetTitle')}>
        {selected ? (
          <>
            <div class="kv">
              <span>{t('agent.void.parcel')}</span>
              <b class="mono-t">{selected.parcelId}</b>
            </div>
            <div class="kv">
              <span>{t('agent.void.timeLeft')}</span>
              <b>{voidCountdownLabel(selectedMs, t)}</b>
            </div>

            {selectedMs <= 0 ? (
              <Note tone="warn" icon="clock" title={t('agent.void.closedTitle')} detail={t('agent.void.closedDetail')} />
            ) : (
              <>
                <p class="t-body" style="margin-top:8px">
                  {t('agent.void.tearLabel')}
                </p>
                <PhotoField
                  id="void-photo"
                  value={state.void.photoRef}
                  label={t('agent.void.tornPhoto')}
                  upload={(file) => actions.uploadPhoto('dropoff', file)}
                  onCapture={(ref) => actions.setVoidPhoto(ref)}
                />
                <Checklist items={[t('agent.void.check1'), t('agent.void.check2')]} />
                <Button
                  chevron={false}
                  disabled={!state.void.photoRef || selectedMs <= 0}
                  busy={state.busy === 'void'}
                  onClick={() => void actions.submitVoid()}
                >
                  {t('agent.void.undoRefund')}
                </Button>
              </>
            )}
            <Button variant="link" onClick={() => actions.openVoid(null)}>
              {t('agent.void.keepParcel')}
            </Button>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
