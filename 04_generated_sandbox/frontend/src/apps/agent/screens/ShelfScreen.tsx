import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Note, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { DEFAULT_BAG_BAYS, MAX_BAG_BAYS, MIN_SHELF_SLOTS, SHELF_COLORS, gridDims } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';

export interface ShelfScreenProps {
  state: AgentState;
  actions: AgentActions;
}

const MAX_ROWS = 30;
const MAX_COLS = SHELF_COLORS.length; // one distinct colour per column — beyond this they repeat

/**
 * The pickup shelf, set up by the shop itself. The backend models the grid (rows × colour columns →
 * "Green-3" slots) and hands parcels to the first free slot; this screen is the agent-facing half: see the
 * current shelf with what's on it, size it, and mark BUNDLE slots — slots that pool small parcels (letters,
 * envelopes) instead of each burning a whole slot. Shrinking is blocked while it would strand a parcel;
 * a slot's type can only change while it is empty (so pooled parcels are never orphaned).
 */
export function ShelfScreen({ state, actions }: ShelfScreenProps) {
  const t = useT();
  const grid = state.shelf;

  useEffect(() => {
    if (state.shelfState === 'idle') void actions.loadShelf();
  }, [state.shelfState, actions]);

  const cur = gridDims(grid?.grid);
  const loadedBundles = useMemo(() => (grid?.grid ?? []).filter((s) => s.consolidation).map((s) => s.label), [grid]);

  const [rows, setRows] = useState<number | null>(null);
  const [cols, setCols] = useState<number | null>(null);
  const [bundles, setBundles] = useState<Set<string>>(new Set());
  // Adopt the server's current dimensions + bundle slots once the grid lands (never clobber a live edit).
  useEffect(() => {
    if (cur && rows === null) {
      setRows(cur.rows);
      setCols(cur.cols);
      setBundles(new Set(loadedBundles));
    }
  }, [cur, rows, loadedBundles]);

  if (!grid && state.shelfState === 'loading') return <div class="scr"><p class="hint">{t('agent.shelf.loading')}</p></div>;
  if (!grid && state.shelfState === 'error' && state.shelfError) return <div class="scr"><ErrorNote error={state.shelfError} onRetry={() => void actions.loadShelf()} /></div>;
  if (!grid) return <div class="scr" />;

  const r = rows ?? cur?.rows ?? 4;
  const c = cols ?? cur?.cols ?? 5;

  // Occupancy from the server grid: a normal slot's occupiedBy, or a bundle slot's pooled items.
  const occAt = (row: number, col: number) => grid.grid.find((s) => s.row === row && s.col === col);
  const itemCount = (s?: { occupiedBy?: string; items?: string[] }) => (s?.items ? s.items.length : s?.occupiedBy ? 1 : 0);
  const occupied = grid.grid.filter((s) => itemCount(s) > 0);
  const orphan = occupied.filter((s) => s.row > r || s.col > c); // occupied slots the new dimensions would remove
  const total = r * c;
  const free = total - occupied.filter((s) => s.row <= r && s.col <= c).length;

  // The bundle labels inside the current dimensions — the save payload + the "changed" comparison.
  const bundlePayload: string[] = [];
  for (let ci = 0; ci < c; ci += 1) {
    const color = SHELF_COLORS[ci % SHELF_COLORS.length];
    for (let ri = 1; ri <= r; ri += 1) {
      const label = `${color}-${ri}`;
      if (bundles.has(label)) bundlePayload.push(label);
    }
  }

  const belowMin = total < MIN_SHELF_SLOTS;
  const dimsChanged = !cur || r !== cur.rows || c !== cur.cols;
  const bundlesChanged = bundlePayload.length !== loadedBundles.length || bundlePayload.some((l) => !loadedBundles.includes(l));
  const canSave = (dimsChanged || bundlesChanged) && !belowMin && orphan.length === 0;

  const toggleBundle = (label: string) =>
    setBundles((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

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
              const isBundle = bundles.has(label);
              const n = itemCount(occAt(ri + 1, ci + 1));
              const locked = n > 0; // a slot's type can only change while it is empty
              const aria = isBundle
                ? (n === 1 ? t('agent.shelf.slotBundleAriaOne', { label }) : t('agent.shelf.slotBundleAriaMany', { label, count: n }))
                : n > 0
                  ? t('agent.shelf.slotTakenAria', { label })
                  : t('agent.shelf.slotFreeAria', { label });
              return (
                <button
                  key={ci}
                  type="button"
                  class={`shelfcell shelfcell--${color.toLowerCase()}${isBundle ? ' shelfcell--bundle' : ''}${n > 0 ? ' shelfcell--taken' : ''}`}
                  aria-pressed={isBundle}
                  disabled={locked}
                  aria-label={aria}
                  onClick={() => toggleBundle(label)}
                >
                  {ri + 1}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p class="card__note" style="margin-top:8px">{t('agent.shelf.bundleHint')}</p>

      <div class="shelflegend" aria-hidden="true">
        <span class="shelflegend__item"><span class="shelfcell shelfcell--legendfree" /> {t('agent.shelf.legendFree')}</span>
        <span class="shelflegend__item"><span class="shelfcell shelfcell--legendfree shelfcell--taken" /> {t('agent.shelf.legendTaken')}</span>
        <span class="shelflegend__item"><span class="shelfcell shelfcell--legendfree shelfcell--bundle" /> {t('agent.shelf.legendBundle')}</span>
      </div>

      {/* The other pile in the room. The shelf holds parcels waiting for a customer; these are the bags
          waiting for a bus, and until now nothing asked how many the shop could actually stand on its floor. */}
      <BagBays state={state} actions={actions} />

      {belowMin ? <Note tone="warn" icon="warning" title={t('agent.shelf.minSlots', { min: MIN_SHELF_SLOTS })} /> : null}
      {orphan.length ? (
        <Note tone="warn" icon="warning" title={orphan.length === 1 ? t('agent.shelf.orphanOne', { count: orphan.length }) : t('agent.shelf.orphanMany', { count: orphan.length })} />
      ) : null}

      <div class="scr__cta">
        <Button busy={state.busy === 'shelf'} disabled={!canSave} onClick={() => void actions.saveShelf(r, c, bundlePayload)}>
          {t('agent.shelf.save')}
        </Button>
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => t('agent.shelf.aloud', { total, free })} label={t('agent.readAloud')} />
      </div>
    </div>
  );
}

/**
 * Bag space — how many outbound bags this shop can stand on its floor at once.
 *
 * The same declaration as the shelf, for the other pile in the room: a kiosk has space for a couple, a
 * hardware store for plenty, and only the shopkeeper knows which they are. It matters because a bag is
 * refused once the floor is full, and because the bag plan then has to say WHICH destinations to pack
 * first rather than listing everything that is waiting.
 */
function BagBays({ state, actions }: ShelfScreenProps) {
  const t = useT();
  const current = state.agent?.bagBays ?? DEFAULT_BAG_BAYS;
  const [bays, setBays] = useState<number | null>(null);
  const n = bays ?? current;
  return (
    <Card label={t('agent.shelf.baysTitle')}>
      <Stepper id="bag-bays" label={t('agent.shelf.baysLabel')} value={n} min={1} max={MAX_BAG_BAYS} onChange={setBays} />
      <p class="card__note">{t('agent.shelf.baysNote')}</p>
      <Button variant="outline" chevron={false} busy={state.busy === 'bag-bays'} disabled={n === current} onClick={() => void actions.saveBagBays(n)}>
        {t('agent.shelf.baysSave')}
      </Button>
    </Card>
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
