import { useCallback, useEffect, useState } from 'preact/hooks';
import { formatDate, useLocale, useT } from '../../../shared/i18n';
import { ErrorNote } from '../../../shared/ui';
import { Markdown } from '../../../shared/documents/markdown';
import { countryNameIn } from '../../../shared/documents/documents';
import { narrow, type SbgError } from '../../../lib/sbg';
import { diffCounts, foldUnchanged, textDiff, type DiffLine } from '../textDiff';
import type { TowerActions, TowerState } from '../useTowerApp';
import { CountrySelect, useCountryAtlas } from './CountrySelect';
import { ConsolePick } from '../ConsolePick';

/**
 * THE TERMS OF USE, YOUR DATA, AND COOKIES — written here, published by two, every version kept (the user, 2026-10-25:
 * "the text can be drafted and inserted but need cms from the staff console and it's usual track of changes
 * timestamped etc.").
 *
 * A document is never edited in place. A change is a new version: written by one member of staff with a note saying
 * what changed, published by a DIFFERENT one, or declined with a reason. Each version says who wrote it and when, who
 * published it and when, how many people agreed to it — and can be read, and compared with the one before it, line by
 * line and word by word.
 *
 * GENERAL, AND EACH COUNTRY'S OWN (the user, 2026-10-25: "every country needs it's specific adjustments, so there will
 * be the general terms of use, global, and specific terms of use"): the general texts first, which everybody agrees to;
 * then each country's own, which everybody there agrees to as well — written here like any other version, its first
 * one included. Everybody a published version concerns is told in their app (the user: "a notification in the bell").
 */
export type DocumentKind = 'terms' | 'privacy' | 'cookies';
const KINDS: readonly DocumentKind[] = ['terms', 'privacy', 'cookies'];

export interface DocVersion {
  versionId: string;
  kind: DocumentKind;
  country?: string;
  number?: number;
  title: string;
  body: string;
  changeNote: string;
  askAgain: boolean;
  status: 'proposed' | 'published' | 'declined';
  basedOn?: string;
  writtenBy: string;
  writtenAt: string;
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
  publishedAt?: string;
  source?: 'seed';
  mine?: boolean;
  agreed?: number;
}

/** One line: the general text of a document, or a country's own. A country's has nothing published until its first is. */
export interface DocEntry {
  key: string;
  kind: DocumentKind;
  country?: string;
  path: string;
  current?: DocVersion;
  pending?: DocVersion;
  versions: DocVersion[];
}

const DRAFT_KEY = (key: string) => `sbg-document-draft:${key}`;

/** An unsent draft, kept in this browser only — a convenience: a closed tab does not lose an afternoon's wording. */
function readDraft(key: string): { title: string; body: string; changeNote: string; askAgain: boolean } | null {
  try {
    const raw = globalThis.localStorage?.getItem(DRAFT_KEY(key));
    return raw ? (JSON.parse(raw) as { title: string; body: string; changeNote: string; askAgain: boolean }) : null;
  } catch {
    return null;
  }
}

function keepDraft(key: string, draft: { title: string; body: string; changeNote: string; askAgain: boolean } | null): void {
  try {
    if (draft) globalThis.localStorage?.setItem(DRAFT_KEY(key), JSON.stringify(draft));
    else globalThis.localStorage?.removeItem(DRAFT_KEY(key));
  } catch {
    /* a private window keeps nothing: the editor still works */
  }
}

export function DocumentsScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [items, setItems] = useState<DocEntry[] | null>(null);
  const [error, setError] = useState<SbgError | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.documents();
    if (r.error) return setError(r.error);
    setError(null);
    setItems(narrow<{ items: DocEntry[] }>(r.data)?.items ?? []);
  }, [client]);

  useEffect(() => {
    void load();
  }, [client]);

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.docs.title')}</h1>
        <p class="cons__lede">{t('tower.docs.lede')}</p>
      </header>
      {error ? <ErrorNote error={error} onRetry={() => void load()} showDetail /> : null}
      {items === null ? (
        <p class="cons__empty">{t('tower.imports.loading')}</p>
      ) : (
        <>
          <h2 class="docs__group">{t('tower.docs.generalTitle')}</h2>
          <p class="docs__grouplede">{t('tower.docs.generalLede')}</p>
          {items
            .filter((entry) => !entry.country)
            .map((entry) => (
              <DocumentPanel key={entry.key} entry={entry} state={state} actions={actions} onChanged={load} />
            ))}
          <CountryLines items={items} state={state} actions={actions} onChanged={load} />
        </>
      )}
    </>
  );
}

/**
 * EACH COUNTRY'S OWN — grouped by country, and a way to write a country's first version of any of the three. A line
 * that exists is changed in its own panel, like the general ones.
 */
function CountryLines({ items, state, actions, onChanged }: { items: DocEntry[]; state: TowerState; actions: TowerActions; onChanged: () => Promise<void> }) {
  const t = useT();
  const locale = useLocale();
  const client = actions.client();
  const atlas = useCountryAtlas(client?.api as never);
  const [adding, setAdding] = useState(false);
  const [country, setCountry] = useState('');
  const [kind, setKind] = useState<DocumentKind>('terms');
  const own = items.filter((entry) => entry.country);
  const nameOf = (code: string) => atlas.find((c) => c.code === code)?.name ?? countryNameIn(code, locale);
  const countries = [...new Set(own.map((entry) => entry.country!))].sort((a, b) => nameOf(a).localeCompare(nameOf(b), locale));
  const exists = country ? own.some((entry) => entry.country === country && entry.kind === kind) : false;
  const general = items.find((entry) => !entry.country && entry.kind === kind)?.current;
  const key = country ? `${kind}@${country}` : '';

  return (
    <>
      <h2 class="docs__group">{t('tower.docs.countriesTitle')}</h2>
      <p class="docs__grouplede">{t('tower.docs.countriesLede')}</p>
      {countries.map((code) => (
        <div key={code} class="docs__country">
          <h3 class="docs__countryname">{nameOf(code)}</h3>
          {own
            .filter((entry) => entry.country === code)
            .map((entry) => (
              <DocumentPanel key={entry.key} entry={entry} state={state} actions={actions} onChanged={onChanged} />
            ))}
        </div>
      ))}
      {adding ? (
        <section class="cons__panel docs__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.docs.addCountry')}</span>
          </div>
          <div class="docs__pick">
            <CountrySelect value={country} onChange={setCountry} label={t('tower.docs.f.country')} options={atlas} />
            <ConsolePick label={t('tower.docs.f.kind')} value={kind} onChange={(v) => setKind(v as DocumentKind)} options={KINDS.map((k) => ({ value: k, label: t(`tower.docs.kind.${k}` as const) }))} />
          </div>
          {exists ? (
            <p class="chint">{t('tower.docs.exists', { country: nameOf(country) })}</p>
          ) : country ? (
            <Editor
              key={key}
              lineKey={key}
              kind={kind}
              country={country}
              countryName={nameOf(country)}
              start={{ title: t('tower.docs.titleFor', { title: general?.title ?? t(`tower.docs.kind.${kind}` as const), country: nameOf(country) }), body: '' }}
              who={state.who?.name}
              actions={actions}
              onDone={async (sent) => {
                if (!sent) {
                  setAdding(false);
                  return;
                }
                setAdding(false);
                setCountry('');
                await onChanged();
              }}
            />
          ) : null}
          {!country || exists ? (
            <div class="docs__decide">
              <button type="button" class="cbtn" onClick={() => setAdding(false)}>
                {t('tower.docs.cancel')}
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <div class="docs__actions">
          <button type="button" class="cbtn" onClick={() => setAdding(true)}>
            {t('tower.docs.addCountry')}
          </button>
        </div>
      )}
    </>
  );
}

function DocumentPanel({ entry, state, actions, onChanged }: { entry: DocEntry; state: TowerState; actions: TowerActions; onChanged: () => Promise<void> }) {
  const t = useT();
  const client = actions.client();
  const who = state.who?.name;
  const [writing, setWriting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [view, setView] = useState<{ versionId: string; mode: 'read' | 'compare' } | null>(null);
  const [error, setError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const locale = useLocale();
  const { current, pending } = entry;
  const where = entry.country ? countryNameIn(entry.country, locale) : undefined;
  const shown = current ?? pending ?? entry.versions[0];
  const published = entry.versions.filter((v) => v.status === 'published');
  const previousOf = (v: DocVersion): DocVersion | undefined =>
    v.status === 'proposed' ? current : v.number ? published.find((p) => p.number === v.number! - 1) : undefined;

  const decide = async (version: DocVersion, publish: boolean) => {
    if (!client) return;
    setBusy(true);
    setError(null);
    const r = publish ? await client.api.publishDocument(version.versionId, who) : await client.api.declineDocument(version.versionId, reason.trim(), who);
    setBusy(false);
    if (r.error) return setError(r.error);
    setReason('');
    await onChanged();
  };

  const opened = view ? entry.versions.find((v) => v.versionId === view.versionId) ?? null : null;

  return (
    <section class="cons__panel docs__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{shown?.title ?? entry.key}</span>
        <a class="docs__path" href={entry.path} target="_blank" rel="noopener noreferrer">
          {entry.path}
        </a>
      </div>
      {current ? (
        <p class="docs__line">
          <span class="ctag ctag--ok">{t('tower.docs.version', { number: current.number ?? 0 })}</span>{' '}
          {current.source === 'seed'
            ? t('tower.docs.seeded', { when: formatDate(current.publishedAt ?? current.writtenAt) })
            : t('tower.docs.publishedBy', { when: formatDate(current.publishedAt ?? ''), writer: current.writtenBy, publisher: current.decidedBy ?? '' })}{' '}
          · {t('tower.docs.agreed', { n: current.agreed ?? 0 })}
        </p>
      ) : (
        <p class="docs__line">
          <span class="ctag ctag--quiet">{t('tower.docs.notPublished')}</span>
        </p>
      )}

      {pending ? (
        <div class="docs__pending">
          <p class="docs__line">
            <span class="ctag ctag--warn">{t('tower.docs.waiting')}</span> {t('tower.docs.writtenBy', { writer: pending.writtenBy, when: formatDate(pending.writtenAt) })}
            {pending.askAgain ? (
              <>
                {' '}
                <span class="ctag ctag--info">{t('tower.docs.asksAgain')}</span>
              </>
            ) : null}
          </p>
          <p class="docs__note">{pending.changeNote}</p>
          {current ? (
            <DiffView before={current} after={pending} />
          ) : (
            <>
              <p class="chint">{t('tower.docs.firstVersion')}</p>
              <div class="docs__view">
                <Markdown text={pending.body} class="md docs__md" />
              </div>
            </>
          )}
          {/* Who is told once it is published (the user, 2026-10-25: "a notification in the bell"). */}
          <p class="chint">{where ? t('tower.docs.tellsCountry', { country: where }) : t('tower.docs.tellsAll')}</p>
          {error ? <ErrorNote error={error} showDetail /> : null}
          <div class="docs__decide">
            {pending.mine ? null : (
              <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void decide(pending, true)}>
                {t('tower.docs.publish', { number: (current?.number ?? 0) + 1 })}
              </button>
            )}
            <label class="cfield docs__reason">
              <span class="cfield__label">{t(pending.mine ? 'tower.docs.withdrawWhy' : 'tower.docs.declineWhy')}</span>
              <input class="cinput" value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
            </label>
            <button type="button" class="cbtn" disabled={busy || !reason.trim()} onClick={() => void decide(pending, false)}>
              {t(pending.mine ? 'tower.docs.withdraw' : 'tower.docs.decline')}
            </button>
          </div>
          {pending.mine ? <p class="chint">{t('tower.docs.ownProposal')}</p> : null}
        </div>
      ) : writing ? (
        <Editor
          lineKey={entry.key}
          kind={entry.kind}
          country={entry.country}
          countryName={where}
          current={current}
          start={shown ? { title: shown.title, body: shown.body } : { title: '', body: '' }}
          who={who}
          actions={actions}
          onDone={async (sent) => {
            setWriting(false);
            if (sent) await onChanged();
          }}
        />
      ) : (
        <div class="docs__actions">
          <button type="button" class="cbtn cbtn--primary" onClick={() => setWriting(true)}>
            {t('tower.docs.write')}
          </button>
          {current ? (
            <button type="button" class="cbtn" onClick={() => setView(view?.versionId === current.versionId && view.mode === 'read' ? null : { versionId: current.versionId, mode: 'read' })}>
              {t('tower.docs.read')}
            </button>
          ) : null}
        </div>
      )}

      <button type="button" class="cbtn cbtn--ghost cbtn--sm docs__toggle" onClick={() => setShowHistory(!showHistory)}>
        {t(showHistory ? 'tower.docs.hideHistory' : 'tower.docs.history', { n: entry.versions.length })}
      </button>
      {showHistory ? (
        <div class="crows docs__history">
          {entry.versions.map((v) => {
            const before = previousOf(v);
            const counts = before ? diffCounts(textDiff(before.body, v.body)) : null;
            return (
              <div class="crow crow--static" key={v.versionId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{v.number ? t('tower.docs.version', { number: v.number }) : t('tower.docs.unnumbered')}</span>
                    <span class={`ctag ${v.status === 'published' ? 'ctag--ok' : v.status === 'proposed' ? 'ctag--warn' : 'ctag--quiet'}`}>{t(`tower.docs.status.${v.status}` as const)}</span>
                    {v.askAgain ? <span class="ctag ctag--info">{t('tower.docs.asksAgain')}</span> : null}
                    {v.number ? <span class="ctag ctag--quiet">{t('tower.docs.agreed', { n: v.agreed ?? 0 })}</span> : null}
                  </span>
                  <span class="crow__sub">
                    {t('tower.docs.writtenBy', { writer: v.writtenBy, when: formatDate(v.writtenAt) })}
                    {v.decidedBy ? ` · ${t(v.status === 'published' ? 'tower.docs.publishedOn' : 'tower.docs.declinedOn', { who: v.decidedBy, when: formatDate(v.decidedAt ?? '') })}` : ''}
                    {counts ? ` · ${t('tower.docs.counts', counts)}` : ''}
                  </span>
                  <span class="crow__sub">{v.changeNote}</span>
                  {v.reason ? <span class="crow__sub">{t('tower.docs.why', { reason: v.reason })}</span> : null}
                </span>
                <span class="docs__rowacts">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setView(view?.versionId === v.versionId && view.mode === 'read' ? null : { versionId: v.versionId, mode: 'read' })}>
                    {t('tower.docs.read')}
                  </button>
                  {before ? (
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setView(view?.versionId === v.versionId && view.mode === 'compare' ? null : { versionId: v.versionId, mode: 'compare' })}>
                      {t('tower.docs.compare')}
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {opened ? (
        <div class="docs__view">
          <p class="docs__line">
            <span class="ctag ctag--quiet">{opened.number ? t('tower.docs.version', { number: opened.number }) : t('tower.docs.unnumbered')}</span> {opened.title}
          </p>
          {view?.mode === 'compare' && previousOf(opened) ? <DiffView before={previousOf(opened)!} after={opened} /> : <Markdown text={opened.body} class="md docs__md" />}
        </div>
      ) : null}
    </section>
  );
}

/** What changed, as track changes: lines added and taken out, and a changed line with its words struck and inserted. */
function DiffView({ before, after }: { before: DocVersion; after: DocVersion }) {
  const t = useT();
  const lines = textDiff(before.body, after.body);
  const titleChanged = before.title !== after.title;
  // Every change with a line either side; the long unchanged stretches between them said as how many lines they are.
  const shown = foldUnchanged(lines.filter((l) => l.kind !== 'same' || l.text.trim()));
  return (
    <div class="tdiff" aria-label={t('tower.docs.compareLabel', { from: before.number ?? 0 })}>
      {titleChanged ? (
        <p class="tdiff__line tdiff__line--changed">
          <del>{before.title}</del> <ins>{after.title}</ins>
        </p>
      ) : null}
      {shown.map((l, i) =>
        l.kind === 'fold' ? (
          <p key={i} class="tdiff__fold">
            {t('tower.docs.unchanged', { n: l.count })}
          </p>
        ) : (
          <DiffRow key={i} line={l} />
        ),
      )}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  if (line.kind === 'changed') {
    return (
      <p class="tdiff__line tdiff__line--changed">
        {line.parts.map((p, i) => (p.kind === 'added' ? <ins key={i}>{p.text}</ins> : p.kind === 'removed' ? <del key={i}>{p.text}</del> : <span key={i}>{p.text}</span>))}
      </p>
    );
  }
  if (line.kind === 'added') return <p class="tdiff__line tdiff__line--added"><ins>{line.text}</ins></p>;
  if (line.kind === 'removed') return <p class="tdiff__line tdiff__line--removed"><del>{line.text}</del></p>;
  return <p class="tdiff__line">{line.text}</p>;
}

/**
 * Writing a new version: from the published text, with a preview, a note saying what changed, and whether it asks again.
 * A country's first starts from nothing but a title naming it, and asks everybody there whatever would be ticked.
 */
function Editor({
  lineKey,
  kind,
  country,
  countryName,
  current,
  start,
  who,
  actions,
  onDone,
}: {
  lineKey: string;
  kind: DocumentKind;
  country?: string;
  countryName?: string;
  current?: DocVersion;
  start: { title: string; body: string };
  who?: string;
  actions: TowerActions;
  onDone: (sent: boolean) => Promise<void>;
}) {
  const t = useT();
  const client = actions.client();
  const kept = readDraft(lineKey);
  const [title, setTitle] = useState(kept?.title ?? start.title);
  const [body, setBody] = useState(kept?.body ?? start.body);
  const [changeNote, setChangeNote] = useState(kept?.changeNote ?? '');
  const [askAgain, setAskAgain] = useState(kept?.askAgain ?? false);
  const [preview, setPreview] = useState<'write' | 'preview' | 'changes'>('write');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);

  useEffect(() => {
    const unchanged = title === start.title && body === start.body && !changeNote;
    keepDraft(lineKey, unchanged ? null : { title, body, changeNote, askAgain });
  }, [title, body, changeNote, askAgain]);

  const same = current ? title.trim() === current.title && body.trim() === current.body.trim() : !body.trim();
  const blocker = same ? t(current ? 'tower.docs.nothingChanged' : 'tower.docs.needText') : !title.trim() ? t('tower.docs.needTitle') : !changeNote.trim() ? t('tower.docs.needNote') : null;

  return (
    <div class="docs__editor">
      <label class="cfield">
        <span class="cfield__label">{t('tower.docs.f.title')}</span>
        <input class="cinput" value={title} maxLength={120} onInput={(e) => setTitle(e.currentTarget.value)} />
      </label>
      <div class="docs__tabs" role="tablist">
        {(current ? (['write', 'preview', 'changes'] as const) : (['write', 'preview'] as const)).map((tab) => (
          <button key={tab} type="button" role="tab" aria-selected={preview === tab} class={`cbtn cbtn--sm ${preview === tab ? 'cbtn--primary' : 'cbtn--ghost'}`} onClick={() => setPreview(tab)}>
            {t(`tower.docs.tab.${tab}` as const)}
          </button>
        ))}
      </div>
      {preview === 'write' ? (
        <label class="cfield">
          <span class="cfield__label">{t('tower.docs.f.body')}</span>
          <textarea class="cinput docs__text" rows={24} value={body} onInput={(e) => setBody(e.currentTarget.value)} />
          <span class="chint">{t('tower.docs.f.bodyHint')}</span>
        </label>
      ) : preview === 'preview' ? (
        <div class="docs__view">
          <Markdown text={body} class="md docs__md" />
        </div>
      ) : current ? (
        <DiffView before={current} after={{ ...current, title, body, number: undefined }} />
      ) : null}
      <label class="cfield">
        <span class="cfield__label">{t('tower.docs.f.note')}</span>
        <input class="cinput" value={changeNote} maxLength={1000} placeholder={t('tower.docs.f.notePlaceholder')} onInput={(e) => setChangeNote(e.currentTarget.value)} />
        <span class="chint">{t('tower.docs.f.noteHint')}</span>
      </label>
      {current ? (
        <label class="docs__check">
          <input type="checkbox" checked={askAgain} onChange={(e) => setAskAgain(e.currentTarget.checked)} />
          <span>
            <b>{t('tower.docs.f.askAgain')}</b>
            <span class="chint">{t('tower.docs.f.askAgainHint')}</span>
          </span>
        </label>
      ) : (
        // Nobody there agreed to anything of the country's own yet: its first version is agreed to by all of them.
        <p class="chint">{t('tower.docs.firstAsks', { country: countryName ?? country ?? '' })}</p>
      )}
      {error ? <ErrorNote error={error} showDetail /> : null}
      <div class="docs__decide">
        <button
          type="button"
          class="cbtn cbtn--primary"
          disabled={busy || blocker !== null}
          onClick={async () => {
            if (!client) return;
            setBusy(true);
            setError(null);
            const r = await client.api.proposeDocument(kind, { title: title.trim(), body, changeNote: changeNote.trim(), askAgain: current ? askAgain : true, ...(country ? { country } : {}), ...(who ? { by: who } : {}) });
            setBusy(false);
            if (r.error) return setError(r.error);
            keepDraft(lineKey, null);
            await onDone(true);
          }}
        >
          {t('tower.docs.propose')}
        </button>
        <button type="button" class="cbtn" onClick={() => void onDone(false)}>
          {t('tower.docs.cancel')}
        </button>
        {blocker ? <span class="chint">{blocker}</span> : <span class="chint">{t('tower.docs.needsSecond')}</span>}
      </div>
    </div>
  );
}
