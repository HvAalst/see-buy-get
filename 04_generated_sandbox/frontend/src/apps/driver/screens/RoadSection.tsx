import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Icon, Note, Pill, Sheet, type IconName } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import { haversineKm } from '../../../shared/geo';
import { ROAD_KINDS, roadBlocks, roadMeasure, roadSummary, roadTone, roadValueLabel, type RoadKind } from '../logic';
import type { DriverActions, DriverState } from '../useDriverApp';
import type { RoadConstraint } from '../types';

/**
 * THE ROAD — the crowd-sourced constraint map, on the screen where a driver names the road they run.
 *
 * Nobody sells bridge clearances for these corridors, so the fleet that needs the map builds it: one tap
 * from the cab, the way a speed-camera app works. Two things on this surface are not cosmetic.
 *
 * FIRST, the caveat never leaves. "Nothing reported" is not "clear", and it is shown as its own line in
 * every state — including the empty one, which is exactly where a driver most wants to read it as a pass.
 *
 * SECOND, "it is gone" does not remove anything. It disputes the report and hands it to an operator, and
 * it goes on warning meanwhile; the row stays, at full weight, and says why. Being wrong about a bridge
 * that is still standing is the failure this whole feature is arranged around, so the screen must never
 * let a driver believe their tap took it off the map.
 */
export function RoadSection({ state, actions }: { state: DriverState; actions: DriverActions }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  // Read once when the section first appears, and never again on its own: this runs on a connection the
  // driver pays for by the megabyte, and the road does not change while they are looking at it.
  useEffect(() => {
    if (state.roadState === 'idle') void actions.loadRoad();
  }, [state.roadState, actions]);

  const items = state.road;
  const loading = state.roadState === 'loading';

  return (
    <Card>
      <h2 class="road__h">{t('driver.road.title')}</h2>
      <p class="card__note">{t('driver.road.lede')}</p>

      {state.roadState === 'error' ? (
        <>
          <Note tone="warn" icon="pin" title={t('driver.road.loadFailed')} detail={t('driver.toast.noLocationDetail')} />
          <Button variant="outline" onClick={() => void actions.loadRoad()}>
            {t('driver.road.retry')}
          </Button>
        </>
      ) : (
        <>
          <p class="road__sum" aria-live="polite">
            {loading ? t('driver.route.loadingPlaces') : roadSummary(items, t)}
          </p>
          <ul class="road__list">
            {items.map((c) => (
              <RoadRow key={c.constraintId} c={c} at={state.roadAt} busy={state.busy} actions={actions} t={t} />
            ))}
          </ul>
        </>
      )}

      {/* Shown in EVERY state, the empty one included. A list with nothing in it is the moment a driver is
          most likely to read silence as a clear road, so that is the moment the sentence matters most. */}
      <p class="road__caveat">
        <Icon name="info" size={18} />
        <span>{t('driver.road.caveat')}</span>
      </p>

      <Button variant="outline" onClick={() => setOpen(true)}>
        {t('driver.road.reportCta')}
      </Button>

      <ReportSheet open={open} onClose={() => setOpen(false)} state={state} actions={actions} />
    </Card>
  );
}

/** The glyph for each kind. Monoline set only — never an emoji, which does not carry at a glance in sun. */
const KIND_ICON: Record<RoadKind, IconName> = {
  LOW_BRIDGE: 'warning',
  HEIGHT_BARRIER: 'block',
  WEIGHT_LIMIT: 'scale',
  NO_HAZMAT: 'block',
  WASHOUT: 'warning',
  WEIGHBRIDGE: 'weight',
  FERRY: 'route',
  CHECKPOINT: 'badge',
};

function kindName(kind: string, t: Translate): string {
  return t(`driver.road.kind.${kind}` as never);
}

function RoadRow({
  c,
  at,
  busy,
  actions,
  t,
}: {
  c: RoadConstraint;
  at: { lat: number; lng: number } | null;
  busy: string | null;
  actions: DriverActions;
  t: Translate;
}) {
  const value = roadValueLabel(c, t);
  const km = at ? Math.round(haversineKm(at, c.at) * 10) / 10 : null;
  const mine = `road:${c.constraintId}`;

  return (
    <li class={`road__row road__row--${roadTone(c)}`}>
      <Icon name={KIND_ICON[c.kind as RoadKind] ?? 'info'} size={22} class="road__ic" />
      <div class="road__body">
        <p class="road__name">
          {kindName(c.kind, t)}
          {value ? ` · ${value}` : ''}
          {/* Advisories are marked as what they are. A ferry costs a haulier time, never the load, and a
              row that reads like a refusal teaches them to skim past the ones that are. */}
          {!roadBlocks(c.kind) ? <Pill tone="idle">{t('driver.road.advisory')}</Pill> : null}
        </p>
        {km != null ? <p class="road__meta">{t('driver.road.away', { km: String(km) })}</p> : null}
        {c.note ? <p class="road__meta">{c.note}</p> : null}
        {c.confirmations > 0 ? (
          <p class="road__meta">
            {c.confirmations === 1 ? t('driver.road.agreeOne') : t('driver.road.agreeCount', { count: c.confirmations })}
          </p>
        ) : null}
        {/* A disputed hazard keeps its danger tone and gains this line. It does NOT get softened: somebody
            saying a bridge is gone is not evidence that it is, and this is the state in which a driver
            must go on treating it as there. */}
        {c.status === 'disputed' ? (
          <p class="road__disputed">
            <Icon name="warning" size={16} /> {t('driver.road.disputed')}
          </p>
        ) : null}
        <div class="road__acts">
          <Button variant="outline" full={false} busy={busy === mine} onClick={() => void actions.answerRoad(c.constraintId, true)}>
            {t('driver.road.stillThere')}
          </Button>
          <Button variant="link" full={false} busy={busy === mine} onClick={() => void actions.answerRoad(c.constraintId, false)}>
            {t('driver.road.itsGone')}
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * The report itself: pick a thing, and where there is a number on a sign, give it.
 *
 * Two steps at most, and the second only for the three kinds that carry a measurement. The server refuses
 * "low bridge, unknown height" — an unmeasured limit cannot be checked against any load — so asking here
 * is the difference between one tap and a rejected form at a junction with a truck behind you.
 */
function ReportSheet({
  open,
  onClose,
  state,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  state: DriverState;
  actions: DriverActions;
}) {
  const t = useT();
  const [kind, setKind] = useState<RoadKind | null>(null);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');

  const close = () => {
    setKind(null);
    setValue('');
    setNote('');
    onClose();
  };

  const measure = kind ? roadMeasure(kind) : null;
  const busy = state.busy === 'report-road';

  const choose = (k: RoadKind) => {
    setKind(k);
    // Nothing to measure means nothing more to ask: the tap IS the report.
    if (roadMeasure(k) == null) void send(k, undefined);
  };

  const send = async (k: RoadKind, v: number | undefined) => {
    await actions.reportRoad(k, v, note);
    close();
  };

  const num = Number(value);
  // Tonnes on screen, kilograms on the wire — no weight sign anywhere is posted in kilograms.
  const wire = measure === 'weight_kg' ? num * 1000 : num;
  const ready = measure == null || (Number.isFinite(num) && num > 0);

  return (
    <Sheet open={open} onClose={close} title={kind && measure ? t('driver.road.valueTitle') : t('driver.road.sheetTitle')}>
      {kind && measure ? (
        <>
          <div class="field">
            <label class="field__label" for="road-value">
              {measure === 'height_m' ? t('driver.road.heightLabel') : t('driver.road.weightLabel')}
            </label>
            <input
              id="road-value"
              class="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              placeholder={measure === 'height_m' ? t('driver.road.heightPh') : t('driver.road.weightPh')}
              value={value}
              onInput={(e) => setValue(e.currentTarget.value)}
            />
          </div>
          <div class="field" style="margin-top:16px">
            <label class="field__label" for="road-note">
              {t('driver.road.noteLabel')}
            </label>
            <input id="road-note" class="input" type="text" placeholder={t('driver.road.notePh')} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
          </div>
          <Button disabled={!ready} busy={busy} onClick={() => void send(kind, wire)}>
            {t('driver.road.send')}
          </Button>
          <Button variant="link" onClick={() => setKind(null)}>
            {t('driver.road.back')}
          </Button>
        </>
      ) : (
        <>
          <p class="card__note">{t('driver.road.sheetLede')}</p>
          <div class="road__grid">
            {ROAD_KINDS.map((k) => (
              <button type="button" key={k} class={`road__pick${roadBlocks(k) ? ' road__pick--stop' : ''}`} disabled={busy} onClick={() => choose(k)}>
                <Icon name={KIND_ICON[k]} size={28} />
                <span>{kindName(k, t)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
