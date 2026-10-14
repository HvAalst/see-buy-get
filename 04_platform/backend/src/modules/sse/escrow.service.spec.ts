import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { InvoiceService } from './invoice.service';
import { ComplianceService } from './compliance.service';
import { SettlementListener } from './settlement-listener.service';
import { FxService } from './fx.service';
import { TripleEntryLedger } from './triple-entry-ledger.service';
import { DisputeService } from './dispute.service';
import { WalletService } from '../m1/wallet/wallet.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';

describe('SSE settlement (depth)', () => {
  let escrow: EscrowService;
  let wallet: WalletService;
  let compliance: ComplianceService;
  let listener: SettlementListener;
  let disputes: DisputeService;
  let journal: TripleEntryLedger;
  let events: EventBus;

  const payer = 'did:glos:shipper';
  const payee = 'did:glos:carrier';

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EscrowService, InvoiceService, ComplianceService, SettlementListener, FxService, TripleEntryLedger, DisputeService,
        WalletService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    escrow = moduleRef.get(EscrowService);
    wallet = moduleRef.get(WalletService);
    compliance = moduleRef.get(ComplianceService);
    listener = moduleRef.get(SettlementListener);
    disputes = moduleRef.get(DisputeService);
    journal = moduleRef.get(TripleEntryLedger);
    events = moduleRef.get(EventBus);

    wallet.provision(payer, { jurisdiction: 'US' });
    wallet.provision(payee, { jurisdiction: 'US' });
    wallet.credit(payer, 2000);
  });

  // commissionRate 0 keeps the core-flow math clean.
  const terms = (shipmentId: string, over: Record<string, unknown> = {}) => ({
    glosShipmentId: shipmentId,
    payerDid: payer,
    currency: 'USD',
    totalAmount: 1000,
    commissionRate: 0,
    milestones: [
      { name: 'PICKUP' as const, percent: 20, payeeDid: payee },
      { name: 'HANDOVER' as const, percent: 50, payeeDid: payee },
      { name: 'DELIVERY' as const, percent: 30, payeeDid: payee },
    ],
    ...over,
  });

  it('creates + funds, releases milestones, reconciles, finalizes invoice + journal', () => {
    const e = escrow.create(terms('S1'));
    escrow.fund(e.escrowId);
    expect(wallet.balanceOf(payer)).toBe(1000);

    escrow.releaseByMilestone('S1', 'PICKUP');
    escrow.releaseByMilestone('S1', 'HANDOVER');
    escrow.releaseByMilestone('S1', 'DELIVERY');
    expect(wallet.balanceOf(payee)).toBe(1000);
    expect(escrow.summary(e.escrowId).status).toBe('released');
    expect(journal.verify(e.escrowId)).toBe(true); // SSE-082 chain intact
  });

  it('rejects bad terms and overdrawn funding', () => {
    expect(() => escrow.create({ ...terms('S2'), milestones: [{ name: 'PICKUP', percent: 40, payeeDid: payee }] })).toThrow(BadRequestException);
    const e = escrow.create({ ...terms('S3'), totalAmount: 5000 });
    expect(() => escrow.fund(e.escrowId)).toThrow(BadRequestException);
  });

  it('deducts the GLOS commission with a transparent breakdown (SSE-041)', () => {
    const e = escrow.create(terms('S4', { commissionRate: 0.1 }));
    escrow.fund(e.escrowId);
    escrow.releaseByMilestone('S4', 'PICKUP'); // gross 200
    expect(wallet.balanceOf(payee)).toBe(180); // 200 − 10% fee
    expect(escrow.summary(e.escrowId).feesCollected).toBe(20);
  });

  it('settles cross-border with FX into the payee currency (SSE-042/071)', () => {
    wallet.provision('did:glos:eu-carrier', { jurisdiction: 'NL' }); // EUR wallet
    const e = escrow.create({ ...terms('S5'), milestones: [{ name: 'PICKUP', percent: 100, payeeDid: 'did:glos:eu-carrier' }] });
    escrow.fund(e.escrowId);
    escrow.releaseByMilestone('S5', 'PICKUP');
    expect(wallet.balanceOf('did:glos:eu-carrier', 'EUR')).toBeGreaterThan(0);
    const ms = escrow.get(e.escrowId).milestones[0];
    expect(ms.fx?.currency).toBe('EUR');
  });

  it('applies a late penalty and refunds the payer (SSE-034)', () => {
    const e = escrow.create({ ...terms('S6'), milestones: [{ name: 'DELIVERY', percent: 100, payeeDid: payee }], deadline: '2020-01-01T00:00:00Z', latePenaltyPct: 0.1 });
    escrow.fund(e.escrowId);
    const payerBefore = wallet.balanceOf(payer);
    escrow.releaseByMilestone('S6', 'DELIVERY'); // late → 10% penalty
    expect(wallet.balanceOf(payee)).toBe(900);
    expect(wallet.balanceOf(payer)).toBe(payerBefore + 100); // penalty refunded
  });

  it('supports staged funding (SSE-012)', () => {
    const e = escrow.create({ ...terms('S7'), staged: true, milestones: [{ name: 'PICKUP', percent: 50, payeeDid: payee }, { name: 'DELIVERY', percent: 50, payeeDid: payee }] });
    escrow.fund(e.escrowId, 'PICKUP');
    expect(escrow.releaseByMilestone('S7', 'PICKUP').released).toBe(true);
    expect(escrow.releaseByMilestone('S7', 'DELIVERY').reason).toBe('not_funded');
    escrow.fund(e.escrowId, 'DELIVERY');
    expect(escrow.releaseByMilestone('S7', 'DELIVERY').released).toBe(true);
  });

  it('settles automatically from an M4 oracle event (the loop)', async () => {
    listener.onModuleInit();
    const e = escrow.create(terms('S8'));
    escrow.fund(e.escrowId);
    await events.publish(GlosEvent.Tracking.PickupOk, { glosShipmentId: 'S8', eventId: 'evt-1' });
    expect(wallet.balanceOf(payee)).toBe(200);
  });

  it('files a dispute (freeze) then resolves it, paying the split and notifying M5 (SSE-050..054)', async () => {
    const e = escrow.create(terms('S9'));
    escrow.fund(e.escrowId);

    const dispute = disputes.file({ escrowId: e.escrowId, milestone: 'PICKUP', tag: 'delay', reason: 'late pickup', filedByDid: payer });
    expect(escrow.releaseByMilestone('S9', 'PICKUP').reason).toBe('no_pending_milestone'); // frozen

    disputes.resolve(dispute.disputeId, { level: 1, atFault: true, atFaultDid: payee });
    expect(wallet.balanceOf(payee)).toBe(0); // payee at fault → nothing
    expect(wallet.balanceOf(payer)).toBe(1200); // funded 1000 (from 2000), pickup 200 refunded
    expect(events.getLog().some((ev) => ev.type === GlosEvent.Settlement.DisputeResolved)).toBe(true);
  });

  it('freezes a release on a compliance hold (SSE-072)', () => {
    const e = escrow.create(terms('S10'));
    escrow.fund(e.escrowId);
    compliance.placeHold(payee);
    expect(escrow.releaseByMilestone('S10', 'PICKUP').reason).toBe('compliance_hold');
    expect(wallet.balanceOf(payee)).toBe(0);
  });
});
