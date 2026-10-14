import { useEffect, useMemo, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { narrow, type Result } from '../../../lib/sbg';
import { createArchiveApi, type ArchivedNoteDoc } from '../../../lib/sbg/personas/archive';
import { linkRowSays, splitLinks } from '../../../shared/archive/documentLink';
import { canShareFiles, fileNameFor, handOverFile, passOnLink, waysToPassOn } from '../../../shared/archive/handOver';
import { useNoteLinks } from '../../../shared/archive/useNoteLinks';
import { day, retentionLines } from '../../../shared/archive/words';
import type { BusinessClient } from '../api';
import { linksTag } from '../logic';

/*
 * A LOAD'S KEPT NOTE, IN THE BUSINESS APP.
 *
 * A shop, a fleet office and a store read their notes in an archive. A business reads its note ON THE LOAD — so this
 * is where the two things a kept note is for have to be: the whole file, to keep or hand to somebody, and the links to
 * it. A delivered load's receipt is emailed to one of the business's people with such a link in it, which makes this
 * the place the business SEES that link, how often it was opened, and stops it.
 *
 * The same server routes and the same hook as the archive (useNoteLinks): a second way onto an act carries what the
 * first one does. Only the dress is the console's.
 */

/** The whole file — the note, every copy as it was signed, its photographs — and how long we keep it. */
export function NoteFile({ client, noteId, code }: { client: BusinessClient | null; noteId: string; code: string }) {
  const t = useT();
  const api = useMemo(() => (client ? createArchiveApi(client.client.sbg) : null), [client]);
  const [doc, setDoc] = useState<ArchivedNoteDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const shares = useMemo(() => canShareFiles(), []);

  useEffect(() => {
    setDoc(null);
    setSaid('');
    if (!api) return;
    let stale = false;
    void api.note(noteId).then((r: Result<unknown>) => {
      if (!stale && !r.error && r.data) setDoc(narrow<ArchivedNoteDoc>(r.data));
    });
    return () => {
      stale = true;
    };
  }, [api, noteId]);

  const take = async () => {
    if (!api) return;
    setBusy(true);
    setSaid('');
    const r: Result<unknown> = await api.noteBundle(noteId);
    setBusy(false);
    if (r.error || !r.data) return setSaid(t('business.note.fileFailed'));
    // Named by the note's own number where it is known; by the load's code until then.
    const name = fileNameFor(doc?.number ?? code);
    const how = await handOverFile(name, narrow<Blob>(r.data), doc?.number ?? code);
    setSaid(how === 'shared' ? t('doclink.handed.shared') : how === 'saved' ? t('doclink.handed.saved', { name }) : '');
  };

  return (
    <>
      <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void take()}>
        {t(shares ? 'archive.shareBundle' : 'archive.exportBundle')}
      </button>
      {said ? (
        <span class="chint biz-note__line" role="status">
          {said}
        </span>
      ) : null}
      {doc ? <span class="chint biz-note__line">{retentionLines(doc.retention, t).join(' ')}</span> : null}
    </>
  );
}

/** The links to this load's note: where each went, how it was used, whether it still opens — and making and stopping one. */
export function NoteLinksPanel({ client, noteId, title, act }: { client: BusinessClient | null; noteId: string; title: string; act: boolean }) {
  const t = useT();
  const links = useNoteLinks(client ? client.client.sbg : null, noteId);
  const [asking, setAsking] = useState('');
  const [passed, setPassed] = useState('');
  const [showStopped, setShowStopped] = useState(false);
  const { live, stopped } = splitLinks(links.links);
  const ways = useMemo(() => waysToPassOn(), []);
  const tag = linksTag(live.length, t);
  const made = links.made;

  const pass = async (how: 'share' | 'copy') => {
    if (!made) return;
    const went = await passOnLink(made.url, title, how, ways);
    setPassed(went === 'shared' ? t('archive.links.passedShared') : went === 'copied' ? t('archive.links.passedCopied') : went === 'shown' ? t('archive.links.passedShown') : '');
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('archive.links.title')}</span>
        {links.phase === 'ready' ? <span class={`ctag ctag--${tag.tone}`}>{tag.label}</span> : null}
      </div>
      <p class="cons__lede">{t('archive.links.lede')}</p>

      {made ? (
        <div class="cnote biz-link" role="status">
          <strong>{t('archive.links.madeTitle')}</strong>
          <span>{t('archive.links.madeDetail', { date: day(made.expiresAt) })}</span>
          <input class="cinput biz-link__url" type="text" readOnly aria-label={t('archive.links.madeLabel')} value={made.url} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <span class="twr-panelend">
            {ways.share ? (
              <button type="button" class="cbtn cbtn--primary cbtn--sm" onClick={() => void pass('share')}>
                {t('archive.links.send')}
              </button>
            ) : null}
            {ways.copy ? (
              <button type="button" class={`cbtn cbtn--sm ${ways.share ? 'cbtn--ghost' : 'cbtn--primary'}`} onClick={() => void pass('copy')}>
                {t('archive.links.copy')}
              </button>
            ) : null}
          </span>
          {passed ? <span>{passed}</span> : null}
        </div>
      ) : null}

      {links.phase === 'error' ? <p class="cerr">{t('business.note.linksError')}</p> : null}
      {links.phase === 'ready' && links.links.length === 0 ? <p class="chint">{t('archive.links.none')}</p> : null}
      {links.phase === 'ready' && links.links.length > 0 && live.length === 0 ? <p class="chint">{t('archive.links.noneLive')}</p> : null}

      {/* The links that still open are what is shown: each is a way in. The ones that have stopped are the note's
          history — who was sent it, and how that ended — one click away, never gone. */}
      {(showStopped ? [...live, ...stopped] : live).length > 0 ? (
        <div class="crows">
          {(showStopped ? [...live, ...stopped] : live).map((l) => {
            const says = linkRowSays(l, t);
            return (
              <div class="crow" key={l.linkId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name biz-link__name">{says.title}</span>
                  </span>
                  {/* On a line that wraps: how a link stopped is a sentence, and must not end in an ellipsis. */}
                  <span class="biz-loads__flags">
                    <span>
                      {says.state} · {says.used}
                    </span>
                  </span>
                  {/* Cancelling opens under the row, as ending a contract does: it cannot be switched back on, and
                      the button is a finger's width from a row somebody was only reading. */}
                  {act && says.canCancel ? (
                    asking === l.linkId ? (
                      <span class="biz-contract__end">
                        <span class="chint">{t('archive.links.cancelAsk')}</span>
                        <span class="twr-panelend">
                          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setAsking('')}>
                            {t('archive.links.cancelNo')}
                          </button>
                          <button type="button" class="cbtn cbtn--danger cbtn--sm" disabled={links.cancelling === l.linkId} onClick={() => void links.cancelLink(l.linkId).then(() => setAsking(''))}>
                            {t('archive.links.cancelYes')}
                          </button>
                        </span>
                      </span>
                    ) : (
                      <span class="twr-panelend">
                        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setAsking(l.linkId)}>
                          {t('archive.links.cancel')}
                        </button>
                      </span>
                    )
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {stopped.length > 0 ? (
        <button type="button" class="cbtn cbtn--ghost cbtn--sm biz-link__fold" onClick={() => setShowStopped((v) => !v)}>
          {showStopped ? t('archive.links.hideStopped') : stopped.length === 1 ? t('archive.links.showStoppedOne') : t('archive.links.showStoppedMany', { n: stopped.length })}
        </button>
      ) : null}

      {links.problem ? (
        <p class="cerr" role="alert">
          {links.problem}
        </p>
      ) : null}

      {/* Somebody who may only look is told so here, once — not left to find a missing button. */}
      {act ? (
        made ? null : (
          <>
            <div class="twr-panelend biz-link__make">
              <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={links.making || links.phase !== 'ready'} onClick={() => void links.makeLink().then(() => setPassed(''))}>
                {t('archive.links.make')}
              </button>
            </div>
            <p class="chint">{t('archive.links.makeHint')}</p>
          </>
        )
      ) : (
        <p class="chint">{t('business.note.viewer')}</p>
      )}
    </section>
  );
}
