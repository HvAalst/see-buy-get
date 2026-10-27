import { useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import type { ParcelView, TowerActions, TowerState } from '../useTowerApp';
import { WITHDRAWABLE, withdrawReasonOk, withdrawSays, type WithdrawView } from '../withdraw';

/**
 * WITHDRAW THIS PARCEL (the user, 2026-10-27: "Back to its shop, sender pays"): what it would do, said first — withdrawn where
 * it is, or at a hub turned round to the shop it was handed in at, its sender paying the way back in cash there — then done,
 * with why. The server answers for a store's parcel (the store's to call off) and for one that cannot be withdrawn.
 */
export function WithdrawBlock({ parcel, state, actions }: { parcel: ParcelView; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [view, setView] = useState<WithdrawView | null>(null);
  const [reason, setReason] = useState('');
  if (!WITHDRAWABLE.includes(parcel.status)) return null;
  const asked = view && view.parcelId === parcel.parcelId ? view : null;
  if (!asked) {
    return (
      <div class="twr-release">
        <p class="chint">{t('tower.withdraw.hint')}</p>
        <button type="button" class="cbtn cbtn--ghost" disabled={state.busyId === 'withdraw-ask'} onClick={async () => setView(await actions.withdrawPreview(parcel.parcelId))}>
          {t('tower.withdraw.ask')}
        </button>
      </div>
    );
  }
  const close = () => {
    setView(null);
    setReason('');
  };
  return (
    <div class="twr-release">
      <span class={asked.outcome === 'no' ? 'ctag ctag--warn' : 'ctag ctag--info'}>{t(asked.outcome === 'no' ? 'tower.withdraw.noTag' : asked.outcome === 'turn_round' ? 'tower.withdraw.turnTag' : 'tower.withdraw.voidTag')}</span>
      <p class="chint">{withdrawSays(asked, t)}</p>
      {asked.outcome === 'no' ? null : (
        <label class="cfield">
          <span class="cfield__label">{t('tower.withdraw.reasonLabel')}</span>
          <textarea class="cinput" rows={2} maxLength={200} value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
        </label>
      )}
      <span class="twr-panelend">
        {asked.outcome === 'no' ? null : (
          <button
            type="button"
            class="cbtn cbtn--primary cbtn--sm"
            disabled={state.busyId === 'withdraw' || !withdrawReasonOk(reason)}
            onClick={async () => {
              if (await actions.withdraw(parcel.parcelId, reason.trim())) close();
            }}
          >
            {asked.outcome === 'turn_round' ? t('tower.withdraw.confirmTurn', { shop: asked.backTo ?? '' }) : t('tower.withdraw.confirmVoid')}
          </button>
        )}
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={close}>
          {t(asked.outcome === 'no' ? 'tower.withdraw.ok' : 'tower.withdraw.notNow')}
        </button>
      </span>
    </div>
  );
}
