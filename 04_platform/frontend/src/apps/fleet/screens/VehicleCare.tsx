import { useEffect, useMemo, useState } from 'preact/hooks';
import { AuthImage, Button, ErrorNote, Note, Pill, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { Result, SbgClient } from '../../../lib/sbg';
import type { MediaKind } from '../../../lib/sbg/personas/media';
import { DEFECT_WORD, OFF_ROAD_REASONS, REASON_WORD, SOURCE_WORD, careApi, kmWords, localDay, spellBegun, spellSpan, type OffRoadReason, type VehicleCare } from '../care';
import { formatDate } from '../../../shared/i18n';
import type { VehicleRow } from '../types';
import { ServiceSection } from './ServiceSection';

/**
 * A VEHICLE'S UPKEEP, in one sheet under the vehicle's name: whether it can go out and every reason it cannot, its
 * spells off the road (now and to come), and taking it off — with a reason, from a day, until a day or until it is put
 * back; its service; its defects; its odometer. Whatever is saved here is what the plan, the driver's list and the
 * shift start read.
 */
export function VehicleCareSheet({
  vehicle,
  sbg,
  onClose,
  onChanged,
  uploadPhoto,
}: {
  vehicle: VehicleRow | null;
  sbg: SbgClient | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  /** For a job card's photograph. */
  uploadPhoto?: (kind: MediaKind, file: File) => Promise<string | null>;
}) {
  const t = useT();
  const api = useMemo(() => (sbg ? careApi(sbg) : null), [sbg]);
  const [care, setCare] = useState<VehicleCare | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // The fleet's today, as the server judges every day here; the device's only until the sheet has loaded.
  const today = care?.today ?? localDay();
  const [reason, setReason] = useState<OffRoadReason>('repair');
  const [fromDay, setFromDay] = useState('');
  const [untilDay, setUntilDay] = useState('');
  const [note, setNote] = useState('');
  const [km, setKm] = useState('');
  // The defect being decided, how, and the reason said with it.
  const [deciding, setDeciding] = useState<{ defectId: string; decision: 'fixed' | 'cleared' } | null>(null);
  const [why, setWhy] = useState('');
  const [newMeter, setNewMeter] = useState(false);

  useEffect(() => {
    setCare(null);
    setError(null);
    if (!vehicle || !api) return;
    void api.care(vehicle.vehicleId).then((r) => {
      if (r.error || !r.data) return setError(r.error);
      setCare(r.data);
      setFromDay(r.data.today);
    });
  }, [vehicle, api]);

  const act = async (call: () => Promise<Result<VehicleCare>>) => {
    setBusy(true);
    setError(null);
    const r = await call();
    setBusy(false);
    if (r.error || !r.data) return setError(r.error);
    setCare(r.data);
    await onChanged();
  };
  const takeOff = () =>
    act(async () => {
      const r = await api!.takeOffRoad(vehicle!.vehicleId, { reason, ...(note.trim() ? { note: note.trim() } : {}), fromDay, ...(untilDay ? { untilDay } : {}) });
      if (!r.error) {
        setNote('');
        setUntilDay('');
      }
      return r;
    });
  const spellNow = care?.spells.some((s) => spellBegun(s, today));

  return (
    <Sheet open={Boolean(vehicle)} onClose={onClose} title={vehicle ? t('fleet.care.title', { plate: vehicle.plate }) : ''}>
      {error ? <ErrorNote error={error as never} showDetail /> : null}
      {!care ? (
        error ? null : <p class="hint">{t('fleet.care.loading')}</p>
      ) : (
        <>
          {care.usable ? (
            <Note tone="ok" icon="check" title={t('fleet.care.onRoad')} />
          ) : (
            <Note tone="warn" icon="warning" title={t('fleet.care.offRoad')} detail={care.offRoad.join(' · ')} />
          )}
          {care.inUse && !care.usable ? <p class="hint">{t('fleet.care.inUse')}</p> : null}
          {!care.usable && (spellNow || care.grounded) ? (
            <Button variant="outline" chevron={false} busy={busy} disabled={busy} onClick={() => void act(() => api!.backOnRoad(care.vehicleId))}>
              {t('fleet.care.backOnRoad')}
            </Button>
          ) : null}

          {care.spells.length ? (
            <>
              <p class="field__label" style="margin-top:16px">
                {t('fleet.care.spellsTitle')}
              </p>
              <ul class="rows">
                {care.spells.map((s) => (
                  <li key={s.spellId} class="row row--static">
                    <span class="row__body">
                      <span class="row__t">{t(REASON_WORD[s.reason])}</span>
                      <span class="row__s">
                        {spellSpan(s, today, t)}
                        {s.note ? ` · ${s.note}` : ''}
                      </span>
                      <span class="row__s">{t('fleet.care.setBy', { who: s.setBy })}</span>
                    </span>
                    <span class="row__end">
                      <Button variant="link" full={false} chevron={false} disabled={busy} onClick={() => void act(() => api!.endSpell(care.vehicleId, s.spellId))}>
                        {t(spellBegun(s, today) ? 'fleet.care.end' : 'fleet.care.callOff')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <ServiceSection care={care} api={api!} act={act} busy={busy} uploadPhoto={uploadPhoto ? (file) => uploadPhoto('job_card', file) : undefined} />

          {/* DEFECTS: what drivers found, safety-critical first, each with its photo — and the office's word on it. */}
          <p class="field__label" style="margin-top:16px">
            {t('fleet.care.defectsTitle')}
          </p>
          {care.lastCheckAt ? (
            <p class="hint">{t(care.lastCheckClean ? 'fleet.care.lastCheckClean' : 'fleet.care.lastCheckProblems', { who: care.lastCheckBy ?? '', when: formatDate(care.lastCheckAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
          ) : (
            <p class="hint">{t('fleet.care.noCheck')}</p>
          )}
          {care.defects.length === 0 ? <p class="hint">{t('fleet.care.noDefects')}</p> : null}
          <ul class="rows">
            {care.defects.map((d) => (
              <li key={d.defectId} class="row row--static" style="flex-wrap:wrap">
                <span class="row__body">
                  <span class="row__t">{t(DEFECT_WORD[d.item])}</span>
                  {d.note ? <span class="row__s">“{d.note}”</span> : null}
                  <span class="row__s">{t('fleet.care.reported', { who: d.reportedBy, when: formatDate(d.reportedAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
                  {d.hasPhoto ? <AuthImage mediaId={`${care.vehicleId}|${d.defectId}`} load={api!.defectPhoto} alt={t('fleet.care.defectPhoto', { item: t(DEFECT_WORD[d.item]) })} class="photos__thumb photos__thumb--sm" /> : null}
                </span>
                <span class="row__end">
                  <Pill tone={d.safety ? 'danger' : 'warn'} dot>
                    {t(d.safety ? 'fleet.care.unsafe' : 'fleet.care.canGo')}
                  </Pill>
                </span>
                {deciding?.defectId === d.defectId ? (
                  <div style="width:100%;margin-top:8px">
                    <input class="input" maxLength={300} value={why} placeholder={t(deciding.decision === 'fixed' ? 'fleet.care.fixedPh' : 'fleet.care.clearedPh')} aria-label={t(deciding.decision === 'fixed' ? 'fleet.care.fixedPh' : 'fleet.care.clearedPh')} onInput={(e) => setWhy(e.currentTarget.value)} />
                    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                      <Button
                        full={false}
                        chevron={false}
                        busy={busy}
                        disabled={busy || !why.trim()}
                        onClick={() =>
                          void act(async () => {
                            const r = await api!.decideDefect(care.vehicleId, d.defectId, deciding.decision, why.trim());
                            if (!r.error) {
                              setDeciding(null);
                              setWhy('');
                            }
                            return r;
                          })
                        }
                      >
                        {t(deciding.decision === 'fixed' ? 'fleet.care.saveFixed' : 'fleet.care.saveCleared')}
                      </Button>
                      <Button variant="link" full={false} onClick={() => setDeciding(null)}>
                        {t('fleet.care.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <span style="display:flex;gap:2px 16px;flex-wrap:wrap;width:100%">
                    <Button variant="link" full={false} onClick={() => { setDeciding({ defectId: d.defectId, decision: 'fixed' }); setWhy(''); }}>
                      {t('fleet.care.fixed')}
                    </Button>
                    {d.safety ? (
                      <Button variant="link" full={false} onClick={() => { setDeciding({ defectId: d.defectId, decision: 'cleared' }); setWhy(''); }}>
                        {t('fleet.care.cleared')}
                      </Button>
                    ) : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {care.decided.length ? (
            <p class="hint">
              {care.decided
                .slice(0, 3)
                .map((d) => t(d.status === 'fixed' ? 'fleet.care.wasFixed' : 'fleet.care.wasCleared', { item: t(DEFECT_WORD[d.item]), who: d.decidedBy ?? '', why: d.decisionNote ?? '' }))
                .join(' · ')}
            </p>
          ) : null}

          {/* THE ODOMETER: the last reading and who gave it, any that look wrong, and one recorded by hand. */}
          <p class="field__label" style="margin-top:16px">
            {t('fleet.care.odoTitle')}
          </p>
          {care.odometer ? (
            <p class="t-body">
              {t('fleet.care.odoLast', { km: kmWords(care.odometer.km), how: t(SOURCE_WORD[care.odometer.source]), who: care.odometer.by, when: formatDate(care.odometer.at, { dateStyle: 'medium', timeStyle: 'short' }) })}
            </p>
          ) : (
            <p class="hint">{t('fleet.care.odoNone')}</p>
          )}
          {care.readings
            .filter((r) => r.doubtful)
            .slice(0, 3)
            .map((r) => (
              <p key={r.readingId} class="hint plan__win--warn">
                {t('fleet.care.odoDoubtful', { km: kmWords(r.km), who: r.by, why: r.doubtful ?? '' })}
              </p>
            ))}
          <div class="plan__tune" style="margin-top:6px">
            <div class="field">
              <label class="field__label" for="care-km">
                {t('fleet.care.odoRecord')}
              </label>
              <input id="care-km" class="input input--mono" inputMode="numeric" value={km} onInput={(e) => setKm(e.currentTarget.value)} />
            </div>
          </div>
          <label class="checkline" style="margin:6px 0 10px">
            <input type="checkbox" checked={newMeter} onChange={(e) => setNewMeter(e.currentTarget.checked)} />
            <span>{t('fleet.care.odoNewMeter')}</span>
          </label>
          <Button
            variant="outline"
            chevron={false}
            busy={busy}
            disabled={busy || !km.replace(/[^0-9]/g, '')}
            onClick={() =>
              void act(async () => {
                const r = await api!.recordReading(care.vehicleId, Number(km.replace(/[^0-9]/g, '')), newMeter);
                if (!r.error) {
                  setKm('');
                  setNewMeter(false);
                }
                return r;
              })
            }
          >
            {t('fleet.care.odoSave')}
          </Button>

          {/* TAKE IT OFF THE ROAD: why, from when, until when. What it does is said beside the button. */}
          <p class="field__label" style="margin-top:16px">
            {t('fleet.care.takeOffTitle')}
          </p>
          <div class="chips" role="radiogroup" aria-label={t('fleet.care.reasonLabel')}>
            {OFF_ROAD_REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} class={'chip chip--tap' + (reason === r ? ' chip--on' : '')} onClick={() => setReason(r)}>
                {t(REASON_WORD[r])}
              </button>
            ))}
          </div>
          <div class="plan__tune" style="margin-top:10px">
            <div class="field">
              <label class="field__label" for="care-from">
                {t('fleet.care.from')}
              </label>
              <input id="care-from" class="input" type="date" min={today} value={fromDay} onInput={(e) => setFromDay(e.currentTarget.value)} />
            </div>
            <div class="field">
              <label class="field__label" for="care-until">
                {t('fleet.care.until')}
              </label>
              <input id="care-until" class="input" type="date" min={fromDay} value={untilDay} onInput={(e) => setUntilDay(e.currentTarget.value)} />
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="care-note">
              {t('fleet.care.note')}
            </label>
            <input id="care-note" class="input" maxLength={300} value={note} placeholder={t('fleet.care.notePh')} onInput={(e) => setNote(e.currentTarget.value)} />
          </div>
          <p class="hint">{t(untilDay ? 'fleet.care.untilHint' : 'fleet.care.openHint')}</p>
          <Button chevron={false} busy={busy} disabled={busy || !fromDay} onClick={() => void takeOff()}>
            {t('fleet.care.takeOff')}
          </Button>
        </>
      )}
      <Button variant="link" onClick={onClose}>
        {t('fleet.vehicles.close')}
      </Button>
    </Sheet>
  );
}
