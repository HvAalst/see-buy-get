import { Card, ErrorNote, Note, Pill, ReadAloud } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import type { StoreReputation } from '../api';
import type { HomeActions, HomeState } from '../useHomeApp';

export interface StoreScreenProps {
  state: HomeState;
  actions: HomeActions;
}

/** A rate as a percentage, or a dash — never 0% for "we have not measured this yet". */
const pct = (n?: number): string => (n == null ? '—' : `${Math.round(n * 100)}%`);

/**
 * How long "quickly" is, in words a shopper reads rather than a number they convert.
 *
 * Hours under a day, then days. "38 hours" is arithmetic somebody has to do; "about 2 days" is the fact
 * they were actually asking for.
 */
function handoverWords(hours: number | undefined, t: Translate): string {
  if (hours == null) return '—';
  if (hours < 1) return t('home.store.underAnHour');
  if (hours < 24) return t('home.store.hours', { n: String(Math.round(hours)) });
  return t('home.store.days', { n: String(Math.round((hours / 24) * 10) / 10) });
}

/**
 * A store's public reputation — mostly things we watched, not things we were told.
 *
 * WHY IT IS HERE AND NOT ONLY IN THE WIDGET. If this page existed only inside the price widget a
 * merchant chooses to install, any merchant with a bad score would suppress it by not installing — and a
 * score the badly-behaved can opt out of is not a score. So it lives on the one app that serves
 * strangers, readable without an account, the same rule the public freight market already keeps.
 *
 * The other half of that rule binds US: everything here is measured identically for every store and
 * there is no switch anywhere that tunes one. If a merchant can hide a bad score we are worthless to
 * buyers; if we can adjust one, we are selling reputation.
 *
 * MEASURED LEADS, opinions follow. What no review site can compute is the part worth showing first: we
 * carried the parcel, so we know when it was sold and when it reached a counter. The stars are last and
 * are withheld entirely below a real sample — telling a shopper a new business is "rated 3.0" on its
 * third order is this network damaging somebody who has done nothing wrong.
 */
export function StoreScreen({ state, actions }: StoreScreenProps) {
  const t = useT();
  const r: StoreReputation | null = state.reputation;

  if (state.reputationState === 'error') {
    return (
      <div class="scr">
        {state.reputationError ? <ErrorNote error={state.reputationError} onRetry={() => void (r && actions.openStore(r.vendorId))} /> : null}
      </div>
    );
  }
  if (!r) return <div class="scr"><p class="scr__lede">{t('home.store.loading')}</p></div>;

  const nothingYet = r.shipments === 0;

  return (
    <div class="scr">
      <h1 class="scr__title">{r.name}</h1>
      <p class="scr__lede">{t('home.store.lede')}</p>

      {/* A store with no shipments is NEW, and says so rather than showing a wall of dashes that reads
          like a store with problems. The most common reason to be here with nothing measured is having
          just opened. */}
      {nothingYet ? (
        <Note tone="info" icon="info" title={t('home.store.newTitle')} detail={t('home.store.newDetail')} />
      ) : (
        <>
          <Card title={t('home.store.measuredTitle')}>
            <p class="card__note">{t('home.store.measuredNote')}</p>
            <div class="rows" role="list">
              <div class="row row--static" role="listitem">
                <span class="row__body">
                  <span class="row__t">{pct(r.shipsNextDayRate)}</span>
                  <span class="row__s">{t('home.store.nextDay')}</span>
                </span>
              </div>
              <div class="row row--static" role="listitem">
                <span class="row__body">
                  <span class="row__t">{handoverWords(r.medianHoursToHandover, t)}</span>
                  <span class="row__s">{t('home.store.typical')}</span>
                </span>
              </div>
              {/* Shown only when there is something to show. A 0% "never arrived" on every well-behaved
                  store is a line that trains people to skip the section. */}
              {r.neverDroppedRate ? (
                <div class="row row--static" role="listitem">
                  <span class="row__body">
                    <span class="row__t">{pct(r.neverDroppedRate)}</span>
                    <span class="row__s">{t('home.store.neverArrived')}</span>
                  </span>
                </div>
              ) : null}
              {r.upheldDisputeRate ? (
                <div class="row row--static" role="listitem">
                  <span class="row__body">
                    <span class="row__t">{pct(r.upheldDisputeRate)}</span>
                    <span class="row__s">{t('home.store.upheld')}</span>
                  </span>
                </div>
              ) : null}
            </div>
            <p class="card__note">{t('home.store.basedOn', { n: String(r.shipments) })}</p>
          </Card>

          {r.tags.length ? (
            <Card title={t('home.store.saidTitle')}>
              <div class="chips">
                {r.tags.map((tag) => (
                  <span key={tag.tag} class={`chip${tag.positive ? '' : ' chip--neg'}`}>
                    {t(`send.rate.tag.${tag.tag}` as 'send.rate.tag.WELL_PACKED')} · {tag.count}
                  </span>
                ))}
              </div>
              <p class="card__note">{t('home.store.saidNote')}</p>
            </Card>
          ) : null}

          <Card title={t('home.store.starsTitle')}>
            {r.rating.isNew ? (
              /* REP1, inherited unchanged: no headline average until there is enough to average. */
              <Note tone="info" icon="info" title={t('home.store.tooFewTitle')} detail={t('home.store.tooFewDetail', { n: String(r.rating.count) })} />
            ) : (
              <p class="t-body">
                <Pill tone="ok">{r.rating.average.toFixed(1)}</Pill> {t('home.store.outOfFive', { n: String(r.rating.count) })}
              </p>
            )}
          </Card>
        </>
      )}

      {/* The rule, said out loud on the page it governs. A buyer has no reason to trust any of this
          unless they know the store could not have edited it. */}
      <Note tone="info" icon="lock" title={t('home.store.ruleTitle')} detail={t('home.store.ruleDetail')} />

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            nothingYet
              ? t('home.store.newDetail')
              : t('home.store.aloud', { name: r.name, pct: pct(r.shipsNextDayRate), n: String(r.shipments) })
          }
          label={t('home.readAloud')}
        />
      </div>
    </div>
  );
}
