import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Chip, Icon } from '../../../shared/ui';
import { useLocale, useT } from '../../../shared/i18n';
import { GUIDE_APPS, HELP_GROUPS, articleById, articles, type GuideArticle, type HelpGroup, type PublicApp } from '../../../shared/guide/articles';
import { CONTACT_PATH, HELP_PATH, HELP_ROLES, MOST_ASKED, articlePath, byGroup, forRole, relatedOf, roleOf, roleOfArticle, searchArticles, type HelpPage, type HelpRole } from '../help';
import { HelpText } from '../helpText';
import { ContactScreen } from './ContactScreen';
import '../help.css';

/**
 * THE HELP CENTRE — on the front door, one address per article (the user, 2026-10-22: "Help in the front door app"),
 * drawn after the review of that day: a reading page of its own, distinct from the apps' working screens (its own face,
 * orange where the eye should land, a dark mode a driver may switch on at night — the user: "a switch for the drivers,
 * not the standard"); each reader's help grouped by task; steps as the centre of an article; warnings marked; the why and
 * the rare cases folded away; every button the reader must find drawn as a chip and every route through the screens as
 * a path. Every word is in the catalog (en.help.ts), in the reader's language. Built into HTML at build time.
 */
export function HelpScreen({ page }: { page: HelpPage }) {
  const [dark, setDark] = useHelpTheme();
  const [contentsOpen, setContentsOpen] = useState(false);
  return (
    <div class="hc" data-theme={dark ? 'dark' : 'light'}>
      <HelpTop dark={dark} onDark={setDark} contents={page.kind === 'article' ? { open: contentsOpen, toggle: () => setContentsOpen((o) => !o) } : undefined} />
      {page.kind === 'contact' ? (
        <div class="hc__single">
          <ContactScreen />
        </div>
      ) : page.kind === 'article' ? (
        <ArticlePage id={page.id} contentsOpen={contentsOpen} />
      ) : (
        <HelpIndex />
      )}
    </div>
  );
}

/** The reader's choice of light or dark, for the help only, kept on this device. Light unless they chose dark. */
const THEME_KEY = 'sbg-help-theme';
function useHelpTheme(): [boolean, (dark: boolean) => void] {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try {
      setDark(globalThis.localStorage?.getItem(THEME_KEY) === 'dark');
    } catch {
      /* a browser that keeps nothing: light, as everybody starts */
    }
  }, []);
  const choose = (next: boolean) => {
    setDark(next);
    try {
      globalThis.localStorage?.setItem(THEME_KEY, next ? 'dark' : 'light');
      document.documentElement.dataset.helpTheme = next ? 'dark' : 'light';
    } catch {
      /* chosen for this visit */
    }
  };
  return [dark, choose];
}

/** The help's own top bar: its mark, a search over every article, Contents on a phone, and light or dark. */
function HelpTop({ dark, onDark, contents }: { dark: boolean; onDark: (dark: boolean) => void; contents?: { open: boolean; toggle: () => void } }) {
  const t = useT();
  const locale = useLocale();
  const all = useMemo(() => articles(t), [t, locale]);
  const [q, setQ] = useState('');
  const found = q.trim() ? searchArticles(all, q).slice(0, 6) : [];
  return (
    <header class="hc__top">
      <div class="hc__topin">
        {/* The mark goes home, to the front page; the word goes to the help's own start. */}
        <nav class="hc__brand" aria-label={t('help.ui.crumbsLabel')}>
          <a class="hc__logo" href="/" aria-label={t('help.ui.home')} title={t('help.ui.home')}>
            <img class="hc__tile" src="/img/brand-tile.svg" width={30} height={30} alt="" />
            <span aria-hidden="true">SeeBuyGet</span>
          </a>
          <span class="hc__sep" aria-hidden="true">
            ›
          </span>
          <a class="hc__logo hc__logo--help" href={HELP_PATH}>
            {t('help.ui.title')}
          </a>
        </nav>
        <form
          class="hc__search"
          role="search"
          action={HELP_PATH}
          method="get"
          onSubmit={(e) => {
            if (found[0]) {
              e.preventDefault();
              location.assign(articlePath(found[0].id));
            }
          }}
        >
          <Icon name="search" size={18} />
          <input name="q" type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder={t('help.ui.searchPlaceholder')} aria-label={t('help.ui.searchLabel')} autocomplete="off" />
          {found.length ? (
            <ul class="hc__found" role="listbox" aria-label={t('help.ui.results', { n: found.length })}>
              {found.map((a) => (
                <li key={a.id}>
                  <a href={articlePath(a.id)}>{a.title}</a>
                </li>
              ))}
            </ul>
          ) : null}
        </form>
        {contents ? (
          <button type="button" class="hc__btn hc__contentsbtn" aria-expanded={contents.open} aria-controls="hc-side" onClick={contents.toggle}>
            {t('help.ui.contents')}
          </button>
        ) : null}
        <button type="button" class="hc__btn" aria-pressed={dark} onClick={() => onDark(!dark)} title={t('help.ui.themeLabel')}>
          <Icon name={dark ? 'sun' : 'moon'} size={18} />
          <span>{t(dark ? 'help.ui.light' : 'help.ui.dark')}</span>
        </button>
      </div>
    </header>
  );
}

function HelpIndex() {
  const t = useT();
  const locale = useLocale();
  const all = useMemo(() => articles(t), [t, locale]);
  const [role, setRole] = useState<HelpRole | null>(null);
  const [query, setQuery] = useState('');
  // Who the reader is (?for=shop) and what they searched (?q=), from the address — after the first frame, which is the
  // page as it was built.
  useEffect(() => {
    const search = globalThis.location?.search ?? '';
    setRole(roleOf(search));
    setQuery(new URLSearchParams(search).get('q') ?? '');
  }, []);
  const choose = (next: HelpRole | null) => {
    setRole(next);
    try {
      const url = new URL(location.href);
      if (next) url.searchParams.set('for', next);
      else url.searchParams.delete('for');
      url.searchParams.delete('q');
      history.replaceState(null, '', url);
    } catch {
      /* the address stays as it was; the list is still the one chosen */
    }
    setQuery('');
  };

  const found = query.trim() ? searchArticles(all, query) : null;
  const most = MOST_ASKED.map((id) => all.find((a) => a.id === id)).filter((a): a is GuideArticle => Boolean(a));
  const groups = byGroup(forRole(all, role), locale);

  return (
    <div class="hc__single">
      <main class="hc__index">
        <h1>{t('help.ui.title')}</h1>
        <p class="hc__lead">{t('help.ui.lede')}</p>

        <div class="hc__roles" role="group" aria-label={t('help.ui.rolesLabel')}>
          <Chip label={t('help.ui.role.all')} active={role === null} onClick={() => choose(null)} />
          {HELP_ROLES.map((r) => (
            <Chip key={r.role} label={t(r.label)} active={role === r.role} onClick={() => choose(r.role)} />
          ))}
        </div>

        {found ? (
          <section aria-live="polite">
            <h2>{t('help.ui.results', { n: found.length })}</h2>
            {found.length ? <Cards list={found} /> : <p class="hc__muted">{t('help.ui.noResults')}</p>}
          </section>
        ) : (
          <>
            {role === null ? (
              <section>
                <h2>{t('help.ui.mostAsked')}</h2>
                <Cards list={most} />
              </section>
            ) : null}
            {groups.map(([group, list]) => (
              <section key={group}>
                <h2>{t(`help.ui.group.${group}`)}</h2>
                <ul class="hc__list">
                  {list.map((a) => (
                    <li key={a.id}>
                      <a href={role ? `${articlePath(a.id)}?for=${role}` : articlePath(a.id)}>{a.title}</a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}

        <StillStuck />
      </main>
    </div>
  );
}

/** Rows that carry an article's summary: what most readers came for, and search results. */
function Cards({ list }: { list: GuideArticle[] }) {
  return (
    <ul class="hc__cards">
      {list.map((a) => (
        <li key={a.id}>
          <a href={articlePath(a.id)}>
            <span class="hc__cardt">{a.title}</span>
            <span class="hc__cardsum">{a.summary}</span>
            <span class="hc__chev" aria-hidden="true">
              ›
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function ArticlePage({ id, contentsOpen }: { id: string; contentsOpen: boolean }) {
  const t = useT();
  const locale = useLocale();
  const all = useMemo(() => articles(t), [t, locale]);
  const a = useMemo(() => articleById(id, t), [id, t, locale]);
  // Whose help this is being read as: the address says (?for=), else the article's own first reader.
  const [role, setRole] = useState<HelpRole | null>(null);
  useEffect(() => setRole(roleOf(globalThis.location?.search ?? '')), []);
  if (!a) {
    return (
      <div class="hc__single">
        <main class="hc__index">
          <h1>{t('help.ui.unknownTitle')}</h1>
          <p class="hc__lead">{t('help.ui.unknownBody')}</p>
          <a class="hc__more" href={HELP_PATH}>
            {t('help.ui.allHelp')} ›
          </a>
        </main>
      </div>
    );
  }
  const reader = role && forRole([a], role).length ? role : roleOfArticle(a);
  const readerLabel = HELP_ROLES.find((r) => r.role === reader)?.label;
  const apps = a.apps.filter((x): x is PublicApp => x !== 'console').map((x) => t(GUIDE_APPS[x]));
  const kinds = a.noteKinds ?? [];
  const notesOf = (kind: string) => (a.notes ?? []).filter((_, i) => (kinds[i] ?? 'note') === kind);
  const inline = (a.notes ?? []).map((text, i) => ({ text, kind: kinds[i] ?? 'note' })).filter((n) => n.kind === 'note' || n.kind === 'careful');
  const why = notesOf('why');
  const rare = notesOf('rare');
  const related = relatedOf(a, all);
  const onPage: Array<[string, string]> = [
    ...(a.steps?.length ? ([['steps', t('help.ui.steps')]] as Array<[string, string]>) : []),
    ...(why.length ? ([['why', t('help.ui.why')]] as Array<[string, string]>) : []),
    ...(rare.length ? ([['rare', t('help.ui.rare')]] as Array<[string, string]>) : []),
    ...(related.length ? ([['related', t('help.ui.related')]] as Array<[string, string]>) : []),
  ];

  return (
    <div class="hc__wrap">
      <nav id="hc-side" class={`hc__side${contentsOpen ? ' hc__side--open' : ''}`} aria-label={t('help.ui.contents')}>
        <div class="hc__sideapp">
          {readerLabel ? t(readerLabel) : t('help.ui.title')}
          <a href={HELP_PATH}>{t('help.ui.changeReader')}</a>
        </div>
        {byGroup(forRole(all, reader), locale).map(([group, list]) => (
          <div key={group}>
            <h4>{t(`help.ui.group.${group}`)}</h4>
            <ul>
              {list.map((x) => (
                <li key={x.id}>
                  <a href={`${articlePath(x.id)}?for=${reader}`} aria-current={x.id === a.id ? 'page' : undefined}>
                    {x.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <main class="hc__article" id="hc-top">
        <nav class="hc__crumbs" aria-label={t('help.ui.crumbsLabel')}>
          <a href={HELP_PATH}>{t('help.ui.title')}</a>
          <span aria-hidden="true"> › </span>
          {readerLabel ? (
            <>
              <a href={`${HELP_PATH}?for=${reader}`}>{t(readerLabel)}</a>
              <span aria-hidden="true"> › </span>
            </>
          ) : null}
          <span>{t(`help.ui.group.${a.group ?? 'daily'}`)}</span>
        </nav>
        <h1>{a.title}</h1>
        {apps.length ? (
          <p class="hc__applies" aria-label={t('help.ui.appliesTo')}>
            {apps.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </p>
        ) : null}
        <p class="hc__lead">
          <HelpText text={a.summary} />
        </p>

        {a.steps?.length ? (
          <>
            <h2 id="steps">{t('help.ui.steps')}</h2>
            <ol class="hc__steps">
              {a.steps.map((s) => (
                <li key={s}>
                  <p>
                    <HelpText text={s} />
                  </p>
                </li>
              ))}
            </ol>
          </>
        ) : null}

        {inline.map((n) => (
          <Callout key={n.text} kind={n.kind === 'careful' ? 'careful' : 'note'} title={t(n.kind === 'careful' ? 'help.ui.careful' : 'help.ui.note')}>
            <HelpText text={n.text} />
          </Callout>
        ))}

        {why.length ? (
          <details class="hc__fold" id="why">
            <summary>{t('help.ui.why')}</summary>
            {why.map((n) => (
              <p key={n}>
                <HelpText text={n} />
              </p>
            ))}
          </details>
        ) : null}
        {rare.length ? (
          <details class="hc__fold" id="rare">
            <summary>{t('help.ui.rare')}</summary>
            {rare.map((n) => (
              <p key={n}>
                <HelpText text={n} />
              </p>
            ))}
          </details>
        ) : null}

        <StillStuck about={a.id} />

        {related.length ? (
          <section class="hc__related" id="related">
            <h3>{t('help.ui.related')}</h3>
            <ul>
              {related.map((r) => (
                <li key={r.id}>
                  <a href={`${articlePath(r.id)}?for=${reader}`}>
                    {r.title} <span aria-hidden="true">›</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div class="hc__foot">
          <CopyLink path={articlePath(a.id)} />
          <a href="#hc-top">{t('help.ui.backToTop')} ↑</a>
        </div>
      </main>

      {onPage.length > 1 ? (
        <aside class="hc__onpage" aria-label={t('help.ui.onThisPage')}>
          <h4>{t('help.ui.onThisPage')}</h4>
          <ul>
            {onPage.map(([anchor, label]) => (
              <li key={anchor}>
                <a href={`#${anchor}`}>{label}</a>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}

function Callout({ kind, title, children }: { kind: 'note' | 'careful'; title: string; children: ComponentChildren }) {
  return (
    <div class={`hc__call hc__call--${kind}`}>
      <Icon name={kind === 'careful' ? 'warning' : 'info'} size={22} />
      <div>
        <b>{title}</b>
        <p>{children}</p>
      </div>
    </div>
  );
}

/** The article's own address, copied — to send to somebody, or keep. Says so when it is done. */
function CopyLink({ path }: { path: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <button
      type="button"
      class="hc__linkbtn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(new URL(path, location.origin).toString());
          setCopied(true);
          timer.current = setTimeout(() => setCopied(false), 2500);
        } catch {
          /* no clipboard here: the address bar has it */
        }
      }}
    >
      {t(copied ? 'help.ui.copied' : 'help.ui.copyLink')}
    </button>
  );
}

/** At the foot of every help page: when the help did not help, write to us — carrying the article it was about. */
function StillStuck({ about }: { about?: string }) {
  const t = useT();
  return (
    <aside class="hc__stuck">
      <h3>{t('help.ui.stuckTitle')}</h3>
      <p>{t('help.ui.stuckBody')}</p>
      <a class="hc__stuckbtn" href={about ? `${CONTACT_PATH}?about=${encodeURIComponent(about)}` : CONTACT_PATH}>
        {t('help.ui.stuckCta')}
      </a>
    </aside>
  );
}

export type { HelpGroup };
export const _groupsForTests = HELP_GROUPS;
