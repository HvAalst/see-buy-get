import { useState } from 'preact/hooks';
import { Button, Card, CodeCard, ErrorNote, GlanceNumber, Icon, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { handoffLine, money, orderStatus, ordersSummary, paidWord } from '../logic';
import type { VendorActions, VendorState } from '../useVendorApp';

export interface OrdersScreenProps {
  state: VendorState;
  actions: VendorActions;
}

/**
 * The store at a glance: prepaid balance as the hero, the incoming-orders inbox (buyer
 * checkouts waiting to ship — each one starts the mint), and every order with its status
 * in merchant words. Tapping an order opens the drill-down sheet.
 */
export function OrdersScreen({ state, actions }: OrdersScreenProps) {
  const [topupOpen, setTopupOpen] = useState(false);
  const unpaid = state.orders.filter((o) => o.paidStatus !== 'ParcelPaid').length;
  const moving = state.orders.filter((o) => o.status !== 'Delivered' && o.status !== 'Voided').length;

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <GlanceNumber
        label="Prepaid balance"
        value={money(state.vendor?.balance)}
        sub={unpaid ? `${unpaid} order${unpaid === 1 ? '' : 's'} unpaid — top up to release ${unpaid === 1 ? 'its label' : 'their labels'}.` : 'Every label is paid from this balance.'}
        aside={
          <Button variant="link" full={false} onClick={() => setTopupOpen(true)}>
            Top up
          </Button>
        }
      />

      {state.checkouts.length ? (
        <Card title="Waiting to ship" aside={<span class="row__count">{state.checkouts.length}</span>}>
          <p class="card__note">Buyers picked their collection shop at your checkout — each one is a tap from a label.</p>
          <div class="rows" role="list" style="margin-top:12px">
            {state.checkouts.map((c) => (
              <button key={c.id} type="button" class="row" onClick={() => actions.startMint(c)}>
                <span class="row__ic">
                  <Icon name="send" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t">{handoffLine(c)}</span>
                  <span class="row__s">{c.subtotal != null ? `Order value ${money(c.subtotal)}` : 'Tap to make the label'}</span>
                </span>
                <span class="row__end">
                  <Icon name="chevronRight" size={22} />
                </span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title={`Orders · ${state.orders.length}`}>
        {state.orders.length === 0 ? (
          <p class="hint">No orders yet. Mint your first label from the Ship tab.</p>
        ) : (
          <div class="rows" role="list">
            {state.orders.map((o) => {
              const st = orderStatus(o.status);
              const paid = paidWord(o.paidStatus);
              return (
                <button key={o.parcelId} type="button" class="row" onClick={() => void actions.openOrder(o.parcelId)}>
                  <span class="row__ic">
                    <Icon name={st.icon} size={24} />
                  </span>
                  <span class="row__body">
                    <span class="row__t mono-t">{o.externalOrderId ?? o.parcelId}</span>
                    <span class="row__s">{`${st.word} · ${o.size} → ${o.destZone}`}</span>
                  </span>
                  <span class="row__end">
                    <Pill tone={paid.tone === 'ok' ? 'ok' : 'warn'} dot>
                      {paid.word}
                    </Pill>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => ordersSummary(state.vendor?.balance ?? 0, moving, unpaid)} label="Read this aloud" />
      </div>

      <TopUpSheet open={topupOpen} onClose={() => setTopupOpen(false)} state={state} actions={actions} />
      <OrderSheet state={state} actions={actions} />
    </div>
  );
}

function TopUpSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: VendorState; actions: VendorActions }) {
  const [amount, setAmount] = useState('100');
  const value = Number(amount);
  return (
    <Sheet open={open} onClose={onClose} title="Top up your balance">
      <p class="t-body">You prepay the shipping; the buyer's share is collected at your checkout and stays your income.</p>
      <div class="field">
        <label class="field__label" for="vtopup">
          Amount
        </label>
        <input id="vtopup" class="input" type="number" inputMode="decimal" min="1" step="1" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
      </div>
      <Button
        chevron={false}
        busy={state.busy === 'topup'}
        disabled={!(value > 0)}
        onClick={() => {
          onClose();
          void actions.topUp(value);
        }}
      >
        {value > 0 ? `Add ${value.toFixed(2)}` : 'Add money'}
      </Button>
      <Button variant="link" onClick={onClose}>
        Not now
      </Button>
    </Sheet>
  );
}

function OrderSheet({ state, actions }: { state: VendorState; actions: VendorActions }) {
  const d = state.detail;
  const st = d ? orderStatus(d.status) : null;
  return (
    <Sheet open={Boolean(d)} onClose={actions.closeOrder} title={d ? (d.externalOrderId ?? d.parcelId) : ''}>
      {d && st ? (
        <>
          <div class="kv">
            <span>Status</span>
            <b>{st.word}</b>
          </div>
          <div class="kv">
            <span>Size · zone</span>
            <b>{`${d.size} → ${d.destZone}`}</b>
          </div>
          {d.shipmentCost != null ? (
            <div class="kv">
              <span>Shipping cost</span>
              <b>{money(d.shipmentCost)}</b>
            </div>
          ) : null}
          {d.buyerCharge != null ? (
            <div class="kv">
              <span>Buyer paid at checkout</span>
              <b>{money(d.buyerCharge)}</b>
            </div>
          ) : null}
          {d.trackingKey ? (
            <div class="kv">
              <span>Tracking key</span>
              <b class="mono-t">{d.trackingKey}</b>
            </div>
          ) : null}
          {d.paidStatus !== 'ParcelPaid' ? (
            <Button chevron={false} busy={state.busy === `settle:${d.parcelId}`} onClick={() => void actions.settleOrder(d.parcelId)}>
              Pay now from the balance
            </Button>
          ) : null}
          {d.collectionCode ? <CodeCard label="Buyer's collection code" code={d.collectionCode} /> : null}
          {d.scans?.length ? (
            <div>
              {d.scans.map((s) => (
                <div key={`${s.at}:${s.status}`} class="kv">
                  <span>{s.status.replace(/_/g, ' ')}</span>
                  <b>{new Date(s.at).toLocaleString()}</b>
                </div>
              ))}
            </div>
          ) : null}
          <Button variant="link" onClick={actions.closeOrder}>
            Close
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}
