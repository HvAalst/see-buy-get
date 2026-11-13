import { useMemo, useState } from 'preact/hooks';
import { createMdpApi, type SbgClient, type SbgError } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { Button, ErrorNote, Note, ScanField, Sheet, WeightInput } from '../../../shared/ui';

interface Checked {
  parcelId: string;
  foundKg: number;
  saidKg: number;
  differs: boolean;
}

/**
 * 2026-11-13 — WEIGH A PARCEL ON YOUR FLOOR (the owner: "shop and hub tools", T2): on a scale that counts, a parcel unlike what its
 * sender said is recorded against it and the sender told; the same, and nothing is kept. A guide scale is said to be one by the
 * server, in its own words. Opened from the sort.
 */
export function WeighSheet({ open, onClose, sbg, mdpId }: { open: boolean; onClose: () => void; sbg: SbgClient | null; mdpId?: string }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [parcelId, setParcelId] = useState('');
  const [kg, setKg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const value = Number(kg.replace(',', '.'));
  const weigh = async () => {
    if (!api || !mdpId || !parcelId.trim() || !(value > 0)) return;
    setBusy(true);
    setError(null);
    const r = (await api.weigh(mdpId, parcelId.trim().toUpperCase(), value)) as { data?: unknown; error?: SbgError | null };
    setBusy(false);
    if (r.error) return setError(r.error);
    setChecked(r.data as Checked);
    setParcelId('');
    setKg('');
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('mdp.weigh.title')}>
      <p class="t-body">{t('mdp.weigh.body')}</p>
      {checked ? (
        <Note
          tone={checked.differs ? 'warn' : 'info'}
          icon="weight"
          title={t(checked.differs ? 'mdp.weigh.differs' : 'mdp.weigh.same', { id: checked.parcelId, kg: checked.foundKg, said: checked.saidKg })}
          detail={checked.differs ? t('mdp.weigh.told') : undefined}
        />
      ) : null}
      {error ? <ErrorNote error={error} showDetail /> : null}
      <ScanField id="weigh-id" label={t('mdp.weigh.parcel')} value={parcelId} onValue={setParcelId} expect="parcel" placeholder={t('mdp.sort.scanSticker')} upper />
      <div class="field">
        <label class="field__label" for="weigh-kg">
          {t('mdp.weigh.kg')}
        </label>
        <WeightInput id="weigh-kg" value={kg} onInput={setKg} />
      </div>
      <Button chevron={false} busy={busy} disabled={!parcelId.trim() || !(value > 0)} onClick={() => void weigh()}>
        {t('mdp.weigh.save')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('mdp.weigh.done')}
      </Button>
    </Sheet>
  );
}
