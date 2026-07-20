import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../../../foundation/auth/public.decorator';
import { IdentityService } from '../identity.service';
import { WalletService } from './wallet.service';
import { MultiSigService } from './multi-sig.service';
import { SettlementTrigger } from './wallet.types';
import { ApproveDto, BankLinkVerifyDto, CashOutDto, CreditDto, SettlementTriggerDto, WithdrawalDto } from './wallet.dto';

/**
 * Wallet endpoints for a participant (UDIW-040/043/044/052).
 * NOTE: marked @Public for the prototype so the wallet UX is demoable. In production these
 * require per-owner authorization (a DID-bound token whose subject owns the account).
 */
@Public()
@Controller('identity/accounts/:accountId/wallet')
export class WalletController {
  constructor(
    private readonly identity: IdentityService,
    private readonly wallet: WalletService,
    private readonly multiSig: MultiSigService,
  ) {}

  private didFor(accountId: string): string {
    const account = this.identity.getAccount(accountId); // 404 if account missing
    if (!account.did) throw new BadRequestException('Wallet not ready — verify identity first');
    return account.did;
  }

  @Get()
  get(@Param('accountId') accountId: string) {
    return this.wallet.summary(this.didFor(accountId));
  }

  @Post('cash-out')
  cashOut(@Param('accountId') accountId: string, @Body() dto: CashOutDto) {
    return this.wallet.payout(this.didFor(accountId), dto);
  }

  /** Prototype helper to simulate task earnings landing in the wallet. */
  @Post('credit')
  credit(@Param('accountId') accountId: string, @Body() dto: CreditDto) {
    return this.wallet.summary(this.wallet.credit(this.didFor(accountId), dto.amount, dto.currency).did);
  }

  @Post('settlement-trigger')
  setTrigger(@Param('accountId') accountId: string, @Body() dto: SettlementTriggerDto) {
    return this.wallet.setSettlementTrigger(this.didFor(accountId), dto.trigger as unknown as SettlementTrigger);
  }

  @Post('bank-link/start')
  bankLinkStart(@Param('accountId') accountId: string) {
    return this.wallet.startBankLink(this.didFor(accountId));
  }

  @Post('bank-link/verify')
  bankLinkVerify(@Param('accountId') accountId: string, @Body() dto: BankLinkVerifyDto) {
    return this.wallet.verifyBankLink(this.didFor(accountId), dto.challengeId, dto.amount1, dto.amount2);
  }

  @Post('withdrawals')
  withdraw(@Param('accountId') accountId: string, @Body() dto: WithdrawalDto) {
    return this.multiSig.requestWithdrawal(this.didFor(accountId), dto);
  }

  @Post('withdrawals/:requestId/approve')
  approve(@Param('requestId') requestId: string, @Body() dto: ApproveDto) {
    return this.multiSig.approve(requestId, dto.adminId);
  }
}
