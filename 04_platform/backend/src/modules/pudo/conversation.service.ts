import { PersonService } from './person.service';
import { ParcelService } from './parcel.service';
import { accountFor, isFor } from './addressed-to';
import { AgentService } from './agent.service';
import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { decodeAudio } from '../../foundation/media/decode-audio';
import { DispatchService, commitModeOf } from './dispatch.service';
import { DriverService } from './driver.service';
import { NotificationService } from './notification.service';
import { VendorService } from './vendor.service';
import { ConversationSubject,
  QUICK_REPLIES,
  REPORT_REASONS,
  SETTLE_METHODS,
  SETTLE_WHEN,
  type Conversation,
  type ConversationMessage,
  type ConversationView,
  type DisputeReport,
  type MessageReport,
  type MessageView,
  type QuickReply,
  type ReportReason,
  type SettleMethod,
  type SettleWhen,
  type VoiceNote,
} from './conversation.types';

/** CV4 — a voice message is a message, not a recording session: about two minutes at a phone's bitrate. */
export const MAX_VOICE_BYTES = 900_000;
export const MAX_VOICE_SECONDS = 120;

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
  /** CV3 — reports of chosen messages a party shared with the network. Fixed copies; never changed. */
  private readonly disputeReports = new PersistentMap<string, DisputeReport>('pudo-conversation-dispute-reports');
  /** CV4 — voice recordings, apart from the messages so listing a thread never carries audio. */
  private readonly voice = new PersistentMap<string, VoiceNote>('pudo-conversation-voice');
  /** Send times per sender for the hourly cap. In memory: a restart forgiving an hour of messages is harmless. */
  private readonly sentAt = new Map<string, number[]>();

  constructor(
    private readonly dispatch: DispatchService,
    private readonly drivers: DriverService,
    private readonly notifications: NotificationService,
    private readonly vendors: VendorService,
    // CV5 — the parcel thread's three facts: the parcel, the person collecting it, the shop holding it. Optional so
    // the specs that construct this service over four stubs keep working; the real module always provides them.
    @Optional() private readonly parcels?: ParcelService,
    @Optional() private readonly persons?: PersonService,
    @Optional() private readonly agents?: AgentService,
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

  /**
   * CV5 — TALK ABOUT A PARCEL WAITING AT A SHOP: the person collecting it and the shop holding it.
   *
   * Either side may start it. The person collecting proves they are the receiver by being the account the parcel
   * belongs to — or, while it belongs to none, the one on the number it was addressed to; the shop proves itself by
   * being the parcel's collection shop. A stranger, on either
   * side, is told the parcel does not exist — the thread must not confirm that a parcel is waiting for somebody.
   *
   * The shop can only reach a customer who HAS an account: a message needs a person to arrive at. Told plainly,
   * with what to say to the customer, because the alternative — the shop typing a number into somebody else's
   * messaging app — is exactly the third-party dependence this thread exists to remove.
   */
  openAboutParcel(parcelId: string, did: string, now = Date.now()): ConversationView {
    if (!this.parcels || !this.persons) throw new GlosError('INVALID_STATE', 'Parcel conversations are not available here');
    const parcel = this.parcels.get(parcelId); // NOT_FOUND for a parcel that does not exist
    const shopDid = parcel.destAgentDid;
    if (!shopDid) throw new GlosError('INVALID_STATE', 'This parcel has no collection shop yet, so there is nobody to talk to');
    if (parcel.status === 'Voided' || parcel.status === 'Returned') throw new GlosError('INVALID_STATE', 'This parcel is no longer waiting at a shop');

    let askerDid: string;
    if (did === shopDid) {
      const person = accountFor(this.parcels.receiverOf(parcel), this.persons);
      if (!person) {
        throw new GlosError('NOT_FOUND', 'This customer has no SeeBuyGet account yet, so there is nobody to message. They can sign in to the Send app with the phone number they gave, and the parcel will be there.');
      }
      askerDid = person.personDid;
    } else {
      const person = this.persons.findByDid(did);
      if (!person || !isFor(this.parcels.receiverOf(parcel), person)) throw new GlosError('NOT_FOUND', 'Parcel not found');
      askerDid = did;
    }

    const existing = [...this.threads.values()].find((c) => c.parcelId === parcelId && c.askerDid === askerDid);
    if (existing) return this.viewFor(existing, did);

    const startedToday = [...this.threads.values()].filter((c) => (c.askerDid === did || c.posterDid === did) && now - Date.parse(c.createdAt) < DAY_MS).length;
    if (startedToday >= NEW_THREADS_PER_DAY) {
      throw new GlosError('FORBIDDEN', `You have started ${NEW_THREADS_PER_DAY} conversations today — answer the ones you have, and try again tomorrow`);
    }
    const thread: Conversation = {
      conversationId: `cv_${randomBytes(8).toString('hex')}`,
      parcelId,
      posterDid: shopDid,
      askerDid,
      createdAt: new Date(now).toISOString(),
      lastSeq: 0,
      readSeq: {},
    };
    this.threads.set(thread.conversationId, thread);
    return this.viewFor(thread, did);
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
    // A shared thread may be READ by the driver's manager; everything else below still needs a party.
    const thread = this.requireReader(conversationId, did);
    const all = this.messages.get(conversationId) ?? [];
    const agreed = agreedSeqs(all);
    const items = all.filter((m) => m.seq > after).map((m) => this.viewOf(m, did, agreed, thread.posterDid));
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
    const freightId = requireLoad(thread, 'A price is named on a load — a parcel waiting at a shop has nothing to price');
    const note = boundedNote(input.note);
    const proposal = this.dispatch.propose({ freightId, driverDid: did, from: input.from, price: Number(input.price), ...(note ? { note } : {}) }, now);
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
    if (!thread.freightId || !this.settlesOffPlatform(thread.freightId)) {
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

  /**
   * CV4 — A VOICE MESSAGE. For the driver with a load in both hands, and for anybody for whom writing is the
   * hard part. The recording is checked by its bytes (decodeAudio), kept apart from the thread, and pushed as
   * "a voice message arrived" — never with the recording or anything from it.
   */
  sendVoice(conversationId: string, did: string, input: { dataUrl: string; durationSec: number }, now = Date.now()): MessageView {
    const thread = this.requireParty(conversationId, did);
    this.requireOpen(thread, did);
    const durationSec = Math.round(Number(input.durationSec));
    if (!Number.isFinite(durationSec) || durationSec < 1 || durationSec > MAX_VOICE_SECONDS) {
      throw new GlosError('INVALID_INPUT', `A voice message runs 1 to ${MAX_VOICE_SECONDS} seconds`);
    }
    const { contentType, bytes } = decodeAudio(input.dataUrl, MAX_VOICE_BYTES);
    const note: VoiceNote = {
      voiceId: `vn_${randomBytes(8).toString('hex')}`,
      conversationId,
      fromDid: did,
      contentType,
      data: bytes.toString('base64'),
      size: bytes.length,
      durationSec,
      createdAt: new Date(now).toISOString(),
    };
    this.voice.set(note.voiceId, note);
    try {
      return this.append(thread, did, { kind: 'voice', voiceId: note.voiceId, durationSec }, now, 'New voice message about');
    } catch (err) {
      // Refused by the hourly cap: a recording nobody can reach must not stay behind.
      this.voice.delete(note.voiceId);
      throw err;
    }
  }

  /** CV4 — play a voice message: those who may read the thread (a party, or a manager the driver shared it with). */
  voiceFor(conversationId: string, voiceId: string, did: string): { contentType: string; bytes: Buffer } {
    this.requireReader(conversationId, did);
    const note = this.voice.get(voiceId);
    // Another conversation's recording is as absent as one that never existed.
    if (!note || note.conversationId !== conversationId) throw new GlosError('NOT_FOUND', 'Voice message not found');
    return { contentType: note.contentType, bytes: Buffer.from(note.data, 'base64') };
  }

  /** CV4 — the operator plays a voice message a party put in a shared report. That one, and no other. */
  voiceForReport(reportId: string, voiceId: string): { contentType: string; bytes: Buffer } {
    const report = this.disputeReports.get(reportId);
    if (!report || !report.messages.some((m) => m.voiceId === voiceId)) throw new GlosError('NOT_FOUND', 'Voice message not found in that report');
    const note = this.voice.get(voiceId);
    if (!note) throw new GlosError('NOT_FOUND', 'Voice message not found');
    return { contentType: note.contentType, bytes: Buffer.from(note.data, 'base64') };
  }

  /**
   * CV3 — THE DRIVER SHARES THIS CONVERSATION WITH THEIR FLEET MANAGER, or stops sharing it.
   *
   * The driver's decision alone (user, 2026-09-13): the poster cannot share the driver's words onward, and a
   * manager cannot ask for them. Read-only, and it follows the fleet — a driver who leaves takes the share with
   * them, because the reader is checked against the driver's CURRENT manager on every read.
   */
  setShared(conversationId: string, did: string, on: boolean, now = Date.now()): ConversationView {
    const thread = this.requireParty(conversationId, did);
    if (did !== thread.askerDid) throw new GlosError('FORBIDDEN', 'Only the driver in this conversation can share it with their fleet manager');
    if (on) {
      const managerDid = this.managerOf(did);
      if (!managerDid) throw new GlosError('INVALID_STATE', 'You drive for yourself, so there is no fleet manager to share this with');
      thread.sharedWithManagerDid = managerDid;
      thread.sharedAt = new Date(now).toISOString();
    } else {
      delete thread.sharedWithManagerDid;
      delete thread.sharedAt;
    }
    this.threads.set(conversationId, thread);
    return this.viewFor(thread, did);
  }

  /** CV3 — the threads this manager's drivers shared with them, most recently active first. */
  listShared(managerDid: string): ConversationView[] {
    return [...this.threads.values()]
      .filter((c) => this.isSharedWith(c, managerDid))
      .sort((a, b) => (b.lastAt ?? b.createdAt).localeCompare(a.lastAt ?? a.createdAt))
      .map((c) => this.viewFor(c, managerDid));
  }

  /**
   * CV3 — A PARTY SHARES A REPORT OF CHOSEN MESSAGES with the network.
   *
   * The party decides what is shown (user, 2026-09-13); the thread itself stays private. A fixed copy with a
   * sha256 fingerprint, identities replaced by the role each message came from, and a line in the thread so
   * the OTHER side knows a report was shared. Allowed in a blocked thread: a dispute is most often what comes
   * after two people stopped talking.
   */
  shareDisputeReport(conversationId: string, did: string, seqs: number[], note?: string, now = Date.now()): { reportId: string; fingerprint: string; seqCount: number } {
    const thread = this.requireParty(conversationId, did);
    const chosen = [...new Set((seqs ?? []).map((s) => Number(s)))].filter((s) => Number.isInteger(s)).sort((a, b) => a - b);
    if (!chosen.length) throw new GlosError('INVALID_INPUT', 'Choose the messages that show what happened');
    if (chosen.length > 200) throw new GlosError('INVALID_INPUT', 'A report can hold up to 200 messages');
    const all = this.messages.get(conversationId) ?? [];
    const picked = chosen.map((s) => all.find((m) => m.seq === s));
    if (picked.some((m) => !m)) throw new GlosError('NOT_FOUND', 'One of those messages is not in this conversation');
    const cleanNote = boundedNote(note);

    const messages: DisputeReport['messages'] = (picked as ConversationMessage[]).map((m) => ({
      seq: m.seq,
      from: m.fromDid === thread.posterDid ? 'poster' : 'asker',
      kind: m.kind,
      ...(m.body !== undefined ? { body: m.body } : {}),
      ...(m.quick ? { quick: m.quick } : {}),
      ...(m.price !== undefined ? { price: m.price } : {}),
      ...(m.decision ? { decision: m.decision } : {}),
      ...(m.settlement ? { settlement: { ...m.settlement } } : {}),
      ...(m.refSeq !== undefined ? { refSeq: m.refSeq } : {}),
      ...(m.voiceId ? { voiceId: m.voiceId, durationSec: m.durationSec } : {}),
      at: m.at,
    }));
    const report: DisputeReport = {
      reportId: `dr_${randomBytes(8).toString('hex')}`,
      conversationId,
      subject: subjectOf(thread),
      ...(thread.freightId ? { freightId: thread.freightId } : {}),
      ...(thread.parcelId ? { parcelId: thread.parcelId } : {}),
      freightCode: this.codeOf(thread),
      posterDid: thread.posterDid,
      askerDid: thread.askerDid,
      byDid: did,
      sharedBy: did === thread.posterDid ? 'poster' : 'asker',
      ...(cleanNote ? { note: cleanNote } : {}),
      messages,
      fingerprint: createHash('sha256').update(JSON.stringify(messages)).digest('hex'),
      createdAt: new Date(now).toISOString(),
    };
    this.disputeReports.set(report.reportId, report);
    // Told in the thread, never done behind the other side's back.
    this.append(thread, did, { kind: 'report_shared', reportRef: report.reportId, seqCount: chosen.length }, now, 'A report was shared about');
    return { reportId: report.reportId, fingerprint: report.fingerprint, seqCount: chosen.length };
  }

  /** CV3 — every dispute report, newest first — for the operator. */
  listDisputeReports(): DisputeReport[] {
    return [...this.disputeReports.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
        title: `${pushTitle} ${this.codeOf(thread)}`,
        body: 'Open the conversation to read it.',
        tag: `conv:${thread.conversationId}`,
        data: { conversationId: thread.conversationId, ...(thread.freightId ? { freightId: thread.freightId } : {}), ...(thread.parcelId ? { parcelId: thread.parcelId } : {}) },
      })
      .catch(() => undefined);

    return this.viewOf(stored, fromDid, agreedSeqs(all), thread.posterDid);
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

  /** A party — or the driver's CURRENT manager on a thread the driver shared. Reading only. */
  private requireReader(conversationId: string, did: string): Conversation {
    const thread = this.threads.get(conversationId);
    if (thread && (thread.posterDid === did || thread.askerDid === did || this.isSharedWith(thread, did))) return thread;
    throw new GlosError('NOT_FOUND', 'Conversation not found');
  }

  /** Shared with this manager, and that manager still manages the driver. */
  private isSharedWith(thread: Conversation, managerDid: string): boolean {
    return Boolean(thread.sharedWithManagerDid) && thread.sharedWithManagerDid === managerDid && this.managerOf(thread.askerDid) === managerDid;
  }

  private managerOf(driverDid: string): string | undefined {
    try {
      return this.drivers.get(driverDid).managerDid ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** A message as one party reads it. A proposal carries where it stands NOW, read from the negotiation. */
  private viewOf(m: ConversationMessage, did: string, agreed: Set<number>, posterDid: string): MessageView {
    const view: MessageView = { seq: m.seq, mine: m.fromDid === did, from: m.fromDid === posterDid ? 'poster' : 'asker', kind: m.kind, at: m.at };
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
    if (m.kind === 'report_shared' && m.seqCount !== undefined) view.seqCount = m.seqCount;
    if (m.kind === 'voice' && m.voiceId) view.voice = { voiceId: m.voiceId, durationSec: m.durationSec ?? 0 };
    return view;
  }

  private viewFor(thread: Conversation, did: string): ConversationView {
    const role: ConversationView['role'] = did === thread.posterDid ? 'poster' : did === thread.askerDid ? 'asker' : 'manager';
    const all = this.messages.get(thread.conversationId) ?? [];
    const last = all.at(-1);
    const counterpartName = this.counterpartName(thread, role);
    return {
      conversationId: thread.conversationId,
      subject: subjectOf(thread),
      ...(thread.freightId ? { freightId: thread.freightId } : {}),
      ...(thread.parcelId ? { parcelId: thread.parcelId } : {}),
      freightCode: this.codeOf(thread),
      freightLabel: this.labelOf(thread),
      role,
      ...(counterpartName ? { counterpartName } : {}),
      negotiable: Boolean(thread.freightId) && this.negotiable(thread.freightId!),
      settlesOffPlatform: Boolean(thread.freightId) && this.settlesOffPlatform(thread.freightId!),
      shareable: Boolean(this.managerOf(thread.askerDid)),
      sharedWithManager: Boolean(thread.sharedWithManagerDid) && thread.sharedWithManagerDid === this.managerOf(thread.askerDid),
      lastSeq: thread.lastSeq,
      // A manager reads a shared thread; they keep no read marker in somebody else's conversation.
      unread: role === 'manager' ? 0 : Math.max(0, thread.lastSeq - (thread.readSeq[did] ?? 0)),
      ...(last ? { lastMessage: this.viewOf(last, did, agreedSeqs(all), thread.posterDid) } : {}),
      ...(thread.lastAt ? { lastAt: thread.lastAt } : {}),
      createdAt: thread.createdAt,
      blocked: Boolean(thread.blockedBy),
      blockedByMe: thread.blockedBy === did,
    };
  }

  /** Who the other side is, by name, where a name may be shown — see ConversationView.counterpartName. */
  private counterpartName(thread: Conversation, role: ConversationView['role']): string | undefined {
    try {
      if (thread.parcelId) {
        if (role === 'asker') return this.agents?.get(thread.posterDid).shopName;
        const person = this.persons?.findByDid(thread.askerDid);
        return person ? this.persons?.profile(person).displayName : undefined;
      }
      return role !== 'asker' ? this.drivers.get(thread.askerDid).displayName : undefined;
    } catch {
      return undefined;
    }
  }

  private codeOf(thread: Conversation): string {
    return thread.parcelId ?? this.freightCode(thread.freightId ?? '');
  }

  private labelOf(thread: Conversation): string {
    if (!thread.parcelId) return this.freightLabel(thread.freightId ?? '');
    try {
      return `Collect at ${this.agents?.get(thread.posterDid).shopName ?? 'the shop'}`;
    } catch {
      return 'Collect at the shop';
    }
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

function subjectOf(thread: Pick<Conversation, 'parcelId'>): ConversationSubject {
  return thread.parcelId ? 'parcel' : 'freight';
}

/** The load a deal is about — a parcel thread has none, and says so in the caller's words. */
function requireLoad(thread: Pick<Conversation, 'freightId'>, reason: string): string {
  if (!thread.freightId) throw new GlosError('INVALID_STATE', reason);
  return thread.freightId;
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
