/**
 * The pure half of a conversation about a load. No DOM, no fetch.
 *
 * A thread is two people and one load. The server numbers every message; the client merges what it already
 * has with what it is sent, by that number, so a message never appears twice and never out of order — however
 * the polls and the sends interleave.
 */

/** Mirrored from backend conversation.types.ts — keep the two lists identical. */
export const QUICK_REPLIES = ['on_my_way', 'loaded', 'arrived', 'delivered', 'paid', 'running_late'] as const;
export type QuickReply = (typeof QUICK_REPLIES)[number];

export const REPORT_REASONS = ['spam', 'abuse', 'scam'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** CV2 — mirrored from backend conversation.types.ts. */
export const SETTLE_METHODS = ['cash', 'mobile_money', 'bank', 'other'] as const;
export type SettleMethod = (typeof SETTLE_METHODS)[number];
export const SETTLE_WHEN = ['on_pickup', 'on_delivery', 'after_delivery'] as const;
export type SettleWhen = (typeof SETTLE_WHEN)[number];

export const MAX_MESSAGE_CHARS = 1000;

export type MessageKind = 'text' | 'quick' | 'proposal' | 'decision' | 'settlement' | 'settlement_agreed' | 'report_shared' | 'voice';

/** CV4 — the longest voice message the app records. The server allows a little more; this is the one people see. */
export const MAX_VOICE_SECONDS = 60;

/** CV4 — what to record in, most compact first. iOS Safari records only MP4; Chrome and Android prefer WebM/Opus. */
export const AUDIO_MIME_PREFERENCE = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'] as const;

/** CV4 — the first recording format this browser supports, or null to let the browser choose. */
export function pickAudioMime(isSupported: (type: string) => boolean): string | null {
  for (const type of AUDIO_MIME_PREFERENCE) {
    try {
      if (isSupported(type)) return type;
    } catch {
      /* a browser that throws on the question does not support the answer */
    }
  }
  return null;
}

/** CV4 — "0:07", "1:05". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface ChatMessage {
  seq: number;
  mine: boolean;
  /** The role it came from — what a shared (read-only) reader goes by, since nothing is "mine" to them. */
  from?: 'poster' | 'driver';
  kind: MessageKind;
  body?: string;
  quick?: QuickReply;
  proposal?: { proposalId: string; price: number; status?: string };
  decision?: { proposalId: string; decision: 'accepted' | 'declined'; price: number };
  settlement?: { amount: number; method: SettleMethod; when: SettleWhen; agreed: boolean };
  refSeq?: number;
  /** CV3 — report_shared: how many messages the report holds. */
  seqCount?: number;
  /** CV4 — a voice message, fetched separately when somebody presses play. */
  voice?: { voiceId: string; durationSec: number };
  at: string;
}

export interface ChatThread {
  conversationId: string;
  freightId: string;
  freightCode: string;
  freightLabel: string;
  /** `manager` — CV3: a fleet manager reading a thread their driver shared. */
  role: 'poster' | 'asker' | 'manager';
  /** CV3 — the driver drives for a fleet, so there is a manager to share with. */
  shareable?: boolean;
  /** CV3 — the driver shared this thread with that manager. */
  sharedWithManager?: boolean;
  counterpartName?: string;
  /** CV2 — a price can be named here. */
  negotiable?: boolean;
  /** CV2 — the two may write down an off-platform settlement here. */
  settlesOffPlatform?: boolean;
  lastSeq: number;
  unread: number;
  lastMessage?: ChatMessage;
  lastAt?: string;
  createdAt: string;
  blocked: boolean;
  blockedByMe: boolean;
}

/** What we have, plus what arrived — once each, in the server's order. */
export function mergeMessages(have: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const bySeq = new Map<number, ChatMessage>();
  for (const m of have) bySeq.set(m.seq, m);
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** The highest sequence number held — what to ask "after" on the next catch-up. */
export function lastSeqOf(messages: ChatMessage[]): number {
  return messages.reduce((max, m) => (m.seq > max ? m.seq : max), 0);
}

/** Why nothing can be sent right now, as a message key — or null. An empty box is not a reason, just a disabled button. */
export function composeBlocker(text: string, thread: Pick<ChatThread, 'blocked' | 'blockedByMe'> | null): 'common.chat.blockedByMe' | 'common.chat.blocked' | 'common.chat.tooLong' | null {
  if (thread?.blocked) return thread.blockedByMe ? 'common.chat.blockedByMe' : 'common.chat.blocked';
  if (text.trim().length > MAX_MESSAGE_CHARS) return 'common.chat.tooLong';
  return null;
}

/** Unread across every thread — the badge. */
export function totalUnread(threads: Pick<ChatThread, 'unread'>[]): number {
  return threads.reduce((sum, t) => sum + (t.unread > 0 ? t.unread : 0), 0);
}

/** The threads about one load, for the poster's view of that load. */
export function threadsFor(threads: ChatThread[], freightId: string): ChatThread[] {
  return threads.filter((t) => t.freightId === freightId);
}

/** CV2 — a typed amount, or null when it is not a positive number. */
export function parseAmount(text: string): number | null {
  const n = Number(String(text).replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** CV2 — may this person answer this offer from the thread? Only the poster, only while it is open. */
export function canDecide(thread: Pick<ChatThread, 'role' | 'blocked'> | null, m: ChatMessage): boolean {
  return Boolean(thread && !thread.blocked && thread.role === 'poster' && m.kind === 'proposal' && m.proposal?.status === 'open');
}

/** CV2 — may this person agree to this settlement? Only the side that did NOT write it, and only once. */
export function canAgree(thread: Pick<ChatThread, 'blocked'> | null, m: ChatMessage): boolean {
  return Boolean(thread && !thread.blocked && m.kind === 'settlement' && !m.mine && m.settlement && !m.settlement.agreed);
}

/** CV3 — add a message to the report being put together, or take it out again. Kept in the thread's order. */
export function toggleSeq(selected: number[], seq: number): number[] {
  return selected.includes(seq) ? selected.filter((s) => s !== seq) : [...selected, seq].sort((a, b) => a - b);
}

/** CV3 — may this person share the thread with their manager? Only the driver who asked, when they have one. */
export function canShare(thread: Pick<ChatThread, 'role' | 'shareable'> | null): boolean {
  return Boolean(thread && thread.role === 'asker' && thread.shareable);
}

/** CV2 — may this person name a price here? The driver who asked, on a negotiated load, in an open thread. */
export function canPropose(thread: Pick<ChatThread, 'role' | 'blocked' | 'negotiable'> | null): boolean {
  return Boolean(thread && !thread.blocked && thread.role === 'asker' && thread.negotiable);
}
