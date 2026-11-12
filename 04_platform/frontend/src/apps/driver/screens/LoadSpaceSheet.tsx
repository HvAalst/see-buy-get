import { useState } from 'preact/hooks';
import { Button, ErrorNote, Sheet } from '../../../shared/ui';
import type { SbgError } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { litresOf, loadSpaceBody } from '../logic';
import type { DriverActions } from '../useDriverApp';

/**
 * 2026-11-12 — WHAT YOUR VEHICLE TAKES (the owner: "I am driving my VAN, it is assumed that it can load 1200 Kg. Can I set it
 * up to 600 Kg and 1000 liter volume?"). The most it carries and its load space; loads are offered by these. The server says
 * the most a vehicle of its kind may carry.
 */
export function LoadSpaceSheet({ open, onClose, actions, vehicle, word }: { open: boolean; onClose: () => void; actions: DriverActions; vehicle: { vehicleId: string; capacityKg: number; volumeM3?: number }; word: string }) {
  const t = useT();
  const [kg, setKg] = useState(String(vehicle.capacityKg));
  const [litres, setLitres] = useState(litresOf(vehicle.volumeM3)?.toString() ?? '');
  const [error, setError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState(false);
  const made = loadSpaceBody(kg, litres);
  const save = async () => {
    if (!('body' in made)) return;
    setBusy(true);
    const failed = await actions.setLoadSpace(vehicle.vehicleId, made.body);
    setBusy(false);
    if (failed) return setError(failed);
    setError(null);
    onClose();
  };
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
      <Button chevron={false} busy={busy} disabled={!('body' in made)} onClick={() => void save()}>
        {t('driver.load.save')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('driver.load.keep')}
      </Button>
    </Sheet>
  );
}
