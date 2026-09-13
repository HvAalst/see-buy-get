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
export type MessageKind = 'text' | 'quick' | 'proposal' | 'decision' | 'settlement' | 'settlement_agreed' | 'report_shared' | 'voice';

/**
 * CV4 — A VOICE MESSAGE'S RECORDING, kept apart from the thread's messages so a thread's list stays small.
 * Read only by those who may read the thread (and an operator, when a party put it in a shared report).
 */
export interface VoiceNote {
  voiceId: string;
  conversationId: string;
  fromDid: string;
  contentType: string;
  /** The recording, base64. */
  data: string;
  size: number;
  durationSec: number;
  createdAt: string;
}

/**
 * CV3 — A REPORT OF CHOSEN MESSAGES, shared by a party with the network.
 *
 * The thread stays private; what the operator reads is exactly the messages one party chose, as a FIXED copy
 * with a fingerprint over it, so nobody can later claim the report said something else. Identities are replaced
 * by the role each message came from. The operator-only record keeps the parties' DIDs, because acting on a
 * dispute means knowing who is in it.
 */
export interface DisputeReport {
  reportId: string;
  conversationId: string;
  freightId: string;
  freightCode: string;
  posterDid: string;
  askerDid: string;
  byDid: string;
  sharedBy: 'poster' | 'driver';
  note?: string;
  messages: Array<{
    seq: number;
    from: 'poster' | 'driver';
    kind: MessageKind;
    body?: string;
    quick?: QuickReply;
    price?: number;
    decision?: 'accepted' | 'declined';
    settlement?: { amount: number; method: SettleMethod; when: SettleWhen };
    refSeq?: number;
    /** A voice message the party chose to include — the operator may play exactly this one. */
    voiceId?: string;
    durationSec?: number;
    at: string;
  }>;
  /**
   * sha256 over the messages exactly as shared.
   *
   * NOT called `hash`: the global ResponseMaskInterceptor strips any key named `hash` from every response, at
   * every depth (it is a credential name). Found in the browser pass — the report reached the console without
   * its fingerprint, and the screen crashed for every operator the moment one report existed.
   */
  fingerprint: string;
  createdAt: string;
}

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
  /** CV3 — the driver's own fleet manager, when the driver chose to share. Read-only, and only while that
   *  manager is still the driver's manager. */
  sharedWithManagerDid?: string;
  sharedAt?: string;
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
  /** report_shared: the dispute report, and how many messages it holds — so the OTHER side is told. */
  reportRef?: string;
  seqCount?: number;
  /** voice: the recording, and how long it runs. */
  voiceId?: string;
  durationSec?: number;
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
  /** The role the message came from — never who. A shared reader is neither party, so "mine" says nothing to
   *  them: found in the browser pass, a manager saw their own driver's offer signed "the poster". */
  from: 'poster' | 'driver';
  kind: MessageKind;
  body?: string;
  quick?: QuickReply;
  /** A proposal and where it stands NOW — read from the negotiation, because a message cannot change. */
  proposal?: { proposalId: string; price: number; status?: string };
  decision?: { proposalId: string; decision: 'accepted' | 'declined'; price: number };
  settlement?: { amount: number; method: SettleMethod; when: SettleWhen; agreed: boolean };
  refSeq?: number;
  seqCount?: number;
  /** CV4 — a voice message: fetched separately, by those who may read the thread. */
  voice?: { voiceId: string; durationSec: number };
  at: string;
}

/** A thread as one party sees it. Carries no DID and no contact detail of the other party. */
export interface ConversationView {
  conversationId: string;
  freightId: string;
  freightCode: string;
  /** "Maize · Nakuru → Nairobi" — what the load is, so the list reads without opening each row. */
  freightLabel: string;
  /** `manager` — CV3: the driver's fleet manager reading a thread the driver shared. Never a writer. */
  role: 'poster' | 'asker' | 'manager';
  /** The asker's display name, shown to the poster (and the manager). The poster is "the poster" to the asker. */
  counterpartName?: string;
  /** CV3 — the asker drives for a fleet, so there is a manager to share with. */
  shareable: boolean;
  /** CV3 — the asker has shared this thread with that manager. */
  sharedWithManager: boolean;
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
