import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { WalletService } from './wallet.service';
import { PayoutRecord } from './wallet.types';

// Multi-party approval for corporate wallets (UDIW-052). Withdrawals above a configurable
// amount require a quorum of designated admins before execution.

interface MultiSigConfig {
  admins: string[];
  threshold: number; // approvals required
  amountThreshold: number; // only amounts above this need multi-sig
}

interface WithdrawalRequest {
  requestId: string;
  did: string;
  amount: number;
  currency?: string;
  destination?: string;
  approvals: Set<string>;
  requiredApprovals: number;
  status: 'pending' | 'executed';
  payout?: PayoutRecord;
}

export interface WithdrawalOutcome {
  status: 'pending' | 'executed';
  requestId?: string;
  requiredApprovals?: number;
  approvals?: number;
  payout?: PayoutRecord;
}

@Injectable()
export class MultiSigService {
  private readonly configs = new Map<string, MultiSigConfig>();
  private readonly requests = new Map<string, WithdrawalRequest>();

  constructor(private readonly wallet: WalletService) {}

  configure(did: string, config: MultiSigConfig): void {
    if (config.threshold < 1 || config.threshold > config.admins.length) {
      throw new ForbiddenException('threshold must be between 1 and the number of admins');
    }
    this.configs.set(did, config);
    this.wallet.setCorporate(did, true);
  }

  /** Request a withdrawal. Small amounts (or non-corporate) execute immediately. */
  requestWithdrawal(
    did: string,
    input: { amount: number; currency?: string; destination?: string; requestedBy?: string },
  ): WithdrawalOutcome {
    const wallet = this.wallet.require(did);
    const config = this.configs.get(did);
    const needsMultiSig = wallet.corporate && config && input.amount > config.amountThreshold;

    if (!needsMultiSig) {
      const payout = this.wallet.payout(did, input);
      return { status: 'executed', payout };
    }

    const request: WithdrawalRequest = {
      requestId: `wr_${randomBytes(10).toString('hex')}`,
      did,
      amount: input.amount,
      currency: input.currency,
      destination: input.destination,
      approvals: new Set(input.requestedBy ? [input.requestedBy] : []),
      requiredApprovals: config!.threshold,
      status: 'pending',
    };
    this.requests.set(request.requestId, request);
    return this.maybeExecute(request);
  }

  approve(requestId: string, adminId: string): WithdrawalOutcome {
    const request = this.requests.get(requestId);
    if (!request) throw new NotFoundException(`Withdrawal request not found: ${requestId}`);
    if (request.status === 'executed') return this.outcome(request);

    const config = this.configs.get(request.did);
    if (!config || !config.admins.includes(adminId)) {
      throw new ForbiddenException('Not an authorized admin for this wallet');
    }
    request.approvals.add(adminId);
    return this.maybeExecute(request);
  }

  getRequest(requestId: string): WithdrawalOutcome {
    const request = this.requests.get(requestId);
    if (!request) throw new NotFoundException(`Withdrawal request not found: ${requestId}`);
    return this.outcome(request);
  }

  private maybeExecute(request: WithdrawalRequest): WithdrawalOutcome {
    if (request.approvals.size >= request.requiredApprovals) {
      request.payout = this.wallet.payout(request.did, {
        amount: request.amount,
        currency: request.currency,
        destination: request.destination,
      });
      request.status = 'executed';
    }
    return this.outcome(request);
  }

  private outcome(request: WithdrawalRequest): WithdrawalOutcome {
    return {
      status: request.status,
      requestId: request.requestId,
      requiredApprovals: request.requiredApprovals,
      approvals: request.approvals.size,
      payout: request.payout,
    };
  }
}
