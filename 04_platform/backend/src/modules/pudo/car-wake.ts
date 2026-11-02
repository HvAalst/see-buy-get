import { Inject, Injectable, Logger } from '@nestjs/common';
import { PersonService } from './person.service';
import { tokenPrint } from './car-keys';
import { readFcmAnswer, readTokenAnswer, signedAssertion, tokenForm, wakeData, wakeMessage, type FcmConfig, type FcmFailure, type WakeData } from './fcm';

/**
 * MESSAGES IN THE CAR — THE WAKE-UP (05_engineering/android-auto-messages.md; the owner, 2026-11-02: "we start with 2").
 *
 * A message arrives in a chat for a driver who turned "Messages in the car" on: the phone is sent a content-free
 * Firebase message — this chat has news, and nothing else — and its native part fetches the words from us with its car
 * key, then posts the notification the car reads aloud. Never a name or a word through Google's push service.
 */

/** Firebase no longer knows this phone (UNREGISTERED, or a token of another project's): its token is dropped. */
export class CarTokenGone extends Error {
  constructor() {
    super('Firebase no longer knows this phone');
    this.name = 'CarTokenGone';
  }
}

/** A wake-up not taken, said by what to do about it. Carries no token, no key, no address. */
export class CarWakeError extends Error {
  constructor(
    readonly kind: FcmFailure,
    message: string,
  ) {
    super(message);
    this.name = 'CarWakeError';
  }
}

/** Whatever takes a wake-up off our hands. It resolves ONLY when it was taken; a dead token throws CarTokenGone. */
export interface CarWakeSender {
  send(token: string, conversationId: string): Promise<void>;
}
export const CAR_WAKE_SENDER = Symbol('CAR_WAKE_SENDER');

/** One wake-up the outbox kept: a print of the token it was for (never the token), and exactly what it said. */
export interface KeptWake {
  to: string;
  data: WakeData;
  at: string;
}

/**
 * WHERE A WAKE-UP GOES WHEN FIREBASE IS NOT WIRED IN: nowhere. Kept here, the newest fifty, so that a sandbox can be read
 * ("what would have been sent?") and a test can assert on what a phone would have received. The message it was for went
 * as it always does: a wake-up is never what a message waits on.
 */
@Injectable()
export class OutboxCarWakeSender implements CarWakeSender {
  private readonly kept: KeptWake[] = [];

  async send(token: string, conversationId: string): Promise<void> {
    this.kept.unshift({ to: tokenPrint(token), data: wakeData(conversationId), at: new Date().toISOString() });
    this.kept.length = Math.min(this.kept.length, 50);
  }

  /** What was "sent", newest first — to one phone's token, or to anybody. */
  recent(token?: string): KeptWake[] {
    const print = token ? tokenPrint(token) : undefined;
    return this.kept.filter((w) => !print || w.to === print);
  }
}

/** How long Firebase is waited for. Nobody is looking at a screen; a message is not held up by it either. */
export const FCM_TIMEOUT_MS = 10_000;

const WORDS: Record<FcmFailure, string> = {
  gone: 'Firebase no longer knows this phone',
  auth: 'Firebase refused the server’s access token',
  limit: 'Firebase asked us to slow down',
  refused: 'Firebase refused it for this project',
  failed: 'Firebase answered with a fault',
  unreachable: 'Firebase could not be reached',
};

/**
 * THE PRODUCTION `CarWakeSender`: one wake-up, POSTed to Firebase's HTTP v1 API with an access token traded for an
 * assertion signed by the service account (fcm.ts). The access token is kept until a minute before it runs out; one
 * Firebase refuses is asked for again, once, and the wake-up tried once more — a wake-up sent twice is harmless, it says
 * only "look". Nothing it throws carries a token, a key or an address, and it logs nothing at all.
 *
 * A redirect is not followed: the credential is for one address.
 */
export class FcmWakeSender implements CarWakeSender {
  private access?: { token: string; until: number };
  private asking?: Promise<string>;

  constructor(
    private readonly config: FcmConfig,
    private readonly timeoutMs: number = FCM_TIMEOUT_MS,
  ) {}

  /** A project, a service account that reads, and an address it may go to. Without all of them this is not wired in. */
  ready(): boolean {
    return Boolean(this.config.sendUrl && this.config.tokenUrl && this.config.clientEmail && this.config.privateKey);
  }

  async send(token: string, conversationId: string): Promise<void> {
    if (!this.ready()) throw new CarWakeError('refused', 'Firebase is not set up');
    let answer = await this.post(await this.accessToken(), token, conversationId);
    if (!answer.ok && answer.kind === 'auth') {
      this.access = undefined;
      answer = await this.post(await this.accessToken(), token, conversationId);
    }
    if (answer.ok) return;
    if (answer.kind === 'gone') throw new CarTokenGone();
    throw new CarWakeError(answer.kind, WORDS[answer.kind]);
  }

  /** The access token: kept while it is good, asked for once however many wake-ups are waiting for it. */
  private accessToken(now: number = Date.now()): Promise<string> {
    if (this.access && this.access.until > now) return Promise.resolve(this.access.token);
    this.asking ??= this.askForToken().finally(() => {
      this.asking = undefined;
    });
    return this.asking;
  }

  private async askForToken(): Promise<string> {
    const { status, body } = await this.fetch(this.config.tokenUrl as string, { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, tokenForm(signedAssertion(this.config)));
    const got = readTokenAnswer(status, body);
    if (!got) throw new CarWakeError('auth', 'Google would not give the server an access token for Firebase');
    this.access = { token: got.token, until: Date.now() + Math.max(0, got.seconds - 60) * 1000 };
    return got.token;
  }

  private async post(access: string, token: string, conversationId: string) {
    const { status, body } = await this.fetch(this.config.sendUrl as string, { authorization: `Bearer ${access}`, 'content-type': 'application/json', accept: 'application/json' }, JSON.stringify(wakeMessage(token, conversationId)));
    return readFcmAnswer(status, body);
  }

  private async fetch(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: abort.signal });
      return { status: res.status, body: await res.text() };
    } catch {
      // No answer, or none in time. What went wrong is not passed on: an error from the socket can name the address.
      throw new CarWakeError('unreachable', WORDS.unreachable);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Firebase when it can be used; the outbox otherwise — which is a sandbox as it is meant to run, and off where nothing is set. */
export function chooseCarWakeSender(outbox: OutboxCarWakeSender, fcm: FcmWakeSender): CarWakeSender {
  return fcm.ready() ? fcm : outbox;
}

/**
 * WHO IS WOKEN WHEN A MESSAGE ARRIVES. ConversationService calls `wake` with whoever the message is FOR; if that is a
 * driver record with a car key whose phone has told us its token, the phone is woken. Never awaited by the chat, never
 * able to fail a message: what goes wrong here is counted, and that is all.
 *
 * An account at rest (muted) is not woken, as it is not rung (NotificationService): what arrived waits in the app.
 */
@Injectable()
export class CarWakeService {
  private readonly logger = new Logger(CarWakeService.name);
  /** Since this server started: kept in memory, and a restart forgets it. */
  private handed = 0;
  private failed = 0;
  private dropped = 0;

  constructor(
    private readonly persons: PersonService,
    @Inject(CAR_WAKE_SENDER) private readonly sender: CarWakeSender,
  ) {}

  /**
   * DOES THE CAR REACH THIS DRIVER — a car key whose phone told us its token? Then a chat message is not also pushed to
   * the web app (the integrator, 2026-11-02): the Play app shows the web app's push notices as its own, and the driver
   * would be told twice. It stays in the bell's inbox. An account at rest is reached by neither. Never throws.
   */
  reachesInCar(recipientDid: string): boolean {
    try {
      return !this.persons.isResting(recipientDid) && this.persons.carKeysOfDriver(recipientDid).some((k) => Boolean(k.car.fcmToken));
    } catch {
      return false;
    }
  }

  /** Wake every phone that reads this driver's chats in the car. How many were asked. Never throws. */
  async wake(recipientDid: string, conversationId: string): Promise<number> {
    let keys;
    try {
      if (this.persons.isResting(recipientDid)) return 0;
      keys = this.persons.carKeysOfDriver(recipientDid).filter((k) => k.car.fcmToken);
    } catch {
      return 0;
    }
    await Promise.all(
      keys.map(async ({ car }) => {
        const token = car.fcmToken as string;
        try {
          await this.sender.send(token, conversationId);
          this.handed += 1;
        } catch (err) {
          this.failed += 1;
          if (err instanceof CarTokenGone) {
            // GONE IS AN ANSWER, not a fault: the app was removed, or the phone wiped. The token is dropped — only if it
            // is still the one we sent to; the phone may have told us a new one meanwhile — and Settings says "Waiting
            // for the phone" until it tells us another.
            this.persons.updateCarKey(car.keyHash, (c) => (c.fcmToken === token ? withoutToken(c) : c));
            this.dropped += 1;
          } else {
            // The kind only: never the token, the key, the driver or the chat.
            this.logger.warn(`a wake-up for the car was not taken: ${(err as CarWakeError).kind ?? 'failed'}`);
          }
        }
      }),
    );
    return keys.length;
  }

  /** For staff, and tests: what this server has done since it started. Counts only. */
  counts(): { handed: number; failed: number; dropped: number } {
    return { handed: this.handed, failed: this.failed, dropped: this.dropped };
  }
}

function withoutToken<T extends { fcmToken?: string; tokenAt?: string }>(car: T): T {
  const rest = { ...car };
  delete rest.fcmToken;
  delete rest.tokenAt;
  return rest;
}
