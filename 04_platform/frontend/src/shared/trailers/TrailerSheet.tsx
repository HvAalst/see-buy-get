import { useState } from 'preact/hooks';
import { Button, ErrorNote, PhotoField, Sheet } from '../ui';
import { useT } from '../i18n';
import type { SbgError } from '../../lib/sbg';
import type { Uploaded } from '../upload';
import { EMPTY_TRAILER, trailerBody, type TrailerBody, type TrailerForm } from '../trailers';

/**
 * 2026-11-13 — A TRAILER, AS TYPED (trailer plan D1–D2): kept by a courier or a fleet — with its registration card where it carries a
 * plate of its own (the server says when) — or hired for the day, typed at the hitch. Its maximum and its own weight from its plate:
 * what it carries is worked out, never assumed.
 */
export function TrailerSheet({ open, onClose, mode, onSave, upload }: { open: boolean; onClose: () => void; mode: 'keep' | 'hire'; onSave: (body: TrailerBody) => Promise<SbgError | null>; upload?: (file: File) => Promise<Uploaded> }) {
  const t = useT();
  const [f, setF] = useState<TrailerForm>(EMPTY_TRAILER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  if (!open) return null;
  const set = (patch: Partial<TrailerForm>) => setF((x) => ({ ...x, ...patch }));
  const made = trailerBody(f);
  const save = async () => {
    if (!('body' in made)) return;
    setBusy(true);
    const failed = await onSave(made.body);
    setBusy(false);
    setError(failed);
    if (!failed) {
      setF(EMPTY_TRAILER);
      onClose();
    }
  };
  const field = (id: string, label: string, value: string, onInput: (v: string) => void, numeric = true) => (
    <div class="field">
      <label class="field__label" for={id}>
        {label}
      </label>
      <input id={id} class="input" {...(numeric ? { type: 'number', inputMode: 'numeric' as const, min: '0' } : { autoComplete: 'off' })} value={value} onInput={(e) => onInput(e.currentTarget.value)} />
    </div>
  );
  return (
    <Sheet open onClose={onClose} title={t(mode === 'hire' ? 'trailer.hireTitle' : 'trailer.addTitle')}>
      <p class="t-body">{t(mode === 'hire' ? 'trailer.hireBody' : 'trailer.addBody')}</p>
      {error ? <ErrorNote error={error} showDetail /> : null}
      {field('trailer-plate', t('trailer.plate'), f.plate, (plate) => set({ plate }), false)}
      {field('trailer-max', t('trailer.maxKg'), f.maxKg, (maxKg) => set({ maxKg }))}
      {field('trailer-empty', t('trailer.emptyKg'), f.emptyKg, (emptyKg) => set({ emptyKg }))}
      {field('trailer-litres', t('trailer.litresLabel'), f.litres, (litres) => set({ litres }))}
      <div class="chips">
        {(
          [
            ['braked', 'trailer.braked'],
            ['closed', 'trailer.closed'],
            ['ramp', 'trailer.withRamp'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" class={`chip chip--tap${f[key] ? ' chip--on' : ''}`} aria-pressed={f[key]} onClick={() => set({ [key]: !f[key] } as Partial<TrailerForm>)}>
            {t(label)}
          </button>
        ))}
      </div>
      {mode === 'keep' && upload ? <PhotoField id="trailer-card" value={f.registrationRef} label={t('trailer.card')} upload={upload} onCapture={(registrationRef) => set({ registrationRef })} /> : null}
      {mode === 'keep' ? <p class="hint">{t('trailer.cardHint')}</p> : null}
      {'error' in made && (f.plate || f.maxKg || f.emptyKg) ? <p class="hint">{t(made.error)}</p> : null}
      <Button chevron={false} busy={busy} disabled={!('body' in made)} onClick={() => void save()}>
        {t(mode === 'hire' ? 'trailer.hireSave' : 'trailer.addSave')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('trailer.cancel')}
      </Button>
    </Sheet>
  );
}
