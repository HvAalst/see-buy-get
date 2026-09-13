/**
 * CV1 — the pure half of a conversation about a load. No DOM, no fetch.
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

export const MAX_MESSAGE_CHARS = 1000;

export interface ChatMessage {
  seq: number;
  mine: boolean;
  kind: 'text' | 'quick';
  body?: string;
  quick?: QuickReply;
  at: string;
}

export interface ChatThread {
  conversationId: string;
  freightId: string;
  freightCode: string;
  freightLabel: string;
  role: 'poster' | 'asker';
  counterpartName?: string;
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
