import type { OutgoingCode, RouteSender } from './code-route.service';
import type { RouteState } from './code-routes.types';
import { SmsFailure, SmsSendError } from './sms.types';
import { TelegramConfig, TELEGRAM_GATEWAY, readTelegramAnswer, toTelegramBody } from './telegram';
import { WhatsAppConfig, readWhatsAppAnswer, toWhatsAppBody } from './whatsapp';

/** How long an app's service is waited for: somebody is looking at "we are sending you a code". */
export const APP_TIMEOUT_MS = 10_000;

const words = (name: string): Record<SmsFailure, string> => ({
  unreachable: `${name} could not be reached`,
  refused: `${name} refused it for this account`,
  limit: `${name} asked us to slow down`,
  rejected: `${name} cannot reach this number`,
  failed: `${name} answered with a fault`,
  paused: 'this server reached its own cap on texts',
});

/** One JSON request, no redirect followed, its status and body — or `unreachable`, carrying nothing of the socket's words. */
async function post(url: string, token: string, body: string, timeoutMs: number, unreachable: string): Promise<{ status: number; body: string }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body, redirect: 'manual', signal: abort.signal });
    return { status: res.status, body: await res.text() };
  } catch {
    throw new SmsSendError('unreachable', unreachable);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 2026-11-16 — A CODE BY WHATSAPP (the plan, D2): the approved authentication template with the code in its body and copy
 * button. Only a code goes this way, and only when the person chose it.
 */
export class WhatsAppSender implements RouteSender {
  readonly id = 'whatsapp' as const;
  readonly kind = 'app' as const;
  private readonly said = words('WhatsApp');

  constructor(
    readonly config: WhatsAppConfig,
    private readonly timeoutMs: number = APP_TIMEOUT_MS,
  ) {}

  state(): RouteState {
    return this.config.state;
  }

  reportsDelivery(): boolean {
    return this.config.state === 'ready' && this.config.reports;
  }

  async deliver(msg: OutgoingCode): Promise<{ ref?: string }> {
    const { endpoint, token } = this.config;
    if (!endpoint || !token) throw new SmsSendError('refused', 'WhatsApp is not set up');
    if (!msg.code) throw new SmsSendError('refused', 'only a code goes by WhatsApp');
    const res = await post(endpoint, token, toWhatsAppBody(this.config, msg.to, msg.code), this.timeoutMs, this.said.unreachable);
    const answer = readWhatsAppAnswer(res.status, res.body);
    if (!answer.ok) throw new SmsSendError(answer.kind, answer.code ? `${this.said[answer.kind]} (${answer.code})` : this.said[answer.kind], answer.code);
    return answer.ref ? { ref: answer.ref } : {};
  }
}

/** 2026-11-16 — A CODE BY TELEGRAM (the plan, D3): our own code through Telegram's Gateway, refunded by it when not delivered. */
export class TelegramSender implements RouteSender {
  readonly id = 'telegram' as const;
  readonly kind = 'app' as const;
  private readonly said = words('Telegram');

  constructor(
    readonly config: TelegramConfig,
    private readonly timeoutMs: number = APP_TIMEOUT_MS,
  ) {}

  state(): RouteState {
    return this.config.state;
  }

  reportsDelivery(): boolean {
    return this.config.state === 'ready' && this.config.reports;
  }

  async deliver(msg: OutgoingCode): Promise<{ ref?: string }> {
    const { token } = this.config;
    if (this.config.state !== 'ready' || !token) throw new SmsSendError('refused', 'Telegram is not set up');
    if (!msg.code) throw new SmsSendError('refused', 'only a code goes by Telegram');
    const res = await post(TELEGRAM_GATEWAY, token, toTelegramBody(this.config, msg.to, msg.code, msg.minutes ?? 10), this.timeoutMs, this.said.unreachable);
    const answer = readTelegramAnswer(res.status, res.body);
    if (!answer.ok) throw new SmsSendError(answer.kind, answer.code ? `${this.said[answer.kind]} (${answer.code})` : this.said[answer.kind], answer.code);
    return answer.ref ? { ref: answer.ref } : {};
  }
}
