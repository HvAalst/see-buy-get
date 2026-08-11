import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Chip, ErrorNote, GlanceNumber, Icon, Pager, Pill, ReadAloud, SearchInput, Sheet } from '../../../shared/ui';
import { useDebounced } from '../../../shared/useDebounced';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { money } from '../logic';
import { JOBS_LIMIT, type DriverActions, type DriverState, type JobsQuery } from '../useDriverApp';
import type { DriverJobRow } from '../types';

export interface EarningsScreenProps {
  state: DriverState;
  actions: DriverActions;
}

const STATUS_OPTIONS: Array<{ value: 'claimed' | 'in_transit' | 'delivered'; labelKey: MessageKey }> = [
  { value: 'claimed', labelKey: 'driver.earn.statusClaimed' },
  { value: 'in_transit', labelKey: 'driver.earn.statusInTransit' },
  { value: 'delivered', labelKey: 'driver.earn.statusDelivered' },
];
const SORT_OPTIONS: Array<{ value: JobsQuery['sort']; labelKey: MessageKey }> = [
  { value: 'newest', labelKey: 'driver.earn.sortNewest' },
  { value: 'oldest', labelKey: 'driver.earn.sortOldest' },
  { value: 'earn_desc', labelKey: 'driver.earn.sortEarnDesc' },
  { value: 'earn_asc', labelKey: 'driver.earn.sortEarnAsc' },
];

const STATUS_WORD_KEYS: Record<string, MessageKey> = {
  available: 'driver.earn.statusAvailable',
  claimed: 'driver.earn.statusClaimed',
  in_transit: 'driver.earn.statusInTransit',
  delivered: 'driver.earn.statusDelivered',
};

function statusWord(status: string, t: Translate): string {
  const k = STATUS_WORD_KEYS[status];
  return k ? t(k) : status;
}

/**
 * The driver's jobs + earnings: what they have earned on their dedicated-freight hauls (paid vs still
 * owed), then the jobs themselves — searchable / filterable / paged / exportable. The "Earned" headline is
 * the sum for the CURRENT filter; there is no live balance to fall back to, so it shows a dash until loaded.
 */
export function EarningsScreen({ state, actions }: EarningsScreenProps) {
  const t = useT();
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

  const chips = jobChips(q, t);
  const filtered = q.q !== '' || chips.length > 0;
  const resetAll = () => {
    setSearchText('');
    actions.queryJobs({ q: '', status: '', paid: '', from: '', to: '', sort: 'newest' });
  };
  const live = loading
    ? t('driver.earn.liveLoading')
    : state.jobsState === 'error'
      ? t('driver.earn.liveError')
      : state.jobsTotal === 0
        ? filtered
          ? t('driver.earn.liveNoMatch')
          : t('driver.earn.liveEmpty')
        : state.jobsTotal === 1
          ? t('driver.earn.liveFoundOne', { count: state.jobsTotal })
          : t('driver.earn.liveFoundMany', { count: state.jobsTotal });

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('earnings')} /> : null}

      <GlanceNumber label={t('driver.earn.earned')} value={sum ? money(sum.earned) : '—'} sub={sum ? t('driver.earn.sub', { paid: money(sum.paid), unpaid: money(sum.unpaid), delivered: sum.delivered }) : t('driver.earn.subEmpty')} />

      <Card title={t('driver.earn.jobsTitle')} aside={<span class="row__count">{state.jobsTotal}</span>}>
        <div class="reg__controls">
          <SearchInput value={searchText} onInput={setSearchText} placeholder={t('driver.earn.searchPlaceholder')} label={t('driver.earn.searchLabel')} />
          <button type="button" class={`reg__filter${chips.length ? ' reg__filter--on' : ''}`} onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={20} />
            <span>{chips.length ? t('driver.earn.filtersCount', { count: chips.length }) : t('driver.earn.filters')}</span>
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
              <p class="hint">{t('driver.earn.loadingShort')}</p>
            ) : state.jobsState === 'error' ? (
              <p class="hint">{t('driver.earn.listError')} <button type="button" class="linkbtn" onClick={() => actions.queryJobs({ offset: q.offset })}>{t('driver.tryAgain')}</button></p>
            ) : filtered ? (
              <p class="hint">{t('driver.earn.listNoMatch')} <button type="button" class="linkbtn" onClick={resetAll}>{t('driver.earn.clearFilters')}</button></p>
            ) : (
              <p class="hint">{t('driver.earn.listEmpty')}</p>
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
              {t('driver.earn.exportAll', { count: state.jobsTotal })}
            </Button>
          </div>
        ) : null}
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => (sum ? t('driver.earn.aloud', { earned: money(sum.earned), paid: money(sum.paid), unpaid: money(sum.unpaid), delivered: sum.delivered }) : t('driver.earn.aloudEmpty'))} label={t('driver.readAloud')} />
      </div>

      <JobFilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} query={q} onApply={(patch) => { actions.queryJobs(patch); setFilterOpen(false); }} onClearAll={() => { resetAll(); setFilterOpen(false); }} />
    </div>
  );
}

function JobRow({ j }: { j: DriverJobRow }) {
  const t = useT();
  const when = j.deliveredAt ?? j.claimedAt;
  return (
    <div class="row row--static">
      <span class="row__ic">
        <Icon name="truck" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t mono-t">{j.code}</span>
        <span class="row__s">{t('driver.earn.rowDesc', { description: j.description, dest: j.destLabel })}</span>
        <span class="row__meta">
          {t('driver.earn.rowMeta', { status: statusWord(j.status, t), kg: j.weightKg, payment: j.paid ? t('driver.earn.paid') : t('driver.earn.owed') })}
          {when ? t('driver.earn.rowDate', { date: new Date(when).toLocaleDateString() }) : ''}
        </span>
      </span>
      <span class="row__end">
        <b class="amt amt--in">{money(j.earning)}</b>
        <Pill tone={j.paid ? 'ok' : 'warn'} dot>
          {j.paid ? t('driver.earn.paid') : t('driver.earn.owed')}
        </Pill>
      </span>
    </div>
  );
}

function jobChips(q: JobsQuery, t: Translate): Array<{ key: string; label: string; clear: Partial<JobsQuery> }> {
  const out: Array<{ key: string; label: string; clear: Partial<JobsQuery> }> = [];
  if (q.status) out.push({ key: 'status', label: statusWord(q.status, t), clear: { status: '' } });
  if (q.paid) out.push({ key: 'paid', label: q.paid === 'paid' ? t('driver.earn.paid') : t('driver.earn.owed'), clear: { paid: '' } });
  if (q.from || q.to) out.push({ key: 'date', label: t('driver.earn.dateChip', { from: q.from || '…', to: q.to || '…' }), clear: { from: '', to: '' } });
  if (q.sort !== 'newest') {
    const opt = SORT_OPTIONS.find((s) => s.value === q.sort);
    out.push({ key: 'sort', label: opt ? t(opt.labelKey) : q.sort, clear: { sort: 'newest' } });
  }
  return out;
}

function JobFilterSheet({ open, onClose, query, onApply, onClearAll }: { open: boolean; onClose: () => void; query: JobsQuery; onApply: (patch: Partial<JobsQuery>) => void; onClearAll: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<JobsQuery>(query);
  useEffect(() => {
    if (open) setDraft(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<JobsQuery>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <Sheet open={open} onClose={onClose} title={t('driver.earn.filterTitle')}>
      <div class="field">
        <label class="field__label" for="j-status">{t('driver.earn.statusFieldLabel')}</label>
        <select id="j-status" class="select" value={draft.status} onChange={(e) => set({ status: e.currentTarget.value as JobsQuery['status'] })}>
          <option value="">{t('driver.earn.anyStatus')}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{t(s.labelKey)}</option>
          ))}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="j-paid">{t('driver.earn.paymentLabel')}</label>
        <select id="j-paid" class="select" value={draft.paid} onChange={(e) => set({ paid: e.currentTarget.value as JobsQuery['paid'] })}>
          <option value="">{t('driver.earn.paidOrOwed')}</option>
          <option value="paid">{t('driver.earn.paid')}</option>
          <option value="unpaid">{t('driver.earn.owed')}</option>
        </select>
      </div>
      <div class="reg__dates">
        <div class="field">
          <label class="field__label" for="j-from">{t('driver.earn.fromLabel')}</label>
          <input id="j-from" class="input" type="date" value={draft.from} onInput={(e) => set({ from: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="j-to">{t('driver.earn.toLabel')}</label>
          <input id="j-to" class="input" type="date" value={draft.to} onInput={(e) => set({ to: e.currentTarget.value })} />
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="j-sort">{t('driver.earn.sortLabel')}</label>
        <select id="j-sort" class="select" value={draft.sort} onChange={(e) => set({ sort: e.currentTarget.value as JobsQuery['sort'] })}>
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{t(s.labelKey)}</option>
          ))}
        </select>
      </div>
      <Button chevron={false} onClick={() => onApply({ status: draft.status, paid: draft.paid, from: draft.from, to: draft.to, sort: draft.sort })}>
        {t('driver.earn.showJobs')}
      </Button>
      <Button variant="link" onClick={onClearAll}>
        {t('driver.earn.clearAllFilters')}
      </Button>
    </Sheet>
  );
}
