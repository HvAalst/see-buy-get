import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { EscrowService, CreateEscrowInput } from './escrow.service';
import { InvoiceService } from './invoice.service';
import { DisputeService } from './dispute.service';
import { TripleEntryLedger } from './triple-entry-ledger.service';
import { FxService } from './fx.service';
import { CreateEscrowDto, FileDisputeDto, FundDto, ResolveDisputeDto } from './sse.dto';

interface ModuleInfo {
  module: string;
  name: string;
  epic: string;
  status: 'active';
}

/** SSE settlement endpoints. DID-authenticated (global guard; no @Public). */
@Controller('settlement')
export class SseController {
  constructor(
    private readonly escrow: EscrowService,
    private readonly invoices: InvoiceService,
    private readonly disputes: DisputeService,
    private readonly journal: TripleEntryLedger,
    private readonly fx: FxService,
  ) {}

  @Get('module-info')
  info(): ModuleInfo {
    return { module: 'SSE', name: 'Smart Settlement & Escrow Engine', epic: '02_epic_domains/epic_sse_smart_settlement.md', status: 'active' };
  }

  @Get('fx/:from/:to')
  fxQuote(@Param('from') from: string, @Param('to') to: string) {
    return this.fx.quote(from.toUpperCase(), to.toUpperCase());
  }

  @Post('escrows')
  create(@Body() dto: CreateEscrowDto) {
    return this.escrow.create(dto as unknown as CreateEscrowInput);
  }

  @Post('escrows/:id/fund')
  fund(@Param('id') id: string, @Body() dto: FundDto) {
    return this.escrow.summary(this.escrow.fund(id, dto?.milestone).escrowId);
  }

  @Post('escrows/:id/accept')
  accept(@Param('id') id: string) {
    return this.escrow.summary(this.escrow.accept(id).escrowId);
  }

  @Get('escrows/:id')
  get(@Param('id') id: string) {
    return this.escrow.summary(id);
  }

  @Get('escrows/:id/invoice')
  invoice(@Param('id') id: string) {
    return this.invoices.get(id);
  }

  /** Triple-entry journal + chain verification (SSE-082). */
  @Get('escrows/:id/journal')
  journalEntries(@Param('id') id: string) {
    return { entries: this.journal.journal(id), verified: this.journal.verify(id) };
  }

  @Get('escrows/by-shipment/:glosShipmentId')
  byShipment(@Param('glosShipmentId') glosShipmentId: string) {
    const escrow = this.escrow.getByShipment(glosShipmentId);
    if (!escrow) throw new NotFoundException(`No escrow for shipment ${glosShipmentId}`);
    return this.escrow.summary(escrow.escrowId);
  }

  // --- disputes (SSE-050..054) ---

  @Post('escrows/:id/disputes')
  fileDispute(@Param('id') id: string, @Body() dto: FileDisputeDto) {
    return this.disputes.file({ escrowId: id, ...dto });
  }

  @Get('disputes/:disputeId/evidence')
  evidence(@Param('disputeId') disputeId: string) {
    return this.disputes.evidencePack(disputeId);
  }

  @Post('disputes/:disputeId/resolve')
  resolveDispute(@Param('disputeId') disputeId: string, @Body() dto: ResolveDisputeDto) {
    return this.disputes.resolve(disputeId, dto);
  }
}
