import { ForbiddenException } from '@nestjs/common';
import { MultiSigService } from './multi-sig.service';
import { WalletService } from './wallet.service';
import { EventBus } from '../../../foundation/events/event-bus.service';

describe('MultiSigService (corporate withdrawals, T-206)', () => {
  let wallet: WalletService;
  let multiSig: MultiSigService;
  const did = 'did:glos:corp';

  beforeEach(() => {
    wallet = new WalletService(new EventBus());
    multiSig = new MultiSigService(wallet);
    wallet.provision(did, { jurisdiction: 'US', corporate: true });
    wallet.credit(did, 10000);
    multiSig.configure(did, { admins: ['admin-a', 'admin-b', 'admin-c'], threshold: 2, amountThreshold: 1000 });
  });

  it('executes small withdrawals immediately', () => {
    const outcome = multiSig.requestWithdrawal(did, { amount: 500, requestedBy: 'admin-a' });
    expect(outcome.status).toBe('executed');
    expect(outcome.payout?.amount).toBe(500);
  });

  it('holds large withdrawals until a quorum approves', () => {
    const req = multiSig.requestWithdrawal(did, { amount: 5000, requestedBy: 'admin-a' });
    expect(req.status).toBe('pending');
    expect(req.approvals).toBe(1);

    const afterSecond = multiSig.approve(req.requestId!, 'admin-b');
    expect(afterSecond.status).toBe('executed');
    expect(afterSecond.payout?.amount).toBe(5000);
    expect(wallet.balanceOf(did)).toBe(5000);
  });

  it('rejects approval from a non-admin', () => {
    const req = multiSig.requestWithdrawal(did, { amount: 5000, requestedBy: 'admin-a' });
    expect(() => multiSig.approve(req.requestId!, 'intruder')).toThrow(ForbiddenException);
  });

  it('counts duplicate approvals once', () => {
    const req = multiSig.requestWithdrawal(did, { amount: 5000, requestedBy: 'admin-a' });
    const again = multiSig.approve(req.requestId!, 'admin-a'); // same admin re-approves
    expect(again.status).toBe('pending');
    expect(again.approvals).toBe(1);
  });
});
