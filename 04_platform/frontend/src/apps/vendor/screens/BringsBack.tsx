import { useState } from 'preact/hooks';
import { Button, Note, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { money } from '../logic';
import type { VendorActions, VendorLoad, VendorState } from '../useVendorApp';
import { callOffSays, ShopPicker } from './CallOff';

/**
 * ONE OF ITS OWN PARCELS COMING TO ITS DOOR AS A LOAD (the user, 2026-10-27: "As a load to its door"): which, from which hub —
 * and, while no driver has taken it, the most the store pays, which it may raise, or the box sent to a shop instead ("Switch
 * to a shop"). The load is never simply withdrawn: the goods would wait at the hub for nobody.
 */
export function BringsBackLine({ load, state, actions }: { load: VendorLoad; state: VendorState; actions: VendorActions }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const b = load.bringsBack!;
  const currency = state.vendor?.currency;
  const now = load.maxSpend ?? 0;
  const waiting = load.status === 'available';
  const value = Number(amount);
  const save = async () => {
    if (!(value > now)) return;
    setProblem(null);
    const refused = await actions.raiseMaxSpend(load.freightId, value);
    if (refused) return setProblem(refused);
    setOpen(false);
    setAmount('');
  };
  return (
    <>
      <span class="row__s">{t('vendor.loads.bringsBack', { parcel: b.parcelId, hub: b.hubName })}</span>
      {b.handedAt ? <span class="row__s">{t('vendor.loads.handedAt', { hub: b.hubName })}</span> : null}
      {/* Withdrawn: only ever because the store sent the box to a shop instead — its order says which, and its code. */}
      {load.status === 'cancelled' ? <span class="row__s">{t('vendor.loads.sentToShop', { parcel: b.parcelId })}</span> : null}
      {waiting ? <span class="row__s row__s--warn">{t('vendor.loads.noDriverYet', { amount: money(now, currency) })}</span> : null}
      {waiting && !open ? (
        <span class="raise__acts">
          <Button
            variant="link"
            full={false}
            onClick={() => {
              setAmount(String(Math.ceil(now * 1.25)));
              setOpen(true);
            }}
          >
            {t('vendor.loads.raise')}
          </Button>
          <Button variant="link" full={false} busy={state.busy === `switch-ask:${load.freightId}`} onClick={() => void actions.askSwitch(load.freightId)}>
            {t('vendor.loads.toShop')}
          </Button>
        </span>
      ) : null}
      {waiting && open ? (
        <span class="raise">
          <label class="field__label" for={`raise-${load.freightId}`}>
            {t('vendor.loads.raiseLabel', { currency: currency ?? '' })}
          </label>
          <input id={`raise-${load.freightId}`} class="input" type="number" inputMode="decimal" min="1" step="1" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
          {problem ? (
            <span class="row__s row__s--warn" role="alert">
              {problem}
            </span>
          ) : null}
          <span class="raise__acts">
            <Button full={false} chevron={false} busy={state.busy === `raise:${load.freightId}`} disabled={!(value > now)} onClick={() => void save()}>
              {t('vendor.loads.raiseSave')}
            </Button>
            <Button variant="link" full={false} onClick={() => setOpen(false)}>
              {t('vendor.loads.raiseCancel')}
            </Button>
          </span>
        </span>
      ) : null}
    </>
  );
}

/**
 * THE BOX TO A SHOP INSTEAD (the user, 2026-10-27: "Switch to a shop"), in a sheet over the list: while no driver has taken
 * its load to the store's door, the store picks a shop, is told the price, and only then is the box sent on from the hub as a
 * new parcel — the load withdrawn, nothing of it charged, as a load is charged only when a driver takes it.
 */
export function SwitchToShopSheet({ state, actions }: { state: VendorState; actions: VendorActions }) {
  const t = useT();
  const asked = state.switchTo;
  const load = asked ? state.loads.find((l) => l.freightId === asked.freightId) : undefined;
  if (!asked || !load) return null;
  const view = asked.view;
  const no = view.outcome === 'no';
  return (
    <Sheet open onClose={actions.cancelSwitch} title={t('vendor.loads.toShopTitle', { code: load.code })}>
      {view.outcome === 'pick' ? (
        <>
          <Note tone="info" icon="repeat" title={t('vendor.loads.toShopPick')} detail={t('vendor.loads.toShopPickBody', { hub: view.atHub ?? '' })} />
          <ShopPicker id={`switch-shop-${load.freightId}`} label={t('vendor.loads.findShop')} state={state} onPick={(did) => void actions.askSwitch(load.freightId, did)} />
        </>
      ) : null}
      {view.outcome === 'bring_back' ? (
        <>
          <Note tone="info" icon="repeat" title={t('vendor.loads.toShopPrice', { shop: view.backTo ?? '' })} detail={`${callOffSays(view, t, true)} ${t('vendor.loads.toShopWithdrawn', { code: load.code })}`} />
          <Button chevron={false} busy={state.busy === `switch:${load.freightId}`} onClick={() => void actions.confirmSwitch(load.freightId)}>
            {t('vendor.loads.toShopConfirm', { shop: view.backTo ?? '', amount: money(view.amount ?? 0, view.currency) })}
          </Button>
          <Button variant="link" onClick={() => void actions.askSwitch(load.freightId)}>
            {t('vendor.loads.pickAgain')}
          </Button>
        </>
      ) : null}
      {no ? <Note tone="warn" icon="block" title={t('vendor.loads.toShopNo')} detail={view.why ?? ''} /> : null}
      <Button variant="link" onClick={actions.cancelSwitch}>
        {t(no ? 'vendor.callOff.ok' : 'vendor.loads.keepDoor')}
      </Button>
    </Sheet>
  );
}
