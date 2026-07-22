import { Card, ErrorNote, Icon, Pill, ReadAloud } from '../../../shared/ui';
import { dashboardSummary, hoursLabel, projectPositions } from '../logic';
import type { FleetActions, FleetState } from '../useFleetApp';

export interface DashboardScreenProps {
  state: FleetState;
  actions: FleetActions;
}

/** The live fleet: counts, GPS positions, working hours and cargo in motion. */
export function DashboardScreen({ state, actions }: DashboardScreenProps) {
  const d = state.dashboard;
  const points = projectPositions(d?.positions ?? []);
  const sessions = d?.sessions.list ?? [];
  const cargo = d?.cargo.items ?? [];

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <div class="tiles tiles--5">
        <Tile value={`${d?.vehicles.active ?? 0}/${d?.vehicles.total ?? 0}`} label="Vehicles active" />
        <Tile value={`${d?.drivers.onShift ?? 0}/${d?.drivers.total ?? 0}`} label="On shift" />
        <Tile value={String(d?.sessions.active ?? 0)} label="Sessions" />
        <Tile value={`${d?.cargo.count ?? 0}·${d?.cargo.totalKg ?? 0}kg`} label="Cargo moving" />
        <Tile value={hoursLabel(d?.sessions.todayHours)} label="Hours today" />
      </div>

      <Card title="Where your vehicles are" label="Live GPS">
        <p class="card__note">Vehicles on shift that reported a position — drivers ping when they look for work.</p>
        <div class="fmap" role="img" aria-label={`${points.length} vehicle${points.length === 1 ? '' : 's'} reporting a position`}>
          {points.length === 0 ? (
            <p class="fmap__empty">No vehicle is reporting a position.</p>
          ) : (
            points.map((p) => (
              <span key={p.plate} class="fmap__pt" style={`left:${p.x}%;top:${p.y}%`} title={p.title}>
                <span class="fmap__dot" />
                <span class="fmap__lbl mono">{p.plate}</span>
              </span>
            ))
          )}
        </div>
      </Card>

      <Card title="Working hours — on shift now">
        {sessions.length === 0 ? (
          <p class="hint">No drivers on shift.</p>
        ) : (
          <div class="rows" role="list">
            {sessions.map((s) => (
              <div key={`${s.plate}:${s.driverName}`} class="row row--static" role="listitem">
                <span class="row__ic">
                  <Icon name="person" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t">{s.driverName}</span>
                  <span class="row__s">{`${s.plate} · ${s.vehicleClass} · on duty ${hoursLabel(s.hoursOnDuty)}`}</span>
                </span>
                <span class="row__end">
                  <Pill tone={s.location ? 'ok' : 'idle'} dot>
                    {s.location ? 'Located' : 'No signal'}
                  </Pill>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Cargo in motion">
        {cargo.length === 0 ? (
          <p class="hint">No cargo claimed right now.</p>
        ) : (
          <div>
            {cargo.map((c) => (
              <div key={c.ref} class="kv">
                <span>
                  <span class="mono">{c.ref}</span>
                  {` · ${c.weightKg} kg → ${c.destLabel}`}
                </span>
                <b>{c.driver}</b>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div class="scr__foot">
        <ReadAloud
          text={() => (d ? dashboardSummary(d) : 'The dashboard is still loading.')}
          label="Read this aloud"
        />
      </div>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div class="tile">
      <span class="tile__v tile__v--sm">{value}</span>
      <span class="tile__l">{label}</span>
    </div>
  );
}
