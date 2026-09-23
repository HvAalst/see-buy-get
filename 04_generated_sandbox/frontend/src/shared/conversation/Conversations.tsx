import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { narrow, type ConversationsApi } from '../../lib/sbg';
import { formatDate, useT } from '../i18n';
import { Button, Card, Chip, ErrorNote, Icon, Note, Pill, Sheet } from '../ui';
import {
  MAX_MESSAGE_CHARS,
  REPORT_REASONS,
  SETTLE_METHODS,
  SETTLE_WHEN,
  canAgree,
  canDecide,
  canPropose,
  canShare,
  composeBlocker,
  counterpartKey,
  quickRepliesFor,
  formatDuration,
  MAX_VOICE_SECONDS,
  pickAudioMime,
  lastSeqOf,
  mergeMessages,
  parseAmount,
  toggleSeq,
  type ChatMessage,
  type ChatThread,
  type ReportReason,
  type SettleMethod,
  type SettleWhen,
} from './logic';

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

const money = (n: number) => n.toFixed(2);

/**
 * ONE CONVERSATION ABOUT ONE LOAD, in a sheet.
 *
 * Shared by the driver asking and the shop or store answering, because it is the same conversation seen from
 * two ends. Nothing in it can be edited or deleted — the sheet says so in plain words, and says who can read
 * it, rather than claiming a privacy the network does not provide.
 *
 * CV2 puts the deal in the same place. CV3 adds the two ways a thread leaves its two parties, both by choice:
 * the DRIVER may share it with their own fleet manager (who reads it and never writes), and EITHER party may
 * share a report of messages they choose with the network — the other side is told in the thread.
 */
export function ConversationSheet({
  api,
  thread,
  onClose,
  onChanged,
  positionFor,
  readOnly = false,
}: {
  api: ConversationsApi | null;
  thread: ChatThread | null;
  onClose: () => void;
  onChanged?: () => void;
  /** CV2 — where the driver is, for naming a price. Absent on the poster's side. */
  positionFor?: () => Promise<{ lat: number; lng: number } | null>;
  /** CV3 — a fleet manager reading a thread their driver shared: no composer, no deal, no report. */
  readOnly?: boolean;
}) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [current, setCurrent] = useState<ChatThread | null>(thread);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState<number | null>(null);
  const [reported, setReported] = useState<number[]>([]);
  const [confirmAccept, setConfirmAccept] = useState<string | null>(null);
  const [deal, setDeal] = useState<'price' | 'settle' | null>(null);
  const [price, setPrice] = useState('');
  const [priceNote, setPriceNote] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SettleMethod>('cash');
  const [when, setWhen] = useState<SettleWhen>('on_delivery');
  const [settleNote, setSettleNote] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [disputeNote, setDisputeNote] = useState('');
  // CV4 — a voice message being recorded: when it started, and the recorder behind it.
  const [recording, setRecording] = useState<{ startedAt: number } | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  // CV4 — a finished recording waiting to be listened to. Nothing leaves the phone until Send: a message that can
  // never be deleted deserves a listen first (user, 2026-09-13 — as BondBridge does).
  const [draft, setDraft] = useState<{ blob: Blob; url: string; seconds: number } | null>(null);
  const draftRef = useRef<{ url: string } | null>(null);
  const canRecord =
    typeof window !== 'undefined' && typeof (window as { MediaRecorder?: unknown }).MediaRecorder !== 'undefined' && Boolean(globalThis.navigator?.mediaDevices?.getUserMedia);

  // The recording clock, and the stop at the limit — a voice message is a message, not a recording session.
  useEffect(() => {
    if (!recording) return undefined;
    const tick = window.setInterval(() => {
      const elapsed = (Date.now() - recording.startedAt) / 1000;
      setRecordSeconds(Math.floor(elapsed));
      if (elapsed >= MAX_VOICE_SECONDS) stopRecording(false);
    }, 250);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);
  const held = useRef<ChatMessage[]>([]);
  const id = thread?.conversationId ?? null;

  const catchUp = useCallback(
    async (fromScratch = false) => {
      if (!api || !id) return;
      if (fromScratch) held.current = [];
      const r = await api.messages(id, lastSeqOf(held.current));
      if (r.error) {
        setFailed(r.error.detail || r.error.title || t('common.chat.loadFailed'));
        return;
      }
      const data = narrow<{ thread: ChatThread; items: ChatMessage[] }>(r.data);
      if (!data) return;
      setFailed(null);
      setCurrent(data.thread);
      held.current = mergeMessages(held.current, data.items);
      setMessages(held.current);
      const seq = lastSeqOf(held.current);
      // A reader who is not a party keeps no read marker in somebody else's conversation.
      if (!readOnly && seq > 0 && data.thread.unread > 0) {
        await api.read(id, seq);
        onChanged?.();
      }
    },
    [api, id, onChanged, t, readOnly],
  );

  useEffect(() => {
    held.current = [];
    setMessages([]);
    setText('');
    setCurrent(thread);
    setReported([]);
    setDeal(null);
    setConfirmAccept(null);
    setSelecting(false);
    setPicked([]);
    setDone(null);
    if (!id) return undefined;
    void catchUp();
    const timer = window.setInterval(() => void catchUp(), POLL_MS);
    return () => {
      window.clearInterval(timer);
      // Closing the sheet mid-recording throws the recording away and releases the microphone — and a recording
      // waiting to be listened to goes with it, so another thread never opens with somebody else's draft.
      stopRecording(true);
      discardDraft();
    };
    // Re-run only when a different thread opens; catchUp is stable for one thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Run one action against the thread, then re-read the whole thread: a decision changes an EARLIER card. */
  const act = async (key: string, run: () => Promise<{ error: { detail?: string; title?: string } | null }>, after?: () => void) => {
    setBusy(key);
    const r = await run();
    setBusy(null);
    if (r.error) {
      setFailed(r.error.detail || r.error.title || t('common.chat.loadFailed'));
      return;
    }
    setFailed(null);
    after?.();
    await catchUp(true);
    onChanged?.();
  };

  const send = (message: { body?: string; quick?: string }) => {
    if (!api || !id) return;
    void act('send', () => api.send(id, message), () => {
      if (message.body !== undefined) setText('');
    });
  };

  const offerPrice = async () => {
    if (!api || !id) return;
    const value = parseAmount(price);
    if (value === null) return setFailed(t('common.chat.deal.priceNeeded'));
    const from = positionFor ? await positionFor() : null;
    if (!from) return setFailed(t('common.chat.deal.needPosition'));
    void act('price', () => api.propose(id, { price: value, from, ...(priceNote.trim() ? { note: priceNote.trim() } : {}) }), () => {
      setPrice('');
      setPriceNote('');
      setDeal(null);
    });
  };

  const decide = (proposalId: string, decision: 'accept' | 'decline') => {
    if (!api || !id) return;
    setConfirmAccept(null);
    void act(`${decision}:${proposalId}`, () => api.decide(id, proposalId, decision));
  };

  const recordSettlement = () => {
    if (!api || !id) return;
    const value = parseAmount(amount);
    if (value === null) return setFailed(t('common.chat.deal.amountNeeded'));
    void act('settle', () => api.settle(id, { amount: value, method, when, ...(settleNote.trim() ? { note: settleNote.trim() } : {}) }), () => {
      setAmount('');
      setSettleNote('');
      setDeal(null);
    });
  };

  const toggleShare = (on: boolean) => {
    if (!api || !id) return;
    void act('share', () => api.share(id, on));
  };

  const shareReport = () => {
    if (!api || !id) return;
    if (!picked.length) return setFailed(t('common.chat.dispute.none'));
    void act('dispute', () => api.disputeReport(id, picked, disputeNote.trim() || undefined), () => {
      setSelecting(false);
      setPicked([]);
      setDisputeNote('');
      setDone(t('common.chat.dispute.done'));
    });
  };

  /** CV4 — start recording. Asks for the microphone only now, when somebody pressed record. */
  const startRecording = async () => {
    if (!api || !id || recording) return;
    setFailed(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setFailed(t('common.chat.voice.noMic'));
      return;
    }
    const mime = pickAudioMime((type) => MediaRecorder.isTypeSupported(type));
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const startedAt = Date.now();
    chunksRef.current = [];
    discardRef.current = false;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      const seconds = Math.max(1, Math.min(MAX_VOICE_SECONDS, Math.round((Date.now() - startedAt) / 1000)));
      setRecording(null);
      setRecordSeconds(0);
      if (discardRef.current || !chunksRef.current.length) return;
      // Kept on the phone to be listened to — sent only when the person presses Send.
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mime || 'audio/webm' });
      const url = URL.createObjectURL(blob);
      draftRef.current = { url };
      setDraft({ blob, url, seconds });
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording({ startedAt });
  };

  /** CV4 — stop recording: send it, or throw it away. */
  const stopRecording = (discard: boolean) => {
    discardRef.current = discard;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  /** CV4 — throw the listened-to recording away. Its object URL is released with it. */
  const discardDraft = () => {
    if (draftRef.current) URL.revokeObjectURL(draftRef.current.url);
    draftRef.current = null;
    setDraft(null);
  };

  /** CV4 — send the recording the person has listened to. */
  const sendDraft = () => {
    if (!api || !id || !draft) return;
    const { blob, seconds } = draft;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      void act('voice', () => api.sendVoice(id, { dataUrl, durationSec: seconds }), discardDraft);
    };
    reader.readAsDataURL(blob);
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
  // The other side by name where a name is shown, else by role — and the role depends on what the thread is about:
  // a load's asker is a driver, a parcel's asker is the customer collecting it. A manager reads the driver's side of a
  // shared load thread, so the counterpart they see is the poster, named by role.
  const who = current?.counterpartName ?? t(counterpartKey(current));
  const authorOf = (m: ChatMessage) => (readOnly ? (m.from === 'asker' ? t('common.chat.driver') : t('common.chat.poster')) : m.mine ? t('common.chat.you') : who);
  const proposable = !readOnly && canPropose(current) && Boolean(positionFor);
  const settleable = !readOnly && Boolean(current?.settlesOffPlatform) && !closed;

  /** What a message SAYS, by kind. The deal cards are sentences, so they read aloud and translate like text. */
  const content = (m: ChatMessage) => {
    if (m.kind === 'quick' && m.quick) return <b>{t(`common.chat.quick.${m.quick}` as 'common.chat.quick.loaded')}</b>;
    if (m.kind === 'proposal' && m.proposal) {
      const status = m.proposal.status ?? 'open';
      return (
        <>
          <b>{t('common.chat.deal.proposed', { amount: money(m.proposal.price) })}</b>
          <span style="margin-left:6px">
            <Pill tone={status === 'accepted' ? 'ok' : status === 'open' ? 'info' : 'idle'}>{t(`common.chat.deal.status.${status}` as 'common.chat.deal.status.open')}</Pill>
          </span>
          {m.body ? <div>“{m.body}”</div> : null}
        </>
      );
    }
    if (m.kind === 'decision' && m.decision) {
      return <b>{t(m.decision.decision === 'accepted' ? 'common.chat.deal.acceptedLine' : 'common.chat.deal.declinedLine', { amount: money(m.decision.price) })}</b>;
    }
    if (m.kind === 'settlement' && m.settlement) {
      return (
        <>
          <b>
            {t('common.chat.deal.settleLine', {
              amount: money(m.settlement.amount),
              method: t(`common.chat.deal.method.${m.settlement.method}` as 'common.chat.deal.method.cash'),
              when: t(`common.chat.deal.when.${m.settlement.when}` as 'common.chat.deal.when.on_delivery'),
            })}
          </b>
          <span style="margin-left:6px">
            <Pill tone={m.settlement.agreed ? 'ok' : 'info'}>{t(m.settlement.agreed ? 'common.chat.deal.agreed' : 'common.chat.deal.waitingAgree')}</Pill>
          </span>
          {m.body ? <div>“{m.body}”</div> : null}
          <div class="hint" style="font-size:12px">{t('common.chat.deal.recordOnly')}</div>
        </>
      );
    }
    if (m.kind === 'settlement_agreed') return <b>{t('common.chat.deal.agreedLine')}</b>;
    if (m.kind === 'report_shared') return <b>{t('common.chat.dispute.sharedLine', { n: m.seqCount ?? 0 })}</b>;
    if (m.kind === 'voice' && m.voice && id) return <VoicePlayer api={api} conversationId={id} voiceId={m.voice.voiceId} durationSec={m.voice.durationSec} />;
    return m.body;
  };

  return (
    <Sheet open={Boolean(thread)} onClose={onClose} title={thread ? t('common.chat.title', { code: thread.freightCode }) : ''}>
      {thread ? (
        <>
          <p class="hint">{thread.freightLabel}</p>
          {readOnly ? (
            <Note tone="info" icon="info" title={t('common.chat.share.readOnlyTitle')} detail={t('common.chat.share.readOnly')} />
          ) : (
            <>
              <p class="hint">{t('common.chat.withWho', { who })}</p>
              {/* Said plainly, because it is the promise the thread makes: who can read it, and that it stays. */}
              <Note tone="info" icon="info" title={t('common.chat.privacyTitle')} detail={t('common.chat.privacy')} />
            </>
          )}

          {/* CV3 — the driver's own choice, and theirs alone: widen who may READ this, never who may write. */}
          {!readOnly && canShare(current) ? (
            <div style="margin-top:10px">
              {/* A labelled tick box, not the register kit's Checkbox: that one carries its words only for a screen
                  reader, and found in the browser pass a driver saw a bare square beside nothing. */}
              <label class="checkline">
                <input type="checkbox" checked={Boolean(current?.sharedWithManager)} disabled={busy === 'share'} onChange={(e) => toggleShare(e.currentTarget.checked)} />
                <span>{t('common.chat.share.toggle')}</span>
              </label>
              <p class="hint">{t('common.chat.share.hint')}</p>
            </div>
          ) : null}

          {failed ? (
            <p class="hint" role="alert">
              {failed}
            </p>
          ) : null}
          {done ? <Note tone="ok" icon="check" title={done} detail="" /> : null}

          {selecting ? <p class="hint" style="margin-top:10px">{t('common.chat.dispute.lede')}</p> : null}

          <div class="rows" role="log" aria-live="polite" style="margin-top:12px; gap:8px">
            {messages.length === 0 ? <p class="hint">{t('common.chat.empty')}</p> : null}
            {messages.map((m) => (
              <div
                key={m.seq}
                style={`align-self:${m.mine ? 'flex-end' : 'flex-start'}; max-width:85%; padding:8px 12px; border-radius:14px; background:${m.mine ? 'var(--brand-50, #eef0ff)' : 'var(--surface-2, #f2f2f5)'}${m.kind !== 'text' && m.kind !== 'quick' ? '; border:1px solid var(--line, #dcdce4)' : ''}`}
              >
                {selecting ? (
                  <label class="checkline">
                    <input type="checkbox" checked={picked.includes(m.seq)} onChange={() => setPicked((xs) => toggleSeq(xs, m.seq))} />
                    <span>{t('common.chat.dispute.pick')}</span>
                  </label>
                ) : null}

                <div class="t-body" style="white-space:pre-wrap; overflow-wrap:anywhere">
                  {content(m)}
                </div>

                {/* CV2 — the poster answers an open price from the card itself. Accepting gives the load away,
                    so it takes a second tap that says so. */}
                {!readOnly && !selecting && canDecide(current, m) && m.proposal ? (
                  <div style="margin-top:6px">
                    {confirmAccept === m.proposal.proposalId ? (
                      <>
                        <p class="hint">{t('common.chat.deal.acceptConfirm', { amount: money(m.proposal.price) })}</p>
                        <Button full={false} chevron={false} busy={busy === `accept:${m.proposal.proposalId}`} onClick={() => decide(m.proposal!.proposalId, 'accept')}>
                          {t('common.chat.deal.accept')}
                        </Button>
                        <Button variant="link" full={false} onClick={() => setConfirmAccept(null)}>
                          {t('common.cancel')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="outline" full={false} chevron={false} onClick={() => setConfirmAccept(m.proposal!.proposalId)}>
                          {t('common.chat.deal.accept')}
                        </Button>
                        <Button variant="link" full={false} busy={busy === `decline:${m.proposal.proposalId}`} onClick={() => decide(m.proposal!.proposalId, 'decline')}>
                          {t('common.chat.deal.decline')}
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}

                {!readOnly && !selecting && canAgree(current, m) ? (
                  <div style="margin-top:6px">
                    <Button variant="outline" full={false} chevron={false} busy={busy === `agree:${m.seq}`} onClick={() => api && id && void act(`agree:${m.seq}`, () => api.agree(id, m.seq))}>
                      {t('common.chat.deal.agree')}
                    </Button>
                  </div>
                ) : null}

                <div class="hint" style="margin-top:2px; font-size:12px">
                  {authorOf(m)} · {whenSent(m.at)}
                  {!readOnly && !selecting && !m.mine && !reported.includes(m.seq) ? (
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

          {readOnly ? null : selecting ? (
            // CV3 — putting a report together: the chosen messages, why, and a send that says how many.
            <div style="margin-top:12px">
              <div class="field">
                <label class="field__label" for="dispute-note">
                  {t('common.chat.dispute.note')}
                </label>
                <input id="dispute-note" class="input" value={disputeNote} onInput={(e) => setDisputeNote(e.currentTarget.value)} />
              </div>
              <Button chevron={false} busy={busy === 'dispute'} disabled={!picked.length} onClick={shareReport}>
                {t('common.chat.dispute.send', { n: picked.length })}
              </Button>
              <Button
                variant="link"
                full={false}
                onClick={() => {
                  setSelecting(false);
                  setPicked([]);
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          ) : closed ? (
            <Note tone="warn" icon="warning" title={t(current?.blockedByMe ? 'common.chat.blockedByMe' : 'common.chat.blocked')} detail="" />
          ) : (
            <>
              <div class="chiprow" role="group" aria-label={t('common.chat.quickTitle')} style="margin-top:12px">
                {quickRepliesFor(current).map((q) => (
                  <Chip key={q} label={t(`common.chat.quick.${q}` as 'common.chat.quick.loaded')} active={false} onClick={() => send({ quick: q })} />
                ))}
              </div>
              {/* CV4 — a voice message, for a driver with a load in both hands or anybody for whom writing is the
                  hard part. Offered only where the browser can record; the microphone is asked for on the tap. */}
              {canRecord ? (
                <div style="margin-top:12px">
                  {recording ? (
                    <>
                      <p class="hint" aria-live="polite">
                        {t('common.chat.voice.recording', { time: formatDuration(recordSeconds), max: formatDuration(MAX_VOICE_SECONDS) })}
                      </p>
                      <Button full={false} chevron={false} onClick={() => stopRecording(false)}>
                        {t('common.chat.voice.stopListen')}
                      </Button>
                      <Button variant="link" full={false} onClick={() => stopRecording(true)}>
                        {t('common.cancel')}
                      </Button>
                    </>
                  ) : draft ? (
                    // Listen first. Send, record it again, or throw it away — nothing has left the phone yet.
                    <>
                      <p class="hint">{t('common.chat.voice.review', { duration: formatDuration(draft.seconds) })}</p>
                      <audio controls src={draft.url} style="width:100%; max-width:300px" />
                      <div style="margin-top:6px">
                        <Button full={false} chevron={false} busy={busy === 'voice'} onClick={sendDraft}>
                          {t('common.chat.voice.send')}
                        </Button>
                        <Button
                          variant="outline"
                          full={false}
                          chevron={false}
                          disabled={busy === 'voice'}
                          onClick={() => {
                            discardDraft();
                            void startRecording();
                          }}
                        >
                          {t('common.chat.voice.again')}
                        </Button>
                        <Button variant="link" full={false} disabled={busy === 'voice'} onClick={discardDraft}>
                          {t('common.chat.voice.discard')}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Button variant="outline" full={false} chevron={false} busy={busy === 'voice'} onClick={() => void startRecording()}>
                      {t('common.chat.voice.record')}
                    </Button>
                  )}
                </div>
              ) : null}

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
              <Button chevron={false} busy={busy === 'send'} disabled={!text.trim() || blocker !== null} onClick={() => send({ body: text })}>
                {t('common.chat.send')}
              </Button>

              {/* CV2 — the deal. Offered only where it applies: a price to the driver on a negotiated load, a
                  settlement where the network does not pay. Nothing to choose from is not a control. */}
              {proposable || settleable ? (
                <div class="chiprow" style="margin-top:12px">
                  {proposable ? <Chip label={t('common.chat.deal.proposeTitle')} active={deal === 'price'} onClick={() => setDeal(deal === 'price' ? null : 'price')} /> : null}
                  {settleable ? <Chip label={t('common.chat.deal.settleTitle')} active={deal === 'settle'} onClick={() => setDeal(deal === 'settle' ? null : 'settle')} /> : null}
                </div>
              ) : null}

              {deal === 'price' ? (
                <div style="margin-top:10px">
                  <div class="field">
                    <label class="field__label" for="deal-price">
                      {t('common.chat.deal.price')}
                    </label>
                    <input id="deal-price" class="input" type="number" inputMode="decimal" min="0" step="1" value={price} onInput={(e) => setPrice(e.currentTarget.value)} />
                  </div>
                  <div class="field" style="margin-top:8px">
                    <label class="field__label" for="deal-price-note">
                      {t('common.chat.deal.note')}
                    </label>
                    <input id="deal-price-note" class="input" value={priceNote} onInput={(e) => setPriceNote(e.currentTarget.value)} />
                  </div>
                  <Button chevron={false} busy={busy === 'price'} disabled={parseAmount(price) === null} onClick={() => void offerPrice()}>
                    {t('common.chat.deal.send')}
                  </Button>
                </div>
              ) : null}

              {deal === 'settle' ? (
                <div style="margin-top:10px">
                  <p class="hint">{t('common.chat.deal.settleLede')}</p>
                  <div class="field">
                    <label class="field__label" for="deal-amount">
                      {t('common.chat.deal.amount')}
                    </label>
                    <input id="deal-amount" class="input" type="number" inputMode="decimal" min="0" step="1" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
                  </div>
                  <div class="field" style="margin-top:8px">
                    <label class="field__label" for="deal-method">
                      {t('common.chat.deal.method')}
                    </label>
                    <select id="deal-method" class="select" value={method} onChange={(e) => setMethod(e.currentTarget.value as SettleMethod)}>
                      {SETTLE_METHODS.map((k) => (
                        <option key={k} value={k}>
                          {t(`common.chat.deal.method.${k}` as 'common.chat.deal.method.cash')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div class="field" style="margin-top:8px">
                    <label class="field__label" for="deal-when">
                      {t('common.chat.deal.when')}
                    </label>
                    <select id="deal-when" class="select" value={when} onChange={(e) => setWhen(e.currentTarget.value as SettleWhen)}>
                      {SETTLE_WHEN.map((k) => (
                        <option key={k} value={k}>
                          {t(`common.chat.deal.when.${k}` as 'common.chat.deal.when.on_delivery')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div class="field" style="margin-top:8px">
                    <label class="field__label" for="deal-settle-note">
                      {t('common.chat.deal.note')}
                    </label>
                    <input id="deal-settle-note" class="input" value={settleNote} onInput={(e) => setSettleNote(e.currentTarget.value)} />
                  </div>
                  <Button chevron={false} busy={busy === 'settle'} disabled={parseAmount(amount) === null} onClick={recordSettlement}>
                    {t('common.chat.deal.record')}
                  </Button>
                </div>
              ) : null}
            </>
          )}

          {readOnly ? null : (
            <div style="margin-top:12px">
              {/* CV3 — offered in a blocked thread too: a dispute is most often what follows a falling-out. */}
              {!selecting && messages.length > 0 ? (
                <Button
                  variant="link"
                  full={false}
                  onClick={() => {
                    setSelecting(true);
                    setDone(null);
                  }}
                >
                  {t('common.chat.dispute.start')}
                </Button>
              ) : null}
              {current?.blockedByMe ? (
                <Button variant="link" full={false} onClick={() => void setBlocked(false)}>
                  {t('common.chat.unblock')}
                </Button>
              ) : !closed && !confirmBlock && !selecting ? (
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
          )}
        </>
      ) : null}
    </Sheet>
  );
}

/**
 * The threads a person is party to — optionally only those about one load — or, for a fleet manager, the ones
 * their drivers shared. Fetches its own list, so a screen mounts it without owning chat state; `refreshKey` lets
 * the host re-read after something changed.
 */
/**
 * CV4 — ONE VOICE MESSAGE. Fetched only when somebody presses play: a thread full of recordings must not
 * download them all to show a list. Played from an object URL, because an <audio src> cannot carry the token
 * the recording is protected by, and the URL is released when the message leaves the screen.
 */
function VoicePlayer({ api, conversationId, voiceId, durationSec }: { api: ConversationsApi | null; conversationId: string; voiceId: string; durationSec: number }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  if (url) return <audio controls autoPlay src={url} style="width:100%; max-width:260px" />;
  return (
    <button
      type="button"
      class="linkbtn"
      disabled={state === 'loading'}
      onClick={async () => {
        if (!api) return;
        setState('loading');
        const r = await api.voiceBlob(conversationId, voiceId);
        const blob = (r.data ?? null) as unknown as Blob | null;
        if (r.error || !blob) {
          setState('failed');
          return;
        }
        setUrl(URL.createObjectURL(blob));
        setState('idle');
      }}
    >
      <Icon name="speaker" size={18} /> {state === 'failed' ? t('common.chat.voice.failed') : t('common.chat.voice.play', { duration: formatDuration(durationSec) })}
    </button>
  );
}

export function ConversationList({
  api,
  freightId,
  subject,
  refreshKey = 0,
  onOpen,
  emptyText,
  source = 'mine',
  cardTitle,
}: {
  api: ConversationsApi | null;
  freightId?: string;
  /** CV5 — only threads about loads, or only about parcels. A shop has both, on different screens. */
  subject?: 'freight' | 'parcel';
  refreshKey?: number;
  onOpen: (thread: ChatThread) => void;
  emptyText?: string;
  /** CV3 — `shared`: a fleet manager's read-only list of what their drivers shared. */
  source?: 'mine' | 'shared';
  /**
   * Draw the card yourself, and DRAW NOTHING WHEN THERE IS NOTHING IN IT.
   *
   * A caller that wraps this list in its own Card gets a permanent white block reading "No conversations
   * yet" — on a phone that is a fifth of the screen spent saying nothing, every day, to every driver who
   * has not yet had a conversation. Passing the title here hands the decision to the list, which is the
   * only thing that knows whether it has anything to show.
   */
  cardTitle?: string;
}) {
  const t = useT();
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [error, setError] = useState<Parameters<typeof ErrorNote>[0]['error'] | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    const r = source === 'shared' ? await api.shared() : await api.mine();
    if (r.error) return setError(r.error);
    setError(null);
    const all = (narrow<ChatThread[]>(r.data) ?? []).filter((x) => !subject || (x.subject ?? 'freight') === subject);
    setThreads(freightId ? all.filter((x) => x.freightId === freightId) : all);
  }, [api, freightId, subject, source]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // An error is never swallowed by cardTitle: a list that failed to load is not a list that is empty,
  // and a driver waiting on an answer needs to know which of the two they are looking at.
  if (error) return <ErrorNote error={error} onRetry={() => void load()} />;
  if (threads === null) return cardTitle ? null : <p class="hint">{t('common.loading')}</p>;
  if (threads.length === 0) return cardTitle ? null : <p class="hint">{emptyText ?? t('common.chat.listEmpty')}</p>;

  /** The last message as one line — a deal card reads as what it did, not as an empty bubble. */
  const preview = (m: ChatMessage): string => {
    if (m.kind === 'quick' && m.quick) return t(`common.chat.quick.${m.quick}` as 'common.chat.quick.loaded');
    if (m.kind === 'proposal' && m.proposal) return t('common.chat.deal.proposed', { amount: money(m.proposal.price) });
    if (m.kind === 'decision' && m.decision) return t(m.decision.decision === 'accepted' ? 'common.chat.deal.acceptedLine' : 'common.chat.deal.declinedLine', { amount: money(m.decision.price) });
    // The terms themselves, not the name of the form that wrote them: found in the browser pass, the list read
    // "Write down how you will settle" beside a settlement that had already been written down.
    if (m.kind === 'settlement' && m.settlement) {
      return t('common.chat.deal.settleLine', {
        amount: money(m.settlement.amount),
        method: t(`common.chat.deal.method.${m.settlement.method}` as 'common.chat.deal.method.cash'),
        when: t(`common.chat.deal.when.${m.settlement.when}` as 'common.chat.deal.when.on_delivery'),
      });
    }
    if (m.kind === 'settlement_agreed') return t('common.chat.deal.agreedLine');
    if (m.kind === 'report_shared') return t('common.chat.dispute.sharedLine', { n: m.seqCount ?? 0 });
    if (m.kind === 'voice' && m.voice) return t('common.chat.voice.preview', { duration: formatDuration(m.voice.durationSec) });
    return m.body ?? '';
  };

  const rows = (
    <div class="rows" role="list">
      {threads.map((x) => (
        <button key={x.conversationId} type="button" class="row" onClick={() => onOpen(x)}>
          <span class="row__ic">
            <Icon name="send" size={22} />
          </span>
          <span class="row__body">
            <span class="row__t">
              {x.freightCode} · {x.counterpartName ?? t(counterpartKey(x))}
            </span>
            <span class="row__s">
              {x.lastMessage ? `${x.lastMessage.mine && x.role !== 'manager' ? `${t('common.chat.you')}: ` : ''}${preview(x.lastMessage)}` : x.freightLabel}
            </span>
          </span>
          <span class="row__end">
            {x.blocked ? <Pill tone="idle">{t('common.chat.closedPill')}</Pill> : x.unread > 0 ? <Pill tone="warn" dot>{t('common.chat.unread', { n: x.unread })}</Pill> : <Icon name="chevronRight" size={22} />}
          </span>
        </button>
      ))}
    </div>
  );

  return cardTitle ? <Card title={cardTitle}>{rows}</Card> : rows;
}
