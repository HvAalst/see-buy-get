import { useState } from 'preact/hooks';
import { Button } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { money } from '../logic';
import type { VendorActions, VendorLoad, VendorState } from '../useVendorApp';

/**
 * ONE OF ITS OWN PARCELS COMING TO ITS DOOR AS A LOAD (the user, 2026-10-27: "As a load to its door"): which, from which hub —
 * and, while no driver has taken it, the most the store pays, which it may raise. The load is never withdrawn: the goods
 * would wait at the hub for nobody.
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
      {waiting ? <span class="row__s row__s--warn">{t('vendor.loads.noDriverYet', { amount: money(now, currency) })}</span> : null}
      {waiting && !open ? (
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
