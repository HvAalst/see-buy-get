import { Global, Module } from '@nestjs/common';
import { MailBounces } from './mail-bounces.service';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { OutboxMailSender } from './outbox-mail.sender';
import { MAIL_SENDER, MailSender } from './mail.types';
import { zeptoMailConfig } from './zeptomail';
import { ZeptoMailSender } from './zeptomail.sender';

/**
 * WHICH SENDER THIS SERVER STARTS WITH — decided once, here, from what it was given.
 *
 * The provider's, when there is a token AND an address it may be sent to. The outbox otherwise, which keeps what it
 * is handed: that is a sandbox as it is meant to run, and on anything else it is a fault the console's Connections
 * screen says out loud. A token with no usable address is NOT half-used: nothing is sent, and the screen says why.
 */
export function chooseMailSender(outbox: OutboxMailSender, provider: ZeptoMailSender): MailSender {
  return provider.ready() ? provider : outbox;
}

/** Global: accounts, company administrators, staff and fleets all send mail. */
@Global()
@Module({
  controllers: [MailController],
  providers: [
    MailService,
    MailBounces,
    OutboxMailSender,
    { provide: ZeptoMailSender, useFactory: () => new ZeptoMailSender(zeptoMailConfig()) },
    { provide: MAIL_SENDER, useFactory: chooseMailSender, inject: [OutboxMailSender, ZeptoMailSender] },
  ],
  exports: [MailService, MailBounces, OutboxMailSender],
})
export class MailModule {}
