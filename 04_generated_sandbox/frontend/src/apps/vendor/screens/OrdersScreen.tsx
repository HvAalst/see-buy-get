import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Chip, CodeCard, ErrorNote, GlanceNumber, Icon, Pager, Pill, ReadAloud, SearchInput, Sheet } from '../../../shared/ui';
import { useDebounced } from '../../../shared/useDebounced';
import { handoffLine, money, orderStatus, ordersSummary, paidWord } from '../logic';
import { ORDER_LIMIT, type OrderQuery, type VendorActions, type VendorState } from '../useVendorApp';
import type { NetworkPoint, OrderRow } from '../types';

export interface OrdersScreenProps {
  state: VendorState;
  actions: VendorActions;
}

/**
 * The store at a glance: prepaid balance as the hero, the incoming-orders inbox (buyer
 * checkouts waiting to ship — each one starts the mint), and every order with its status
 * in merchant words. Tapping an order opens the drill-down sheet.
 */
const STATUS_OPTIONS: string[] = ['Created', 'At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Delivered', 'Disputed', 'Voided'];
const SORT_OPTIONS: Array<{ value: OrderQuery['sort']; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'cost_desc', label: 'Cost: high → low' },
  { value: 'cost_asc', label: 'Cost: low → high' },
];

export function OrdersScreen({ state, actions }: OrdersScreenProps) {
  const [topupOpen, setTopupOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(state.orderQuery.q);
  const debounced = useDebounced(searchText, 300);
  const q = state.orderQuery;
  // Store-wide (the WHOLE store, never the filtered/paged list) — so the "top up" nudge and the spoken
  // summary stay honest when the register is filtered or paged. See useVendorApp.refresh → orderStats.
  // NULL means the counts are not yet known (first load, or the stats call failed): never let that read as
  // "0 unpaid → all paid" (a false all-clear on money); statsKnown gates the affirmative wording.
  const statsKnown = state.orderStats != null;
  const unpaid = state.orderStats?.unpaid ?? 0;
  const moving = state.orderStats?.active ?? 0;

  // Load the PUDO directory once so the per-PUDO filter has shop names to offer.
  useEffect(() => {
    if (state.pointsState === 'idle') void actions.loadPoints();
  }, [state.pointsState, actions]);

  // Fire the search once typing pauses (and only when it actually changes the active query).
  useEffect(() => {
    if (debounced !== state.orderQuery.q) actions.queryOrders({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const chips = activeFilterChips(q, state.points);
  const filtered = q.q !== '' || chips.length > 0;

  // A full reset — search box AND every filter/sort. Shared by the empty-state and the sheet's "clear all"
  // so the two "clear" affordances behave identically.
  const resetAll = () => {
    setSearchText('');
    actions.queryOrders({ q: '', status: '', pudo: '', from: '', to: '', paid: '', sort: 'newest' });
  };

  // A visually-hidden status line (WCAG 2.1 SC 4.1.3) — assistive tech hears the result set change even
  // when the pager is hidden (a filtered set that fits one page announces nothing otherwise).
  const liveStatus =
    state.ordersState === 'loading'
      ? 'Loading shipments…'
      : state.ordersState === 'error'
        ? 'Could not load shipments.'
        : state.ordersTotal === 0
          ? filtered
            ? 'No shipments match your filters.'
            : 'No shipments yet.'
          : `${state.ordersTotal} shipment${state.ordersTotal === 1 ? '' : 's'} found.`;

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <GlanceNumber
        label="Prepaid balance"
        value={money(state.vendor?.balance)}
        sub={
          !statsKnown
            ? 'Your prepaid balance pays for each label.'
            : unpaid
              ? `${unpaid} order${unpaid === 1 ? '' : 's'} unpaid — top up to release ${unpaid === 1 ? 'its label' : 'their labels'}.`
              : 'Every label is paid from this balance.'
        }
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

      <Card title="Shipments" aside={<span class="row__count">{state.ordersTotal}</span>}>
        <div class="reg__controls">
          <SearchInput value={searchText} onInput={setSearchText} placeholder="Search buyer, order, DID, product…" label="Search shipments" />
          <button type="button" class={`reg__filter${chips.length ? ' reg__filter--on' : ''}`} onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={20} />
            <span>{chips.length ? `Filters · ${chips.length}` : 'Filters'}</span>
          </button>
        </div>

        {chips.length ? (
          <div class="reg__chips">
            {chips.map((c) => (
              <Chip key={c.key} label={c.label} onRemove={() => actions.queryOrders(c.clear)} />
            ))}
          </div>
        ) : null}

        <p class="sr-only" role="status">{liveStatus}</p>

        <div class="reg__list" aria-busy={state.ordersState === 'loading'}>
          {state.orders.length === 0 ? (
            state.ordersState === 'loading' ? (
              <p class="hint">Loading…</p>
            ) : state.ordersState === 'error' ? (
              <p class="hint">Couldn’t load your shipments. <button type="button" class="linkbtn" onClick={() => actions.queryOrders({ offset: q.offset })}>Try again</button></p>
            ) : filtered ? (
              <p class="hint">No shipments match. <button type="button" class="linkbtn" onClick={resetAll}>Clear filters</button></p>
            ) : (
              <p class="hint">No orders yet. Mint your first label from the Ship tab.</p>
            )
          ) : (
            <div class={`rows${state.ordersState === 'loading' ? ' rows--loading' : ''}`} role="list">
              {state.orders.map((o) => (
                <OrderRowItem key={o.parcelId} o={o} onOpen={() => void actions.openOrder(o.parcelId)} />
              ))}
            </div>
          )}
        </div>

        <Pager offset={q.offset} limit={ORDER_LIMIT} total={state.ordersTotal} busy={state.ordersState === 'loading'} onOffset={(offset) => actions.queryOrders({ offset })} />
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => (statsKnown ? ordersSummary(state.vendor?.balance ?? 0, moving, unpaid) : `Balance ${money(state.vendor?.balance ?? 0)}. Shipment counts are updating.`)} label="Read this aloud" />
      </div>

      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} query={q} points={state.points} onApply={(patch) => { actions.queryOrders(patch); setFilterOpen(false); }} onClearAll={() => { resetAll(); setFilterOpen(false); }} />
      <TopUpSheet open={topupOpen} onClose={() => setTopupOpen(false)} state={state} actions={actions} />
      <OrderSheet state={state} actions={actions} />
    </div>
  );
}

/** One shipment row — order ref, then who + what, then status · zone · cost. The DID is searchable but
 *  not shown (the point of the register is not to scroll DID numbers). */
function OrderRowItem({ o, onOpen }: { o: OrderRow; onOpen: () => void }) {
  const st = orderStatus(o.status);
  const paid = paidWord(o.paidStatus);
  const who = [o.buyer, o.products].filter(Boolean).join(' · ');
  return (
    <button type="button" class="row" onClick={onOpen}>
      <span class="row__ic">
        <Icon name={st.icon} size={24} />
      </span>
      <span class="row__body">
        <span class="row__t mono-t">{o.externalOrderId ?? o.parcelId}</span>
        {who ? <span class="row__s">{who}</span> : null}
        <span class="row__meta">{`${st.word} · ${o.size} → ${o.destZone}${o.shipmentCost != null ? ` · ${money(o.shipmentCost)}` : ''}`}</span>
      </span>
      <span class="row__end">
        <Pill tone={paid.tone === 'ok' ? 'ok' : 'warn'} dot>
          {paid.word}
        </Pill>
      </span>
    </button>
  );
}

/** Human name for a destination PUDO did (from the directory), falling back to a short id. */
function pudoName(did: string, points: NetworkPoint[]): string {
  return points.find((p) => p.did === did)?.shopName ?? `PUDO ${did.slice(-6)}`;
}

/** The applied filters as removable chips (each carries the query patch that clears it). */
function activeFilterChips(q: OrderQuery, points: NetworkPoint[]): Array<{ key: string; label: string; clear: Partial<OrderQuery> }> {
  const out: Array<{ key: string; label: string; clear: Partial<OrderQuery> }> = [];
  if (q.status) out.push({ key: 'status', label: orderStatus(q.status as OrderRow['status']).word, clear: { status: '' } });
  if (q.pudo) out.push({ key: 'pudo', label: pudoName(q.pudo, points), clear: { pudo: '' } });
  if (q.paid) out.push({ key: 'paid', label: q.paid === 'paid' ? 'Paid' : 'Unpaid', clear: { paid: '' } });
  if (q.from || q.to) out.push({ key: 'date', label: `${q.from || '…'} → ${q.to || '…'}`, clear: { from: '', to: '' } });
  if (q.sort !== 'newest') out.push({ key: 'sort', label: SORT_OPTIONS.find((s) => s.value === q.sort)?.label ?? q.sort, clear: { sort: 'newest' } });
  return out;
}

/** The filter sheet — a local draft applied all at once, so the list updates only when you tap Apply.
 *  "Clear all filters" resets the search box too (via onClearAll), matching the empty-state affordance. */
function FilterSheet({ open, onClose, query, points, onApply, onClearAll }: { open: boolean; onClose: () => void; query: OrderQuery; points: NetworkPoint[]; onApply: (patch: Partial<OrderQuery>) => void; onClearAll: () => void }) {
  const [draft, setDraft] = useState<OrderQuery>(query);
  // Re-sync the draft to the live query each time the sheet opens.
  useEffect(() => {
    if (open) setDraft(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<OrderQuery>) => setDraft((d) => ({ ...d, ...patch }));
  const destPudos = points.filter((p) => p.did);

  return (
    <Sheet open={open} onClose={onClose} title="Filter shipments">
      <div class="field">
        <label class="field__label" for="f-status">Status</label>
        <select id="f-status" class="select" value={draft.status} onChange={(e) => set({ status: e.currentTarget.value })}>
          <option value="">Any status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{orderStatus(s as OrderRow['status']).word}</option>
          ))}
        </select>
      </div>

      <div class="field">
        <label class="field__label" for="f-pudo">Collection PUDO</label>
        <select id="f-pudo" class="select" value={draft.pudo} onChange={(e) => set({ pudo: e.currentTarget.value })}>
          <option value="">Any PUDO</option>
          {destPudos.map((p) => (
            <option key={p.did} value={p.did}>{p.shopName}</option>
          ))}
        </select>
      </div>

      <div class="field">
        <label class="field__label" for="f-paid">Payment</label>
        <select id="f-paid" class="select" value={draft.paid} onChange={(e) => set({ paid: e.currentTarget.value as OrderQuery['paid'] })}>
          <option value="">Paid or unpaid</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
      </div>

      <div class="reg__dates">
        <div class="field">
          <label class="field__label" for="f-from">From</label>
          <input id="f-from" class="input" type="date" value={draft.from} onInput={(e) => set({ from: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="f-to">To</label>
          <input id="f-to" class="input" type="date" value={draft.to} onInput={(e) => set({ to: e.currentTarget.value })} />
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="f-sort">Sort</label>
        <select id="f-sort" class="select" value={draft.sort} onChange={(e) => set({ sort: e.currentTarget.value as OrderQuery['sort'] })}>
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <Button chevron={false} onClick={() => onApply({ status: draft.status, pudo: draft.pudo, paid: draft.paid, from: draft.from, to: draft.to, sort: draft.sort })}>
        Show shipments
      </Button>
      <Button variant="link" onClick={onClearAll}>
        Clear all filters
      </Button>
    </Sheet>
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
          {d.collectionCode ? <CodeCard label="Buyer's collection code" code={d.collectionCode} scanAs="collect" /> : null}
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
