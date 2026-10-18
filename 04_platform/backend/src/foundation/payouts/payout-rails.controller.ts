import { Body, Controller, HttpCode, Inject, Ip, Optional, Param, Post } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { GlosError } from '../http/glos-error';
import { MPESA_PAYOUT_RAIL, type B2cResult, type MpesaPayoutRail } from './mpesa-payout-rail.adapter';
import { PayoutService } from './payout.service';

/**
 * WHERE A PAYOUT RAIL SAYS WHAT HAPPENED — M-Pesa's B2C result and queue-timeout URLs.
 *
 * Public, because Safaricom signs nothing and carries no token of ours; what admits a body is the rail: Safaricom's
 * addresses (the loopback only in a sandbox), and a request id we made and kept before we sent it. Anything it can read
 * and match is answered as accepted — a provider that is not answered retries until it is.
 */
@Controller('rails/payouts')
export class PayoutRailsController {
  constructor(
    private readonly payouts: PayoutService,
    @Optional() @Inject(MPESA_PAYOUT_RAIL) private readonly mpesa?: MpesaPayoutRail | null,
  ) {}

  @Public()
  @ApiExcludeEndpoint()
  @HttpCode(200)
  @Post(':provider/result')
  result(@Param('provider') provider: string, @Body() body: unknown, @Ip() ip: string): { ResultCode: number; ResultDesc: string } {
    return this.take(this.rail(provider).result(body, { ip }));
  }

  @Public()
  @ApiExcludeEndpoint()
  @HttpCode(200)
  @Post(':provider/timeout')
  timeout(@Param('provider') provider: string, @Body() body: unknown, @Ip() ip: string): { ResultCode: number; ResultDesc: string } {
    return this.take(this.rail(provider).timeout(body, { ip }));
  }

  private rail(provider: string): MpesaPayoutRail {
    if (provider !== 'mpesa' || !this.mpesa) throw new GlosError('NOT_FOUND', 'No such payout rail on this server');
    return this.mpesa;
  }

  private take(result: B2cResult): { ResultCode: number; ResultDesc: string } {
    this.payouts.fromRail(result);
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }
}
