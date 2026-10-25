import { useEffect, useState } from 'preact/hooks';
import { Button, ErrorNote, Note, PhotoField, ScanField, Sheet } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import type { components } from '../../../lib/sbg/schema';
import type { DriverActions } from '../useDriverApp';

export type BreakdownView = components['schemas']['VehicleBreakdown'];
export type TakeOverView = components['schemas']['BreakdownToTakeOver'];
export type TakenOverView = components['schemas']['TakeOverResult'];
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

/** How many couriers near a broken-down courier were told, in words: one, several, or nobody (and what that means). */
export function couriersToldLine(n: number, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  if (n === 0) return t('driver.brk.couriersNone');
  return n === 1 ? t('driver.brk.couriersToldOne') : t('driver.brk.couriersToldMany', { n });
}

/**
 * THE VEHICLE HAS BROKEN DOWN, from the driver out in it: what happened, a photo if they can, and where they are — the
 * phone is asked as the sheet opens, and if it cannot say, the office gets the last known position. What comes back
 * says the office knows, and whether the shippers of what is aboard were told. The shift is the driver's to end.
 *
 * A COURIER has no office: theirs says it is reported, and — with bags or parcels aboard — how many couriers near them
 * were told, so that one can come and take them on (the user, 2026-10-25: "Split by the road").
 */
export function BreakdownSheet({ open, actions, onClose, courier = false }: { open: boolean; actions: DriverActions; onClose: () => void; courier?: boolean }) {
  const t = useT();
  const [cause, setCause] = useState<Cause | null>(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);
  const [finding, setFinding] = useState<'asking' | 'found' | 'none'>('asking');
  const [error, setError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<BreakdownView | null>(null);
  const [queued, setQueued] = useState(false);

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
    setQueued(false);
    onClose();
  };
  const send = async () => {
    if (!cause) return;
    setBusy(true);
    setError(null);
    const r = await actions.sendBreakdown({ cause, note: note.trim(), ...(photo ? { photoRef: photo } : {}), ...(where ? { lat: where.lat, lng: where.lng } : {}) });
    setBusy(false);
    if (r.error) return setError(r.error);
    // With no signal it waits on this phone: there is nothing back yet to say who was told.
    if (r.queued) return setQueued(true);
    setDone(r.data ?? null);
  };
  const told = done ? done.aboard.filter((l) => l.shipperTold).length : 0;

  return (
    <Sheet open={open} onClose={close} title={t('driver.brk.title')}>
      {queued ? (
        <>
          <Note tone="warn" icon="offline" title={t('driver.brk.queuedTitle')} detail={t('driver.brk.queuedDetail')} />
          <Button chevron={false} onClick={close}>
            {t('driver.close')}
          </Button>
        </>
      ) : done ? (
        <>
          <Note tone="warn" icon="warning" title={t(courier ? 'driver.brk.toldTitleCourier' : 'driver.brk.toldTitle')} detail={t(courier ? 'driver.brk.toldDetailCourier' : 'driver.brk.toldDetail')} />
          {told ? <p class="t-body">{t('driver.brk.shippersTold', { n: told })}</p> : null}
          {done.couriersTold !== undefined ? <p class="t-body">{couriersToldLine(done.couriersTold, t)}</p> : null}
          {done.aboard.length ? <p class="hint">{t(courier ? 'driver.brk.keepShiftCourier' : 'driver.brk.keepShift')}</p> : null}
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
            {t(courier ? 'driver.brk.sendCourier' : 'driver.brk.send')}
          </Button>
          <Button variant="link" onClick={close}>
            {t('driver.close')}
          </Button>
        </>
      )}
    </Sheet>
  );
}

/**
 * TAKE THE LOADS OVER from a broken-down vehicle of the driver's own fleet — shown only while there is one. The driver
 * picks it, sees what it carries, and types the six digits the other driver reads out from "Show my badge" (or scans
 * that badge): the two of them, at the vehicle together. Every load moves, or none does.
 *
 * A COURIER sees another courier's, broken down near them, with bags or parcels to take on — how far, nearest first — and
 * is told that the road left on each bag is theirs when they hand it in (the user, 2026-10-25: "Split by the road").
 */
export function TakeOverLink({ actions, courier = false }: { actions: DriverActions; courier?: boolean }) {
  const t = useT();
  const [list, setList] = useState<TakeOverView[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const look = () => void actions.loadTakeOvers().then((l) => live && setList(l));
    look();
    const every = setInterval(look, 60_000);
    return () => {
      live = false;
      clearInterval(every);
    };
  }, [actions.loadTakeOvers]);
  if (!list.length && !open) return null;
  return (
    <>
      <Button variant="link" full={false} onClick={() => setOpen(true)}>
        {t(courier ? 'driver.tko.openCourier' : 'driver.tko.open')}
      </Button>
      <TakeOverSheet
        open={open}
        list={list}
        actions={actions}
        courier={courier}
        onClose={() => {
          setOpen(false);
          void actions.loadTakeOvers().then(setList);
        }}
      />
    </>
  );
}

function TakeOverSheet({ open, list, actions, onClose, courier }: { open: boolean; list: TakeOverView[]; actions: DriverActions; onClose: () => void; courier: boolean }) {
  const t = useT();
  const [pick, setPick] = useState<string | null>(null);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [done, setDone] = useState<TakenOverView | null>(null);
  const chosen = list.find((b) => b.breakdownId === pick) ?? (list.length === 1 ? list[0] : undefined);
  const close = () => {
    setPick(null);
    setPass('');
    setError(null);
    setDone(null);
    onClose();
  };
  const send = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const where = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 8_000, maximumAge: 60_000 });
    });
    const r = await actions.sendTakeOver({ breakdownId: chosen.breakdownId, pass: pass.trim(), ...(where ? { lat: where.lat, lng: where.lng } : {}) });
    setBusy(false);
    if (r.error) return setError(r.error);
    setDone(r.data ?? null);
  };

  return (
    <Sheet open={open} onClose={close} title={t(courier ? 'driver.tko.titleCourier' : 'driver.tko.title')}>
      {done ? (
        <>
          <Note tone="ok" icon="check" title={t('driver.tko.doneTitle', { plate: done.toPlate })} detail={t(courier ? 'driver.tko.doneDetailCourier' : 'driver.tko.doneDetail', { list: done.moved.join(', '), from: done.fromPlate })} />
          <Button chevron={false} onClick={close}>
            {t('driver.close')}
          </Button>
        </>
      ) : (
        <>
          {error ? <ErrorNote error={error as never} showDetail /> : null}
          {list.length > 1 ? (
            <div class="chips">
              {list.map((b) => (
                <button key={b.breakdownId} type="button" class={'chip chip--tap' + (chosen?.breakdownId === b.breakdownId ? ' chip--on' : '')} aria-pressed={chosen?.breakdownId === b.breakdownId} onClick={() => setPick(b.breakdownId)}>
                  {b.plate}
                </button>
              ))}
            </div>
          ) : null}
          {chosen ? (
            <>
              <p class="t-body">
                {chosen.km !== undefined
                  ? t('driver.tko.whatNear', { who: chosen.driverName ?? chosen.plate, km: chosen.km.toLocaleString() })
                  : t('driver.tko.what', { plate: chosen.plate })}
              </p>
              <ul class="rows">
                {chosen.loads.map((l) => (
                  <li key={l.label} class="row row--static">
                    <span class="row__body">
                      <span class="row__t">{l.label}</span>
                      <span class="row__s">{t(l.state === 'aboard' ? 'driver.tko.aboard' : 'driver.tko.toCollect', { kg: l.weightKg.toLocaleString() })}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <ScanField id="tko-pass" expect="badge" label={t('driver.tko.passLabel', { who: chosen.driverName ?? '' })} value={pass} onValue={setPass} placeholder="123456" />
              <p class="hint">{t('driver.tko.passHint')}</p>
              {chosen.loads.some((l) => l.kind === 'bag') ? <p class="hint">{t('driver.tko.payRoad')}</p> : null}
              <Button chevron={false} busy={busy} disabled={busy || pass.replace(/\s/g, '').length < 6} onClick={() => void send()}>
                {t('driver.tko.send', { kg: chosen.totalKg.toLocaleString() })}
              </Button>
            </>
          ) : null}
          <Button variant="link" onClick={close}>
            {t('driver.close')}
          </Button>
        </>
      )}
    </Sheet>
  );
}
