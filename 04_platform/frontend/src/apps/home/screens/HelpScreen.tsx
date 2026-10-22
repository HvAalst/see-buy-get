import { useEffect, useMemo, useState } from 'preact/hooks';
import { Chip, Icon, SearchInput } from '../../../shared/ui';
import { useLocale, useT } from '../../../shared/i18n';
import { GUIDE_APPS, articleById, articles, type GuideArticle, type PublicApp } from '../../../shared/guide/articles';
import { CONTACT_PATH, HELP_PATH, HELP_ROLES, MOST_ASKED, alphabetical, articlePath, forRole, relatedOf, roleOf, searchArticles, type HelpPage, type HelpRole } from '../help';
import { ContactScreen } from './ContactScreen';
import '../help.css';

/**
 * THE HELP CENTRE — on the front door, one address per article (the user, 2026-10-22: "help could be done better";
 * "Help in the front door app"). The index asks who you are and lets you search; each article is a page of its own,
 * written into HTML at build time so search engines and AI assistants read it, with what is related and a way to write
 * to us when it did not help. Every word is in the catalog (en.help.ts), in the reader's language.
 */
export function HelpScreen({ page }: { page: HelpPage }) {
  if (page.kind === 'contact') return <ContactScreen />;
  if (page.kind === 'article') return <ArticlePage id={page.id} />;
  return <HelpIndex />;
}

function HelpIndex() {
  const t = useT();
  const locale = useLocale();
  const all = useMemo(() => articles(t), [t, locale]);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<HelpRole | null>(null);
  // Who the reader is, from the address (?for=shop) — read after the first frame, which is the page as it was built.
  useEffect(() => setRole(roleOf(globalThis.location?.search ?? '')), []);
  const choose = (next: HelpRole | null) => {
    setRole(next);
    try {
      const url = new URL(location.href);
      if (next) url.searchParams.set('for', next);
      else url.searchParams.delete('for');
      history.replaceState(null, '', url);
    } catch {
      /* the address stays as it was; the list is still the one chosen */
    }
  };

  const found = query.trim() ? searchArticles(forRole(all, role), query) : null;
  const most = MOST_ASKED.map((id) => all.find((a) => a.id === id)).filter((a): a is GuideArticle => Boolean(a));
  const listed = alphabetical(forRole(all, role), locale);

  return (
    <div class="scr help">
      <h1 class="scr__title">{t('help.ui.title')}</h1>
      <p class="scr__lede">{t('help.ui.lede')}</p>
      <SearchInput value={query} onInput={setQuery} label={t('help.ui.searchLabel')} placeholder={t('help.ui.searchPlaceholder')} />

      <div class="help__roles" role="group" aria-label={t('help.ui.rolesLabel')}>
        <Chip label={t('help.ui.role.all')} active={role === null} onClick={() => choose(null)} />
        {HELP_ROLES.map((r) => (
          <Chip key={r.role} label={t(r.label)} active={role === r.role} onClick={() => choose(r.role)} />
        ))}
      </div>

      {found ? (
        <section class="help__sec" aria-live="polite">
          <h2 class="help__h2">{t('help.ui.results', { n: found.length })}</h2>
          {found.length ? <ArticleRows list={found} withSummary /> : <p class="hint">{t('help.ui.noResults')}</p>}
        </section>
      ) : (
        <>
          {role === null ? (
            <section class="help__sec">
              <h2 class="help__h2">{t('help.ui.mostAsked')}</h2>
              <ArticleRows list={most} withSummary />
            </section>
          ) : null}
          <section class="help__sec">
            <h2 class="help__h2">{role === null ? t('help.ui.everything') : t('help.ui.forYou', { n: listed.length })}</h2>
            <ArticleRows list={listed} />
          </section>
        </>
      )}

      <StillStuck />
    </div>
  );
}

function ArticlePage({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const all = useMemo(() => articles(t), [t, locale]);
  const a = useMemo(() => articleById(id, t), [id, t, locale]);
  if (!a) {
    return (
      <div class="scr help">
        <h1 class="scr__title">{t('help.ui.unknownTitle')}</h1>
        <p class="scr__lede">{t('help.ui.unknownBody')}</p>
        <a class="btn btn--outline btn--full" href={HELP_PATH}>
          {t('help.ui.allHelp')}
        </a>
      </div>
    );
  }
  const apps = a.apps.filter((x): x is PublicApp => x !== 'console').map((x) => t(GUIDE_APPS[x]));
  const related = relatedOf(a, all);
  return (
    <article class="scr help">
      <nav class="help__crumbs" aria-label={t('help.ui.crumbsLabel')}>
        <a href={HELP_PATH}>{t('help.ui.title')}</a>
        <Icon name="chevronRight" size={16} />
        <span aria-current="page">{a.title}</span>
      </nav>
      <h1 class="scr__title">{a.title}</h1>
      {apps.length ? <p class="help__in">{t('help.ui.in', { apps: apps.join(' · ') })}</p> : null}
      <p class="scr__lede">{a.summary}</p>
      {a.steps?.length ? (
        <ol class="help__steps">
          {a.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      ) : null}
      {(a.notes ?? []).map((n) => (
        <p key={n} class="help__note">
          {n}
        </p>
      ))}

      <StillStuck about={a.id} />

      {related.length ? (
        <section class="help__sec">
          <h2 class="help__h2">{t('help.ui.related')}</h2>
          <ArticleRows list={related} />
        </section>
      ) : null}
      <a class="land__link" href={HELP_PATH}>
        {t('help.ui.allHelp')}
        <Icon name="chevronRight" size={18} />
      </a>
    </article>
  );
}

function ArticleRows({ list, withSummary }: { list: GuideArticle[]; withSummary?: boolean }) {
  return (
    <ul class="rows help__rows">
      {list.map((a) => (
        <li key={a.id}>
          <a class="row" href={articlePath(a.id)}>
            <span class="row__body">
              <span class="row__t">{a.title}</span>
              {withSummary ? <span class="row__s">{a.summary}</span> : null}
            </span>
            <span class="row__end">
              <Icon name="chevronRight" size={20} />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** At the foot of every help page: when the help did not help, write to us — carrying the article it was about. */
function StillStuck({ about }: { about?: string }) {
  const t = useT();
  return (
    <aside class="help__stuck">
      <h2 class="help__h2">{t('help.ui.stuckTitle')}</h2>
      <p class="help__stuckp">{t('help.ui.stuckBody')}</p>
      <a class="btn btn--outline btn--full" href={about ? `${CONTACT_PATH}?about=${encodeURIComponent(about)}` : CONTACT_PATH}>
        {t('help.ui.stuckCta')}
      </a>
    </aside>
  );
}
