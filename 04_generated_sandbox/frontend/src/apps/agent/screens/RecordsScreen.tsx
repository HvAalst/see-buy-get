import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Chip, GlanceNumber, Icon, Pager, ReadAloud, SearchInput, Sheet } from '../../../shared/ui';
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
  const [view, setView] = useState<View>('parcels');

  useEffect(() => {
    if (view === 'parcels' && state.parcelHistState === 'idle') actions.loadHistory();
    if (view === 'earnings' && state.ledgerState === 'idle') actions.loadEarnings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return (
    <div class="scr">
      <div class="seg" role="group" aria-label="Records view">
        <button type="button" aria-pressed={view === 'parcels'} class={`seg__btn${view === 'parcels' ? ' seg__btn--on' : ''}`} onClick={() => setView('parcels')}>
          Parcels
        </button>
        <button type="button" aria-pressed={view === 'earnings'} class={`seg__btn${view === 'earnings' ? ' seg__btn--on' : ''}`} onClick={() => setView('earnings')}>
          Earnings
        </button>
      </div>

      {view === 'parcels' ? <ParcelHistory state={state} actions={actions} /> : <Earnings state={state} actions={actions} />}
    </div>
  );
}

/* ------------------------------------------------------------------ parcels -- */

const STATUS_OPTIONS: ParcelStatus[] = ['Created', 'At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Delivered', 'Disputed', 'Voided'];

function ParcelHistory({ state, actions }: RecordsScreenProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(state.parcelHistQuery.q);
  const debounced = useDebounced(searchText, 300);
  const q = state.parcelHistQuery;

  useEffect(() => {
    if (debounced !== state.parcelHistQuery.q) actions.queryHistory({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const chips = histChips(q);
  const filtered = q.q !== '' || chips.length > 0;
  const resetAll = () => {
    setSearchText('');
    actions.queryHistory({ q: '', status: '', role: '', from: '', to: '', sort: 'newest' });
  };
  // 'idle' is the pre-load frame — treat it as loading so the first open never flashes the "nothing here" copy.
  const loading = state.parcelHistState === 'loading' || state.parcelHistState === 'idle';
  const live = loading ? 'Loading parcels…' : state.parcelHistState === 'error' ? 'Could not load parcels.' : state.parcelHistTotal === 0 ? (filtered ? 'No parcels match your filters.' : 'No parcels yet.') : `${state.parcelHistTotal} parcel${state.parcelHistTotal === 1 ? '' : 's'} found.`;

  return (
    <>
      <Card title="Parcel history" aside={<span class="row__count">{state.parcelHistTotal}</span>}>
        <div class="reg__controls">
          <SearchInput value={searchText} onInput={setSearchText} placeholder="Search parcel, DID, tracking, zone…" label="Search parcels" />
          <button type="button" class={`reg__filter${chips.length ? ' reg__filter--on' : ''}`} onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={20} />
            <span>{chips.length ? `Filters · ${chips.length}` : 'Filters'}</span>
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
              <p class="hint">Loading…</p>
            ) : state.parcelHistState === 'error' ? (
              <p class="hint">Couldn’t load your parcels. <button type="button" class="linkbtn" onClick={() => actions.queryHistory({ offset: q.offset })}>Try again</button></p>
            ) : filtered ? (
              <p class="hint">No parcels match. <button type="button" class="linkbtn" onClick={resetAll}>Clear filters</button></p>
            ) : (
              <p class="hint">No parcels yet. Take one in and it lands here.</p>
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
              Export all {state.parcelHistTotal} as CSV
            </Button>
          </div>
        ) : null}
      </Card>

      <HistFilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} query={q} onApply={(patch) => { actions.queryHistory(patch); setFilterOpen(false); }} onClearAll={() => { resetAll(); setFilterOpen(false); }} />
    </>
  );
}

function HistRow({ p }: { p: AgentParcelRow }) {
  return (
    <div class="row row--static">
      <span class="row__ic">
        <Icon name={p.role === 'origin' ? 'box' : 'person'} size={24} />
      </span>
      <span class="row__body">
        <span class="row__t mono-t">{p.parcelId}</span>
        <span class="row__s">{`${parcelRoleWord(p.role)} · ${p.originZone} → ${p.destZone} · ${p.size}`}</span>
        <span class="row__meta">{`${parcelStatusWord(p.status)} · ${new Date(p.createdAt).toLocaleDateString()}`}</span>
      </span>
    </div>
  );
}

function histChips(q: HistQuery): Array<{ key: string; label: string; clear: Partial<HistQuery> }> {
  const out: Array<{ key: string; label: string; clear: Partial<HistQuery> }> = [];
  if (q.status) out.push({ key: 'status', label: parcelStatusWord(q.status as ParcelStatus), clear: { status: '' } });
  if (q.role) out.push({ key: 'role', label: parcelRoleWord(q.role), clear: { role: '' } });
  if (q.from || q.to) out.push({ key: 'date', label: `${q.from || '…'} → ${q.to || '…'}`, clear: { from: '', to: '' } });
  if (q.sort !== 'newest') out.push({ key: 'sort', label: 'Oldest first', clear: { sort: 'newest' } });
  return out;
}

function HistFilterSheet({ open, onClose, query, onApply, onClearAll }: { open: boolean; onClose: () => void; query: HistQuery; onApply: (patch: Partial<HistQuery>) => void; onClearAll: () => void }) {
  const [draft, setDraft] = useState<HistQuery>(query);
  useEffect(() => {
    if (open) setDraft(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<HistQuery>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <Sheet open={open} onClose={onClose} title="Filter parcels">
      <div class="field">
        <label class="field__label" for="h-role">What you did</label>
        <select id="h-role" class="select" value={draft.role} onChange={(e) => set({ role: e.currentTarget.value as HistQuery['role'] })}>
          <option value="">Took in or handed out</option>
          <option value="origin">Took in (drop-off)</option>
          <option value="dest">Handed out (collection)</option>
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="h-status">Status</label>
        <select id="h-status" class="select" value={draft.status} onChange={(e) => set({ status: e.currentTarget.value })}>
          <option value="">Any status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{parcelStatusWord(s)}</option>
          ))}
        </select>
      </div>
      <div class="reg__dates">
        <div class="field">
          <label class="field__label" for="h-from">From</label>
          <input id="h-from" class="input" type="date" value={draft.from} onInput={(e) => set({ from: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="h-to">To</label>
          <input id="h-to" class="input" type="date" value={draft.to} onInput={(e) => set({ to: e.currentTarget.value })} />
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="h-sort">Sort</label>
        <select id="h-sort" class="select" value={draft.sort} onChange={(e) => set({ sort: e.currentTarget.value as HistQuery['sort'] })}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
      <Button chevron={false} onClick={() => onApply({ status: draft.status, role: draft.role, from: draft.from, to: draft.to, sort: draft.sort })}>
        Show parcels
      </Button>
      <Button variant="link" onClick={onClearAll}>
        Clear all filters
      </Button>
    </Sheet>
  );
}

/* ----------------------------------------------------------------- earnings -- */

const TYPE_OPTIONS: Array<{ value: EarnQuery['type']; label: string }> = [
  { value: 'TOP_UP', label: 'Top-up' },
  { value: 'LABOR_PAYOUT', label: 'Handling pay' },
  { value: 'FEE', label: 'Shipping fee' },
  { value: 'REFUND', label: 'Refund' },
  { value: 'OVERDRAFT', label: 'Credit' },
];
const EARN_SORT: Array<{ value: EarnQuery['sort']; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'amount_desc', label: 'Amount: high → low' },
  { value: 'amount_asc', label: 'Amount: low → high' },
];

function netLabel(net: number): string {
  return `${net < 0 ? '−' : ''}${money(Math.abs(net))}`;
}

function Earnings({ state, actions }: RecordsScreenProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(state.ledgerQuery.q);
  const debounced = useDebounced(searchText, 300);
  const q = state.ledgerQuery;
  const sum = state.ledgerSummary;

  useEffect(() => {
    if (debounced !== state.ledgerQuery.q) actions.queryLedger({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const chips = earnChips(q);
  const filtered = q.q !== '' || chips.length > 0;
  const resetAll = () => {
    setSearchText('');
    actions.queryLedger({ q: '', type: '', direction: '', from: '', to: '', sort: 'newest' });
  };
  const loading = state.ledgerState === 'loading' || state.ledgerState === 'idle';
  const live = loading ? 'Loading earnings…' : state.ledgerState === 'error' ? 'Could not load earnings.' : state.ledgerTotal === 0 ? (filtered ? 'No entries match your filters.' : 'No entries yet.') : `${state.ledgerTotal} ${state.ledgerTotal === 1 ? 'entry' : 'entries'} found.`;

  return (
    <>
      {/* The BALANCE is the live wallet (state.agent), never the summary's fetch-time snapshot — a top-up on
          another screen must not leave a stale figure here. The summary drives only the in/out/net sub-line. */}
      <GlanceNumber label="Wallet balance" value={money(state.agent?.balance)} sub={sum ? `This view · ${money(sum.in)} in · ${money(sum.out)} out · net ${netLabel(sum.net)}` : 'Your money in, out and net — for whatever you filter to below.'} />

      <Card title="Earnings" aside={<span class="row__count">{state.ledgerTotal}</span>}>
        <div class="reg__controls">
          <SearchInput value={searchText} onInput={setSearchText} placeholder="Search reference or type…" label="Search earnings" />
          <button type="button" class={`reg__filter${chips.length ? ' reg__filter--on' : ''}`} onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={20} />
            <span>{chips.length ? `Filters · ${chips.length}` : 'Filters'}</span>
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
              <p class="hint">Loading…</p>
            ) : state.ledgerState === 'error' ? (
              <p class="hint">Couldn’t load your earnings. <button type="button" class="linkbtn" onClick={() => actions.queryLedger({ offset: q.offset })}>Try again</button></p>
            ) : filtered ? (
              <p class="hint">No entries match. <button type="button" class="linkbtn" onClick={resetAll}>Clear filters</button></p>
            ) : (
              <p class="hint">No entries yet. Take in a parcel or top up and it lands here.</p>
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
              Export all {state.ledgerTotal} as CSV
            </Button>
          </div>
        ) : null}
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => `Balance ${money(state.agent?.balance ?? 0)}.${sum ? ` In this view: ${money(sum.in)} in, ${money(sum.out)} out, net ${sum.net < 0 ? 'minus ' : ''}${money(Math.abs(sum.net))}.` : ''}`} label="Read this aloud" />
      </div>

      <EarnFilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} query={q} onApply={(patch) => { actions.queryLedger(patch); setFilterOpen(false); }} onClearAll={() => { resetAll(); setFilterOpen(false); }} />
    </>
  );
}

function EarnRow({ e }: { e: AgentLedgerRow }) {
  return (
    <div class="row row--static">
      <span class="row__ic">
        <Icon name={e.sign === '+' ? 'wallet' : 'send'} size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">{agentLedgerTypeWord(e.type)}</span>
        {e.reference ? <span class="row__s mono-t">{e.reference}</span> : null}
        <span class="row__meta">{new Date(e.at).toLocaleDateString()}</span>
      </span>
      <span class="row__end">
        <b class={`amt amt--${e.sign === '+' ? 'in' : 'out'}`}>{`${e.sign}${money(e.amount)}`}</b>
      </span>
    </div>
  );
}

function earnChips(q: EarnQuery): Array<{ key: string; label: string; clear: Partial<EarnQuery> }> {
  const out: Array<{ key: string; label: string; clear: Partial<EarnQuery> }> = [];
  if (q.type) out.push({ key: 'type', label: agentLedgerTypeWord(q.type), clear: { type: '' } });
  if (q.direction) out.push({ key: 'direction', label: q.direction === 'in' ? 'Money in' : 'Money out', clear: { direction: '' } });
  if (q.from || q.to) out.push({ key: 'date', label: `${q.from || '…'} → ${q.to || '…'}`, clear: { from: '', to: '' } });
  if (q.sort !== 'newest') out.push({ key: 'sort', label: EARN_SORT.find((s) => s.value === q.sort)?.label ?? q.sort, clear: { sort: 'newest' } });
  return out;
}

function EarnFilterSheet({ open, onClose, query, onApply, onClearAll }: { open: boolean; onClose: () => void; query: EarnQuery; onApply: (patch: Partial<EarnQuery>) => void; onClearAll: () => void }) {
  const [draft, setDraft] = useState<EarnQuery>(query);
  useEffect(() => {
    if (open) setDraft(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<EarnQuery>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <Sheet open={open} onClose={onClose} title="Filter earnings">
      <div class="field">
        <label class="field__label" for="e-type">Type</label>
        <select id="e-type" class="select" value={draft.type} onChange={(e) => set({ type: e.currentTarget.value as EarnQuery['type'] })}>
          <option value="">Any type</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="e-dir">Direction</label>
        <select id="e-dir" class="select" value={draft.direction} onChange={(e) => set({ direction: e.currentTarget.value as EarnQuery['direction'] })}>
          <option value="">Money in or out</option>
          <option value="in">Money in</option>
          <option value="out">Money out</option>
        </select>
      </div>
      <div class="reg__dates">
        <div class="field">
          <label class="field__label" for="e-from">From</label>
          <input id="e-from" class="input" type="date" value={draft.from} onInput={(e) => set({ from: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="e-to">To</label>
          <input id="e-to" class="input" type="date" value={draft.to} onInput={(e) => set({ to: e.currentTarget.value })} />
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="e-sort">Sort</label>
        <select id="e-sort" class="select" value={draft.sort} onChange={(e) => set({ sort: e.currentTarget.value as EarnQuery['sort'] })}>
          {EARN_SORT.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      <Button chevron={false} onClick={() => onApply({ type: draft.type, direction: draft.direction, from: draft.from, to: draft.to, sort: draft.sort })}>
        Show entries
      </Button>
      <Button variant="link" onClick={onClearAll}>
        Clear all filters
      </Button>
    </Sheet>
  );
}
