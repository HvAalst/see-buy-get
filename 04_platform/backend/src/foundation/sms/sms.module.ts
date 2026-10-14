import { Global, Module } from '@nestjs/common';
import { OutboxSmsSender } from './outbox-sms.sender';
import { SmsService } from './sms.service';
import { SMS_SENDER, SmsSender } from './sms.types';
import { twilioConfig } from './twilio';
import { TwilioSmsSender } from './twilio.sender';

/**
 * WHICH SENDER THIS SERVER STARTS WITH — decided once, here, from what it was given.
 *
 * Twilio, when there is an account, a credential, a sender, and this is not a sandbox (`twilioConfig`). The outbox
 * otherwise, which keeps what it is handed: that is a sandbox as it is meant to run, and on anything else it is a
 * fault — nobody can be sent a code — which the door says to the person and the console's Connections screen says
 * to staff. Half a set-up is NOT half-used: nothing is sent, and the screen says which part is missing.
 */
export function chooseSmsSender(outbox: OutboxSmsSender, provider: TwilioSmsSender): SmsSender {
  return provider.ready() ? provider : outbox;
}

/** Global: the door that sends a code lives in the product module, and so does the Connections screen's answer. */
@Global()
@Module({
  providers: [
    SmsService,
    OutboxSmsSender,
    { provide: TwilioSmsSender, useFactory: () => new TwilioSmsSender(twilioConfig()) },
    { provide: SMS_SENDER, useFactory: chooseSmsSender, inject: [OutboxSmsSender, TwilioSmsSender] },
  ],
  exports: [SmsService, OutboxSmsSender],
})
export class SmsModule {}
