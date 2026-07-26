import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Icon, Note, Pill, ReadAloud, ScanField, Sheet } from '../../../shared/ui';
import { handoverSummary } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';

export interface HandoverScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/** Preset reasons a parcel is knowingly left behind — tappable, so no typing is needed to short-ship. */
const SHORT_SHIP_REASONS = ['No space left on the bus', 'Parcel not ready', 'Driver would not take it'];

/**
 * Hand waiting parcels to the bus: scan the driver badge, tap the parcels going on, one
 * CTA. Tapping a row toggles it — big targets, visible tick, no checkbox to miss.
 *
 * S25 completeness gate: the server refuses a short load and tells us exactly which parcels for this
 * bus are still waiting (`state.handover.missed`). Those rows light up as "Waiting" and the agent
 * either taps them on and hands over again, or opens the sheet to leave them behind with a reason —
 * so a bus can never quietly pull away with parcels left on the shelf.
 */
export function HandoverScreen({ state, actions }: HandoverScreenProps) {
  const f = state.handover;
  const rows = state.shopParcels;
  const loading = state.shopParcelsState === 'loading';
  const [leaveOpen, setLeaveOpen] = useState(false);
  const busy = state.busy === 'handover';

  return (
    <div class="scr">
      <h1 class="scr__title">Hand to the bus</h1>
      <p class="scr__lede">Scan the driver's badge, then tap every parcel you are giving them.</p>

      {/* The gate's INCOMPLETE_MANIFEST lands here as a warn note ("load them, or leave them behind"). */}
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
              const waiting = f.missed.includes(p.parcelId);
              return (
                <button
                  key={p.parcelId}
                  type="button"
                  class={`pick${on ? ' pick--on' : ''}${waiting ? ' pick--missed' : ''}`}
                  aria-pressed={on}
                  onClick={() => actions.toggleHandover(p.parcelId)}
                >
                  <span class="pick__tick" aria-hidden="true">
                    {on ? <Icon name="check" size={20} /> : null}
                  </span>
                  <span class="pick__body">
                    <span class="pick__t">{`${p.parcelId} · ${p.size}`}</span>
                    <span class="pick__s">{`To ${p.destZone}`}</span>
                  </span>
                  {waiting ? <span class="pick__end"><Pill tone="warn">Waiting</Pill></span> : null}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {f.missed.length ? (
        <Note
          tone="warn"
          icon="truck"
          title={`${f.missed.length} parcel${f.missed.length === 1 ? '' : 's'} for this bus still waiting`}
          detail="Tap the ones marked “Waiting” to load them too, or leave them behind."
        />
      ) : rows.length > 0 && f.selected.length === 0 ? (
        <Note tone="info" icon="box" title="Tap the parcels going on the bus" />
      ) : null}

      <div class="scr__cta">
        <Button
          onClick={() => void actions.submitHandover()}
          disabled={!f.badge.trim() || f.selected.length === 0}
          busy={busy}
        >
          {f.selected.length ? `Hand over ${f.selected.length} parcel${f.selected.length === 1 ? '' : 's'}` : 'Hand over'}
        </Button>
        {f.missed.length ? (
          <Button variant="outline" chevron={false} disabled={busy} onClick={() => setLeaveOpen(true)}>
            {`Leave ${f.missed.length} behind…`}
          </Button>
        ) : null}
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => handoverSummary(rows.length, f.selected.length, f.missed.length)} label="Read this aloud" />
      </div>

      <Sheet open={leaveOpen} onClose={() => setLeaveOpen(false)} title="Leave parcels behind?">
        <p class="hint">
          {`${f.missed.length} parcel${f.missed.length === 1 ? '' : 's'} will stay at your shop and the office will be told. Why ${f.missed.length === 1 ? 'is it' : 'are they'} not going?`}
        </p>
        <div class="rows">
          {SHORT_SHIP_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              class="row"
              disabled={busy}
              onClick={() => {
                setLeaveOpen(false);
                void actions.submitHandover(reason);
              }}
            >
              <span class="row__ic"><Icon name="truck" size={24} /></span>
              <span class="row__body"><span class="row__t">{reason}</span></span>
              <span class="row__end"><Icon name="chevronRight" size={22} /></span>
            </button>
          ))}
        </div>
        <Button variant="link" onClick={() => setLeaveOpen(false)}>Cancel</Button>
      </Sheet>
    </div>
  );
}
