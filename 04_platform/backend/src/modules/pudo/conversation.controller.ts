import { Body, Controller, Get, Header, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles, SignedIn } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { ConversationService } from './conversation.service';
// In a *.dto.ts file on purpose: the swagger plugin only introspects those, and a DTO declared here publishes
// an empty request body to the contract (the gate caught exactly that).
import {
  DisputeReportDto,
  OpenConversationDto,
  ProposePriceInThreadDto,
  ReadMarkerDto,
  RecordSettlementDto,
  ReportMessageDto,
  SendMessageDto,
  ShareConversationDto,
  VoiceMessageDto,
} from './conversation.dto';

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

  @SignedIn()
  @Get()
  mine(@Actor() actor: IntrospectionResult) {
    return this.conversations.listFor(didOf(actor));
  }

  /** Ask about a load — or (CV5) talk about a parcel waiting at a shop. Either returns to the thread already open. */
  @SignedIn()
  @Post()
  open(@Body() dto: OpenConversationDto, @Actor() actor: IntrospectionResult) {
    if (dto.parcelId) return this.conversations.openAboutParcel(dto.parcelId, didOf(actor));
    if (!dto.freightId) throw new GlosError('FIELD_REQUIRED', 'Say what the conversation is about: a load, or a parcel');
    return this.conversations.open(dto.freightId, didOf(actor));
  }

  /** Reported messages, newest first — the operator's review list (CV3 gives it a screen). */
  @Roles('operator')
  @Get('reports')
  reports() {
    return { items: this.conversations.listReports() };
  }

  /** CV3 — the conversations this fleet's drivers chose to share with it. Read-only. */
  @Roles('fleet_manager')
  @Get('shared')
  shared(@Actor() actor: IntrospectionResult) {
    return this.conversations.listShared(didOf(actor));
  }

  /** CV3 — the reports of chosen messages that parties shared — the operator's side of a dispute. */
  @Roles('operator')
  @Get('dispute-reports')
  disputeReports() {
    return { items: this.conversations.listDisputeReports() };
  }

  /** CV4 — the operator plays a voice message a party chose to include in a shared report. */
  @Roles('operator')
  @Get('dispute-reports/:reportId/voice/:voiceId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  disputeVoice(@Param('reportId') reportId: string, @Param('voiceId') voiceId: string): StreamableFile {
    const { contentType, bytes } = this.conversations.voiceForReport(reportId, voiceId);
    return new StreamableFile(bytes, { type: contentType });
  }

  /** CV4 — send a voice message. */
  @SignedIn()
  @Post(':id/voice')
  sendVoice(@Param('id') id: string, @Body() dto: VoiceMessageDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.sendVoice(id, didOf(actor), dto);
  }

  /** CV4 — play a voice message: the thread's readers only. Never cached, never sniffed as something else. */
  @SignedIn()
  @Get(':id/voice/:voiceId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  voice(@Param('id') id: string, @Param('voiceId') voiceId: string, @Actor() actor: IntrospectionResult): StreamableFile {
    const { contentType, bytes } = this.conversations.voiceFor(id, voiceId, didOf(actor));
    return new StreamableFile(bytes, { type: contentType });
  }

  /** CV3 — the driver shares this conversation with their fleet manager, or stops sharing it. */
  @SignedIn()
  @Post(':id/share')
  share(@Param('id') id: string, @Body() dto: ShareConversationDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.setShared(id, didOf(actor), dto.on);
  }

  /** CV3 — a party shares a report of the messages they choose. The other side is told in the thread. */
  @SignedIn()
  @Post(':id/dispute-reports')
  shareDisputeReport(@Param('id') id: string, @Body() dto: DisputeReportDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.shareDisputeReport(id, didOf(actor), dto.seqs, dto.note);
  }

  @SignedIn()
  @Get(':id/messages')
  messages(@Param('id') id: string, @Query('after') after: string | undefined, @Actor() actor: IntrospectionResult) {
    return this.conversations.messagesFor(id, didOf(actor), Math.max(0, Math.floor(Number(after) || 0)));
  }

  @SignedIn()
  @Post(':id/messages')
  send(@Param('id') id: string, @Body() dto: SendMessageDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.send(id, didOf(actor), dto);
  }

  /** CV2 — the driver names a price, through the load's own negotiation. */
  @SignedIn()
  @Post(':id/proposals')
  propose(@Param('id') id: string, @Body() dto: ProposePriceInThreadDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.proposePrice(id, didOf(actor), dto);
  }

  /** CV2 — the poster accepts a price in the thread. Accepting claims the load for that driver. */
  @SignedIn()
  @Post(':id/proposals/:proposalId/accept')
  acceptPrice(@Param('id') id: string, @Param('proposalId') proposalId: string, @Actor() actor: IntrospectionResult) {
    return this.conversations.decideProposal(id, didOf(actor), proposalId, 'accept');
  }

  @SignedIn()
  @Post(':id/proposals/:proposalId/decline')
  declinePrice(@Param('id') id: string, @Param('proposalId') proposalId: string, @Actor() actor: IntrospectionResult) {
    return this.conversations.decideProposal(id, didOf(actor), proposalId, 'decline');
  }

  /** CV2 — write down how a load the network does not pay will be settled. */
  @SignedIn()
  @Post(':id/settlements')
  recordSettlement(@Param('id') id: string, @Body() dto: RecordSettlementDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.recordSettlement(id, didOf(actor), dto);
  }

  /** CV2 — the other party agrees to a written-down settlement. */
  @SignedIn()
  @Post(':id/messages/:seq/agree')
  agreeSettlement(@Param('id') id: string, @Param('seq') seq: string, @Actor() actor: IntrospectionResult) {
    return this.conversations.agreeSettlement(id, didOf(actor), Number(seq));
  }

  @SignedIn()
  @Post(':id/read')
  read(@Param('id') id: string, @Body() dto: ReadMarkerDto, @Actor() actor: IntrospectionResult) {
    return this.conversations.markRead(id, didOf(actor), dto.seq);
  }

  @SignedIn()
  @Post(':id/block')
  block(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    return this.conversations.block(id, didOf(actor));
  }

  @SignedIn()
  @Post(':id/unblock')
  unblock(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    return this.conversations.unblock(id, didOf(actor));
  }

  @SignedIn()
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
