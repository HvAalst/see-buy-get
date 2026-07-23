import { Button, Card, ErrorNote, ReadAloud, ScanField } from '../../../shared/ui';
import { bagLine, fillPercent, fillingBags, placeLine, sortSummary, swatchIndex } from '../logic';
import type { MdpActions, MdpState } from '../useMdpApp';

export interface SortScreenProps {
  state: MdpState;
  actions: MdpActions;
}

/**
 * The sort loop — the screen a worker lives on. Scan a sticker, and the answer is ONE
 * instruction readable from a step back: the bag code, colour-keyed to its destination.
 * The queue chips let a worker tap instead of rescan when the pile is already listed.
 */
export function SortScreen({ state, actions }: SortScreenProps) {
  const last = state.last;
  const filling = fillingBags(state.totes);

  return (
    <div class="scr">
      <h1 class="scr__title">Sort parcels</h1>
      <p class="scr__lede">Scan a parcel — the screen answers which bag it goes in.</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      {last ? (
        <section class={`place place--${swatchIndex(last.nextDestination.id)}`} aria-live="polite">
          <p class="place__k">Place in bag</p>
          <p class="place__bag">{last.toteCode}</p>
          <p class="place__dest">{placeLine(last)}</p>
          <p class="place__meta">{`Parcel ${last.parcelId} · bag ${last.fillPct}% full`}</p>
        </section>
      ) : null}

      <Card>
        <ScanField
          id="sort-id"
          label={`Next parcel (${state.queue.length} queued)`}
          value={state.form.sortId}
          onValue={(v) => actions.setForm({ sortId: v })}
          expect="parcel"
          placeholder="Scan the sticker"
          upper
          enterKeyHint="go"
          onScan={(v) => void actions.submitSort(v)}
        />
        <div style="margin-top:12px">
          <Button chevron={false} onClick={() => void actions.submitSort()} disabled={!state.form.sortId.trim()} busy={state.busy === 'sort'}>
            Sort — where does it go?
          </Button>
        </div>
        {state.queue.length ? (
          <div class="chips" style="margin-top:12px">
            {state.queue.slice(0, 12).map((id) => (
              <button key={id} type="button" class={`chip chip--tap mono${state.form.sortId === id ? ' chip--on' : ''}`} onClick={() => actions.pickSortId(id)}>
                {id}
              </button>
            ))}
          </div>
        ) : (
          <p class="hint" style="margin-top:12px">
            Queue empty — scan any parcel that is physically here.
          </p>
        )}
      </Card>

      {filling.length ? (
        <Card title="Open destination bags" tone="soft">
          <div class="bags">
            {filling.map((t) => (
              <div key={t.code} class="bagrow bagrow--static">
                <span class={`swatch swatch--${swatchIndex(t.destinationNodeId)}`} aria-hidden="true" />
                <span class="bagrow__body">
                  <span class="bagrow__code">{t.code}</span>
                  <span class="bagrow__dest">{bagLine(t)}</span>
                  <span class="fillbar" role="progressbar" aria-valuenow={fillPercent(t.unitsUsed)} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.code} fill`}>
                    <span style={`width:${fillPercent(t.unitsUsed)}%`} />
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => sortSummary(state.queue.length, state.last)} label="Read this aloud" />
      </div>
    </div>
  );
}
