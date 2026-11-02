import { useCallback, useEffect, useState } from 'preact/hooks';
import { narrow, type ConversationsApi, type SbgError } from '../../lib/sbg';
import { useT } from '../i18n';
import { SHARE_LOST } from '../launch';
import { forgetSharedFiles, takeSharedFiles } from '../sharedFiles';
import { Button, ErrorNote, Icon, Note, Pill, Sheet } from '../ui';
import { uploadFailureSentence } from '../ui/ErrorNote';
import { WhatIsThis } from './FiledPhoto';
import { fitsSubject, sourceLabel, type FilingChoice, type PreparedPhoto } from './filedPhotoLogic';
import { counterpartKey, type ChatThread } from './logic';
import { fileAll, photoRefusal, preparePhoto, type FileOutcome } from './photoFiling';
import { newestFirst, writable } from './sharedInLogic';

/**
 * 2026-11-02 — PHOTOS SHARED INTO THE APP FROM THE PHONE'S GALLERY (the owner: such a photo "is asked the same 'What is
 * this?' and filed the same way" — no loose photos anywhere). The photos, each with where it came from — "from the gallery",
 * with the date the phone wrote into it or "no date on it" — then "What is this?", then the chats about a load or a parcel
 * this person may file to. One tap files them all to that chat's record, and its card appears in the chat.
 */
export function SharedPhotosSheet({ api, id, onClose, onOpenChat }: { api: ConversationsApi; id: string | null; onClose: () => void; onOpenChat: (thread: ChatThread) => void }) {
  const [phase, setPhase] = useState<SharedPhotosViewProps['phase']>('loading');
  const [photos, setPhotos] = useState<Array<PreparedPhoto | { failed: string }>>([]);
  const [words, setWords] = useState<string | undefined>(undefined);
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [loadError, setLoadError] = useState<SbgError | null>(null);
  const [choice, setChoice] = useState<FilingChoice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, FileOutcome>>({});
  const [last, setLast] = useState<ChatThread | null>(null);
  const t = useT();

  useEffect(() => {
    if (!id) return undefined;
    let gone = false;
    setPhase('loading');
    setResults({});
    setLast(null);
    setChoice(null);
    void (async () => {
      if (id === SHARE_LOST) return setPhase('lost');
      const kept = await takeSharedFiles(id);
      if (gone) return;
      if (!kept) return setPhase('gone');
      setWords(kept.words);
      // Each made ready from the file as the phone handed it over: its date read first, then made smaller.
      // One this phone cannot open says why, in the words every photo field uses (shared/upload.ts).
      const ready = await Promise.all(
        kept.files.map((f) => preparePhoto(f.blob, 'gallery').catch((e: unknown) => ({ failed: photoRefusal(e, t('sharedIn.photos.unreadable')) }))),
      );
      if (gone) return;
      setPhotos(ready);
      setPhase('ready');
    })();
    return () => {
      gone = true;
    };
  }, [id]);

  const load = useCallback(async () => {
    setLoadError(null);
    const r = await api.mine();
    if (r.error) return setLoadError(r.error);
    setThreads(newestFirst(writable(narrow<ChatThread[]>(r.data) ?? [])).filter((x) => x.canFilePhotos));
  }, [api]);

  useEffect(() => {
    if (id) void load();
  }, [load, id]);

  const pick = async (x: ChatThread) => {
    if (busy || !choice) return;
    const ready = photos.filter(isReady);
    if (!ready.length) return;
    setBusy(x.conversationId);
    const outcome = await fileAll(api, x.conversationId, ready, choice, (e) => uploadFailureSentence(e, 'photo'), t('common.chat.photo.noRoom'));
    setBusy(null);
    setResults((r) => ({ ...r, [x.conversationId]: outcome }));
    if (outcome.state === 'refused') return;
    setLast(x);
    // Filed, or waiting on the phone with the outbox: the copy the share left in the cache is no longer needed.
    if (id) void forgetSharedFiles(id);
  };

  return (
    <Sheet open={Boolean(id)} onClose={onClose} title={t('sharedIn.title')}>
      {id ? (
        <SharedPhotosView
          phase={phase}
          photos={photos}
          words={words}
          choice={choice}
          threads={threads}
          loadError={loadError}
          busy={busy}
          results={results}
          last={last}
          onChoose={setChoice}
          onPick={(x) => void pick(x)}
          onRetry={() => void load()}
          onOpenChat={onOpenChat}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

/** A photo made ready to file — not one that could not be read. */
function isReady(p: PreparedPhoto | { failed: string }): p is PreparedPhoto {
  return !('failed' in p);
}

export interface SharedPhotosViewProps {
  /** loading — being read and made ready; ready; gone — no longer on the phone; lost — never reached the app. */
  phase: 'loading' | 'ready' | 'gone' | 'lost';
  /** Each photo made ready, or why one could not be, in words. */
  photos: Array<PreparedPhoto | { failed: string }>;
  words?: string;
  choice: FilingChoice | null;
  /** The chats this person may file to, newest first; null while asked for. */
  threads: ChatThread[] | null;
  loadError: SbgError | null;
  busy: string | null;
  results: Record<string, FileOutcome>;
  last: ChatThread | null;
  onChoose: (choice: FilingChoice | null) => void;
  onPick: (thread: ChatThread) => void;
  onRetry: () => void;
  onOpenChat: (thread: ChatThread) => void;
  onClose: () => void;
}

/** The sheet's insides, from props alone — so a test can hold it to its words and press its rows. */
export function SharedPhotosView(p: SharedPhotosViewProps) {
  const t = useT();
  if (p.phase === 'lost' || p.phase === 'gone') {
    return (
      <>
        <Note tone="warn" icon="camera" title={t(p.phase === 'lost' ? 'sharedIn.photos.lost' : 'sharedIn.photos.gone')} />
        <div class="sharedin__acts">
          <Button variant="link" full={false} onClick={p.onClose}>
            {t('common.done')}
          </Button>
        </div>
      </>
    );
  }
  if (p.phase === 'loading') return <p class="hint">{t('common.loading')}</p>;

  const who = (x: ChatThread) => x.counterpartName ?? t(counterpartKey(x));
  const lastOutcome = p.last ? p.results[p.last.conversationId] : undefined;
  const filed = Boolean(lastOutcome && lastOutcome.state !== 'refused');
  const readable = p.photos.filter(isReady).length;
  return (
    <div class="sharedin">
      <h3 class="scr__section">{t('sharedIn.photos.what', { count: p.photos.length })}</h3>
      <div class="filedphoto__shared">
        {p.photos.map((photo, i) => {
          if (!isReady(photo)) {
            return (
              <p key={i} class="hint" role="alert">
                {photo.failed}
              </p>
            );
          }
          const label = sourceLabel(photo);
          return (
            <figure key={i} class="filedphoto__fig">
              <img class="filedphoto__preview" src={photo.dataUrl} alt={t('common.chat.photo.previewAlt')} />
              <figcaption class="hint">{t(label.key, label.params)}</figcaption>
            </figure>
          );
        })}
      </div>
      {p.words ? <p class="hint">{t('sharedIn.photos.cameWith', { text: p.words })}</p> : null}
      <p class="hint">{t('sharedIn.photos.lede')}</p>

      {filed ? (
        <div class="sharedin__done">
          {lastOutcome!.state === 'queued' ? (
            <Note tone="info" icon="clock" title={t('sharedIn.photos.queued', { code: p.last!.freightCode })} />
          ) : (
            <Note tone="ok" icon="check" title={t('sharedIn.photos.filed', { code: p.last!.freightCode, who: who(p.last!) })} />
          )}
          <div class="sharedin__acts">
            <Button variant="outline" full={false} chevron={false} onClick={() => p.onOpenChat(p.last!)}>
              {t('sharedIn.openChat')}
            </Button>
            <Button variant="link" full={false} onClick={p.onClose}>
              {t('common.done')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* A subject is not known until a chat is chosen: every moment is offered, and a parcel is never loaded. */}
          <WhatIsThis subject={undefined} choice={p.choice} onChoose={p.onChoose} />
          <h3 class="scr__section">{t('sharedIn.photos.chatsTitle')}</h3>
          {p.loadError ? (
            <ErrorNote error={p.loadError} onRetry={p.onRetry} />
          ) : p.threads === null ? (
            <p class="hint">{t('common.loading')}</p>
          ) : p.threads.length === 0 ? (
            <Note tone="info" icon="info" title={t('sharedIn.photos.none')} />
          ) : (
            <>
              {!p.choice ? <p class="hint">{t('sharedIn.photos.chooseFirst')}</p> : null}
              <div class="rows" role="list">
                {p.threads.map((x) => {
                  const r = p.results[x.conversationId];
                  const fits = fitsSubject(p.choice, x.subject ?? 'freight');
                  return (
                    <div key={x.conversationId} role="listitem">
                      <button
                        type="button"
                        class="row"
                        disabled={!p.choice || !fits || Boolean(p.busy) || !readable}
                        aria-busy={p.busy === x.conversationId}
                        onClick={() => p.onPick(x)}
                      >
                        <span class="row__ic">
                          <Icon name={x.subject === 'parcel' ? 'parcel' : 'truck'} size={22} />
                        </span>
                        <span class="row__body">
                          <span class="row__t">
                            {x.freightCode} · {who(x)}
                          </span>
                          <span class="row__s">{p.choice && !fits ? t('sharedIn.photos.notLoaded') : x.freightLabel}</span>
                        </span>
                        <span class="row__end">
                          {p.busy === x.conversationId ? <span class="hint">{t('sharedIn.photos.filing')}</span> : r?.state === 'filed' ? <Pill tone="ok">{t('sharedIn.photos.filedPill')}</Pill> : <Icon name="chevronRight" size={22} />}
                        </span>
                      </button>
                      {r?.state === 'refused' ? (
                        <p class="hint sharedin__refused" role="alert">
                          {t('common.chat.unsent', { why: r.why })}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
