import { useEffect, useMemo, useState } from 'preact/hooks';
import type { SbgClient } from '../../../lib/sbg';
import { createFiscalApi } from '../../../lib/sbg/personas/fiscal';
import { TaxInvoicesCard } from '../../../shared/TaxInvoicesCard';
import { Button, Card, Checkbox, Chip, ErrorNote, GlanceNumber, Icon, Pager, ReadAloud, SearchInput, SelectionBar, Sheet } from '../../../shared/ui';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { triggerDownload } from '../../../shared/download';
import { toggleAll, toggleId } from '../../../shared/register';
import { useDebounced } from '../../../shared/useDebounced';
import { ledgerRowsToCsv, ledgerTypeWord, money } from '../logic';
import { LEDGER_LIMIT, type LedgerQuery, type VendorActions, type VendorState } from '../useVendorApp';
import type { LedgerSummary, SettlementRow } from '../types';

export interface BooksScreenProps {
  state: VendorState;
  actions: VendorActions;
  /** The signed-in client: the store’s tax invoices are read with it. */
  client?: SbgClient | null;
}

const TYPE_OPTIONS: Array<'TOP_UP' | 'BILLING' | 'REBATE'> = ['TOP_UP', 'BILLING', 'REBATE'];
const LEDGER_SORT_OPTIONS: Array<{ value: LedgerQuery['sort']; labelKey: MessageKey }> = [
  { value: 'newest', labelKey: 'vendor.sort.newest' },
  { value: 'oldest', labelKey: 'vendor.sort.oldest' },
  { value: 'amount_desc', labelKey: 'vendor.sort.amountDesc' },
  { value: 'amount_asc', labelKey: 'vendor.sort.amountAsc' },
];

/**
 * The store's books: the prepaid balance and its money in / out / net for whatever you filter to, then the
 * ledger itself — every top-up, shipment billing and rebate — searchable, filterable, paged, multi-select
 * and exportable, exactly like the shipment register. The balance is always the whole store; the in/out/net
 * follow the filter.
 */
export function BooksScreen({ state, actions, client }: BooksScreenProps) {
  const t = useT();
  // What the store bought from the network, as KRA has it (eTIMS, Kenya only): what it claims its VAT back with.
  const fiscal = useMemo(() => (client ? createFiscalApi(client) : null), [client]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(state.ledgerQuery.q);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const debounced = useDebounced(searchText, 300);
  const q = state.ledgerQuery;
  const sum = state.ledgerSummary;

  // Fire the search once typing pauses (and only when it actually changes the active query).
  useEffect(() => {
    if (debounced !== state.ledgerQuery.q) actions.queryLedger({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const chips = ledgerFilterChips(q, t);
  const filtered = q.q !== '' || chips.length > 0;

  const resetAll = () => {
    setSearchText('');
    actions.queryLedger({ q: '', type: '', direction: '', from: '', to: '', sort: 'newest' });
  };

  // Selection is scoped to the current view (see the shipment register): clear on any query change; the
  // count and export derive from the live page so a background reload can't drift them.
  const querySig = `${q.q}|${q.type}|${q.direction}|${q.from}|${q.to}|${q.sort}|${q.offset}`;
  useEffect(() => {
    setSelected(new Set());
  }, [querySig]);

  const pageIds = state.ledger.map((s) => s.id);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someChecked = pageIds.some((id) => selected.has(id));
  const selectedRows = state.ledger.filter((s) => selected.has(s.id));

  const exportSelected = () => {
    if (selectedRows.length === 0) return;
    triggerDownload('bookkeeping-selected.csv', ledgerRowsToCsv(selectedRows));
    actions.pushToast({ tone: 'ok', icon: 'check', title: t('vendor.toast.selectedExported', { count: selectedRows.length }), detail: t('vendor.toast.savedBooksSelected') });
    setSelected(new Set());
  };

  const liveStatus =
    state.ledgerState === 'loading'
      ? t('vendor.books.liveLoading')
      : state.ledgerState === 'error'
        ? t('vendor.books.liveError')
        : state.ledgerTotal === 0
          ? filtered
            ? t('vendor.books.liveNoneFiltered')
            : t('vendor.noEntriesYet')
          : t(state.ledgerTotal === 1 ? 'vendor.books.liveFoundOne' : 'vendor.books.liveFoundMany', { count: state.ledgerTotal });

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('books')} /> : null}

      {state.vendor?.balance === null ? (
        <GlanceNumber label={t('vendor.noTillLabel')} value="—" sub={t('vendor.noTillSub')} />
      ) : (
        <GlanceNumber
          label={t('vendor.balanceLabel')}
          value={money(state.vendor?.balance, state.vendor?.currency)}
          sub={sum ? t('vendor.books.balanceSubSummary', { in: money(sum.in, sum.currency), out: money(sum.out, sum.currency), net: netLabel(sum.net, sum.currency) }) : t('vendor.books.balanceSubEmpty')}
        />
      )}

      <Card title={t('vendor.books.title')} aside={<span class="row__count">{state.ledgerTotal}</span>}>
        <div class="reg__controls">
          <SearchInput value={searchText} onInput={setSearchText} placeholder={t('vendor.books.searchPh')} label={t('vendor.books.searchLabel')} />
          <button type="button" class={`reg__filter${chips.length ? ' reg__filter--on' : ''}`} onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={20} />
            <span>{chips.length ? t('vendor.filters.withCount', { count: chips.length }) : t('vendor.filters.label')}</span>
          </button>
        </div>

        {chips.length ? (
          <div class="reg__chips">
            {chips.map((c) => (
              <Chip key={c.key} label={c.label} onRemove={() => actions.queryLedger(c.clear)} />
            ))}
          </div>
        ) : null}

        <p class="sr-only" role="status">{liveStatus}</p>

        <div class="reg__list" aria-busy={state.ledgerState === 'loading'}>
          {state.ledger.length === 0 ? (
            state.ledgerState === 'loading' ? (
              <p class="hint">{t('vendor.loading')}</p>
            ) : state.ledgerState === 'error' ? (
              <p class="hint">{t('vendor.books.loadError')} <button type="button" class="linkbtn" onClick={() => actions.queryLedger({ offset: q.offset })}>{t('vendor.tryAgain')}</button></p>
            ) : filtered ? (
              <p class="hint">{t('vendor.books.noMatch')} <button type="button" class="linkbtn" onClick={resetAll}>{t('vendor.clearFilters')}</button></p>
            ) : (
              <p class="hint">{t('vendor.books.noEntriesLong')}</p>
            )
          ) : (
            <>
              <div class="reg__selall">
                <Checkbox checked={allChecked} indeterminate={someChecked && !allChecked} onChange={() => setSelected(toggleAll(selected, pageIds))} label={t('vendor.books.selectAllLabel')} />
                <span class="reg__selall-txt">{allChecked ? t('vendor.selectedAllOnPage') : t('vendor.selectAllOnPage')}</span>
              </div>
              <div class={`rows${state.ledgerState === 'loading' ? ' rows--loading' : ''}`} role="list">
                {state.ledger.map((s) => (
                  <LedgerRowItem key={s.id} s={s} currency={state.vendor?.currency} selected={selected.has(s.id)} onToggle={() => setSelected(toggleId(selected, s.id))} />
                ))}
              </div>
            </>
          )}
        </div>

        <Pager offset={q.offset} limit={LEDGER_LIMIT} total={state.ledgerTotal} busy={state.ledgerState === 'loading'} onOffset={(offset) => actions.queryLedger({ offset })} />

        {state.ledgerTotal > 0 ? (
          <div class="reg__export">
            <Button variant="link" full={false} busy={state.busy === 'export-ledger'} onClick={() => void actions.exportLedger()}>
              {t('vendor.exportAll', { count: state.ledgerTotal })}
            </Button>
          </div>
        ) : null}
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => ledgerSpoken(state.vendor?.balance ?? 0, sum, t, state.vendor?.currency)} label={t('vendor.readAloud')} />
      </div>

      <SelectionBar count={selectedRows.length} onClear={() => setSelected(new Set())}>
        <Button variant="outline" full={false} onClick={exportSelected}>
          {t('vendor.export')}
        </Button>
      </SelectionBar>

      {fiscal ? <TaxInvoicesCard load={fiscal.myFiscalInvoices} page={fiscal.fiscalInvoicePage} /> : null}

      <LedgerFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        query={q}
        onApply={(patch) => {
          actions.queryLedger(patch);
          setFilterOpen(false);
        }}
        onClearAll={() => {
          resetAll();
          setFilterOpen(false);
        }}
      />
    </div>
  );
}

/** "net 42.00" or "net −8.00" — a real minus for a spend-heavy view. */
function netLabel(net: number, currency?: string): string {
  return `${net < 0 ? '−' : ''}${money(Math.abs(net), currency)}`;
}

/** One ledger row — type + parcel/note + date, with the signed amount. Tapping the row (or its checkbox)
 *  selects it; there is no drill-down, so the row IS the select target. */
/** A line is in the money of the books it was posted to; one from before lines said so, in the store’s. */
function LedgerRowItem({ s, currency, selected, onToggle }: { s: SettlementRow; currency?: string; selected: boolean; onToggle: () => void }) {
  const t = useT();
  const word = ledgerTypeWord(s.type, t);
  const sub = [s.parcelId, s.note].filter(Boolean).join(' · ');
  return (
    <div class={`orow${selected ? ' orow--on' : ''}`}>
      <Checkbox checked={selected} onChange={() => onToggle()} label={t('vendor.books.selectEntry', { word, amount: `${s.sign}${money(s.amount, s.currency ?? currency)}` })} />
      {/* The row is a select target (no drill-down), so it is a toggle button — aria-pressed announces its
          state, and the visible content is its accessible name. */}
      <button type="button" class="row orow__row" aria-pressed={selected} onClick={onToggle}>
        <span class="row__ic">
          <Icon name={s.sign === '+' ? 'wallet' : 'send'} size={24} />
        </span>
        <span class="row__body">
          <span class="row__t">{word}</span>
          {sub ? <span class="row__s">{sub}</span> : null}
          <span class="row__meta">{new Date(s.at).toLocaleDateString()}</span>
        </span>
        <span class="row__end">
          <b class={`amt amt--${s.sign === '+' ? 'in' : 'out'}`}>{`${s.sign}${money(s.amount, s.currency ?? currency)}`}</b>
        </span>
      </button>
    </div>
  );
}

/** The applied filters as removable chips (each carries the query patch that clears it). */
function ledgerFilterChips(q: LedgerQuery, t: Translate): Array<{ key: string; label: string; clear: Partial<LedgerQuery> }> {
  const out: Array<{ key: string; label: string; clear: Partial<LedgerQuery> }> = [];
  if (q.type) out.push({ key: 'type', label: ledgerTypeWord(q.type, t), clear: { type: '' } });
  if (q.direction) out.push({ key: 'direction', label: q.direction === 'in' ? t('vendor.books.moneyIn') : t('vendor.books.moneyOut'), clear: { direction: '' } });
  if (q.from || q.to) out.push({ key: 'date', label: `${q.from || '…'} → ${q.to || '…'}`, clear: { from: '', to: '' } });
  if (q.sort !== 'newest') { const so = LEDGER_SORT_OPTIONS.find((s) => s.value === q.sort); out.push({ key: 'sort', label: so ? t(so.labelKey) : q.sort, clear: { sort: 'newest' } }); }
  return out;
}

function ledgerSpoken(balance: number, sum: LedgerSummary | null, t: Translate, currency?: string): string {
  if (!sum) return t('vendor.books.spokenBalance', { balance: money(balance, currency) });
  const net = `${sum.net < 0 ? t('vendor.books.spokenMinus') : ''}${money(Math.abs(sum.net), sum.currency)}`;
  return t('vendor.books.spokenFull', { balance: money(balance, currency), in: money(sum.in, sum.currency), out: money(sum.out, sum.currency), net });
}

/** The filter sheet — a local draft applied all at once. "Clear all filters" also clears the search box. */
function LedgerFilterSheet({ open, onClose, query, onApply, onClearAll }: { open: boolean; onClose: () => void; query: LedgerQuery; onApply: (patch: Partial<LedgerQuery>) => void; onClearAll: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<LedgerQuery>(query);
  useEffect(() => {
    if (open) setDraft(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<LedgerQuery>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Sheet open={open} onClose={onClose} title={t('vendor.books.filterTitle')}>
      <div class="field">
        <label class="field__label" for="l-type">{t('vendor.books.fType')}</label>
        <select id="l-type" class="select" value={draft.type} onChange={(e) => set({ type: e.currentTarget.value as LedgerQuery['type'] })}>
          <option value="">{t('vendor.books.anyType')}</option>
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{ledgerTypeWord(opt, t)}</option>
          ))}
        </select>
      </div>

      <div class="field">
        <label class="field__label" for="l-dir">{t('vendor.books.fDirection')}</label>
        <select id="l-dir" class="select" value={draft.direction} onChange={(e) => set({ direction: e.currentTarget.value as LedgerQuery['direction'] })}>
          <option value="">{t('vendor.books.anyDirection')}</option>
          <option value="in">{t('vendor.books.moneyIn')}</option>
          <option value="out">{t('vendor.books.moneyOut')}</option>
        </select>
      </div>

      <div class="reg__dates">
        <div class="field">
          <label class="field__label" for="l-from">{t('vendor.from')}</label>
          <input id="l-from" class="input" type="date" value={draft.from} onInput={(e) => set({ from: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="l-to">{t('vendor.to')}</label>
          <input id="l-to" class="input" type="date" value={draft.to} onInput={(e) => set({ to: e.currentTarget.value })} />
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="l-sort">{t('vendor.sortLabel')}</label>
        <select id="l-sort" class="select" value={draft.sort} onChange={(e) => set({ sort: e.currentTarget.value as LedgerQuery['sort'] })}>
          {LEDGER_SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{t(s.labelKey)}</option>
          ))}
        </select>
      </div>

      <Button chevron={false} onClick={() => onApply({ type: draft.type, direction: draft.direction, from: draft.from, to: draft.to, sort: draft.sort })}>
        {t('vendor.books.showEntries')}
      </Button>
      <Button variant="link" onClick={onClearAll}>
        {t('vendor.clearAllFilters')}
      </Button>
    </Sheet>
  );
}
