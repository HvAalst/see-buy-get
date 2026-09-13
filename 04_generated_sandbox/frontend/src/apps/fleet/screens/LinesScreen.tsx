import { Button, Card, ErrorNote, Pill, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { lineBlocker, lineZones, ownLines } from '../logic';
import type { FleetActions, FleetState } from '../useFleetApp';

/**
 * F1 — THE FLEET'S OWN LINES.
 *
 * A manager could only ever choose among the corridors the network drew, which is right for the network's
 * buses and wrong for a fleet that runs its own road every day. In a country where the network only MATCHES,
 * that fleet IS the local operator, and without a way to put its routes on the map there is nothing to match.
 *
 * So a fleet proposes; the network publishes. The status is said plainly, because a line that is "saved" and
 * a line that routes parcels are different facts, and a manager who confuses them sends a driver to a counter
 * that will refuse the handover.
 */
export function LinesScreen({ state, actions }: { state: FleetState; actions: FleetActions }) {
  const t = useT();
  const mine = ownLines(state.corridors, state.manager?.did);
  const waiting = mine.filter((c) => c.status === 'proposed').length;
  const f = state.lForm;
  const blocker = lineBlocker(f, state.corridors);
  const zones = lineZones(state.corridors);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('fleet.lines.title')}</h1>
      <p class="scr__lede">{t('fleet.lines.lede')}</p>

      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <Card>
        {mine.length === 0 ? (
          <p class="hint">{t('fleet.lines.none')}</p>
        ) : (
          <div class="rows" role="list">
            {mine.map((c) => (
              <div key={c.corridorId} class="row row--static" role="listitem">
                <span class="row__body">
                  <span class="row__t">{c.name}</span>
                  <span class="row__s">{`${c.originZone} → ${c.destZone}${c.schedule ? ` · ${c.schedule}` : ''}`}</span>
                </span>
                <span class="row__end">
                  {c.status === 'proposed' ? (
                    <Pill tone="info">{t('fleet.lines.proposed')}</Pill>
                  ) : c.status === 'blocked' ? (
                    <Pill tone="warn">{t('fleet.lines.blocked')}</Pill>
                  ) : (
                    <Pill tone="ok">{t('fleet.lines.active')}</Pill>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={t('fleet.lines.newTitle')}>
        <div class="field">
          <label class="field__label" for="l-origin">
            {t('fleet.lines.origin')}
          </label>
          <input id="l-origin" class="input" list="l-zones" value={f.originZone} onInput={(e) => actions.setLForm({ originZone: e.currentTarget.value })} />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="l-dest">
            {t('fleet.lines.dest')}
          </label>
          <input id="l-dest" class="input" list="l-zones" value={f.destZone} onInput={(e) => actions.setLForm({ destZone: e.currentTarget.value })} />
        </div>
        {/* Suggestions, never a closed list: a fleet's first line may run into a zone nobody has drawn yet. */}
        <datalist id="l-zones">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="l-name">
            {t('fleet.lines.name')}
          </label>
          <input
            id="l-name"
            class="input"
            value={f.name}
            placeholder={f.originZone && f.destZone ? `${f.originZone} → ${f.destZone}` : ''}
            onInput={(e) => actions.setLForm({ name: e.currentTarget.value })}
          />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="l-vehicle">
            {t('fleet.lines.vehicle')}
          </label>
          <select id="l-vehicle" class="select" value={f.vehicleType} onChange={(e) => actions.setLForm({ vehicleType: e.currentTarget.value === 'truck' ? 'truck' : 'bus' })}>
            <option value="bus">{t('fleet.lines.bus')}</option>
            <option value="truck">{t('fleet.lines.truck')}</option>
          </select>
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="l-schedule">
            {t('fleet.lines.schedule')}
          </label>
          <input id="l-schedule" class="input" value={f.schedule} placeholder={t('fleet.lines.schedulePh')} onInput={(e) => actions.setLForm({ schedule: e.currentTarget.value })} />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="l-note">
            {t('fleet.lines.note')}
          </label>
          <input id="l-note" class="input" value={f.note} onInput={(e) => actions.setLForm({ note: e.currentTarget.value })} />
          <p class="hint">{t('fleet.lines.noteHint')}</p>
        </div>
        <div style="margin-top:14px">
          <Button chevron={false} onClick={() => void actions.proposeLine()} disabled={blocker !== null} busy={state.busy === 'line'}>
            {t('fleet.lines.cta')}
          </Button>
          {blocker ? <p class="hint" style="margin-top:8px">{t(blocker)}</p> : null}
        </div>
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => t('fleet.lines.aloud', { count: mine.length, waiting })} label={t('fleet.readAloud')} />
      </div>
    </div>
  );
}
