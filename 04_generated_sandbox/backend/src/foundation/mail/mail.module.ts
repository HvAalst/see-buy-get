import { Global, Module } from '@nestjs/common';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { OutboxMailSender } from './outbox-mail.sender';
import { MAIL_SENDER } from './mail.types';

/**
 * Global: accounts, company administrators, staff and fleets all send mail.
 *
 * PRODUCTION SWAP: provide a ZeptoMail sender under MAIL_SENDER when ZEPTOMAIL_TOKEN is set (mail.types.ts).
 */
@Global()
@Module({
  controllers: [MailController],
  providers: [MailService, OutboxMailSender, { provide: MAIL_SENDER, useExisting: OutboxMailSender }],
  exports: [MailService, OutboxMailSender],
})
export class MailModule {}
