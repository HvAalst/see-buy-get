/**
 * CONVERSATIONS — two people, about one load (design: 05_engineering/conversations.md).
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

/** CV2 — how two people settle a load the network does not pay. Mirrored in the frontend logic. */
export const SETTLE_METHODS = ['cash', 'mobile_money', 'bank', 'other'] as const;
export type SettleMethod = (typeof SETTLE_METHODS)[number];
export const SETTLE_WHEN = ['on_pickup', 'on_delivery', 'after_delivery'] as const;
export type SettleWhen = (typeof SETTLE_WHEN)[number];

/**
 * What a message IS.
 *
 *   text / quick        talking
 *   proposal            CV2 — a driver's price, made through the load's own negotiation
 *   decision            CV2 — the poster accepting (which claims the load) or declining that price
 *   settlement          CV2 — a written-down arrangement for paying off-platform: a RECORD, never a posting
 *   settlement_agreed   CV2 — the other party agreeing to it
 */
export type MessageKind = 'text' | 'quick' | 'proposal' | 'decision' | 'settlement' | 'settlement_agreed';

export interface Conversation {
  conversationId: string;
  freightId: string;
  /** Who posted the load and answers for it. */
  posterDid: string;
  /** The one who asked — an active driver. One thread per (load, asker). */
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
  kind: MessageKind;
  /** Text, or the note that travels with a proposal or a settlement. */
  body?: string;
  quick?: QuickReply;
  /** proposal / decision: the negotiation's own proposal, so the thread and the price screen are one fact. */
  proposalId?: string;
  price?: number;
  decision?: 'accepted' | 'declined';
  settlement?: { amount: number; method: SettleMethod; when: SettleWhen };
  /** settlement_agreed: the settlement message being agreed to. */
  refSeq?: number;
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
  kind: MessageKind;
  body?: string;
  quick?: QuickReply;
  /** A proposal and where it stands NOW — read from the negotiation, because a message cannot change. */
  proposal?: { proposalId: string; price: number; status?: string };
  decision?: { proposalId: string; decision: 'accepted' | 'declined'; price: number };
  settlement?: { amount: number; method: SettleMethod; when: SettleWhen; agreed: boolean };
  refSeq?: number;
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
  /** The asker's display name, shown to the poster. The poster is "the poster" to the asker. */
  counterpartName?: string;
  /** CV2 — whether a price can be named in this thread: the load was posted to be negotiated. */
  negotiable: boolean;
  /** CV2 — whether the two may record a settlement here: the network does not pay for this load. */
  settlesOffPlatform: boolean;
  lastSeq: number;
  unread: number;
  lastMessage?: MessageView;
  lastAt?: string;
  createdAt: string;
  blocked: boolean;
  blockedByMe: boolean;
}
