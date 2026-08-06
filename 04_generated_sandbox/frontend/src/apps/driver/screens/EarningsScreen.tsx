import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Chip, ErrorNote, GlanceNumber, Icon, Pager, Pill, ReadAloud, SearchInput, Sheet } from '../../../shared/ui';
import { useDebounced } from '../../../shared/useDebounced';
import { money } from '../logic';
import { JOBS_LIMIT, type DriverActions, type DriverState, type JobsQuery } from '../useDriverApp';
import type { DriverJobRow } from '../types';

export interface EarningsScreenProps {
  state: DriverState;
  actions: DriverActions;
}

const STATUS_OPTIONS: Array<{ value: 'claimed' | 'in_transit' | 'delivered'; label: string }> = [
  { value: 'claimed', label: 'Claimed' },
  { value: 'in_transit', label: 'On the road' },
  { value: 'delivered', label: 'Delivered' },
];
const SORT_OPTIONS: Array<{ value: JobsQuery['sort']; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'earn_desc', label: 'Earning: high → low' },
  { value: 'earn_asc', label: 'Earning: low → high' },
];

function statusWord(status: string): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'claimed':
      return 'Claimed';
    case 'in_transit':
      return 'On the road';
    case 'delivered':
      return 'Delivered';
    default:
      return status;
  }
}

/**
 * The driver's jobs + earnings: what they have earned on their dedicated-freight hauls (paid vs still
 * owed), then the jobs themselves — searchable / filterable / paged / exportable. The "Earned" headline is
 * the sum for the CURRENT filter; there is no live balance to fall back to, so it shows a dash until loaded.
 */
export function EarningsScreen({ state, actions }: EarningsScreenProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(state.jobsQuery.q);
  const debounced = useDebounced(searchText, 300);
  const q = state.jobsQuery;
  const sum = state.jobsSummary;
  const loading = state.jobsState === 'loading' || state.jobsState === 'idle';

  useEffect(() => {
    if (debounced !== state.jobsQuery.q) actions.queryJobs({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const chips = jobChips(q);
  const filtered = q.q !== '' || chips.length > 0;
  const resetAll = () => {
    setSearchText('');
    actions.queryJobs({ q: '', status: '', paid: '', from: '', to: '', sort: 'newest' });
  };
  const live = loading ? 'Loading jobs…' : state.jobsState === 'error' ? 'Could not load jobs.' : state.jobsTotal === 0 ? (filtered ? 'No jobs match your filters.' : 'No jobs yet.') : `${state.jobsTotal} job${state.jobsTotal === 1 ? '' : 's'} found.`;

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('earnings')} /> : null}

      <GlanceNumber label="Earned" value={sum ? money(sum.earned) : '—'} sub={sum ? `${money(sum.paid)} paid · ${money(sum.unpaid)} owed · ${sum.delivered} delivered` : 'What you have earned on your freight hauls — for whatever you filter to below.'} />

      <Card title="Jobs" aside={<span class="row__count">{state.jobsTotal}</span>}>
        <div class="reg__controls">
          <SearchInput value={searchText} onInput={setSearchText} placeholder="Search job, cargo, destination…" label="Search jobs" />
          <button type="button" class={`reg__filter${chips.length ? ' reg__filter--on' : ''}`} onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={20} />
            <span>{chips.length ? `Filters · ${chips.length}` : 'Filters'}</span>
          </button>
        </div>
        {chips.length ? (
          <div class="reg__chips">
            {chips.map((c) => (
              <Chip key={c.key} label={c.label} onRemove={() => actions.queryJobs(c.clear)} />
            ))}
          </div>
        ) : null}
        <p class="sr-only" role="status">{live}</p>
        <div class="reg__list" aria-busy={loading}>
          {state.jobs.length === 0 ? (
            loading ? (
              <p class="hint">Loading…</p>
            ) : state.jobsState === 'error' ? (
              <p class="hint">Couldn’t load your jobs. <button type="button" class="linkbtn" onClick={() => actions.queryJobs({ offset: q.offset })}>Try again</button></p>
            ) : filtered ? (
              <p class="hint">No jobs match. <button type="button" class="linkbtn" onClick={resetAll}>Clear filters</button></p>
            ) : (
              <p class="hint">No jobs yet. Claim a freight haul and it lands here.</p>
            )
          ) : (
            <div class={`rows${state.jobsState === 'loading' ? ' rows--loading' : ''}`} role="list">
              {state.jobs.map((j) => (
                <JobRow key={j.freightId} j={j} />
              ))}
            </div>
          )}
        </div>
        <Pager offset={q.offset} limit={JOBS_LIMIT} total={state.jobsTotal} busy={state.jobsState === 'loading'} onOffset={(offset) => actions.queryJobs({ offset })} />
        {state.jobsTotal > 0 ? (
          <div class="reg__export">
            <Button variant="link" full={false} busy={state.busy === 'export-jobs'} onClick={() => void actions.exportJobs()}>
              Export all {state.jobsTotal} as CSV
            </Button>
          </div>
        ) : null}
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => (sum ? `Earned ${money(sum.earned)}. ${money(sum.paid)} paid, ${money(sum.unpaid)} still owed, ${sum.delivered} delivered.` : 'Your earnings will show here.')} label="Read this aloud" />
      </div>

      <JobFilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} query={q} onApply={(patch) => { actions.queryJobs(patch); setFilterOpen(false); }} onClearAll={() => { resetAll(); setFilterOpen(false); }} />
    </div>
  );
}

function JobRow({ j }: { j: DriverJobRow }) {
  const when = j.deliveredAt ?? j.claimedAt;
  return (
    <div class="row row--static">
      <span class="row__ic">
        <Icon name="truck" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t mono-t">{j.code}</span>
        <span class="row__s">{`${j.description} · ${j.destLabel}`}</span>
        <span class="row__meta">{`${statusWord(j.status)} · ${j.weightKg} kg · ${j.paid ? 'Paid' : 'Owed'}${when ? ` · ${new Date(when).toLocaleDateString()}` : ''}`}</span>
      </span>
      <span class="row__end">
        <b class="amt amt--in">{money(j.earning)}</b>
        <Pill tone={j.paid ? 'ok' : 'warn'} dot>
          {j.paid ? 'Paid' : 'Owed'}
        </Pill>
      </span>
    </div>
  );
}

function jobChips(q: JobsQuery): Array<{ key: string; label: string; clear: Partial<JobsQuery> }> {
  const out: Array<{ key: string; label: string; clear: Partial<JobsQuery> }> = [];
  if (q.status) out.push({ key: 'status', label: statusWord(q.status), clear: { status: '' } });
  if (q.paid) out.push({ key: 'paid', label: q.paid === 'paid' ? 'Paid' : 'Owed', clear: { paid: '' } });
  if (q.from || q.to) out.push({ key: 'date', label: `${q.from || '…'} → ${q.to || '…'}`, clear: { from: '', to: '' } });
  if (q.sort !== 'newest') out.push({ key: 'sort', label: SORT_OPTIONS.find((s) => s.value === q.sort)?.label ?? q.sort, clear: { sort: 'newest' } });
  return out;
}

function JobFilterSheet({ open, onClose, query, onApply, onClearAll }: { open: boolean; onClose: () => void; query: JobsQuery; onApply: (patch: Partial<JobsQuery>) => void; onClearAll: () => void }) {
  const [draft, setDraft] = useState<JobsQuery>(query);
  useEffect(() => {
    if (open) setDraft(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<JobsQuery>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <Sheet open={open} onClose={onClose} title="Filter jobs">
      <div class="field">
        <label class="field__label" for="j-status">Status</label>
        <select id="j-status" class="select" value={draft.status} onChange={(e) => set({ status: e.currentTarget.value as JobsQuery['status'] })}>
          <option value="">Any status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="j-paid">Payment</label>
        <select id="j-paid" class="select" value={draft.paid} onChange={(e) => set({ paid: e.currentTarget.value as JobsQuery['paid'] })}>
          <option value="">Paid or owed</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Owed</option>
        </select>
      </div>
      <div class="reg__dates">
        <div class="field">
          <label class="field__label" for="j-from">From</label>
          <input id="j-from" class="input" type="date" value={draft.from} onInput={(e) => set({ from: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="j-to">To</label>
          <input id="j-to" class="input" type="date" value={draft.to} onInput={(e) => set({ to: e.currentTarget.value })} />
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="j-sort">Sort</label>
        <select id="j-sort" class="select" value={draft.sort} onChange={(e) => set({ sort: e.currentTarget.value as JobsQuery['sort'] })}>
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      <Button chevron={false} onClick={() => onApply({ status: draft.status, paid: draft.paid, from: draft.from, to: draft.to, sort: draft.sort })}>
        Show jobs
      </Button>
      <Button variant="link" onClick={onClearAll}>
        Clear all filters
      </Button>
    </Sheet>
  );
}
