import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Public } from '../../foundation/auth/public.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { auditActor } from '../../foundation/auth/acting';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { SupportService } from './support.service';
import { SupportAnswerDto, SupportInboxView, SupportMessageDto, SupportMessageView, SupportReceivedView, type SupportStatus } from './support.types';

/** WRITING TO US (support.types.ts): anybody writes, signed in or not; network staff read, answer and close. */
@Controller('sbg')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /**
   * A message to SeeBuyGet, from the help's "Write to us". No sign-in: the person who most needs to write is often the one
   * who cannot get in. Ten from one caller in a quarter of an hour, and five open from one address, are what a person needs.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 15 * 60)
  @Post('support/messages')
  write(@Body() dto: SupportMessageDto): Promise<SupportReceivedView> {
    return this.support.write(dto);
  }

  /** The messages, sorted: open ones by default — urgent first, then whoever has waited longest. */
  @Roles('operator')
  @Get('ops/support')
  inbox(@Query('status') status?: string): SupportInboxView {
    const s: SupportStatus = status === 'answered' || status === 'closed' ? status : 'open';
    return this.support.inbox(s);
  }

  /** An answer, by email to the address the person gave, kept with the message under the name of who wrote it. */
  @Roles('operator')
  @Post('ops/support/:reference/answer')
  answer(@Param('reference') reference: string, @Body() dto: SupportAnswerDto, @Actor() actor: IntrospectionResult): Promise<SupportMessageView> {
    return this.support.answer(reference, dto.text, auditActor(actor));
  }

  @Roles('operator')
  @Post('ops/support/:reference/close')
  close(@Param('reference') reference: string, @Actor() actor: IntrospectionResult): SupportMessageView {
    return this.support.close(reference, auditActor(actor));
  }
}
