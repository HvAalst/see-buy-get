import { Button, Card, ErrorNote, Icon, Note, ReadAloud, ScanField } from '../../../shared/ui';
import { handoverSummary } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';

export interface HandoverScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * Hand waiting parcels to the bus: scan the driver badge, tap the parcels going on, one
 * CTA. Tapping a row toggles it — big targets, visible tick, no checkbox to miss.
 */
export function HandoverScreen({ state, actions }: HandoverScreenProps) {
  const f = state.handover;
  const rows = state.shopParcels;
  const loading = state.shopParcelsState === 'loading';

  return (
    <div class="scr">
      <h1 class="scr__title">Hand to the bus</h1>
      <p class="scr__lede">Scan the driver's badge, then tap every parcel you are giving them.</p>

      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('handover')} /> : null}

      <Card>
        <ScanField
          id="badge"
          label="Driver badge"
          value={f.badge}
          onValue={(v) => actions.setHandover({ badge: v })}
          expect="badge"
          placeholder="Scan the badge"
          upper
        />
      </Card>

      <Card label={`Waiting at your shop (${rows.length})`}>
        {loading ? (
          <p class="hint">Getting your parcels…</p>
        ) : rows.length === 0 ? (
          <p class="hint">No parcels waiting for the bus right now.</p>
        ) : (
          <div class="picklist" role="group" aria-label="Parcels to hand over">
            {rows.map((p) => {
              const on = f.selected.includes(p.parcelId);
              return (
                <button key={p.parcelId} type="button" class={`pick${on ? ' pick--on' : ''}`} aria-pressed={on} onClick={() => actions.toggleHandover(p.parcelId)}>
                  <span class="pick__tick" aria-hidden="true">
                    {on ? <Icon name="check" size={20} /> : null}
                  </span>
                  <span class="pick__body">
                    <span class="pick__t">{`${p.parcelId} · ${p.size}`}</span>
                    <span class="pick__s">{`To ${p.destZone}`}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {rows.length > 0 && f.selected.length === 0 ? (
        <Note tone="info" icon="box" title="Tap the parcels going on the bus" />
      ) : null}

      <div class="scr__cta">
        <Button
          onClick={() => void actions.submitHandover()}
          disabled={!f.badge.trim() || f.selected.length === 0}
          busy={state.busy === 'handover'}
        >
          {f.selected.length ? `Hand over ${f.selected.length} parcel${f.selected.length === 1 ? '' : 's'}` : 'Hand over'}
        </Button>
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => handoverSummary(rows.length, f.selected.length)} label="Read this aloud" />
      </div>
    </div>
  );
}
