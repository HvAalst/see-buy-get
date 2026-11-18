import { useCallback, useEffect, useState } from 'preact/hooks';
import { countryNameIn } from '../../../shared/documents/documents';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { formatMoney, useLocale, useT } from '../../../shared/i18n';
import { abroadChangeLine, clearerLine, conditionLine, routeActs, routeStateTag, type BorderArrival, type BorderRoute, type BorderRoutes } from '../abroad';
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
              <RouteRow key={`${r.from}-${r.to}`} r={r} nameOf={nameOf} writer={writer} busy={busy} onAct={act} />
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
                <button type="button" class="cbtn" style="margin-top:8px" disabled={!from || !to || busy !== null} onClick={() => act(from, to, 'propose')}>
                  {t('tower.abroad.propose')}
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

const emptyArrival = (country: string): BorderArrival => ({ country, airports: [], hubs: [], agents: [] });

/** One route: its state, what it needs, and what this reader may do with it. */
export function RouteRow({ r, nameOf, writer, busy, onAct }: { r: BorderRoute; nameOf: (code: string) => string; writer: boolean; busy: string | null; onAct: (from: string, to: string, act: Act) => void }) {
  const t = useT();
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
  const api = client?.api;
  const c = a.country;

  return (
    <div class="cnote" style="margin-top:12px">
      <p>
        <b>{nameOf(c)}</b> <span class="chint">({c})</span>
      </p>

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
    </div>
  );
}
