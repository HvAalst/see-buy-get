import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { narrow, type SbgError } from '../../../lib/sbg';
import { ErrorNote } from '../../../shared/ui';
import type { TowerActions, TowerState } from '../useTowerApp';
import { TrailAnchorPanel } from './TrailAnchorPanel';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

interface StaffRead {
  readId: string;
  at: string;
  lastAt: string;
  times: number;
  byKind: 'staff' | 'key';
  byName: string;
  route: string;
  record: string;
}

/**
 * WHAT STAFF OPENED (backend staff-reads.types.ts) — every record a member of staff opened by its name or number: who,
 * which, when, how many times in a row. Lists are not in it. Looking at it is in it too.
 */
export function StaffReadsScreen({ actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [by, setBy] = useState('');
  const [record, setRecord] = useState('');
  const [rows, setRows] = useState<StaffRead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<SbgError | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.staffReads({ ...(by.trim() ? { by: by.trim() } : {}), ...(record.trim() ? { record: record.trim() } : {}) });
    if (r.error) return setError(r.error);
    const v = narrow<{ items: StaffRead[]; total: number }>(r.data);
    setError(null);
    setRows(v?.items ?? []);
    setTotal(v?.total ?? 0);
  }, [client, by, record]);

  useEffect(() => {
    void load();
    // Loaded once on arrival; the filters ask again when their button is pressed.
  }, [client]);

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.staffReads.title')}</h1>
        <p class="cons__lede">{t('tower.staffReads.lede')}</p>
      </header>
      {/* Round 40 — the trail anchored outside our database: the auditor's daily copy, and checking one read out. */}
      <TrailAnchorPanel actions={actions} />
      <section class="cons__panel">
        <form
          class="cons__filters"
          style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <label class="cfield">
            <span class="cfield__label">{t('tower.staffReads.by')}</span>
            <input id="staff-reads-by" class="cinput" value={by} placeholder={t('tower.staffReads.byPlaceholder')} onInput={(e) => setBy(e.currentTarget.value)} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.staffReads.record')}</span>
            <input id="staff-reads-record" class="cinput" value={record} placeholder={t('tower.staffReads.recordPlaceholder')} onInput={(e) => setRecord(e.currentTarget.value)} />
          </label>
          <button type="submit" class="cbtn cbtn--primary cbtn--sm">
            {t('tower.staffReads.find')}
          </button>
        </form>
        {error ? <ErrorNote error={error} onRetry={() => void load()} /> : null}
        {rows === null ? (
          <p class="cons__empty">{t('tower.imports.loading')}</p>
        ) : rows.length === 0 ? (
          <p class="cons__empty">{t('tower.staffReads.none')}</p>
        ) : (
          <>
            <p class="chint">{t('tower.staffReads.count', { shown: rows.length, total })}</p>
            <div class="crows">
              {rows.map((r) => (
                <div class="crow crow--static" key={r.readId}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">{r.record}</span>
                      <span class={`ctag ${r.byKind === 'key' ? 'ctag--warn' : 'ctag--quiet'}`}>{r.byName}</span>
                    </span>
                    <span class="crow__sub">
                      {r.times > 1 ? t('tower.staffReads.times', { first: when(r.at), last: when(r.lastAt), n: r.times }) : when(r.at)} · <code>{r.route}</code>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
