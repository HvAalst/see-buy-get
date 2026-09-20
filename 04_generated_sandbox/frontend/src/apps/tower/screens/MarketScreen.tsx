import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { Icon, PlaceMap, type PlaceMapLine } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import {
  MOOD_LABEL,
  boardVsMarket,
  chartPoints,
  dayTakeUp,
  marketMood,
  priceClaim,
  quietLanes,
  takeUp,
  thinWindow,
  laneEnds,
  laneWeights,
  lanePlottable,
  lanesNear,
  lanesUnplaceable,
  type MarketSeriesView,
} from '../market';
import { LaneSheet } from './LaneSheet';
import type { TowerActions } from '../useTowerApp';

const RANGES = [30, 90, 365] as const;

/** How far from a place counts as near it. City, county, corridor — three steps somebody can mean. */
const RADII = [25, 100, 400] as const;
const LANE_PAGE = 10;

/**
 * CL3 — WHAT THE MARKET IS DOING, derived from what the loads already say.
 *
 * Nobody reports anything on this screen. Every figure comes from timestamps a load carries anyway, which is
 * the only reason it can be trusted in a market where people are busy and forms go unfilled: a fleet
 * withdrawing capacity does not file a notice, it simply stops claiming, and these lines move within a day.
 *
 * The screen's discipline is refusing to say more than the sample supports. Where the server marked a figure
 * thin, the numbers are still shown and the VERDICT is withheld — a hedged verdict still reads as a verdict,
 * and somebody deciding whether to buy a truck deserves better than a confident-looking shrug.
 */
export function MarketScreen({ actions }: { actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [days, setDays] = useState<(typeof RANGES)[number]>(90);
  const [series, setSeries] = useState<MarketSeriesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [laneQuery, setLaneQuery] = useState('');
  const [centre, setCentre] = useState('');
  const [radius, setRadius] = useState<number>(RADII[1]);
  const [lanePage, setLanePage] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  const since = useMemo(() => new Date(Date.now() - days * 24 * 3_600_000).toISOString(), [days]);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    const r = await client.api.marketSeries({ since });
    setLoading(false);
    if (r.error) {
      setError(r.error.detail || r.error.title);
      return;
    }
    setError(null);
    setSeries(r.data as unknown as MarketSeriesView);
  }, [client, since]);

  useEffect(() => {
    void load();
  }, [load]);

  const mood = marketMood(series);
  const met = series ? takeUp(series.totals) : null;
  const points = series ? chartPoints(series.days) : [];
  const quiet = series ? quietLanes(series.lanes) : [];

  /*
   * WHICH LANES ARE ON SCREEN, and the map and the table must always answer that the same way — one
   * filter, two renderings of its result. Two lists built separately is how a map ends up showing a
   * lane the table below it has filtered out.
   */
  const allLanes = useMemo(() => series?.lanes ?? [], [series]);
  const ends = useMemo(() => laneEnds(allLanes), [allLanes]);
  const foundLanes = useMemo(() => {
    const q = laneQuery.trim().toLowerCase();
    const named = q ? allLanes.filter((l) => l.lane.toLowerCase().includes(q)) : allLanes;
    const here = ends.find((e) => e.name === centre);
    return here ? lanesNear(named, here.point, radius) : named;
  }, [allLanes, ends, laneQuery, centre, radius]);
  // Only worth saying while a radius is being applied: without one, nothing has been set aside.
  const unplaceable = useMemo(() => (centre ? lanesUnplaceable(allLanes) : 0), [centre, allLanes]);
  const lanePages = Math.max(1, Math.ceil(foundLanes.length / LANE_PAGE));
  const shownLanes = foundLanes.slice(lanePage * LANE_PAGE, lanePage * LANE_PAGE + LANE_PAGE);
  /* Only the page you are looking at is drawn. A map of four hundred lanes is a scribble, and the point
     of drawing them is to see where the ones in front of you actually are. */
  const openLane = picked ? (allLanes.find((l) => l.lane === picked) ?? null) : null;
  const weightOf = laneWeights(shownLanes);
  const drawn: PlaceMapLine[] = shownLanes.filter(lanePlottable).map((l) => ({
    id: l.lane,
    label: t('tower.market.laneTip', { lane: l.lane, posted: l.postedLoads, claimed: l.claimedLoads }),
    from: l.fromPoint!,
    to: l.toPoint!,
    weight: weightOf(l),
    tone: l.quiet ? ('warn' as const) : ('plain' as const),
  }));
  const wait = series?.timeToClaim;
  const price = series?.priceVsStack;
  const priceOver = priceClaim(price);

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.market.title')}</h1>
        <p class="cons__lede">{t('tower.market.lede')}</p>
      </header>

      <p class="cons__caveat">
        <Icon name="info" size={16} />
        <span>
          <b>{t('tower.market.caveatT')}</b> {t('tower.market.caveat')}
        </span>
      </p>

      {error ? <p class="cerr">{error}</p> : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.market.shapeTitle')}</span>
          <span class={`ctag ${mood === 'tight' ? 'ctag--warn' : mood === 'easing' ? 'ctag--ok' : 'ctag--quiet'}`}>{t(MOOD_LABEL[mood])}</span>
        </div>
        {/* The console's own pick-one control, not the `chip` the phone apps use: those classes live in
            four app stylesheets and in none of the console's, so they rendered as bare buttons with no
            gap between them. Orange means chosen here, the same signal as the rail. */}
        <nav class="twr-sisters" aria-label={t('tower.market.pickRange')}>
          {RANGES.map((n) => (
            <button key={n} type="button" class={`twr-sister${days === n ? ' twr-sister--on' : ''}`} aria-pressed={days === n} onClick={() => setDays(n)}>
              <span class="twr-sister__n">{t('tower.market.range', { n })}</span>
            </button>
          ))}
        </nav>

        {loading && !series ? (
          <p class="cons__empty">{t('tower.market.loading')}</p>
        ) : !series ? (
          <p class="cons__empty">{t('tower.market.none')}</p>
        ) : (
          <>
            {/* The one sentence a thin window is entitled to: the numbers, and a warning not to read a trend. */}
            {thinWindow(series.totals) ? <p class="cons__caveat">{t('tower.market.thinWindow')}</p> : null}
            <table class="ctbl">
              <tbody>
                <tr>
                  <td class="ctbl__strong">{t('tower.market.asked')}</td>
                  <td>{t('tower.market.loadsKm', { loads: series.totals.offeredLoads, km: Math.round(series.totals.offeredKm).toLocaleString() })}</td>
                </tr>
                {/* THE THREE OUTCOMES OF WHAT WAS ASKED FOR, and they add up to it exactly. `movedLoads`
                    used to sit in this block and cannot: it counts loads claimed in the window whenever they
                    were posted, so the three numbers under "asked for" came to more than it. */}
                <tr>
                  <td class="ctbl__strong">{t('tower.market.met')}</td>
                  <td>
                    {t('tower.market.loads', { n: series.totals.metLoads })}
                    {/* Suppressed entirely when nothing was asked for: 0% would blame the fleet for a question nobody put. */}
                    {met == null ? null : <span class="ctag ctag--quiet">{t('tower.market.takeUp', { pct: met })}</span>}
                  </td>
                </tr>
                <tr>
                  <td class="ctbl__strong">{t('tower.market.unmet')}</td>
                  <td>{t('tower.market.loadsKm', { loads: series.totals.unmetLoads, km: Math.round(series.totals.unmetKm).toLocaleString() })}</td>
                </tr>
                <tr>
                  <td class="ctbl__strong">{t('tower.market.withdrawn')}</td>
                  <td class="ctbl__sub">{t('tower.market.withdrawnBody', { n: series.totals.cancelledLoads })}</td>
                </tr>
                {/* …and the OTHER question, kept below the partition and labelled as a different count. */}
                <tr>
                  <td class="ctbl__strong">{t('tower.market.moved')}</td>
                  <td>
                    {t('tower.market.loadsKm', { loads: series.totals.movedLoads, km: Math.round(series.totals.movedKm).toLocaleString() })}
                    <div class="ctbl__sub">{t('tower.market.movedHint')}</div>
                  </td>
                </tr>
                <tr>
                  <td class="ctbl__strong">{t('tower.market.deadhead')}</td>
                  <td class="ctbl__sub">{t('tower.market.deadheadBody', { km: Math.round(series.totals.deadheadKm).toLocaleString() })}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </section>

      {series ? (
        <>
          {/* ---- how long the market is taking to answer ---- */}
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.market.waitTitle')}</span>
              {wait?.stretching ? <span class="ctag ctag--warn">{t('tower.market.stretching')}</span> : null}
              {wait?.thin ? <span class="ctag ctag--quiet">{t('tower.market.thin')}</span> : null}
            </div>
            <p class="cons__lede">{t('tower.market.waitHint')}</p>
            {wait?.medianHours == null ? (
              <p class="cons__empty">{t('tower.market.waitNone')}</p>
            ) : (
              <ul class="twr-checklist">
                <li>
                  <b>{t('tower.market.waitNow', { hours: wait.medianHours })}</b>
                  <div class="ctbl__sub">{t('tower.market.waitCount', { n: wait.loads })}</div>
                </li>
                <li>
                  {wait.priorMedianHours == null ? t('tower.market.waitNoPrior') : t('tower.market.waitPrior', { hours: wait.priorMedianHours })}
                  <div class="ctbl__sub">{t('tower.market.waitCount', { n: wait.priorLoads })}</div>
                </li>
              </ul>
            )}
          </section>

          {/* ---- what negotiated loads cleared at ---- */}
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.market.priceTitle')}</span>
              {price?.thin ? <span class="ctag ctag--quiet">{t('tower.market.thin')}</span> : null}
            </div>
            <p class="cons__lede">{t('tower.market.priceHint')}</p>
            {price == null || price.medianRatio == null ? (
              <p class="cons__empty">{t('tower.market.priceNone')}</p>
            ) : priceOver == null ? (
              /* The claim IS the ratio here, so a thin sample takes the number with it and leaves the count. */
              <p class="cons__empty">{t('tower.market.priceThin', { n: price.loads })}</p>
            ) : (
              <p>
                <b>{t('tower.market.priceRatio', { pct: priceOver })}</b>
                <span class="ctbl__sub"> {t('tower.market.priceCount', { n: price.loads })}</span>
              </p>
            )}
          </section>

          {/* ---- posted against claimed, day by day ---- */}
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.market.daysTitle')}</span>
              <span class="ctbl__sub">{t('tower.market.daysLegend')}</span>
            </div>
            <div class="twr-spark" role="img" aria-label={t('tower.market.daysAria', { n: points.length })}>
              {points.map((p) => (
                <span key={p.day} class="twr-spark__day" title={p.day}>
                  <span class="twr-spark__posted" style={{ height: `${Math.round(p.posted * 100)}%` }} />
                  <span class="twr-spark__claimed" style={{ height: `${Math.round(p.claimed * 100)}%` }} />
                </span>
              ))}
            </div>
            {/* The last week in words, because a bar chart cannot be read aloud down a phone. */}
            <p class="ctbl__sub">
              {series.days.slice(-7).map((d) => {
                const pct = dayTakeUp(d);
                return `${d.day.slice(5)} ${d.postedLoads}/${d.claimedLoads}${pct == null ? '' : ` (${pct}%)`}`;
              }).join(' · ')}
            </p>
          </section>

          {/* ---- lanes ---- */}
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.market.lanesTitle')}</span>
              <span class="chint">{t('tower.market.laneCount', { n: allLanes.length })}</span>
              {quiet.length ? <span class="ctag ctag--warn">{t('tower.market.quietCount', { n: quiet.length })}</span> : null}
            </div>

            {/*
              * THE MAP GOES ABOVE THE LIST AND NEVER INSTEAD OF IT. A lane named "Nairobi → South B" is
              * one of a great many pairs inside one city, and a name does not tell you where it is; a
              * line does, and only a line does. But the numbers are in the table, and a map cannot be
              * read for a figure — so this is the same rule the geospatial work settled on, a pin beside
              * the list rather than in place of it.
              */}
            {drawn.length ? (
              <>
                <PlaceMap lines={drawn} selectedId={picked} onPick={(id) => setPicked(id === picked ? null : id)} label={t('tower.market.mapLabel')} />
                {/* Said under the map, every time, because a straight line between two dots reads as a
                    road to anybody not thinking about it — and because the dots are town centroids, so
                    two lanes inside one neighbourhood share one. Neither is a defect; both would be
                    misreadings if we let them pass unmentioned. */}
                <p class="chint">{t('tower.market.mapBasis')}</p>
              </>
            ) : null}

            {series.lanes.length > 0 ? (
              <div class="twr-knobs__row">
                <label class="twr-knob cfield">
                  <span class="cfield__label">{t('tower.market.search')}</span>
                  <input
                    class="cinput"
                    value={laneQuery}
                    onInput={(e) => {
                      setLaneQuery((e.target as HTMLInputElement).value);
                      setLanePage(0);
                    }}
                    placeholder={t('tower.market.searchPh')}
                  />
                </label>
                <label class="twr-knob cfield">
                  <span class="cfield__label">{t('tower.market.near')}</span>
                  <select
                    class="cinput"
                    value={centre}
                    onChange={(e) => {
                      setCentre((e.target as HTMLSelectElement).value);
                      setLanePage(0);
                    }}
                  >
                    {/* The places the market actually runs through, alphabetical. It cannot offer a town
                        no lane reaches, which is the whole advantage over a free-text box. */}
                    <option value="">{t('tower.market.nearAnywhere')}</option>
                    {ends.map((e) => (
                      <option key={e.name} value={e.name}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                {centre ? (
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.market.within')}</span>
                    <select
                      class="cinput"
                      value={String(radius)}
                      onChange={(e) => {
                        setRadius(Number((e.target as HTMLSelectElement).value));
                        setLanePage(0);
                      }}
                    >
                      {RADII.map((km) => (
                        <option key={km} value={String(km)}>
                          {t('tower.market.km', { n: km })}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}

            {series.lanes.length === 0 ? (
              <p class="cons__empty">{t('tower.market.lanesNone')}</p>
            ) : foundLanes.length === 0 ? (
              <p class="cons__empty">{t('tower.market.lanesNoMatch')}</p>
            ) : (
              <table class="ctbl ctbl--stack">
                <thead>
                  <tr>
                    <th>{t('tower.market.col.lane')}</th>
                    <th>{t('tower.market.col.posted')}</th>
                    <th>{t('tower.market.col.claimed')}</th>
                    <th>{t('tower.market.col.before')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shownLanes.map((l) => (
                    <tr key={l.lane} class={picked === l.lane ? 'is-open' : undefined}>
                      <td class="ctbl__lead">
                        {/* The name is the control, rather than a click handler on the row: a row is not
                            focusable and cannot be pressed with a keyboard, and this console's contract
                            says the keyboard is a first-class pointer. */}
                        <button type="button" class="ctbl__pick" aria-pressed={picked === l.lane} onClick={() => setPicked(picked === l.lane ? null : l.lane)}>
                          {l.lane}
                        </button>
                        {/* A lane we cannot draw stays in the list and says so. Dropping it would make
                            the map and the table disagree about how many lanes there are, and the one
                            that is wrong would be the map. */}
                        {lanePlottable(l) ? null : <div class="chint">{t('tower.market.notOnMap')}</div>}
                      </td>
                      <td>
                        <span class="ctbl__lbl">{t('tower.market.col.posted')}</span>
                        {l.postedLoads}
                      </td>
                      <td>
                        <span class="ctbl__lbl">{t('tower.market.col.claimed')}</span>
                        {l.claimedLoads}
                      </td>
                      <td class="ctbl__sub">
                        <span class="ctbl__lbl">{t('tower.market.col.before')}</span>
                        {l.priorPostedLoads}
                      </td>
                      <td class="ctbl__num">
                        {l.quiet ? <span class="ctag ctag--warn">{t('tower.market.quiet')}</span> : null}
                        {l.thin ? <span class="ctag ctag--quiet">{t('tower.market.thin')}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {lanePages > 1 ? (
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={lanePage === 0} onClick={() => setLanePage(lanePage - 1)}>
                  {t('tower.imports.prev')}
                </button>
                <span class="chint">{t('tower.market.lanePage', { page: lanePage + 1, pages: lanePages, shown: shownLanes.length, total: foundLanes.length })}</span>
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={lanePage >= lanePages - 1} onClick={() => setLanePage(lanePage + 1)}>
                  {t('tower.imports.next')}
                </button>
              </div>
            ) : null}
            {unplaceable > 0 ? <p class="chint">{t('tower.market.unplaceable', { n: unplaceable })}</p> : null}
            {openLane ? <LaneSheet lane={openLane} since={since} api={client?.api as never} onClose={() => setPicked(null)} /> : null}
            <p class="ctbl__sub">{t('tower.market.lanesFoot')}</p>
          </section>
        </>
      ) : null}
    </>
  );
}

/** Exported for the fleet office's context line, which asks the same question from the other side. */
export { boardVsMarket };
