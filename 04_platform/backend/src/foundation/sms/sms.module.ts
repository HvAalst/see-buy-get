import { Global, Module } from '@nestjs/common';
import { africasTalkingConfig } from './africastalking';
import { AfricasTalkingSender } from './africastalking.sender';
import { CodeRouteService, ROUTE_SENDERS, RouteSender } from './code-route.service';
import { OutboxSmsSender } from './outbox-sms.sender';
import { SmsStatusController } from './sms-status.controller';
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
 *
 * 2026-11-16 — and the ROUTES a code may go by (CodeRouteService): Africa's Talking and Twilio, each used where it is set
 * up, in the order staff set per country on the console's Sign-in codes screen.
 */
export function chooseSmsSender(outbox: OutboxSmsSender, provider: TwilioSmsSender): SmsSender {
  return provider.ready() ? provider : outbox;
}

/** Global: the door that sends a code lives in the product module, and so does the Connections screen's answer. */
@Global()
@Module({
  controllers: [SmsStatusController],
  providers: [
    SmsService,
    OutboxSmsSender,
    CodeRouteService,
    { provide: TwilioSmsSender, useFactory: () => new TwilioSmsSender(twilioConfig()) },
    { provide: AfricasTalkingSender, useFactory: () => new AfricasTalkingSender(africasTalkingConfig()) },
    { provide: SMS_SENDER, useFactory: chooseSmsSender, inject: [OutboxSmsSender, TwilioSmsSender] },
    { provide: ROUTE_SENDERS, useFactory: (africasTalking: AfricasTalkingSender, twilio: TwilioSmsSender): RouteSender[] => [africasTalking, twilio], inject: [AfricasTalkingSender, TwilioSmsSender] },
  ],
  exports: [SmsService, OutboxSmsSender, CodeRouteService],
})
export class SmsModule {}
