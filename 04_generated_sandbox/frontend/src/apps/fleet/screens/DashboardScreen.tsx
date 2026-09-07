import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Icon, PlaceMap, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { dashboardSummary, hoursLabel, vehiclePins } from '../logic';
import type { FleetActions, FleetState } from '../useFleetApp';

export interface DashboardScreenProps {
  state: FleetState;
  actions: FleetActions;
}

/** The live fleet: counts, GPS positions, working hours and cargo in motion. */
export function DashboardScreen({ state, actions }: DashboardScreenProps) {
  const t = useT();
  const [bigMap, setBigMap] = useState(false);
  const d = state.dashboard;
  const pins = vehiclePins(d?.positions ?? []);
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

{/* A REAL map, and one that renders whether or not anything is on it.

          It used to be a bespoke dot-plot projected onto an abstract grid, which meant that with nothing
          reporting there was nothing to see — an empty grid says less than no map at all. A manager
          opening this app at six in the morning, before a single driver has started, should still see
          the place they operate in. The shared map handles that already: no pins simply means the
          operating area at city zoom, and it falls back to the plot when the tiles cannot load.

          Pins are INFO-ONLY — no onPick — because there is nothing to choose here. A tappable vehicle
          that did nothing would be a dead tap on every dot. */}
      <Card title={t('fleet.dash.mapTitle')} label={t('fleet.dash.mapLabel')}>
        <p class="card__note">{pins.length === 0 ? t('fleet.dash.mapNoneNote') : t('fleet.dash.mapNote')}</p>
        <PlaceMap
          pins={pins}
          label={pins.length === 1 ? t('fleet.dash.mapAriaOne', { count: pins.length }) : t('fleet.dash.mapAriaMany', { count: pins.length })}
        />
        {/* Its own control rather than a tap on the surface: the map underneath pans and zooms, and a
            surface that both moves under your finger and opens something is a surface that does the
            wrong one of those about half the time. */}
        <div style="margin-top:12px">
          <Button variant="outline" chevron={false} onClick={() => setBigMap(true)}>
            {t('fleet.dash.mapExpand')}
          </Button>
        </div>
      </Card>

      {/* Mounted only while open, so Leaflet initialises once and against a box that already has its
          real height — a map built inside a closed sheet comes up sized to nothing. */}
      <Sheet open={bigMap} onClose={() => setBigMap(false)} title={t('fleet.dash.mapTitle')}>
        {bigMap ? (
          <>
            <PlaceMap
              tall
              pins={pins}
              label={pins.length === 1 ? t('fleet.dash.mapAriaOne', { count: pins.length }) : t('fleet.dash.mapAriaMany', { count: pins.length })}
            />
            <p class="card__note">{pins.length === 0 ? t('fleet.dash.mapNoneNote') : t('fleet.dash.mapNote')}</p>
          </>
        ) : null}
      </Sheet>

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
