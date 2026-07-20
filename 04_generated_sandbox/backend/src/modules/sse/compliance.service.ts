import { Injectable } from '@nestjs/common';

// Pre-payout compliance screen (SSE-072). Sandbox stub: screen a DID against a hold list
// before any release. In production this re-checks sanctions + active account holds in real time.

export interface ScreenResult {
  ok: boolean;
  reason?: string;
}

@Injectable()
export class ComplianceService {
  private readonly holds = new Set<string>();

  screen(did: string): ScreenResult {
    return this.holds.has(did) ? { ok: false, reason: 'active_hold' } : { ok: true };
  }

  /** Test/ops hook to place a hold on a DID. */
  placeHold(did: string): void {
    this.holds.add(did);
  }
}
