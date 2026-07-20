import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { Escrow, Invoice, InvoiceLine, MilestoneName } from './escrow.types';

/**
 * InvoiceService — smart invoices (SSE-020/021/022/023). Draft on creation; each release adds a
 * live line with the full money breakdown (gross / fee / penalty / bonus / net); finalizes +
 * anchors on completion. Lines carry the payee DID so multi-party shipments roll up.
 */
@Injectable()
export class InvoiceService {
  private readonly byEscrow = new Map<string, Invoice>();

  constructor(private readonly ledger: LedgerService) {}

  createDraft(escrow: Escrow): Invoice {
    const invoice: Invoice = {
      invoiceId: `inv_${randomBytes(10).toString('hex')}`,
      escrowId: escrow.escrowId,
      glosShipmentId: escrow.glosShipmentId,
      currency: escrow.currency,
      status: 'draft',
      lines: [],
      total: escrow.totalAmount,
      feesTotal: 0,
    };
    this.byEscrow.set(escrow.escrowId, invoice);
    return invoice;
  }

  addReleaseLine(
    escrowId: string,
    milestone: MilestoneName,
    payeeDid: string,
    parts: { gross: number; fee: number; penalty: number; bonus: number; net: number; triggerEventId?: string },
  ): InvoiceLine {
    const invoice = this.require(escrowId);
    const line: InvoiceLine = { milestone, payeeDid, currency: invoice.currency, ...parts, at: new Date().toISOString() };
    invoice.lines.push(line);
    invoice.feesTotal = Math.round((invoice.feesTotal + parts.fee) * 100) / 100;
    return line;
  }

  finalize(escrowId: string): Invoice {
    const invoice = this.require(escrowId);
    invoice.status = 'final';
    invoice.finalizedAt = new Date().toISOString();
    invoice.anchorTxId = this.ledger.anchor({ invoiceId: invoice.invoiceId, lines: invoice.lines, total: invoice.total }).txId;
    return invoice;
  }

  get(escrowId: string): Invoice | undefined {
    return this.byEscrow.get(escrowId);
  }

  private require(escrowId: string): Invoice {
    const invoice = this.byEscrow.get(escrowId);
    if (!invoice) throw new NotFoundException(`No invoice for escrow ${escrowId}`);
    return invoice;
  }
}
