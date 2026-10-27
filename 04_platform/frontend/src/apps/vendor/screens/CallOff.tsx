import { useState } from 'preact/hooks';
import { Button, Icon, Note } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import { distanceLabel, haversineKm, type GeoPoint } from '../../../shared/geo';
import { money } from '../logic';
import type { CallOffView, NetworkPoint, OrderDetail } from '../types';
import type { VendorActions, VendorState } from '../useVendorApp';

/** What calling it off would do now, in the store's words: what comes back, or what bringing it back costs — or why not. */
export function callOffSays(view: CallOffView, t: Translate, picked = false): string {
  if (view.outcome === 'refund') return view.amount ? t('vendor.callOff.refund', { amount: money(view.amount, view.currency) }) : t('vendor.callOff.refundNothing');
  // A shop the store picked is not one it handed the parcel in at.
  if (view.outcome === 'bring_back') return t(picked ? 'vendor.callOff.bringBackPicked' : 'vendor.callOff.bringBack', { hub: view.atHub ?? '', shop: view.backTo ?? '', amount: money(view.amount ?? 0, view.currency) });
  if (view.outcome === 'to_door') return t('vendor.callOff.toDoor', { hub: view.atHub ?? '', door: view.backTo ?? '', suggested: money(view.suggestedMax ?? 0, view.currency) });
  if (view.outcome === 'pick') return t(view.door ? 'vendor.callOff.pickBodyDoor' : 'vendor.callOff.pickBody', { hub: view.atHub ?? '' });
  return view.why ?? '';
}

/**
 * The shops a store may pick for its parcel to come back to (2026-10-27): those taking parcels, matching what it typed, the
 * nearest to its own door first — at most `n`.
 */
export function shopsToPick(points: readonly NetworkPoint[], filter: string, near: GeoPoint | null, n = 8): NetworkPoint[] {
  const q = filter.trim().toLowerCase();
  return points
    .filter((p) => p.openState === 'open' && p.takesNew !== false)
    .filter((p) => !q || p.shopName.toLowerCase().includes(q) || p.zone.toLowerCase().includes(q) || (p.landmark ?? '').toLowerCase().includes(q))
    .sort((a, b) => {
      if (near) {
        const da = a.location ? haversineKm(near, a.location) : Number.POSITIVE_INFINITY;
        const db = b.location ? haversineKm(near, b.location) : Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
      }
      return a.shopName.localeCompare(b.shopName);
    })
    .slice(0, n);
}

/**
 * The shops to pick from (2026-10-27): found by name or area, the nearest to the store's door first — for a parcel called off
 * at a hub, and for a box whose load to the store's door no driver took.
 */
export function ShopPicker({ id, label, state, onPick }: { id: string; label: string; state: VendorState; onPick: (did: string) => void }) {
  const t = useT();
  const [filter, setFilter] = useState('');
  const near = state.vendor?.collection?.location ?? state.vendor?.location ?? null;
  const shops = shopsToPick(state.points, filter, near);
  return (
    <>
      <div class="field">
        <label class="field__label" for={id}>
          {label}
        </label>
        <input id={id} class="input" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} autocomplete="off" />
      </div>
      {state.pointsState === 'loading' ? <p class="hint">{t('vendor.mint.findingShops')}</p> : null}
      <div class="rows" role="list">
        {shops.map((p) => (
          <button key={p.did} type="button" class="row" onClick={() => onPick(p.did)} disabled={state.busy !== null}>
            <span class="row__ic">
              <Icon name="home" size={24} />
            </span>
            <span class="row__body">
              <span class="row__t">{p.shopName}</span>
              <span class="row__s">{[near && p.location ? distanceLabel(haversineKm(near, p.location)) : null, t('vendor.zone', { zone: p.zone }), p.landmark].filter(Boolean).join(' · ')}</span>
            </span>
            <span class="row__end">
              <Icon name="chevronRight" size={22} />
            </span>
          </button>
        ))}
      </div>
      {state.pointsState === 'ready' && !shops.length ? <p class="hint">{t('vendor.callOff.noShops')}</p> : null}
    </>
  );
}

/** Where an order may be called off: not handed in yet, at the shop it was handed in at, or at a hub. */
const CALLABLE = ['Created', 'At_PUDO', 'At_MDP'];

/**
 * CALLING AN ORDER OFF, from the store's own app (2026-10-27): said first what it would do and cost, then done. Before it left
 * the shop it was handed in at, it is withdrawn and its money comes back; at a hub it comes back to that shop as a new parcel,
 * at a price — what it cost to get there is not given back (the user: "Comes back, store pays"). Not handed in at a shop, the
 * store picks where it comes back to ("let the store pick"): a shop near it, or its own door as a load ("As a load to its
 * door") — at a driver's price, never more than the most it allows.
 */
export function CallOffBlock({ d, state, actions }: { d: OrderDetail; state: VendorState; actions: VendorActions }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [most, setMost] = useState('');
  // The order bringing goods back to the store is not called off: they are the store's own, on their way to it.
  if (!CALLABLE.includes(d.status) || d.returnOf) return null;
  const asked = state.callOff?.parcelId === d.parcelId ? state.callOff : null;
  if (!asked) {
    return (
      <Button variant="link" busy={state.busy === `calloff-ask:${d.parcelId}`} onClick={() => void actions.askCallOff(d.parcelId)}>
        {t('vendor.callOff.open')}
      </Button>
    );
  }
  const view = asked.view;
  const ask = (backTo?: string) => {
    setMost('');
    void actions.askCallOff(d.parcelId, backTo);
  };
  const keep = (
    <Button variant="link" onClick={actions.cancelCallOff}>
      {t(view.outcome === 'no' ? 'vendor.callOff.ok' : 'vendor.callOff.keep')}
    </Button>
  );
  // It was picked, not given: another place may be picked instead.
  const pickAgain = asked.backTo ? (
    <Button variant="link" onClick={() => ask()}>
      {t('vendor.callOff.pickAgain')}
    </Button>
  ) : null;
  const reasonField = (
    <div class="field">
      <label class="field__label" for="calloff-reason">
        {t('vendor.callOff.reason')}
      </label>
      <input id="calloff-reason" class="input" maxLength={200} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
    </div>
  );

  if (view.outcome === 'pick') {
    return (
      <div class="calloff">
        <Note tone="info" icon="repeat" title={t('vendor.callOff.pickTitle')} detail={callOffSays(view, t)} />
        {view.door ? (
          <button type="button" class="row" onClick={() => ask('door')} disabled={state.busy !== null}>
            <span class="row__ic">
              <Icon name="home" size={24} />
            </span>
            <span class="row__body">
              <span class="row__t">{t('vendor.callOff.yourDoor')}</span>
              <span class="row__s">{view.door}</span>
            </span>
            <span class="row__end">
              <Icon name="chevronRight" size={22} />
            </span>
          </button>
        ) : null}
        <ShopPicker id="calloff-shop" label={t('vendor.callOff.findShop')} state={state} onPick={(did) => ask(did)} />
        {keep}
      </div>
    );
  }

  if (view.outcome === 'to_door') {
    const amount = Number(most || view.suggestedMax || 0);
    return (
      <div class="calloff">
        <Note tone="info" icon="truck" title={t('vendor.callOff.title')} detail={callOffSays(view, t)} />
        <div class="field">
          <label class="field__label" for="calloff-most">
            {t('vendor.callOff.mostLabel', { currency: view.currency ?? '' })}
          </label>
          <input id="calloff-most" class="input" type="number" inputMode="decimal" min="1" step="1" value={most || String(view.suggestedMax ?? '')} onInput={(e) => setMost(e.currentTarget.value)} />
        </div>
        {reasonField}
        <Button chevron={false} busy={state.busy === `calloff:${d.parcelId}`} disabled={!(amount > 0)} onClick={() => void actions.confirmCallOff(d.parcelId, { reason: reason.trim() || undefined, maxSpend: amount })}>
          {t('vendor.callOff.confirmDoor', { amount: money(amount, view.currency) })}
        </Button>
        {pickAgain}
        {keep}
      </div>
    );
  }

  const no = view.outcome === 'no';
  return (
    <div class="calloff">
      <Note tone={no ? 'warn' : 'info'} icon={no ? 'block' : view.outcome === 'bring_back' ? 'repeat' : 'wallet'} title={t(no ? 'vendor.callOff.noTitle' : 'vendor.callOff.title')} detail={callOffSays(view, t, Boolean(asked.backTo))} />
      {no ? null : (
        <>
          {reasonField}
          <Button chevron={false} busy={state.busy === `calloff:${d.parcelId}`} onClick={() => void actions.confirmCallOff(d.parcelId, { reason: reason.trim() || undefined })}>
            {view.outcome === 'bring_back' ? t('vendor.callOff.confirmBack', { amount: money(view.amount ?? 0, view.currency) }) : t('vendor.callOff.confirmRefund')}
          </Button>
        </>
      )}
      {/* Back to the shop it was handed in at — or its own door, where it has one (2026-10-27). */}
      {view.outcome === 'bring_back' && view.door && !asked.backTo ? (
        <Button variant="link" onClick={() => ask('door')}>
          {t('vendor.callOff.orDoor', { door: view.door })}
        </Button>
      ) : null}
      {pickAgain}
      {keep}
    </div>
  );
}
