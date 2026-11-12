import { useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Pill, Sheet } from '../../../shared/ui';
import type { SbgError } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { nextWords, phoneZone, tripBodies, tripDaysWords, type SavedTrip, type TripEndInput } from '../trips';
import type { DriverActions, DriverState } from '../useDriverApp';

/** The phone's own date (YYYY-MM-DD). */
function todayHere(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 2026-11-12 — MY TRIPS (the owner: "much like an alarm … or several trips selecting the specific day and start time"): each
 * with its days, its time and when it next runs; on shift, "Go now" opens its loads. A driver's own are paused, skipped for a
 * day or deleted here; the ones their fleet set are only read.
 */
export function TripsCard({ state, actions, onShift }: { state: DriverState; actions: DriverActions; onShift: boolean }) {
  const t = useT();
  useEffect(() => {
    void actions.loadTrips();
  }, []);
  const trips = state.trips ?? [];
  const fleetDriver = Boolean(state.driver?.managerDid);
  if (state.trips === null) return null;
  const today = todayHere();
  return (
    <Card title={t('driver.trips.title')}>
      <p class="card__note">{t('driver.trips.lede')}</p>
      {trips.length === 0 ? <p class="card__note">{t(fleetDriver ? 'driver.trips.noneFleet' : 'driver.trips.none')}</p> : null}
      {trips.map((trip) => (
        <TripRow key={trip.tripId} trip={trip} actions={actions} onShift={onShift} today={today} busy={state.busy !== null} />
      ))}
    </Card>
  );
}

function TripRow({ trip, actions, onShift, today, busy }: { trip: SavedTrip; actions: DriverActions; onShift: boolean; today: string; busy: boolean }) {
  const t = useT();
  const next = nextWords(trip.next, today, t, 'driver.trips');
  return (
    <div class="trip-row" style="border-top:1px solid var(--bd);padding-top:12px;margin-top:12px">
      <p class="row__t">
        {trip.name ? `${trip.name} · ` : ''}
        {trip.from.label} → {trip.to.label}
      </p>
      <p class="card__note">
        {t('driver.trips.line', { time: trip.startTime, days: tripDaysWords(trip.days, t, 'driver.trips') })}
        {trip.paused ? ` · ${t('driver.trips.paused')}` : next ? ` · ${t('driver.trips.next', { when: next })}` : ''}
      </p>
      {trip.skips.length ? <p class="card__note">{t('driver.trips.skipped', { days: trip.skips.map((d) => String(Number(d.slice(8, 10)))).join(', ') })}</p> : null}
      {trip.mine ? null : <Pill tone="idle">{t('driver.trips.byFleet')}</Pill>}
      <div class="linkcol">
        {onShift ? (
          <Button variant="link" full={false} disabled={busy} onClick={() => void actions.goTrip(trip)}>
            {t('driver.trips.go')}
          </Button>
        ) : null}
        {trip.mine && trip.next && !trip.paused ? (
          <Button variant="link" full={false} disabled={busy} onClick={() => void actions.skipTrip(trip, trip.next!.day, true)}>
            {t('driver.trips.skipNext')}
          </Button>
        ) : null}
        {trip.mine && trip.skips.length ? (
          <Button variant="link" full={false} disabled={busy} onClick={() => void actions.skipTrip(trip, trip.skips[0], false)}>
            {t('driver.trips.unskip')}
          </Button>
        ) : null}
        {trip.mine ? (
          <Button variant="link" full={false} disabled={busy} onClick={() => void actions.pauseTrip(trip, !trip.paused)}>
            {t(trip.paused ? 'driver.trips.resume' : 'driver.trips.pause')}
          </Button>
        ) : null}
        {trip.mine ? (
          <Button variant="link" full={false} danger disabled={busy} onClick={() => void actions.removeTrip(trip)}>
            {t('driver.trips.delete')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** "Save this trip": the days (Sunday first), the time it leaves, and — given a time — the trip back on the same days. */
export function SaveTripSheet({ open, onClose, actions, from, to }: { open: boolean; onClose: () => void; actions: DriverActions; from: TripEndInput; to: TripEndInput }) {
  const t = useT();
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [time, setTime] = useState('05:30');
  const [back, setBack] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState(false);
  const bodies = tripBodies(from, to, days, time, back, phoneZone(), name);
  const toggle = (d: number) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  const save = async () => {
    if (!bodies) return;
    setBusy(true);
    const failed = await actions.saveTrips(bodies);
    setBusy(false);
    if (failed) return setError(failed);
    setError(null);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('driver.trips.sheetTitle')}>
      <p class="t-body">{t('driver.trips.sheetBody', { from: from.label, to: to.label })}</p>
      {error ? <ErrorNote error={error} /> : null}
      <div class="field">
        <span class="field__label">{t('driver.trips.days')}</span>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <Button key={d} variant={days.includes(d) ? 'primary' : 'outline'} full={false} chevron={false} onClick={() => toggle(d)}>
              {t(`driver.trips.day.${d}` as never)}
            </Button>
          ))}
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="trip-time">
          {t('driver.trips.time')}
        </label>
        <input id="trip-time" class="input" type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label class="field__label" for="trip-back">
          {t('driver.trips.back')}
        </label>
        <input id="trip-back" class="input" type="time" value={back} onInput={(e) => setBack(e.currentTarget.value)} />
        <p class="hint">{t('driver.trips.backHint', { from: from.label, to: to.label })}</p>
      </div>
      <div class="field">
        <label class="field__label" for="trip-name">
          {t('driver.trips.name')}
        </label>
        <input id="trip-name" class="input" maxLength={60} value={name} onInput={(e) => setName(e.currentTarget.value)} />
      </div>
      <Button chevron={false} busy={busy} disabled={!bodies} onClick={() => void save()}>
        {t('driver.trips.saveGo')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('driver.trips.keep')}
      </Button>
    </Sheet>
  );
}
