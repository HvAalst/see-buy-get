import { useEffect, useState } from 'preact/hooks';
import { Button, ErrorNote, Note, PhotoField, Sheet } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import type { components } from '../../../lib/sbg/schema';
import type { DriverActions } from '../useDriverApp';

export type BreakdownView = components['schemas']['VehicleBreakdown'];
type Cause = BreakdownView['cause'];

/** What broke, for the driver: a word, never a code. In the order a driver meets it. */
export const CAUSE_WORD: Record<Cause, MessageKey> = {
  engine: 'driver.brk.cause.engine',
  tyre: 'driver.brk.cause.tyre',
  electrical: 'driver.brk.cause.electrical',
  brakes: 'driver.brk.cause.brakes',
  fuel: 'driver.brk.cause.fuel',
  accident: 'driver.brk.cause.accident',
  other: 'driver.brk.cause.other',
};
const CAUSES = Object.keys(CAUSE_WORD) as Cause[];

/**
 * THE VEHICLE HAS BROKEN DOWN, from the driver out in it: what happened, a photo if they can, and where they are — the
 * phone is asked as the sheet opens, and if it cannot say, the office gets the last known position. What comes back
 * says the office knows, and whether the shippers of what is aboard were told. The shift is the driver's to end.
 */
export function BreakdownSheet({ open, actions, onClose }: { open: boolean; actions: DriverActions; onClose: () => void }) {
  const t = useT();
  const [cause, setCause] = useState<Cause | null>(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);
  const [finding, setFinding] = useState<'asking' | 'found' | 'none'>('asking');
  const [error, setError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<BreakdownView | null>(null);

  // Where the phone is now, asked once as the sheet opens.
  useEffect(() => {
    if (!open) return;
    setWhere(null);
    setFinding('asking');
    if (typeof navigator === 'undefined' || !navigator.geolocation) return setFinding('none');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setWhere({ lat: p.coords.latitude, lng: p.coords.longitude });
        setFinding('found');
      },
      () => setFinding('none'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [open]);

  const close = () => {
    setCause(null);
    setNote('');
    setPhoto('');
    setError(null);
    setDone(null);
    onClose();
  };
  const send = async () => {
    if (!cause) return;
    setBusy(true);
    setError(null);
    const r = await actions.sendBreakdown({ cause, note: note.trim(), ...(photo ? { photoRef: photo } : {}), ...(where ? { lat: where.lat, lng: where.lng } : {}) });
    setBusy(false);
    if (r.error) return setError(r.error);
    setDone(r.data ?? null);
  };
  const told = done ? done.aboard.filter((l) => l.shipperTold).length : 0;

  return (
    <Sheet open={open} onClose={close} title={t('driver.brk.title')}>
      {done ? (
        <>
          <Note tone="warn" icon="warning" title={t('driver.brk.toldTitle')} detail={t('driver.brk.toldDetail')} />
          {told ? <p class="t-body">{t('driver.brk.shippersTold', { n: told })}</p> : null}
          <Button chevron={false} onClick={close}>
            {t('driver.close')}
          </Button>
        </>
      ) : (
        <>
          {error ? <ErrorNote error={error as never} showDetail /> : null}
          <p class="t-body">{t('driver.brk.what')}</p>
          <div class="chips">
            {CAUSES.map((c) => (
              <button key={c} type="button" class={'chip chip--tap' + (cause === c ? ' chip--on' : '')} aria-pressed={cause === c} onClick={() => setCause(c)}>
                {t(CAUSE_WORD[c])}
              </button>
            ))}
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="brk-note">
              {t('driver.brk.noteLabel')}
            </label>
            <input id="brk-note" class="input" maxLength={300} value={note} placeholder={t('driver.brk.notePh')} onInput={(e) => setNote(e.currentTarget.value)} />
          </div>
          <div class="field">
            <span class="field__label">{t('driver.defect.photoLabel')}</span>
            <PhotoField id="brk-photo" value={photo} upload={(f) => actions.uploadPhoto('defect', f)} onCapture={setPhoto} label={t('driver.defect.photoLabel')} disabled={busy} />
          </div>
          <p class="hint">{t(finding === 'found' ? 'driver.brk.whereFound' : finding === 'none' ? 'driver.brk.whereNone' : 'driver.brk.whereAsking')}</p>
          <Note tone="danger" icon="warning" title={t('driver.brk.safety')} />
          <Button chevron={false} busy={busy} disabled={busy || !cause || !note.trim()} onClick={() => void send()}>
            {t('driver.brk.send')}
          </Button>
          <Button variant="link" onClick={close}>
            {t('driver.close')}
          </Button>
        </>
      )}
    </Sheet>
  );
}
