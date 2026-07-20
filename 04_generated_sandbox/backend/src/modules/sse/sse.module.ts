import { Module } from '@nestjs/common';
import { M1Module } from '../m1/m1.module';
import { SseController } from './sse.controller';
import { EscrowService } from './escrow.service';
import { InvoiceService } from './invoice.service';
import { ComplianceService } from './compliance.service';
import { SettlementListener } from './settlement-listener.service';
import { FxService } from './fx.service';
import { TripleEntryLedger } from './triple-entry-ledger.service';
import { DisputeService } from './dispute.service';

/**
 * SSE — Smart Settlement & Escrow Engine.
 * Epic: 02_epic_domains/epic_sse_smart_settlement.md.
 * Sprint 1 (loop) + Sprint 2 (fees/FX/penalty/staged) + Sprint 3 (disputes/triple-entry).
 * Escrow funds from M1 wallets; milestone releases driven by M4 oracle events; auto-created from
 * M3 match.confirmed. Imports M1Module for WalletService; foundations are global.
 */
@Module({
  imports: [M1Module],
  controllers: [SseController],
  providers: [EscrowService, InvoiceService, ComplianceService, SettlementListener, FxService, TripleEntryLedger, DisputeService],
})
export class SseModule {}
