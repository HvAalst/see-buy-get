import { useCallback, useEffect, useState } from 'preact/hooks';
import { narrow, type ConversationsApi, type SbgError } from '../../lib/sbg';
import { useT } from '../i18n';
import { onLaunch, type SharedIn } from '../launch';
import { Button, ErrorNote, Icon, Note, Pill, Sheet, refusalSentence } from '../ui';
import type { InstallApp } from '../ui/InstallBar';
import { ConversationSheet } from './Conversations';
import { SharedPhotosSheet } from './SharedPhotos';
import { forgetSharedFiles, heldFiles, holdFiles, letGoFiles } from '../sharedFiles';
import { MAX_MESSAGE_CHARS, counterpartKey, type ChatThread } from './logic';
import { hold, held, letGo, linkOf, messageBlocker, messageOf, newestFirst, sendShared, writable, type SendOutcome } from './sharedInLogic';

/**
 * 2026-11-02 — SHARED WITH SEEBUYGET (the owner: "it should show up in the share list especially when we will start
 * sharing in in-chat if that becomes necessary").
 *
 * A driver is sent a pickup point on WhatsApp, or finds the shop on Google Maps, and shares it to SBG Driver. The app
 * opens on what was shared — the words, and the link as a link the person may tap (we never open or fetch it) — and on
 * their chats, newest first, each saying with whom and about which load. One tap sends it there as a message from them;
 * Copy is always beside it, so nothing shared ends on a screen with nowhere to go.
 *
 * Mounted once per app through AppLayer, in the five apps with chats. Signed out, what was shared waits an hour and
 * opens right after the sign-in.
 */
export function SharedInLayer({ app, chats, onSignIn }: { app: InstallApp; chats: ConversationsApi | null | undefined; onSignIn?: () => void }) {
  const t = useT();
  const [shared, setShared] = useState<SharedIn | null>(() => held(app));
  // 2026-11-02 — photos shared from the gallery: the name they wait under on this phone (shared/sharedFiles.ts).
  const [photos, setPhotos] = useState<string | null>(() => heldFiles(app));
  // The chat a message was just sent into, opened from the confirmation.
  const [chat, setChat] = useState<ChatThread | null>(null);

  useEffect(
    () =>
      onLaunch('share', (share) => {
        // Kept before it is shown: a sign-in, a reload or an expired session in between does not lose it.
        hold(app, share);
        setShared(share);
      }),
    [app],
  );

  // Photos are their own kind (shared/launch.ts): they wait for this listener, and are filed, never sent loose.
  useEffect(
    () =>
      onLaunch('files', (id) => {
        holdFiles(app, id);
        setPhotos(id);
      }),
    [app],
  );

  const close = () => {
    letGo(app);
    setShared(null);
  };

  /** Put away: filed, or not wanted. Nothing of them stays on the phone. */
  const closePhotos = () => {
    if (photos) void forgetSharedFiles(photos);
    letGoFiles(app);
    setPhotos(null);
  };

  return (
    <>
      {/* Signed out: said, so a share that seemed to do nothing is not shared again — and the way to sign in, where the
          app signs in from inside it (the Send app). `undefined` is a session still being restored: nothing said yet. */}
      {shared && chats === null ? (
        <div class="sharedin__held">
          <Note tone="info" icon="send" title={t('sharedIn.held.title')} detail={t('sharedIn.held.detail')} />
          <div class="sharedin__heldacts">
            {onSignIn ? (
              <Button variant="outline" full={false} chevron={false} onClick={onSignIn}>
                {t('sharedIn.held.signIn')}
              </Button>
            ) : null}
            <Button variant="link" full={false} onClick={close}>
              {t('sharedIn.held.forget')}
            </Button>
          </div>
        </div>
      ) : null}
      {photos && chats === null ? (
        <div class="sharedin__held">
          <Note tone="info" icon="camera" title={t('sharedIn.photos.held.title')} detail={t('sharedIn.photos.held.detail')} />
          <div class="sharedin__heldacts">
            {onSignIn ? (
              <Button variant="outline" full={false} chevron={false} onClick={onSignIn}>
                {t('sharedIn.held.signIn')}
              </Button>
            ) : null}
            <Button variant="link" full={false} onClick={closePhotos}>
              {t('sharedIn.held.forget')}
            </Button>
          </div>
        </div>
      ) : null}
      {chats ? (
        <>
          <SharedPhotosSheet
            api={chats}
            id={photos}
            onClose={closePhotos}
            onOpenChat={(x) => {
              closePhotos();
              setChat(x);
            }}
          />
          <SharedInSheet
            key={shared ? messageOf(shared) : ''}
            app={app}
            api={chats}
            shared={shared}
            onClose={close}
            onOpenChat={(x) => {
              close();
              setChat(x);
            }}
          />
          <ConversationSheet api={chats} thread={chat} onClose={() => setChat(null)} />
        </>
      ) : null}
    </>
  );
}

/** The sheet: what was shared, the chats it can go into, and Copy. Holds the asking; `SharedInView` draws it. */
export function SharedInSheet({
  app,
  api,
  shared,
  onClose,
  onOpenChat,
}: {
  app: InstallApp;
  api: ConversationsApi;
  shared: SharedIn | null;
  onClose: () => void;
  onOpenChat: (thread: ChatThread) => void;
}) {
  const t = useT();
  const [message, setMessage] = useState(() => (shared ? messageOf(shared) : ''));
  // Too long for one message: the words are open to shorten from the start, never a send that can only be refused.
  const [editing, setEditing] = useState(() => Boolean(shared && messageBlocker(messageOf(shared))));
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [loadError, setLoadError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SendOutcome>>({});
  const [last, setLast] = useState<ChatThread | null>(null);
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const r = await api.mine();
    if (r.error) return setLoadError(r.error);
    setThreads(newestFirst(writable(narrow<ChatThread[]>(r.data) ?? [])));
  }, [api]);

  useEffect(() => {
    if (shared) void load();
  }, [load, shared]);

  const pick = async (x: ChatThread) => {
    if (busy) return;
    setBusy(x.conversationId);
    const outcome = await sendShared(api, x.conversationId, message.trim(), refusalSentence);
    setBusy(null);
    setResults((r) => ({ ...r, [x.conversationId]: outcome }));
    if (outcome.state !== 'refused') setLast(x);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <Sheet open={Boolean(shared)} onClose={onClose} title={t('sharedIn.title')}>
      {shared ? (
        <SharedInView
          app={app}
          link={linkOf(shared)}
          message={message}
          editing={editing}
          threads={threads}
          loadError={loadError}
          busy={busy}
          results={results}
          last={last}
          copied={copied}
          onEdit={(text) => {
            setMessage(text);
            setCopied(null);
          }}
          onStartEditing={() => setEditing(true)}
          onPick={(x) => void pick(x)}
          onCopy={() => void copy()}
          onRetry={() => void load()}
          onOpenChat={onOpenChat}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

export interface SharedInViewProps {
  app: InstallApp;
  /** The web link in what was shared, drawn as a link where it stands in the words. */
  link: string | undefined;
  /** What goes into the chat — what was shared, as the person may have changed it. */
  message: string;
  editing: boolean;
  /** Their chats, newest first; null while they are asked for. */
  threads: ChatThread[] | null;
  loadError: SbgError | null;
  /** The chat being sent into now. */
  busy: string | null;
  results: Record<string, SendOutcome>;
  /** The chat it last went into, for the confirmation. */
  last: ChatThread | null;
  copied: 'copied' | 'failed' | null;
  onEdit: (text: string) => void;
  onStartEditing: () => void;
  onPick: (thread: ChatThread) => void;
  onCopy: () => void;
  onRetry: () => void;
  onOpenChat: (thread: ChatThread) => void;
  onClose: () => void;
}

/** The words, with the link in them drawn as a link. Only a web link: anything else shared stays words. */
function Linked({ text, link }: { text: string; link: string | undefined }) {
  const at = link ? text.indexOf(link) : -1;
  if (!link || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      {/* Opened by the browser if they tap it; this app never opens or fetches it (no preview is made). */}
      <a class="sharedin__link" href={link} target="_blank" rel="noopener noreferrer">
        {link}
      </a>
      {text.slice(at + link.length)}
    </>
  );
}

export function SharedInView(p: SharedInViewProps) {
  const t = useT();
  const blocker = messageBlocker(p.message);
  const empty = !p.message.trim();
  const who = (x: ChatThread) => x.counterpartName ?? t(counterpartKey(x));
  const lastOutcome = p.last ? p.results[p.last.conversationId] : undefined;

  return (
    <div class="sharedin">
      <h3 class="scr__section">{t('sharedIn.what')}</h3>
      {p.editing ? (
        <div class="field">
          <label class="field__label" for="sharedin-text">
            {t('sharedIn.editLabel')}
          </label>
          <textarea id="sharedin-text" class="input" rows={5} maxLength={4000} value={p.message} onInput={(e) => p.onEdit(e.currentTarget.value)} />
        </div>
      ) : (
        <p class="sharedin__what">
          <Linked text={p.message} link={p.link} />
        </p>
      )}
      {blocker ? (
        <p class="hint" role="alert">
          {t(blocker, { max: MAX_MESSAGE_CHARS })}
        </p>
      ) : null}
      <div class="sharedin__acts">
        <Button variant="outline" full={false} chevron={false} disabled={empty} onClick={p.onCopy}>
          {t('sharedIn.copy')}
        </Button>
        {p.editing ? null : (
          <Button variant="link" full={false} onClick={p.onStartEditing}>
            {t('sharedIn.edit')}
          </Button>
        )}
      </div>
      {p.copied ? (
        <p class="hint" role="status">
          {t(p.copied === 'copied' ? 'sharedIn.copied' : 'sharedIn.copyFailed')}
        </p>
      ) : null}

      <h3 class="scr__section">{t('sharedIn.chatsTitle')}</h3>

      {/* It went: said, with the way into that chat, and the way out. The list stays below for a second chat. */}
      {p.last && lastOutcome && lastOutcome.state !== 'refused' ? (
        <div class="sharedin__done">
          {lastOutcome.state === 'queued' ? (
            <Note tone="info" icon="clock" title={t('sharedIn.queued', { who: who(p.last) })} />
          ) : (
            <Note tone="ok" icon="check" title={t('sharedIn.sent', { who: who(p.last), code: p.last.freightCode })} />
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
      ) : null}

      {p.loadError ? (
        <ErrorNote error={p.loadError} onRetry={p.onRetry} />
      ) : p.threads === null ? (
        <p class="hint">{t('common.loading')}</p>
      ) : p.threads.length === 0 ? (
        // No chats yet: what a chat is, and how one starts — and Copy, above, still takes it anywhere.
        <Note tone="info" icon="info" title={t('sharedIn.none.title')} detail={t(`sharedIn.none.${p.app}` as 'sharedIn.none.driver')} />
      ) : (
        <>
          <p class="hint">{t('sharedIn.chatsLede')}</p>
          <div class="rows" role="list">
            {p.threads.map((x) => {
              const r = p.results[x.conversationId];
              // A message can never be taken back, so a chat it went into is not offered twice.
              const went = r?.state === 'sent' || r?.state === 'queued';
              return (
                <div key={x.conversationId} role="listitem">
                  <button
                    type="button"
                    class="row"
                    disabled={x.blocked || went || Boolean(p.busy) || empty || blocker !== null}
                    aria-busy={p.busy === x.conversationId}
                    onClick={() => p.onPick(x)}
                  >
                    <span class="row__ic">
                      <Icon name="send" size={22} />
                    </span>
                    <span class="row__body">
                      <span class="row__t">
                        {x.freightCode} · {who(x)}
                      </span>
                      <span class="row__s">{x.freightLabel}</span>
                    </span>
                    <span class="row__end">
                      {x.blocked ? (
                        <Pill tone="idle">{t('common.chat.closedPill')}</Pill>
                      ) : r?.state === 'sent' ? (
                        <Pill tone="ok">{t('sharedIn.sentPill')}</Pill>
                      ) : r?.state === 'queued' ? (
                        <Pill tone="info">{t('sharedIn.waitingPill')}</Pill>
                      ) : p.busy === x.conversationId ? (
                        <span class="hint">{t('sharedIn.sending')}</span>
                      ) : (
                        <Icon name="chevronRight" size={22} />
                      )}
                    </span>
                  </button>
                  {/* Refused — a closed thread, too many messages, no signal — in the words it came with, under the chat it was meant for. */}
                  {r?.state === 'refused' ? <p class="hint sharedin__refused" role="alert">{t('common.chat.unsent', { why: r.why })}</p> : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
