import { useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Note, Sheet } from '../../../shared/ui';
import { EnergyChoice } from '../../../shared/ui/EnergyChoice';
import { energyFits } from '../../../shared/vehicleEnergy';
import { useT } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import { ownVehicleMissing, type OwnVehicleForm } from '../logic';
import { vehicleWord } from '../vehicle-words';
import type { DriverActions } from '../useDriverApp';

/**
 * 2026-11-21 — A VEHICLE OF THEIR OWN, CORRECTED OR TAKEN OFF (the owner: "can't edit the car details when I made a mistake in
 * the number plate"). The plate as it is on the vehicle — the one it had is kept on its record — and, quiet until asked for,
 * the way to take it off their vehicles: sold, scrapped, or added by mistake. What that means is said before the button that
 * does it. A refusal (a plate on another vehicle, a shift running on it) is shown in the server's words.
 */
export function OwnVehicleSheet({ vehicle, onClose, actions }: { vehicle: { vehicleId: string; plate: string; vehicleClass: string }; onClose: () => void; actions: DriverActions }) {
  const t = useT();
  const [plate, setPlate] = useState(vehicle.plate);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState<'plate' | 'remove' | null>(null);
  const [error, setError] = useState<SbgError | null>(null);
  const changed = plate.trim().replace(/\s+/g, ' ').toUpperCase() !== vehicle.plate && plate.trim() !== '';
  const act = async (which: 'plate' | 'remove', go: () => Promise<SbgError | null>) => {
    setBusy(which);
    const failed = await go();
    setBusy(null);
    if (failed) return setError(failed);
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={t('driver.own.title', { plate: vehicle.plate })}>
      {error ? <ErrorNote error={error} /> : null}
      <div class="field">
        <label class="field__label" for="own-plate">
          {t('driver.alone.plate')}
        </label>
        <input id="own-plate" class="input input--mono" value={plate} maxLength={32} autoComplete="off" spellcheck={false} onInput={(e) => setPlate(e.currentTarget.value)} />
        <p class="hint">{t(vehicle.vehicleClass === 'bike' ? 'driver.alone.plateBike' : 'driver.own.plateHint')}</p>
      </div>
      <Button chevron={false} busy={busy === 'plate'} disabled={!changed || busy !== null} onClick={() => void act('plate', () => actions.correctPlate(vehicle.vehicleId, plate.trim()))}>
        {t('driver.own.savePlate')}
      </Button>

      <Card title={t('driver.own.removeTitle')}>
        <p class="card__note">{t('driver.own.removeLede')}</p>
        {removing ? (
          <>
            <Note tone="warn" icon="truck" title={t('driver.own.removeSure', { plate: vehicle.plate })} detail={t('driver.own.removeMeans')} />
            <div class="stack">
              <Button chevron={false} busy={busy === 'remove'} disabled={busy !== null} onClick={() => void act('remove', () => actions.retireOwnVehicle(vehicle.vehicleId, vehicle.plate))}>
                {t('driver.own.removeYes')}
              </Button>
              <Button variant="outline" chevron={false} disabled={busy !== null} onClick={() => setRemoving(false)}>
                {t('driver.own.keep')}
              </Button>
            </div>
          </>
        ) : (
          <Button variant="outline" chevron={false} onClick={() => setRemoving(true)}>
            {t('driver.own.remove', { plate: vehicle.plate })}
          </Button>
        )}
      </Card>
      <Button variant="link" onClick={onClose}>
        {t('driver.close')}
      </Button>
    </Sheet>
  );
}

/**
 * 2026-11-21 — ANOTHER VEHICLE OF THEIR OWN (the owner: "I can't add a second car of mine"). What riding for themselves asked of
 * the first, without the country they ride in already: a kind their licence covers (chosen already when there is one), its
 * plate, what it runs on, and a truck's body. On their list at once.
 */
export function AddOwnVehicleSheet({ classes, onClose, actions }: { classes: string[]; onClose: () => void; actions: DriverActions }) {
  const t = useT();
  const [form, setForm] = useState<OwnVehicleForm>({ vehicleClass: classes.length === 1 ? classes[0] : '', plate: '' });
  const [bodies, setBodies] = useState<Array<{ id: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  // A truck is registered with its body: the list is read only when a truck is among what they may drive.
  useEffect(() => {
    if (!classes.includes('truck')) return;
    let gone = false;
    void actions.truckBodies().then((list) => {
      if (!gone) setBodies(list);
    });
    return () => {
      gone = true;
    };
  }, [classes.join(',')]);
  const missing = ownVehicleMissing(form, classes);
  const add = async () => {
    setBusy(true);
    const failed = await actions.addOwnVehicle({
      vehicleClass: form.vehicleClass,
      plate: form.plate.trim(),
      ...(form.vehicleClass === 'truck' && form.truckSubtype ? { truckSubtype: form.truckSubtype } : {}),
      ...(form.energy ? { energy: form.energy } : {}),
    });
    setBusy(false);
    if (failed) return setError(failed);
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={t('driver.own.addTitle')}>
      <p class="t-body">{t('driver.own.addLede')}</p>
      {error ? <ErrorNote error={error} /> : null}
      <div class="stack">
        <div class="field">
          <label class="field__label" for="own-class">
            {t('driver.alone.vehicle')}
          </label>
          <select
            id="own-class"
            class="select"
            value={form.vehicleClass}
            onChange={(e) => {
              const vehicleClass = e.currentTarget.value;
              setForm({ ...form, vehicleClass, ...(energyFits(vehicleClass, form.energy ?? '') ? {} : { energy: '' }) });
            }}
          >
            {classes.length === 1 ? null : <option value="">{t('driver.alone.choose')}</option>}
            {classes.map((c) => (
              <option key={c} value={c}>
                {vehicleWord(c, t)}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="own-new-plate">
            {t('driver.alone.plate')}
          </label>
          <input id="own-new-plate" class="input input--mono" value={form.plate} maxLength={32} autoComplete="off" spellcheck={false} onInput={(e) => setForm({ ...form, plate: e.currentTarget.value })} />
          {form.vehicleClass === 'bike' ? <p class="hint">{t('driver.alone.plateBike')}</p> : null}
        </div>
        {form.vehicleClass ? <EnergyChoice id="own-energy-new" vehicleClass={form.vehicleClass} value={form.energy ?? ''} onChange={(energy) => setForm({ ...form, energy })} /> : null}
        {form.vehicleClass === 'truck' ? (
          <div class="field">
            <label class="field__label" for="own-body">
              {t('driver.alone.body')}
            </label>
            <select id="own-body" class="select" value={form.truckSubtype ?? ''} onChange={(e) => setForm({ ...form, truckSubtype: e.currentTarget.value })}>
              <option value="">{t('driver.alone.choose')}</option>
              {bodies.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <Button chevron={false} busy={busy} disabled={missing !== null} onClick={() => void add()}>
          {t('driver.own.addCta')}
        </Button>
        {missing ? <p class="hint">{t(missing)}</p> : null}
      </div>
      <Button variant="link" onClick={onClose}>
        {t('driver.close')}
      </Button>
    </Sheet>
  );
}
