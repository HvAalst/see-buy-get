import { useEffect, useMemo, useState } from 'preact/hooks';
import { AuthImage, Button, Card, ErrorNote, Pill, PlaceMap } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import type { Result, SbgClient } from '../../../lib/sbg';
import { BREAKDOWN_CAUSES, CAUSE_WORD, careApi, whereWords, type BreakdownCause, type BreakdownTaker, type CareApi, type VehicleBreakdown, type VehicleCare } from '../care';

/**
 * A VEHICLE BROKEN DOWN, on its upkeep sheet: what happened, who was out in it, where (on a map), what was aboard and
 * which of today's trips were held — and the office's word on how it ended: back on the road, or into the workshop,
 * always with what was done.
 */
export function OpenBreakdown({ care, api, act, busy }: { care: VehicleCare; api: CareApi; act: (call: () => Promise<Result<VehicleCare>>) => Promise<void>; busy: boolean }) {
  const t = useT();
  // Open — or resolved, with loads still waiting with the driver it broke down under.
  const open = care.breakdowns.find((b) => b.status === 'open' || b.stillAboard.length > 0);
  const [outcome, setOutcome] = useState<'back_on_road' | 'workshop' | null>(null);
  const [note, setNote] = useState('');
  const [untilDay, setUntilDay] = useState('');
  const [takers, setTakers] = useState<BreakdownTaker[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!open) return null;
  const findTakers = async () => {
    setError(null);
    const r = await api.takers(care.vehicleId, open.breakdownId);
    if (r.error || !r.data) return setError(r.error);
    setTakers(r.data);
  };
  const moveTo = (driverDid: string) =>
    act(async () => {
      const r = await api.handOver(care.vehicleId, open.breakdownId, driverDid);
      if (!r.error) setTakers(null);
      return r;
    });
  const resolve = () =>
    act(async () => {
      const r = await api.resolveBreakdown(care.vehicleId, open.breakdownId, { outcome: outcome!, note: note.trim(), ...(outcome === 'workshop' && untilDay ? { untilDay } : {}) });
      if (!r.error) {
        setOutcome(null);
        setNote('');
        setUntilDay('');
      }
      return r;
    });

  return (
    <>
      <p class="field__label" style="margin-top:16px">
        {t('fleet.brk.title')}
      </p>
      <div class="row row--static">
        <span class="row__body">
          <span class="row__t">
            {t(CAUSE_WORD[open.cause])}: “{open.note}”
          </span>
          <span class="row__s">{t('fleet.brk.reported', { who: open.reportedBy, when: formatDate(open.reportedAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
          {open.driverName && open.driverName !== open.reportedBy ? <span class="row__s">{t('fleet.brk.driver', { who: open.driverName })}</span> : null}
          <span class="row__s">{whereWords(open, t)}</span>
          <span class="row__s">{open.aboard.length ? t('fleet.brk.aboard', { n: open.aboard.length, list: open.aboard.map((l) => l.label).join(', ') }) : t('fleet.brk.nothingAboard')}</span>
          {open.held.length ? <span class="row__s row__s--warn">{t('fleet.brk.held', { n: open.held.length, codes: open.held.join(', ') })}</span> : null}
          {open.handovers.map((h) => (
            <span key={h.at} class="row__s">
              {t(h.proof === 'pass' ? 'fleet.brk.handedByPass' : 'fleet.brk.handedByOffice', { who: h.toDriverName, plate: h.toPlate, when: formatDate(h.at, { dateStyle: 'medium', timeStyle: 'short' }), by: h.by, loads: h.loads.join(', ') })}
            </span>
          ))}
          {open.stillAboard.length && open.handovers.length ? <span class="row__s row__s--warn">{t('fleet.brk.stillAboard', { list: open.stillAboard.join(', ') })}</span> : null}
          {open.hasPhoto ? <AuthImage mediaId={`${care.vehicleId}|${open.breakdownId}`} load={api.breakdownPhoto} alt={t('fleet.brk.photoAlt', { plate: care.plate })} class="photos__thumb photos__thumb--sm" /> : null}
        </span>
        <span class="row__end">
          <Pill tone={open.status === 'open' ? 'danger' : 'warn'} dot>
            {t(open.status === 'open' ? 'fleet.brk.pill' : 'fleet.brk.pillWaiting')}
          </Pill>
        </span>
      </div>
      {open.location ? <PlaceMap pins={[{ id: open.breakdownId, label: care.plate, point: open.location, tone: 'warn' }]} label={t('fleet.brk.mapAria', { plate: care.plate })} /> : null}
      {error ? <ErrorNote error={error as never} showDetail /> : null}
      {/* ITS LOADS, to another of the fleet's vehicles: usually the drivers do it between them, with the code; the office when they cannot. */}
      {open.stillAboard.length ? (
        takers ? (
          <>
            <p class="field__label" style="margin-top:12px">
              {t('fleet.brk.moveTitle')}
            </p>
            {takers.length === 0 ? <p class="hint">{t('fleet.brk.noTakers')}</p> : null}
            <ul class="rows">
              {takers.map((k) => (
                <li key={k.driverDid} class="row row--static">
                  <span class="row__body">
                    <span class="row__t">
                      {k.plate} · {k.driverName}
                    </span>
                    <span class="row__s">{t('fleet.brk.room', { kg: k.roomKg.toLocaleString() })}</span>
                  </span>
                  <span class="row__end">
                    <Button variant="link" full={false} disabled={busy} onClick={() => void moveTo(k.driverDid)}>
                      {t('fleet.brk.moveHere')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <p class="hint">{t('fleet.brk.moveHint')}</p>
            <Button variant="link" full={false} onClick={() => setTakers(null)}>
              {t('fleet.care.cancel')}
            </Button>
          </>
        ) : (
          <>
            <p class="hint">{t('fleet.brk.takeOverHint')}</p>
            <Button variant="link" full={false} onClick={() => void findTakers()}>
              {t('fleet.brk.move')}
            </Button>
          </>
        )
      ) : null}
      {open.status !== 'open' ? null : outcome ? (
        <>
          <div class="field" style="margin-top:10px">
            <label class="field__label" for="brk-note">
              {t(outcome === 'workshop' ? 'fleet.brk.workshopNote' : 'fleet.brk.backNote')}
            </label>
            <input id="brk-note" class="input" maxLength={300} value={note} placeholder={t(outcome === 'workshop' ? 'fleet.brk.workshopPh' : 'fleet.brk.backPh')} onInput={(e) => setNote(e.currentTarget.value)} />
          </div>
          {outcome === 'workshop' ? (
            <div class="field">
              <label class="field__label" for="brk-until">
                {t('fleet.care.until')}
              </label>
              <input id="brk-until" class="input" type="date" min={care.today} value={untilDay} onInput={(e) => setUntilDay(e.currentTarget.value)} />
            </div>
          ) : null}
          <p class="hint">{t(outcome === 'workshop' ? 'fleet.brk.workshopHint' : 'fleet.brk.backHint')}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <Button full={false} chevron={false} busy={busy} disabled={busy || !note.trim()} onClick={() => void resolve()}>
              {t(outcome === 'workshop' ? 'fleet.brk.saveWorkshop' : 'fleet.brk.saveBack')}
            </Button>
            <Button variant="link" full={false} onClick={() => setOutcome(null)}>
              {t('fleet.care.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <span style="display:flex;gap:2px 16px;flex-wrap:wrap">
          <Button variant="link" full={false} onClick={() => { setOutcome('back_on_road'); setNote(''); }}>
            {t('fleet.brk.back')}
          </Button>
          <Button variant="link" full={false} onClick={() => { setOutcome('workshop'); setNote(''); }}>
            {t('fleet.brk.workshop')}
          </Button>
        </span>
      )}
    </>
  );
}

/**
 * RECORD A BREAKDOWN the office heard of by telephone — the shippers of what is aboard are told, and today's trips for
 * it held, as when the driver reports it — and the breakdowns of the last month, with how each ended.
 */
export function RecordBreakdown({ care, api, act, busy }: { care: VehicleCare; api: CareApi; act: (call: () => Promise<Result<VehicleCare>>) => Promise<void>; busy: boolean }) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [cause, setCause] = useState<BreakdownCause | null>(null);
  const [note, setNote] = useState('');
  const open = care.breakdowns.some((b) => b.status === 'open');
  const past = care.breakdowns.filter((b) => b.status === 'resolved');
  const record = () =>
    act(async () => {
      const r = await api.recordBreakdown(care.vehicleId, { cause: cause!, note: note.trim() });
      if (!r.error) {
        setRecording(false);
        setCause(null);
        setNote('');
      }
      return r;
    });

  return (
    <>
      {past.length ? (
        <p class="hint">
          {past
            .map((b) => t(b.outcome === 'workshop' ? 'fleet.brk.wasWorkshop' : 'fleet.brk.wasBack', { day: formatDate(b.reportedAt, { dateStyle: 'medium' }), cause: t(CAUSE_WORD[b.cause]), why: b.resolutionNote ?? '' }))
            .join(' · ')}
        </p>
      ) : null}
      {open ? null : recording ? (
        <>
          <div class="chips" role="radiogroup" aria-label={t('fleet.brk.whatBroke')}>
            {BREAKDOWN_CAUSES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={cause === c} class={'chip chip--tap' + (cause === c ? ' chip--on' : '')} onClick={() => setCause(c)}>
                {t(CAUSE_WORD[c])}
              </button>
            ))}
          </div>
          <div class="field" style="margin-top:10px">
            <label class="field__label" for="brk-what">
              {t('fleet.brk.whatHappened')}
            </label>
            <input id="brk-what" class="input" maxLength={300} value={note} placeholder={t('fleet.brk.whatPh')} onInput={(e) => setNote(e.currentTarget.value)} />
          </div>
          <p class="hint">{t('fleet.brk.recordHint')}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <Button full={false} chevron={false} busy={busy} disabled={busy || !cause || !note.trim()} onClick={() => void record()}>
              {t('fleet.brk.recordSave')}
            </Button>
            <Button variant="link" full={false} onClick={() => setRecording(false)}>
              {t('fleet.care.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <Button variant="link" full={false} onClick={() => setRecording(true)}>
          {t('fleet.brk.record')}
        </Button>
      )}
    </>
  );
}

/**
 * BROKEN DOWN NOW, at the top of the office's vehicles: each one, where it is on a map, who is out with it and what
 * is aboard — a tap from its upkeep sheet, where the office says how it ended. Nothing at all when nothing is broken down.
 */
export function BrokenDownCard({ sbg, fleetDid, reload, onOpen }: { sbg: SbgClient | null; fleetDid: string | undefined; reload: number; onOpen: (vehicleId: string) => void }) {
  const t = useT();
  const api = useMemo(() => (sbg ? careApi(sbg) : null), [sbg]);
  const [list, setList] = useState<VehicleBreakdown[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!api || !fleetDid) return;
    void api.fleetBreakdowns(fleetDid).then((r) => (r.error || !r.data ? setError(r.error) : (setError(null), setList(r.data))));
  }, [api, fleetDid, reload]);
  if (error) return <ErrorNote error={error as never} />;
  if (!list.length) return null;
  const pins = list.filter((b) => b.location).map((b) => ({ id: b.vehicleId, label: b.plate, point: b.location!, tone: 'warn' as const }));
  return (
    <Card title={t('fleet.brk.cardTitle', { n: list.length })}>
      {pins.length ? <PlaceMap pins={pins} onPick={onOpen} label={t('fleet.brk.cardMapAria', { n: pins.length })} /> : null}
      <ul class="rows">
        {list.map((b) => (
          <li key={b.breakdownId} class="row row--static">
            <span class="row__body">
              <span class="row__t">{b.plate}</span>
              <span class="row__s">
                {t(CAUSE_WORD[b.cause])}: “{b.note}”
              </span>
              <span class="row__s">{t('fleet.brk.reported', { who: b.driverName ?? b.reportedBy, when: formatDate(b.reportedAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
              <span class="row__s">{whereWords(b, t)}</span>
              {b.aboard.length ? <span class="row__s">{t('fleet.brk.aboard', { n: b.aboard.length, list: b.aboard.map((l) => l.label).join(', ') })}</span> : null}
            </span>
            <span class="row__end">
              <Button variant="link" full={false} onClick={() => onOpen(b.vehicleId)}>
                {t('fleet.vehicles.careBtn')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
