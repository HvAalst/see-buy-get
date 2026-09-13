import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DispatchService } from './dispatch.service';
import { DriverService } from './driver.service';
import { NotificationService } from './notification.service';
import {
  QUICK_REPLIES,
  REPORT_REASONS,
  type Conversation,
  type ConversationMessage,
  type ConversationView,
  type MessageReport,
  type MessageView,
  type QuickReply,
  type ReportReason,
} from './conversation.types';

/** A message is a message, not a document. */
export const MAX_MESSAGE_CHARS = 1000;
/** Chat comes BEFORE a match, which means messaging strangers: a cap on how many a person may start a day. */
export const NEW_THREADS_PER_DAY = 20;
/** …and on how much one person may send in an hour, across every thread. */
export const MESSAGES_PER_HOUR = 60;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** A thread may be STARTED only while the load is still looking for somebody. */
const OPEN_TO_QUESTIONS = new Set(['available', 'scheduled']);

/**
 * CV1 — THE THREAD. See conversation.types.ts and 05_engineering/conversations.md.
 *
 * The rate limits live here, keyed by the sender, rather than on the route: the route-level guard counts per
 * IP, and a whole depot behind one mobile carrier is one IP.
 */
@Injectable()
export class ConversationService {
  // Durable: the thread is the record of what two people agreed, and a record that vanished on restart is not one.
  private readonly threads = new PersistentMap<string, Conversation>('pudo-conversations');
  private readonly messages = new PersistentMap<string, ConversationMessage[]>('pudo-conversation-messages');
  private readonly reports = new PersistentMap<string, MessageReport>('pudo-conversation-reports');
  /** Send times per sender for the hourly cap. In memory: a restart forgiving an hour of messages is harmless. */
  private readonly sentAt = new Map<string, number[]>();

  constructor(
    private readonly dispatch: DispatchService,
    private readonly drivers: DriverService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Ask about a load — or return to the thread already asked. One thread per (load, asker), so asking twice
   * never scatters one negotiation across two places.
   */
  open(freightId: string, askerDid: string, now = Date.now()): ConversationView {
    const freight = this.dispatch.requireFreightPublic(freightId);
    const posterDid = freight.postedByDid ?? freight.shipperDid;
    if (!posterDid) throw new GlosError('FORBIDDEN', 'Nobody can answer questions about this load — it was posted without an owner');
    if (posterDid === askerDid) throw new GlosError('INVALID_INPUT', 'This is your own load. People asking about it will appear in your conversations.');

    const existing = [...this.threads.values()].find((c) => c.freightId === freightId && c.askerDid === askerDid);
    if (existing) return this.viewFor(existing, askerDid);

    if (!this.drivers.canOperate(askerDid)) throw new GlosError('FORBIDDEN', 'Only an active driver can ask about a load');
    if (!OPEN_TO_QUESTIONS.has(freight.status) && freight.claimedBy !== askerDid) {
      throw new GlosError('INVALID_STATE', 'This load is no longer looking for a driver, so it is not open to new questions');
    }
    const startedToday = [...this.threads.values()].filter((c) => c.askerDid === askerDid && now - Date.parse(c.createdAt) < DAY_MS).length;
    if (startedToday >= NEW_THREADS_PER_DAY) {
      throw new GlosError('FORBIDDEN', `You have started ${NEW_THREADS_PER_DAY} conversations today — answer the ones you have, and try again tomorrow`);
    }

    const thread: Conversation = {
      conversationId: `cv_${randomBytes(8).toString('hex')}`,
      freightId,
      posterDid,
      askerDid,
      createdAt: new Date(now).toISOString(),
      lastSeq: 0,
      readSeq: {},
    };
    this.threads.set(thread.conversationId, thread);
    return this.viewFor(thread, askerDid);
  }

  /** Every thread this person is a party to, most recently active first. */
  listFor(did: string): ConversationView[] {
    return [...this.threads.values()]
      .filter((c) => c.posterDid === did || c.askerDid === did)
      .sort((a, b) => (b.lastAt ?? b.createdAt).localeCompare(a.lastAt ?? a.createdAt))
      .map((c) => this.viewFor(c, did));
  }

  /** One thread's messages after a sequence number. `after = 0` is the whole thread. */
  messagesFor(conversationId: string, did: string, after = 0): { thread: ConversationView; items: MessageView[] } {
    const thread = this.requireParty(conversationId, did);
    const items = (this.messages.get(conversationId) ?? []).filter((m) => m.seq > after).map((m) => viewOf(m, did));
    return { thread: this.viewFor(thread, did), items };
  }

  send(conversationId: string, fromDid: string, input: { body?: string; quick?: string }, now = Date.now()): MessageView {
    const thread = this.requireParty(conversationId, fromDid);
    if (thread.blockedBy) {
      throw new GlosError('FORBIDDEN', thread.blockedBy === fromDid ? 'You blocked this conversation — unblock it to write again' : 'This conversation is closed');
    }
    const message = composed(input);

    const recent = (this.sentAt.get(fromDid) ?? []).filter((t) => now - t < HOUR_MS);
    if (recent.length >= MESSAGES_PER_HOUR) throw new GlosError('FORBIDDEN', 'That is a lot of messages in one hour — wait a little before sending more');
    this.sentAt.set(fromDid, [...recent, now]);

    const at = new Date(now).toISOString();
    const stored: ConversationMessage = { seq: thread.lastSeq + 1, fromDid, at, ...message };
    this.messages.set(conversationId, [...(this.messages.get(conversationId) ?? []), stored]);
    thread.lastSeq = stored.seq;
    thread.lastAt = at;
    thread.readSeq = { ...thread.readSeq, [fromDid]: stored.seq };
    this.threads.set(conversationId, thread);

    // DISCREET: the push says a message arrived and about which load — never what it says. A lock screen is
    // read by whoever is holding the phone.
    const other = fromDid === thread.posterDid ? thread.askerDid : thread.posterDid;
    const code = this.freightCode(thread.freightId);
    void this.notifications
      .notify(other, {
        kind: 'message',
        title: `New message about ${code}`,
        body: 'Open the conversation to read it.',
        tag: `conv:${conversationId}`,
        data: { conversationId, freightId: thread.freightId },
      })
      .catch(() => undefined);

    return viewOf(stored, fromDid);
  }

  /** Move this party's read marker forward. Never backward, never past the end. */
  markRead(conversationId: string, did: string, seq: number): ConversationView {
    const thread = this.requireParty(conversationId, did);
    const upTo = Math.min(Math.max(0, Math.floor(Number(seq) || 0)), thread.lastSeq);
    if (upTo > (thread.readSeq[did] ?? 0)) {
      thread.readSeq = { ...thread.readSeq, [did]: upTo };
      this.threads.set(conversationId, thread);
    }
    return this.viewFor(thread, did);
  }

  /** Close the thread for writing, both ways, until the person who closed it opens it. The messages stay. */
  block(conversationId: string, did: string, now = Date.now()): ConversationView {
    const thread = this.requireParty(conversationId, did);
    if (!thread.blockedBy) {
      thread.blockedBy = did;
      thread.blockedAt = new Date(now).toISOString();
      this.threads.set(conversationId, thread);
    }
    return this.viewFor(thread, did);
  }

  unblock(conversationId: string, did: string): ConversationView {
    const thread = this.requireParty(conversationId, did);
    if (thread.blockedBy && thread.blockedBy !== did) throw new GlosError('FORBIDDEN', 'Only the person who closed this conversation can open it again');
    delete thread.blockedBy;
    delete thread.blockedAt;
    this.threads.set(conversationId, thread);
    return this.viewFor(thread, did);
  }

  /** Report a message you RECEIVED. Kept with a copy of the message, for the operator's review. */
  report(conversationId: string, did: string, seq: number, reason: string, now = Date.now()): { reportId: string } {
    this.requireParty(conversationId, did);
    if (!REPORT_REASONS.includes(reason as ReportReason)) throw new GlosError('INVALID_INPUT', `A report needs a reason: ${REPORT_REASONS.join(', ')}`);
    const message = (this.messages.get(conversationId) ?? []).find((m) => m.seq === Number(seq));
    if (!message) throw new GlosError('NOT_FOUND', 'No such message in this conversation');
    if (message.fromDid === did) throw new GlosError('INVALID_INPUT', 'You cannot report your own message');
    const existing = [...this.reports.values()].find((r) => r.conversationId === conversationId && r.seq === message.seq && r.byDid === did);
    if (existing) return { reportId: existing.reportId };
    const record: MessageReport = {
      reportId: `rpt_${randomBytes(8).toString('hex')}`,
      conversationId,
      seq: message.seq,
      byDid: did,
      reportedDid: message.fromDid,
      reason: reason as ReportReason,
      snapshot: { ...message },
      at: new Date(now).toISOString(),
    };
    this.reports.set(record.reportId, record);
    return { reportId: record.reportId };
  }

  /** Every report, newest first — for the operator (CV3 puts it on a screen). */
  listReports(): MessageReport[] {
    return [...this.reports.values()].sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * A stranger gets NOT_FOUND, never FORBIDDEN: telling somebody a conversation exists between two other
   * people is a fact they have not earned.
   */
  private requireParty(conversationId: string, did: string): Conversation {
    const thread = this.threads.get(conversationId);
    if (!thread || (thread.posterDid !== did && thread.askerDid !== did)) throw new GlosError('NOT_FOUND', 'Conversation not found');
    return thread;
  }

  private viewFor(thread: Conversation, did: string): ConversationView {
    const role = did === thread.posterDid ? 'poster' : 'asker';
    const last = (this.messages.get(thread.conversationId) ?? []).at(-1);
    let counterpartName: string | undefined;
    if (role === 'poster') {
      try {
        counterpartName = this.drivers.get(thread.askerDid).displayName;
      } catch {
        counterpartName = undefined;
      }
    }
    return {
      conversationId: thread.conversationId,
      freightId: thread.freightId,
      freightCode: this.freightCode(thread.freightId),
      freightLabel: this.freightLabel(thread.freightId),
      role,
      ...(counterpartName ? { counterpartName } : {}),
      lastSeq: thread.lastSeq,
      unread: Math.max(0, thread.lastSeq - (thread.readSeq[did] ?? 0)),
      ...(last ? { lastMessage: viewOf(last, did) } : {}),
      ...(thread.lastAt ? { lastAt: thread.lastAt } : {}),
      createdAt: thread.createdAt,
      blocked: Boolean(thread.blockedBy),
      blockedByMe: thread.blockedBy === did,
    };
  }

  private freightCode(freightId: string): string {
    try {
      return (this.dispatch.requireFreightPublic(freightId) as { code?: string }).code ?? freightId;
    } catch {
      return freightId;
    }
  }

  private freightLabel(freightId: string): string {
    try {
      const f = this.dispatch.requireFreightPublic(freightId);
      return `${f.description} · ${f.pickupLabel} → ${f.destLabel}`;
    } catch {
      return '';
    }
  }
}

function viewOf(m: ConversationMessage, did: string): MessageView {
  return { seq: m.seq, mine: m.fromDid === did, kind: m.kind, ...(m.body !== undefined ? { body: m.body } : {}), ...(m.quick ? { quick: m.quick } : {}), at: m.at };
}

/** Exactly one of a quick reply or some text — and text within bounds. */
function composed(input: { body?: string; quick?: string }): Pick<ConversationMessage, 'kind' | 'body' | 'quick'> {
  if (input.quick !== undefined && input.quick !== null && input.quick !== '') {
    if (!QUICK_REPLIES.includes(input.quick as QuickReply)) throw new GlosError('INVALID_INPUT', `Unknown quick reply: ${input.quick}`);
    return { kind: 'quick', quick: input.quick as QuickReply };
  }
  const body = (input.body ?? '').trim();
  if (!body) throw new GlosError('FIELD_REQUIRED', 'Write something first');
  if (body.length > MAX_MESSAGE_CHARS) throw new GlosError('INVALID_INPUT', `Keep a message under ${MAX_MESSAGE_CHARS} characters`);
  return { kind: 'text', body };
}
