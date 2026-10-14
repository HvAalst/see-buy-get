import { useEffect, useState } from 'preact/hooks';
import { Icon, Pill } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { fetchTowns, type TownPage } from '../api';
import { prerenderedTowns } from '../prerendered';

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

  useEffect(() => {
    void fetchTowns().then((r) => {
      if (r.error || !r.data) return setFailed(true);
      setTowns(r.data.items);
    });
  }, []);

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

      <p class="hint">{t('home.town.howTo')}</p>
      <a class="land__link" href="/">
        {t('home.town.allTowns')}
        <Icon name="chevronRight" size={18} />
      </a>
    </div>
  );
}
