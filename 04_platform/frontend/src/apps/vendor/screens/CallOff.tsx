import { useState } from 'preact/hooks';
import { Button, Note } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import { money } from '../logic';
import type { CallOffView, OrderDetail } from '../types';
import type { VendorActions, VendorState } from '../useVendorApp';

/** What calling it off would do now, in the store's words: what comes back, or what bringing it back costs — or why not. */
export function callOffSays(view: CallOffView, t: Translate): string {
  if (view.outcome === 'refund') return view.amount ? t('vendor.callOff.refund', { amount: money(view.amount, view.currency) }) : t('vendor.callOff.refundNothing');
  if (view.outcome === 'bring_back') return t('vendor.callOff.bringBack', { hub: view.atHub ?? '', shop: view.backTo ?? '', amount: money(view.amount ?? 0, view.currency) });
  return view.why ?? '';
}

/** Where an order may be called off: not handed in yet, at the shop it was handed in at, or at a hub. */
const CALLABLE = ['Created', 'At_PUDO', 'At_MDP'];

/**
 * CALLING AN ORDER OFF, from the store's own app (2026-10-27): said first what it would do and cost, then done. Before it left
 * the shop it was handed in at, it is withdrawn and its money comes back; at a hub it comes back to that shop as a new parcel,
 * at a price — what it cost to get there is not given back (the user: "Comes back, store pays").
 */
export function CallOffBlock({ d, state, actions }: { d: OrderDetail; state: VendorState; actions: VendorActions }) {
  const t = useT();
  const [reason, setReason] = useState('');
  // The order bringing goods back to the store is not called off: they are the store's own, on their way to it.
  if (!CALLABLE.includes(d.status) || d.returnOf) return null;
  const asked = state.callOff?.parcelId === d.parcelId ? state.callOff.view : null;
  if (!asked) {
    return (
      <Button variant="link" busy={state.busy === `calloff-ask:${d.parcelId}`} onClick={() => void actions.askCallOff(d.parcelId)}>
        {t('vendor.callOff.open')}
      </Button>
    );
  }
  const no = asked.outcome === 'no';
  return (
    <div class="calloff">
      <Note tone={no ? 'warn' : 'info'} icon={no ? 'block' : asked.outcome === 'bring_back' ? 'repeat' : 'wallet'} title={t(no ? 'vendor.callOff.noTitle' : 'vendor.callOff.title')} detail={callOffSays(asked, t)} />
      {no ? null : (
        <>
          <div class="field">
            <label class="field__label" for="calloff-reason">
              {t('vendor.callOff.reason')}
            </label>
            <input id="calloff-reason" class="input" maxLength={200} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
          </div>
          <Button chevron={false} busy={state.busy === `calloff:${d.parcelId}`} onClick={() => void actions.confirmCallOff(d.parcelId, reason.trim() || undefined)}>
            {asked.outcome === 'bring_back' ? t('vendor.callOff.confirmBack', { amount: money(asked.amount ?? 0, asked.currency) }) : t('vendor.callOff.confirmRefund')}
          </Button>
        </>
      )}
      <Button variant="link" onClick={actions.cancelCallOff}>
        {t(no ? 'vendor.callOff.ok' : 'vendor.callOff.keep')}
      </Button>
    </div>
  );
}
