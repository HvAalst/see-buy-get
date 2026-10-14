import { useState } from 'preact/hooks';
import { Button, ErrorNote } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { MAX_ORDER_LOADS, evenLoads, weightWords, type ordersApi } from '../orders';

type Api = ReturnType<typeof ordersApi>;

/**
 * AN ORDER SPLIT INTO LOADS. The user, 2026-10-06, on an order heavier than the largest truck: "The office, shipper is
 * told". So the plan only SAYS how many loads it would make; the split is the office's own act, made here, and it is
 * said before it is made what follows from it — each load is planned, carried and signed for on its own, and the
 * shipper hears that its order comes in parts.
 *
 * It is a choice made now or not at all: nothing is pending. The number of loads is the office's; the weights are
 * shared out evenly (the loads of a split add up to the order to the kilo). `suggest` is what the plan worked out —
 * as many loads as the largest vehicle makes of it — and where it is given, fewer than that is not offered.
 */
export function SplitOrder({ order, suggest, loadKg, api, onDone }: { order: { freightId: string; code: string; weightKg: number }; suggest?: number; loadKg?: number; api: Api; onDone: () => Promise<void> | void }) {
  const t = useT();
  const least = Math.max(2, suggest ?? 2);
  // No more loads than there are kilos to put in them.
  const most = Math.max(least, Math.min(MAX_ORDER_LOADS, Math.floor(order.weightKg)));
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(least);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const loads = evenLoads(order.weightKg, n);

  const split = async () => {
    setBusy(true);
    setError(null);
    const r = await api.splitOrder(order.freightId, loads);
    setBusy(false);
    if (r.error || !r.data) return setError(r.error);
    setOpen(false);
    await onDone();
  };

  if (!open) {
    return (
      <Button variant="outline" chevron={false} full={false} onClick={() => setOpen(true)}>
        {suggest ? t('fleet.split.ctaN', { n: suggest }) : t('fleet.split.cta')}
      </Button>
    );
  }
  return (
    <div class="split" role="group" aria-label={t('fleet.split.title', { code: order.code })}>
      <p class="field__label">{t('fleet.split.title', { code: order.code })}</p>
      <div class="split__n">
        <Button variant="outline" chevron={false} full={false} disabled={n <= least || busy} aria-label={t('fleet.split.fewer')} onClick={() => setN((v) => Math.max(least, v - 1))}>
          −
        </Button>
        <strong aria-live="polite">{t('fleet.split.loads', { n })}</strong>
        <Button variant="outline" chevron={false} full={false} disabled={n >= most || busy} aria-label={t('fleet.split.more')} onClick={() => setN((v) => Math.min(most, v + 1))}>
          +
        </Button>
      </div>
      <p class="hint">{t('fleet.split.weights', { weights: loads.map(weightWords).join(' + ') })}</p>
      {loadKg && loads[0] > loadKg ? <p class="hint orders__nopin">{t('fleet.split.stillHeavy', { size: weightWords(loadKg) })}</p> : null}
      <p class="hint">{t('fleet.split.told')}</p>
      <div class="orders__acts">
        <Button variant="outline" chevron={false} disabled={busy} onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
        <Button chevron={false} busy={busy} onClick={() => void split()}>
          {t('fleet.split.confirm', { n })}
        </Button>
      </div>
      {error ? <ErrorNote error={error as never} showDetail /> : null}
    </div>
  );
}

/**
 * THE WAY BACK from a split, while nobody has acted on it: every load still an order, none on a truck, none handed
 * on. The server decides that; when it will not, it says which load has moved.
 */
export function RejoinOrder({ freightId, api, onDone }: { freightId: string; api: Api; onDone: () => Promise<void> | void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const rejoin = async () => {
    setBusy(true);
    setError(null);
    const r = await api.rejoinOrder(freightId);
    setBusy(false);
    if (r.error || !r.data) return setError(r.error);
    await onDone();
  };
  return (
    <>
      <Button variant="link" chevron={false} busy={busy} onClick={() => void rejoin()}>
        {t('fleet.split.rejoinCta')}
      </Button>
      <p class="hint">{t('fleet.split.rejoinHint')}</p>
      {error ? <ErrorNote error={error as never} showDetail /> : null}
    </>
  );
}
