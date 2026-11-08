import { useCallback, useEffect, useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { ConsolePick } from '../ConsolePick';
import { ConsoleFold } from '../ConsoleFold';
import { holds } from '../staffRoles';
import type { TowerActions, TowerState } from '../useTowerApp';
import type { ZoneSetup } from '../zones';
import {
  addStep,
  approveFrom,
  belowCost,
  cellCost,
  earliestDay,
  figure,
  marginOf,
  removeStep,
  setCell,
  statusKey,
  termsOf,
  weekShift,
  workingCard,
  type PriceCardTerms,
  type PriceReportView,
  type PriceCardView,
  type PriceCardsView,
  type ZonePrice,
} from '../priceCards';

type Write = () => Promise<{ error?: { detail?: string; title?: string } | null } | { error?: unknown; data?: unknown }>;

/**
 * A COUNTRY'S PRICES BY ZONE (2026-11-08 — zone pricing, step 2). Its company drafts a price card on its published zones —
 * bands, a table of prices by weight, a charge for each group's ends, surcharges, the size rules — makes it ready, files it
 * with its regulator where its regulator requires that, and a second person approves it from a date at least the
 * country's notice ahead. The shops' own fees, our fee and the tax are added to the card's price, as today. Nothing is
 * charged from a card until the country's prices switch to it (step 3).
 */
export function ZonePricesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const sisters = (state.entities ?? []).filter((e) => e.kind === 'sister');
  const own = state.who?.entityId && sisters.some((s) => s.entityId === state.who?.entityId) ? state.who.entityId : undefined;
  const [entityId, setEntityId] = useState<string | null>(own ?? sisters[0]?.entityId ?? null);
  useEffect(() => {
    if (!entityId && (own ?? sisters[0]?.entityId)) setEntityId(own ?? sisters[0].entityId);
  }, [own, sisters.length]);
  const writer = state.who?.mode === 'company' || holds(state.who?.roles, 'admin');

  const [view, setView] = useState<PriceCardsView | null>(null);
  const [zones, setZones] = useState<ZoneSetup | null>(null);
  const [terms, setTerms] = useState<PriceCardTerms | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || !entityId) return;
    const [r, z] = await Promise.all([client.api.priceCards(entityId), client.api.zones(entityId)]);
    if (r.error) {
      setError(r.error.detail || r.error.title || '');
      return;
    }
    const v = r.data as unknown as PriceCardsView;
    setView(v);
    if (!z.error) setZones(z.data as unknown as ZoneSetup);
    const w = workingCard(v);
    setTerms(w ? termsOf(w) : null);
  }, [client, entityId]);

  useEffect(() => {
    setView(null);
    setTerms(null);
    setError(null);
    setDone(null);
    void load();
  }, [load]);

  const run = async (key: string, write: Write, message: string) => {
    setBusy(key);
    setError(null);
    setDone(null);
    const r = (await write()) as { error?: { detail?: string; title?: string } | null };
    setBusy(null);
    if (r.error) {
      setError(r.error.detail || r.error.title || '');
      return false;
    }
    setDone(message);
    await load();
    return true;
  };

  const card = workingCard(view);
  const editing = writer && card?.status === 'draft' && terms;
  const zoneList = zones?.inForce?.zones ?? [];
  const zoneName = (code: string) => zoneList.find((z) => z.code === code)?.name ?? code;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.prices.title')}</h1>
        <p class="cons__lede">{t('tower.prices.lede')}</p>
      </header>

      {sisters.length > 1 ? (
        <section class="cons__panel">
          <div class="twr-corridorform">
            <ConsolePick label={t('tower.zones.choose')} value={entityId ?? ''} onChange={(v) => setEntityId(v || null)} options={sisters.map((c) => ({ value: c.entityId, label: c.name, tag: c.jurisdiction }))} />
          </div>
        </section>
      ) : null}

      {done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {done}
        </p>
      ) : null}
      {error ? (
        <p class="cerr">
          <Abbreviated text={error} />
        </p>
      ) : null}

      {!entityId ? null : !view ? (
        <p class="cons__empty">{t('tower.prices.loading')}</p>
      ) : (
        <>
          <section class="cons__panel twr-zonestatus">
            {view.inForce ? (
              <p>{t('tower.prices.inForce', { version: view.inForce.version, date: new Date(view.inForce.effectiveFrom ?? '').toLocaleString(), who: view.inForce.approvedBy ?? '' })}</p>
            ) : (
              <p>{t('tower.prices.noneInForce')}</p>
            )}
            {view.pending
              .filter((c) => c.status === 'scheduled')
              .map((c) => (
                <p key={c.version}>
                  {t('tower.prices.scheduled', { version: c.version, date: new Date(c.effectiveFrom ?? '').toLocaleString(), who: c.approvedBy ?? '' })}{' '}
                  {writer ? (
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null} onClick={() => client && run('withdraw', () => client.api.withdrawPriceCard(entityId, c.version), t('tower.prices.withdrawn'))}>
                      {t('tower.prices.withdraw')}
                    </button>
                  ) : null}
                </p>
              ))}
          </section>

          <SettingsFold view={view} writer={writer} busy={busy === 'settings'} onSave={(s) => client && run('settings', () => client.api.setPriceCardSettings(entityId, s), t('tower.prices.settings.saved'))} />

          {!card ? (
            writer ? (
              <StartCard view={view} busy={busy === 'start'} onStart={(v) => client && run('start', () => client.api.startPriceCard(entityId, v), t('tower.prices.started'))} />
            ) : null
          ) : (
            <ConsoleFold title={t('tower.prices.card', { version: card.version })} hint={t(statusKey(card.status))} defaultOpen>
              <p class="chint">{t('tower.prices.onMap', { version: card.zoneMapVersion, currency: card.currency })}</p>
              {card.problems.length ? (
                <div class="cerr">
                  <b>{t('tower.prices.problems')}</b>
                  <ul>
                    {card.problems.map((p) => (
                      <li key={p}>
                        <Abbreviated text={p} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <CardTerms terms={editing ? terms! : termsOf(card)} card={card} costs={view.costs} groups={zones?.groups ?? []} zoneList={zoneList} zoneName={zoneName} editable={Boolean(editing)} onChange={setTerms} />

              {writer ? (
                <CardActions
                  card={card}
                  view={view}
                  busy={busy}
                  onSave={() => terms && client && run('save', () => client.api.savePriceCard(entityId, terms), t('tower.prices.saved'))}
                  onReady={() => client && run('ready', () => client.api.readyPriceCard(entityId), t('tower.prices.readied'))}
                  onDiscard={() => client && run('discard', () => client.api.discardPriceCard(entityId), t('tower.prices.discarded'))}
                  onFiled={(ref) => client && run('filed', () => client.api.filePriceCard(entityId, card.version, ref), t('tower.prices.filedDone'))}
                  onCleared={(ref) => client && run('cleared', () => client.api.clearPriceCard(entityId, card.version, ref), t('tower.prices.clearedDone'))}
                  onApprove={(from) => client && run('approve', () => client.api.approvePriceCard(entityId, card.version, from), t('tower.prices.approved'))}
                  onWithdraw={() => client && run('withdraw', () => client.api.withdrawPriceCard(entityId, card.version), t('tower.prices.withdrawn'))}
                />
              ) : null}
            </ConsoleFold>
          )}

          {card || view.inForce ? <TryPrice entityId={entityId} actions={actions} zoneList={zoneList} /> : null}
          {/* 2026-11-08 — once a card has priced anything: its price against what carrying it costs, pair by pair (step 4). */}
          {view.inForce || view.history.length ? <PriceReport entityId={entityId} actions={actions} /> : null}

          <ConsoleFold title={t('tower.prices.history')} hint={t('tower.prices.historyHint', { n: view.history.length })}>
            {view.history.length ? (
              <ul class="twr-zonestatus">
                {view.history.map((c) => (
                  <li key={c.version}>
                    {t('tower.prices.historyRow', { version: c.version, status: t(statusKey(c.status)), who: c.withdrawnBy ?? c.approvedBy ?? c.createdBy })}
                  </li>
                ))}
              </ul>
            ) : (
              <p class="cons__empty">{t('tower.prices.historyNone')}</p>
            )}
          </ConsoleFold>
        </>
      )}
    </>
  );
}

/**
 * PRICE AND COST PER PAIR OF ZONES, A WEEK AT A TIME (2026-11-08 — zone pricing, step 4). What the card priced each pair's
 * parcels at against what carrying them was planned to cost — the road at the cheapest carrier, the hubs' fees, the bag
 * loading — worst first, the pairs priced below cost marked. Planned costs at estimated distances for now.
 */
function PriceReport({ entityId, actions }: { entityId: string; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [report, setReport] = useState<PriceReportView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    setProblem(null);
    void client.api.priceReport(entityId, week).then((r) => {
      if (!live) return;
      if (r.error) setProblem(r.error.detail || r.error.title || '');
      else setReport(r.data as unknown as PriceReportView);
    });
    return () => {
      live = false;
    };
  }, [client, entityId, week]);
  const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <ConsoleFold title={t('tower.prices.report.title')} hint={report ? t('tower.prices.report.hint', { from: report.week, to: report.weekEnds }) : ''}>
      <p class="chint">{t('tower.prices.report.lede')}</p>
      <div class="twr-zonepublish">
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={!report} onClick={() => report && setWeek(weekShift(report.week, -7))}>
          {t('tower.prices.report.prev')}
        </button>
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={!report || weekShift(report.week, 7) > new Date().toISOString().slice(0, 10)} onClick={() => report && setWeek(weekShift(report.week, 7))}>
          {t('tower.prices.report.next')}
        </button>
      </div>
      {problem ? (
        <p class="cerr">
          <Abbreviated text={problem} />
        </p>
      ) : null}
      {report && !report.rows.length ? <p class="cons__empty">{t('tower.prices.report.none')}</p> : null}
      {report && report.rows.length ? (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.prices.report.col.pair')}</th>
              <th>{t('tower.prices.col.band')}</th>
              <th>{t('tower.prices.report.col.parcels')}</th>
              <th>{t('tower.prices.report.col.price', { currency: report.currency })}</th>
              <th>{t('tower.prices.report.col.planned', { currency: report.currency })}</th>
              <th>{t('tower.prices.report.col.left', { currency: report.currency })}</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => {
              const left = marginOf(r);
              return (
                <tr key={`${r.from}>${r.to}`} class={left < 0 ? 'twr-below' : undefined}>
                  <td class="ctbl__strong">{t('tower.prices.report.pair', { from: r.fromName, to: r.toName })}</td>
                  <td>
                    <span class="ctbl__lbl">{t('tower.prices.col.band')}</span>
                    {r.band}
                  </td>
                  <td class="ctbl__num">
                    <span class="ctbl__lbl">{t('tower.prices.report.col.parcels')}</span>
                    {r.parcels}
                  </td>
                  <td class="ctbl__num">
                    <span class="ctbl__lbl">{t('tower.prices.report.col.price', { currency: report.currency })}</span>
                    {money(r.price)}
                  </td>
                  <td class="ctbl__num">
                    <span class="ctbl__lbl">{t('tower.prices.report.col.planned', { currency: report.currency })}</span>
                    {money(r.planned)}
                  </td>
                  <td class="ctbl__num">
                    <span class="ctbl__lbl">{t('tower.prices.report.col.left', { currency: report.currency })}</span>
                    {money(left)}
                    {r.below ? <span class="chint"> {t('tower.prices.report.below', { n: r.below })}</span> : null}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td class="ctbl__strong">{t('tower.prices.report.total')}</td>
              <td />
              <td class="ctbl__num">
                <span class="ctbl__lbl">{t('tower.prices.report.col.parcels')}</span>
                {report.totals.parcels}
              </td>
              <td class="ctbl__num">
                <span class="ctbl__lbl">{t('tower.prices.report.col.price', { currency: report.currency })}</span>
                {money(report.totals.price)}
              </td>
              <td class="ctbl__num">
                <span class="ctbl__lbl">{t('tower.prices.report.col.planned', { currency: report.currency })}</span>
                {money(report.totals.planned)}
              </td>
              <td class="ctbl__num">
                <span class="ctbl__lbl">{t('tower.prices.report.col.left', { currency: report.currency })}</span>
                {money(marginOf(report.totals))}
              </td>
            </tr>
          </tbody>
        </table>
      ) : null}
      {report?.unplanned ? <p class="chint">{t('tower.prices.report.unplanned', { n: report.unplanned })}</p> : null}
    </ConsoleFold>
  );
}

function SettingsFold({ view, writer, busy, onSave }: { view: PriceCardsView; writer: boolean; busy: boolean; onSave: (s: { filingRequired: boolean; noticeDays: number }) => void }) {
  const t = useT();
  const [filing, setFiling] = useState(view.settings.filingRequired);
  const [days, setDays] = useState(String(view.settings.noticeDays));
  useEffect(() => {
    setFiling(view.settings.filingRequired);
    setDays(String(view.settings.noticeDays));
  }, [view.settings.filingRequired, view.settings.noticeDays]);
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 0 && n <= 180;
  const changed = filing !== view.settings.filingRequired || n !== view.settings.noticeDays;
  return (
    <ConsoleFold title={t('tower.prices.settings.title')} hint={t(view.settings.filingRequired ? 'tower.prices.settings.hintFiled' : 'tower.prices.settings.hint', { days: view.settings.noticeDays })}>
      <fieldset class="twr-zonegroups" disabled={!writer}>
        <p class="chint">{t('tower.prices.settings.lede')}</p>
        <div class="twr-zonepublish">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-pressed={filing} onClick={() => setFiling(!filing)}>
            {t(filing ? 'tower.prices.settings.filingOn' : 'tower.prices.settings.filingOff')}
          </button>
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.settings.notice')}</span>
            <input id="price-notice-days" class="cinput" inputMode="numeric" value={days} onInput={(e) => setDays((e.target as HTMLInputElement).value)} />
          </label>
          {writer ? (
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || !changed || !valid} onClick={() => onSave({ filingRequired: filing, noticeDays: n })}>
              {t('tower.prices.settings.save')}
            </button>
          ) : null}
        </div>
        {!valid ? <p class="cerr">{t('tower.prices.settings.noticeBad')}</p> : null}
      </fieldset>
    </ConsoleFold>
  );
}

function StartCard({ view, busy, onStart }: { view: PriceCardsView; busy: boolean; onStart: (zoneMapVersion?: number) => void }) {
  const t = useT();
  const [map, setMap] = useState(String(view.zoneMaps[0] ?? ''));
  if (!view.zoneMaps.length) return <p class="cons__empty">{t('tower.prices.needZones')}</p>;
  return (
    <section class="cons__panel twr-zonechosen">
      <p class="twr-clear__t">{t('tower.prices.start')}</p>
      <p class="chint">{t('tower.prices.startLede')}</p>
      <div class="twr-zonechosen__row">
        <ConsolePick label={t('tower.prices.zoneMap')} value={map} onChange={setMap} small options={view.zoneMaps.map((v) => ({ value: String(v), label: t('tower.prices.zoneMapN', { version: v }) }))} />
        <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => onStart(map ? Number(map) : undefined)}>
          {t('tower.prices.startGo')}
        </button>
      </div>
    </section>
  );
}

function Money({ id, value, editable, onChange, label }: { id: string; value: number; editable: boolean; onChange: (n: number) => void; label: string }) {
  return editable ? <input id={id} class="cinput twr-pricein" inputMode="decimal" aria-label={label} value={String(value)} onInput={(e) => onChange(figure((e.target as HTMLInputElement).value))} /> : <span class="ctbl__num">{value.toLocaleString()}</span>;
}

function CardTerms({
  terms,
  card,
  costs,
  groups,
  zoneList,
  zoneName,
  editable,
  onChange,
}: {
  terms: PriceCardTerms;
  card: PriceCardView;
  costs: PriceCardsView['costs'];
  groups: Array<{ key: string; name: string }>;
  zoneList: Array<{ code: string; name: string }>;
  zoneName: (code: string) => string;
  editable: boolean;
  onChange: (t: PriceCardTerms) => void;
}) {
  const t = useT();
  const [newStep, setNewStep] = useState('');
  const [zonePick, setZonePick] = useState('');
  const [pairA, setPairA] = useState('');
  const [pairB, setPairB] = useState('');
  const [pairBand, setPairBand] = useState('');
  const set = (patch: Partial<PriceCardTerms>) => onChange({ ...terms, ...patch });
  const zoneOptions = zoneList.map((z) => ({ value: z.code, label: z.name, tag: z.code }));
  return (
    <div class="twr-card">
      <p class="twr-clear__t">{t('tower.prices.bands')}</p>
      <p class="chint">{t('tower.prices.bandsLede')}</p>
      <table class="ctbl ctbl--stack">
        <thead>
          <tr>
            <th>{t('tower.prices.col.band')}</th>
            <th>{t('tower.prices.col.zones')}</th>
            <th>{t('tower.prices.col.km')}</th>
          </tr>
        </thead>
        <tbody>
          {terms.bands.map((b, i) => {
            const last = i === terms.bands.length - 1;
            const patch = (p: Partial<typeof b>) => set({ bands: terms.bands.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <tr key={b.key}>
                <td class="ctbl__strong">{editable ? <input id={`band-name-${b.key}`} class="cinput" value={b.name} maxLength={40} aria-label={t('tower.prices.col.band')} onInput={(e) => patch({ name: (e.target as HTMLInputElement).value })} /> : b.name}</td>
                <td>
                  <span class="ctbl__lbl">{t('tower.prices.col.zones')}</span>
                  {last ? t('tower.prices.further') : <Money id={`band-zones-${b.key}`} value={b.maxZones ?? 0} editable={editable} label={t('tower.prices.col.zones')} onChange={(n) => patch({ maxZones: Math.round(n) })} />}
                </td>
                <td>
                  <span class="ctbl__lbl">{t('tower.prices.col.km')}</span>
                  {last ? t('tower.prices.further') : <Money id={`band-km-${b.key}`} value={b.maxKm ?? 0} editable={editable} label={t('tower.prices.col.km')} onChange={(n) => patch({ maxKm: n })} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p class="twr-clear__t">{t('tower.prices.table', { currency: card.currency })}</p>
      <p class="chint">{t('tower.prices.tableLede')}</p>
      <div class="twr-pricegrid">
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.prices.col.upTo')}</th>
              {terms.bands.map((b) => (
                <th key={b.key}>{b.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {terms.steps.map((kg, i) => (
              <tr key={kg}>
                <td class="ctbl__strong">
                  {t('tower.prices.kg', { kg })}
                  {editable && terms.steps.length > 1 ? (
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => onChange(removeStep(terms, i))}>
                      {t('tower.prices.removeStep')}
                    </button>
                  ) : null}
                </td>
                {terms.bands.map((b) => {
                  const price = terms.table[b.key]?.[i] ?? 0;
                  const cost = cellCost(costs, b.key, kg);
                  return (
                    <td key={b.key}>
                      <span class="ctbl__lbl">{b.name}</span>
                      <Money id={`cell-${b.key}-${kg}`} value={price} editable={editable} label={`${b.name} ${kg}`} onChange={(n) => onChange(setCell(terms, b.key, i, n))} />
                      {cost ? <span class={belowCost(price, cost.cost) ? 'cerr twr-pricecost' : 'chint twr-pricecost'}>{t(belowCost(price, cost.cost) ? 'tower.prices.belowCost' : 'tower.prices.cost', { cost: cost.cost.toLocaleString() })}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td class="ctbl__strong">{t('tower.prices.perExtraKg')}</td>
              {terms.bands.map((b) => (
                <td key={b.key}>
                  <span class="ctbl__lbl">{b.name}</span>
                  <Money id={`extra-${b.key}`} value={terms.perExtraKg[b.key] ?? 0} editable={editable} label={`${b.name} ${t('tower.prices.perExtraKg')}`} onChange={(n) => set({ perExtraKg: { ...terms.perExtraKg, [b.key]: n } })} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {editable ? (
        <div class="twr-zonechosen__row">
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.addStep')}</span>
            <input id="price-new-step" class="cinput" inputMode="decimal" value={newStep} onInput={(e) => setNewStep((e.target as HTMLInputElement).value)} />
          </label>
          <button
            type="button"
            class="cbtn cbtn--ghost cbtn--sm"
            disabled={!(figure(newStep) > 0)}
            onClick={() => {
              onChange(addStep(terms, figure(newStep)));
              setNewStep('');
            }}
          >
            {t('tower.prices.addStepGo')}
          </button>
        </div>
      ) : null}
      <p class="chint">{t('tower.prices.costNote')}</p>

      <p class="twr-clear__t">{t('tower.prices.ends')}</p>
      <p class="chint">{t('tower.prices.endsLede')}</p>
      <table class="ctbl ctbl--stack">
        <thead>
          <tr>
            <th>{t('tower.prices.col.group')}</th>
            <th>{t('tower.prices.col.perParcel')}</th>
            <th>{t('tower.prices.col.perKg')}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const c = terms.groupCharges[g.key] ?? { perParcel: 0, perKg: 0 };
            const patch = (p: Partial<typeof c>) => set({ groupCharges: { ...terms.groupCharges, [g.key]: { ...c, ...p } } });
            return (
              <tr key={g.key}>
                <td class="ctbl__strong">{g.name}</td>
                <td>
                  <span class="ctbl__lbl">{t('tower.prices.col.perParcel')}</span>
                  <Money id={`group-parcel-${g.key}`} value={c.perParcel} editable={editable} label={`${g.name} ${t('tower.prices.col.perParcel')}`} onChange={(n) => patch({ perParcel: n })} />
                </td>
                <td>
                  <span class="ctbl__lbl">{t('tower.prices.col.perKg')}</span>
                  <Money id={`group-kg-${g.key}`} value={c.perKg} editable={editable} label={`${g.name} ${t('tower.prices.col.perKg')}`} onChange={(n) => patch({ perKg: n })} />
                </td>
              </tr>
            );
          })}
          {Object.entries(terms.zoneCharges).map(([code, c]) => (
            <tr key={code}>
              <td class="ctbl__strong">
                {t('tower.prices.ownPrice', { zone: zoneName(code) })}
                {editable ? (
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => set({ zoneCharges: Object.fromEntries(Object.entries(terms.zoneCharges).filter(([k]) => k !== code)) })}>
                    {t('tower.prices.remove')}
                  </button>
                ) : null}
              </td>
              <td>
                <span class="ctbl__lbl">{t('tower.prices.col.perParcel')}</span>
                <Money id={`zone-parcel-${code}`} value={c.perParcel} editable={editable} label={t('tower.prices.col.perParcel')} onChange={(n) => set({ zoneCharges: { ...terms.zoneCharges, [code]: { ...c, perParcel: n } } })} />
              </td>
              <td>
                <span class="ctbl__lbl">{t('tower.prices.col.perKg')}</span>
                <Money id={`zone-kg-${code}`} value={c.perKg} editable={editable} label={t('tower.prices.col.perKg')} onChange={(n) => set({ zoneCharges: { ...terms.zoneCharges, [code]: { ...c, perKg: n } } })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && zoneOptions.length ? (
        <div class="twr-zonechosen__row">
          <ConsolePick label={t('tower.prices.ownPriceFor')} value={zonePick} onChange={setZonePick} small options={zoneOptions.filter((o) => !terms.zoneCharges[o.value])} />
          <button
            type="button"
            class="cbtn cbtn--ghost cbtn--sm"
            disabled={!zonePick}
            onClick={() => {
              set({ zoneCharges: { ...terms.zoneCharges, [zonePick]: { perParcel: 0, perKg: 0 } } });
              setZonePick('');
            }}
          >
            {t('tower.prices.ownPriceAdd')}
          </button>
        </div>
      ) : null}

      <p class="twr-clear__t">{t('tower.prices.pairs')}</p>
      <p class="chint">{t('tower.prices.pairsLede')}</p>
      {terms.pairs.length ? (
        <ul class="twr-zonestatus">
          {terms.pairs.map((p, i) => (
            <li key={`${p.a}-${p.b}`}>
              {t('tower.prices.pairRow', { a: zoneName(p.a), b: zoneName(p.b), band: terms.bands.find((b) => b.key === p.band)?.name ?? p.band })}{' '}
              {editable ? (
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => set({ pairs: terms.pairs.filter((_, j) => j !== i) })}>
                  {t('tower.prices.remove')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p class="cons__empty">{t('tower.prices.pairsNone')}</p>
      )}
      {editable && zoneOptions.length ? (
        <div class="twr-zonechosen__row">
          <ConsolePick label={t('tower.prices.pairA')} value={pairA} onChange={setPairA} small options={zoneOptions} />
          <ConsolePick label={t('tower.prices.pairB')} value={pairB} onChange={setPairB} small options={zoneOptions.filter((o) => o.value !== pairA)} />
          <ConsolePick label={t('tower.prices.col.band')} value={pairBand} onChange={setPairBand} small options={terms.bands.map((b) => ({ value: b.key, label: b.name }))} />
          <button
            type="button"
            class="cbtn cbtn--ghost cbtn--sm"
            disabled={!pairA || !pairB || !pairBand || pairA === pairB}
            onClick={() => {
              set({ pairs: [...terms.pairs.filter((p) => !((p.a === pairA && p.b === pairB) || (p.a === pairB && p.b === pairA))), { a: pairA, b: pairB, band: pairBand }] });
              setPairA('');
              setPairB('');
              setPairBand('');
            }}
          >
            {t('tower.prices.pairAdd')}
          </button>
        </div>
      ) : null}

      <p class="twr-clear__t">{t('tower.prices.rules')}</p>
      <div class="twr-knobs">
        <div class="twr-knobs__row">
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.divisorShop')}</span>
            <Money id="divisor-shop" value={terms.weight.divisorShop} editable={editable} label={t('tower.prices.divisorShop')} onChange={(n) => set({ weight: { ...terms.weight, divisorShop: n } })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.divisorDoor')}</span>
            <Money id="divisor-door" value={terms.weight.divisorDoor} editable={editable} label={t('tower.prices.divisorDoor')} onChange={(n) => set({ weight: { ...terms.weight, divisorDoor: n } })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.stepKg')}</span>
            <Money id="step-kg" value={terms.weight.stepKg} editable={editable} label={t('tower.prices.stepKg')} onChange={(n) => set({ weight: { ...terms.weight, stepKg: n } })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.maxKg')}</span>
            <Money id="max-kg" value={terms.weight.maxKg} editable={editable} label={t('tower.prices.maxKg')} onChange={(n) => set({ weight: { ...terms.weight, maxKg: n } })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.volumeFrom')}</span>
            <Money id="volume-from" value={terms.weight.volumeFromKg} editable={editable} label={t('tower.prices.volumeFrom')} onChange={(n) => set({ weight: { ...terms.weight, volumeFromKg: n } })} />
          </label>
        </div>
        <p class="chint">{t('tower.prices.rulesLede')}</p>
        <div class="twr-knobs__row">
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.door')}</span>
            <Money id="surcharge-door" value={terms.surcharges.door} editable={editable} label={t('tower.prices.door')} onChange={(n) => set({ surcharges: { ...terms.surcharges, door: n } })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.oversize', { cm: terms.surcharges.oversizeCm })}</span>
            <Money id="surcharge-oversize" value={terms.surcharges.oversize} editable={editable} label={t('tower.prices.oversize', { cm: terms.surcharges.oversizeCm })} onChange={(n) => set({ surcharges: { ...terms.surcharges, oversize: n } })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.oversizeCm')}</span>
            <Money id="surcharge-oversize-cm" value={terms.surcharges.oversizeCm} editable={editable} label={t('tower.prices.oversizeCm')} onChange={(n) => set({ surcharges: { ...terms.surcharges, oversizeCm: n } })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.fragile')}</span>
            <Money id="surcharge-fragile" value={terms.surcharges.fragile} editable={editable} label={t('tower.prices.fragile')} onChange={(n) => set({ surcharges: { ...terms.surcharges, fragile: n } })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.minimum')}</span>
            <Money id="price-minimum" value={terms.minimum} editable={editable} label={t('tower.prices.minimum')} onChange={(n) => set({ minimum: n })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.cashStep')}</span>
            <Money id="price-cash-step" value={terms.cashStep} editable={editable} label={t('tower.prices.cashStep')} onChange={(n) => set({ cashStep: n })} />
          </label>
        </div>
        <p class="chint">{t('tower.prices.cashStepLede')}</p>
      </div>
    </div>
  );
}

function CardActions({
  card,
  view,
  busy,
  onSave,
  onReady,
  onDiscard,
  onFiled,
  onCleared,
  onApprove,
  onWithdraw,
}: {
  card: PriceCardView;
  view: PriceCardsView;
  busy: string | null;
  onSave: () => void;
  onReady: () => void;
  onDiscard: () => void;
  onFiled: (ref: string) => void;
  onCleared: (ref: string) => void;
  onApprove: (from?: string) => void;
  onWithdraw: () => void;
}) {
  const t = useT();
  const [ref, setRef] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const earliest = earliestDay(today, view.settings.noticeDays);
  const [day, setDay] = useState(earliest);
  const filing = view.settings.filingRequired;
  return (
    <div class="twr-panelend twr-zoneacts">
      {card.status === 'draft' ? (
        <>
          <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy !== null} onClick={onSave}>
            {t('tower.prices.save')}
          </button>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null || card.problems.length > 0} onClick={onReady}>
            {t('tower.prices.ready')}
          </button>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null} onClick={onDiscard}>
            {t('tower.prices.discard')}
          </button>
          <p class="chint">{t(filing ? 'tower.prices.readyHintFiled' : 'tower.prices.readyHint')}</p>
        </>
      ) : null}
      {(card.status === 'ready' && filing) || card.status === 'filed' ? (
        <>
          <label class="cfield">
            <span class="cfield__label">{t(card.status === 'ready' ? 'tower.prices.filedRef' : 'tower.prices.clearedRef')}</span>
            <input id="price-card-ref" class="cinput" value={ref} maxLength={120} onInput={(e) => setRef((e.target as HTMLInputElement).value)} />
          </label>
          <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy !== null || !ref.trim()} onClick={() => (card.status === 'ready' ? onFiled(ref.trim()) : onCleared(ref.trim()))}>
            {t(card.status === 'ready' ? 'tower.prices.filed' : 'tower.prices.cleared')}
          </button>
        </>
      ) : null}
      {(card.status === 'ready' && !filing) || card.status === 'cleared' ? (
        <>
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.from')}</span>
            <input id="price-card-from" class="cinput" type="date" min={earliest} value={day} onInput={(e) => setDay((e.target as HTMLInputElement).value)} />
          </label>
          <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy !== null} onClick={() => onApprove(approveFrom(day, earliest))}>
            {t('tower.prices.approve')}
          </button>
          <p class="chint">{t('tower.prices.approveHint', { days: view.settings.noticeDays, who: card.readyBy ?? '' })}</p>
        </>
      ) : null}
      {['ready', 'filed', 'cleared'].includes(card.status) ? (
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null} onClick={onWithdraw}>
          {t('tower.prices.withdraw')}
        </button>
      ) : null}
    </div>
  );
}

function TryPrice({ entityId, actions, zoneList }: { entityId: string; actions: TowerActions; zoneList: Array<{ code: string; name: string }> }) {
  const t = useT();
  const client = actions.client();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kg, setKg] = useState('1');
  const [dims, setDims] = useState({ l: '', w: '', h: '' });
  const [door, setDoor] = useState(false);
  const [fragile, setFragile] = useState(false);
  const [answer, setAnswer] = useState<ZonePrice | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const options = zoneList.map((z) => ({ value: z.code, label: z.name, tag: z.code }));
  const ask = async () => {
    if (!client || !from || !to) return;
    setErr(null);
    const r = await client.api.tryZonePrice(entityId, { from, to, kg, l: dims.l, w: dims.w, h: dims.h, door, fragile });
    if (r.error) {
      setErr(r.error.detail || r.error.title || '');
      setAnswer(null);
      return;
    }
    setAnswer(r.data as unknown as ZonePrice);
  };
  return (
    <ConsoleFold title={t('tower.prices.try')} hint={t('tower.prices.tryHint')}>
      <div class="twr-zonechosen">
        <div class="twr-zonechosen__row">
          <ConsolePick label={t('tower.prices.tryFrom')} value={from} onChange={setFrom} small options={options} />
          <ConsolePick label={t('tower.prices.tryTo')} value={to} onChange={setTo} small options={options} />
        </div>
        <div class="twr-zonechosen__row">
          <label class="cfield">
            <span class="cfield__label">{t('tower.prices.tryKg')}</span>
            <input id="try-kg" class="cinput" inputMode="decimal" value={kg} onInput={(e) => setKg((e.target as HTMLInputElement).value)} />
          </label>
          {(['l', 'w', 'h'] as const).map((k) => (
            <label key={k} class="cfield">
              <span class="cfield__label">{t(`tower.prices.try.${k}` as never)}</span>
              <input id={`try-${k}`} class="cinput" inputMode="decimal" value={dims[k]} onInput={(e) => setDims({ ...dims, [k]: (e.target as HTMLInputElement).value })} />
            </label>
          ))}
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-pressed={door} onClick={() => setDoor(!door)}>
            {t('tower.prices.tryDoor')}
          </button>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-pressed={fragile} onClick={() => setFragile(!fragile)}>
            {t('tower.prices.tryFragile')}
          </button>
          <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={!from || !to} onClick={() => void ask()}>
            {t('tower.prices.tryGo')}
          </button>
        </div>
        {err ? (
          <p class="cerr">
            <Abbreviated text={err} />
          </p>
        ) : null}
        {answer ? (
          <div class="cons__panel">
            <p class="twr-clear__t">{t('tower.prices.tryAnswer', { from: answer.fromName, to: answer.toName, band: answer.bandName, zones: answer.zonesCrossed, km: Math.round(answer.km).toLocaleString(), kg: answer.billableKg })}</p>
            <ul class="twr-zonestatus">
              {answer.lines.map((l) => (
                <li key={l.key}>
                  {l.label}: {answer.currency} {l.amount.toLocaleString()}
                </li>
              ))}
            </ul>
            <p class="ctbl__strong">{t('tower.prices.tryTotal', { amount: `${answer.currency} ${answer.amount.toLocaleString()}` })}</p>
            <p class="chint">{t('tower.prices.tryNote')}</p>
          </div>
        ) : null}
      </div>
    </ConsoleFold>
  );
}
