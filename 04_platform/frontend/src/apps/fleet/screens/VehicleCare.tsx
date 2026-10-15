import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, ErrorNote, Note, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { Result, SbgClient } from '../../../lib/sbg';
import { OFF_ROAD_REASONS, REASON_WORD, careApi, localDay, spellBegun, spellSpan, type OffRoadReason, type VehicleCare } from '../care';
import type { VehicleRow } from '../types';

/**
 * A VEHICLE'S UPKEEP, in one sheet under the vehicle's name: whether it can go out and every reason it cannot, its
 * spells off the road (now and to come), and taking it off — with a reason, from a day, until a day or until it is put
 * back. Whatever is saved here is what the plan, the driver's list and the shift start read.
 */
export function VehicleCareSheet({ vehicle, sbg, onClose, onChanged }: { vehicle: VehicleRow | null; sbg: SbgClient | null; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const t = useT();
  const api = useMemo(() => (sbg ? careApi(sbg) : null), [sbg]);
  const [care, setCare] = useState<VehicleCare | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const today = localDay();
  const [reason, setReason] = useState<OffRoadReason>('repair');
  const [fromDay, setFromDay] = useState(today);
  const [untilDay, setUntilDay] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    setCare(null);
    setError(null);
    if (!vehicle || !api) return;
    void api.care(vehicle.vehicleId).then((r) => (r.error || !r.data ? setError(r.error) : setCare(r.data)));
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
