import { AfricasTalkingConfig, readAtAnswer, toAtForm } from './africastalking';
import type { RouteSender } from './code-route.service';
import type { RouteState } from './code-routes.types';
import { OutgoingSms, SmsFailure, SmsSendError } from './sms.types';

/** How long Africa's Talking is waited for: somebody is looking at "we are sending you a code". */
export const AT_TIMEOUT_MS = 10_000;

const WORDS: Record<SmsFailure, string> = {
  unreachable: "Africa's Talking could not be reached",
  refused: "Africa's Talking refused it for this account",
  limit: "Africa's Talking asked us to slow down",
  rejected: "Africa's Talking cannot text this number",
  failed: "Africa's Talking answered with a fault",
  paused: 'this server reached its own cap on texts',
};

/**
 * 2026-11-16 — ONE TEXT, POSTED TO AFRICA'S TALKING. Taken only when it said so (`readAtAnswer`); otherwise an
 * `SmsSendError` saying whose it is to put right, carrying no number, text or key. No second try of its own: the next
 * ROUTE is the second try (CodeRouteService). A redirect is not followed: the key is for one address.
 */
export class AfricasTalkingSender implements RouteSender {
  readonly id = 'africastalking' as const;
  readonly kind = 'sms' as const;

  constructor(
    private readonly config: AfricasTalkingConfig,
    private readonly timeoutMs: number = AT_TIMEOUT_MS,
  ) {}

  state(): RouteState {
    return this.config.state;
  }

  reportsDelivery(): boolean {
    return this.config.state === 'ready' && this.config.reports;
  }

  async deliver(sms: OutgoingSms): Promise<{ ref?: string }> {
    const { endpoint, apiKey } = this.config;
    if (!endpoint || !apiKey) throw new SmsSendError('refused', "Africa's Talking is not set up");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    let status: number;
    let body: string;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { apiKey, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: toAtForm(this.config, sms),
        redirect: 'manual',
        signal: abort.signal,
      });
      status = res.status;
      body = await res.text();
    } catch {
      throw new SmsSendError('unreachable', WORDS.unreachable);
    } finally {
      clearTimeout(timer);
    }
    const answer = readAtAnswer(status, body);
    if (!answer.ok) throw new SmsSendError(answer.kind, answer.code ? `${WORDS[answer.kind]} (${answer.code})` : WORDS[answer.kind], answer.code);
    return answer.ref ? { ref: answer.ref } : {};
  }
}
