import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { PlaceMap } from '../../../shared/ui/PlaceMap';
import { addEnglish, formatDate, useLocale, useT } from '../../../shared/i18n';
import { enDirectory } from '../../../shared/i18n/catalogs/en.directory';
import { countryNameIn } from '../../../shared/documents/documents';
import { forPath } from '../pages';
import {
  DIRECTORY_KINDS,
  DIRECTORY_PATH,
  directoryCountryPath,
  fetchDirectory,
  fetchDirectoryCountry,
  matching,
  prerenderedDirectory,
  siteHost,
  telOf,
  type DirectoryCountry,
  type DirectoryCountryView,
  type DirectoryEntry,
  type DirectoryKind,
  type DirectoryPage,
} from '../directory';
import '../pages.css';
import '../directory.css';

// The directory's words come with its code, never in the front page's first download.
addEnglish(enDirectory);

/**
 * THE LOGISTICS DIRECTORY (the user, 2026-10-30: "a directory much similar to that of fiata.org but in our own style";
 * the choices in memory decided-2026-10-30-directory). FIATA's is a territory picker and, per territory, its members'
 * names and addresses. Ours is the firms on SeeBuyGet whose papers two of our staff checked, by country and by what they
 * do — and on every entry, what the firm says of itself beside what we have seen of its work here.
 *
 * THREE THINGS ON THESE PAGES ARE NOT COSMETIC (as on the agent finder, AgentsScreen):
 * - The order is alphabetical, and the page says so. A list of firms is read as a ranking unless it says otherwise.
 * - Their words are marked as theirs every time, and never checked by us; what we saw stands beside them, counted.
 * - An empty record says which kind of empty it is: most of a firm's work never comes through us.
 *
 * A phone is a Call button, never a printed number; an email an Email button. Only what the firm chose to show.
 */
export function DirectoryScreen({ page }: { page: DirectoryPage }) {
  return page.kind === 'index' ? <Countries /> : <CountryFirms country={page.country} />;
}

/** True once the page runs in a browser — the map is drawn only then, so the built HTML and the first frame agree. */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function firmsLine(n: number, t: ReturnType<typeof useT>): string {
  return n === 1 ? t('directory.firmsOne') : t('directory.firms', { n });
}

function Countries() {
  const t = useT();
  const locale = useLocale();
  const mounted = useMounted();
  const [countries, setCountries] = useState<DirectoryCountry[]>(() => prerenderedDirectory().index?.countries ?? []);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchDirectory().then((r) => {
      if (!live) return;
      if (r.error || !r.data) return setFailed(true);
      setCountries(r.data.countries);
    });
    return () => {
      live = false;
    };
  }, []);

  const named = (c: DirectoryCountry) => countryNameIn(c.country, locale) || c.name;
  const pins = countries.filter((c) => c.at).map((c) => ({ id: c.country, label: `${named(c)} · ${firmsLine(c.total, t)}`, point: c.at! }));

  return (
    <article class="land pg dir">
      <header class="pg__head">
        <h1 class="land__title">{t('directory.title')}</h1>
        <p class="land__lede">{t('directory.lede')}</p>
      </header>

      {failed && countries.length ? <p class="pg__asof">{t('directory.unreachable')}</p> : null}

      <section class="land__sec">
        <h2 class="land__h2">{t('directory.countriesTitle')}</h2>
        {countries.length ? (
          <>
            {mounted && pins.length ? (
              <div class="dir__map">
                <PlaceMap pins={pins} onPick={(cc) => location.assign(directoryCountryPath(cc))} label={t('directory.mapLabel')} />
              </div>
            ) : null}
            <ul class="pg__who dir__countries">
              {countries.map((c) => (
                <li key={c.country}>
                  <a href={directoryCountryPath(c.country)}>
                    <span class="pg__whot">{named(c)}</span>
                    <span class="sr-only">: </span>
                    <span class="land__p">
                      {firmsLine(c.total, t)}
                      {DIRECTORY_KINDS.filter((k) => c[k] > 0)
                        .map((k) => ` · ${t('directory.kindCount', { kind: t(`directory.kinds.${k}`), n: c[k] })}`)
                        .join('')}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p class="land__p">{failed ? t('home.town.unreachable') : t('directory.none')}</p>
            <p class="land__p">{t('directory.noneBody')}</p>
          </>
        )}
      </section>

      <HowItIsMade />
    </article>
  );
}

/** How a firm comes to be listed, how to read an entry, and how to be in it — on both pages. */
function HowItIsMade() {
  const t = useT();
  return (
    <>
      <section class="land__sec">
        <h2 class="land__h2">{t('directory.howTitle')}</h2>
        <ul class="pg__list">
          <li>{t('directory.how1')}</li>
          <li>{t('directory.how2')}</li>
          <li>{t('directory.how3')}</li>
          <li>{t('directory.how4')}</li>
        </ul>
      </section>
      <section class="land__sec">
        <h2 class="land__h2">{t('directory.readTitle')}</h2>
        <p class="land__p">{t('directory.basis')}</p>
      </section>
      <section class="land__sec">
        <h2 class="land__h2">{t('directory.joinTitle')}</h2>
        <p class="pg__links">
          <a class="land__link" href={forPath('business')}>
            {t('directory.joinBusiness')}
            <Icon name="chevronRight" size={18} />
          </a>
          <a class="land__link" href={forPath('fleets')}>
            {t('directory.joinFleet')}
            <Icon name="chevronRight" size={18} />
          </a>
        </p>
      </section>
    </>
  );
}

function CountryFirms({ country }: { country: string }) {
  const t = useT();
  const locale = useLocale();
  const [view, setView] = useState<DirectoryCountryView | null>(() => {
    const built = prerenderedDirectory().country;
    return built?.country === country ? built : null;
  });
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<DirectoryKind | 'all'>('all');
  const [words, setWords] = useState('');

  useEffect(() => {
    let live = true;
    void fetchDirectoryCountry(country).then((r) => {
      if (!live) return;
      if (r.error || !r.data) return setFailed(true);
      setView(r.data);
    });
    return () => {
      live = false;
    };
  }, [country]);

  const name = countryNameIn(country, locale) || view?.name || country;
  const entries = view?.entries ?? [];
  const shown = useMemo(() => matching(entries, kind, words), [entries, kind, words]);
  const counts = DIRECTORY_KINDS.map((k) => [k, entries.filter((e) => e.kinds.includes(k)).length] as const).filter(([, n]) => n > 0);

  return (
    <article class="land pg dir">
      <p class="dir__crumb">
        <a class="land__link" href={DIRECTORY_PATH}>
          {t('directory.allCountries')}
        </a>
      </p>
      <header class="pg__head">
        <h1 class="land__title">{t('directory.countryTitle', { country: name })}</h1>
        <p class="land__lede">{t('directory.countryLede', { country: name })}</p>
      </header>

      {failed && view ? <p class="pg__asof">{t('directory.unreachable')}</p> : null}

      {entries.length ? (
        <section class="land__sec">
          {/* What they do, as buttons — never a select; and the typed words over name, line and what they clear. */}
          {counts.length > 1 ? (
            <div class="dir__kinds" role="group" aria-label={t('directory.show')}>
              <button type="button" class="dir__kind" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
                {t('directory.all', { n: entries.length })}
              </button>
              {counts.map(([k, n]) => (
                <button type="button" key={k} class="dir__kind" aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {t('directory.kindCount', { kind: t(`directory.kinds.${k}`), n })}
                </button>
              ))}
            </div>
          ) : null}
          {entries.length > 5 ? (
            <label class="dir__find">
              <span class="dir__findl">{t('directory.find')}</span>
              <input class="dir__input" type="search" value={words} onInput={(e) => setWords((e.target as HTMLInputElement).value)} />
              <span class="pg__asof">{t('directory.findHint')}</span>
            </label>
          ) : null}
          {shown.length ? (
            <ul class="dir__firms">
              {shown.map((e) => (
                <Firm key={e.handle} e={e} />
              ))}
            </ul>
          ) : (
            <p class="land__p">{t('directory.noMatch')}</p>
          )}
        </section>
      ) : (
        <section class="land__sec">
          <p class="land__p">{failed && !view ? t('home.town.unreachable') : t('directory.countryNone', { country: name })}</p>
          <p class="land__p">{t('directory.noneBody')}</p>
        </section>
      )}

      <HowItIsMade />
    </article>
  );
}

/** A month and a year — "on SeeBuyGet since" needs no day. */
const monthYear = (iso: string) => formatDate(iso, { month: 'long', year: 'numeric' });

function Firm({ e }: { e: DirectoryEntry }) {
  const t = useT();
  const seen: string[] = [];
  if (e.seen.appointed !== undefined) seen.push(t('directory.seenAppointed', { appointed: e.seen.appointed, cleared: e.seen.cleared ?? 0 }));
  if (e.seen.arranged) seen.push(t('directory.seenArranged', { n: e.seen.arranged }));
  if (e.seen.delivered) seen.push(t('directory.seenDelivered', { n: e.seen.delivered }));
  const c = e.contact ?? {};
  const reach = c.phone || c.email || c.website;
  const clears = (e.says?.clears ?? []).map((s) => {
    const key = `home.agents.spec.${s}`;
    const word = t(key as never);
    return word === key ? s.replace(/_/g, ' ') : word;
  });
  const paper = (p: string, what: string) => {
    const key = `directory.paper.${p}`;
    const word = t(key as never);
    return word === key ? what : word;
  };

  return (
    <li class="dir__firm" id={e.handle}>
      <h2 class="dir__name">{e.name}</h2>
      <p class="dir__tags">
        {e.kinds.map((k) => (
          <span class="dir__tag" key={k}>
            {t(`directory.kind.${k}`)}
          </span>
        ))}
        <span class="dir__since">{t('directory.since', { date: monthYear(e.since) })}</span>
      </p>

      {/* THEIR WORDS — marked as theirs every time: the one thing here we did not derive. */}
      {e.words || clears.length || e.says?.places.length ? (
        <div class="dir__words">
          <h3 class="dir__h3">{t('directory.theirWords')}</h3>
          {e.words ? <p class="dir__quote">“{e.words}”</p> : null}
          {clears.length ? <p class="land__p">{t('directory.clears', { what: clears.join(', ') })}</p> : null}
          {e.says?.places.length ? <p class="land__p">{t('directory.clearsAt', { where: e.says.places.join(', ') })}</p> : null}
          <p class="pg__asof">{t('directory.notChecked')}</p>
        </div>
      ) : null}

      {/* WHAT WE SAW — beside it, counted; an empty record says which kind of empty it is. */}
      <div class="dir__seen">
        <h3 class="dir__h3">{t('directory.seenTitle')}</h3>
        {seen.length ? seen.map((s) => <p class="land__p" key={s}>{s}</p>) : <p class="land__p">{t('directory.seenNone')}</p>}
      </div>

      <div class="dir__checks">
        <h3 class="dir__h3">{t('directory.checksTitle')}</h3>
        {e.checks.length ? (
          <ul class="dir__list">
            {e.checks.map((k) => (
              <li key={k.paper + k.at}>
                {paper(k.paper, k.what)} — {t('directory.checked', { date: formatDate(k.at) })}
              </li>
            ))}
          </ul>
        ) : (
          <p class="land__p">{t('directory.checksNone')}</p>
        )}
      </div>

      {c.address ? (
        <p class="land__p">
          <b>{t('directory.address')}:</b> {c.address}
        </p>
      ) : null}
      {c.hours ? (
        <p class="land__p">
          <b>{t('directory.hours')}:</b> {c.hours}
        </p>
      ) : null}

      <div class="dir__reach" role="group" aria-label={t('directory.contactTitle', { name: e.name })}>
        {c.phone ? (
          <a class="pbtn pbtn--primary dir__btn" href={telOf(c.phone)}>
            <Icon name="phone" size={18} />
            {t('directory.call')}
          </a>
        ) : null}
        {c.email ? (
          <a class="pbtn dir__btn" href={`mailto:${c.email}`}>
            <Icon name="mail" size={18} />
            {t('directory.email')}
          </a>
        ) : null}
        {c.website ? (
          <a class="pbtn dir__btn" href={c.website} target="_blank" rel="noopener noreferrer nofollow" title={siteHost(c.website)}>
            <Icon name="globe" size={18} />
            {t('directory.website')}
          </a>
        ) : null}
        <a class="land__link dir__page" href={`/@${e.handle}`}>
          {t('directory.page')}
          <Icon name="chevronRight" size={18} />
        </a>
      </div>
      {!reach ? <p class="pg__asof">{t('directory.noContact')}</p> : null}
    </li>
  );
}
