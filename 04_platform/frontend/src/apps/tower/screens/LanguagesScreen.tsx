import { useEffect, useMemo, useState } from 'preact/hooks';
import { LOCALE_ENDONYMS, formatDate, localesWithWords, useT, type Locale } from '../../../shared/i18n';
import { ErrorNote } from '../../../shared/ui';
import type { SbgError } from '../../../lib/sbg';
import { languageRows, placeholderList, reviewProblem, rowCounts, visibleRows, type LanguageFilter, type LanguageRow, type WordReviewRow } from '../languages';
import type { TowerActions, TowerState } from '../useTowerApp';
import { CountrySelect, useCountryAtlas } from './CountrySelect';
import { ConsolePick } from '../ConsolePick';

/**
 * 2026-11-03 — LANGUAGES: EACH COUNTRY REVIEWS THE APPS' WORDS (the owner: "a separate review sheet that lives in 'languages'
 * where a review can be edited as version 2. the first version is not lost. languages are reviewed per country sbg
 * company"). Pick a language and a country you work in; every phrase is a row — the English, version 1 as written into the
 * apps, and your country's version 2. Write your own words, or keep version 1 as it is; every step is kept with who and when.
 */
const ENGLISH = Object.assign(
  {},
  ...Object.values(import.meta.glob<Record<string, unknown>>('../../../shared/i18n/catalogs/en*.ts', { eager: true })).flatMap((m) => Object.values(m).filter((v): v is Record<string, string> => Boolean(v) && typeof v === 'object')),
) as Record<string, string>;
const VERSION_ONE = import.meta.glob<{ words: Record<string, string> }>('../../../shared/i18n/words/*/*.ts');
const PAGE = 40;

export function LanguagesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const atlas = useCountryAtlas(client?.api as never);
  const languages = localesWithWords().filter((l) => l !== 'en');
  const held = state.who?.countries ?? [];
  const everywhere = held.includes('*');
  const [locale, setLocale] = useState<Locale>(languages[0] ?? 'sw');
  const [country, setCountry] = useState<string>(everywhere ? '' : (held[0] ?? ''));
  const [v1, setV1] = useState<Record<string, string> | null>(null);
  const [reviews, setReviews] = useState<WordReviewRow[] | null>(null);
  const [error, setError] = useState<SbgError | null>(null);
  const [filter, setFilter] = useState<LanguageFilter>('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);

  // Version 1 of the language: every file of it, fetched when the language is picked.
  useEffect(() => {
    let live = true;
    setV1(null);
    const files = Object.entries(VERSION_ONE).filter(([path]) => path.includes(`/words/${locale}/`));
    void Promise.all(files.map(([, load]) => load())).then((mods) => {
      if (live) setV1(Object.assign({}, ...mods.map((m) => m.words)));
    });
    return () => {
      live = false;
    };
  }, [locale]);

  // The country's version 2.
  const loadReviews = async () => {
    if (!client || !country) return;
    setReviews(null);
    const r = await client.api.wordReviews(locale, country);
    if (r.error) return setError(r.error as SbgError);
    setError(null);
    setReviews(((r.data as { items?: WordReviewRow[] } | null)?.items ?? []) as WordReviewRow[]);
  };
  useEffect(() => {
    void loadReviews();
  }, [locale, country, client]);

  const rows = useMemo(() => (v1 && reviews ? languageRows(ENGLISH, v1, reviews) : null), [v1, reviews]);
  const counts = rows ? rowCounts(rows) : null;
  const visible = rows ? visibleRows(rows, filter, query) : [];
  const countryOptions = everywhere ? atlas : atlas.filter((c) => held.includes(c.code));

  const saved = (row: WordReviewRow) => setReviews((list) => [...(list ?? []).filter((r) => r.key !== row.key), row]);

  return (
    <div class="cons__page">
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.langs.title')}</h1>
        <p class="cons__lede">{t('tower.langs.lede')}</p>
      </header>
      <section class="cons__panel">
        <div class="twr-knobs__row">
          <ConsolePick label={t('tower.langs.language')} value={locale} onChange={(v) => setLocale(v as Locale)} options={languages.map((l) => ({ value: l, label: LOCALE_ENDONYMS[l] }))} />
          <CountrySelect value={country} onChange={setCountry} label={t('tower.langs.country')} options={countryOptions} />
        </div>
        {!country ? <p class="cons__empty">{t('tower.langs.pickCountry')}</p> : null}
        {error ? <ErrorNote error={error} /> : null}
        {country && !rows && !error ? <p class="cons__empty">{t('tower.imports.loading')}</p> : null}
        {country && rows && counts ? (
          <>
            <div class="twr-tabs" role="group" aria-label={t('tower.langs.filter')}>
              {(['all', 'open', 'reviewed', 'own'] as const).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} class={`cbtn cbtn--sm ${filter === f ? 'cbtn--on' : 'cbtn--ghost'}`} onClick={() => (setFilter(f), setShown(PAGE))}>
                  {t(`tower.langs.f.${f}`, { n: counts[f] })}
                </button>
              ))}
            </div>
            <input class="cinput" style="width:100%" type="search" value={query} onInput={(e) => (setQuery((e.target as HTMLInputElement).value), setShown(PAGE))} placeholder={t('tower.langs.searchPh')} aria-label={t('tower.langs.search')} />
            {visible.length === 0 ? <p class="cons__empty">{t('tower.langs.none')}</p> : null}
            <table class="ctbl ctbl--stack" style="margin-top:12px">
              <tbody>
                {visible.slice(0, shown).map((row) => (
                  <PhraseRow key={row.key} row={row} locale={locale} country={country} actions={actions} onSaved={saved} />
                ))}
              </tbody>
            </table>
            {visible.length > shown ? (
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost" onClick={() => setShown((n) => n + PAGE)}>
                  {t('tower.langs.more', { n: Math.min(PAGE, visible.length - shown), left: visible.length - shown })}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

function PhraseRow({ row, locale, country, actions, onSaved }: { row: LanguageRow; locale: string; country: string; actions: TowerActions; onSaved: (r: WordReviewRow) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const review = row.review;
  const save = async (body: { text?: string; keep?: boolean }) => {
    const client = actions.client();
    if (!client) return;
    if (body.text !== undefined) {
      const p = reviewProblem(row.english, body.text);
      if (p) return setProblem(t(p === 'empty' ? 'tower.langs.problemEmpty' : 'tower.langs.problemPlaceholders', { list: placeholderList(row.english).join(' ') }));
    }
    setBusy(true);
    const r = await client.api.reviewWord(locale, country, row.key, body);
    setBusy(false);
    if (r.error) return setProblem((r.error as SbgError).detail || (r.error as SbgError).title || null);
    setProblem(null);
    setEditing(false);
    onSaved(r.data as WordReviewRow);
  };
  return (
    <tr>
      <td>
        <span class="ctbl__sub" style="display:block">
          <code class="ctbl__mono">{row.key}</code>
        </span>
        <span class="ctbl__sub" style="display:block">
          {t('tower.langs.english')} {row.english}
        </span>
        <span style="display:block">
          {t('tower.langs.v1')} {row.v1 ?? <i>{t('tower.langs.v1None')}</i>}
        </span>
        {review ? (
          <span class="ctbl__strong" style="display:block">
            {t('tower.langs.v2')} {review.text ?? t('tower.langs.kept')} <span class="ctbl__sub">{t('tower.langs.by', { name: review.by, when: formatDate(review.at, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
          </span>
        ) : null}
        {editing ? (
          <label class="cfield" style="margin-top:8px">
            <span class="cfield__label">{t('tower.langs.yourWords')}</span>
            <textarea class="cinput" rows={3} value={draft} onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)} />
            {placeholderList(row.english).length ? <span class="chint">{t('tower.langs.keepThese', { list: placeholderList(row.english).join(' ') })}</span> : null}
          </label>
        ) : null}
        {problem ? <p class="cerr">{problem}</p> : null}
        {history && review ? (
          <ul class="chint" style="margin:6px 0 0;padding-left:18px">
            {review.history.map((h, i) => (
              <li key={i}>{t('tower.langs.step', { words: h.text ?? t('tower.langs.kept'), name: h.by, when: formatDate(h.at, { dateStyle: 'medium', timeStyle: 'short' }) })}</li>
            ))}
          </ul>
        ) : null}
      </td>
      <td class="ctbl__num">
        <span class="twr-panelend">
          {editing ? (
            <>
              <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => void save({ text: draft })}>
                {t('tower.langs.saveV2')}
              </button>
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => (setEditing(false), setProblem(null))}>
                {t('common.cancel')}
              </button>
            </>
          ) : (
            <>
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => (setDraft(review?.text ?? row.v1 ?? row.english), setEditing(true))}>
                {t('tower.langs.edit')}
              </button>
              {!review?.kept && row.v1 ? (
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void save({ keep: true })}>
                  {t('tower.langs.keepV1')}
                </button>
              ) : null}
              {review ? (
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setHistory((h) => !h)}>
                  {t('tower.langs.history', { n: review.history.length })}
                </button>
              ) : null}
            </>
          )}
        </span>
      </td>
    </tr>
  );
}
