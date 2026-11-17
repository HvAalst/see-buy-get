import type { OutgoingCode, RouteSender } from './code-route.service';
import type { RouteState } from './code-routes.types';
import { SmsSendError } from './sms.types';
import type { TruecallerConfig } from './truecaller';

/**
 * 2026-11-17 — TRUECALLER, AS A ROUTE ON THE CONSOLE (the owner: "as recommended … build it"): shown with the others, offered
 * or withdrawn per country, counted — but it confirms a number without a code, so it is never handed a text.
 */
export class TruecallerRoute implements RouteSender {
  readonly id = 'truecaller' as const;
  readonly kind = 'confirm' as const;

  constructor(readonly config: TruecallerConfig) {}

  state(): RouteState {
    return this.config.state;
  }

  reportsDelivery(): boolean {
    return false;
  }

  async deliver(_msg: OutgoingCode): Promise<{ ref?: string }> {
    throw new SmsSendError('refused', 'Truecaller confirms a number; it carries no code');
  }
}
