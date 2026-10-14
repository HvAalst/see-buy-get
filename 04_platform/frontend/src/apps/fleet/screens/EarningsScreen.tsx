import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Chip, DocumentButton, ErrorNote, Explainer, GlanceNumber, Icon, Pager, Pill, ReadAloud, SearchInput, Sheet } from '../../../shared/ui';
import { useDebounced } from '../../../shared/useDebounced';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { EARN_LIMIT, type EarningsQuery, type FleetActions, type FleetState } from '../useFleetApp';
import type { FleetJobRow } from '../types';
import { cash } from '../../../shared/money';

export interface EarningsScreenProps {
  state: FleetState;
  actions: FleetActions;
}

const money = (n: number | undefined | null, currency?: string) => cash(n, currency);

const STATUS_OPTIONS: Array<{ value: 'claimed' | 'in_transit' | 'delivered' | 'cancelled'; labelKey: MessageKey }> = [
  { value: 'claimed', labelKey: 'fleet.earn.statusClaimed' },
  { value: 'in_transit', labelKey: 'fleet.earn.statusInTransit' },
  { value: 'delivered', labelKey: 'fleet.earn.statusDelivered' },
  { value: 'cancelled', labelKey: 'fleet.earn.statusCancelled' },
];
const SORT_OPTIONS: Array<{ value: EarningsQuery['sort']; labelKey: MessageKey }> = [
  { value: 'newest', labelKey: 'fleet.earn.sortNewest' },
  { value: 'oldest', labelKey: 'fleet.earn.sortOldest' },
  { value: 'earn_desc', labelKey: 'fleet.earn.sortEarnDesc' },
  { value: 'earn_asc', labelKey: 'fleet.earn.sortEarnAsc' },
];
const STATUS_WORD_KEYS: Record<string, MessageKey> = {
  available: 'fleet.earn.statusAvailable',
  claimed: 'fleet.earn.statusClaimed',
  in_transit: 'fleet.earn.statusInTransit',
  delivered: 'fleet.earn.statusDelivered',
  cancelled: 'fleet.earn.statusCancelled',
};
const statusWord = (status: string, t: Translate) => (STATUS_WORD_KEYS[status] ? t(STATUS_WORD_KEYS[status]) : status);

/**
 * FP1 — WHAT THE FLEET HAS EARNED, AND WHERE THE MONEY IS.
 *
 * A fleet is paid as one supplier for every haul its drivers carry, and until this screen it could see none of it:
 * the money accrued in the network's books under the fleet's name while the fleet app showed vehicles and shifts.
 * This is the register a manager reconciles payday against — every haul with the driver beside it, the total cut
 * by driver and by month, and, apart from all that, three figures that must never be blurred: what the network
 * has BOOKED as owed, what is ON ITS WAY, and what a rail confirmed LEAVING.
 */
export function EarningsScreen({ state, actions }: EarningsScreenProps) {
  const t = useT();
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(state.earnQuery.q);
  const debounced = useDebounced(searchText, 300);
  const q = state.earnQuery;
  const sum = state.earnSummary;
  // Every total in the money the fleet is settled in; a job in the money it was locked in (JobRow).
  const currency = sum?.settlement?.currency ?? state.dashboard?.currency;
  const loading = state.earnState === 'loading' || state.earnState === 'idle';

  useEffect(() => {
    if (debounced !== state.earnQuery.q) actions.queryEarnings({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const nameOf = (did: string) => state.drivers.find((d) => d.did === did)?.displayName ?? did;
  const chips = earnChips(q, t, nameOf);
  const filtered = q.q !== '' || chips.length > 0;
  const resetAll = () => {
    setSearchText('');
    actions.queryEarnings({ q: '', status: '', paid: '', driver: '', from: '', to: '', sort: 'newest' });
  };

  return (
    <div class="scr">
      <div class="scr__back">
        <Button variant="link" chevron={false} onClick={() => actions.go('dash')}>
          <Icon name="chevronLeft" size={20} /> {t('fleet.earn.back')}
        </Button>
      </div>
      <h1 class="scr__title">{t('fleet.earn.title')}</h1>
      <Explainer who={state.manager?.did} id="fleet.earnings.how" text={t('fleet.earn.lede')} />
      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.queryEarnings({ offset: q.offset })} /> : null}

      <GlanceNumber
        label={t('fleet.earn.earned')}
        value={sum ? money(sum.earned, currency) : '—'}
        sub={sum ? t('fleet.earn.sub', { booked: money(sum.paid, currency), pending: money(sum.unpaid, currency), delivered: sum.delivered, count: sum.count }) : t('fleet.earn.subEmpty')}
      />

      {/* The money itself — three facts, three lines, never one number. */}
      {sum?.settlement ? (
        <Card title={t('fleet.earn.moneyTitle')}>
          <div class="kv">
            <span>{t('fleet.earn.owed')}</span>
            <b class="mono-t">{sum.settlement.owed == null ? t('fleet.earn.owedNoSister') : money(sum.settlement.owed, currency)}</b>
          </div>
          <div class="kv">
            <span>{t('fleet.earn.inFlight')}</span>
            <b class="mono-t">{money(sum.settlement.inFlight, currency)}</b>
          </div>
          <div class="kv">
            <span>{t('fleet.earn.settled')}</span>
            <b class="mono-t">{money(sum.settlement.settled, currency)}</b>
          </div>
          <p class="card__note">{sum.settlement.owed == null ? t('fleet.earn.moneyNoteNoSister') : t('fleet.earn.moneyNote')}</p>
        </Card>
      ) : null}

      {sum && sum.byDriver.length ? (
        <Card title={t('fleet.earn.byDriverTitle')}>
          <div class="rows" role="list">
            {sum.byDriver.map((d) => (
              <button key={d.driverDid} type="button" class="row" onClick={() => actions.queryEarnings({ driver: q.driver === d.driverDid ? '' : d.driverDid })} aria-pressed={q.driver === d.driverDid}>
                <span class="row__ic">
                  <Icon name="person" size={22} />
                </span>
                <span class="row__body">
                  <span class="row__t">{d.driverName}</span>
                  <span class="row__s">{t('fleet.earn.driverLine', { delivered: d.delivered, count: d.count })}</span>
                </span>
                <span class="row__end">
                  <b class="amt amt--in">{money(d.earned, currency)}</b>
                </span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {sum && sum.byMonth.length ? (
        <Card title={t('fleet.earn.byMonthTitle')}>
          {sum.byMonth.map((m) => (
            <div key={m.month} class="kv">
              <span>{monthWords(m.month)}</span>
              <b class="mono-t">
                {money(m.earned, currency)} <span class="hint">· {t('fleet.earn.monthLine', { delivered: m.delivered, count: m.count })}</span>
              </b>
            </div>
          ))}
        </Card>
      ) : null}

      <Card title={t('fleet.earn.jobsTitle')} aside={<span class="row__count">{state.earnTotal}</span>}>
        <div class="reg__controls">
          <SearchInput value={searchText} onInput={setSearchText} placeholder={t('fleet.earn.searchPlaceholder')} label={t('fleet.earn.searchLabel')} />
          <button type="button" class={`reg__filter${chips.length ? ' reg__filter--on' : ''}`} onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={20} />
            <span>{chips.length ? t('fleet.earn.filtersCount', { count: chips.length }) : t('fleet.earn.filters')}</span>
          </button>
        </div>
        {chips.length ? (
          <div class="reg__chips">
            {chips.map((c) => (
              <Chip key={c.key} label={c.label} onRemove={() => actions.queryEarnings(c.clear)} />
            ))}
          </div>
        ) : null}
        <div class="reg__list" aria-busy={loading}>
          {state.earnRows.length === 0 ? (
            loading ? (
              <p class="hint">{t('fleet.earn.loading')}</p>
            ) : state.earnState === 'error' ? (
              <p class="hint">{t('fleet.earn.listError')}</p>
            ) : filtered ? (
              <p class="hint">
                {t('fleet.earn.listNoMatch')}{' '}
                <button type="button" class="linkbtn" onClick={resetAll}>
                  {t('fleet.earn.clearFilters')}
                </button>
              </p>
            ) : (
              <p class="hint">{t('fleet.earn.listEmpty')}</p>
            )
          ) : (
            <div class={`rows${state.earnState === 'loading' ? ' rows--loading' : ''}`} role="list">
              {state.earnRows.map((j) => (
                <JobRow key={j.freightId} j={j} currency={currency} actions={actions} />
              ))}
            </div>
          )}
        </div>
        <Pager offset={q.offset} limit={EARN_LIMIT} total={state.earnTotal} busy={state.earnState === 'loading'} onOffset={(offset) => actions.queryEarnings({ offset })} />
        {state.earnTotal > 0 ? (
          <div class="reg__export">
            <Button variant="link" full={false} busy={state.busy === 'export-earnings'} onClick={() => void actions.exportEarnings()}>
              {t('fleet.earn.exportAll', { count: state.earnTotal })}
            </Button>
          </div>
        ) : null}
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => (sum ? t('fleet.earn.aloud', { earned: money(sum.earned, currency), owed: money(sum.settlement?.owed ?? 0, currency), settled: money(sum.settlement?.settled ?? 0, currency) }) : t('fleet.earn.aloudEmpty'))} label={t('fleet.readAloud')} />
      </div>

      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        query={q}
        drivers={state.drivers.map((d) => ({ did: d.did, name: d.displayName }))}
        onApply={(patch) => {
          actions.queryEarnings(patch);
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

function JobRow({ j, currency, actions }: { j: FleetJobRow; currency?: string; actions: FleetActions }) {
  const t = useT();
  const when = j.deliveredAt ?? j.claimedAt;
  return (
    <div class="row row--static">
      <span class="row__ic">
        <Icon name="truck" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">
          <span class="mono-t">{j.code}</span> · {j.driverName}
        </span>
        <span class="row__s">{t('fleet.earn.rowDesc', { description: j.description, dest: j.destLabel })}</span>
        <span class="row__meta">
          {t('fleet.earn.rowMeta', { status: statusWord(j.status, t), kg: j.weightKg })}
          {when ? ` · ${new Date(when).toLocaleDateString()}` : ''}
        </span>
        {/* FP8 — an upheld claim took part of this haul's pay back. */}
        {j.clawback ? <span class="row__meta row__s--danger">{t('fleet.earn.clawbackLine', { amount: money(j.clawback, j.currency ?? currency) })}</span> : null}
        <span class="row__meta">
          <DocumentButton label={t('common.cmr.open')} title={t('common.cmr.title')} fetch={() => actions.freightNote(j.freightId)} />
        </span>
      </span>
      <span class="row__end">
        <b class="amt amt--in">{money(j.earning, j.currency ?? currency)}</b>
        <Pill tone={j.paid || j.direct ? 'ok' : 'warn'} dot>
          {j.paid ? t('fleet.earn.booked') : j.direct ? t('fleet.earn.direct') : t('fleet.earn.pending')}
        </Pill>
      </span>
    </div>
  );
}

/** "September 2026" from "2026-09". */
function monthWords(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function earnChips(q: EarningsQuery, t: Translate, nameOf: (did: string) => string): Array<{ key: string; label: string; clear: Partial<EarningsQuery> }> {
  const out: Array<{ key: string; label: string; clear: Partial<EarningsQuery> }> = [];
  if (q.driver) out.push({ key: 'driver', label: nameOf(q.driver), clear: { driver: '' } });
  if (q.status) out.push({ key: 'status', label: statusWord(q.status, t), clear: { status: '' } });
  if (q.paid) out.push({ key: 'paid', label: q.paid === 'paid' ? t('fleet.earn.booked') : t('fleet.earn.pending'), clear: { paid: '' } });
  if (q.from || q.to) out.push({ key: 'date', label: `${q.from || '…'} → ${q.to || '…'}`, clear: { from: '', to: '' } });
  if (q.sort !== 'newest') {
    const opt = SORT_OPTIONS.find((s) => s.value === q.sort);
    out.push({ key: 'sort', label: opt ? t(opt.labelKey) : q.sort, clear: { sort: 'newest' } });
  }
  return out;
}

function FilterSheet({ open, onClose, query, drivers, onApply, onClearAll }: { open: boolean; onClose: () => void; query: EarningsQuery; drivers: Array<{ did: string; name: string }>; onApply: (patch: Partial<EarningsQuery>) => void; onClearAll: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<EarningsQuery>(query);
  useEffect(() => {
    if (open) setDraft(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<EarningsQuery>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <Sheet open={open} onClose={onClose} title={t('fleet.earn.filterTitle')}>
      <div class="field">
        <label class="field__label" for="e-driver">
          {t('fleet.earn.driverLabel')}
        </label>
        <select id="e-driver" class="select" value={draft.driver} onChange={(e) => set({ driver: e.currentTarget.value })}>
          <option value="">{t('fleet.earn.anyDriver')}</option>
          {drivers.map((d) => (
            <option key={d.did} value={d.did}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="e-status">
          {t('fleet.earn.statusFieldLabel')}
        </label>
        <select id="e-status" class="select" value={draft.status} onChange={(e) => set({ status: e.currentTarget.value as EarningsQuery['status'] })}>
          <option value="">{t('fleet.earn.anyStatus')}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {t(s.labelKey)}
            </option>
          ))}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="e-paid">
          {t('fleet.earn.paymentLabel')}
        </label>
        <select id="e-paid" class="select" value={draft.paid} onChange={(e) => set({ paid: e.currentTarget.value as EarningsQuery['paid'] })}>
          <option value="">{t('fleet.earn.bookedOrPending')}</option>
          <option value="paid">{t('fleet.earn.booked')}</option>
          <option value="unpaid">{t('fleet.earn.pending')}</option>
        </select>
      </div>
      <div class="reg__dates">
        <div class="field">
          <label class="field__label" for="e-from">
            {t('fleet.earn.fromLabel')}
          </label>
          <input id="e-from" class="input" type="date" value={draft.from} onInput={(e) => set({ from: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="e-to">
            {t('fleet.earn.toLabel')}
          </label>
          <input id="e-to" class="input" type="date" value={draft.to} onInput={(e) => set({ to: e.currentTarget.value })} />
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="e-sort">
          {t('fleet.earn.sortLabel')}
        </label>
        <select id="e-sort" class="select" value={draft.sort} onChange={(e) => set({ sort: e.currentTarget.value as EarningsQuery['sort'] })}>
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {t(s.labelKey)}
            </option>
          ))}
        </select>
      </div>
      <Button chevron={false} onClick={() => onApply({ driver: draft.driver, status: draft.status, paid: draft.paid, from: draft.from, to: draft.to, sort: draft.sort })}>
        {t('fleet.earn.show')}
      </Button>
      <Button variant="link" onClick={onClearAll}>
        {t('fleet.earn.clearAllFilters')}
      </Button>
    </Sheet>
  );
}
