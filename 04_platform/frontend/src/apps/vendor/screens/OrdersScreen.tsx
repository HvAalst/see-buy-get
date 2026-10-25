import { useEffect, useState } from 'preact/hooks';
import { AuthImage, Button, Card, Checkbox, Chip, CodeCard, ErrorNote, GlanceNumber, Icon, Note, Pager, Pill, ReadAloud, PushPrompt, SearchInput, ExplainerReset, SelectionBar, Sheet, TopUpCostNote, PhoneField } from '../../../shared/ui';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { triggerDownload } from '../../../shared/download';
import { toggleAll, toggleId } from '../../../shared/register';
import { useDebounced } from '../../../shared/useDebounced';
import { formatDate } from '../../../shared/i18n';
import { heldLine } from '../../../shared/tamper';
import { handoffLine, money, orderRowsToCsv, orderStatus, ordersSummary, paidWord, reportRowLine } from '../logic';
import { DamageReportCard } from '../../../shared/damage/DamageReportCard';
import type { SbgClient } from '../../../lib/sbg';
import { ORDER_LIMIT, type OrderQuery, type VendorActions, type VendorState } from '../useVendorApp';
import { ConversationList, ConversationSheet } from '../../../shared/conversation/Conversations';
import type { ChatThread } from '../../../shared/conversation/logic';
import type { NetworkPoint, OrderRow } from '../types';
import { ssccWords } from '../gs1';

export interface OrdersScreenProps {
  state: VendorState;
  actions: VendorActions;
  /** The signed-in client: a damage claim report is read, taken and handed on from the order it is about. */
  client?: SbgClient | null;
}

/**
 * The store at a glance: prepaid balance as the hero, the incoming-orders inbox (buyer
 * checkouts waiting to ship — each one starts the mint), and every order with its status
 * in merchant words. Tapping an order opens the drill-down sheet.
 */
const STATUS_OPTIONS: string[] = ['Created', 'At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Unclaimed', 'Delivered', 'Disputed', 'Voided', 'Returned', 'Lost'];
const SORT_OPTIONS: Array<{ value: OrderQuery['sort']; labelKey: MessageKey }> = [
  { value: 'newest', labelKey: 'vendor.sort.newest' },
  { value: 'oldest', labelKey: 'vendor.sort.oldest' },
  { value: 'cost_desc', labelKey: 'vendor.sort.costDesc' },
  { value: 'cost_asc', labelKey: 'vendor.sort.costAsc' },
];

export function OrdersScreen({ state, actions, client = null }: OrdersScreenProps) {
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

      {/* ASKED FOR, rather than hidden behind the bell. A store operator waits on a prepayment being
          confirmed and on a buyer's order arriving; both happen while they are doing something else. */}
      <PushPrompt
        api={actions.notifications}
        title={t('vendor.push.title')}
        reason={t('vendor.push.reason')}
        turnOn={t('vendor.push.turnOn')}
        notNow={t('vendor.push.notNow')}
        storageKey="glos-vendor-push-asked"
      />

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
                      value: money(r.declaredValue, r.currency),
                      cost: money(r.returnCost + (r.holdingCost ?? 0), r.currency),
                    })}
                  </span>
                  <span class="row__s">{t('vendor.returns.waitingSince', { date: formatDate(r.offeredAt, { dateStyle: 'medium' }) })}</span>
                  {r.holdingCost ? (
                    <span class="row__s">
                      {t('vendor.returns.holdingLine', {
                        trip: money(r.returnCost, r.currency),
                        shelf: money(r.holdingCost, r.currency),
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

      {state.vendor?.balance === null ? (
        // A store where we only match keeps no till with us: a dash and the reason, never 0.00 and a Top up.
        <GlanceNumber label={t('vendor.noTillLabel')} value="—" sub={t('vendor.noTillSub')} />
      ) : (
        <GlanceNumber
          label={t('vendor.balanceLabel')}
          value={money(state.vendor?.balance, state.vendor?.currency)}
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
      )}

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
                  <span class="row__s">{c.subtotal != null ? t('vendor.orders.orderValue', { value: money(c.subtotal, state.vendor?.currency) }) : t('vendor.orders.tapToMake')}</span>
                </span>
                <span class="row__end">
                  <Icon name="chevronRight" size={22} />
                </span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {/* THE DAMAGE CLAIM REPORTS on this store's orders — each opens its order, where the report is. A store with an
          insurer on its policy sees where each one went. Shown only where there is one: most stores never see this. */}
      {state.damageReports.length ? (
        <Card title={t('vendor.reports.title')} aside={<span class="row__count">{state.damageReports.length}</span>}>
          <p class="hint">{t('vendor.reports.lede')}</p>
          <div class="rows" role="list">
            {state.damageReports.map((r) => (
              <button key={r.parcelId} type="button" class="row" onClick={() => void actions.openOrder(r.parcelId)}>
                <span class="row__ic">
                  <Icon name="info" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t mono-t">{r.number}</span>
                  <span class="row__s">{r.reason}</span>
                  <span class="row__meta">{reportRowLine(r, t)}</span>
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
        <ReadAloud text={() => (statsKnown ? ordersSummary(state.vendor?.balance ?? 0, moving, unpaid, t, state.vendor?.currency) : t('vendor.orders.countsUpdating', { balance: money(state.vendor?.balance ?? 0, state.vendor?.currency) }))} label={t('vendor.readAloud')} />
        <ExplainerReset who={state.vendor?.did} />
      </div>

      <SelectionBar count={selectedRows.length} onClear={() => setSelected(new Set())}>
        <Button variant="outline" full={false} onClick={exportSelected}>
          {t('vendor.export')}
        </Button>
      </SelectionBar>

      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} query={q} points={state.points} onApply={(patch) => { actions.queryOrders(patch); setFilterOpen(false); }} onClearAll={() => { resetAll(); setFilterOpen(false); }} />
      <TopUpSheet open={topupOpen} onClose={() => setTopupOpen(false)} state={state} actions={actions} />
      <OrderSheet state={state} actions={actions} client={client} />
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
          <span class="row__meta">{`${st.word} · ${o.size} → ${o.destZone}${o.shipmentCost != null ? ` · ${money(o.shipmentCost, o.currency)}` : ''}`}</span>
          {/* Round 35 — held under the tamper protocol: what was found and where, until SeeBuyGet operations releases it. */}
          {o.held ? <span class="row__s row__s--warn">{heldLine(o.held, t)}</span> : null}
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

/**
 * PREPAY — which is asking to pay, not paying. The twin of the shop app's sheet, and the same two faces:
 * with a request waiting it shows the reference and the rail's own words, because there is nothing else
 * to do; with none it asks for an amount.
 */
function TopUpSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: VendorState; actions: VendorActions }) {
  const t = useT();
  const [amount, setAmount] = useState('100');
  const [phone, setPhone] = useState('');
  const value = Number(amount);
  const waiting = state.funding?.status === 'awaiting' ? state.funding : null;
  const refused = state.funding?.status === 'failed' ? state.funding : null;

  if (waiting) {
    return (
      <Sheet open={open} onClose={onClose} title={t(waiting.pushed ? 'vendor.topup.pushTitle' : 'vendor.topup.waitTitle')}>
        {/* Watching a phone and reading a reference are different jobs — see the shop app's twin. */}
        <Note
          tone="info"
          icon={waiting.pushed ? 'keypad' : 'clock'}
          title={t(waiting.pushed ? 'vendor.topup.pushNote' : 'vendor.topup.waitNote', { amount: money(waiting.amount, waiting.currency) })}
          detail={waiting.instructions}
        />
        <div class="field">
          <span class="field__label">{t(waiting.pushed ? 'vendor.topup.referenceAlso' : 'vendor.topup.reference')}</span>
          <p class="payref">{waiting.reference}</p>
        </div>
        <p class="t-body">{t('vendor.topup.waitBody')}</p>
        <Button variant="outline" chevron={false} busy={state.refreshing} onClick={() => void actions.refresh()}>
          {t('vendor.topup.check')}
        </Button>
        <Button variant="link" onClick={onClose}>
          {t('vendor.topup.notNow')}
        </Button>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('vendor.topup.title')}>
      <p class="t-body">{t('vendor.topup.body')}</p>
      {refused?.failureReason ? <Note tone="warn" icon="clock" title={t('vendor.topup.refused')} detail={refused.failureReason} /> : null}
      <div class="field">
        <label class="field__label" for="vtopup">
          {state.vendor?.currency ? t('vendor.topup.amountIn', { currency: state.vendor.currency }) : t('vendor.topup.amount')}
        </label>
        <input id="vtopup" class="input" type="number" inputMode="decimal" min="1" step="1" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
      </div>
      {/* What it costs, under the box where the amount is still being decided — the shop app's twin. */}
      <TopUpCostNote terms={state.topUpTerms} amount={value} risesBy={t('vendor.topup.lands')} />
      {/* The number that will ring, typed rather than read off the store's record — the line that pays is
          often the owner's own, and a PIN prompt on a handset nobody offered is worse than no prompt. */}
      <div class="field">
        <label class="field__label" for="vtopup-phone">
          {t('vendor.topup.phone')}
        </label>
        <PhoneField id="vtopup-phone" value={phone} onInput={(v) => setPhone(v)} />
        <p class="hint">{t('vendor.topup.phoneHint')}</p>
      </div>
      <Button chevron={false} busy={state.busy === 'topup'} disabled={!(value > 0)} onClick={() => void actions.topUp(value, phone.trim() || undefined)}>
        {value > 0 ? t(phone.trim() ? 'vendor.topup.askPush' : 'vendor.topup.ask', { amount: money(value, state.vendor?.currency) }) : t('vendor.topup.addMoney')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('vendor.topup.notNow')}
      </Button>
    </Sheet>
  );
}

/** The order's photo of its contents — and, where we do not hold it, that said in words rather than an empty tile. */
function ContentsPhoto({ mediaId, load }: { mediaId: string; load: VendorActions['loadMedia'] }) {
  const t = useT();
  const [gone, setGone] = useState(false);
  return (
    <div style="margin-top:10px">
      <p class="field__label">{t('vendor.order.contentsPhoto')}</p>
      {gone ? <p class="hint">{t('vendor.order.contentsPhotoGone')}</p> : <AuthImage mediaId={mediaId} load={load} alt={t('vendor.order.contentsPhoto')} onFailed={() => setGone(true)} />}
    </div>
  );
}

function OrderSheet({ state, actions, client }: { state: VendorState; actions: VendorActions; client: SbgClient | null }) {
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
              <b>{money(d.shipmentCost, d.currency)}</b>
            </div>
          ) : null}
          {/* Inside the shipping cost above, never on top of it. Shown only when there is something to
              show: a "Tax 0.00" line on every order in a country that charges none teaches a store to
              skim, and the fee line goes with it. */}
          {d.platformFee ? (
            <div class="kv kv--quiet">
              <span>{d.platformFeePct ? t('vendor.order.platformFeePct', { pct: (d.platformFeePct * 100).toFixed(2) }) : t('vendor.order.platformFee')}</span>
              <b>{money(d.platformFee, d.currency)}</b>
            </div>
          ) : null}
          {d.shipmentTax ? (
            <div class="kv kv--quiet">
              <span>{d.taxLabel ?? t('vendor.order.tax')}</span>
              <b>{money(d.shipmentTax, d.currency)}</b>
            </div>
          ) : null}
          {d.buyerCharge != null ? (
            <div class="kv">
              <span>{t('vendor.order.buyerPaid')}</span>
              <b>{money(d.buyerCharge, d.currency)}</b>
            </div>
          ) : null}
          {d.trackingKey ? (
            <div class="kv">
              <span>{t('vendor.trackingKey')}</span>
              <b class="mono-t">{d.trackingKey}</b>
            </div>
          ) : null}
          {/* Round 29 — its SSCC under the store's GS1 prefix: on its label as a GS1-128 barcode, said here as GS1 prints it. */}
          {d.sscc ? (
            <div class="kv">
              <span>{t('vendor.order.sscc')}</span>
              <b class="mono-t">{ssccWords(d.sscc, state.vendor?.gs1)}</b>
            </div>
          ) : null}
          {/* Round 30 — the photo the store took of what is in it: the "before" a damage claim is judged against. */}
          {d.contentPhotoRef ? <ContentsPhoto mediaId={d.contentPhotoRef} load={actions.loadMedia} /> : null}
          {d.paidStatus !== 'ParcelPaid' ? (
            <Button chevron={false} busy={state.busy === `settle:${d.parcelId}`} onClick={() => void actions.settleOrder(d.parcelId)}>
              {t('vendor.payNow')}
            </Button>
          ) : null}
          {/* Round 27 — its label, to print again once paid: on paper, or on a thermal label printer (ZPL). */}
          {d.paidStatus === 'ParcelPaid' ? (
            <div class="kv">
              <Button variant="link" full={false} busy={state.busy === `label:${d.parcelId}`} onClick={() => void actions.printOrderLabel(d.parcelId)}>
                {t('vendor.order.printLabel')}
              </Button>
              <Button variant="link" full={false} busy={state.busy === `thermal:${d.parcelId}`} onClick={() => void actions.thermalOrderLabel(d.parcelId)}>
                {t('vendor.mint.thermal')}
              </Button>
            </div>
          ) : null}
          {d.collectionCode ? <CodeCard label={t('vendor.buyerCollectionCode')} code={d.collectionCode} scanAs="collect" /> : null}
          {/* The damage claim report on this order: the store reads it, keeps the file, and hands it on — the same three things the receiver has. */}
          {d.damageReport ? <DamageReportCard client={client} parcelId={d.parcelId} number={d.damageReport.number} /> : null}
          {d.scans?.length ? (
            <div>
              {d.scans.map((s) => (
                <div key={`${s.at}:${s.status}`} class="kv">
                  <span>{s.status.replace(/_/g, ' ')}</span>
                  <b>
                    {new Date(s.at).toLocaleString()}
                    {/* Round 23 — a step done with no signal is dated by the phone that did it; when it reached us, beside it. */}
                    {s.receivedAt ? <small> · {t('vendor.scanHeardLate', { at: new Date(s.receivedAt).toLocaleString() })}</small> : null}
                  </b>
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
