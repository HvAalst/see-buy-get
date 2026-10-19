import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { EntityService } from '../../foundation/entity/entity.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { MailService } from '../../foundation/mail/mail.service';
import { tryDelivery, type HookMessage } from '../../foundation/outbound/hook-delivery';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { BUSINESS_HOOK_EVENTS, type BusinessHookEvent, type BusinessSystemCounts, type BusinessSystemView } from './business-hook.types';
import { BusinessService, type ActingMember } from './business.service';
import { DispatchService } from './dispatch.service';
import { NotificationService } from './notification.service';

/** How often waiting messages are sent. A system waiting on "picked up" wants seconds, not minutes. */
const DRAIN_MS = Number(process.env.GLOS_CALLBACK_DRAIN_MS ?? 15_000);
/** At most once a day a business is told its system is not taking our messages (round 10: "The company, once a day"). */
const TELL_EVERY_MS = 24 * 3_600_000;

/** Which of our events is which of the business's, and where the load is in it. */
const TOPICS: ReadonlyArray<[string, BusinessHookEvent, (p: Record<string, unknown>) => string | undefined]> = [
  // A carrier took it: claimed from the board, an accepted price, or an office's own driver.
  [GlosEvent.Pudo.LoadClaimed, 'load.taken', (p) => (p.kind === 'freight' ? String(p.ref ?? '') : undefined)],
  [GlosEvent.Pudo.FreightHandedBack, 'load.handed_back', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightPickedUp, 'load.picked_up', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightDeliveryFailed, 'load.delivery_failed', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightDelivered, 'load.delivered', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightCancelled, 'load.cancelled', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightClaimOpened, 'load.claim_opened', (p) => String(p.freightId ?? '')],
  [GlosEvent.Pudo.FreightClaimDecided, 'load.claim_decided', (p) => String(p.freightId ?? '')],
];

interface SystemSettings {
  entityId: string;
  url?: string;
  setAt?: string;
  secret: string;
  secretTurnedAt: string;
}

interface BusinessHookMessage extends HookMessage {
  entityId: string;
  /** When the last of its tries failed: what the once-a-day notice counts. */
  givenUpAt?: string;
}

/**
 * A BUSINESS'S OWN SYSTEM, TOLD OF ITS LOADS (the user, round 10: "Businesses first"; "Only what it sees in its app";
 * "The company, once a day").
 *
 * WHAT IT HEARS: a carrier took its load, gave it back, picked it up, could not hand it over, delivered it; it was
 * cancelled; a claim was opened on it, and decided. Nothing about money: a business's payments are between the parties
 * (rule-quotations-not-payments). A load at a border or a hub is not said: nothing records that yet.
 *
 * WHAT A MESSAGE CARRIES: the load exactly as the business's own Loads screen reads it (DispatchService.postedBy), and
 * nothing more — never a fleet's own price, never where a driver is.
 *
 * HOW: signed with the business's own secret (made when an owner first gives an address, shown once, turned by an
 * owner), tried eight times over about two days like a store's (hook-delivery.ts), and read back by the business: whether
 * each arrived, sent again, a test. When some are given up, the business is told in its bell and its owners by email —
 * at most once a day. Network staff see counts and send nothing in a business's name.
 */
@Injectable()
export class BusinessHookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BusinessHookService.name);
  private readonly settings = new PersistentMap<string, SystemSettings>('business-hook-settings');
  private readonly outbox = new PersistentMap<string, BusinessHookMessage>('business-hook-outbox');
  /** When each business was last told its system is down. */
  private readonly told = new PersistentMap<string, { at: string }>('business-hook-told');
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;

  constructor(
    private readonly events: EventBus,
    private readonly dispatch: DispatchService,
    private readonly entities: EntityService,
    private readonly businesses: BusinessService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly mail?: MailService,
  ) {}

  onModuleInit(): void {
    for (const [topic, event, freightOf] of TOPICS) {
      this.events.subscribe<Record<string, unknown>>(topic, (e) => {
        const freightId = freightOf(e.payload ?? {});
        if (freightId) this.relay(event, freightId);
      });
    }
    this.timer = setInterval(() => void this.drain(), DRAIN_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /* ---------------------------------------------------------- what is sent -- */

  /** One event on one load, to each business whose load it is and that gave its system's address. */
  relay(event: BusinessHookEvent, freightId: string): void {
    let f;
    try {
      f = this.dispatch.requireFreightPublic(freightId);
    } catch {
      return;
    }
    for (const did of new Set([f.postedByDid, f.shipperDid].filter((d): d is string => Boolean(d)))) {
      const entity = this.entities.byDid(did);
      if (!entity?.business) continue;
      // Exactly what its own Loads screen reads about this load.
      const load = this.dispatch.postedBy(did).find((r) => r.freightId === freightId);
      if (load) this.enqueue(entity.entityId, event, { load });
    }
  }

  private enqueue(entityId: string, event: string, data: Record<string, unknown>, now: number = Date.now()): BusinessHookMessage | undefined {
    const s = this.settings.get(entityId);
    if (!s?.url) return undefined;
    const at = new Date(now).toISOString();
    const body = JSON.stringify({ event, data, at });
    const message: BusinessHookMessage = {
      id: `bh_${randomBytes(6).toString('hex')}`,
      entityId,
      url: s.url,
      event,
      signature: createHmac('sha256', s.secret).update(body).digest('hex'),
      body,
      at,
      state: 'pending',
      attempts: 0,
      nextTryAt: at,
    };
    this.outbox.set(message.id, message);
    return message;
  }

  /** Send what is due, then tell a business whose system has stopped taking them. Serial, and never throws. */
  async drain(now: number = Date.now()): Promise<{ sent: number; failed: number }> {
    if (this.draining) return { sent: 0, failed: 0 };
    this.draining = true;
    let sent = 0;
    let failed = 0;
    try {
      const due = [...this.outbox.values()].filter((m) => m.state === 'pending' && Date.parse(m.nextTryAt) <= now);
      for (const message of due) {
        const after = await tryDelivery(message, now);
        if (after.state === 'delivered') sent += 1;
        if (after.state === 'failed') {
          after.givenUpAt = new Date(now).toISOString();
          failed += 1;
        }
        this.outbox.set(after.id, after);
      }
      await this.tellWhenDown(now);
    } catch (err) {
      this.logger.warn(`business messages: ${(err as Error).message}`);
    } finally {
      this.draining = false;
    }
    return { sent, failed };
  }

  /**
   * ONCE A DAY AT MOST: a business with messages given up since it was last told hears it in its bell, and its owners
   * by email, with where to send them again (round 10: "The company, once a day").
   */
  async tellWhenDown(now: number = Date.now()): Promise<number> {
    const byBusiness = new Map<string, BusinessHookMessage[]>();
    for (const m of this.outbox.values()) {
      if (m.state !== 'failed' || !m.givenUpAt) continue;
      const last = this.told.get(m.entityId)?.at;
      if (last && m.givenUpAt <= last) continue;
      byBusiness.set(m.entityId, [...(byBusiness.get(m.entityId) ?? []), m]);
    }
    let told = 0;
    for (const [entityId, given] of byBusiness) {
      const last = this.told.get(entityId)?.at;
      if (last && now - Date.parse(last) < TELL_EVERY_MS) continue;
      const entity = this.entities.find(entityId);
      if (!entity?.business) continue;
      this.told.set(entityId, { at: new Date(now).toISOString() });
      told += 1;
      const since = given.map((m) => m.at).sort()[0];
      const count = given.length;
      try {
        await this.notifications?.notify(entity.did, {
          kind: 'system_down',
          title: 'Your system is not taking our messages',
          body: `${count === 1 ? 'A message' : `${count} messages`} about your loads ${count === 1 ? 'was' : 'were'} given up after two days of tries. Put your system right, then send ${count === 1 ? 'it' : 'them'} again under Your system.`,
          link: '/',
          data: { count, since },
        });
      } catch (err) {
        this.logger.warn(`system_down notice failed for ${entityId}: ${(err as Error).message}`);
      }
      for (const owner of this.businesses.ownerAddresses(entityId)) {
        void this.mail?.send('business-system-down', { address: owner.address, name: owner.name }, { business: entity.name, count, since });
      }
    }
    return told;
  }

  /* ----------------------------------------------------- what the business does -- */

  /** What its system is told, and what became of each message — any member reads it. */
  view(entityId: string, extra: { secret?: string } = {}): BusinessSystemView {
    const s = this.settings.get(entityId);
    return {
      ...(s?.url ? { url: s.url, setAt: s.setAt } : {}),
      hasSecret: Boolean(s?.secret),
      ...(s?.secretTurnedAt ? { secretTurnedAt: s.secretTurnedAt } : {}),
      ...extra,
      events: [...BUSINESS_HOOK_EVENTS],
      messages: [...this.outbox.values()]
        .filter((m) => m.entityId === entityId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 100)
        .map(({ id, event, at, state, attempts, nextTryAt, deliveredAt, lastError, resent, body }) => ({ id, event, at, state, attempts, nextTryAt, body, ...(deliveredAt ? { deliveredAt } : {}), ...(lastError ? { lastError } : {}), ...(resent ? { resent } : {}) })),
    };
  }

  /**
   * Where its system is told — an owner's act. The first address makes the business's signing secret, shown in this
   * answer and never again. Empty stops the messages; the secret stays, so giving an address again needs no new one.
   */
  setAddress(acting: ActingMember, raw: string, now: number = Date.now()): BusinessSystemView {
    this.businesses.requireOwner(acting);
    const entityId = acting.entity.entityId;
    const url = String(raw ?? '').trim();
    if (url && !/^https?:\/\/[^\s/]+/i.test(url)) throw new GlosError('INVALID_INPUT', 'Give the full address of your system, starting with https://', { field: 'url' });
    const at = new Date(now).toISOString();
    const before = this.settings.get(entityId);
    const secret = before?.secret ?? newSecret();
    this.settings.set(entityId, { entityId, secret, secretTurnedAt: before?.secretTurnedAt ?? at, ...(url ? { url, setAt: at } : {}) });
    return this.view(entityId, before ? {} : { secret });
  }

  /** A new signing secret, shown in this answer and never again — an owner's act. Every message from now on is signed with it. */
  turnSecret(acting: ActingMember, now: number = Date.now()): BusinessSystemView {
    this.businesses.requireOwner(acting);
    const entityId = acting.entity.entityId;
    const before = this.settings.get(entityId);
    const secret = newSecret();
    this.settings.set(entityId, { ...(before ?? { entityId }), entityId, secret, secretTurnedAt: new Date(now).toISOString() });
    return this.view(entityId, { secret });
  }

  /** A message that says only that it is a test. A member who may act. */
  async test(acting: ActingMember): Promise<BusinessSystemView['messages'][number]> {
    this.requireMayAct(acting);
    const sent = this.enqueue(acting.entity.entityId, 'test', { message: 'A test message from SeeBuyGet. Verify its signature with your secret; then your system can read ours.' });
    if (!sent) throw new GlosError('INVALID_STATE', 'Give your system’s address first');
    await this.drain();
    return this.messageView(acting.entity.entityId, sent.id);
  }

  /**
   * One sent again: the SAME message (its id, its body) to the address and with the secret the business has now, with
   * a fresh round of tries. A member who may act.
   */
  async resend(acting: ActingMember, messageId: string, now: number = Date.now()): Promise<BusinessSystemView['messages'][number]> {
    this.requireMayAct(acting);
    const entityId = acting.entity.entityId;
    const message = this.outbox.get(messageId);
    if (!message || message.entityId !== entityId) throw new GlosError('NOT_FOUND', 'No such message');
    const s = this.settings.get(entityId);
    if (!s?.url) throw new GlosError('INVALID_STATE', 'Give your system’s address first');
    const again: BusinessHookMessage = {
      ...message,
      url: s.url,
      signature: createHmac('sha256', s.secret).update(message.body).digest('hex'),
      state: 'pending',
      attempts: 0,
      nextTryAt: new Date(now).toISOString(),
      resent: (message.resent ?? 0) + 1,
    };
    delete again.lastError;
    delete again.givenUpAt;
    this.outbox.set(again.id, again);
    await this.drain();
    return this.messageView(entityId, messageId);
  }

  /** For network staff: how its messages stand, counted. */
  counts(entityId: string): BusinessSystemCounts {
    const mine = [...this.outbox.values()].filter((m) => m.entityId === entityId);
    return {
      hasAddress: Boolean(this.settings.get(entityId)?.url),
      delivered: mine.filter((m) => m.state === 'delivered').length,
      waiting: mine.filter((m) => m.state === 'pending').length,
      givenUp: mine.filter((m) => m.state === 'failed').length,
    };
  }

  private messageView(entityId: string, id: string): BusinessSystemView['messages'][number] {
    const found = this.view(entityId).messages.find((m) => m.id === id);
    if (!found) throw new GlosError('NOT_FOUND', 'No such message');
    return found;
  }

  private requireMayAct(acting: ActingMember): void {
    if (!this.businesses.mayAct(acting)) throw new GlosError('FORBIDDEN', 'A viewer reads; ask somebody who may act for the business');
  }
}

function newSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}
