import { Button, Card, ErrorNote, Explainer, PhotoField, ReadAloud, ScanField, Sheet } from '../../../shared/ui';
import { heldLine } from '../../../shared/tamper';
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
  // Round 35 — held under the tamper protocol: listed apart, never offered to sort.
  const held = state.inbound.filter((p) => p.held && p.atMdpId === state.hub?.mdpId);
  const heldIds = new Set(held.map((p) => p.parcelId));
  const sortable = state.queue.filter((id) => !heldIds.has(id));
  const tamper = state.tamper;

  return (
    <div class="scr">
      <h1 class="scr__title">{t('mdp.sort.title')}</h1>
      <Explainer who={state.hub?.did} id="mdp.sort.how" text={t('mdp.sort.lede')} />

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

      <Sheet open={tamper !== null} onClose={() => actions.openTamper(null)} title={t('mdp.tamper.title')}>
        {tamper ? (
          <>
            <p class="t-body">{t('mdp.tamper.body')}</p>
            <ScanField
              id="tamper-id"
              label={t('mdp.tamper.parcel')}
              value={tamper.parcelId}
              onValue={(v) => actions.setTamper({ parcelId: v })}
              expect="parcel"
              placeholder={t('mdp.sort.scanSticker')}
              upper
            />
            <div class="field" style="margin-top:12px">
              <span class="field__label">{t('mdp.tamper.photo')}</span>
              <PhotoField id="tamper-photo" value={tamper.photoRef} upload={(f) => actions.uploadPhoto(f)} onCapture={(ref) => actions.setTamper({ photoRef: ref })} label={t('mdp.tamper.photo')} disabled={state.busy === 'tamper'} />
            </div>
            <div class="field">
              <label class="field__label" for="tamper-note">
                {t('mdp.tamper.note')}
              </label>
              <textarea id="tamper-note" class="input" rows={2} maxLength={500} value={tamper.note} onInput={(e) => actions.setTamper({ note: e.currentTarget.value })} disabled={state.busy === 'tamper'} />
            </div>
            <Button chevron={false} busy={state.busy === 'tamper'} disabled={!tamper.parcelId.trim() || !tamper.photoRef} onClick={() => void actions.submitTamper()}>
              {t('mdp.tamper.send')}
            </Button>
            <Button variant="link" onClick={() => actions.openTamper(null)}>
              {t('mdp.tamper.cancel')}
            </Button>
          </>
        ) : null}
      </Sheet>    </div>
  );
}
