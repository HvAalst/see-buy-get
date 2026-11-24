import { useCallback, useEffect, useState } from 'preact/hooks';
import { countryNameIn } from '../../../shared/documents/documents';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { formatMoney, useLocale, useT } from '../../../shared/i18n';
import { abroadChangeLine, clearerLine, conditionLine, endsBody, endsLines, routeActs, routeStateTag, type BorderArrival, type BorderRoute, type BorderRoutes } from '../abroad';
import { ConsolePick } from '../ConsolePick';
import { momentWords } from '../connections';
import { holds } from '../staffRoles';
import type { TowerActions, TowerState } from '../useTowerApp';
import { CountrySelect, useCountryAtlas } from './CountrySelect';

type Act = 'propose' | 'approve' | 'decline' | 'off';
type Answer = { error?: { detail?: string; title?: string } | null };

/**
 * 2026-11-18 — PARCELS ACROSS A BORDER (the plan "Parcels across a border: the traveller and the customs hold", step 1;
 * D1–D9 "As recommended"; the owner on D1: "staff can block and open airports of a single country (for example Schiphol
 * yes, Maastricht airport block)"). Every route and what it still needs, each thing by name; two people switch one on,
 * one switches it off. Per arrival country: its airports, each opened only with a customs warehouse agreed there under a
 * temporary-storage licence; who clears there; our clearance fee. Every change is listed with who made it.
 */
export function AbroadScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const locale = useLocale();
  const client = actions.client();
  const who = state.who?.name;
  const writer = state.who?.mode !== 'operator' || holds(state.who.roles, 'admin');
  const atlas = useCountryAtlas(client?.api as never);
  const [view, setView] = useState<BorderRoutes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [setUp, setSetUp] = useState<string[]>([]);
  const [pick, setPick] = useState('');

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.borderRoutes();
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || t('tower.conn.unread'));
    setError(null);
    setView(r.data as unknown as BorderRoutes);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (code: string) => atlas.find((c) => c.code === code)?.name ?? countryNameIn(code, locale);
  const by = who ? { by: who } : {};
  const change = async (key: string, write: () => Promise<Answer>): Promise<boolean> => {
    setBusy(key);
    const r = await write();
    setBusy(null);
    if (r.error) {
      setError(r.error.detail || r.error.title || '');
      return false;
    }
    setError(null);
    await load();
    return true;
  };
  const act = (f: string, tt: string, a: Act) => (client ? void change(`${f}-${tt}:${a}`, () => client.api.borderRoute(f, tt, a, by) as Promise<Answer>) : undefined);

  const arrivals = view ? [...view.arrivals, ...setUp.filter((c) => !view.arrivals.some((a) => a.country === c)).map((c) => emptyArrival(c))] : [];

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.abroad.title')}</h1>
        <p class="cons__lede">{t('tower.abroad.lede')}</p>
        <p class="chint">{t('tower.abroad.travellers')}</p>
      </header>
      {error ? (
        <p class="cerr" role="alert">
          <Abbreviated text={error} />
        </p>
      ) : null}
      {view === null ? (
        error ? null : <p class="cons__empty">{t('tower.imports.loading')}</p>
      ) : (
        <>
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.abroad.routes')}</span>
            </div>
            {view.routes.length === 0 ? <p class="cons__empty">{t('tower.abroad.noRoutes')}</p> : null}
            {view.routes.map((r) => (
              <RouteRow key={`${r.from}-${r.to}`} r={r} nameOf={nameOf} writer={writer} busy={busy} onAct={act} setUp={client ? { api: client.api, by, change } : undefined} />
            ))}
            {writer ? (
              <div class="cnote" style="margin-top:12px">
                <p>
                  <b>{t('tower.abroad.new')}</b>
                </p>
                <div class="cgrid2">
                  <CountrySelect value={from} onChange={setFrom} label={t('tower.abroad.from')} options={atlas} />
                  <CountrySelect value={to} onChange={setTo} label={t('tower.abroad.to')} options={atlas} />
                </div>
                <button type="button" class="cbtn" style="margin-top:8px" disabled={!from || !to || busy !== null || !client} onClick={() => client && void change(`${from}-${to}:prepare`, () => client.api.prepareBorderRoute(from, to) as Promise<Answer>)}>
                  {t('tower.abroad.setUp')}
                </button>
              </div>
            ) : null}
          </section>

          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.abroad.arrivals')}</span>
            </div>
            {arrivals.length === 0 ? <p class="cons__empty">{t('tower.abroad.noArrivals')}</p> : null}
            {arrivals.map((a) => (
              <ArrivalPanel key={a.country} a={a} nameOf={nameOf} writer={writer} busy={busy} by={by} client={client} change={change} />
            ))}
            {writer ? (
              <div class="cnote" style="margin-top:12px">
                <CountrySelect value={pick} onChange={setPick} label={t('tower.abroad.arrivalPick')} options={atlas} />
                <button type="button" class="cbtn cbtn--ghost" style="margin-top:8px" disabled={!pick} onClick={() => (setSetUp((s) => (s.includes(pick) ? s : [...s, pick])), setPick(''))}>
                  {t('tower.abroad.arrivalPick')}
                </button>
              </div>
            ) : null}
          </section>

          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.abroad.changes')}</span>
            </div>
            {view.changes.length === 0 ? <p class="cons__empty">{t('tower.abroad.noChanges')}</p> : null}
            {view.changes.map((c, i) => (
              <p key={`${c.at}-${i}`} class="chint">
                {abroadChangeLine(c, nameOf, t)} · {momentWords(c.at)}
              </p>
            ))}
          </section>
        </>
      )}
    </>
  );
}

const emptyArrival = (country: string): BorderArrival => ({ country, payment: { dutyBy: 'agent', ourPartBy: 'collection' }, airports: [], hubs: [], agents: [] });

type SetUp = { api: NonNullable<ReturnType<TowerActions['client']>>['api']; by: { by?: string }; change: (key: string, write: () => Promise<Answer>) => Promise<boolean> };

/** One route: its state, what it needs, where it leaves, who carries it, its prices, and what this reader may do with it. */
export function RouteRow({ r, nameOf, writer, busy, onAct, setUp }: { r: BorderRoute; nameOf: (code: string) => string; writer: boolean; busy: string | null; onAct: (from: string, to: string, act: Act) => void; setUp?: SetUp }) {
  const t = useT();
  const [airport, setAirport] = useState(r.departure?.airport ?? '');
  const [hub, setHub] = useState(r.departure?.mdpId ?? '');
  const [carrier, setCarrier] = useState(r.carrier?.entityId ?? '');
  const [arrival, setArrival] = useState(r.arrival?.airport ?? '');
  // 2026-11-23 — a road route between two EU countries (P3-1): its fleet and its central hub.
  const road = r.by === 'road';
  const [fleet, setFleet] = useState(r.fleet?.managerDid ?? '');
  const [central, setCentral] = useState(r.hub?.mdpId ?? '');
  const arrivalOpen = r.conditions.find((c) => c.key === 'airport')?.met ?? false;
  const [prices, setPrices] = useState({ S: r.prices ? String(r.prices.S) : '', M: r.prices ? String(r.prices.M) : '', L: r.prices ? String(r.prices.L) : '' });
  // 2026-11-24 — the pair's price card at its ends (route plan part 9): a charge per price group of each country's zones.
  const asForm = (charges: Record<string, number> | undefined, groups: Array<{ key: string }> | undefined) => Object.fromEntries((groups ?? []).map((g) => [g.key, charges?.[g.key] ? String(charges[g.key]) : '']));
  const [ends, setEnds] = useState({ from: asForm(r.ends?.from, r.fromGroups), to: asForm(r.ends?.to, r.toGroups) });
  const endsSent = endsBody(ends);
  const editable = writer && setUp && r.state === 'off';
  const price = (n: number) => (r.prices ? formatMoney(n, r.prices.currency) : '');
  const tag = routeStateTag(r, t);
  const from = nameOf(r.from);
  const to = nameOf(r.to);
  const word: Record<Act, string> = { propose: t('tower.abroad.propose'), approve: t('tower.abroad.approve'), decline: r.mine ? t('tower.abroad.withdraw') : t('tower.abroad.decline'), off: t('tower.abroad.off') };
  return (
    <div class="cnote" style="margin-top:12px">
      <p>
        <b>{t('tower.abroad.route', { from, to })}</b> <span class={`ctag ctag--${tag.tone}`}>{tag.tag}</span>
      </p>
      {r.proposedBy && r.proposedAt ? <p class="chint">{t('tower.abroad.proposedBy', { who: r.proposedBy, when: momentWords(r.proposedAt) })}</p> : null}
      {r.approvedBy && r.approvedAt && r.state === 'on' ? <p class="chint">{t('tower.abroad.approvedBy', { who: r.approvedBy, when: momentWords(r.approvedAt) })}</p> : null}
      <ul style="margin:6px 0 0;padding-left:20px">
        {r.conditions.map((c) => (
          <li key={c.key} class={c.met ? 'chint' : 'cerr'}>
            {c.met ? '✓ ' : '✗ '}
            {conditionLine(c.key, from, to, t)}
          </li>
        ))}
      </ul>
      {road ? (
        <>
          <p class="chint" style="margin-top:8px">{t('tower.abroad.byRoad')}</p>
          <p class="chint">
            <b>{t('tower.abroad.fleet')}</b> · {r.fleet ? r.fleet.name : t('tower.abroad.carrier.none')}
          </p>
          <p class="chint">
            <b>{t('tower.abroad.hub')}</b> · {r.hub ? r.hub.name : t('tower.abroad.carrier.none')}
          </p>
        </>
      ) : (
        <>
          <p class="chint" style="margin-top:8px">
            <b>{t('tower.abroad.departure')}</b> · {r.departure ? t('tower.abroad.departureLine', { airport: r.departure.airport, hub: r.departure.name }) : t('tower.abroad.departureNone')}
          </p>
          <p class="chint">
            <b>{t('tower.abroad.arrival')}</b> · {r.arrival ? r.arrival.airport : t('tower.abroad.arrival.none')}
          </p>
          {r.arrival && !arrivalOpen ? <p class="cerr">{t('tower.abroad.arrival.closed', { airport: r.arrival.airport })}</p> : null}
          <p class="chint">
            <b>{t('tower.abroad.carrier')}</b> · {r.carrier ? r.carrier.name : t('tower.abroad.carrier.none')}
          </p>
        </>
      )}
      <p class="chint">
        <b>{t('tower.abroad.prices')}</b> · {r.prices ? t('tower.abroad.prices.line', { S: price(r.prices.S), M: price(r.prices.M), L: price(r.prices.L) }) : t('tower.abroad.prices.none')}
      </p>
      {road ? (
        <p class="chint">
          <b>{t('tower.abroad.ends')}</b> · {endsLines(r, nameOf, (n) => formatMoney(n, r.prices?.currency ?? r.currency ?? ''), t).join(' · ') || t('tower.abroad.ends.none')}
        </p>
      ) : null}
      {writer && r.state !== 'off' ? <p class="chint">{t('tower.abroad.locked')}</p> : null}
      {editable ? (
        <div style="margin-top:6px">
          {road ? (
            <>
              {r.fleets.length === 0 ? (
                <p class="chint">{t('tower.abroad.fleet.noFleets', { from, to })}</p>
              ) : (
                <>
                  <ConsolePick label={t('tower.abroad.fleet.pick')} value={fleet} onChange={setFleet} placeholder="—" options={r.fleets.map((f) => ({ value: f.id, label: f.name }))} />
                  <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null || !fleet} onClick={() => void setUp.change(`${r.from}-${r.to}:fleet`, () => setUp.api.setBorderFleet(r.from, r.to, { managerDid: fleet, ...setUp.by }) as Promise<Answer>)}>
                    {t('tower.abroad.fleet.save')}
                  </button>
                </>
              )}
              {r.arrivalHubs.length === 0 ? (
                <p class="chint">{t('tower.abroad.hub.noHubs', { to })}</p>
              ) : (
                <>
                  <ConsolePick label={t('tower.abroad.hub.pick', { to })} value={central} onChange={setCentral} placeholder="—" options={r.arrivalHubs.map((h) => ({ value: h.id, label: h.name }))} />
                  <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null || !central} onClick={() => void setUp.change(`${r.from}-${r.to}:hub`, () => setUp.api.setBorderHub(r.from, r.to, { mdpId: central, ...setUp.by }) as Promise<Answer>)}>
                    {t('tower.abroad.hub.save')}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
          {r.departureHubs.length === 0 ? (
            <p class="chint">{t('tower.abroad.dep.noHubs', { from })}</p>
          ) : (
            <>
              <ConsolePick label={t('tower.abroad.dep.airport')} value={airport} onChange={setAirport} placeholder="—" options={r.departureAirports.map((code) => ({ value: code, label: code }))} />
              <ConsolePick label={t('tower.abroad.dep.hub')} value={hub} onChange={setHub} placeholder="—" options={r.departureHubs.map((h) => ({ value: h.id, label: h.name }))} />
              <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null || !airport || !hub} onClick={() => void setUp.change(`${r.from}-${r.to}:departure`, () => setUp.api.setBorderDeparture(r.from, r.to, { airport, mdpId: hub, ...setUp.by }) as Promise<Answer>)}>
                {t('tower.abroad.dep.save')}
              </button>
            </>
          )}
          <ConsolePick label={t('tower.abroad.arrival.pick', { to })} value={arrival} onChange={setArrival} placeholder="—" options={r.arrivalAirports.map((code) => ({ value: code, label: code }))} />
          <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null || !arrival} onClick={() => void setUp.change(`${r.from}-${r.to}:arrival`, () => setUp.api.setBorderArrival(r.from, r.to, { airport: arrival, ...setUp.by }) as Promise<Answer>)}>
            {t('tower.abroad.arrival.save')}
          </button>
          {r.carriers.length === 0 ? (
            <p class="chint">{t('tower.abroad.carrier.noCarriers', { from })}</p>
          ) : (
            <>
              <ConsolePick label={t('tower.abroad.carrier.pick')} value={carrier} onChange={setCarrier} placeholder="—" options={r.carriers.map((c) => ({ value: c.id, label: c.name }))} />
              <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null || !carrier} onClick={() => void setUp.change(`${r.from}-${r.to}:carrier`, () => setUp.api.setBorderCarrier(r.from, r.to, { entityId: carrier, ...setUp.by }) as Promise<Answer>)}>
                {t('tower.abroad.carrier.save')}
              </button>
            </>
          )}
            </>
          )}
          {r.currency ? (
            <>
              <div class="cgrid2">
                {(['S', 'M', 'L'] as const).map((size) => (
                  <label key={size} class="cfield">
                    <span class="cfield__label">{t(size === 'S' ? 'tower.abroad.prices.small' : size === 'M' ? 'tower.abroad.prices.medium' : 'tower.abroad.prices.large')} ({r.currency})</span>
                    <input class="cinput" inputMode="decimal" value={prices[size]} onInput={(e) => setPrices({ ...prices, [size]: e.currentTarget.value })} />
                  </label>
                ))}
              </div>
              <button
                type="button"
                class="cbtn cbtn--ghost"
                disabled={busy !== null || !(Number(prices.S) > 0 && Number(prices.M) > 0 && Number(prices.L) > 0)}
                onClick={() => void setUp.change(`${r.from}-${r.to}:prices`, () => setUp.api.setBorderPrices(r.from, r.to, { S: Number(prices.S), M: Number(prices.M), L: Number(prices.L), ...setUp.by }) as Promise<Answer>)}
              >
                {t('tower.abroad.prices.save')}
              </button>
              {road ? (
                <>
                  <p class="chint" style="margin-top:8px">{t('tower.abroad.ends.lede')}</p>
                  {([['from', r.from, r.fromGroups], ['to', r.to, r.toGroups]] as const).map(([end, country, groups]) => (
                    <div key={end} class="cgrid2">
                      {(groups ?? []).map((g) => (
                        <label key={g.key} class="cfield">
                          <span class="cfield__label">
                            {nameOf(country)} · {g.name} ({r.currency})
                          </span>
                          <input class="cinput" inputMode="decimal" value={ends[end][g.key] ?? ''} onInput={(e) => setEnds({ ...ends, [end]: { ...ends[end], [g.key]: e.currentTarget.value } })} />
                        </label>
                      ))}
                    </div>
                  ))}
                  {'error' in endsSent ? <p class="cerr">{t(endsSent.error)}</p> : null}
                  <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null || 'error' in endsSent} onClick={() => 'body' in endsSent && void setUp.change(`${r.from}-${r.to}:ends`, () => setUp.api.setBorderEnds(r.from, r.to, { ...endsSent.body, ...setUp.by }) as Promise<Answer>)}>
                    {t('tower.abroad.ends.save')}
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <p class="chint">{t('tower.abroad.prices.noCompany', { from })}</p>
          )}
        </div>
      ) : null}
      {r.mine ? <p class="chint">{t('tower.abroad.mine')}</p> : null}
      {writer ? (
        <p style="margin-top:8px">
          {routeActs(r).map((a) => (
            <button key={a} type="button" class={`cbtn${a === 'approve' || a === 'propose' ? '' : ' cbtn--ghost'}`} style="margin-right:6px" disabled={busy !== null} onClick={() => onAct(r.from, r.to, a)}>
              {word[a]}
            </button>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** One arrival country: its airports and their warehouses, who clears there, our fee there. */
function ArrivalPanel({
  a,
  nameOf,
  writer,
  busy,
  by,
  client,
  change,
}: {
  a: BorderArrival;
  nameOf: (code: string) => string;
  writer: boolean;
  busy: string | null;
  by: { by?: string };
  client: ReturnType<TowerActions['client']>;
  change: (key: string, write: () => Promise<Answer>) => Promise<boolean>;
}) {
  const t = useT();
  const [whAt, setWhAt] = useState<string | null>(null);
  const [wh, setWh] = useState({ mdpId: '', tstLicence: '', validUntil: '', agreement: '' });
  const [kind, setKind] = useState<'agent' | 'company'>(a.clearer?.kind ?? 'agent');
  const [agent, setAgent] = useState(a.clearer?.kind === 'agent' ? a.clearer.entityId : '');
  const [registration, setRegistration] = useState('');
  const [fee, setFee] = useState(a.fee ? String(a.fee.amount) : '');
  const [storage, setStorage] = useState(a.readdress ? String(a.readdress.storagePerDay) : '');
  const [handling, setHandling] = useState(a.readdress ? String(a.readdress.handlingFee) : '');
  const api = client?.api;
  const c = a.country;

  return (
    <div class="cnote" style="margin-top:12px">
      <p>
        <b>{nameOf(c)}</b> <span class="chint">({c})</span>
      </p>

      {/* 2026-11-19 — how a receiver pays here (D17, D18): the country's defaults; the other ways open once receivers can pay us online. */}
      <p class="chint" style="margin-top:8px">
        <b>{t('tower.abroad.payment')}</b> · {t(a.payment.dutyBy === 'agent' ? 'tower.abroad.payment.dutyAgent' : 'tower.abroad.payment.dutyCompany')} · {t(a.payment.ourPartBy === 'collection' ? 'tower.abroad.payment.atCollection' : 'tower.abroad.payment.byLink')}
      </p>
      <p class="chint">{t('tower.abroad.payment.note')}</p>

      <p class="chint" style="margin-top:8px">
        <b>{t('tower.abroad.airports')}</b>
      </p>
      <ul style="margin:4px 0 0;padding-left:20px">
        {a.airports.map((ap) => (
          <li key={ap.code} style="margin-top:8px">
            <b>{ap.code}</b> <span class={`ctag ctag--${ap.open ? 'ok' : 'muted'}`}>{t(ap.open ? 'tower.abroad.airportOpen' : 'tower.abroad.airportBlocked')}</span>
            {ap.warehouse ? (
              <>
                <span class="chint"> · {t('tower.abroad.warehouseLine', { hub: ap.warehouse.name, licence: ap.warehouse.tstLicence, agreement: ap.warehouse.agreement })}</span>
                {ap.warehouse.validUntil ? <span class="chint"> · {t('tower.abroad.warehouseUntil', { date: ap.warehouse.validUntil })}</span> : null}
              </>
            ) : (
              <span class="chint"> · {t('tower.abroad.warehouseNone')}</span>
            )}
            {ap.lapsed ? <p class="cerr">{t('tower.abroad.lapsed')}</p> : null}
            {writer && api ? (
              <span style="margin-left:8px">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null} onClick={() => void change(`${c}:${ap.code}:open`, () => api.setBorderAirport(c, ap.code, { open: !ap.open, ...by }) as Promise<Answer>)}>
                  {t(ap.open ? 'tower.abroad.blockIt' : 'tower.abroad.openIt')}
                </button>{' '}
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setWhAt(whAt === ap.code ? null : ap.code)}>
                  {t('tower.abroad.wh.title', { airport: ap.code })}
                </button>
              </span>
            ) : null}
            {whAt === ap.code && writer && api ? (
              <div style="margin-top:8px">
                {a.hubs.length === 0 ? (
                  <p class="chint">{t('tower.abroad.wh.noHubs')}</p>
                ) : (
                  <>
                    <ConsolePick label={t('tower.abroad.wh.hub')} value={wh.mdpId} onChange={(v) => setWh({ ...wh, mdpId: v })} placeholder="—" options={a.hubs.map((h) => ({ value: h.id, label: h.name }))} />
                    <label class="cfield">
                      <span class="cfield__label">{t('tower.abroad.wh.licence')}</span>
                      <input class="cinput" value={wh.tstLicence} onInput={(e) => setWh({ ...wh, tstLicence: e.currentTarget.value })} />
                    </label>
                    <label class="cfield">
                      <span class="cfield__label">{t('tower.abroad.wh.until')}</span>
                      <input class="cinput" type="date" value={wh.validUntil} onInput={(e) => setWh({ ...wh, validUntil: e.currentTarget.value })} />
                    </label>
                    <label class="cfield">
                      <span class="cfield__label">{t('tower.abroad.wh.agreement')}</span>
                      <input class="cinput" value={wh.agreement} onInput={(e) => setWh({ ...wh, agreement: e.currentTarget.value })} />
                    </label>
                    <p class="chint">{t('tower.abroad.wh.note')}</p>
                    <button
                      type="button"
                      class="cbtn"
                      disabled={busy !== null || !wh.mdpId || wh.tstLicence.trim().length < 3 || wh.agreement.trim().length < 3}
                      onClick={() =>
                        void change(`${c}:${ap.code}:wh`, () => api.setBorderWarehouse(c, ap.code, { mdpId: wh.mdpId, tstLicence: wh.tstLicence.trim(), agreement: wh.agreement.trim(), ...(wh.validUntil ? { validUntil: wh.validUntil } : {}), ...by }) as Promise<Answer>).then((ok) => ok && setWhAt(null))
                      }
                    >
                      {t('tower.abroad.wh.save')}
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <p class="chint" style="margin-top:12px">
        <b>{t('tower.abroad.clearer')}</b> · {clearerLine(a, momentWords, t)}
      </p>
      {writer && api ? (
        <div style="margin-top:6px">
          <ConsolePick
            label={t('tower.abroad.clearer')}
            value={kind}
            onChange={(v) => setKind(v as 'agent' | 'company')}
            options={[
              { value: 'agent', label: t('tower.abroad.clearer.kindAgent') },
              { value: 'company', label: t('tower.abroad.clearer.kindCompany') },
            ]}
          />
          {kind === 'agent' ? (
            a.agents.length === 0 ? (
              <p class="chint">{t('tower.abroad.clearer.noAgents')}</p>
            ) : (
              <ConsolePick label={t('tower.abroad.clearer.agent')} value={agent} onChange={setAgent} placeholder="—" options={a.agents.map((g) => ({ value: g.id, label: g.name }))} />
            )
          ) : (
            <label class="cfield">
              <span class="cfield__label">{t('tower.abroad.clearer.registration')}</span>
              <input class="cinput" value={registration} onInput={(e) => setRegistration(e.currentTarget.value)} />
            </label>
          )}
          <button
            type="button"
            class="cbtn cbtn--ghost"
            disabled={busy !== null || (kind === 'agent' ? !agent : registration.trim().length < 3)}
            onClick={() => void change(`${c}:clearer`, () => api.setBorderClearer(c, kind === 'agent' ? { kind, entityId: agent, ...by } : { kind, registration: registration.trim(), ...by }) as Promise<Answer>)}
          >
            {t('tower.abroad.clearer.save')}
          </button>
        </div>
      ) : null}

      <p class="chint" style="margin-top:12px">
        <b>{t('tower.abroad.fee')}</b> · {a.fee ? formatMoney(a.fee.amount, a.fee.currency) : t('tower.abroad.fee.none')}
      </p>
      {writer && api ? (
        a.currency ? (
          <div style="margin-top:6px">
            <label class="cfield">
              <span class="cfield__label">{t('tower.abroad.fee.amount', { currency: a.currency })}</span>
              <input class="cinput" inputMode="decimal" value={fee} onInput={(e) => setFee(e.currentTarget.value)} />
            </label>
            <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null || !(Number(fee) > 0)} onClick={() => void change(`${c}:fee`, () => api.setBorderFee(c, { amount: Number(fee), ...by }) as Promise<Answer>)}>
              {t('tower.abroad.fee.save')}
            </button>
          </div>
        ) : (
          <p class="chint">{t('tower.abroad.fee.noCompany')}</p>
        )
      ) : null}

      {/* 2026-11-19 — D20: what a new receiver pays on top when someone else takes a parcel not paid in time. */}
      <p class="chint" style="margin-top:12px">
        <b>{t('tower.abroad.readdress')}</b> ·{' '}
        {a.readdress ? t('tower.abroad.readdress.line', { storage: formatMoney(a.readdress.storagePerDay, a.readdress.currency), handling: formatMoney(a.readdress.handlingFee, a.readdress.currency) }) : t('tower.abroad.readdress.none')}
      </p>
      {writer && api && a.currency ? (
        <div style="margin-top:6px">
          <div class="cgrid2">
            <label class="cfield">
              <span class="cfield__label">{t('tower.abroad.readdress.storage', { currency: a.currency })}</span>
              <input class="cinput" inputMode="decimal" value={storage} onInput={(e) => setStorage(e.currentTarget.value)} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('tower.abroad.readdress.handling', { currency: a.currency })}</span>
              <input class="cinput" inputMode="decimal" value={handling} onInput={(e) => setHandling(e.currentTarget.value)} />
            </label>
          </div>
          <button
            type="button"
            class="cbtn cbtn--ghost"
            disabled={busy !== null || !(Number(storage) >= 0 && storage !== '') || !(Number(handling) >= 0 && handling !== '')}
            onClick={() => void change(`${c}:readdress`, () => api.setBorderReaddress(c, { storagePerDay: Number(storage), handlingFee: Number(handling), ...by }) as Promise<Answer>)}
          >
            {t('tower.abroad.readdress.save')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
