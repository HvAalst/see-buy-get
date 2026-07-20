import { BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { EventBus } from '../../../foundation/events/event-bus.service';
import { GlosEvent } from '../../../foundation/events/glos-events';

describe('WalletService', () => {
  let wallet: WalletService;
  let events: EventBus;

  beforeEach(() => {
    events = new EventBus();
    wallet = new WalletService(events);
  });

  it('provisions idempotently and picks currency by jurisdiction (T-201)', () => {
    const a = wallet.provision('did:glos:1', { jurisdiction: 'NL' });
    const b = wallet.provision('did:glos:1', { jurisdiction: 'NL' });
    expect(a).toBe(b); // idempotent
    expect(a.settlementCurrency).toBe('EUR');
    expect(wallet.provision('did:glos:2', { jurisdiction: 'US' }).settlementCurrency).toBe('USD');
    expect(events.getLog().filter((e) => e.type === GlosEvent.Wallet.Provisioned)).toHaveLength(2);
  });

  it('credits and pays out instantly, emitting PayoutCompleted (T-203)', () => {
    wallet.provision('did:glos:1', { jurisdiction: 'US' });
    wallet.credit('did:glos:1', 50);
    const payout = wallet.payout('did:glos:1', { amount: 30 });
    expect(payout.status).toBe('completed');
    expect(payout.currency).toBe('USD');
    expect(wallet.balanceOf('did:glos:1')).toBe(20);
    expect(events.getLog().some((e) => e.type === GlosEvent.Wallet.PayoutCompleted)).toBe(true);
  });

  it('rejects overdrawn payouts', () => {
    wallet.provision('did:glos:1');
    wallet.credit('did:glos:1', 10);
    expect(() => wallet.payout('did:glos:1', { amount: 25 })).toThrow(BadRequestException);
  });

  it('validates settlement triggers (T-202)', () => {
    wallet.provision('did:glos:1');
    expect(wallet.setSettlementTrigger('did:glos:1', { type: 'instant' }).settlementTrigger.type).toBe('instant');
    expect(
      wallet.setSettlementTrigger('did:glos:1', {
        type: 'time_locked',
        stages: [{ milestone: 'pickup', percent: 50 }, { milestone: 'delivery', percent: 50 }],
      }).settlementTrigger.type,
    ).toBe('time_locked');
    expect(() =>
      wallet.setSettlementTrigger('did:glos:1', {
        type: 'time_locked',
        stages: [{ milestone: 'pickup', percent: 40 }],
      }),
    ).toThrow(BadRequestException); // stages must sum to 100
  });

  it('links a bank account via matching micro-deposits (T-208)', () => {
    wallet.provision('did:glos:1');
    const challenge = wallet.startBankLink('did:glos:1');
    expect(wallet.verifyBankLink('did:glos:1', challenge.challengeId, challenge.amounts[0], challenge.amounts[1]).linked).toBe(true);
    expect(wallet.summary('did:glos:1').bankLinked).toBe(true);
  });

  it('rejects bank-link with wrong amounts', () => {
    wallet.provision('did:glos:1');
    const challenge = wallet.startBankLink('did:glos:1');
    expect(() => wallet.verifyBankLink('did:glos:1', challenge.challengeId, 9.99, 9.98)).toThrow(BadRequestException);
  });
});
