import { useState } from 'preact/hooks';
import { Button, ErrorNote, Sheet } from '../../../shared/ui';
import type { SbgClient, SbgError } from '../../../lib/sbg';
import { trailerApi } from '../../../shared/trailers';
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
  /** 2026-11-13 — what it may tow, and its rates (trailer plan D3, D5). */
  towLimits?: { brakedKg: number; unbrakedKg: number; grossKg?: number };
  pricePerKm?: number;
  pricePerKmWithTrailer?: number;
}

export function LoadSpaceSheet({ open, onClose, actions, vehicle, word, own, sbg, onShift = false }: { open: boolean; onClose: () => void; actions: DriverActions; vehicle: LoadSpaceVehicle; word: string; own: boolean; sbg?: SbgClient | null; onShift?: boolean }) {
  const t = useT();
  // 2026-11-13 — what it may tow (trailer plan D3), for a car or a van; and, on a shift, its rate while towing (D5).
  const tows = vehicle.vehicleClass === 'van' || vehicle.vehicleClass === 'car';
  const [braked, setBraked] = useState(vehicle.towLimits ? String(vehicle.towLimits.brakedKg) : '');
  const [unbraked, setUnbraked] = useState(vehicle.towLimits ? String(vehicle.towLimits.unbrakedKg) : '');
  const [gross, setGross] = useState(vehicle.towLimits?.grossKg != null ? String(vehicle.towLimits.grossKg) : '');
  const [towRate, setTowRate] = useState(vehicle.pricePerKmWithTrailer != null ? String(vehicle.pricePerKmWithTrailer) : '');
  const towChanged = tows && (braked !== (vehicle.towLimits ? String(vehicle.towLimits.brakedKg) : '') || unbraked !== (vehicle.towLimits ? String(vehicle.towLimits.unbrakedKg) : '') || gross !== (vehicle.towLimits?.grossKg != null ? String(vehicle.towLimits.grossKg) : ''));
  const rateChanged = tows && onShift && towRate !== (vehicle.pricePerKmWithTrailer != null ? String(vehicle.pricePerKmWithTrailer) : '');
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
    if (failed) {
      setBusy(false);
      return setError(failed);
    }
    if (sbg && towChanged && braked.trim() && unbraked.trim()) {
      const r = await trailerApi(sbg).setTowLimits(vehicle.vehicleId, { brakedKg: Number(braked), unbrakedKg: Number(unbraked), grossKg: gross.trim() ? Number(gross) : null });
      if (r.error) {
        setBusy(false);
        return setError(r.error);
      }
    }
    if (sbg && rateChanged && vehicle.pricePerKm != null) {
      const r = await trailerApi(sbg).setRateWithTrailer(vehicle.vehicleId, vehicle.pricePerKm, towRate.trim() ? Number(towRate.replace(',', '.')) : null);
      if (r.error) {
        setBusy(false);
        return setError(r.error);
      }
    }
    setBusy(false);
    if (towChanged || rateChanged) await actions.refresh();
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

      {tows && own ? (
        <div class="field">
          <span class="field__label">{t('trailer.mayTow')}</span>
          <p class="hint">{t('trailer.mayTowHint')}</p>
          {(
            [
              ['tow-braked', 'trailer.towBraked', braked, setBraked],
              ['tow-unbraked', 'trailer.towUnbraked', unbraked, setUnbraked],
              ['tow-gross', 'trailer.towGross', gross, setGross],
              ...(onShift ? ([['tow-rate', 'trailer.towRate', towRate, setTowRate]] as const) : []),
            ] as const
          ).map(([id, label, value, onSet]) => (
            <div class="field" key={id}>
              <label class="field__label" for={id}>
                {t(label)}
              </label>
              <input id={id} class="input" type="number" inputMode="decimal" min="0" value={value} onInput={(e) => onSet(e.currentTarget.value)} />
            </div>
          ))}
        </div>
      ) : null}

      <Button chevron={false} busy={busy} disabled={!('body' in made)} onClick={() => void save()}>
        {t('driver.load.save')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('driver.load.keep')}
      </Button>
    </Sheet>
  );
}
