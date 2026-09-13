/**
 * CONVERSATIONS — two people, about one load (CV1; design: 05_engineering/conversations.md).
 *
 * The network matches shipments, but a shipment is two people agreeing: when, how it is loaded, and — where
 * we hold no money — how one pays the other. So a conversation belongs to a JOB, never to a friendship: it is
 * opened about a posted load, between the load's poster and one person asking about it. No load, no thread.
 *
 * Append-only, on purpose. Nothing here is ever edited or deleted: a correction is a new message. A chat that
 * can be rewritten is useless as a record, and the record is the reason to keep it — we move value through
 * people we have no recourse against, and what they agreed is the one thing we can later show.
 */

/**
 * Quick replies — the words a driver needs with one thumb, in their own language. Stored as a KEY, rendered by
 * the reader's app in the reader's language, so "Loaded" sent in Swahili arrives in Amharic. Mirrored in
 * frontend/src/shared/conversation/logic.ts; keep the two lists identical.
 */
export const QUICK_REPLIES = ['on_my_way', 'loaded', 'arrived', 'delivered', 'paid', 'running_late'] as const;
export type QuickReply = (typeof QUICK_REPLIES)[number];

export const REPORT_REASONS = ['spam', 'abuse', 'scam'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface Conversation {
  conversationId: string;
  freightId: string;
  /** Who posted the load and answers for it. */
  posterDid: string;
  /** The one who asked — CV1: an active driver. One thread per (load, asker). */
  askerDid: string;
  createdAt: string;
  /** The last sequence number handed out. Catch-up asks for everything after a seq, never after a clock. */
  lastSeq: number;
  lastAt?: string;
  /** Each party's read marker, by seq. */
  readSeq: Record<string, number>;
  /** Set when a party blocks: nobody writes until THAT party unblocks. The messages stay. */
  blockedBy?: string;
  blockedAt?: string;
}

export interface ConversationMessage {
  seq: number;
  fromDid: string;
  kind: 'text' | 'quick';
  body?: string;
  quick?: QuickReply;
  at: string;
}

/** A message reported by the party who received it — kept with a copy of what was reported. */
export interface MessageReport {
  reportId: string;
  conversationId: string;
  seq: number;
  byDid: string;
  reportedDid: string;
  reason: ReportReason;
  /** The message as it was. Append-only threads make this redundant today; it stays true if that ever changes. */
  snapshot: ConversationMessage;
  at: string;
}

/** A message as a PARTY reads it: whether it is theirs, and no identities at all. */
export interface MessageView {
  seq: number;
  mine: boolean;
  kind: 'text' | 'quick';
  body?: string;
  quick?: QuickReply;
  at: string;
}

/** A thread as one party sees it. Carries no DID and no contact detail of the other party. */
export interface ConversationView {
  conversationId: string;
  freightId: string;
  freightCode: string;
  /** "Maize · Nakuru → Nairobi" — what the load is, so the list reads without opening each row. */
  freightLabel: string;
  role: 'poster' | 'asker';
  /** The asker's display name, shown to the poster. The poster is "the poster of <code>" to the asker. */
  counterpartName?: string;
  lastSeq: number;
  unread: number;
  lastMessage?: MessageView;
  lastAt?: string;
  createdAt: string;
  blocked: boolean;
  blockedByMe: boolean;
}
