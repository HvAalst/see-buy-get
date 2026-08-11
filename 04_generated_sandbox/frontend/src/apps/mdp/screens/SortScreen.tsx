import { Button, Card, ErrorNote, ReadAloud, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
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
  const t = useT();
  const last = state.last;
  const filling = fillingBags(state.totes);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('mdp.sort.title')}</h1>
      <p class="scr__lede">{t('mdp.sort.lede')}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      {last ? (
        <section class={`place place--${swatchIndex(last.nextDestination.id)}`} aria-live="polite">
          <p class="place__k">{t('mdp.sort.placeInBag')}</p>
          <p class="place__bag">{last.toteCode}</p>
          <p class="place__dest">{placeLine(last, t)}</p>
          <p class="place__meta">{t('mdp.sort.placeMeta', { id: last.parcelId, pct: last.fillPct })}</p>
        </section>
      ) : null}

      <Card>
        <ScanField
          id="sort-id"
          label={t('mdp.sort.nextParcel', { count: state.queue.length })}
          value={state.form.sortId}
          onValue={(v) => actions.setForm({ sortId: v })}
          expect="parcel"
          placeholder={t('mdp.sort.scanSticker')}
          upper
          enterKeyHint="go"
          onScan={(v) => void actions.submitSort(v)}
        />
        <div style="margin-top:12px">
          <Button chevron={false} onClick={() => void actions.submitSort()} disabled={!state.form.sortId.trim()} busy={state.busy === 'sort'}>
            {t('mdp.sort.cta')}
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
            {t('mdp.sort.queueEmpty')}
          </p>
        )}
      </Card>

      {filling.length ? (
        <Card title={t('mdp.sort.openBags')} tone="soft">
          <div class="bags">
            {filling.map((bag) => (
              <div key={bag.code} class="bagrow bagrow--static">
                <span class={`swatch swatch--${swatchIndex(bag.destinationNodeId)}`} aria-hidden="true" />
                <span class="bagrow__body">
                  <span class="bagrow__code">{bag.code}</span>
                  <span class="bagrow__dest">{bagLine(bag, t)}</span>
                  <span class="fillbar" role="progressbar" aria-valuenow={fillPercent(bag.unitsUsed)} aria-valuemin={0} aria-valuemax={100} aria-label={t('mdp.bagFillAria', { code: bag.code })}>
                    <span style={`width:${fillPercent(bag.unitsUsed)}%`} />
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => sortSummary(state.queue.length, state.last, t)} label={t('mdp.readAloud')} />
      </div>
    </div>
  );
}
