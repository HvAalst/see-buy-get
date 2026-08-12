import { useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Note, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { MIN_SHELF_SLOTS, SHELF_COLORS, gridDims } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';

export interface ShelfScreenProps {
  state: AgentState;
  actions: AgentActions;
}

const MAX_ROWS = 30;
const MAX_COLS = SHELF_COLORS.length; // one distinct colour per column — beyond this they repeat

/**
 * The pickup shelf, set up by the shop itself. The backend already models the grid (rows × colour columns →
 * "Green-3" slots) and hands parcels to the first free slot; this screen is the missing agent-facing half:
 * see the current shelf with what's on it, change the number of rows/columns, and save. Shrinking is blocked
 * while it would strand a parcel on a slot being removed — the server has no such guard, so the client holds it.
 */
export function ShelfScreen({ state, actions }: ShelfScreenProps) {
  const t = useT();
  const grid = state.shelf;

  useEffect(() => {
    if (state.shelfState === 'idle') void actions.loadShelf();
  }, [state.shelfState, actions]);

  const cur = gridDims(grid?.grid);
  const [rows, setRows] = useState<number | null>(null);
  const [cols, setCols] = useState<number | null>(null);
  // Adopt the server's current dimensions once the grid lands (and only then — never clobber a live edit).
  useEffect(() => {
    if (cur && rows === null) {
      setRows(cur.rows);
      setCols(cur.cols);
    }
  }, [cur, rows]);

  if (!grid && state.shelfState === 'loading') return <div class="scr"><p class="hint">{t('agent.shelf.loading')}</p></div>;
  if (!grid && state.shelfState === 'error' && state.error) return <div class="scr"><ErrorNote error={state.error} onRetry={() => void actions.loadShelf()} /></div>;
  if (!grid) return <div class="scr" />;

  const r = rows ?? cur?.rows ?? 4;
  const c = cols ?? cur?.cols ?? 5;
  const occupied = grid.grid.filter((s) => s.occupiedBy);
  const orphan = occupied.filter((s) => s.row > r || s.col > c); // slots that would be removed while still holding a parcel
  const total = r * c;
  const free = total - (occupied.length - orphan.length);
  const belowMin = total < MIN_SHELF_SLOTS;
  const changed = !cur || r !== cur.rows || c !== cur.cols;
  const canSave = changed && !belowMin && orphan.length === 0;

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.shelf.title')}</h1>
      <p class="scr__lede">{t('agent.shelf.lede')}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
        <Stepper id="shelf-rows" label={t('agent.shelf.rows')} value={r} min={1} max={MAX_ROWS} onChange={setRows} />
        <Stepper id="shelf-cols" label={t('agent.shelf.cols')} value={c} min={1} max={MAX_COLS} onChange={setCols} />
        <p class="card__note">{t('agent.shelf.freeOf', { free, total })}</p>
      </Card>

      <div class="shelfgrid" role="group" aria-label={t('agent.shelf.gridAria')}>
        {Array.from({ length: r }, (_, ri) => (
          <div class="shelfgrid__row" key={ri}>
            {Array.from({ length: c }, (_, ci) => {
              const color = SHELF_COLORS[ci % SHELF_COLORS.length];
              const label = `${color}-${ri + 1}`;
              const taken = occupied.some((s) => s.row === ri + 1 && s.col === ci + 1);
              return (
                <span
                  key={ci}
                  class={`shelfcell shelfcell--${color.toLowerCase()}${taken ? ' shelfcell--taken' : ''}`}
                  aria-label={taken ? t('agent.shelf.slotTakenAria', { label }) : t('agent.shelf.slotFreeAria', { label })}
                >
                  {ri + 1}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <div class="shelflegend" aria-hidden="true">
        <span class="shelflegend__item"><span class="shelfcell shelfcell--legendfree" /> {t('agent.shelf.legendFree')}</span>
        <span class="shelflegend__item"><span class="shelfcell shelfcell--taken" /> {t('agent.shelf.legendTaken')}</span>
      </div>

      {belowMin ? <Note tone="warn" icon="warning" title={t('agent.shelf.minSlots', { min: MIN_SHELF_SLOTS })} /> : null}
      {orphan.length ? (
        <Note tone="warn" icon="warning" title={orphan.length === 1 ? t('agent.shelf.orphanOne', { count: orphan.length }) : t('agent.shelf.orphanMany', { count: orphan.length })} />
      ) : null}

      <div class="scr__cta">
        <Button busy={state.busy === 'shelf'} disabled={!canSave} onClick={() => void actions.saveShelf(r, c)}>
          {t('agent.shelf.save')}
        </Button>
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => t('agent.shelf.aloud', { total, free })} label={t('agent.readAloud')} />
      </div>
    </div>
  );
}

function Stepper({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const t = useT();
  return (
    <div class="stepper">
      <span class="stepper__label" id={`${id}-l`}>{label}</span>
      <div class="stepper__ctrl" role="group" aria-labelledby={`${id}-l`}>
        <button type="button" class="stepper__btn" aria-label={t('agent.shelf.decrease')} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
        <span class="stepper__val" aria-live="polite">{value}</span>
        <button type="button" class="stepper__btn" aria-label={t('agent.shelf.increase')} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
      </div>
    </div>
  );
}
