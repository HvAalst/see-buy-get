import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
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
  topLanes,
  type MarketSeriesView,
} from '../market';
import type { TowerActions } from '../useTowerApp';

const RANGES = [30, 90, 365] as const;

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

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    const since = new Date(Date.now() - days * 24 * 3_600_000).toISOString();
    const r = await client.api.marketSeries({ since });
    setLoading(false);
    if (r.error) {
      setError(r.error.detail || r.error.title);
      return;
    }
    setError(null);
    setSeries(r.data as unknown as MarketSeriesView);
  }, [client, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const mood = marketMood(series);
  const met = series ? takeUp(series.totals) : null;
  const points = series ? chartPoints(series.days) : [];
  const quiet = series ? quietLanes(series.lanes) : [];
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
              {quiet.length ? <span class="ctag ctag--warn">{t('tower.market.quietCount', { n: quiet.length })}</span> : null}
            </div>
            {series.lanes.length === 0 ? (
              <p class="cons__empty">{t('tower.market.lanesNone')}</p>
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
                  {topLanes(series.lanes).map((l) => (
                    <tr key={l.lane}>
                      <td class="ctbl__lead">{l.lane}</td>
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
            <p class="ctbl__sub">{t('tower.market.lanesFoot')}</p>
          </section>
        </>
      ) : null}
    </>
  );
}

/** Exported for the fleet office's context line, which asks the same question from the other side. */
export { boardVsMarket };
