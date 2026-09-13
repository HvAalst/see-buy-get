import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { narrow, type ConversationsApi } from '../../lib/sbg';
import { formatDate, useT } from '../i18n';
import { Button, Chip, ErrorNote, Icon, Note, Pill, Sheet } from '../ui';
import { MAX_MESSAGE_CHARS, QUICK_REPLIES, REPORT_REASONS, composeBlocker, lastSeqOf, mergeMessages, type ChatMessage, type ChatThread, type ReportReason } from './logic';

/** Catch-up while a thread is open. Push says something arrived; this is what fetches it. Enough to start. */
const POLL_MS = 8000;

/**
 * When a message was sent: the time today, the date and time otherwise. A chat stamped with a date alone
 * (found in the browser pass: every message read "Sep 13, 2026") cannot say whether "on my way" was said a
 * minute ago or this morning — which is exactly the question a waiting shopkeeper is asking.
 */
function whenSent(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${formatDate(at)} ${time}`;
}

/**
 * CV1 — ONE CONVERSATION ABOUT ONE LOAD, in a sheet.
 *
 * Shared by the driver asking and the shop or store answering, because it is the same conversation seen from
 * two ends. Nothing in it can be edited or deleted — the sheet says so in plain words, and says who can read
 * it, rather than claiming a privacy the network does not provide.
 */
export function ConversationSheet({ api, thread, onClose, onChanged }: { api: ConversationsApi | null; thread: ChatThread | null; onClose: () => void; onChanged?: () => void }) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [current, setCurrent] = useState<ChatThread | null>(thread);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState<number | null>(null);
  const [reported, setReported] = useState<number[]>([]);
  const held = useRef<ChatMessage[]>([]);
  const id = thread?.conversationId ?? null;

  const catchUp = useCallback(async () => {
    if (!api || !id) return;
    const after = lastSeqOf(held.current);
    const r = await api.messages(id, after);
    if (r.error) {
      setFailed(r.error.detail || r.error.title || t('common.chat.loadFailed'));
      return;
    }
    const data = narrow<{ thread: ChatThread; items: ChatMessage[] }>(r.data);
    if (!data) return;
    setFailed(null);
    setCurrent(data.thread);
    if (data.items.length) {
      held.current = mergeMessages(held.current, data.items);
      setMessages(held.current);
    }
    const seq = lastSeqOf(held.current);
    if (seq > 0 && data.thread.unread > 0) {
      await api.read(id, seq);
      onChanged?.();
    }
  }, [api, id, onChanged, t]);

  useEffect(() => {
    held.current = [];
    setMessages([]);
    setText('');
    setCurrent(thread);
    setReported([]);
    if (!id) return undefined;
    void catchUp();
    const timer = window.setInterval(() => void catchUp(), POLL_MS);
    return () => window.clearInterval(timer);
    // Re-run only when a different thread opens; catchUp is stable for one thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const send = async (message: { body?: string; quick?: string }) => {
    if (!api || !id) return;
    setBusy(true);
    const r = await api.send(id, message);
    setBusy(false);
    if (r.error) {
      setFailed(r.error.detail || r.error.title || t('common.chat.loadFailed'));
      return;
    }
    const sent = narrow<ChatMessage>(r.data);
    if (sent) {
      held.current = mergeMessages(held.current, [sent]);
      setMessages(held.current);
    }
    if (message.body !== undefined) setText('');
    onChanged?.();
  };

  const setBlocked = async (block: boolean) => {
    if (!api || !id) return;
    setConfirmBlock(false);
    const r = block ? await api.block(id) : await api.unblock(id);
    if (r.error) return setFailed(r.error.detail || r.error.title || t('common.chat.loadFailed'));
    setCurrent(narrow<ChatThread>(r.data) ?? current);
    onChanged?.();
  };

  const report = async (seq: number, reason: ReportReason) => {
    if (!api || !id) return;
    setReporting(null);
    const r = await api.report(id, seq, reason);
    if (r.error) return setFailed(r.error.detail || r.error.title || t('common.chat.loadFailed'));
    setReported((xs) => [...xs, seq]);
  };

  const blocker = composeBlocker(text, current);
  const closed = Boolean(current?.blocked);
  const who = current?.role === 'poster' ? current.counterpartName ?? t('common.chat.driver') : t('common.chat.poster');

  return (
    <Sheet open={Boolean(thread)} onClose={onClose} title={thread ? t('common.chat.title', { code: thread.freightCode }) : ''}>
      {thread ? (
        <>
          <p class="hint">{thread.freightLabel}</p>
          <p class="hint">{t('common.chat.withWho', { who })}</p>
          {/* Said plainly, because it is the promise the thread makes: who can read it, and that it stays. */}
          <Note tone="info" icon="info" title={t('common.chat.privacyTitle')} detail={t('common.chat.privacy')} />
          {failed ? <p class="hint" role="alert">{failed}</p> : null}

          <div class="rows" role="log" aria-live="polite" style="margin-top:12px; gap:8px">
            {messages.length === 0 ? <p class="hint">{t('common.chat.empty')}</p> : null}
            {messages.map((m) => (
              <div
                key={m.seq}
                style={`align-self:${m.mine ? 'flex-end' : 'flex-start'}; max-width:85%; padding:8px 12px; border-radius:14px; background:${m.mine ? 'var(--brand-50, #eef0ff)' : 'var(--surface-2, #f2f2f5)'}`}
              >
                <div class="t-body" style="white-space:pre-wrap; overflow-wrap:anywhere">
                  {m.kind === 'quick' && m.quick ? <b>{t(`common.chat.quick.${m.quick}` as 'common.chat.quick.loaded')}</b> : m.body}
                </div>
                <div class="hint" style="margin-top:2px; font-size:12px">
                  {m.mine ? t('common.chat.you') : who} · {whenSent(m.at)}
                  {!m.mine && !reported.includes(m.seq) ? (
                    <>
                      {' · '}
                      <button type="button" class="linkbtn" onClick={() => setReporting(m.seq)}>
                        {t('common.chat.report')}
                      </button>
                    </>
                  ) : null}
                  {reported.includes(m.seq) ? ` · ${t('common.chat.reported')}` : null}
                </div>
                {reporting === m.seq ? (
                  <div class="chiprow" style="margin-top:6px">
                    {REPORT_REASONS.map((r) => (
                      <Chip key={r} label={t(`common.chat.reason.${r}` as 'common.chat.reason.spam')} active={false} onClick={() => void report(m.seq, r)} />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {closed ? (
            <Note tone="warn" icon="warning" title={t(current?.blockedByMe ? 'common.chat.blockedByMe' : 'common.chat.blocked')} detail="" />
          ) : (
            <>
              <div class="chiprow" role="group" aria-label={t('common.chat.quickTitle')} style="margin-top:12px">
                {QUICK_REPLIES.map((q) => (
                  <Chip key={q} label={t(`common.chat.quick.${q}` as 'common.chat.quick.loaded')} active={false} onClick={() => void send({ quick: q })} />
                ))}
              </div>
              <div class="field" style="margin-top:12px">
                <label class="sr-only" for="chat-text">
                  {t('common.chat.placeholder')}
                </label>
                <textarea
                  id="chat-text"
                  class="input"
                  rows={3}
                  maxLength={MAX_MESSAGE_CHARS + 1}
                  value={text}
                  placeholder={t('common.chat.placeholder')}
                  onInput={(e) => setText(e.currentTarget.value)}
                />
                {blocker ? <p class="hint">{t(blocker, { max: MAX_MESSAGE_CHARS })}</p> : null}
              </div>
              <Button chevron={false} busy={busy} disabled={!text.trim() || blocker !== null} onClick={() => void send({ body: text })}>
                {t('common.chat.send')}
              </Button>
            </>
          )}

          <div style="margin-top:12px">
            {current?.blockedByMe ? (
              <Button variant="link" full={false} onClick={() => void setBlocked(false)}>
                {t('common.chat.unblock')}
              </Button>
            ) : !closed && !confirmBlock ? (
              <Button variant="link" full={false} danger onClick={() => setConfirmBlock(true)}>
                {t('common.chat.block')}
              </Button>
            ) : null}
            {confirmBlock ? (
              <>
                <p class="hint">{t('common.chat.blockConfirm')}</p>
                <Button variant="outline" full={false} chevron={false} danger onClick={() => void setBlocked(true)}>
                  {t('common.chat.block')}
                </Button>
                <Button variant="link" full={false} onClick={() => setConfirmBlock(false)}>
                  {t('common.cancel')}
                </Button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

/**
 * The threads a person is part to — optionally only those about one load. Fetches its own list, so a screen
 * mounts it without owning chat state; `refreshKey` lets the host re-read after something changed.
 */
export function ConversationList({
  api,
  freightId,
  refreshKey = 0,
  onOpen,
  emptyText,
}: {
  api: ConversationsApi | null;
  freightId?: string;
  refreshKey?: number;
  onOpen: (thread: ChatThread) => void;
  emptyText?: string;
}) {
  const t = useT();
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [error, setError] = useState<Parameters<typeof ErrorNote>[0]['error'] | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    const r = await api.mine();
    if (r.error) return setError(r.error);
    setError(null);
    const all = narrow<ChatThread[]>(r.data) ?? [];
    setThreads(freightId ? all.filter((x) => x.freightId === freightId) : all);
  }, [api, freightId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (error) return <ErrorNote error={error} onRetry={() => void load()} />;
  if (threads === null) return <p class="hint">{t('common.loading')}</p>;
  if (threads.length === 0) return <p class="hint">{emptyText ?? t('common.chat.listEmpty')}</p>;

  return (
    <div class="rows" role="list">
      {threads.map((x) => (
        <button key={x.conversationId} type="button" class="row" onClick={() => onOpen(x)}>
          <span class="row__ic">
            <Icon name="send" size={22} />
          </span>
          <span class="row__body">
            <span class="row__t">
              {x.freightCode} · {x.role === 'poster' ? x.counterpartName ?? t('common.chat.driver') : t('common.chat.poster')}
            </span>
            <span class="row__s">
              {x.lastMessage
                ? `${x.lastMessage.mine ? `${t('common.chat.you')}: ` : ''}${x.lastMessage.kind === 'quick' && x.lastMessage.quick ? t(`common.chat.quick.${x.lastMessage.quick}` as 'common.chat.quick.loaded') : x.lastMessage.body ?? ''}`
                : x.freightLabel}
            </span>
          </span>
          <span class="row__end">
            {x.blocked ? <Pill tone="idle">{t('common.chat.closedPill')}</Pill> : x.unread > 0 ? <Pill tone="warn" dot>{t('common.chat.unread', { n: x.unread })}</Pill> : <Icon name="chevronRight" size={22} />}
          </span>
        </button>
      ))}
    </div>
  );
}
