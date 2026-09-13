import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DispatchService, commitModeOf } from './dispatch.service';
import { DriverService } from './driver.service';
import { NotificationService } from './notification.service';
import { VendorService } from './vendor.service';
import {
  QUICK_REPLIES,
  REPORT_REASONS,
  SETTLE_METHODS,
  SETTLE_WHEN,
  type Conversation,
  type ConversationMessage,
  type ConversationView,
  type MessageReport,
  type MessageView,
  type QuickReply,
  type ReportReason,
  type SettleMethod,
  type SettleWhen,
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
 * CONVERSATIONS ABOUT A LOAD. See conversation.types.ts and 05_engineering/conversations.md.
 *
 * CV1 is the thread. CV2 puts the deal IN it: a price is named through the load's own negotiation (so the
 * shop's price screen and the thread are one fact, not two copies that can disagree), and two people who settle
 * a load the network does not pay can write down how — a record the network keeps and never acts on.
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
    private readonly vendors: VendorService,
  ) {}

  /**
   * WHO ANSWERS FOR A LOAD, as a person the chat can recognise.
   *
   * A store's diverted order records the STORE ID as its shipper (`ven_…`) — dispatch bills against it — while
   * a store signs in as its DID. Compared raw, the thread would be addressed to an id nobody signs in as, and
   * the store would never see a question about its own load. Resolved here to the DID a store actually holds.
   */
  private posterOf(freight: { postedByDid?: string; shipperDid?: string }): string | undefined {
    if (freight.postedByDid) return freight.postedByDid;
    const shipper = freight.shipperDid;
    if (shipper && this.vendors.has(shipper)) return this.vendors.get(shipper).did;
    return shipper;
  }

  /**
   * Ask about a load — or return to the thread already asked. One thread per (load, asker), so asking twice
   * never scatters one negotiation across two places.
   */
  open(freightId: string, askerDid: string, now = Date.now()): ConversationView {
    const freight = this.dispatch.requireFreightPublic(freightId);
    const posterDid = this.posterOf(freight);
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
    const all = this.messages.get(conversationId) ?? [];
    const agreed = agreedSeqs(all);
    const items = all.filter((m) => m.seq > after).map((m) => this.viewOf(m, did, agreed));
    return { thread: this.viewFor(thread, did), items };
  }

  send(conversationId: string, fromDid: string, input: { body?: string; quick?: string }, now = Date.now()): MessageView {
    const thread = this.requireParty(conversationId, fromDid);
    this.requireOpen(thread, fromDid);
    return this.append(thread, fromDid, composed(input), now, 'New message about');
  }

  /**
   * CV2 — THE DRIVER NAMES A PRICE, in the thread.
   *
   * Made through the load's own negotiation rather than beside it: the shop's price screen and this thread
   * then show one proposal, and every rule the negotiation already enforces (a negotiable load, a coupled
   * vehicle, a rating above the floor, one live price per driver) applies here without being restated.
   */
  proposePrice(conversationId: string, did: string, input: { price: number; note?: string; from: { lat: number; lng: number } }, now = Date.now()): MessageView {
    const thread = this.requireParty(conversationId, did);
    if (did !== thread.askerDid) throw new GlosError('FORBIDDEN', 'Only the driver who asked can name a price — the poster accepts or declines it');
    this.requireOpen(thread, did);
    const note = boundedNote(input.note);
    const proposal = this.dispatch.propose({ freightId: thread.freightId, driverDid: did, from: input.from, price: Number(input.price), ...(note ? { note } : {}) }, now);
    return this.append(thread, did, { kind: 'proposal', proposalId: proposal.proposalId, price: proposal.price, ...(note ? { body: note } : {}) }, now, 'New price offered on');
  }

  /**
   * CV2 — THE POSTER ANSWERS A PRICE, in the thread. Accepting claims the load for that driver, exactly as the
   * price screen does, because it IS the price screen's accept.
   */
  decideProposal(conversationId: string, did: string, proposalId: string, decision: 'accept' | 'decline', now = Date.now()): MessageView {
    const thread = this.requireParty(conversationId, did);
    if (did !== thread.posterDid) throw new GlosError('FORBIDDEN', 'Only the poster of the load can accept or decline a price');
    this.requireOpen(thread, did);
    const proposal = this.dispatch.requireProposalPublic(proposalId);
    // A price from ANOTHER driver on the same load is not this conversation's to decide.
    if (proposal.freightId !== thread.freightId || proposal.driverDid !== thread.askerDid) throw new GlosError('NOT_FOUND', 'No such price in this conversation');
    const decided = decision === 'accept' ? this.dispatch.acceptProposal(proposalId, now).proposal : this.dispatch.declineProposal(proposalId, now);
    return this.append(
      thread,
      did,
      { kind: 'decision', proposalId, decision: decision === 'accept' ? 'accepted' : 'declined', price: decided.price },
      now,
      decision === 'accept' ? 'Price accepted on' : 'Price declined on',
    );
  }

  /**
   * CV2 — WRITE DOWN HOW YOU WILL SETTLE, for a load the network does not pay.
   *
   * A RECORD, never a posting: nothing here touches the books, in any country. Refused on a load the network
   * pays for, because a second private arrangement beside a payout the platform already makes is how a driver
   * gets paid twice — or a shop believes it has.
   */
  recordSettlement(conversationId: string, did: string, input: { amount: number; method: string; when: string; note?: string }, now = Date.now()): MessageView {
    const thread = this.requireParty(conversationId, did);
    this.requireOpen(thread, did);
    if (!this.settlesOffPlatform(thread.freightId)) {
      throw new GlosError('INVALID_STATE', 'This load is paid through the network, so there is nothing to settle between you — the driver is paid on delivery');
    }
    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) throw new GlosError('INVALID_INPUT', 'Name an amount above zero');
    if (!SETTLE_METHODS.includes(input.method as SettleMethod)) throw new GlosError('INVALID_INPUT', `How it is paid: ${SETTLE_METHODS.join(', ')}`);
    if (!SETTLE_WHEN.includes(input.when as SettleWhen)) throw new GlosError('INVALID_INPUT', `When it is paid: ${SETTLE_WHEN.join(', ')}`);
    const note = boundedNote(input.note);
    return this.append(
      thread,
      did,
      { kind: 'settlement', settlement: { amount, method: input.method as SettleMethod, when: input.when as SettleWhen }, ...(note ? { body: note } : {}) },
      now,
      'A settlement was written down on',
    );
  }

  /** CV2 — the OTHER party agrees to a written-down settlement. Once; never by the one who wrote it. */
  agreeSettlement(conversationId: string, did: string, seq: number, now = Date.now()): MessageView {
    const thread = this.requireParty(conversationId, did);
    this.requireOpen(thread, did);
    const all = this.messages.get(conversationId) ?? [];
    const target = all.find((m) => m.seq === Number(seq) && m.kind === 'settlement');
    if (!target) throw new GlosError('NOT_FOUND', 'No such settlement in this conversation');
    if (target.fromDid === did) throw new GlosError('INVALID_INPUT', 'The other side agrees to a settlement — not the one who wrote it down');
    if (agreedSeqs(all).has(target.seq)) throw new GlosError('INVALID_STATE', 'This settlement is already agreed');
    return this.append(thread, did, { kind: 'settlement_agreed', refSeq: target.seq }, now, 'A settlement was agreed on');
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

  /** Every report, newest first — for the operator's Reported messages screen. */
  listReports(): MessageReport[] {
    return [...this.reports.values()].sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * ONE WAY A MESSAGE ENTERS A THREAD — text, a price, a decision or a settlement alike: the hourly cap, the
   * next sequence number, the sender's own read marker, and a discreet push to the other party.
   */
  private append(thread: Conversation, fromDid: string, message: Omit<ConversationMessage, 'seq' | 'fromDid' | 'at'>, now: number, pushTitle: string): MessageView {
    const recent = (this.sentAt.get(fromDid) ?? []).filter((t) => now - t < HOUR_MS);
    if (recent.length >= MESSAGES_PER_HOUR) throw new GlosError('FORBIDDEN', 'That is a lot of messages in one hour — wait a little before sending more');
    this.sentAt.set(fromDid, [...recent, now]);

    const at = new Date(now).toISOString();
    const stored: ConversationMessage = { seq: thread.lastSeq + 1, fromDid, at, ...message };
    const all = [...(this.messages.get(thread.conversationId) ?? []), stored];
    this.messages.set(thread.conversationId, all);
    thread.lastSeq = stored.seq;
    thread.lastAt = at;
    thread.readSeq = { ...thread.readSeq, [fromDid]: stored.seq };
    this.threads.set(thread.conversationId, thread);

    // DISCREET: the push says what KIND of thing arrived and about which load — never what it says, and never
    // an amount. A lock screen is read by whoever is holding the phone.
    const other = fromDid === thread.posterDid ? thread.askerDid : thread.posterDid;
    void this.notifications
      .notify(other, {
        kind: 'message',
        title: `${pushTitle} ${this.freightCode(thread.freightId)}`,
        body: 'Open the conversation to read it.',
        tag: `conv:${thread.conversationId}`,
        data: { conversationId: thread.conversationId, freightId: thread.freightId },
      })
      .catch(() => undefined);

    return this.viewOf(stored, fromDid, agreedSeqs(all));
  }

  private requireOpen(thread: Conversation, did: string): void {
    if (thread.blockedBy) {
      throw new GlosError('FORBIDDEN', thread.blockedBy === did ? 'You blocked this conversation — unblock it to write again' : 'This conversation is closed');
    }
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

  /** A message as one party reads it. A proposal carries where it stands NOW, read from the negotiation. */
  private viewOf(m: ConversationMessage, did: string, agreed: Set<number>): MessageView {
    const view: MessageView = { seq: m.seq, mine: m.fromDid === did, kind: m.kind, at: m.at };
    if (m.body !== undefined) view.body = m.body;
    if (m.quick) view.quick = m.quick;
    if (m.kind === 'proposal' && m.proposalId) {
      let status: string | undefined;
      try {
        status = this.dispatch.requireProposalPublic(m.proposalId).status;
      } catch {
        status = undefined;
      }
      view.proposal = { proposalId: m.proposalId, price: m.price ?? 0, ...(status ? { status } : {}) };
    }
    if (m.kind === 'decision' && m.proposalId && m.decision) view.decision = { proposalId: m.proposalId, decision: m.decision, price: m.price ?? 0 };
    if (m.kind === 'settlement' && m.settlement) view.settlement = { ...m.settlement, agreed: agreed.has(m.seq) };
    if (m.refSeq !== undefined) view.refSeq = m.refSeq;
    return view;
  }

  private viewFor(thread: Conversation, did: string): ConversationView {
    const role = did === thread.posterDid ? 'poster' : 'asker';
    const all = this.messages.get(thread.conversationId) ?? [];
    const last = all.at(-1);
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
      negotiable: this.negotiable(thread.freightId),
      settlesOffPlatform: this.settlesOffPlatform(thread.freightId),
      lastSeq: thread.lastSeq,
      unread: Math.max(0, thread.lastSeq - (thread.readSeq[did] ?? 0)),
      ...(last ? { lastMessage: this.viewOf(last, did, agreedSeqs(all)) } : {}),
      ...(thread.lastAt ? { lastAt: thread.lastAt } : {}),
      createdAt: thread.createdAt,
      blocked: Boolean(thread.blockedBy),
      blockedByMe: thread.blockedBy === did,
    };
  }

  private negotiable(freightId: string): boolean {
    try {
      return commitModeOf(this.dispatch.requireFreightPublic(freightId)) === 'negotiate';
    } catch {
      return false;
    }
  }

  /** A load with no paying shipper settles off-platform — the counter's cash booking, a bulletin load. */
  private settlesOffPlatform(freightId: string): boolean {
    try {
      return !this.dispatch.requireFreightPublic(freightId).shipperDid;
    } catch {
      return false;
    }
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

/** The settlement messages somebody has agreed to. */
function agreedSeqs(all: ConversationMessage[]): Set<number> {
  return new Set(all.filter((m) => m.kind === 'settlement_agreed' && m.refSeq !== undefined).map((m) => m.refSeq!));
}

function boundedNote(note?: string): string | undefined {
  const trimmed = note?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_MESSAGE_CHARS) throw new GlosError('INVALID_INPUT', `Keep a note under ${MAX_MESSAGE_CHARS} characters`);
  return trimmed;
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
