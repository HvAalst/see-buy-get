import { useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, PlacePicker, type PlaceNote } from '../../../shared/ui';
import type { SbgError } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { nextWords, tripDaysWords, type SavedTrip } from '../../driver/trips';
import { ownLines } from '../logic';
import type { FleetActions, FleetState } from '../useFleetApp';

type Pin = { lat: number; lng: number } | null;

/** The phone's own date (YYYY-MM-DD). */
function todayHere(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * What the fleet's form sends: the trip for its driver, in its vehicle, on chosen days at a time — and, selling space on one of
 * its lines, how much and at what price (each run posted a week ahead). With a time back, the trip back on the same days.
 * Nothing until complete.
 */
export function fleetTripBodies(f: { driverDid: string; vehicleId: string; from: { label: string; pin: Pin }; to: { label: string; pin: Pin }; days: number[]; time: string; back: string; sell: boolean; corridorId: string; capacityKg: string; basis: string; amount: string }): Array<Record<string, unknown>> | null {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!f.driverDid || !f.from.pin || !f.to.pin || !f.from.label.trim() || !f.to.label.trim() || !f.days.length || !time.test(f.time) || (f.back && !time.test(f.back))) return null;
  const num = (s: string) => Number(s.trim().replace(',', '.'));
  let sell: Record<string, unknown> | undefined;
  if (f.sell) {
    if (!f.vehicleId || !f.corridorId || !(num(f.amount) > 0) || !['per_trip', 'per_km', 'per_kg'].includes(f.basis)) return null;
    sell = { corridorId: f.corridorId, basis: f.basis, amount: num(f.amount), ...(num(f.capacityKg) > 0 ? { capacityKg: num(f.capacityKg) } : {}) };
  }
  const base = { driverDid: f.driverDid, ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}), days: [...new Set(f.days)].sort((a, b) => a - b) };
  const leg = (a: { label: string; pin: Pin }, b: { label: string; pin: Pin }, at: string, withSale: boolean) => ({ ...base, fromLabel: a.label.trim(), fromLat: a.pin!.lat, fromLng: a.pin!.lng, toLabel: b.label.trim(), toLat: b.pin!.lat, toLng: b.pin!.lng, startTime: at, ...(withSale && sell ? { sell } : {}) });
  // Space is sold on the line the fleet chose — the way there; the way back is its drivers' work.
  return [leg(f.from, f.to, f.time, true), ...(f.back ? [leg(f.to, f.from, f.back, false)] : [])];
}

/**
 * 2026-11-12 — A FLEET'S TRIPS (the owner: "as a general option, also for a fleet"; answers: the fleet sets its drivers' trips,
 * they see them; selling space, each run is posted as a departure a week ahead, any single run taken back).
 */
export function FleetTripsCard({ state, actions }: { state: FleetState; actions: FleetActions }) {
  const t = useT();
  useEffect(() => {
    void actions.loadTrips();
  }, []);
  const trips = state.trips ?? [];
  const [adding, setAdding] = useState(false);
  const today = todayHere();
  return (
    <Card title={t('fleet.trips.title')}>
      <p class="card__note">{t('fleet.trips.lede')}</p>
      {trips.length === 0 ? <p class="card__note">{t('fleet.trips.none')}</p> : null}
      {trips.map((trip) => (
        <FleetTripRow key={trip.tripId} trip={trip} actions={actions} today={today} busy={state.busy !== null} />
      ))}
      {adding ? <AddTrip state={state} actions={actions} onDone={() => setAdding(false)} /> : (
        <Button variant="outline" chevron={false} onClick={() => setAdding(true)}>
          {t('fleet.trips.add')}
        </Button>
      )}
    </Card>
  );
}

function FleetTripRow({ trip, actions, today, busy }: { trip: SavedTrip; actions: FleetActions; today: string; busy: boolean }) {
  const t = useT();
  const next = nextWords(trip.next, today, t, 'fleet.trips');
  return (
    <div style="border-top:1px solid var(--bd);padding-top:12px;margin-top:12px">
      <p class="row__t">
        {trip.from.label} → {trip.to.label}
      </p>
      <p class="card__note">
        {t('fleet.trips.line', { driver: trip.driverName ?? '', plate: trip.plate ?? t('fleet.trips.noVehicle'), time: trip.startTime, days: tripDaysWords(trip.days, t, 'fleet.trips') })}
        {trip.paused ? ` · ${t('fleet.trips.paused')}` : next ? ` · ${t('fleet.trips.next', { when: next })}` : ''}
      </p>
      {trip.sale ? <p class="card__note">{t('fleet.trips.selling', { n: trip.posted?.length ?? 0 })}</p> : null}
      {trip.postError ? <p class="cerr">{t('fleet.trips.postError', { why: trip.postError })}</p> : null}
      <div class="linkcol">
        {trip.next && !trip.paused ? (
          <Button variant="link" full={false} disabled={busy} onClick={() => void actions.skipTrip(trip.tripId, trip.next!.day, true)}>
            {t('fleet.trips.skipNext')}
          </Button>
        ) : null}
        {trip.skips.length ? (
          <Button variant="link" full={false} disabled={busy} onClick={() => void actions.skipTrip(trip.tripId, trip.skips[0], false)}>
            {t('fleet.trips.unskip')}
          </Button>
        ) : null}
        <Button variant="link" full={false} disabled={busy} onClick={() => void actions.pauseTrip(trip.tripId, !trip.paused)}>
          {t(trip.paused ? 'fleet.trips.resume' : 'fleet.trips.pause')}
        </Button>
        <Button variant="link" full={false} danger disabled={busy} onClick={() => void actions.removeTrip(trip.tripId)}>
          {t('fleet.trips.delete')}
        </Button>
      </div>
    </div>
  );
}

function AddTrip({ state, actions, onDone }: { state: FleetState; actions: FleetActions; onDone: () => void }) {
  const t = useT();
  const lines = ownLines(state.corridors, state.manager?.did).filter((c) => c.status === 'active');
  const [f, setF] = useState({ driverDid: '', vehicleId: '', from: { label: '', pin: null as Pin }, to: { label: '', pin: null as Pin }, days: [1, 2, 3, 4, 5, 6], time: '05:30', back: '', sell: false, corridorId: lines[0]?.corridorId ?? '', capacityKg: '', basis: 'per_trip', amount: '' });
  const [error, setError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState(false);
  const bodies = fleetTripBodies(f);
  const note = (n: PlaceNote) => t(n.kind === 'notFound' ? 'fleet.trips.notFound' : n.kind === 'idle' ? 'fleet.trips.placeHow' : 'fleet.trips.placeSet');
  const save = async () => {
    if (!bodies) return;
    setBusy(true);
    const failed = await actions.saveTrips(bodies);
    setBusy(false);
    if (failed) return setError(failed);
    onDone();
  };
  return (
    <div style="border-top:1px solid var(--bd);padding-top:12px;margin-top:12px">
      {error ? <ErrorNote error={error} /> : null}
      <div class="field">
        <label class="field__label" for="ft-driver">
          {t('fleet.trips.driver')}
        </label>
        <select id="ft-driver" class="select" value={f.driverDid} onChange={(e) => setF({ ...f, driverDid: e.currentTarget.value })}>
          <option value="">{t('fleet.trips.chooseDriver')}</option>
          {state.drivers.map((d) => (
            <option key={d.did} value={d.did}>
              {d.displayName}
            </option>
          ))}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="ft-vehicle">
          {t('fleet.trips.vehicle')}
        </label>
        <select id="ft-vehicle" class="select" value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.currentTarget.value })}>
          <option value="">{t('fleet.trips.anyVehicle')}</option>
          {state.vehicles.map((v) => (
            <option key={v.vehicleId} value={v.vehicleId}>
              {v.plate}
            </option>
          ))}
        </select>
      </div>
      <PlacePicker id="ft-from" fieldLabel={t('fleet.trips.from')} placeholder={t('fleet.trips.placePh')} mapLabel={t('fleet.trips.mapLabel')} findLabel={t('fleet.upload.find')} label={f.from.label} pin={f.from.pin} onLabel={(label) => setF((x) => ({ ...x, from: { ...x.from, label } }))} onPin={(pin) => setF((x) => ({ ...x, from: { ...x.from, pin } }))} geocode={actions.geocodePlace} noteText={note} startHere />
      <PlacePicker id="ft-to" fieldLabel={t('fleet.trips.to')} placeholder={t('fleet.trips.placePh')} mapLabel={t('fleet.trips.mapLabel')} findLabel={t('fleet.upload.find')} label={f.to.label} pin={f.to.pin} reference={f.from.pin} onLabel={(label) => setF((x) => ({ ...x, to: { ...x.to, label } }))} onPin={(pin) => setF((x) => ({ ...x, to: { ...x.to, pin } }))} geocode={actions.geocodePlace} noteText={note} />
      <div class="field">
        <span class="field__label">{t('fleet.trips.days')}</span>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <Button key={d} variant={f.days.includes(d) ? 'primary' : 'outline'} full={false} chevron={false} onClick={() => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] })}>
              {t(`fleet.trips.day.${d}` as never)}
            </Button>
          ))}
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="ft-time">
          {t('fleet.trips.time')}
        </label>
        <input id="ft-time" class="input" type="time" value={f.time} onInput={(e) => setF({ ...f, time: e.currentTarget.value })} />
      </div>
      <div class="field">
        <label class="field__label" for="ft-back">
          {t('fleet.trips.back')}
        </label>
        <input id="ft-back" class="input" type="time" value={f.back} onInput={(e) => setF({ ...f, back: e.currentTarget.value })} />
      </div>
      <label class="field" style="flex-direction:row;gap:8px;align-items:center">
        <input type="checkbox" checked={f.sell} onChange={(e) => setF({ ...f, sell: e.currentTarget.checked })} />
        <span>{t('fleet.trips.sell')}</span>
      </label>
      {f.sell ? (
        lines.length === 0 ? (
          <p class="card__note">{t('fleet.trips.noLine')}</p>
        ) : (
          <>
            <div class="field">
              <label class="field__label" for="ft-line">
                {t('fleet.trips.line2')}
              </label>
              <select id="ft-line" class="select" value={f.corridorId} onChange={(e) => setF({ ...f, corridorId: e.currentTarget.value })}>
                {lines.map((c) => (
                  <option key={c.corridorId} value={c.corridorId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div class="field">
              <label class="field__label" for="ft-kg">
                {t('fleet.trips.capacity')}
              </label>
              <input id="ft-kg" class="input" inputMode="numeric" value={f.capacityKg} onInput={(e) => setF({ ...f, capacityKg: e.currentTarget.value })} />
            </div>
            <div class="field">
              <label class="field__label" for="ft-basis">
                {t('fleet.runs.basis')}
              </label>
              <select id="ft-basis" class="select" value={f.basis} onChange={(e) => setF({ ...f, basis: e.currentTarget.value })}>
                <option value="per_trip">{t('fleet.runs.basisTrip')}</option>
                <option value="per_km">{t('fleet.runs.basisKm')}</option>
                <option value="per_kg">{t('fleet.runs.basisKg')}</option>
              </select>
            </div>
            <div class="field">
              <label class="field__label" for="ft-amount">
                {t('fleet.trips.amount')}
              </label>
              <input id="ft-amount" class="input" inputMode="decimal" value={f.amount} onInput={(e) => setF({ ...f, amount: e.currentTarget.value })} />
            </div>
          </>
        )
      ) : null}
      <Button chevron={false} busy={busy} disabled={!bodies} onClick={() => void save()}>
        {t('fleet.trips.save')}
      </Button>
      <Button variant="link" onClick={onDone}>
        {t('fleet.trips.keep')}
      </Button>
    </div>
  );
}
