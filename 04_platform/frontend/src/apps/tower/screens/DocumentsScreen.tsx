import { useCallback, useEffect, useState } from 'preact/hooks';
import { formatDate, useT } from '../../../shared/i18n';
import { ErrorNote } from '../../../shared/ui';
import { Markdown } from '../../../shared/documents/markdown';
import { narrow, type SbgError } from '../../../lib/sbg';
import { diffCounts, foldUnchanged, textDiff, type DiffLine } from '../textDiff';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * THE TERMS OF USE, YOUR DATA, AND COOKIES — written here, published by two, every version kept (the user, 2026-10-25:
 * "the text can be drafted and inserted but need cms from the staff console and it's usual track of changes
 * timestamped etc.").
 *
 * A document is never edited in place. A change is a new version: written by one member of staff with a note saying
 * what changed, published by a DIFFERENT one, or declined with a reason. Each version says who wrote it and when, who
 * published it and when, how many people agreed to it — and can be read, and compared with the one before it, line by
 * line and word by word.
 */
export type DocumentKind = 'terms' | 'privacy' | 'cookies';

export interface DocVersion {
  versionId: string;
  kind: DocumentKind;
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

export interface DocEntry {
  kind: DocumentKind;
  path: string;
  current: DocVersion;
  pending?: DocVersion;
  versions: DocVersion[];
}

const DRAFT_KEY = (kind: DocumentKind) => `sbg-document-draft:${kind}`;

/** An unsent draft, kept in this browser only — a convenience: a closed tab does not lose an afternoon's wording. */
function readDraft(kind: DocumentKind): { title: string; body: string; changeNote: string; askAgain: boolean } | null {
  try {
    const raw = globalThis.localStorage?.getItem(DRAFT_KEY(kind));
    return raw ? (JSON.parse(raw) as { title: string; body: string; changeNote: string; askAgain: boolean }) : null;
  } catch {
    return null;
  }
}

function keepDraft(kind: DocumentKind, draft: { title: string; body: string; changeNote: string; askAgain: boolean } | null): void {
  try {
    if (draft) globalThis.localStorage?.setItem(DRAFT_KEY(kind), JSON.stringify(draft));
    else globalThis.localStorage?.removeItem(DRAFT_KEY(kind));
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
        items.map((entry) => <DocumentPanel key={entry.kind} entry={entry} state={state} actions={actions} onChanged={load} />)
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
  const { current, pending } = entry;
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
        <span class="cons__panelt">{current.title}</span>
        <a class="docs__path" href={entry.path} target="_blank" rel="noopener noreferrer">
          {entry.path}
        </a>
      </div>
      <p class="docs__line">
        <span class="ctag ctag--ok">{t('tower.docs.version', { number: current.number ?? 0 })}</span>{' '}
        {current.source === 'seed'
          ? t('tower.docs.seeded', { when: formatDate(current.publishedAt ?? current.writtenAt) })
          : t('tower.docs.publishedBy', { when: formatDate(current.publishedAt ?? ''), writer: current.writtenBy, publisher: current.decidedBy ?? '' })}{' '}
        · {t('tower.docs.agreed', { n: current.agreed ?? 0 })}
      </p>

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
          <DiffView before={current} after={pending} />
          {error ? <ErrorNote error={error} showDetail /> : null}
          <div class="docs__decide">
            {pending.mine ? null : (
              <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void decide(pending, true)}>
                {t('tower.docs.publish', { number: (current.number ?? 0) + 1 })}
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
        <Editor kind={entry.kind} current={current} who={who} actions={actions} onDone={async (sent) => {
          setWriting(false);
          if (sent) await onChanged();
        }} />
      ) : (
        <div class="docs__actions">
          <button type="button" class="cbtn cbtn--primary" onClick={() => setWriting(true)}>
            {t('tower.docs.write')}
          </button>
          <button type="button" class="cbtn" onClick={() => setView(view?.versionId === current.versionId && view.mode === 'read' ? null : { versionId: current.versionId, mode: 'read' })}>
            {t('tower.docs.read')}
          </button>
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

/** Writing a new version: from the published text, with a preview, a note saying what changed, and whether it asks again. */
function Editor({ kind, current, who, actions, onDone }: { kind: DocumentKind; current: DocVersion; who?: string; actions: TowerActions; onDone: (sent: boolean) => Promise<void> }) {
  const t = useT();
  const client = actions.client();
  const kept = readDraft(kind);
  const [title, setTitle] = useState(kept?.title ?? current.title);
  const [body, setBody] = useState(kept?.body ?? current.body);
  const [changeNote, setChangeNote] = useState(kept?.changeNote ?? '');
  const [askAgain, setAskAgain] = useState(kept?.askAgain ?? false);
  const [preview, setPreview] = useState<'write' | 'preview' | 'changes'>('write');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);

  useEffect(() => {
    const unchanged = title === current.title && body === current.body && !changeNote;
    keepDraft(kind, unchanged ? null : { title, body, changeNote, askAgain });
  }, [title, body, changeNote, askAgain]);

  const same = title.trim() === current.title && body.trim() === current.body.trim();
  const blocker = same ? t('tower.docs.nothingChanged') : !changeNote.trim() ? t('tower.docs.needNote') : null;

  return (
    <div class="docs__editor">
      <label class="cfield">
        <span class="cfield__label">{t('tower.docs.f.title')}</span>
        <input class="cinput" value={title} maxLength={120} onInput={(e) => setTitle(e.currentTarget.value)} />
      </label>
      <div class="docs__tabs" role="tablist">
        {(['write', 'preview', 'changes'] as const).map((tab) => (
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
      ) : (
        <DiffView before={current} after={{ ...current, title, body, number: undefined }} />
      )}
      <label class="cfield">
        <span class="cfield__label">{t('tower.docs.f.note')}</span>
        <input class="cinput" value={changeNote} maxLength={1000} placeholder={t('tower.docs.f.notePlaceholder')} onInput={(e) => setChangeNote(e.currentTarget.value)} />
        <span class="chint">{t('tower.docs.f.noteHint')}</span>
      </label>
      <label class="docs__check">
        <input type="checkbox" checked={askAgain} onChange={(e) => setAskAgain(e.currentTarget.checked)} />
        <span>
          <b>{t('tower.docs.f.askAgain')}</b>
          <span class="chint">{t('tower.docs.f.askAgainHint')}</span>
        </span>
      </label>
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
            const r = await client.api.proposeDocument(kind, { title: title.trim(), body, changeNote: changeNote.trim(), askAgain, ...(who ? { by: who } : {}) });
            setBusy(false);
            if (r.error) return setError(r.error);
            keepDraft(kind, null);
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
