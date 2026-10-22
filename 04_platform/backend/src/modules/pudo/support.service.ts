import { Injectable, Optional } from '@nestjs/common';
import { randomInt } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { MailService } from '../../foundation/mail/mail.service';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { isPlausibleEmail, normalizeEmail } from './email-code.service';
import {
  SUPPORT_CATEGORIES,
  URGENT_CATEGORIES,
  type SupportCategory,
  type SupportInboxView,
  type SupportMessageDto,
  type SupportMessageView,
  type SupportStatus,
} from './support.types';

/** A closed message, and the address with it, is kept this long — then it is deleted. Answered is not closed. */
export const SUPPORT_KEPT_DAYS = 180;
/** Open messages one address may have at once: a person writing again is fine; a machine writing a hundred is not. */
export const SUPPORT_OPEN_PER_ADDRESS = 5;
const DAY_MS = 86_400_000;
/** No 0/O or 1/I: a reference is read out on the phone. */
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface StoredMessage {
  reference: string;
  category: SupportCategory;
  email: string;
  message: string;
  about?: string;
  from?: string;
  locale?: string;
  at: string;
  status: SupportStatus;
  answers: { by: string; at: string; text: string; mailed: boolean }[];
  closedAt?: string;
  closedBy?: string;
}

/**
 * WRITING TO US (support.types.ts): the person's message, sorted by what it is about, read and answered by SeeBuyGet
 * staff by email. The person is thanked with a reference; staff read what cannot wait first, then whoever has waited
 * longest; an answer goes to the address given, and is kept with the message. Nobody has to sign in to write — the
 * person who most needs to write is the one who cannot.
 */
@Injectable()
export class SupportService {
  private readonly messages = new PersistentMap<string, StoredMessage>('support-messages');

  // Optional so a hand-built service still keeps what it is sent; without mail, nobody is emailed and nothing else changes.
  constructor(@Optional() private readonly mail?: MailService) {}

  /** A message as written. The address must be one an answer can go to; a form-filling machine's is dropped unread. */
  async write(dto: SupportMessageDto, now: number = Date.now()): Promise<{ reference: string }> {
    const email = normalizeEmail(dto.email);
    if (!isPlausibleEmail(email)) throw new GlosError('VALIDATION_FAILED', 'An email address we can answer you at', { field: 'email' });
    const message = dto.message.trim();
    if (message.length < 10) throw new GlosError('VALIDATION_FAILED', 'Say a little more: what happened, and what you need', { field: 'message' });
    // The field people never see: what fills it is a machine. Thanked like anybody, kept by nobody.
    if (dto.website?.trim()) return { reference: this.newReference() };
    this.sweep(now);
    const open = [...this.messages.values()].filter((m) => m.email === email && m.status === 'open').length;
    if (open >= SUPPORT_OPEN_PER_ADDRESS) {
      throw new GlosError('RATE_LIMITED', 'You have several messages waiting for an answer already. We answer them in turn: you will hear from us by email.');
    }
    const stored: StoredMessage = {
      reference: this.newReference(),
      category: dto.category,
      email,
      message,
      ...(dto.about ? { about: dto.about } : {}),
      ...(dto.from ? { from: dto.from } : {}),
      ...(dto.locale ? { locale: dto.locale.slice(0, 12) } : {}),
      at: new Date(now).toISOString(),
      status: 'open',
      answers: [],
    };
    this.messages.set(stored.reference, stored);
    await this.mail?.send('support-received', { address: email }, { reference: stored.reference, category: stored.category, message });
    return { reference: stored.reference };
  }

  /** For staff: messages in one state, urgent first, then oldest first; and how many are open per category. */
  inbox(status: SupportStatus = 'open', now: number = Date.now()): SupportInboxView {
    this.sweep(now);
    const all = [...this.messages.values()];
    const openBy = new Map<string, number>();
    for (const m of all) if (m.status === 'open') openBy.set(m.email, (openBy.get(m.email) ?? 0) + 1);
    const items = all
      .filter((m) => m.status === status)
      .sort((a, b) => Number(this.urgent(b)) - Number(this.urgent(a)) || (status === 'open' ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)))
      .map((m) => this.view(m, (openBy.get(m.email) ?? 0) - (m.status === 'open' ? 1 : 0)));
    const counts = SUPPORT_CATEGORIES.map((category) => ({ category, open: all.filter((m) => m.status === 'open' && m.category === category).length }));
    return { status, counts, items, keptDays: SUPPORT_KEPT_DAYS };
  }

  /** A member of staff answers: by email, to the address given, and the answer is kept with the message. */
  async answer(reference: string, text: string, by: string, now: number = Date.now()): Promise<SupportMessageView> {
    const m = this.require(reference);
    if (m.status === 'closed') throw new GlosError('INVALID_STATE', 'This message is closed. A new one from the same person is its own message.');
    const said = text.trim();
    if (!said) throw new GlosError('VALIDATION_FAILED', 'Write the answer', { field: 'text' });
    // Handed to the mail before it is recorded. `mailed` says whether it LEFT: until a mail provider is wired it waits in
    // the outbox, and the console says so beside the answer rather than letting it read as sent.
    const handed = (await this.mail?.send('support-answer', { address: m.email }, { reference: m.reference, asked: m.message, answer: said, by })) ?? false;
    m.answers.push({ by, at: new Date(now).toISOString(), text: said, mailed: handed && (this.mail?.delivers() ?? false) });
    m.status = 'answered';
    this.messages.set(m.reference, m);
    return this.view(m, 0);
  }

  /** Done with: kept for SUPPORT_KEPT_DAYS from now, then deleted with the address. */
  close(reference: string, by: string, now: number = Date.now()): SupportMessageView {
    const m = this.require(reference);
    if (m.status === 'closed') return this.view(m, 0);
    m.status = 'closed';
    m.closedAt = new Date(now).toISOString();
    m.closedBy = by;
    this.messages.set(m.reference, m);
    return this.view(m, 0);
  }

  private require(reference: string): StoredMessage {
    const m = this.messages.get(reference.trim().toUpperCase());
    if (!m) throw new GlosError('NOT_FOUND', 'No message with that reference');
    return m;
  }

  private urgent(m: StoredMessage): boolean {
    return URGENT_CATEGORIES.includes(m.category);
  }

  private view(m: StoredMessage, others: number): SupportMessageView {
    return { ...m, answers: [...m.answers], urgent: this.urgent(m), others: Math.max(0, others) };
  }

  private newReference(): string {
    for (;;) {
      let ref = 'SBG-';
      for (let i = 0; i < 6; i += 1) ref += REF_ALPHABET[randomInt(0, REF_ALPHABET.length)];
      if (!this.messages.has(ref)) return ref;
    }
  }

  /** A closed message past its keeping is deleted, the address with it. */
  private sweep(now: number): void {
    for (const [ref, m] of this.messages) {
      if (m.status === 'closed' && m.closedAt && now - Date.parse(m.closedAt) > SUPPORT_KEPT_DAYS * DAY_MS) this.messages.delete(ref);
    }
  }
}
