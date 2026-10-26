import { Button, PhotoField, ScanField, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { MdpActions, MdpState } from '../useMdpApp';

/**
 * Round 35 — A PARCEL FOUND CUT OR OPENED at this hub (the tamper protocol): which, its photograph, what is seen. Held
 * here — sorted into no bag — and SeeBuyGet operations told. Opened from the sort, and from a store's arrival as its
 * parcels are scanned in (reading B): a parcel scanned in stands at the hub, and is reported like any other there.
 */
export function TamperSheet({ state, actions }: { state: MdpState; actions: MdpActions }) {
  const t = useT();
  const tamper = state.tamper;
  return (
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
    </Sheet>
  );
}
