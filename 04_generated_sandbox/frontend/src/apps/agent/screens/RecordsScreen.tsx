import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Chip, GlanceNumber, Icon, Pager, ReadAloud, SearchInput, Sheet } from '../../../shared/ui';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { useDebounced } from '../../../shared/useDebounced';
import { agentLedgerTypeWord, money, parcelRoleWord, parcelStatusWord } from '../logic';
import { EARN_LIMIT, HIST_LIMIT, type AgentActions, type AgentState, type EarnQuery, type HistQuery } from '../useAgentApp';
import type { AgentLedgerRow, AgentParcelRow, ParcelStatus } from '../types';

export interface RecordsScreenProps {
  state: AgentState;
  actions: AgentActions;
}

type View = 'parcels' | 'earnings';

/**
 * The shop's records: a Parcels | Earnings toggle over two registers — the parcels it handled and the money
 * it earned — each searchable / filterable / paged / exportable, the persona-appropriate mirror of the
 * vendor's registers (an agent looks things up and exports; the vendor's bulk multi-select is not surfaced).
 */
export function RecordsScreen({ state, actions }: RecordsScreenProps) {
  const t = useT();
  const [view, setView] = useState<View>('parcels');

  useEffect(() => {
    if (view === 'parcels' && state.parcelHistState === 'idle') actions.loadHistory();
    if (view === 'earnings' && state.ledgerState === 'idle') actions.loadEarnings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return (
    <div class="scr">
      <div class="seg" role="group" aria-label={t('agent.records.viewAria')}>
        <button type="button" aria-pressed={view === 'parcels'} class={`seg__btn${view === 'parcels' ? ' seg__btn--on' : ''}`} onClick={() => setView('parcels')}>
          {t('agent.records.parcels')}
        </button>
        <button type="button" aria-pressed={view === 'earnings'} class={`seg__btn${view === 'earnings' ? ' seg__btn--on' : ''}`} onClick={() => setView('earnings')}>
          {t('agent.records.earnings')}
        </button>
      </div>

      {view === 'parcels' ? <ParcelHistory state={state} actions={actions} /> : <Earnings state={state} actions={actions} />}
    </div>
  );
}

/* ------------------------------------------------------------------ parcels -- */

const STATUS_OPTIONS: ParcelStatus[] = ['Created', 'At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Unclaimed', 'Delivered', 'Disputed', 'Voided'];

function ParcelHistory({ state, actions }: RecordsScreenProps) {
  const t = useT();
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(state.parcelHistQuery.q);
  const debounced = useDebounced(searchText, 300);
  const q = state.parcelHistQuery;

  useEffect(() => {
    if (debounced !== state.parcelHistQuery.q) actions.queryHistory({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const chips = histChips(q, t);
  const filtered = q.q !== '' || chips.length > 0;
  const resetAll = () => {
    setSearchText('');
    actions.queryHistory({ q: '', status: '', role: '', from: '', to: '', sort: 'newest' });
  };
  // 'idle' is the pre-load frame — treat it as loading so the first open never flashes the "nothing here" copy.
  const loading = state.parcelHistState === 'loading' || state.parcelHistState === 'idle';
  const live = loading ? t('agent.records.loadingParcels') : state.parcelHistState === 'error' ? t('agent.records.errParcels') : state.parcelHistTotal === 0 ? (filtered ? t('agent.records.noMatchParcels') : t('agent.records.noParcels')) : (state.parcelHistTotal === 1 ? t('agent.records.foundOne', { count: state.parcelHistTotal }) : t('agent.records.foundMany', { count: state.parcelHistTotal }));

  return (
    <>
      <Card title={t('agent.records.parcelHistory')} aside={<span class="row__count">{state.parcelHistTotal}</span>}>
        <div class="reg__controls">
          <SearchInput value={searchText} onInput={setSearchText} placeholder={t('agent.records.searchParcelsPh')} label={t('agent.records.searchParcelsLabel')} />
          <button type="button" class={`reg__filter${chips.length ? ' reg__filter--on' : ''}`} onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={20} />
            <span>{chips.length ? t('agent.records.filtersCount', { count: chips.length }) : t('agent.records.filters')}</span>
          </button>
        </div>
        {chips.length ? (
          <div class="reg__chips">
            {chips.map((c) => (
              <Chip key={c.key} label={c.label} onRemove={() => actions.queryHistory(c.clear)} />
            ))}
          </div>
        ) : null}
        <p class="sr-only" role="status">{live}</p>
        <div class="reg__list" aria-busy={loading}>
          {state.parcelHist.length === 0 ? (
            loading ? (
              <p class="hint">{t('agent.records.loadingShort')}</p>
            ) : state.parcelHistState === 'error' ? (
              <p class="hint">{t('agent.records.errParcelsRetry')} <button type="button" class="linkbtn" onClick={() => actions.queryHistory({ offset: q.offset })}>{t('agent.tryAgain')}</button></p>
            ) : filtered ? (
              <p class="hint">{t('agent.records.noMatchShort')} <button type="button" class="linkbtn" onClick={resetAll}>{t('agent.records.clearFilters')}</button></p>
            ) : (
              <p class="hint">{t('agent.records.emptyParcels')}</p>
            )
          ) : (
            <div class={`rows${state.parcelHistState === 'loading' ? ' rows--loading' : ''}`} role="list">
              {state.parcelHist.map((p) => (
                <HistRow key={p.parcelId} p={p} />
              ))}
            </div>
          )}
        </div>
        <Pager offset={q.offset} limit={HIST_LIMIT} total={state.parcelHistTotal} busy={state.parcelHistState === 'loading'} onOffset={(offset) => actions.queryHistory({ offset })} />
        {state.parcelHistTotal > 0 ? (
          <div class="reg__export">
            <Button variant="link" full={false} busy={state.busy === 'export-history'} onClick={() => void actions.exportHistory()}>
              {t('agent.records.exportCsv', { count: state.parcelHistTotal })}
            </Button>
          </div>
        ) : null}
      </Card>

      <HistFilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} query={q} onApply={(patch) => { actions.queryHistory(patch); setFilterOpen(false); }} onClearAll={() => { resetAll(); setFilterOpen(false); }} />
    </>
  );
}

function HistRow({ p }: { p: AgentParcelRow }) {
  const t = useT();
  return (
    <div class="row row--static">
      <span class="row__ic">
        <Icon name={p.role === 'origin' ? 'box' : 'person'} size={24} />
      </span>
      <span class="row__body">
        <span class="row__t mono-t">{p.parcelId}</span>
        <span class="row__s">{`${parcelRoleWord(p.role, t)} · ${p.originZone} → ${p.destZone} · ${p.size}`}</span>
        <span class="row__meta">{`${parcelStatusWord(p.status, t)} · ${new Date(p.createdAt).toLocaleDateString()}`}</span>
      </span>
    </div>
  );
}

function histChips(q: HistQuery, t: Translate): Array<{ key: string; label: string; clear: Partial<HistQuery> }> {
  const out: Array<{ key: string; label: string; clear: Partial<HistQuery> }> = [];
  if (q.status) out.push({ key: 'status', label: parcelStatusWord(q.status as ParcelStatus, t), clear: { status: '' } });
  if (q.role) out.push({ key: 'role', label: parcelRoleWord(q.role, t), clear: { role: '' } });
  if (q.from || q.to) out.push({ key: 'date', label: `${q.from || '…'} → ${q.to || '…'}`, clear: { from: '', to: '' } });
  if (q.sort !== 'newest') out.push({ key: 'sort', label: t('agent.records.sortOldest'), clear: { sort: 'newest' } });
  return out;
}

function HistFilterSheet({ open, onClose, query, onApply, onClearAll }: { open: boolean; onClose: () => void; query: HistQuery; onApply: (patch: Partial<HistQuery>) => void; onClearAll: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<HistQuery>(query);
  useEffect(() => {
    if (open) setDraft(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<HistQuery>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <Sheet open={open} onClose={onClose} title={t('agent.records.filterParcelsTitle')}>
      <div class="field">
        <label class="field__label" for="h-role">{t('agent.records.whatYouDid')}</label>
        <select id="h-role" class="select" value={draft.role} onChange={(e) => set({ role: e.currentTarget.value as HistQuery['role'] })}>
          <option value="">{t('agent.records.roleAny')}</option>
          <option value="origin">{t('agent.records.roleOrigin')}</option>
          <option value="dest">{t('agent.records.roleDest')}</option>
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="h-status">{t('agent.records.status')}</label>
        <select id="h-status" class="select" value={draft.status} onChange={(e) => set({ status: e.currentTarget.value })}>
          <option value="">{t('agent.records.anyStatus')}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{parcelStatusWord(s, t)}</option>
          ))}
        </select>
      </div>
      <div class="reg__dates">
        <div class="field">
          <label class="field__label" for="h-from">{t('agent.records.from')}</label>
          <input id="h-from" class="input" type="date" value={draft.from} onInput={(e) => set({ from: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="h-to">{t('agent.records.to')}</label>
          <input id="h-to" class="input" type="date" value={draft.to} onInput={(e) => set({ to: e.currentTarget.value })} />
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="h-sort">{t('agent.records.sort')}</label>
        <select id="h-sort" class="select" value={draft.sort} onChange={(e) => set({ sort: e.currentTarget.value as HistQuery['sort'] })}>
          <option value="newest">{t('agent.records.sortNewest')}</option>
          <option value="oldest">{t('agent.records.sortOldest')}</option>
        </select>
      </div>
      <Button chevron={false} onClick={() => onApply({ status: draft.status, role: draft.role, from: draft.from, to: draft.to, sort: draft.sort })}>
        {t('agent.records.showParcels')}
      </Button>
      <Button variant="link" onClick={onClearAll}>
        {t('agent.records.clearAll')}
      </Button>
    </Sheet>
  );
}

/* ----------------------------------------------------------------- earnings -- */

const TYPE_OPTIONS: Array<EarnQuery['type']> = ['TOP_UP', 'LABOR_PAYOUT', 'FEE', 'REFUND'];
const EARN_SORT: Array<{ value: EarnQuery['sort']; labelKey: MessageKey }> = [
  { value: 'newest', labelKey: 'agent.records.sortNewest' },
  { value: 'oldest', labelKey: 'agent.records.sortOldest' },
  { value: 'amount_desc', labelKey: 'agent.records.sortAmountDesc' },
  { value: 'amount_asc', labelKey: 'agent.records.sortAmountAsc' },
];

function netLabel(net: number): string {
  return `${net < 0 ? '−' : ''}${money(Math.abs(net))}`;
}

function Earnings({ state, actions }: RecordsScreenProps) {
  const t = useT();
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(state.ledgerQuery.q);
  const debounced = useDebounced(searchText, 300);
  const q = state.ledgerQuery;
  const sum = state.ledgerSummary;

  useEffect(() => {
    if (debounced !== state.ledgerQuery.q) actions.queryLedger({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const chips = earnChips(q, t);
  const filtered = q.q !== '' || chips.length > 0;
  const resetAll = () => {
    setSearchText('');
    actions.queryLedger({ q: '', type: '', direction: '', from: '', to: '', sort: 'newest' });
  };
  const loading = state.ledgerState === 'loading' || state.ledgerState === 'idle';
  const live = loading ? t('agent.records.loadingEarnings') : state.ledgerState === 'error' ? t('agent.records.errEarnings') : state.ledgerTotal === 0 ? (filtered ? t('agent.records.noMatchEntries') : t('agent.records.noEntries')) : (state.ledgerTotal === 1 ? t('agent.records.foundEntryOne', { count: state.ledgerTotal }) : t('agent.records.foundEntryMany', { count: state.ledgerTotal }));

  return (
    <>
      {/* The BALANCE is the live wallet (state.agent), never the summary's fetch-time snapshot — a top-up on
          another screen must not leave a stale figure here. The summary drives only the in/out/net sub-line. */}
      <GlanceNumber label={t('agent.records.walletBalance')} value={money(state.agent?.balance)} sub={sum ? t('agent.records.viewSummary', { in: money(sum.in), out: money(sum.out), net: netLabel(sum.net) }) : t('agent.records.summaryHint')} />

      <Card title={t('agent.records.earnings')} aside={<span class="row__count">{state.ledgerTotal}</span>}>
        <div class="reg__controls">
          <SearchInput value={searchText} onInput={setSearchText} placeholder={t('agent.records.searchEarningsPh')} label={t('agent.records.searchEarningsLabel')} />
          <button type="button" class={`reg__filter${chips.length ? ' reg__filter--on' : ''}`} onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={20} />
            <span>{chips.length ? t('agent.records.filtersCount', { count: chips.length }) : t('agent.records.filters')}</span>
          </button>
        </div>
        {chips.length ? (
          <div class="reg__chips">
            {chips.map((c) => (
              <Chip key={c.key} label={c.label} onRemove={() => actions.queryLedger(c.clear)} />
            ))}
          </div>
        ) : null}
        <p class="sr-only" role="status">{live}</p>
        <div class="reg__list" aria-busy={loading}>
          {state.ledger.length === 0 ? (
            loading ? (
              <p class="hint">{t('agent.records.loadingShort')}</p>
            ) : state.ledgerState === 'error' ? (
              <p class="hint">{t('agent.records.errEarningsRetry')} <button type="button" class="linkbtn" onClick={() => actions.queryLedger({ offset: q.offset })}>{t('agent.tryAgain')}</button></p>
            ) : filtered ? (
              <p class="hint">{t('agent.records.noMatchEntriesShort')} <button type="button" class="linkbtn" onClick={resetAll}>{t('agent.records.clearFilters')}</button></p>
            ) : (
              <p class="hint">{t('agent.records.emptyEntries')}</p>
            )
          ) : (
            <div class={`rows${state.ledgerState === 'loading' ? ' rows--loading' : ''}`} role="list">
              {state.ledger.map((e) => (
                <EarnRow key={e.id} e={e} />
              ))}
            </div>
          )}
        </div>
        <Pager offset={q.offset} limit={EARN_LIMIT} total={state.ledgerTotal} busy={state.ledgerState === 'loading'} onOffset={(offset) => actions.queryLedger({ offset })} />
        {state.ledgerTotal > 0 ? (
          <div class="reg__export">
            <Button variant="link" full={false} busy={state.busy === 'export-ledger'} onClick={() => void actions.exportLedger()}>
              {t('agent.records.exportCsv', { count: state.ledgerTotal })}
            </Button>
          </div>
        ) : null}
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => `${t('agent.records.aloudBalance', { balance: money(state.agent?.balance ?? 0) })}${sum ? t('agent.records.aloudView', { in: money(sum.in), out: money(sum.out), net: `${sum.net < 0 ? t('agent.records.minus') : ''}${money(Math.abs(sum.net))}` }) : ''}`} label={t('agent.readAloud')} />
      </div>

      <EarnFilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} query={q} onApply={(patch) => { actions.queryLedger(patch); setFilterOpen(false); }} onClearAll={() => { resetAll(); setFilterOpen(false); }} />
    </>
  );
}

function EarnRow({ e }: { e: AgentLedgerRow }) {
  const t = useT();
  return (
    <div class="row row--static">
      <span class="row__ic">
        <Icon name={e.sign === '+' ? 'wallet' : 'send'} size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">{agentLedgerTypeWord(e.type, t)}</span>
        {e.reference ? <span class="row__s mono-t">{e.reference}</span> : null}
        <span class="row__meta">{new Date(e.at).toLocaleDateString()}</span>
      </span>
      <span class="row__end">
        <b class={`amt amt--${e.sign === '+' ? 'in' : 'out'}`}>{`${e.sign}${money(e.amount)}`}</b>
      </span>
    </div>
  );
}

function earnChips(q: EarnQuery, t: Translate): Array<{ key: string; label: string; clear: Partial<EarnQuery> }> {
  const out: Array<{ key: string; label: string; clear: Partial<EarnQuery> }> = [];
  if (q.type) out.push({ key: 'type', label: agentLedgerTypeWord(q.type, t), clear: { type: '' } });
  if (q.direction) out.push({ key: 'direction', label: q.direction === 'in' ? t('agent.records.moneyIn') : t('agent.records.moneyOut'), clear: { direction: '' } });
  if (q.from || q.to) out.push({ key: 'date', label: `${q.from || '…'} → ${q.to || '…'}`, clear: { from: '', to: '' } });
  if (q.sort !== 'newest') { const s = EARN_SORT.find((x) => x.value === q.sort); out.push({ key: 'sort', label: s ? t(s.labelKey) : q.sort, clear: { sort: 'newest' } }); }
  return out;
}

function EarnFilterSheet({ open, onClose, query, onApply, onClearAll }: { open: boolean; onClose: () => void; query: EarnQuery; onApply: (patch: Partial<EarnQuery>) => void; onClearAll: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<EarnQuery>(query);
  useEffect(() => {
    if (open) setDraft(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<EarnQuery>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <Sheet open={open} onClose={onClose} title={t('agent.records.filterEarningsTitle')}>
      <div class="field">
        <label class="field__label" for="e-type">{t('agent.records.type')}</label>
        <select id="e-type" class="select" value={draft.type} onChange={(e) => set({ type: e.currentTarget.value as EarnQuery['type'] })}>
          <option value="">{t('agent.records.anyType')}</option>
          {TYPE_OPTIONS.map((ty) => (
            <option key={ty} value={ty}>{agentLedgerTypeWord(ty, t)}</option>
          ))}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="e-dir">{t('agent.records.direction')}</label>
        <select id="e-dir" class="select" value={draft.direction} onChange={(e) => set({ direction: e.currentTarget.value as EarnQuery['direction'] })}>
          <option value="">{t('agent.records.dirAny')}</option>
          <option value="in">{t('agent.records.moneyIn')}</option>
          <option value="out">{t('agent.records.moneyOut')}</option>
        </select>
      </div>
      <div class="reg__dates">
        <div class="field">
          <label class="field__label" for="e-from">{t('agent.records.from')}</label>
          <input id="e-from" class="input" type="date" value={draft.from} onInput={(e) => set({ from: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="e-to">{t('agent.records.to')}</label>
          <input id="e-to" class="input" type="date" value={draft.to} onInput={(e) => set({ to: e.currentTarget.value })} />
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="e-sort">{t('agent.records.sort')}</label>
        <select id="e-sort" class="select" value={draft.sort} onChange={(e) => set({ sort: e.currentTarget.value as EarnQuery['sort'] })}>
          {EARN_SORT.map((s) => (
            <option key={s.value} value={s.value}>{t(s.labelKey)}</option>
          ))}
        </select>
      </div>
      <Button chevron={false} onClick={() => onApply({ type: draft.type, direction: draft.direction, from: draft.from, to: draft.to, sort: draft.sort })}>
        {t('agent.records.showEntries')}
      </Button>
      <Button variant="link" onClick={onClearAll}>
        {t('agent.records.clearAll')}
      </Button>
    </Sheet>
  );
}
