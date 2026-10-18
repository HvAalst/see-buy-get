import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { storeClaimed } from '../../foundation/store/one-writer';
import { storeEngine } from '../../foundation/store/persistent-map';
import { EvidenceView } from './evidence.types';

/**
 * EVIDENCE THAT LASTS, for network staff (the user, 2026-10-18): whether every fingerprint the network has handed out
 * can still be checked — the anchors kept and chained (fabric-ledger.adapter.ts) — and which one server writes the
 * store (one-writer.ts).
 */
@Controller('sbg')
export class EvidenceController {
  constructor(private readonly ledger: LedgerService) {}

  @Roles('operator')
  @Get('evidence')
  evidence(): EvidenceView {
    const check = this.ledger.check();
    const claim = storeClaimed();
    return {
      ...(check ? { ledger: check } : {}),
      store: { engine: claim?.engine ?? storeEngine(), claimed: Boolean(claim), ...(claim ? { pid: claim.pid, since: claim.since } : {}) },
    };
  }
}
