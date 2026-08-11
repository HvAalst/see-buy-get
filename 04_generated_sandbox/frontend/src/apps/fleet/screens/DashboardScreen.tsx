import { Card, ErrorNote, Icon, Pill, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { dashboardSummary, hoursLabel, projectPositions } from '../logic';
import type { FleetActions, FleetState } from '../useFleetApp';

export interface DashboardScreenProps {
  state: FleetState;
  actions: FleetActions;
}

/** The live fleet: counts, GPS positions, working hours and cargo in motion. */
export function DashboardScreen({ state, actions }: DashboardScreenProps) {
  const t = useT();
  const d = state.dashboard;
  const points = projectPositions(d?.positions ?? []);
  const sessions = d?.sessions.list ?? [];
  const cargo = d?.cargo.items ?? [];

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <div class="tiles tiles--5">
        <Tile value={`${d?.vehicles.active ?? 0}/${d?.vehicles.total ?? 0}`} label={t('fleet.dash.tileVehicles')} />
        <Tile value={`${d?.drivers.onShift ?? 0}/${d?.drivers.total ?? 0}`} label={t('fleet.dash.tileOnShift')} />
        <Tile value={String(d?.sessions.active ?? 0)} label={t('fleet.dash.tileSessions')} />
        <Tile value={`${d?.cargo.count ?? 0}·${d?.cargo.totalKg ?? 0}kg`} label={t('fleet.dash.tileCargo')} />
        <Tile value={hoursLabel(d?.sessions.todayHours)} label={t('fleet.dash.tileHours')} />
      </div>

      <Card title={t('fleet.dash.mapTitle')} label={t('fleet.dash.mapLabel')}>
        <p class="card__note">{t('fleet.dash.mapNote')}</p>
        <div
          class="fmap"
          role="img"
          aria-label={points.length === 1 ? t('fleet.dash.mapAriaOne', { count: points.length }) : t('fleet.dash.mapAriaMany', { count: points.length })}
        >
          {points.length === 0 ? (
            <p class="fmap__empty">{t('fleet.dash.mapEmpty')}</p>
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

      <Card title={t('fleet.dash.hoursTitle')}>
        {sessions.length === 0 ? (
          <p class="hint">{t('fleet.dash.noDrivers')}</p>
        ) : (
          <div class="rows" role="list">
            {sessions.map((s) => (
              <div key={`${s.plate}:${s.driverName}`} class="row row--static" role="listitem">
                <span class="row__ic">
                  <Icon name="person" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t">{s.driverName}</span>
                  <span class="row__s">{t('fleet.dash.onDutyRow', { plate: s.plate, cls: s.vehicleClass, hours: hoursLabel(s.hoursOnDuty) })}</span>
                </span>
                <span class="row__end">
                  <Pill tone={s.location ? 'ok' : 'idle'} dot>
                    {s.location ? t('fleet.dash.located') : t('fleet.dash.noSignal')}
                  </Pill>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={t('fleet.dash.cargoTitle')}>
        {cargo.length === 0 ? (
          <p class="hint">{t('fleet.dash.noCargo')}</p>
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
          text={() => (d ? dashboardSummary(d, t) : t('fleet.dash.aloudLoading'))}
          label={t('fleet.readAloud')}
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
