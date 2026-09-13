import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Checkbox, Chip, CodeCard, ErrorNote, GlanceNumber, Icon, Pager, Pill, ReadAloud, SearchInput, SelectionBar, Sheet } from '../../../shared/ui';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { triggerDownload } from '../../../shared/download';
import { toggleAll, toggleId } from '../../../shared/register';
import { useDebounced } from '../../../shared/useDebounced';
import { formatDate } from '../../../shared/i18n';
import { handoffLine, money, orderRowsToCsv, orderStatus, ordersSummary, paidWord } from '../logic';
import { ORDER_LIMIT, type OrderQuery, type VendorActions, type VendorState } from '../useVendorApp';
import { ConversationList, ConversationSheet } from '../../../shared/conversation/Conversations';
import type { ChatThread } from '../../../shared/conversation/logic';
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
const STATUS_OPTIONS: string[] = ['Created', 'At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Unclaimed', 'Delivered', 'Disputed', 'Voided'];
const SORT_OPTIONS: Array<{ value: OrderQuery['sort']; labelKey: MessageKey }> = [
  { value: 'newest', labelKey: 'vendor.sort.newest' },
  { value: 'oldest', labelKey: 'vendor.sort.oldest' },
  { value: 'cost_desc', labelKey: 'vendor.sort.costDesc' },
  { value: 'cost_asc', labelKey: 'vendor.sort.costAsc' },
];

export function OrdersScreen({ state, actions }: OrdersScreenProps) {
  const t = useT();
  const [topupOpen, setTopupOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(state.orderQuery.q);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // CV1 — the thread open in the sheet, and a tick that makes the list re-read after something changed.
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [chatTick, setChatTick] = useState(0);
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

  const chips = activeFilterChips(q, state.points, t);
  const filtered = q.q !== '' || chips.length > 0;

  // A full reset — search box AND every filter/sort. Shared by the empty-state and the sheet's "clear all"
  // so the two "clear" affordances behave identically.
  const resetAll = () => {
    setSearchText('');
    actions.queryOrders({ q: '', status: '', pudo: '', from: '', to: '', paid: '', sort: 'newest' });
  };

  // Multi-select is scoped to the current view: a deliberate query change (filter / search / page) clears it.
  const querySig = `${q.q}|${q.status}|${q.pudo}|${q.from}|${q.to}|${q.paid}|${q.sort}|${q.offset}`;
  useEffect(() => {
    setSelected(new Set());
  }, [querySig]);

  const pageIds = state.orders.map((o) => o.parcelId);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someChecked = pageIds.some((id) => selected.has(id));
  // The EFFECTIVE selection is derived live from the visible page, so the badge count and the export are
  // ALWAYS exactly the checked rows in hand. A same-query background refresh (tab refocus / online / a
  // post-mutation reload) can reorder a selected row off the page without changing querySig; a stale id left
  // in the set is then simply not counted or exported (and the deliberate-change effect above clears it).
  const selectedRows = state.orders.filter((o) => selected.has(o.parcelId));

  const exportSelected = () => {
    if (selectedRows.length === 0) return;
    triggerDownload('shipments-selected.csv', orderRowsToCsv(selectedRows));
    actions.pushToast({ tone: 'ok', icon: 'check', title: t('vendor.toast.selectedExported', { count: selectedRows.length }), detail: t('vendor.toast.savedShipmentsSelected') });
    setSelected(new Set());
  };

  // A visually-hidden status line (WCAG 2.1 SC 4.1.3) — assistive tech hears the result set change even
  // when the pager is hidden (a filtered set that fits one page announces nothing otherwise).
  const liveStatus =
    state.ordersState === 'loading'
      ? t('vendor.orders.liveLoading')
      : state.ordersState === 'error'
        ? t('vendor.orders.liveError')
        : state.ordersTotal === 0
          ? filtered
            ? t('vendor.orders.liveNoneFiltered')
            : t('vendor.orders.liveNone')
          : t(state.ordersTotal === 1 ? 'vendor.orders.liveFoundOne' : 'vendor.orders.liveFoundMany', { count: state.ordersTotal });

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      {/* CV1 — drivers asking about an order this store sent as freight. Near the top, because an unanswered
          question is the one thing here that a driver is standing still waiting on. */}
      <Card title={t('common.chat.listTitle')}>
        <ConversationList api={actions.chatApi} refreshKey={chatTick} onOpen={setThread} emptyText={t('vendor.chat.empty')} />
      </Card>
      <ConversationSheet api={actions.chatApi} thread={thread} onClose={() => setThread(null)} onChanged={() => setChatTick((n) => n + 1)} />

      {/* Parcels nobody came for, above the register because they are the only thing here waiting on a
          DECISION rather than on the network. Both numbers are shown, because "pay to bring it back" is
          not a question anybody can answer without what it is worth and what the trip costs. */}
      {state.returns.length ? (
        <Card title={t('vendor.returns.title')} aside={<span class="row__count">{state.returns.length}</span>}>
          <p class="card__note">{t('vendor.returns.lede')}</p>
          <div class="rows" role="list">
            {state.returns.map((r) => (
              <div key={r.offerId} class="row row--static" role="listitem">
                <span class="row__body">
                  <span class="row__t">{r.parcelId}</span>
                  <span class="row__s">
                    {t('vendor.returns.line', {
                      value: `${r.currency} ${r.declaredValue.toFixed(2)}`,
                      cost: `${r.currency} ${(r.returnCost + (r.holdingCost ?? 0)).toFixed(2)}`,
                    })}
                  </span>
                  <span class="row__s">{t('vendor.returns.waitingSince', { date: formatDate(r.offeredAt, { dateStyle: 'medium' }) })}</span>
                  {r.holdingCost ? (
                    <span class="row__s">
                      {t('vendor.returns.holdingLine', {
                        trip: `${r.currency} ${r.returnCost.toFixed(2)}`,
                        shelf: `${r.currency} ${r.holdingCost.toFixed(2)}`,
                      })}
                    </span>
                  ) : null}
                </span>
                <span class="row__end">
                  <Button variant="link" full={false} busy={state.busy === `return:${r.offerId}`} onClick={() => void actions.answerReturn(r.offerId, true)}>
                    {t('vendor.returns.accept')}
                  </Button>
                  <Button variant="link" full={false} busy={state.busy === `return:${r.offerId}`} onClick={() => void actions.answerReturn(r.offerId, false)}>
                    {t('vendor.returns.decline')}
                  </Button>
                </span>
              </div>
            ))}
          </div>
          {/* Said rather than implied: declining does not make the parcel go away, and a store that
              believes it has should not find out from a phone call. */}
          <p class="card__note">{t('vendor.returns.declineNote')}</p>
        </Card>
      ) : null}

      <GlanceNumber
        label={t('vendor.balanceLabel')}
        value={money(state.vendor?.balance)}
        sub={
          !statsKnown
            ? t('vendor.orders.balanceSubUnknown')
            : unpaid
              ? t(unpaid === 1 ? 'vendor.orders.balanceSubUnpaidOne' : 'vendor.orders.balanceSubUnpaidMany', { count: unpaid })
              : t('vendor.orders.balanceSubPaid')
        }
        aside={
          <Button variant="link" full={false} onClick={() => setTopupOpen(true)}>
            {t('vendor.orders.topUp')}
          </Button>
        }
      />

      {state.checkouts.length ? (
        <Card title={t('vendor.waitingToShip')} aside={<span class="row__count">{state.checkouts.length}</span>}>
          <p class="card__note">{t('vendor.orders.waitingNote')}</p>
          <div class="rows" role="list" style="margin-top:12px">
            {state.checkouts.map((c) => (
              <button key={c.id} type="button" class="row" onClick={() => actions.startMint(c)}>
                <span class="row__ic">
                  <Icon name="send" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t">{handoffLine(c, t)}</span>
                  <span class="row__s">{c.subtotal != null ? t('vendor.orders.orderValue', { value: money(c.subtotal) }) : t('vendor.orders.tapToMake')}</span>
                </span>
                <span class="row__end">
                  <Icon name="chevronRight" size={22} />
                </span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title={t('vendor.orders.shipmentsTitle')} aside={<span class="row__count">{state.ordersTotal}</span>}>
        <div class="reg__controls">
          <SearchInput value={searchText} onInput={setSearchText} placeholder={t('vendor.orders.searchPh')} label={t('vendor.orders.searchLabel')} />
          <button type="button" class={`reg__filter${chips.length ? ' reg__filter--on' : ''}`} onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={20} />
            <span>{chips.length ? t('vendor.filters.withCount', { count: chips.length }) : t('vendor.filters.label')}</span>
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
              <p class="hint">{t('vendor.loading')}</p>
            ) : state.ordersState === 'error' ? (
              <p class="hint">{t('vendor.orders.loadError')} <button type="button" class="linkbtn" onClick={() => actions.queryOrders({ offset: q.offset })}>{t('vendor.tryAgain')}</button></p>
            ) : filtered ? (
              <p class="hint">{t('vendor.orders.noMatch')} <button type="button" class="linkbtn" onClick={resetAll}>{t('vendor.clearFilters')}</button></p>
            ) : (
              <p class="hint">{t('vendor.orders.noOrders')}</p>
            )
          ) : (
            <>
              <div class="reg__selall">
                <Checkbox checked={allChecked} indeterminate={someChecked && !allChecked} onChange={() => setSelected(toggleAll(selected, pageIds))} label={t('vendor.orders.selectAllLabel')} />
                <span class="reg__selall-txt">{allChecked ? t('vendor.selectedAllOnPage') : t('vendor.selectAllOnPage')}</span>
              </div>
              <div class={`rows${state.ordersState === 'loading' ? ' rows--loading' : ''}`} role="list">
                {state.orders.map((o) => (
                  <OrderRowItem
                    key={o.parcelId}
                    o={o}
                    selected={selected.has(o.parcelId)}
                    onToggle={() => setSelected(toggleId(selected, o.parcelId))}
                    onOpen={() => void actions.openOrder(o.parcelId)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <Pager offset={q.offset} limit={ORDER_LIMIT} total={state.ordersTotal} busy={state.ordersState === 'loading'} onOffset={(offset) => actions.queryOrders({ offset })} />

        {state.ordersTotal > 0 ? (
          <div class="reg__export">
            <Button variant="link" full={false} busy={state.busy === 'export'} onClick={() => void actions.exportOrders()}>
              {t('vendor.exportAll', { count: state.ordersTotal })}
            </Button>
          </div>
        ) : null}
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => (statsKnown ? ordersSummary(state.vendor?.balance ?? 0, moving, unpaid, t) : t('vendor.orders.countsUpdating', { balance: money(state.vendor?.balance ?? 0) }))} label={t('vendor.readAloud')} />
      </div>

      <SelectionBar count={selectedRows.length} onClear={() => setSelected(new Set())}>
        <Button variant="outline" full={false} onClick={exportSelected}>
          {t('vendor.export')}
        </Button>
      </SelectionBar>

      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} query={q} points={state.points} onApply={(patch) => { actions.queryOrders(patch); setFilterOpen(false); }} onClearAll={() => { resetAll(); setFilterOpen(false); }} />
      <TopUpSheet open={topupOpen} onClose={() => setTopupOpen(false)} state={state} actions={actions} />
      <OrderSheet state={state} actions={actions} />
    </div>
  );
}

/** One shipment row — a select checkbox (a sibling, since it is itself a button) beside a tappable card:
 *  order ref, then who + what, then status · zone · cost. The DID is searchable but not shown (the point of
 *  the register is not to scroll DID numbers). */
function OrderRowItem({ o, selected, onToggle, onOpen }: { o: OrderRow; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  const t = useT();
  const st = orderStatus(o.status, t);
  const paid = paidWord(o.paidStatus, t);
  const who = [o.buyer, o.products].filter(Boolean).join(' · ');
  const label = o.externalOrderId ?? o.parcelId;
  return (
    <div class={`orow${selected ? ' orow--on' : ''}`}>
      <Checkbox checked={selected} onChange={() => onToggle()} label={t('vendor.orders.selectOrder', { label })} />
      <button type="button" class="row orow__row" onClick={onOpen}>
        <span class="row__ic">
          <Icon name={st.icon} size={24} />
        </span>
        <span class="row__body">
          <span class="row__t mono-t">{label}</span>
          {who ? <span class="row__s">{who}</span> : null}
          <span class="row__meta">{`${st.word} · ${o.size} → ${o.destZone}${o.shipmentCost != null ? ` · ${money(o.shipmentCost)}` : ''}`}</span>
        </span>
        <span class="row__end">
          <Pill tone={paid.tone === 'ok' ? 'ok' : 'warn'} dot>
            {paid.word}
          </Pill>
        </span>
      </button>
    </div>
  );
}

/** Human name for a destination PUDO did (from the directory), falling back to a short id. */
function pudoName(did: string, points: NetworkPoint[], t: Translate): string {
  return points.find((p) => p.did === did)?.shopName ?? t('vendor.orders.pudoFallback', { id: did.slice(-6) });
}

/** The applied filters as removable chips (each carries the query patch that clears it). */
function activeFilterChips(q: OrderQuery, points: NetworkPoint[], t: Translate): Array<{ key: string; label: string; clear: Partial<OrderQuery> }> {
  const out: Array<{ key: string; label: string; clear: Partial<OrderQuery> }> = [];
  if (q.status) out.push({ key: 'status', label: orderStatus(q.status as OrderRow['status'], t).word, clear: { status: '' } });
  if (q.pudo) out.push({ key: 'pudo', label: pudoName(q.pudo, points, t), clear: { pudo: '' } });
  if (q.paid) out.push({ key: 'paid', label: q.paid === 'paid' ? t('vendor.paid.paid') : t('vendor.paid.unpaid'), clear: { paid: '' } });
  if (q.from || q.to) out.push({ key: 'date', label: `${q.from || '…'} → ${q.to || '…'}`, clear: { from: '', to: '' } });
  if (q.sort !== 'newest') { const so = SORT_OPTIONS.find((s) => s.value === q.sort); out.push({ key: 'sort', label: so ? t(so.labelKey) : q.sort, clear: { sort: 'newest' } }); }
  return out;
}

/** The filter sheet — a local draft applied all at once, so the list updates only when you tap Apply.
 *  "Clear all filters" resets the search box too (via onClearAll), matching the empty-state affordance. */
function FilterSheet({ open, onClose, query, points, onApply, onClearAll }: { open: boolean; onClose: () => void; query: OrderQuery; points: NetworkPoint[]; onApply: (patch: Partial<OrderQuery>) => void; onClearAll: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<OrderQuery>(query);
  // Re-sync the draft to the live query each time the sheet opens.
  useEffect(() => {
    if (open) setDraft(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<OrderQuery>) => setDraft((d) => ({ ...d, ...patch }));
  const destPudos = points.filter((p) => p.did);

  return (
    <Sheet open={open} onClose={onClose} title={t('vendor.orders.filterTitle')}>
      <div class="field">
        <label class="field__label" for="f-status">{t('vendor.orders.fStatus')}</label>
        <select id="f-status" class="select" value={draft.status} onChange={(e) => set({ status: e.currentTarget.value })}>
          <option value="">{t('vendor.orders.anyStatus')}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{orderStatus(s as OrderRow['status'], t).word}</option>
          ))}
        </select>
      </div>

      <div class="field">
        <label class="field__label" for="f-pudo">{t('vendor.orders.fPudo')}</label>
        <select id="f-pudo" class="select" value={draft.pudo} onChange={(e) => set({ pudo: e.currentTarget.value })}>
          <option value="">{t('vendor.orders.anyPudo')}</option>
          {destPudos.map((p) => (
            <option key={p.did} value={p.did}>{p.shopName}</option>
          ))}
        </select>
      </div>

      <div class="field">
        <label class="field__label" for="f-paid">{t('vendor.orders.fPayment')}</label>
        <select id="f-paid" class="select" value={draft.paid} onChange={(e) => set({ paid: e.currentTarget.value as OrderQuery['paid'] })}>
          <option value="">{t('vendor.orders.anyPayment')}</option>
          <option value="paid">{t('vendor.paid.paid')}</option>
          <option value="unpaid">{t('vendor.paid.unpaid')}</option>
        </select>
      </div>

      <div class="reg__dates">
        <div class="field">
          <label class="field__label" for="f-from">{t('vendor.from')}</label>
          <input id="f-from" class="input" type="date" value={draft.from} onInput={(e) => set({ from: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="f-to">{t('vendor.to')}</label>
          <input id="f-to" class="input" type="date" value={draft.to} onInput={(e) => set({ to: e.currentTarget.value })} />
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="f-sort">{t('vendor.sortLabel')}</label>
        <select id="f-sort" class="select" value={draft.sort} onChange={(e) => set({ sort: e.currentTarget.value as OrderQuery['sort'] })}>
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{t(s.labelKey)}</option>
          ))}
        </select>
      </div>

      <Button chevron={false} onClick={() => onApply({ status: draft.status, pudo: draft.pudo, paid: draft.paid, from: draft.from, to: draft.to, sort: draft.sort })}>
        {t('vendor.orders.showShipments')}
      </Button>
      <Button variant="link" onClick={onClearAll}>
        {t('vendor.clearAllFilters')}
      </Button>
    </Sheet>
  );
}

function TopUpSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: VendorState; actions: VendorActions }) {
  const t = useT();
  const [amount, setAmount] = useState('100');
  const value = Number(amount);
  return (
    <Sheet open={open} onClose={onClose} title={t('vendor.topup.title')}>
      <p class="t-body">{t('vendor.topup.body')}</p>
      <div class="field">
        <label class="field__label" for="vtopup">
          {t('vendor.topup.amount')}
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
        {value > 0 ? t('vendor.topup.add', { amount: value.toFixed(2) }) : t('vendor.topup.addMoney')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('vendor.topup.notNow')}
      </Button>
    </Sheet>
  );
}

function OrderSheet({ state, actions }: { state: VendorState; actions: VendorActions }) {
  const t = useT();
  const d = state.detail;
  const st = d ? orderStatus(d.status, t) : null;
  return (
    <Sheet open={Boolean(d)} onClose={actions.closeOrder} title={d ? (d.externalOrderId ?? d.parcelId) : ''}>
      {d && st ? (
        <>
          <div class="kv">
            <span>{t('vendor.order.status')}</span>
            <b>{st.word}</b>
          </div>
          <div class="kv">
            <span>{t('vendor.order.sizeZone')}</span>
            <b>{`${d.size} → ${d.destZone}`}</b>
          </div>
          {d.shipmentCost != null ? (
            <div class="kv">
              <span>{t('vendor.order.shippingCost')}</span>
              <b>{money(d.shipmentCost)}</b>
            </div>
          ) : null}
          {/* Inside the shipping cost above, never on top of it. Shown only when there is something to
              show: a "Tax 0.00" line on every order in a country that charges none teaches a store to
              skim, and the fee line goes with it. */}
          {d.platformFee ? (
            <div class="kv kv--quiet">
              <span>{d.platformFeePct ? t('vendor.order.platformFeePct', { pct: (d.platformFeePct * 100).toFixed(2) }) : t('vendor.order.platformFee')}</span>
              <b>{money(d.platformFee)}</b>
            </div>
          ) : null}
          {d.shipmentTax ? (
            <div class="kv kv--quiet">
              <span>{d.taxLabel ?? t('vendor.order.tax')}</span>
              <b>{money(d.shipmentTax)}</b>
            </div>
          ) : null}
          {d.buyerCharge != null ? (
            <div class="kv">
              <span>{t('vendor.order.buyerPaid')}</span>
              <b>{money(d.buyerCharge)}</b>
            </div>
          ) : null}
          {d.trackingKey ? (
            <div class="kv">
              <span>{t('vendor.trackingKey')}</span>
              <b class="mono-t">{d.trackingKey}</b>
            </div>
          ) : null}
          {d.paidStatus !== 'ParcelPaid' ? (
            <Button chevron={false} busy={state.busy === `settle:${d.parcelId}`} onClick={() => void actions.settleOrder(d.parcelId)}>
              {t('vendor.payNow')}
            </Button>
          ) : null}
          {d.collectionCode ? <CodeCard label={t('vendor.buyerCollectionCode')} code={d.collectionCode} scanAs="collect" /> : null}
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
            {t('vendor.close')}
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}
