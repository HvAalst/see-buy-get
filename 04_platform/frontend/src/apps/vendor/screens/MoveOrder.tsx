import { Button, Note } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import { money } from '../logic';
import type { MoveView, OrderDetail } from '../types';
import type { VendorActions, VendorState } from '../useVendorApp';
import { ShopPicker } from './CallOff';

/**
 * What moving the order would do, in the store's words (2026-11-06; the owner: "moving needs a re-price, but it's not
 * automated by us so the user is aware of the implication"): the new price beside the old, and what it does to the balance.
 */
export function moveSays(view: MoveView, t: Translate): string {
  if (!view.canMove) return view.why ?? '';
  const now = money(view.now, view.currency);
  const was = money(view.was, view.currency);
  const after = view.balanceAfter != null ? money(view.balanceAfter, view.currency) : null;
  if (view.difference > 0) return t('vendor.move.dearer', { shop: view.to.shopName, now, was, diff: money(view.difference, view.currency), after: after ?? '' });
  if (view.difference < 0) return t('vendor.move.cheaper', { shop: view.to.shopName, now, was, diff: money(-view.difference, view.currency), after: after ?? '' });
  return t('vendor.move.same', { shop: view.to.shopName, now });
}

/** Where an order may move from: booked to be handed in at a shop, and not handed in yet. */
export function movable(d: Pick<OrderDetail, 'status' | 'originAgentDid' | 'handInMdpId' | 'returnOf'>): boolean {
  return d.status === 'Created' && Boolean(d.originAgentDid) && !d.handInMdpId && !d.returnOf;
}

/**
 * HANDING AN ORDER IN AT ANOTHER SHOP, from the store's own app (2026-11-06). The store picks the shop, is told the new
 * price and what it does to its balance, and moves it — or keeps it where it is. Never done for it.
 */
export function MoveBlock({ d, state, actions }: { d: OrderDetail; state: VendorState; actions: VendorActions }) {
  const t = useT();
  if (!movable(d)) return null;
  const asked = state.move?.parcelId === d.parcelId ? state.move : null;
  if (!asked) {
    return (
      <Button variant="link" onClick={() => actions.startMove(d.parcelId)}>
        {t('vendor.move.open')}
      </Button>
    );
  }
  const keep = (
    <Button variant="link" onClick={actions.cancelMove}>
      {t('vendor.move.keep')}
    </Button>
  );
  if (!asked.view) {
    return (
      <div class="calloff">
        <Note tone="info" icon="repeat" title={t('vendor.move.pickTitle')} detail={t('vendor.move.pickBody')} />
        <ShopPicker id="move-shop" label={t('vendor.move.findShop')} state={state} exclude={d.originAgentDid} onPick={(did) => void actions.askMove(d.parcelId, did)} />
        {keep}
      </div>
    );
  }
  const view = asked.view;
  return (
    <div class="calloff">
      <Note tone={view.canMove ? 'info' : 'warn'} icon={view.canMove ? 'repeat' : 'block'} title={view.canMove ? t('vendor.move.title', { shop: view.to.shopName }) : t('vendor.move.noTitle', { shop: view.to.shopName })} detail={moveSays(view, t)} />
      {view.canMove ? (
        <Button chevron={false} busy={state.busy === `move:${d.parcelId}`} onClick={() => void actions.confirmMove(d.parcelId)}>
          {t('vendor.move.confirm', { shop: view.to.shopName, amount: money(view.now, view.currency) })}
        </Button>
      ) : null}
      <Button variant="link" onClick={() => actions.startMove(d.parcelId)}>
        {t('vendor.move.pickAgain')}
      </Button>
      {keep}
    </div>
  );
}
