import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { formatDate, useLocale, useT } from '../../../shared/i18n';
import { Markdown } from '../../../shared/documents/markdown';
import { countryNameIn, fetchDocument, fetchDocumentCountries, fetchDocumentHistory, type DocumentCountry, type PublishedDocument, type PublishedVersionLine } from '../../../shared/documents/documents';
import { prerenderedDocument, prerenderedTowns } from '../prerendered';
import { CONTACT_PATH, HELP_PATH } from '../help';
import { AUDIENCES, NOTICES, countriesOf, forPath, noticeKey, pageKey, range, type Audience, type InfoPage, type Notice } from '../pages';
import '../pages.css';

/**
 * SEEBUYGET AT A GLANCE, AND A PAGE FOR EACH READER — written to be quoted (the user, 2026-10-22: "a marketing page for
 * agentic search optimization"). A search engine or an AI assistant reads the built HTML and quotes one sentence at a
 * time, so each answers on its own; a person reads the same page top to bottom. Built at build time (prerender.tsx),
 * with a FAQPage a machine can read for the questions.
 */
export function InfoScreen({ page }: { page: InfoPage }) {
  return page.kind === 'about' ? <About /> : page.kind === 'notice' ? <NoticePage which={page.which} /> : <ForPage who={page.who} />;
}

/** The country a notice page is asked for — `/terms/?country=KE` — or none: the general text. Never while building. */
function countryAsked(): string | undefined {
  try {
    const code = new URLSearchParams(globalThis.location?.search ?? '').get('country')?.trim().toUpperCase();
    return code && /^[A-Z]{2}$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * THE TERMS OF USE, YOUR DATA, OR COOKIES — as staff published them in the console (the user, 2026-10-25), with which
 * version it is and what changed. Built with the words the server had when the site was built, then read again: a
 * version published since shows without a new release. Every earlier version can be read back, word for word. The way
 * to write to us about it chooses the data topic; the other two documents are in the site's foot.
 *
 * GENERAL, AND EACH COUNTRY'S OWN (the user, 2026-10-25: "general terms of use, global, and specific terms of use"): the
 * page is the general text, and lists the countries that add a text of their own; `?country=KE` is Kenya's, said to be
 * read together with the general one.
 */
function NoticePage({ which }: { which: Notice }) {
  const t = useT();
  const locale = useLocale();
  const [country] = useState(countryAsked);
  const [doc, setDoc] = useState<PublishedDocument | null>(() => (country ? null : prerenderedDocument(which)));
  const [failed, setFailed] = useState(false);
  const [history, setHistory] = useState<PublishedVersionLine[] | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [countries, setCountries] = useState<DocumentCountry[]>([]);

  useEffect(() => {
    let live = true;
    void fetchDocument(which, undefined, country).then((d) => {
      if (!live) return;
      if (d) {
        setDoc(d);
        setCurrent(d.number);
      } else setFailed(true);
    });
    if (!country) {
      void fetchDocumentCountries(which).then((c) => {
        if (live && c) setCountries(c);
      });
    }
    return () => {
      live = false;
    };
  }, [which, country]);

  const openVersion = (number: number) => {
    void fetchDocument(which, number, country).then((d) => {
      if (d) setDoc(d);
    });
  };
  const showHistory = () => {
    void fetchDocumentHistory(which, country).then((h) => setHistory(h ?? []));
  };

  const where = country ? countryNameIn(country, locale) : undefined;
  const general = NOTICES[which].path;
  const latest = current ?? doc?.number ?? null;
  const old = doc && latest !== null && doc.number < latest;
  return (
    <article class="land pg">
      <header class="pg__head">
        <h1 class="land__title">{doc?.title ?? t(noticeKey(which, 'title'))}</h1>
        {/* Said only of a country text there is: one with none is told so below, with the way to the general. */}
        {where && doc ? (
          <p class="land__lede">
            {t('pages.notice.forCountry', { country: where })}{' '}
            <a class="land__link" href={general}>
              {t('pages.notice.general')}
            </a>
          </p>
        ) : null}
        {doc ? <p class="pg__asof">{t('pages.notice.version', { number: doc.number, date: formatDate(doc.publishedAt) })}</p> : null}
        {old ? (
          <p class="pg__old">
            {t('pages.notice.reading', { number: doc.number, date: formatDate(doc.publishedAt) })}{' '}
            <button type="button" class="land__link pg__btn" onClick={() => openVersion(latest)}>
              {t('pages.notice.current')}
            </button>
          </p>
        ) : null}
      </header>

      {doc ? (
        <Markdown text={doc.body} class="md pg__md" />
      ) : failed && where ? (
        // A country with no text of its own: the general one is all there is, everywhere.
        <p class="pg__asof">
          {t('pages.notice.noneForCountry', { country: where })}{' '}
          <a class="land__link" href={general}>
            {t('pages.notice.general')}
          </a>
        </p>
      ) : (
        <p class="pg__asof">{t(failed ? 'pages.notice.unavailable' : 'pages.notice.loading')}</p>
      )}

      {doc && doc.number > 1 && doc.changeNote ? <p class="pg__changed">{t('pages.notice.changed', { note: doc.changeNote })}</p> : null}

      {countries.length ? (
        <section class="land__sec">
          <h2 class="land__h2">{t('pages.notice.countriesTitle')}</h2>
          <p>{t('pages.notice.countriesLede')}</p>
          <ul class="pg__list">
            {countries.map((c) => (
              <li key={c.country}>
                <a class="land__link" href={c.path}>
                  {countryNameIn(c.country, locale)}
                </a>{' '}
                — {t('pages.notice.version', { number: c.number, date: formatDate(c.publishedAt) })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {doc ? (
        <section class="land__sec pg__history">
          {history === null ? (
            <button type="button" class="land__link pg__btn" onClick={showHistory}>
              {t('pages.notice.earlier')}
              <Icon name="chevronDown" size={18} />
            </button>
          ) : (
            <>
              <h2 class="land__h2">{t('pages.notice.earlier')}</h2>
              {history.length > 1 ? (
                <ul class="pg__list">
                  {history.map((v) => (
                    <li key={v.number}>
                      <button type="button" class="land__link pg__btn" onClick={() => openVersion(v.number)}>
                        {t('pages.notice.readVersion', { number: v.number })}
                      </button>{' '}
                      — {formatDate(v.publishedAt)}. {v.changeNote}
                    </li>
                  ))}
                </ul>
              ) : (
                <p class="pg__asof">{t('pages.notice.earlierNone')}</p>
              )}
            </>
          )}
        </section>
      ) : null}

      <footer class="pg__foot">
        <p class="pg__links">
          <a class="land__link" href={`${CONTACT_PATH}?topic=privacy`}>
            {t('pages.notice.write')}
            <Icon name="chevronRight" size={18} />
          </a>
        </p>
      </footer>
    </article>
  );
}

function About() {
  const t = useT();
  const locale = useLocale();
  const towns = prerenderedTowns();
  const countries = countriesOf(towns, locale);
  return (
    <article class="land pg">
      <header class="pg__head">
        <h1 class="land__title">{t('pages.about.title')}</h1>
        <p class="land__lede">{t('pages.about.lede')}</p>
      </header>

      <section class="land__sec">
        <h2 class="land__h2">{t('pages.about.howTitle')}</h2>
        <ol class="pg__steps">
          {range(5).map((i) => (
            <li key={i}>{t(`pages.about.how${i}` as never)}</li>
          ))}
        </ol>
      </section>

      <section class="land__sec">
        <h2 class="land__h2">{t('pages.forAll')}</h2>
        <ul class="pg__who">
          {AUDIENCES.map((a) => (
            <li key={a.who}>
              <a href={forPath(a.who)}>
                <span class="pg__whot">{t(pageKey(a.who, 'title'))}</span>
                {/* Read as one sentence, by a screen reader and in the plain-text copy: the title, then what it is. */}
                <span class="sr-only">: </span>
                <span class="land__p">{t(a.blurb)}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section class="land__sec">
        <h2 class="land__h2">{t('pages.about.whereTitle')}</h2>
        {/* A count from the build, never a list of towns (the user: "we should be truthful"). */}
        <p class="land__p">{towns.length && countries ? t('pages.about.where', { n: towns.length, countries }) : t('pages.about.whereNone')}</p>
      </section>

      <section class="land__sec">
        <h2 class="land__h2">{t('pages.about.priceTitle')}</h2>
        <p class="land__p">{t('pages.about.price')}</p>
      </section>

      <section class="land__sec">
        <h2 class="land__h2">{t('pages.about.safeTitle')}</h2>
        <ul class="pg__list">
          {range(4).map((i) => (
            <li key={i}>{t(`pages.about.safe${i}` as never)}</li>
          ))}
        </ul>
      </section>

      <section class="land__sec">
        <h2 class="land__h2">{t('pages.about.companyTitle')}</h2>
        <p class="land__p">{t('pages.about.company')}</p>
        <p class="land__p">{t('pages.about.matchOnly')}</p>
      </section>

      <section class="land__sec">
        <h2 class="land__h2">{t('pages.about.helpTitle')}</h2>
        <p class="land__p">{t('pages.about.helpBody')}</p>
        <p class="pg__links">
          <a class="land__link" href={HELP_PATH}>
            {t('pages.about.helpLink')}
            <Icon name="chevronRight" size={18} />
          </a>
          <a class="land__link" href={CONTACT_PATH}>
            {t('pages.about.contactLink')}
            <Icon name="chevronRight" size={18} />
          </a>
        </p>
      </section>

      <section class="land__sec">
        <h2 class="land__h2">{t('pages.about.aiTitle')}</h2>
        <p class="land__p">
          {t('pages.about.aiBody')} <a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">llms-full.txt</a>
        </p>
      </section>
    </article>
  );
}

function ForPage({ who }: { who: Audience }) {
  const t = useT();
  const spec = AUDIENCES.find((a) => a.who === who)!;
  const k = (part: string) => t(pageKey(who, part));
  return (
    <article class="land pg">
      <header class="pg__head">
        <h1 class="land__title">{k('title')}</h1>
        <p class="land__lede">{k('lede')}</p>
        <div class="land__cta">
          <a class="btn btn--primary land__primary" href={spec.join}>
            {k('cta')}
            <Icon name="chevronRight" size={20} class="btn__chev" />
          </a>
        </div>
      </header>

      <section class="land__sec">
        <h2 class="land__h2">{t('pages.how')}</h2>
        <ol class="pg__steps">
          {range(spec.steps).map((i) => (
            <li key={i}>{k(`step${i}`)}</li>
          ))}
        </ol>
      </section>

      <section class="land__sec">
        <h2 class="land__h2">{t('pages.needs')}</h2>
        <ul class="pg__list">
          {range(spec.needs).map((i) => (
            <li key={i}>{k(`need${i}`)}</li>
          ))}
        </ul>
      </section>

      <section class="land__sec">
        <h2 class="land__h2">{t('pages.questions')}</h2>
        <div class="land__faq">
          {range(spec.questions).map((i) => (
            <details key={i} class="land__qa" open>
              <summary class="land__q">{k(`q${i}`)}</summary>
              <p class="land__a">{k(`a${i}`)}</p>
            </details>
          ))}
        </div>
        <p class="pg__links">
          <a class="land__link" href={`${HELP_PATH}?for=${spec.help}`}>
            {t('pages.help')}
            <Icon name="chevronRight" size={18} />
          </a>
        </p>
      </section>
    </article>
  );
}
