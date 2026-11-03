import { useT } from '../i18n';
import { energiesFor, energyWord, type VehicleEnergy } from '../vehicleEnergy';

/**
 * WHAT IT RUNS ON, CHOSEN BY A TAP (2026-11-03): two to five chips, the most usual for the class first. Nothing is chosen
 * for anybody — a guessed fuel would be counted as if somebody had said it.
 */
export function EnergyChoice({ id, vehicleClass, value, onChange, hint = true }: { id: string; vehicleClass: string; value: string; onChange: (energy: VehicleEnergy) => void; hint?: boolean }) {
  const t = useT();
  return (
    <div class="field" role="group" aria-labelledby={`${id}-label`}>
      <span class="field__label" id={`${id}-label`}>
        {t('vehicle.energy.label')}
      </span>
      <div class="chips">
        {energiesFor(vehicleClass).map((e) => (
          <button key={e} type="button" class={`chip chip--tap${value === e ? ' chip--on' : ''}`} aria-pressed={value === e} onClick={() => onChange(e)}>
            {energyWord(e, t)}
          </button>
        ))}
      </div>
      {hint ? <p class="hint">{t('vehicle.energy.hint')}</p> : null}
    </div>
  );
}
