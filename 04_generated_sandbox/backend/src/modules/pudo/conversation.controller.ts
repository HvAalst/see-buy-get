import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { ConversationService } from './conversation.service';
// In a *.dto.ts file on purpose: the swagger plugin only introspects those, and a DTO declared here publishes
// an empty request body to the contract (the gate caught exactly that).
import { OpenConversationDto, ProposePriceInThreadDto, ReadMarkerDto, RecordSettlementDto, ReportMessageDto, SendMessageDto } from './conversation.dto';

/**
 * CV1 — CONVERSATIONS ABOUT A LOAD (05_engineering/conversations.md).
 *
 * Every route acts as the token's OWN identity and never accepts one in the body: a thread is readable by its
 * two parties and nobody else, and that includes an operator. An operator sees only what a party chose to
 * report (and, in CV3, a dispute report the parties chose to share).
 */
@Controller('sbg/conversations')
export class ConversationController {
  constructor(private readonly conversations: ConversationService) {}

  @Get()
  mine(@Actor() actor: IntrospectionResult) {
    return this.conversations.listFor(didOf(actor));
  }

  /** Ask about a load, or return to the thread already asked. */
  @Post()
  open(@Body() dto: OpenConversationDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.open(dto.freightId, didOf(actor));
  }

  /** Reported messages, newest first — the operator's review list (CV3 gives it a screen). */
  @Roles('operator')
  @Get('reports')
  reports() {
    return { items: this.conversations.listReports() };
  }

  @Get(':id/messages')
  messages(@Param('id') id: string, @Query('after') after: string | undefined, @Actor() actor: IntrospectionResult) {
    return this.conversations.messagesFor(id, didOf(actor), Math.max(0, Math.floor(Number(after) || 0)));
  }

  @Post(':id/messages')
  send(@Param('id') id: string, @Body() dto: SendMessageDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.send(id, didOf(actor), dto);
  }

  /** CV2 — the driver names a price, through the load's own negotiation. */
  @Post(':id/proposals')
  propose(@Param('id') id: string, @Body() dto: ProposePriceInThreadDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.proposePrice(id, didOf(actor), dto);
  }

  /** CV2 — the poster accepts a price in the thread. Accepting claims the load for that driver. */
  @Post(':id/proposals/:proposalId/accept')
  acceptPrice(@Param('id') id: string, @Param('proposalId') proposalId: string, @Actor() actor: IntrospectionResult) {
    return this.conversations.decideProposal(id, didOf(actor), proposalId, 'accept');
  }

  @Post(':id/proposals/:proposalId/decline')
  declinePrice(@Param('id') id: string, @Param('proposalId') proposalId: string, @Actor() actor: IntrospectionResult) {
    return this.conversations.decideProposal(id, didOf(actor), proposalId, 'decline');
  }

  /** CV2 — write down how a load the network does not pay will be settled. */
  @Post(':id/settlements')
  recordSettlement(@Param('id') id: string, @Body() dto: RecordSettlementDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.recordSettlement(id, didOf(actor), dto);
  }

  /** CV2 — the other party agrees to a written-down settlement. */
  @Post(':id/messages/:seq/agree')
  agreeSettlement(@Param('id') id: string, @Param('seq') seq: string, @Actor() actor: IntrospectionResult) {
    return this.conversations.agreeSettlement(id, didOf(actor), Number(seq));
  }

  @Post(':id/read')
  read(@Param('id') id: string, @Body() dto: ReadMarkerDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.markRead(id, didOf(actor), dto.seq);
  }

  @Post(':id/block')
  block(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    return this.conversations.block(id, didOf(actor));
  }

  @Post(':id/unblock')
  unblock(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    return this.conversations.unblock(id, didOf(actor));
  }

  @Post(':id/messages/:seq/report')
  report(@Param('id') id: string, @Param('seq') seq: string, @Body() dto: ReportMessageDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.report(id, didOf(actor), Number(seq), dto.reason);
  }
}

/** A conversation is between people with an identity. No identity, no thread. */
function didOf(actor: IntrospectionResult | undefined): string {
  if (!actor?.did) throw new GlosError('FORBIDDEN', 'Sign in to use conversations');
  return actor.did;
}
