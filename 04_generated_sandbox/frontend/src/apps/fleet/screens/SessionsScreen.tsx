import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Pill, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { corridorState, freeDrivers, freeVehicles, overShiftLimit, shortDid, usableCorridors } from '../logic';
import type { AssignmentRow, CorridorRow } from '../types';
import type { FleetActions, FleetState } from '../useFleetApp';

export interface SessionsScreenProps {
  state: FleetState;
  actions: FleetActions;
}

/**
 * Driver ↔ vehicle couplings. Drivers normally start a shift themselves by scanning the
 * dashboard QR; this screen couples on their behalf and ends sessions.
 *
 * THE CORRIDOR IS THE FIELD THAT MISLED PEOPLE. It was labelled "(optional)", which is true when the
 * shift starts and false by the time that driver pulls up at a shop counter: the handover refuses
 * outright without a corridor, and it refuses on the SHOPKEEPER's screen, about something only a manager
 * can fix. So the field now says what leaving it empty COSTS, a shift already running can be put on a
 * corridor without ending it, and when the network has published none the screen says that rather than
 * offering an empty list a manager has no way to fill.
 */
export function SessionsScreen({ state, actions }: SessionsScreenProps) {
  const t = useT();
  const f = state.cForm;
  const drivers = freeDrivers(state.drivers, state.assignments);
  const vehicles = freeVehicles(state.vehicles, state.assignments);
  // Only live corridors this fleet may run are offered: the network's, and our own published lines. A blocked
  // one is still shown on a shift already on it — that is a warning — but never something to newly choose,
  // and neither is another fleet's line or our own proposal still waiting for the network.
  const live = usableCorridors(state.corridors, state.manager?.did);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} showDetail={state.error.code === 'CANNOT_COUPLE' || state.error.code === 'HOURS_EXCEEDED'} /> : null}

      <Card title={t('fleet.sessions.coupleTitle')}>
        <p class="card__note">{t('fleet.sessions.coupleNote')}</p>
        <div class="field">
          <label class="field__label" for="c-driver">
            {t('fleet.sessions.driver')}
          </label>
          <select id="c-driver" class="select" value={f.driverDid} onChange={(e) => actions.setCForm({ driverDid: e.currentTarget.value })}>
            <option value="">{t('fleet.sessions.pickDriver')}</option>
            {drivers.map((d) => (
              <option key={d.did} value={d.did}>
                {`${d.displayName} (${(d.licence?.classes ?? []).join('/') || t('fleet.sessions.anyClass')})`}
              </option>
            ))}
          </select>
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="c-vehicle">
            {t('fleet.sessions.vehicle')}
          </label>
          <select id="c-vehicle" class="select" value={f.vehicleId} onChange={(e) => actions.setCForm({ vehicleId: e.currentTarget.value })}>
            <option value="">{t('fleet.sessions.pickVehicle')}</option>
            {vehicles.map((v) => (
              <option key={v.vehicleId} value={v.vehicleId}>
                {`${v.plate} · ${v.vehicleClass} · ${v.capacityKg} kg`}
              </option>
            ))}
          </select>
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="c-corridor">
            {t('fleet.sessions.corridor')}
          </label>
          <select id="c-corridor" class="select" value={f.corridorId} onChange={(e) => actions.setCForm({ corridorId: e.currentTarget.value })}>
            <option value="">{t('fleet.sessions.noCorridor')}</option>
            {live.map((c) => (
              <option key={c.corridorId} value={c.corridorId}>
                {`${c.name} (${c.originZone} → ${c.destZone})`}
              </option>
            ))}
          </select>
          {/* What empty costs — or, when there is nothing to choose, why the list is empty. A manager
              cannot draw a corridor: the network publishes them, and it has published none. */}
          <p class="hint">{live.length ? t('fleet.sessions.corridorNote') : t('fleet.sessions.noCorridorsYet')}</p>
        </div>
        <div style="margin-top:14px">
          <Button chevron={false} onClick={() => void actions.couple()} disabled={!f.driverDid || !f.vehicleId} busy={state.busy === 'couple'}>
            {t('fleet.sessions.coupleCta')}
          </Button>
        </div>
      </Card>

      <Card title={t('fleet.sessions.onDutyTitle', { count: state.assignments.length })}>
        {state.assignments.length === 0 ? (
          <p class="hint">{t('fleet.sessions.noDrivers')}</p>
        ) : (
          <div class="rows" role="list">
            {state.assignments.map((a) => {
              const d = state.drivers.find((x) => x.did === a.driverDid);
              const v = state.vehicles.find((x) => x.vehicleId === a.vehicleId);
              return (
                <div key={a.assignmentId} class="sess" role="listitem">
                  <div class="row row--static">
                    <span class="row__body">
                      <span class="row__t">{d?.displayName ?? shortDid(a.driverDid)}</span>
                      <span class="row__s">{v ? `${v.plate} · ${v.vehicleClass}` : shortDid(a.vehicleId)}</span>
                      <span class="row__meta">
                        <CorridorTag assignment={a} corridors={state.corridors} />
                        {/* FP8 — the office's own clock on the shift, against the server's limit. */}
                        {overShiftLimit(a.startedAt, state.dashboard?.hours?.limit) ? <Pill tone="danger">{t('fleet.sessions.overLimit')}</Pill> : null}
                      </span>
                    </span>
                    <span class="row__end">
                      {/* FP5 — from the shift to the market: this driver, this vehicle, what they could take. */}
                      <Button variant="link" full={false} onClick={() => actions.openDispatch(a.driverDid)}>
                        {t('fleet.dispatch.findLoad')}
                      </Button>
                      <Button variant="link" full={false} danger busy={state.busy === `uncouple:${a.driverDid}`} onClick={() => void actions.uncouple(a.driverDid)}>
                        {t('fleet.sessions.endSession')}
                      </Button>
                    </span>
                  </div>
                  <CorridorPicker assignment={a} corridors={live} state={state} actions={actions} />
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div class="scr__foot">
        <ReadAloud
          text={() => t('fleet.sessions.aloud', { sessions: state.assignments.length, drivers: drivers.length, vehicles: vehicles.length })}
          label={t('fleet.readAloud')}
        />
      </div>
    </div>
  );
}

/** The corridor a running shift is on — as a state, never as a blank. */
function CorridorTag({ assignment, corridors }: { assignment: AssignmentRow; corridors: CorridorRow[] }) {
  const t = useT();
  const st = corridorState(assignment, corridors);
  // Not "no corridor" — what having none MEANS for this driver's day.
  if (st.kind === 'none') return <Pill tone="warn">{t('fleet.sessions.noCorridorWarn')}</Pill>;
  if (st.kind === 'blocked') return <Pill tone="warn">{t('fleet.sessions.corridorBlocked', { name: st.name })}</Pill>;
  if (st.kind === 'gone') return <Pill tone="warn">{t('fleet.sessions.corridorGone', { name: st.name })}</Pill>;
  return <Pill tone="ok">{st.name}</Pill>;
}

/**
 * Put this shift on a corridor, or move it to another one — without ending the shift.
 *
 * Two steps on purpose, pick then press: a select that acted on change would let one mis-tap move a
 * driver onto a different bus route in the middle of their day. Ending and re-coupling was the only
 * repair before this, and it costs the driver everything that lives on the coupling — their snooze,
 * their declared road, the work they have already claimed.
 */
function CorridorPicker({
  assignment,
  corridors,
  state,
  actions,
}: {
  assignment: AssignmentRow;
  corridors: CorridorRow[];
  state: FleetState;
  actions: FleetActions;
}) {
  const t = useT();
  const [pick, setPick] = useState('');
  // Nothing to choose from is not a control, it is a dead select. The couple form above says why.
  if (corridors.length === 0) return null;

  const chosen = pick || assignment.corridorId || '';
  const unchanged = chosen === (assignment.corridorId ?? '');
  const id = `sess-cor-${assignment.assignmentId}`;

  return (
    <div class="sess__cor">
      <label class="sr-only" for={id}>
        {t('fleet.sessions.putOnCorridor')}
      </label>
      <select id={id} class="select" value={chosen} onChange={(e) => setPick(e.currentTarget.value)}>
        <option value="">{t('fleet.sessions.putOnCorridor')}</option>
        {corridors.map((c) => (
          <option key={c.corridorId} value={c.corridorId}>
            {`${c.name} (${c.originZone} → ${c.destZone})`}
          </option>
        ))}
      </select>
      <Button
        chevron={false}
        full={false}
        variant="outline"
        disabled={unchanged || !chosen}
        busy={state.busy === `corridor:${assignment.driverDid}`}
        onClick={() => void actions.assignCorridor(assignment.driverDid, chosen)}
      >
        {t('fleet.sessions.setCorridor')}
      </Button>
    </div>
  );
}
