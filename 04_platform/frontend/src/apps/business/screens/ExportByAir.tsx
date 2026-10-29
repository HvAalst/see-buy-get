import { useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { useT, type MessageKey } from '../../../shared/i18n';
import { ConsolePick } from '../../tower/ConsolePick';
import { SitePicker } from '../../tower/screens/SitePicker';
import type { BusinessClient, BusinessView } from '../api';
import { fromUtcInput, utcWords, type ExportDetail, type ExportFlight } from '../exports';
import { awbState } from '../../../shared/awb';

type Problem = { detail?: string; title: string } | null | undefined;
const sayProblem = (e: Problem) => (e ? e.detail || e.title : null);

export { awbState } from '../../../shared/awb';

const AWB_WORD: Record<'short' | 'ok' | 'wrong', MessageKey> = {
  short: 'business.exports.air.awbShort',
  ok: 'business.exports.air.awbOk',
  wrong: 'business.exports.air.awbWrong',
};

const blankFlight = (): ExportFlight & { departsLocal: string } => ({ flight: '', date: '', from: '', to: '', departsLocal: '' });

/**
 * AN EXPORT BY AIR (2026-10-29): copied off the airline's booking confirmation — the waybill, the flights, the latest
 * acceptance time our truck must beat, the cargo as booked, who secured it, the range chilled goods are kept in. SeeBuyGet
 * books no flight and issues no waybill: it carries the road to the cargo terminal.
 */
export function RegisterAirExport({ business, client, onDone }: { business: BusinessView; client: BusinessClient; onDone: (exportId?: string) => void | Promise<void> }) {
  const t = useT();
  const [form, setForm] = useState({
    goods: '',
    from: business.country ?? '',
    to: '',
    nature: '' as '' | 'FOP',
    bookedWith: 'forwarder' as 'forwarder' | 'airline',
    party: '',
    awb: '',
    kind: 'master' as 'master' | 'house' | 'direct',
    house: '',
    airline: '',
    status: 'confirmed' as 'confirmed' | 'queued',
    lat: '',
    pieces: '',
    kg: '',
    m3: '',
    handler: '',
    security: 'unsecured' as 'unsecured' | 'secured',
    agentName: '',
    agentNumber: '',
    minC: '2',
    maxC: '8',
    preCooled: false,
    inspection: false,
  });
  const [flights, setFlights] = useState([blankFlight()]);
  const [sites, setSites] = useState({ loading: '', terminal: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: Event) => setForm({ ...form, [k]: (e.target as HTMLInputElement).value });
  const awb = awbState(form.awb);
  const flightsGiven = flights.filter((f) => f.flight.trim() && f.date && f.from.trim() && f.to.trim());

  const send = async () => {
    setBusy(true);
    setError(null);
    const r = await client.exports.registerAir({
      goodsDescription: form.goods.trim(),
      originCountry: form.from.trim(),
      destCountry: form.to.trim(),
      ...(form.nature ? { natureCode: form.nature } : {}),
      bookedWith: form.bookedWith,
      partyName: form.party.trim(),
      loadingSiteId: sites.loading,
      terminalSiteId: sites.terminal,
      air: {
        awb: form.awb.trim(),
        waybillKind: form.kind,
        ...(form.kind === 'house' && form.house.trim() ? { houseNumber: form.house.trim() } : {}),
        ...(form.airline.trim() ? { airline: form.airline.trim() } : {}),
        bookingStatus: form.status,
        flights: flightsGiven.map((f) => ({ flight: f.flight.trim(), date: f.date, from: f.from.trim(), to: f.to.trim(), ...(f.departsLocal ? { departsLocal: f.departsLocal } : {}) })),
        latAt: fromUtcInput(form.lat) ?? '',
        pieces: Number(form.pieces),
        weightKg: Number(form.kg),
        ...(Number(form.m3) > 0 ? { volumeM3: Number(form.m3) } : {}),
        ...(form.handler.trim() ? { handler: form.handler.trim() } : {}),
        security: form.security === 'secured' ? { status: 'secured', agentName: form.agentName.trim(), ...(form.agentNumber.trim() ? { agentNumber: form.agentNumber.trim() } : {}) } : { status: 'unsecured' },
        ...(form.nature === 'FOP' ? { temp: { minC: Number(form.minC), maxC: Number(form.maxC), ...(form.preCooled ? { preCooled: true } : {}) } } : {}),
        ...(form.inspection ? { inspectionAtAirport: true } : {}),
      },
    });
    setBusy(false);
    if (r.error) return setError(sayProblem(r.error));
    await onDone(r.data?.exportId);
  };

  const field = (k: keyof typeof form, label: MessageKey, extra: Record<string, string> = {}) => (
    <label class="cfield">
      <span class="cfield__label">{t(label)}</span>
      <input class="cinput" value={String(form[k])} onInput={set(k)} {...extra} />
    </label>
  );
  const setFlight = (i: number, patch: Partial<ExportFlight>) => setFlights(flights.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const api = client.api as never;
  const ready = form.goods.trim() && form.party.trim() && awb === 'ok' && flightsGiven.length && fromUtcInput(form.lat) && Number(form.pieces) > 0 && Number(form.kg) > 0 && sites.loading && sites.terminal && (form.kind !== 'house' || form.house.trim()) && (form.security !== 'secured' || form.agentName.trim()) && (form.nature !== 'FOP' || Number(form.minC) < Number(form.maxC));

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.exports.air.title')}</span>
      </div>
      <p class="chint">{t('business.exports.air.hint')}</p>
      {field('goods', 'business.exports.f.goods', { maxLength: '300' })}
      <div class="biz-two">
        {field('from', 'business.exports.f.from', { maxLength: '2', placeholder: 'KE' })}
        {field('to', 'business.exports.f.to', { maxLength: '2', placeholder: 'NL' })}
      </div>
      <ConsolePick
        label={t('business.exports.air.nature')}
        value={form.nature}
        options={[
          { value: '', label: t('business.exports.air.general') },
          { value: 'FOP', label: t('business.exports.air.perishable') },
        ]}
        onChange={(v) => setForm({ ...form, nature: v as '' | 'FOP' })}
      />
      <p class="chint">{t('business.exports.air.notYet')}</p>
      {form.nature === 'FOP' ? (
        <>
          <div class="biz-two">
            {field('minC', 'business.exports.air.minC', { type: 'number', step: '0.5' })}
            {field('maxC', 'business.exports.air.maxC', { type: 'number', step: '0.5' })}
          </div>
          <label class="cfield--check">
            <input type="checkbox" checked={form.preCooled} onChange={() => setForm({ ...form, preCooled: !form.preCooled })} />
            <span>{t('business.exports.air.preCooled')}</span>
          </label>
        </>
      ) : null}

      <h3 class="cons__sub">{t('business.exports.air.bookingTitle')}</h3>
      <p class="chint">{t('business.exports.air.bookingHint')}</p>
      <div class="biz-two">
        <ConsolePick
          label={t('business.exports.f.bookedWith')}
          value={form.bookedWith}
          options={[
            { value: 'forwarder', label: t('business.exports.f.forwarder') },
            { value: 'airline', label: t('business.exports.air.anAirline') },
          ]}
          onChange={(v) => setForm({ ...form, bookedWith: v as 'forwarder' | 'airline' })}
        />
        {field('party', 'business.exports.f.party', { maxLength: '120' })}
      </div>
      <div class="biz-two">
        <label class="cfield">
          <span class="cfield__label">{t('business.exports.air.awb')}</span>
          <input class="cinput" value={form.awb} onInput={set('awb')} maxLength={16} placeholder="706-12345675" inputMode="numeric" />
          {awb !== 'empty' ? <span class={awb === 'wrong' ? 'cerr' : 'chint'}>{t(AWB_WORD[awb])}</span> : null}
        </label>
        {field('airline', 'business.exports.air.airline', { maxLength: '80' })}
      </div>
      <ConsolePick
        label={t('business.exports.air.kind')}
        value={form.kind}
        options={(['master', 'direct', 'house'] as const).map((k) => ({ value: k, label: t(`business.exports.air.kind.${k}`) }))}
        onChange={(v) => setForm({ ...form, kind: v as 'master' | 'house' | 'direct' })}
      />
      {form.kind === 'house' ? field('house', 'business.exports.air.house', { maxLength: '40' }) : null}
      <ConsolePick
        label={t('business.exports.air.status')}
        value={form.status}
        options={[
          { value: 'confirmed', label: t('business.exports.air.confirmed') },
          { value: 'queued', label: t('business.exports.air.queued') },
        ]}
        onChange={(v) => setForm({ ...form, status: v as 'confirmed' | 'queued' })}
      />
      {form.status === 'queued' ? <p class="cerr">{t('business.exports.air.queuedWarn')}</p> : null}

      <h3 class="cons__sub">{t('business.exports.air.flightsTitle')}</h3>
      {flights.map((f, i) => (
        <div key={i}>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.air.flight')}</span>
              <input class="cinput" value={f.flight} maxLength={10} placeholder="KQ 112" onInput={(e) => setFlight(i, { flight: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.air.date')}</span>
              <input class="cinput" type="date" value={f.date} onInput={(e) => setFlight(i, { date: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.air.fromAirport')}</span>
              <input class="cinput" value={f.from} maxLength={3} placeholder="NBO" onInput={(e) => setFlight(i, { from: (e.target as HTMLInputElement).value.toUpperCase() })} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.air.toAirport')}</span>
              <input class="cinput" value={f.to} maxLength={3} placeholder="AMS" onInput={(e) => setFlight(i, { to: (e.target as HTMLInputElement).value.toUpperCase() })} />
            </label>
          </div>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.air.departs')}</span>
              <input class="cinput" type="time" value={f.departsLocal} onInput={(e) => setFlight(i, { departsLocal: (e.target as HTMLInputElement).value })} />
            </label>
            {flights.length > 1 ? (
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setFlights(flights.filter((_, j) => j !== i))}>
                  {t('business.exports.air.removeFlight')}
                </button>
              </div>
            ) : (
              <span />
            )}
          </div>
        </div>
      ))}
      {flights.length < 6 ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setFlights([...flights, blankFlight()])}>
            {t('business.exports.air.addFlight')}
          </button>
        </div>
      ) : null}
      <div class="biz-two">
        {field('lat', 'business.exports.air.lat', { type: 'datetime-local' })}
        {field('handler', 'business.exports.air.handler', { maxLength: '80' })}
      </div>
      <p class="chint"><Abbreviated text={t('business.exports.air.latHint')} /></p>

      <h3 class="cons__sub">{t('business.exports.air.cargoTitle')}</h3>
      <div class="biz-two">
        {field('pieces', 'business.exports.air.pieces', { type: 'number', min: '1' })}
        {field('kg', 'business.exports.air.kg', { type: 'number', min: '0.1', step: '0.1' })}
      </div>
      {field('m3', 'business.exports.air.m3', { type: 'number', min: '0', step: '0.01' })}
      <ConsolePick
        label={t('business.exports.air.security')}
        value={form.security}
        options={[
          { value: 'unsecured', label: t('business.exports.air.unsecured') },
          { value: 'secured', label: t('business.exports.air.secured') },
        ]}
        onChange={(v) => setForm({ ...form, security: v as 'unsecured' | 'secured' })}
      />
      {form.security === 'secured' ? (
        <>
          <div class="biz-two">
            {field('agentName', 'business.exports.air.agentName', { maxLength: '120' })}
            {field('agentNumber', 'business.exports.air.agentNumber', { maxLength: '40' })}
          </div>
          <p class="chint">{t('business.exports.air.securedHint')}</p>
        </>
      ) : (
        <p class="chint">{t('business.exports.air.unsecuredHint')}</p>
      )}
      <label class="cfield--check">
        <input type="checkbox" checked={form.inspection} onChange={() => setForm({ ...form, inspection: !form.inspection })} />
        <span>{t('business.exports.air.inspection')}</span>
      </label>

      <h3 class="cons__sub">{t('business.exports.f.placesTitle')}</h3>
      <SitePicker kind="loading" entityId={business.entityId} api={api} value={sites.loading} onChange={(loading) => setSites({ ...sites, loading })} label={t('business.exports.air.loading')} addLabel={t('business.exports.f.addPlace')} />
      <SitePicker kind="port" entityId={business.entityId} api={api} value={sites.terminal} onChange={(terminal) => setSites({ ...sites, terminal })} label={t('business.exports.air.terminal')} addLabel={t('business.exports.f.addPlace')} />
      {error ? <p class="cerr">{error}</p> : null}
      <div class="twr-panelend">
        <button type="button" class="cbtn cbtn--primary" disabled={busy || !ready} onClick={() => void send()}>
          {t('business.exports.f.save')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={() => void onDone()}>
          {t('business.exports.notNow')}
        </button>
      </div>
    </section>
  );
}

const REGIME_WORD: Record<string, MessageKey> = {
  none: 'business.exports.air.regime.none',
  domestic: 'business.exports.air.regime.domestic',
  unknown: 'business.exports.air.regime.unknown',
};

/**
 * THE AIR WAYBILL, READ: the booking as copied, the law of its route on the waybill's day, what that law asks and it lacks,
 * where it disagrees with the packing list, and what the exporter is warned of. Held and checked — never issued.
 */
export function AirWaybillPanel({ d, client, mine, onDetail }: { d: ExportDetail; client?: BusinessClient; mine?: boolean; onDetail?: (next: ExportDetail) => void | Promise<void> }) {
  const t = useT();
  const a = d.consignment.air;
  const view = d.air;
  const [moving, setMoving] = useState(false);
  const [next, setNext] = useState({ flight: '', date: '', from: '', to: '', lat: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!a || !view) return null;
  /** The booking changed: the airline's word, recorded by the exporter — the old booking is kept. */
  const change = async (body: Parameters<BusinessClient['exports']['airBooking']>[1], note: string) => {
    if (!client) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const r = await client.exports.airBooking(d.consignment.exportId, body);
    setBusy(false);
    if (r.error) return setError(sayProblem(r.error));
    setMoving(false);
    setDone(note);
    if (r.data && onDetail) await onDetail(r.data);
  };
  const nextReady = next.flight.trim() && next.date && next.from.trim().length === 3 && next.to.trim().length === 3 && fromUtcInput(next.lat);
  const check = view.check;
  const fact = (k: MessageKey, v: string) => (
    <div class="cons__fact">
      <dt class="cons__factk">{t(k)}</dt>
      <dd class="cons__factv">{v}</dd>
    </div>
  );
  const lines = (title: MessageKey, items: string[], tone: 'chint' | 'cerr' = 'chint') =>
    items.length ? (
      <>
        <h3 class="cons__sub">{t(title)}</h3>
        {items.map((s, i) => (
          <p class={tone} key={i}>
            <Abbreviated text={s} />
          </p>
        ))}
      </>
    ) : null;
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.exports.air.panelTitle')}</span>
        <span class={`ctag ctag--${a.bookingStatus === 'queued' ? 'warn' : 'ok'}`}>{t(a.bookingStatus === 'queued' ? 'business.exports.air.tagQueued' : 'business.exports.air.tagConfirmed')}</span>
      </div>
      <dl class="cons__facts">
        {fact('business.exports.air.d.awb', `${a.awb} — ${a.airline}${check.airline ? '' : ` (${t('business.exports.air.d.asGiven')})`}`)}
        {a.houseNumber ? fact('business.exports.air.d.house', a.houseNumber) : null}
        {fact('business.exports.air.d.kind', t(`business.exports.air.kind.${a.waybillKind}`))}
        {fact('business.exports.air.d.flights', a.flights.map((f) => `${f.flight} ${f.date} ${f.from}→${f.to}${f.departsLocal ? ` ${f.departsLocal}` : ''}`).join('; '))}
        {fact('business.exports.air.d.lat', utcWords(a.latAt))}
        {fact('business.exports.air.d.cargo', t('business.exports.air.d.cargoLine', { pieces: a.pieces, kg: a.weightKg.toLocaleString('en') }) + (a.volumeM3 ? `, ${a.volumeM3} m³` : ''))}
        {a.handler ? fact('business.exports.air.d.handler', a.handler) : null}
        {fact('business.exports.air.d.security', a.security.status === 'secured' ? t('business.exports.air.d.securedBy', { who: a.security.agentName ?? '', number: a.security.agentNumber ? ` (${a.security.agentNumber})` : '' }) : t('business.exports.air.d.notSecured'))}
        {a.temp ? fact('business.exports.air.d.temp', t('business.exports.air.d.tempLine', { min: a.temp.minC, max: a.temp.maxC }) + (a.temp.preCooled ? t('business.exports.air.d.preCooled') : '')) : null}
      </dl>
      {done ? <p class="cnote">{done}</p> : null}
      {error ? <p class="cerr">{error}</p> : null}
      {mine && client ? (
        <div class="twr-panelend">
          {a.bookingStatus === 'queued' ? (
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => void change({ bookingStatus: 'confirmed' }, t('business.exports.air.confirmedNote'))}>
              {t('business.exports.air.markConfirmed')}
            </button>
          ) : null}
          {!moving ? (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setMoving(true)}>
              {t('business.exports.air.moveStart')}
            </button>
          ) : null}
        </div>
      ) : null}
      {mine && client && moving ? (
        <>
          <p class="chint">{t('business.exports.air.moveHint')}</p>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.air.flight')}</span>
              <input class="cinput" value={next.flight} maxLength={10} placeholder={a.flights[0]?.flight} onInput={(e) => setNext({ ...next, flight: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.air.date')}</span>
              <input class="cinput" type="date" value={next.date} onInput={(e) => setNext({ ...next, date: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.air.fromAirport')}</span>
              <input class="cinput" value={next.from} maxLength={3} placeholder={a.fromAirport} onInput={(e) => setNext({ ...next, from: (e.target as HTMLInputElement).value.toUpperCase() })} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.air.toAirport')}</span>
              <input class="cinput" value={next.to} maxLength={3} placeholder={a.toAirport} onInput={(e) => setNext({ ...next, to: (e.target as HTMLInputElement).value.toUpperCase() })} />
            </label>
          </div>
          <label class="cfield">
            <span class="cfield__label">{t('business.exports.air.lat')}</span>
            <input class="cinput" type="datetime-local" value={next.lat} onInput={(e) => setNext({ ...next, lat: (e.target as HTMLInputElement).value })} />
          </label>
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--primary cbtn--sm"
              disabled={busy || !nextReady}
              onClick={() => void change({ flights: [{ flight: next.flight.trim(), date: next.date, from: next.from.trim(), to: next.to.trim() }], latAt: fromUtcInput(next.lat)! }, t('business.exports.air.movedNote'))}
            >
              {t('business.exports.air.moveSave')}
            </button>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setMoving(false)}>
              {t('business.exports.notNow')}
            </button>
          </div>
        </>
      ) : null}
      {a.formerBookings?.length ? <p class="chint">{t('business.exports.air.former', { n: a.formerBookings.length, last: a.formerBookings[a.formerBookings.length - 1].flights.map((f) => `${f.flight} ${f.date}`).join(', ') })}</p> : null}
      {lines('business.exports.air.warningsTitle', view.warnings)}
      <h3 class="cons__sub">{t('business.exports.air.lawTitle')}</h3>
      <p class="cons__lede">
        <Abbreviated text={check.rules ?? t(REGIME_WORD[check.regime] ?? 'business.exports.air.regime.unknown')} />
      </p>
      {check.limits.map((s, i) => (
        <p class="chint" key={`l${i}`}>
          <Abbreviated text={s} />
        </p>
      ))}
      {check.claims.map((s, i) => (
        <p class="chint" key={`c${i}`}>
          <Abbreviated text={s} />
        </p>
      ))}
      <p class="chint">{t(check.electronicPossible ? 'business.exports.air.electronicYes' : 'business.exports.air.electronicNo')}</p>
      {lines('business.exports.air.mismatchTitle', check.mismatches, 'cerr')}
      {lines('business.exports.air.lawMissingTitle', check.missing, 'cerr')}
      {lines('business.exports.air.askTitle', check.ask)}
      {lines('business.exports.air.caveatsTitle', check.caveats)}
      {check.sources.length ? <p class="chint">{t('business.exports.air.sources', { sources: check.sources.join('; ') })}</p> : null}
    </section>
  );
}
