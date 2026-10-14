import { Injectable } from '@nestjs/common';
import { OutgoingSms, SmsSender } from './sms.types';

/**
 * WHERE A TEXT GOES WHEN NO PROVIDER IS WIRED IN: nowhere. It is kept here, the newest fifty, so that a sandbox can
 * be read ("what would have been texted?") and a test can assert on the RECEIVER — the thing a sender's own
 * "it worked" never proves. On a server real people use, texts ending here is a fault, and the console's Connections
 * screen says so out loud.
 */
@Injectable()
export class OutboxSmsSender implements SmsSender {
  private readonly kept: Array<OutgoingSms & { at: string }> = [];

  async send(sms: OutgoingSms): Promise<void> {
    this.kept.unshift({ ...sms, at: new Date().toISOString() });
    this.kept.length = Math.min(this.kept.length, 50);
  }

  /** What was "sent", newest first — to one number, or to anybody. */
  recent(to?: string): Array<OutgoingSms & { at: string }> {
    return this.kept.filter((m) => !to || m.to === to);
  }
}
