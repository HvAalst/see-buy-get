import { useEffect, useState } from 'preact/hooks';
import type { components } from '../../../lib/sbg/schema';
import { useT, type MessageKey } from '../../../shared/i18n';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { awbState } from '../../../shared/awb';
import { ConsoleFold } from '../ConsoleFold';
import { ConsolePick } from '../ConsolePick';
import { SitePicker } from './SitePicker';
import { animalsBody, animalsReady, EMPTY_ANIMALS, LiveAnimalsFields, type AnimalsForm } from './LiveAnimalsFields';

export type ImportAirView = components['schemas']['ImportAirView'];
type Result = Promise<{ error?: { detail?: string; title?: string } | null }>;
export interface AirAgencyRow {
  key: string;
  name: string;
  looksAt: string;
  suggestFor: string[];
}

export interface ImportByAirCalls {
  agencies(): Promise<{ data?: { items: AirAgencyRow[]; source: string } | null; error?: unknown }>;
  set(body: Record<string, unknown>): Result;
  step(body: { step: string; reference?: string; at?: string }): Result;
  anyway(body: { reason: string; waitingIsMine: boolean }): Result;
}

const utcIn = (v: string): string | undefined => {
  const at = Date.parse(`${v.trim()}${v.trim().length === 16 ? ':00' : ''}Z`);
  return v.trim() && !Number.isNaN(at) ? new Date(at).toISOString() : undefined;
};
const utc = (iso?: string) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '');
const AWB_WORD: Record<'short' | 'ok' | 'wrong', MessageKey> = { short: 'tower.byAir.awbShort', ok: 'tower.byAir.awbOk', wrong: 'tower.byAir.awbWrong' };

/**
 * AN IMPORT BY AIR (2026-10-29). The cargo waits in the handler's shed until customs, every agency the goods need and the
 * handler's delivery order have released it — notice of arrival alone is never enough. Each step is recorded here by the
 * importer or its agent, with its reference; the road leg from the shed is offered to nobody until then, unless the importer
 * sends the truck anyway. The handler's free storage is counted in hours from its notice: hours, never money.
 */
export function ImportByAir({ code, air, youAre, natureCode, destCountry, calls, onChanged, api, importerEntityId }: {
  code: string;
  /** For the importer's own places: the one the veterinary officer named, for live animals (2026-10-30). */
  api?: unknown;
  importerEntityId?: string;
  air?: ImportAirView;
  youAre: 'importer' | 'agent' | 'onlooker' | string;
  natureCode?: string;
  destCountry: string;
  calls: ImportByAirCalls;
  onChanged: () => void | Promise<void>;
}) {
  const t = useT();
  const canAct = youAre === 'importer' || youAre === 'agent';
  const [editing, setEditing] = useState(false);
  const [agencies, setAgencies] = useState<{ items: AirAgencyRow[]; source: string } | null>(null);
  const [form, setForm] = useState(() => ({
    awb: air?.awb ?? '',
    kind: (air?.waybillKind ?? 'master') as 'master' | 'house' | 'direct',
    house: air?.houseNumber ?? '',
    airline: '',
    flight: air?.flights[0]?.flight ?? '',
    date: air?.flights[0]?.date ?? '',
    from: air?.flights[0]?.from ?? '',
    to: air?.flights[0]?.to ?? '',
    arrives: air?.flights[0]?.arrivesLocal ?? '',
    handler: air?.handler ?? '',
    pieces: air ? String(air.pieces) : '',
    kg: air ? String(air.weightKg) : '',
    minC: air?.temp ? String(air.temp.minC) : '',
    maxC: air?.temp ? String(air.temp.maxC) : '',
    chosen: (air?.agencies ?? []).map((a) => a.key),
    freeHours: air?.freeHours != null ? String(air.freeHours) : '',
    source: air?.freeHoursSource ?? '',
  }));
  // Live animals (2026-10-30): the keeper's declaration, and on an import the place the veterinary officer named.
  const [withAnimals, setWithAnimals] = useState(Boolean(air?.animals));
  const [animals, setAnimals] = useState<AnimalsForm>(() => {
    const a = air?.animals;
    return a
      ? { ...EMPTY_ANIMALS, kind: a.kind as AnimalsForm['kind'], species: a.species, count: String(a.count), permit: a.permit, healthCertificate: a.healthCertificate, citesListed: Boolean(a.cites), citesPermit: a.cites ?? '', movementPermit: a.movementPermit ?? '', attendantName: a.attendant?.name ?? '', attendantPhone: a.attendant?.phone ?? '', namedOn: a.destination?.namedOn ?? '' }
      : { ...EMPTY_ANIMALS };
  });
  const [vetSite, setVetSite] = useState('');
  const [steps, setSteps] = useState<Record<string, { reference: string; at: string }>>({});
  const [reason, setReason] = useState('');
  const [mine, setMine] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAct) return;
    void calls.agencies().then((r) => {
      const data = r.data ?? null;
      setAgencies(data);
      // Never ticked for the importer: suggested by the goods, chosen by whoever knows the border.
      if (data && !air) setForm((f) => ({ ...f, chosen: f.chosen.length ? f.chosen : data.items.filter((a) => natureCode && a.suggestFor.includes(natureCode)).map((a) => a.key) }));
    });
  }, [canAct]);

  const act = async (fn: () => Result, after?: () => void) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title || '');
    after?.();
    await onChanged();
  };
  const set = (k: keyof typeof form) => (e: Event) => setForm({ ...form, [k]: (e.target as HTMLInputElement).value });
  const field = (k: keyof typeof form, label: MessageKey, extra: Record<string, string> = {}) => (
    <label class="twr-knob cfield">
      <span class="cfield__label">{t(label)}</span>
      <input class="cinput" value={String(form[k])} onInput={set(k)} {...extra} />
    </label>
  );
  const awb = awbState(form.awb);
  const ready = (!withAnimals || animalsReady(animals, 'import')) && awb === 'ok' && form.flight.trim() && form.date && form.from.trim().length === 3 && form.to.trim().length === 3 && form.handler.trim() && Number(form.pieces) > 0 && Number(form.kg) > 0 && (form.kind !== 'house' || form.house.trim());
  const save = () =>
    act(
      () =>
        calls.set({
          awb: form.awb.trim(),
          waybillKind: form.kind,
          ...(form.kind === 'house' ? { houseNumber: form.house.trim() } : {}),
          ...(form.airline.trim() ? { airline: form.airline.trim() } : {}),
          flights: [{ flight: form.flight.trim(), date: form.date, from: form.from.trim(), to: form.to.trim(), ...(form.arrives ? { arrivesLocal: form.arrives } : {}) }],
          handler: form.handler.trim(),
          pieces: Number(form.pieces),
          weightKg: Number(form.kg),
          ...(form.minC.trim() && form.maxC.trim() ? { minC: Number(form.minC), maxC: Number(form.maxC) } : {}),
          agencies: form.chosen,
          ...(form.freeHours.trim() ? { freeHours: Number(form.freeHours) } : {}),
          ...(form.source.trim() ? { freeHoursSource: form.source.trim() } : {}),
          ...(withAnimals ? { animals: animalsBody(animals, 'import', youAre === 'importer' && vetSite ? vetSite : undefined) } : {}),
        }),
      () => setEditing(false),
    );

  const clock = air?.clock;
  const clockLine = !air || !clock
    ? ''
    : clock.state === 'not_started'
      ? t(clock.freeHours != null ? 'tower.byAir.clock.notStarted' : 'tower.byAir.clock.notStartedNoHours')
      : clock.state === 'no_free_hours'
        ? t('tower.byAir.clock.noFreeHours', { handler: air.handler })
        : clock.state === 'running'
          ? t('tower.byAir.clock.running', { hours: clock.freeHours ?? 0, handler: air.handler, until: utc(clock.freeUntil) })
          : clock.state === 'due_soon'
            ? t('tower.byAir.clock.dueSoon', { handler: air.handler, until: utc(clock.freeUntil), left: clock.hoursLeft ?? 0 })
            : clock.state === 'over'
              ? t('tower.byAir.clock.over', { handler: air.handler, until: utc(clock.freeUntil) })
              : t('tower.byAir.clock.stopped', { when: utc(clock.leftAt) });
  const released = Boolean(air && !air.gaps.length);
  const hint = !air ? t('tower.byAir.fold.none') : released ? t('tower.byAir.fold.released') : air.collectAnyway ? t('tower.byAir.fold.anyway') : t('tower.byAir.fold.waiting', { n: air.gaps.length });

  /** One step of the release: done, with its reference — or, for whoever may, the reference and a button. */
  const stepRow = (key: string, label: string, done: { reference?: string; at: string; by: string } | undefined, needsRef: boolean) => {
    const draft = steps[key] ?? { reference: '', at: '' };
    return (
      <div class="crow" key={key}>
        <span class="crow__body">
          <span class="crow__top">
            <span class="crow__name"><Abbreviated text={label} /></span>
            <span class={`ctag ctag--${done ? 'ok' : 'warn'}`}>{t(done ? 'tower.byAir.done' : 'tower.byAir.notYet')}</span>
          </span>
          {done ? <span class="crow__sub">{t('tower.byAir.doneLine', { when: utc(done.at), by: done.by, reference: done.reference ?? '—' })}</span> : null}
          {canAct ? (
            <span class="twr-knobs__row">
              <input class="cinput" maxLength={60} placeholder={t(needsRef ? 'tower.byAir.refNeeded' : 'tower.byAir.refOptional')} value={draft.reference} onInput={(e) => setSteps({ ...steps, [key]: { ...draft, reference: (e.target as HTMLInputElement).value } })} />
              <input class="cinput" type="datetime-local" value={draft.at} onInput={(e) => setSteps({ ...steps, [key]: { ...draft, at: (e.target as HTMLInputElement).value } })} />
              <button
                type="button"
                class="cbtn cbtn--ghost cbtn--sm"
                disabled={busy || (needsRef && draft.reference.trim().length < 3)}
                onClick={() => void act(() => calls.step({ step: key, ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}), ...(utcIn(draft.at) ? { at: utcIn(draft.at)! } : {}) }), () => setSteps({ ...steps, [key]: { reference: '', at: '' } }))}
              >
                {t(done ? 'tower.byAir.recordAgain' : 'tower.byAir.record')}
              </button>
            </span>
          ) : null}
        </span>
      </div>
    );
  };

  return (
    <ConsoleFold title={<>{code} · {t('tower.byAir.title')}</>} hint={hint} defaultOpen={Boolean(!air || !released || clock?.state === 'due_soon' || clock?.state === 'over')}>
      <p class="cons__lede">{t('tower.byAir.lede')}</p>
      {error ? <p class="cerr">{error}</p> : null}
      {air && !editing ? (
        <>
          <p class="cons__lede">{t('tower.byAir.held', { awb: air.awb, airline: air.airline, flights: air.flights.map((f) => `${f.flight} ${f.date} ${f.from}→${f.to}`).join('; '), handler: air.handler, pieces: air.pieces, kg: air.weightKg })}</p>
          {air.temp ? <p class="chint">{t('tower.byAir.temp', { min: air.temp.minC ?? '', max: air.temp.maxC ?? '' })}</p> : null}
          {air.animals ? (
            <p class="chint">
              <span class="ctag ctag--warn">{t('tower.animals.tag')}</span>{' '}
              {t(air.animals.destination ? 'tower.animals.held' : 'tower.animals.heldNoPlace', { count: air.animals.count, species: air.animals.species, place: air.animals.destination?.label ?? '', namedOn: air.animals.destination?.namedOn ?? '', by: air.animals.fitToTravel.by ?? '' })}
            </p>
          ) : null}
          {(air.warnings ?? []).map((w, i) => (
            <p class="cerr" key={`w${i}`}>
              <Abbreviated text={w} />
            </p>
          ))}
          {air.roadWaits ? <p class="chint"><span class="ctag ctag--warn">{t('tower.byAir.waits')}</span> {air.roadWaits}</p> : released ? <p class="chint"><span class="ctag ctag--ok">{t('tower.byAir.releasedTag')}</span> {t('tower.byAir.releasedLine')}</p> : null}
          {air.collectAnyway ? <p class="chint">{t('tower.byAir.anywaySaid', { by: air.collectAnyway.by ?? '', when: utc(air.collectAnyway.at), reason: air.collectAnyway.reason ?? '' })}</p> : null}
          <p class={clock?.state === 'due_soon' || clock?.state === 'over' ? 'cerr' : 'chint'}>{clockLine}{air.freeHoursSource ? ` ${t('tower.byAir.clock.source', { source: air.freeHoursSource })}` : ''}</p>
          <h3 class="cons__sub">{t('tower.byAir.stepsTitle')}</h3>
          <div class="crows">
            {stepRow('notified', t('tower.byAir.step.notified'), air.notified, false)}
            {stepRow('customs', t('tower.byAir.step.customs'), air.customs, true)}
            {air.agencies.map((a) => stepRow(a.key, a.name, a.released, false))}
            {stepRow('delivery_order', t('tower.byAir.step.deliveryOrder'), air.deliveryOrder, true)}
          </div>
          <p class="chint">{t('tower.byAir.notifiedNote')}</p>
          {youAre === 'importer' && air.gaps.length && !air.collectAnyway ? (
            <>
              <h3 class="cons__sub">{t('tower.byAir.anywayTitle')}</h3>
              <p class="chint">{t('tower.byAir.anywayHint')}</p>
              <div class="twr-knobs__row">
                <label class="twr-knob cfield">
                  <span class="cfield__label">{t('tower.byAir.f.reason')}</span>
                  <input class="cinput" maxLength={300} value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
                </label>
              </div>
              <label class="cfield--check">
                <input type="checkbox" checked={mine} onChange={() => setMine(!mine)} />
                <span>{t('tower.byAir.f.waitingIsMine')}</span>
              </label>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || reason.trim().length < 5 || !mine} onClick={() => void act(() => calls.anyway({ reason: reason.trim(), waitingIsMine: true }))}>
                  {t('tower.byAir.sendAnyway')}
                </button>
              </div>
            </>
          ) : null}
          <h3 class="cons__sub">{t('tower.byAir.lawTitle')}</h3>
          <p class="chint"><Abbreviated text={air.check.rules ?? t('tower.byAir.lawUnread')} /></p>
          {(air.check.limits ?? []).map((l, i) => <p class="chint" key={i}><Abbreviated text={l} /></p>)}
          {canAct ? (
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setEditing(true)}>{t('tower.byAir.change')}</button>
            </div>
          ) : null}
        </>
      ) : canAct ? (
        <>
          <p class="chint">{t('tower.byAir.formHint')}</p>
          <div class="twr-knobs__row">
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.byAir.f.awb')}</span>
              <input class="cinput" value={form.awb} onInput={set('awb')} maxLength={16} placeholder="074-12345675" inputMode="numeric" />
              {awb !== 'empty' ? <span class={awb === 'wrong' ? 'cerr' : 'chint'}>{t(AWB_WORD[awb])}</span> : null}
            </label>
            {field('airline', 'tower.byAir.f.airline', { maxLength: '80' })}
          </div>
          <div class="twr-knobs__row">
            <div class="twr-knob">
              <ConsolePick label={t('tower.byAir.f.kind')} value={form.kind} options={(['master', 'direct', 'house'] as const).map((k) => ({ value: k, label: t(`tower.byAir.kind.${k}`) }))} onChange={(v) => setForm({ ...form, kind: v as 'master' | 'house' | 'direct' })} />
            </div>
            {form.kind === 'house' ? field('house', 'tower.byAir.f.house', { maxLength: '40' }) : null}
          </div>
          <div class="twr-knobs__row">
            {field('flight', 'tower.byAir.f.flight', { maxLength: '10', placeholder: 'KL 565' })}
            {field('date', 'tower.byAir.f.date', { type: 'date' })}
          </div>
          <div class="twr-knobs__row">
            {field('from', 'tower.byAir.f.from', { maxLength: '3', placeholder: 'AMS' })}
            {field('to', 'tower.byAir.f.to', { maxLength: '3', placeholder: 'NBO' })}
            {field('arrives', 'tower.byAir.f.arrives', { type: 'time' })}
          </div>
          <div class="twr-knobs__row">
            {field('handler', 'tower.byAir.f.handler', { maxLength: '80' })}
          </div>
          <div class="twr-knobs__row">
            {field('pieces', 'tower.byAir.f.pieces', { type: 'number', min: '1' })}
            {field('kg', 'tower.byAir.f.kg', { type: 'number', min: '0.1', step: '0.1' })}
          </div>
          <div class="twr-knobs__row">
            {field('minC', 'tower.byAir.f.minC', { type: 'number', step: '0.5' })}
            {field('maxC', 'tower.byAir.f.maxC', { type: 'number', step: '0.5' })}
          </div>
          <h3 class="cons__sub">{t('tower.byAir.agenciesTitle', { country: destCountry })}</h3>
          {agencies?.items.length ? (
            <>
              {agencies.items.map((a) => (
                <label class="cfield--check" key={a.key}>
                  <input type="checkbox" checked={form.chosen.includes(a.key)} onChange={() => setForm({ ...form, chosen: form.chosen.includes(a.key) ? form.chosen.filter((k) => k !== a.key) : [...form.chosen, a.key] })} />
                  <span>
                    <Abbreviated text={a.name} /> — {a.looksAt}
                  </span>
                </label>
              ))}
              <p class="chint">{t('tower.byAir.agenciesHint', { source: agencies.source })}</p>
            </>
          ) : (
            <p class="chint">{t('tower.byAir.agenciesNone', { country: destCountry })}</p>
          )}
          <label class="cfield--check">
            <input type="checkbox" checked={withAnimals} onChange={() => setWithAnimals(!withAnimals)} />
            <span>{t('tower.animals.f.with')}</span>
          </label>
          {withAnimals ? (
            <LiveAnimalsFields
              value={animals}
              onChange={setAnimals}
              side="import"
              placeSlot={
                youAre === 'importer' && importerEntityId ? (
                  <>
                    <div class="twr-knobs__row">
                      <div class="twr-knob">
                        <SitePicker kind="delivery" entityId={importerEntityId} api={api as never} value={vetSite} onChange={setVetSite} label={t('tower.animals.f.vetPlace')} addLabel={t('tower.sites.addDelivery')} />
                      </div>
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.animals.f.namedOn')}</span>
                        <input class="cinput" maxLength={120} value={animals.namedOn} onInput={(e) => setAnimals({ ...animals, namedOn: (e.target as HTMLInputElement).value })} />
                      </label>
                    </div>
                    <p class="chint">{t(air?.animals?.destination ? 'tower.animals.vetPlaceKept' : 'tower.animals.vetPlaceHint', { place: air?.animals?.destination?.label ?? '' })}</p>
                  </>
                ) : (
                  <p class="chint">{t('tower.animals.vetPlaceImporter')}</p>
                )
              }
            />
          ) : null}
          <div class="twr-knobs__row">
            {field('freeHours', 'tower.byAir.f.freeHours', { type: 'number', min: '0', max: '720' })}
            {field('source', 'tower.byAir.f.source', { maxLength: '160' })}
          </div>
          <p class="chint">{t(destCountry === 'KE' ? 'tower.byAir.freeHint.KE' : 'tower.byAir.freeHint')}</p>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || !ready} onClick={() => void save()}>{t('tower.byAir.save')}</button>
            {air ? <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setEditing(false)}>{t('tower.byAir.cancel')}</button> : null}
          </div>
        </>
      ) : (
        <p class="chint">{t('tower.byAir.noneYet')}</p>
      )}
    </ConsoleFold>
  );
}
