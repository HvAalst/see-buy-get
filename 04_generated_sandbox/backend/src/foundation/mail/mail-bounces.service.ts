import { Injectable, Logger } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GlosError } from '../http/glos-error';
import { hashEmail } from '../identity/phone';
import { PersistentMap } from '../store/persistent-map';
import { EVENT_REFUSALS, EventRefusal, readBounces, readProducerSignature, readSignedEvent } from './mail-bounces';

/** How long an address is left alone after a soft bounce: a full mailbox, a server having a bad hour. */
export const SOFT_BOUNCE_PAUSE_H = 24;
/** How many notices' ids are remembered, so one sent twice is acted on once. */
const SEEN_MAX = 2000;

/** What is kept about an address that came back. NEVER THE ADDRESS: its key, as a person's own email is keyed. */
interface BouncedAddress {
  kind: 'hard' | 'soft';
  at: string;
  /** A soft bounce only: when writing to it starts again by itself. */
  until?: string;
  count: number;
  reason?: string;
}

/** Bounce notices, as staff are shown them. */
export class MailBounceConnection {
  /** A key is set, so notices are listened for. Without one the address they are sent to answers as if it were not there. */
  listening: boolean;
  /** Addresses email is not being sent to right now, because email to them came back. */
  stopped: number;
  /**
   * Since this server started: notices taken · notices that CARRIED A SIGNATURE and were refused — the provider with
   * another key, or this server reading it wrongly · requests with no signature at all, which are anybody's: the
   * address is public, and something will find it.
   */
  received: number;
  refused: number;
  unsigned: number;
  @ApiPropertyOptional() lastAt?: string;
  /** Why the last SIGNED one to be refused was. `mismatch` on every one of them means the key here is not the provider's. */
  @ApiPropertyOptional({ enum: EVENT_REFUSALS }) lastRefused?: EventRefusal;
  @ApiPropertyOptional() lastRefusedAt?: string;
}

/** What a bounce notice came to. */
export class ProviderEventsAnswer {
  @ApiProperty() ok: boolean;
}

/**
 * THE ADDRESSES EMAIL CAME BACK FROM.
 *
 * WHAT IT IS FOR. An address that bounces keeps bouncing, and a provider judges an account by how much of what it
 * sends comes back. So an address that came back for good is not written to again — until it proves itself: a code
 * sent to it, at somebody's own asking, is read and typed in. A CODE ALWAYS GOES, bounced or not, for that reason
 * (`MailTemplate.asked`): it is the only way back, and somebody at a screen asked for it.
 *
 * A SOFT BOUNCE — a full mailbox, a server having a bad hour — pauses the address for a day and then lets it go again.
 *
 * WHAT IS KEPT is the address's key (`hashEmail`, the same key a person's recovery email is known by), how it came
 * back, and when. Never the address. That is also what lets a person be told, in their own app, that the email they
 * would be reached at does not work.
 */
@Injectable()
export class MailBounces {
  private readonly logger = new Logger(MailBounces.name);
  private readonly addresses = new PersistentMap<string, BouncedAddress>('mail-bounced-addresses');
  private readonly seen = new Set<string>();

  /** Since this server started. */
  private received = 0;
  private refused = 0;
  private unsigned = 0;
  private lastAt?: string;
  private lastRefused?: { why: EventRefusal; at: string };

  /** The key the provider signs its notices with — set on the webhook there, and here as ZEPTOMAIL_WEBHOOK_KEY. */
  private key(): string {
    return process.env.ZEPTOMAIL_WEBHOOK_KEY?.trim() ?? '';
  }

  listening(): boolean {
    return Boolean(this.key());
  }

  /**
   * A NOTICE ARRIVES. `body` must be the bytes it arrived in: a signature is over those, and a body somebody has
   * already parsed cannot be checked. How many bounces it held.
   *
   * With no key set, this address does not exist. With one, a notice is taken only when it is signed with it; the
   * answer to anything else says nothing about why.
   */
  take(body: unknown, signature: string | undefined, now: number = Date.now()): number {
    const key = this.key();
    if (!key) throw new GlosError('NOT_FOUND', 'Not found');
    // No signature we can read: it is not the provider's, whatever its body. Said apart from a signed one refused.
    if (!readProducerSignature(signature)) return this.refuse('unsigned', now);
    if (!Buffer.isBuffer(body)) return this.refuse('not_raw', now);
    const read = readSignedEvent(body, signature, key, now);
    if (!read.ok) return this.refuse(read.why, now);
    this.received += 1;
    this.lastAt = new Date(now).toISOString();
    const { id, bounces } = readBounces(read.event);
    // The same notice, sent again: acted on once. (Its timestamp is not signed, so a replay cannot be told by age.)
    if (id) {
      if (this.seen.has(id)) return 0;
      this.seen.add(id);
      if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value as string);
    }
    for (const b of bounces) this.record(b.address, b.kind, b.reason, now);
    return bounces.length;
  }

  /** An address came back. A hard bounce is never softened by a later soft one; a soft one pauses from now. */
  record(address: string, kind: 'hard' | 'soft', reason: string | undefined, now: number = Date.now()): void {
    const key = hashEmail(address);
    if (!key) return;
    const before = this.addresses.get(key);
    const hard = kind === 'hard' || before?.kind === 'hard';
    this.addresses.set(key, {
      kind: hard ? 'hard' : 'soft',
      at: new Date(now).toISOString(),
      ...(hard ? {} : { until: new Date(now + SOFT_BOUNCE_PAUSE_H * 3_600_000).toISOString() }),
      count: (before?.count ?? 0) + 1,
      ...(reason ? { reason } : before?.reason ? { reason: before.reason } : {}),
    });
  }

  /** Is email to this address stopped right now, and how. */
  stopped(address: string, now: number = Date.now()): 'hard' | 'soft' | undefined {
    return this.stoppedKey(hashEmail(address), now);
  }

  /** The same, by the address's key — for a person, whose address is not kept beside them and whose key is. */
  stoppedKey(key: string | undefined, now: number = Date.now()): 'hard' | 'soft' | undefined {
    const entry = key ? this.addresses.get(key) : undefined;
    if (!entry) return undefined;
    if (entry.kind === 'hard') return 'hard';
    return entry.until && now < Date.parse(entry.until) ? 'soft' : undefined;
  }

  /** The address proved itself: somebody read a code we sent it. Email to it starts again. */
  works(address: string): void {
    const key = hashEmail(address);
    if (key && this.addresses.has(key)) this.addresses.delete(key);
  }

  connection(now: number = Date.now()): MailBounceConnection {
    return {
      listening: this.listening(),
      stopped: [...this.addresses.keys()].filter((k) => this.stoppedKey(k, now)).length,
      received: this.received,
      refused: this.refused,
      unsigned: this.unsigned,
      ...(this.lastAt ? { lastAt: this.lastAt } : {}),
      ...(this.lastRefused ? { lastRefused: this.lastRefused.why, lastRefusedAt: this.lastRefused.at } : {}),
    };
  }

  private refuse(why: EventRefusal, now: number): never {
    if (why === 'unsigned') this.unsigned += 1;
    else {
      this.refused += 1;
      this.lastRefused = { why, at: new Date(now).toISOString() };
    }
    // Ours to put right, and loud: every notice will be refused until it is.
    if (why === 'not_raw') this.logger.error('A bounce notice arrived and could not be checked: this server is not reading that address as raw bytes (readProviderEventsRaw)');
    // The provider — or whoever it was — is told only that it was not taken.
    throw new GlosError('UNAUTHORIZED', 'This notice was not taken');
  }
}
