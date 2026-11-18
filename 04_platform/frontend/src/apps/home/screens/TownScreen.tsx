import { useEffect, useState } from 'preact/hooks';
import { Icon, Pill } from '../../../shared/ui';
import { formatMoney, useT } from '../../../shared/i18n';
import { TOWN_PRICE_SIZES, fetchTownPrices, fetchTowns, type TownPage, type TownPrices } from '../api';
import { prerenderedTownPrices, prerenderedTowns } from '../prerendered';

const SIZE_WORD = { S: 'home.town.small', M: 'home.town.medium', L: 'home.town.large' } as const;

/** A counter price: whole where it is whole (KES 300), with its cents where it has them (€4.50). */
export const townPrice = (amount: number, currency: string) => formatMoney(amount, currency, Number.isInteger(amount) ? 0 : undefined);

/**
 * 2026-11-18 — WHAT IT COSTS FROM HERE (the owner: example prices per country, "yes"): to another shop in the town and to
 * the country's busiest towns, the lowest price for each size, as paid at the counter. A real table, so a machine reads it
 * as one. Nothing where no company of ours sells: there is no price to show.
 */
export function TownPricesTable({ page, prices }: { page: TownPage; prices: TownPrices | null }) {
  const t = useT();
  if (!prices || prices.slug !== page.slug || !prices.to.length) return null;
  return (
    <section class="town__prices" aria-labelledby="town-prices-h">
      <h2 id="town-prices-h" class="town__h">
        {t('home.town.pricesTitle', { town: page.town })}
      </h2>
      <div class="town__scroll">
        <table class="town__table">
          <thead>
            <tr>
              <th scope="col">{t('home.town.pricesTo')}</th>
              {TOWN_PRICE_SIZES.map((s) => (
                <th key={s} scope="col" class="town__n">
                  {t(SIZE_WORD[s])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {prices.to.map((row) => (
              <tr key={row.slug}>
                <th scope="row">{row.slug === page.slug ? t('home.town.within', { town: page.town }) : row.town}</th>
                {TOWN_PRICE_SIZES.map((s) => (
                  <td key={s} class="town__n">
                    {row.from[s] !== undefined ? townPrice(row.from[s]!, prices.currency) : '–'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="hint">{t('home.town.pricesNote')}</p>
    </section>
  );
}

/**
 * PARCEL SHOPS IN ONE TOWN — `/towns/<slug>`, a page of its own.
 *
 * "Parcel shops in Nairobi" is what people type, and the honest answer is the list: the shops that take parcels
 * there today, open ones first, each with its landmark (there are no street addresses here) and its public page.
 * Built into HTML at build time for search engines and AI assistants (prerender.tsx), then refreshed live.
 */
export function TownScreen({ slug }: { slug: string }) {
  const t = useT();
  const [towns, setTowns] = useState<TownPage[]>(() => prerenderedTowns());
  const [failed, setFailed] = useState(false);
  const [prices, setPrices] = useState<TownPrices | null>(() => prerenderedTownPrices());

  useEffect(() => {
    void fetchTowns().then((r) => {
      if (r.error || !r.data) return setFailed(true);
      setTowns(r.data.items);
    });
    // Fresh prices too: a price card may have changed since the build. Not reached: the build's stay.
    void fetchTownPrices().then((r) => {
      if (!r.error && r.data) setPrices(r.data.items.find((p) => p.slug === slug) ?? null);
    });
  }, [slug]);

  const page = towns.find((p) => p.slug === slug);
  if (!page) {
    return (
      <div class="scr">
        <h1 class="scr__title">{t('home.town.unknownTitle')}</h1>
        <p class="scr__lede">{failed ? t('home.town.unreachable') : t('home.town.unknown')}</p>
        <a class="btn btn--outline btn--full" href="/">
          {t('home.town.allTowns')}
        </a>
      </div>
    );
  }

  const open = page.shops.filter((s) => s.openState === 'open').length;
  return (
    <div class="scr town">
      <h1 class="scr__title">{t('home.town.title', { town: page.town })}</h1>
      <p class="scr__lede">{page.shops.length === 1 ? t('home.town.ledeOne', { town: page.town }) : t('home.town.lede', { town: page.town, n: page.shops.length, open })}</p>
      <div class="scr__cta">
        <a class="btn btn--primary btn--full" href="/send/">
          {t('home.landing.send')}
          <Icon name="chevronRight" size={20} class="btn__chev" />
        </a>
      </div>

      <ul class="rows town__shops" aria-label={t('home.town.shopsLabel', { town: page.town })}>
        {page.shops.map((s) => {
          const body = (
            <>
              <span class="row__ic">
                <Icon name="home" size={22} />
              </span>
              <span class="row__body">
                <span class="row__t">{s.shopName}</span>
                <span class="row__s">{s.landmark}</span>
                {s.rating ? <span class="row__s">{t('home.town.rating', { stars: s.rating.average, n: s.rating.count })}</span> : null}
              </span>
              <span class="row__end">
                <Pill tone={s.openState === 'open' ? 'ok' : 'idle'} dot>
                  {s.openState === 'open' ? t('home.town.open') : t('home.town.closed')}
                </Pill>
              </span>
            </>
          );
          return (
            <li key={s.shopName + s.landmark}>
              {s.handle ? (
                <a class="row" href={`/@${s.handle}`}>
                  {body}
                </a>
              ) : (
                <div class="row row--static">{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      <TownPricesTable page={page} prices={prices} />

      <p class="hint">{t('home.town.howTo')}</p>
      <a class="land__link" href="/">
        {t('home.town.allTowns')}
        <Icon name="chevronRight" size={18} />
      </a>
    </div>
  );
}
