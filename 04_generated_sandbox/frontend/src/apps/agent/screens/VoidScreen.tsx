import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, Icon, Note, Pill, ReadAloud, Sheet } from '../../../shared/ui';
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const rows = voidableParcels(state.shopParcels, now);
  const loading = state.shopParcelsState === 'loading';
  const selected = state.void.parcelId ? state.shopParcels.find((p) => p.parcelId === state.void.parcelId) ?? null : null;
  const selectedMs = selected ? voidRemainingMs(selected.acceptedAt, now) : 0;

  return (
    <div class="scr">
      <h1 class="scr__title">Undo a drop-off</h1>
      <p class="scr__lede">Took one in by mistake? You have five minutes to undo it and get your money back.</p>

      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('void')} /> : null}

      <Card label={`You can still undo (${rows.length})`}>
        {loading ? (
          <p class="hint">Getting your recent drop-offs…</p>
        ) : rows.length === 0 ? (
          <p class="hint">Nothing to undo. Only a parcel you took in within the last five minutes can be undone.</p>
        ) : (
          <div class="rows" role="list">
            {rows.map((p) => (
              <button key={p.parcelId} type="button" class="row" onClick={() => actions.openVoid(p.parcelId)}>
                <span class="row__ic">
                  <Icon name="box" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t mono-t">{p.parcelId}</span>
                  <span class="row__s">{`${p.size} · to ${p.destZone}`}</span>
                </span>
                <span class="row__end">
                  <Pill tone="warn" dot>
                    {voidCountdownLabel(voidRemainingMs(p.acceptedAt, now))}
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
              ? `${rows.length} drop-off${rows.length === 1 ? '' : 's'} can still be undone. Tap one, photograph the torn label, and confirm.`
              : 'Nothing to undo. Only a parcel taken in within the last five minutes can be undone.'
          }
          label="Read this aloud"
        />
      </div>

      <Sheet open={Boolean(selected)} onClose={() => actions.openVoid(null)} title="Undo this drop-off?">
        {selected ? (
          <>
            <div class="kv">
              <span>Parcel</span>
              <b class="mono-t">{selected.parcelId}</b>
            </div>
            <div class="kv">
              <span>Time left</span>
              <b>{voidCountdownLabel(selectedMs)}</b>
            </div>

            {selectedMs <= 0 ? (
              <Note tone="warn" icon="clock" title="The window has closed" detail="This one can no longer be undone. Ask the control tower." />
            ) : (
              <>
                <p class="t-body" style="margin-top:8px">
                  Tear the label off the parcel and photograph it — that is the proof it cannot be used again.
                </p>
                <PhotoField
                  id="void-photo"
                  value={state.void.photoRef}
                  label="Photo of the torn label"
                  upload={(file) => actions.uploadPhoto('dropoff', file)}
                  onCapture={(ref) => actions.setVoidPhoto(ref)}
                />
                <Checklist items={['Your wallet is refunded straight away', 'The parcel is cancelled for good']} />
                <Button
                  chevron={false}
                  disabled={!state.void.photoRef || selectedMs <= 0}
                  busy={state.busy === 'void'}
                  onClick={() => void actions.submitVoid()}
                >
                  Undo and refund me
                </Button>
              </>
            )}
            <Button variant="link" onClick={() => actions.openVoid(null)}>
              Keep the parcel
            </Button>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
