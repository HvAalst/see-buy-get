import { Icon } from '../../../shared/ui';
import { useLocale, useT } from '../../../shared/i18n';
import { prerenderedTowns } from '../prerendered';
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

/**
 * YOUR DATA, OR COOKIES — what the system does, section by section, every sentence standing on its own. The way to
 * write to us about it chooses that topic; the other page is one tap away.
 */
function NoticePage({ which }: { which: Notice }) {
  const t = useT();
  const spec = NOTICES[which];
  const k = (part: string) => t(noticeKey(which, part));
  return (
    <article class="land pg">
      <header class="pg__head">
        <h1 class="land__title">{k('title')}</h1>
        <p class="land__lede">{k('lede')}</p>
        <p class="pg__asof">{t('pages.notice.asOf')}</p>
      </header>

      {spec.sections.map((s) => (
        <section key={s.id} class="land__sec">
          <h2 class="land__h2">{k(`${s.id}.title`)}</h2>
          <ul class="pg__list">
            {range(s.items).map((i) => (
              <li key={i}>{k(`${s.id}.${i}`)}</li>
            ))}
          </ul>
        </section>
      ))}

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
