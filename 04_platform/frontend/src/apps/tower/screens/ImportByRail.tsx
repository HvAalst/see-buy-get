import { Abbreviated } from '../../../shared/ui/Abbr';
import { useState } from 'preact/hooks';
import type { components } from '../../../lib/sbg/schema';
import { useT } from '../../../shared/i18n';
import { ConsoleFold } from '../ConsoleFold';
import { SitePicker } from './SitePicker';

export type ImportByRailView = components['schemas']['ImportByRailView'];
type Result = Promise<{ error?: { detail?: string; title?: string } | null }>;

export interface ImportByRailCalls {
  set(body: { terminalSiteId: string; expectedAt?: string; freeDays?: number }): Result;
  arrived(body: { at: string; reference?: string }): Result;
  collectAnyway(reason: string): Result;
  /** When the train left the port with the box: the line's clock outside the terminal starts then (2026-10-29). */
  leftPort(at: string): Result;
}

/** A moment typed as UTC (the console's times are UTC), or nothing. */
const utcIn = (v: string): string | undefined => {
  const at = Date.parse(`${v.trim()}${v.trim().length === 16 ? ':00' : ''}Z`);
  return v.trim() && !Number.isNaN(at) ? new Date(at).toISOString() : undefined;
};
const utc = (iso?: string) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '');

/**
 * INLAND BY RAIL (the user, 2026-10-29: "build the clock with the blocker as you said"). The box comes from the port on a
 * train; our truck collects it at the rail terminal. Until the railway has said it is there, the road leg waits — offered
 * to nobody, refused at the take — so no truck is sent to wait for a train. The importer alone may send it anyway, with a
 * reason, because it pays for the waiting. The rail terminal's free days run from the arrival until our truck takes the box.
 */
export function ImportByRail({ code, rail, youAre, entityId, api, calls, onChanged }: {
  code: string;
  rail?: ImportByRailView;
  youAre: 'importer' | 'agent' | 'onlooker' | string;
  entityId: string;
  api: unknown;
  calls: ImportByRailCalls;
  onChanged: () => void | Promise<void>;
}) {
  const t = useT();
  const canAct = youAre === 'importer' || youAre === 'agent';
  const [form, setForm] = useState({ site: '', expected: '', freeDays: '' });
  const [arrival, setArrival] = useState({ at: '', reference: '' });
  const [reason, setReason] = useState('');
  const [leftAt, setLeftAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Result) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title || '');
    setChanging(false);
    await onChanged();
  };

  const clock = rail?.clock;
  const clockLine = !rail || !clock
    ? ''
    : clock.state === 'not_started'
      ? t('tower.byRail.clock.notStarted')
      : clock.state === 'no_free_days'
        ? t('tower.byRail.clock.noFreeDays', { terminal: rail.terminal.label })
        : clock.state === 'running'
          ? t('tower.byRail.clock.running', { days: clock.freeDays ?? 0, terminal: rail.terminal.label, until: utc(clock.freeUntil) })
          : clock.state === 'due_soon'
            ? t('tower.byRail.clock.dueSoon', { terminal: rail.terminal.label, until: utc(clock.freeUntil) })
            : clock.state === 'over'
              ? t('tower.byRail.clock.over', { until: utc(clock.freeUntil), days: clock.daysOver ?? 0 })
              : t('tower.byRail.clock.stopped', { when: utc(clock.leftAt), days: clock.daysOver ?? 0 });
  const urgent = clock?.state === 'due_soon' || clock?.state === 'over';
  const hint = !rail
    ? t('tower.byRail.fold.none')
    : clock?.state === 'over'
      ? t('tower.byRail.fold.over', { terminal: rail.terminal.label })
      : clock?.state === 'due_soon'
        ? t('tower.byRail.fold.dueSoon', { terminal: rail.terminal.label })
        : rail.arrival
          ? t('tower.byRail.fold.arrived', { terminal: rail.terminal.label })
          : rail.collectAnyway ? t('tower.byRail.fold.anyway') : t('tower.byRail.fold.waiting', { terminal: rail.terminal.label });

  return (
    <ConsoleFold title={<>{code} · {t('tower.byRail.title')}</>} hint={hint} defaultOpen={Boolean(rail && (!rail.arrival || urgent || rail.takenBefore))}>
      <p class="cons__lede">{t('tower.byRail.lede')}</p>
      {rail ? (
        <>
          <p class="cons__lede">
            {t('tower.byRail.set', { terminal: rail.terminal.label })}
            {rail.expectedAt ? ` ${t('tower.byRail.expected', { when: utc(rail.expectedAt) })}` : ''}
          </p>
          {rail.leftPort ? (
            <p class="chint">{t('tower.byRail.leftPortAt', { when: utc(rail.leftPort.at), by: rail.leftPort.by })}</p>
          ) : canAct ? (
            <div class="twr-knobs__row">
              <label class="twr-knob cfield">
                <span class="cfield__label">{t('tower.byRail.f.leftPort')}</span>
                <input class="cinput" type="datetime-local" value={leftAt} onInput={(e) => setLeftAt((e.target as HTMLInputElement).value)} />
              </label>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || !utcIn(leftAt)} onClick={() => void act(() => calls.leftPort(utcIn(leftAt)!))}>{t('tower.byRail.recordLeftPort')}</button>
              </div>
            </div>
          ) : null}
          {rail.arrival ? (
            <p class="chint">
              <span class="ctag ctag--ok">{t('tower.byRail.there')}</span> {t('tower.byRail.arrivedAt', { when: utc(rail.arrival.at), by: rail.arrival.by })}
              {rail.arrival.reference ? ` ${t('tower.byRail.notice', { reference: rail.arrival.reference })}` : ''}
            </p>
          ) : rail.roadWaits ? (
            <p class="chint"><span class="ctag ctag--warn">{t('tower.byRail.waits')}</span> {rail.roadWaits}</p>
          ) : (
            <p class="chint">{t('tower.byRail.noLegYet')}</p>
          )}
          {rail.takenBefore ? <p class="chint"><span class="ctag ctag--warn">{t('tower.byRail.takenBeforeTag')}</span> {t('tower.byRail.takenBefore')}</p> : null}
          {rail.collectAnyway ? (
            <p class="chint">{t('tower.byRail.anywaySaid', { by: rail.collectAnyway.by, when: utc(rail.collectAnyway.at), reason: rail.collectAnyway.reason })}</p>
          ) : null}
          <p class="chint">{clockLine}</p>

          {canAct && !rail.arrival ? (
            <div class="twr-knobs">
              <div class="twr-knobs__row">
                <label class="twr-knob cfield">
                  <span class="cfield__label">{t('tower.byRail.f.arrivedAt')}</span>
                  <input class="cinput" type="datetime-local" value={arrival.at} onInput={(e) => setArrival({ ...arrival, at: (e.target as HTMLInputElement).value })} />
                </label>
                <label class="twr-knob cfield">
                  <span class="cfield__label">{t('tower.byRail.f.notice')}</span>
                  <input class="cinput" maxLength={60} value={arrival.reference} onInput={(e) => setArrival({ ...arrival, reference: (e.target as HTMLInputElement).value })} />
                </label>
              </div>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || !utcIn(arrival.at)} onClick={() => void act(() => calls.arrived({ at: utcIn(arrival.at)!, ...(arrival.reference.trim() ? { reference: arrival.reference.trim() } : {}) }))}>
                  {t('tower.byRail.recordArrival')}
                </button>
              </div>
            </div>
          ) : null}
          {youAre === 'importer' && !rail.arrival && !rail.collectAnyway ? (
            <div class="twr-knobs">
              <label class="twr-knob cfield">
                <span class="cfield__label">{t('tower.byRail.f.anyway')}</span>
                <span class="chint">{t('tower.byRail.anywayHint')}</span>
                <input class="cinput" maxLength={300} value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
              </label>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || reason.trim().length < 5} onClick={() => void act(() => calls.collectAnyway(reason.trim()))}>
                  {t('tower.byRail.sendAnyway')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {canAct && rail && !rail.arrival && !changing ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setChanging(true)}>{t('tower.byRail.changeTitle')}</button>
        </div>
      ) : null}
      {canAct && !rail?.arrival && (!rail || changing) ? (
        <div class="twr-knobs">
          <p class="cfield__label">{t(rail ? 'tower.byRail.changeTitle' : 'tower.byRail.setTitle')}</p>
          <SitePicker kind="clearance" entityId={entityId} api={api as never} value={form.site} onChange={(site) => setForm({ ...form, site })} label={t('tower.byRail.f.terminal')} addLabel={t('tower.sites.addPort')} />
          <div class="twr-knobs__row">
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.byRail.f.expected')}</span>
              <input class="cinput" type="datetime-local" value={form.expected} onInput={(e) => setForm({ ...form, expected: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.byRail.f.freeDays')}</span>
              <input class="cinput" type="number" min={0} max={60} value={form.freeDays} onInput={(e) => setForm({ ...form, freeDays: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--ghost cbtn--sm"
              disabled={busy || !form.site}
              onClick={() => void act(() => calls.set({ terminalSiteId: form.site, ...(utcIn(form.expected) ? { expectedAt: utcIn(form.expected)! } : {}), ...(form.freeDays.trim() ? { freeDays: Number(form.freeDays) } : {}) }))}
            >
              {t('tower.byRail.save')}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
    </ConsoleFold>
  );
}
