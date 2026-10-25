import { useState } from 'preact/hooks';
import { AuthImage, Button, PhotoField, Pill } from '../ui';
import { useT } from '../i18n';
import type { Result } from '../../lib/sbg';
import { SERVICE_KINDS, SERVICE_STATE, SERVICE_WORD, dayLabel, kmWords, planWords, type CareApi, type ServiceKind, type VehicleCare } from './care';

/**
 * A VEHICLE'S SERVICE, inside its upkeep sheet: when the next one is due and how that stands, how often (the usual for
 * its kind, or the office's own), and what was done to it with the workshop's job card — and recording one. Never a
 * price, never a part: what was done, when, and where.
 */
export function ServiceSection({ care, api, act, busy, uploadPhoto }: { care: VehicleCare; api: CareApi; act: (call: () => Promise<Result<VehicleCare>>) => Promise<void>; busy: boolean; uploadPhoto?: (file: File) => Promise<string | null> }) {
  const t = useT();
  const today = care.today; // the fleet's, as the server judges the day of a service
  const due = care.service;
  const state = SERVICE_STATE[due.state];
  const [planning, setPlanning] = useState(false);
  const [everyKm, setEveryKm] = useState('');
  const [everyMonths, setEveryMonths] = useState('');
  const [recording, setRecording] = useState(false);
  const [what, setWhat] = useState<ServiceKind>('service');
  const [day, setDay] = useState(today);
  const [km, setKm] = useState('');
  const [workshop, setWorkshop] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');
  const digits = (x: string) => x.replace(/[^0-9]/g, '');

  const openPlan = () => {
    setEveryKm(due.plan.everyKm ? String(due.plan.everyKm) : '');
    setEveryMonths(due.plan.everyMonths ? String(due.plan.everyMonths) : '');
    setPlanning(true);
  };
  const savePlan = (body: { everyKm?: number; everyMonths?: number; useClassUsual?: boolean }) =>
    act(async () => {
      const r = await api.setServicePlan(care.vehicleId, body);
      if (!r.error) setPlanning(false);
      return r;
    });
  const record = () =>
    act(async () => {
      const r = await api.recordService(care.vehicleId, {
        day,
        what,
        ...(digits(km) ? { km: Number(digits(km)) } : {}),
        ...(workshop.trim() ? { workshop: workshop.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(photo ? { photoRef: photo } : {}),
      });
      if (!r.error) {
        setRecording(false);
        setWhat('service');
        setDay(today);
        setKm('');
        setWorkshop('');
        setNote('');
        setPhoto('');
      }
      return r;
    });

  return (
    <>
      <p class="field__label" style="margin-top:16px">
        {t('fleet.svc.title')}
      </p>
      <div class="row row--static">
        <span class="row__body">
          <span class="row__t">{due.line}</span>
          <span class="row__s">
            {planWords(due.plan, t)} · {t(due.plan.source === 'office' ? 'fleet.svc.sourceOffice' : 'fleet.svc.sourceClass')}
          </span>
          <span class="row__s">{t(due.from === 'service' ? 'fleet.svc.fromService' : 'fleet.svc.fromRegistered', { day: dayLabel(due.fromDay, today, t) })}</span>
        </span>
        <span class="row__end">
          <Pill tone={state.tone} dot>
            {t(state.key)}
          </Pill>
        </span>
      </div>

      {planning ? (
        <>
          <div class="plan__tune" style="margin-top:6px">
            <div class="field">
              <label class="field__label" for="svc-every-km">
                {t('fleet.svc.everyKm')}
              </label>
              <input id="svc-every-km" class="input input--mono" inputMode="numeric" value={everyKm} onInput={(e) => setEveryKm(e.currentTarget.value)} />
            </div>
            <div class="field">
              <label class="field__label" for="svc-every-months">
                {t('fleet.svc.everyMonths')}
              </label>
              <input id="svc-every-months" class="input input--mono" inputMode="numeric" value={everyMonths} onInput={(e) => setEveryMonths(e.currentTarget.value)} />
            </div>
          </div>
          <p class="hint">{t('fleet.svc.planHint')}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <Button
              full={false}
              chevron={false}
              busy={busy}
              disabled={busy || (!digits(everyKm) && !digits(everyMonths))}
              onClick={() => void savePlan({ ...(digits(everyKm) ? { everyKm: Number(digits(everyKm)) } : {}), ...(digits(everyMonths) ? { everyMonths: Number(digits(everyMonths)) } : {}) })}
            >
              {t('fleet.svc.savePlan')}
            </Button>
            {due.plan.source === 'office' ? (
              <Button variant="link" full={false} disabled={busy} onClick={() => void savePlan({ useClassUsual: true })}>
                {t('fleet.svc.usualBack')}
              </Button>
            ) : null}
            <Button variant="link" full={false} onClick={() => setPlanning(false)}>
              {t('fleet.care.cancel')}
            </Button>
          </div>
        </>
      ) : null}

      {recording ? (
        <>
          <p class="field__label" style="margin-top:12px">
            {t('fleet.svc.what')}
          </p>
          <div class="chips" role="radiogroup" aria-label={t('fleet.svc.what')}>
            {SERVICE_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={what === k} class={'chip chip--tap' + (what === k ? ' chip--on' : '')} onClick={() => setWhat(k)}>
                {t(SERVICE_WORD[k])}
              </button>
            ))}
          </div>
          <div class="plan__tune" style="margin-top:10px">
            <div class="field">
              <label class="field__label" for="svc-day">
                {t('fleet.svc.day')}
              </label>
              <input id="svc-day" class="input" type="date" max={today} value={day} onInput={(e) => setDay(e.currentTarget.value)} />
            </div>
            <div class="field">
              <label class="field__label" for="svc-km">
                {t('fleet.svc.km')}
              </label>
              <input id="svc-km" class="input input--mono" inputMode="numeric" value={km} onInput={(e) => setKm(e.currentTarget.value)} />
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="svc-workshop">
              {t('fleet.svc.workshop')}
            </label>
            <input id="svc-workshop" class="input" maxLength={120} value={workshop} placeholder={t('fleet.svc.workshopPh')} onInput={(e) => setWorkshop(e.currentTarget.value)} />
          </div>
          <div class="field">
            <label class="field__label" for="svc-note">
              {t('fleet.svc.note')}
            </label>
            <input id="svc-note" class="input" maxLength={300} value={note} placeholder={t('fleet.svc.notePh')} onInput={(e) => setNote(e.currentTarget.value)} />
          </div>
          {uploadPhoto ? <PhotoField id="svc-job-card" value={photo} upload={uploadPhoto} onCapture={setPhoto} label={t('fleet.svc.jobCard')} disabled={busy} /> : null}
          <p class="hint">{t('fleet.svc.recordHint')}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <Button full={false} chevron={false} busy={busy} disabled={busy || !day} onClick={() => void record()}>
              {t('fleet.svc.save')}
            </Button>
            <Button variant="link" full={false} onClick={() => setRecording(false)}>
              {t('fleet.care.cancel')}
            </Button>
          </div>
        </>
      ) : null}

      {!planning && !recording ? (
        <span style="display:flex;gap:2px 16px;flex-wrap:wrap">
          <Button variant="link" full={false} onClick={() => setRecording(true)}>
            {t('fleet.svc.record')}
          </Button>
          <Button variant="link" full={false} onClick={openPlan}>
            {t('fleet.svc.change')}
          </Button>
        </span>
      ) : null}

      {care.services.length ? (
        <ul class="rows">
          {care.services.map((s) => (
            <li key={s.recordId} class="row row--static">
              <span class="row__body">
                <span class="row__t">
                  {t(SERVICE_WORD[s.what])} · {dayLabel(s.day, today, t)}
                </span>
                {s.km !== undefined || s.workshop ? <span class="row__s">{[s.km !== undefined ? kmWords(s.km) : '', s.workshop ?? ''].filter(Boolean).join(' · ')}</span> : null}
                {s.note ? <span class="row__s">“{s.note}”</span> : null}
                <span class="row__s">{t('fleet.svc.by', { who: s.by })}</span>
                {s.hasPhoto ? <AuthImage mediaId={`${care.vehicleId}|${s.recordId}`} load={api.servicePhoto} alt={t('fleet.svc.jobCardAlt', { what: t(SERVICE_WORD[s.what]), day: dayLabel(s.day, today, t) })} class="photos__thumb photos__thumb--sm" /> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="hint">{t('fleet.svc.none')}</p>
      )}
    </>
  );
}
