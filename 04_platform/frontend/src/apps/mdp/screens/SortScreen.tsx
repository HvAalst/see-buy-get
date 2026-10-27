import { Button, Card, ErrorNote, Explainer, ReadAloud, ScanField } from '../../../shared/ui';
import { heldLine } from '../../../shared/tamper';
import { useT } from '../../../shared/i18n';
import { bagLine, fillPercent, fillingBags, placeLine, sortSummary, swatchIndex } from '../logic';
import type { MdpActions, MdpState } from '../useMdpApp';
import { TamperSheet } from './TamperSheet';
import { RelabelCard } from './RelabelCard';

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
  // Round 35 — held under the tamper protocol: listed apart, never offered to sort.
  const held = state.inbound.filter((p) => p.held && p.atMdpId === state.hub?.mdpId);
  const heldIds = new Set(held.map((p) => p.parcelId));
  const sortable = state.queue.filter((id) => !heldIds.has(id));

  return (
    <div class="scr">
      <h1 class="scr__title">{t('mdp.sort.title')}</h1>
      <Explainer who={state.hub?.did} id="mdp.sort.how" text={t('mdp.sort.lede')} />

      {state.error ? <ErrorNote error={state.error} /> : null}

      {/* 2026-10-27 — a parcel its store called off here: its new label, printed and put over the old one, then sorted. */}
      <RelabelCard state={state} actions={actions} />

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
        <Button variant="link" onClick={() => actions.openTamper(state.form.sortId.trim().toUpperCase())}>
          {t('mdp.tamper.open')}
        </Button>
        {sortable.length ? (
          <div class="chips" style="margin-top:12px">
            {sortable.slice(0, 12).map((id) => (
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

      {held.length ? (
        <Card title={t('mdp.tamper.heldHere', { count: held.length })} tone="soft">
          <ul class="hint" style="padding-left:18px;margin:0">
            {held.map((p) => (
              <li key={p.parcelId}>
                <b class="mono">{p.parcelId}</b> — {p.held ? heldLine(p.held, t) : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

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

      <TamperSheet state={state} actions={actions} />
    </div>
  );
}
