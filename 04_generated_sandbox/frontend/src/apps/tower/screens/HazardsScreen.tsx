import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { mapsSearchUrl } from '../../../shared/maps';
import {
  CLEAR_REASON_MAX,
  canClear,
  isLongWait,
  kindLabel,
  KIND_EFFECT,
  measureLabel,
  pointLabel,
  waitLabel,
  type ConstraintView,
} from '../logic';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * The disputed-hazard queue — the one screen that can take a warning off every driver's map.
 *
 * Three things this screen has to keep saying, because all three are counter-intuitive and all three are
 * the point of the feature:
 *
 *   1. Everything in this list is STILL WARNING everybody. A dispute is not a removal. The caveat at the
 *      top is not dismissible for that reason.
 *   2. Clearing is not deleting. The record survives with a name and a reason on it, and a driver who
 *      meets the hazard again reports it afresh.
 *   3. An empty queue is not a clean map. It only means nobody is currently arguing with it.
 */
export function HazardsScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.hazards;
  const now = Date.now();

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.hazards.title')}</h1>
        <p class="cons__lede">{t('tower.hazards.lede')}</p>
      </header>

      <p class="cons__caveat">
        <Icon name="warning" size={18} />
        <span>
          <b>{t('tower.hazards.caveatLead')}</b> {t('tower.hazards.caveat')}
        </span>
      </p>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.hazards.count', { n: rows?.length ?? 0 })}</span>
          <span class="twr-panelend">
            {state.readAt ? (
              <span class="ctbl__sub">{t('tower.hazards.updatedAt', { time: new Date(state.readAt).toLocaleTimeString() })}</span>
            ) : null}
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void actions.refresh()} disabled={state.loading}>
              <Icon name="refresh" size={16} />
              {t('tower.hazards.refresh')}
            </button>
          </span>
        </div>

        {state.done ? (
          <p class="twr-done">
            <Icon name="check" size={16} />
            {state.done}
          </p>
        ) : null}

        {state.error ? (
          <p class="cerr" style="margin:12px 16px">
            <b>{t('tower.hazards.failedTitle')}</b> — {state.error.detail || state.error.title}
          </p>
        ) : null}

        {rows === null ? (
          <p class="cons__empty">{t('tower.hazards.loading')}</p>
        ) : rows.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.hazards.emptyTitle')}</p>
            <p>{t('tower.hazards.emptyBody')}</p>
          </div>
        ) : (
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.hazards.col.hazard')}</th>
                <th class="ctbl__num">{t('tower.hazards.col.measure')}</th>
                <th>{t('tower.hazards.col.where')}</th>
                <th>{t('tower.hazards.col.evidence')}</th>
                <th>{t('tower.hazards.col.waiting')}</th>
                <th aria-label={t('tower.hazards.clear')} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <HazardRow key={row.constraintId} row={row} now={now} state={state} actions={actions} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function HazardRow({ row, now, state, actions }: { row: ConstraintView; now: number; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const open = state.openId === row.constraintId;
  const name = kindLabel(row.kind, t);
  // A place an operator wants to LOOK at, not drive to — a search pin, not turn-by-turn directions.
  const href = mapsSearchUrl(row.at);

  return (
    <>
      <tr class={open ? 'is-open' : undefined}>
        <td>
          <div class="ctbl__strong">{name}</div>
          <div class="ctbl__sub">
            {KIND_EFFECT[row.kind] === 'blocks' ? t('tower.hazards.blocks') : t('tower.hazards.advisory')}
          </div>
        </td>
        <td class="ctbl__num">{measureLabel(row, t)}</td>
        <td>
          <div class="ctbl__mono">{pointLabel(row.at)}</div>
          {href ? (
            <a class="twr-link" href={href} target="_blank" rel="noopener noreferrer">
              {t('tower.hazards.openMap')}
            </a>
          ) : null}
        </td>
        <td>
          <div>{t('tower.hazards.evidence', { confirmations: row.confirmations, refutations: row.refutations })}</div>
          <div class="ctbl__sub">{t('tower.hazards.reportedAt', { date: new Date(row.reportedAt).toLocaleDateString() })}</div>
          {row.note ? (
            <div class="ctbl__sub">
              <b>{t('tower.hazards.noteLabel')}:</b> {row.note}
            </div>
          ) : null}
        </td>
        <td>
          <div>{waitLabel(row, now, t)}</div>
          {isLongWait(row, now) ? <span class="ctag ctag--warn">{t('tower.hazards.longWait')}</span> : null}
        </td>
        <td class="ctbl__num">
          <button
            type="button"
            class="cbtn cbtn--ghost cbtn--sm"
            aria-expanded={open}
            onClick={() => actions.open(open ? null : row.constraintId)}
          >
            {open ? t('tower.hazards.cancel') : t('tower.hazards.clear')}
          </button>
        </td>
      </tr>
      {open ? (
        <tr class="is-open ctbl__editor">
          <td colSpan={6}>
            <ClearForm row={row} hazard={name} state={state} actions={actions} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * The clearance itself. One step, and the REASON is the confirmation.
 *
 * No "are you sure?" over the top of it: the field that has to be filled in is already a deliberate act,
 * and a second dialog only teaches people to click through both. What the form owes the operator instead
 * is an accurate description of what is about to happen — including that this is kept, not deleted.
 */
function ClearForm({ row, hazard, state, actions }: { row: ConstraintView; hazard: string; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const busy = state.busyId === row.constraintId;
  const ready = canClear(reason);

  return (
    <div class="twr-clear">
      <p class="twr-clear__t">{t('tower.hazards.clearTitle')}</p>
      <p class="twr-clear__b">{t('tower.hazards.clearBody')}</p>

      <label class="cfield">
        <span class="cfield__label">{t('tower.hazards.reason')}</span>
        <textarea
          class="ctextarea"
          value={reason}
          maxLength={CLEAR_REASON_MAX}
          placeholder={t('tower.hazards.reasonPlaceholder')}
          onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)}
        />
        <span class="chint">{t('tower.hazards.reasonHint')}</span>
      </label>

      {state.clearError ? (
        <p class="cerr">
          <b>{t('tower.hazards.clearFailed')}</b> — {state.clearError.detail || state.clearError.title}
        </p>
      ) : null}

      <div class="twr-clear__act">
        <button
          type="button"
          class="cbtn cbtn--danger"
          disabled={!ready || busy}
          onClick={() => void actions.clear(row.constraintId, reason, hazard)}
        >
          {t('tower.hazards.confirm')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={() => actions.open(null)} disabled={busy}>
          {t('tower.hazards.cancel')}
        </button>
        {!ready ? <span class="chint">{t('tower.hazards.reasonNeeded')}</span> : null}
      </div>
    </div>
  );
}
