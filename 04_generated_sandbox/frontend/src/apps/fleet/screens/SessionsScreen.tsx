import { Button, Card, ErrorNote, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { freeDrivers, freeVehicles, shortDid } from '../logic';
import type { FleetActions, FleetState } from '../useFleetApp';

export interface SessionsScreenProps {
  state: FleetState;
  actions: FleetActions;
}

/**
 * Driver ↔ vehicle couplings. Drivers normally start a shift themselves by scanning the
 * dashboard QR; this screen couples on their behalf and ends sessions.
 */
export function SessionsScreen({ state, actions }: SessionsScreenProps) {
  const t = useT();
  const f = state.cForm;
  const drivers = freeDrivers(state.drivers, state.assignments);
  const vehicles = freeVehicles(state.vehicles, state.assignments);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

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
            {state.corridors.map((c) => (
              <option key={c.corridorId} value={c.corridorId}>
                {`${c.name} (${c.originZone} → ${c.destZone})`}
              </option>
            ))}
          </select>
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
              const c = state.corridors.find((x) => x.corridorId === a.corridorId);
              return (
                <div key={a.assignmentId} class="row row--static" role="listitem">
                  <span class="row__body">
                    <span class="row__t">{d?.displayName ?? shortDid(a.driverDid)}</span>
                    <span class="row__s">{`${v ? `${v.plate} · ${v.vehicleClass}` : shortDid(a.vehicleId)}${c ? ` · ${c.name}` : ''}`}</span>
                  </span>
                  <span class="row__end">
                    <Button variant="link" full={false} danger busy={state.busy === `uncouple:${a.driverDid}`} onClick={() => void actions.uncouple(a.driverDid)}>
                      {t('fleet.sessions.endSession')}
                    </Button>
                  </span>
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
