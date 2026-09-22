import { Global, Module } from '@nestjs/common';
import { FundingService } from './funding.service';
import { SandboxFundingRail } from './sandbox-funding-rail.adapter';
import { FUNDING_RAIL } from './funding.types';
import { FundingController } from './funding.controller';

/**
 * Global, like the books it posts to and like the payouts it mirrors: money arriving is not one module's
 * business, and a shop's float and a store's prepaid balance come in through the same door.
 *
 * The rail is bound by token, so a Daraja C2B adapter replaces the sandbox one without a line changing
 * anywhere else — the same seam as the payout rail, the geocoder and the router.
 */
@Global()
@Module({
  controllers: [FundingController],
  providers: [FundingService, SandboxFundingRail, { provide: FUNDING_RAIL, useExisting: SandboxFundingRail }],
  exports: [FundingService, FUNDING_RAIL],
})
export class FundingModule {}
