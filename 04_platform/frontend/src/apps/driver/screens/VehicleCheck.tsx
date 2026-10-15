import { useEffect, useState } from 'preact/hooks';
import { Button, ErrorNote, Note, PhotoField, RefusalNote, Sheet } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import type { components } from '../../../lib/sbg/schema';
import type { DriverActions } from '../useDriverApp';

export type CheckSheetView = components['schemas']['CheckSheet'];
export type CheckResultView = components['schemas']['CheckResult'];
export type DefectItem = components['schemas']['VehicleDefect']['item'];

/** What each item is called, for the driver: a word, never a code. */
export const ITEM_WORD: Record<DefectItem, MessageKey> = {
  tyres: 'driver.check.item.tyres',
  brakes: 'driver.check.item.brakes',
  lights: 'driver.check.item.lights',
  mirrors: 'driver.check.item.mirrors',
  horn: 'driver.check.item.horn',
  wipers: 'driver.check.item.wipers',
  leaks: 'driver.check.item.leaks',
  chain: 'driver.check.item.chain',
  load_gear: 'driver.check.item.load_gear',
  body: 'driver.check.item.body',
  other: 'driver.check.item.other',
};

type Answer = { ok: boolean; note: string; photo: string };

/**
 * THE DAILY CHECK, before a shift: every item the vehicle's class is asked about, fine or not. A problem says what is
 * wrong — in words, or a photograph — and the office hears it. A problem with brakes, tyres or lights keeps the vehicle
 * off the road until the office has it fixed, and the sheet says so before the driver walks to it.
 */
export function VehicleCheckSheet({ open, pick, actions, onClose }: { open: boolean; pick: { vehicleId?: string; vehicleQr?: string }; actions: DriverActions; onClose: () => void }) {
  const t = useT();
  const [sheet, setSheet] = useState<CheckSheetView | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [error, setError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResultView | null>(null);

  useEffect(() => {
    setSheet(null);
    setAnswers({});
    setResult(null);
    setError(null);
    if (!open || (!pick.vehicleId && !pick.vehicleQr)) return;
    void actions.loadCheck(pick).then((r) => (r.error ? setError(r.error) : setSheet(r.data ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pick.vehicleId, pick.vehicleQr]);

  const answer = (item: string, patch: Partial<Answer>) => setAnswers((was) => ({ ...was, [item]: { ...(was[item] ?? { ok: true, note: '', photo: '' }), ...patch } }));
  const allAnswered = sheet ? sheet.items.every((i) => answers[i.item] !== undefined) : false;
  const problemsSaid = sheet ? sheet.items.every((i) => !answers[i.item] || answers[i.item].ok || answers[i.item].note.trim() || answers[i.item].photo) : false;

  const send = async () => {
    if (!sheet) return;
    setBusy(true);
    setError(null);
    const r = await actions.sendCheck(
      { vehicleId: sheet.vehicleId },
      sheet.items.map((i) => {
        const a = answers[i.item];
        return { item: i.item, ok: a.ok, ...(!a.ok && a.note.trim() ? { note: a.note.trim() } : {}), ...(!a.ok && a.photo ? { photoRef: a.photo } : {}) };
      }),
    );
    setBusy(false);
    if (r.error) return setError(r.error);
    setResult(r.data ?? null);
  };

  return (
    <Sheet open={open} onClose={onClose} title={sheet ? t('driver.check.title', { plate: sheet.plate }) : t('driver.check.titlePlain')}>
      {error ? <RefusalNote error={error} /> : null}
      {result ? (
        <>
          {result.clean ? (
            <Note tone="ok" icon="check" title={t('driver.check.clean')} />
          ) : result.usable ? (
            <Note tone="warn" icon="warning" title={t('driver.check.problemsUsable', { count: result.found.length + result.alreadyOpen.length })} detail={t('driver.check.officeTold')} />
          ) : (
            <Note tone="danger" icon="block" title={t('driver.check.notSafe')} detail={result.offRoad.join(' · ')} />
          )}
          <Button chevron={false} onClick={onClose}>
            {t(result.usable ? 'driver.check.doneStart' : 'driver.check.doneOther')}
          </Button>
        </>
      ) : !sheet ? (
        error ? null : <p class="hint">{t('driver.check.loading')}</p>
      ) : (
        <>
          <p class="t-body">{t(sheet.required ? 'driver.check.whyRequired' : 'driver.check.why')}</p>
          {sheet.checkedTodayBy ? <p class="hint">{t('driver.check.checkedToday', { who: sheet.checkedTodayBy })}</p> : null}
          <ul class="rows">
            {sheet.items.map((i) => {
              const a = answers[i.item];
              return (
                <li key={i.item} class="row row--static" style="flex-wrap:wrap">
                  <span class="row__body">
                    <span class="row__t">{t(ITEM_WORD[i.item])}</span>
                    {i.safety ? <span class="row__s">{t('driver.check.safetyItem')}</span> : null}
                  </span>
                  <span class="row__end" style="gap:8px;display:flex">
                    <button type="button" class={'chip chip--tap' + (a?.ok === true ? ' chip--on' : '')} aria-pressed={a?.ok === true} onClick={() => answer(i.item, { ok: true })}>
                      {t('driver.check.ok')}
                    </button>
                    <button type="button" class={'chip chip--tap' + (a?.ok === false ? ' chip--on' : '')} aria-pressed={a?.ok === false} onClick={() => answer(i.item, { ok: false })}>
                      {t('driver.check.problem')}
                    </button>
                  </span>
                  {a && !a.ok ? (
                    <div style="width:100%;margin-top:8px">
                      <input class="input" maxLength={300} value={a.note} placeholder={t('driver.check.notePh')} aria-label={t('driver.check.noteLabel', { item: t(ITEM_WORD[i.item]) })} onInput={(e) => answer(i.item, { note: e.currentTarget.value })} />
                      <div style="margin-top:8px">
                        <PhotoField id={`check-${i.item}`} value={a.photo} upload={(f) => actions.uploadPhoto('defect', f)} onCapture={(id) => answer(i.item, { photo: id })} label={t('driver.check.photoAria', { item: t(ITEM_WORD[i.item]) })} disabled={busy} />
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!problemsSaid ? <p class="hint">{t('driver.check.sayWhat')}</p> : null}
          <Button chevron={false} busy={busy} disabled={busy || !allAnswered || !problemsSaid} onClick={() => void send()}>
            {t('driver.check.send')}
          </Button>
        </>
      )}
      <Button variant="link" onClick={onClose}>
        {t('driver.close')}
      </Button>
    </Sheet>
  );
}

const REPORTABLE: DefectItem[] = ['brakes', 'tyres', 'lights', 'leaks', 'mirrors', 'load_gear', 'body', 'other'];

/**
 * A PROBLEM WITH THE VEHICLE, on the road: what, in words (and a photo), and whether it is safe to keep driving. The
 * office hears at once; not safe takes the vehicle off the road for the next shift. The shift running now is the
 * driver's to end — the sheet says to stop where it is safe and call the office.
 */
export function ReportDefectSheet({ open, actions, onClose }: { open: boolean; actions: DriverActions; onClose: () => void }) {
  const t = useT();
  const [item, setItem] = useState<DefectItem | null>(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');
  const [safe, setSafe] = useState<boolean | null>(null);
  const [error, setError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setItem(null);
    setNote('');
    setPhoto('');
    setSafe(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };
  const send = async () => {
    if (!item || safe === null) return;
    setBusy(true);
    const failed = await actions.sendDefect({ item, note: note.trim(), ...(photo ? { photoRef: photo } : {}), safe });
    setBusy(false);
    if (failed) return setError(failed);
    close();
  };

  return (
    <Sheet open={open} onClose={close} title={t('driver.defect.title')}>
      {error ? <ErrorNote error={error as never} showDetail /> : null}
      <p class="t-body">{t('driver.defect.what')}</p>
      <div class="chips">
        {REPORTABLE.map((i) => (
          <button key={i} type="button" class={'chip chip--tap' + (item === i ? ' chip--on' : '')} aria-pressed={item === i} onClick={() => setItem(i)}>
            {t(ITEM_WORD[i])}
          </button>
        ))}
      </div>
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="defect-note">
          {t('driver.defect.noteLabel')}
        </label>
        <input id="defect-note" class="input" maxLength={300} value={note} placeholder={t('driver.check.notePh')} onInput={(e) => setNote(e.currentTarget.value)} />
      </div>
      <div class="field">
        <span class="field__label">{t('driver.defect.photoLabel')}</span>
        <PhotoField id="defect-photo" value={photo} upload={(f) => actions.uploadPhoto('defect', f)} onCapture={setPhoto} label={t('driver.defect.photoLabel')} disabled={busy} />
      </div>
      <p class="field__label">{t('driver.defect.safeQ')}</p>
      <div class="chips">
        <button type="button" class={'chip chip--tap' + (safe === true ? ' chip--on' : '')} aria-pressed={safe === true} onClick={() => setSafe(true)}>
          {t('driver.defect.safeYes')}
        </button>
        <button type="button" class={'chip chip--tap' + (safe === false ? ' chip--on' : '')} aria-pressed={safe === false} onClick={() => setSafe(false)}>
          {t('driver.defect.safeNo')}
        </button>
      </div>
      {safe === false ? <Note tone="danger" icon="warning" title={t('driver.defect.stop')} detail={t('driver.defect.stopDetail')} /> : null}
      <Button chevron={false} busy={busy} disabled={busy || !item || !note.trim() || safe === null} onClick={() => void send()}>
        {t('driver.defect.send')}
      </Button>
      <Button variant="link" onClick={close}>
        {t('driver.close')}
      </Button>
    </Sheet>
  );
}
