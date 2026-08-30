import { Button, Card, ErrorNote, Icon, Note, Pill, ReadAloud } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import { bodyWords, marketShape, marketWhere, marketWork } from '../logic';
import type { MarketRow } from '../api';
import { MARKET_REACHES, type HomeActions, type HomeState, type MarketReach } from '../useHomeApp';

export interface MarketScreenProps {
  state: HomeState;
  actions: HomeActions;
}

/**
 * FB3b — the freight market, to anyone at all.
 *
 * The only screen in this app that is not part of joining, and it is here because this is the only app that
 * serves strangers. The people who most need to know what freight moves on a corridor are the ones who do
 * not own a truck to move it with yet: an operator deciding which body to buy, someone weighing up a move to
 * another city (user, 2026-08-30 — "not just a driver, also someone planning of living and working abroad").
 * Putting that behind a sign-in would gate the data on having already made the decision it informs.
 *
 * Two things are load-bearing about how it reads. The MONEY is labelled as indicative every time it appears,
 * because it is the network's default rate and not an offer to anybody. And the SHAPE of demand leads —
 * eleven loads that all want a flatbed is a completely different market from eleven that want eleven
 * different trucks, and a list read top to bottom never shows that.
 */
export function MarketScreen({ state, actions }: MarketScreenProps) {
  const t = useT();
  const rows = state.market;
  const busy = state.marketState === 'locating' || state.marketState === 'loading';
  const answered = state.marketState === 'ready' && state.marketAt != null;
  const shape = marketShape(rows);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('home.market.title')}</h1>
      <p class="scr__lede">{t('home.market.lede')}</p>

      <form
        class="mkt__find"
        onSubmit={(e) => {
          e.preventDefault();
          void actions.lookUpMarket();
        }}
      >
        <div class="field">
          <label class="field__label" for="mkt-q">
            {t('home.market.whereLabel')}
          </label>
          <input
            id="mkt-q"
            class="input"
            type="search"
            autocomplete="off"
            placeholder={t('home.market.wherePh')}
            value={state.marketQuery}
            onInput={(e) => actions.setMarketQuery(e.currentTarget.value)}
          />
        </div>
        <Button type="submit" busy={busy} disabled={!state.marketQuery.trim()}>
          {t('home.market.look')}
        </Button>
      </form>

      <Reach value={state.marketReach} onChange={actions.setMarketReach} />

      {state.error ? <ErrorNote error={state.error} /> : null}

      {busy ? (
        <p class="scr__lede" aria-live="polite">
          {t('common.loading')}
        </p>
      ) : !answered ? (
        <Card title={t('home.market.startTitle')} tone="soft">
          <p class="card__note">{t('home.market.startLede')}</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card title={t('home.market.emptyTitle')} tone="soft">
          <p class="card__note">{t('home.market.emptyLede')}</p>
        </Card>
      ) : (
        <>
          <Shape shape={shape} place={state.marketPlace ?? state.marketQuery} />

          {/* Said once, above the money, and again on every row. These prices are the network's own default
              rate applied to each load — not an offer, and not what any particular operator would earn. */}
          <Note tone="info" icon="wallet" title={t('home.market.basisTitle')} detail={t('home.market.basisDetail')} />

          <div class="rows mkt__list" role="list">
            {rows.map((row, i) => (
              <MarketCard key={`${row.pickupAbout.lat},${row.pickupAbout.lng},${i}`} row={row} />
            ))}
          </div>
        </>
      )}

      <div class="scr__cta">
        <Button variant="outline" onClick={() => actions.go('roles')}>
          {t('home.market.joinCta')}
        </Button>
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => spoken(rows, shape, t)} label={t('home.readAloud')} />
      </div>
    </div>
  );
}

/**
 * The shape of demand, before any individual load.
 *
 * This is the answer to the question the page is actually for. A prospective operator does not need to read
 * eleven rows to learn that this corridor wants flatbeds; they need the count, and then the rows as evidence.
 */
function Shape({ shape, place }: { shape: ReturnType<typeof marketShape>; place: string }) {
  const t = useT();
  return (
    <Card title={t('home.market.shapeTitle', { place })} tone="soft">
      <p class="card__note">{t('home.market.shapeCount', { n: shape.total })}</p>
      {shape.bodies.length ? (
        <div class="mkt__bodies">
          {shape.bodies.map((b) => (
            <Pill key={b.body} tone="info">
              {t('home.market.shapeBody', { body: bodyWords(b.body, t), n: b.n })}
            </Pill>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/** How far the visitor cares to look — theirs to set, exactly as it is the operator's on the driver board. */
function Reach({ value, onChange }: { value: MarketReach; onChange: (r: MarketReach) => void }) {
  const t = useT();
  return (
    <div class="mkt__reach">
      <span class="mkt__reach-lbl" id="mkt-reach">
        {t('home.market.reach')}
      </span>
      <div class="mkt__reach-set" role="group" aria-labelledby="mkt-reach">
        {MARKET_REACHES.map((r) => (
          <button key={String(r)} type="button" class="mkt__reach-btn" aria-pressed={value === r} onClick={() => onChange(r)}>
            {r == null ? t('home.market.reachAny') : t('home.market.reachKm', { km: r })}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One load. No name, no code, no address — the work, the corridor in towns, and the indicative money. */
function MarketCard({ row }: { row: MarketRow }) {
  const t = useT();
  return (
    <article class="row mkt__row" role="listitem">
      <span class="row__ic">
        <Icon name="truck" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">{marketWork(row, t)}</span>
        <span class="row__s">{marketWhere(row, t)}</span>
        <span class="row__s">{t('home.market.distance', { empty: row.deadheadKm, loaded: row.loadedKm, total: row.totalKm })}</span>
        {row.requiredEquipment?.length ? <span class="row__s">{t('home.market.needsKit', { kit: row.requiredEquipment.map((e) => kitWords(e, t)).join(', ') })}</span> : null}
      </span>
      <span class="row__end mkt__money">
        {row.indicativeTotal != null ? (
          <>
            <b class="mkt__amount">{row.indicativeTotal.toFixed(2)}</b>
            <span class="mkt__perkm">{row.indicativePerKm != null ? t('home.market.perKm', { amount: row.indicativePerKm.toFixed(2) }) : t('home.market.perKmNone')}</span>
            <span class="mkt__indicative">{t('home.market.indicative')}</span>
          </>
        ) : (
          <span class="mkt__perkm">{t('home.market.noPrice')}</span>
        )}
      </span>
    </article>
  );
}

/** Equipment codes in words. An unknown code renders as itself rather than vanishing — a silently dropped
 *  requirement is the one that costs somebody a purchase decision. */
function kitWords(code: string, t: Translate): string {
  const key = `home.market.kit.${code}` as 'home.market.kit.FLT';
  const word = t(key);
  return word === key ? code : word;
}

function spoken(rows: MarketRow[], shape: ReturnType<typeof marketShape>, t: Translate): string {
  if (!rows.length) return t('home.market.spokenEmpty');
  const lead = shape.bodies[0];
  return lead ? t('home.market.spoken', { n: rows.length, body: bodyWords(lead.body, t), k: lead.n }) : t('home.market.spokenPlain', { n: rows.length });
}
