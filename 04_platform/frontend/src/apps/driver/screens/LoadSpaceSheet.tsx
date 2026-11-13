import { useState } from 'preact/hooks';
import { Button, ErrorNote, Sheet } from '../../../shared/ui';
import type { SbgError } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { equipmentOptions, equipmentWords } from '../../../shared/equipment';
import { litresOf, loadSpaceBody } from '../logic';
import type { DriverActions } from '../useDriverApp';

/**
 * 2026-11-12 — WHAT YOUR VEHICLE TAKES (the owner: "I am driving my VAN, it is assumed that it can load 1200 Kg. Can I set it
 * up to 600 Kg and 1000 liter volume?"). The most it carries and its load space; loads are offered by these. The server says
 * the most a vehicle of its kind may carry.
 *
 * 2026-11-13 — AND THE LOADING EQUIPMENT IT CARRIES (the owner: "build loading equipment"): on a vehicle that is the driver's
 * own, every piece its kind can carry, ticked; on a fleet's, what the fleet says, read only — the fleet keeps that record.
 */
export interface LoadSpaceVehicle {
  vehicleId: string;
  vehicleClass: string;
  capacityKg: number;
  volumeM3?: number;
  equipment?: string[];
}

export function LoadSpaceSheet({ open, onClose, actions, vehicle, word, own }: { open: boolean; onClose: () => void; actions: DriverActions; vehicle: LoadSpaceVehicle; word: string; own: boolean }) {
  const t = useT();
  const [kg, setKg] = useState(String(vehicle.capacityKg));
  const [litres, setLitres] = useState(litresOf(vehicle.volumeM3)?.toString() ?? '');
  const before = (vehicle.equipment ?? []).filter((e) => e !== 'MAN');
  const [picked, setPicked] = useState<string[]>(before);
  const [error, setError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState(false);
  const made = loadSpaceBody(kg, litres);
  const options = equipmentOptions(t, vehicle.vehicleClass);
  const equipmentChanged = own && (picked.length !== before.length || picked.some((e) => !before.includes(e)));
  const save = async () => {
    if (!('body' in made)) return;
    setBusy(true);
    const failed = await actions.setLoadSpace(vehicle.vehicleId, made.body, equipmentChanged ? picked : undefined);
    setBusy(false);
    if (failed) return setError(failed);
    setError(null);
    onClose();
  };
  const fleetSays = equipmentWords(vehicle.equipment, t);
  return (
    <Sheet open={open} onClose={onClose} title={t('driver.load.title', { vehicle: word })}>
      <p class="t-body">{t('driver.load.body', { vehicle: word })}</p>
      {error ? <ErrorNote error={error} /> : null}
      <div class="field">
        <label class="field__label" for="load-kg">
          {t('driver.load.kg')}
        </label>
        <input id="load-kg" class="input" type="number" inputMode="numeric" min="1" step="1" value={kg} onInput={(e) => setKg(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label class="field__label" for="load-litres">
          {t('driver.load.litres')}
        </label>
        <input id="load-litres" class="input" type="number" inputMode="numeric" min="1" step="10" value={litres} onInput={(e) => setLitres(e.currentTarget.value)} />
        <p class="hint">{t('driver.load.litresHint')}</p>
      </div>
      {'error' in made && (kg.trim() || litres.trim()) ? <p class="hint">{t(made.error)}</p> : null}

      <div class="field">
        <span class="field__label">{t('equipment.title')}</span>
        {!options.length ? (
          <p class="hint">{t('equipment.noneFits', { vehicle: word })}</p>
        ) : own ? (
          <>
            <p class="hint">{t('equipment.body')}</p>
            <div class="chips">
              {options.map((eq) => {
                const on = picked.includes(eq.key);
                return (
                  <button key={eq.key} type="button" class={`chip chip--tap${on ? ' chip--on' : ''}`} aria-pressed={on} onClick={() => setPicked(on ? picked.filter((e) => e !== eq.key) : [...picked, eq.key])}>
                    {eq.label}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <p class="hint">
            {fleetSays || t('equipment.none')}. {t('equipment.fleetSets')}
          </p>
        )}
      </div>

      <Button chevron={false} busy={busy} disabled={!('body' in made)} onClick={() => void save()}>
        {t('driver.load.save')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('driver.load.keep')}
      </Button>
    </Sheet>
  );
}
